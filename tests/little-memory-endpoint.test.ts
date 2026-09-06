import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp, AppDeps, GrowthStore, VerifiedDiaryPage, SourceDeletionChoice } from '../server/app';
import { MemorySeed, FamiliarProfile, LittleMemory, SceneBriefFields } from '../src/types';

/** PF-CORE-03A — the scene-brief draft/confirm/mutate endpoints require auth and
 * a server-verified owner source; provenance is server-derived; the draft is
 * bounded and fails closed; the save is explicit and idempotent. */

const PAGE: VerifiedDiaryPage = {
  id: 'dp-1', userId: 'user-a', status: 'confirmed', title: 'A pocket of calm', date: '2026-09-03',
  todayInMyWords: 'On the walk home I left my phone in my bag and noticed the morning light.',
  whatFeltImportant: ['The walk home felt like mine again'],
};

const BRIEF: SceneBriefFields = {
  title: 'A pocket of calm',
  setting: 'a quiet tree-lined street on the walk home',
  timeOfDay: 'morning',
  emotionalTone: 'quiet relief',
  familiarAction: 'Midnight pads beside her, tail curled, watching the light',
  visualMotifs: ['morning light through trees', 'a phone tucked away'],
  composition: 'wide, low angle with warm negative space',
  caption: 'The walk home is mine again.',
};
const GOOD_BRIEF = JSON.stringify(BRIEF);

function mkSeed(id: string, userId: string, status: MemorySeed['status'] = 'active'): MemorySeed {
  return {
    kind: 'memorySeed', id, userId, status, text: `seed ${id}`, sourceExcerpt: 'x', sourceDate: '2026-09-03',
    sourceRefs: [{ kind: 'diaryPage', id: 'dp-1', availability: 'available' }],
    aiAssisted: true, approvedByUser: true, editedByUser: false, createdAt: 1, confirmedAt: 1,
  };
}

