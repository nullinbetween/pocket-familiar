import React from 'react';
import { ReflectionMode } from '../types';
import {
  deriveFamiliarState,
  familiarCopyFor,
  FamiliarInputs,
  FamiliarState,
  FAMILIAR_IDENTITY,
  modePresentationFor,
  motionClassesFor,
} from '../lib/familiar-state';
import { FAMILIAR_ART, FAMILIAR_HEAD, FAMILIAR_ALT } from '../lib/brand';

/**
 * PF-02 -> Skin Round 1: ONE Pocket Familiar, now rendered from the accepted
 * painterly art pipeline instead of code-native SVG. The SAME identity appears
 * in every mode and state; only which state portrait shows, one accent line of
 * app-authored copy, and purposeful micro-motion vary.
 *
 * Determinism is unchanged: the portrait is chosen ONLY from the app-owned
 * FamiliarState (deriveFamiliarState), never from model output. State is never
 * conveyed by colour alone -- the visible label + distinct per-state art carry
 * it, and the root still exposes data-identity / data-state / data-posture and
 * aria labels for assistive tech and tests. Reduced motion strips every
 * nonessential animation while the static portrait stays fully readable.
 *
 * variant:
 *   - 'head' -> compact head-only runtime icon (accepted 96px q-head export);
 *   - 'full' -> large painterly portrait, for landing / workspace presence.
 */

export const FamiliarAvatar: React.FC<{
  state: FamiliarState;
  mode: ReflectionMode;
  reducedMotion?: boolean;
  size?: number;
  variant?: 'head' | 'full';
  /** Meaningful alt when the portrait stands alone; '' when a label sits beside it. */
  alt?: string;
}> = ({ state, mode, reducedMotion = false, size = 56, variant = 'head', alt }) => {
  const posture = modePresentationFor(mode).posture;
  const motion = motionClassesFor(state, reducedMotion).join(' ');
  const src = variant === 'full' ? FAMILIAR_ART[state] : FAMILIAR_HEAD[state];
  const altText = alt ?? '';

  return (
    <img
      src={src}
      alt={altText}
      width={size}
      height={size}
      draggable={false}
      decoding="async"
      className={`familiar-avatar select-none object-contain ${motion}`}
      style={{ width: size, height: size }}
      data-identity={FAMILIAR_IDENTITY}
      data-state={state}
      data-posture={posture}
      data-variant={variant}
      aria-hidden={altText === '' ? true : undefined}
    />
  );
};

/** The familiar's presence strip: portrait + state label + one mode line. */
export const FamiliarPresence: React.FC<{
  inputs: FamiliarInputs;
  mode: ReflectionMode;
  reducedMotion?: boolean;
  /** 'full' promotes the familiar to a large journal-desk presence. */
  variant?: 'head' | 'full';
}> = ({ inputs, mode, reducedMotion = false, variant = 'head' }) => {
  const state = deriveFamiliarState(inputs);
  const copy = familiarCopyFor(state);
  const modeLine = modePresentationFor(mode).line;

  if (variant === 'full') {
    return (
      <div
        id="familiar-presence"
        role="status"
        aria-label={`Pocket familiar: ${copy}`}
        data-state={state}
        data-identity={FAMILIAR_IDENTITY}
        className="flex items-center gap-4 rounded-3xl border pf-hairline pf-paper-surface px-4 py-4 shadow-2xs"
      >
        <div className="shrink-0">
          <FamiliarAvatar state={state} mode={mode} reducedMotion={reducedMotion} size={96} variant="full" />
        </div>
        <div className="min-w-0">
          <p id="familiar-state-copy" className="text-sm font-semibold text-[var(--pf-ink)] leading-snug">
            {copy}
          </p>
          <p id="familiar-mode-line" className="text-xs text-[var(--pf-forest)] mt-0.5 truncate">
            {modeLine}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      id="familiar-presence"
      role="status"
      aria-label={`Pocket familiar: ${copy}`}
      data-state={state}
      data-identity={FAMILIAR_IDENTITY}
      className="flex items-center gap-3 rounded-2xl border pf-hairline bg-white px-3.5 py-2.5 shadow-2xs"
    >
      <FamiliarAvatar state={state} mode={mode} reducedMotion={reducedMotion} size={44} variant="head" />
      <div className="min-w-0">
        <p id="familiar-state-copy" className="text-xs font-semibold text-[#2D3126] truncate">
          {copy}
        </p>
        <p id="familiar-mode-line" className="text-[11px] text-[#7A7A6A] truncate">
          {modeLine}
        </p>
      </div>
    </div>
  );
};

/** Large standalone familiar portrait for the current state (journal-desk anchor). */
export const FamiliarPortrait: React.FC<{
  state: FamiliarState;
  mode: ReflectionMode;
  reducedMotion?: boolean;
  size?: number;
}> = ({ state, mode, reducedMotion = false, size = 160 }) => (
  <FamiliarAvatar
    state={state}
    mode={mode}
    reducedMotion={reducedMotion}
    size={size}
    variant="full"
    alt={FAMILIAR_ALT[state]}
  />
);
