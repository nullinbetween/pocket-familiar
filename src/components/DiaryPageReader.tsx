import React, { useEffect, useRef } from 'react';
import { X, Link2, Link2Off } from 'lucide-react';
import { DiaryPage } from '../types';
import { PROVENANCE } from '../lib/brand';

/**
 * Full, keyboard-accessible reader for a saved Diary Page. Shows EVERY saved
 * field and its provenance, and works even when the source conversation is no
 * longer available. Opening the saved page is kept separate from navigating to
 * the source conversation (a conversation is not the edited diary). Presentation
 * only — no reads or writes.
 */
export const DiaryPageReader: React.FC<{
  page: DiaryPage;
  sourceAvailable: boolean;
  onOpenSource?: (interactionId: string) => void;
  onClose: () => void;
}> = ({ page, sourceAvailable, onOpenSource, onClose }) => {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus(); }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div className="absolute inset-0 bg-[#10151F]/60 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />
      <div id="diary-page-reader" role="dialog" aria-modal="true" aria-label={`Diary page: ${page.title}`}
        className="relative w-full sm:max-w-md pf-paper-surface border pf-hairline rounded-t-[26px] sm:rounded-[26px] shadow-2xl max-h-[92vh] overflow-y-auto">
        <button id="diary-page-reader-close" ref={closeRef} onClick={onClose} aria-label="Close"
          className="absolute top-3 right-3 p-1.5 rounded-lg text-[#7A7A6A] hover:bg-black/5"><X className="w-4 h-4" /></button>

        <div className="px-6 pt-7 pb-6 space-y-4">
          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded bg-[#FAF3E0] text-[#7A5825] border border-[#E8DAB2]">
            Diary Page
          </span>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-xl font-bold text-[var(--pf-ink)]" style={{ fontFamily: '"Playfair Display", Georgia, serif' }}>{page.title}</h2>
            <time className="text-xs text-[#8A8471] font-mono shrink-0">{page.date}</time>
          </div>

          <div>
            <span className="text-[11px] font-bold text-[#7A5825] uppercase tracking-wide">Today, in my words</span>
            <p id="diary-reader-prose" className="mt-1 text-sm text-[#38382E] leading-relaxed whitespace-pre-wrap">{page.todayInMyWords}</p>
          </div>

          {page.whatFeltImportant.length > 0 && (
            <div>
              <span className="text-[11px] font-bold text-[#7A5825] uppercase tracking-wide">What felt important</span>
              <ul id="diary-reader-important" className="mt-1 space-y-1">
                {page.whatFeltImportant.map((item, i) => (
                  <li key={i} className="text-sm text-[#4A4A3A] flex gap-1.5"><span className="text-[#B99C5A]">✦</span><span>{item}</span></li>
                ))}
              </ul>
            </div>
          )}

          {page.carryForward && (
            <div>
              <span className="text-[11px] font-bold text-[#7A5825] uppercase tracking-wide">Carry forward</span>
              <p className="mt-1 text-sm text-[#5A6650] italic border-l-2 border-[#CBD6C3] pl-2">{page.carryForward}</p>
            </div>
          )}

          <footer className="pt-3 border-t pf-hairline space-y-2 text-[11px] text-[#8A8471]">
            <p className="font-semibold text-[var(--pf-forest-deep)]">
              {PROVENANCE.story.source} · AI-assisted draft · approved by you{page.editedByUser ? ' · edited' : ''}
            </p>
            {sourceAvailable ? (
              <button id="diary-open-source-btn" onClick={() => onOpenSource?.(page.sourceInteractionId)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-white/70 border pf-hairline text-[var(--pf-forest-deep)] hover:bg-white font-semibold">
                <Link2 className="w-3 h-3" /> Go to source conversation
              </button>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-white/60 border pf-hairline">
                <Link2Off className="w-3 h-3" /> Source conversation no longer available — this page is still kept in full
              </span>
            )}
          </footer>
        </div>
      </div>
    </div>
  );
};
