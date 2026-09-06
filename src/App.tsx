import React, { useState, useEffect, useRef } from 'react';
import { subscribeToAuthState, signInWithGoogle, logOut, getIdTokenOrThrow } from './lib/firebase';
import {
  subscribeToDiaryPages,
  subscribeToUserInteractions,
  subscribeToMemorySeeds,
  subscribeToLittleMemories,
  subscribeToFamiliarProfile,
  getOrInitFamiliarProfile,
  newMemorySeedId,
  newLittleMemoryId,
  newLittleMemoryGenerationId,
} from './lib/firestore-service';
import { UserAuthProfile, JournalInteraction, DiaryPage, MemorySeed, LittleMemory, FamiliarProfile, SceneBriefFields } from './types';
import { SeedProposal } from './lib/memory-seed-flow';
import { activeSeeds as activeSeedsOf } from './lib/memory-seed-flow';
import { createLittleMemoryGenerationController } from './lib/little-memory-generation';
import { requestSeedProposal } from './lib/seed-proposal-client';
import { confirmSeed, mutateSeed, deleteSource, previewSource, activateKeeper, SourcePlanChangedError, SourceDeletionPreview, draftLittleMemory, confirmLittleMemory, mutateLittleMemory, previewSeedDeletion, deleteSeed, SeedPlanChangedError, SeedDeletionPreview, generateLittleMemory, fetchLittleMemoryImage } from './lib/growth-client';
import { Navbar, ActiveTab } from './components/Navbar';
import { LandingHero } from './components/LandingHero';
import { ReflectionWorkspace } from './components/ReflectionWorkspace';
import { MemoryLibrary } from './components/MemoryLibrary';
import { EntryDetailModal } from './components/EntryDetailModal';
import { FamiliarHome } from './components/FamiliarHome';
import { MemorySeedProposal } from './components/MemorySeedProposal';
import { SourceDeletionDialog } from './components/SourceDeletionDialog';
import { SeedDeletionDialog } from './components/SeedDeletionDialog';
import { DiaryPageReader } from './components/DiaryPageReader';
import { LittleMemoryAlbum } from './components/LittleMemoryAlbum';
import { Loader2 } from 'lucide-react';

