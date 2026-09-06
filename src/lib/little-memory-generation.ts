import { LittleMemory } from '../types';
import { deriveLittleMemoryGenerationId } from './little-memory-image';

/**
 * PF-CORE-03B closure P0-2: the real generate seam used by the app.
 *
 * One billable attempt = one stable generationId. An in-flight attempt reuses its
 * id across an ambiguous client/network retry (refresh/double-click/timeout), so
 * the server collapses the repeat to in_progress/exists_ready and never bills a
 * second time; a new id is minted only for a genuinely new attempt (first Create,
 * an explicit Retry after a definitively failed attempt, or a Regenerate). A
 * single-flight guard additionally blocks a synchronous double-click from issuing
 * two requests before local state reflects the in-flight attempt.
 *
 * This is the exact object App wires to the album's onGenerate, so tests exercise
 * the real callback path, not a parallel reimplementation.
 */
export interface LittleMemoryGenerationController {
  generate(lm: LittleMemory): Promise<void>;
  /** Testing/inspection: is an attempt for this Little Memory in flight right now? */
  isInFlight(littleMemoryId: string): boolean;
}

export interface GenerationControllerDeps {
  /** Mint a fresh server-derived generation id for a NEW attempt. */
  mintId: (lm: LittleMemory) => string;
  /** Send the (littleMemoryId, generationId) generate request to the server. */
  send: (args: { littleMemoryId: string; generationId: string }) => Promise<{
    littleMemory?: LittleMemory;
    alreadyReady?: boolean;
    inProgress?: boolean;
  }>;
}

export function createLittleMemoryGenerationController(
  deps: GenerationControllerDeps
): LittleMemoryGenerationController {
  const inFlight = new Set<string>();
  // Keep the last submitted id until the canonical Firestore snapshot visibly
  // acknowledges it. This closes the gap between a settled/ambiguous HTTP request
  // and the subscription update reaching React.
  const retainedAttempts = new Map<string, { generationId: string; baselineImageId?: string }>();
  return {
    isInFlight: (littleMemoryId) => inFlight.has(littleMemoryId),
    async generate(lm) {
      const key = lm.id;
      if (!key) return;
      // Single-flight: a second click before the first settles is ignored.
      if (inFlight.has(key)) return;

      const retained = retainedAttempts.get(key);
      let generationId: string;
      if (lm.pendingGeneration?.status === 'generating') {
        // Canonical state owns the active attempt, including after refresh.
        generationId = lm.pendingGeneration.generationId;
      } else if (lm.pendingGeneration?.status === 'failed') {
        // The canonical record definitively closed this attempt. An explicit Retry
        // is a new billable attempt and therefore receives a new id.
        generationId = deps.mintId(lm);
      } else if (
        retained &&
        lm.image?.generationId !== retained.generationId &&
        lm.image?.generationId === retained.baselineImageId
      ) {
        // The caller still has the pre-attempt snapshot. Reuse the submitted id
        // even when the previous HTTP request succeeded or failed ambiguously.
        generationId = retained.generationId;
      } else {
        // No retained attempt, or Firestore has acknowledged the retained id as
        // the current image and this click is an explicit Regenerate.
        generationId = deriveLittleMemoryGenerationId(lm, () => deps.mintId(lm));
      }
      retainedAttempts.set(key, {
        generationId,
        baselineImageId: generationId === retained?.generationId
          ? retained.baselineImageId
          : lm.image?.generationId,
      });
      inFlight.add(key);
      try {
        await deps.send({ littleMemoryId: key, generationId });
      } finally {
        inFlight.delete(key);
      }
    },
  };
}
