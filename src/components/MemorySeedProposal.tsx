import React, { useEffect, useState } from 'react';
import { SeedProposal } from '../lib/memory-seed-flow';
import { FAMILIAR_HEAD } from '../lib/brand';
import { Loader2, Sprout, X } from 'lucide-react';

/**
 * PF-CORE-01: the Memory Seed proposal surface. A model-proposed seed shown for
 * review — NOT remembered until the user approves it. The user may edit the
 * seed text, approve, decline or cancel. Declining/cancelling changes nothing
 * (no writer runs). The source excerpt and date are the SERVER-verified values
 * and are read-only here.
 */

interface Props {
  /** Fetches the not-yet-durable proposal (server-verified). Retryable. */
  requestProposal: () => Promise<SeedProposal>;
  sourcePageTitle: string;
  /** Persists the approved seed. Resolves when durable; rejects to show an error. */
  onApprove: (editedText: string, proposal: SeedProposal) => Promise<void>;
  /** Decline or cancel — must leave the source page and conversation unchanged. */
  onClose: () => void;
}

export const MemorySeedProposal: React.FC<Props> = ({ requestProposal, sourcePageTitle, onApprove, onClose }) => {
  const [proposal, setProposal] = useState<SeedProposal | null>(null);
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const p = await requestProposal();
      setProposal(p);
      setText(p.text);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'A memory suggestion is unavailable right now.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const approve = async () => {
    if (!proposal || !text.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onApprove(text.trim(), proposal);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remember that yet — nothing was saved. You can retry.');
      setSaving(false);
    }
  };

  return (
    <div
      id="memory-seed-proposal"
      role="dialog"
      aria-modal="true"
      aria-label="A memory to keep?"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[rgba(20,28,43,0.45)] backdrop-blur-sm p-0 sm:p-4"
    >
      <div className="w-full sm:max-w-md bg-[var(--pf-paper)] rounded-t-3xl sm:rounded-3xl border pf-hairline shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b pf-hairline">
          <div className="flex items-center gap-2 min-w-0">
            <Sprout className="w-4 h-4 text-[var(--pf-forest)] shrink-0" />
            <span className="text-sm font-semibold text-[var(--pf-ink)] truncate">A memory to keep?</span>
          </div>
          <button
            id="memory-seed-cancel-btn"
            onClick={onClose}
            aria-label="Cancel — nothing is saved"
            title="Cancel — nothing is saved"
            className="p-1.5 rounded-lg text-[#7A7A6A] hover:text-[var(--pf-ink)] hover:bg-[var(--pf-paper-2)]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 py-4 space-y-3">
          <div className="flex items-start gap-2.5">
            <img src={FAMILIAR_HEAD.ready} alt="" aria-hidden="true" className="w-9 h-9 object-contain shrink-0 mt-0.5" draggable={false} />
            <p className="text-xs text-[#6A6A5A] leading-relaxed">
              From your page <span className="font-semibold text-[var(--pf-ink)]">“{sourcePageTitle}”</span>, your familiar
              offers one sentence to remember. Nothing is kept until you approve it.
            </p>
          </div>

          {loading && (
            <div id="memory-seed-loading" className="flex items-center gap-2 text-xs text-[#5A6650] py-8 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> Looking for something worth keeping…
            </div>
          )}

          {!loading && error && !proposal && (
            <div className="rounded-xl bg-[#FBEFEF] border border-[#E7C9C9] px-3 py-2.5 text-xs text-[#8C3232] flex items-center justify-between gap-2">
              <span className="min-w-0">{error}</span>
              <button
                id="memory-seed-retry-btn"
                onClick={load}
                className="px-2.5 py-1 rounded-md bg-[#8C3232] hover:bg-[#722727] text-white font-semibold text-xs shrink-0"
              >
                Retry
              </button>
            </div>
          )}

          {proposal && (
            <>
              <div className="flex items-center gap-2">
                <span
                  id="memory-seed-not-saved"
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--pf-paper-2)] text-[#6A6A5A] border pf-hairline"
                >
                  Not remembered yet
                </span>
                {editing && <span className="text-[10px] text-[#8A8A78]">Editing your words</span>}
              </div>

              {editing ? (
                <textarea
                  id="memory-seed-text-input"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={3}
                  maxLength={280}
                  className="w-full rounded-xl border pf-hairline bg-white px-3 py-2 text-sm text-[var(--pf-ink)] resize-none focus:outline-none focus:ring-2 focus:ring-[rgba(124,138,106,0.4)]"
                />
              ) : (
                <p id="memory-seed-text" className="text-base text-[var(--pf-ink)] italic leading-relaxed rounded-2xl bg-white/70 border pf-hairline px-4 py-3.5" style={{ fontFamily: '"Playfair Display", Georgia, serif' }}>
                  “{text}”
                </p>
              )}

              <div className="rounded-xl bg-[var(--pf-paper-2)]/60 border pf-hairline px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[#8A8A78] mb-1">
                  From your page · {proposal.sourceDate}
                </p>
                <p id="memory-seed-source-excerpt" className="text-xs text-[#5A5A4A] italic leading-relaxed line-clamp-4">
                  “{proposal.sourceExcerpt}”
                </p>
              </div>

              {error && (
                <p className="text-xs text-[#8C3232]">{error}</p>
              )}

              <div className="flex items-center gap-2 pt-1">
                <button
                  id="memory-seed-approve-btn"
                  onClick={approve}
                  disabled={saving || !text.trim()}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-full bg-[var(--pf-forest)] hover:bg-[var(--pf-forest-deep)] disabled:opacity-50 text-[var(--pf-cream)] text-xs font-semibold shadow-xs transition-colors"
                >
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sprout className="w-3.5 h-3.5" />}
                  Remember this
                </button>
                <button
                  id="memory-seed-edit-btn"
                  onClick={() => setEditing((v) => !v)}
                  className="px-3 py-2 rounded-full border pf-hairline text-xs font-semibold text-[var(--pf-ink)] hover:bg-[var(--pf-paper-2)]"
                >
                  {editing ? 'Done' : 'Edit'}
                </button>
                <button
                  id="memory-seed-decline-btn"
                  onClick={onClose}
                  className="px-3 py-2 rounded-full text-xs font-semibold text-[#7A7A6A] hover:text-[var(--pf-ink)]"
                >
                  Not now
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
