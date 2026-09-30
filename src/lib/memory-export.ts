import { JournalInteraction, DiaryPage, MemorySeed, LittleMemory } from '../types';
import { hasViewableImage, pendingGenerationStatus, resolveImageStatus } from './little-memory-image';

/**
 * PF-CORE-02 Living Memory — deterministic, truthful Memory Room export. It
 * contains ONLY the owned records that are actually implemented (Conversations,
 * Diary Pages, Memory Seeds), with kind/status/provenance preserved. Model text
 * is never re-labelled as user-authored diary text, and revoked seeds are
 * included with their status (the scope note states this explicitly). No
 * runtime/secret configuration is ever serialized.
 */

export interface MemoryRoomInput {
  conversations: JournalInteraction[];
  diaryPages: DiaryPage[];
  memorySeeds: MemorySeed[];
  littleMemories?: LittleMemory[];
  exportedAt: number;
}

export interface MemoryRoomJson {
  kind: 'pocketFamiliarMemoryRoomExport';
  version: 1;
  exportedAt: string;
  scope: string;
  conversations: Array<{
    kind: 'conversation'; id: string; title: string; createdAt: number; status: string;
    userOpening: string; familiarReflection: string;
    turns: Array<{ author: 'you' | 'familiar'; text: string; timestamp: number }>;
  }>;
  diaryPages: Array<{
    kind: 'diaryPage'; id: string; title: string; date: string; status: string; editedByUser: boolean;
    todayInMyWords: string; whatFeltImportant: string[]; carryForward?: string;
    source: { kind: 'conversation'; id: string };
  }>;
  memorySeeds: Array<{
    kind: 'memorySeed'; id: string; status: 'active' | 'revoked'; text: string;
    approvedByUser: boolean; editedByUser: boolean; sourceExcerpt: string; sourceDate: string;
    sourceRefs: Array<{ kind: string; id: string; availability: string }>;
  }>;
  littleMemories: Array<{
    kind: 'littleMemory'; id: string; status: 'brief_approved'; date: string;
    approvedByUser: boolean; editedByUser: boolean; illustrationGenerated: boolean;
    illustrationStatus: 'not_generated' | 'generating' | 'ready' | 'failed' | 'stale';
    illustrationAttemptStatus: 'none' | 'generating' | 'failed';
    title: string; caption: string;
    sourceRefs: Array<{ kind: string; id: string; availability: string; label: string }>;
  }>;
  knownLimitations: string[];
}

const SCOPE_NOTE =
  'Contains your Conversations, Diary Pages, Memory Seeds (both active and revoked seeds are included, each with its status) and Little Memories with bounded illustration status. Private image bytes and storage locations are not included. Account-level deletion is not part of this slice.';

/**
 * Canonical export ordering. Firestore subscription arrays can arrive in any
 * order, so before serializing we sort each top-level record type by a documented
 * stable key: display date DESCENDING (newest first), then document id ASCENDING
 * as a total tie-breaker. Conversation turns keep their meaningful stored order
 * (they are a transcript); only non-semantic reference arrays (seed sourceRefs)
 * are canonically ordered, by (kind, id). This makes the export byte-identical
 * regardless of input array order.
 */
const convDate = (c: JournalInteraction) => c.createdAt ?? 0;
const pageDate = (p: DiaryPage) => p.confirmedAt ?? p.createdAt ?? 0;
const seedDate = (s: MemorySeed) => s.confirmedAt ?? s.createdAt ?? 0;
const lmDate = (l: LittleMemory) => l.confirmedAt ?? l.createdAt ?? 0;
const byDateDescIdAsc = <T>(date: (x: T) => number, id: (x: T) => string) => (a: T, b: T): number => {
  const d = date(b) - date(a);
  if (d !== 0) return d;
  const ia = id(a), ib = id(b);
  return ia < ib ? -1 : ia > ib ? 1 : 0;
};
const canonicalize = (input: MemoryRoomInput) => ({
  conversations: [...input.conversations].sort(byDateDescIdAsc(convDate, (c) => c.id ?? '')),
  diaryPages: [...input.diaryPages].sort(byDateDescIdAsc(pageDate, (p) => p.id ?? '')),
  memorySeeds: [...input.memorySeeds].sort(byDateDescIdAsc(seedDate, (s) => s.id ?? '')),
  littleMemories: [...(input.littleMemories ?? [])].sort(byDateDescIdAsc(lmDate, (l) => l.id ?? '')),
});
const canonicalRefs = (refs: MemorySeed['sourceRefs']) =>
  [...(refs ?? [])].sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

