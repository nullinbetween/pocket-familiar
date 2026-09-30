import { MemorySeed, LittleMemory } from '../types';

/**
 * PF-CORE-01 / PF-02.1 deletion policy: deleting a source must PREVIEW its
 * affected descendants and let the user choose — never silently retain, never
 * silently cascade.
 *
 * A Diary Page is a source; a Memory Seed grounded in it is a descendant.
 * Revoking a seed is a separate action (see memory-seed-flow.revokeSeed): it
 * removes the seed from context but leaves its source untouched. This module is
 * only about deleting the SOURCE page and what that implies for its seeds.
 *
 * No hidden raw-source snapshot exists, so "keep" simply flips the typed ref to
 * `unavailable`; the seed still shows only its already-visible approved text and
 * excerpt. Nothing is resurrected and nothing is lost.
 */

export interface AffectedSeed {
  seedId: string;
  text: string;
  /** True when this page is the seed's ONLY source (deleting it orphans the seed). */
  onlySource: boolean;
}

export interface SourceDeletionPreview {
  sourcePageId: string;
  affectedSeeds: AffectedSeed[];
}

/** Affected descendants of deleting one Diary Page — active or revoked alike. */
export function previewSourceDeletion(pageId: string, seeds: MemorySeed[]): SourceDeletionPreview {
  const affected: AffectedSeed[] = [];
  for (const s of seeds) {
    const refsToPage = (s.sourceRefs ?? []).filter((r) => r.kind === 'diaryPage' && r.id === pageId);
    if (refsToPage.length === 0) continue;
    const onlySource = (s.sourceRefs ?? []).every((r) => r.kind === 'diaryPage' && r.id === pageId);
    affected.push({ seedId: s.id ?? '', text: s.text, onlySource });
  }
  return { sourcePageId: pageId, affectedSeeds: affected };
}

/**
 * PF-CORE-01 closure P0-2: a deterministic fingerprint of the CURRENT affected
 * descendant set for a source page. The confirmation carries the fingerprint the
 * user actually saw; the server recomputes it inside the transaction and commits
 * only on an exact match, so a memory that appeared or changed between preview
 * and confirm can never be silently deleted or retained. Pure and shared by the
 * server store and its fake so both agree byte-for-byte.
 */
export function sourcePlanFingerprint(
  pageId: string,
  seeds: MemorySeed[],
  littleMemories: LittleMemory[] = []
): string {
  const affected = seeds
    .filter((s) => (s.sourceRefs ?? []).some((r) => r.kind === 'diaryPage' && r.id === pageId))
    .map((s) => {
      const refs = (s.sourceRefs ?? [])
        .map((r) => `${r.kind}:${r.id}/${r.availability}`)
        .sort()
        .join(',');
      return `${s.id ?? ''}#${s.status}#${refs}`;
    })
    .sort();
  // PF-CORE-03A: Little Memories grounded in this page are descendants too, so
  // they enter the fingerprint. An LM appearing/changing between preview and
  // confirm therefore forces a conflict + re-review, exactly like a seed.
  const lmAffected = littleMemories
    .filter((lm) => (lm.sourceRefs ?? []).some((r) => r.kind === 'diaryPage' && r.id === pageId))
    .map((lm) => {
      const refs = (lm.sourceRefs ?? [])
        .map((r) => `${r.kind}:${r.id}/${r.availability}`)
        .sort()
        .join(',');
      return `${lm.id ?? ''}#${lm.status}#${refs}`;
    })
    .sort();
  return `v2:${affected.length}:${affected.join('|')}::lm:${lmAffected.length}:${lmAffected.join('|')}`;
}

/**
 * PF-CORE-03A P0-2: deleting a Memory Seed is a source deletion for any Little
 * Memory that references it. A fingerprint of the CURRENT affected Little Memory
 * set lets the server confirm stale-safely (delete + flip only that seed ref to
 * unavailable, atomically) and reject a stale plan. Revoke is NOT delete and does
 * not enter here — a revoked seed still exists and stays a readable source.
 */
export function seedPlanFingerprint(seedId: string, littleMemories: LittleMemory[] = []): string {
  const affected = littleMemories
    .filter((lm) => (lm.sourceRefs ?? []).some((r) => r.kind === 'memorySeed' && r.id === seedId))
    .map((lm) => {
      const refs = (lm.sourceRefs ?? [])
        .map((r) => `${r.kind}:${r.id}/${r.availability}`)
        .sort()
        .join(',');
      return `${lm.id ?? ''}#${lm.status}#${refs}`;
    })
    .sort();
  return `seedv1:${affected.length}:${affected.join('|')}`;
}

/** Little Memories whose provenance includes this Memory Seed (kept, never deleted). */
export function previewSeedDeletion(
  seedId: string,
  littleMemories: LittleMemory[]
): Array<{ littleMemoryId: string; title: string }> {
  return littleMemories
    .filter((lm) => (lm.sourceRefs ?? []).some((r) => r.kind === 'memorySeed' && r.id === seedId))
    .map((lm) => ({ littleMemoryId: lm.id ?? '', title: lm.title }));
}

/** Little Memories whose provenance includes this Diary Page (active descendants). */
export function previewLittleMemoryDeletion(
  pageId: string,
  littleMemories: LittleMemory[]
): Array<{ littleMemoryId: string; title: string; onlySource: boolean }> {
  const affected: Array<{ littleMemoryId: string; title: string; onlySource: boolean }> = [];
  for (const lm of littleMemories) {
    const refs = lm.sourceRefs ?? [];
    if (!refs.some((r) => r.kind === 'diaryPage' && r.id === pageId)) continue;
    // "onlySource" = this page is the LM's ONLY diaryPage source (it always has one),
    // i.e. no other diaryPage ref survives. Seed refs are secondary provenance.
    const otherDiaryRefs = refs.filter((r) => r.kind === 'diaryPage' && r.id !== pageId);
    affected.push({ littleMemoryId: lm.id ?? '', title: lm.title, onlySource: otherDiaryRefs.length === 0 });
  }
  return affected;
}

export type DeletionChoice = 'delete_descendants' | 'keep_marked_unavailable';

export interface DeletionPlan {
  deletePageId: string;
  /** Seeds to delete outright (only when the user chose to, AND this was their only source). */
  deleteSeedIds: string[];
  /** Seeds to keep with this source ref flipped to `unavailable`. */
  markUnavailableSeedIds: string[];
}

/**
 * Turn a preview + an explicit user choice into a concrete, auditable plan.
 * - `keep_marked_unavailable`: every affected seed is kept; its ref to this
 *   page becomes `unavailable`.
 * - `delete_descendants`: only seeds whose SOLE source is this page are deleted.
 *   A seed with other surviving sources is never auto-deleted — per policy it is
 *   kept and its ref to this page is marked unavailable instead.
 */
export function planSourceDeletion(preview: SourceDeletionPreview, choice: DeletionChoice): DeletionPlan {
  const deleteSeedIds: string[] = [];
  const markUnavailableSeedIds: string[] = [];
  for (const a of preview.affectedSeeds) {
    if (choice === 'delete_descendants' && a.onlySource) {
      deleteSeedIds.push(a.seedId);
    } else {
      markUnavailableSeedIds.push(a.seedId);
    }
  }
  return { deletePageId: preview.sourcePageId, deleteSeedIds, markUnavailableSeedIds };
}
