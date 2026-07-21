// End-to-end test: load the real DoomBreak extension into Chromium, send a
// real prompt on chatgpt.com, verify overlay appears → badge transitions →
// auto-close fires when generation ends.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const EXT = ROOT;
const PROFILE = join(ROOT, '.e2e-profiles', 'e2e');
mkdirSync(PROFILE, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log((ok ? '  ✅ ' : '  ❌ ') + name + (detail ? ' — ' + detail : ''));
};

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  viewport: { width: 1280, height: 800 },
  args: [
    '--disable-extensions-except=' + EXT,
    '--load-extension=' + EXT,
    '--disable-blink-features=AutomationControlled',
  ],
});

try {
  // Confirm the MV3 service worker registered.
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 }).catch(() => null);
  check('service worker registered', !!sw, sw ? sw.url().slice(0, 60) : 'none');

  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });

  const composer = page.locator('#prompt-textarea:visible, #mobile-composer-prompt:visible, textarea[placeholder="Ask anything"]:visible, div[contenteditable="true"]:visible').first();
  await composer.waitFor({ state: 'visible', timeout: 45000 });
  await page.keyboard.press('Escape').catch(() => {});
  await composer.click();
  await page.keyboard.type('Write a 500 word essay about the history of lighthouses.', { delay: 10 });

  const t0 = Date.now();
  await page.keyboard.press('Enter');

  // 1. Overlay appears
  const overlay = page.locator('#doombreak-overlay');
  let appeared = true;
  try { await overlay.waitFor({ state: 'attached', timeout: 8000 }); }
  catch { appeared = false; }
  check('overlay appears after prompt', appeared, appeared ? (Date.now() - t0) + 'ms after Enter' : 'never appeared');

  if (appeared) {
    // 2. Badge shows Thinking or Typing (Thinking window can be brief)
    const badge = page.locator('#doombreak-badge-text');
    const early = (await badge.textContent().catch(() => '')) || '';
    check('badge visible with state text', early === 'Thinking' || early === 'Typing', 'showed "' + early + '"');

    // 3. Badge reaches Typing while streaming
    let reachedTyping = false;
    try {
      await page.waitForFunction(() => {
        const el = document.getElementById('doombreak-badge-text');
        return el && el.textContent === 'Typing';
      }, { timeout: 45000 });
      reachedTyping = true;
    } catch {}
    check('badge transitions to Typing', reachedTyping);

    // Screenshot the live overlay for the record
    await page.screenshot({ path: 'e2e-overlay.png' });

    // 4. Auto-close after generation completes
    let closed = true;
    try { await overlay.waitFor({ state: 'detached', timeout: 180000 }); }
    catch { closed = false; }
    check('overlay auto-closes when generation ends', closed);

    // 5. Streak + telemetry were recorded (read via SW context — the page's
    // main world has no chrome.storage).
    await page.waitForTimeout(1000);
    const stored = sw
      ? await sw.evaluate(() => new Promise(res => chrome.storage.local.get(null, res))).catch(() => null)
      : null;
    const streak = (stored && stored.autoCloseStreak) || {};
    const todayCount = Object.values(streak)[0] || 0;
    check('auto-close streak recorded in storage', todayCount > 0, JSON.stringify(streak));
    const telem = (stored && stored.selectorTelemetry) || {};
    check('selector telemetry flushed to storage', Object.keys(telem).length > 0, Object.keys(telem).join(', ') || 'empty');

    // 6. Toggle re-show via keyboard while idle should do nothing
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+D' : 'Control+Shift+D');
    await page.waitForTimeout(600);
    const overlayAfterToggle = await page.locator('#doombreak-overlay').count();
    check('toggle while idle does not show overlay', overlayAfterToggle === 0);
  }
} finally {
  await ctx.close();
}

const passed = results.filter(r => r.ok).length;
console.log('\nE2E: ' + passed + '/' + results.length + ' checks passed');
process.exit(passed === results.length ? 0 : 1);
