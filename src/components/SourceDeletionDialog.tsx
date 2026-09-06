import React, { useState } from 'react';
import { AlertTriangle, Trash2, Archive, X, Loader2 } from 'lucide-react';

/** What the confirmation shows per affected memory (from the server preview). */
export interface AffectedSeed {
  seedId: string;
  text: string;
}

/**
 * PF-02.1 deletion policy: deleting a source Diary Page previews its affected
 * descendants (Memory Seeds) and asks the user to choose — never silently
 * retain, never silently cascade. "Keep" flips the typed ref to `unavailable`;
 * no hidden raw source exists, so nothing is resurrected or lost.
 */

interface Props {
  pageTitle: string;
  /** Server-authoritative affected descendants (from /api/source/preview). */
  affectedSeeds: AffectedSeed[];
  /** True while the server preview is loading. */
  loading?: boolean;
  /** Set when the plan changed since preview and the user must re-review. */
  conflictNotice?: string | null;
  onDeleteWithDescendants: () => Promise<void>;
  onKeepMarkedUnavailable: () => Promise<void>;
  onCancel: () => void;
}

export const SourceDeletionDialog: React.FC<Props> = ({
  pageTitle,
  affectedSeeds,
  loading = false,
  conflictNotice = null,
  onDeleteWithDescendants,
  onKeepMarkedUnavailable,
  onCancel,
}) => {
  const [busy, setBusy] = useState<null | 'delete' | 'keep'>(null);
  const [error, setError] = useState<string | null>(null);
  const hasDescendants = affectedSeeds.length > 0;

  const run = async (which: 'delete' | 'keep', fn: () => Promise<void>) => {
    setBusy(which);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not go through. Nothing was changed; you can try again.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      id="source-deletion-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="Delete this page?"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[rgba(20,28,43,0.45)] backdrop-blur-sm p-0 sm:p-4"
    >
      <div className="w-full sm:max-w-md bg-[var(--pf-paper)] rounded-t-3xl sm:rounded-3xl border pf-hairline shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b pf-hairline">
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="w-4 h-4 text-[#8C6527] shrink-0" />
            <span className="text-sm font-semibold text-[var(--pf-ink)] truncate">Delete “{pageTitle}”?</span>
          </div>
          <button
            id="source-deletion-cancel-x"
            onClick={onCancel}
            aria-label="Cancel"
            className="p-1.5 rounded-lg text-[#7A7A6A] hover:text-[var(--pf-ink)] hover:bg-[var(--pf-paper-2)]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 py-4 space-y-3">
          {conflictNotice && (
            <p id="source-deletion-conflict" role="alert" className="rounded-xl bg-[#FAF4E8] border border-[#EADBBA] px-3 py-2 text-xs text-[#8C6527]">
              {conflictNotice}
            </p>
          )}

          {loading ? (
            <p id="source-deletion-loading" className="text-xs text-[#6A6A5A] py-4 text-center">Checking what this affects…</p>
          ) : hasDescendants ? (
            <>
              <p className="text-xs text-[#5A5A4A]">
                This page is the source of{' '}
                <span className="font-semibold text-[var(--pf-ink)]">
                  {affectedSeeds.length} memor{affectedSeeds.length === 1 ? 'y' : 'ies'}
                </span>{' '}
                your familiar holds. Choose what happens to them — nothing is decided for you.
              </p>
              <ul id="source-deletion-affected" className="space-y-1.5 max-h-40 overflow-y-auto">
                {affectedSeeds.map((s) => (
                  <li
                    key={s.seedId}
                    data-affected-seed-id={s.seedId}
                    className="text-xs text-[var(--pf-ink)] rounded-lg bg-white/70 border pf-hairline px-3 py-2"
                  >
                    {s.text}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-xs text-[#5A5A4A]">
              No kept memories depend on this page. Deleting it removes only the page.
            </p>
          )}

          {error && (
            <p id="source-deletion-error" role="alert" className="text-xs text-[#8C3232]">{error}</p>
          )}

          <div className="space-y-2 pt-1">
            {hasDescendants && (
              <button
                id="source-deletion-keep-btn"
                onClick={() => run('keep', onKeepMarkedUnavailable)}
                disabled={busy !== null || loading}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-full bg-[var(--pf-forest)] hover:bg-[var(--pf-forest-deep)] disabled:opacity-50 text-[var(--pf-cream)] text-xs font-semibold"
              >
                {busy === 'keep' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Archive className="w-3.5 h-3.5" />}
                Delete page, keep the memories (marked “source unavailable”)
              </button>
            )}
            <button
              id="source-deletion-delete-btn"
              onClick={() => run('delete', onDeleteWithDescendants)}
              disabled={busy !== null || loading}
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-full border border-[#E7C9C9] bg-[#FBEFEF] hover:bg-[#F6E3E3] disabled:opacity-50 text-[#8C3232] text-xs font-semibold"
            >
              {busy === 'delete' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              {hasDescendants ? 'Delete page and these memories' : 'Delete this page'}
            </button>
            <button
              id="source-deletion-cancel-btn"
              onClick={onCancel}
              disabled={busy !== null || loading}
              className="w-full px-3 py-2 rounded-full text-xs font-semibold text-[#7A7A6A] hover:text-[var(--pf-ink)]"
            >
              Cancel — keep everything
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
