import { describe, expect, it } from 'vitest';
import { JournalInteraction, DiaryPage, MemorySeed } from '../src/types';
import { buildMemoryRoomJson, serializeMemoryRoomJson, buildMemoryRoomMarkdown, MemoryRoomInput } from '../src/lib/memory-export';

/** PF-CORE-02 Living Memory — truthful, deterministic Memory Room export. */

const input: MemoryRoomInput = {
  exportedAt: Date.UTC(2026, 8, 5, 0, 0, 0),
  conversations: [{
    id: 'c1', userId: 'u', title: 'A quiet morning', initialPrompt: 'I felt calm', reflectionOutput: 'You noticed the calm',
    mode: 'deep_reflection', mood: 'serene', tags: [], turns: [
      { id: 't1', role: 'user', content: 'the walk home is mine', timestamp: 1 },
      { id: 't2', role: 'model', content: 'make it a ritual', timestamp: 2 },
    ], createdAt: 1000, updatedAt: 1000,
  } as JournalInteraction],
  diaryPages: [{
    kind: 'diaryPage', id: 'p1', userId: 'u', title: 'A pocket of calm', date: '2026-09-03', todayInMyWords: 'my own words about today',
    whatFeltImportant: ['the walk home'], carryForward: 'stay phone-free', sourceInteractionId: 'c1', sourceTurnIds: ['t1'],
    aiAssisted: true, status: 'confirmed', createdAt: 900, confirmedAt: 2000, editedByUser: true,
  } as DiaryPage],
  memorySeeds: [
    { kind: 'memorySeed', id: 's1', userId: 'u', status: 'active', text: 'walk home is mine', sourceExcerpt: 'excerpt', sourceDate: '2026-09-03', sourceRefs: [{ kind: 'diaryPage', id: 'p1', availability: 'available' }], aiAssisted: true, approvedByUser: true, editedByUser: false, createdAt: 800, confirmedAt: 3000 } as MemorySeed,
    { kind: 'memorySeed', id: 's2', userId: 'u', status: 'revoked', text: 'a released thought', sourceExcerpt: 'x', sourceDate: '2026-08-20', sourceRefs: [{ kind: 'diaryPage', id: 'p1', availability: 'available' }], aiAssisted: true, approvedByUser: true, editedByUser: false, createdAt: 700, confirmedAt: 2500, revokedAt: 2600 } as MemorySeed,
  ],
};

describe('JSON export', () => {
  const j = buildMemoryRoomJson(input);
  it('contains all three types with kind/status/provenance', () => {
    expect(j.conversations).toHaveLength(1);
    expect(j.diaryPages[0].source).toEqual({ kind: 'conversation', id: 'c1' });
    expect(j.memorySeeds.map((s) => s.status).sort()).toEqual(['active', 'revoked']);
    expect(j.memorySeeds[0].sourceRefs[0]).toMatchObject({ kind: 'diaryPage', id: 'p1' });
  });
  it('never converts model turns into user-authored diary text', () => {
    const c = j.conversations[0];
    expect(c.turns.find((t) => t.text === 'make it a ritual')!.author).toBe('familiar');
    expect(c.familiarReflection).toBe('You noticed the calm');
    // the diary page body is the user's approved words, not the model reflection
    expect(j.diaryPages[0].todayInMyWords).toBe('my own words about today');
  });
  it('includes revoked seeds and states the scope explicitly', () => {
    expect(j.scope.toLowerCase()).toContain('revoked');
    expect(j.knownLimitations.join(' ')).toMatch(/account deletion/i);
  });
  it('serializes byte-identically regardless of input array order (real determinism)', () => {
    // A second seed/page/conversation so ordering actually has something to sort.
    const multi: MemoryRoomInput = {
      exportedAt: input.exportedAt,
      conversations: [
        input.conversations[0],
        { ...input.conversations[0], id: 'c0', title: 'An earlier talk', createdAt: 500 } as JournalInteraction,
      ],
      diaryPages: [
        input.diaryPages[0],
        { ...input.diaryPages[0], id: 'p0', title: 'An earlier page', confirmedAt: 100, createdAt: 90 } as DiaryPage,
      ],
      memorySeeds: input.memorySeeds,
    };
    const shuffled: MemoryRoomInput = {
      exportedAt: multi.exportedAt,
      conversations: [...multi.conversations].reverse(),
      diaryPages: [...multi.diaryPages].reverse(),
      memorySeeds: [...multi.memorySeeds].reverse(),
    };
    // Byte-identical JSON despite reversed input order.
    expect(serializeMemoryRoomJson(shuffled)).toBe(serializeMemoryRoomJson(multi));
    // Canonical order is newest-first by (date desc, id asc): c1(1000) before c0(500).
    const j = buildMemoryRoomJson(shuffled);
    expect(j.conversations.map((c) => c.id)).toEqual(['c1', 'c0']);
    expect(j.diaryPages.map((p) => p.id)).toEqual(['p1', 'p0']);
    expect(j.memorySeeds.map((s) => s.id)).toEqual(['s1', 's2']); // s1 confirmedAt 3000 > s2 2500
    // Markdown is order-stable too.
    expect(buildMemoryRoomMarkdown(shuffled)).toBe(buildMemoryRoomMarkdown(multi));
    // Conversation turn order (a transcript) is preserved, not sorted.
    expect(j.conversations[0].turns.map((t) => t.text)).toEqual(['the walk home is mine', 'make it a ritual']);
  });
  it('does not leak runtime/secret configuration', () => {
    const s = serializeMemoryRoomJson(input).toLowerCase();
    expect(s).not.toContain('apikey');
    expect(s).not.toContain('firebase');
    expect(s).not.toContain('token');
  });
});

describe('Markdown export', () => {
  const md = buildMemoryRoomMarkdown(input);
  it('has separated, authored sections', () => {
    expect(md).toContain('## From my story — Diary Pages (1)');
    expect(md).toContain('## Conversations (1)');
    expect(md).toContain('## Held by Midnight — Memory Seeds (2)');
    expect(md).toContain('**You**: I felt calm');
    expect(md).toContain('**Your familiar**: You noticed the calm');
  });
  it('marks revoked seeds and includes the scope note', () => {
    expect(md).toContain('[revoked]');
    expect(md).toContain('[active]');
    expect(md.toLowerCase()).toContain('scope:');
  });
});
