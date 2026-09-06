import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { Navbar, ActiveTab } from '../components/Navbar';
import { ReflectionWorkspace } from '../components/ReflectionWorkspace';
import { MemoryLibrary } from '../components/MemoryLibrary';
import { EntryDetailModal } from '../components/EntryDetailModal';
import { DiaryDraftEditor } from '../components/DiaryDraftEditor';
import { DiaryFlowDeps } from '../lib/diary-flow';
import { FamiliarHome } from '../components/FamiliarHome';
import { MemorySeedProposal } from '../components/MemorySeedProposal';
import { SourceDeletionDialog } from '../components/SourceDeletionDialog';
import { SeedDeletionDialog } from '../components/SeedDeletionDialog';
import { LittleMemoryAlbum } from '../components/LittleMemoryAlbum';
import { LittleMemoryStudio } from '../components/LittleMemoryStudio';
import { briefFingerprint } from '../lib/little-memory-image';
import { SeedProposal } from '../lib/memory-seed-flow';
import { previewSourceDeletion } from '../lib/deletion-plan';
import { LittleMemoryDraftResult } from '../lib/growth-client';
import { JournalInteraction, DiaryPage, UserAuthProfile, MemorySeed, FamiliarProfile, LittleMemory } from '../types';

/**
 * VISUAL_ONLY_FIXTURE_DATA — dev-only Skin Round 1 visual + interaction QA
 * harness. Composes the REAL production components with deterministic fixture
 * data and OBSERVABLE (spy-recorded) callbacks so a browser run can assert that
 * the right saved record drives navigation/save — not just that pixels render.
 * NOT live-auth evidence. No auth bypass / query flag / fake-user path / test
 * credential is added to App or the production bundle; this is a separate dev
 * entry excluded from `vite build`.
 */

declare global { interface Window { __qa: any } }
if (typeof window !== 'undefined') {
  window.__qa = { modalId: null, resumeId: null, sourceId: null, saveCalls: [], confirmed: null, closed: 0 };
}
const rec = (k: string, v: any) => { if (typeof window !== 'undefined') window.__qa[k] = v; };

const FIXTURE_USER: UserAuthProfile = { uid: 'visual-fixture-user', email: 'fixture@example.com', displayName: 'Sora', photoURL: null };
const NOW = Date.UTC(2026, 8, 3, 9, 0, 0);

const ACTIVE: JournalInteraction = {
  id: 'fx-active', userId: FIXTURE_USER.uid, title: 'A quiet morning after drop-off',
  initialPrompt: 'Drop-off was smoother today and I felt a small pocket of calm afterwards.',
  reflectionOutput: 'It sounds like that pocket of calm was hard-won. You noticed it — that noticing is worth keeping.',
  mode: 'deep_reflection', mood: 'serene', tags: ['mornings', 'calm'],
  turns: [
    { id: 'u1', role: 'user', content: 'Drop-off was smoother today and I felt a small pocket of calm afterwards. I want to hold onto that.', timestamp: NOW },
    { id: 'm1', role: 'model', content: 'It sounds like that pocket of calm was hard-won — you made space for it. What did the calm let you notice that the rush usually hides?', timestamp: NOW + 4000 },
    { id: 'u2', role: 'user', content: 'That I actually like the walk home when I am not checking my phone.', timestamp: NOW + 60000 },
    { id: 'm2', role: 'model', content: 'A small, repeatable good. You could let the walk home be a phone-free ritual — not a rule, just a door you leave open.', timestamp: NOW + 64000 },
  ],
  createdAt: NOW, updatedAt: NOW + 64000, isFavorite: true, generationStatus: 'complete',
};

const ENTRIES: JournalInteraction[] = [
  ACTIVE,
  { id: 'fx-2', userId: FIXTURE_USER.uid, title: 'The presentation I dreaded', initialPrompt: 'I was anxious about the review but it went fine.', reflectionOutput: 'The dread was louder than the day itself — worth remembering next time it shows up.', mode: 'summary', mood: 'anxious', tags: ['work'], turns: [{ id: 'a', role: 'user', content: 'I was anxious about the review but it went fine.', timestamp: NOW - 86400000 }, { id: 'b', role: 'model', content: 'The dread was louder than the day itself.', timestamp: NOW - 86400000 }], createdAt: NOW - 86400000, updatedAt: NOW - 86400000, isFavorite: false, generationStatus: 'complete' },
  { id: 'fx-3', userId: FIXTURE_USER.uid, title: 'A tangle of ideas for the shop', initialPrompt: 'Too many directions for the little shop idea.', reflectionOutput: 'Three threads stand out — start with the one you could try this week.', mode: 'brainstorm', mood: 'inspired', tags: ['ideas', 'shop'], turns: [{ id: 'c', role: 'user', content: 'Too many directions for the little shop idea.', timestamp: NOW - 2 * 86400000 }, { id: 'd', role: 'model', content: 'Three threads stand out.', timestamp: NOW - 2 * 86400000 }], createdAt: NOW - 2 * 86400000, updatedAt: NOW - 2 * 86400000, isFavorite: false, generationStatus: 'complete' },
];

