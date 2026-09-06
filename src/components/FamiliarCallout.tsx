import React from 'react';
import { FamiliarAvatar } from './Familiar';
import { ReflectionMode } from '../types';

/**
 * PF-01 closing ritual entry point, PF-02 revision: the real familiar appears,
 * and on small screens avatar+copy+button STACK so the text never collapses
 * into a narrow column (Codex PF-02 mobile requirement).
 */
export const FamiliarCallout: React.FC<{
  onPress: () => void;
  disabled?: boolean;
  /** PF-02.1: the callout shows the SAME posture as the workspace familiar. */
  mode: ReflectionMode;
}> = ({ onPress, disabled, mode }) => (
  <div
    id="familiar-press-callout"
    className="rounded-2xl border border-[#CBD6C3] bg-[#EDF2E8] p-4 flex flex-col sm:flex-row sm:items-center gap-3 shadow-2xs"
  >
    <div className="flex items-center gap-3 flex-1 min-w-0">
      <div className="shrink-0">
        <FamiliarAvatar state="quiet" mode={mode} size={48} />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-[#2D3126]">
          Shall I press this conversation into today&rsquo;s page?
        </p>
        <p className="text-[11px] text-[#5A6650] mt-0.5">
          I&rsquo;ll draft a diary page from your own words — you decide what&rsquo;s kept.
        </p>
      </div>
    </div>
    <button
      id="press-into-page-btn"
      onClick={onPress}
      disabled={disabled}
      className="w-full sm:w-auto shrink-0 px-3.5 py-2 rounded-xl bg-[#55604B] hover:bg-[#434D3A] text-[#FDFCF7] text-xs font-bold shadow-xs transition-colors disabled:opacity-50"
    >
      Press into today&rsquo;s page
    </button>
  </div>
);
