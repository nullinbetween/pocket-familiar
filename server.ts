import path from 'path';
import express from 'express';
import dotenv from 'dotenv';
import { GoogleGenAI, Interactions } from '@google/genai';
import { initializeApp as initializeAdminApp, getApps as getAdminApps } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore as getAdminFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage as getAdminStorage } from 'firebase-admin/storage';
import { readFileSync } from 'fs';
import { createApp, VerifiedDiaryPage, GrowthStore, SourceDeletionChoice, PrivateImageStore, ImageGenerateResult } from './server/app';
import { MemorySeed, FamiliarProfile, LittleMemory, SceneBriefFields } from './src/types';
import { markSourceUnavailable } from './src/lib/memory-seed-flow';
import { markLittleMemorySourceUnavailable, sanitizeSceneBrief } from './src/lib/little-memory-flow';
import { sourcePlanFingerprint, seedPlanFingerprint } from './src/lib/deletion-plan';
import { buildImageInteractionRequest, validateGeneratedImageBytes } from './src/lib/little-memory-image';
import { ProjectConfigError, resolveProjectId } from './server/config';
import { cacheControlForStaticFile, HTML_CACHE_CONTROL } from './server/static-cache';

dotenv.config();

// Gate A: port follows the environment (Cloud Run contract) with a safe local fallback.
const PORT = Number.parseInt(process.env.PORT ?? '', 10) || 8080;

// Gate B: project binding FAILS CLOSED. A missing or unreviewed
// FIREBASE_PROJECT_ID refuses startup.
let FIREBASE_PROJECT_ID: string;
try {
  const resolved = resolveProjectId(process.env);
  FIREBASE_PROJECT_ID = resolved.projectId;
} catch (err) {
  if (err instanceof ProjectConfigError) {
    console.error(`[config] REFUSING TO START: ${err.message}`);
    process.exit(1);
  }
  throw err;
}

// Gate D: model ladder is configurable and must be verified by a real smoke test
// (scripts/gemini-smoke.mjs) — the AI Studio generated names are not trusted as-is.
const MODEL_LADDER = (process.env.GEMINI_MODELS ?? '')
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);
const DEFAULT_LADDER = [
  'gemini-3.6-flash',
  'gemini-3.1-flash-lite',
  'gemini-flash-latest',
  'gemini-3.7-flash',
];

const ATTEMPT_TIMEOUT_MS = Number.parseInt(process.env.GEMINI_ATTEMPT_TIMEOUT_MS ?? '', 10) || 15000;
const TOTAL_TIMEOUT_MS = Number.parseInt(process.env.GEMINI_TOTAL_TIMEOUT_MS ?? '', 10) || 40000;

// PF-CORE-03B: image generation. Default to Google's currently recommended image
// model (Imagen was deprecated/shut down Aug 2026); override via GEMINI_IMAGE_MODEL.
const GEMINI_IMAGE_MODEL = (process.env.GEMINI_IMAGE_MODEL ?? '').trim() || 'gemini-3.1-flash-image';
const IMAGE_ATTEMPT_TIMEOUT_MS = Number.parseInt(process.env.GEMINI_IMAGE_ATTEMPT_TIMEOUT_MS ?? '', 10) || 60000;

// Firebase Admin for ID-token verification (Gate B). Uses ADC on Cloud Run;
// honours FIREBASE_AUTH_EMULATOR_HOST for deterministic local/emulator testing.
if (getAdminApps().length === 0) {
  initializeAdminApp({ projectId: FIREBASE_PROJECT_ID });
}
const adminAuth = getAdminAuth();

// PF-CORE-01 closure: server-side Firestore for owner-verified source reads AND
// all trusted growth WRITES (seed confirm/edit/revoke/delete, source deletion,
// Keeper activation). Uses the SAME named database as the browser client
// (VITE_FIRESTORE_DATABASE_ID / FIRESTORE_DATABASE_ID); "(default)" when unset.
// Firestore rules deny these writes to the client, so the Admin SDK here is the
// only mutation path for canonical growth records.
const FIRESTORE_DATABASE_ID = (process.env.FIRESTORE_DATABASE_ID ?? '').trim();
const adminDb = FIRESTORE_DATABASE_ID
  ? getAdminFirestore(FIRESTORE_DATABASE_ID)
  : getAdminFirestore();

