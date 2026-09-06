import { describe, expect, it } from 'vitest';
import { MemorySeed } from '../src/types';
import {
  isKeeperReady,
  readinessFactsOf,
  readinessPhase,
  READINESS_COPY,
  KEEPER_READINESS,
} from '../src/lib/keeper-readiness';

/** PF-CORE-01 evidence 9: closed Keeper-readiness rule and its exact boundaries. */

function seed(id: string, pageId: string, date: string, status: MemorySeed['status'] = 'active'): MemorySeed {
  return {
    kind: 'memorySeed',
    id,
    userId: 'u',
    status,
    text: `seed ${id}`,
    sourceExcerpt: 'excerpt',
    sourceDate: date,
    sourceRefs: [{ kind: 'diaryPage', id: pageId, availability: 'available' }],
    aiAssisted: true,
    approvedByUser: true,
    editedByUser: false,
    createdAt: 1,
    confirmedAt: 1,
  };
}

describe('evidence 9: readiness boundaries', () => {
  it('2 active seeds -> NOT ready', () => {
    const seeds = [seed('s1', 'p1', '2026-09-01'), seed('s2', 'p2', '2026-09-02')];
    expect(isKeeperReady(seeds)).toBe(false);
  });

  it('3 seeds from the SAME page -> NOT ready (needs 3 distinct pages)', () => {
    const seeds = [
      seed('s1', 'p1', '2026-09-01'),
      seed('s2', 'p1', '2026-09-02'),
      seed('s3', 'p1', '2026-09-03'),
    ];
    expect(readinessFactsOf(seeds).distinctSourcePageCount).toBe(1);
    expect(isKeeperReady(seeds)).toBe(false);
  });

  it('3 seeds on ONE date (3 distinct pages) -> NOT ready (needs 2 dates)', () => {
    const seeds = [
      seed('s1', 'p1', '2026-09-01'),
      seed('s2', 'p2', '2026-09-01'),
      seed('s3', 'p3', '2026-09-01'),
    ];
    expect(readinessFactsOf(seeds).distinctSourceDateCount).toBe(1);
    expect(isKeeperReady(seeds)).toBe(false);
  });

  it('3 distinct pages across 2 dates -> READY', () => {
    const seeds = [
      seed('s1', 'p1', '2026-09-01'),
      seed('s2', 'p2', '2026-09-01'),
      seed('s3', 'p3', '2026-09-02'),
    ];
    expect(isKeeperReady(seeds)).toBe(true);
  });

  it('revoked seeds do not count toward readiness', () => {
    const seeds = [
      seed('s1', 'p1', '2026-09-01'),
      seed('s2', 'p2', '2026-09-01'),
      seed('s3', 'p3', '2026-09-02', 'revoked'),
    ];
    expect(isKeeperReady(seeds)).toBe(false);
  });
});

describe('qualitative progress copy never leaks the numeric threshold', () => {
  it('phase transitions gathering -> taking_root -> ready', () => {
    expect(readinessPhase([])).toBe('gathering');
    expect(readinessPhase([seed('s1', 'p1', '2026-09-01')])).toBe('taking_root');
    expect(
      readinessPhase([
        seed('s1', 'p1', '2026-09-01'),
        seed('s2', 'p2', '2026-09-01'),
        seed('s3', 'p3', '2026-09-02'),
      ])
    ).toBe('ready');
  });

  it('no readiness copy mentions the threshold numbers or a count-to-go', () => {
    const numbers = [KEEPER_READINESS.minActiveSeeds, KEEPER_READINESS.minDistinctSourcePages, KEEPER_READINESS.minDistinctSourceDates];
    for (const copy of Object.values(READINESS_COPY)) {
      expect(/\d/.test(copy)).toBe(false);
      for (const n of numbers) expect(copy.includes(String(n))).toBe(false);
      expect(/more|left|remaining|to go|out of/i.test(copy)).toBe(false);
    }
  });
});
