// Final E2E with clips + the 5 Chrome Web Store screenshots (1280×800).
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const EXT = ROOT;
const OUT = join(EXT, 'store-assets');
const PROFILE = join(ROOT, '.e2e-profiles', 'shots');
mkdirSync(OUT, { recursive: true });
mkdirSync(PROFILE, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log((ok ? '  ✅ ' : '  ❌ ') + name + (detail ? ' — ' + detail : ''));
};

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  viewport: { width: 1280, height: 800 },
  args: [
    '--disable-extensions-except=' + EXT,
    '--load-extension=' + EXT,
    '--disable-blink-features=AutomationControlled',
    '--autoplay-policy=no-user-gesture-required',
  ],
});

try {
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const extId = new URL(sw.url()).host;

  // Seed a streak of 4 so the footer shows real numbers in the shots.
  // onInstalled fills defaults asynchronously on this fresh profile — retry
  // until our seed survives its write.
  const today = new Date().toISOString().slice(0, 10);
  for (let i = 0; i < 10; i++) {
    await sw.evaluate(k => new Promise(res =>
      chrome.storage.local.set({ autoCloseStreak: { [k]: 4 } }, res)), today);
    await new Promise(r => setTimeout(r, 400));
    const v = await sw.evaluate(() => new Promise(res =>
      chrome.storage.local.get(['autoCloseStreak'], r => res(r.autoCloseStreak))));
    if (v && v[today] === 4) break;
  }

  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  const composer = page.locator('#prompt-textarea').first();
  await composer.waitFor({ state: 'visible', timeout: 45000 });
  await page.keyboard.press('Escape').catch(() => {});
  await composer.click();
  await page.keyboard.type('Write a 600 word essay about the history of mapmaking.', { delay: 10 });
  await page.keyboard.press('Enter');

  const overlay = page.locator('#doombreak-overlay');
  await overlay.waitFor({ state: 'attached', timeout: 8000 });

  // SHOT 2 — Thinking badge (immediately after show)
  await page.waitForTimeout(350); // let panels paint
  await page.screenshot({ path: join(OUT, '2-thinking.png') });

  // Streak footer (read early — fast generations can auto-close the overlay
  // before the later shots finish)
  const streakText = await page.locator('#doombreak-streak').textContent().catch(() => '');
  check('streak footer shows a count', /[0-9] breaks? today/.test(streakText || ''), '"' + streakText + '"');

  // Clips actually playing?
  await page.waitForTimeout(1200);
  const playing = await page.evaluate(() => {
    const vids = [...document.querySelectorAll('#doombreak-overlay video')];
    return {
      count: vids.length,
      playing: vids.filter(v => v.readyState >= 2 && !v.paused && v.currentTime > 0).length,
      muted: vids.every(v => v.muted),
    };
  });
  check('3 clip panels present', playing.count === 3, playing.count + ' videos');
  check('clips are playing', playing.playing === playing.count, playing.playing + '/' + playing.count);
  check('clips muted by default', playing.muted);

  // Sound toggle — audio comes from exactly one panel (the target)
  await page.click('#doombreak-sound');
  const unmutedCount = await page.evaluate(() =>
    [...document.querySelectorAll('#doombreak-overlay video')].filter(v => !v.muted).length);
  check('sound toggle unmutes exactly one panel', unmutedCount === 1, unmutedCount + ' unmuted');
  await page.click('#doombreak-sound'); // back to muted

  // Scroll-to-advance: real wheel gesture over the middle panel swaps the clip
  const beforeScroll = await page.evaluate(() =>
    document.querySelectorAll('#doombreak-overlay .db-panel')[1].querySelector('video').getAttribute('data-file'));
  const panelBox = await page.locator('#doombreak-overlay .db-panel').nth(1).boundingBox();
  await page.mouse.move(panelBox.x + panelBox.width / 2, panelBox.y + panelBox.height / 2);
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(600);
  const afterScroll = await page.evaluate(() =>
    document.querySelectorAll('#doombreak-overlay .db-panel')[1].querySelector('video').getAttribute('data-file'));
  check('wheel scroll advances the reel', afterScroll && afterScroll !== beforeScroll,
    beforeScroll + ' → ' + afterScroll);
  await page.mouse.wheel(0, -300); // scroll back
  await page.waitForTimeout(600);
  const backScroll = await page.evaluate(() =>
    document.querySelectorAll('#doombreak-overlay .db-panel')[1].querySelector('video').getAttribute('data-file'));
  check('wheel up scrolls back through history', backScroll === beforeScroll,
    'returned to ' + backScroll);

  // SHOT 3 — Typing badge
  await page.waitForFunction(() => {
    const el = document.getElementById('doombreak-badge-text');
    return el && el.textContent === 'Typing';
  }, { timeout: 45000 });
  await page.screenshot({ path: join(OUT, '3-typing.png') });

  // SHOT 1 — Hero (mid-generation, clips rolling)
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(OUT, '1-hero.png') });

  // SHOT 5 — Streak footer visible (best-effort: overlay may have closed)
  if (await overlay.count()) await page.screenshot({ path: join(OUT, '5-streak.png') });

  // Auto-close
  await overlay.waitFor({ state: 'detached', timeout: 180000 });
  const stored = await sw.evaluate(() => new Promise(res => chrome.storage.local.get(null, res)));
  check('streak incremented 4 → 5', stored.autoCloseStreak[today] === 5, JSON.stringify(stored.autoCloseStreak));

  // ── v1.1: PiP mode + cats-only vibe, verified live ──
  await sw.evaluate(() => new Promise(res =>
    chrome.storage.local.set({ overlayMode: 'pip', feedTags: ['cats'] }, res)));
  await page.waitForTimeout(600);
  await composer.click();
  await page.keyboard.type('Now write a 300 word essay about telescopes.', { delay: 10 });
  await page.keyboard.press('Enter');
  await overlay.waitFor({ state: 'attached', timeout: 10000 });
  await page.waitForTimeout(1500);
  const pip = await page.evaluate(() => {
    const el = document.getElementById('doombreak-overlay');
    const vids = [...el.querySelectorAll('video')];
    return {
      isPip: el.classList.contains('db-pip'),
      panels: el.querySelectorAll('.db-panel').length,
      srcs: vids.map(v => (v.src || '').split('/').pop()),
      playing: vids.filter(v => v.readyState >= 2 && !v.paused).length,
    };
  });
  check('pip overlay has db-pip class', pip.isPip);
  check('pip overlay renders 1 panel', pip.panels === 1, pip.panels + ' panel(s)');
  check('vibe filter serves cats clip', pip.srcs.every(f => f.startsWith('cats_')), pip.srcs.join(','));
  check('pip clip playing', pip.playing === 1);
  await page.screenshot({ path: join(OUT, '6-pip.png') });
  // Close via keyboard toggle mid-generation, then wait for generation to end.
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+D' : 'Control+Shift+D');
  await page.waitForTimeout(400);
  check('toggle hides pip overlay mid-generation',
    (await page.locator('#doombreak-overlay').count()) === 0);
  await page.waitForFunction(() => !document.querySelector('[data-testid="stop-button"]'), { timeout: 180000 });

  // SHOT 4 — Popup with healthy telemetry (extension page in a tab)
  const pop = await ctx.newPage();
  await pop.setViewportSize({ width: 1280, height: 800 });
  await pop.goto('chrome-extension://' + extId + '/popup.html');
  await pop.waitForTimeout(800);
  const summary = await pop.locator('#health-summary').textContent();
  check('popup health summary is healthy', /healthy/i.test(summary || ''), '"' + summary + '"');
  // Composite the popup at 2x onto a dark canvas for a clean 1280×800 shot.
  const buf = await pop.locator('body').screenshot({ scale: 'device' });
  const sharp = (await import(join(EXT, 'node_modules', 'sharp', 'lib', 'index.js'))).default;
  const popBuf = await sharp(buf).resize({ height: 720, fit: 'inside' }).toBuffer();
  const meta = await sharp(popBuf).metadata();
  await sharp({
    create: { width: 1280, height: 800, channels: 3, background: { r: 15, g: 23, b: 42 } },
  })
    .composite([{ input: popBuf, left: Math.round((1280 - meta.width) / 2), top: Math.max(0, Math.round((800 - meta.height) / 2)) }])
    .png()
    .toFile(join(OUT, '4-popup.png'));
} finally {
  await ctx.close();
}

const passed = results.filter(r => r.ok).length;
console.log('\nChecks: ' + passed + '/' + results.length + ' passed. Screenshots in store-assets/');
process.exit(passed === results.length ? 0 : 1);
