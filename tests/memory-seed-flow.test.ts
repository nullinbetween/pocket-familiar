import { describe, expect, it } from 'vitest';
import { MemorySeed } from '../src/types';
import {
  validateSeedForApproval,
  buildCanonicalSeed,
  revokeSeed,
  markSourceUnavailable,
  activeSeeds,
  SeedProposal,
} from '../src/lib/memory-seed-flow';

/** PF-CORE-01 (closure) pure helpers shared by the server transactions and UI. */

const PROPOSAL: SeedProposal = {
  text: 'The walk home is mine again when I leave my phone in my bag.',
  sourceExcerpt: 'On the walk home I left my phone in my bag and noticed the light.',
  sourceDate: '2026-09-03',
  sourceRefs: [{ kind: 'diaryPage', id: 'dp-long', availability: 'available' }],
};

describe('validateSeedForApproval', () => {
  it('accepts a well-formed approval', () => {
    expect(validateSeedForApproval(PROPOSAL.text, PROPOSAL)).toEqual({ ok: true });
  });
  it('rejects empty text', () => {
    expect(validateSeedForApproval('   ', PROPOSAL)).toEqual({ ok: false, reason: 'empty_seed_text' });
  });
  it('requires exactly one diaryPage source ref (one-source schema)', () => {
    const two = { ...PROPOSAL, sourceRefs: [...PROPOSAL.sourceRefs, { kind: 'diaryPage' as const, id: 'x', availability: 'available' as const }] };
    expect(validateSeedForApproval(PROPOSAL.text, two)).toEqual({ ok: false, reason: 'expected_exactly_one_source_ref' });
  });
  it('rejects a bad source date', () => {
    expect(validateSeedForApproval(PROPOSAL.text, { ...PROPOSAL, sourceDate: 'someday' })).toEqual({ ok: false, reason: 'missing_source_date' });
  });
});

describe('buildCanonicalSeed (server-side record building)', () => {
  it('records edited text, editedByUser, verified provenance and no hidden raw source', () => {
    const edited = 'I keep the walk home phone-free and it stays mine.';
    const seed = buildCanonicalSeed({ userId: 'u', proposal: PROPOSAL, editedText: edited, now: 1000 });
    expect(seed.text).toBe(edited);
    expect(seed.editedByUser).toBe(true);
    expect(seed.status).toBe('active');
    expect(seed.approvedByUser).toBe(true);
    expect(seed.aiAssisted).toBe(true);
    expect(seed.sourceExcerpt).toBe(PROPOSAL.sourceExcerpt);
    expect(seed.sourceDate).toBe('2026-09-03');
    expect(seed.sourceRefs).toEqual([{ kind: 'diaryPage', id: 'dp-long', availability: 'available' }]);
    expect(seed.createdAt).toBe(1000);
    expect(seed.confirmedAt).toBe(1000);
    expect(Object.keys(seed)).not.toContain('rawSource');
  });
  it('unchanged text -> editedByUser=false', () => {
    const seed = buildCanonicalSeed({ userId: 'u', proposal: PROPOSAL, editedText: PROPOSAL.text, now: 1 });
    expect(seed.editedByUser).toBe(false);
  });
});

describe('revoke + context assembly (evidence 6)', () => {
  const seeds: MemorySeed[] = [
    { kind: 'memorySeed', id: 's1', userId: 'u', status: 'active', text: 'Keep the walk home phone-free.', sourceExcerpt: 'x', sourceDate: '2026-09-03', sourceRefs: [{ kind: 'diaryPage', id: 'p1', availability: 'available' }], aiAssisted: true, approvedByUser: true, editedByUser: false, createdAt: 1, confirmedAt: 1 },
    { kind: 'memorySeed', id: 's2', userId: 'u', status: 'active', text: 'The dread was louder than the day.', sourceExcerpt: 'y', sourceDate: '2026-08-20', sourceRefs: [{ kind: 'diaryPage', id: 'p2', availability: 'available' }], aiAssisted: true, approvedByUser: true, editedByUser: false, createdAt: 1, confirmedAt: 1 },
  ];

  it('activeSeeds returns only active seeds (the set injected as JSON context)', () => {
    expect(activeSeeds(seeds).map((s) => s.id)).toEqual(['s1', 's2']);
  });

  it('once revoked, the seed leaves the active set immediately', () => {
    const revoked = revokeSeed(seeds[0], 2000);
    expect(revoked.status).toBe('revoked');
    expect(revoked.revokedAt).toBe(2000);
    const next = [revoked, seeds[1]];
    expect(activeSeeds(next).map((s) => s.id)).toEqual(['s2']);
  });

  it('revoke is idempotent (preserves original revokedAt)', () => {
    const once = revokeSeed(seeds[0], 2000);
    expect(revokeSeed(once, 9999)).toBe(once);
  });
});

describe('markSourceUnavailable (evidence 7) never resurrects raw text', () => {
  it('flips only the ref availability; text and excerpt untouched', () => {
    const s: MemorySeed = { kind: 'memorySeed', id: 's1', userId: 'u', status: 'active', text: 'kept text', sourceExcerpt: 'the visible excerpt', sourceDate: '2026-09-03', sourceRefs: [{ kind: 'diaryPage', id: 'p1', availability: 'available' }], aiAssisted: true, approvedByUser: true, editedByUser: false, createdAt: 1, confirmedAt: 1 };
    const next = markSourceUnavailable(s, 'p1');
    expect(next.sourceRefs[0].availability).toBe('unavailable');
    expect(next.text).toBe('kept text');
    expect(next.sourceExcerpt).toBe('the visible excerpt');
  });
});
