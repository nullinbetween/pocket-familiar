import React from 'react';
import { BookHeart, Link2, Link2Off, NotebookPen } from 'lucide-react';
import { DiaryPage } from '../types';
import { EMPTY_ART } from '../lib/brand';

/**
 * PF-01: confirmed Diary Pages — a clearly separate artefact class.
 * Cards are visually and semantically distinct from conversation cards:
 * every card carries the "Diary Page" badge, provenance, and AI-assisted flag.
 */

interface Props {
  pages: DiaryPage[];
  isSourceAvailable: (interactionId: string) => boolean;
  onOpenSource: (interactionId: string) => void;
}

export const DiaryPagesView: React.FC<Props> = ({ pages, isSourceAvailable, onOpenSource }) => {
  if (pages.length === 0) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-14 text-center space-y-4">
        <img
          src={EMPTY_ART.diary}
          alt="Your familiar beside a closed linen diary with a pressed leaf"
          className="w-44 h-auto mx-auto object-contain"
          decoding="async"
        />
        <h2 className="text-base font-bold text-[var(--pf-ink)]" style={{ fontFamily: '\"Playfair Display\", Georgia, serif' }}>No diary pages yet</h2>
        <p className="text-xs text-[#7A7A6A] max-w-sm mx-auto leading-relaxed">
          When a conversation feels finished, your familiar can press it into a page.
          Only what you approve is kept here.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-4">
      {pages.map((page) => {
        const sourceOk = isSourceAvailable(page.sourceInteractionId);
        return (
          <article
            key={page.id}
            id={`diary-page-${page.id}`}
            className="rounded-2xl border border-[#E8DAB2] bg-[#FDFBF3] p-5 shadow-2xs space-y-3"
          >
            <header className="flex items-start justify-between gap-3">
              <div>
                <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded bg-[#FAF3E0] text-[#7A5825] border border-[#E8DAB2]">
                  <NotebookPen className="w-3 h-3" />
                  Diary Page
                </span>
                <h3 className="mt-1.5 text-sm font-bold text-[#2D2D24]">{page.title}</h3>
              </div>
              <time className="text-xs text-[#7A7A6A] font-mono shrink-0">{page.date}</time>
            </header>

            <p className="text-xs text-[#38382E] leading-relaxed whitespace-pre-wrap">
              {page.todayInMyWords}
            </p>

            {page.whatFeltImportant.length > 0 && (
              <div className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-wide text-[#7A5825]">
                  What felt important
                </span>
                <ul className="space-y-1">
                  {page.whatFeltImportant.map((item, i) => (
                    <li key={i} className="text-xs text-[#4A4A3A] flex gap-1.5">
                      <span className="text-[#B99C5A]">✦</span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {page.carryForward && (
              <p className="text-xs text-[#5A6650] italic border-l-2 border-[#CBD6C3] pl-2">
                Carry forward: {page.carryForward}
              </p>
            )}

            <footer className="flex flex-wrap items-center gap-2 pt-1 border-t border-[#EFE6D0] text-[10px] text-[#8A8471]">
              <span className="px-1.5 py-0.5 rounded bg-[#F2EFE9] border border-[#E0DBCF]">
                Drafted with your familiar · kept by you{page.editedByUser ? ' · edited' : ''}
              </span>
              {sourceOk ? (
                <button
                  id={`diary-open-source-${page.id}`}
                  onClick={() => onOpenSource(page.sourceInteractionId)}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#EDF2E8] border border-[#CBD6C3] text-[#3E4A35] hover:bg-[#E2EBDA] font-semibold"
                >
                  <Link2 className="w-3 h-3" />
                  View source conversation
                </button>
              ) : (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#F2EFE9] border border-[#E0DBCF]">
                  <Link2Off className="w-3 h-3" />
                  Source conversation no longer available
                </span>
              )}
              <span className="ml-auto">
                confirmed {new Date(page.confirmedAt).toLocaleDateString()}
              </span>
            </footer>
          </article>
        );
      })}
    </div>
  );
};