class FakeStore implements GrowthStore {
  pages = new Map<string, VerifiedDiaryPage>();
  seeds = new Map<string, MemorySeed>();
  lms = new Map<string, LittleMemory>();
  confirmCalls = 0;
  private k(uid: string, id: string) { return `${uid}/${id}`; }
  async getDiaryPage(uid: string, pageId: string) { const p = this.pages.get(this.k(uid, pageId)); return p && p.userId === uid ? p : null; }
  async confirmSeedOnce() { throw new Error('unused'); return { seed: {} as MemorySeed, created: true }; }
  async editSeedText() { return null; }
  async revokeSeedById() { return null; }
  async deleteSeedById() {}
  async listActiveSeeds() { return []; }
  async getActiveSeedsByIds(uid: string, ids: string[]) {
    const want = new Set(ids);
    return [...this.seeds.values()].filter((s) => s.userId === uid && s.status === 'active' && s.id !== undefined && want.has(s.id));
  }
  async confirmLittleMemoryOnce(uid: string, id: string, record: Omit<LittleMemory, 'id'>) {
    this.confirmCalls += 1;
    const key = this.k(uid, id);
    const existing = this.lms.get(key);
    if (existing) return { littleMemory: existing, created: false };
    const littleMemory: LittleMemory = { ...record, id };
    this.lms.set(key, littleMemory);
    return { littleMemory, created: true };
  }
  async editLittleMemory(uid: string, id: string, fields: SceneBriefFields) {
    const lm = this.lms.get(this.k(uid, id));
    if (!lm) return null;
    const next = { ...lm, ...fields, editedByUser: true };
    this.lms.set(this.k(uid, id), next);
    return next;
  }
  async deleteLittleMemoryById(uid: string, id: string) { this.lms.delete(this.k(uid, id)); }
  async getLittleMemory(uid: string, id: string) { const lm = this.lms.get(this.k(uid, id)); return lm && lm.userId === uid ? lm : null; }
  async beginLittleMemoryGeneration(uid: string, id: string, generationId: string, model: string, fingerprint: string, now: number) {
    const lm = this.lms.get(this.k(uid, id));
    if (!lm) return { status: 'not_found' as const };
    if (lm.status !== 'brief_approved') return { status: 'not_approved' as const };
    if (lm.image?.generationId === generationId) return { status: 'exists_ready' as const, littleMemory: lm };
    if (lm.pendingGeneration?.status === 'generating') return { status: 'in_progress' as const, littleMemory: lm };
    const next: LittleMemory = { ...lm, pendingGeneration: { status: 'generating' as const, generationId, model, briefFingerprint: fingerprint, attemptStartedAt: now } };
    this.lms.set(this.k(uid, id), next);
    return { status: 'started' as const, littleMemory: next };
  }
  async finalizeLittleMemoryGeneration(uid: string, id: string, generationId: string, meta: { model: string; objectPath: string; mimeType: string; generatedAt: number; fingerprint: string }) {
    const lm = this.lms.get(this.k(uid, id));
    if (!lm) return { status: 'not_found' as const };
    if (lm.pendingGeneration?.generationId !== generationId) return { status: 'superseded' as const };
    const displacedObjectPath = lm.image?.objectPath;
    const next: LittleMemory = { ...lm, image: { status: 'ready' as const, generationId, model: meta.model, objectPath: meta.objectPath, mimeType: meta.mimeType, generatedAt: meta.generatedAt, briefFingerprint: meta.fingerprint } };
    delete next.pendingGeneration;
    this.lms.set(this.k(uid, id), next);
    return { status: 'ok' as const, littleMemory: next, displacedObjectPath };
  }
  async failLittleMemoryGeneration(uid: string, id: string, generationId: string, failureCode: string) {
    const lm = this.lms.get(this.k(uid, id));
    if (!lm) return { status: 'not_found' as const };
    if (lm.pendingGeneration?.generationId !== generationId) return { status: 'superseded' as const };
    this.lms.set(this.k(uid, id), { ...lm, pendingGeneration: { ...lm.pendingGeneration, status: 'failed', failureCode } });
    return { status: 'ok' as const };
  }
  async previewSeedDeletion(uid: string, seedId: string) {
    if (!this.seeds.get(this.k(uid, seedId))) return null;
    return { affectedLittleMemories: [], planVersion: 'seedv1:0:' };
  }
  async deleteSeedWithLittleMemories(uid: string, seedId: string) {
    if (!this.seeds.get(this.k(uid, seedId))) return { status: 'not_found' as const };
    this.seeds.delete(this.k(uid, seedId));
    return { status: 'ok' as const, updatedLittleMemories: 0 };
  }
  async previewSourceDeletion() { return { affectedSeeds: [], affectedLittleMemories: [], planVersion: 'v' }; }
  async deleteSourceWithDescendants(_u: string, _p: string, _c: SourceDeletionChoice) { return { status: 'ok' as const, deletedSeeds: 0, keptSeeds: 0, deletedLittleMemories: 0, keptLittleMemories: 0 }; }
  async activateKeeper() { return { profile: null as FamiliarProfile | null, outcome: 'no_profile' as const }; }
}

function appWith(store: GrowthStore | undefined, generate?: AppDeps['generate']) {
  const generateSpy = (generate ?? vi.fn(async () => ({ text: GOOD_BRIEF }))) as ReturnType<typeof vi.fn>;
  const deps = {
    verifyIdToken: vi.fn(async (t: string) => { if (t === 'a') return { uid: 'user-a' }; if (t === 'b') return { uid: 'user-b' }; throw new Error('bad'); }),
    generate: generateSpy, store, generateSpy,
    models: ['m1', 'm2'], attemptTimeoutMs: 500, totalTimeoutMs: 1500,
  } as AppDeps & { generateSpy: ReturnType<typeof vi.fn> };
  return { app: createApp(deps), deps };
}
const seededStore = () => { const s = new FakeStore(); s.pages.set('user-a/dp-1', PAGE); s.seeds.set('user-a/seed-1', mkSeed('seed-1', 'user-a')); return s; };