const DIARY: DiaryPage[] = [
  { kind: 'diaryPage', id: 'dp-long', userId: FIXTURE_USER.uid, title: 'A pocket of calm',
    date: '2026-09-03',
    todayInMyWords: 'Drop-off was smoother today and I felt a small pocket of calm afterwards. On the walk home I left my phone in my bag and just noticed the morning light through the trees. It was small, but it was mine, and I want to keep the shape of it.',
    whatFeltImportant: ['The walk home felt like mine again', 'Calm is easier to keep when I make room for it'],
    carryForward: 'Leave the walk home phone-free tomorrow.',
    sourceInteractionId: 'fx-active', sourceTurnIds: ['u1', 'u2'], aiAssisted: true, status: 'confirmed', createdAt: NOW, confirmedAt: NOW + 120000, editedByUser: true },
  { kind: 'diaryPage', id: 'dp-nosrc', userId: FIXTURE_USER.uid, title: 'An older kept page',
    date: '2026-08-20',
    todayInMyWords: 'A steady day I chose to keep even though the conversation it came from is long gone.',
    whatFeltImportant: ['I can keep a page without keeping the whole conversation'],
    sourceInteractionId: 'gone-conv', sourceTurnIds: ['x'], aiAssisted: true, status: 'confirmed', createdAt: NOW - 14 * 86400000, confirmedAt: NOW - 14 * 86400000, editedByUser: false },
];

// PF-CORE-01 fixtures. Seeds engineered for the readiness boundaries: the
// "ready" set is 3 active seeds from 3 distinct pages across 2 dates.
const SEEDS_COMPANION: MemorySeed[] = [
  { kind: 'memorySeed', id: 'seed-1', userId: FIXTURE_USER.uid, status: 'active',
    text: 'The walk home is mine again when I leave my phone in my bag.',
    sourceExcerpt: 'On the walk home I left my phone in my bag and just noticed the morning light through the trees.',
    sourceDate: '2026-09-03', sourceRefs: [{ kind: 'diaryPage', id: 'dp-long', availability: 'available' }],
    aiAssisted: true, approvedByUser: true, editedByUser: false, createdAt: NOW, confirmedAt: NOW + 1000 },
  { kind: 'memorySeed', id: 'seed-2', userId: FIXTURE_USER.uid, status: 'active',
    text: 'I can keep a page without keeping the whole conversation it came from.',
    sourceExcerpt: 'A steady day I chose to keep even though the conversation it came from is long gone.',
    sourceDate: '2026-08-20', sourceRefs: [{ kind: 'diaryPage', id: 'dp-nosrc', availability: 'unavailable' }],
    aiAssisted: true, approvedByUser: true, editedByUser: true, createdAt: NOW - 1e7, confirmedAt: NOW - 1e7 },
  { kind: 'memorySeed', id: 'seed-r', userId: FIXTURE_USER.uid, status: 'revoked',
    text: 'A thought I decided to stop holding.',
    sourceExcerpt: 'An older note I let go of.', sourceDate: '2026-08-19',
    sourceRefs: [{ kind: 'diaryPage', id: 'dp-nosrc', availability: 'available' }],
    aiAssisted: true, approvedByUser: true, editedByUser: false, createdAt: NOW - 2e7, confirmedAt: NOW - 2e7, revokedAt: NOW - 1.5e7 },
];

