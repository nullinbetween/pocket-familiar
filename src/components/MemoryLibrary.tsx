import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Search, Star, Trash2, ArrowUpDown, Download, AlertCircle, Leaf, MessageSquare, Sparkles, ChevronDown, ChevronRight, Pencil, RotateCcw, ArrowUpRight, X } from 'lucide-react';
import { JournalInteraction, MoodType, DiaryPage, ReflectionMode, MemorySeed, LittleMemory } from '../types';
import { deleteInteraction, updateInteraction } from '../lib/firestore-service';
import { MEMORY_COPY, MEMORY_COLUMNS } from '../lib/brand';
import { filterConversations, filterPages, projectionBody } from '../lib/memory-views';
import {
  projectAll, searchMemory, groupByKind, dayLabel,
  MemoryScope, SeedStatusFilter, MemoryRecord,
} from '../lib/memory-room';
import { serializeMemoryRoomJson, buildMemoryRoomMarkdown } from '../lib/memory-export';
import { DiaryPageReader } from './DiaryPageReader';

/**
 * Memory library — three continuous provenance columns shown side by side at
 * every width (owner direction): From my story (kept diary pages), You told me
 * (the user's own words), What I thought (the familiar's reflections). Each
 * column owns a continuous tone + a decorative accepted-art scene; paper notes
 * stack inside. Cards are short previews that open the full page/conversation —
 * never shrink-to-cram. These are PRESENTATION projections of existing saved
 * data; no new memory mechanism. Search / sort / mode filter / starred / export
 * / delete stay functional but secondary and correctly scoped.
 */

interface Props {
  userId: string;
  entries: JournalInteraction[];
  diaryPages: DiaryPage[];
  memorySeeds?: MemorySeed[];
  littleMemories?: LittleMemory[];
  onOpenLittleMemory?: (lm: LittleMemory) => void;
  onSelectEntry: (entry: JournalInteraction) => void;
  onOpenModal: (entry: JournalInteraction) => void;
  onNewEntry: () => void;
  isSourceAvailable: (interactionId: string) => boolean;
  onOpenSource: (interactionId: string) => void;
  /** Server-routed seed operations (reused from the Familiar route; no direct writes). */
  onSeedEdit?: (seed: MemorySeed, text: string) => Promise<void>;
  onSeedRevoke?: (seed: MemorySeed) => Promise<void>;
  /** Opens the stale-safe seed-deletion review (server preview → confirm). */
  onSeedRequestDelete?: (seed: MemorySeed) => void;
  /** Local timezone for day/week grouping (defaults to the browser tz). */
  timeZone?: string;
}

const MOOD_EMOJIS: Record<MoodType, string> = {
  serene: '🌿', inspired: '✨', grateful: '🙏', thoughtful: '💡', anxious: '🌊', frustrated: '🔥', neutral: '⚖️',
};
const MODE_LABELS: Array<{ id: ReflectionMode | 'all'; label: string }> = [
  { id: 'all', label: 'All lenses' }, { id: 'deep_reflection', label: 'Reflect' }, { id: 'summary', label: 'Summarise' },
  { id: 'brainstorm', label: 'Explore' }, { id: 'action_plan', label: 'Plan' }, { id: 'mindful_chat', label: 'Talk' },
];
const COL_ICON = { story: Leaf, told: MessageSquare, thought: Sparkles } as const;
const MEMORY_COLUMN_INITIAL = 3;
const MEMORY_COLUMN_BATCH = 5;
const MEMORY_COLUMN_MAX = 25;

export function nextMemoryColumnVisibleCount(current: number, total: number): number {
  const cap = Math.min(total, MEMORY_COLUMN_MAX);
  if (current >= cap) return Math.min(MEMORY_COLUMN_INITIAL, total);
  return Math.min(current + MEMORY_COLUMN_BATCH, cap);
}

/**
 * Provenance detail reader for one Memory Seed. Shows the approved sentence, its
 * status, the verified source excerpt and a link to the exact source Diary Page
 * (Seed → Diary Page → Conversation). Every mutation is routed through the
 * server-backed handlers the parent supplies (edit / revoke / delete); revoking
 * or deleting a seed never touches its source page. Keyboard-accessible: initial
 * focus moves into the dialog, Tab/Shift+Tab are trapped inside it, and Escape /
 * overlay / Close all return focus to the exact element that opened it.
 */
