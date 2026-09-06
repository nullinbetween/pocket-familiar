import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { deriveFamiliarState } from '../src/lib/familiar-state';
import { WorkspaceFamiliarFacts, workspaceFamiliarInputs } from '../src/lib/familiar-workspace';
import { FamiliarCallout } from '../src/components/FamiliarCallout';

/** PF-02.1 evidence: tests at the REAL workspace-input seam. */

const IDLE: WorkspaceFamiliarFacts = {
  composerText: '',
  persisting: false,
  isGenerating: false,
  draftingPage: false,
  flowErrorVisible: false,
  persistedGenerationFailed: false,
  diaryEditorErrorVisible: false,
  diaryEditorOpen: false,
  justReady: false,
  pageJustSaved: false,
};

const state = (f: Partial<WorkspaceFamiliarFacts>) =>
  deriveFamiliarState(workspaceFamiliarInputs({ ...IDLE, ...f }));

describe('PF-02.1 fix 1: persisted failed entry drives error_recoverable', () => {
  it('opening a persisted generationStatus=failed entry (standing retry visible) -> error', () => {
    expect(state({ persistedGenerationFailed: true })).toBe('error_recoverable');
  });
  it('while actively retrying, the panel hides and the familiar thinks', () => {
    expect(state({ persistedGenerationFailed: true, isGenerating: true })).toBe('thinking');
  });
  it('while the diary editor covers the flow, the standing panel is hidden and drafting shows', () => {
    expect(
      state({ persistedGenerationFailed: true, diaryEditorOpen: true, draftingPage: true })
    ).toBe('drafting_page');
  });
});

describe('PF-02.1 fix 2: PF-01 editor failures reach the familiar and clear deterministically', () => {
  it('a visible draft/save failure inside the editor -> error', () => {
    expect(state({ diaryEditorOpen: true, diaryEditorErrorVisible: true })).toBe('error_recoverable');
  });
  it('retry clears the signal and drafting shows again', () => {
    expect(state({ diaryEditorOpen: true, diaryEditorErrorVisible: false, draftingPage: true })).toBe(
      'drafting_page'
    );
  });
  it('cancel/teardown clears the signal (editor closed, no error remains)', () => {
    expect(state({ diaryEditorOpen: false, diaryEditorErrorVisible: false })).toBe('quiet');
  });
  it('confirmed save after a failed attempt celebrates, not errors', () => {
    expect(state({ diaryEditorErrorVisible: false, pageJustSaved: true })).toBe('celebrating_save');
  });
});

describe('PF-02.1 fix 3: successful Retry Response is a ready transition', () => {
  it('sequence: failed entry -> retrying -> success maps failed->thinking->ready', () => {
    // opened failed entry
    expect(state({ persistedGenerationFailed: true })).toBe('error_recoverable');
    // Retry Response pressed: work in flight, stale ready cleared
    expect(state({ persistedGenerationFailed: true, isGenerating: true, justReady: false })).toBe('thinking');
    // flow complete: entry now 'complete', justReady set by handleRetryGeneration
    expect(state({ persistedGenerationFailed: false, justReady: true })).toBe('ready');
  });
});

describe('PF-02.1 fix 4: the callout wears the ACTIVE mode posture', () => {
  it('brainstorm mode reaches the callout avatar', () => {
    const html = renderToStaticMarkup(
      createElement(FamiliarCallout, { onPress: () => undefined, mode: 'brainstorm' })
    );
    expect(html).toContain('data-posture="sparking"');
    expect(html).toContain('data-identity="pocket-familiar"');
  });
  it('each mode renders its own posture on the callout', () => {
    const seen = new Set<string>();
    for (const mode of ['deep_reflection', 'summary', 'brainstorm', 'action_plan', 'mindful_chat'] as const) {
      const html = renderToStaticMarkup(createElement(FamiliarCallout, { onPress: () => undefined, mode }));
      const m = /data-posture="([^"]+)"/.exec(html);
      seen.add(m?.[1] ?? '');
    }
    expect(seen.size).toBe(5);
  });
});

describe('PF-02.1: error still overrides ready and celebration at the real seam', () => {
  it('everything at once -> error_recoverable', () => {
    expect(
      state({
        persistedGenerationFailed: true,
        flowErrorVisible: true,
        diaryEditorErrorVisible: true,
        justReady: true,
        pageJustSaved: true,
        composerText: 'typing',
      })
    ).toBe('error_recoverable');
  });
});
