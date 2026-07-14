# Privacy Policy — Doomscroll Break

**Last updated: 2026-05-24**

## Summary

Doomscroll Break stores a small amount of data **locally on your device only**. No data is ever transmitted to any server. No analytics. No tracking. No third-party services.

---

## What data is stored

All data is stored exclusively in `chrome.storage.local` — a sandboxed, device-local key-value store provided by Chrome. It is never synced, shared, or transmitted.

| Storage key | What it holds | Why |
|---|---|---|
| `enabled` | Boolean — whether the extension is on | Persists your on/off preference across sessions |
| `soundOn` | Boolean — whether video sound is on | Persists your mute preference |
| `promptMode` | Boolean — whether prompt-aware mode is on | Persists your content preference |
| `sloganIndex` | Integer — current position in slogan rotation | Keeps slogans from repeating after restart |
| `autoCloseStreak` | Object — count of auto-closes per calendar day (kept for 7 days) | Powers the daily streak counter shown in the overlay |
| `selectorTelemetry` | Object — per-CSS-selector match timestamps and counts | Powers the popup health check that warns if ChatGPT's DOM has changed. Never leaves your device. |

---

## What data is NOT collected

- No personal information
- No browsing history
- No prompt or conversation content
- No usage analytics
- No crash reports
- No identifiers of any kind

---

## Network access

Doomscroll Break makes **zero network requests**. All video clips are bundled with the extension as local MP4 files. The extension communicates only with `chatgpt.com` pages via a content script (to detect generation state) — it does not send any data to or from those pages.

---

## Permissions used

| Permission | Why it's needed |
|---|---|
| `storage` | To read and write the preference/telemetry keys listed above |
| Content script on `chatgpt.com` / `gemini.google.com` | The content script must run on chatgpt.com to observe the DOM and detect generation state |

---

## Data retention

- `autoCloseStreak` entries older than 7 days are automatically pruned on each update.
- `selectorTelemetry` is capped at 32 entries.
- All data can be cleared at any time via Chrome → Settings → Privacy → Clear browsing data → Site data, or by uninstalling the extension.

---

## Contact

If you have questions about this policy, open an issue at:  
**https://github.com/JoshuaLaw10/DoomBreak/issues**
