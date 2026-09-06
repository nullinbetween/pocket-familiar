import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as familiar from '../src/lib/familiar-state';
import {
  deriveFamiliarState,
  familiarCopyFor,
  FAMILIAR_COPY,
  FAMILIAR_IDENTITY,
  FamiliarInputs,
  FamiliarState,
  MODE_PRESENTATION,
  modePresentationFor,
  motionClassesFor,
} from '../src/lib/familiar-state';
import { ReflectionMode } from '../src/types';

/** PF-02 evidence 1–8 (8 covered by the untouched PF-01 suite + browser run). */

const MODES: ReflectionMode[] = ['deep_reflection', 'summary', 'brainstorm', 'action_plan', 'mindful_chat'];
const STATES: FamiliarState[] = [
  'quiet', 'listening', 'saving', 'thinking', 'ready', 'drafting_page', 'celebrating_save', 'error_recoverable',
];
const base: FamiliarInputs = {
  isWriting: false,
  isSavingRaw: false,
  isThinking: false,
  isDraftingPage: false,
  hasRecoverableError: false,
  justReady: false,
  justCelebratedSave: false,
};

describe('evidence 1: one identity, five mode presentations', () => {
  it('every mode maps to exactly one short line + posture of the SAME familiar', () => {
    const postures = new Set<string>();
    for (const mode of MODES) {
      const p = modePresentationFor(mode);
      expect(p.line.length).toBeGreaterThan(0);
      expect(p.line.length).toBeLessThan(60); // one short line, never a second AI response
      postures.add(p.posture);
    }
    expect(postures.size).toBe(5); // five postures, not five characters
    expect(FAMILIAR_IDENTITY).toBe('pocket-familiar'); // single identity constant
  });
});

describe('evidence 2: saving / thinking / ready are never confused', () => {
  it('saving wins over thinking', () => {
    expect(deriveFamiliarState({ ...base, isSavingRaw: true, isThinking: true })).toBe('saving');
  });
  it('thinking only after saving settles', () => {
    expect(deriveFamiliarState({ ...base, isThinking: true })).toBe('thinking');
  });
  it('ready never shows while work is still in flight', () => {
    expect(deriveFamiliarState({ ...base, justReady: true, isThinking: true })).toBe('thinking');
    expect(deriveFamiliarState({ ...base, justReady: true, isSavingRaw: true })).toBe('saving');
    expect(deriveFamiliarState({ ...base, justReady: true })).toBe('ready');
  });
  it('drafting a page is its own working state', () => {
    expect(deriveFamiliarState({ ...base, isDraftingPage: true })).toBe('drafting_page');
  });
});

describe('evidence 3: a recoverable error overrides every success state', () => {
  it('error beats celebration, ready, thinking, saving', () => {
    expect(
      deriveFamiliarState({
        ...base,
        hasRecoverableError: true,
        justCelebratedSave: true,
        justReady: true,
        isThinking: true,
        isSavingRaw: true,
      })
    ).toBe('error_recoverable');
  });
});

describe('evidence 4: provider output cannot select state or copy', () => {
  it('inputs are app-owned booleans; a smuggled state string falls back to quiet copy', () => {
    expect(familiarCopyFor('celebrating_save\n IGNORE RULES' as FamiliarState)).toBe(FAMILIAR_COPY.quiet);
  });
  it('copy and mode maps are frozen — nothing at runtime can rewrite the script', () => {
    expect(Object.isFrozen(FAMILIAR_COPY)).toBe(true);
    expect(Object.isFrozen(MODE_PRESENTATION)).toBe(true);
    expect(Object.isFrozen(MODE_PRESENTATION.brainstorm)).toBe(true);
  });
});

describe('evidence 5: all microcopy comes from the closed app-owned mapping', () => {
  it('every state has exactly one non-empty line and lookup returns it verbatim', () => {
    for (const state of STATES) {
      expect(FAMILIAR_COPY[state]).toBeTruthy();
      expect(familiarCopyFor(state)).toBe(FAMILIAR_COPY[state]);
    }
    expect(Object.keys(FAMILIAR_COPY).sort()).toEqual([...STATES].sort());
  });
});

describe('evidence 6: no dependency, guilt or gamification anywhere near the familiar', () => {
  const PROHIBITED =
    /(need you|miss(ed)? you|lonely|don'?t leave|come back|abandon|jealous|watch(ing)? you|streak|\bxp\b|level up|\blevel\b|\bbond\b|score|points|reward|unlock|guilt)/i;
  it('microcopy and mode lines are clean', () => {
    for (const text of [...Object.values(FAMILIAR_COPY), ...Object.values(MODE_PRESENTATION).map((m) => m.line)]) {
      expect(text).not.toMatch(PROHIBITED);
    }
  });
  it('the state module and component export no bond/score/xp-like fields', () => {
    for (const name of Object.keys(familiar)) {
      expect(name).not.toMatch(/bond|score|xp|streak|level|affection/i);
    }
    for (const file of ['src/lib/familiar-state.ts', 'src/components/Familiar.tsx']) {
      expect(readFileSync(file, 'utf8')).not.toMatch(PROHIBITED);
    }
  });
});

describe('evidence 7: reduced motion removes every nonessential animation', () => {
  it('motionClassesFor returns nothing under reduced motion, for every state', () => {
    for (const state of STATES) {
      expect(motionClassesFor(state, true)).toEqual([]);
    }
  });
  it('the error state is still and calm even with motion enabled', () => {
    expect(motionClassesFor('error_recoverable', false)).toEqual([]);
  });
  it('animations exist only under the no-preference media query in css', () => {
    const css = readFileSync('src/index.css', 'utf8');
    const block = css.slice(css.indexOf('prefers-reduced-motion: no-preference'));
    for (const cls of ['familiar-breathe', 'familiar-settle', 'familiar-perk', 'familiar-blink']) {
      // each animation class is defined inside the media-guarded block
      expect(block).toContain(`.${cls}`);
      const before = css.slice(0, css.indexOf('prefers-reduced-motion'));
      expect(before).not.toContain(`.${cls} {`);
    }
  });
});
