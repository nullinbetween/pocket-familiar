import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp, AppDeps, VerifiedDiaryPage } from '../server/app';

/** PF-CORE-01 evidence 1, 2, 10: the seed proposal requires auth AND a
 * server-verified owner source; provenance (excerpt/date/refs) comes from the
 * verified record, never the model; nothing is persisted by the endpoint. */

const PAGE: VerifiedDiaryPage = {
  id: 'dp-long',
  userId: 'user-a',
  status: 'confirmed',
  title: 'A pocket of calm',
  date: '2026-09-03',
  todayInMyWords: 'On the walk home I left my phone in my bag and noticed the morning light.',
  whatFeltImportant: ['The walk home felt like mine again'],
  carryForward: 'Leave the walk home phone-free tomorrow.',
};

const GOOD_SEED = JSON.stringify({ seed: 'The walk home is mine again when I leave my phone in my bag.' });

function deps(opts: {
  generate?: AppDeps['generate'];
  getDiaryPage?: AppDeps['getDiaryPage'];
  omitGetDiaryPage?: boolean;
} = {}): AppDeps & { generateSpy: ReturnType<typeof vi.fn>; getPageSpy: ReturnType<typeof vi.fn> } {
  const generateSpy = (opts.generate ?? vi.fn(async () => ({ text: GOOD_SEED }))) as ReturnType<typeof vi.fn>;
  const getPageSpy = (opts.getDiaryPage ?? vi.fn(async (uid: string, pageId: string) => (uid === 'user-a' && pageId === 'dp-long' ? PAGE : null))) as ReturnType<typeof vi.fn>;
  return {
    verifyIdToken: vi.fn(async (t: string) => {
      if (t === 'good') return { uid: 'user-a' };
      throw new Error('bad token');
    }),
    generate: generateSpy,
    getDiaryPage: opts.omitGetDiaryPage ? undefined : getPageSpy,
    generateSpy,
    getPageSpy,
    models: ['m1', 'm2'],
    attemptTimeoutMs: 500,
    totalTimeoutMs: 1500,
  } as AppDeps & { generateSpy: ReturnType<typeof vi.fn>; getPageSpy: ReturnType<typeof vi.fn> };
}

const post = (d: AppDeps, body: object, token?: string) => {
  const r = request(createApp(d)).post('/api/gemini/memory-seed-draft');
  if (token) r.set('Authorization', `Bearer ${token}`);
  return r.send(body);
};

describe('evidence 1: proposal requires authentication and a verified owner source', () => {
  it('no token -> 401, neither source nor provider touched', async () => {
    const d = deps();
    const res = await post(d, { diaryPageId: 'dp-long' });
    expect(res.status).toBe(401);
    expect(d.getPageSpy).not.toHaveBeenCalled();
    expect(d.generateSpy).not.toHaveBeenCalled();
  });

  it('forged token -> 401', async () => {
    const d = deps();
    const res = await post(d, { diaryPageId: 'dp-long' }, 'forged');
    expect(res.status).toBe(401);
    expect(d.generateSpy).not.toHaveBeenCalled();
  });

  it('missing diaryPageId -> 400 before any fetch/model', async () => {
    const d = deps();
    const res = await post(d, {}, 'good');
    expect(res.status).toBe(400);
    expect(d.getPageSpy).not.toHaveBeenCalled();
    expect(d.generateSpy).not.toHaveBeenCalled();
  });

  it('source not found for this user -> 404, provider untouched', async () => {
    const d = deps({ getDiaryPage: vi.fn(async () => null) });
    const res = await post(d, { diaryPageId: 'nope' }, 'good');
    expect(res.status).toBe(404);
    expect(d.generateSpy).not.toHaveBeenCalled();
  });

  it('cross-user: a page owned by someone else is refused (defense in depth)', async () => {
    // Even if a fetch returned a foreign-owned record, the endpoint rejects it.
    const foreign = { ...PAGE, userId: 'user-b' };
    const d = deps({ getDiaryPage: vi.fn(async () => foreign) });
    const res = await post(d, { diaryPageId: 'dp-long' }, 'good');
    expect(res.status).toBe(404);
    expect(d.generateSpy).not.toHaveBeenCalled();
  });

  it('server without Firestore wiring -> 503, provider untouched', async () => {
    const d = deps({ omitGetDiaryPage: true });
    const res = await post(d, { diaryPageId: 'dp-long' }, 'good');
    expect(res.status).toBe(503);
    expect(d.generateSpy).not.toHaveBeenCalled();
  });
});

describe('evidence 2 & 10: returns a non-durable proposal; provenance is server-verified', () => {
  it('the endpoint fetches under the VERIFIED uid, not any client-supplied uid', async () => {
    const d = deps();
    await post(d, { diaryPageId: 'dp-long', uid: 'user-evil' }, 'good');
    expect(d.getPageSpy).toHaveBeenCalledWith('user-a', 'dp-long');
  });

  it('proposal text comes from the model, but excerpt/date/refs come from the verified page', async () => {
    const d = deps();
    const res = await post(d, { diaryPageId: 'dp-long' }, 'good');
    expect(res.status).toBe(200);
    expect(res.body.proposal.text).toBe('The walk home is mine again when I leave my phone in my bag.');
    expect(res.body.proposal.sourceDate).toBe('2026-09-03');
    expect(res.body.proposal.sourceExcerpt).toContain('left my phone in my bag');
    expect(res.body.proposal.sourceRefs).toEqual([{ kind: 'diaryPage', id: 'dp-long', availability: 'available' }]);
  });

  it('model-supplied provenance is ignored — only the seed text is taken', async () => {
    const spoof = JSON.stringify({
      seed: 'a valid short seed sentence',
      sourceDate: '1999-01-01',
      sourceRefs: [{ kind: 'diaryPage', id: 'not-mine', availability: 'available' }],
      sourceExcerpt: 'attacker excerpt',
    });
    const d = deps({ generate: vi.fn(async () => ({ text: spoof })) });
    const res = await post(d, { diaryPageId: 'dp-long' }, 'good');
    expect(res.status).toBe(200);
    expect(res.body.proposal.sourceDate).toBe('2026-09-03'); // from page, not model
    expect(res.body.proposal.sourceRefs[0].id).toBe('dp-long'); // from page, not model
    expect(res.body.proposal.sourceExcerpt).not.toContain('attacker excerpt');
  });

  it('malformed / ungrounded model output fails closed (502), nothing persisted', async () => {
    const d = deps({ generate: vi.fn(async () => ({ text: 'not json at all' })) });
    const res = await post(d, { diaryPageId: 'dp-long' }, 'good');
    expect(res.status).toBe(502);
  });

  it('over-limit seed fails closed', async () => {
    const long = JSON.stringify({ seed: 'word '.repeat(60) });
    const d = deps({ generate: vi.fn(async () => ({ text: long })) });
    const res = await post(d, { diaryPageId: 'dp-long' }, 'good');
    expect(res.status).toBe(502);
  });
});
