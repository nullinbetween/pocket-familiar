import { MemorySeed, LittleMemory, SceneBriefFields } from '../types';
import { LittleMemorySource } from './little-memory-flow';

/**
 * PF-CORE-01 closure: browser wrappers for the trusted growth endpoints. The
 * client never writes canonical seeds, the familiar profile stage, or source
 * deletions directly (Firestore rules deny it) — it calls these authenticated
 * server transactions and reads results back through live subscriptions. Each
 * carries a fresh Firebase ID token.
 */

async function postJson<T>(getToken: () => Promise<string>, path: string, body: unknown): Promise<T> {
  const idToken = await getToken();
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const err = new Error((data && data.error) || `Server responded with status ${response.status}`) as Error & { status?: number };
    err.status = response.status;
    throw err;
  }
  return (await response.json()) as T;
}

/** Confirm (create-once) a canonical Memory Seed via the server transaction. */
export async function confirmSeed(
  getToken: () => Promise<string>,
  args: { diaryPageId: string; seedId: string; proposedText: string; editedText: string }
): Promise<{ seed: MemorySeed; created: boolean }> {
  return postJson(getToken, '/api/seeds/confirm', args);
}

/** Edit / revoke a seed via the server (provenance stays immutable). Permanent
 * deletion is a separate, stale-safe preview/confirm flow — see deleteSeed(). */
export async function mutateSeed(
  getToken: () => Promise<string>,
  args: { seedId: string; op: 'edit' | 'revoke'; text?: string }
): Promise<{ success: true; seed?: MemorySeed }> {
  return postJson(getToken, '/api/seeds/mutate', args);
}

export interface SeedDeletionPreview {
  affectedLittleMemories: Array<{ littleMemoryId: string; title: string }>;
  planVersion: string;
}

/** Server-authoritative preview of a Memory Seed deletion (Little Memories kept). */
export async function previewSeedDeletion(
  getToken: () => Promise<string>,
  args: { seedId: string }
): Promise<SeedDeletionPreview> {
  const r = await postJson<{ affectedLittleMemories?: SeedDeletionPreview['affectedLittleMemories']; planVersion: string }>(
    getToken,
    '/api/seeds/preview-delete',
    args
  );
  return { affectedLittleMemories: r.affectedLittleMemories ?? [], planVersion: r.planVersion };
}

export class SeedPlanChangedError extends Error {
  constructor() {
    super('seed_plan_changed');
    this.name = 'SeedPlanChangedError';
  }
}

/**
 * Delete a Memory Seed. Carries the planVersion from the preview the user saw; if
 * the referencing Little Memories changed since then the server returns 409 and
 * this throws SeedPlanChangedError (no writes) so the UI can re-preview. Never
 * deletes a Little Memory; only flips the affected seed ref to unavailable.
 */
export async function deleteSeed(
  getToken: () => Promise<string>,
  args: { seedId: string; planVersion: string }
): Promise<{ success: true; updatedLittleMemories: number }> {
  try {
    return await postJson(getToken, '/api/seeds/delete', args);
  } catch (err) {
    if ((err as { status?: number }).status === 409) throw new SeedPlanChangedError();
    throw err;
  }
}

export interface SourceDeletionPreview {
  affectedSeeds: Array<{ seedId: string; text: string }>;
  affectedLittleMemories: Array<{ littleMemoryId: string; title: string }>;
  planVersion: string;
}

/** Server-authoritative preview of a source deletion (what the user must see). */
export async function previewSource(
  getToken: () => Promise<string>,
  args: { diaryPageId: string }
): Promise<SourceDeletionPreview> {
  const r = await postJson<{
    affectedSeeds: SourceDeletionPreview['affectedSeeds'];
    affectedLittleMemories?: SourceDeletionPreview['affectedLittleMemories'];
    planVersion: string;
  }>(getToken, '/api/source/preview', args);
  return { affectedSeeds: r.affectedSeeds, affectedLittleMemories: r.affectedLittleMemories ?? [], planVersion: r.planVersion };
}

/* ── PF-CORE-03A: Little Memory scene brief (draft → confirm → edit/delete) ────*/

