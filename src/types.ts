export type ReflectionMode =
  | 'deep_reflection'
  | 'summary'
  | 'brainstorm'
  | 'action_plan'
  | 'mindful_chat';

export type MoodType =
  | 'serene'
  | 'inspired'
  | 'grateful'
  | 'thoughtful'
  | 'anxious'
  | 'frustrated'
  | 'neutral';

export interface MessageTurn {
  id: string;
  role: 'user' | 'model';
  content: string;
  timestamp: number;
}

export type GenerationStatus = 'pending' | 'complete' | 'failed';

export interface JournalInteraction {
  id?: string;
  userId: string;
  userEmail?: string;
  title: string;
  initialPrompt: string;
  reflectionOutput: string;
  mode: ReflectionMode;
  mood: MoodType;
  tags: string[];
  turns: MessageTurn[];
  modelUsed?: string;
  createdAt: number;
  updatedAt: number;
  isFavorite?: boolean;
  /** Gate C: raw entry is persisted first with status 'pending'. */
  generationStatus?: GenerationStatus;
  /** Gate D: timing evidence (raw write, gemini attempts, derived write). */
  timings?: Record<string, unknown>;
}

export interface UserAuthProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

export interface FilterState {
  searchQuery: string;
  selectedMode: ReflectionMode | 'all';
  selectedMood: MoodType | 'all';
  onlyFavorites: boolean;
  sortBy: 'newest' | 'oldest';
}

/* ── PF-01: Diary Pages ──────────────────────────────────────────────────────
 * Conversation (JournalInteraction) is the PROCESS; a Diary Page is the
 * user-owned RESULT, created only by explicit confirmation. The `kind`
 * discriminator makes the two types impossible to confuse in code and UI.
 */

export interface DiaryDraftFields {
  title: string;
  date: string; // YYYY-MM-DD
  todayInMyWords: string;
  whatFeltImportant: string[]; // 1-2 short items
  carryForward?: string;
}

export interface DiaryPage extends DiaryDraftFields {
  kind: 'diaryPage';
  id?: string;
  userId: string;
  sourceInteractionId: string;
  sourceTurnIds: string[];
  aiAssisted: true;
  status: 'confirmed';
  createdAt: number;
  confirmedAt: number;
  editedByUser: boolean;
}

export function isDiaryPage(value: unknown): value is DiaryPage {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (value as { kind?: unknown }).kind === 'diaryPage' &&
      (value as { status?: unknown }).status === 'confirmed'
  );
}

/* ── PF-CORE-01: Growth Roots — Memory Seeds & Familiar origin/stage ──────────
 * A Memory Seed is a user-approved, provenance-bearing fragment the familiar is
 * allowed to hold. It is a SEPARATE artefact from Diary Pages and Conversations.
 * Only an explicit approval creates one; only 'active' seeds may enter model
 * context. Records are self-contained (typed sourceRefs, visible excerpt) with
 * no hidden raw-source snapshot.
 */

export type MemorySeedStatus = 'active' | 'revoked';

export interface SeedSourceRef {
  kind: 'diaryPage';
  id: string;
  availability: 'available' | 'unavailable';
}

export interface MemorySeed {
  kind: 'memorySeed';
  id?: string;
  userId: string;
  status: MemorySeedStatus;
  /** The visible, user-approved seed sentence (editable before approval). */
  text: string;
  /** A short, verified excerpt from the source page (server-fetched, shown). */
  sourceExcerpt: string;
  /** The source page's local calendar date (YYYY-MM-DD). */
  sourceDate: string;
  sourceRefs: SeedSourceRef[];
  aiAssisted: true;
  approvedByUser: true;
  editedByUser: boolean;
  createdAt: number;
  confirmedAt: number;
  revokedAt?: number;
}

export function isMemorySeed(v: unknown): v is MemorySeed {
  return Boolean(
    v && typeof v === 'object' &&
    (v as { kind?: unknown }).kind === 'memorySeed' &&
    ((v as { status?: unknown }).status === 'active' || (v as { status?: unknown }).status === 'revoked')
  );
}

/* ── PF-CORE-03A: Little Memories — user-approved scene briefs ─────────────────
 * A Little Memory is the truthful, provenance-bearing record that PRECEDES CG
 * generation. It is created only by an explicit user approval of an AI-assisted
 * scene brief drafted from a confirmed Diary Page plus zero or more explicitly
 * chosen ACTIVE Memory Seeds. In 03A it carries NO image URL and makes NO
 * "generated"/"ready" claim: real image generation is PF-CORE-03B. The `kind`
 * discriminator keeps it distinct from Conversations, Diary Pages and Seeds.
 */

