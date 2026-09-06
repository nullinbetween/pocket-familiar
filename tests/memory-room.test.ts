import { describe, expect, it } from 'vitest';
import { JournalInteraction, DiaryPage, MemorySeed } from '../src/types';
import {
  projectAll, searchMemory, groupByKind, localDayKey, localWeekKey, dayLabel, MemoryRecord,
} from '../src/lib/memory-room';

/** PF-CORE-02 Living Memory — projection identity, deterministic search/order,
 * timezone grouping and source availability. */

const conv = (id: string, over: Partial<JournalInteraction> = {}): JournalInteraction => ({
  id, userId: 'u', title: 'Same Title', initialPrompt: 'i said this', reflectionOutput: 'familiar reflected that',
  mode: 'deep_reflection', mood: 'serene', tags: [], turns: [
    { id: 't1', role: 'user', content: 'the walk home', timestamp: 1 },
    { id: 't2', role: 'model', content: 'a phone-free ritual', timestamp: 2 },
  ], createdAt: 1000, updatedAt: 1000, ...over,
});
const page = (id: string, over: Partial<DiaryPage> = {}): DiaryPage => ({
  kind: 'diaryPage', id, userId: 'u', title: 'Same Title', date: '2026-09-03', todayInMyWords: 'my own words',
  whatFeltImportant: ['a thing'], sourceInteractionId: 'c1', sourceTurnIds: ['t1'], aiAssisted: true,
  status: 'confirmed', createdAt: 900, confirmedAt: 2000, editedByUser: false, ...over,
});
const seed = (id: string, over: Partial<MemorySeed> = {}): MemorySeed => ({
  kind: 'memorySeed', id, userId: 'u', status: 'active', text: 'Same Title', sourceExcerpt: 'excerpt',
  sourceDate: '2026-09-03', sourceRefs: [{ kind: 'diaryPage', id: 'p1', availability: 'available' }],
  aiAssisted: true, approvedByUser: true, editedByUser: false, createdAt: 800, confirmedAt: 3000, ...over,
});

describe('projection identity — the three kinds can never be confused', () => {
  it('same raw doc id + identical text still yields distinct, collision-proof records', () => {
    const recs = projectAll([conv('X')], [page('X', { sourceInteractionId: 'X' })], [seed('X', { sourceRefs: [{ kind: 'diaryPage', id: 'X', availability: 'available' }] })]);
    const byKind = Object.fromEntries(recs.map((r) => [r.kind, r]));
    expect(byKind.conversation.id).toBe('conversation:X');
    expect(byKind.diaryPage.id).toBe('diaryPage:X');
    expect(byKind.memorySeed.id).toBe('memorySeed:X');
    expect(new Set(recs.map((r) => r.id)).size).toBe(3);
  });

  it('authorship lines never attribute model text to the user', () => {
    const [c] = projectAll([conv('c1')], [], []);
    expect(c.authorshipOrApproval).toContain('Conversation');
    // the model turn is preserved as a model turn in raw, not folded into user text
    expect(c.raw.conversation!.turns.find((t) => t.content === 'a phone-free ritual')!.role).toBe('model');
    const [, d] = projectAll([conv('c1')], [page('p1')], []);
    expect(d.authorshipOrApproval).toContain('approved by you');
  });
});

describe('source availability', () => {
  it('a diary page whose source conversation is gone is unavailable; present is available', () => {
    const gone = projectAll([], [page('p1', { sourceInteractionId: 'missing' })], [])[0];
    expect(gone.sourceAvailability).toBe('unavailable');
    const ok = projectAll([conv('c1')], [page('p1', { sourceInteractionId: 'c1' })], [])[1];
    expect(ok.sourceAvailability).toBe('available');
  });
  it('a seed whose source diary page is gone is unavailable', () => {
    const rec = projectAll([], [], [seed('s1', { sourceRefs: [{ kind: 'diaryPage', id: 'missing', availability: 'available' }] })])[0];
    expect(rec.sourceAvailability).toBe('unavailable');
    expect(rec.sourceRefs[0].availability).toBe('unavailable');
  });
});

