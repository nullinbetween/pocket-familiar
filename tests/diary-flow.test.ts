import { describe, expect, it, vi } from 'vitest';
import { confirmDiaryPage, DiaryFlowDeps, requestDiaryDraft } from '../src/lib/diary-flow';
import { isDiaryPage, JournalInteraction } from '../src/types';

/** PF-01 client-flow evidence: 2, 6, 7, 8, 9, 10, 11. */

const INTERACTION: JournalInteraction = {
  id: 'conv-1',
  userId: 'user-a',
  title: 'a hard day',
  initialPrompt: 'today was heavy',
  reflectionOutput: 'model prose',
  mode: 'deep_reflection',
  mood: 'anxious',
  tags: ['reflection'],
  turns: [
    { id: 'usr_1', role: 'user', content: 'today was heavy at drop-off', timestamp: 1 },
    { id: 'gem_1', role: 'model', content: 'model-authored reflection prose', timestamp: 2 },
    { id: 'usr_2', role: 'user', content: 'but the afternoon felt lighter', timestamp: 3 },
  ],
  createdAt: 1,
  updatedAt: 3,
};

const DRAFT_RESPONSE = {
  title: 'Heavy morning, lighter afternoon',
  todayInMyWords: 'The drop-off was heavy, but the afternoon felt lighter.',
  whatFeltImportant: ['The afternoon shift'],
  sourceTurnIds: ['usr_1', 'usr_2'],
};

function makeDeps(overrides: Partial<DiaryFlowDeps> = {}) {
  const saved = new Map<string, unknown>();
  const deps: DiaryFlowDeps = {
    requestDraft: vi.fn(async () => DRAFT_RESPONSE),
    savePage: vi.fn(async (pageId, page) => {
      saved.set(pageId, page);
    }),
    newPageId: vi.fn(() => 'page-1'),
    now: () => 1000,
    ...overrides,
  };
  return { deps, saved };
}

describe('PF-01 evidence 2: only user-authored turns become diary sources', () => {
  it('model turn ids are dropped even when explicitly selected', async () => {
    const { deps } = makeDeps();
    await requestDiaryDraft(deps, INTERACTION, ['usr_1', 'gem_1', 'usr_2'], '2026-09-02');
    const payload = (deps.requestDraft as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.sources.map((s: { turnId: string }) => s.turnId)).toEqual(['usr_1', 'usr_2']);
    expect(JSON.stringify(payload)).not.toContain('model-authored reflection prose');
  });

  it('selecting ONLY model turns refuses without any provider call', async () => {
    const { deps } = makeDeps();
    const outcome = await requestDiaryDraft(deps, INTERACTION, ['gem_1'], '2026-09-02');
    expect(outcome.phase).toBe('draft_failed');
    expect(deps.requestDraft).not.toHaveBeenCalled();
  });

  it('duplicate selections are deduplicated', async () => {
    const { deps } = makeDeps();
    await requestDiaryDraft(deps, INTERACTION, ['usr_1', 'usr_1'], '2026-09-02');
    const payload = (deps.requestDraft as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.sources).toHaveLength(1);
  });
});

describe('PF-01 evidence 6/7: failure leaves the conversation unchanged; drafts are never canonical', () => {
  it('generation failure -> no page write, no conversation mutation', async () => {
    const before = JSON.stringify(INTERACTION);
    const { deps } = makeDeps({
      requestDraft: vi.fn(async () => {
        throw new Error('provider down');
      }),
    });
    const outcome = await requestDiaryDraft(deps, INTERACTION, ['usr_1'], '2026-09-02');
    expect(outcome.phase).toBe('draft_failed');
    expect(deps.savePage).not.toHaveBeenCalled();
    expect(JSON.stringify(INTERACTION)).toBe(before);
  });

  it('a successful draft alone never writes a page (evidence 7)', async () => {
    const { deps } = makeDeps();
    const outcome = await requestDiaryDraft(deps, INTERACTION, ['usr_1', 'usr_2'], '2026-09-02');
    expect(outcome.phase).toBe('draft_ready');
    expect(deps.savePage).not.toHaveBeenCalled(); // only explicit confirmation persists
  });
});

