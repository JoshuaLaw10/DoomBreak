# Building a Chrome extension that doesn't break when ChatGPT changes its DOM

*Or: what I learned shipping a product whose premise died before launch.*

---

I built Doomscroll Break to solve a specific problem: when ChatGPT is generating a response, I'd open a new tab and start doomscrolling — and not come back. The extension showed a self-closing video overlay during generation and closed itself automatically when the answer arrived.

Shortly after I finished the architecture, Claude and ChatGPT both shipped native background-mode with push notifications. Product dead. But the engineering problems the project forced me to solve are worth writing about. Here's the three that actually mattered.

---

## Problem 1: ChatGPT's DOM changes constantly and silently

ChatGPT ships DOM updates several times a month. Most Chrome extensions that scrape it use scattered `querySelector` calls throughout their code. When OpenAI changes a selector, the extension breaks — but it breaks *silently*. The user sees nothing happen. They assume their prompt finished. They miss their answer.

The standard fix is to monitor the extension for complaints. That's reactive and slow.

**What I did instead: platform adapter pattern.**

Every selector in the extension lives in exactly one file: [`platforms/chatgpt.js`](../platforms/chatgpt.js). The content script never calls `document.querySelector` directly. It only calls methods:

```javascript
// content_script.js — no selectors, ever
const snap = ChatGPT.getStateSnapshot();
// → { generating, turnCount, signature, lastUserPrompt }
```

```javascript
// platforms/chatgpt.js — all selectors, nothing else
var _STOP_SELECTORS = [
  { key: 'stop:testid',        sel: '[data-testid="stop-button"]' },
  { key: 'stop:button-testid', sel: 'button[data-testid="stop-button"]' },
  { key: 'stop:aria-stop-gen', sel: 'button[aria-label="Stop generating"]' },
  { key: 'stop:aria-stop-str', sel: 'button[aria-label="Stop streaming"]' },
];
```

When OpenAI changes their markup, there is exactly one file to update, one diff to review, one place to look. The content script doesn't care what changed.

The selectors themselves are listed from most-specific (data-testid attributes, stable across redesigns) to least-specific (aria-label text, can change with copy updates). The first one that matches wins. This gives four layers of fallback before detection fails completely.

**Why this matters beyond this project:** any extension that scrapes a site you don't control should isolate its selectors this way. DOM changes are inevitable. The question is how much of your codebase they touch when they happen.

---

## Problem 2: How do you know your selectors still work in production?

Tests can tell you selectors work against captured HTML. They can't tell you whether today's live ChatGPT page still matches the HTML you captured three months ago.

The conventional answer is: set up monitoring, watch for error reports, check periodically. All of those require infrastructure or human attention.

**What I did instead: selector telemetry as a passive canary.**

Every time a selector successfully matches in a real user session, it records a timestamp:

```javascript
function _recordMatch(selectorKey) {
  var now   = Date.now();
  var entry = _telemetry.selectors[selectorKey] || { lastMatch: 0, count: 0 };
  entry.lastMatch = now;
  entry.count++;
  _telemetry.dirty = true;
  _maybeFlush(); // writes to chrome.storage.local at most once per 60s
}
```

The popup reads that data and shows a health view:

```
stop:testid         ✓ matched 2h ago     ← healthy
stop:aria-stop-gen  ✓ matched 2h ago     ← healthy  
stop:composer-aria  ⚠ last matched 4d ago ← stale, needs attention
```

If no stop-button selector has matched in 3+ days, the popup shows a warning in red. The user sees it before they assume the extension is broken and uninstall it. The developer sees it before they get flooded with "it stopped working" issues.

**The clever part:** this canary fires automatically in production, on real ChatGPT sessions, with zero backend infrastructure. The data never leaves the user's device. It costs nothing to run. And it gives you a leading indicator — you find out about DOM changes when selectors stop matching, not after users notice the extension doesn't work.

One implementation detail worth noting: telemetry is hydrated from storage on module load, but matches can be recorded before the async hydration completes. The merge logic takes the max of stored and live values for each key, so no data is lost in the race:

