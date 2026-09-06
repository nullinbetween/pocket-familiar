import { JournalInteraction, DiaryPage, MemorySeed, LittleMemory } from '../types';
import { hasViewableImage } from './little-memory-image';

/**
 * PF-CORE-02 Living Memory — pure, provenance-aware projection + deterministic
 * search/grouping over the collections that ALREADY exist. There is no new
 * canonical store, no denormalized index, no model-generated "memory truth":
 * this only projects and searches the authenticated user's own live records.
 *
 * The discriminated `MemoryRecord.kind` and the `${kind}:${sourceDocId}` id make
 * a Conversation, a Diary Page and a Memory Seed impossible to confuse even when
 * their raw document ids or visible text are identical.
 */

export type MemoryKind = 'conversation' | 'diaryPage' | 'memorySeed' | 'littleMemory';

export interface MemoryRecordSourceRef {
  kind: 'conversation' | 'diaryPage' | 'memorySeed';
  id: string;
  availability: 'available' | 'unavailable';
}

export interface MemoryRecord {
  kind: MemoryKind;
  /** Stable, collision-proof: `${kind}:${sourceDocId}`. */
  id: string;
  sourceDocId: string;
  /** Epoch ms used for ordering. */
  displayDate: number;
  title: string;
  summary: string;
  /** Human authorship/approval line — never claims model text is the user's. */
  authorshipOrApproval: string;
  status: string;
  sourceRefs: MemoryRecordSourceRef[];
  sourceAvailability: 'available' | 'unavailable' | 'not_applicable';
  /** Normalized (lowercased, whitespace-collapsed) haystack for local search. */
  searchableText: string;
  /** The raw record, for the detail reader. Exactly one field is set. */
  raw: { conversation?: JournalInteraction; diaryPage?: DiaryPage; memorySeed?: MemorySeed; littleMemory?: LittleMemory };
}

/** Availability resolvers: whether a referenced source doc still exists for this owner. */
export interface AvailabilityLookup {
  conversationExists: (id: string) => boolean;
  diaryPageExists: (id: string) => boolean;
  memorySeedExists: (id: string) => boolean;
}

const norm = (s: string): string => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();

export function projectConversation(c: JournalInteraction): MemoryRecord {
  const turns = c.turns ?? [];
  // Both conversation columns ("You told me" / "What I thought") are rendered
  // from this same record's raw.conversation — the model's words are never
  // attributed to the user. Search covers title, both authored sides and turns.
  const searchable = norm(
    [c.title, c.initialPrompt, c.reflectionOutput, ...(c.tags ?? []), ...turns.map((t) => t.content)].join(' ')
  );
  return {
    kind: 'conversation',
    id: `conversation:${c.id ?? ''}`,
    sourceDocId: c.id ?? '',
    displayDate: c.createdAt ?? 0,
    title: c.title || 'Untitled conversation',
    summary: c.initialPrompt || '',
    authorshipOrApproval: 'You & your familiar · Conversation',
    status: c.generationStatus ?? 'complete',
    sourceRefs: [],
    sourceAvailability: 'not_applicable',
    searchableText: searchable,
    raw: { conversation: c },
  };
}

export function projectDiaryPage(p: DiaryPage, lookup: AvailabilityLookup): MemoryRecord {
  const convId = p.sourceInteractionId ?? '';
  const available = convId ? lookup.conversationExists(convId) : false;
  const searchable = norm([p.title, p.todayInMyWords, ...(p.whatFeltImportant ?? []), p.carryForward ?? ''].join(' '));
  return {
    kind: 'diaryPage',
    id: `diaryPage:${p.id ?? ''}`,
    sourceDocId: p.id ?? '',
    displayDate: p.confirmedAt ?? p.createdAt ?? 0,
    title: p.title || 'Untitled page',
    summary: p.todayInMyWords || '',
    authorshipOrApproval: `You · Journal · AI-assisted draft, approved by you${p.editedByUser ? ' · edited' : ''}`,
    status: p.status ?? 'confirmed',
    sourceRefs: [{ kind: 'conversation', id: convId, availability: available ? 'available' : 'unavailable' }],
    sourceAvailability: available ? 'available' : 'unavailable',
    searchableText: searchable,
    raw: { diaryPage: p },
  };
}

