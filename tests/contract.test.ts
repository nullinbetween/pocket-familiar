import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { allowQuestionForTurn, buildModePrompt, countWords, createApp, validateContract, AppDeps } from '../server/app';

/**
 * Round 1.1 fix 3: the concise response contract is enforced in code.
 */

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

describe('validateContract: deterministic per-mode rules', () => {
  it('counts latin words and CJK characters', () => {
    expect(countWords('three little words')).toBe(3);
    expect(countWords('今天很難')).toBe(4);
    expect(countWords('mixed 中文 words')).toBe(4);
  });

  it('deep_reflection: ≤60 words, at most one question', () => {
    expect(validateContract('deep_reflection', words(60) + '?').ok).toBe(true);
    expect(validateContract('deep_reflection', words(61)).ok).toBe(false);
    expect(validateContract('deep_reflection', 'why? how? ' + words(10)).ok).toBe(false);
  });

  it('summary: 80 words total maximum for BOTH paragraph and bullet forms, ≤5 bullets', () => {
    expect(validateContract('summary', words(80)).ok).toBe(true);
    expect(validateContract('summary', words(81)).ok).toBe(false);
    const bullets = ['- one', '- two', '- three', '- four', '- five'].join('\n');
    expect(validateContract('summary', bullets).ok).toBe(true);
    // bullet form gets NO extra word budget (round 1.2 fix 3)
    const fatBullets = `- ${words(40)}\n- ${words(45)}`;
    expect(validateContract('summary', fatBullets).ok).toBe(false);
    const sixBullets = bullets + '\n- six';
    expect(validateContract('summary', sixBullets).ok).toBe(false);
  });

  it('brainstorm: exactly three ideas, ≤100 words', () => {
    expect(validateContract('brainstorm', '1. a\n2. b\n3. c').ok).toBe(true);
    expect(validateContract('brainstorm', '1. a\n2. b').ok).toBe(false);
    expect(validateContract('brainstorm', '1. a\n2. b\n3. c\n4. d').ok).toBe(false);
    expect(validateContract('brainstorm', `1. ${words(50)}\n2. b\n3. ${words(60)}`).ok).toBe(false);
  });

  it('action_plan: one step ≤50 words', () => {
    expect(validateContract('action_plan', words(50)).ok).toBe(true);
    expect(validateContract('action_plan', words(51)).ok).toBe(false);
  });

  it('mindful_chat: ≤60 words, at most one question', () => {
    expect(validateContract('mindful_chat', words(59) + '?').ok).toBe(true);
    expect(validateContract('mindful_chat', words(61)).ok).toBe(false);
  });

  it('enforces the selected per-turn question policy, not prompt wording alone', () => {
    expect(validateContract('mindful_chat', 'A grounded ending.', 0).ok).toBe(true);
    expect(validateContract('mindful_chat', 'Would rest feel helpful?', 0).ok).toBe(false);
    expect(validateContract('mindful_chat', 'Would rest feel helpful?', 1).ok).toBe(true);
    expect(validateContract('summary', 'Anything else?', 0).ok).toBe(false);
  });

  it('uses a stable 30%-bucket policy and a general, non-possessive default character', () => {
    const first = allowQuestionForTurn('same words', 2);
    expect(allowQuestionForTurn('same words', 2)).toBe(first);
    const noQuestion = buildModePrompt('mindful_chat', false);
    expect(noQuestion).toContain('ask NO questions');
    expect(noQuestion).toContain('default general Pocket Familiar');
    expect(noQuestion).toContain('Do not use pet names');
    expect(buildModePrompt('mindful_chat', true)).toContain('A question is optional');
  });
});

describe('contract enforcement in the request path', () => {
  function deps(generate: AppDeps['generate']): AppDeps {
    return {
      verifyIdToken: async () => ({ uid: 'user-a' }),
      generate,
      models: ['model-1', 'model-2'],
      attemptTimeoutMs: 500,
      totalTimeoutMs: 1500,
    };
  }
  const BODY = { mode: 'deep_reflection', mood: 'neutral', title: 't', prompt: 'entry', history: [] };

  it('a nonconforming answer is a failed attempt; a conforming fallback succeeds', async () => {
    const generate = vi.fn(async ({ model }: { model: string }) =>
      model === 'model-1' ? { text: words(200) } : { text: 'one short, grounded observation.' }
    );
    const res = await request(createApp(deps(generate)))
      .post('/api/gemini/reflect')
      .set('Authorization', 'Bearer t')
      .send(BODY);
    expect(res.status).toBe(200);
    expect(res.body.modelUsed).toBe('model-2');
    expect(res.body.timings.attempts[0].error).toMatch(/^contract_violation:reflect_over_60_words/);
  });

  it('all models nonconforming -> 502, nothing stored/truncated', async () => {
    const generate = vi.fn(async () => ({ text: words(200) }));
    const res = await request(createApp(deps(generate)))
      .post('/api/gemini/reflect')
      .set('Authorization', 'Bearer t')
      .send(BODY);
    expect(res.status).toBe(502);
    expect(res.body.text).toBeUndefined();
    expect(
      res.body.timings.attempts.every((a: { error?: string }) => a.error?.startsWith('contract_violation'))
    ).toBe(true);
  });
});