const SEEDS_READY: MemorySeed[] = [
  SEEDS_COMPANION[0], // dp-long, 2026-09-03
  { kind: 'memorySeed', id: 'seed-3', userId: FIXTURE_USER.uid, status: 'active',
    text: 'The dread was louder than the day itself — worth remembering next time.',
    sourceExcerpt: 'I was anxious about the review but it went fine.',
    sourceDate: '2026-08-20', sourceRefs: [{ kind: 'diaryPage', id: 'dp-2', availability: 'available' }],
    aiAssisted: true, approvedByUser: true, editedByUser: false, createdAt: NOW - 5e6, confirmedAt: NOW - 5e6 },
  { kind: 'memorySeed', id: 'seed-4', userId: FIXTURE_USER.uid, status: 'active',
    text: 'Start the shop with the one thread I could try this week.',
    sourceExcerpt: 'Too many directions for the little shop idea.',
    sourceDate: '2026-08-20', sourceRefs: [{ kind: 'diaryPage', id: 'dp-3', availability: 'available' }],
    aiAssisted: true, approvedByUser: true, editedByUser: false, createdAt: NOW - 4e6, confirmedAt: NOW - 4e6 },
];

// PF-CORE-03A Little Memory fixtures: one fully available, one whose source page
// is gone (kept-unavailable) so the "still readable" path can be asserted.
const LITTLE_MEMORIES: LittleMemory[] = [
  {
    kind: 'littleMemory', id: 'lm-1', userId: FIXTURE_USER.uid, status: 'brief_approved', date: '2026-09-03',
    title: 'A pocket of calm', setting: 'a quiet tree-lined street on the walk home', timeOfDay: 'morning',
    emotionalTone: 'quiet relief', familiarAction: 'Midnight pads beside her, tail curled, watching the light',
    visualMotifs: ['morning light through trees', 'a phone tucked away'], composition: 'wide, low angle with warm negative space',
    caption: 'The walk home is mine again.',
    sourceRefs: [
      { kind: 'diaryPage', id: 'dp-long', availability: 'available', label: 'A pocket of calm · 2026-09-03' },
      { kind: 'memorySeed', id: 'seed-1', availability: 'available', label: 'The walk home is mine again…' },
    ],
    aiAssisted: true, approvedByUser: true, editedByUser: false, createdAt: NOW, confirmedAt: NOW + 5000,
  },
  {
    kind: 'littleMemory', id: 'lm-gone', userId: FIXTURE_USER.uid, status: 'brief_approved', date: '2026-08-20',
    title: 'An older kept scene', setting: 'a steady afternoon indoors', timeOfDay: 'afternoon',
    emotionalTone: 'settled', familiarAction: 'Midnight dozes on a closed book',
    visualMotifs: ['soft lamplight'], composition: 'close, cosy framing', caption: 'A steady day I chose to keep.',
    sourceRefs: [{ kind: 'diaryPage', id: 'dp-gone', availability: 'unavailable', label: 'An older kept page · 2026-08-20' }],
    aiAssisted: true, approvedByUser: true, editedByUser: true, createdAt: NOW - 14 * 86400000, confirmedAt: NOW - 14 * 86400000,
  },
];

const FIXTURE_LM_DRAFT: LittleMemoryDraftResult = {
  draft: {
    title: 'A pocket of calm', setting: 'a quiet tree-lined street on the walk home', timeOfDay: 'morning',
    emotionalTone: 'quiet relief', familiarAction: 'Midnight pads beside her, watching the light',
    visualMotifs: ['morning light through trees'], composition: 'wide, low angle with warm negative space',
    caption: 'The walk home is mine again.',
  },
  source: {
    date: '2026-09-03',
    diaryPage: { id: 'dp-long', title: 'A pocket of calm', date: '2026-09-03', excerpt: 'On the walk home I left my phone in my bag and just noticed the morning light through the trees.' },
    seeds: [{ id: 'seed-1', text: 'The walk home is mine again when I leave my phone in my bag.' }],
  },
};

const PROFILE_COMPANION: FamiliarProfile = { kind: 'familiarProfile', id: 'profile', userId: FIXTURE_USER.uid, originId: 'midnight', stage: 'companion', createdAt: NOW - 3e7 };
const PROFILE_KEEPER: FamiliarProfile = { ...PROFILE_COMPANION, stage: 'keeper', stageActivatedAt: NOW };

const FIXTURE_PROPOSAL: SeedProposal = {
  text: 'The walk home is mine again when I leave my phone in my bag.',
  sourceExcerpt: 'Drop-off was smoother today and I felt a small pocket of calm afterwards. On the walk home I left my phone in my bag and just noticed the morning light through the trees.',
  sourceDate: '2026-09-03',
  sourceRefs: [{ kind: 'diaryPage', id: 'dp-long', availability: 'available' }],
};