export interface LittleMemoryDraftResult {
  draft: SceneBriefFields;
  source: LittleMemorySource;
}

/** Ask the server for an AI-assisted scene brief from chosen sources (a DRAFT only). */
export async function draftLittleMemory(
  getToken: () => Promise<string>,
  args: { diaryPageId: string; seedIds: string[] }
): Promise<LittleMemoryDraftResult> {
  const r = await postJson<LittleMemoryDraftResult>(getToken, '/api/gemini/little-memory-draft', args);
  return { draft: r.draft, source: r.source };
}

/** Confirm (create-once) a Little Memory from the exact user-reviewed fields. */
export async function confirmLittleMemory(
  getToken: () => Promise<string>,
  args: { littleMemoryId: string; diaryPageId: string; seedIds: string[]; draftFields: SceneBriefFields; approvedFields: SceneBriefFields }
): Promise<{ littleMemory: LittleMemory; created: boolean }> {
  return postJson(getToken, '/api/little-memory/confirm', args);
}

/** Edit / delete a Little Memory via the server (scoped to the record; never its sources). */
export async function mutateLittleMemory(
  getToken: () => Promise<string>,
  args: { littleMemoryId: string; op: 'edit' | 'delete'; fields?: SceneBriefFields }
): Promise<{ success: true; littleMemory?: LittleMemory }> {
  return postJson(getToken, '/api/little-memory/mutate', args);
}

/* ── PF-CORE-03B: generate one real illustration + retrieve it privately ───────*/

/** Generate one illustration for an approved Little Memory (explicit action, idempotent by generationId). */
export async function generateLittleMemory(
  getToken: () => Promise<string>,
  args: { littleMemoryId: string; generationId: string }
): Promise<{ littleMemory?: LittleMemory; alreadyReady?: boolean; inProgress?: boolean }> {
  return postJson(getToken, '/api/little-memory/generate', args);
}

/**
 * Fetch a generated illustration's bytes through the authenticated, private
 * retrieval endpoint (no public URL). Returns a Blob the caller turns into an
 * object URL for display.
 */
export async function fetchLittleMemoryImage(
  getToken: () => Promise<string>,
  args: { littleMemoryId: string }
): Promise<Blob> {
  const idToken = await getToken();
  const resp = await fetch(`/api/little-memory/image?littleMemoryId=${encodeURIComponent(args.littleMemoryId)}`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!resp.ok) {
    const err = new Error(`Illustration unavailable (status ${resp.status})`) as Error & { status?: number };
    err.status = resp.status;
    throw err;
  }
  return await resp.blob();
}

export class SourcePlanChangedError extends Error {
  constructor() {
    super('source_plan_changed');
    this.name = 'SourcePlanChangedError';
  }
}

/**
 * Delete a source Diary Page. Must carry the `planVersion` from the preview the
 * user saw; if the affected memories changed since then the server returns 409
 * and this throws `SourcePlanChangedError` (no writes) so the UI can re-preview.
 */
export async function deleteSource(
  getToken: () => Promise<string>,
  args: { diaryPageId: string; choice: 'delete_descendants' | 'keep_marked_unavailable'; planVersion: string }
): Promise<{ success: true; deletedSeeds: number; keptSeeds: number }> {
  try {
    return await postJson(getToken, '/api/source/delete', args);
  } catch (err) {
    if ((err as { status?: number }).status === 409) throw new SourcePlanChangedError();
    throw err;
  }
}

/**
 * Begin the Keeper chapter via the server (one-way, idempotent). Resolves with
 * the outcome; a 409 "not_ready" is surfaced as outcome 'not_ready' rather than
 * thrown, so the UI can explain eligibility honestly.
 */
export async function activateKeeper(
  getToken: () => Promise<string>
): Promise<{ outcome: 'activated' | 'already_keeper' | 'not_ready' | 'no_profile' }> {
  try {
    const r = await postJson<{ outcome: 'activated' | 'already_keeper' }>(getToken, '/api/familiar/activate-keeper', {});
    return { outcome: r.outcome };
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 409) return { outcome: 'not_ready' };
    if (status === 404) return { outcome: 'no_profile' };
    throw err;
  }
}
