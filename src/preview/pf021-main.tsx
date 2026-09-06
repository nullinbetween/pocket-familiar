import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { DiaryDraftEditor } from '../components/DiaryDraftEditor';
import { FamiliarPresence } from '../components/Familiar';
import { DiaryFlowDeps } from '../lib/diary-flow';
import { workspaceFamiliarInputs } from '../lib/familiar-workspace';
import { FlowDeps, retryGeneration } from '../lib/reflection-flow';
import { JournalInteraction } from '../types';

/**
 * PF-02.1 ACTUAL-FLOW harness (dev only). Unlike the pf02 state-picker, this
 * page has NO way to select a familiar state directly: every transition comes
 * from the real reflection/diary flow functions and the real component
 * callbacks, exactly as the production workspace wires them. Only the IO deps
 * (network/Firestore) are deterministic fakes.
 */

const FAILED_ENTRY: JournalInteraction = {
  id: 'conv-failed',
  userId: 'preview-user',
  title: 'A rough drop-off',
  initialPrompt: 'Drop-off was rough today.',
  reflectionOutput: '',
  mode: 'deep_reflection',
  mood: 'anxious',
  tags: ['reflection'],
  turns: [{ id: 'usr_1', role: 'user', content: 'Drop-off was rough today and I doubted myself.', timestamp: 1 }],
  createdAt: 1,
  updatedAt: 1,
  generationStatus: 'failed', // opened as a PERSISTED failed entry
};

function ScenarioA() {
  const [entry, setEntry] = useState<JournalInteraction>(FAILED_ENTRY);
  const [isGenerating, setIsGenerating] = useState(false);
  const [justReady, setJustReady] = useState(false);
  const [flowError, setFlowError] = useState<string | null>(null);
  const [failNext, setFailNext] = useState(false);

  const flowDeps: FlowDeps = {
    saveEntry: async () => 'unused',
    updateEntry: async (_id, updates) => {
      setEntry((prev) => ({ ...prev, ...updates } as JournalInteraction));
    },
    requestReflection: async () => {
      await new Promise((r) => setTimeout(r, 700));
      if (failNext) throw new Error('provider unavailable (simulated)');
      return { text: 'One small observation about your morning. What eased it?' };
    },
    now: () => Date.now(),
  };

  // identical wiring to ReflectionWorkspace.handleRetryGeneration
  const onRetry = async () => {
    if (isGenerating) return;
    setFlowError(null);
    setJustReady(false);
    setIsGenerating(true);
    const outcome = await retryGeneration(flowDeps, entry);
    if (outcome.phase === 'complete') {
      setEntry(outcome.entry);
      setJustReady(true);
    } else if (outcome.phase === 'saved_generation_failed') {
      setEntry(outcome.entry);
      setFlowError(outcome.error);
    }
    setIsGenerating(false);
  };

  const inputs = workspaceFamiliarInputs({
    composerText: '',
    persisting: false,
    isGenerating,
    draftingPage: false,
    flowErrorVisible: flowError !== null,
    persistedGenerationFailed: entry.generationStatus === 'failed',
    diaryEditorErrorVisible: false,
    diaryEditorOpen: false,
    justReady,
    pageJustSaved: false,
  });

  return (
    <section id="scenario-a" className="space-y-2">
      <h2 className="text-xs font-bold uppercase tracking-wide text-[#4A4A3A]">
        A · opened persisted-failed entry → Retry Response → ready
      </h2>
      <label className="text-[11px] text-[#7A5825] flex items-center gap-1">
        <input id="a-fail-next" type="checkbox" checked={failNext} onChange={(e) => setFailNext(e.target.checked)} />
        simulate provider failure on next retry
      </label>
      <FamiliarPresence inputs={inputs} mode={entry.mode} />
      {entry.generationStatus === 'failed' && !isGenerating && !flowError && (
        <div className="p-3 rounded-xl bg-[#FAF4E8] border border-[#EADBBA] text-[#8C6527] text-xs flex items-center justify-between gap-3">
          <span>This entry is saved, but the companion response is still missing.</span>
          <button id="a-retry-btn" onClick={onRetry} className="px-2.5 py-1 rounded-md bg-[#8C6527] text-white font-semibold text-xs">
            Retry Response
          </button>
        </div>
      )}
      {flowError && (
        <div className="p-3 rounded-xl bg-[#FBEFEF] border border-[#ECC8C8] text-[#8C3232] text-xs flex items-center justify-between gap-3">
          <span>Saved; companion response unavailable: {flowError}</span>
          <button id="a-retry-banner-btn" onClick={onRetry} className="px-2.5 py-1 rounded-md bg-[#8C3232] text-white font-semibold text-xs">
            Retry Response
          </button>
        </div>
      )}
    </section>
  );
}

