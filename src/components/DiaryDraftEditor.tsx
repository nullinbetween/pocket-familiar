import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, Sparkles, X } from 'lucide-react';
import { DiaryDraftFields, DiaryPage, JournalInteraction } from '../types';
import { confirmDiaryPage, DiaryFlowDeps, requestDiaryDraft, userTurnsOf } from '../lib/diary-flow';
import { DiaryFieldErrors } from '../lib/diary-validate';
import { FamiliarAvatar } from './Familiar';
import { KEEP_COPY, NOT_SAVED_LABEL } from '../lib/brand';

/**
 * PF-01 Diary Page approval, Skin Round 1 (honest closure): a focused warm-paper
 * sheet with a small Q-head familiar that dims the journal behind it. It is
 * explicitly an AI-assisted DRAFT built from the conversation text the user
 * selected — approving saves a Diary Page. The default view is a read-only
 * preview of EVERY field that will be saved (title, date, diary prose, all
 * important points, carry-forward); Edit progressively reveals the editable
 * fields. Prose is never wrapped in quotation marks (it is generated diary
 * prose, not verbatim speech).
 *
 * Consent + provenance LOGIC is unchanged: nothing is a diary page until the
 * user approves; Decline/failure leaves the conversation unchanged; the same
 * pageId on retry never duplicates. All prior selectors are preserved.
 */

interface Props {
  userId: string;
  interaction: JournalInteraction;
  deps: DiaryFlowDeps;
  todayISO: string;
  onConfirmed: (page: DiaryPage) => void;
  onClose: () => void;
  onDraftingChange?: (drafting: boolean) => void;
  onRecoverableErrorChange?: (hasError: boolean) => void;
}

type Stage = 'selecting' | 'generating' | 'editing' | 'saving';

/** Read-only preview of every field that Approve will save. Pure — testable. */
export const DiaryDraftPreview: React.FC<{ draft: DiaryDraftFields }> = ({ draft }) => (
  <div id="diary-draft-preview" className="rounded-2xl bg-white/70 border pf-hairline px-4 py-3 space-y-3 text-left">
    <div className="flex items-baseline justify-between gap-2">
      <h4 className="text-sm font-bold text-[var(--pf-ink)]" style={{ fontFamily: '"Playfair Display", Georgia, serif' }}>{draft.title}</h4>
      <span className="text-[11px] text-[#8A8471] font-mono shrink-0">{draft.date}</span>
    </div>
    <div>
      <span className="text-[10px] font-bold text-[#7A5825] uppercase tracking-wide">Today, in my words</span>
      <p className="mt-0.5 text-xs text-[#38382E] leading-relaxed whitespace-pre-wrap">{draft.todayInMyWords}</p>
    </div>
    {draft.whatFeltImportant.length > 0 && (
      <div>
        <span className="text-[10px] font-bold text-[#7A5825] uppercase tracking-wide">What felt important</span>
        <ul className="mt-0.5 space-y-0.5">
          {draft.whatFeltImportant.map((item, i) => (
            <li key={i} className="text-xs text-[#4A4A3A] flex gap-1.5"><span className="text-[#B99C5A]">✦</span><span>{item}</span></li>
          ))}
        </ul>
      </div>
    )}
    {draft.carryForward && (
      <div>
        <span className="text-[10px] font-bold text-[#7A5825] uppercase tracking-wide">Carry forward</span>
        <p className="mt-0.5 text-xs text-[#5A6650] italic border-l-2 border-[#CBD6C3] pl-2">{draft.carryForward}</p>
      </div>
    )}
  </div>
);

