import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';

/**
 * Gate E: emulator-backed evidence that
 *  - user A cannot read/update/delete user B's documents,
 *  - unauthenticated (signed-out) access to history fails.
 * Runs against the Firestore emulator (see npm run test:rules).
 */

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-rules-evidence',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8089,
    },
  });
  // Seed one document for user B, bypassing rules.
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users/user-b/interactions/entry-1'), {
      userId: 'user-b',
      initialPrompt: 'user B private journal text',
      createdAt: 1,
    });
    await setDoc(doc(ctx.firestore(), 'users/user-b/diaryPages/page-1'), {
      kind: 'diaryPage',
      userId: 'user-b',
      title: 'user B private diary page',
      status: 'confirmed',
      confirmedAt: 1,
    });
    await setDoc(doc(ctx.firestore(), 'users/user-b/memorySeeds/seed-1'), {
      kind: 'memorySeed',
      userId: 'user-b',
      status: 'active',
      text: 'user B private memory seed',
      confirmedAt: 1,
    });
    await setDoc(doc(ctx.firestore(), 'users/user-b/familiar/profile'), {
      kind: 'familiarProfile',
      userId: 'user-b',
      originId: 'midnight',
      stage: 'companion',
      createdAt: 1,
    });
    await setDoc(doc(ctx.firestore(), 'users/user-b/littleMemories/lm-1'), {
      kind: 'littleMemory',
      userId: 'user-b',
      status: 'brief_approved',
      title: 'user B private little memory',
      confirmedAt: 1,
    });
  });
});

afterAll(async () => {
  await env?.cleanup();
});