describe('scene-brief draft: auth + server-verified sources + bounded output', () => {
  it('no token -> 401, neither source nor provider touched', async () => {
    const { app, deps } = appWith(seededStore());
    const res = await request(app).post('/api/gemini/little-memory-draft').send({ diaryPageId: 'dp-1' });
    expect(res.status).toBe(401);
    expect(deps.generateSpy).not.toHaveBeenCalled();
  });
  it('no store wiring -> 503', async () => {
    const { app } = appWith(undefined);
    const res = await request(app).post('/api/gemini/little-memory-draft').set('Authorization', 'Bearer a').send({ diaryPageId: 'dp-1' });
    expect(res.status).toBe(503);
  });
  it('missing diaryPageId -> 400 before any model call', async () => {
    const { app, deps } = appWith(seededStore());
    const res = await request(app).post('/api/gemini/little-memory-draft').set('Authorization', 'Bearer a').send({});
    expect(res.status).toBe(400);
    expect(deps.generateSpy).not.toHaveBeenCalled();
  });
  it('cross-user page -> 404, provider untouched', async () => {
    const { app, deps } = appWith(seededStore());
    const res = await request(app).post('/api/gemini/little-memory-draft').set('Authorization', 'Bearer b').send({ diaryPageId: 'dp-1' });
    expect(res.status).toBe(404);
    expect(deps.generateSpy).not.toHaveBeenCalled();
  });
  it('a chosen seed that is not active -> 409, provider untouched', async () => {
    const store = seededStore();
    store.seeds.set('user-a/seed-x', mkSeed('seed-x', 'user-a', 'revoked'));
    const { app, deps } = appWith(store);
    const res = await request(app).post('/api/gemini/little-memory-draft').set('Authorization', 'Bearer a').send({ diaryPageId: 'dp-1', seedIds: ['seed-x'] });
    expect(res.status).toBe(409);
    expect(deps.generateSpy).not.toHaveBeenCalled();
  });
  it('returns a bounded draft plus SERVER-verified source metadata', async () => {
    const { app } = appWith(seededStore());
    const res = await request(app).post('/api/gemini/little-memory-draft').set('Authorization', 'Bearer a').send({ diaryPageId: 'dp-1', seedIds: ['seed-1'] });
    expect(res.status).toBe(200);
    expect(res.body.draft.title).toBe('A pocket of calm');
    expect(res.body.source.date).toBe('2026-09-03');
    expect(res.body.source.diaryPage.id).toBe('dp-1');
    expect(res.body.source.diaryPage.excerpt).toContain('left my phone in my bag');
    expect(res.body.source.seeds).toEqual([{ id: 'seed-1', text: 'seed seed-1' }]);
  });
  it('malformed / extra-key model output fails closed (502)', async () => {
    const bad = appWith(seededStore(), vi.fn(async () => ({ text: 'not json' })));
    expect((await request(bad.app).post('/api/gemini/little-memory-draft').set('Authorization', 'Bearer a').send({ diaryPageId: 'dp-1' })).status).toBe(502);
    const extra = appWith(seededStore(), vi.fn(async () => ({ text: JSON.stringify({ ...BRIEF, imageUrl: 'x' }) })));
    expect((await request(extra.app).post('/api/gemini/little-memory-draft').set('Authorization', 'Bearer a').send({ diaryPageId: 'dp-1' })).status).toBe(502);
  });
  it('fetches under the VERIFIED uid, not a client-supplied uid', async () => {
    const store = seededStore();
    const getSpy = vi.spyOn(store, 'getDiaryPage');
    const { app } = appWith(store);
    await request(app).post('/api/gemini/little-memory-draft').set('Authorization', 'Bearer a').send({ diaryPageId: 'dp-1', uid: 'user-evil' });
    expect(getSpy).toHaveBeenCalledWith('user-a', 'dp-1');
  });
});

