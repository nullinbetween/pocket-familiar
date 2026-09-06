import { saveInteraction, updateInteraction } from './firestore-service';
import { getIdTokenOrThrow } from './firebase';
import { FlowDeps, ReflectionResponse } from './reflection-flow';

/**
 * Single source of truth for the LIVE reflection-flow dependencies.
 *
 * Both the full ReflectionWorkspace and the History Quick Reply modal
 * (EntryDetailModal) build their continuation through this factory so there is
 * exactly one authenticated, raw-save-first implementation — never a second
 * divergent path that could skip the Firebase ID token or the durability order.
 *
 * Gate B: every /api/gemini/reflect call carries a FRESH Firebase ID token.
 * Gate C: saveEntry/updateEntry persist the raw user turn first; the flow
 * (src/lib/reflection-flow.ts) only then requests generation and retains the
 * raw turn on failure.
 */
export function createReflectionFlowDeps(
  userId: string,
  opts: { onSaved?: FlowDeps['onSaved']; now?: () => number } = {}
): FlowDeps {
  return {
    saveEntry: (entry) => saveInteraction(userId, entry),
    updateEntry: (entryId, updates) => updateInteraction(userId, entryId, updates),
    requestReflection: async (payload): Promise<ReflectionResponse> => {
      const idToken = await getIdTokenOrThrow();
      const response = await fetch('/api/gemini/reflect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Server responded with status ${response.status}`);
      }
      const data = await response.json();
      return { text: data.text, modelUsed: data.modelUsed, timings: data.timings };
    },
    now: opts.now ?? (() => Date.now()),
    onSaved: opts.onSaved,
  };
}