export function projectMemorySeed(s: MemorySeed, lookup: AvailabilityLookup): MemoryRecord {
  const refs: MemoryRecordSourceRef[] = (s.sourceRefs ?? [])
    .filter((r) => r.kind === 'diaryPage')
    .map((r) => ({
      kind: 'diaryPage' as const,
      id: r.id,
      availability: lookup.diaryPageExists(r.id) && r.availability === 'available' ? 'available' as const : 'unavailable' as const,
    }));
  const anyAvailable = refs.some((r) => r.availability === 'available');
  return {
    kind: 'memorySeed',
    id: `memorySeed:${s.id ?? ''}`,
    sourceDocId: s.id ?? '',
    displayDate: s.confirmedAt ?? s.createdAt ?? 0,
    title: s.text || 'Memory seed',
    summary: s.sourceExcerpt || '',
    authorshipOrApproval: `Approved by you · held by Midnight${s.editedByUser ? ' · edited' : ''}`,
    status: s.status,
    sourceRefs: refs,
    sourceAvailability: refs.length === 0 ? 'not_applicable' : anyAvailable ? 'available' : 'unavailable',
    searchableText: norm([s.text, s.sourceExcerpt].join(' ')),
    raw: { memorySeed: s },
  };
}

export function projectLittleMemory(lm: LittleMemory, lookup: AvailabilityLookup): MemoryRecord {
  const refs: MemoryRecordSourceRef[] = (lm.sourceRefs ?? []).map((r) => {
    const exists = r.kind === 'diaryPage' ? lookup.diaryPageExists(r.id) : lookup.memorySeedExists(r.id);
    return {
      kind: r.kind,
      id: r.id,
      availability: exists && r.availability === 'available' ? ('available' as const) : ('unavailable' as const),
    };
  });
  const anyAvailable = refs.some((r) => r.availability === 'available');
  // Search only what the user can actually see: title, caption and source labels.
  // Internal image-direction fields remain available to the generation backend,
  // but must not create surprising matches in the user-facing Memory Room.
  const searchable = norm([lm.title, lm.caption, ...(lm.sourceRefs ?? []).map((r) => r.label)].join(' '));
  return {
    kind: 'littleMemory',
    id: `littleMemory:${lm.id ?? ''}`,
    sourceDocId: lm.id ?? '',
    displayDate: lm.confirmedAt ?? lm.createdAt ?? 0,
    title: lm.title || 'Little Memory',
    summary: lm.caption || lm.setting || '',
    authorshipOrApproval: `Saved by you · Little Memory · illustration ${hasViewableImage(lm) ? 'ready' : 'not generated yet'}`,
    status: lm.status,
    sourceRefs: refs,
    sourceAvailability: refs.length === 0 ? 'not_applicable' : anyAvailable ? 'available' : 'unavailable',
    searchableText: searchable,
    raw: { littleMemory: lm },
  };
}

/** Project every owned record into the unified space. */
export function projectAll(
  conversations: JournalInteraction[],
  diaryPages: DiaryPage[],
  memorySeeds: MemorySeed[],
  littleMemories: LittleMemory[] = []
): MemoryRecord[] {
  const lookup: AvailabilityLookup = {
    conversationExists: (id) => conversations.some((c) => c.id === id),
    diaryPageExists: (id) => diaryPages.some((p) => p.id === id),
    // P1a: a revoked Memory Seed still EXISTS and remains a readable provenance
    // source — availability is document existence, not active status. (Only active
    // seeds may be newly selected for a new scene brief; that lives elsewhere.)
    memorySeedExists: (id) => memorySeeds.some((s) => s.id === id),
  };
  return [
    ...conversations.map(projectConversation),
    ...diaryPages.map((p) => projectDiaryPage(p, lookup)),
    ...memorySeeds.map((s) => projectMemorySeed(s, lookup)),
    ...littleMemories.map((lm) => projectLittleMemory(lm, lookup)),
  ];
}

