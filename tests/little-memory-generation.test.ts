import { describe, expect, it } from 'vitest';
import { LittleMemory } from '../src/types';
import { createLittleMemoryGenerationController } from '../src/lib/little-memory-generation';

/**
 * PF-CORE-03B closure P0-2 — the ACTUAL generate seam App wires to the album's
 * onGenerate. One billable attempt = one stable generationId across ambiguous
 * client/network retry; a genuinely new attempt (create / retry-after-failure /
 * regenerate) mints a new id. A fake server enforces the real server-side
 * idempotency so we can count provider (billable) calls.
 */

const base = (over: Partial<LittleMemory> = {}): LittleMemory => ({
  kind: 'littleMemory', id: 'lm-1', userId: 'u', status: 'brief_approved', date: '2026-09-03',
  title: 't', setting: 's', timeOfDay: 'd', emotionalTone: 'e', familiarAction: 'a',
  visualMotifs: ['m'], composition: 'c', caption: 'cap',
  sourceRefs: [{ kind: 'diaryPage', id: 'dp1', availability: 'available', label: 'p' }],
  aiAssisted: true, approvedByUser: true, editedByUser: false, createdAt: 1, confirmedAt: 1, ...over,
});

/** A fake server that mirrors beginLittleMemoryGeneration idempotency + billing. */
function fakeServer() {
  let providerCalls = 0;
  const state: { image?: LittleMemory['image']; pending?: LittleMemory['pendingGeneration'] } = {};
  const send = async ({ generationId }: { littleMemoryId: string; generationId: string }) => {
    // exists_ready: same id already the current image → no provider call
    if (state.image?.generationId === generationId) return { alreadyReady: true };
    // in_progress: an attempt is already generating → no provider call
    if (state.pending?.status === 'generating') return { inProgress: true };
    // started: this is the one billable call for the attempt; then promote to ready
    state.pending = { status: 'generating', generationId, model: 'm', briefFingerprint: 'fp', attemptStartedAt: Date.now() };
    providerCalls += 1;
    state.image = { status: 'ready', generationId, model: 'm', objectPath: `p/${generationId}`, mimeType: 'image/png', generatedAt: Date.now(), briefFingerprint: 'fp' };
    state.pending = undefined;
    return {};
  };
  return { get providerCalls() { return providerCalls; }, state, send };
}

describe('generation controller — stable attempt id + no second provider call', () => {
  it('a synchronous double-click issues exactly ONE request/provider call', async () => {
    const srv = fakeServer();
    let minted = 0;
    const ctrl = createLittleMemoryGenerationController({ mintId: () => `g-${++minted}`, send: srv.send });
    const lm = base();
    await Promise.all([ctrl.generate(lm), ctrl.generate(lm)]); // double-click before state updates
    expect(srv.providerCalls).toBe(1);
    expect(minted).toBe(1); // only one id minted
  });

  it('an ambiguous retry while the attempt is still generating reuses the id (no second call)', async () => {
    const srv = fakeServer();
    let minted = 0;
    const ctrl = createLittleMemoryGenerationController({ mintId: () => `g-${++minted}`, send: srv.send });
    // Model a refresh mid-flight: the reloaded record carries the in-flight pending.
    const inFlight = base({ pendingGeneration: { status: 'generating', generationId: 'g-live', model: 'm', briefFingerprint: 'fp', attemptStartedAt: 1 } });
    // Seed the fake server as already generating that same id.
    srv.state.pending = { status: 'generating', generationId: 'g-live', model: 'm', briefFingerprint: 'fp', attemptStartedAt: 1 };
    await ctrl.generate(inFlight);
    expect(minted).toBe(0);           // reused g-live, minted nothing
    expect(srv.providerCalls).toBe(0); // server saw same attempt generating → no bill
  });

  it('retains the id when the request was accepted server-side but rejects before Firestore updates', async () => {
    let minted = 0;
    let providerCalls = 0;
    const seenIds: string[] = [];
    let first = true;
    const send = async ({ generationId }: { littleMemoryId: string; generationId: string }) => {
      seenIds.push(generationId);
      if (first) {
        first = false;
        providerCalls += 1; // server accepted/started the paid attempt
        throw new TypeError('network response was lost');
      }
      // Same server attempt is already running, so this replay is not billable.
      return { inProgress: true };
    };
    const ctrl = createLittleMemoryGenerationController({ mintId: () => `g-${++minted}`, send });
    const unchanged = base();
    await expect(ctrl.generate(unchanged)).rejects.toThrow(/network response was lost/);
    await ctrl.generate(unchanged); // no simulated Firestore update yet
    expect(seenIds).toEqual(['g-1', 'g-1']);
    expect(minted).toBe(1);
    expect(providerCalls).toBe(1);
  });

  it('retains a successful id until the canonical snapshot acknowledges it, then Regenerate mints anew', async () => {
    let minted = 0;
    const seenIds: string[] = [];
    const ctrl = createLittleMemoryGenerationController({
      mintId: () => `g-${++minted}`,
      send: async ({ generationId }) => { seenIds.push(generationId); return { alreadyReady: seenIds.length > 1 }; },
    });
    const before = base();
    await ctrl.generate(before);
    await ctrl.generate(before); // HTTP settled, but Firestore still shows pre-generation record
    expect(seenIds).toEqual(['g-1', 'g-1']);
    const acknowledged = base({ image: { status: 'ready', generationId: 'g-1', model: 'm', objectPath: 'p/g-1', mimeType: 'image/png', generatedAt: 1, briefFingerprint: 'fp' } });
    await ctrl.generate(acknowledged); // explicit Regenerate after canonical acknowledgement
    expect(seenIds).toEqual(['g-1', 'g-1', 'g-2']);
  });

  it('a first Create, then a Retry after failure, then a Regenerate each mint a new id and bill once', async () => {
    const srv = fakeServer();
    let minted = 0;
    const ctrl = createLittleMemoryGenerationController({ mintId: () => `g-${++minted}`, send: srv.send });
    await ctrl.generate(base()); // create → g-1, bills
    expect(srv.providerCalls).toBe(1);
    // retry after a definitively failed attempt → a NEW id, bills again
    const failed = base({ pendingGeneration: { status: 'failed', generationId: 'g-1', model: 'm', briefFingerprint: 'fp', attemptStartedAt: 1, failureCode: 'x' } });
    srv.state.pending = undefined; srv.state.image = undefined; // server: prior attempt cleared
    await ctrl.generate(failed);
    expect(minted).toBe(2);
    expect(srv.providerCalls).toBe(2);
    // regenerate over a ready image → a NEW id, bills again
    const ready = base({ image: { status: 'ready', generationId: 'g-2', model: 'm', objectPath: 'p', mimeType: 'image/png', generatedAt: 1, briefFingerprint: 'fp' } });
    srv.state.image = { status: 'ready', generationId: 'g-2', model: 'm', objectPath: 'p', mimeType: 'image/png', generatedAt: 1, briefFingerprint: 'fp' };
    await ctrl.generate(ready);
    expect(minted).toBe(3);
    expect(srv.providerCalls).toBe(3);
  });
});
