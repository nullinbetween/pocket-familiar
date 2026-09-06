/**
 * PF-CORE-03A Little Memory — browser evidence against the dev-only
 * VISUAL_ONLY_FIXTURE_DATA harness. Proves the truthful loop: choose sources →
 * draft → caption review → a failed save preserves the draft → retry creates one record;
 * the album/detail; exact source navigation; source-unavailable readability;
 * server-routed edit/delete; the 4th-kind search + export; and that NO fake
 * illustration is shown.
 *
 * Run (no production auth):
 *   VITE_FIREBASE_* ... npx vite --port 5199 --host 127.0.0.1 &
 *   node tests/interaction/little-memory.mjs
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:5199';
const OUT = process.env.SHOT_DIR || 'screenshots';
fs.mkdirSync(OUT, { recursive: true });
const D = { width: 1440, height: 900 }, M = { width: 390, height: 844 };
const NAV = { waitUntil: 'networkidle', timeout: 30000 };
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail: String(detail) });
const browser = await chromium.launch();

async function withPage(scene, vp, fn) {
  const ctx = await browser.newContext({ viewport: vp, acceptDownloads: true });
  const page = await ctx.newPage();
  try { await page.goto(`${BASE}/preview/skin-qa.html#${scene}`, NAV); await page.waitForTimeout(450); await fn(page, ctx); }
  catch (e) { check(`SECTION_ERROR(${scene})`, false, e.message); }
  finally { await ctx.close(); }
}
async function snap(page, sel, name, tag) {
  const file = `${OUT}/${name}-${tag}.png`;
  try { if (sel === '__full') await page.screenshot({ path: file, fullPage: true }); else await page.locator(sel).screenshot({ path: file }); check(`shot ${name} (${tag})`, fs.existsSync(file), file); }
  catch (e) { check(`shot ${name} (${tag})`, false, e.message); }
}

// ── Studio: choose → draft → edit → failed save preserves → retry = one record ─
await withPage('little-studio', D, async (page) => {
  await page.waitForSelector('#little-memory-studio', { timeout: 5000 });
  check('studio opens on a chosen diary page', (await page.locator('#lm-source-page').count()) === 1);
  check('active seeds are offered as explicit choices', (await page.locator('#lm-seed-option-seed-1').count()) === 1);
  await page.click('#lm-seed-option-seed-1');
  await page.click('#lm-draft-btn');
  await page.waitForSelector('#lm-review', { timeout: 5000 });
  check('review says the Little Memory is not saved yet', /not saved yet/i.test(await page.textContent('#lm-not-saved')));
  check('internal image-direction fields are hidden from the user', !/Setting|Time of day|Emotional tone|Midnight is|Visual motifs|Composition/i.test(await page.textContent('#lm-review')));
  check('the user, not Gemini, chose the source seed', (await page.evaluate(() => window.__qa.lmDraftArgs?.seedIds || [])).includes('seed-1'));
  await snap(page, '#little-memory-studio', 'little-memory-review', 'desktop');
  // edit a field, then fail the first save
  await page.fill('#lm-field-caption', 'My own caption for this scene.');
  await page.click('#lm-approve-btn');
  await page.waitForTimeout(200);
  let qa = await page.evaluate(() => window.__qa);
  check('first save failed (fixture)', qa.confirmed === 'lm-save-failed', qa.confirmed);
  check('a failed save preserves the review + the user edit', (await page.locator('#lm-review').count()) === 1 && (await page.inputValue('#lm-field-caption')) === 'My own caption for this scene.');
  check('the failed save shows an error', (await page.locator('#lm-error').count()) === 1);
  // retry succeeds -> exactly one approval recorded with the edited caption
  await page.click('#lm-approve-btn');
  await page.waitForTimeout(200);
  qa = await page.evaluate(() => window.__qa);
  check('retry saves exactly one record with the edited fields', qa.confirmed === 'lm-approved' && qa.saveCalls.filter((x) => x.startsWith('lm-approve:')).length === 1, JSON.stringify(qa.saveCalls));
  check('the saved caption is the user’s edited text', qa.saveCalls.some((x) => x === 'lm-approve:My own caption for this scene.'));
  // P0-1: the production studio allocated the id ONCE and both attempts reused it.
  check('the id is pre-allocated exactly once for the save group', qa.allocCount === 1, `allocCount=${qa.allocCount}`);
  check('both save attempts carried the SAME pre-allocated id (idempotent retry)', Array.isArray(qa.approveIds) && qa.approveIds.length === 2 && qa.approveIds[0] === qa.approveIds[1], JSON.stringify(qa.approveIds));
});

// ── Album + detail + provenance + no fake image ───────────────────────────────
await withPage('little', D, async (page) => {
  await page.waitForSelector('#little-memory-album', { timeout: 5000 });
  check('album shows Little Memory cards', (await page.locator('#lm-card-lm-1').count()) === 1);
  check('a not-generated card honestly shows the pending placeholder (no image)', (await page.locator('#lm-card-pending-lm-1').count()) === 1 && (await page.locator('#lm-card-image-lm-1').count()) === 0);
  check('no auto-generation happened on album load', !(await page.evaluate(() => window.__qa.saveCalls)).some((x) => x.startsWith('lm-generate:')));
  await snap(page, '__full', 'little-memory-album', 'desktop');
  // detail + exact source navigation
  await page.click('#lm-card-lm-1');
  await page.waitForSelector('#little-memory-detail', { timeout: 5000 });
  const detailText = await page.textContent('#little-memory-detail');
  check('detail shows the human-facing caption', /The walk home is mine again/i.test(detailText));
  check('detail hides internal image-direction fields', !/Setting|Time of day|Emotional tone|Midnight is|Visual motifs|Composition/i.test(detailText));
  check('an available diary source has an exact Open link', (await page.locator('#lm-detail-source-diaryPage-dp-long').count()) === 1);
  check('an available seed source has an exact Open link', (await page.locator('#lm-detail-source-memorySeed-seed-1').count()) === 1);
  await snap(page, '#little-memory-detail', 'little-memory-detail', 'desktop');
  await page.click('#lm-detail-source-diaryPage-dp-long');
  await page.waitForTimeout(150);
  check('opening the diary source navigates to the exact page', (await page.evaluate(() => window.__qa.sourceId)) === 'dp-long');
});

// ── P1c: the album header is truthful when illustrations exist ─────────────────
await withPage('little', D, async (page) => {
  await page.waitForSelector('#little-memory-album', { timeout: 5000 });
  // The harness has ready/stale illustrations present, so the header must NOT claim
  // globally that no pictures exist.
  const header = await page.textContent('.max-w-4xl');
  check('album header does not falsely say no pictures exist when some are illustrated',
    !/No pictures are generated yet/i.test(header) && /illustrations you/i.test(header), header?.slice(0, 160));
});

// ── P1a + P1b: a REVOKED seed still exists → readable + exact-id navigation ────
await withPage('little', D, async (page) => {
  await page.waitForSelector('#little-memory-album', { timeout: 5000 });
  await page.click('#lm-card-lm-revseed');
  await page.waitForSelector('#little-memory-detail', { timeout: 5000 });
  check('a revoked-but-existing seed source is still navigable (not marked unavailable)',
    (await page.locator('#lm-detail-source-memorySeed-seed-r').count()) === 1);
  await page.click('#lm-detail-source-memorySeed-seed-r');
  await page.waitForTimeout(150);
  check('opening the seed source carries the EXACT seed id (not merely a tab switch)',
    (await page.evaluate(() => window.__qa.seedSourceId)) === 'seed-r');
});
await withPage('little', M, async (page) => { await page.waitForSelector('#little-memory-album'); await snap(page, '__full', 'little-memory-album', 'mobile'); });

// ── Source-unavailable stays readable ─────────────────────────────────────────
await withPage('little', D, async (page) => {
  await page.waitForSelector('#lm-card-lm-gone', { timeout: 5000 });
  await page.click('#lm-card-lm-gone');
  await page.waitForSelector('#little-memory-detail', { timeout: 5000 });
  const t = await page.textContent('#little-memory-detail');
  check('a Little Memory with a gone source is still fully readable', /A steady day I chose to keep/.test(t));
  check('the gone source is labelled unavailable, not linked', /source unavailable/i.test(t) && (await page.locator('#lm-detail-source-diaryPage-dp-gone').count()) === 0);
  await snap(page, '#little-memory-detail', 'little-memory-source-unavailable', 'desktop');
});

// ── Server-routed delete remains scoped to the Little Memory ──────────────────
await withPage('little', D, async (page) => {
  await page.click('#lm-card-lm-1');
  await page.waitForSelector('#little-memory-detail', { timeout: 5000 });
  check('no technical brief editor is exposed in the detail', (await page.locator('#lm-detail-edit-btn').count()) === 0);
  await page.click('#lm-detail-delete-btn');
  await page.click('#lm-detail-delete-confirm-btn');
  await page.waitForTimeout(150);
  const qa = await page.evaluate(() => window.__qa);
  check('delete routes through the server-backed handler', qa.saveCalls.some((x) => x === 'lm-delete:lm-1'));
  check('edit/delete never fired a diary/seed/source delete', !qa.saveCalls.some((x) => /^(diary|seed|source|revoke|delete:)/.test(x)));
});

// ── New Little Memory from a diary page (the full loop through the album) ──────
await withPage('little', D, async (page) => {
  await page.click('#lm-new-btn');
  await page.waitForSelector('#lm-page-picker', { timeout: 5000 });
  check('the page picker lists confirmed diary pages', (await page.locator('#lm-pick-page-dp-long').count()) === 1);
  await page.click('#lm-pick-page-dp-long');
  await page.waitForSelector('#little-memory-studio', { timeout: 5000 });
  await page.click('#lm-draft-btn');
  await page.waitForSelector('#lm-review', { timeout: 5000 });
  await page.click('#lm-approve-btn');
  await page.waitForTimeout(200);
  const qa = await page.evaluate(() => window.__qa);
  check('approving from the album records exactly one save', qa.confirmed === 'lm-approved');
});

// ── Living Memory: Little Memory is the 4th searchable kind + in the export ────
await withPage('memory', D, async (page) => {
  check('a Little Memories scope chip exists', (await page.locator('#memory-scope-littleMemory').count()) === 1);
  await page.click('#memory-scope-littleMemory');
  await page.waitForSelector('#memory-results', { timeout: 5000 });
  check('scope=Little Memories returns only that kind', (await page.locator('#memory-results section').count()) === 1 && (await page.locator('#memory-result-littleMemory\\:lm-1').count()) === 1);
  await page.click('#memory-result-littleMemory\\:lm-1');
  await page.waitForTimeout(150);
  check('opening a Little Memory result routes to the album', (await page.evaluate(() => window.__qa.openedLittleMemoryId)) === 'lm-1');
});
await withPage('memory', D, async (page) => {
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 5000 }),
    page.click('#memory-room-export-json-btn'),
  ]);
  const json = fs.readFileSync(await dl.path(), 'utf8');
  check('Room JSON export includes little memories', json.includes('"littleMemories"'));
  check('Room JSON reports generated illustrations truthfully', json.includes('"illustrationGenerated": true') && json.includes('"illustrationStatus": "ready"'));
  check('Room JSON never claims an image URL for a little memory', !/imageurl/i.test(json));
  check('Room JSON never exposes a private object path', !/objectPath|users\/[^/]+\/littleMemories\/[^/]+\/generations\//i.test(json));
});

// ── P0-2: deleting a Memory Seed shows the affected Little Memories + is stale-safe
await withPage('seed-deletion', D, async (page) => {
  await page.waitForSelector('#seed-deletion-dialog', { timeout: 5000 });
  check('seed deletion shows the affected Little Memories (kept, not deleted)', (await page.locator('#seed-deletion-affected li').count()) === 1);
  check('the dialog states the Little Memories are kept', /kept/i.test(await page.textContent('#seed-deletion-dialog')));
  await snap(page, '#seed-deletion-dialog', 'seed-deletion', 'desktop');
  await page.click('#seed-deletion-delete-btn');
  await page.waitForTimeout(150);
  check('confirming deletes the seed', (await page.evaluate(() => window.__qa.confirmed)) === 'seed-deleted');
});
await withPage('seed-deletion-conflict', D, async (page) => {
  await page.waitForSelector('#seed-deletion-dialog', { timeout: 5000 });
  check('conflict: one affected Little Memory shown initially', (await page.locator('#seed-deletion-affected li').count()) === 1);
  await page.click('#seed-deletion-delete-btn');
  await page.waitForTimeout(150);
  check('conflict: a stale plan shows the plan-changed notice', (await page.locator('#seed-deletion-conflict').count()) === 1);
  check('conflict: the refreshed preview now shows both Little Memories', (await page.locator('#seed-deletion-affected li').count()) === 2);
  let qa = await page.evaluate(() => window.__qa);
  check('conflict: first confirm did NOT delete', qa.confirmed === 'seed-conflict', qa.confirmed);
  await page.click('#seed-deletion-delete-btn');
  await page.waitForTimeout(150);
  qa = await page.evaluate(() => window.__qa);
  check('conflict: reconfirm on the refreshed plan succeeds', qa.confirmed === 'seed-deleted-after-refresh', qa.confirmed);
});

// ── PF-CORE-03B: explicit generation → ready; failed → retry; stale → regenerate ─
await withPage('little', D, async (page) => {
  await page.waitForSelector('#little-memory-album', { timeout: 5000 });
  // not_generated → explicit Create → ready with real (dev-fixture) image + provenance
  await page.click('#lm-card-lm-1');
  await page.waitForSelector('#little-memory-detail', { timeout: 5000 });
  check('a not-generated Little Memory offers an explicit Create action', (await page.locator('#lm-generate-btn').count()) === 1 && (await page.locator('#lm-detail-pending').count()) === 1);
  await page.click('#lm-generate-btn');
  await page.waitForSelector('#lm-detail-image', { timeout: 5000 });
  let qa = await page.evaluate(() => window.__qa);
  check('generation happens only on the explicit action', qa.saveCalls.includes('lm-generate:lm-1') && qa.confirmed === 'lm-generated');
  check('ready detail shows the real generated image via the authenticated load', qa.imageLoaded >= 1);
  const src = await page.getAttribute('#lm-detail-image', 'src');
  check('the displayed image came from the retrieval path (dev fixture here), not a baked asset', !!src && src.startsWith('data:image/svg'));
  check('ready detail carries AI-generated provenance without exposing the internal brief', /AI-generated from your saved memory/i.test(await page.textContent('#lm-detail-illustration')));
  await snap(page, '#little-memory-detail', 'little-memory-generated', 'desktop');
});
await withPage('little', M, async (page) => {
  await page.waitForSelector('#little-memory-album');
  await page.click('#lm-card-lm-1'); await page.waitForSelector('#lm-generate-btn');
  await page.click('#lm-generate-btn'); await page.waitForSelector('#lm-detail-image', { timeout: 5000 });
  await snap(page, '__full', 'little-memory-generated', 'mobile');
});
await withPage('little', D, async (page) => {
  // failed → visible Retry → ready
  await page.click('#lm-card-lm-failed');
  await page.waitForSelector('#little-memory-detail', { timeout: 5000 });
  check('a failed illustration shows a visible Retry and keeps the caption', (await page.locator('#lm-generate-retry-btn').count()) === 1 && /Try creating it again/i.test(await page.textContent('#little-memory-detail')));
  await page.click('#lm-generate-retry-btn');
  await page.waitForSelector('#lm-detail-image', { timeout: 5000 });
  check('retry produces a ready image', (await page.evaluate(() => window.__qa.saveCalls)).includes('lm-generate:lm-failed'));
});
await withPage('little', D, async (page) => {
  // stale (edited after generation) → shows previous image + "made from the previous brief" + Regenerate
  await page.click('#lm-card-lm-stale');
  await page.waitForSelector('#little-memory-detail', { timeout: 5000 });
  check('a stale image is still shown, labelled made-from-previous-brief', (await page.locator('#lm-detail-image').count()) === 1 && (await page.locator('#lm-illustration-stale').count()) === 1);
  check('a stale image offers Regenerate', (await page.locator('#lm-regenerate-btn').count()) === 1);
  await snap(page, '#little-memory-detail', 'little-memory-stale', 'desktop');
  await page.click('#lm-regenerate-btn');
  await page.waitForTimeout(200);
  check('regenerate refreshes to a ready (non-stale) image', (await page.locator('#lm-illustration-stale').count()) === 0 && (await page.locator('#lm-detail-image').count()) === 1);
});

// ── P0-3: a FAILED regeneration keeps the previous image viewable + offers retry ─
await withPage('little', D, async (page) => {
  await page.waitForSelector('#little-memory-album', { timeout: 5000 });
  await page.click('#lm-card-lm-regenfail');
  await page.waitForSelector('#little-memory-detail', { timeout: 5000 });
  check('a ready illustration shows the image + a Regenerate action',
    (await page.locator('#lm-detail-image').count()) === 1 && (await page.locator('#lm-regenerate-btn').count()) === 1);
  await page.click('#lm-regenerate-btn');
  await page.waitForTimeout(250);
  const qa = await page.evaluate(() => window.__qa);
  check('the regeneration attempt failed (fixture)', qa.confirmed === 'lm-generate-failed');
  check('the previous illustration is STILL shown after a failed regeneration (P0-3)',
    (await page.locator('#lm-detail-image').count()) === 1);
  check('a failed replacement is honestly marked and offers a retry',
    (await page.locator('#lm-illustration-replace-failed').count()) === 1 && (await page.locator('#lm-generate-retry-btn').count()) === 1);
  await snap(page, '#little-memory-detail', 'little-memory-regen-failed', 'desktop');
});

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ total: results.length, passed: results.length - failed.length, failed: failed.length, results }, null, 2));
process.exit(failed.length ? 1 : 0);
