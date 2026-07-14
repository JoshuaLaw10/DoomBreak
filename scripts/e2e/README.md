# Browser-automation tooling (Playwright)

One-time setup:

```bash
npm i -D playwright
npx playwright install chromium   # branded Chrome can't --load-extension anymore
```

| Command | What it does |
|---|---|
| `npm run e2e` | Loads the extension in Chromium, runs a real prompt on chatgpt.com, asserts overlay → badges → auto-close → streak → telemetry (8 checks). |
| `npm run shots` | Full clip E2E (12 checks incl. vibe filter + PiP) and regenerates the 1280×800 store screenshots in `store-assets/`. |
| `npm run promo` | Renders `store-assets/promo-tile-440x280.png` + `promo-marquee-1400x560.png`. |
| `npm run verify:claude` | Multi-LLM branch: opens claude.ai (log in when the window appears — waits 15 min), sends a prompt, captures `tests/fixtures/claude-*.html`, reports whether the adapter fired. |
| `npm run verify:gemini` | Same for gemini.google.com. |

Profiles persist in `.e2e-profiles/` (gitignored) — logins survive across runs.
Delete a profile dir to reset extension storage between runs.
