import {
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  getDocs,
  getDoc,
} from 'firebase/firestore';
import { db, stripUndefined } from './firebase';
import { DiaryPage, JournalInteraction, MemorySeed, FamiliarProfile, LittleMemory } from '../types';
import { defaultFamiliarProfile } from './familiar-origin';

/**
 * Save a new interaction/journal entry in the user's isolated subcollection
 * Path: /users/{userId}/interactions/{interactionId}
 */
export async function saveInteraction(
  userId: string,
  entry: Omit<JournalInteraction, 'id'>
): Promise<string> {
  if (!userId) {
    throw new Error('Authentication required: Missing userId for Firestore persistence.');
  }

  try {
    const interactionsRef = collection(db, 'users', userId, 'interactions');
    const newDocRef = doc(interactionsRef);
    const docId = newDocRef.id;

    const payload = stripUndefined({
      ...entry,
      id: docId,
      userId,
      createdAt: entry.createdAt || Date.now(),
      updatedAt: Date.now(),
    });

    await setDoc(newDocRef, payload);
    console.log(`[Firestore] Successfully saved interaction ${docId} for user ${userId}`);
    return docId;
  } catch (error: any) {
    console.error(`[Firestore Save Error] User ${userId}:`, error);
    throw new Error(`Failed to save journal reflection to Firestore: ${error.message || error}`);
  }
}

/**
 * Update an existing interaction (e.g. adding conversation turns, changing favorite flag)
 */
export async function updateInteraction(
  userId: string,
  interactionId: string,
  updates: Partial<JournalInteraction>
): Promise<void> {
  if (!userId || !interactionId) {
    throw new Error('Both userId and interactionId are required for updates.');
  }

  try {
    const docRef = doc(db, 'users', userId, 'interactions', interactionId);
    const sanitizedUpdates = stripUndefined({
      ...updates,
      updatedAt: Date.now(),
    });

    await updateDoc(docRef, sanitizedUpdates);
    console.log(`[Firestore] Successfully updated interaction ${interactionId}`);
  } catch (error: any) {
    console.error(`[Firestore Update Error] Interaction ${interactionId}:`, error);
    throw new Error(`Failed to update journal entry: ${error.message || error}`);
  }
}

/**
 * Delete an interaction
 */
export async function deleteInteraction(
  userId: string,
  interactionId: string
): Promise<void> {
  if (!userId || !interactionId) {
    throw new Error('Both userId and interactionId are required for deletion.');
  }

  try {
    const docRef = doc(db, 'users', userId, 'interactions', interactionId);
    await deleteDoc(docRef);
    console.log(`[Firestore] Successfully deleted interaction ${interactionId}`);
  } catch (error: any) {
    console.error(`[Firestore Delete Error] Interaction ${interactionId}:`, error);
    throw new Error(`Failed to delete journal entry: ${error.message || error}`);
  }
}

/**
 * Real-time subscription to the user's isolated interactions collection
 */
export function subscribeToUserInteractions(
  userId: string,
  onData: (entries: JournalInteraction[]) => void,
  onError?: (error: any) => void
): () => void {
  if (!userId) {
    onData([]);
    return () => {};
  }

  try {
    const interactionsRef = collection(db, 'users', userId, 'interactions');
    const q = query(interactionsRef, orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const entries: JournalInteraction[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data() as JournalInteraction;
          entries.push({
            ...data,
            id: docSnap.id,
          });
        });
        onData(entries);
      },
      (error) => {
        console.error(`[Firestore Subscription Error] User ${userId}:`, error);
        if (onError) onError(error);
      }
    );

    return unsubscribe;
  } catch (err) {
    console.error('Failed to establish Firestore subscription:', err);
    if (onError) onError(err);
    return () => {};
  }
}

/* ── PF-01: Diary Pages — separate collection, never mixed with conversations ─
 * Path: /users/{userId}/diaryPages/{pageId}
 */

/** Pre-allocate a page id so a retried save NEVER duplicates the page. */
export function newDiaryPageId(userId: string): string {
  return doc(collection(db, 'users', userId, 'diaryPages')).id;
}

/** Idempotent confirmed-page write: same pageId -> same document. */
export async function saveDiaryPage(userId: string, pageId: string, page: Omit<DiaryPage, 'id'>): Promise<void> {
  if (!userId || !pageId) {
    throw new Error('Authentication and pageId required for diary persistence.');
  }
  const ref = doc(db, 'users', userId, 'diaryPages', pageId);
  await setDoc(ref, stripUndefined({ ...page, id: pageId }));
}

export function subscribeToDiaryPages(
  userId: string,
  onData: (pages: DiaryPage[]) => void,
  onError?: (error: unknown) => void
): () => void {
  if (!userId) {
    onData([]);
    return () => {};
  }
  const ref = collection(db, 'users', userId, 'diaryPages');
  const q = query(ref, orderBy('confirmedAt', 'desc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const pages: DiaryPage[] = [];
      snapshot.forEach((docSnap) => pages.push({ ...(docSnap.data() as DiaryPage), id: docSnap.id }));
      onData(pages);
    },
    (error) => {
      console.error('[Firestore diaryPages subscription]', error);
      if (onError) onError(error);
    }
  );
}