const SeedDetailModal: React.FC<{
  seed: MemorySeed;
  sourceAvailable: boolean;
  busy: boolean;
  error: string | null;
  onOpenSource: () => void;
  onEdit: (text: string) => void;
  onRevoke: () => void;
  onDelete: () => void;
  onClose: () => void;
}> = ({ seed, sourceAvailable, busy, error, onOpenSource, onEdit, onRevoke, onDelete, onClose }) => {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(seed.text);
  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });
  useEffect(() => { setEditing(false); setText(seed.text); }, [seed]);

  // Real focus management (runs once for the lifetime of the open dialog):
  // capture the opener, move focus in, trap Tab/Shift+Tab, and restore focus to
  // the exact opener on any close path (Escape / overlay / Close button all
  // unmount this component).
  useEffect(() => {
    openerRef.current = (document.activeElement as HTMLElement) ?? null;
    const focusable = (): HTMLElement[] =>
      Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) ?? []).filter((el) => el.offsetParent !== null || el === document.activeElement);
    (focusable()[0] ?? dialogRef.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCloseRef.current(); return; }
      if (e.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) { e.preventDefault(); dialogRef.current?.focus(); return; }
      const first = items[0], last = items[items.length - 1];
      const active = document.activeElement as HTMLElement;
      const inside = dialogRef.current?.contains(active);
      if (e.shiftKey && (active === first || !inside)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (active === last || !inside)) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      openerRef.current?.focus?.();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-[#10151F]/60 backdrop-blur-[2px] flex items-center justify-center p-4" onClick={onClose}>
      <div ref={dialogRef} id="memory-seed-detail" role="dialog" aria-modal="true" aria-label="Memory seed detail" tabIndex={-1}
        className="bg-white rounded-2xl max-w-md w-full p-5 shadow-xl border pf-hairline space-y-4 max-h-[85vh] overflow-y-auto focus:outline-hidden"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="inline-flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[var(--pf-brass)]" />
            <h4 className="font-bold text-[var(--pf-ink)] text-base" style={{ fontFamily: '"Playfair Display", Georgia, serif' }}>Memory Seed</h4>
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${seed.status === 'active' ? 'bg-[#E7EFE0] text-[#3F5A31]' : 'bg-[#F1ECE0] text-[#8A7A55]'}`}>{seed.status === 'active' ? 'Active' : 'Released'}</span>
          </div>
          <button aria-label="Close" onClick={onClose} className="p-1 text-[#8A8A7A] hover:text-[var(--pf-ink)] rounded-lg hover:bg-[#F3F0E8]"><X className="w-4 h-4" /></button>
        </div>

        {editing ? (
          <textarea id="seed-detail-edit-input" value={text} onChange={(e) => setText(e.target.value)} rows={3} autoFocus
            className="w-full text-sm border border-[#E0DBCF] rounded-xl bg-white p-2.5 focus:outline-hidden focus:border-[var(--pf-forest)]" />
        ) : (
          <p className="text-sm text-[var(--pf-ink)] leading-relaxed">“{seed.text}”</p>
        )}

        <p className="text-[10px] text-[#8A8471]">Approved by you · held by Midnight{seed.editedByUser ? ' · edited' : ''} · from {seed.sourceDate}</p>

        {seed.sourceExcerpt && (
          <div className="rounded-xl bg-[#F7F4EC] border pf-hairline p-2.5">
            <p className="text-[9px] font-bold uppercase tracking-wide text-[#9A9482] mb-0.5">From your source page</p>
            <p className="text-[11px] text-[#5A5446] italic leading-snug">“{seed.sourceExcerpt}”</p>
          </div>
        )}

        <div>
          <button id="seed-detail-source-btn" onClick={onOpenSource} disabled={!sourceAvailable}
            className={`inline-flex items-center gap-1 text-[11px] font-semibold ${sourceAvailable ? 'text-[var(--pf-forest-deep)] hover:underline' : 'text-[#A8A491] cursor-not-allowed'}`}>
            <ArrowUpRight className="w-3.5 h-3.5" /> {sourceAvailable ? 'Open the source Diary Page' : 'Source page unavailable'}
          </button>
          {!sourceAvailable && <p className="text-[9px] text-[#9A5A3A] mt-0.5">The Diary Page this grew from is no longer here — this seed still stands on its own.</p>}
        </div>

        {error && <p id="seed-detail-error" className="text-[11px] text-[#8C3232]">{error}</p>}

        <div className="flex items-center gap-2 pt-1 border-t pf-hairline flex-wrap">
          {editing ? (
            <>
              <button id="seed-detail-save-btn" onClick={() => { onEdit(text); setEditing(false); }} disabled={busy || !text.trim()}
                className="px-3 py-1.5 rounded-xl text-[11px] font-semibold bg-[var(--pf-forest)] hover:bg-[var(--pf-forest-deep)] text-[var(--pf-cream)] disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button>
              <button onClick={() => { setEditing(false); setText(seed.text); }} disabled={busy} className="px-3 py-1.5 rounded-xl text-[11px] font-semibold text-[#555546] hover:bg-[#FAF8F2]">Cancel</button>
            </>
          ) : (
            <>
              {seed.status === 'active' && (
                <button id="seed-detail-edit-btn" onClick={() => setEditing(true)} disabled={busy}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold text-[#555546] border border-[#E8E4D8] hover:bg-[#FAF8F2]"><Pencil className="w-3 h-3" /> Edit</button>
              )}
              {seed.status === 'active' && (
                <button id="seed-detail-revoke-btn" onClick={onRevoke} disabled={busy}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold text-[#8A7A55] border border-[#E8DAB2] hover:bg-[#FAF3E0]"><RotateCcw className="w-3 h-3" /> Release (revoke)</button>
              )}
              {/* Delete opens the stale-safe seed-deletion review (server preview → confirm). */}
              <button id="seed-detail-delete-btn" onClick={onDelete} disabled={busy}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold text-[#8C3232] border border-[#E8C9C9] hover:bg-[#FBEFEF] ml-auto"><Trash2 className="w-3 h-3" /> Delete</button>
            </>
          )}
        </div>
        <p className="text-[9px] text-[#9A9482]">Releasing or deleting a seed never removes the Diary Page or Conversation it came from.</p>
      </div>
    </div>
  );
};

export const MemoryLibrary: React.FC<Props> = ({
  userId, entries, diaryPages, memorySeeds = [], littleMemories = [], onOpenLittleMemory, onSelectEntry, onOpenModal, onNewEntry, isSourceAvailable, onOpenSource,
  onSeedEdit, onSeedRevoke, onSeedRequestDelete, timeZone,
}) => {
  const tz = timeZone || (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC') || 'UTC';
  const [query, setQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [sortNewest, setSortNewest] = useState(true);
  const [modeFilter, setModeFilter] = useState<ReflectionMode | 'all'>('all');
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [readerPage, setReaderPage] = useState<DiaryPage | null>(null);
  // PF-CORE-02 Living Memory: cross-type search + seed archive detail.
  const [scope, setScope] = useState<MemoryScope>('all');
  const [seedStatus, setSeedStatus] = useState<SeedStatusFilter>('all');
  const [seedDetail, setSeedDetail] = useState<MemorySeed | null>(null);
  const [seedBusy, setSeedBusy] = useState(false);
  const [seedError, setSeedError] = useState<string | null>(null);
  const [visibleColumnCounts, setVisibleColumnCounts] = useState<Record<'story' | 'told' | 'thought', number>>({
    story: 3, told: 3, thought: 3,
  });

  const activeSeeds = useMemo(() => memorySeeds.filter((s) => s.status === 'active'), [memorySeeds]);
  const revokedSeeds = useMemo(() => memorySeeds.filter((s) => s.status === 'revoked'), [memorySeeds]);

  const searchActive = query.trim().length > 0 || scope !== 'all';
  const results = useMemo(() => {
    if (!searchActive) return [] as MemoryRecord[];
    const all = projectAll(entries, diaryPages, memorySeeds, littleMemories);
    return searchMemory(all, { text: query, scope, seedStatus });
  }, [searchActive, entries, diaryPages, memorySeeds, littleMemories, query, scope, seedStatus]);
  const resultGroups = useMemo(() => groupByKind(results), [results]);

  const KIND_LABEL: Record<string, string> = { diaryPage: 'From my story · Diary Pages', conversation: 'Conversations', memorySeed: 'Held by Midnight · Memory Seeds', littleMemory: 'Little Memories' };

  const runSeed = async (fn: (() => Promise<void>) | undefined, label: string) => {
    if (!fn) return;
    setSeedBusy(true); setSeedError(null);
    try { await fn(); }
    catch (err) { setSeedError(err instanceof Error ? err.message : `That ${label} did not go through. You can try again.`); }
    finally { setSeedBusy(false); }
  };
  const seedSourcePage = (seed: MemorySeed): DiaryPage | undefined => {
    const ref = seed.sourceRefs.find((r) => r.kind === 'diaryPage' && r.availability === 'available');
    return ref ? diaryPages.find((d) => d.id === ref.id) : undefined;
  };
  const openSeedSource = (seed: MemorySeed) => {
    const p = seedSourcePage(seed);
    if (p) { setSeedDetail(null); setReaderPage(p); }
  };

  const conversations = useMemo(
    () => filterConversations(entries, { query, mode: modeFilter, onlyFavorites, sortNewest }),
    [entries, query, modeFilter, onlyFavorites, sortNewest]
  );
  const pages = useMemo(() => filterPages(diaryPages, { query, sortNewest }), [diaryPages, query, sortNewest]);

  const toggleFav = async (e: JournalInteraction, ev: React.MouseEvent) => {
    ev.stopPropagation(); if (!e.id) return;
    try { await updateInteraction(userId, e.id, { isFavorite: !e.isFavorite }); } catch (err) { console.error(err); }
  };
  const confirmDelete = async () => {
    if (!deleteTargetId) return; setIsDeleting(true);
    try { await deleteInteraction(userId, deleteTargetId); setDeleteTargetId(null); }
    catch (err) { console.error(err); } finally { setIsDeleting(false); }
  };
  const download = (href: string, name: string) => {
    const a = document.createElement('a'); a.setAttribute('href', href); a.setAttribute('download', name);
    document.body.appendChild(a); a.click(); a.remove();
  };
  const exportPagesJSON = () =>
    download('data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(diaryPages, null, 2)), `pocket-familiar-diary-pages-${Date.now()}.json`);
  const exportConversationsJSON = () =>
    download('data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(entries, null, 2)), `pocket-familiar-conversations-${Date.now()}.json`);
  // Restored human-readable Markdown export of the full conversations, including
  // every subsequent user/model turn (no schema or data change).
  const exportConversationsMarkdown = () => {
    let md = `# My Pocket Familiar conversations\nExported: ${new Date().toLocaleString()}\n\n---\n\n`;
    entries.forEach((e, i) => {
      md += `## ${i + 1}. ${e.title || 'Untitled entry'}\n`;
      md += `*${new Date(e.createdAt).toLocaleString()} · ${e.mood} · ${e.mode}*\n\n`;
      md += `### You\n${e.initialPrompt}\n\n### Reflection\n${e.reflectionOutput}\n\n`;
      const turns = e.turns ?? [];
      if (turns.length > 0) {
        md += `### Conversation (${turns.length} turn${turns.length === 1 ? '' : 's'})\n`;
        turns.forEach((t) => { md += `**${t.role === 'user' ? 'You' : 'Your familiar'}**: ${t.content}\n\n`; });
      }
      md += `---\n\n`;
    });
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    download(url, `pocket-familiar-conversations-${Date.now()}.md`);
  };

  // PF-CORE-02: truthful Memory Room export across all three owned record types.
  const exportRoomJSON = () =>
    download('data:text/json;charset=utf-8,' + encodeURIComponent(serializeMemoryRoomJson({ conversations: entries, diaryPages, memorySeeds, littleMemories, exportedAt: Date.now() })), `pocket-familiar-memory-room-${Date.now()}.json`);
  const exportRoomMarkdown = () => {
    const blob = new Blob([buildMemoryRoomMarkdown({ conversations: entries, diaryPages, memorySeeds, littleMemories, exportedAt: Date.now() })], { type: 'text/markdown;charset=utf-8' });
    download(URL.createObjectURL(blob), `pocket-familiar-memory-room-${Date.now()}.md`);
  };

  const empty = entries.length === 0 && diaryPages.length === 0 && memorySeeds.length === 0 && littleMemories.length === 0;

  const NoteCard: React.FC<{ id: string; onClick: () => void; children: React.ReactNode; extra?: React.ReactNode }> = ({ id, onClick, children, extra }) => (
    <div className="pf-note rounded-xl border pf-hairline p-2.5 shadow-2xs">
      <button id={id} onClick={onClick} className="w-full text-left">{children}</button>
      {extra}
    </div>
  );

  return (
    <div className="pf-page pf-page-frame space-y-4">
      <div className="flex items-center justify-between">
        <span className="w-9" aria-hidden="true" />
        <h1 className="text-lg font-bold text-[var(--pf-ink)] inline-flex items-center gap-2" style={{ fontFamily: '"Playfair Display", Georgia, serif' }}>
          <svg viewBox="0 0 24 24" className="w-5 h-5 text-[var(--pf-forest)]" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M9 3h6M8 7h8l-1 3.5a5 5 0 0 1 2 4V18a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3v-3.5a5 5 0 0 1 2-4L7 7z"/></svg>
          {MEMORY_COPY.title}
        </h1>
        <button aria-label="Search" onClick={() => setShowSearch((s) => { if (s) setQuery(''); return !s; })}
          className={`w-9 h-9 rounded-full inline-flex items-center justify-center ${showSearch ? 'bg-[var(--pf-forest)] text-[var(--pf-cream)]' : 'text-[#6A6A5A] hover:bg-[#EFECE3]'}`}>
          <Search className="w-4 h-4" />
        </button>
      </div>

      {/* Honest note: the two conversation columns are one saved source seen two ways */}
      <p className="text-[11px] text-center text-[#8A8471]">{MEMORY_COPY.projectionNote}</p>

      {showSearch && (
        <div className="relative">
          <Search className="w-4 h-4 text-[#8A8A7A] absolute left-3 top-1/2 -translate-y-1/2" />
          <input id="history-search-input" type="text" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search across everything you’ve kept…" autoFocus
            className="w-full pl-9 pr-3 py-2 text-sm border border-[#E0DBCF] rounded-xl bg-white focus:outline-hidden focus:border-[var(--pf-forest)]" />
        </div>
      )}

      <section className="pf-paper-surface rounded-2xl border pf-hairline px-3 py-2.5 space-y-2.5" aria-label="Memory controls">
      {/* PF-CORE-02 — one search, three record types; explicit scope + seed status filters */}
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]" role="group" aria-label="Filter which memories to show">
        <span className="w-full sm:w-auto text-[9px] font-bold uppercase tracking-[0.14em] text-[#8A8471] sm:mr-1">Show</span>
        {([
          ['all', 'All'], ['conversation', 'Conversations'], ['diaryPage', 'Diary Pages'], ['memorySeed', 'Memory Seeds'], ['littleMemory', 'Little Memories'],
        ] as Array<[MemoryScope, string]>).map(([id, label]) => (
          <button key={id} id={`memory-scope-${id}`} onClick={() => { setScope(id); if (id !== 'memorySeed') setSeedStatus('all'); }} aria-pressed={scope === id}
            className={`px-2.5 py-1 rounded-full border font-semibold transition-colors ${scope === id ? 'bg-[var(--pf-forest)] text-[var(--pf-cream)] border-[var(--pf-forest)]' : 'bg-white text-[#7A7A6A] border-[#E8E4D8] hover:bg-[#FAF8F2]'}`}>
            {label}
          </button>
        ))}
        {scope === 'memorySeed' && (
          <span className="inline-flex items-center gap-1 ml-1 pl-1.5 border-l border-[#E8E4D8]">
            {([
              ['all', 'All seeds'], ['active', 'Active'], ['revoked', 'Revoked'],
            ] as Array<[SeedStatusFilter, string]>).map(([id, label]) => (
              <button key={id} id={`memory-seedstatus-${id}`} onClick={() => setSeedStatus(id)} aria-pressed={seedStatus === id}
                className={`px-2 py-1 rounded-full border transition-colors ${seedStatus === id ? 'bg-[#EAE2CC] text-[#5A4A22] border-[#DDD0AE]' : 'bg-white text-[#8A8471] border-[#E8E4D8] hover:bg-[#FAF8F2]'}`}>
                {label}
              </button>
            ))}
          </span>
        )}
      </div>

      {/* Secondary controls — scoped correctly. Sort / lens / Starred apply only
          to the default three-column view; during unified search/scope results
          the ordering is fixed newest-first, so those controls are hidden rather
          than shown inert. Exports stay available in both views. */}
      <div className="flex flex-wrap items-center gap-2 text-[11px] pt-2 border-t pf-hairline">
        {!searchActive && (
          <>
            <span className="w-full sm:w-auto text-[9px] font-bold uppercase tracking-[0.14em] text-[#8A8471] sm:mr-1">Arrange</span>
            <button id="history-toggle-sort-btn" onClick={() => setSortNewest((s) => !s)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white text-[#7A7A6A] border border-[#E8E4D8] hover:bg-[#FAF8F2]">
              <ArrowUpDown className="w-3 h-3" /> {sortNewest ? 'Newest' : 'Oldest'}
            </button>
            <span className="inline-flex items-center gap-1 pl-1 text-[#8A8471]">Conversations:</span>
            <div className="relative inline-flex items-center">
              <select id="memory-mode-filter" value={modeFilter} onChange={(e) => setModeFilter(e.target.value as ReflectionMode | 'all')}
                aria-label="Filter conversations by lens"
                className="appearance-none pl-2.5 pr-6 py-1 rounded-full bg-white text-[#555546] border border-[#E8E4D8] hover:bg-[#FAF8F2] font-semibold">
                {MODE_LABELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
              <ChevronDown className="w-3 h-3 text-[#8A8A7A] absolute right-2 pointer-events-none" />
            </div>
            <button id="history-toggle-favorites-btn" onClick={() => setOnlyFavorites((f) => !f)}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border transition-all ${onlyFavorites ? 'bg-[#FAF3E0] text-[#7A5825] border-[#E8DAB2]' : 'bg-white text-[#7A7A6A] border-[#E8E4D8] hover:bg-[#FAF8F2]'}`}>
              <Star className={`w-3 h-3 ${onlyFavorites ? 'fill-[#B88846] text-[#B88846]' : ''}`} /> Starred
            </button>
          </>
        )}
        <details className="relative ml-auto w-full sm:w-auto group">
          <summary id="memory-export-toggle" className="list-none cursor-pointer inline-flex w-full sm:w-auto items-center justify-center gap-1.5 px-3 py-1.5 rounded-full bg-white text-[var(--pf-forest-deep)] border border-[#D9D2C2] font-semibold hover:bg-[#FAF8F2]">
            <Download className="w-3 h-3" /> Export memories <ChevronDown className="w-3 h-3 transition-transform group-open:rotate-180" />
          </summary>
          <div id="memory-export-menu" className="mt-2 sm:absolute sm:right-0 sm:top-full sm:z-20 w-full sm:w-[21rem] grid grid-cols-2 gap-1.5 rounded-2xl border pf-hairline bg-[var(--pf-paper)] p-2.5 shadow-xl">
            <button id="history-export-pages-json-btn" onClick={exportPagesJSON} title="Export diary pages as JSON"
              className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-[#7A7A6A] hover:text-[var(--pf-forest-deep)] hover:bg-white border border-[#E8E4D8] font-semibold"><Download className="w-3 h-3" /> Pages JSON</button>
            <button id="history-export-json-btn" onClick={exportConversationsJSON} title="Export conversations as JSON"
              className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-[#7A7A6A] hover:text-[var(--pf-forest-deep)] hover:bg-white border border-[#E8E4D8] font-semibold"><Download className="w-3 h-3" /> Talks JSON</button>
            <button id="history-export-md-btn" onClick={exportConversationsMarkdown} title="Export conversations as Markdown (.md)"
              className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-[#7A7A6A] hover:text-[var(--pf-forest-deep)] hover:bg-white border border-[#E8E4D8] font-semibold"><Download className="w-3 h-3" /> Talks .md</button>
            <button id="memory-room-export-json-btn" onClick={exportRoomJSON} title="Export the whole Memory Room (conversations, diary pages and seeds) as JSON"
              className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-[var(--pf-cream)] bg-[var(--pf-forest)] hover:bg-[var(--pf-forest-deep)] border border-[var(--pf-forest)] font-semibold"><Download className="w-3 h-3" /> Room JSON</button>
            <button id="memory-room-export-md-btn" onClick={exportRoomMarkdown} title="Export the whole Memory Room as Markdown (.md)"
              className="col-span-2 inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[var(--pf-forest-deep)] hover:bg-white border border-[var(--pf-forest)] font-semibold"><Download className="w-3 h-3" /> Room .md</button>
          </div>
        </details>
      </div>
      </section>

      {empty ? (
        <div className="text-center space-y-4 py-10">
          <div className="relative w-40 h-52 mx-auto overflow-hidden rounded-[24px] border pf-hairline shadow-sm">
            <img src={MEMORY_COLUMNS[0].scene} alt="" aria-hidden="true" className="absolute inset-0 w-full h-full object-cover" decoding="async" />
            <img src={MEMORY_COLUMNS[0].familiar} alt="Your familiar beside an empty page" className="absolute left-2 right-2 bottom-1 w-[calc(100%_-_1rem)] h-auto object-contain drop-shadow-lg" decoding="async" />
          </div>
          <h3 className="text-base font-bold text-[var(--pf-ink)]" style={{ fontFamily: '"Playfair Display", Georgia, serif' }}>Your memory library is empty</h3>
          <p className="text-xs text-[#7A7A6A] max-w-xs mx-auto leading-relaxed">Write with your familiar and your words are gathered here — private to you.</p>
          <button id="history-empty-new-entry-btn" onClick={onNewEntry}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--pf-forest)] hover:bg-[var(--pf-forest-deep)] text-[var(--pf-cream)] text-xs font-semibold shadow-xs">
            <Leaf className="w-3.5 h-3.5" /> Start an entry
          </button>
        </div>
      ) : searchActive ? (
        /* PF-CORE-02 — unified, provenance-aware results across the three kinds */
        <div id="memory-results" className="space-y-5">
          <p className="text-[11px] text-[#8A8471]">
            {results.length === 0
              ? 'Nothing matched — try a different word, or widen the filter above.'
              : `${results.length} ${results.length === 1 ? 'memory' : 'memories'} found. Grouped by kind, newest first.`}
          </p>
          {results.length === 0 ? (
            <div id="memory-no-results" className="text-center py-10 space-y-2">
              <Search className="w-6 h-6 mx-auto text-[#B8B3A2]" />
              <p className="text-xs text-[#7A7A6A]">No memories match “{query.trim() || 'this filter'}”.</p>
            </div>
          ) : resultGroups.map((group) => (
            <section key={group.kind} aria-label={KIND_LABEL[group.kind]} className="space-y-2">
              <h2 className="text-xs font-bold text-[var(--pf-forest-deep)] inline-flex items-center gap-1.5">
                {group.kind === 'diaryPage' && <Leaf className="w-3.5 h-3.5" />}
                {group.kind === 'conversation' && <MessageSquare className="w-3.5 h-3.5" />}
                {group.kind === 'memorySeed' && <Sparkles className="w-3.5 h-3.5" />}
                {group.kind === 'littleMemory' && <Sparkles className="w-3.5 h-3.5" />}
                {KIND_LABEL[group.kind]} <span className="text-[#A8A491] font-normal">({group.records.length})</span>
              </h2>
              <div className="space-y-2">
                {group.records.map((rec) => (
                  <button key={rec.id} id={`memory-result-${rec.id}`}
                    onClick={() => {
                      if (rec.kind === 'conversation' && rec.raw.conversation) onOpenModal(rec.raw.conversation);
                      else if (rec.kind === 'diaryPage' && rec.raw.diaryPage) setReaderPage(rec.raw.diaryPage);
                      else if (rec.kind === 'memorySeed' && rec.raw.memorySeed) setSeedDetail(rec.raw.memorySeed);
                      else if (rec.kind === 'littleMemory' && rec.raw.littleMemory) onOpenLittleMemory?.(rec.raw.littleMemory);
                    }}
                    className="w-full text-left pf-note rounded-xl border pf-hairline p-3 shadow-2xs hover:border-[var(--pf-forest)] transition-colors">
                    <div className="flex items-baseline justify-between gap-2">
                      <h3 className="text-[12px] font-bold text-[var(--pf-ink)] leading-tight line-clamp-2">{rec.title}</h3>
                      <span className="shrink-0 text-[9px] font-mono text-[#9A9482]">{dayLabel(rec.displayDate, tz)}</span>
                    </div>
                    {rec.summary && <p className="text-[10px] text-[#4A4A3A] leading-snug line-clamp-2 mt-1">{rec.summary}</p>}
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <span className="text-[9px] text-[#8A8471]">{rec.authorshipOrApproval}</span>
                      {rec.kind === 'memorySeed' && (
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${rec.status === 'active' ? 'bg-[#E7EFE0] text-[#3F5A31]' : 'bg-[#F1ECE0] text-[#8A7A55]'}`}>{rec.status === 'active' ? 'Active' : 'Revoked'}</span>
                      )}
                      {rec.sourceAvailability === 'unavailable' && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#FBF0EC] text-[#9A5A3A] inline-flex items-center gap-0.5"><AlertCircle className="w-2.5 h-2.5" /> source unavailable</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <>
        <div className="pf-memory-columns grid grid-cols-3 gap-2 sm:gap-3 items-stretch">
          {MEMORY_COLUMNS.map((col) => {
            const Icon = COL_ICON[col.key];
            const columnItems = col.key === 'story' ? pages : conversations;
            const visibleCount = Math.min(visibleColumnCounts[col.key], columnItems.length);
            const visibleItems = columnItems.slice(0, visibleCount);
            const displayCap = Math.min(columnItems.length, MEMORY_COLUMN_MAX);
            const remainingWithinCap = Math.max(0, displayCap - visibleCount);
            return (
              <section key={col.key} className={`pf-col ${col.tone} rounded-2xl border pf-hairline flex flex-col min-h-[60vh]`}>
                {/* Two deliberate art layers: full scene base, transparent familiar above it. */}
                <div className="pf-col-art" aria-hidden="true">
                  <img src={col.scene} alt="" className="pf-col-background" decoding="async" />
                  <img src={col.familiar} alt="" className="pf-col-familiar" decoding="async" />
                </div>
                {/* header */}
                <div className="relative z-[1] px-2 sm:px-3 pt-3 pb-2 text-center">
                  <div className="inline-flex items-center gap-1 text-[var(--pf-forest-deep)]"><Icon className="w-3.5 h-3.5" /></div>
                  <h2 className="text-[11px] sm:text-xs font-bold text-[var(--pf-ink)] leading-tight">{col.label}</h2>
                  <p className="text-[9px] text-[#7A7A6A]">{col.source}</p>
                </div>

                <div className="relative z-[1] flex-1 px-1.5 sm:px-2 pb-3 space-y-2 overflow-visible">
                  {/* FROM MY STORY */}
                  {col.key === 'story' && (pages.length === 0
                    ? <p className="text-[10px] text-center text-[#8A8471] px-1 py-4">No kept pages yet.</p>
                    : (visibleItems as DiaryPage[]).map((page) => (
                      <NoteCard key={page.id} id={`diary-page-${page.id}`} onClick={() => setReaderPage(page)}>
                        <div className="flex items-baseline justify-between gap-1">
                          <h3 className="text-[11px] font-bold text-[var(--pf-ink)] line-clamp-2 leading-tight">{page.title}</h3>
                        </div>
                        <p className="text-[10px] text-[#8A8471] font-mono mt-0.5">{page.date}</p>
                        <p className="text-[10px] text-[#4A4A3A] leading-snug line-clamp-3 mt-1">{page.todayInMyWords}</p>
                        <p className="text-[9px] text-[var(--pf-forest-deep)] font-semibold mt-1">Open full page →</p>
                      </NoteCard>
                    ))
                  )}

                  {/* YOU TOLD ME / WHAT I THOUGHT */}
                  {col.key !== 'story' && (conversations.length === 0
                    ? <p className="text-[10px] text-center text-[#8A8471] px-1 py-4">Nothing here yet.</p>
                    : (visibleItems as JournalInteraction[]).map((entry) => {
                      const body = projectionBody(col.key as 'told' | 'thought', entry);
                      return (
                        <NoteCard key={entry.id} id={`history-card-${col.key}-${entry.id}`} onClick={() => onOpenModal(entry)}
                          extra={
                            <div className="flex items-center gap-1 mt-1 pt-1 border-t pf-hairline">
                              <button id={`mem-star-${col.key}-${entry.id}`} onClick={(e) => toggleFav(entry, e)} title={entry.isFavorite ? 'Unstar' : 'Star'} className="p-0.5 text-[#8A8A7A] hover:text-[#B88846]">
                                <Star className={`w-3 h-3 ${entry.isFavorite ? 'fill-[#B88846] text-[#B88846]' : ''}`} />
                              </button>
                              <button id={`mem-resume-${col.key}-${entry.id}`} onClick={(e) => { e.stopPropagation(); onSelectEntry(entry); }} title="Open in Journal" className="text-[9px] text-[var(--pf-forest-deep)] font-semibold hover:underline">Resume</button>
                              <button id={`mem-delete-${col.key}-${entry.id}`} onClick={(e) => { e.stopPropagation(); setDeleteTargetId(entry.id || null); }} title="Delete conversation" className="ml-auto p-0.5 text-[#8A8A7A] hover:text-[#8C3232]">
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          }>
                          <div className="flex items-center gap-1">
                            <span className="text-[11px]">{MOOD_EMOJIS[entry.mood] || '💡'}</span>
                            <h3 className="text-[11px] font-bold text-[var(--pf-ink)] line-clamp-2 leading-tight">{entry.title || 'Untitled entry'}</h3>
                          </div>
                          <p className="text-[10px] text-[#4A4A3A] leading-snug line-clamp-3 mt-1">{body}</p>
                          <p className="text-[9px] text-[var(--pf-forest-deep)] font-semibold mt-1">{col.source}</p>
                        </NoteCard>
                      );
                    })
                  )}

                  {(remainingWithinCap > 0 || visibleCount > MEMORY_COLUMN_INITIAL) && (
                    <button id={`memory-column-toggle-${col.key}`} type="button" aria-expanded={visibleCount > 3}
                      onClick={() => setVisibleColumnCounts((current) => ({
                        ...current,
                        [col.key]: nextMemoryColumnVisibleCount(current[col.key], columnItems.length),
                      }))}
                      className="mx-auto mt-1 flex items-center justify-center gap-1 rounded-full border pf-hairline bg-[var(--pf-paper)]/90 px-2.5 py-1 text-[9px] font-semibold text-[var(--pf-forest-deep)] shadow-xs hover:bg-white">
                      <ChevronDown className={`h-3 w-3 transition-transform ${remainingWithinCap === 0 ? 'rotate-180' : ''}`} />
                      {remainingWithinCap > 0 ? `Show next ${Math.min(MEMORY_COLUMN_BATCH, remainingWithinCap)}` : 'Back to latest 3'}
                    </button>
                  )}
                </div>
              </section>
            );
          })}
        </div>

        {/* Held by Midnight — a separate archive/shelf for Memory Seeds (active + revoked kept distinct) */}
        <section id="held-by-midnight" aria-label="Held by Midnight — your Memory Seeds" className="pf-glass rounded-2xl border pf-hairline p-3 sm:p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[var(--pf-brass)]" />
            <h2 className="text-sm font-bold text-[var(--pf-ink)]" style={{ fontFamily: '"Playfair Display", Georgia, serif' }}>Held by Midnight</h2>
            <span className="text-[10px] text-[#8A8471]">Seeds you approved for your familiar to carry.</span>
          </div>

          <div>
            <h3 className="text-[10px] font-bold uppercase tracking-wide text-[var(--pf-forest-deep)] mb-1.5">Actively held ({activeSeeds.length})</h3>
            {activeSeeds.length === 0 ? (
              <p className="text-[10px] text-[#8A8471] py-1">Nothing held yet. When you approve a seed, it rests here.</p>
            ) : (
              <div className="grid sm:grid-cols-2 gap-2">
                {activeSeeds.map((s) => (
                  <button key={s.id} id={`held-seed-${s.id}`} onClick={() => setSeedDetail(s)}
                    className="text-left pf-note rounded-xl border pf-hairline p-2.5 shadow-2xs hover:border-[var(--pf-forest)] transition-colors">
                    <p className="text-[11px] text-[var(--pf-ink)] leading-snug line-clamp-3">“{s.text}”</p>
                    <p className="text-[9px] text-[#8A8471] mt-1">Approved by you · held by Midnight{s.editedByUser ? ' · edited' : ''} · {s.sourceDate}</p>
                  </button>
                ))}
              </div>
            )}
          </div>

          {revokedSeeds.length > 0 && (
            <div className="pt-1 border-t pf-hairline">
              <h3 className="text-[10px] font-bold uppercase tracking-wide text-[#8A7A55] mb-1.5 mt-2">Released ({revokedSeeds.length})</h3>
              <div className="grid sm:grid-cols-2 gap-2">
                {revokedSeeds.map((s) => (
                  <button key={s.id} id={`held-seed-${s.id}`} onClick={() => setSeedDetail(s)}
                    className="text-left rounded-xl border border-dashed border-[#DDD5C4] bg-[#F7F4EC]/60 p-2.5 hover:border-[#C8BFA8] transition-colors">
                    <p className="text-[11px] text-[#7A7364] leading-snug line-clamp-2 line-through decoration-[#C8BFA8]/70">“{s.text}”</p>
                    <p className="text-[9px] text-[#9A9482] mt-1">Released — no longer carried · from {s.sourceDate}</p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
        </>
      )}

      {/* Full Diary Page reader (keyboard-accessible; works without source) */}
      {readerPage && (
        <DiaryPageReader page={readerPage} sourceAvailable={isSourceAvailable(readerPage.sourceInteractionId)}
          onOpenSource={(id) => { setReaderPage(null); onOpenSource(id); }} onClose={() => setReaderPage(null)} />
      )}

      {/* Delete confirmation — makes clear the whole conversation is removed */}
      {deleteTargetId && (
        <div className="fixed inset-0 z-50 bg-[#10151F]/60 backdrop-blur-[2px] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-xl border pf-hairline space-y-4">
            <div className="flex items-center gap-3 text-[#8C3232]">
              <div className="p-2 rounded-xl bg-[#FBEFEF]"><AlertCircle className="w-5 h-5" /></div>
              <h4 className="font-bold text-[var(--pf-ink)] text-base">Delete entire conversation?</h4>
            </div>
            <p className="text-xs text-[#666656] leading-relaxed">This removes the whole saved conversation — both your words and the familiar’s reflections — from your journal. This can’t be undone.</p>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button onClick={() => setDeleteTargetId(null)} disabled={isDeleting} className="px-3.5 py-2 rounded-xl text-xs font-semibold text-[#555546] hover:bg-[#FAF8F2]">Cancel</button>
              <button id="history-confirm-delete-btn" onClick={confirmDelete} disabled={isDeleting}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-[#8C3232] hover:bg-[#722727] text-white shadow-xs">{isDeleting ? 'Deleting…' : 'Delete conversation'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Memory Seed provenance detail — server-routed edit / revoke / delete.
          Reads live from the subscription so a revoke/edit reflects immediately. */}
      {(() => {
        const live = seedDetail ? memorySeeds.find((s) => s.id === seedDetail.id) ?? seedDetail : null;
        return live ? (
        <SeedDetailModal
          seed={live}
          sourceAvailable={!!seedSourcePage(live)}
          busy={seedBusy}
          error={seedError}
          onOpenSource={() => openSeedSource(live)}
          onEdit={(text) => runSeed(onSeedEdit ? () => onSeedEdit(live, text) : undefined, 'edit')}
          onRevoke={() => runSeed(onSeedRevoke ? () => onSeedRevoke(live) : undefined, 'release')}
          onDelete={() => { setSeedDetail(null); setSeedError(null); onSeedRequestDelete?.(live); }}
          onClose={() => { setSeedDetail(null); setSeedError(null); }}
        />
        ) : null;
      })()}
    </div>
  );
};