async function getDiaryPage(uid: string, pageId: string): Promise<VerifiedDiaryPage | null> {
  const snap = await adminDb.doc(`users/${uid}/diaryPages/${pageId}`).get();
  if (!snap.exists) return null;
  const d = snap.data() as Record<string, unknown>;
  // Defence in depth: the record must actually belong to this uid and be a
  // confirmed diary page before the server will treat it as a valid source.
  if (d.userId !== uid || d.kind !== 'diaryPage' || d.status !== 'confirmed') return null;
  return {
    id: pageId,
    userId: uid,
    status: 'confirmed',
    title: typeof d.title === 'string' ? d.title : '',
    date: typeof d.date === 'string' ? d.date : '',
    todayInMyWords: typeof d.todayInMyWords === 'string' ? d.todayInMyWords : '',
    whatFeltImportant: Array.isArray(d.whatFeltImportant)
      ? (d.whatFeltImportant as unknown[]).filter((x): x is string => typeof x === 'string')
      : [],
    carryForward: typeof d.carryForward === 'string' ? d.carryForward : undefined,
  };
}

const seedsCol = (uid: string) => adminDb.collection(`users/${uid}/memorySeeds`);
const seedDoc = (uid: string, id: string) => adminDb.doc(`users/${uid}/memorySeeds/${id}`);
const withId = (id: string, data: FirebaseFirestore.DocumentData): MemorySeed => ({ ...(data as MemorySeed), id });

// PF-CORE-03A: Little Memories — a separate owned collection.
const lmCol = (uid: string) => adminDb.collection(`users/${uid}/littleMemories`);
const lmDoc = (uid: string, id: string) => adminDb.doc(`users/${uid}/littleMemories/${id}`);
const lmWithId = (id: string, data: FirebaseFirestore.DocumentData): LittleMemory => ({ ...(data as LittleMemory), id });