const makeFailThenSucceedDeps = (): DiaryFlowDeps => {
  let calls = 0;
  return {
    requestDraft: async () => ({
      title: 'A pocket of calm',
      todayInMyWords: 'Drop-off was smoother today and I felt a small pocket of calm afterwards.',
      whatFeltImportant: ['The walk home felt like mine again'],
      carryForward: 'Leave the walk home phone-free tomorrow.',
      sourceTurnIds: ['u1', 'u2'],
    }),
    savePage: async (pageId: string) => {
      calls += 1;
      window.__qa.saveCalls.push(pageId);
      if (calls === 1) throw new Error('fixture: first save fails');
      // second call succeeds
    },
    newPageId: () => 'dp-fake',
    now: () => NOW,
  };
};

function Shell() {
  const scene = (typeof location !== 'undefined' && location.hash.replace('#', '')) || 'journal';
  const familiarScene = scene === 'familiar' || scene === 'keeper-ready' || scene === 'keeper';
  const initialTab: ActiveTab = scene === 'memory' ? 'memory' : scene === 'little' ? 'little' : familiarScene ? 'familiar' : 'journal';
  const [tab, setTab] = useState<ActiveTab>(initialTab);
  const [modalEntry, setModalEntry] = useState<JournalInteraction | null>(null);
  const [deps] = useState(makeFailThenSucceedDeps);
  useEffect(() => { if (scene === 'modal') setModalEntry(ACTIVE); }, [scene]);

  return (
    <div className="h-dvh min-h-0 w-full overflow-hidden bg-[var(--pf-cream)] text-[#38382E] flex flex-col">
      <div className="bg-[#2b241a] text-[#F0E4C8] text-[10px] text-center py-1 tracking-wide font-mono">
        VISUAL_ONLY_FIXTURE_DATA — dev harness, not live-auth evidence
      </div>
      <Navbar user={FIXTURE_USER} activeTab={tab} onTabChange={setTab} onNewEntry={() => rec('resumeId', 'new')} onSignOut={() => {}} memoryCount={ENTRIES.length + DIARY.length} />
      <main id="app-scroll-region" className="flex-1 min-h-0 w-full overflow-y-auto overflow-x-hidden overscroll-contain pb-16">
        {tab === 'journal' && (
          <ReflectionWorkspace userId={FIXTURE_USER.uid} userEmail={FIXTURE_USER.email || undefined}
            activeInteraction={scene === 'journal' ? null : ACTIVE} onSessionUpdated={() => {}} onNewSession={() => {}} />
        )}
        {tab === 'memory' && (
          <MemoryLibrary userId={FIXTURE_USER.uid} entries={ENTRIES} diaryPages={DIARY} memorySeeds={SEEDS_COMPANION}
            littleMemories={LITTLE_MEMORIES}
            onOpenLittleMemory={(lm) => rec('openedLittleMemoryId', lm.id)}
            timeZone="Asia/Tokyo"
            onSelectEntry={(e) => rec('resumeId', e.id)}
            onOpenModal={(e) => { rec('modalId', e.id); setModalEntry(e); }}
            onNewEntry={() => {}}
            isSourceAvailable={(id) => id !== 'gone-conv'}
            onOpenSource={(id) => rec('sourceId', id)}
            onSeedEdit={async (s, t) => { window.__qa.saveCalls.push(`edit:${s.id}:${t}`); }}
            onSeedRevoke={async (s) => { window.__qa.saveCalls.push(`revoke:${s.id}`); }}
            onSeedRequestDelete={(s) => { window.__qa.saveCalls.push(`request-delete:${s.id}`); rec('seedDeleteRequestId', s.id); }} />
        )}
        {tab === 'little' && <LittleAlbumHarness />}
        {tab === 'familiar' && (
          <FamiliarHome
            profile={scene === 'keeper' ? PROFILE_KEEPER : PROFILE_COMPANION}
            seeds={scene === 'familiar' ? SEEDS_COMPANION : SEEDS_READY}
            diaryPages={DIARY}
            onProposeSeedFromPage={(p) => rec('proposePageId', p.id)}
            onSaveSeedText={async (s, t) => { window.__qa.saveCalls.push(`edit:${s.id}:${t}`); }}
            onRevokeSeed={async (s) => { window.__qa.saveCalls.push(`revoke:${s.id}`); }}
            onRequestSeedDeletion={(s) => { window.__qa.saveCalls.push(`request-delete:${s.id}`); rec('seedDeleteRequestId', s.id); }}
            onOpenSource={(id) => rec('sourceId', id)}
            isSourceAvailable={(id) => id !== 'dp-nosrc'}
            onRequestSourceDeletion={(p) => rec('deletePageId', p.id)}
            onBeginKeeper={async () => { window.__qa.confirmed = 'keeper-activated'; }}
          />
        )}
      </main>
      {modalEntry && (
        <EntryDetailModal userId={FIXTURE_USER.uid} entry={modalEntry} onClose={() => { window.__qa.closed += 1; setModalEntry(null); }} onResumeInWorkspace={(e) => rec('resumeId', e.id)} onEntryUpdated={() => {}} />
      )}
      {scene === 'remember' && (
        <DiaryDraftEditor userId={FIXTURE_USER.uid} interaction={ACTIVE} deps={deps} todayISO="2026-09-03"
          onConfirmed={(page) => rec('confirmed', page.id ?? 'confirmed')} onClose={() => { window.__qa.closed += 1; }} />
      )}

      {scene === 'seed-proposal' && (
        <MemorySeedProposal
          requestProposal={async () => FIXTURE_PROPOSAL}
          sourcePageTitle="A pocket of calm"
          onApprove={async (text) => { window.__qa.saveCalls.push(`approve:${text}`); window.__qa.confirmed = 'seed-approved'; }}
          onClose={() => { window.__qa.closed += 1; }}
        />
      )}

      {scene === 'source-deletion' && (
        <SourceDeletionDialog
          pageTitle="A pocket of calm"
          affectedSeeds={previewSourceDeletion('dp-long', SEEDS_READY).affectedSeeds}
          onDeleteWithDescendants={async () => { window.__qa.confirmed = 'deleted-descendants'; }}
          onKeepMarkedUnavailable={async () => { window.__qa.confirmed = 'kept-unavailable'; }}
          onCancel={() => { window.__qa.closed += 1; }}
        />
      )}

      {scene === 'source-conflict' && <SourceConflictHarness />}

      {scene === 'little-studio' && <LittleStudioHarness />}
      {scene === 'little-generate' && <LittleAlbumHarness />}

      {scene === 'seed-deletion' && (
        <SeedDeletionDialog
          seedText="The walk home is mine again when I leave my phone in my bag."
          affectedLittleMemories={[{ littleMemoryId: 'lm-1', title: 'A pocket of calm' }]}
          onConfirmDelete={async () => { window.__qa.confirmed = 'seed-deleted'; }}
          onCancel={() => { window.__qa.closed += 1; }}
        />
      )}

      {scene === 'seed-deletion-conflict' && <SeedDeletionConflictHarness />}
    </div>
  );
}

