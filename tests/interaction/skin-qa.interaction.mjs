/**
 * Skin Round 1 — reproducible browser INTERACTION evidence (not a unit test).
 *
 * Runs real clicks/keyboard against the dev-only VISUAL_ONLY_FIXTURE_DATA harness
 * (preview/skin-qa.html) with observable spy callbacks (window.__qa) and asserts
 * that the correct saved record drives navigation/save, that the diary reader
 * shows every field (incl. when the source is gone), that save-fail→retry reuses
 * one page id, that mode/Starred scope only conversations, and that Pages JSON /
 * Conversations JSON / Conversations Markdown download the right collections.
 *
 * How to run (no production auth; nothing hits Firebase):
 *   npm i -D playwright   # or use a global playwright
 *   VITE_FIREBASE_PROJECT_ID=<reviewed> VITE_FIREBASE_API_KEY=<public web key> \
 *   VITE_FIREBASE_AUTH_DOMAIN=... VITE_FIREBASE_APP_ID=... \
 *   npx vite --port 5199 --host 127.0.0.1 &
 *   node tests/interaction/skin-qa.interaction.mjs
 * Exits non-zero if any assertion fails; prints a JSON report.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
const BASE = process.env.QA_BASE || 'http://127.0.0.1:5199';
const D = { width: 1440, height: 900 }, M = { width: 390, height: 844 };
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail: String(detail) });
const NAV = { waitUntil: 'networkidle', timeout: 30000 };
const browser = await chromium.launch();
async function section(fn) { try { await fn(); } catch (e) { check('SECTION_ERROR', false, e.message); } }

await section(async () => {
  const ctx = await browser.newContext({ viewport: M, acceptDownloads: true });
  const page = await ctx.newPage();
  await page.goto(BASE + '/preview/skin-qa.html#memory', NAV); await page.waitForTimeout(400);
  await page.focus('#diary-page-dp-long'); await page.keyboard.press('Enter');
  await page.waitForSelector('#diary-page-reader', { timeout: 5000 });
  const t = await page.textContent('#diary-page-reader');
  check('reader opens via keyboard (Enter)', true);
  check('reader shows last sentence', /keep the shape of it/.test(t));
  check('reader shows BOTH important points', /The walk home felt like mine again/.test(t) && /Calm is easier to keep when I make room for it/.test(t));
  check('reader shows carry-forward', /Leave the walk home phone-free tomorrow/.test(t));
  check('reader offers source nav when available', (await page.locator('#diary-open-source-btn').count()) === 1);
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  check('reader closes on Escape', (await page.locator('#diary-page-reader').count()) === 0);
  await page.click('#diary-page-dp-nosrc'); await page.waitForSelector('#diary-page-reader');
  const t2 = await page.textContent('#diary-page-reader');
  check('no-source page still readable in full', /keep a page without keeping the whole conversation/.test(t2) && /no longer available/.test(t2));
  check('no-source page hides source-nav', (await page.locator('#diary-open-source-btn').count()) === 0);
  await ctx.close();
});
await section(async () => {
  const ctx = await browser.newContext({ viewport: M });
  const page = await ctx.newPage();
  await page.goto(BASE + '/preview/skin-qa.html#remember', NAV);
  await page.click('#diary-generate-draft-btn'); await page.waitForSelector('#diary-draft-preview', { timeout: 5000 });
  const preview = await page.textContent('#diary-draft-preview');
  check('preview shows all draft fields before Edit', /A pocket of calm/.test(preview) && /The walk home felt like mine again/.test(preview) && /Leave the walk home phone-free tomorrow/.test(preview));
  check('Edit fields hidden until Edit clicked', (await page.locator('#diary-title-input').count()) === 0);
  check('visible not-saved label present', await page.locator('#draft-not-saved-label').isVisible());
  await page.click('#diary-save-page-btn'); await page.waitForTimeout(500);
  check('first save failure keeps draft (retry offered)', (await page.locator('#diary-save-retry-btn').count()) === 1 && (await page.locator('#diary-draft-preview').count()) === 1);
  await page.click('#diary-save-page-btn').catch(() => {}); await page.click('#diary-save-retry-btn').catch(() => {});
  await page.waitForTimeout(500);
  const qa = await page.evaluate(() => window.__qa);
  check('retry reuses SAME pageId, one page', Array.isArray(qa.saveCalls) && qa.saveCalls.length >= 2 && qa.saveCalls.every((x) => x === qa.saveCalls[0]), JSON.stringify(qa.saveCalls));
  check('confirmed after retry', qa.confirmed != null, qa.confirmed);
  await ctx.close();
});
await section(async () => {
  const ctx = await browser.newContext({ viewport: M });
  const page = await ctx.newPage();
  await page.goto(BASE + '/preview/skin-qa.html#modal', NAV); await page.waitForTimeout(300);
  check('conversation Close control stays visible on mobile', await page.locator('#entry-detail-close').isVisible());
  await page.click('#entry-detail-close'); await page.waitForTimeout(150);
  check('conversation closes from visible Close control', (await page.locator('#entry-detail-modal-container').count()) === 0);
  await page.goto(BASE + '/preview/skin-qa.html#modal', NAV); await page.waitForTimeout(200);
  await page.locator('#entry-detail-backdrop').click({ position: { x: 2, y: 2 } }); await page.waitForTimeout(150);
  check('conversation closes by tapping outside the note', (await page.locator('#entry-detail-modal-container').count()) === 0);
  await ctx.close();
});
await section(async () => {
  for (const [sel, key, want, field] of [
    ['#history-card-told-fx-2', 'told', 'fx-2', 'modalId'],
    ['#history-card-thought-fx-3', 'thought', 'fx-3', 'modalId'],
    ['#mem-resume-told-fx-active', 'resume', 'fx-active', 'resumeId'],
  ]) {
    const ctx = await browser.newContext({ viewport: D });
    const page = await ctx.newPage();
    await page.goto(BASE + '/preview/skin-qa.html#memory', NAV); await page.waitForTimeout(300);
    await page.click(sel); await page.waitForTimeout(300);
    const qa = await page.evaluate(() => window.__qa);
    check(`${key} click passes id ${want}`, qa[field] === want, `${field}=${qa[field]}`);
    await ctx.close();
  }
});
await section(async () => {
  const ctx = await browser.newContext({ viewport: D });
  const page = await ctx.newPage();
  await page.goto(BASE + '/preview/skin-qa.html#memory', NAV); await page.waitForTimeout(300);
  const told = () => page.locator('[id^="history-card-told-"]').count();
  const pages = () => page.locator('[id^="diary-page-"]').count();
  check('baseline 3 told / 2 pages', (await told()) === 3 && (await pages()) === 2, `${await told()}/${await pages()}`);
  await page.selectOption('#memory-mode-filter', 'summary'); await page.waitForTimeout(200);
  check('mode=summary -> 1 told, pages still 2', (await told()) === 1 && (await pages()) === 2, `${await told()}/${await pages()}`);
  await page.selectOption('#memory-mode-filter', 'all');
  await page.click('#history-toggle-favorites-btn'); await page.waitForTimeout(200);
  check('Starred -> 1 fav told, pages still 2 (not hidden)', (await told()) === 1 && (await pages()) === 2, `${await told()}/${await pages()}`);
  await page.click('#history-toggle-favorites-btn');
  await page.click('#mem-delete-told-fx-2'); await page.waitForSelector('#history-confirm-delete-btn');
  check('delete confirm says "Delete entire conversation?"', /Delete entire conversation\?/.test(await page.textContent('body')));
  await ctx.close();
});
async function grab(page, sel) { const [dl] = await Promise.all([page.waitForEvent('download'), page.click(sel)]); return { name: dl.suggestedFilename(), content: fs.readFileSync(await dl.path(), 'utf8') }; }
await section(async () => {
  const ctx = await browser.newContext({ viewport: D, acceptDownloads: true });
  const page = await ctx.newPage();
  await page.goto(BASE + '/preview/skin-qa.html#memory', NAV); await page.waitForTimeout(300);
  await page.click('#memory-export-toggle');
  const pj = await grab(page, '#history-export-pages-json-btn'); const pja = JSON.parse(pj.content);
  check('Pages JSON = diary pages collection', pj.name.includes('diary-pages') && Array.isArray(pja) && pja.length === 2 && pja.every((x) => x.kind === 'diaryPage'), pj.name);
  const cj = await grab(page, '#history-export-json-btn'); const cja = JSON.parse(cj.content);
  check('Conversations JSON = conversations collection w/ turns', cj.name.includes('conversations') && cja.length === 3 && !!cja[0].turns, cj.name);
  const md = await grab(page, '#history-export-md-btn');
  check('Conversations Markdown .md includes full turns', md.name.endsWith('.md') && /### Conversation/.test(md.content) && /\*\*Your familiar\*\*: The dread was louder than the day itself/.test(md.content), md.name);
  await ctx.close();
});
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ total: results.length, passed: results.length - failed.length, failed: failed.length, results }, null, 2));
process.exit(failed.length ? 1 : 0);
