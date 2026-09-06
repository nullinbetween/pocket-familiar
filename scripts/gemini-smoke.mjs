// Gate D: real-API smoke test for the model ladder. Run separately and rarely —
// it spends quota. Usage: GEMINI_API_KEY=... node scripts/gemini-smoke.mjs
import { GoogleGenAI } from '@google/genai';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('SKIPPED: set GEMINI_API_KEY to run the smoke test (it spends quota).');
  process.exit(2);
}

const models = (process.env.GEMINI_MODELS ?? 'gemini-3.6-flash,gemini-3.1-flash-lite,gemini-flash-latest,gemini-3.7-flash')
  .split(',').map((m) => m.trim()).filter(Boolean);

const ai = new GoogleGenAI({ apiKey });
const results = [];
for (const model of models) {
  const t0 = Date.now();
  try {
    const r = await ai.models.generateContent({
      model,
      contents: [{ role: 'user', parts: [{ text: 'Reply with the single word: ok' }] }],
      config: { temperature: 0 },
    });
    const text = (r?.text ?? '').trim().slice(0, 40);
    results.push({ model, ok: Boolean(text), ms: Date.now() - t0, sample: text });
  } catch (err) {
    results.push({ model, ok: false, ms: Date.now() - t0, error: err?.status ?? err?.message ?? String(err) });
  }
}
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2));
const usable = results.filter((r) => r.ok).map((r) => r.model);
console.log(usable.length > 0 ? `USABLE_MODELS=${usable.join(',')}` : 'USABLE_MODELS=none — ladder must be fixed before deploy');
process.exit(usable.length > 0 ? 0 : 1);
