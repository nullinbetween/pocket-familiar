import { MemorySeed, SeedSourceRef } from '../types';

/**
 * PF-CORE-01 (closure): Memory Seed logic. After the closure, canonical seeds
 * are created/mutated ONLY by authenticated server transactions — a browser
 * client can no longer write them (Firestore rules deny it). This module holds
 * the pure, deterministic helpers those transactions and the UI share:
 *   - validation of the user-approved text,
 *   - building the canonical record (server-side),
 *   - pure revoke / mark-source-unavailable transitions,
 *   - assembling ONLY active seeds into clearly-delimited model context.
 *
 * Invariants preserved: a model-proposed seed is never durable without explicit
 * user approval (now enforced by a server confirm transaction); a seed carries
 * only its visible text, a server-verified excerpt and typed refs — no hidden
 * raw-source snapshot; only 'active' seeds enter model context, so revoked or
 * deleted seeds leave it on the very next request.
 */

/** A server-verified, not-yet-durable proposal shown to the user for approval. */
export interface SeedProposal {
  /** The model-proposed seed sentence (editable before approval). */
  text: string;
  /** A short excerpt the SERVER read from the verified source page (shown to the user). */
  sourceExcerpt: string;
  /** The verified source page's local calendar date (YYYY-MM-DD). */
  sourceDate: string;
  /** Typed provenance — the confirmed Diary Page(s) this seed is grounded in. */
  sourceRefs: SeedSourceRef[];
}

export const SEED_TEXT_MAX_CHARS = 280;
export const SEED_EXCERPT_MAX_CHARS = 600;

/** Deterministic validation of the user-approved seed text and its provenance. */
export function validateSeedForApproval(
  editedText: string,
  proposal: SeedProposal
): { ok: true } | { ok: false; reason: string } {
  const text = editedText.trim();
  if (!text) return { ok: false, reason: 'empty_seed_text' };
  if (text.length > SEED_TEXT_MAX_CHARS) return { ok: false, reason: `seed_text_over_${SEED_TEXT_MAX_CHARS}_chars` };
  if (typeof proposal.sourceExcerpt !== 'string' || !proposal.sourceExcerpt.trim()) {
    return { ok: false, reason: 'missing_source_excerpt' };
  }
  if (proposal.sourceExcerpt.length > SEED_EXCERPT_MAX_CHARS) {
    return { ok: false, reason: `source_excerpt_over_${SEED_EXCERPT_MAX_CHARS}_chars` };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(proposal.sourceDate)) return { ok: false, reason: 'missing_source_date' };
  if (!Array.isArray(proposal.sourceRefs) || proposal.sourceRefs.length !== 1) {
    // This slice creates exactly one Diary Page source per seed.
    return { ok: false, reason: 'expected_exactly_one_source_ref' };
  }
  const ref = proposal.sourceRefs[0];
  if (!ref || ref.kind !== 'diaryPage' || typeof ref.id !== 'string' || !ref.id.trim()) {
    return { ok: false, reason: 'malformed_source_ref' };
  }
  return { ok: true };
}

/**
 * Build the canonical seed record from a server-verified proposal and the
 * user-approved (possibly edited) text. PURE: the SERVER calls this inside a
 * create-once transaction, deciding `now` itself. Provenance comes only from the
 * verified proposal; `editedByUser` compares approved text to the proposed text.
 */
export function buildCanonicalSeed(args: {
  userId: string;
  proposal: SeedProposal;
  editedText: string;
  now: number;
}): Omit<MemorySeed, 'id'> {
  const text = args.editedText.trim();
  const editedByUser = text !== args.proposal.text.trim();
  const sourceRefs: SeedSourceRef[] = args.proposal.sourceRefs.map((r) => ({
    kind: 'diaryPage',
    id: r.id,
    availability: 'available',
  }));
  return {
    kind: 'memorySeed',
    userId: args.userId,
    status: 'active',
    text,
    sourceExcerpt: args.proposal.sourceExcerpt.trim(),
    sourceDate: args.proposal.sourceDate,
    sourceRefs,
    aiAssisted: true,
    approvedByUser: true,
    editedByUser,
    createdAt: args.now,
    confirmedAt: args.now,
  };
}

/**
 * Pure revoke transition. Idempotent — revoking an already-revoked seed is a
 * no-op (its original revokedAt is preserved). Revocation removes the seed from
 * assembled context immediately (see `assembleSeedContext`) but never touches
 * the source Diary Page.
 */
export function revokeSeed(seed: MemorySeed, now: number): MemorySeed {
  if (seed.status === 'revoked') return seed;
  return { ...seed, status: 'revoked', revokedAt: now };
}

/**
 * Mark one source reference unavailable (used when the user deletes a source
 * page but keeps this seed). No raw source text is stored, so nothing is lost
 * or resurrected — only the typed ref's availability flips.
 */
export function markSourceUnavailable(seed: MemorySeed, pageId: string): MemorySeed {
  return {
    ...seed,
    sourceRefs: seed.sourceRefs.map((r) =>
      r.kind === 'diaryPage' && r.id === pageId ? { ...r, availability: 'unavailable' } : r
    ),
  };
}

/**
 * Active-seed filter shared by the UI and the server. NOTE (closure P0-1): the
 * old `assembleSeedContext` raw-bullet helper was REMOVED. Seed context now
 * reaches the model only as a single JSON-serialized data object built in the
 * server `/reflect` path — there is deliberately no helper that renders seeds as
 * free-standing bullet prose, so hostile seed text can never escape the JSON
 * frame. Revoked/removed seeds are excluded here, so a revocation takes effect
 * the instant the active set is next assembled.
 */
export function activeSeeds(seeds: MemorySeed[]): MemorySeed[] {
  return seeds.filter((s) => s.status === 'active');
}
