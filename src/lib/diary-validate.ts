import { DiaryDraftFields } from '../types';
import { countWords } from './text-metrics';

/**
 * PF-01.1 fix 2: shared deterministic validation of the USER-EDITED page,
 * run before any Firestore write. Nothing is silently truncated — violations
 * come back as visible, field-level errors and the editable draft is kept.
 */

export const DIARY_LIMITS = {
  titleMaxChars: 80,
  bodyMaxWords: 100,
  itemMaxWords: 20,
  itemsMin: 1,
  itemsMax: 2,
  carryMaxWords: 25,
  sourceIdsMax: 20,
  sourceIdMaxChars: 100,
} as const;

export type DiaryFieldErrors = Partial<
  Record<'title' | 'date' | 'todayInMyWords' | 'whatFeltImportant' | 'carryForward' | 'sourceTurnIds', string>
>;

function isRealCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function validateConfirmedPage(
  edited: DiaryDraftFields,
  sourceTurnIds: string[]
): { ok: true } | { ok: false; errors: DiaryFieldErrors } {
  const errors: DiaryFieldErrors = {};
  const L = DIARY_LIMITS;

  const title = edited.title.trim();
  if (!title) errors.title = 'A title is required.';
  else if (title.length > L.titleMaxChars) {
    errors.title = `Title is ${title.length} characters — the maximum is ${L.titleMaxChars}.`;
  }

  if (!isRealCalendarDate(edited.date)) {
    errors.date = 'Date must be a real calendar date (YYYY-MM-DD).';
  }

  const body = edited.todayInMyWords.trim();
  if (!body) errors.todayInMyWords = 'Your words are required.';
  else {
    const w = countWords(body);
    if (w > L.bodyMaxWords) {
      errors.todayInMyWords = `This is ${w} words — the maximum is ${L.bodyMaxWords}. Trim it yourself; nothing is cut automatically.`;
    }
  }

  const items = edited.whatFeltImportant.map((i) => i.trim()).filter(Boolean);
  if (items.length < L.itemsMin || items.length > L.itemsMax) {
    errors.whatFeltImportant = `Keep ${L.itemsMin}–${L.itemsMax} non-empty items.`;
  } else {
    const over = items.find((i) => countWords(i) > L.itemMaxWords);
    if (over) {
      errors.whatFeltImportant = `Each item stays within ${L.itemMaxWords} words ("${over.slice(0, 30)}…" is over).`;
    }
  }

  const carry = edited.carryForward?.trim();
  if (carry && countWords(carry) > L.carryMaxWords) {
    errors.carryForward = `Carry forward is ${countWords(carry)} words — the maximum is ${L.carryMaxWords}.`;
  }

  if (
    sourceTurnIds.length === 0 ||
    sourceTurnIds.length > L.sourceIdsMax ||
    new Set(sourceTurnIds).size !== sourceTurnIds.length ||
    sourceTurnIds.some((id) => typeof id !== 'string' || !id.trim() || id.length > L.sourceIdMaxChars)
  ) {
    errors.sourceTurnIds = 'Source turn references are missing or malformed.';
  }

  return Object.keys(errors).length === 0 ? { ok: true } : { ok: false, errors };
}

/** Structural comparison for editedByUser — never join-based. */
export function sameImportantItems(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((item, i) => item === b[i]);
}