export function buildMemoryRoomJson(input: MemoryRoomInput): MemoryRoomJson {
  const { conversations, diaryPages, memorySeeds, littleMemories } = canonicalize(input);
  const withoutCurrentIllustration = littleMemories.filter((l) => !hasViewableImage(l)).length;
  return {
    kind: 'pocketFamiliarMemoryRoomExport',
    version: 1,
    exportedAt: new Date(input.exportedAt).toISOString(),
    scope: SCOPE_NOTE,
    conversations: conversations.map((c) => ({
      kind: 'conversation',
      id: c.id ?? '',
      title: c.title || 'Untitled conversation',
      createdAt: c.createdAt ?? 0,
      status: c.generationStatus ?? 'complete',
      userOpening: c.initialPrompt || '',
      familiarReflection: c.reflectionOutput || '',
      turns: (c.turns ?? []).map((t) => ({ author: t.role === 'user' ? 'you' : 'familiar', text: t.content, timestamp: t.timestamp })),
    })),
    diaryPages: diaryPages.map((p) => ({
      kind: 'diaryPage',
      id: p.id ?? '',
      title: p.title || 'Untitled page',
      date: p.date,
      status: p.status ?? 'confirmed',
      editedByUser: !!p.editedByUser,
      todayInMyWords: p.todayInMyWords,
      whatFeltImportant: p.whatFeltImportant ?? [],
      carryForward: p.carryForward,
      source: { kind: 'conversation', id: p.sourceInteractionId ?? '' },
    })),
    memorySeeds: memorySeeds.map((s) => ({
      kind: 'memorySeed',
      id: s.id ?? '',
      status: s.status,
      text: s.text,
      approvedByUser: !!s.approvedByUser,
      editedByUser: !!s.editedByUser,
      sourceExcerpt: s.sourceExcerpt,
      sourceDate: s.sourceDate,
      sourceRefs: canonicalRefs(s.sourceRefs).map((r) => ({ kind: r.kind, id: r.id, availability: r.availability })),
    })),
    littleMemories: littleMemories.map((l) => ({
      kind: 'littleMemory' as const,
      id: l.id ?? '',
      status: l.status,
      date: l.date,
      approvedByUser: !!l.approvedByUser,
      editedByUser: !!l.editedByUser,
      // Truthful bounded state only. Private paths/bytes/URLs never enter export.
      illustrationGenerated: hasViewableImage(l),
      illustrationStatus: resolveImageStatus(l),
      illustrationAttemptStatus: pendingGenerationStatus(l),
      title: l.title,
      caption: l.caption,
      sourceRefs: [...(l.sourceRefs ?? [])]
        .sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map((r) => ({ kind: r.kind, id: r.id, availability: r.availability, label: r.label })),
    })),
    knownLimitations: [
      'Account deletion is not implemented in this slice and is not represented in this export.',
      'Generated illustration bytes and private storage locations are intentionally excluded from this metadata export.',
      ...(withoutCurrentIllustration > 0
        ? [`${withoutCurrentIllustration} Little ${withoutCurrentIllustration === 1 ? 'Memory does' : 'Memories do'} not currently have a generated illustration.`]
        : []),
    ],
  };
}

export function serializeMemoryRoomJson(input: MemoryRoomInput): string {
  return JSON.stringify(buildMemoryRoomJson(input), null, 2);
}

