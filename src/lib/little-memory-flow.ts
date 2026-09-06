import { LittleMemory, LittleMemorySourceRef, SceneBriefFields } from '../types';

/**
 * PF-CORE-03A: pure Little Memory logic shared by the authenticated server
 * transactions and the review UI. A Little Memory is a user-approved, bounded
 * "scene brief" grounded in exactly one confirmed Diary Page plus zero or more
 * explicitly chosen ACTIVE Memory Seeds. It carries NO image and makes NO
 * generated/ready claim in 03A.
 *
 * Invariants:
 *   - only an explicit user approval creates a durable record (server confirm);
 *   - trusted provenance — the server-derived userId, date, source refs/labels/
 *     availability, status and timestamps — comes from SERVER-VERIFIED records,
 *     never from model output or client claims;
 *   - the scene-brief schema is closed and bounded, validated identically for the
 *     model draft output and the user-approved save.
 *
 * NOTE: `editedByUser` is UX metadata, computed by comparing the client-returned
 * draft fields to the approved fields. It is NOT cryptographically authoritative
 * provenance — a client could set it — so no security decision depends on it.
 * Security decisions rely only on the verified uid and server-fetched sources.
 */

/* ── Bounded scene-brief schema ───────────────────────────────────────────────*/

export const SCENE_BRIEF_KEYS = [
  'title', 'setting', 'timeOfDay', 'emotionalTone', 'familiarAction', 'visualMotifs', 'composition', 'caption',
] as const;

export const SCENE_BRIEF_LIMITS = {
  title: 80,
  setting: 200,
  timeOfDay: 60,
  emotionalTone: 80,
  familiarAction: 200,
  composition: 200,
  caption: 160,
  motifsMin: 1,
  motifsMax: 6,
  motifItem: 40,
} as const;

const LABEL_MAX = 90;

export type SceneBriefVerdict = { ok: true } | { ok: false; reason: string };

const STRING_FIELDS: Array<{ key: keyof SceneBriefFields; max: number }> = [
  { key: 'title', max: SCENE_BRIEF_LIMITS.title },
  { key: 'setting', max: SCENE_BRIEF_LIMITS.setting },
  { key: 'timeOfDay', max: SCENE_BRIEF_LIMITS.timeOfDay },
  { key: 'emotionalTone', max: SCENE_BRIEF_LIMITS.emotionalTone },
  { key: 'familiarAction', max: SCENE_BRIEF_LIMITS.familiarAction },
  { key: 'composition', max: SCENE_BRIEF_LIMITS.composition },
  { key: 'caption', max: SCENE_BRIEF_LIMITS.caption },
];

/**
 * Validate an UNTRUSTED object as a closed, bounded scene brief. Extra keys,
 * missing keys, wrong types and over-limit fields all fail closed. Used both for
 * the model's draft output and the user-approved save, so neither can smuggle an
 * unsupported shape through.
 */
export function validateSceneBriefShape(raw: unknown): SceneBriefVerdict {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'brief_not_object' };
  const obj = raw as Record<string, unknown>;
  const keys = Object.keys(obj);
  const allowed = new Set<string>(SCENE_BRIEF_KEYS);
  for (const k of keys) if (!allowed.has(k)) return { ok: false, reason: `brief_extra_key(${k})` };
  for (const k of SCENE_BRIEF_KEYS) if (!(k in obj)) return { ok: false, reason: `brief_missing_key(${k})` };
  for (const { key, max } of STRING_FIELDS) {
    const v = obj[key];
    if (typeof v !== 'string' || !v.trim()) return { ok: false, reason: `brief_${key}_empty` };
    if (v.trim().length > max) return { ok: false, reason: `brief_${key}_over_${max}_chars` };
  }
  const motifs = obj.visualMotifs;
  if (!Array.isArray(motifs)) return { ok: false, reason: 'brief_visualMotifs_not_array' };
  if (motifs.length < SCENE_BRIEF_LIMITS.motifsMin || motifs.length > SCENE_BRIEF_LIMITS.motifsMax) {
    return { ok: false, reason: `brief_visualMotifs_not_${SCENE_BRIEF_LIMITS.motifsMin}_to_${SCENE_BRIEF_LIMITS.motifsMax}` };
  }
  const seen = new Set<string>();
  for (const m of motifs) {
    if (typeof m !== 'string' || !m.trim()) return { ok: false, reason: 'brief_motif_empty' };
    if (m.trim().length > SCENE_BRIEF_LIMITS.motifItem) return { ok: false, reason: `brief_motif_over_${SCENE_BRIEF_LIMITS.motifItem}_chars` };
    const norm = m.trim().toLowerCase();
    if (seen.has(norm)) return { ok: false, reason: 'brief_duplicate_motif' };
    seen.add(norm);
  }
  return { ok: true };
}