/**
 * VISUAL_ONLY_FIXTURE_DATA harness for the P0-2 seed-deletion stale-plan flow:
 * the FIRST confirm hits a simulated conflict (a new Little Memory appears + the
 * conflict notice), the SECOND confirm on the refreshed plan succeeds. No Little
 * Memory is ever deleted.
 */
function SeedDeletionConflictHarness() {
  const A = { littleMemoryId: 'lm-1', title: 'A pocket of calm' };
  const B = { littleMemoryId: 'lm-2', title: 'A scene that appeared after you looked' };
  const [affected, setAffected] = useState([A]);
  const [conflict, setConflict] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);
  return (
    <SeedDeletionDialog
      seedText="The walk home is mine again."
      affectedLittleMemories={affected}
      conflictNotice={conflict}
      onConfirmDelete={async () => {
        if (attempts === 0) {
          setAttempts(1);
          setAffected([A, B]);
          setConflict('The Little Memories this affects changed since you last looked — please review the updated list before deleting.');
          window.__qa.confirmed = 'seed-conflict';
          return;
        }
        window.__qa.confirmed = 'seed-deleted-after-refresh';
      }}
      onCancel={() => { window.__qa.closed += 1; }}
    />
  );
}

/**
 * VISUAL_ONLY_FIXTURE_DATA harness for the PF-CORE-03A save path: the FIRST save
 * fails (proving the draft + the user's edits survive), the SECOND succeeds
 * (proving retry creates exactly one record). No image is generated.
 */
