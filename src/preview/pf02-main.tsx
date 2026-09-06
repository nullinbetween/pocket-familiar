import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { FamiliarPresence } from '../components/Familiar';
import { FamiliarCallout } from '../components/FamiliarCallout';
import { FamiliarInputs, FamiliarState, deriveFamiliarState } from '../lib/familiar-state';
import { ReflectionMode } from '../types';

/** PF-02 dev-only harness: force each app-owned state/mode for browser evidence. */

const NONE: FamiliarInputs = {
  isWriting: false,
  isSavingRaw: false,
  isThinking: false,
  isDraftingPage: false,
  hasRecoverableError: false,
  justReady: false,
  justCelebratedSave: false,
};

const PRESETS: Record<FamiliarState, FamiliarInputs> = {
  quiet: NONE,
  listening: { ...NONE, isWriting: true },
  saving: { ...NONE, isSavingRaw: true, isThinking: true }, // saving must win
  thinking: { ...NONE, isThinking: true },
  ready: { ...NONE, justReady: true },
  drafting_page: { ...NONE, isDraftingPage: true },
  celebrating_save: { ...NONE, justCelebratedSave: true },
  error_recoverable: { ...NONE, hasRecoverableError: true, justCelebratedSave: true }, // error must win
};

const MODES: ReflectionMode[] = ['deep_reflection', 'summary', 'brainstorm', 'action_plan', 'mindful_chat'];

function Preview() {
  const [preset, setPreset] = useState<FamiliarState>('quiet');
  const [mode, setMode] = useState<ReflectionMode>('deep_reflection');
  const [reduced, setReduced] = useState(false);
  const inputs = PRESETS[preset];
  return (
    <div className="min-h-screen bg-[#FDFCF7] text-[#38382E] p-4 space-y-4 max-w-3xl mx-auto">
      <div className="flex flex-wrap items-center gap-2 p-3 rounded-xl border border-dashed border-[#C9B98A] bg-[#FBF7EC] text-[11px] text-[#7A5825]">
        <strong>PF-02 harness (dev only)</strong>
        {(Object.keys(PRESETS) as FamiliarState[]).map((s) => (
          <button key={s} id={`preset-${s}`} onClick={() => setPreset(s)}
            className={`px-2 py-1 rounded border text-[10px] font-semibold ${preset === s ? 'bg-[#7A5825] text-white border-[#7A5825]' : 'bg-white border-[#E0DBCF] text-[#4A4A3A]'}`}>
            {s}
          </button>
        ))}
        <span className="mx-1">|</span>
        {MODES.map((m) => (
          <button key={m} id={`mode-${m}`} onClick={() => setMode(m)}
            className={`px-2 py-1 rounded border text-[10px] font-semibold ${mode === m ? 'bg-[#55604B] text-white border-[#55604B]' : 'bg-white border-[#E0DBCF] text-[#4A4A3A]'}`}>
            {m}
          </button>
        ))}
        <label className="flex items-center gap-1 ml-1">
          <input id="toggle-reduced-motion" type="checkbox" checked={reduced} onChange={(e) => setReduced(e.target.checked)} />
          reduced motion
        </label>
      </div>

      <FamiliarPresence inputs={inputs} mode={mode} reducedMotion={reduced} />

      <p className="text-[11px] text-[#7A7A6A]">
        derived state: <code id="derived-state">{deriveFamiliarState(inputs)}</code>
      </p>

      <div className="pt-3 border-t border-[#E8E4D8] space-y-2">
        <h2 className="text-xs font-bold uppercase tracking-wide text-[#4A4A3A]">PF-01 callout (mobile stacking check)</h2>
        <FamiliarCallout mode={mode} onPress={() => undefined} />
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Preview />);
