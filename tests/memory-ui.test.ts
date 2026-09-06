import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { DiaryDraftEditor, DiaryDraftPreview } from '../src/components/DiaryDraftEditor';
import { DiaryPageReader } from '../src/components/DiaryPageReader';
import { MemoryLibrary, nextMemoryColumnVisibleCount } from '../src/components/MemoryLibrary';
import { filterConversations, filterPages, projectionBody, columnHasFavorites, exportScope } from '../src/lib/memory-views';
import { KEEP_COPY, NOT_SAVED_LABEL } from '../src/lib/brand';
import { DiaryDraftFields, DiaryPage, JournalInteraction } from '../src/types';
import { DiaryFlowDeps } from '../src/lib/diary-flow';

vi.mock('../src/lib/firestore-service', () => ({
  deleteInteraction: vi.fn(async () => {}),
  updateInteraction: vi.fn(async () => {}),
}));

const LONG_DRAFT: DiaryDraftFields = {
  title: 'A long, considered day',
  date: '2026-09-03',
  todayInMyWords:
    'Today asked a lot of me and I met most of it. The morning was rushed but the afternoon settled, ' +
    'and by evening I noticed I had kept the small promises I made to myself. It was not perfect, but it was mine, ' +
    'and that felt like enough to write down and keep.',
  whatFeltImportant: ['Kept the small promises I made to myself', 'The afternoon settled after a rushed morning'],
  carryForward: 'Protect the first quiet hour tomorrow.',
};

const LONG_PAGE: DiaryPage = {
  kind: 'diaryPage', id: 'dp-long', userId: 'u1',
  title: LONG_DRAFT.title, date: LONG_DRAFT.date, todayInMyWords: LONG_DRAFT.todayInMyWords,
  whatFeltImportant: LONG_DRAFT.whatFeltImportant, carryForward: LONG_DRAFT.carryForward,
  sourceInteractionId: 'conv-1', sourceTurnIds: ['t1'], aiAssisted: true, status: 'confirmed',
  createdAt: 1, confirmedAt: 2, editedByUser: true,
};

const INTERACTION: JournalInteraction = {
  id: 'conv-1', userId: 'u1', title: 'A long, considered day', initialPrompt: 'Today asked a lot of me.',
  reflectionOutput: 'You met most of it — and you noticed the promises you kept.', mode: 'deep_reflection', mood: 'thoughtful',
  tags: ['reflection'], turns: [{ id: 't1', role: 'user', content: 'Today asked a lot of me.', timestamp: 1 }],
  createdAt: 3, updatedAt: 3, generationStatus: 'complete',
};

const fakeDeps: DiaryFlowDeps = {
  requestDraft: vi.fn(async () => ({ ...LONG_DRAFT, sourceTurnIds: ['t1'] })),
  savePage: vi.fn(async () => {}),
  newPageId: () => 'p1',
  now: () => 1,
};

describe('closure 1: approval shows every persisted field + honest not-saved status without Edit', () => {
  it('the default preview renders title, date, prose, BOTH important points and carry-forward', () => {
    const html = renderToStaticMarkup(createElement(DiaryDraftPreview, { draft: LONG_DRAFT }));
    expect(html).toContain('A long, considered day');
    expect(html).toContain('2026-09-03');
    expect(html).toContain('Kept the small promises I made to myself');
    expect(html).toContain('The afternoon settled after a rushed morning');
    expect(html).toContain('Protect the first quiet hour tomorrow.');
    expect(html).toContain('by evening I noticed I had kept the small promises');
  });
  it('generated prose is NOT wrapped in quotation marks that imply verbatim speech', () => {
    const html = renderToStaticMarkup(createElement(DiaryDraftPreview, { draft: LONG_DRAFT }));
    expect(html).not.toContain('&ldquo;' + LONG_DRAFT.todayInMyWords.slice(0, 12));
    expect(html).not.toContain('"' + LONG_DRAFT.todayInMyWords.slice(0, 12));
  });
  it('the approval sheet shows an honest AI-assisted / not-saved label and "Keep this page?" heading', () => {
    const html = renderToStaticMarkup(createElement(DiaryDraftEditor, {
      userId: 'u1', interaction: INTERACTION, deps: fakeDeps, todayISO: '2026-09-03',
      onConfirmed: () => {}, onClose: () => {},
    }));
    expect(html).toContain(NOT_SAVED_LABEL);
    expect(html).toContain(KEEP_COPY.heading);
    // the not-saved label is a visible element, not an sr-only screen-reader node
    expect(html).not.toContain('sr-only');
  });
});