describe('deterministic search / filter / order', () => {
  const records = projectAll(
    [conv('c1', { title: 'Morning calm', createdAt: 1000 }), conv('c2', { title: 'Shop ideas', createdAt: 3000 })],
    [page('p1', { title: 'A pocket of calm', confirmedAt: 2000 })],
    [seed('s1', { text: 'walk home is mine', confirmedAt: 5000 }), seed('s2', { text: 'old thought', status: 'revoked', confirmedAt: 4000 })]
  );

  it('normalizes case + whitespace and matches as plain substring (no score field)', () => {
    const r = searchMemory(records, { text: '  POCKET   Of Calm ', scope: 'all', seedStatus: 'all' });
    expect(r.map((x) => x.id)).toContain('diaryPage:p1');
    r.forEach((x) => expect(x).not.toHaveProperty('score'));
  });

  it('scope filters to a single kind', () => {
    const r = searchMemory(records, { text: '', scope: 'memorySeed', seedStatus: 'all' });
    expect(r.every((x) => x.kind === 'memorySeed')).toBe(true);
    expect(r).toHaveLength(2);
  });

  it('seed status filter only affects seeds', () => {
    const active = searchMemory(records, { text: '', scope: 'memorySeed', seedStatus: 'active' });
    expect(active.map((x) => x.id)).toEqual(['memorySeed:s1']);
    const revoked = searchMemory(records, { text: '', scope: 'memorySeed', seedStatus: 'revoked' });
    expect(revoked.map((x) => x.id)).toEqual(['memorySeed:s2']);
    // when scope is all, seedStatus=active drops revoked seeds but keeps other kinds
    const mixed = searchMemory(records, { text: '', scope: 'all', seedStatus: 'active' });
    expect(mixed.some((x) => x.id === 'memorySeed:s2')).toBe(false);
    expect(mixed.some((x) => x.kind === 'conversation')).toBe(true);
  });

  it('orders by kind then newest-first, grouped', () => {
    const g = groupByKind(searchMemory(records, { text: '', scope: 'all', seedStatus: 'all' }));
    expect(g.map((x) => x.kind)).toEqual(['diaryPage', 'conversation', 'memorySeed']);
    expect(g[1].records.map((r) => r.id)).toEqual(['conversation:c2', 'conversation:c1']); // newest first
  });

  it('equal timestamps use a stable id tie-breaker', () => {
    const recs = projectAll([conv('a', { createdAt: 10 }), conv('b', { createdAt: 10 })], [], []);
    const r = searchMemory(recs, { text: '', scope: 'conversation', seedStatus: 'all' });
    expect(r.map((x) => x.id)).toEqual(['conversation:b', 'conversation:a']);
  });

  it('no-result search returns empty deterministically', () => {
    expect(searchMemory(records, { text: 'zzzz-nothing', scope: 'all', seedStatus: 'all' })).toEqual([]);
  });
});

describe('timezone-aware local grouping (UTC/JST boundary)', () => {
  const t = Date.UTC(2026, 8, 5, 16, 30); // 2026-09-05T16:30Z → JST 2026-09-06 01:30
  it('localDayKey differs across UTC and JST at the boundary', () => {
    expect(localDayKey(t, 'UTC')).toBe('2026-09-05');
    expect(localDayKey(t, 'Asia/Tokyo')).toBe('2026-09-06');
  });
  it('localWeekKey is tz-aware across a week boundary', () => {
    // 2026-09-06T20:00Z: UTC Sunday 2026-09-06 (ISO week N) vs JST Monday 2026-09-07 (ISO week N+1)
    const t2 = Date.UTC(2026, 8, 6, 20, 0);
    expect(localDayKey(t2, 'UTC')).toBe('2026-09-06');
    expect(localDayKey(t2, 'Asia/Tokyo')).toBe('2026-09-07');
    expect(localWeekKey(t2, 'UTC')).not.toBe(localWeekKey(t2, 'Asia/Tokyo'));
  });
  it('dayLabel is relative to a provided now', () => {
    const now = Date.UTC(2026, 8, 6, 3, 0);
    expect(dayLabel(now, 'UTC', now)).toBe('Today');
    expect(dayLabel(now - 86400000, 'UTC', now)).toBe('Yesterday');
  });
});
