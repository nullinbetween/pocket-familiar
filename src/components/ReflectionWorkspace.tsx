import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  Send, Loader2, Copy, Check, Brain, ListTodo, FileText, Lightbulb, MessageSquare,
  AlertTriangle, RotateCcw, Type, Tag as TagIcon, Smile, SlidersHorizontal, Feather, X,
} from 'lucide-react';
import { JournalInteraction, MoodType, ReflectionMode } from '../types';
import { getIdTokenOrThrow } from '../lib/firebase';
import { createReflectionFlowDeps } from '../lib/reflection-deps';
import { FlowDeps, retryGeneration, submitEntry } from '../lib/reflection-flow';
import { DiaryFlowDeps, userTurnsOf } from '../lib/diary-flow';
import { localTodayISO } from '../lib/text-metrics';
import { FamiliarAvatar } from './Familiar';
import { deriveFamiliarState, familiarCopyFor, FAMILIAR_IDENTITY, modePresentationFor } from '../lib/familiar-state';
import { workspaceFamiliarInputs } from '../lib/familiar-workspace';
import { newDiaryPageId, saveDiaryPage } from '../lib/firestore-service';
import { FamiliarCallout } from './FamiliarCallout';
import { DiaryDraftEditor } from './DiaryDraftEditor';
import { DiaryPage } from '../types';
import { JOURNAL_COPY, LANDING_ART } from '../lib/brand';

interface ReflectionWorkspaceProps {
  userId: string;
  userEmail?: string;
  activeInteraction: JournalInteraction | null;
  onSessionUpdated: (interaction: JournalInteraction) => void;
  onNewSession: () => void;
  onDiaryPageConfirmed?: (page: DiaryPage) => void;
}

const MOODS: Array<{ type: MoodType; label: string; icon: string }> = [
  { type: 'serene', label: 'Serene', icon: '🌿' },
  { type: 'inspired', label: 'Inspired', icon: '✨' },
  { type: 'grateful', label: 'Grateful', icon: '🙏' },
  { type: 'thoughtful', label: 'Thoughtful', icon: '💡' },
  { type: 'anxious', label: 'Anxious', icon: '🌊' },
  { type: 'frustrated', label: 'Frustrated', icon: '🔥' },
  { type: 'neutral', label: 'Neutral', icon: '⚖️' },
];

const MODES: Array<{ type: ReflectionMode; label: string; description: string; icon: React.ElementType }> = [
  { type: 'deep_reflection', label: 'Reflect', description: 'Sit with it and look a little deeper', icon: Brain },
  { type: 'summary', label: 'Summarise', description: 'Gather the threads into a clear overview', icon: FileText },
  { type: 'brainstorm', label: 'Explore', description: 'Open up a few fresh possibilities', icon: Lightbulb },
  { type: 'action_plan', label: 'Plan', description: 'Turn it into one or two next steps', icon: ListTodo },
  { type: 'mindful_chat', label: 'Talk', description: 'Just an open, gentle conversation', icon: MessageSquare },
];

const PROMPT_STARTERS: Record<ReflectionMode, string[]> = {
  deep_reflection: [
    'I found myself reacting strongly to a comment today, and I want to understand what triggered me...',
    'I am feeling conflicted between pursuing a safe routine and taking a creative risk...',
    'Looking back at the past few weeks, I notice I have been neglecting my boundaries with...',
  ],
  summary: [
    'Here are my unorganized notes and brain-dump from today’s meetings and personal thoughts...',
    'Weekly reflection: What did I achieve, where did I spend my energy, and what drained me...',
    'Key milestones and takeaways from my recent project delivery...',
  ],
  brainstorm: [
    'I want to brainstorm 5 novel ways to re-engage with my reading habits without feeling pressured...',
    'Ideas for a weekend reset ritual that blends physical movement with mindful stillness...',
    'Creative directions for solving our team’s asynchronous communication bottleneck...',
  ],
  action_plan: [
    'I have an overwhelming list of 10 tasks. Help me turn these into 3 clear priorities with 24-hour milestones...',
    'I want to build a consistent morning writing habit. What is a pragmatic step-by-step roadmap?',
    'Action plan for preparing an honest, empathetic conversation with a collaborator...',
  ],
  mindful_chat: [
    'Today felt heavy. I just need a safe space to talk through what happened...',
    'I had an unexpected win today and wanted to celebrate the small progress...',
    'Can we talk through a strategy for managing pre-presentation jitters?',
  ],
};