// PF-CORE-01 closure: the trusted growth boundary, implemented with Admin SDK
// transactions. Admin writes bypass Firestore security rules, which now DENY the
// browser client these mutations — so this server is the only path that can
// create or change canonical growth records.
const growthStore: GrowthStore = {
  getDiaryPage,

  async confirmSeedOnce(uid, seedId, record) {
    const ref = seedDoc(uid, seedId);
    return adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) {
        // Idempotent: a lost-response retry returns the existing record unchanged.
        return { seed: withId(seedId, snap.data()!), created: false };
      }
      const toWrite = { ...record, id: seedId };
      tx.set(ref, toWrite);
      return { seed: { ...(record as Omit<MemorySeed, 'id'>), id: seedId }, created: true };
    });
  },

  async editSeedText(uid, seedId, text) {
    const ref = seedDoc(uid, seedId);
    return adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      const cur = withId(seedId, snap.data()!);
      if (cur.status !== 'active') return cur; // only active seeds are editable; no provenance change
      tx.update(ref, { text, editedByUser: true }); // provenance + timestamps untouched
      return { ...cur, text, editedByUser: true };
    });
  },

  async revokeSeedById(uid, seedId, now) {
    const ref = seedDoc(uid, seedId);
    return adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      const cur = withId(seedId, snap.data()!);
      if (cur.status === 'revoked') return cur; // idempotent; original revokedAt preserved
      tx.update(ref, { status: 'revoked', revokedAt: now });
      return { ...cur, status: 'revoked', revokedAt: now };
    });
  },

  async deleteSeedById(uid, seedId) {
    await seedDoc(uid, seedId).delete();
  },

  async previewSeedDeletion(uid, seedId) {
    const seedSnap = await seedDoc(uid, seedId).get();
    if (!seedSnap.exists) return null;
    const lmSnap = await lmCol(uid).get();
    const littleMemories = lmSnap.docs.map((d) => lmWithId(d.id, d.data()));
    const affectedLittleMemories = littleMemories
      .filter((lm) => (lm.sourceRefs ?? []).some((r) => r.kind === 'memorySeed' && r.id === seedId))
      .map((lm) => ({ littleMemoryId: lm.id ?? '', title: lm.title }));
    return { affectedLittleMemories, planVersion: seedPlanFingerprint(seedId, littleMemories) };
  },

  async deleteSeedWithLittleMemories(uid, seedId, expectedPlanVersion) {
    const ref = seedDoc(uid, seedId);
    return adminDb.runTransaction(async (tx) => {
      const seedSnap = await tx.get(ref);
      if (!seedSnap.exists) return { status: 'not_found' as const };
      const allLm = await tx.get(lmCol(uid));
      const littleMemories = allLm.docs.map((d) => lmWithId(d.id, d.data()));
      if (seedPlanFingerprint(seedId, littleMemories) !== expectedPlanVersion) {
        return { status: 'conflict' as const };
      }
      tx.delete(ref);
      let updatedLittleMemories = 0;
      for (const d of allLm.docs) {
        const lm = lmWithId(d.id, d.data());
        if (!(lm.sourceRefs ?? []).some((r) => r.kind === 'memorySeed' && r.id === seedId)) continue;
        // Keep the Little Memory; flip ONLY this seed ref to unavailable.
        tx.update(d.ref, { sourceRefs: markLittleMemorySourceUnavailable(lm, 'memorySeed', seedId).sourceRefs });
        updatedLittleMemories += 1;
      }
      return { status: 'ok' as const, updatedLittleMemories };
    });
  },

  async listActiveSeeds(uid, limit) {
    // PF-CORE-01 closure P0-3: equality-only query (auto-indexed — no manual
    // composite index needed) with deterministic ordering in trusted server
    // code. An equality filter PLUS orderBy on a different field would require a
    // manual composite index; ordering here instead keeps the app honest even
    // with the default automatic indexes.
    const cap = Math.max(1, Math.min(limit, 50));
    const snap = await seedsCol(uid).where('status', '==', 'active').limit(200).get();
    const seeds = snap.docs.map((d) => withId(d.id, d.data()));
    seeds.sort((a, b) => (b.confirmedAt ?? 0) - (a.confirmedAt ?? 0));
    return seeds.slice(0, cap);
  },

  async getActiveSeedsByIds(uid, ids) {
    // Equality-only reads (auto-indexed). Only owned + active seeds are returned;
    // anything missing/revoked/foreign is simply absent so the caller fails closed.
    const wanted = new Set(ids);
    if (wanted.size === 0) return [];
    const snap = await seedsCol(uid).where('status', '==', 'active').limit(500).get();
    return snap.docs
      .map((d) => withId(d.id, d.data()))
      .filter((s) => s.id !== undefined && wanted.has(s.id) && s.status === 'active');
  },

  async confirmLittleMemoryOnce(uid, littleMemoryId, record) {
    const ref = lmDoc(uid, littleMemoryId);
    return adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) {
        return { littleMemory: lmWithId(littleMemoryId, snap.data()!), created: false };
      }
      tx.set(ref, { ...record, id: littleMemoryId });
      return { littleMemory: { ...(record as Omit<LittleMemory, 'id'>), id: littleMemoryId }, created: true };
    });
  },

  async editLittleMemory(uid, littleMemoryId, fields: SceneBriefFields) {
    const ref = lmDoc(uid, littleMemoryId);
    return adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      const cur = lmWithId(littleMemoryId, snap.data()!);
      const f = sanitizeSceneBrief(fields);
      // Only the reviewed brief fields change; provenance + timestamps are immutable.
      // A READY image no longer matches the edited brief → mark it stale.
      const update: Record<string, unknown> = { ...f, editedByUser: true };
      if (cur.image?.status === 'ready') update.image = { ...cur.image, status: 'stale' };
      tx.update(ref, update);
      return { ...cur, ...f, editedByUser: true, ...(cur.image?.status === 'ready' ? { image: { ...cur.image, status: 'stale' } } : {}) };
    });
  },

  async deleteLittleMemoryById(uid, littleMemoryId) {
    await lmDoc(uid, littleMemoryId).delete();
  },

  async getLittleMemory(uid, littleMemoryId) {
    const snap = await lmDoc(uid, littleMemoryId).get();
    if (!snap.exists) return null;
    const lm = lmWithId(littleMemoryId, snap.data()!);
    return lm.userId === uid ? lm : null;
  },

  async beginLittleMemoryGeneration(uid, littleMemoryId, generationId, model, fingerprint, now) {
    const ref = lmDoc(uid, littleMemoryId);
    return adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { status: 'not_found' as const };
      const cur = lmWithId(littleMemoryId, snap.data()!);
      if (cur.userId !== uid) return { status: 'not_found' as const };
      if (cur.status !== 'brief_approved') return { status: 'not_approved' as const };
      // Idempotent: this exact attempt already produced the current image (P0-2).
      if (cur.image?.generationId === generationId) {
        return { status: 'exists_ready' as const, littleMemory: cur };
      }
      // A failed id is terminal. Replaying it must not reopen the attempt and bill
      // the provider again; the client mints a new id only after observing failure.
      if (cur.pendingGeneration?.status === 'failed' && cur.pendingGeneration.generationId === generationId) {
        return { status: 'attempt_failed' as const, littleMemory: cur };
      }
      // An attempt (this id or another) is already generating → no second provider
      // call. Fail closed; no abandoned-attempt takeover in this closure (P0-2).
      if (cur.pendingGeneration?.status === 'generating') {
        return { status: 'in_progress' as const, littleMemory: cur };
      }
      // Fresh attempt: record the pending generation WITHOUT touching the current
      // image, so a pending/failed replacement never clobbers it (P0-3).
      const pendingGeneration = { status: 'generating' as const, generationId, model, briefFingerprint: fingerprint, attemptStartedAt: now };
      tx.update(ref, { pendingGeneration });
      return { status: 'started' as const, littleMemory: { ...cur, pendingGeneration } };
    });
  },

  async finalizeLittleMemoryGeneration(uid, littleMemoryId, generationId, meta) {
    const ref = lmDoc(uid, littleMemoryId);
    return adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { status: 'not_found' as const };
      const cur = lmWithId(littleMemoryId, snap.data()!);
      if (cur.userId !== uid) return { status: 'not_found' as const };
      // Only promote if this is still the current pending attempt (never overwrite a newer one).
      if (cur.pendingGeneration?.generationId !== generationId) return { status: 'superseded' as const };
      const displacedObjectPath = cur.image?.objectPath;
      const image = {
        status: 'ready' as const, generationId, model: meta.model, objectPath: meta.objectPath,
        mimeType: meta.mimeType, generatedAt: meta.generatedAt, briefFingerprint: meta.fingerprint,
      };
      // Atomic promotion: set the new image AND clear the pending attempt together.
      tx.update(ref, { image, pendingGeneration: FieldValue.delete() });
      const next: LittleMemory = { ...cur, image };
      delete next.pendingGeneration;
      return { status: 'ok' as const, littleMemory: next, displacedObjectPath };
    });
  },

  async failLittleMemoryGeneration(uid, littleMemoryId, generationId, failureCode) {
    const ref = lmDoc(uid, littleMemoryId);
    return adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { status: 'not_found' as const };
      const cur = lmWithId(littleMemoryId, snap.data()!);
      if (cur.userId !== uid) return { status: 'not_found' as const };
      if (cur.pendingGeneration?.generationId !== generationId) return { status: 'superseded' as const };
      // Mark only the pending attempt failed; the current image (if any) is untouched (P0-3).
      tx.update(ref, { pendingGeneration: { ...cur.pendingGeneration, status: 'failed', failureCode } });
      return { status: 'ok' as const };
    });
  },

  async previewSourceDeletion(uid, pageId) {
    const pageSnap = await adminDb.doc(`users/${uid}/diaryPages/${pageId}`).get();
    if (!pageSnap.exists) return null;
    const snap = await seedsCol(uid).get();
    const seeds = snap.docs.map((d) => withId(d.id, d.data()));
    const lmSnap = await lmCol(uid).get();
    const littleMemories = lmSnap.docs.map((d) => lmWithId(d.id, d.data()));
    const affectedSeeds = seeds
      .filter((s) => (s.sourceRefs ?? []).some((r) => r.kind === 'diaryPage' && r.id === pageId))
      .map((s) => ({ seedId: s.id ?? '', text: s.text }));
    const affectedLittleMemories = littleMemories
      .filter((lm) => (lm.sourceRefs ?? []).some((r) => r.kind === 'diaryPage' && r.id === pageId))
      .map((lm) => ({ littleMemoryId: lm.id ?? '', title: lm.title }));
    return { affectedSeeds, affectedLittleMemories, planVersion: sourcePlanFingerprint(pageId, seeds, littleMemories) };
  },

  async deleteSourceWithDescendants(uid, pageId, choice: SourceDeletionChoice, expectedPlanVersion) {
    const pageRef = adminDb.doc(`users/${uid}/diaryPages/${pageId}`);
    return adminDb.runTransaction(async (tx) => {
      // Verify the page and re-read ALL descendants (seeds + little memories) inside the transaction.
      const pageSnap = await tx.get(pageRef);
      const all = await tx.get(seedsCol(uid));
      const seeds = all.docs.map((d) => withId(d.id, d.data()));
      const allLm = await tx.get(lmCol(uid));
      const littleMemories = allLm.docs.map((d) => lmWithId(d.id, d.data()));
      // Recompute the fingerprint the user saw; commit only if it still matches.
      if (!pageSnap.exists || sourcePlanFingerprint(pageId, seeds, littleMemories) !== expectedPlanVersion) {
        return { status: 'conflict' as const };
      }
      let deletedSeeds = 0;
      let keptSeeds = 0;
      let deletedLittleMemories = 0;
      let keptLittleMemories = 0;
      tx.delete(pageRef);
      for (const d of all.docs) {
        const seed = withId(d.id, d.data());
        if (!seed.sourceRefs.some((r) => r.kind === 'diaryPage' && r.id === pageId)) continue;
        const onlySource = seed.sourceRefs.every((r) => r.kind === 'diaryPage' && r.id === pageId);
        if (choice === 'delete_descendants' && onlySource) {
          tx.delete(d.ref);
          deletedSeeds += 1;
        } else {
          tx.update(d.ref, { sourceRefs: markSourceUnavailable(seed, pageId).sourceRefs });
          keptSeeds += 1;
        }
      }
      for (const d of allLm.docs) {
        const lm = lmWithId(d.id, d.data());
        if (!(lm.sourceRefs ?? []).some((r) => r.kind === 'diaryPage' && r.id === pageId)) continue;
        // A Little Memory always has exactly one diaryPage source in 03A, so this
        // page being deleted orphans it. "keep" flips that ref to unavailable.
        const otherDiary = (lm.sourceRefs ?? []).some((r) => r.kind === 'diaryPage' && r.id !== pageId);
        if (choice === 'delete_descendants' && !otherDiary) {
          tx.delete(d.ref);
          deletedLittleMemories += 1;
        } else {
          tx.update(d.ref, { sourceRefs: markLittleMemorySourceUnavailable(lm, 'diaryPage', pageId).sourceRefs });
          keptLittleMemories += 1;
        }
      }
      return { status: 'ok' as const, deletedSeeds, keptSeeds, deletedLittleMemories, keptLittleMemories };
    });
  },

  async activateKeeper(uid, now, eligible) {
    const profileRef = adminDb.doc(`users/${uid}/familiar/profile`);
    return adminDb.runTransaction(async (tx) => {
      const psnap = await tx.get(profileRef);
      if (!psnap.exists) return { profile: null, outcome: 'no_profile' as const };
      const prof = { ...(psnap.data() as FamiliarProfile), id: 'profile' };
      if (prof.stage === 'keeper') return { profile: prof, outcome: 'already_keeper' as const };
      const seedsSnap = await tx.get(seedsCol(uid).where('status', '==', 'active'));
      const seeds = seedsSnap.docs.map((d) => withId(d.id, d.data()));
      if (!eligible(seeds)) return { profile: prof, outcome: 'not_ready' as const };
      tx.update(profileRef, { stage: 'keeper', stageActivatedAt: now });
      return { profile: { ...prof, stage: 'keeper', stageActivatedAt: now }, outcome: 'activated' as const };
    });
  },
};