function LittleStudioHarness() {
  const [attempts, setAttempts] = useState(0);
  return (
    <LittleMemoryStudio
      sourcePage={DIARY[0]}
      activeSeeds={SEEDS_COMPANION.filter((s) => s.status === 'active')}
      allocateId={() => { window.__qa.allocCount = (window.__qa.allocCount || 0) + 1; return `lm-alloc-${window.__qa.allocCount}`; }}
      requestDraft={async (seedIds) => { window.__qa.lmDraftArgs = { seedIds }; return FIXTURE_LM_DRAFT; }}
      onApprove={async (a) => {
        window.__qa.approveIds = window.__qa.approveIds || [];
        window.__qa.approveIds.push(a.littleMemoryId);
        if (attempts === 0) {
          setAttempts(1);
          window.__qa.confirmed = 'lm-save-failed';
          throw new Error('fixture: first save fails');
        }
        window.__qa.saveCalls.push(`lm-approve:${a.approvedFields.caption}`);
        window.__qa.confirmed = 'lm-approved';
      }}
      onClose={() => { window.__qa.closed += 1; }}
    />
  );
}

/**
 * VISUAL_ONLY_FIXTURE_DATA harness for the P0-2 plan-conflict flow: the first
 * confirm hits a simulated `source_plan_changed`, which refreshes the preview
 * (a new seed appears) and shows the conflict notice; the second confirm on the
 * refreshed plan succeeds.
 */
function SourceConflictHarness() {
  const A = { seedId: 'A', text: 'The walk home is mine again.' };
  const B = { seedId: 'B', text: 'A memory that appeared after you first looked.' };
  const [affected, setAffected] = useState([A]);
  const [conflict, setConflict] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);
  const doDelete = async () => {
    if (attempts === 0) {
      setAttempts(1);
      setAffected([A, B]);
      setConflict('These memories changed since you last looked — please review the updated list before deleting.');
      window.__qa.confirmed = 'conflict-409';
      return;
    }
    window.__qa.confirmed = 'deleted-after-refresh';
  };
  return (
    <SourceDeletionDialog
      pageTitle="A pocket of calm"
      affectedSeeds={affected}
      conflictNotice={conflict}
      onDeleteWithDescendants={doDelete}
      onKeepMarkedUnavailable={doDelete}
      onCancel={() => { window.__qa.closed += 1; }}
    />
  );
}

// A visibly dev-only fixture image (never a real generated result, never production output).
const DEV_FIXTURE_IMAGE = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="400"><rect width="100%" height="100%" fill="#26324a"/>' +
  '<text x="50%" y="46%" fill="#ffe7b0" font-family="monospace" font-size="15" text-anchor="middle">DEV FIXTURE</text>' +
  '<text x="50%" y="56%" fill="#ffe7b0" font-family="monospace" font-size="11" text-anchor="middle">NOT REAL OUTPUT</text></svg>'
);
const briefOf = (lm: LittleMemory) => ({
  title: lm.title, setting: lm.setting, timeOfDay: lm.timeOfDay, emotionalTone: lm.emotionalTone,
  familiarAction: lm.familiarAction, visualMotifs: [...(lm.visualMotifs ?? [])], composition: lm.composition, caption: lm.caption,
});

/**
 * VISUAL_ONLY_FIXTURE_DATA harness for the PF-CORE-03B illustration lifecycle.
 * Stateful so an explicit generate/edit flips the record; loadImage returns a
 * visibly dev-only fixture image, never a real generated result.
 */