function ScenarioB() {
  const [open, setOpen] = useState(true);
  const [draftingPage, setDraftingPage] = useState(false);
  const [editorError, setEditorError] = useState(false);
  const [pageJustSaved, setPageJustSaved] = useState(false);
  const [failDraft, setFailDraft] = useState(true);
  const [failSave, setFailSave] = useState(false);

  const deps: DiaryFlowDeps = {
    requestDraft: async () => {
      await new Promise((r) => setTimeout(r, 600));
      if (failDraft) throw new Error('draft endpoint unavailable (simulated)');
      return {
        title: 'The hard part might be mine',
        todayInMyWords: 'Drop-off was rough, pickup was bright.',
        whatFeltImportant: ['She was beaming at pickup'],
        sourceTurnIds: ['usr_1'],
      };
    },
    savePage: async () => {
      await new Promise((r) => setTimeout(r, 400));
      if (failSave) throw new Error('firestore write failed (simulated)');
    },
    newPageId: () => `page-${Date.now()}`,
    now: () => Date.now(),
  };

  const inputs = workspaceFamiliarInputs({
    composerText: '',
    persisting: false,
    isGenerating: false,
    draftingPage,
    flowErrorVisible: false,
    persistedGenerationFailed: false,
    diaryEditorErrorVisible: editorError,
    diaryEditorOpen: open,
    justReady: false,
    pageJustSaved,
  });

  return (
    <section id="scenario-b" className="space-y-2 pt-4 border-t border-[#E8E4D8]">
      <h2 className="text-xs font-bold uppercase tracking-wide text-[#4A4A3A]">
        B · PF-01 draft/save failures reach the familiar through the editor seam
      </h2>
      <div className="flex gap-3 text-[11px] text-[#7A5825]">
        <label className="flex items-center gap-1">
          <input id="b-fail-draft" type="checkbox" checked={failDraft} onChange={(e) => setFailDraft(e.target.checked)} />
          fail draft
        </label>
        <label className="flex items-center gap-1">
          <input id="b-fail-save" type="checkbox" checked={failSave} onChange={(e) => setFailSave(e.target.checked)} />
          fail save
        </label>
      </div>
      <FamiliarPresence inputs={inputs} mode="deep_reflection" />
      {pageJustSaved && (
        <div id="b-saved-ack" className="p-2 rounded-xl bg-[#FAF3E0] border border-[#E8DAB2] text-[#7A5825] text-xs font-semibold">
          Diary page saved.
        </div>
      )}
      {open && (
        <DiaryDraftEditor
          userId="preview-user"
          interaction={{ ...FAILED_ENTRY, generationStatus: 'complete' }}
          deps={deps}
          todayISO="2026-09-02"
          onConfirmed={() => { setOpen(false); setPageJustSaved(true); }}
          onClose={() => setOpen(false)}
          onDraftingChange={setDraftingPage}
          onRecoverableErrorChange={setEditorError}
        />
      )}
      {!open && !pageJustSaved && (
        <button id="b-reopen" onClick={() => setOpen(true)} className="px-3 py-1.5 rounded-lg border border-[#D8D3C5] text-xs">reopen editor</button>
      )}
    </section>
  );
}

createRoot(document.getElementById('root')!).render(
  <div className="min-h-screen bg-[#FDFCF7] text-[#38382E] p-4 space-y-5 max-w-3xl mx-auto">
    <div className="p-2 rounded-xl border border-dashed border-[#C9B98A] bg-[#FBF7EC] text-[11px] text-[#7A5825]">
      <strong>PF-02.1 actual-flow harness (dev only)</strong> — no direct state selection; the familiar
      moves only through real flow outcomes and component callbacks.
    </div>
    <ScenarioA />
    <ScenarioB />
  </div>
);
