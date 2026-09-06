import { FamiliarState } from './familiar-state';

/**
 * Pocket Familiar brand surface — product-facing names, humane trust copy and
 * the accepted painterly art paths. Centralised so the visible identity stays
 * consistent and no engineering/SaaS language leaks into the primary UI.
 *
 * Art assets are the pipeline-accepted PNGs (see BUILD_COORDINATION addendum),
 * served from /assets/pocket-familiar. This module changes no behaviour, data
 * flow, endpoint or state logic — it is names, copy and image paths only.
 */

export const PRODUCT_NAME = 'Pocket Familiar' as const;

export const BRAND_COPY = {
  hero: 'A small companion for the days you want to remember.',
  support:
    'Write what happened. Your familiar helps you notice what mattered—and only keeps what you approve.',
  cta: 'Continue with Google',
  tagline: 'A small companion for the days you want to remember.',
} as const;

/** Humane, non-technical trust lines (never RBAC / rules / engine language). */
export const TRUST_COPY = {
  privateByDesign: 'Private by design',
  onlyYou: 'Only you can see your journal',
  approvalFirst: 'Nothing becomes a diary page until you approve it',
  gemini: 'Reflections by Gemini',
} as const;

const BASE = '/assets/pocket-familiar';

/** Large painterly familiar art, one per deterministic state. */
export const FAMILIAR_ART: Readonly<Record<FamiliarState, string>> = {
  quiet: `${BASE}/familiar/quiet.png`,
  listening: `${BASE}/familiar/neutral.png`,
  saving: `${BASE}/familiar/writing.png`,
  thinking: `${BASE}/familiar/thinking.png`,
  ready: `${BASE}/familiar/neutral.png`,
  drafting_page: `${BASE}/familiar/writing.png`,
  celebrating_save: `${BASE}/familiar/celebrating.png`,
  error_recoverable: `${BASE}/familiar/recoverable.png`,
};

/** Compact head-only runtime icons (96px accepted exports). */
export const FAMILIAR_HEAD: Readonly<Record<FamiliarState, string>> = {
  quiet: `${BASE}/qhead/quiet.png`,
  listening: `${BASE}/qhead/listening.png`,
  saving: `${BASE}/qhead/memory-seed.png`,
  thinking: `${BASE}/qhead/thinking.png`,
  ready: `${BASE}/qhead/ready.png`,
  drafting_page: `${BASE}/qhead/writing.png`,
  celebrating_save: `${BASE}/qhead/celebrating.png`,
  error_recoverable: `${BASE}/qhead/retry.png`,
};

export const LANDING_ART = {
  heroDesktop: `${BASE}/landing/landing-hero-desktop.png`,
  heroMobile: `${BASE}/landing/landing-hero-mobile.png`,
} as const;

/**
 * PF-CORE-01: accepted Stage-2 Midnight → Keeper artwork (CodeX-accepted, see
 * CODEX_ADDENDUM_2026-09-05_GROWTH_ROOTS_KEEPER_ASSETS_ACCEPTED.md). Replaceable
 * asset slots wired to app-owned stage state only — never model-selected. The
 * design board and expression sheet are intentionally NOT bundled at runtime.
 */
export const KEEPER_ART = {
  /** Pre-eligibility locked preview. */
  silhouette: `${BASE}/evolution/midnight-keeper/midnight-keeper-silhouette.png`,
  /** Deliberate transformation ceremony. */
  reveal: `${BASE}/evolution/midnight-keeper/midnight-keeper-reveal.png`,
  /**
   * Normal Keeper presence temporarily reuses the clean-alpha reveal pose.
   * The dedicated neutral master contains a baked checkerboard triangle at the
   * arm/waist gap and must not be shown until the art-lane v2 is accepted.
   */
  neutral: `${BASE}/evolution/midnight-keeper/midnight-keeper-reveal.png`,
  /** Keeper profile / archive (holding the journal). */
  holdingJournal: `${BASE}/evolution/midnight-keeper/midnight-keeper-holding-journal.png`,
} as const;

export const EMPTY_ART = {
  conversations: `${BASE}/empty/conversations.png`,
  diary: `${BASE}/empty/diary.png`,
} as const;

/** Short, human alt text carrying the familiar's visible state. */
export const FAMILIAR_ALT: Readonly<Record<FamiliarState, string>> = {
  quiet: 'Your familiar resting quietly',
  listening: 'Your familiar listening',
  saving: 'Your familiar keeping your words safe',
  thinking: 'Your familiar thinking',
  ready: 'Your familiar with a small thought ready',
  drafting_page: 'Your familiar drafting today’s page',
  celebrating_save: 'Your familiar quietly celebrating a kept page',
  error_recoverable: 'Your familiar waiting to try that step again',
};

/** Journal writing screen copy. */
export const JOURNAL_COPY = {
  title: 'Journal',
  prompt: 'What\u2019s on your mind?',
  privateLabel: 'Private',
} as const;

/**
 * Diary Page approval copy. Honest by design: this is an AI-assisted draft built
 * from the conversation text the user selected — approving it saves a Diary Page.
 * It is NOT a verbatim quote and does not create a future "memory" the familiar
 * recalls. Consent/provenance/validation logic is unchanged.
 */
export const KEEP_COPY = {
  heading: 'Keep this page?',
  body: 'An AI-assisted draft based on the conversation text you chose. Nothing is saved until you approve it.',
  reassurance: 'You choose what’s kept.',
  approve: 'Save Diary Page',
  edit: 'Edit',
  decline: 'Not now',
} as const;

export const NOT_SAVED_LABEL = 'AI-assisted draft — not saved yet' as const;

/**
 * Human-facing provenance views for the Memory library. These are presentation
 * projections of the EXISTING data model (confirmed diary pages, the user's own
 * turns, and the familiar's reflections) — no data-model change.
 */
export const PROVENANCE = {
  story: { key: 'story', label: 'From my story', source: 'You \u00b7 Journal' },
  told: { key: 'told', label: 'You told me', source: 'You \u00b7 Conversation' },
  thought: { key: 'thought', label: 'What I thought', source: 'Familiar \u00b7 Insight' },
} as const;

export const MEMORY_COPY = {
  title: 'Memory library',
  projectionNote: 'Two ways of seeing the same saved conversations.',
} as const;

/** Provenance columns: an accepted scene base plus a separate transparent familiar. */
export const MEMORY_COLUMNS = [
  { key: 'story', label: PROVENANCE.story.label, source: PROVENANCE.story.source, tone: 'pf-col-story', scene: `${BASE}/memory-columns/story.jpg`, familiar: FAMILIAR_ART.quiet },
  { key: 'told', label: PROVENANCE.told.label, source: PROVENANCE.told.source, tone: 'pf-col-told', scene: `${BASE}/memory-columns/told.jpg`, familiar: FAMILIAR_ART.listening },
  { key: 'thought', label: PROVENANCE.thought.label, source: PROVENANCE.thought.source, tone: 'pf-col-thought', scene: `${BASE}/memory-columns/thought.jpg`, familiar: FAMILIAR_ART.thinking },
] as const;