export default function App() {
  const [currentUser, setCurrentUser] = useState<UserAuthProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  const [activeTab, setActiveTab] = useState<ActiveTab>('journal');
  const [activeInteraction, setActiveInteraction] = useState<JournalInteraction | null>(null);
  const [entries, setEntries] = useState<JournalInteraction[]>([]);
  const [diaryPages, setDiaryPages] = useState<DiaryPage[]>([]);
  const [memorySeeds, setMemorySeeds] = useState<MemorySeed[]>([]);
  const [littleMemories, setLittleMemories] = useState<LittleMemory[]>([]);
  const [littleFocusId, setLittleFocusId] = useState<string | null>(null);
  const [familiarFocusSeedId, setFamiliarFocusSeedId] = useState<string | null>(null);
  const [familiarProfile, setFamiliarProfile] = useState<FamiliarProfile | null>(null);
  const [modalEntry, setModalEntry] = useState<JournalInteraction | null>(null);
  const [firestoreError, setFirestoreError] = useState<string | null>(null);

  // PF-CORE-01 transient UI state (never durable): an open proposal and the
  // pre-allocated seedId that keeps a retried approval idempotent.
  const [proposalPage, setProposalPage] = useState<DiaryPage | null>(null);
  const [proposalSeedId, setProposalSeedId] = useState<string | null>(null);
  const [deletionPage, setDeletionPage] = useState<DiaryPage | null>(null);
  const [deletionPreview, setDeletionPreview] = useState<SourceDeletionPreview | null>(null);
  const [deletionLoading, setDeletionLoading] = useState(false);
  const [deletionConflict, setDeletionConflict] = useState<string | null>(null);
  const [sourceReaderPage, setSourceReaderPage] = useState<DiaryPage | null>(null);
  // PF-CORE-03A P0-2: stale-safe Memory Seed deletion (server preview → confirm).
  const [seedDeletion, setSeedDeletion] = useState<MemorySeed | null>(null);
  const [seedDeletionPreview, setSeedDeletionPreview] = useState<SeedDeletionPreview | null>(null);
  const [seedDeletionLoading, setSeedDeletionLoading] = useState(false);
  const [seedDeletionConflict, setSeedDeletionConflict] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeToAuthState((user) => {
      if (user) {
        setCurrentUser({ uid: user.uid, email: user.email, displayName: user.displayName, photoURL: user.photoURL });
      } else {
        setCurrentUser(null); setActiveInteraction(null); setEntries([]); setDiaryPages([]);
        setMemorySeeds([]); setLittleMemories([]); setFamiliarProfile(null);
      }
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!currentUser?.uid) return;
    setFirestoreError(null);
    const unsubscribe = subscribeToUserInteractions(
      currentUser.uid,
      (updatedEntries) => {
        setEntries(updatedEntries);
        if (activeInteraction?.id) {
          const fresh = updatedEntries.find((e) => e.id === activeInteraction.id);
          if (fresh) setActiveInteraction(fresh);
        }
      },
      (err) => { console.error('Firestore subscription error:', err); setFirestoreError('We’re having trouble syncing right now — trying again…'); }
    );
    return () => unsubscribe();
  }, [currentUser?.uid]);

  useEffect(() => {
    if (!currentUser?.uid) return;
    const unsubscribe = subscribeToDiaryPages(currentUser.uid, setDiaryPages, (err) => console.error('Diary pages subscription error:', err));
    return () => unsubscribe();
  }, [currentUser?.uid]);

  useEffect(() => {
    if (!currentUser?.uid) return;
    const unsubscribe = subscribeToMemorySeeds(currentUser.uid, setMemorySeeds, (err) => console.error('Memory seeds subscription error:', err));
    return () => unsubscribe();
  }, [currentUser?.uid]);

  useEffect(() => {
    if (!currentUser?.uid) return;
    const unsubscribe = subscribeToLittleMemories(currentUser.uid, setLittleMemories, (err) => console.error('Little memories subscription error:', err));
    return () => unsubscribe();
  }, [currentUser?.uid]);

  useEffect(() => {
    if (!currentUser?.uid) return;
    // Ensure the default Midnight/Companion profile exists, then keep it live.
    getOrInitFamiliarProfile(currentUser.uid).then(setFamiliarProfile).catch((err) => console.error('Familiar profile init error:', err));
    const unsubscribe = subscribeToFamiliarProfile(currentUser.uid, (p) => { if (p) setFamiliarProfile(p); }, (err) => console.error('Familiar profile subscription error:', err));
    return () => unsubscribe();
  }, [currentUser?.uid]);

  const handleSignIn = async () => {
    setAuthError(null); setSigningIn(true);
    try {
      await signInWithGoogle();
    } catch (err: any) {
      console.error('Sign-in failed:', err);
      if (err.code === 'auth/popup-closed-by-user') setAuthError('Sign-in popup was closed before completing. Please try again.');
      else if (err.code === 'auth/cancelled-popup-request') setAuthError('Sign-in was cancelled.');
      else setAuthError(err.message || 'Failed to authenticate with Google.');
    } finally { setSigningIn(false); }
  };

  const handleSignOut = async () => {
    try { await logOut(); } catch (err) { console.error('Sign-out failed:', err); }
  };

  const handleNewSession = () => { setActiveInteraction(null); setActiveTab('journal'); };
  const handleSelectEntry = (entry: JournalInteraction) => { setActiveInteraction(entry); setActiveTab('journal'); };
  const handleSessionUpdated = (updated: JournalInteraction) => setActiveInteraction(updated);

  // ── PF-CORE-01 handlers ─────────────────────────────────────────────────────
  const uid = currentUser?.uid ?? '';
  // Kept fresh so the once-created generation controller always mints ids for the
  // signed-in user without being recreated (which would drop its in-flight guard).
  const uidRef = useRef(uid);
  uidRef.current = uid;

  const openProposal = (page: DiaryPage) => {
    if (!page.id) return;
    setProposalSeedId(newMemorySeedId(uid)); // pre-allocate → retried approval is idempotent
    setProposalPage(page);
  };

  // Seed confirmation is a trusted server transaction (create-once by the
  // pre-allocated seedId). The client never writes the canonical seed itself.
  const approveProposal = async (editedText: string, proposal: SeedProposal) => {
    if (!proposalPage?.id || !proposalSeedId) throw new Error('This memory can no longer be kept from here. Please reopen it.');
    await confirmSeed(getIdTokenOrThrow, {
      diaryPageId: proposalPage.id,
      seedId: proposalSeedId,
      proposedText: proposal.text,
      editedText,
    });
    setProposalPage(null);
    setProposalSeedId(null);
  };

  // Source-page deletion: the server owns the plan. The user first sees a
  // server preview (affected descendants + a plan fingerprint); confirmation
  // carries that fingerprint. If the affected set changed since the preview, the
  // server returns 409 and we re-preview and ask again — never a silent cascade.
  const closeDeletion = () => { setDeletionPage(null); setDeletionPreview(null); setDeletionConflict(null); setDeletionLoading(false); };

  const openDeletion = (page: DiaryPage) => {
    if (!page.id) return;
    setDeletionPage(page); setDeletionPreview(null); setDeletionConflict(null); setDeletionLoading(true);
    previewSource(getIdTokenOrThrow, { diaryPageId: page.id })
      .then(setDeletionPreview)
      .catch(() => setDeletionConflict('Could not load what this affects. Please close and try again.'))
      .finally(() => setDeletionLoading(false));
  };

  const deleteSourceWithChoice = async (choice: 'delete_descendants' | 'keep_marked_unavailable') => {
    if (!deletionPage?.id || !deletionPreview) return;
    try {
      await deleteSource(getIdTokenOrThrow, { diaryPageId: deletionPage.id, choice, planVersion: deletionPreview.planVersion });
      closeDeletion();
    } catch (err) {
      if (err instanceof SourcePlanChangedError) {
        const fresh = await previewSource(getIdTokenOrThrow, { diaryPageId: deletionPage.id });
        setDeletionPreview(fresh);
        setDeletionConflict('These memories changed since you last looked — please review the updated list before deleting.');
        return;
      }
      throw err;
    }
  };

  // ── PF-CORE-03A P0-2: Memory Seed deletion (server owns the plan) ────────────
  // The user sees a server preview of the Little Memories that reference the seed
  // (which are KEPT); the confirm carries that plan fingerprint. A changed plan
  // returns 409 → re-preview and ask again. Deleting the seed flips only that
  // seed ref to unavailable and never deletes a Little Memory.
  const closeSeedDeletion = () => { setSeedDeletion(null); setSeedDeletionPreview(null); setSeedDeletionConflict(null); setSeedDeletionLoading(false); };
  const openSeedDeletion = (seed: MemorySeed) => {
    if (!seed.id) return;
    setSeedDeletion(seed); setSeedDeletionPreview(null); setSeedDeletionConflict(null); setSeedDeletionLoading(true);
    previewSeedDeletion(getIdTokenOrThrow, { seedId: seed.id })
      .then(setSeedDeletionPreview)
      .catch(() => setSeedDeletionConflict('Could not load what this affects. Please close and try again.'))
      .finally(() => setSeedDeletionLoading(false));
  };
  const confirmSeedDeletion = async () => {
    if (!seedDeletion?.id || !seedDeletionPreview) return;
    try {
      await deleteSeed(getIdTokenOrThrow, { seedId: seedDeletion.id, planVersion: seedDeletionPreview.planVersion });
      closeSeedDeletion();
    } catch (err) {
      if (err instanceof SeedPlanChangedError) {
        const fresh = await previewSeedDeletion(getIdTokenOrThrow, { seedId: seedDeletion.id });
        setSeedDeletionPreview(fresh);
        setSeedDeletionConflict('The Little Memories this affects changed since you last looked — please review the updated list before deleting.');
        return;
      }
      throw err;
    }
  };

  // ── PF-CORE-03A Little Memory handlers ──────────────────────────────────────
  // The scene brief is a server DRAFT; nothing is durable until the explicit
  // save, which is a create-once server transaction keyed by a pre-allocated id.
  const requestLittleMemoryDraft = (diaryPageId: string, seedIds: string[]) =>
    draftLittleMemory(getIdTokenOrThrow, { diaryPageId, seedIds });

  // The id is pre-allocated ONCE in the studio (stable across a failed save and
  // Retry), so the server's create-once transaction yields exactly one record.
  const approveLittleMemory = async (args: { littleMemoryId: string; sourcePage: DiaryPage; draftFields: SceneBriefFields; approvedFields: SceneBriefFields; seedIds: string[] }) => {
    if (!args.sourcePage.id) throw new Error('That diary page can no longer be used from here. Please reopen it.');
    const { littleMemory } = await confirmLittleMemory(getIdTokenOrThrow, {
      littleMemoryId: args.littleMemoryId,
      diaryPageId: args.sourcePage.id,
      seedIds: args.seedIds,
      draftFields: args.draftFields,
      approvedFields: args.approvedFields,
    });
    // Owner 2026-09-06: once the user explicitly approves the Little Memory,
    // begin its one idempotent illustration attempt automatically. Do not make
    // them discover and press a second paid-operation button. The controller's
    // stable attempt id prevents refresh/double-click duplication; a definitive
    // failure remains visible and requires an explicit Retry.
    void genControllerRef.current.generate(littleMemory).catch(() => {
      // The server records the bounded failed state on the canonical record;
      // the live subscription renders Retry without losing the approved brief.
    });
  };
  const deleteLittleMemory = (lm: LittleMemory) =>
    mutateLittleMemory(getIdTokenOrThrow, { littleMemoryId: lm.id!, op: 'delete' }).then(() => {});

  // PF-CORE-03B P0-2: one real illustration per explicit action via the shared
  // generation controller (stable attempt id across ambiguous retry + single-flight
  // guard). Created once and kept across renders so its in-flight set persists.
  const genControllerRef = useRef(
    createLittleMemoryGenerationController({
      mintId: (lm) => newLittleMemoryGenerationId(uidRef.current, lm.id!),
      send: (args) => generateLittleMemory(getIdTokenOrThrow, args),
    })
  );
  const generateLittleMemoryImage = (lm: LittleMemory) => genControllerRef.current.generate(lm);
  // Authenticated, private retrieval → a per-view object URL (no public URL).
  const loadLittleMemoryImage = (lm: LittleMemory) =>
    fetchLittleMemoryImage(getIdTokenOrThrow, { littleMemoryId: lm.id! }).then((b) => URL.createObjectURL(b));

  // Keeper activation is a trusted, one-way server transaction. Eligibility never
  // auto-transforms; this runs only on the explicit ceremony confirmation.
  const beginKeeper = async () => {
    const { outcome } = await activateKeeper(getIdTokenOrThrow);
    if (outcome === 'not_ready') {
      throw new Error('Your familiar isn’t ready to become a Keeper yet — keep a few more memories first.');
    }
    if (outcome === 'no_profile') {
      throw new Error('Your familiar profile is still loading. Please try again in a moment.');
    }
    // activated / already_keeper: the live subscription reflects the new stage.
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[var(--pf-cream)] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-[#606C5A]">
          <Loader2 className="w-8 h-8 animate-spin" />
          <span className="text-xs font-semibold text-[#666654]">Opening your journal…</span>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return <LandingHero onSignIn={handleSignIn} isLoading={signingIn} error={authError} />;
  }

  return (
    <div className="h-dvh min-h-0 w-full overflow-hidden bg-[var(--pf-cream)] text-[#38382E] flex flex-col selection:bg-[#EAE5D8] selection:text-[#2C2D22]">
      <Navbar
        user={currentUser}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onNewEntry={handleNewSession}
        onSignOut={handleSignOut}
        memoryCount={entries.length + diaryPages.length}
      />

      {firestoreError && (
        <div className="bg-[#FAF4E8] border-b border-[#EADBBA] px-4 py-2 text-center text-xs text-[#8C6527] font-medium">{firestoreError}</div>
      )}

      <main id="app-scroll-region" className="flex-1 min-h-0 w-full overflow-y-auto overflow-x-hidden overscroll-contain pb-16">
        {activeTab === 'journal' && (
          <ReflectionWorkspace
            userId={currentUser.uid}
            userEmail={currentUser.email || undefined}
            activeInteraction={activeInteraction}
            onSessionUpdated={handleSessionUpdated}
            onNewSession={handleNewSession}
          />
        )}
        {activeTab === 'memory' && (
          <MemoryLibrary
            userId={currentUser.uid}
            entries={entries}
            diaryPages={diaryPages}
            memorySeeds={memorySeeds}
            onSelectEntry={handleSelectEntry}
            onOpenModal={(entry) => setModalEntry(entry)}
            onNewEntry={handleNewSession}
            isSourceAvailable={(id) => entries.some((e) => e.id === id)}
            onOpenSource={(id) => { const src = entries.find((e) => e.id === id); if (src) { setActiveInteraction(src); setActiveTab('journal'); } }}
            onSeedEdit={(seed, text) => mutateSeed(getIdTokenOrThrow, { seedId: seed.id!, op: 'edit', text }).then(() => {})}
            onSeedRevoke={(seed) => mutateSeed(getIdTokenOrThrow, { seedId: seed.id!, op: 'revoke' }).then(() => {})}
            onSeedRequestDelete={openSeedDeletion}
            littleMemories={littleMemories}
            onOpenLittleMemory={(lm) => { setLittleFocusId(lm.id ?? null); setActiveTab('little'); }}
          />
        )}
        {activeTab === 'little' && (
          <LittleMemoryAlbum
            littleMemories={littleMemories}
            diaryPages={diaryPages}
            activeSeeds={activeSeedsOf(memorySeeds)}
            requestDraft={requestLittleMemoryDraft}
            allocateId={() => newLittleMemoryId(uid)}
            onApprove={approveLittleMemory}
            onDelete={deleteLittleMemory}
            onGenerate={generateLittleMemoryImage}
            loadImage={loadLittleMemoryImage}
            onOpenDiaryPage={(pageId) => { const p = diaryPages.find((d) => d.id === pageId); if (p) setSourceReaderPage(p); }}
            // P1b: open/focus the EXACT seed in the Familiar tab (not merely switch tabs).
            onOpenSeed={(seedId) => { setFamiliarFocusSeedId(seedId); setActiveTab('familiar'); }}
            isDiaryAvailable={(pageId) => diaryPages.some((p) => p.id === pageId)}
            // P1a: availability is document EXISTENCE — a revoked seed still exists and
            // remains a readable provenance source (only active seeds may be newly selected).
            isSeedAvailable={(seedId) => memorySeeds.some((s) => s.id === seedId)}
            focusId={littleFocusId}
            onFocusConsumed={() => setLittleFocusId(null)}
          />
        )}
        {activeTab === 'familiar' && (
          <FamiliarHome
            profile={familiarProfile}
            seeds={memorySeeds}
            diaryPages={diaryPages}
            onProposeSeedFromPage={openProposal}
            onSaveSeedText={(seed, text) => mutateSeed(getIdTokenOrThrow, { seedId: seed.id!, op: 'edit', text }).then(() => {})}
            onRevokeSeed={(seed) => mutateSeed(getIdTokenOrThrow, { seedId: seed.id!, op: 'revoke' }).then(() => {})}
            onRequestSeedDeletion={openSeedDeletion}
            onOpenSource={(pageId) => { const p = diaryPages.find((d) => d.id === pageId); if (p) setSourceReaderPage(p); }}
            isSourceAvailable={(pageId) => diaryPages.some((p) => p.id === pageId)}
            onRequestSourceDeletion={openDeletion}
            onBeginKeeper={beginKeeper}
            focusSeedId={familiarFocusSeedId}
            onFocusConsumed={() => setFamiliarFocusSeedId(null)}
          />
        )}
      </main>

      {modalEntry && (
        <EntryDetailModal
          userId={currentUser.uid}
          entry={modalEntry}
          onClose={() => setModalEntry(null)}
          onResumeInWorkspace={handleSelectEntry}
          onEntryUpdated={(updated) => { setModalEntry(updated); if (activeInteraction?.id === updated.id) setActiveInteraction(updated); }}
        />
      )}

      {proposalPage && proposalPage.id && (
        <MemorySeedProposal
          requestProposal={() => requestSeedProposal(getIdTokenOrThrow, { diaryPageId: proposalPage.id! })}
          sourcePageTitle={proposalPage.title}
          onApprove={approveProposal}
          onClose={() => { setProposalPage(null); setProposalSeedId(null); }}
        />
      )}

      {deletionPage && deletionPage.id && (
        <SourceDeletionDialog
          pageTitle={deletionPage.title}
          affectedSeeds={deletionPreview?.affectedSeeds ?? []}
          loading={deletionLoading}
          conflictNotice={deletionConflict}
          onDeleteWithDescendants={() => deleteSourceWithChoice('delete_descendants')}
          onKeepMarkedUnavailable={() => deleteSourceWithChoice('keep_marked_unavailable')}
          onCancel={closeDeletion}
        />
      )}

      {seedDeletion && seedDeletion.id && (
        <SeedDeletionDialog
          seedText={seedDeletion.text}
          affectedLittleMemories={seedDeletionPreview?.affectedLittleMemories ?? []}
          loading={seedDeletionLoading}
          conflictNotice={seedDeletionConflict}
          onConfirmDelete={confirmSeedDeletion}
          onCancel={closeSeedDeletion}
        />
      )}

      {sourceReaderPage && (
        <DiaryPageReader
          page={sourceReaderPage}
          sourceAvailable={entries.some((e) => e.id === sourceReaderPage.sourceInteractionId)}
          onOpenSource={(interactionId) => {
            const src = entries.find((e) => e.id === interactionId);
            setSourceReaderPage(null);
            if (src) { setActiveInteraction(src); setActiveTab('journal'); }
          }}
          onClose={() => setSourceReaderPage(null)}
        />
      )}
    </div>
  );
}