describe('Gate E: per-user isolation under firestore.rules', () => {
  it('user A can write and read their own interaction', async () => {
    const dbA = env.authenticatedContext('user-a').firestore();
    await assertSucceeds(
      setDoc(doc(dbA, 'users/user-a/interactions/mine-1'), {
        userId: 'user-a',
        initialPrompt: 'my own entry',
        createdAt: 2,
      })
    );
    await assertSucceeds(getDoc(doc(dbA, 'users/user-a/interactions/mine-1')));
  });

  it('user A cannot READ user B documents', async () => {
    const dbA = env.authenticatedContext('user-a').firestore();
    await assertFails(getDoc(doc(dbA, 'users/user-b/interactions/entry-1')));
    await assertFails(getDocs(collection(dbA, 'users/user-b/interactions')));
  });

  it('user A cannot UPDATE user B documents', async () => {
    const dbA = env.authenticatedContext('user-a').firestore();
    await assertFails(
      updateDoc(doc(dbA, 'users/user-b/interactions/entry-1'), { initialPrompt: 'tampered' })
    );
  });

  it('user A cannot DELETE user B documents', async () => {
    const dbA = env.authenticatedContext('user-a').firestore();
    await assertFails(deleteDoc(doc(dbA, 'users/user-b/interactions/entry-1')));
  });

  it('user A cannot CREATE documents under user B', async () => {
    const dbA = env.authenticatedContext('user-a').firestore();
    await assertFails(
      setDoc(doc(dbA, 'users/user-b/interactions/planted'), { userId: 'user-b' })
    );
  });

  it('signed-out (unauthenticated) access to any user history fails', async () => {
    const anon = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anon, 'users/user-b/interactions/entry-1')));
    await assertFails(getDocs(collection(anon, 'users/user-a/interactions')));
    await assertFails(getDocs(collection(anon, 'users/user-b/interactions')));
  });

  // PF-01 evidence 12 + PF-01.1 fix 4: diary pages are isolated AND canonical
  const validPage = (userId: string, pageId: string) => ({
    kind: 'diaryPage',
    userId,
    id: pageId,
    title: 'my page',
    date: '2026-09-02',
    todayInMyWords: 'my own words about today',
    whatFeltImportant: ['one thing'],
    sourceInteractionId: 'conv-1',
    sourceTurnIds: ['usr_1'],
    aiAssisted: true,
    status: 'confirmed',
    createdAt: 2,
    confirmedAt: 2,
    editedByUser: false,
  });

  it('user A can write/read their OWN canonical diary page', async () => {
    const dbA = env.authenticatedContext('user-a').firestore();
    await assertSucceeds(
      setDoc(doc(dbA, 'users/user-a/diaryPages/my-page'), validPage('user-a', 'my-page'))
    );
    await assertSucceeds(getDoc(doc(dbA, 'users/user-a/diaryPages/my-page')));
  });

  it('SAME-USER write of a status:draft page is denied (canonical only)', async () => {
    const dbA = env.authenticatedContext('user-a').firestore();
    await assertFails(
      setDoc(doc(dbA, 'users/user-a/diaryPages/draft-1'), {
        ...validPage('user-a', 'draft-1'),
        status: 'draft',
      })
    );
  });

  it('SAME-USER write with a foreign stored userId is denied', async () => {
    const dbA = env.authenticatedContext('user-a').firestore();
    await assertFails(
      setDoc(doc(dbA, 'users/user-a/diaryPages/spoof-1'), {
        ...validPage('user-b', 'spoof-1'),
      })
    );
  });

  it('SAME-USER write with missing provenance is denied', async () => {
    const dbA = env.authenticatedContext('user-a').firestore();
    const page: Record<string, unknown> = { ...validPage('user-a', 'noprov-1') };
    delete page.sourceInteractionId;
    await assertFails(setDoc(doc(dbA, 'users/user-a/diaryPages/noprov-1'), page));
  });

  it('SAME-USER write with malformed shape is denied (3 items / bad date / id mismatch)', async () => {
    const dbA = env.authenticatedContext('user-a').firestore();
    await assertFails(
      setDoc(doc(dbA, 'users/user-a/diaryPages/shape-1'), {
        ...validPage('user-a', 'shape-1'),
        whatFeltImportant: ['a', 'b', 'c'],
      })
    );
    await assertFails(
      setDoc(doc(dbA, 'users/user-a/diaryPages/shape-2'), {
        ...validPage('user-a', 'shape-2'),
        date: 'someday',
      })
    );
    await assertFails(
      setDoc(doc(dbA, 'users/user-a/diaryPages/shape-3'), {
        ...validPage('user-a', 'OTHER-ID'),
      })
    );
  });

  it('user A cannot READ/CREATE/UPDATE/DELETE user B diary pages', async () => {
    const dbA = env.authenticatedContext('user-a').firestore();
    await assertFails(getDoc(doc(dbA, 'users/user-b/diaryPages/page-1')));
    await assertFails(getDocs(collection(dbA, 'users/user-b/diaryPages')));
    await assertFails(setDoc(doc(dbA, 'users/user-b/diaryPages/planted'), { userId: 'user-b' }));
    await assertFails(updateDoc(doc(dbA, 'users/user-b/diaryPages/page-1'), { title: 'tampered' }));
    await assertFails(deleteDoc(doc(dbA, 'users/user-b/diaryPages/page-1')));
  });

  it('signed-out access to diary pages fails', async () => {
    const anon = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anon, 'users/user-b/diaryPages/page-1')));
    await assertFails(getDocs(collection(anon, 'users/user-a/diaryPages')));
  });

  const validSeed = (userId: string, seedId: string) => ({
    kind: 'memorySeed', userId, id: seedId, status: 'active', text: 'a small thing worth keeping',
    sourceExcerpt: 'an excerpt from my own page', sourceDate: '2026-09-02',
    sourceRefs: [{ kind: 'diaryPage', id: 'dp-1', availability: 'available' }],
    aiAssisted: true, approvedByUser: true, editedByUser: false, createdAt: 2, confirmedAt: 2,
  });

  // PF-CORE-01 closure P0-1: growth authority lives at a trusted server
  // boundary. The client may READ its own seeds but may NOT create/update/delete
  // them directly — those go through Admin-SDK server transactions.
  it('owner can READ own seeds but CANNOT create/update/delete them directly (server-only)', async () => {
    const dbA = env.authenticatedContext('user-a').firestore();
    await assertSucceeds(getDocs(collection(dbA, 'users/user-a/memorySeeds')));
    // forged "approved" seed creation is denied
    await assertFails(setDoc(doc(dbA, 'users/user-a/memorySeeds/forge-1'), validSeed('user-a', 'forge-1')));
    // seed a real record out-of-band, then prove the client cannot mutate it
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users/user-a/memorySeeds/real-1'), validSeed('user-a', 'real-1'));
      await setDoc(doc(ctx.firestore(), 'users/user-a/memorySeeds/real-2'), { ...validSeed('user-a', 'real-2'), status: 'revoked', revokedAt: 3 });
    });
    // provenance / text mutation denied
    await assertFails(updateDoc(doc(dbA, 'users/user-a/memorySeeds/real-1'), { sourceExcerpt: 'rewritten' }));
    await assertFails(updateDoc(doc(dbA, 'users/user-a/memorySeeds/real-1'), { text: 'tampered' }));
    // revoked -> active reactivation denied
    await assertFails(updateDoc(doc(dbA, 'users/user-a/memorySeeds/real-2'), { status: 'active' }));
    // direct delete denied
    await assertFails(deleteDoc(doc(dbA, 'users/user-a/memorySeeds/real-1')));
  });

  it('user A cannot READ or write user B memory seeds', async () => {
    const dbA = env.authenticatedContext('user-a').firestore();
    await assertFails(getDoc(doc(dbA, 'users/user-b/memorySeeds/seed-1')));
    await assertFails(getDocs(collection(dbA, 'users/user-b/memorySeeds')));
    await assertFails(setDoc(doc(dbA, 'users/user-b/memorySeeds/planted'), validSeed('user-b', 'planted')));
    await assertFails(deleteDoc(doc(dbA, 'users/user-b/memorySeeds/seed-1')));
  });

  // PF-CORE-03A: Little Memories — owner may READ only; create/update/delete are
  // server-only (Admin SDK), so a browser client cannot forge an approved brief,
  // spoof provenance, or write a generated/image claim by direct write.
  const validLittleMemory = (userId: string, id: string) => ({
    kind: 'littleMemory', userId, id, status: 'brief_approved', date: '2026-09-03',
    title: 'A pocket of calm', setting: 'a tree-lined street', timeOfDay: 'morning', emotionalTone: 'quiet relief',
    familiarAction: 'Midnight pads beside her', visualMotifs: ['morning light'], composition: 'wide low angle',
    caption: 'The walk home is mine again.',
    sourceRefs: [{ kind: 'diaryPage', id: 'dp-1', availability: 'available', label: 'A pocket of calm · 2026-09-03' }],
    aiAssisted: true, approvedByUser: true, editedByUser: false, createdAt: 2, confirmedAt: 2,
  });

  it('owner can READ own little memories but CANNOT create/update/delete them directly (server-only)', async () => {
    const dbA = env.authenticatedContext('user-a').firestore();
    await assertSucceeds(getDocs(collection(dbA, 'users/user-a/littleMemories')));
    // a well-formed forged create is denied (no client create rule exists)
    await assertFails(setDoc(doc(dbA, 'users/user-a/littleMemories/forge-1'), validLittleMemory('user-a', 'forge-1')));
    // a malformed create is likewise denied
    await assertFails(setDoc(doc(dbA, 'users/user-a/littleMemories/forge-2'), { kind: 'littleMemory', userId: 'user-a' }));
    // seed a real record out-of-band, then prove the client cannot mutate or delete it
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users/user-a/littleMemories/real-1'), validLittleMemory('user-a', 'real-1'));
    });
    await assertFails(updateDoc(doc(dbA, 'users/user-a/littleMemories/real-1'), { caption: 'tampered' }));
    await assertFails(updateDoc(doc(dbA, 'users/user-a/littleMemories/real-1'), { imageUrl: 'https://evil/x.png' }));
    await assertFails(deleteDoc(doc(dbA, 'users/user-a/littleMemories/real-1')));
  });

  it('user A cannot READ or write user B little memories', async () => {
    const dbA = env.authenticatedContext('user-a').firestore();
    await assertFails(getDoc(doc(dbA, 'users/user-b/littleMemories/lm-1')));
    await assertFails(getDocs(collection(dbA, 'users/user-b/littleMemories')));
    await assertFails(setDoc(doc(dbA, 'users/user-b/littleMemories/planted'), validLittleMemory('user-b', 'planted')));
    await assertFails(updateDoc(doc(dbA, 'users/user-b/littleMemories/lm-1'), { caption: 'tampered' }));
    await assertFails(deleteDoc(doc(dbA, 'users/user-b/littleMemories/lm-1')));
  });

  it('signed-out access to little memories fails', async () => {
    const anon = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anon, 'users/user-b/littleMemories/lm-1')));
    await assertFails(getDocs(collection(anon, 'users/user-a/littleMemories')));
  });

  // PF-CORE-01 closure P0-1: familiar profile.
  const companion = (userId: string) => ({ kind: 'familiarProfile', id: 'profile', userId, originId: 'midnight', stage: 'companion', createdAt: 2 });

  it('owner may create ONLY the fixed Midnight+Companion profile', async () => {
    const dbA = env.authenticatedContext('user-a').firestore();
    await assertSucceeds(setDoc(doc(dbA, 'users/user-a/familiar/profile'), companion('user-a')));
    await assertSucceeds(getDoc(doc(dbA, 'users/user-a/familiar/profile')));
  });

  it('client CANNOT directly set Keeper, change origin, use an alt doc id, or preset activation', async () => {
    const dbA = env.authenticatedContext('user-a').firestore();
    // direct keeper create denied
    await assertFails(setDoc(doc(dbA, 'users/user-a/familiar/profile2keeper'), { ...companion('user-a'), id: 'profile2keeper', stage: 'keeper' }));
    // keeper on the fixed doc denied
    await assertFails(setDoc(doc(dbA, 'users/user-a/familiar/profile'), { ...companion('user-a'), stage: 'keeper', stageActivatedAt: 1 }));
    // non-midnight origin denied
    await assertFails(setDoc(doc(dbA, 'users/user-a/familiar/profile'), { ...companion('user-a'), originId: 'ember' }));
    // alternate familiar doc id denied entirely (only /profile may exist)
    await assertFails(setDoc(doc(dbA, 'users/user-a/familiar/shadow'), { ...companion('user-a'), id: 'shadow' }));
    // preset stageActivatedAt on create denied
    await assertFails(setDoc(doc(dbA, 'users/user-a/familiar/profile'), { ...companion('user-a'), stageActivatedAt: 5 }));
  });

  it('client CANNOT update stage to Keeper, nor delete/recreate the profile (non-downgrade)', async () => {
    const dbA = env.authenticatedContext('user-a').firestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users/user-a/familiar/profile'), companion('user-a'));
    });
    await assertFails(updateDoc(doc(dbA, 'users/user-a/familiar/profile'), { stage: 'keeper', stageActivatedAt: 9 }));
    await assertFails(deleteDoc(doc(dbA, 'users/user-a/familiar/profile')));
  });

  it('user A cannot READ/UPDATE/DELETE user B familiar profile', async () => {
    const dbA = env.authenticatedContext('user-a').firestore();
    await assertFails(getDoc(doc(dbA, 'users/user-b/familiar/profile')));
    await assertFails(updateDoc(doc(dbA, 'users/user-b/familiar/profile'), { stage: 'keeper' }));
    await assertFails(deleteDoc(doc(dbA, 'users/user-b/familiar/profile')));
  });

  it('owner CANNOT directly delete a diary page (source deletion is server-only)', async () => {
    const dbA = env.authenticatedContext('user-a').firestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users/user-a/diaryPages/own-del'), {
        kind: 'diaryPage', userId: 'user-a', id: 'own-del', title: 't', date: '2026-09-02',
        todayInMyWords: 'x', whatFeltImportant: ['a'], sourceInteractionId: 'c', sourceTurnIds: ['u1'],
        aiAssisted: true, status: 'confirmed', createdAt: 1, confirmedAt: 1, editedByUser: false,
      });
    });
    await assertFails(deleteDoc(doc(dbA, 'users/user-a/diaryPages/own-del')));
  });

  it('signed-out access to seeds and familiar profile fails', async () => {
    const anon = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anon, 'users/user-b/memorySeeds/seed-1')));
    await assertFails(getDoc(doc(anon, 'users/user-b/familiar/profile')));
  });

  it('nested subcollections are closed for EVERYONE (blanket grant removed, PF-01.1 fix 4)', async () => {
    const dbA = env.authenticatedContext('user-a').firestore();
    await assertFails(
      setDoc(doc(dbA, 'users/user-b/interactions/entry-1/notes/n1'), { x: 1 })
    );
    // even the owner: the app declares no such path, so rules deny it
    await assertFails(
      setDoc(doc(dbA, 'users/user-a/interactions/mine-1/notes/n1'), { x: 1 })
    );
  });
});
