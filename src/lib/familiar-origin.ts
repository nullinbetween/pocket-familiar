import { FamiliarProfile, FamiliarStage, FamiliarOriginId, MemorySeed } from '../types';
import { isKeeperReady } from './keeper-readiness';

/**
 * PF-CORE-01: origin identity + deterministic, app-owned stage transitions.
 *
 * Identity is chosen at birth and is IMMUTABLE for this route. Evolution
 * reveals the same personality in a new form; it never rewrites who the
 * familiar is. Nothing here reads model output: a provider response can never
 * select an origin, a stage, eligibility, rewards or shared-history claims.
 */

/** Immutable Midnight identity (the only origin shipped this slice). */
export const MIDNIGHT_ORIGIN = Object.freeze({
  originId: 'midnight' as FamiliarOriginId,
  name: 'Midnight',
  eyes: 'amber',
  constellation: 'a four-point constellation on the brow',
  palette: Object.freeze(['midnight & navy', 'muted gold', 'moss'] as const),
  motif: 'leaf',
  temperament: 'steady, watchful and gentle',
  essenceLine: 'Amber-eyed, leaf-marked, quiet by nature — the same soul in every form.',
});

/** Per-form presentation copy. The identity line is shared; only the form changes. */
export const FORM_PRESENTATION: Readonly<Record<FamiliarStage, { form: string; motto: string; note: string }>> =
  Object.freeze({
    companion: Object.freeze({
      form: 'Companion',
      motto: 'Here for the days you want to remember.',
      note: 'Your familiar sits with you while pages are still gathering.',
    }),
    keeper: Object.freeze({
      form: 'Keeper',
      motto: 'Holding the pages you chose to keep.',
      note: 'Your familiar has grown into a Keeper of the moments you approved.',
    }),
  });

/** Ordinal ranking of stages — used only to forbid downgrades. */
const STAGE_RANK: Readonly<Record<FamiliarStage, number>> = Object.freeze({ companion: 0, keeper: 1 });

/** The default profile every current/existing user receives. */
export function defaultFamiliarProfile(userId: string, now: number): Omit<FamiliarProfile, 'id'> {
  return {
    kind: 'familiarProfile',
    userId,
    originId: 'midnight',
    stage: 'companion',
    createdAt: now,
  };
}

/**
 * Pure, idempotent, non-downgrading stage transition.
 * - A target at or below the current stage is a no-op (`changed:false`), so a
 *   retried transformation never rewrites `stageActivatedAt` or duplicates work.
 * - Downgrades are impossible: revoking/deleting seeds later never calls this
 *   with a lower stage, and even if it did, the profile is returned unchanged.
 */
export function activateStage(
  profile: FamiliarProfile,
  target: FamiliarStage,
  now: number
): { profile: FamiliarProfile; changed: boolean } {
  if (STAGE_RANK[target] <= STAGE_RANK[profile.stage]) {
    return { profile, changed: false };
  }
  return {
    profile: { ...profile, stage: target, stageActivatedAt: profile.stageActivatedAt ?? now },
    changed: true,
  };
}

export type KeeperActivationOutcome =
  | { phase: 'activated'; profile: FamiliarProfile; changed: boolean }
  | { phase: 'not_ready' }
  | { phase: 'already_keeper'; profile: FamiliarProfile };

/**
 * The ONLY sanctioned path to the Keeper stage. It requires BOTH:
 *   1. closed-rule eligibility over app-owned seeds (isKeeperReady), and
 *   2. an explicit caller (a user action) — this function never runs on its own.
 * Eligibility alone never transforms; this must be invoked deliberately.
 * Idempotent: a second call once already Keeper reports `already_keeper` and
 * leaves the earlier `stageActivatedAt` intact.
 */
export function requestKeeperActivation(args: {
  profile: FamiliarProfile;
  seeds: MemorySeed[];
  now: number;
}): KeeperActivationOutcome {
  const { profile, seeds, now } = args;
  if (profile.stage === 'keeper') {
    return { phase: 'already_keeper', profile };
  }
  if (!isKeeperReady(seeds)) {
    return { phase: 'not_ready' };
  }
  const { profile: next, changed } = activateStage(profile, 'keeper', now);
  return { phase: 'activated', profile: next, changed };
}
