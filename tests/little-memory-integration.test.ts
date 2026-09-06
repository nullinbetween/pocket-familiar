import { describe, expect, it } from 'vitest';
import { JournalInteraction, DiaryPage, MemorySeed, LittleMemory } from '../src/types';
import { projectAll, searchMemory, groupByKind } from '../src/lib/memory-room';
import { buildMemoryRoomJson, serializeMemoryRoomJson, buildMemoryRoomMarkdown, MemoryRoomInput } from '../src/lib/memory-export';

/** PF-CORE-03A — Little Memory as the 4th discriminated record type in Living
 * Memory search + export, honest about illustration state. */

const conv = (id: string): JournalInteraction => ({
  id, userId: 'u', title: 'c', initialPrompt: 'i', reflectionOutput: 'r', mode: 'deep_reflection', mood: 'serene',
  tags: [], turns: [], createdAt: 1000, updatedAt: 1000,
});
const page = (id: string, over: Partial<DiaryPage> = {}): DiaryPage => ({
  kind: 'diaryPage', id, userId: 'u', title: 'A pocket of calm', date: '2026-09-03', todayInMyWords: 'words',
  whatFeltImportant: ['x'], sourceInteractionId: 'c1', sourceTurnIds: ['t1'], aiAssisted: true, status: 'confirmed',
  createdAt: 900, confirmedAt: 2000, editedByUser: false, ...over,
});
const seed = (id: string, over: Partial<MemorySeed> = {}): MemorySeed => ({
  kind: 'memorySeed', id, userId: 'u', status: 'active', text: 'the walk home is mine', sourceExcerpt: 'x',
  sourceDate: '2026-09-03', sourceRefs: [{ kind: 'diaryPage', id: 'p1', availability: 'available' }],
  aiAssisted: true, approvedByUser: true, editedByUser: false, createdAt: 800, confirmedAt: 3000, ...over,
});
const lm = (id: string, over: Partial<LittleMemory> = {}): LittleMemory => ({
  kind: 'littleMemory', id, userId: 'u', status: 'brief_approved', date: '2026-09-03',
  title: 'A pocket of calm', setting: 'a tree-lined street', timeOfDay: 'morning', emotionalTone: 'quiet relief',
  familiarAction: 'Midnight pads beside her', visualMotifs: ['morning light'], composition: 'wide low angle',
  caption: 'The walk home is mine again.',
  sourceRefs: [
    { kind: 'diaryPage', id: 'p1', availability: 'available', label: 'A pocket of calm · 2026-09-03' },
    { kind: 'memorySeed', id: 's1', availability: 'available', label: 'the walk home is mine' },
  ],
  aiAssisted: true, approvedByUser: true, editedByUser: false, createdAt: 900, confirmedAt: 4000, ...over,
});

describe('projection: littleMemory is a distinct 4th kind', () => {
  it('same doc id across all four kinds yields four collision-proof records', () => {
    const recs = projectAll([conv('X')], [page('X')], [seed('X', { sourceRefs: [] })], [lm('X', { sourceRefs: [] })]);
    const ids = recs.map((r) => r.id);
    expect(ids).toContain('littleMemory:X');
    expect(new Set(ids).size).toBe(4);
    const rec = recs.find((r) => r.kind === 'littleMemory')!;
    expect(rec.authorshipOrApproval).toMatch(/illustration not generated yet/);
    expect(rec.raw.littleMemory).toBeDefined();
  });
  it('source availability tracks both the diary page and the chosen seed', () => {
    const okRec = projectAll([], [page('p1')], [seed('s1')], [lm('lm1')]).find((r) => r.kind === 'littleMemory')!;
    expect(okRec.sourceAvailability).toBe('available');
    // page gone AND seed gone -> unavailable, but still readable (record present)
    const goneRec = projectAll([], [], [], [lm('lm1')]).find((r) => r.kind === 'littleMemory')!;
    expect(goneRec.sourceAvailability).toBe('unavailable');
    expect(goneRec.title).toBe('A pocket of calm');
  });
});

describe('search + grouping', () => {
  const recs = projectAll([conv('c1')], [page('p1')], [seed('s1')], [lm('lm1')]);
  it('scope filters to littleMemory and matches only user-visible fields', () => {
    const r = searchMemory(recs, { text: 'walk home', scope: 'littleMemory', seedStatus: 'all' });
    expect(r.map((x) => x.id)).toEqual(['littleMemory:lm1']);
    expect(searchMemory(recs, { text: 'wide low angle', scope: 'littleMemory', seedStatus: 'all' })).toEqual([]);
  });
  it('groups four kinds with littleMemory ordered last', () => {
    const g = groupByKind(searchMemory(recs, { text: '', scope: 'all', seedStatus: 'all' }));
    expect(g.map((x) => x.kind)).toEqual(['diaryPage', 'conversation', 'memorySeed', 'littleMemory']);
  });
});

