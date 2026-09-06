import { describe, it, expect, vi, beforeEach } from 'vitest';

// The live factory imports firebase (auth) and firestore-service (writes).
// Mock both so this stays a deterministic node unit test with no Firebase init.
vi.mock('../src/lib/firebase', () => ({ getIdTokenOrThrow: vi.fn() }));
vi.mock('../src/lib/firestore-service', () => ({
  saveInteraction: vi.fn(),
  updateInteraction: vi.fn(),
}));

import { getIdTokenOrThrow } from '../src/lib/firebase';
import { saveInteraction, updateInteraction } from '../src/lib/firestore-service';
import { createReflectionFlowDeps } from '../src/lib/reflection-deps';
import { submitEntry, retryGeneration } from '../src/lib/reflection-flow';
import { JournalInteraction } from '../src/types';

const mockToken = vi.mocked(getIdTokenOrThrow);
const mockSave = vi.mocked(saveInteraction);
const mockUpdate = vi.mocked(updateInteraction);

function historyEntry(): JournalInteraction {
  return {
    id: 'entry-1',
    userId: 'user-a',
    title: 'A saved history entry',
    initialPrompt: 'first thing',
    reflectionOutput: 'prior reflection',
    mode: 'mindful_chat',
    mood: 'thoughtful',
    tags: ['reflection'],
    turns: [
      { id: 'usr_1', role: 'user', content: 'first thing', timestamp: 1 },
      { id: 'gem_1', role: 'model', content: 'prior reflection', timestamp: 2 },
    ],
    createdAt: 1,
    updatedAt: 2,
    generationStatus: 'complete',
  };
}

function okFetch(body: Record<string, unknown>) {
  return vi.fn(async () => ({ ok: true, json: async () => body })) as unknown as typeof fetch;
}
function failFetch(status: number, body: Record<string, unknown>) {
  return vi.fn(async () => ({ ok: false, status, json: async () => body })) as unknown as typeof fetch;
}

