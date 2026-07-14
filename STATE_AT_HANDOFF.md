# State at Handoff — Doomscroll Break

> **Read this first in every new session.**  
> It is the authoritative source of what's done, what's next, and where skeletons are buried.

---

## What this is

A Chrome extension (MV3) that shows a self-closing video overlay on chatgpt.com while ChatGPT is generating. The overlay closes automatically when the answer is ready. Targets Chrome Web Store submission.

**Repo:** https://github.com/JoshuaLaw10/DoomBreak  
**Privacy policy (live after GitHub Pages setup):** https://joshuaLaw10.github.io/DoomBreak/privacy.html

---

## Current state (as of 2026-07-13)

### ✅ Done

| Area | Status |
|---|---|
| Architecture refactor | Complete — platform adapter, data/code separation, state machine |
| `platforms/chatgpt.js` | Complete — all selectors, telemetry, getStateSnapshot() |
| `content_script.js` | Complete — edge-triggered observer + heartbeat, no raw selectors |
| `service_worker.js` | Complete — dropped oEmbed, clean install init |
| `popup.html / popup.js` | Complete — selector health check section added |
| `data/keywords.js` | Complete — 4-tag keyword mapping |
| `data/slogans.js` | Complete — 20 slogans |
| `data/feed.js` | Placeholder — regenerate after sourcing clips |
| `scripts/generate-feed.mjs` | Complete — validates media/ + regenerates data/feed.js |
| `scripts/generate-icons.mjs` | Complete — rasterises SVG → 4 PNG sizes |
| `icons/icon.svg` | Complete — brain + play button design |
| `icons/icon-{16,32,48,128}.png` | ✅ Generated and committed |
| `manifest.json` | Complete — v1.0.0, MV3, correct permissions |
| Test suite | **92 passing, 0 skipped** — baseline locked; includes 7 real-DOM fixture tests |
| `scripts/source-clips.mjs` | Complete — Pexels API downloader (needs free `PEXELS_API_KEY`), compresses via ffmpeg, writes metadata.json |
| `scripts/package.mjs` | Complete — validates + builds `dist/doombreak-vX.Y.Z.zip` for store upload (`npm run package`) |
| GitHub Pages | ✅ Enabled 2026-07-13 — privacy policy at https://joshualaw10.github.io/DoomBreak/privacy.html |
| Keyboard command | ✅ Wired 2026-07-13 — `chrome.commands.onCommand` → message → content script (was declared but dead) |
| Permissions | ✅ Trimmed 2026-07-13 — unused `tabs` + redundant `host_permissions` removed from manifest, listing, privacy docs |
| Feed schema bug | ✅ Fixed 2026-07-13 — generate-feed.mjs emitted legacy `src`/`platform` keys; overlay reads `file`. Verified end-to-end with synthetic clips |
| `PRIVACY.md` | Complete — plain text version |
| `docs/privacy.html` | Complete — GitHub Pages version (needs Pages enabled in repo settings) |
| `STORE_LISTING.md` | Complete — short desc, long desc, permission justifications, screenshot shot list |
| `STATE_AT_HANDOFF.md` | This file |
| GitHub Actions CI | `.github/workflows/test.yml` — runs tests on every push |
| `.gitignore` | `node_modules/`, `metadata.json`, `.DS_Store` |

---

## 🔴 Blocked on human action

**Only step 6/7 remain: create the $5 dev account and submit.** Upload `dist/doombreak-v1.1.0.zip` (rebuild anytime with `npm run package`), paste copy from `STORE_LISTING.md`, pick 5 of the 6 screenshots in `store-assets/`, privacy URL: https://joshualaw10.github.io/DoomBreak/privacy.html

**v1.2.0 (2026-07-14): GEMINI SUPPORT VERIFIED LIVE.** Platform registry (window.Platform) + gemini.google.com adapter — overlay appeared/auto-closed on real Gemini (logged-out chat works, fully reproducible via `npm run verify:gemini`); fixtures in tests/fixtures/gemini-*.html, 8 fixture tests. claude.ai adapter remains an UNVERIFIED draft (user skipped login verification): file kept in platforms/claude.js, but claude.ai is NOT in the manifest — re-add only after `npm run verify:claude` passes. Store zip: dist/doombreak-v1.2.0.zip. Submission copy in STORE_LISTING.md covers both hosts.

