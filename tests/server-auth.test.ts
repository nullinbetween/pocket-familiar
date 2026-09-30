import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp, AppDeps } from '../server/app';

function makeDeps(overrides: Partial<AppDeps> = {}): AppDeps & { generateSpy: ReturnType<typeof vi.fn> } {
  const generateSpy = vi.fn(async () => ({ text: 'one short, grounded observation.' }));
  return {
    verifyIdToken: vi.fn(async (token: string) => {
      if (token === 'valid-token-user-a') return { uid: 'user-a' };
      if (token === 'valid-token-user-b') return { uid: 'user-b' };
      const err = new Error('invalid or expired');
      throw err;
    }),
    generate: generateSpy,
    generateSpy,
    models: ['model-1', 'model-2'],
    attemptTimeoutMs: 500,
    totalTimeoutMs: 1500,
    ...overrides,
  } as AppDeps & { generateSpy: ReturnType<typeof vi.fn> };
}

const GOOD_BODY = { mode: 'deep_reflection', mood: 'neutral', title: 't', prompt: 'today was hard', history: [] };

describe('Gate B: authentication gates the Gemini endpoint', () => {
  it('rejects a request with no Authorization header BEFORE any provider call', async () => {
    const deps = makeDeps();
    const res = await request(createApp(deps)).post('/api/gemini/reflect').send(GOOD_BODY);
    expect(res.status).toBe(401);
    expect(deps.generateSpy).not.toHaveBeenCalled();
  });

  it('rejects an invalid/forged token before any provider call', async () => {
    const deps = makeDeps();
    const res = await request(createApp(deps))
      .post('/api/gemini/reflect')
      .set('Authorization', 'Bearer forged-token')
      .send(GOOD_BODY);
    expect(res.status).toBe(401);
    expect(deps.generateSpy).not.toHaveBeenCalled();
  });

  it('rejects an expired token (verifier throws) before any provider call', async () => {
    const deps = makeDeps({
      verifyIdToken: async () => {
        const e: Error & { code?: string } = new Error('auth/id-token-expired');
        e.code = 'auth/id-token-expired';
        throw e;
      },
    });
    const res = await request(createApp(deps))
      .post('/api/gemini/reflect')
      .set('Authorization', 'Bearer expired-token')
      .send(GOOD_BODY);
    expect(res.status).toBe(401);
    expect(deps.generateSpy).not.toHaveBeenCalled();
  });

  it('accepts a verified token; uid comes from the token, not the body', async () => {
    const deps = makeDeps();
    const res = await request(createApp(deps))
      .post('/api/gemini/reflect')
      .set('Authorization', 'Bearer valid-token-user-a')
      .send({ ...GOOD_BODY, uid: 'attacker-uid', userId: 'attacker-uid', email: 'a@b.c' });
    expect(res.status).toBe(200);
    expect(deps.verifyIdToken).toHaveBeenCalledWith('valid-token-user-a');
    // body identity fields never reach the provider payload
    const call = deps.generateSpy.mock.calls[0][0];
    expect(JSON.stringify(call.contents)).not.toContain('attacker-uid');
  });

  it('health check needs no auth and leaks no config', async () => {
    const deps = makeDeps();
    const res = await request(createApp(deps)).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(JSON.stringify(res.body)).not.toMatch(/key|secret|project/i);
  });
});

describe('Gate D: bounded, fail-closed generation', () => {
  it('fails closed on empty/blocked model output (no fabricated text)', async () => {
    const deps = makeDeps({ generate: vi.fn(async () => ({ text: '' })) });
    const res = await request(createApp(deps))
      .post('/api/gemini/reflect')
      .set('Authorization', 'Bearer valid-token-user-a')
      .send(GOOD_BODY);
    expect(res.status).toBe(502);
    expect(res.body.text).toBeUndefined();
    expect(res.body.timings.attempts).toHaveLength(2);
    expect(res.body.timings.attempts.every((a: { ok: boolean }) => !a.ok)).toBe(true);
  });

  it('aborts a hanging attempt at the per-attempt deadline and reports timeout attempts', async () => {
    const deps = makeDeps({
      generate: vi.fn(
        () => new Promise(() => undefined) // hangs forever; the ladder must abort it
      ),
      attemptTimeoutMs: 120,
      totalTimeoutMs: 400,
    });
    const t0 = Date.now();
    const res = await request(createApp(deps))
      .post('/api/gemini/reflect')
      .set('Authorization', 'Bearer valid-token-user-a')
      .send(GOOD_BODY);
    const elapsed = Date.now() - t0;
    expect(res.status).toBe(502);
    expect(elapsed).toBeLessThan(2000); // bounded well under a hanging-forever scenario
    expect(res.body.timings.attempts.some((a: { error?: string }) => a.error === 'timeout')).toBe(true);
  });

  it('falls back to the next model and reports per-attempt timings on success', async () => {
    const deps = makeDeps({
      generate: vi.fn(async ({ model }: { model: string }) => {
        if (model === 'model-1') throw Object.assign(new Error('not found'), { status: 404 });
        return { text: 'short reflection.' };
      }),
    });
    const res = await request(createApp(deps))
      .post('/api/gemini/reflect')
      .set('Authorization', 'Bearer valid-token-user-a')
      .send(GOOD_BODY);
    expect(res.status).toBe(200);
    expect(res.body.modelUsed).toBe('model-2');
    expect(res.body.timings.attempts).toHaveLength(2);
    expect(res.body.timings.attempts[0].ok).toBe(false);
    expect(res.body.timings.attempts[1].ok).toBe(true);
  });

  it('rejects an over-long prompt without calling the provider', async () => {
    const deps = makeDeps();
    const res = await request(createApp(deps))
      .post('/api/gemini/reflect')
      .set('Authorization', 'Bearer valid-token-user-a')
      .send({ ...GOOD_BODY, prompt: 'x'.repeat(9000) });
    expect(res.status).toBe(400);
    expect(deps.generateSpy).not.toHaveBeenCalled();
  });

  it('rejects an empty prompt without calling the provider', async () => {
    const deps = makeDeps();
    const res = await request(createApp(deps))
      .post('/api/gemini/reflect')
      .set('Authorization', 'Bearer valid-token-user-a')
      .send({ ...GOOD_BODY, prompt: '   ' });
    expect(res.status).toBe(400);
    expect(deps.generateSpy).not.toHaveBeenCalled();
  });
});
