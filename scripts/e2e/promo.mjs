// Renders the Chrome Web Store promo images at exact pixel sizes:
//   store-assets/promo-tile-440x280.png   (small promo tile)
//   store-assets/promo-marquee-1400x560.png (marquee)
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const EXT = ROOT;
const OUT = join(EXT, 'store-assets');

const icon = 'data:image/png;base64,' + readFileSync(join(EXT, 'icons/icon-128.png')).toString('base64');
const hero = 'data:image/png;base64,' + readFileSync(join(OUT, '1-hero.png')).toString('base64');

const base = `
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:-apple-system,'SF Pro Display','Segoe UI',system-ui,sans-serif; overflow:hidden; }
  .bg {
    width:100%; height:100vh; position:relative; overflow:hidden;
    background:
      radial-gradient(120% 140% at 85% 15%, #312e81 0%, transparent 55%),
      radial-gradient(100% 120% at 10% 90%, #164e63 0%, transparent 50%),
      #0b1020;
    display:flex; align-items:center;
  }
  .glow { position:absolute; border-radius:50%; filter:blur(70px); opacity:.45; }
  .txt { position:relative; z-index:2; }
  h1 { color:#fff; font-weight:800; letter-spacing:-.02em; }
  p  { color:#a5b4fc; font-weight:500; }
  .badge {
    display:inline-flex; align-items:center; gap:7px;
    background:rgba(255,255,255,.1); border:1px solid rgba(255,255,255,.16);
    border-radius:999px; color:#e0e7ff; font-weight:700;
  }
  .dot { width:8px; height:8px; border-radius:50%; background:#4ade80; }
  img.icon { border-radius:24%; box-shadow:0 10px 36px rgba(0,0,0,.5); }
  .shot {
    border-radius:14px; box-shadow:0 24px 70px rgba(0,0,0,.6);
    border:1px solid rgba(255,255,255,.14);
  }
</style>`;

const tile = `${base}
<div class="bg" style="padding:0 30px;">
  <div class="glow" style="width:260px;height:260px;background:#6366f1;top:-80px;right:-60px;"></div>
  <div class="txt" style="display:flex;align-items:center;gap:22px;">
    <img class="icon" src="${icon}" width="92" height="92" />
    <div>
      <h1 style="font-size:34px;line-height:1.05;">Doomscroll<br/>Break</h1>
      <p style="font-size:14.5px;margin-top:8px;">Scroll while ChatGPT thinks.<br/>Closes when your answer is ready.</p>
    </div>
  </div>
</div>`;

const marquee = `${base}
<div class="bg" style="padding:0 70px; gap:60px;">
  <div class="glow" style="width:420px;height:420px;background:#6366f1;top:-140px;right:180px;"></div>
  <div class="txt" style="flex:1;">
    <img class="icon" src="${icon}" width="96" height="96" />
    <h1 style="font-size:54px;line-height:1.04;margin-top:26px;">Doomscroll intentionally<br/>while ChatGPT thinks.</h1>
    <p style="font-size:22px;margin-top:16px;">Auto-closes the moment your answer is ready.<br/>No discipline required.</p>
    <div style="margin-top:22px;display:flex;gap:10px;">
      <span class="badge" style="padding:8px 16px;font-size:14px;"><span class="dot"></span>Auto-close</span>
      <span class="badge" style="padding:8px 16px;font-size:14px;">😂🌊🏀🎯🐱🐶 Vibes</span>
      <span class="badge" style="padding:8px 16px;font-size:14px;">100% local</span>
    </div>
  </div>
  <div class="txt" style="flex:0 0 620px; transform:rotate(1.5deg);">
    <img class="shot" src="${hero}" width="620" />
  </div>
</div>`;

const browser = await chromium.launch();
for (const [name, html, w, h] of [
  ['promo-tile-440x280.png', tile, 440, 280],
  ['promo-marquee-1400x560.png', marquee, 1400, 560],
]) {
  const pg = await browser.newPage({ viewport: { width: w, height: h } });
  await pg.setContent(html, { waitUntil: 'networkidle' });
  await pg.screenshot({ path: join(OUT, name) });
  console.log('✓ ' + name);
  await pg.close();
}
await browser.close();