// PF-CORE-03B: private, user-scoped media store on Cloud Storage. Bytes never
// touch Firestore or the browser bundle; objects are written private (no public
// URL) and read back only through the authenticated retrieval endpoint.
//
// Closure P0-5: the bucket is REQUIRED and explicit. Without a configured
// LITTLE_MEMORY_BUCKET there is no silent fallback to the project default bucket —
// the store is simply absent, and the generate/retrieval endpoints fail closed
// (503) before any provider/billing. Defence in depth: every object path is
// verified to live under this user's own Little Memory namespace before use.
const STORAGE_BUCKET = (process.env.LITTLE_MEMORY_BUCKET ?? '').trim();
// Cloud Storage bucket names are bare DNS-style names (not gs:// URLs). Keep this
// validation deliberately conservative so malformed configuration never reaches
// a billable generation attempt.
const STORAGE_BUCKET_VALID = /^(?=.{3,222}$)(?!.*\.\.)(?!\d{1,3}(?:\.\d{1,3}){3}$)[a-z0-9][a-z0-9._-]*[a-z0-9]$/.test(STORAGE_BUCKET);
const underOwnNamespace = (uid: string, objectPath: string): boolean =>
  /^[A-Za-z0-9_-]{1,128}$/.test(uid) &&
  !objectPath.includes('..') && !objectPath.includes('//') && !objectPath.endsWith('/') &&
  objectPath.startsWith(`users/${uid}/littleMemories/`);
