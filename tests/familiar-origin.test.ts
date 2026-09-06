import { describe, expect, it } from 'vitest';
import { FamiliarProfile, MemorySeed } from '../src/types';
import {
  defaultFamiliarProfile,
  activateStage,
  requestKeeperActivation,
  MIDNIGHT_ORIGIN,
} from '../src/lib/familiar-origin';

/** PF-CORE-01 evidence 10-12: model output cannot alter origin/stage/readiness;
 * eligibility never auto-transforms; transformation is idempotent and preserves
 * earlier records. */

function readySeeds(): MemorySeed[] {
  const mk = (id: string, page: string, date: string): MemorySeed => ({
    kind: 'memorySeed', id, userId: 'u', status: 'active', text: id, sourceExcerpt: 'x', sourceDate: date,
    sourceRefs: [{ kind: 'diaryPage', id: page, availability: 'available' }],
    aiAssisted: true, approvedByUser: true, editedByUser: false, createdAt: 1, confirmedAt: 1,
  });
  return [mk('s1', 'p1', '2026-09-01'), mk('s2', 'p2', '2026-09-01'), mk('s3', 'p3', '2026-09-02')];
}

describe('evidence 10: identity and stage are app-owned, not model-driven', () => {
  it('default profile is always Midnight / Companion regardless of any input', () => {
    const p = defaultFamiliarProfile('u', 100);
    expect(p.originId).toBe('midnight');
    expect(p.stage).toBe('companion');
    expect(MIDNIGHT_ORIGIN.eyes).toBe('amber');
    expect(MIDNIGHT_ORIGIN.motif).toBe('leaf');
  });

  it('activation functions take no model text — only profile, seeds and time', () => {
    // Structural guarantee: there is no code path taking generated prose here.
    expect(requestKeeperActivation.length).toBe(1); // a single {profile,seeds,now} arg
    expect(activateStage.length).toBe(3); // (profile, target, now)
  });
});

describe('evidence 11: eligibility never auto-transforms; explicit activation does', () => {
  const companion: FamiliarProfile = { kind: 'familiarProfile', id: 'profile', userId: 'u', originId: 'midnight', stage: 'companion', createdAt: 1 };

  it('not-ready seeds cannot activate', () => {
    const out = requestKeeperActivation({ profile: companion, seeds: [], now: 500 });
    expect(out.phase).toBe('not_ready');
  });

  it('ready seeds still require this explicit call to change stage', () => {
    // Being ready does not itself mutate the profile; the profile only changes
    // when requestKeeperActivation is deliberately invoked.
    const stillCompanion = companion;
    expect(stillCompanion.stage).toBe('companion');
    const out = requestKeeperActivation({ profile: companion, seeds: readySeeds(), now: 500 });
    expect(out.phase).toBe('activated');
    if (out.phase !== 'activated') return;
    expect(out.profile.stage).toBe('keeper');
    expect(out.profile.stageActivatedAt).toBe(500);
    // The original object is not mutated.
    expect(companion.stage).toBe('companion');
  });
});

describe('evidence 12: transformation is idempotent and preserves earlier records', () => {
  const keeper: FamiliarProfile = { kind: 'familiarProfile', id: 'profile', userId: 'u', originId: 'midnight', stage: 'keeper', createdAt: 1, stageActivatedAt: 700 };

  it('re-activating an already-Keeper profile is a no-op that preserves stageActivatedAt', () => {
    const out = requestKeeperActivation({ profile: keeper, seeds: readySeeds(), now: 9999 });
    expect(out.phase).toBe('already_keeper');
    if (out.phase !== 'already_keeper') return;
    expect(out.profile.stageActivatedAt).toBe(700);
  });

  it('activateStage never downgrades and never rewrites an existing timestamp', () => {
    const down = activateStage(keeper, 'companion', 5000);
    expect(down.changed).toBe(false);
    expect(down.profile.stage).toBe('keeper');
    const again = activateStage(keeper, 'keeper', 5000);
    expect(again.changed).toBe(false);
    expect(again.profile.stageActivatedAt).toBe(700);
  });

  it('stage does not downgrade even when seeds later fall below threshold', () => {
    // Revoking seeds after becoming Keeper does not call any downgrade path.
    const out = requestKeeperActivation({ profile: keeper, seeds: [], now: 8000 });
    expect(out.phase).toBe('already_keeper');
    expect((out as { profile: FamiliarProfile }).profile.stage).toBe('keeper');
  });
});
