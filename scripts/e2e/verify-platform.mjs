// Interactive verification for the multi-LLM adapters.
// Usage: node verify-platform.mjs claude | gemini
//
// Opens a persistent Chromium with the extension loaded. If the site needs
// login, the human logs in in the opened window (state persists in the
// profile for later runs). Then: sends a prompt, captures thinking/typing/
// idle DOM fixtures (selector-agnostic heuristics), and reports whether the
// extension overlay appeared + auto-closed.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const SITE = process.argv[2];
const CONF = {
  claude: {
    url: 'https://claude.ai/new',
    composer: 'div[contenteditable="true"].ProseMirror, div[aria-label*="Claude"][contenteditable="true"], [data-testid="chat-input"] [contenteditable="true"], fieldset [contenteditable="true"]',
    fixturePrefix: 'claude',
  },
  gemini: {
    url: 'https://gemini.google.com/app',
    composer: 'rich-textarea .ql-editor, div[contenteditable="true"][aria-label], .ql-editor[contenteditable="true"]',
    fixturePrefix: 'gemini',
  },
}[SITE];
if (!CONF) { console.error('usage: node verify-platform.mjs claude|gemini'); process.exit(2); }

const EXT = ROOT;
const FIXTURES = join(EXT, 'tests', 'fixtures');
const PROFILE = join(ROOT, '.e2e-profiles', 'multi');
mkdirSync(PROFILE, { recursive: true });

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  viewport: { width: 1280, height: 800 },
  args: [
    '--disable-extensions-except=' + EXT,
    '--load-extension=' + EXT,
    '--disable-blink-features=AutomationControlled',
  ],
});
let page = ctx.pages()[0] || await ctx.newPage();
const log = m => console.log('[' + SITE + '] ' + m);

// Survive tab churn during login: always work against a live tab on the
// target origin, reopening one if everything got closed.
async function ensurePage() {
  const alive = ctx.pages().filter(p => !p.isClosed());
  const onSite = alive.find(p => p.url().includes(SITE === 'claude' ? 'claude.ai' : 'gemini.google.com'));
  if (onSite) { page = onSite; return; }
  page = alive[0] || await ctx.newPage();
  if (!page.url().includes(SITE === 'claude' ? 'claude.ai' : 'gemini.google.com')) {
    await page.goto(CONF.url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  }
}

async function bodyTextLen() {
  return page.evaluate(() => (document.body.innerText || '').length);
}
async function saveFixture(name) {
  const html = await page.evaluate(() => {
    // Prefer the container that actually holds the conversation; claude.ai
    // keeps a small marketing <main> around, so fall back to body when main
    // looks tiny.
    const main = document.querySelector('main');
    const el = (main && main.innerHTML.length > 20000) ? main : document.body;
    return el.outerHTML;
  });
  writeFileSync(join(FIXTURES, name), html);
  log('saved ' + name + ' (' + Math.round(html.length / 1024) + 'KB) from ' + page.url());
  await page.screenshot({ path: name.replace('.html', '.png') }).catch(() => {});
}

try {
  log('opening ' + CONF.url + ' …');
  await page.goto(CONF.url, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Wait for the composer — human may need to log in first. Poll across
  // tabs so login redirects/closures don't kill the run.
  log('waiting for composer (LOG IN IN THE OPEN WINDOW if prompted — up to 7 min) …');
  const deadline = Date.now() + 900000; // 15 min — no rush
  let composer = null;
  let lastShot = 0;
  await page.bringToFront().catch(() => {});
  while (Date.now() < deadline && !composer) {
    await ensurePage();
    const c = page.locator(CONF.composer).first();
    if (await c.isVisible().catch(() => false)) { composer = c; break; }
    if (Date.now() - lastShot > 30000) {
      lastShot = Date.now();
      await page.screenshot({ path: SITE + '-wait-status.png' }).catch(() => {});
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  if (!composer) throw new Error('composer never appeared — not logged in?');
  log('composer visible on: ' + page.url());
  log('all tabs: ' + ctx.pages().map(p => p.url()).join(' | '));
  // Close every other tab so capture/typing can't diverge.
  for (const p of ctx.pages()) { if (p !== page && !p.isClosed()) await p.close().catch(() => {}); }
  await page.waitForTimeout(1500);

  const baseline = await bodyTextLen();
  // Claude re-renders its composer and may show onboarding modals; dismiss,
  // then re-resolve a fresh visible editor at click time.
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(800);
  const editor = page.locator('div[contenteditable="true"]').locator('visible=true').first();
  await editor.click({ timeout: 15000 }).catch(async () => {
    await page.evaluate(() => {
      const els = [...document.querySelectorAll('div[contenteditable="true"]')];
      const vis = els.find(e => e.offsetWidth > 0 && e.offsetHeight > 0);
      if (vis) vis.focus();
    });
  });
  await page.keyboard.type('Write a 500 word essay about the history of the compass.', { delay: 12 });
  await page.keyboard.press('Enter');
  log('prompt sent.');

  // THINKING: capture shortly after send, before meaningful text lands.
  await page.waitForTimeout(700);
  await saveFixture(CONF.fixturePrefix + '-thinking.html');

  // Did the overlay appear? (only works if the adapter's selectors are right)
  const overlayAppeared = await page.waitForSelector('#doombreak-overlay', { timeout: 6000 })
    .then(() => true).catch(() => false);
  log('overlay appeared: ' + overlayAppeared);

  // TYPING: body text grew well past baseline.
  await page.waitForFunction(b => (document.body.innerText || '').length > b + 250,
    baseline, { timeout: 90000 });
  await saveFixture(CONF.fixturePrefix + '-typing.html');
  if (overlayAppeared) await page.screenshot({ path: SITE + '-overlay.png' });

  // IDLE: text length stable for 4s.
  let last = await bodyTextLen();
  for (let stable = 0; stable < 4; ) {
    await page.waitForTimeout(1000);
    const now = await bodyTextLen();
    if (now === last) stable++; else { stable = 0; last = now; }
  }
  await page.waitForTimeout(1000);
  await saveFixture(CONF.fixturePrefix + '-idle.html');

  const overlayGone = (await page.locator('#doombreak-overlay').count()) === 0;
  log('overlay auto-closed: ' + overlayGone);
  log(overlayAppeared && overlayGone
    ? 'RESULT: adapter WORKS live'
    : 'RESULT: adapter needs selector fixes — inspect the fixtures');
} finally {
  await ctx.close();
}
