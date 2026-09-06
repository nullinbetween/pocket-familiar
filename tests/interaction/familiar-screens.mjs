/**
 * PF-CORE-01 — Familiar surface screenshots (evidence 13) + a few browser
 * interaction assertions against the dev-only VISUAL_ONLY_FIXTURE_DATA harness.
 * Captures mobile + desktop shots of: seed proposal, seed library, Companion
 * profile, Keeper-ready ceremony, and Keeper state/silhouette.
 *
 * Run (no production auth; nothing hits Firebase):
 *   VITE_FIREBASE_* ... npx vite --port 5199 --host 127.0.0.1 &
 *   node tests/interaction/familiar-screens.mjs
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

async function shot(scene, name, waitSel, viewport, prep, clipSel) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  try {
    await page.goto(`${BASE}/preview/skin-qa.html#${scene}`, NAV);
    await page.waitForSelector(waitSel, { timeout: 8000 });
    await page.waitForTimeout(500); // settle fonts/art
    if (prep) await prep(page);
    const tag = viewport === M ? 'mobile' : 'desktop';
    const file = `${OUT}/${name}-${tag}.png`;
    if (clipSel) {
      await page.locator(clipSel).screenshot({ path: file });
    } else {
      await page.screenshot({ path: file, fullPage: true });
    }
    check(`shot ${name} (${tag})`, fs.existsSync(file), file);
  } catch (e) {
    check(`shot ${name}`, false, e.message);
  } finally {
    await ctx.close();
  }
}

for (const vp of [M, D]) {
  await shot('seed-proposal', 'seed-proposal', '#memory-seed-proposal', vp);
  await shot('familiar', 'companion-profile', '#familiar-identity', vp);
  await shot('familiar', 'seed-library', '#memory-seed-library', vp, null, '#memory-seed-library');
  await shot('keeper-ready', 'keeper-ceremony', '#familiar-begin-keeper-btn', vp, async (page) => {
    await page.click('#familiar-begin-keeper-btn');
    await page.waitForSelector('#familiar-keeper-ceremony', { timeout: 5000 });
  });
  await shot('keeper', 'keeper-state', '#familiar-keeper-portrait', vp);
}

// ── Interaction assertions ────────────────────────────────────────────────────
async function withPage(scene, vp, fn) {
  const ctx = await browser.newContext({ viewport: vp });
  const page = await ctx.newPage();
  try { await page.goto(`${BASE}/preview/skin-qa.html#${scene}`, NAV); await page.waitForTimeout(400); await fn(page); }
  catch (e) { check('SECTION_ERROR', false, e.message); }
  finally { await ctx.close(); }
}

await withPage('seed-proposal', M, async (page) => {
  check('proposal shows "Not remembered yet"', (await page.locator('#memory-seed-not-saved').count()) === 1);
  check('proposal shows verified source excerpt', (await page.locator('#memory-seed-source-excerpt').count()) === 1);
  await page.click('#memory-seed-approve-btn'); await page.waitForTimeout(200);
  const qa = await page.evaluate(() => window.__qa);
  check('approve records durable write only on approval', qa.confirmed === 'seed-approved', qa.confirmed);
});

await withPage('familiar', D, async (page) => {
  check('active seeds render as kept slips', (await page.locator('.memory-seed-card').count()) >= 2);
  check('no numeric threshold shown in growth motif', !/\b3\b|\b2\b|more|left|remaining/i.test(await page.textContent('#familiar-growth-motif')));
  check('companion shows NO Keeper button (not eligible)', (await page.locator('#familiar-begin-keeper-btn').count()) === 0);
  check('locked Keeper silhouette present in the scene', (await page.locator('#familiar-keeper-silhouette').count()) === 1);
  // Slips open to reveal quiet controls (no 3-icon cluster by default)
  check('no management icons shown before opening a slip', (await page.locator('.memory-seed-revoke-btn').count()) === 0);
  const slips = page.locator('.memory-seed-open-btn');
  const n = await slips.count();
  let sawUnavailable = false;
  for (let i = 0; i < n; i++) {
    await slips.nth(i).click(); await page.waitForTimeout(80);
    if ((await page.locator('.memory-seed-source-unavailable').count()) >= 1) sawUnavailable = true;
  }
  check('an opened slip renders an honest unavailable-source state', sawUnavailable);
  await page.locator('.memory-seed-revoke-btn').first().click(); await page.waitForTimeout(150);
  const qa = await page.evaluate(() => window.__qa);
  check('revoke calls the revoke handler', Array.isArray(qa.saveCalls) && qa.saveCalls.some((x) => /^revoke:/.test(x)), JSON.stringify(qa.saveCalls));
});

await withPage('keeper-ready', D, async (page) => {
  check('eligible shows explicit Keeper action', (await page.locator('#familiar-begin-keeper-btn').count()) === 1);
  const qa0 = await page.evaluate(() => window.__qa);
  check('eligibility did NOT auto-transform', qa0.confirmed == null, qa0.confirmed);
  await page.click('#familiar-begin-keeper-btn'); await page.waitForSelector('#familiar-keeper-ceremony');
  check('ceremony offers staying in Companion', (await page.locator('#familiar-keeper-stay-btn').count()) === 1);
  await page.click('#familiar-keeper-confirm-btn'); await page.waitForTimeout(200);
  const qa = await page.evaluate(() => window.__qa);
  check('explicit confirm activates Keeper', qa.confirmed === 'keeper-activated', qa.confirmed);
});

await withPage('keeper', D, async (page) => {
  check('Keeper state shows the accepted Keeper artwork', (await page.locator('#familiar-keeper-portrait').count()) === 1);
  check('earlier Companion form history preserved', /Companion/.test(await page.textContent('#familiar-form-history')));
});

await withPage('familiar', D, async (page) => {
  check('Companion shows the accepted locked Keeper silhouette preview', (await page.locator('#familiar-keeper-silhouette').count()) === 1);
});

await withPage('source-deletion', D, async (page) => {
  check('deletion dialog previews affected memories', (await page.locator('#source-deletion-affected').count()) === 1);
  check('deletion offers keep-marked-unavailable', (await page.locator('#source-deletion-keep-btn').count()) === 1);
});

// P0-2: plan-conflict refresh/reconfirm flow
await withPage('source-conflict', D, async (page) => {
  check('conflict: one affected memory shown initially', (await page.locator('#source-deletion-affected li').count()) === 1);
  await page.click('#source-deletion-delete-btn'); await page.waitForTimeout(150);
  check('conflict: 409 shows the plan-changed notice', (await page.locator('#source-deletion-conflict').count()) === 1);
  check('conflict: refreshed preview now shows both memories', (await page.locator('#source-deletion-affected li').count()) === 2);
  const qa1 = await page.evaluate(() => window.__qa);
  check('conflict: first confirm did NOT delete', qa1.confirmed === 'conflict-409', qa1.confirmed);
  await page.click('#source-deletion-delete-btn'); await page.waitForTimeout(150);
  const qa2 = await page.evaluate(() => window.__qa);
  check('conflict: reconfirm on refreshed plan succeeds', qa2.confirmed === 'deleted-after-refresh', qa2.confirmed);
});

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ total: results.length, passed: results.length - failed.length, failed: failed.length, results }, null, 2));
process.exit(failed.length ? 1 : 0);