export const DiaryDraftEditor: React.FC<Props> = ({
  userId, interaction, deps, todayISO, onConfirmed, onClose, onDraftingChange, onRecoverableErrorChange,
}) => {
  const userTurns = useMemo(() => userTurnsOf(interaction), [interaction]);
  const [selected, setSelected] = useState<string[]>(userTurns.map((t) => t.id));
  const [stage, setStage] = useState<Stage>('selecting');
  const [draftError, setDraftError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<DiaryFieldErrors>({});
  const [aiDraft, setAiDraft] = useState<(DiaryDraftFields & { sourceTurnIds: string[] }) | null>(null);
  const [edited, setEdited] = useState<DiaryDraftFields | null>(null);
  const [pageId, setPageId] = useState<string | undefined>(undefined);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    onRecoverableErrorChange?.(Boolean(draftError || saveError));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftError, saveError]);
  useEffect(() => () => onRecoverableErrorChange?.(false), []);

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const generate = async () => {
    setDraftError(null); setStage('generating'); onDraftingChange?.(true);
    const outcome = await requestDiaryDraft(deps, interaction, selected, todayISO);
    onDraftingChange?.(false);
    if (outcome.phase === 'draft_failed') { setDraftError(outcome.error); setStage('selecting'); return; }
    setAiDraft(outcome.draft);
    setEdited({
      title: outcome.draft.title, date: outcome.draft.date, todayInMyWords: outcome.draft.todayInMyWords,
      whatFeltImportant: [...outcome.draft.whatFeltImportant], carryForward: outcome.draft.carryForward,
    });
    setStage('editing');
  };

  const save = async () => {
    if (!edited || !aiDraft || !interaction.id) return;
    setSaveError(null); setFieldErrors({}); setStage('saving');
    const outcome = await confirmDiaryPage(deps, {
      userId, interactionId: interaction.id, edited, sourceTurnIds: aiDraft.sourceTurnIds, aiDraft, pageId,
    });
    if (outcome.phase === 'validation_failed') { setFieldErrors(outcome.errors); setStage('editing'); setExpanded(true); return; }
    setPageId(outcome.pageId);
    if (outcome.phase === 'save_failed') { setSaveError(outcome.error); setStage('editing'); return; }
    onConfirmed(outcome.page);
  };

  const FieldError: React.FC<{ name: keyof DiaryFieldErrors }> = ({ name }) =>
    fieldErrors[name] ? (
      <p id={`diary-error-${name}`} className="mt-1 text-[11px] font-semibold text-[#8C3232]">{fieldErrors[name]}</p>
    ) : null;

  const setItem = (idx: number, value: string) =>
    setEdited((prev) => {
      if (!prev) return prev;
      const items = [...prev.whatFeltImportant]; items[idx] = value;
      return { ...prev, whatFeltImportant: items };
    });

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div className="absolute inset-0 bg-[#10151F]/60 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />

      <div id="diary-draft-editor" role="dialog" aria-modal="true" aria-label="Keep this page?"
        className="relative w-full sm:max-w-md pf-paper-surface border pf-hairline rounded-t-[26px] sm:rounded-[26px] shadow-2xl max-h-[92vh] overflow-y-auto">
        <button id="diary-draft-cancel-btn" onClick={onClose} title="Close — your conversation stays unchanged"
          className="absolute top-3 right-3 p-1.5 rounded-lg text-[#7A7A6A] hover:bg-black/5"><X className="w-4 h-4" /></button>

        <div className="px-6 pt-7 pb-6">
          <div className="flex justify-center">
            <FamiliarAvatar state="ready" mode={interaction.mode} size={52} variant="head" />
          </div>
          <h3 className="mt-2 text-center text-xl font-bold text-[var(--pf-ink)]" style={{ fontFamily: '"Playfair Display", Georgia, serif' }}>
            {KEEP_COPY.heading}
          </h3>
          <div className="mt-1.5 flex justify-center">
            <span id="draft-not-saved-label" className="inline-block text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded bg-[#FAF3E0] text-[#7A5825] border border-[#E8DAB2]">
              {NOT_SAVED_LABEL}
            </span>
          </div>

          {stage === 'selecting' && (
            <div className="mt-4 space-y-3">
              <p className="text-xs text-center text-[#5A5A4A] leading-relaxed">
                Choose which of <strong>your own</strong> words to press into today’s page. Your familiar’s replies are never kept as your record.
              </p>
              <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                {userTurns.map((t) => (
                  <label key={t.id} className="flex items-start gap-2 p-2 rounded-lg border pf-hairline bg-white text-xs text-[#4A4A3A] cursor-pointer hover:border-[#CBD6C3]">
                    <input type="checkbox" checked={selected.includes(t.id)} onChange={() => toggle(t.id)} className="mt-0.5 accent-[var(--pf-forest)]" />
                    <span className="line-clamp-2">{t.content}</span>
                  </label>
                ))}
              </div>
              {draftError && (
                <div className="p-3 rounded-xl bg-[#FBEFEF] border border-[#ECC8C8] text-[#8C3232] text-xs flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5 shrink-0" />Draft unavailable: {draftError}</span>
                  <button id="diary-draft-retry-btn" onClick={generate} className="px-2.5 py-1 rounded-md bg-[#8C3232] hover:bg-[#722727] text-white font-semibold text-xs shrink-0">Retry</button>
                </div>
              )}
              <button id="diary-generate-draft-btn" onClick={generate} disabled={selected.length === 0}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-full bg-[var(--pf-forest)] hover:bg-[var(--pf-forest-deep)] text-[var(--pf-cream)] text-sm font-bold shadow-xs disabled:opacity-50">
                <Sparkles className="w-4 h-4" /> Draft from {selected.length} of my {selected.length === 1 ? 'note' : 'notes'}
              </button>
            </div>
          )}

          {stage === 'generating' && (
            <div id="diary-draft-loading" className="flex items-center gap-2 text-xs text-[#5A6650] py-8 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> Pressing your words into a draft…
            </div>
          )}

          {(stage === 'editing' || stage === 'saving') && edited && (
            <div className="mt-4 space-y-4">
              <p className="text-xs text-center text-[#5A5A4A] leading-relaxed">{KEEP_COPY.body}</p>

              {/* Default read-only preview: every field that Approve will save */}
              <DiaryDraftPreview draft={edited} />

              <p className="flex items-center justify-center gap-1.5 text-[11px] text-[#7A7A6A]">
                <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>
                {KEEP_COPY.reassurance}
              </p>

              {expanded && (
                <div className="space-y-3 border-t pf-hairline pt-3">
                  <div>
                    <label className="text-[11px] font-bold text-[#4A4A3A] uppercase tracking-wide">Title</label>
                    <input id="diary-title-input" value={edited.title} onChange={(e) => setEdited({ ...edited, title: e.target.value })}
                      className="mt-1 w-full px-3 py-2 text-sm font-semibold text-[#2D2D24] border border-[#E0DBCF] rounded-xl bg-white focus:outline-hidden focus:border-[var(--pf-forest)]" placeholder="Page title" />
                    <FieldError name="title" />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-[#4A4A3A] uppercase tracking-wide">Date</label>
                    <input id="diary-date-input" type="date" value={edited.date} onChange={(e) => setEdited({ ...edited, date: e.target.value })}
                      className="mt-1 w-full px-3 py-2 text-xs border border-[#E0DBCF] rounded-xl bg-white text-[#4A4A3A]" />
                    <FieldError name="date" />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-[#4A4A3A] uppercase tracking-wide">Today, in my words</label>
                    <textarea id="diary-today-textarea" rows={4} value={edited.todayInMyWords} onChange={(e) => setEdited({ ...edited, todayInMyWords: e.target.value })}
                      className="mt-1 w-full p-3 text-xs text-[#2D2D24] border border-[#E0DBCF] rounded-xl bg-white leading-relaxed focus:outline-hidden focus:border-[var(--pf-forest)]" />
                    <FieldError name="todayInMyWords" />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-[#4A4A3A] uppercase tracking-wide">What felt important (max 2)</label>
                    {edited.whatFeltImportant.map((item, idx) => (
                      <input key={idx} id={`diary-important-${idx}`} value={item} onChange={(e) => setItem(idx, e.target.value)}
                        className="mt-1 w-full px-3 py-2 text-xs border border-[#E0DBCF] rounded-xl bg-white text-[#2D2D24] focus:outline-hidden focus:border-[var(--pf-forest)]" />
                    ))}
                    <FieldError name="whatFeltImportant" />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-[#4A4A3A] uppercase tracking-wide">Carry forward (optional)</label>
                    <input id="diary-carry-input" value={edited.carryForward ?? ''} onChange={(e) => setEdited({ ...edited, carryForward: e.target.value || undefined })}
                      className="mt-1 w-full px-3 py-2 text-xs border border-[#E0DBCF] rounded-xl bg-white text-[#2D2D24] focus:outline-hidden focus:border-[var(--pf-forest)]" />
                    <FieldError name="carryForward" />
                  </div>
                </div>
              )}

              {saveError && (
                <div className="p-3 rounded-xl bg-[#FBEFEF] border border-[#ECC8C8] text-[#8C3232] text-xs flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5 shrink-0" />Could not save: {saveError} — your draft is kept.</span>
                  <button id="diary-save-retry-btn" onClick={save} className="px-2.5 py-1 rounded-md bg-[#8C3232] hover:bg-[#722727] text-white font-semibold text-xs shrink-0">Retry</button>
                </div>
              )}

              <div className="space-y-2 pt-1">
                <button id="diary-save-page-btn" onClick={save} disabled={stage === 'saving'}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-full bg-[var(--pf-forest)] hover:bg-[var(--pf-forest-deep)] text-[var(--pf-cream)] text-sm font-bold shadow-xs disabled:opacity-60">
                  {stage === 'saving' ? <Loader2 className="w-4 h-4 animate-spin" /> : null}{KEEP_COPY.approve}
                </button>
                <button id="diary-edit-toggle-btn" onClick={() => setExpanded((v) => !v)}
                  className="w-full px-4 py-2.5 rounded-full bg-white border pf-hairline text-[var(--pf-ink)] text-sm font-semibold hover:bg-[#FAF8F2]">
                  {expanded ? 'Done editing' : KEEP_COPY.edit}
                </button>
                <button id="diary-cancel-btn" onClick={onClose}
                  className="w-full px-4 py-2.5 rounded-full bg-white border pf-hairline text-[#7A5230] text-sm font-semibold hover:bg-[#FAF8F2]">
                  {KEEP_COPY.decline}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