describe('export includes little memories honestly and deterministically', () => {
  const input: MemoryRoomInput = {
    exportedAt: Date.UTC(2026, 8, 5),
    conversations: [conv('c1')],
    diaryPages: [page('p1')],
    memorySeeds: [seed('s1')],
    littleMemories: [lm('lm1'), lm('lm0', { confirmedAt: 100, title: 'Earlier brief' })],
  };
  it('JSON carries user-visible memory data, provenance and status without internal image direction', () => {
    const j = buildMemoryRoomJson(input);
    expect(j.littleMemories).toHaveLength(2);
    expect(j.littleMemories[0].illustrationGenerated).toBe(false);
    expect(j.littleMemories[0].illustrationStatus).toBe('not_generated');
    expect(j.littleMemories[0].illustrationAttemptStatus).toBe('none');
    expect(j.littleMemories[0]).not.toHaveProperty('imageUrl');
    expect(j.littleMemories[0]).not.toHaveProperty('setting');
    expect(j.littleMemories[0]).not.toHaveProperty('composition');
    expect(j.littleMemories[0].sourceRefs.map((r) => r.id).sort()).toEqual(['p1', 's1']);
    expect(j.scope.toLowerCase()).toContain('bounded illustration status');
    expect(j.knownLimitations.join(' ')).toMatch(/do not currently have a generated illustration/i);
  });
  it('exports ready, stale-with-failed-replacement, and pending states truthfully without private media data', () => {
    const withStates: MemoryRoomInput = {
      ...input,
      littleMemories: [
        lm('ready', { image: { status: 'ready', generationId: 'g-ready', model: 'm', objectPath: 'users/u/private/ready.png', mimeType: 'image/png', generatedAt: 5 } }),
        lm('stale', {
          image: { status: 'stale', generationId: 'g-old', model: 'm', objectPath: 'users/u/private/stale.png', mimeType: 'image/png', generatedAt: 4, briefFingerprint: 'old' },
          pendingGeneration: { status: 'failed', generationId: 'g-failed', model: 'm', briefFingerprint: 'new', attemptStartedAt: 6, failureCode: 'provider_unavailable' },
        }),
        lm('pending', { image: undefined, pendingGeneration: { status: 'generating', generationId: 'g-pending', model: 'm', briefFingerprint: 'fp', attemptStartedAt: 7 } }),
        lm('plain'),
      ],
    };
    const j = buildMemoryRoomJson(withStates);
    const byId = Object.fromEntries(j.littleMemories.map((item) => [item.id, item]));
    expect(byId.ready).toMatchObject({ illustrationGenerated: true, illustrationStatus: 'ready', illustrationAttemptStatus: 'none' });
    expect(byId.stale).toMatchObject({ illustrationGenerated: true, illustrationStatus: 'stale', illustrationAttemptStatus: 'failed' });
    expect(byId.pending).toMatchObject({ illustrationGenerated: false, illustrationStatus: 'generating', illustrationAttemptStatus: 'generating' });
    expect(byId.plain).toMatchObject({ illustrationGenerated: false, illustrationStatus: 'not_generated', illustrationAttemptStatus: 'none' });
    const json = JSON.stringify(j);
    expect(json).not.toContain('objectPath');
    expect(json).not.toContain('users/u/private');
    const md = buildMemoryRoomMarkdown(withStates);
    expect(md).toContain('illustration ready');
    expect(md).toContain('illustration stale · latest attempt failed; current illustration preserved');
    expect(md).toContain('illustration generating');
    expect(md).not.toContain('users/u/private');
    const shuffled: MemoryRoomInput = { ...withStates, littleMemories: [...withStates.littleMemories!].reverse() };
    expect(serializeMemoryRoomJson(shuffled)).toBe(serializeMemoryRoomJson(withStates));
    expect(buildMemoryRoomMarkdown(shuffled)).toBe(buildMemoryRoomMarkdown(withStates));
  });
  it('serializes byte-identically under shuffled little-memory input', () => {
    const shuffled: MemoryRoomInput = { ...input, littleMemories: [...input.littleMemories!].reverse() };
    expect(serializeMemoryRoomJson(shuffled)).toBe(serializeMemoryRoomJson(input));
    // canonical newest-first: lm1 (4000) before lm0 (100)
    expect(buildMemoryRoomJson(shuffled).littleMemories.map((l) => l.id)).toEqual(['lm1', 'lm0']);
  });
  it('Markdown has a Little Memories section with bounded not-generated status', () => {
    const md = buildMemoryRoomMarkdown(input);
    expect(md).toContain('## Little Memories (2)');
    expect(md.toLowerCase()).toContain('illustration');
    expect(md).toContain('illustration not_generated');
  });
  it('export still works when littleMemories is omitted (back-compat)', () => {
    const { littleMemories, ...rest } = input;
    void littleMemories;
    expect(buildMemoryRoomJson(rest as MemoryRoomInput).littleMemories).toEqual([]);
  });
});
