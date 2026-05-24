# 🧠 Doomscroll Break

> **Doomscroll responsibly. Automatically.**

Doombreak is a Chrome extension that gives you an intentional doomscroll break **only while ChatGPT is generating a response**, then **automatically closes itself the moment the answer is ready**.

No discipline required.

---

## ✨ What it does

- Detects when ChatGPT starts generating
- Opens a **full-screen, 3-panel short-clip overlay**
- Shows a live status badge: **Thinking → Typing**
- **Auto-closes** the moment ChatGPT finishes responding
- Tracks your **daily auto-close streak** (how many times it saved you today)
- **Prompt-Aware Mode** — reels match the vibe of what you asked
- Sound toggle, keyboard shortcut (`Cmd/Ctrl+Shift+D`)

---

## 🎬 How it works

1. Enable the extension via the popup
2. Send a prompt on [chatgpt.com](https://chatgpt.com)
3. Doombreak opens instantly — scroll while you wait
4. ChatGPT finishes → Doombreak closes → you're back in the conversation

---

## 🛠 Architecture

```
manifest.json           — Extension entrypoint (MV3)
content_script.js       — State machine + overlay lifecycle
service_worker.js       — Install init + message routing
popup.html / popup.js   — Control panel + selector health check

data/
  keywords.js           — Prompt keyword → tag mapping
  slogans.js            — Rotating overlay slogans
  feed.js               — Clip manifest (auto-generated)

platforms/
  chatgpt.js            — ChatGPT DOM adapter (all selectors here)

scripts/
  generate-feed.mjs     — Validates media/ + regenerates data/feed.js

tests/
  doombreak.test.js     — Content script unit tests (65+ passing, 7 skipped)
  telemetry.test.js     — Platform adapter tests (25+ passing)
  fixtures/             — Real ChatGPT HTML captures (see CAPTURE.md)

docs/
  SOURCING.md           — Clip curation guide (Pexels/Pixabay/Mixkit only)

media/                  — Local MP4 clips (not committed, see SOURCING.md)
icons/                  — Extension icons (16/32/48/128 PNG)
```

### Platform adapter pattern

All ChatGPT DOM selectors are consolidated in `platforms/chatgpt.js`. When OpenAI changes their markup, **that is the only file that needs updating**. The content script never touches raw CSS selectors.

### Detection model

```
idle → thinking  (stop button appears, no assistant text yet)
thinking → typing (assistant signature changes — text started streaming)
typing → idle    (stop button disappears — generation complete → auto-close)
```

`ChatGPT.getStateSnapshot()` performs a single DOM pass per tick (250 ms heartbeat + edge-triggered MutationObserver).

### Selector telemetry

Every successful selector match is recorded in `chrome.storage.local`. The popup **health check** section surfaces a warning if no stop-button selector has matched in the past 3 days — a canary for ChatGPT DOM changes that fires automatically in production.

---

## 🧪 Tests

```bash
npm install
npx vitest run
```

Expected: **78+ passing, 7 skipped** (fixture tests pending real ChatGPT DOM captures).

The 7 skipped tests activate once you follow `tests/fixtures/CAPTURE.md` to replace the placeholder HTML files with real page captures.

---

## 🎥 Sourcing clips

See `docs/SOURCING.md`. Use **Pexels, Pixabay, or Mixkit only** — YouTube/TikTok/Instagram rips violate ToS and will get the extension rejected from the Chrome Web Store.

After sourcing:
```bash
node scripts/generate-feed.mjs
```

This validates every file in `media/` against `metadata.json` and regenerates `data/feed.js`.

---

## 🔒 Privacy

Doombreak uses **only `chrome.storage.local`**. No data leaves your device. No analytics, no third-party services, no backend. See `PRIVACY.md` for the full policy.

Storage keys used:
- `enabled` — master on/off
- `soundOn` — mute preference
- `promptMode` — prompt-aware mode toggle
- `sloganIndex` — slogan rotation position
- `autoCloseStreak` — daily auto-close counts (kept for 7 days)
- `selectorTelemetry` — per-selector match timestamps (local health check only)

---

## 📋 Pre-submission checklist

- [ ] All 85 tests passing (78 + 7 fixture tests after captures)
- [ ] `icons/` populated (16, 32, 48, 128 PNG)
- [ ] `media/` populated with ≥ 20 sourced clips
- [ ] `metadata.json` has no `TODO` placeholders
- [ ] `data/feed.js` regenerated via `generate-feed.mjs`
- [ ] `PRIVACY.md` written and hosted at a public URL
- [ ] Manual test on a real ChatGPT session (send prompt, watch overlay, verify auto-close)
- [ ] Bundle size < 50 MB
- [ ] `manifest.json` version is `1.0.0`

---

## 🔮 Post-launch roadmap

- Multi-LLM support (Gemini, Claude, Cursor)
- Custom clip feeds
- Session-level stats
- Optional hard mode (no scrolling, just vibes)

---

## 📚 What I learned

Attention is about **defaults**, not discipline. A small intervention at exactly the right moment changes behaviour more than any amount of willpower.