describe('confirm: explicit, idempotent, server-derived provenance', () => {
  const confirmBody = (over: Record<string, unknown> = {}) => ({
    littleMemoryId: 'lm-1', diaryPageId: 'dp-1', seedIds: ['seed-1'], draftFields: BRIEF, approvedFields: BRIEF, ...over,
  });
  it('missing approvedFields -> 422, nothing saved', async () => {
    const store = seededStore();
    const { app } = appWith(store);
    const res = await request(app).post('/api/little-memory/confirm').set('Authorization', 'Bearer a').send({ littleMemoryId: 'lm-1', diaryPageId: 'dp-1' });
    expect(res.status).toBe(422);
    expect(store.lms.size).toBe(0);
  });
  it('a valid approval saves exactly once (201) and derives provenance from the source', async () => {
    const store = seededStore();
    const { app } = appWith(store);
    const res = await request(app).post('/api/little-memory/confirm').set('Authorization', 'Bearer a').send(confirmBody());
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(true);
    const lm = res.body.littleMemory as LittleMemory;
    expect(lm.kind).toBe('littleMemory');
    expect(lm.status).toBe('brief_approved');
    expect(lm.sourceRefs.map((r) => r.id).sort()).toEqual(['dp-1', 'seed-1']);
    expect(lm).not.toHaveProperty('imageUrl');
  });
  it('client-supplied source refs cannot be forged (provenance comes from the server)', async () => {
    const store = seededStore();
    const { app } = appWith(store);
    const res = await request(app).post('/api/little-memory/confirm').set('Authorization', 'Bearer a')
      .send(confirmBody({ sourceRefs: [{ kind: 'diaryPage', id: 'not-mine', availability: 'available', label: 'x' }] }));
    expect(res.status).toBe(201);
    expect((res.body.littleMemory as LittleMemory).sourceRefs.every((r) => r.id !== 'not-mine')).toBe(true);
  });
  it('a lost-response retry with the same id returns the same record (created:false), one write', async () => {
    const store = seededStore();
    const { app } = appWith(store);
    await request(app).post('/api/little-memory/confirm').set('Authorization', 'Bearer a').send(confirmBody());
    const res2 = await request(app).post('/api/little-memory/confirm').set('Authorization', 'Bearer a').send(confirmBody());
    expect(res2.status).toBe(200);
    expect(res2.body.created).toBe(false);
    expect(store.lms.size).toBe(1);
  });
  it('a revoked chosen seed is rejected at confirm too (409), nothing saved', async () => {
    const store = seededStore();
    store.seeds.set('user-a/seed-r', mkSeed('seed-r', 'user-a', 'revoked'));
    const { app } = appWith(store);
    const res = await request(app).post('/api/little-memory/confirm').set('Authorization', 'Bearer a').send(confirmBody({ seedIds: ['seed-r'] }));
    expect(res.status).toBe(409);
    expect(store.lms.size).toBe(0);
  });
});

describe('mutate: server-routed edit / delete', () => {
  it('edit validates the closed shape and updates only the brief', async () => {
    const store = seededStore();
    store.lms.set('user-a/lm-1', { id: 'lm-1', kind: 'littleMemory', userId: 'user-a', status: 'brief_approved', date: '2026-09-03', ...BRIEF, sourceRefs: [{ kind: 'diaryPage', id: 'dp-1', availability: 'available', label: 'x' }], aiAssisted: true, approvedByUser: true, editedByUser: false, createdAt: 1, confirmedAt: 1 });
    const { app } = appWith(store);
    const bad = await request(app).post('/api/little-memory/mutate').set('Authorization', 'Bearer a').send({ littleMemoryId: 'lm-1', op: 'edit', fields: { ...BRIEF, title: '' } });
    expect(bad.status).toBe(422);
    const ok = await request(app).post('/api/little-memory/mutate').set('Authorization', 'Bearer a').send({ littleMemoryId: 'lm-1', op: 'edit', fields: { ...BRIEF, caption: 'My own line.' } });
    expect(ok.status).toBe(200);
    expect((ok.body.littleMemory as LittleMemory).caption).toBe('My own line.');
    expect((ok.body.littleMemory as LittleMemory).editedByUser).toBe(true);
  });
  it('delete removes the record (and never touches sources)', async () => {
    const store = seededStore();
    store.lms.set('user-a/lm-1', { id: 'lm-1', kind: 'littleMemory', userId: 'user-a', status: 'brief_approved', date: '2026-09-03', ...BRIEF, sourceRefs: [{ kind: 'diaryPage', id: 'dp-1', availability: 'available', label: 'x' }], aiAssisted: true, approvedByUser: true, editedByUser: false, createdAt: 1, confirmedAt: 1 });
    const { app } = appWith(store);
    const res = await request(app).post('/api/little-memory/mutate').set('Authorization', 'Bearer a').send({ littleMemoryId: 'lm-1', op: 'delete' });
    expect(res.status).toBe(200);
    expect(store.lms.size).toBe(0);
    expect(store.pages.has('user-a/dp-1')).toBe(true); // source untouched
    expect(store.seeds.has('user-a/seed-1')).toBe(true);
  });
  it('edit of a missing record -> 404', async () => {
    const { app } = appWith(seededStore());
    const res = await request(app).post('/api/little-memory/mutate').set('Authorization', 'Bearer a').send({ littleMemoryId: 'nope', op: 'edit', fields: BRIEF });
    expect(res.status).toBe(404);
  });
});
