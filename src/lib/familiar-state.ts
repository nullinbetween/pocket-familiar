import { ReflectionMode } from '../types';

/**
 * PF-02: deterministic, app-owned familiar state.
 *
 * Authority boundary: the APP chooses state, copy, motion and mode. The model
 * returns bounded reflection content only. Nothing in this module reads model
 * output — the inputs are booleans owned by application code, so provider text
 * can never select a state, a posture or a line of copy.
 */

export const FAMILIAR_IDENTITY = 'pocket-familiar' as const;

export type FamiliarState =
  | 'quiet'
  | 'listening'
  | 'saving'
  | 'thinking'
  | 'ready'
  | 'drafting_page'
  | 'celebrating_save'
  | 'error_recoverable';

export interface FamiliarInputs {
  /** The composer currently holds the user's unsent words. */
  isWriting: boolean;
  /** Raw-entry persistence is in flight (not yet settled). */
  isSavingRaw: boolean;
  /** Entry is safe; Gemini reflection work is in progress. */
  isThinking: boolean;
  /** PF-01 diary draft generation is in progress. */
  isDraftingPage: boolean;
  /** A visible, retryable failure is on screen. */
  hasRecoverableError: boolean;
  /** A bounded companion response just arrived. */
  justReady: boolean;
  /** A Diary Page was just confirmed (brief, non-addictive). */
  justCelebratedSave: boolean;
}

/**
 * Deterministic priority (highest first):
 *   error_recoverable > saving > drafting_page > thinking
 *   > celebrating_save > ready > listening > quiet
 * `saving` wins over `thinking` (data safety before intelligence), and a
 * recoverable failure can never be masked by success or celebration.
 */
export function deriveFamiliarState(i: FamiliarInputs): FamiliarState {
  if (i.hasRecoverableError) return 'error_recoverable';
  if (i.isSavingRaw) return 'saving';
  if (i.isDraftingPage) return 'drafting_page';
  if (i.isThinking) return 'thinking';
  if (i.justCelebratedSave) return 'celebrating_save';
  if (i.justReady) return 'ready';
  if (i.isWriting) return 'listening';
  return 'quiet';
}

/**
 * Closed, app-authored microcopy. One short line per state; free of
 * dependency-pressure language, gamified counters and feeling-claims; makes no
 * promise about persistence that the app has not confirmed.
 */
export const FAMILIAR_COPY: Readonly<Record<FamiliarState, string>> = Object.freeze({
  quiet: 'Here when you want to write.',
  listening: 'Listening — take your time.',
  saving: 'Keeping your words safe…',
  thinking: 'Your entry is saved. Thinking about it now…',
  ready: 'A small thought is ready for you.',
  drafting_page: 'Pressing your words into today’s page…',
  celebrating_save: 'Today’s page is kept. Nicely closed.',
  error_recoverable: 'That last step didn’t go through. When you’re ready, try again.',
});

export interface ModePresentation {
  /** One short app-authored line — never a second AI response. */
  line: string;
  /** Posture keyword consumed by the visual component. */
  posture: 'attentive' | 'arranging' | 'sparking' | 'stepping' | 'quiet_listening';
}

export const MODE_PRESENTATION: Readonly<Record<ReflectionMode, ModePresentation>> = Object.freeze({
  deep_reflection: Object.freeze({ line: 'Settling in to reflect with you.', posture: 'attentive' as const }),
  summary: Object.freeze({ line: 'Gathering the threads together.', posture: 'arranging' as const }),
  brainstorm: Object.freeze({ line: 'Sparking a few ideas.', posture: 'sparking' as const }),
  action_plan: Object.freeze({ line: 'Finding one next step.', posture: 'stepping' as const }),
  mindful_chat: Object.freeze({ line: 'Just here, listening.', posture: 'quiet_listening' as const }),
});

/**
 * The ONLY way UI obtains familiar copy. Unknown keys (e.g. anything a model
 * response tried to smuggle in) fall back to the quiet default — lookup never
 * evaluates or renders caller-supplied text.
 */
export function familiarCopyFor(state: FamiliarState): string {
  return FAMILIAR_COPY[state] ?? FAMILIAR_COPY.quiet;
}

export function modePresentationFor(mode: ReflectionMode): ModePresentation {
  return MODE_PRESENTATION[mode] ?? MODE_PRESENTATION.deep_reflection;
}

/**
 * Micro-motion classes per state. Reduced motion strips every nonessential
 * animation; the static presentation must remain fully understandable
 * (state text + posture + icon carry the meaning, never motion or color alone).
 */
export function motionClassesFor(state: FamiliarState, reducedMotion: boolean): string[] {
  if (reducedMotion) return [];
  switch (state) {
    case 'quiet':
      return ['familiar-breathe'];
    case 'listening':
      return ['familiar-breathe', 'familiar-lean'];
    case 'saving':
      return ['familiar-settle'];
    case 'thinking':
      return ['familiar-breathe', 'familiar-ponder'];
    case 'ready':
      return ['familiar-perk'];
    case 'drafting_page':
      return ['familiar-settle'];
    case 'celebrating_save':
      return ['familiar-spark-once'];
    case 'error_recoverable':
      return []; // an error state stays still and calm
  }
}