/** Trim every field to its canonical stored form (call only after validation). */
export function sanitizeSceneBrief(raw: SceneBriefFields): SceneBriefFields {
  return {
    title: raw.title.trim(),
    setting: raw.setting.trim(),
    timeOfDay: raw.timeOfDay.trim(),
    emotionalTone: raw.emotionalTone.trim(),
    familiarAction: raw.familiarAction.trim(),
    visualMotifs: raw.visualMotifs.map((m) => m.trim()),
    composition: raw.composition.trim(),
    caption: raw.caption.trim(),
  };
}

/** Deterministic equality of two briefs (for the editedByUser provenance flag). */
export function sceneBriefEquals(a: SceneBriefFields, b: SceneBriefFields): boolean {
  const sa = sanitizeSceneBrief(a), sb = sanitizeSceneBrief(b);
  return (
    sa.title === sb.title && sa.setting === sb.setting && sa.timeOfDay === sb.timeOfDay &&
    sa.emotionalTone === sb.emotionalTone && sa.familiarAction === sb.familiarAction &&
    sa.composition === sb.composition && sa.caption === sb.caption &&
    sa.visualMotifs.length === sb.visualMotifs.length &&
    sa.visualMotifs.every((m, i) => m === sb.visualMotifs[i])
  );
}

/* ── Server-verified source metadata → typed provenance ───────────────────────*/

/** The SERVER-verified sources a Little Memory is grounded in (never client-claimed). */
export interface LittleMemorySource {
  /** The source Diary Page's local calendar date (YYYY-MM-DD). */
  date: string;
  diaryPage: { id: string; title: string; date: string; excerpt: string };
  /** Explicitly chosen ACTIVE Memory Seeds (may be empty). */
  seeds: Array<{ id: string; text: string }>;
}

const label = (s: string): string => {
  const t = (s || '').replace(/\s+/g, ' ').trim();
  return t.length > LABEL_MAX ? `${t.slice(0, LABEL_MAX - 1).trimEnd()}…` : t;
};

/** Build the typed, labelled source refs from the verified source (all available). */
export function buildLittleMemorySourceRefs(source: LittleMemorySource): LittleMemorySourceRef[] {
  const refs: LittleMemorySourceRef[] = [
    {
      kind: 'diaryPage',
      id: source.diaryPage.id,
      availability: 'available',
      label: label(`${source.diaryPage.title || 'Untitled page'} · ${source.diaryPage.date}`),
    },
  ];
  for (const s of source.seeds) {
    refs.push({ kind: 'memorySeed', id: s.id, availability: 'available', label: label(s.text) });
  }
  return refs;
}

/**
 * Validate a user-approved brief plus its verified source before a durable save.
 * The brief must be a valid closed shape; the source must carry exactly one
 * diaryPage and a well-formed date.
 */
export function validateLittleMemoryForApproval(
  approved: SceneBriefFields,
  source: LittleMemorySource
): SceneBriefVerdict {
  const shape = validateSceneBriefShape(approved as unknown);
  if (shape.ok === false) return shape;
  if (!source || typeof source !== 'object') return { ok: false, reason: 'missing_source' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(source.date)) return { ok: false, reason: 'missing_source_date' };
  if (!source.diaryPage || typeof source.diaryPage.id !== 'string' || !source.diaryPage.id.trim()) {
    return { ok: false, reason: 'missing_diary_source' };
  }
  if (!Array.isArray(source.seeds)) return { ok: false, reason: 'malformed_seed_sources' };
  return { ok: true };
}

/**
 * Build the canonical Little Memory record. PURE: the SERVER calls this inside a
 * create-once transaction, choosing `now`. Trusted provenance (sourceRefs,
 * labels, date) comes only from the verified source. `editedByUser` is non-
 * authoritative UX metadata derived from the client-returned draft fields.
 */
export function buildCanonicalLittleMemory(args: {
  userId: string;
  source: LittleMemorySource;
  draftFields: SceneBriefFields;
  approvedFields: SceneBriefFields;
  now: number;
}): Omit<LittleMemory, 'id'> {
  const fields = sanitizeSceneBrief(args.approvedFields);
  const editedByUser = !sceneBriefEquals(args.approvedFields, args.draftFields);
  return {
    kind: 'littleMemory',
    userId: args.userId,
    status: 'brief_approved',
    date: args.source.date,
    ...fields,
    sourceRefs: buildLittleMemorySourceRefs(args.source),
    aiAssisted: true,
    approvedByUser: true,
    editedByUser,
    createdAt: args.now,
    confirmedAt: args.now,
  };
}

/**
 * Mark one source reference unavailable (used when the user deletes a source
 * page/seed but keeps this Little Memory). No source prose is stored, so nothing
 * is lost or resurrected — only the typed ref's availability flips.
 */
export function markLittleMemorySourceUnavailable(
  lm: LittleMemory,
  refKind: 'diaryPage' | 'memorySeed',
  refId: string
): LittleMemory {
  return {
    ...lm,
    sourceRefs: lm.sourceRefs.map((r) =>
      r.kind === refKind && r.id === refId ? { ...r, availability: 'unavailable' } : r
    ),
  };
}
