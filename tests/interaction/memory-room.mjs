/**
 * PF-CORE-02 Living Memory — Memory Room browser evidence + screenshots against
 * the dev-only VISUAL_ONLY_FIXTURE_DATA harness (#memory scene). Asserts that
 * the three record types are never confused, that Held by Midnight separates
 * active from released seeds, that one search field spans all three kinds with
 * honest no-result state, that the Seed → Diary Page → Conversation provenance
 * chain navigates to the exact source (and stays readable when the source is
 * gone), that seed edit/revoke/delete go only through the server-routed handlers,
 * and that the Memory Room JSON + Markdown exports actually download.
 *
 * Run (no production auth; nothing hits Firebase):
 *   VITE_FIREBASE_* ... npx vite --port 5199 --host 127.0.0.1 &
 *   node tests/interaction/memory-room.mjs
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

async function withPage(vp, fn) {
  const ctx = await browser.newContext({ viewport: vp, acceptDownloads: true });
  const page = await ctx.newPage();
  try { await page.goto(`${BASE}/preview/skin-qa.html#memory`, NAV); await page.waitForTimeout(450); await fn(page, ctx); }
  catch (e) { check('SECTION_ERROR', false, e.message); }
  finally { await ctx.close(); }
}
async function snap(page, sel, name, tag) {
  const file = `${OUT}/${name}-${tag}.png`;
  try {
    if (sel === '__full') await page.screenshot({ path: file, fullPage: true });
    else await page.locator(sel).screenshot({ path: file });
    check(`shot ${name} (${tag})`, fs.existsSync(file), file);
  } catch (e) { check(`shot ${name} (${tag})`, false, e.message); }
}

// ── Overview: three columns from the correct source types + Held by Midnight ──
await withPage(D, async (page) => {
  check('column FROM MY STORY is driven by a diary page', (await page.locator('#diary-page-dp-long').count()) === 1);
  check('column YOU TOLD ME is driven by a conversation', (await page.locator('#history-card-told-fx-active').count()) === 1);
  check('column WHAT I THOUGHT is the same conversation seen a second way', (await page.locator('#history-card-thought-fx-active').count()) === 1);
  check('Held by Midnight archive is present and separate', (await page.locator('#held-by-midnight').count()) === 1);
  check('active seeds sit in Held by Midnight', (await page.locator('#held-seed-seed-1').count()) === 1 && (await page.locator('#held-seed-seed-2').count()) === 1);
  check('a released (revoked) seed is kept visibly distinct', (await page.locator('#held-seed-seed-r').count()) === 1);
  const heldText = await page.textContent('#held-by-midnight');
  check('archive labels active vs released distinctly', /Actively held/.test(heldText) && /Released/.test(heldText), heldText.slice(0, 0));
  await snap(page, '__full', 'memory-room-overview', 'desktop');
});
await withPage(M, async (page) => { await snap(page, '__full', 'memory-room-overview', 'mobile'); });

// ── One search across all three kinds + honest no-result ──────────────────────
await withPage(D, async (page) => {
  await page.click('button[aria-label="Search"]');
  await page.fill('#history-search-input', 'walk');
  await page.waitForSelector('#memory-results', { timeout: 5000 });
  const groups = await page.locator('#memory-results section').count();
  check('search spans multiple record kinds at once', groups >= 2, `groups=${groups}`);
  check('a matching diary page appears in results', (await page.locator('#memory-result-diaryPage\\:dp-long').count()) === 1);
  check('a matching seed appears in results', (await page.locator('#memory-result-memorySeed\\:seed-1').count()) === 1);
  await snap(page, '#memory-results', 'memory-room-search', 'desktop');
  // no-result honesty
  await page.fill('#history-search-input', 'zzzz-nothing-matches');
  await page.waitForSelector('#memory-no-results', { timeout: 5000 });
  check('no-result state is explicit, not an empty void', (await page.locator('#memory-no-results').count()) === 1);
});
await withPage(M, async (page) => {
  await page.click('button[aria-label="Search"]');
  await page.fill('#history-search-input', 'walk');
  await page.waitForSelector('#memory-results', { timeout: 5000 });
  await snap(page, '__full', 'memory-room-search', 'mobile');
});

// ── Scope + seed-status filters actually change the rendered records ───────────
await withPage(D, async (page) => {
  // Default (scope=All): seed-status chips are NOT shown (task wording), and the
  // legacy three-column view with its sort/lens/Starred controls IS shown.
  check('default view: Active/Revoked chips are hidden under scope=All', (await page.locator('#memory-seedstatus-active').count()) === 0);
  check('default view: legacy sort/lens/Starred controls are present', (await page.locator('#history-toggle-sort-btn').count()) === 1 && (await page.locator('#memory-mode-filter').count()) === 1 && (await page.locator('#history-toggle-favorites-btn').count()) === 1);
  // Scope=Memory Seeds: unified results, status chips appear, no inert legacy controls.
  await page.click('#memory-scope-memorySeed');
  await page.waitForSelector('#memory-results', { timeout: 5000 });
  check('scope=Memory Seeds narrows to a single kind', (await page.locator('#memory-results section').count()) === 1);
  check('seed-status chips appear only when scope=Memory Seeds', (await page.locator('#memory-seedstatus-active').count()) === 1);
  check('no inert legacy sort/lens/Starred controls during unified results', (await page.locator('#history-toggle-sort-btn').count()) === 0 && (await page.locator('#memory-mode-filter').count()) === 0 && (await page.locator('#history-toggle-favorites-btn').count()) === 0);
  check('all seeds shown when status=all (active + revoked)', (await page.locator('[id^="memory-result-memorySeed"]').count()) === 3);
  // Active/Revoked visibly change the rendered set (not just the highlight).
  await page.click('#memory-seedstatus-active');
  await page.waitForTimeout(150);
  check('status=Active visibly removes released seeds from the results', (await page.locator('#memory-result-memorySeed\\:seed-r').count()) === 0 && (await page.locator('#memory-result-memorySeed\\:seed-1').count()) === 1);
  await page.click('#memory-seedstatus-revoked');
  await page.waitForTimeout(150);
  check('status=Revoked visibly shows only released seeds', (await page.locator('#memory-result-memorySeed\\:seed-r').count()) === 1 && (await page.locator('#memory-result-memorySeed\\:seed-1').count()) === 0);
});

// ── Closing Search clears the query; no silent hidden filtering ────────────────
await withPage(D, async (page) => {
  await page.click('button[aria-label="Search"]');
  await page.fill('#history-search-input', 'walk');
  await page.waitForSelector('#memory-results', { timeout: 5000 });
  check('a query drives the unified results view', (await page.locator('#memory-results').count()) === 1);
  // Toggle Search off — must clear the query and return to the visible default view.
  await page.click('button[aria-label="Search"]');
  await page.waitForTimeout(150);
  check('closing Search clears the query (input gone)', (await page.locator('#history-search-input').count()) === 0);
  check('closing Search returns to the unfiltered three-column view', (await page.locator('#memory-results').count()) === 0 && (await page.locator('#held-by-midnight').count()) === 1);
});

// ── Provenance chain: Seed → Diary Page → Conversation ────────────────────────
await withPage(D, async (page) => {
  await page.click('#held-seed-seed-1');
  await page.waitForSelector('#memory-seed-detail', { timeout: 5000 });
  check('seed detail reader opens', (await page.locator('#memory-seed-detail').count()) === 1);
  check('seed detail shows a verified source excerpt', /From your source page/.test(await page.textContent('#memory-seed-detail')));
  await snap(page, '#memory-seed-detail', 'memory-room-seed-detail', 'desktop');
  await page.click('#seed-detail-source-btn');
  await page.waitForSelector('#diary-page-reader', { timeout: 5000 });
  check('seed → exact source Diary Page', (await page.locator('#diary-page-reader').count()) === 1);
  const readerText = await page.textContent('#diary-page-reader');
  check('the diary page opened is the seed’s real source', /A pocket of calm/.test(readerText));
  await snap(page, '#diary-page-reader', 'memory-room-provenance-chain', 'desktop');
  await page.click('#diary-open-source-btn');
  await page.waitForTimeout(200);
  const qa = await page.evaluate(() => window.__qa);
  check('diary page → exact source Conversation (no circular loop)', qa.sourceId === 'fx-active', qa.sourceId);
});

// ── Source-unavailable stays readable ─────────────────────────────────────────
await withPage(D, async (page) => {
  await page.click('#held-seed-seed-2');
  await page.waitForSelector('#memory-seed-detail', { timeout: 5000 });
  const t = await page.textContent('#memory-seed-detail');
  check('seed with a gone source is still fully readable', /keep a page without keeping the whole conversation/.test(t));
  check('source-unavailable is stated honestly', /unavailable/i.test(t));
  const disabled = await page.locator('#seed-detail-source-btn').isDisabled();
  check('the unavailable source link is disabled, not a dead loop', disabled === true);
  await snap(page, '#memory-seed-detail', 'memory-room-source-unavailable', 'desktop');
});
await withPage(M, async (page) => {
  await page.click('#held-seed-seed-1');
  await page.waitForSelector('#memory-seed-detail', { timeout: 5000 });
  await snap(page, '#memory-seed-detail', 'memory-room-seed-detail', 'mobile');
});

// ── Seed edit / revoke / delete go ONLY through server-routed handlers ─────────
await withPage(D, async (page) => {
  // edit
  await page.click('#held-seed-seed-1');
  await page.waitForSelector('#memory-seed-detail', { timeout: 5000 });
  await page.click('#seed-detail-edit-btn');
  await page.fill('#seed-detail-edit-input', 'The walk home is mine — edited.');
  await page.click('#seed-detail-save-btn');
  await page.waitForTimeout(150);
  let qa = await page.evaluate(() => window.__qa);
  check('edit routes through the server-backed edit handler', qa.saveCalls.some((x) => x.startsWith('edit:seed-1:')), JSON.stringify(qa.saveCalls));
  // revoke
  await page.click('#seed-detail-revoke-btn');
  await page.waitForTimeout(150);
  qa = await page.evaluate(() => window.__qa);
  check('revoke routes through the server-backed revoke handler', qa.saveCalls.some((x) => x === 'revoke:seed-1'), JSON.stringify(qa.saveCalls));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  check('Escape closes the seed detail dialog', (await page.locator('#memory-seed-detail').count()) === 0);
  // delete now opens the stale-safe seed-deletion review (server preview → confirm)
  await page.click('#held-seed-seed-2');
  await page.waitForSelector('#memory-seed-detail', { timeout: 5000 });
  await page.click('#seed-detail-delete-btn');
  await page.waitForTimeout(150);
  qa = await page.evaluate(() => window.__qa);
  check('delete routes to the stale-safe seed-deletion request (not a direct delete)', qa.saveCalls.some((x) => x === 'request-delete:seed-2'), JSON.stringify(qa.saveCalls));
  check('revoke/delete never fired a client diary/conversation delete', !qa.saveCalls.some((x) => /^(diary|conv)/.test(x)));
});

// ── Memory Room exports actually download (JSON + Markdown) ────────────────────
await withPage(D, async (page) => {
  const [dlJson] = await Promise.all([
    page.waitForEvent('download', { timeout: 5000 }),
    page.click('#memory-room-export-json-btn'),
  ]);
  const jp = await dlJson.path();
  const json = fs.readFileSync(jp, 'utf8');
  check('Room JSON download names all three kinds', json.includes('"conversations"') && json.includes('"diaryPages"') && json.includes('"memorySeeds"'));
  check('Room JSON keeps revoked seeds with status', json.includes('"revoked"'));
  check('Room JSON keeps model turns labelled as the familiar, not the user', json.includes('"author": "familiar"'));
  check('Room JSON leaks no secret config', !/apikey|firebase|token/i.test(json));
  const [dlMd] = await Promise.all([
    page.waitForEvent('download', { timeout: 5000 }),
    page.click('#memory-room-export-md-btn'),
  ]);
  const md = fs.readFileSync(await dlMd.path(), 'utf8');
  check('Room Markdown has separated authored sections', /## From my story/.test(md) && /## Conversations/.test(md) && /## Held by Midnight/.test(md));
  check('Room Markdown marks revoked seeds and states scope', /\[revoked\]/.test(md) && /scope:/i.test(md));
});

// ── Real modal focus management: initial focus, trap both directions, restore ─
await withPage(D, async (page) => {
  await page.focus('#held-seed-seed-1');
  await page.click('#held-seed-seed-1');
  await page.waitForSelector('#memory-seed-detail', { timeout: 5000 });
  const focusInsideOnOpen = await page.evaluate(() => {
    const d = document.querySelector('#memory-seed-detail');
    return !!d && d.contains(document.activeElement);
  });
  check('initial focus moves into the dialog on open', focusInsideOnOpen);
  // Tab forward several times — focus must never escape the dialog.
  let escaped = false;
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    const inside = await page.evaluate(() => {
      const d = document.querySelector('#memory-seed-detail');
      return !!d && d.contains(document.activeElement);
    });
    if (!inside) { escaped = true; break; }
  }
  check('Tab is trapped inside the dialog (forward)', !escaped);
  // Shift+Tab backward — also trapped.
  let escapedBack = false;
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Shift+Tab');
    const inside = await page.evaluate(() => {
      const d = document.querySelector('#memory-seed-detail');
      return !!d && d.contains(document.activeElement);
    });
    if (!inside) { escapedBack = true; break; }
  }
  check('Shift+Tab is trapped inside the dialog (backward)', !escapedBack);
  // Escape closes and returns focus to the exact opener.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  check('Escape closes the dialog', (await page.locator('#memory-seed-detail').count()) === 0);
  const returned = await page.evaluate(() => document.activeElement && document.activeElement.id);
  check('focus returns to the exact opener (held-seed-seed-1)', returned === 'held-seed-seed-1', String(returned));
  // Overlay click also closes and restores focus.
  await page.click('#held-seed-seed-1');
  await page.waitForSelector('#memory-seed-detail', { timeout: 5000 });
  await page.mouse.click(5, 5); // click the backdrop, outside the dialog surface
  await page.waitForTimeout(150);
  check('overlay click closes the dialog', (await page.locator('#memory-seed-detail').count()) === 0);
  const returned2 = await page.evaluate(() => document.activeElement && document.activeElement.id);
  check('overlay close also returns focus to the opener', returned2 === 'held-seed-seed-1', String(returned2));
});

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ total: results.length, passed: results.length - failed.length, failed: failed.length, results }, null, 2));
process.exit(failed.length ? 1 : 0);
