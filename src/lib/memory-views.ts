import { JournalInteraction, DiaryPage, ReflectionMode } from '../types';

/**
 * Pure view logic for the Memory library. The three columns are PRESENTATION
 * projections of the existing saved data — confirmed diary pages, the user's own
 * conversation words, and the familiar's reflections. No new memory mechanism,
 * no schema, no writes here. Kept pure so the library's filtering, projection
 * and control-scoping are unit-testable without rendering or Firebase.
 */

export type MemoryColumn = 'story' | 'told' | 'thought';

export interface ConversationFilter {
  query: string;
  mode: ReflectionMode | 'all';
  onlyFavorites: boolean;
  sortNewest: boolean;
}

const matchesQuery = (e: JournalInteraction, q: string) =>
  !q || Boolean(
    e.title?.toLowerCase().includes(q) ||
    e.initialPrompt?.toLowerCase().includes(q) ||
    e.reflectionOutput?.toLowerCase().includes(q) ||
    e.tags?.some((t) => t.toLowerCase().includes(q))
  );

/** Conversation columns (You told me / What I thought) share this projection source. */
export function filterConversations(entries: JournalInteraction[], f: ConversationFilter): JournalInteraction[] {
  const q = f.query.trim().toLowerCase();
  return entries
    .filter((e) => matchesQuery(e, q))
    .filter((e) => (f.mode === 'all' ? true : e.mode === f.mode))
    .filter((e) => (f.onlyFavorites ? !!e.isFavorite : true))
    .sort((a, b) => (f.sortNewest ? (b.createdAt || 0) - (a.createdAt || 0) : (a.createdAt || 0) - (b.createdAt || 0)));
}

/**
 * Diary pages (From my story). Deliberately has NO favourites parameter: diary
 * pages have no favourite field, so a Starred control must not apply here.
 */
export function filterPages(pages: DiaryPage[], f: { query: string; sortNewest: boolean }): DiaryPage[] {
  const q = f.query.trim().toLowerCase();
  return pages
    .filter((p) => !q || p.title?.toLowerCase().includes(q) || p.todayInMyWords?.toLowerCase().includes(q)
      || p.whatFeltImportant?.some((i) => i.toLowerCase().includes(q)))
    .sort((a, b) => (f.sortNewest ? (b.confirmedAt || 0) - (a.confirmedAt || 0) : (a.confirmedAt || 0) - (b.confirmedAt || 0)));
}

/** The body shown for a conversation projection column. */
export function projectionBody(view: 'told' | 'thought', e: JournalInteraction): string {
  return view === 'told' ? e.initialPrompt : e.reflectionOutput;
}

/** Only the two conversation columns support a Starred filter. */
export function columnHasFavorites(col: MemoryColumn): boolean {
  return col !== 'story';
}

/** Explicit export scope per column, so labels never claim to export "all memories". */
export function exportScope(col: MemoryColumn): 'pages' | 'conversations' {
  return col === 'story' ? 'pages' : 'conversations';
}

export const COLUMN_META: Record<MemoryColumn, { label: string; source: string }> = {
  story: { label: 'From my story', source: 'You · Journal' },
  told: { label: 'You told me', source: 'You · Conversation' },
  thought: { label: 'What I thought', source: 'Familiar · Insight' },
};
