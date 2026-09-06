import { JournalInteraction, MessageTurn, MoodType, ReflectionMode } from '../types';

/**
 * Gate C: journal-first durability flow, extracted from the UI so it can be
 * tested deterministically (Gate F). All effects are injected.
 *
 * Invariants:
 *  1. The raw user entry is persisted FIRST, with generationStatus 'pending'.
 *  2. Gemini generation starts only after that write succeeds.
 *  3. On generation failure the raw entry is retained ('failed') and can be
 *     retried; a retry NEVER appends the raw user text again.
 *  4. If the raw write itself fails, nothing else runs — the caller keeps the
 *     composer content and offers "Retry Save".
 */

export interface ReflectionResponse {
  text: string;
  modelUsed?: string;
  timings?: Record<string, unknown>;
}

export interface FlowDeps {
  saveEntry: (entry: Omit<JournalInteraction, 'id'>) => Promise<string>;
  updateEntry: (entryId: string, updates: Partial<JournalInteraction>) => Promise<void>;
  requestReflection: (payload: {
    mode: ReflectionMode;
    mood: MoodType;
    title: string;
    prompt: string;
    history: Array<{ role: 'user' | 'model'; content: string }>;
  }) => Promise<ReflectionResponse>;
  now: () => number;
  /** Called as soon as the raw entry is durably persisted (drives the visible "Saved" ack). */
  onSaved?: (entry: JournalInteraction) => void;
}

export interface SubmitContext {
  userId: string;
  userEmail?: string;
  title: string;
  mood: MoodType;
  mode: ReflectionMode;
  tags: string[];
  promptText: string;
  existing: JournalInteraction | null;
}

export type FlowOutcome =
  | { phase: 'save_failed'; error: string }
  | { phase: 'saved_generation_failed'; entry: JournalInteraction; error: string }
  | { phase: 'complete'; entry: JournalInteraction };

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function submitEntry(deps: FlowDeps, ctx: SubmitContext): Promise<FlowOutcome> {
  const promptText = ctx.promptText.trim();
  const t0 = deps.now();

  const userTurn: MessageTurn = {
    id: `usr_${t0}`,
    role: 'user',
    content: promptText,
    timestamp: t0,
  };
  const baseTurns = ctx.existing?.turns ?? [];
  const turnsWithUser = [...baseTurns, userTurn];

  let entry: JournalInteraction;
  try {
    if (!ctx.existing?.id) {
      const payload: Omit<JournalInteraction, 'id'> = {
        userId: ctx.userId,
        userEmail: ctx.userEmail,
        title: ctx.title.trim() || promptText.slice(0, 40) + (promptText.length > 40 ? '…' : ''),
        initialPrompt: promptText,
        reflectionOutput: '',
        mode: ctx.mode,
        mood: ctx.mood,
        tags: ctx.tags.length > 0 ? ctx.tags : ['reflection'],
        turns: turnsWithUser,
        createdAt: t0,
        updatedAt: t0,
        isFavorite: false,
        generationStatus: 'pending',
      };
      const newId = await deps.saveEntry(payload);
      entry = { ...payload, id: newId };
    } else {
      const updates: Partial<JournalInteraction> = {
        turns: turnsWithUser,
        tags: ctx.tags,
        generationStatus: 'pending',
        updatedAt: t0,
      };
      await deps.updateEntry(ctx.existing.id, updates);
      entry = { ...ctx.existing, ...updates } as JournalInteraction;
    }
  } catch (err) {
    // Raw write failed: nothing persisted this round; caller preserves composer.
    return { phase: 'save_failed', error: message(err) };
  }

  const rawWriteMs = deps.now() - t0;
  deps.onSaved?.(entry);
  return generateForEntry(deps, entry, { rawWriteMs });
}

/**
 * Retry generation for an entry whose raw text is already persisted.
 * Does NOT append a new user turn — the raw journal text is never duplicated.
 */
export async function retryGeneration(deps: FlowDeps, entry: JournalInteraction): Promise<FlowOutcome> {
  return generateForEntry(deps, entry, { retriedAt: deps.now() });
}

async function generateForEntry(
  deps: FlowDeps,
  entry: JournalInteraction,
  extraTimings: Record<string, unknown>
): Promise<FlowOutcome> {
  if (!entry.id) {
    return { phase: 'saved_generation_failed', entry, error: 'Entry has no id.' };
  }
  const turns = entry.turns ?? [];
  let lastUserIndex = -1;
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].role === 'user') {
      lastUserIndex = i;
      break;
    }
  }
  if (lastUserIndex === -1) {
    return { phase: 'saved_generation_failed', entry, error: 'No user turn to reflect on.' };
  }
  const lastUser = turns[lastUserIndex];
  const history = turns
    .slice(0, lastUserIndex)
    .map((t) => ({ role: t.role, content: t.content }));

  const g0 = deps.now();
  let response: ReflectionResponse;
  try {
    response = await deps.requestReflection({
      mode: entry.mode,
      mood: entry.mood,
      title: entry.title,
      prompt: lastUser.content,
      history,
    });
    if (!response || typeof response.text !== 'string' || !response.text.trim()) {
      throw new Error('Empty companion response.');
    }
  } catch (err) {
    // Gate C: raw entry is retained; mark failed, best-effort.
    try {
      await deps.updateEntry(entry.id, { generationStatus: 'failed', updatedAt: deps.now() });
    } catch {
      // status write failed too — the raw entry itself is still durable
    }
    return {
      phase: 'saved_generation_failed',
      entry: { ...entry, generationStatus: 'failed' },
      error: message(err),
    };
  }

  const geminiMs = deps.now() - g0;
  const modelTurn: MessageTurn = {
    id: `gem_${deps.now()}`,
    role: 'model',
    content: response.text,
    timestamp: deps.now(),
  };

  const d0 = deps.now();
  const updates: Partial<JournalInteraction> = {
    turns: [...turns, modelTurn],
    reflectionOutput: response.text,
    modelUsed: response.modelUsed,
    generationStatus: 'complete',
    updatedAt: deps.now(),
    timings: {
      ...(entry.timings ?? {}),
      ...extraTimings,
      geminiMs,
      server: response.timings ?? null,
    },
  };
  try {
    await deps.updateEntry(entry.id, updates);
  } catch (err) {
    // Derived write failed; raw entry remains durable. Retry regenerates.
    try {
      await deps.updateEntry(entry.id, { generationStatus: 'failed', updatedAt: deps.now() });
    } catch {
      /* raw entry still safe */
    }
    return {
      phase: 'saved_generation_failed',
      entry: { ...entry, generationStatus: 'failed' },
      error: `Companion response could not be stored: ${message(err)}`,
    };
  }
  const derivedWriteMs = deps.now() - d0;
  const finalEntry: JournalInteraction = {
    ...entry,
    ...updates,
    timings: { ...(updates.timings as Record<string, unknown>), derivedWriteMs },
  };
  return { phase: 'complete', entry: finalEntry };
}
