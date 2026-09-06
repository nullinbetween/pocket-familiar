import React, { useEffect, useMemo, useState } from 'react';
import { DiaryPage, MemorySeed, SceneBriefFields } from '../types';
import { LittleMemoryDraftResult } from '../lib/growth-client';
import { validateSceneBriefShape } from '../lib/little-memory-flow';
import { FAMILIAR_HEAD } from '../lib/brand';
import { Loader2, Sparkles, X, ChevronLeft } from 'lucide-react';

/**
 * PF-CORE-03A: the Little Memory studio. The real consent + provenance path
 * BEFORE any illustration exists:
 *   choose a confirmed Diary Page (given) + 0..n ACTIVE Memory Seeds
 *   → the server drafts a bounded scene brief
 *   → the user reviews the user-facing caption and its verified sources
 *   → the user explicitly saves.
 * Nothing is durable until the explicit save; a failed save preserves the draft
 * and the user's edits; NO image is generated here.
 */

interface Props {
  sourcePage: DiaryPage;
  activeSeeds: MemorySeed[];
  /**
   * Allocate a pre-allocated Little Memory id. Called EXACTLY ONCE for the life
   * of this studio (one review/save attempt group), so a failed save followed by
   * Retry re-uses the same id and the server's create-once transaction produces
   * exactly one record. A genuinely new Little Memory is a fresh studio mount.
   */
  allocateId: () => string;
  /** Server draft from the chosen ids (retryable). */
  requestDraft: (seedIds: string[]) => Promise<LittleMemoryDraftResult>;
  /** Persist the EXACT reviewed fields under the stable id. Rejects to show an error + keep edits. */
  onApprove: (args: { littleMemoryId: string; draftFields: SceneBriefFields; approvedFields: SceneBriefFields; seedIds: string[] }) => Promise<void>;
  onClose: () => void;
}

type Step = 'choose' | 'review';

