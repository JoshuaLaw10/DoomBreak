# Chrome Web Store Listing Copy

> Copy-paste these into the Chrome Web Store developer dashboard.  
> Category: **Productivity**

---

## Short description
*(≤ 132 characters — currently 126)*

```
Doomscroll intentionally while ChatGPT thinks. Auto-closes the moment your answer is ready. No discipline required.
```

---

## Detailed description
*(Plain text, ~1000 characters — currently ~970)*

```
Doomscroll Break solves a specific problem: when ChatGPT is generating, you instinctively open YouTube or TikTok — and don't come back.

Instead of fighting that habit, Doomscroll Break works with it.

HOW IT WORKS
Enable the extension, then send any prompt on chatgpt.com. Doomscroll Break instantly opens a full-screen short-clip overlay. Watch, scroll, relax. The moment ChatGPT finishes generating your response, the overlay closes automatically — no tap required.

FEATURES
• Auto-closes the instant ChatGPT is done — you never miss your answer
• Live status badge shows Thinking → Typing as the response develops
• Scroll the reels — wheel or swipe snaps to the next clip, scroll up to go back
• Vibe picker: choose what plays — 😂 Funny, 🌊 Calm, 🏀 Sport, 🎯 Focus, 🐱 Cats, 🐶 Dogs
• Mini Player mode: a small corner overlay instead of full-screen
• Prompt-Aware Mode (on by default): ask about sports, get sports clips; ask for something calm, get calm clips
• Daily streak counter tracks how many times it pulled you back today
• Sound toggle and keyboard shortcut (Cmd/Ctrl+Shift+D)
• Popup health check warns you if ChatGPT's DOM has changed and detection might be affected

PRIVACY
100% local. No data leaves your device. No analytics. No servers. All clips are bundled with the extension — no network requests are ever made.

Works on chatgpt.com and gemini.google.com.
```

---

## Permission justifications
*(For the "Permissions" section of the submission form)*

### `storage`
> Doomscroll Break uses `chrome.storage.local` to persist user preferences (on/off, mute, prompt-aware mode), a daily auto-close streak counter, and per-selector match telemetry that powers the popup health check. No data is transmitted externally.

### Host access: `https://chatgpt.com/*` and `https://gemini.google.com/*` (content script match patterns)
> A content script runs on chatgpt.com and gemini.google.com to observe the DOM via MutationObserver and detect when the AI begins and finishes generating a response. This is the core function of the extension and requires direct page access. No page content is read, stored, or transmitted.

---

## Store metadata

| Field | Value |
|---|---|
| Category | Productivity |
| Language | English |
| Regions | All regions |
| Pricing | Free |
| Mature content | No |
| Single purpose | Detects ChatGPT generation state and shows a self-closing video overlay |

---

## Reviewer notes
*(Include in the "Notes for reviewer" field)*

```
This extension:
- Runs a content script on chatgpt.com only
- Uses MutationObserver to detect when ChatGPT's stop button appears/disappears
- Shows a full-screen overlay of local MP4 video clips while generation is active
- Closes the overlay automatically when generation ends
- Makes zero network requests; all clips are local assets
- Uses chrome.storage.local for preferences only — no external data transmission

To test: enable the extension, open chatgpt.com, send any prompt. The overlay
should appear within ~250ms of generation starting and close within ~850ms of
the stop button disappearing.
```

---

## Screenshot shot list
*(1280×800 each — take after clips are sourced and extension is installed)*

| # | What to show | Notes |
|---|---|---|
| 1 | **Hero** — 3-panel overlay active on ChatGPT | Send a long prompt, capture mid-generation |
| 2 | **Thinking badge** — overlay with "Thinking" badge visible | Capture in the first second before text appears |
| 3 | **Typing badge** — overlay with "Typing" badge + green dot | Capture once text starts streaming |
| 4 | **Popup** — control panel with Prompt-Aware toggle and health check | Open popup with a healthy selector state |
| 5 | **Streak** — overlay footer showing "🔥 5 breaks today" | Use after several auto-closes in one session |