describe('History Quick Reply continuation uses the authenticated, raw-save-first flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockToken.mockResolvedValue('TOKEN123');
    mockSave.mockResolvedValue('new-id');
    mockUpdate.mockResolvedValue(undefined);
  });

  it('sends a fresh Firebase ID token on the reflect request (regression: modal previously sent none)', async () => {
    const f = okFetch({ text: 'a reply', modelUsed: 'm' });
    (globalThis as any).fetch = f;
    const deps = createReflectionFlowDeps('user-a');
    const res = await deps.requestReflection({
      mode: 'mindful_chat', mood: 'thoughtful', title: 't', prompt: 'p', history: [],
    });
    expect(res.text).toBe('a reply');
    const [url, init] = (f as any).mock.calls[0];
    expect(url).toBe('/api/gemini/reflect');
    expect((init.headers as any).Authorization).toBe('Bearer TOKEN123');
  });

  it('a modal/history follow-up saves the user turn first, then generates, authenticated', async () => {
    const f = okFetch({ text: 'a fresh reply', modelUsed: 'm' });
    (globalThis as any).fetch = f;
    const outcome = await submitEntry(createReflectionFlowDeps('user-a'), {
      userId: 'user-a',
      title: 'A saved history entry',
      mood: 'thoughtful',
      mode: 'mindful_chat',
      tags: ['reflection'],
      promptText: 'quick reply from history',
      existing: historyEntry(),
    });
    expect(outcome.phase).toBe('complete');
    // durability order: the FIRST write is the raw user turn with status pending
    const firstWrite = mockUpdate.mock.calls[0];
    expect(firstWrite[0]).toBe('user-a');
    expect(firstWrite[1]).toBe('entry-1');
    expect((firstWrite[2] as any).generationStatus).toBe('pending');
    expect((firstWrite[2] as any).turns.some((t: any) => t.role === 'user' && t.content === 'quick reply from history')).toBe(true);
    // request was authenticated
    expect((f as any).mock.calls[0][1].headers.Authorization).toBe('Bearer TOKEN123');
    // final entry has the model reply appended
    if (outcome.phase === 'complete') {
      const last = outcome.entry.turns[outcome.entry.turns.length - 1];
      expect(last).toMatchObject({ role: 'model', content: 'a fresh reply' });
    }
  });

  it('generation failure after the user turn is saved keeps it durable and retryable, not erased', async () => {
    (globalThis as any).fetch = failFetch(401, { error: 'Authentication required.' });
    const outcome = await submitEntry(createReflectionFlowDeps('user-a'), {
      userId: 'user-a',
      title: 'A saved history entry',
      mood: 'thoughtful',
      mode: 'mindful_chat',
      tags: ['reflection'],
      promptText: 'reply that fails generation',
      existing: historyEntry(),
    });
    expect(outcome.phase).toBe('saved_generation_failed');
    // the user turn was persisted BEFORE generation (pending write)
    const firstWrite = mockUpdate.mock.calls[0][2] as any;
    expect(firstWrite.generationStatus).toBe('pending');
    expect(firstWrite.turns.filter((t: any) => t.role === 'user').length).toBe(2);
    expect(firstWrite.turns.some((t: any) => t.content === 'reply that fails generation')).toBe(true);
    // the entry ends up marked failed (retryable), raw turn retained, no model turn added
    const lastWrite = mockUpdate.mock.calls[mockUpdate.mock.calls.length - 1][2] as any;
    expect(lastWrite.generationStatus).toBe('failed');
    if (outcome.phase === 'saved_generation_failed') {
      expect(outcome.entry.turns.some((t: any) => t.content === 'reply that fails generation')).toBe(true);
      expect(outcome.entry.turns.some((t: any) => t.role === 'model' && t.content === 'a fresh reply')).toBe(false);
      expect(outcome.error).toContain('Authentication required.');
    }
  });

  it('retrying a failed continuation regenerates without duplicating the raw user turn', async () => {
    (globalThis as any).fetch = failFetch(503, { error: 'temporary' });
    const failed = await submitEntry(createReflectionFlowDeps('user-a'), {
      userId: 'user-a',
      title: 'A saved history entry',
      mood: 'thoughtful',
      mode: 'mindful_chat',
      tags: ['reflection'],
      promptText: 'reply pending retry',
      existing: historyEntry(),
    });
    expect(failed.phase).toBe('saved_generation_failed');
    const failedEntry = failed.phase === 'saved_generation_failed' ? failed.entry : historyEntry();

    (globalThis as any).fetch = okFetch({ text: 'recovered reply', modelUsed: 'm' });
    const retry = await retryGeneration(createReflectionFlowDeps('user-a'), failedEntry);
    expect(retry.phase).toBe('complete');
    if (retry.phase === 'complete') {
      // exactly the same user turns — the raw text is never appended twice
      expect(retry.entry.turns.filter((t: any) => t.role === 'user').length).toBe(2);
      expect(retry.entry.turns.filter((t: any) => t.content === 'reply pending retry').length).toBe(1);
      const last = retry.entry.turns[retry.entry.turns.length - 1];
      expect(last).toMatchObject({ role: 'model', content: 'recovered reply' });
    }
  });

  it('when the user is not signed in, the raw turn is still saved and no unauthenticated request is made', async () => {
    mockToken.mockRejectedValue(new Error('Not signed in.'));
    const f = vi.fn();
    (globalThis as any).fetch = f as unknown as typeof fetch;
    const outcome = await submitEntry(createReflectionFlowDeps('user-a'), {
      userId: 'user-a',
      title: 'A saved history entry',
      mood: 'thoughtful',
      mode: 'mindful_chat',
      tags: ['reflection'],
      promptText: 'reply without auth',
      existing: historyEntry(),
    });
    expect(outcome.phase).toBe('saved_generation_failed');
    // no request ever left without a token
    expect(f).not.toHaveBeenCalled();
    // but the raw user turn was persisted first
    expect((mockUpdate.mock.calls[0][2] as any).generationStatus).toBe('pending');
    expect((mockUpdate.mock.calls[0][2] as any).turns.some((t: any) => t.content === 'reply without auth')).toBe(true);
  });
});
