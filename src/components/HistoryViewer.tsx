import React, { useState, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  Search,
  Filter,
  Star,
  Trash2,
  ExternalLink,
  Copy,
  Check,
  Download,
  Calendar,
  MessageSquare,
  Sparkles,
  BookOpen,
  ArrowUpDown,
  Tag,
  AlertCircle,
} from 'lucide-react';
import { JournalInteraction, MoodType, ReflectionMode, FilterState } from '../types';
import { deleteInteraction, updateInteraction } from '../lib/firestore-service';
import { EMPTY_ART } from '../lib/brand';

interface HistoryViewerProps {
  userId: string;
  entries: JournalInteraction[];
  onSelectEntry: (entry: JournalInteraction) => void;
  onOpenModal: (entry: JournalInteraction) => void;
  onNewEntry: () => void;
}

const MOOD_EMOJIS: Record<MoodType, string> = {
  serene: '🌿',
  inspired: '✨',
  grateful: '🙏',
  thoughtful: '💡',
  anxious: '🌊',
  frustrated: '🔥',
  neutral: '⚖️',
};

export const HistoryViewer: React.FC<HistoryViewerProps> = ({
  userId,
  entries,
  onSelectEntry,
  onOpenModal,
  onNewEntry,
}) => {
  const [filterState, setFilterState] = useState<FilterState>({
    searchQuery: '',
    selectedMode: 'all',
    selectedMood: 'all',
    onlyFavorites: false,
    sortBy: 'newest',
  });

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Filtered & Sorted Entries
  const filteredEntries = useMemo(() => {
    return entries
      .filter((entry) => {
        // Search query
        if (filterState.searchQuery.trim()) {
          const q = filterState.searchQuery.toLowerCase();
          const matchTitle = entry.title?.toLowerCase().includes(q);
          const matchPrompt = entry.initialPrompt?.toLowerCase().includes(q);
          const matchOutput = entry.reflectionOutput?.toLowerCase().includes(q);
          const matchTags = entry.tags?.some((t) => t.toLowerCase().includes(q));
          if (!matchTitle && !matchPrompt && !matchOutput && !matchTags) {
            return false;
          }
        }

        // Mode filter
        if (filterState.selectedMode !== 'all' && entry.mode !== filterState.selectedMode) {
          return false;
        }

        // Mood filter
        if (filterState.selectedMood !== 'all' && entry.mood !== filterState.selectedMood) {
          return false;
        }

        // Favorites filter
        if (filterState.onlyFavorites && !entry.isFavorite) {
          return false;
        }

        return true;
      })
      .sort((a, b) => {
        if (filterState.sortBy === 'newest') {
          return (b.createdAt || 0) - (a.createdAt || 0);
        } else {
          return (a.createdAt || 0) - (b.createdAt || 0);
        }
      });
  }, [entries, filterState]);

  // Toggle Favorite
  const handleToggleFavorite = async (entry: JournalInteraction, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!entry.id) return;
    try {
      await updateInteraction(userId, entry.id, {
        isFavorite: !entry.isFavorite,
      });
    } catch (err) {
      console.error('Failed to toggle favorite:', err);
    }
  };

  // Delete Action
  const handleDeleteConfirm = async () => {
    if (!deleteTargetId) return;
    setIsDeleting(true);
    try {
      await deleteInteraction(userId, deleteTargetId);
      setDeleteTargetId(null);
    } catch (err) {
      console.error('Failed to delete interaction:', err);
    } finally {
      setIsDeleting(false);
    }
  };

  // Copy Content
  const handleCopyEntry = (entry: JournalInteraction, e: React.MouseEvent) => {
    e.stopPropagation();
    const formatted = `# ${entry.title || 'Journal entry'}
**Date:** ${new Date(entry.createdAt).toLocaleString()}
**Mood:** ${entry.mood} | **Mode:** ${entry.mode}
**Tags:** ${entry.tags?.join(', ') || 'none'}

## Initial Prompt
${entry.initialPrompt}

## Reflection
${entry.reflectionOutput}
`;
    navigator.clipboard.writeText(formatted);
    setCopiedId(entry.id || 'entry');
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Export all as JSON
  const handleExportJSON = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(entries, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `pocket-familiar-export-${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  // Export all as Markdown
  const handleExportMarkdown = () => {
    let mdContent = `# My Pocket Familiar journal\nExported: ${new Date().toLocaleString()}\n\n---\n\n`;
    entries.forEach((e, idx) => {
      mdContent += `## ${idx + 1}. ${e.title || 'Untitled Reflection'}\n`;
      mdContent += `*Date: ${new Date(e.createdAt).toLocaleString()} | Mood: ${e.mood} | Mode: ${e.mode}*\n\n`;
      mdContent += `### Prompt\n${e.initialPrompt}\n\n`;
      mdContent += `### Reflection\n${e.reflectionOutput}\n\n`;
      if (e.turns && e.turns.length > 2) {
        mdContent += `### Conversation History (${e.turns.length} turns)\n`;
        e.turns.forEach((t) => {
          mdContent += `**${t.role === 'user' ? 'You' : 'Your familiar'}**: ${t.content}\n\n`;
        });
      }
      mdContent += `---\n\n`;
    });

    const blob = new Blob([mdContent], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', url);
    downloadAnchor.setAttribute('download', `pocket-familiar-${Date.now()}.md`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
      {/* Top Controls: Search, Filters & Export */}
      <div className="bg-white rounded-2xl p-5 border border-[#E8E4D8] shadow-2xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-[#8A8A7A] absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              id="history-search-input"
              type="text"
              placeholder="Search your conversations, topics, tags, or reflections…"
              value={filterState.searchQuery}
              onChange={(e) => setFilterState({ ...filterState, searchQuery: e.target.value })}
              className="w-full pl-10 pr-4 py-2 text-xs sm:text-sm border border-[#E0DBCF] rounded-xl focus:outline-hidden focus:border-[#55604B] bg-[#FDFCF7] text-[#2D2D24]"
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              id="history-toggle-favorites-btn"
              onClick={() => setFilterState({ ...filterState, onlyFavorites: !filterState.onlyFavorites })}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-all ${
                filterState.onlyFavorites
                  ? 'bg-[#FAF3E0] text-[#7A5825] border-[#E8DAB2]'
                  : 'bg-white text-[#555546] border-[#E8E4D8] hover:bg-[#FAF8F2]'
              }`}
            >
              <Star className={`w-3.5 h-3.5 ${filterState.onlyFavorites ? 'fill-[#B88846] text-[#B88846]' : ''}`} />
              <span>Starred</span>
            </button>

            <button
              id="history-toggle-sort-btn"
              onClick={() =>
                setFilterState({
                  ...filterState,
                  sortBy: filterState.sortBy === 'newest' ? 'oldest' : 'newest',
                })
              }
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-white text-[#555546] border border-[#E8E4D8] hover:bg-[#FAF8F2] transition-all"
            >
              <ArrowUpDown className="w-3.5 h-3.5" />
              <span>{filterState.sortBy === 'newest' ? 'Newest First' : 'Oldest First'}</span>
            </button>

            {entries.length > 0 && (
              <div className="flex items-center gap-1 border-l border-[#E0DBCF] pl-2">
                <button
                  id="history-export-json-btn"
                  onClick={handleExportJSON}
                  title="Export all entries as JSON"
                  className="p-2 rounded-xl text-[#555546] hover:text-[#3E4A35] hover:bg-[#EDF2E8] border border-[#E8E4D8] text-xs font-medium transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                </button>
                <button
                  id="history-export-md-btn"
                  onClick={handleExportMarkdown}
                  title="Export all entries as Markdown (.md)"
                  className="px-2.5 py-1.5 rounded-xl text-[#555546] hover:text-[#3E4A35] hover:bg-[#EDF2E8] border border-[#E8E4D8] text-xs font-semibold transition-colors"
                >
                  Export .MD
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap items-center gap-2 pt-1 text-xs border-t border-[#E8E4D8]">
          <span className="font-bold text-[#7A7A6A] text-[11px] uppercase tracking-wider mr-1">Focus:</span>
          {[
            { id: 'all', label: 'All Lenses' },
            { id: 'deep_reflection', label: 'Deep Reflection' },
            { id: 'summary', label: 'Summary' },
            { id: 'brainstorm', label: 'Brainstorm' },
            { id: 'action_plan', label: 'Action Blueprint' },
            { id: 'mindful_chat', label: 'Mindful Chat' },
          ].map((modeItem) => (
            <button
              key={modeItem.id}
              onClick={() =>
                setFilterState({ ...filterState, selectedMode: modeItem.id as any })
              }
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                filterState.selectedMode === modeItem.id
                  ? 'bg-[#55604B] text-[#FDFCF7] shadow-2xs'
                  : 'bg-[#EFECE3] hover:bg-[#E4DFD2] text-[#555546]'
              }`}
            >
              {modeItem.label}
            </button>
          ))}
        </div>
      </div>

      {/* Entries List / Grid */}
      {filteredEntries.length === 0 ? (
        <div className="pf-paper-surface rounded-3xl p-10 border pf-hairline text-center space-y-4 shadow-2xs">
          <img
            src={EMPTY_ART.conversations}
            alt="Your familiar peeking into a blank open journal"
            className="w-40 h-auto mx-auto object-contain"
            decoding="async"
          />
          <h3 className="text-base font-bold text-[var(--pf-ink)]" style={{ fontFamily: '\"Playfair Display\", Georgia, serif' }}>
            {entries.length === 0 ? 'No conversations yet' : 'Nothing matches those filters'}
          </h3>
          <p className="text-xs text-[#7A7A6A] max-w-sm mx-auto leading-relaxed">
            {entries.length === 0
              ? 'When you write with your familiar, your conversations are kept here — private to you.'
              : 'Try clearing your search, or choosing a different focus or mood.'}
          </p>
          {entries.length === 0 && (
            <button
              id="history-empty-new-entry-btn"
              onClick={onNewEntry}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--pf-forest)] hover:bg-[var(--pf-forest-deep)] text-[var(--pf-cream)] text-xs font-semibold shadow-xs"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Start your first entry</span>
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredEntries.map((entry) => {
            const turnCount = entry.turns?.length || 1;
            const moodEmoji = MOOD_EMOJIS[entry.mood] || '💡';

            return (
              <div
                key={entry.id}
                id={`history-card-${entry.id}`}
                onClick={() => onOpenModal(entry)}
                className="group bg-white rounded-2xl p-5 border border-[#E8E4D8] hover:border-[#CBD6C3] hover:shadow-md transition-all cursor-pointer flex flex-col justify-between space-y-4 shadow-2xs"
              >
                {/* Header */}
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-base" title={`Mood: ${entry.mood}`}>
                        {moodEmoji}
                      </span>
                      <h4 className="font-bold text-[#2D2D24] text-sm group-hover:text-[#55604B] transition-colors line-clamp-1">
                        {entry.title || 'Untitled entry'}
                      </h4>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={(e) => handleToggleFavorite(entry, e)}
                        className="p-1 rounded-lg hover:bg-[#FAF8F2] text-[#8A8A7A] hover:text-[#B88846] transition-colors"
                        title={entry.isFavorite ? 'Remove star' : 'Star entry'}
                      >
                        <Star
                          className={`w-3.5 h-3.5 ${
                            entry.isFavorite ? 'fill-[#B88846] text-[#B88846]' : ''
                          }`}
                        />
                      </button>
                      <button
                        onClick={(e) => handleCopyEntry(entry, e)}
                        className="p-1 rounded-lg hover:bg-[#FAF8F2] text-[#8A8A7A] hover:text-[#55604B] transition-colors"
                        title="Copy entry markdown"
                      >
                        {copiedId === entry.id ? (
                          <Check className="w-3.5 h-3.5 text-[#55604B]" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteTargetId(entry.id || null);
                        }}
                        className="p-1 rounded-lg hover:bg-[#FBEFEF] text-[#8A8A7A] hover:text-[#8C3232] transition-colors"
                        title="Delete entry"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Metadata line */}
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#7A7A6A]">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5 text-[#8A8A7A]" />
                      {new Date(entry.createdAt).toLocaleDateString([], {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </span>
                    <span>&bull;</span>
                    <span className="px-1.5 py-0.5 rounded bg-[#EFECE3] text-[#4A4A3A] font-medium capitalize">
                      {entry.mode.replace('_', ' ')}
                    </span>
                    <span>&bull;</span>
                    <span className="flex items-center gap-1 text-[#555546]">
                      <MessageSquare className="w-3 h-3 text-[#55604B]" />
                      {turnCount} {turnCount === 1 ? 'turn' : 'turns'}
                    </span>
                  </div>
                </div>

                {/* Prompt & Reflection Preview Snippet */}
                <div className="space-y-2 bg-[#FAF8F2] p-3 rounded-xl border border-[#E8E4D8] text-xs">
                  <p className="text-[#38382E] font-medium line-clamp-2 italic">
                    "{entry.initialPrompt}"
                  </p>
                  <div className="text-[#555546] line-clamp-3 text-[11px] prose prose-xs max-w-none">
                    <ReactMarkdown>{entry.reflectionOutput}</ReactMarkdown>
                  </div>
                </div>

                {/* Footer: Tags and Action Button */}
                <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#E8E4D8] text-xs">
                  <div className="flex flex-wrap gap-1 items-center">
                    {entry.tags?.slice(0, 3).map((t) => (
                      <span
                        key={t}
                        className="px-1.5 py-0.5 rounded text-[10px] bg-[#EFECE3] text-[#555546] font-mono"
                      >
                        #{t}
                      </span>
                    ))}
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectEntry(entry);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#EDF2E8] hover:bg-[#E0E8DA] text-[#3E4A35] text-xs font-semibold transition-colors"
                  >
                    <span>Open in Today</span>
                    <ExternalLink className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTargetId && (
        <div className="fixed inset-0 z-50 bg-[#242A1E]/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-xl border border-[#E8E4D8] space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center gap-3 text-[#8C3232]">
              <div className="p-2 rounded-xl bg-[#FBEFEF]">
                <AlertCircle className="w-5 h-5" />
              </div>
              <h4 className="font-bold text-[#2D2D24] text-base">Delete this conversation?</h4>
            </div>
            <p className="text-xs text-[#666656] leading-relaxed">
              This conversation will be permanently removed from your journal. This can’t be undone.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setDeleteTargetId(null)}
                disabled={isDeleting}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold text-[#555546] hover:bg-[#FAF8F2] transition-colors"
              >
                Cancel
              </button>
              <button
                id="history-confirm-delete-btn"
                onClick={handleDeleteConfirm}
                disabled={isDeleting}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-[#8C3232] hover:bg-[#722727] text-white shadow-xs transition-colors"
              >
                {isDeleting ? 'Deleting...' : 'Delete Permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
