import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { DiaryDraftEditor } from '../components/DiaryDraftEditor';
import { DiaryPagesView } from '../components/DiaryPagesView';
import { FamiliarCallout } from '../components/FamiliarCallout';
import { DiaryFlowDeps } from '../lib/diary-flow';
import { DiaryPage, JournalInteraction } from '../types';
import { localTodayISO } from '../lib/text-metrics';

/**
 * PF-01 BROWSER PREVIEW HARNESS — dev-server only, never part of the
 * production build (vite builds index.html only). Real Firebase/Gemini are
 * replaced by deterministic fakes so the closing-ritual UI states can be
 * exercised and captured as browser evidence without any cloud resources.
 */

const CONVERSATION: JournalInteraction = {
  id: 'conv-preview',
  userId: 'preview-user',
  title: 'Nursery drop-off',
  initialPrompt: 'Drop-off was rough again this morning…',
  reflectionOutput: '',
  mode: 'deep_reflection',
  mood: 'anxious',
  tags: ['reflection'],
  turns: [
    { id: 'usr_1', role: 'user', content: 'Drop-off was rough again this morning — she cried and I second-guessed everything on the walk to the station.', timestamp: 1 },
    { id: 'gem_1', role: 'model', content: 'That sounds heavy. What do you think the tears were carrying for her — and for you?', timestamp: 2 },
    { id: 'usr_2', role: 'user', content: 'By pickup she was beaming and showed me a painting. Maybe the hard part is mine, not hers.', timestamp: 3 },
  ],
  createdAt: 1,
  updatedAt: 3,
};

const FAKE_DRAFT = {
  title: 'The hard part might be mine',
  todayInMyWords:
    'Drop-off was rough and I doubted myself all the way to the station. But at pickup she was beaming with a painting in her hand. Maybe the hard part of goodbye belongs to me, not her.',
  whatFeltImportant: ['She was beaming at pickup', 'The doubt eased once I named it'],
  carryForward: 'Trust the pickup, not the drop-off.',
  sourceTurnIds: ['usr_1', 'usr_2'],
};

function Preview() {
  const [failDraft, setFailDraft] = useState(false);
  const [failSave, setFailSave] = useState(false);
  const [editing, setEditing] = useState(false);
  const [pages, setPages] = useState<DiaryPage[]>([]);
  const [savedAck, setSavedAck] = useState(false);

  const deps: DiaryFlowDeps = {
    requestDraft: async () => {
      await new Promise((r) => setTimeout(r, 600));
      if (failDraft) throw new Error('Companion response unavailable (simulated)');
      return FAKE_DRAFT;
    },
    savePage: async (pageId, page) => {
      await new Promise((r) => setTimeout(r, 400));
      if (failSave) throw new Error('Firestore write failed (simulated)');
      setPages((prev) => [{ ...(page as DiaryPage), id: pageId }, ...prev.filter((p) => p.id !== pageId)]);
    },
    newPageId: () => `page-${Date.now()}`,
    now: () => Date.now(),
  };

  return (
    <div className="min-h-screen bg-[#FDFCF7] text-[#38382E] p-4 space-y-5 max-w-3xl mx-auto">
      <div className="flex flex-wrap items-center gap-3 p-3 rounded-xl border border-dashed border-[#C9B98A] bg-[#FBF7EC] text-[11px] text-[#7A5825]">
        <strong>PF-01 preview harness (fakes, dev only)</strong>
        <label className="flex items-center gap-1"><input id="toggle-fail-draft" type="checkbox" checked={failDraft} onChange={(e) => setFailDraft(e.target.checked)} /> simulate draft failure</label>
        <label className="flex items-center gap-1"><input id="toggle-fail-save" type="checkbox" checked={failSave} onChange={(e) => setFailSave(e.target.checked)} /> simulate save failure</label>
      </div>

      {/* Conversation excerpt (process) */}
      <section className="space-y-2">
        <h2 className="text-xs font-bold uppercase tracking-wide text-[#4A4A3A]">Conversation (process)</h2>
        {CONVERSATION.turns.map((t) => (
          <div key={t.id} className={`max-w-[85%] rounded-2xl p-3 text-xs leading-relaxed shadow-2xs ${t.role === 'user' ? 'ml-auto bg-[#2D3126] text-[#FDFCF7]' : 'bg-white border border-[#E8E4D8] text-[#38382E]'}`}>
            {t.content}
          </div>
        ))}
      </section>

      {!editing && <FamiliarCallout mode="deep_reflection" onPress={() => { setSavedAck(false); setEditing(true); }} />}
      {savedAck && !editing && (
        <div id="diary-page-saved-ack" className="p-3 rounded-xl bg-[#FAF3E0] border border-[#E8DAB2] text-[#7A5825] text-xs font-semibold">
          Diary page saved. You can find it under Diary Pages.
        </div>
      )}
      {editing && (
        <DiaryDraftEditor
          userId="preview-user"
          interaction={CONVERSATION}
          deps={deps}
          todayISO={localTodayISO()}
          onConfirmed={() => { setEditing(false); setSavedAck(true); }}
          onClose={() => setEditing(false)}
        />
      )}

      <section className="space-y-2 pt-2 border-t border-[#E8E4D8]">
        <h2 className="text-xs font-bold uppercase tracking-wide text-[#7A5825]">Diary Pages (result)</h2>
        <DiaryPagesView pages={pages} isSourceAvailable={() => true} onOpenSource={() => undefined} />
      </section>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Preview />);
