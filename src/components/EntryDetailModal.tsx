import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  X,
  Calendar,
  Sparkles,
  Copy,
  Check,
  Send,
  Loader2,
  ExternalLink,
  MessageSquare,
  User,
  Star,
  Brain,
} from 'lucide-react';
import { JournalInteraction } from '../types';
import { submitEntry } from '../lib/reflection-flow';
import { createReflectionFlowDeps } from '../lib/reflection-deps';

interface EntryDetailModalProps {
  userId: string;
  entry: JournalInteraction | null;
  onClose: () => void;
  onResumeInWorkspace: (entry: JournalInteraction) => void;
  onEntryUpdated: (updated: JournalInteraction) => void;
}

export const EntryDetailModal: React.FC<EntryDetailModalProps> = ({
  userId,
  entry,
  onClose,
  onResumeInWorkspace,
  onEntryUpdated,
}) => {
  if (!entry) return null;

  const closeRef = useRef<HTMLButtonElement>(null);
  const [followUpPrompt, setFollowUpPrompt] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleSendFollowUp = async () => {
    if (!followUpPrompt.trim() || isSending || !entry.id) return;
    setErrorMsg(null);
    setIsSending(true);

    const promptText = followUpPrompt.trim();

    try {
      // Gate B/C: the SAME authenticated, raw-save-first continuation the full
      // workspace uses (src/lib/reflection-deps.ts + reflection-flow.ts).
      // The user's new turn is persisted BEFORE generation, every
      // /api/gemini/reflect call carries a fresh Firebase ID token, and a
      // provider failure keeps the saved turn retryable instead of erasing it.
      const outcome = await submitEntry(createReflectionFlowDeps(userId), {
        userId,
        userEmail: entry.userEmail,
        title: entry.title,
        mood: entry.mood || 'thoughtful',
        mode: entry.mode || 'mindful_chat',
        tags: entry.tags ?? [],
        promptText,
        existing: entry,
      });

      if (outcome.phase === 'save_failed') {
        // Nothing persisted this round — keep the composer text so it is not lost.
        setErrorMsg(
          outcome.error || 'Could not save your reply. Nothing was lost — please try again.'
        );
        return;
      }

      // Raw turn is durable from here on; safe to clear the composer.
      onEntryUpdated(outcome.entry);
      setFollowUpPrompt('');

      if (outcome.phase === 'saved_generation_failed') {
        setErrorMsg(
          outcome.error ||
            'Your reply was saved, but the companion response is unavailable. ' +
              'Open it in the full workspace to retry.'
        );
      }
    } catch (err: any) {
      console.error('Follow-up error:', err);
      setErrorMsg(err.message || 'Failed to submit follow-up.');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div id="entry-detail-backdrop" className="fixed inset-0 z-50 bg-[#242A1E]/50 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 overflow-y-auto"
      onClick={onClose}>
      <div
        id="entry-detail-modal-container"
        role="dialog"
        aria-modal="true"
        aria-label={`Conversation: ${entry.title || 'Untitled Reflection'}`}
        onClick={(event) => event.stopPropagation()}
        className="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] shadow-2xl border border-[#E8E4D8] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150"
      >
        {/* Modal Header */}
        <div className="relative p-4 pr-14 sm:p-5 sm:pr-14 border-b border-[#E8E4D8] flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 bg-[#FDFCF7]">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold uppercase tracking-wider bg-[#EDF2E8] text-[#3E4A35] border border-[#CBD6C3]">
                {entry.mode.replace('_', ' ')}
              </span>
              <span className="text-xs text-[#7A7A6A] font-medium capitalize">
                Mood: {entry.mood}
              </span>
            </div>
            <h3 className="text-lg font-bold text-[#2D2D24] leading-tight">
              {entry.title || 'Untitled Reflection'}
            </h3>
            <div className="flex items-center gap-2 text-xs text-[#7A7A6A]">
              <Calendar className="w-3.5 h-3.5 text-[#8A8A7A]" />
              <span>Created {new Date(entry.createdAt).toLocaleString()}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => {
                onResumeInWorkspace(entry);
                onClose();
              }}
              className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded-lg bg-[#55604B] hover:bg-[#434D3A] text-[#FDFCF7] text-xs font-semibold shadow-xs max-w-full"
            >
              <span className="truncate">Open in Full Workspace</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
            <button id="entry-detail-close" ref={closeRef}
              onClick={onClose}
              aria-label="Close conversation"
              className="absolute top-3 right-3 p-2 rounded-full text-[#6F6F61] bg-white/90 border border-[#E8E4D8] shadow-sm hover:text-[#2D2D24] hover:bg-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Scrollable Body: Full Dialogue History */}
        <div className="p-6 overflow-y-auto flex-1 space-y-5 bg-[#FAF8F2]">
          {entry.turns && entry.turns.length > 0 ? (
            entry.turns.map((turn, idx) => {
              const isUser = turn.role === 'user';
              return (
                <div
                  key={turn.id || idx}
                  className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}
                >
                  {!isUser && (
                    <div className="w-8 h-8 rounded-xl bg-[#56624C] text-[#FDFCF7] flex items-center justify-center shrink-0 shadow-xs mt-1">
                      <Sparkles className="w-4 h-4" />
                    </div>
                  )}

                  <div
                    className={`max-w-[88%] rounded-2xl p-4 shadow-2xs text-xs leading-relaxed ${
                      isUser
                        ? 'bg-[#2D3126] text-[#FDFCF7] rounded-tr-xs'
                        : 'bg-white text-[#38382E] border border-[#E8E4D8] rounded-tl-xs'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3 mb-2 pb-1 border-b border-[#E8E4D8]/60">
                      <span className="font-bold text-[11px]">
                        {isUser ? 'You' : 'Your familiar'}
                      </span>
                      <div className="flex items-center gap-2 opacity-70 text-[10px]">
                        <span>{new Date(turn.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        <button
                          onClick={() => handleCopy(turn.content, turn.id)}
                          className="hover:opacity-100 p-0.5"
                          title="Copy turn"
                        >
                          {copiedId === turn.id ? (
                            <Check className="w-3 h-3 text-[#55604B]" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                        </button>
                      </div>
                    </div>

                    {isUser ? (
                      <p className="whitespace-pre-wrap">{turn.content}</p>
                    ) : (
                      <div className="markdown-body prose prose-xs max-w-none text-[#38382E]">
                        <ReactMarkdown>{turn.content}</ReactMarkdown>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="space-y-4">
              <div className="p-4 bg-[#2D3126] text-[#FDFCF7] rounded-2xl text-xs">
                <span className="font-bold text-[11px] block mb-1">You</span>
                <p className="whitespace-pre-wrap">{entry.initialPrompt}</p>
              </div>
              <div className="p-4 bg-white border border-[#E8E4D8] rounded-2xl text-xs">
                <span className="font-bold text-[11px] block mb-1 text-[#3E4A35]">Your familiar’s reflection</span>
                <div className="markdown-body prose prose-xs text-[#38382E]">
                  <ReactMarkdown>{entry.reflectionOutput}</ReactMarkdown>
                </div>
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="p-3 rounded-xl bg-[#FBEFEF] border border-[#ECC8C8] text-[#8C3232] text-xs">
              {errorMsg}
            </div>
          )}
        </div>

        {/* Modal Footer: Quick Follow-up Input */}
        <div className="p-4 border-t border-[#E8E4D8] bg-white space-y-2">
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Reply, or add another turn…"
              value={followUpPrompt}
              onChange={(e) => setFollowUpPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSendFollowUp();
                }
              }}
              className="flex-1 min-w-0 px-3 py-2 text-base sm:text-sm border border-[#E0DBCF] rounded-xl focus:outline-hidden focus:border-[#55604B] bg-[#FDFCF7] text-[#2D2D24]"
            />
            <button
              onClick={handleSendFollowUp}
              disabled={isSending || !followUpPrompt.trim()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#55604B] hover:bg-[#434D3A] text-[#FDFCF7] text-xs font-bold shadow-xs disabled:opacity-50"
            >
              {isSending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <span>Reply</span>
                  <Send className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