let storageReadyUntil = 0;
let storageReadyCheck: Promise<void> | null = null;
const IMAGE_STORE_READY_TTL_MS = 60_000;
const imageStore: PrivateImageStore | undefined = STORAGE_BUCKET_VALID
  ? {
      async assertReady(_uid) {
        if (Date.now() < storageReadyUntil) return;
        if (!storageReadyCheck) {
          storageReadyCheck = (async () => {
            // Read-only and bounded: listing at most one object proves the named
            // bucket exists and this runtime identity can reach its object plane.
            // It does not create or delete a probe object.
            await getAdminStorage().bucket(STORAGE_BUCKET).getFiles({
              autoPaginate: false,
              maxResults: 1,
              prefix: 'users/',
            });
            storageReadyUntil = Date.now() + IMAGE_STORE_READY_TTL_MS;
          })().finally(() => { storageReadyCheck = null; });
        }
        await storageReadyCheck;
      },
      async putImage(uid, objectPath, bytes, mimeType) {
        if (!underOwnNamespace(uid, objectPath)) throw new Error('object_path_outside_user_namespace');
        const bucket = getAdminStorage().bucket(STORAGE_BUCKET);
        await bucket.file(objectPath).save(Buffer.from(bytes), {
          resumable: false,
          contentType: mimeType,
          metadata: { cacheControl: 'private, max-age=0, no-store' },
        });
      },
      async getImage(uid, objectPath) {
        if (!underOwnNamespace(uid, objectPath)) return null;
        const bucket = getAdminStorage().bucket(STORAGE_BUCKET);
        const file = bucket.file(objectPath);
        const [exists] = await file.exists();
        if (!exists) return null;
        const [meta] = await file.getMetadata();
        const [buf] = await file.download();
        return { bytes: new Uint8Array(buf), mimeType: (meta.contentType as string) || 'application/octet-stream' };
      },
      // Closure P0-4: delete exactly one object, only when it is under this user's
      // Little Memory namespace. Never a prefix.
      async deleteLittleMemoryObject(uid, objectPath) {
        if (!underOwnNamespace(uid, objectPath)) return;
        await getAdminStorage().bucket(STORAGE_BUCKET).file(objectPath).delete({ ignoreNotFound: true });
      },
      // Prefix-wide deletion — ONLY for an explicit whole-Little-Memory delete.
      async deleteLittleMemoryMedia(uid, littleMemoryId) {
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid) || !/^[A-Za-z0-9_-]{1,200}$/.test(littleMemoryId)) return;
        await getAdminStorage().bucket(STORAGE_BUCKET).deleteFiles({ prefix: `users/${uid}/littleMemories/${littleMemoryId}/`, force: true });
      },
    }
  : undefined;
