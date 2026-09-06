import { FamiliarInputs } from './familiar-state';

/**
 * PF-02.1: the REAL workspace→familiar input seam, extracted as a pure
 * function so tests exercise the exact mapping production uses (not only the
 * isolated state table).
 *
 * Error definition (Codex PF-02.1 ruling): the familiar is in
 * `error_recoverable` whenever a retry affordance is VISIBLE — that includes
 *  - an in-session flow error banner,
 *  - the standing retry panel for a persisted generationStatus='failed' entry
 *    (visible only while not actively regenerating and not in the diary flow),
 *  - a visible PF-01 draft/save failure inside the diary editor.
 */
export interface WorkspaceFamiliarFacts {
  composerText: string;
  /** raw-entry persistence in flight */
  persisting: boolean;
  /** any reflection generation in flight (first submit or Retry Response) */
  isGenerating: boolean;
  /** PF-01 diary draft generation in flight */
  draftingPage: boolean;
  /** in-session flow error banner visible (save or generation) */
  flowErrorVisible: boolean;
  /** the open entry is persisted with generationStatus === 'failed' */
  persistedGenerationFailed: boolean;
  /** PF-01 editor currently shows a draft/save failure with a retry button */
  diaryEditorErrorVisible: boolean;
  /** the PF-01 editor is open (the standing retry panel hides while it is) */
  diaryEditorOpen: boolean;
  justReady: boolean;
  pageJustSaved: boolean;
}

export function workspaceFamiliarInputs(f: WorkspaceFamiliarFacts): FamiliarInputs {
  // The standing retry panel renders only when no banner is up, nothing is
  // regenerating, and the diary editor is not covering the flow.
  const standingRetryVisible =
    f.persistedGenerationFailed && !f.flowErrorVisible && !f.isGenerating && !f.diaryEditorOpen;
  return {
    isWriting: f.composerText.trim().length > 0,
    isSavingRaw: f.persisting,
    isThinking: f.isGenerating && !f.persisting && !f.draftingPage,
    isDraftingPage: f.draftingPage,
    hasRecoverableError: f.flowErrorVisible || standingRetryVisible || f.diaryEditorErrorVisible,
    justReady: f.justReady,
    justCelebratedSave: f.pageJustSaved,
  };
}
