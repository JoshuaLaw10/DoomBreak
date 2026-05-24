# Roadmap — Doombreak

> **Status: Path A — portfolio wind-down.**  
> The product was conceived before Claude and ChatGPT shipped native background/notify features. Those features absorbed the core use case. Continuing as a consumer product no longer makes sense. The engineering, however, is genuinely strong and stands on its own as a portfolio artifact.

---

## The decision

**Goal:** convert this from "almost-launched Chrome extension" into "a polished engineering artifact that gets me interviews and Show HN traction."

**Not goals:**
- Chrome Web Store submission
- Daily active users
- Growth, retention, or monetization
- Sourcing 80 clips
- Multi-LLM support, custom feeds, or any v1.1 features

**Done criteria:** v1.0.0 tagged on GitHub, demo video in README, technical blog post live, posted to one external surface (HN or LinkedIn). After that, **stop**.

---

## Phase 1 — Reposition (1-2 hours)

Convert the framing from "product" to "engineering case study." Honest narrative, no spin.

- [ ] **Rewrite the README opening.** Lead with the engineering, not the product pitch. Suggested first line:
  > *"A Chrome extension built before AI providers added background-task notifications. The product premise has since been absorbed by the platforms — but the engineering remains a useful case study in MV3 architecture, DOM adapter patterns, and resilience telemetry."*
- [ ] **Add a "Why this exists" section** that explicitly names the timing — built pre-background-notify, shipped as engineering writeup not as live product. This honesty is a *strength* on a resume; pretending otherwise is a weakness.
- [ ] **Add a "What I'd build differently in 2026" section.** Shows product judgment. Reference the brutal review (mechanic vs. dopamine model mismatch, full-screen vs. PiP, etc).
- [ ] **Move the original poetic README** to `docs/ORIGINAL_PITCH.md` as a historical artifact.

---

## Phase 2 — Source 12 clips (2-3 hours)

Just enough to demo. Not 80.

- [ ] Pick 12 clips from Pexels — 3 per tag (calm/funny/sport/focus)
- [ ] Skip Pixabay/Mixkit; one source is faster
- [ ] Compress to ≤500KB each (ffmpeg `-crf 28 -vf scale=720:-2`)
- [ ] Populate `metadata.json` from template
- [ ] Run `npm run feed` to regenerate `data/feed.js`
- [ ] Verify `du -sh media/` < 7MB total

**Why 12:** demo video and screenshots only need to show variety, not exhaust the pool. Real users would need 80; portfolio doesn't.

---

## Phase 3 — Demo materials (3-4 hours)

The artifacts that make this a real portfolio piece.

- [ ] **Load extension unpacked.** Use Cmd+Shift+D, send a long prompt to ChatGPT, verify the full flow works end-to-end with real clips.
- [ ] **Capture the 3 fixture HTML files** following `tests/fixtures/CAPTURE.md`. Activate the 7 skipped tests. Either they pass (great, commit) or they fail (means selectors drifted — update `platforms/chatgpt.js`, this is a legitimate value-add to show in the writeup).
- [ ] **Record a 30-second screen capture** showing: prompt sent → overlay appears → state changes Thinking→Typing → auto-close. Use QuickTime or Loom. Convert to GIF or MP4.
- [ ] **Take 2 screenshots** (skip the full 5-shot list): the hero overlay + the popup with telemetry health check.
- [ ] Drop the demo + screenshots at the top of the README.

---

## Phase 4 — Technical writeup (3-4 hours)

The single highest-leverage artifact. This is what gets quoted on HN, shared on Twitter, and read in interviews.

**Title suggestion:** *"Building a Chrome extension that adapts to ChatGPT's DOM without selector rot"*

Structure:
1. **The problem (briefly).** ChatGPT's DOM changes constantly. Most extensions break silently. How do you know yours still works?
2. **Platform adapter pattern.** One file owns all selectors. Diff-friendly. Onboarding-friendly.
3. **Selector telemetry as a canary.** Per-selector match timestamps flushed to `chrome.storage.local`. The popup shows health. The user never sees a broken extension that thinks it's healthy.
4. **State machine and the typing-detection bug.** The non-obvious one: `signature` (text length × HTML length) is more reliable than `turnCount` for detecting streaming start. Show before/after.
5. **Testing strategy for browser-embedded scripts.** `vi.resetModules` + the `if (typeof module !== 'undefined')` export pattern. Why this beats Puppeteer for unit-scope tests.
6. **What the product taught me about timing.** Be honest: built before background-notify shipped on the platforms. Product is dead, engineering is alive. *This paragraph is the most valuable one.*