if (!imageStore) {
  console.warn('[config] LITTLE_MEMORY_BUCKET is missing or invalid — illustration generation/retrieval will fail closed (503) until it is provisioned.');
}

// Packaged Midnight reference (character consistency). Never a user's face.
// Closure P0-5: load AND validate the canonical reference by its real file
// signature. If it is missing, unreadable, or not a valid image, it is treated as
// absent and the generate endpoint fails closed (503) before any provider call —
// generation never proceeds without the identity reference.
function loadMidnightReference(): { mimeType: string; base64: string } | undefined {
  try {
    const p = path.join(process.cwd(), 'public/assets/pocket-familiar/familiar/neutral.png');
    const bytes = readFileSync(p);
    const verdict = validateGeneratedImageBytes({ mimeType: 'image/png', bytes: new Uint8Array(bytes) });
    if (verdict.ok === false) {
      console.warn(`[config] canonical Midnight reference is invalid (${verdict.reason}); illustration generation will fail closed.`);
      return undefined;
    }
    return { mimeType: 'image/png', base64: bytes.toString('base64') };
  } catch {
    console.warn('[config] canonical Midnight reference is missing/unreadable; illustration generation will fail closed.');
    return undefined;
  }
}
const MIDNIGHT_REFERENCE = loadMidnightReference();