const EDITED = {
  title: 'Heavy morning, lighter afternoon',
  date: '2026-09-02',
  todayInMyWords: 'MY OWN edited words about the day.',
  whatFeltImportant: ['The afternoon shift'],
  carryForward: undefined,
};

describe('PF-01 evidence 8/9/10: confirmation, retry-without-duplication, edits survive', () => {
  it('confirmation creates exactly one page carrying the user-edited fields', async () => {
    const { deps, saved } = makeDeps();
    const outcome = await confirmDiaryPage(deps, {
      userId: 'user-a',
      interactionId: 'conv-1',
      edited: EDITED,
      sourceTurnIds: DRAFT_RESPONSE.sourceTurnIds,
      aiDraft: { ...DRAFT_RESPONSE, date: '2026-09-02', carryForward: undefined },
    });
    expect(outcome.phase).toBe('confirmed');
    expect(saved.size).toBe(1);
    const page = saved.get('page-1') as Record<string, unknown>;
    expect(page.todayInMyWords).toBe('MY OWN edited words about the day.'); // evidence 10
    expect(page.editedByUser).toBe(true);
    expect(page.status).toBe('confirmed');
    expect(page.sourceInteractionId).toBe('conv-1');
    expect(page.sourceTurnIds).toEqual(['usr_1', 'usr_2']);
  });

  it('save failure preserves the draft and retry reuses the SAME pageId (evidence 8/9)', async () => {
    let fail = true;
    const { deps, saved } = makeDeps({
      savePage: vi.fn(async (pageId, page) => {
        if (fail) throw new Error('firestore down');
        saved.set(pageId, page);
      }),
    });
    const args = {
      userId: 'user-a',
      interactionId: 'conv-1',
      edited: EDITED,
      sourceTurnIds: DRAFT_RESPONSE.sourceTurnIds,
      aiDraft: { ...DRAFT_RESPONSE, date: '2026-09-02', carryForward: undefined },
    };
    const first = await confirmDiaryPage(deps, args);
    expect(first.phase).toBe('save_failed');
    fail = false;
    const second = await confirmDiaryPage(deps, { ...args, pageId: first.pageId });
    expect(second.phase).toBe('confirmed');
    const calls = (deps.savePage as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toBe(calls[1][0]); // same document id -> no duplicate page
    expect(deps.newPageId).toHaveBeenCalledTimes(1);
  });

  it('unedited draft is marked editedByUser: false', async () => {
    const { deps, saved } = makeDeps();
    const aiDraft = { ...DRAFT_RESPONSE, date: '2026-09-02', carryForward: undefined };
    await confirmDiaryPage(deps, {
      userId: 'user-a',
      interactionId: 'conv-1',
      edited: { title: aiDraft.title, date: aiDraft.date, todayInMyWords: aiDraft.todayInMyWords, whatFeltImportant: [...aiDraft.whatFeltImportant], carryForward: undefined },
      sourceTurnIds: aiDraft.sourceTurnIds,
      aiDraft,
    });
    expect((saved.get('page-1') as Record<string, unknown>).editedByUser).toBe(false);
  });
});

describe('PF-01 evidence 11: Conversation and Diary Page cannot be confused', () => {
  it('discriminator separates the two artefact types', async () => {
    const { deps, saved } = makeDeps();
    await confirmDiaryPage(deps, {
      userId: 'user-a',
      interactionId: 'conv-1',
      edited: EDITED,
      sourceTurnIds: ['usr_1'],
      aiDraft: { ...DRAFT_RESPONSE, date: '2026-09-02', carryForward: undefined },
    });
    const page = saved.get('page-1');
    expect(isDiaryPage(page)).toBe(true);
    expect(isDiaryPage(INTERACTION)).toBe(false);
    expect((page as { kind: string }).kind).toBe('diaryPage');
  });
});
