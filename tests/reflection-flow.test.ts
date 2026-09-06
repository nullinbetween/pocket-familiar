import { describe, expect, it, vi } from 'vitest';
import { FlowDeps, retryGeneration, submitEntry } from '../src/lib/reflection-flow';
import { JournalInteraction } from '../src/types';

function makeDeps(overrides: Partial<FlowDeps> = {}) {
  const events: string[] = [];
  const store = new Map<string, Record<string, unknown>>();
  let idCounter = 0;
  const deps: FlowDeps = {
    saveEntry: vi.fn(async (entry) => {
      events.push('save');
      const id = `doc-${++idCounter}`;
      store.set(id, { ...entry });
      return id;
    }),
    updateEntry: vi.fn(async (id, updates) => {
      events.push(`update:${String(updates.generationStatus ?? 'data')}`);
      store.set(id, { ...(store.get(id) ?? {}), ...updates });
    }),
    requestReflection: vi.fn(async () => {
      events.push('gemini');
      return { text: 'a gentle observation.', modelUsed: 'model-x' };
    }),
    now: () => Date.now(),
    ...overrides,
  };
  return { deps, events, store };
}

const CTX = {
  userId: 'user-a',
  title: 'my day',
  mood: 'neutral' as const,
  mode: 'deep_reflection' as const,
  tags: ['reflection'],
  promptText: 'today I felt torn about the new project',
  existing: null,
};

describe('Gate C: journal-first durability', () => {
  it('persists the raw entry with status pending BEFORE calling Gemini', async () => {
    const { deps, events, store } = makeDeps();
    const outcome = await submitEntry(deps, CTX);
    expect(outcome.phase).toBe('complete');
    expect(events[0]).toBe('save');
    expect(events.indexOf('gemini')).toBeGreaterThan(events.indexOf('save'));
    const saved = deps.saveEntry as ReturnType<typeof vi.fn>;
    expect(saved.mock.calls[0][0].generationStatus).toBe('pending');
    expect(saved.mock.calls[0][0].turns).toHaveLength(1);
    expect(store.get('doc-1')?.generationStatus).toBe('complete');
  });

  it('fires the Saved acknowledgement after confirmed persistence, before generation completes', async () => {
    const order: string[] = [];
    const { deps } = makeDeps({
      requestReflection: vi.fn(async () => {
        order.push('gemini');
        return { text: 'ok.' };
      }),
      onSaved: () => order.push('saved-ack'),
    });
    await submitEntry(deps, CTX);
    expect(order).toEqual(['saved-ack', 'gemini']);
  });

  it('on Gemini failure the raw entry is retained and marked failed', async () => {
    const { deps, store } = makeDeps({
      requestReflection: vi.fn(async () => {
        throw new Error('forced timeout');
      }),
    });
    const outcome = await submitEntry(deps, CTX);
    expect(outcome.phase).toBe('saved_generation_failed');
    const doc = store.get('doc-1');
    expect(doc).toBeDefined();
    expect(doc?.generationStatus).toBe('failed');
    // raw user text still there, exactly once
    const turns = doc?.turns as Array<{ role: string; content: string }> | undefined;
    // status update did not touch turns; the original save holds them
    expect((turns ?? []).filter((t) => t.role === 'user')).toHaveLength(1);
  });

  it('empty companion text fails closed (treated as failure, not stored as output)', async () => {
    const { deps, store } = makeDeps({
      requestReflection: vi.fn(async () => ({ text: '   ' })),
    });
    const outcome = await submitEntry(deps, CTX);
    expect(outcome.phase).toBe('saved_generation_failed');
    expect(store.get('doc-1')?.reflectionOutput).toBe('');
  });

  it('if the raw write fails nothing else runs and the composer is preserved by the caller', async () => {
    const { deps } = makeDeps({
      saveEntry: vi.fn(async () => {
        throw new Error('firestore down');
      }),
    });
    const outcome = await submitEntry(deps, CTX);
    expect(outcome.phase).toBe('save_failed');
    expect(deps.requestReflection).not.toHaveBeenCalled();
    expect(deps.updateEntry).not.toHaveBeenCalled();
  });
});

describe('Gate C: retry updates the same entry and never duplicates the raw text', () => {
  const failedEntry: JournalInteraction = {
    id: 'doc-9',
    userId: 'user-a',
    title: 'my day',
    initialPrompt: 'today I felt torn',
    reflectionOutput: '',
    mode: 'deep_reflection',
    mood: 'neutral',
    tags: ['reflection'],
    turns: [{ id: 'usr_1', role: 'user', content: 'today I felt torn', timestamp: 1 }],
    createdAt: 1,
    updatedAt: 1,
    generationStatus: 'failed',
  };

  it('retryGeneration adds a model turn to the SAME entry without a new user turn', async () => {
    const { deps } = makeDeps();
    const outcome = await retryGeneration(deps, failedEntry);
    expect(outcome.phase).toBe('complete');
    expect(deps.saveEntry).not.toHaveBeenCalled(); // no new document
    const update = (deps.updateEntry as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[1].generationStatus === 'complete'
    );
    expect(update?.[0]).toBe('doc-9');
    const turns = update?.[1].turns as Array<{ role: string; content: string }>;
    expect(turns.filter((t) => t.role === 'user')).toHaveLength(1);
    expect(turns.filter((t) => t.role === 'model')).toHaveLength(1);
    expect(turns[0].content).toBe('today I felt torn');
  });

  it('a failed retry leaves the raw entry intact and still retryable', async () => {
    const { deps } = makeDeps({
      requestReflection: vi.fn(async () => {
        throw new Error('still down');
      }),
    });
    const outcome = await retryGeneration(deps, failedEntry);
    expect(outcome.phase).toBe('saved_generation_failed');
    expect(deps.saveEntry).not.toHaveBeenCalled();
    if (outcome.phase === 'saved_generation_failed') {
      expect(outcome.entry.turns.filter((t) => t.role === 'user')).toHaveLength(1);
    }
  });

  it('multi-turn: history sent to the server excludes the latest user turn but keeps prior turns', async () => {
    const { deps } = makeDeps();
    const multi: JournalInteraction = {
      ...failedEntry,
      turns: [
        { id: 'usr_1', role: 'user', content: 'first thought', timestamp: 1 },
        { id: 'gem_1', role: 'model', content: 'first reply', timestamp: 2 },
        { id: 'usr_2', role: 'user', content: 'second thought', timestamp: 3 },
      ],
    };
    await retryGeneration(deps, multi);
    const payload = (deps.requestReflection as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.prompt).toBe('second thought');
    expect(payload.history).toEqual([
      { role: 'user', content: 'first thought' },
      { role: 'model', content: 'first reply' },
    ]);
  });
});