type Tray = null | 'title' | 'mood' | 'tags' | 'starters' | 'modes';

export const ReflectionWorkspace: React.FC<ReflectionWorkspaceProps> = ({
  userId, userEmail, activeInteraction, onSessionUpdated, onNewSession, onDiaryPageConfirmed,
}) => {
  const [title, setTitle] = useState(activeInteraction?.title || '');
  const [mood, setMood] = useState<MoodType>(activeInteraction?.mood || 'thoughtful');
  const [mode, setMode] = useState<ReflectionMode>(activeInteraction?.mode || 'deep_reflection');
  const [inputPrompt, setInputPrompt] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>(activeInteraction?.tags || ['reflection']);
  const [tray, setTray] = useState<Tray>(null);

  const [isGenerating, setIsGenerating] = useState(false);
  const [flowError, setFlowError] = useState<{ kind: 'save' | 'generation'; message: string } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [persisting, setPersisting] = useState(false);
  const [savedAck, setSavedAck] = useState(false);
  const [pressingPage, setPressingPage] = useState(false);
  const [pageJustSaved, setPageJustSaved] = useState(false);
  const [draftingPage, setDraftingPage] = useState(false);
  const [justReady, setJustReady] = useState(false);
  const [diaryEditorError, setDiaryEditorError] = useState(false);

  const chatBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeInteraction) {
      setTitle(activeInteraction.title || '');
      setMood(activeInteraction.mood || 'thoughtful');
      setMode(activeInteraction.mode || 'deep_reflection');
      setTags(activeInteraction.tags || ['reflection']);
      setInputPrompt('');
    } else {
      setTitle(''); setMood('thoughtful'); setMode('deep_reflection'); setTags(['reflection']); setInputPrompt('');
    }
    setFlowError(null); setPressingPage(false); setPageJustSaved(false);
    setDraftingPage(false); setJustReady(false); setDiaryEditorError(false); setTray(null);
  }, [activeInteraction?.id]);

  useEffect(() => {
    if (!pageJustSaved) return;
    const t = setTimeout(() => setPageJustSaved(false), 5000);
    return () => clearTimeout(t);
  }, [pageJustSaved]);

  useEffect(() => { chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [activeInteraction?.turns, isGenerating]);

  const handleAddTag = () => {
    const trimmed = tagInput.trim().replace(/^#/, '');
    if (trimmed && !tags.includes(trimmed)) { setTags([...tags, trimmed]); setTagInput(''); }
  };
  const handleRemoveTag = (t: string) => setTags(tags.filter((x) => x !== t));
  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text); setCopiedId(id); setTimeout(() => setCopiedId(null), 2000);
  };

  // Gate B/C: one authenticated, raw-save-first dependency set, shared with the
  // History Quick Reply modal (see src/lib/reflection-deps.ts).
  const flowDeps: FlowDeps = createReflectionFlowDeps(userId, {
    onSaved: (entry) => { setSavedAck(true); setPersisting(false); onSessionUpdated(entry); },
  });

  const diaryDeps: DiaryFlowDeps = {
    requestDraft: async (payload) => {
      const idToken = await getIdTokenOrThrow();
      const response = await fetch('/api/gemini/diary-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Server responded with status ${response.status}`);
      }
      const data = await response.json();
      return data.draft;
    },
    savePage: (pageId, page) => saveDiaryPage(userId, pageId, page),
    newPageId: () => newDiaryPageId(userId),
    now: () => Date.now(),
  };

  const handleSubmit = async (customPrompt?: string) => {
    const promptToSend = (customPrompt || inputPrompt).trim();
    if (!promptToSend || isGenerating) return;
    setFlowError(null); setSavedAck(false); setJustReady(false); setIsGenerating(true); setPersisting(true); setTray(null);
    try {
      const outcome = await submitEntry(flowDeps, {
        userId, userEmail, title, mood, mode, tags, promptText: promptToSend, existing: activeInteraction,
      });
      if (outcome.phase === 'save_failed') {
        setFlowError({ kind: 'save', message: outcome.error || 'Could not save your entry. Nothing was lost — retry the save.' });
        return;
      }
      setInputPrompt('');
      onSessionUpdated(outcome.entry);
      if (outcome.phase === 'complete') setJustReady(true);
      if (outcome.phase === 'saved_generation_failed') {
        setFlowError({ kind: 'generation', message: outcome.error || 'Companion response unavailable.' });
      }
    } finally { setIsGenerating(false); setPersisting(false); }
  };

  const handleRetryGeneration = async () => {
    if (!activeInteraction?.id || isGenerating) return;
    setFlowError(null); setJustReady(false); setIsGenerating(true);
    try {
      const outcome = await retryGeneration(flowDeps, activeInteraction);
      if (outcome.phase === 'complete') { onSessionUpdated(outcome.entry); setJustReady(true); }
      else if (outcome.phase === 'saved_generation_failed') {
        onSessionUpdated(outcome.entry);
        setFlowError({ kind: 'generation', message: outcome.error || 'Companion response unavailable.' });
      }
    } finally { setIsGenerating(false); }
  };

  const hasTurns = !!(activeInteraction && activeInteraction.turns && activeInteraction.turns.length > 0);

  const famState = deriveFamiliarState(workspaceFamiliarInputs({
    composerText: inputPrompt, persisting, isGenerating, draftingPage,
    flowErrorVisible: flowError !== null,
    persistedGenerationFailed: activeInteraction?.generationStatus === 'failed',
    diaryEditorErrorVisible: diaryEditorError, diaryEditorOpen: pressingPage,
    justReady, pageJustSaved,
  }));
  const famCopy = familiarCopyFor(famState);
  const dateLabel = new Date(activeInteraction?.createdAt || Date.now())
    .toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });

  const toggleTray = (t: Tray) => setTray((cur) => (cur === t ? null : t));
  const ToolBtn: React.FC<{ t: Exclude<Tray, null>; label: string; children: React.ReactNode }> = ({ t, label, children }) => (
    <button
      type="button"
      onClick={() => toggleTray(t)}
      aria-pressed={tray === t}
      aria-label={label}
      title={label}
      className={`p-2 rounded-lg transition-colors ${tray === t ? 'bg-[var(--pf-forest)] text-[var(--pf-cream)]' : 'text-[#6A6A5A] hover:bg-[#EFECE3]'}`}
    >
      {children}
    </button>
  );

  return (
    <div className="pf-stage pf-page-frame space-y-4">
      {/* Date · Private */}
      <div className="flex items-center justify-center gap-2 text-xs text-[#7A7A6A]">
        <span>{dateLabel}</span>
        <span>&middot;</span>
        <span className="inline-flex items-center gap-1">{JOURNAL_COPY.privateLabel}
          <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>
        </span>
        {(activeInteraction?.id || savedAck) && (
          <>
            <span>&middot;</span>
            <span className="text-[var(--pf-forest-deep)]">Saved</span>
          </>
        )}
        {hasTurns && (
          <button id="workspace-start-new-session-btn" onClick={onNewSession}
            className="ml-1 inline-flex items-center gap-1 text-[var(--pf-forest-deep)] hover:underline">
            <RotateCcw className="w-3 h-3" /> New
          </button>
        )}
      </div>

      {/* Journal desk: one joined surface — accepted garden scene + paper sheet */}
      <div className="pf-journal-stage">
        <div className="pf-journal-scene rounded-t-[26px] overflow-hidden shadow-lg border border-[rgba(194,162,94,0.28)] border-b-0">
          <div className="relative h-52 sm:h-64 lg:h-72">
            <img src={LANDING_ART.heroDesktop} alt="" aria-hidden="true" className="absolute inset-0 w-full h-full object-cover object-right" decoding="async" />
            <div className="absolute inset-0 bg-gradient-to-t from-[#10151F]/55 via-transparent to-transparent" aria-hidden="true" />
            {/* deterministic state via a small Q-head status chip (the scene already holds a familiar) */}
            <div
              id="familiar-presence" role="status" aria-label={`Pocket familiar: ${famCopy}`}
              data-state={famState} data-identity={FAMILIAR_IDENTITY}
              className="absolute left-3 top-3 inline-flex items-center gap-2 rounded-full pl-1.5 pr-3 py-1 bg-[color-mix(in_srgb,var(--pf-paper)_92%,transparent)] border pf-hairline shadow-2xs max-w-[85%]"
            >
              <FamiliarAvatar state={famState} mode={mode} size={30} variant="head" />
              <span id="familiar-state-copy" className="text-[11px] font-semibold text-[var(--pf-ink)] truncate">{famCopy}</span>
              <span id="familiar-mode-line" className="sr-only">{modePresentationFor(mode).line}</span>
            </div>
          </div>
        </div>

        {/* Writing sheet joined to the scene (rises over its lower edge) */}
        <div className="pf-sheet pf-sheet-overlap rounded-[24px] border pf-hairline p-4 sm:p-6 space-y-3 mx-1">
          <textarea
            id="workspace-prompt-textarea"
            rows={hasTurns ? 4 : 7}
            value={inputPrompt}
            onChange={(e) => { setInputPrompt(e.target.value); setJustReady(false); }}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); handleSubmit(); } }}
            placeholder={hasTurns ? 'Keep going…' : JOURNAL_COPY.prompt}
            className="w-full bg-transparent border-none p-0 text-base sm:text-lg text-[var(--pf-ink)] placeholder:text-[#9a9482] placeholder:italic leading-relaxed resize-y focus:outline-hidden"
            style={{ fontFamily: '"Playfair Display", Georgia, serif' }}
          />
          <div className="flex items-center justify-between gap-2 pt-2 border-t pf-hairline">
            <div className="flex items-center gap-0.5">
              <ToolBtn t="title" label="Title"><Type className="w-4 h-4" /></ToolBtn>
              <ToolBtn t="mood" label="Mood"><Smile className="w-4 h-4" /></ToolBtn>
              <ToolBtn t="tags" label="Tags"><TagIcon className="w-4 h-4" /></ToolBtn>
              <ToolBtn t="starters" label="Ways to begin"><Lightbulb className="w-4 h-4" /></ToolBtn>
              <ToolBtn t="modes" label="How your familiar helps"><SlidersHorizontal className="w-4 h-4" /></ToolBtn>
            </div>
            <button
              id="workspace-submit-prompt-btn"
              onClick={() => handleSubmit()}
              disabled={isGenerating || !inputPrompt.trim()}
              aria-label={hasTurns ? 'Send' : 'Share with your familiar'}
              className="inline-flex items-center justify-center gap-2 h-11 min-w-11 px-4 rounded-full bg-[var(--pf-forest)] hover:bg-[var(--pf-forest-deep)] text-[var(--pf-cream)] text-xs font-bold shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Feather className="w-4 h-4" />}
              <span className="hidden sm:inline">{isGenerating ? 'Working…' : hasTurns ? 'Send' : 'Share'}</span>
            </button>
          </div>
          {persisting && (
            <p className="text-[10px] text-[var(--pf-forest-deep)] font-semibold flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Keeping your words safe…</p>
          )}
          <p className="text-[10px] text-[#9a9482] text-right">Cmd/Ctrl + Enter</p>
        </div>
      </div>

      {/* Progressive-disclosure tool tray (one panel at a time, never a stack) */}
      {tray && (
        <div className="pf-paper-surface rounded-2xl border pf-hairline p-3 shadow-2xs text-xs">
          <div className="flex items-center justify-between mb-2">
            <span className="font-bold text-[#4A4A3A] uppercase tracking-wider text-[10px]">
              {tray === 'title' ? 'Title' : tray === 'mood' ? 'Mood' : tray === 'tags' ? 'Tags'
                : tray === 'starters' ? 'A few ways to begin' : 'How should your familiar help?'}
            </span>
            <button onClick={() => setTray(null)} className="p-0.5 text-[#8A8A7A] hover:text-[var(--pf-ink)]"><X className="w-3.5 h-3.5" /></button>
          </div>

          {tray === 'title' && (
            <input id="workspace-entry-title-input" type="text" value={title}
              onChange={(e) => setTitle(e.target.value)} placeholder="Give today’s entry a title (optional)…"
              className="w-full px-3 py-2 rounded-xl border border-[#E0DBCF] bg-white text-sm text-[var(--pf-ink)] focus:outline-hidden focus:border-[var(--pf-forest)]" />
          )}

          {tray === 'mood' && (
            <div className="flex flex-wrap gap-1.5">
              {MOODS.map((m) => (
                <button key={m.type} id={`mood-btn-${m.type}`} onClick={() => setMood(m.type)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border transition-all ${
                    mood === m.type ? 'border-[var(--pf-forest)] bg-[var(--pf-forest)] text-[var(--pf-cream)] font-semibold'
                    : 'border-[#E8E4D8] text-[#4A4A3A] bg-white hover:border-[#CBD6C3]'}`}>
                  <span>{m.icon}</span><span>{m.label}</span>
                </button>
              ))}
            </div>
          )}

          {tray === 'tags' && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {tags.map((t) => (
                <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#EFECE3] text-[#4A4A3A] text-[11px] border pf-hairline">
                  #{t}<button onClick={() => handleRemoveTag(t)} className="text-[#8A8A7A] hover:text-[var(--pf-ink)]">&times;</button>
                </span>
              ))}
              <span className="inline-flex items-center gap-1">
                <input id="workspace-tag-input" type="text" value={tagInput} placeholder="Add tag"
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddTag(); } }}
                  className="w-20 px-2 py-1 rounded-md border border-[#E0DBCF] bg-white text-xs focus:outline-hidden focus:border-[var(--pf-forest)]" />
                <button id="workspace-add-tag-btn" onClick={handleAddTag} className="p-1 rounded bg-[#EFECE3] hover:bg-[#E2DDCF] text-[#555546]">+</button>
              </span>
            </div>
          )}

          {tray === 'starters' && (
            <div className="grid grid-cols-1 gap-2">
              {PROMPT_STARTERS[mode].map((starter, idx) => (
                <button key={idx} id={`prompt-starter-${idx}`}
                  onClick={() => { setInputPrompt(starter); if (!title) setTitle(starter.slice(0, 35) + '...'); setTray(null); }}
                  className="text-left p-2.5 rounded-xl bg-white border pf-hairline hover:border-[#CBD6C3] hover:bg-[#F5F2EA] text-[#4A4A3A] leading-relaxed">
                  "{starter}"
                </button>
              ))}
            </div>
          )}

          {tray === 'modes' && (
            <div className="flex flex-wrap gap-2">
              {MODES.map((m) => {
                const Icon = m.icon; const on = mode === m.type;
                return (
                  <button key={m.type} id={`mode-btn-${m.type}`} onClick={() => setMode(m.type)} title={m.description} aria-pressed={on}
                    className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border font-semibold transition-all ${
                      on ? 'border-[var(--pf-forest)] bg-[var(--pf-forest)] text-[var(--pf-cream)]'
                      : 'border-[#E0DBCF] bg-white text-[#555546] hover:border-[#CBD6C3]'}`}>
                    <Icon className={`w-4 h-4 ${on ? 'text-[var(--pf-cream)]' : 'text-[#7A7A6A]'}`} /><span>{m.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Conversation feed (paper) */}
      {hasTurns && (
        <div className="space-y-3">
          {activeInteraction!.turns.map((turn, index) => {
            const isUser = turn.role === 'user';
            return (
              <div key={turn.id || index} id={`conversation-turn-${turn.id || index}`}
                className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[88%] rounded-2xl p-3.5 shadow-2xs text-xs leading-relaxed ${
                  isUser ? 'bg-[var(--pf-ink)] text-[var(--pf-cream)] rounded-tr-xs'
                         : 'pf-paper-surface text-[#38382E] border pf-hairline rounded-tl-xs'}`}>
                  <div className="flex items-center justify-between gap-3 mb-1.5">
                    <span className="font-bold text-[10px] opacity-80">{isUser ? 'You' : 'Your familiar'}</span>
                    <button onClick={() => handleCopy(turn.content, turn.id)} className="opacity-60 hover:opacity-100 p-0.5" title="Copy">
                      {copiedId === turn.id ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    </button>
                  </div>
                  {isUser ? <p className="whitespace-pre-wrap">{turn.content}</p>
                    : <div className="markdown-body prose prose-xs max-w-none text-[#38382E]"><ReactMarkdown>{turn.content}</ReactMarkdown></div>}
                </div>
              </div>
            );
          })}
          {isGenerating && (
            <div className="flex justify-start">
              <div className="pf-paper-surface border pf-hairline rounded-2xl rounded-tl-xs p-3.5 text-xs text-[var(--pf-forest-deep)] flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Your familiar is thinking…
              </div>
            </div>
          )}
        </div>
      )}

      {/* When reopening an existing conversation, keep its continuation control
          beside the last turn. iOS needs a 16px field to avoid viewport zoom. */}
      {hasTurns && (
        <section id="workspace-continuation-composer"
          className="sticky bottom-3 z-20 pf-paper-surface rounded-2xl border border-[rgba(194,162,94,0.42)] p-3 shadow-xl space-y-2">
          <label htmlFor="workspace-continuation-textarea"
            className="block text-[10px] font-bold uppercase tracking-[0.13em] text-[var(--pf-forest-deep)]">
            Continue this conversation
          </label>
          <div className="flex items-end gap-2">
            <textarea id="workspace-continuation-textarea" rows={2} value={inputPrompt}
              onChange={(e) => { setInputPrompt(e.target.value); setJustReady(false); }}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); handleSubmit(); } }}
              placeholder="Write the next turn…"
              className="flex-1 min-w-0 resize-none rounded-xl border border-[#E0DBCF] bg-white/80 px-3 py-2 text-base sm:text-sm leading-relaxed text-[var(--pf-ink)] placeholder:text-[#9A9482] focus:outline-hidden focus:border-[var(--pf-forest)]" />
            <button id="workspace-continuation-send-btn" onClick={() => handleSubmit()}
              disabled={isGenerating || !inputPrompt.trim()} aria-label="Send next turn"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--pf-forest)] text-[var(--pf-cream)] shadow-md disabled:opacity-50">
              {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
        </section>
      )}
      <div ref={chatBottomRef} />

      {/* Closing ritual + Remember-this editor + acks + errors */}
      {activeInteraction?.id && userTurnsOf(activeInteraction).length > 0 && !pressingPage && (
        <FamiliarCallout mode={mode} onPress={() => { setPageJustSaved(false); setPressingPage(true); }} disabled={isGenerating} />
      )}
      {pageJustSaved && !pressingPage && (
        <div id="diary-page-saved-ack" className="p-3 rounded-xl bg-[#FAF3E0] border border-[#E8DAB2] text-[#7A5825] text-xs font-semibold">
          Today’s page is kept. You’ll find it in your Memory library.
        </div>
      )}
      {activeInteraction?.id && pressingPage && (
        <DiaryDraftEditor
          userId={userId} interaction={activeInteraction} deps={diaryDeps} todayISO={localTodayISO()}
          onConfirmed={(page) => { setPressingPage(false); setDraftingPage(false); setPageJustSaved(true); onDiaryPageConfirmed?.(page); }}
          onClose={() => { setPressingPage(false); setDraftingPage(false); }}
          onDraftingChange={setDraftingPage}
          onRecoverableErrorChange={setDiaryEditorError}
        />
      )}
      {!flowError && !isGenerating && !pressingPage && activeInteraction?.generationStatus === 'failed' && (
        <div className="p-3 rounded-xl bg-[#FAF4E8] border border-[#EADBBA] text-[#8C6527] text-xs flex items-center justify-between gap-3">
          <span>This entry is saved, but the companion response is still missing.</span>
          <button id="retry-response-standing-btn" onClick={handleRetryGeneration}
            className="px-2.5 py-1 rounded-md bg-[#8C6527] hover:bg-[#6F4F1E] text-white font-semibold text-xs shrink-0">Try again</button>
        </div>
      )}
      {flowError && (
        <div className="p-4 rounded-xl bg-[#FBEFEF] border border-[#ECC8C8] text-[#8C3232] text-xs flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <strong className="font-bold">{flowError.kind === 'save' ? 'Could not save your entry:' : 'Saved; companion response unavailable:'}</strong>
              <p className="mt-0.5">{flowError.message}</p>
              {flowError.kind === 'save' && <p className="mt-0.5 opacity-80">Your text is still in the composer — nothing was lost.</p>}
            </div>
          </div>
          {flowError.kind === 'save'
            ? <button id="retry-save-btn" onClick={() => handleSubmit()} className="px-2.5 py-1 rounded-md bg-[#8C3232] hover:bg-[#722727] text-white font-semibold text-xs shrink-0">Retry save</button>
            : <button id="retry-response-btn" onClick={handleRetryGeneration} className="px-2.5 py-1 rounded-md bg-[#8C3232] hover:bg-[#722727] text-white font-semibold text-xs shrink-0">Try again</button>}
        </div>
      )}

    </div>
  );
};