/** Human-readable Markdown: clearly separated sections and explicit authorship. */
export function buildMemoryRoomMarkdown(input: MemoryRoomInput): string {
  const { conversations, diaryPages, memorySeeds, littleMemories } = canonicalize(input);
  const lines: string[] = [];
  lines.push('# My Pocket Familiar — Memory Room');
  lines.push(`Exported: ${new Date(input.exportedAt).toISOString()}`);
  lines.push(`Scope: ${SCOPE_NOTE}`);
  lines.push('');

  lines.push(`## From my story — Diary Pages (${diaryPages.length})`);
  if (diaryPages.length === 0) lines.push('_None kept yet._');
  diaryPages.forEach((p) => {
    lines.push(`### ${p.title || 'Untitled page'}`);
    lines.push(`*${p.date} · approved by you${p.editedByUser ? ' · edited' : ''}*`);
    lines.push('');
    lines.push(p.todayInMyWords);
    if ((p.whatFeltImportant ?? []).length) {
      lines.push('');
      lines.push('What felt important:');
      p.whatFeltImportant.forEach((i) => lines.push(`- ${i}`));
    }
    if (p.carryForward) { lines.push(''); lines.push(`Carry forward: ${p.carryForward}`); }
    lines.push('');
  });

  lines.push(`## Conversations (${conversations.length})`);
  if (conversations.length === 0) lines.push('_None saved yet._');
  conversations.forEach((c) => {
    lines.push(`### ${c.title || 'Untitled conversation'}`);
    lines.push(`*${new Date(c.createdAt ?? 0).toISOString()} · ${c.mood} · ${c.mode}*`);
    lines.push('');
    lines.push(`**You**: ${c.initialPrompt || ''}`);
    lines.push('');
    lines.push(`**Your familiar**: ${c.reflectionOutput || ''}`);
    const turns = c.turns ?? [];
    if (turns.length) {
      lines.push('');
      lines.push(`Full conversation (${turns.length} turn${turns.length === 1 ? '' : 's'}):`);
      turns.forEach((t) => lines.push(`- **${t.role === 'user' ? 'You' : 'Your familiar'}**: ${t.content}`));
    }
    lines.push('');
  });

  lines.push(`## Held by Midnight — Memory Seeds (${memorySeeds.length})`);
  if (memorySeeds.length === 0) lines.push('_None kept yet._');
  memorySeeds.forEach((s) => {
    lines.push(`- [${s.status}] “${s.text}” — approved by you${s.editedByUser ? ' · edited' : ''}; from ${s.sourceDate}`);
  });
  lines.push('');

  lines.push(`## Little Memories (${littleMemories.length})`);
  if (littleMemories.some(hasViewableImage)) {
    lines.push('_Illustration status is included below; private image bytes, storage locations and internal image direction are not exported._');
  } else {
    lines.push('_No current generated illustrations are stored for these Little Memories._');
  }
  if (littleMemories.length === 0) lines.push('_None kept yet._');
  littleMemories.forEach((l) => {
    const imageStatus = resolveImageStatus(l);
    const attemptStatus = pendingGenerationStatus(l);
    const attemptNote = attemptStatus === 'generating' && hasViewableImage(l)
      ? ' · replacement attempt generating; current illustration preserved'
      : attemptStatus === 'failed'
        ? ` · latest attempt failed${hasViewableImage(l) ? '; current illustration preserved' : ''}`
        : '';
    lines.push(`### ${l.title || 'Little Memory'}`);
    lines.push(`*${l.date} · saved by you · illustration ${imageStatus}${attemptNote}*`);
    lines.push('');
    lines.push(l.caption);
    const refs = [...(l.sourceRefs ?? [])].sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (refs.length) {
      lines.push(`- Grounded in: ${refs.map((r) => `${r.kind} (${r.label}${r.availability === 'unavailable' ? ' — source unavailable' : ''})`).join('; ')}`);
    }
    lines.push('');
  });

  return lines.join('\n');
}