export const LittleMemoryStudio: React.FC<Props> = ({ sourcePage, activeSeeds, allocateId, requestDraft, onApprove, onClose }) => {
  // Allocated ONCE for this studio; stable across a failed save and Retry.
  const [littleMemoryId] = useState(() => allocateId());
  const [step, setStep] = useState<Step>('choose');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<LittleMemoryDraftResult | null>(null);
  const [fields, setFields] = useState<SceneBriefFields | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const seedIds = useMemo(() => activeSeeds.map((s) => s.id!).filter(Boolean).filter((id) => selected.has(id)), [activeSeeds, selected]);

  const toggleSeed = (id: string) =>
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const runDraft = async () => {
    setLoading(true); setError(null);
    try {
      const r = await requestDraft(seedIds);
      setDraft(r);
      setFields(r.draft);
      setStep('review');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Midnight could not find the moment just now. You can retry.');
    } finally {
      setLoading(false);
    }
  };

  const setCaption = (value: string) =>
    setFields((f) => (f ? { ...f, caption: value } : f));

  const approve = async () => {
    if (!fields || !draft || saving) return;
    const verdict = validateSceneBriefShape(fields);
    if (verdict.ok === false) { setError('That moment could not be prepared safely. Please try another version.'); return; }
    setSaving(true); setError(null);
    try {
      await onApprove({ littleMemoryId, draftFields: draft.draft, approvedFields: fields, seedIds });
    } catch (err) {
      // Preserve the draft + edits so the user can retry without losing work.
      setError(err instanceof Error ? err.message : 'Could not save that yet — nothing was saved. You can retry.');
      setSaving(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Make a Little Memory"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[rgba(20,28,43,0.45)] backdrop-blur-sm p-0 sm:p-4"
      onClick={onClose}>
      <div id="little-memory-studio" onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-lg max-h-[92vh] overflow-y-auto bg-[var(--pf-paper)] rounded-t-3xl sm:rounded-3xl border pf-hairline shadow-2xl">
        <div className="sticky top-0 z-[1] flex items-center justify-between px-4 py-3 border-b pf-hairline bg-[var(--pf-paper)]">
          <div className="flex items-center gap-2 min-w-0">
            {step === 'review' && (
              <button id="lm-back-btn" onClick={() => setStep('choose')} aria-label="Back to choosing sources"
                className="p-1 rounded-lg text-[#7A7A6A] hover:text-[var(--pf-ink)] hover:bg-[var(--pf-paper-2)]"><ChevronLeft className="w-4 h-4" /></button>
            )}
            <Sparkles className="w-4 h-4 text-[var(--pf-brass)] shrink-0" />
            <span className="text-sm font-semibold text-[var(--pf-ink)] truncate">
              {step === 'choose' ? 'Make a Little Memory' : 'Keep this moment?'}
            </span>
          </div>
          <button id="lm-studio-cancel-btn" onClick={onClose} aria-label="Cancel — nothing is saved"
            className="p-1.5 rounded-lg text-[#7A7A6A] hover:text-[var(--pf-ink)] hover:bg-[var(--pf-paper-2)]"><X className="w-4 h-4" /></button>
        </div>

        {step === 'choose' && (
          <div className="px-4 py-4 space-y-4">
            <div className="flex items-start gap-2.5">
              <img src={FAMILIAR_HEAD.ready} alt="" aria-hidden="true" className="w-9 h-9 object-contain shrink-0 mt-0.5" draggable={false} />
              <p className="text-xs text-[#6A6A5A] leading-relaxed">
                Choose what this Little Memory grows from. Midnight will prepare the illustration quietly; you only keep the moment and the records it came from.
              </p>
            </div>

            <div id="lm-source-page" className="rounded-xl bg-white/70 border pf-hairline px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[#8A8A78]">From this diary page · {sourcePage.date}</p>
              <p className="text-sm font-bold text-[var(--pf-ink)] mt-0.5">{sourcePage.title}</p>
              <p className="text-xs text-[#5A5A4A] leading-relaxed line-clamp-3 mt-1">{sourcePage.todayInMyWords}</p>
            </div>

            <div>
              <p className="text-[11px] font-semibold text-[var(--pf-ink)] mb-1.5">Add memory seeds (optional)</p>
              {activeSeeds.length === 0 ? (
                <p className="text-[11px] text-[#8A8471]">No active memory seeds yet — that’s fine, a page alone can make a Little Memory.</p>
              ) : (
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {activeSeeds.map((s) => (
                    <label key={s.id} htmlFor={`lm-seed-option-${s.id}`} className="flex items-start gap-2 rounded-lg border pf-hairline px-2.5 py-1.5 bg-white/60 cursor-pointer hover:bg-white">
                      <input id={`lm-seed-option-${s.id}`} type="checkbox" checked={selected.has(s.id!)} onChange={() => toggleSeed(s.id!)}
                        className="mt-0.5 accent-[var(--pf-forest)]" />
                      <span className="text-[11px] text-[#4A4A3A] leading-snug">“{s.text}”</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {error && <p id="lm-error" className="text-xs text-[#8C3232]">{error}</p>}

            <button id="lm-draft-btn" onClick={runDraft} disabled={loading}
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-full bg-[var(--pf-forest)] hover:bg-[var(--pf-forest-deep)] disabled:opacity-50 text-[var(--pf-cream)] text-xs font-semibold shadow-xs transition-colors">
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {loading ? 'Finding the moment…' : 'Find a Little Memory'}
            </button>
          </div>
        )}

        {step === 'review' && fields && (
          <div id="lm-review" className="px-4 py-4 space-y-3">
            <span id="lm-not-saved" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--pf-paper-2)] text-[#6A6A5A] border pf-hairline">
              Not saved yet
            </span>
            <label className="block">
              <span className="sr-only">Little Memory caption</span>
              <textarea id="lm-field-caption" value={fields.caption} onChange={(e) => setCaption(e.target.value)} rows={3}
                className="w-full rounded-2xl border pf-hairline bg-white/75 px-4 py-4 text-[15px] italic leading-relaxed text-[var(--pf-ink)] resize-none focus:outline-none focus:ring-2 focus:ring-[rgba(124,138,106,0.4)]"
                style={{ fontFamily: '"Playfair Display", Georgia, serif' }} />
            </label>

            <div id="lm-review-sources" className="rounded-xl bg-[var(--pf-paper-2)]/60 border pf-hairline px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[#8A8A78] mb-1">Grounded in your own records</p>
              <p className="text-[11px] text-[#5A5A4A]">Diary page: <span className="font-semibold">{draft?.source.diaryPage.title}</span> · {draft?.source.date}</p>
              {(draft?.source.seeds ?? []).map((s) => (
                <p key={s.id} className="text-[11px] text-[#5A5A4A]">Memory seed: “{s.text}”</p>
              ))}
            </div>

            {error && <p id="lm-error" className="text-xs text-[#8C3232]">{error}</p>}

            <div className="flex items-center gap-2 pt-1">
              <button id="lm-approve-btn" onClick={approve} disabled={saving}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-full bg-[var(--pf-forest)] hover:bg-[var(--pf-forest-deep)] disabled:opacity-50 text-[var(--pf-cream)] text-xs font-semibold shadow-xs transition-colors">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                Save Little Memory
              </button>
              <button id="lm-retry-btn" onClick={runDraft} disabled={loading || saving}
                className="px-3 py-2.5 rounded-full border pf-hairline text-xs font-semibold text-[var(--pf-ink)] hover:bg-[var(--pf-paper-2)]">
                {loading ? '…' : 'Try another'}
              </button>
              <button id="lm-decline-btn" onClick={onClose} className="px-3 py-2.5 rounded-full text-xs font-semibold text-[#7A7A6A] hover:text-[var(--pf-ink)]">Not now</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