function LittleAlbumHarness() {
  const base = LITTLE_MEMORIES[0];
  const [items, setItems] = useState<LittleMemory[]>([
    base, // lm-1: not_generated
    LITTLE_MEMORIES[1], // lm-gone: source unavailable (03A readability)
    // lm-failed: a first attempt failed — the failure lives in pendingGeneration,
    // there is no current image (P0-3: failure never fabricates an image).
    { ...base, id: 'lm-failed', title: 'A rainy afternoon', caption: 'The rain kept its own time.',
      pendingGeneration: { status: 'failed', generationId: 'g-old', model: 'gemini-3.1-flash-image', briefFingerprint: 'bf1_OLD_0', attemptStartedAt: NOW, failureCode: 'provider_unavailable' } },
    // lm-stale: a ready image whose brief was edited after — still viewable, stale.
    { ...base, id: 'lm-stale', title: 'A late night page', caption: 'I edited this after the picture.',
      image: { status: 'ready', generationId: 'g-stale', model: 'gemini-3.1-flash-image', objectPath: 'users/fx/littleMemories/lm-stale/generations/g-stale.png', mimeType: 'image/png', generatedAt: NOW, briefFingerprint: 'bf1_OLD_0' } },
    // lm-regenfail: a ready image; regenerating it FAILS — the old image must remain
    // viewable and honestly marked, with a retry offered (closure P0-3).
    { ...base, id: 'lm-regenfail', title: 'A morning by the window', caption: 'The light did not move.',
      image: { status: 'ready', generationId: 'g-keep', model: 'gemini-3.1-flash-image', objectPath: 'users/fx/littleMemories/lm-regenfail/generations/g-keep.png', mimeType: 'image/png', generatedAt: NOW, briefFingerprint: briefFingerprint(briefOf(base)) } },
    // lm-revseed: grown from a Memory Seed that was later REVOKED. The seed still
    // exists, so it remains a readable/navigable provenance source (closure P1a);
    // opening it must carry the EXACT seed id (P1b).
    { ...base, id: 'lm-revseed', title: 'From a memory since let go', caption: 'Still worth keeping the picture.',
      sourceRefs: [
        { kind: 'diaryPage', id: 'dp-long', availability: 'available', label: 'A pocket of calm · 2026-09-03' },
        { kind: 'memorySeed', id: 'seed-r', availability: 'available', label: 'A memory since let go' },
      ] },
  ]);
  // Model the SERVER outcome of one attempt: bill once, then promote to ready
  // (clearing any pending) OR, for lm-regenfail, fail the pending WITHOUT touching
  // the current image. The stable-id / no-second-call seam is tested at the
  // controller level in tests/little-memory-generation.test.ts.
  const onGenerate = async (lm: LittleMemory) => {
    window.__qa.saveCalls.push(`lm-generate:${lm.id}`);
    window.__qa.lmProviderCalls = (window.__qa.lmProviderCalls || 0) + 1;
    if (lm.id === 'lm-regenfail') {
      window.__qa.confirmed = 'lm-generate-failed';
      setItems((prev) => prev.map((x) => x.id === lm.id ? { ...x,
        pendingGeneration: { status: 'failed', generationId: `g-${x.id}-${Date.now()}`, model: 'gemini-3.1-flash-image', briefFingerprint: briefFingerprint(briefOf(x)), attemptStartedAt: Date.now(), failureCode: 'provider_unavailable' } } : x));
      return;
    }
    window.__qa.confirmed = 'lm-generated';
    setItems((prev) => prev.map((x) => x.id === lm.id ? { ...x,
      image: { status: 'ready', generationId: `g-${lm.id}`, model: 'gemini-3.1-flash-image', objectPath: `users/fx/littleMemories/${lm.id}/generations/g.png`, mimeType: 'image/png', generatedAt: Date.now(), briefFingerprint: briefFingerprint(briefOf(x)) },
      pendingGeneration: undefined } : x));
  };
  return (
    <LittleMemoryAlbum
      littleMemories={items}
      diaryPages={DIARY}
      activeSeeds={SEEDS_COMPANION.filter((s) => s.status === 'active')}
      requestDraft={async (pageId, seedIds) => { window.__qa.lmDraftArgs = { pageId, seedIds }; return FIXTURE_LM_DRAFT; }}
      allocateId={() => { window.__qa.allocCount = (window.__qa.allocCount || 0) + 1; return `lm-alloc-${window.__qa.allocCount}`; }}
      onApprove={async (a) => { window.__qa.saveCalls.push(`lm-approve:${a.approvedFields.title}`); window.__qa.confirmed = 'lm-approved'; }}
      onDelete={async (lm) => { window.__qa.saveCalls.push(`lm-delete:${lm.id}`); setItems((prev) => prev.filter((x) => x.id !== lm.id)); }}
      onGenerate={onGenerate}
      loadImage={async () => { window.__qa.imageLoaded = (window.__qa.imageLoaded || 0) + 1; return DEV_FIXTURE_IMAGE; }}
      onOpenDiaryPage={(id) => rec('sourceId', id)}
      onOpenSeed={(id) => rec('seedSourceId', id)}
      isDiaryAvailable={(id) => DIARY.some((p) => p.id === id)}
      isSeedAvailable={(id) => SEEDS_COMPANION.some((s) => s.id === id)}
    />
  );
}

createRoot(document.getElementById("root")!).render(<Shell />);