// Gemini client (server-side only; the key never reaches the browser).
let aiClient: GoogleGenAI | null = null;
function getAIClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is not configured');
  }
  if (!aiClient) {
    aiClient = new GoogleGenAI({ apiKey });
  }
  return aiClient;
}

const app = createApp({
  verifyIdToken: async (token) => {
    const decoded = await adminAuth.verifyIdToken(token);
    return { uid: decoded.uid };
  },
  generate: async ({ model, systemInstruction, contents, temperature, signal }) => {
    const ai = getAIClient();
    const response = await ai.models.generateContent({
      model,
      contents,
      config: {
        systemInstruction,
        temperature,
        abortSignal: signal,
      },
    });
    return { text: response?.text ?? null };
  },
  getDiaryPage,
  store: growthStore,
  seedContextLimit: 12,
  models: MODEL_LADDER.length > 0 ? MODEL_LADDER : DEFAULT_LADDER,
  attemptTimeoutMs: ATTEMPT_TIMEOUT_MS,
  totalTimeoutMs: TOTAL_TIMEOUT_MS,
  // PF-CORE-03B / closure P0-1: one image per attempt via the documented Google
  // GenAI Interactions API (ai.interactions.create) for gemini-3.1-flash-image.
  // The text brief and the canonical Midnight reference are sent as typed
  // interaction inputs, and image output is requested EXPLICITLY via
  // response_format {type:'image', aspect_ratio:'4:5', image_size:'1K'}.
  // Keep the wire request intentionally identical to the documented Gemini
  // Developer API example: do not send optional GAOS-only delivery controls or an
  // explicit `stream:false` field. The request and response remain fully typed —
  // no unsafe cast masking an unsupported SDK method. The generated image is read
  // from the typed output (output_image, then model_output image content fallback).
  generateImage: async ({ model, prompt, referenceImage, signal }): Promise<ImageGenerateResult> => {
    const ai = getAIClient();
    const interaction = await ai.interactions.create(
      buildImageInteractionRequest({ model, prompt, referenceImage }),
      { fetchOptions: { signal } }
    );

    const images: Array<{ mimeType: string; base64: string }> = [];
    const pushImage = (img?: Interactions.ImageContent) => {
      if (img && typeof img.data === 'string' && img.data.length > 0) {
        images.push({ mimeType: img.mime_type || 'image/png', base64: img.data });
      }
    };
    // Primary: the SDK's concatenated output image for the last model output.
    pushImage(interaction.output_image);
    // Fallback: walk model_output steps for any inline image content.
    if (images.length === 0) {
      for (const step of interaction.steps ?? []) {
        if (step.type !== 'model_output') continue;
        for (const content of step.content ?? []) {
          if (content.type === 'image') pushImage(content);
        }
      }
    }
    return { images };
  },
  imageStore,
  imageModel: GEMINI_IMAGE_MODEL,
  imageAttemptTimeoutMs: IMAGE_ATTEMPT_TIMEOUT_MS,
  imageReference: MIDNIGHT_REFERENCE,
  log: (msg) => console.log(msg),
});

// Static/dev serving, then listen.
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    // Development only: Vite/Rollup must never load in the production runtime
    // (round 1.1 fix 4). Dynamic import keeps it out of the production path.
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath, {
      setHeaders: (res, filePath) => {
        res.setHeader('Cache-Control', cacheControlForStaticFile(filePath));
      },
    }));
    app.get('*', (_req, res) => {
      // SPA routes all receive the current shell. Never cache the shell across
      // Cloud Run revisions: it names content-hashed bundles that may no longer
      // exist in a later image.
      res.setHeader('Cache-Control', HTML_CACHE_CONTROL);
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(
      `[Gemini Journal Server] listening on 0.0.0.0:${PORT} ` +
        `(NODE_ENV=${process.env.NODE_ENV ?? 'development'}, ` +
        `PORT env ${process.env.PORT ? 'provided' : 'absent -> fallback 8080'}, ` +
        `project=${FIREBASE_PROJECT_ID})`
    );
  });
}

startServer();
