import { describe, expect, it } from 'vitest';
import { SceneBriefFields } from '../src/types';
import {
  validateSceneBriefShape, sanitizeSceneBrief, sceneBriefEquals,
  buildLittleMemorySourceRefs, buildCanonicalLittleMemory, validateLittleMemoryForApproval,
  markLittleMemorySourceUnavailable, LittleMemorySource, SCENE_BRIEF_LIMITS,
} from '../src/lib/little-memory-flow';

/** PF-CORE-03A — pure Little Memory validation, provenance and canonical build. */

const brief = (over: Partial<SceneBriefFields> = {}): SceneBriefFields => ({
  title: 'A pocket of calm',
  setting: 'a quiet tree-lined street on the walk home',
  timeOfDay: 'morning',
  emotionalTone: 'quiet relief',
  familiarAction: 'Midnight pads beside her, tail curled, watching the light',
  visualMotifs: ['morning light through trees', 'a phone left in a bag'],
  composition: 'wide, low angle with warm negative space',
  caption: 'The walk home is mine again.',
  ...over,
});

const source: LittleMemorySource = {
  date: '2026-09-03',
  diaryPage: { id: 'dp-long', title: 'A pocket of calm', date: '2026-09-03', excerpt: 'On the walk home I left my phone in my bag.' },
  seeds: [{ id: 'seed-1', text: 'The walk home is mine again when I leave my phone in my bag.' }],
};

describe('scene brief shape validation is closed and bounded', () => {
  it('accepts a well-formed brief', () => {
    expect(validateSceneBriefShape(brief())).toEqual({ ok: true });
  });
  it('rejects an extra key (no smuggled fields)', () => {
    const v = validateSceneBriefShape({ ...brief(), imageUrl: 'x' } as unknown);
    expect(v.ok).toBe(false);
    if (v.ok === false) expect(v.reason).toMatch(/extra_key/);
  });
  it('rejects a missing key', () => {
    const b: Record<string, unknown> = { ...brief() }; delete b.caption;
    const v = validateSceneBriefShape(b);
    expect(v.ok).toBe(false);
    if (v.ok === false) expect(v.reason).toMatch(/missing_key\(caption\)/);
  });
  it('rejects empty and over-limit fields', () => {
    expect(validateSceneBriefShape(brief({ title: '' })).ok).toBe(false);
    expect(validateSceneBriefShape(brief({ title: 'x'.repeat(SCENE_BRIEF_LIMITS.title + 1) })).ok).toBe(false);
  });
  it('bounds visualMotifs count, item length and duplicates', () => {
    expect(validateSceneBriefShape(brief({ visualMotifs: [] })).ok).toBe(false);
    expect(validateSceneBriefShape(brief({ visualMotifs: Array(SCENE_BRIEF_LIMITS.motifsMax + 1).fill('m') })).ok).toBe(false);
    expect(validateSceneBriefShape(brief({ visualMotifs: ['x'.repeat(SCENE_BRIEF_LIMITS.motifItem + 1)] })).ok).toBe(false);
    expect(validateSceneBriefShape(brief({ visualMotifs: ['leaf', 'Leaf'] })).ok).toBe(false);
  });
});

describe('provenance is built from the verified source only', () => {
  it('produces exactly one diaryPage ref plus one ref per chosen seed, all available', () => {
    const refs = buildLittleMemorySourceRefs(source);
    expect(refs.filter((r) => r.kind === 'diaryPage')).toHaveLength(1);
    expect(refs.filter((r) => r.kind === 'memorySeed')).toHaveLength(1);
    expect(refs.every((r) => r.availability === 'available')).toBe(true);
    expect(refs[0].label).toContain('A pocket of calm');
    expect(refs[0].label).toContain('2026-09-03');
    expect(refs[1].label).toContain('walk home is mine');
  });
  it('an empty seed selection yields only the diaryPage ref', () => {
    const refs = buildLittleMemorySourceRefs({ ...source, seeds: [] });
    expect(refs).toHaveLength(1);
    expect(refs[0].kind).toBe('diaryPage');
  });
});

describe('canonical build', () => {
  it('marks editedByUser only when the approved brief differs from the draft', () => {
    const same = buildCanonicalLittleMemory({ userId: 'u', source, draftFields: brief(), approvedFields: brief(), now: 100 });
    expect(same.editedByUser).toBe(false);
    expect(same.kind).toBe('littleMemory');
    expect(same.status).toBe('brief_approved');
    expect(same.date).toBe('2026-09-03');
    expect(same).not.toHaveProperty('imageUrl');
    const edited = buildCanonicalLittleMemory({ userId: 'u', source, draftFields: brief(), approvedFields: brief({ caption: 'My own caption.' }), now: 100 });
    expect(edited.editedByUser).toBe(true);
    expect(edited.caption).toBe('My own caption.');
  });
  it('provenance comes from the source, not the approved fields', () => {
    const rec = buildCanonicalLittleMemory({ userId: 'u', source, draftFields: brief(), approvedFields: brief(), now: 100 });
    expect(rec.sourceRefs.map((r) => r.id).sort()).toEqual(['dp-long', 'seed-1']);
    expect(rec.approvedByUser).toBe(true);
    expect(rec.aiAssisted).toBe(true);
  });
});

describe('approval validation + availability', () => {
  it('accepts a valid brief + source, rejects a source with no date or diary page', () => {
    expect(validateLittleMemoryForApproval(brief(), source).ok).toBe(true);
    expect(validateLittleMemoryForApproval(brief(), { ...source, date: 'nope' }).ok).toBe(false);
    expect(validateLittleMemoryForApproval(brief(), { ...source, diaryPage: { ...source.diaryPage, id: '' } }).ok).toBe(false);
  });
  it('marks a single source ref unavailable without touching the others', () => {
    const rec = { id: 'lm1', ...buildCanonicalLittleMemory({ userId: 'u', source, draftFields: brief(), approvedFields: brief(), now: 100 }) };
    const after = markLittleMemorySourceUnavailable(rec, 'diaryPage', 'dp-long');
    expect(after.sourceRefs.find((r) => r.id === 'dp-long')!.availability).toBe('unavailable');
    expect(after.sourceRefs.find((r) => r.id === 'seed-1')!.availability).toBe('available');
  });
  it('sanitize trims fields and motif items', () => {
    const s = sanitizeSceneBrief(brief({ title: '  spaced  ', visualMotifs: ['  a  ', 'b'] }));
    expect(s.title).toBe('spaced');
    expect(s.visualMotifs).toEqual(['a', 'b']);
  });
  it('sceneBriefEquals ignores surrounding whitespace', () => {
    expect(sceneBriefEquals(brief(), brief({ title: '  A pocket of calm  ' }))).toBe(true);
  });
});