/* ── Deterministic search + filter + order ───────────────────────────────────*/

export type MemoryScope = 'all' | 'conversation' | 'diaryPage' | 'memorySeed' | 'littleMemory';
export type SeedStatusFilter = 'all' | 'active' | 'revoked';

export interface MemoryQuery {
  text: string;
  scope: MemoryScope;
  /** Applies only when Memory Seeds are in scope. */
  seedStatus: SeedStatusFilter;
}

/**
 * Local, pure search — no Gemini, embedding, vector store or hidden top-K. Case
 * and whitespace are normalized; matching is plain substring over the record's
 * searchableText. No relevance score is produced. Order: by kind, then
 * newest-first, with a stable id tie-breaker so equal timestamps are
 * deterministic.
 */
export function searchMemory(records: MemoryRecord[], q: MemoryQuery): MemoryRecord[] {
  const needle = norm(q.text);
  const kindOrder: Record<MemoryKind, number> = { diaryPage: 0, conversation: 1, memorySeed: 2, littleMemory: 3 };
  return records
    .filter((r) => (q.scope === 'all' ? true : r.kind === q.scope))
    .filter((r) => {
      if (r.kind !== 'memorySeed') return true;
      if (q.seedStatus === 'all') return true;
      return r.status === q.seedStatus;
    })
    .filter((r) => (needle ? r.searchableText.includes(needle) : true))
    .sort((a, b) => {
      if (a.kind !== b.kind) return kindOrder[a.kind] - kindOrder[b.kind];
      if (b.displayDate !== a.displayDate) return b.displayDate - a.displayDate;
      return a.id < b.id ? 1 : a.id > b.id ? -1 : 0; // stable, deterministic tie-break
    });
}

export interface MemoryGroup {
  kind: MemoryKind;
  records: MemoryRecord[];
}

/** Group already-sorted results by kind, preserving the sorted order within each. */
export function groupByKind(records: MemoryRecord[]): MemoryGroup[] {
  const order: MemoryKind[] = ['diaryPage', 'conversation', 'memorySeed', 'littleMemory'];
  return order
    .map((kind) => ({ kind, records: records.filter((r) => r.kind === kind) }))
    .filter((g) => g.records.length > 0);
}

/* ── Timezone-aware local time grouping ──────────────────────────────────────*/

/** Local calendar day key 'YYYY-MM-DD' for an epoch, in the given IANA tz. */
export function localDayKey(epochMs: number, timeZone: string): string {
  // en-CA yields ISO-style YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(epochMs));
}

/** Local ISO week key 'YYYY-Www' for an epoch, in the given tz (Monday-based). */
export function localWeekKey(epochMs: number, timeZone: string): string {
  const dayKey = localDayKey(epochMs, timeZone); // 'YYYY-MM-DD' local
  const [y, m, d] = dayKey.split('-').map(Number);
  // Work in a UTC proxy of the local calendar date so week math is tz-free.
  const proxy = new Date(Date.UTC(y, m - 1, d));
  const dow = (proxy.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  proxy.setUTCDate(proxy.getUTCDate() - dow + 3); // nearest Thursday (ISO)
  const isoYear = proxy.getUTCFullYear();
  const firstThu = new Date(Date.UTC(isoYear, 0, 4));
  const firstDow = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - firstDow + 3);
  const week = 1 + Math.round((proxy.getTime() - firstThu.getTime()) / (7 * 86400000));
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

/** Human day label relative to `now` (both in tz): Today / Yesterday / YYYY-MM-DD. */
export function dayLabel(epochMs: number, timeZone: string, now: number = Date.now()): string {
  const k = localDayKey(epochMs, timeZone);
  if (k === localDayKey(now, timeZone)) return 'Today';
  if (k === localDayKey(now - 86400000, timeZone)) return 'Yesterday';
  if (localWeekKey(epochMs, timeZone) === localWeekKey(now, timeZone)) return 'Earlier this week';
  return k;
}
