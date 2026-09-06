import { DiaryDraftFields, DiaryPage, JournalInteraction } from '../types';
import { DiaryFieldErrors, sameImportantItems, validateConfirmedPage } from './diary-validate';

/**
 * PF-01 flow logic, extracted from the UI for deterministic testing.
 * Invariants:
 *  1. ONLY user-authored turns are ever sent as diary sources — model prose is
 *     never treated as the user's life evidence, whatever ids the caller passes.
 *  2. Requesting a draft has NO side effects on the conversation; failure or
 *     cancellation leaves it byte-identical.
 *  3. Nothing becomes a canonical Diary Page until explicit confirmation.
 *  4. Confirmation writes to a pre-allocated pageId, so a retried save can
 *     never create a second page.
 */

export interface DiaryDraftResponse {
  title: string;
  todayInMyWords: string;
  whatFeltImportant: string[];
  carryForward?: string;
  sourceTurnIds: string[];
}

export interface DiaryFlowDeps {
  requestDraft: (payload: {
    date: string;
    sources: Array<{ turnId: string; text: string }>;
  }) => Promise<DiaryDraftResponse>;
  savePage: (pageId: string, page: Omit<DiaryPage, 'id'>) => Promise<void>;
  newPageId: () => string;
  now: () => number;
}

export function userTurnsOf(interaction: JournalInteraction) {
  return (interaction.turns ?? []).filter((t) => t.role === 'user');
}

export type DraftOutcome =
  | { phase: 'draft_ready'; draft: DiaryDraftFields & { sourceTurnIds: string[] } }
  | { phase: 'draft_failed'; error: string };

/**
 * Ask for an AI-assisted draft from SELECTED, USER-AUTHORED turns only.
 * Ids that do not belong to user-authored turns are dropped, never sent.
 */
export async function requestDiaryDraft(
  deps: DiaryFlowDeps,
  interaction: JournalInteraction,
  selectedTurnIds: string[],
  date: string
): Promise<DraftOutcome> {
  const userTurns = userTurnsOf(interaction);
  const selectable = new Map(userTurns.map((t) => [t.id, t]));
  const sources = selectedTurnIds
    .filter((id, i, arr) => arr.indexOf(id) === i)
    .map((id) => selectable.get(id))
    .filter((t): t is NonNullable<ReturnType<typeof selectable.get>> => Boolean(t))
    .map((t) => ({ turnId: t!.id, text: t!.content }));
  if (sources.length === 0) {
    return { phase: 'draft_failed', error: 'Select at least one of your own journal turns.' };
  }
  try {
    const resp = await deps.requestDraft({ date, sources });
    return {
      phase: 'draft_ready',
      draft: {
        title: resp.title,
        date,
        todayInMyWords: resp.todayInMyWords,
        whatFeltImportant: resp.whatFeltImportant,
        carryForward: resp.carryForward,
        sourceTurnIds: resp.sourceTurnIds,
      },
    };
  } catch (err) {
    return { phase: 'draft_failed', error: err instanceof Error ? err.message : String(err) };
  }
}

export type ConfirmOutcome =
  | { phase: 'confirmed'; page: DiaryPage; pageId: string }
  | { phase: 'validation_failed'; errors: DiaryFieldErrors; pageId?: string }
  | { phase: 'save_failed'; error: string; pageId: string };

/**
 * Explicit confirmation — the ONLY path that creates a canonical Diary Page.
 * Pass the same pageId on retry so a retried save updates the same document.
 */
export async function confirmDiaryPage(
  deps: DiaryFlowDeps,
  args: {
    userId: string;
    interactionId: string;
    edited: DiaryDraftFields;
    sourceTurnIds: string[];
    aiDraft: DiaryDraftFields;
    pageId?: string;
  }
): Promise<ConfirmOutcome> {
  // PF-01.1 fix 2: user edits are validated BEFORE any Firestore write, with
  // visible field-level errors — never silent truncation. The pre-allocated
  // pageId (if any) is preserved so a later retry still cannot duplicate.
  const verdict = validateConfirmedPage(args.edited, args.sourceTurnIds);
  if (verdict.ok === false) {
    return { phase: 'validation_failed', errors: verdict.errors, pageId: args.pageId };
  }
  const pageId = args.pageId ?? deps.newPageId();
  const now = deps.now();
  const e = args.edited;
  const d = args.aiDraft;
  const editedByUser =
    e.title !== d.title ||
    e.todayInMyWords !== d.todayInMyWords ||
    e.carryForward !== d.carryForward ||
    e.date !== d.date ||
    !sameImportantItems(e.whatFeltImportant, d.whatFeltImportant);
  const page: Omit<DiaryPage, 'id'> = {
    kind: 'diaryPage',
    userId: args.userId,
    title: e.title.trim(),
    date: e.date,
    todayInMyWords: e.todayInMyWords.trim(),
    whatFeltImportant: e.whatFeltImportant.map((i) => i.trim()).filter(Boolean),
    carryForward: e.carryForward?.trim() || undefined,
    sourceInteractionId: args.interactionId,
    sourceTurnIds: args.sourceTurnIds,
    aiAssisted: true,
    status: 'confirmed',
    createdAt: now,
    confirmedAt: now,
    editedByUser,
  };
  try {
    await deps.savePage(pageId, page);
    return { phase: 'confirmed', page: { ...page, id: pageId }, pageId };
  } catch (err) {
    return {
      phase: 'save_failed',
      error: err instanceof Error ? err.message : String(err),
      pageId,
    };
  }
}