/* ── PF-CORE-01: Memory Seeds — a separate, user-controlled collection ─────────
 * Path: /users/{userId}/memorySeeds/{seedId}
 * Never mixed with Diary Pages or Conversations.
 */

/** Pre-allocate a seed id so a retried approval NEVER duplicates the seed. */
export function newMemorySeedId(userId: string): string {
  return doc(collection(db, 'users', userId, 'memorySeeds')).id;
}

// NOTE (closure): canonical seed WRITES (confirm/edit/revoke/delete) are no
// longer performed here. Firestore rules deny direct client writes to
// memorySeeds; those mutations go through authenticated server transactions
// (src/lib/growth-client.ts -> /api/seeds/*). The client keeps a pre-allocated
// id for idempotency and reads results back through the subscription below.

export function subscribeToMemorySeeds(
  userId: string,
  onData: (seeds: MemorySeed[]) => void,
  onError?: (error: unknown) => void
): () => void {
  if (!userId) {
    onData([]);
    return () => {};
  }
  const ref = collection(db, 'users', userId, 'memorySeeds');
  const q = query(ref, orderBy('confirmedAt', 'desc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const seeds: MemorySeed[] = [];
      snapshot.forEach((docSnap) => seeds.push({ ...(docSnap.data() as MemorySeed), id: docSnap.id }));
      onData(seeds);
    },
    (error) => {
      console.error('[Firestore memorySeeds subscription]', error);
      if (onError) onError(error);
    }
  );
}

// NOTE (closure): source-page deletion + descendant cascade now runs as an
// authenticated server transaction (/api/source/delete) that re-reads
// descendants itself — the client no longer sends descendant ids/refs, and
// direct client deletion of a diaryPage is denied by rules.

/* ── PF-CORE-03A: Little Memories — a separate owned collection ────────────────
 * Path: /users/{userId}/littleMemories/{littleMemoryId}
 * Canonical WRITES (confirm/edit/delete) are server-only (rules deny direct
 * client writes); the client pre-allocates an id for idempotency and reads
 * results back through this subscription.
 */

/** Pre-allocate a Little Memory id so a retried approval NEVER duplicates it. */
export function newLittleMemoryId(userId: string): string {
  return doc(collection(db, 'users', userId, 'littleMemories')).id;
}

/** PF-CORE-03B: pre-allocate a generation id so a retried generate is idempotent. */
export function newLittleMemoryGenerationId(userId: string, littleMemoryId: string): string {
  return doc(collection(db, 'users', userId, 'littleMemories', littleMemoryId, 'generations')).id;
}

export function subscribeToLittleMemories(
  userId: string,
  onData: (items: LittleMemory[]) => void,
  onError?: (error: unknown) => void
): () => void {
  if (!userId) {
    onData([]);
    return () => {};
  }
  const ref = collection(db, 'users', userId, 'littleMemories');
  const q = query(ref, orderBy('confirmedAt', 'desc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const items: LittleMemory[] = [];
      snapshot.forEach((docSnap) => items.push({ ...(docSnap.data() as LittleMemory), id: docSnap.id }));
      onData(items);
    },
    (error) => {
      console.error('[Firestore littleMemories subscription]', error);
      if (onError) onError(error);
    }
  );
}

/* ── PF-CORE-01: Familiar profile (origin + stage) ────────────────────────────
 * Path: /users/{userId}/familiar/profile  (single fixed document)
 */

const FAMILIAR_PROFILE_DOC = 'profile';

/**
 * Read the profile, creating the default Midnight/Companion one on first use.
 * Only the Companion default is ever created client-side (rules enforce exactly
 * Midnight + Companion on create). The Keeper transition is server-only.
 */
export async function getOrInitFamiliarProfile(userId: string, now: number = Date.now()): Promise<FamiliarProfile> {
  if (!userId) throw new Error('Authentication required for the familiar profile.');
  const ref = doc(db, 'users', userId, 'familiar', FAMILIAR_PROFILE_DOC);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    return { ...(snap.data() as FamiliarProfile), id: FAMILIAR_PROFILE_DOC };
  }
  const fresh = defaultFamiliarProfile(userId, now);
  await setDoc(ref, stripUndefined({ ...fresh, id: FAMILIAR_PROFILE_DOC }));
  return { ...fresh, id: FAMILIAR_PROFILE_DOC };
}

export function subscribeToFamiliarProfile(
  userId: string,
  onData: (profile: FamiliarProfile | null) => void,
  onError?: (error: unknown) => void
): () => void {
  if (!userId) {
    onData(null);
    return () => {};
  }
  const ref = doc(db, 'users', userId, 'familiar', FAMILIAR_PROFILE_DOC);
  return onSnapshot(
    ref,
    (snap) => onData(snap.exists() ? { ...(snap.data() as FamiliarProfile), id: FAMILIAR_PROFILE_DOC } : null),
    (error) => {
      console.error('[Firestore familiar profile subscription]', error);
      if (onError) onError(error);
    }
  );
}