/** Only the states actually implemented in 03A. A draft is client-only (never persisted). */
export type LittleMemoryStatus = 'brief_approved';

/**
 * PF-CORE-03B: the illustration lifecycle for a Little Memory.
 *
 * The current usable illustration and the in-flight/last-failed attempt are kept
 * in SEPARATE fields (`image` vs `pendingGeneration`), so a regeneration can be
 * pending or fail WITHOUT ever destroying the last good picture (closure P0-3).
 * Bytes never live here — only bounded, server-owned metadata; there is no public
 * URL. This union is the UI-facing DISPLAY status derived from those two fields.
 */
export type LittleMemoryImageStatus = 'not_generated' | 'generating' | 'ready' | 'failed' | 'stale';

/**
 * The CURRENT usable illustration. Only ever `ready` or `stale` — a value here
 * means real bytes exist in private storage. `stale` means the approved brief was
 * edited after this image was generated (still viewable, honestly labelled).
 */
export interface LittleMemoryImage {
  status: 'ready' | 'stale';
  /** Server-derived id of the generation attempt that produced this image. */
  generationId?: string;
  /** The image model used (e.g. gemini-3.1-flash-image). */
  model?: string;
  /** Private, user-scoped Cloud Storage object path (server-derived; never public). */
  objectPath?: string;
  mimeType?: string;
  generatedAt?: number;
  /** Deterministic fingerprint of the approved brief this image was made from. */
  briefFingerprint?: string;
}

/**
 * An in-flight (`generating`) or last-failed (`failed`) generation attempt, kept
 * SEPARATE from the current `image` so a pending or failed replacement never
 * overwrites the last usable illustration (closure P0-3). Promoted into `image`
 * atomically only on success; a failure leaves `image` untouched.
 */
export interface LittleMemoryPendingGeneration {
  status: 'generating' | 'failed';
  /** Server-derived id for THIS attempt (one billable attempt = one stable id). */
  generationId: string;
  /** The image model used (e.g. gemini-3.1-flash-image). */
  model: string;
  /** Deterministic fingerprint of the approved brief this attempt targets. */
  briefFingerprint: string;
  /** When this attempt started (server clock). */
  attemptStartedAt: number;
  /** Bounded, non-raw failure category (never a raw provider error). */
  failureCode?: string;
}

export interface LittleMemorySourceRef {
  /** A Little Memory is grounded in exactly one Diary Page plus 0..n Memory Seeds. */
  kind: 'diaryPage' | 'memorySeed';
  id: string;
  availability: 'available' | 'unavailable';
  /** Short, server-derived label so the record stays honestly readable offline. */
  label: string;
}

/** The bounded, user-reviewed scene-brief fields (the only free-text a user edits). */
export interface SceneBriefFields {
  title: string;
  setting: string;
  timeOfDay: string;
  emotionalTone: string;
  familiarAction: string;
  visualMotifs: string[];
  composition: string;
  caption: string;
}

export interface LittleMemory extends SceneBriefFields {
  kind: 'littleMemory';
  id?: string;
  userId: string;
  status: LittleMemoryStatus;
  /** The source Diary Page's local calendar date (YYYY-MM-DD). */
  date: string;
  /** Typed provenance: exactly one diaryPage ref plus zero or more memorySeed refs. */
  sourceRefs: LittleMemorySourceRef[];
  aiAssisted: true;
  approvedByUser: true;
  editedByUser: boolean;
  createdAt: number;
  confirmedAt: number;
  /**
   * PF-CORE-03B: the CURRENT usable illustration (ready/stale). Absent on every
   * 03A record and until a first generation succeeds (reads as not_generated).
   * NEVER contains image bytes or a public URL.
   */
  image?: LittleMemoryImage;
  /**
   * PF-CORE-03B: the in-flight or last-failed generation attempt, kept separate
   * so it never clobbers `image` (closure P0-3). Cleared on successful promotion.
   */
  pendingGeneration?: LittleMemoryPendingGeneration;
}

export function isLittleMemory(v: unknown): v is LittleMemory {
  return Boolean(
    v && typeof v === 'object' &&
    (v as { kind?: unknown }).kind === 'littleMemory' &&
    (v as { status?: unknown }).status === 'brief_approved'
  );
}

export type FamiliarStage = 'companion' | 'keeper';
export type FamiliarOriginId = 'midnight';

export interface FamiliarProfile {
  kind: 'familiarProfile';
  id?: string;
  userId: string;
  originId: FamiliarOriginId;
  stage: FamiliarStage;
  createdAt: number;
  stageActivatedAt?: number;
}
