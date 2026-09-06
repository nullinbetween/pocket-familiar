import React, { useState } from 'react';
import { AlertTriangle, Trash2, X, Loader2 } from 'lucide-react';

/**
 * PF-CORE-03A P0-2: deleting a Memory Seed previews the Little Memories that
 * reference it and states the honest outcome: the seed is removed and each of
 * those Little Memories is KEPT, with only its reference to this seed marked
 * "source unavailable". No Little Memory is ever deleted. The confirm is
 * server-authoritative and stale-safe (it carries the previewed plan version;
 * a changed plan returns here as a conflict notice for re-review).
 */

interface Props {
  /** A short label for the seed being deleted. */
  seedText: string;
  affectedLittleMemories: Array<{ littleMemoryId: string; title: string }>;
  loading?: boolean;
  conflictNotice?: string | null;
  onConfirmDelete: () => Promise<void>;
  onCancel: () => void;
}

export const SeedDeletionDialog: React.FC<Props> = ({
  seedText, affectedLittleMemories, loading = false, conflictNotice = null, onConfirmDelete, onCancel,
}) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const affected = affectedLittleMemories.length;

  const run = async () => {
    setBusy(true); setError(null);
    try { await onConfirmDelete(); }
    catch (err) { setError(err instanceof Error ? err.message : 'That did not go through. Nothing was changed; you can try again.'); }
    finally { setBusy(false); }
  };

  return (
    <div id="seed-deletion-dialog" role="dialog" aria-modal="true" aria-label="Delete this memory seed?"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[rgba(20,28,43,0.45)] backdrop-blur-sm p-0 sm:p-4">
      <div className="w-full sm:max-w-md bg-[var(--pf-paper)] rounded-t-3xl sm:rounded-3xl border pf-hairline shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b pf-hairline">
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="w-4 h-4 text-[#8C6527] shrink-0" />
            <span className="text-sm font-semibold text-[var(--pf-ink)] truncate">Delete this memory?</span>
          </div>
          <button id="seed-deletion-cancel-x" onClick={onCancel} aria-label="Cancel"
            className="p-1.5 rounded-lg text-[#7A7A6A] hover:text-[var(--pf-ink)] hover:bg-[var(--pf-paper-2)]"><X className="w-4 h-4" /></button>
        </div>

        <div className="px-4 py-4 space-y-3">
          <p className="text-xs text-[#5A5A4A] italic rounded-lg bg-white/70 border pf-hairline px-3 py-2">“{seedText}”</p>

          {conflictNotice && (
            <p id="seed-deletion-conflict" role="alert" className="rounded-xl bg-[#FAF4E8] border border-[#EADBBA] px-3 py-2 text-xs text-[#8C6527]">{conflictNotice}</p>
          )}

          {loading ? (
            <p id="seed-deletion-loading" className="text-xs text-[#6A6A5A] py-4 text-center">Checking what this affects…</p>
          ) : affected > 0 ? (
            <>
              <p className="text-xs text-[#5A5A4A]">
                This memory is a source for{' '}
                <span className="font-semibold text-[var(--pf-ink)]">{affected} Little Memor{affected === 1 ? 'y' : 'ies'}</span>.
                They will be kept — only their link to this memory becomes “source unavailable”.
              </p>
              <ul id="seed-deletion-affected" className="space-y-1.5 max-h-40 overflow-y-auto">
                {affectedLittleMemories.map((l) => (
                  <li key={l.littleMemoryId} data-affected-lm-id={l.littleMemoryId}
                    className="text-xs text-[var(--pf-ink)] rounded-lg bg-white/70 border pf-hairline px-3 py-2">{l.title}</li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-xs text-[#5A5A4A]">No Little Memories depend on this memory. Deleting it removes only the memory.</p>
          )}

          {error && <p id="seed-deletion-error" role="alert" className="text-xs text-[#8C3232]">{error}</p>}

          <div className="space-y-2 pt-1">
            <button id="seed-deletion-delete-btn" onClick={run} disabled={busy || loading}
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-full border border-[#E7C9C9] bg-[#FBEFEF] hover:bg-[#F6E3E3] disabled:opacity-50 text-[#8C3232] text-xs font-semibold">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              {affected > 0 ? 'Delete memory, keep the Little Memories' : 'Delete this memory'}
            </button>
            <button id="seed-deletion-cancel-btn" onClick={onCancel} disabled={busy || loading}
              className="w-full px-3 py-2 rounded-full text-xs font-semibold text-[#7A7A6A] hover:text-[var(--pf-ink)]">Cancel — keep everything</button>
          </div>
        </div>
      </div>
    </div>
  );
};
