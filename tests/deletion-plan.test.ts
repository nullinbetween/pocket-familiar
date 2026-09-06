import { describe, expect, it } from 'vitest';
import { MemorySeed } from '../src/types';
import { previewSourceDeletion, planSourceDeletion } from '../src/lib/deletion-plan';

/** PF-CORE-01 / PF-02.1 evidence 7: deleting a source previews descendants and
 * never silently retains or cascades; "keep" marks the ref unavailable without
 * resurrecting raw text. */

function seed(id: string, pageIds: string[]): MemorySeed {
  return {
    kind: 'memorySeed', id, userId: 'u', status: 'active', text: `seed ${id}`, sourceExcerpt: 'x', sourceDate: '2026-09-01',
    sourceRefs: pageIds.map((p) => ({ kind: 'diaryPage' as const, id: p, availability: 'available' as const })),
    aiAssisted: true, approvedByUser: true, editedByUser: false, createdAt: 1, confirmedAt: 1,
  };
}

describe('previewSourceDeletion lists affected descendants', () => {
  it('finds seeds grounded in the deleted page and flags single-source ones', () => {
    const seeds = [seed('a', ['p1']), seed('b', ['p1', 'p2']), seed('c', ['p2'])];
    const preview = previewSourceDeletion('p1', seeds);
    expect(preview.affectedSeeds.map((s) => s.seedId).sort()).toEqual(['a', 'b']);
    expect(preview.affectedSeeds.find((s) => s.seedId === 'a')!.onlySource).toBe(true);
    expect(preview.affectedSeeds.find((s) => s.seedId === 'b')!.onlySource).toBe(false);
  });

  it('a page with no descendants yields an empty preview (delete affects only the page)', () => {
    const preview = previewSourceDeletion('p9', [seed('a', ['p1'])]);
    expect(preview.affectedSeeds).toEqual([]);
  });
});

describe('planSourceDeletion honours the explicit choice — no silent retain/cascade', () => {
  const seeds = [seed('a', ['p1']), seed('b', ['p1', 'p2'])];
  const preview = previewSourceDeletion('p1', seeds);

  it('keep_marked_unavailable: keeps every affected seed, marks the ref unavailable', () => {
    const plan = planSourceDeletion(preview, 'keep_marked_unavailable');
    expect(plan.deleteSeedIds).toEqual([]);
    expect(plan.markUnavailableSeedIds.sort()).toEqual(['a', 'b']);
    expect(plan.deletePageId).toBe('p1');
  });

  it('delete_descendants: deletes only single-source seeds; multi-source seed is kept + marked', () => {
    const plan = planSourceDeletion(preview, 'delete_descendants');
    expect(plan.deleteSeedIds).toEqual(['a']); // only-source seed
    expect(plan.markUnavailableSeedIds).toEqual(['b']); // has another surviving source
  });
});

/** PF-CORE-03A P0-2: seed-deletion plan over Little Memories (pure + deterministic). */
import { seedPlanFingerprint, previewSeedDeletion } from '../src/lib/deletion-plan';
import { LittleMemory } from '../src/types';

const lm = (id: string, seedId: string | null): LittleMemory => ({
  kind: 'littleMemory', id, userId: 'u', status: 'brief_approved', date: '2026-09-03',
  title: `LM ${id}`, setting: 's', timeOfDay: 't', emotionalTone: 'e', familiarAction: 'a',
  visualMotifs: ['m'], composition: 'c', caption: 'cap',
  sourceRefs: [
    { kind: 'diaryPage', id: 'dp-1', availability: 'available', label: 'dp' },
    ...(seedId ? [{ kind: 'memorySeed' as const, id: seedId, availability: 'available' as const, label: 'seed' }] : []),
  ],
  aiAssisted: true, approvedByUser: true, editedByUser: false, createdAt: 1, confirmedAt: 1,
});

describe('seed deletion plan', () => {
  it('previews only the Little Memories that reference the seed', () => {
    const affected = previewSeedDeletion('seed-1', [lm('a', 'seed-1'), lm('b', 'seed-2'), lm('c', null)]);
    expect(affected).toEqual([{ littleMemoryId: 'a', title: 'LM a' }]);
  });
  it('fingerprint changes when an affected Little Memory appears or changes', () => {
    const before = seedPlanFingerprint('seed-1', [lm('a', 'seed-1')]);
    const after = seedPlanFingerprint('seed-1', [lm('a', 'seed-1'), lm('b', 'seed-1')]);
    expect(before).not.toBe(after);
    // stable given the same set regardless of order
    expect(seedPlanFingerprint('seed-1', [lm('b', 'seed-1'), lm('a', 'seed-1')])).toBe(after);
  });
  it('an unrelated seed change does not alter the fingerprint', () => {
    const a = seedPlanFingerprint('seed-1', [lm('a', 'seed-1'), lm('b', 'seed-2')]);
    const b = seedPlanFingerprint('seed-1', [lm('a', 'seed-1')]);
    expect(a).toBe(b);
  });
});