**v1.1.0 (2026-07-14):** vibe picker (😂🌊🏀🎯🐱🐶 chips in popup → `feedTags`), Mini Player / PiP mode (`overlayMode: 'pip'`, corner 300×480, 1 panel), 24 new cats/dogs clips (104 total, 44.6MB), prompt-aware respects vibe selection. 102 tests; live E2E 12/12 including vibe-filtered PiP on chatgpt.com. Multi-LLM adapter work lives on branch `experimental/multi-llm` — do NOT merge until selectors are verified against logged-in Claude/Gemini sessions.

These **cannot be done by code alone** — they require a browser or physical action:

### 1. ~~Enable GitHub Pages~~ ✅ Done 2026-07-13 via `gh api`
Privacy policy live at `https://joshualaw10.github.io/DoomBreak/privacy.html`.

### 2. ~~Capture real ChatGPT DOM fixtures~~ ✅ Done 2026-07-13
Captured from live chatgpt.com via Playwright (logged-out chat flow). All 7 fixture
tests active and passing. They caught real drift: conversation turns are now
`<section data-testid="conversation-turn-N">` (was `<article>`) — fixed in
`platforms/chatgpt.js`. Real-DOM note: during earliest "thinking", the stop button
exists but NO turns are rendered yet (signature=0 is what distinguishes thinking).

### 3. ~~Source clips~~ ✅ Done 2026-07-14
80 Pexels clips committed in media/ (16 per tag, 33.8MB, each <700KB), feed
regenerated, attribution in data/feed.js. Key saved as PEXELS_API_KEY in
~/.zshrc for future re-sourcing. Pexels only — YouTube/TikTok/Instagram =
instant rejection.

### 4. ~~Take 5 screenshots~~ ✅ Done 2026-07-14
Auto-captured from the live extension at 1280×800 → `store-assets/`
(hero, thinking, typing, popup health, streak). Final clip E2E: 7/7 —
panels playing, muted by default, sound toggle, streak, popup health green.

### 5. End-to-end test — ✅ automated 2026-07-13 (8/8 checks)
Playwright drove the real extension in Chromium against live chatgpt.com:
- [x] Overlay appears within ~250ms (measured 194ms)
- [x] Badge shows "Thinking" then "Typing"
- [x] Overlay auto-closes when generation ends
- [x] Streak counter increments (verified in storage)
- [x] Selector telemetry flushes (stop:testid matching live)
- [x] Toggle while idle is a no-op
Still needs a quick human pass once clips exist: clip playback + sound toggle + popup health UI.
Also fixed during E2E: onInstalled was wiping storage on reinstall (now fills missing keys only).

---

## What's next (in order)

```
Priority 1: Enable GitHub Pages (5 min, unblocks submission form)
Priority 2: Capture DOM fixtures → activate 7 skipped tests → fix selectors if needed
Priority 3: Source clips → npm run feed
Priority 4: Manual E2E test
Priority 5: Screenshots
Priority 6: Fill Chrome Web Store form using STORE_LISTING.md
Priority 7: Submit
```

---

## Architecture decisions that must not be undone

1. **All CSS selectors live in `platforms/chatgpt.js` only.** `content_script.js` never queries the DOM directly. If ChatGPT's markup changes, only `platforms/chatgpt.js` needs updating.

2. **`vi.resetModules()` + module cache clearing is load-bearing in the test suite.** Do not refactor the test import pattern without understanding why it exists — each test needs a fresh module singleton.

3. **No oEmbed, no network requests.** The old `service_worker.js` fetched YouTube metadata. That's gone. All clips are local MP4s.

4. **Feature freeze at v1.0.** Don't add features before the Chrome Web Store submission. Multi-LLM, Pexels API, custom feeds — all post-launch.

5. **Legal clip sourcing is non-negotiable.** Pexels/Pixabay/Mixkit only. Anything else = rejection.

---

## Known sharp dependency note

`sharp` is a dev dependency used only for `npm run icons`. It is not bundled with the extension. The generated PNGs are committed directly. Don't run `npm run icons` unless you're updating the icon design — the PNGs are already correct.

---

## Test baseline

```
Test Files  2 passed (2)
     Tests  92 passed (92)
```

**Never let the passing count drop below 92.** Every new behaviour gets new tests.