describe('closure 3: a saved page opens in full, including both important points, even without a source', () => {
  it('renders every field + provenance and works when the source conversation is unavailable', () => {
    const html = renderToStaticMarkup(createElement(DiaryPageReader, {
      page: LONG_PAGE, sourceAvailable: false, onClose: () => {},
    }));
    expect(html).toContain('Kept the small promises I made to myself');
    expect(html).toContain('The afternoon settled after a rushed morning');
    expect(html).toContain('Protect the first quiet hour tomorrow.');
    expect(html).toContain('AI-assisted draft'); // provenance retained
    expect(html).toContain('no longer available'); // still readable without source
  });
  it('offers source navigation only when the source is available', () => {
    const withSrc = renderToStaticMarkup(createElement(DiaryPageReader, { page: LONG_PAGE, sourceAvailable: true, onClose: () => {} }));
    expect(withSrc).toContain('Go to source conversation');
  });
});

describe('closure 4: Story controls match diary-page data (no favourites, scoped export)', () => {
  it('the diary-page filter has no favourites concept and never drops pages by a favourite flag', () => {
    const pages = filterPages([LONG_PAGE], { query: '', sortNewest: true });
    expect(pages).toHaveLength(1);
    expect(columnHasFavorites('story')).toBe(false);
    expect(columnHasFavorites('told')).toBe(true);
    expect(columnHasFavorites('thought')).toBe(true);
  });
  it('export scope is explicit per column', () => {
    expect(exportScope('story')).toBe('pages');
    expect(exportScope('told')).toBe('conversations');
    expect(exportScope('thought')).toBe('conversations');
  });
});

describe('closure 5: conversation mode filtering + both projections resolve the same saved data', () => {
  const entries: JournalInteraction[] = [
    INTERACTION,
    { ...INTERACTION, id: 'conv-2', mode: 'summary', initialPrompt: 'A quick recap.', reflectionOutput: 'Three points stood out.', isFavorite: true, createdAt: 5 },
  ];
  it('mode filter narrows conversations; favourites filter applies only to conversations', () => {
    expect(filterConversations(entries, { query: '', mode: 'summary', onlyFavorites: false, sortNewest: true })).toHaveLength(1);
    expect(filterConversations(entries, { query: '', mode: 'all', onlyFavorites: true, sortNewest: true }).map((e) => e.id)).toEqual(['conv-2']);
    expect(filterConversations(entries, { query: 'recap', mode: 'all', onlyFavorites: false, sortNewest: true }).map((e) => e.id)).toEqual(['conv-2']);
  });
  it('told and thought are two projections of the SAME conversation record', () => {
    const e = entries[0];
    expect(projectionBody('told', e)).toBe(e.initialPrompt);
    expect(projectionBody('thought', e)).toBe(e.reflectionOutput);
  });
});

describe('memory columns remain calm as the archive grows', () => {
  it('shows only the latest three conversation notes per projection and offers an explicit reveal', () => {
    const entries = Array.from({ length: 30 }, (_, index): JournalInteraction => ({
      ...INTERACTION,
      id: `conv-${index + 1}`,
      title: `Conversation ${index + 1}`,
      createdAt: index + 1,
      updatedAt: index + 1,
    }));
    const html = renderToStaticMarkup(createElement(MemoryLibrary, {
      userId: 'u1', entries, diaryPages: [], memorySeeds: [], littleMemories: [],
      onSelectEntry: () => {}, onOpenModal: () => {}, onNewEntry: () => {},
      isSourceAvailable: () => true, onOpenSource: () => {},
    }));
    expect((html.match(/id="history-card-told-/g) ?? [])).toHaveLength(3);
    expect((html.match(/id="history-card-thought-/g) ?? [])).toHaveLength(3);
    expect(html).toContain('id="memory-column-toggle-told"');
    expect(html).toContain('id="memory-column-toggle-thought"');
    expect(html).toContain('Show next 5');
  });

  it('reveals five at a time, caps a column at 25, then returns to the latest three', () => {
    const counts = [3];
    for (let i = 0; i < 6; i += 1) counts.push(nextMemoryColumnVisibleCount(counts.at(-1)!, 1000));
    expect(counts).toEqual([3, 8, 13, 18, 23, 25, 3]);
  });
});
