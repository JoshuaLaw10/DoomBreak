# 🧠 Doomscroll Break

> A Chrome extension built before AI providers added background-task notifications. The product premise has since been absorbed by the platforms — but the engineering is a useful case study in MV3 architecture, DOM adapter patterns, and in-production selector telemetry.

**[Demo video](#demo) · [Technical writeup](docs/WRITEUP.md) · [Original pitch](docs/ORIGINAL_PITCH.md)**

---

## Why this exists

When I built this, ChatGPT had no "notify me when done" feature. The wait — anywhere from 5 to 60 seconds — created a predictable bad habit: open a new tab, start doomscrolling, forget you had a question in progress.

The idea: give the wait a container. A full-screen short-clip overlay that opens the moment ChatGPT starts generating and closes automatically the moment it finishes. No discipline required. The extension does the closing.

Shortly after, Claude and ChatGPT both shipped native background-mode + push notification features. The product premise is now redundant. But the engineering problems it forced me to solve aren't — and that's what this writeup is about.

---

## What I'd build differently

**The overlay should be a PiP window, not full-screen.** A 320×480 floating panel in the corner lets you see ChatGPT's response start streaming underneath — the "auto-close" transition feels natural instead of jarring.

**Pre-bundled clips can't replicate algorithmic content's feel.** The dopamine mechanism of doomscrolling is infinite + algorithmic + personal. Eighty curated Pexels clips is a screensaver, not a doomscroll feed. A live Reddit/YouTube Shorts embed would have been the right call.

**Auto-close that interrupts is hostile.** Closing the overlay mid-scroll with no transition is the worst possible UX. Fade to minimized, then let the user dismiss — never yank away.

**Streak counters reward the wrong behavior.** "🔥 7 breaks today" means you got distracted seven times. A real behavior-change metric would be "time returned to context within N seconds." 

**Validate the mechanic before sourcing assets.** I spent engineering time on clip sourcing tooling before testing whether the overlay actually felt good to use. Inverted.

---

## The engineering worth keeping

### Platform adapter pattern

ChatGPT's DOM changes frequently and without notice. The naive approach — scattered `querySelector` calls across a content script — means a single DOM change breaks detection silently and you find out from users.

Every selector in Doombreak lives in one file: [`platforms/chatgpt.js`](platforms/chatgpt.js). The content script never touches raw CSS. When OpenAI ships a markup change, there's exactly one file to update, one diff to review.

```
content_script.js       ← state machine, overlay lifecycle, no selectors
platforms/chatgpt.js    ← all selectors, all DOM logic, nothing else
```

### Selector telemetry as a production canary

The harder problem: how do you know your selectors still work in production, on real users' ChatGPT sessions, without building a backend?

Every successful selector match records a timestamp in `chrome.storage.local`. The popup reads those timestamps and surfaces a health warning if no stop-button selector has matched in 3+ days:

```
stop:testid         ✓ 4h ago    ← primary, most specific
stop:aria-stop-gen  ✓ 4h ago    ← fallback #1
stop:composer-aria  — 7d ago    ← fallback #2, stale
```

No server. No crash reporting service. The canary fires automatically in production, on real sessions, with zero infrastructure.

### State machine with signature-based typing detection

The tricky detection problem: ChatGPT shows a stop button while it's "thinking" (computing, no text yet) and while it's "typing" (streaming text). Both states look the same from the stop-button perspective, but the overlay wants to show a different badge for each.

The naive fix — track text length — breaks immediately. Streaming responses don't always increase text length monotonically; they can replace, reformat, or reorder. The reliable signal is a `signature`:

```javascript
// Single DOM pass. Multiplying length × capped HTML gives a number that
// changes whenever content changes, regardless of whether length increased.
signature = (text.length * 1000) + Math.min(html.length, 200_000)
```

`signature === 0` → thinking. `signature > 0 && signature !== lastSignature` → typing started.

### Single-pass DOM reads via `getStateSnapshot()`

The heartbeat runs every 250ms while generating. The naive pattern calls four separate `querySelectorAll` operations per tick. `getStateSnapshot()` batches them into one DOM walk:

```javascript
ChatGPT.getStateSnapshot()
// → { generating, turnCount, signature, lastUserPrompt }
// One turn of the conversation tree. Not four.
```

### Testing browser-embedded scripts without Puppeteer

Content scripts run in the browser's page context — they set globals, they can't be `import`ed cleanly, and they depend on `chrome.*` APIs. The test pattern:

```javascript
// Each test re-executes the module by clearing vitest's registry.
// vi.resetModules() alone isn't enough — require.cache must also be cleared.
// This is the only way to get a fresh singleton per test.
vi.resetModules();
const mod = await import('../content_script.js?t=' + Date.now());
mod._resetForTest();
```

The `?t=` cache-buster forces vitest to treat each dynamic import as a new module, which re-runs all top-level initialization. Paired with `if (typeof module !== 'undefined') { module.exports = {...} }` at the bottom of the script, this gives full unit testability without spinning up a real browser.

**Result: 79 passing tests, 7 skipped** (fixture tests pending real DOM captures, see `tests/fixtures/CAPTURE.md`).

---

## Architecture

```
manifest.json           — Extension entrypoint (MV3)
content_script.js       — State machine + overlay lifecycle
service_worker.js       — Install init + message routing (no network calls)
popup.html / popup.js   — Control panel + selector health check

data/
  keywords.js           — Prompt keyword → tag mapping (prompt-aware mode)
  slogans.js            — Rotating overlay slogans (20)
  feed.js               — Clip manifest (auto-generated by scripts/generate-feed.mjs)

platforms/
  chatgpt.js            — All ChatGPT selectors, telemetry, state derivation

scripts/
  generate-feed.mjs     — Validates media/ + regenerates data/feed.js
  generate-icons.mjs    — SVG → 4× PNG rasterizer (requires sharp)

tests/
  doombreak.test.js     — Content script unit tests
  telemetry.test.js     — Platform adapter tests
  fixtures/             — ChatGPT DOM captures (see CAPTURE.md)

docs/
  SOURCING.md           — Clip curation guide
  WRITEUP.md            — Full technical writeup
  ORIGINAL_PITCH.md     — Original product pitch (historical)
  privacy.html          — Privacy policy (GitHub Pages)
```

### State machine

```
idle ──► thinking ──► typing ──► idle
         (stop btn,   (signature   (stop btn
         no text)     changes)     disappears
                                   → auto-close)
```

### Detection lifecycle

```
MutationObserver (edge-triggered, debounced 400ms)
        +
setInterval heartbeat (250ms, observer disconnects during tick)
        ↓
ChatGPT.getStateSnapshot()   ← single DOM pass
        ↓
_tick(snapshot)              ← state machine
```

---

## Running locally

```bash
npm install
npx vitest run          # 79 passing, 7 skipped
```

To load in Chrome:
1. `chrome://extensions` → enable Developer Mode
2. "Load unpacked" → select this repo root
3. Open chatgpt.com, send a prompt

---

## Privacy

Zero network requests. All data in `chrome.storage.local` only. See [`docs/privacy.html`](docs/privacy.html) / [`PRIVACY.md`](PRIVACY.md) for the full policy and storage key listing.

---

## Lessons

- Validate the mechanic with 5 users before sourcing assets
- Pre-bundled content can't replicate algorithmic content's feel
- Auto-close that interrupts is hostile, not magical
- Platforms eventually absorb point-solutions for platform problems  
- Great engineering doesn't fix a broken product premise — and that's fine; the engineering stands alone