Publish to:
- [ ] Personal blog (if you have one) or dev.to / Medium / Substack
- [ ] Cross-post to Hacker News with title: *"Show HN: A Chrome extension whose product is dead but whose engineering isn't"* — the meta-honesty does well on HN
- [ ] LinkedIn post linking the writeup

---

## Phase 5 — Release (1 hour)

Make the artifact official.

- [ ] Tag `v1.0.0` on GitHub: `git tag -a v1.0.0 -m "v1.0.0 — portfolio release"`
- [ ] Create a GitHub Release with:
  - The demo video
  - "Load Unpacked" install instructions
  - Link to the writeup
  - Honest note that this is a portfolio artifact, not actively developed
- [ ] **Skip Chrome Web Store submission.** CWS adds zero value when the install pathway is "interested HN readers" not "search-driven discovery." Save the $5 fee and the 1-3 week review wait.
- [ ] Update repo description: *"Chrome extension — engineering case study in DOM adapter patterns and selector telemetry. Portfolio piece."*
- [ ] Pin the repo on GitHub profile.

---

## Phase 6 — Stop (the most important phase)

- [ ] Resist the urge to add features
- [ ] Resist the urge to "give it one more push"
- [ ] Resist the urge to submit to CWS "just in case"
- [ ] Close the project mentally. Move on.

**Sunk cost trap:** you've already done the hard work. Every additional hour past Phase 5 is low-ROI. The engineering wins are already locked in. More polish doesn't move the needle.

---

## Total time budget

| Phase | Hours |
|---|---|
| 1. Reposition | 1-2 |
| 2. Source 12 clips | 2-3 |
| 3. Demo materials | 3-4 |
| 4. Technical writeup | 3-4 |
| 5. Release | 1 |
| **Total** | **10-14 hours** |

Spread across 2-3 evenings. Done in a week.

---

## Appendix — If you want to pivot later

Only revisit if you get a strong signal (5+ unprompted users asking for it, an unexpected install spike, someone offering to build with you). Otherwise, the pivots below are theoretical and not worth pursuing pre-emptively.

### Pivot 1: "Wait-time insight" tool
Track time spent waiting on AI tools across browsers. Surface aggregated data. Sell to enterprises who want to understand productivity overhead of AI adoption. This is a B2B analytics play; entirely different product, entirely different distribution.

### Pivot 2: "Selector resilience as a service"
The most interesting piece of Doombreak's engineering is the telemetry canary. Package that as a library or SaaS for other Chrome extension developers who scrape changing DOMs (LinkedIn scrapers, ChatGPT exporters, etc). Niche but real.

### Pivot 3: "Mindful AI wait" (don't do this one)
Replace doomscroll with breathing exercise / meditation / journal prompt during AI waits. The market doesn't exist; the people who wait mindfully don't need an extension to do so.

### Default: don't pivot
The right answer is almost always "ship as portfolio, move to the next project." Pivoting a dead product is one of the highest-cost lowest-return moves in software.

---

## Lessons captured (for the next project)

- **Validate the mechanic with 5 users before sourcing assets.** Spending hours on clip curation before testing whether the overlay feels good was inverted.
- **Pre-bundled content can't replicate algorithmic content's feel.** Stock footage ≠ TikTok, even at 3-panel grid.
- **Auto-close that interrupts is hostile, not magical.** PiP that fades is the right pattern.
- **Streak counters reward the behavior, not the change.** Vanity metrics drift the product away from its goal.
- **Platforms eventually absorb point-solutions for platform problems.** This is the textbook risk; the lesson is to build either much closer to the platform (be the platform) or much further from it (cross-platform aggregation).
- **Great engineering doesn't fix a broken product premise.** Both this project and the original prompt to refactor it spent disproportionate effort on the part that wasn't broken.

---

## Final note

This was not a wasted project. The engineering is real, the patterns are reusable, the writeup will land. The product not shipping isn't a failure — it's a triage. Knowing when to stop is itself a senior-level skill, and doing it explicitly (with a roadmap, on the public record, with reasoning) is much more impressive than quietly abandoning the repo.

Tag, ship the artifact, post the writeup, move on. Then build the next thing with the lessons captured above.