```javascript
chrome.storage.local.get([_STORAGE_KEY], function(result) {
  var saved = result[_STORAGE_KEY] || {};
  for (var key in saved) {
    var stored = saved[key];
    var live   = _telemetry.selectors[key];
    if (!live) {
      _telemetry.selectors[key] = stored;
    } else {
      // Take the max — never lose a match from either side of the race
      _telemetry.selectors[key] = {
        count:     Math.max(stored.count,     live.count),
        lastMatch: Math.max(stored.lastMatch, live.lastMatch),
      };
    }
  }
});
```

---

## Problem 3: Testing a browser-embedded script without spinning up a browser

Content scripts are awkward to test. They:

- Run in the browser page context, not a Node.js module context
- Set globals (`window.ChatGPT`, etc.) rather than exporting
- Depend on `chrome.*` APIs that don't exist in Node
- Maintain singleton state that bleeds between tests if you're not careful

The standard solution is end-to-end tests with Puppeteer or Playwright. Those are slow (10-30 seconds per test), require a real browser, and are brittle against UI changes. For unit-testing state machine logic — "when generating stops, does the overlay close?" — they're overkill.

**What I did instead: a cheap module isolation pattern.**

At the bottom of each script, guarded by a CommonJS check:

```javascript
// platforms/chatgpt.js
if (typeof module !== 'undefined') {
  module.exports = {
    ChatGPT,
    _resetTelemetry,
    _forceFlush,
    _getTelemetryBuffer,
  };
}
```

This block never executes in the browser (where `module` is undefined). In Node.js / vitest, it exports everything needed for testing. One file, two contexts, zero bundler config.

The harder problem is singleton isolation. If `content_script.js` has module-level variables (`var _state = 'idle'`), they persist across tests unless the module is re-executed from scratch. `vi.resetModules()` clears vitest's registry, but a cache-busted dynamic import is the reliable way to force re-execution:

```javascript
beforeEach(async () => {
  vi.resetModules();

  // Set up globals BEFORE the import so module top-level code sees them
  global.chrome  = makeChromeStub();
  global.ChatGPT = makeChatGPTStub();
  global.FEED    = [...];

  // ?t= cache-buster forces vitest to treat this as a new module
  // and re-run all top-level initialization
  const mod = await import('../content_script.js?t=' + Date.now());
  mod._resetForTest(); // belt-and-suspenders state reset
});
```

The result: 79 tests that run in under 800ms, test the full state machine, mock `chrome.storage.local` responses, and never touch a real browser. The 7 tests that actually need real ChatGPT HTML are `describe.skip`'d with instructions for capturing fresh fixtures when needed.

---

## What the product taught me

**The mechanic didn't match the promise.** Doomscrolling is compelling because it's infinite, algorithmic, and personal. Eighty curated Pexels clips is a screensaver — the dopamine loop doesn't activate. I should have validated that the overlay actually felt like doomscrolling before spending days on sourcing tooling.

**Validate before you build.** I wrote a `generate-feed.mjs` validator and a `generate-icons.mjs` rasterizer and a full telemetry system before testing with a single real user. All of that was quality engineering. None of it validated the core mechanic.

**Platforms absorb point solutions.** This is the textbook risk for any extension that fills a gap in someone else's product. The gap closes — either they fix it or competitors do. Building *on* the platform is safer than building *around* the platform.

**Knowing when to stop is a skill.** The engineering here is solid. The product is redundant. Treating them as separable — shipping the engineering writeup instead of pretending to launch a product nobody will use — is itself a senior product decision. The codebase is the artifact. The writeup is the deliverable. That's fine.

---

## Code

**Repo:** [github.com/JoshuaLaw10/DoomBreak](https://github.com/JoshuaLaw10/DoomBreak)

Key files to read in order:
1. [`platforms/chatgpt.js`](../platforms/chatgpt.js) — adapter pattern + telemetry (~280 lines, fully commented)
2. [`content_script.js`](../content_script.js) — state machine, no selectors
3. [`tests/doombreak.test.js`](../tests/doombreak.test.js) — isolation pattern in practice
4. [`tests/telemetry.test.js`](../tests/telemetry.test.js) — telemetry unit tests

```bash
git clone https://github.com/JoshuaLaw10/DoomBreak
cd DoomBreak
npm install
npx vitest run   # 79 passing, 7 skipped
```
