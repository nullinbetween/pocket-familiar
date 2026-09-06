import { MemorySeed } from '../types';

/**
 * PF-CORE-01: the ONE app-owned Keeper-readiness rule.
 *
 * Authority boundary: readiness is derived here, from app-owned canonical
 * records only. No model output, no client claim and no counter stored on the
 * familiar can move this. The rule is closed and testable at its boundaries.
 *
 * Rule for this slice:
 *   at least 3 active, user-approved Memory Seeds
 *   from at least 3 distinct confirmed Diary Pages
 *   across at least 2 local calendar dates
 *
 * The numeric threshold is INTERNAL. The UI may show qualitative progress
 * (`readinessPhase` / `READINESS_COPY`) but must never surface these numbers
 * or any distance-to-unlock.
 */

export interface ReadinessThreshold {
  minActiveSeeds: number;
  minDistinctSourcePages: number;
  minDistinctSourceDates: number;
}

/** Hidden threshold — never render these values in prompt or UI. */
export const KEEPER_READINESS: Readonly<ReadinessThreshold> = Object.freeze({
  minActiveSeeds: 3,
  minDistinctSourcePages: 3,
  minDistinctSourceDates: 2,
});

export interface ReadinessFacts {
  activeSeedCount: number;
  distinctSourcePageCount: number;
  distinctSourceDateCount: number;
}

/**
 * Derive readiness facts from a seed collection. Only 'active' seeds count —
 * a revoked seed contributes nothing, immediately. Distinct source pages are
 * counted from each active seed's typed diaryPage sourceRefs (provenance ids,
 * independent of later source availability); distinct dates from sourceDate.
 */
export function readinessFactsOf(seeds: MemorySeed[]): ReadinessFacts {
  const active = seeds.filter((s) => s.status === 'active');
  const pages = new Set<string>();
  const dates = new Set<string>();
  for (const s of active) {
    for (const ref of s.sourceRefs ?? []) {
      if (ref.kind === 'diaryPage' && typeof ref.id === 'string' && ref.id) pages.add(ref.id);
    }
    if (typeof s.sourceDate === 'string' && s.sourceDate) dates.add(s.sourceDate);
  }
  return {
    activeSeedCount: active.length,
    distinctSourcePageCount: pages.size,
    distinctSourceDateCount: dates.size,
  };
}

/** Closed eligibility check. Never auto-acts; callers still require explicit user activation. */
export function isKeeperReady(seeds: MemorySeed[], threshold: ReadinessThreshold = KEEPER_READINESS): boolean {
  const f = readinessFactsOf(seeds);
  return (
    f.activeSeedCount >= threshold.minActiveSeeds &&
    f.distinctSourcePageCount >= threshold.minDistinctSourcePages &&
    f.distinctSourceDateCount >= threshold.minDistinctSourceDates
  );
}

export type ReadinessPhase = 'gathering' | 'taking_root' | 'ready';

/**
 * Qualitative progress only. Returns a phase, never a number or a
 * seeds-to-go value; the UI copy below carries no threshold either.
 */
export function readinessPhase(seeds: MemorySeed[], threshold: ReadinessThreshold = KEEPER_READINESS): ReadinessPhase {
  if (isKeeperReady(seeds, threshold)) return 'ready';
  const f = readinessFactsOf(seeds);
  if (f.activeSeedCount === 0) return 'gathering';
  return 'taking_root';
}

/** App-authored, qualitative. No counts, no "N more", no bar values. */
export const READINESS_COPY: Readonly<Record<ReadinessPhase, string>> = Object.freeze({
  gathering: 'Your familiar is waiting for its first kept pages.',
  taking_root: 'Your familiar is learning to hold your pages.',
  ready: 'Your familiar is ready to hold your pages as a Keeper.',
});
