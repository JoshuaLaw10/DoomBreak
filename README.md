# 🧠 Doombreak

> **Doomscroll responsibly. Automatically.**

Doombreak is a Chrome extension I built to solve a very specific problem:
when ChatGPT is thinking, I instinctively open YouTube, TikTok, or Instagram — and don’t come back.

Instead of fighting that habit, I designed around it.

Doombreak gives me a short, intentional doomscroll break **only while ChatGPT is generating**, then **automatically closes itself the moment the response is ready**.

No discipline required.

---

## ✨ What it does

* Detects when ChatGPT starts generating
* Opens a **full-screen, 3-panel doomscroll overlay**
* Lets me scroll while I wait
* **Automatically closes** when ChatGPT finishes
* Tracks how many times it saved me *today* (daily auto-close streak)
* Includes sound control, rotating slogans, and playful micro-interactions

It turns an unbounded habit into a bounded one.

---

## 🎬 Demo experience

1. I send a prompt on ChatGPT
2. Doombreak appears instantly
3. Status updates from **Thinking → Typing**
4. I scroll for a bit
5. ChatGPT finishes
6. Doombreak disappears automatically

Back to work. No friction.

---

## 🛠 How I built it

* Chrome extension using a content script
* DOM + `MutationObserver`-based generation detection
* A small state machine:

  * `idle → thinking → typing → idle`
* Streaming-safe typing detection for `chatgpt.com`
* Prompt-aware content selection (sports / calm / funny)
* Local MP4 assets for instant playback
* `chrome.storage.local` for:

  * sound preferences
  * rotating slogans
  * daily auto-close streaks
* No backend, no APIs, no servers

Just JavaScript, CSS, and a worrying amount of polish.

---

## 🧩 Key features

* **Prompt-aware doomscrolling**
  Ask about sports → sports clips
  Ask for calm → calming content

* **Daily auto-close streak**
  Shows how many times Doombreak pulled me back *today*.

* **Self-closing by design**
  I don’t need self-control — the extension has it for me.

* **Over-engineered UI**

  * smooth reel transitions
  * sound toggle
  * subtle animations
  * surprise interactions on close

---

## ⚠️ Challenges I ran into

* ChatGPT’s DOM changes often and unpredictably
* Streaming responses don’t always increase text length
* “Thinking” vs “typing” isn’t explicitly exposed
* Browser autoplay & sound restrictions
* Avoiding false positives during rerenders

Most of the difficulty was detecting something the platform never intended to expose.

---

## 🏆 Accomplishments I’m proud of

* Reliable generation detection on `chatgpt.com`
* Typing detection that works even when text length doesn’t change
* A smooth overlay that doesn’t break the page
* Shipping a fully-working solo hack under time pressure
* Building something that’s funny *and* genuinely useful (to me)

---

## 📚 What I learned

* Attention is about **defaults**, not discipline
* Small UX interventions can change behavior meaningfully
* “Useless” ideas often hide real insight
* Over-engineering is fine when it serves the joke *and* the user

---

## 🔮 What’s next for Doombreak

* Support for other LLMs (Gemini, Claude, Cursor)
* Smarter pacing (fast → slow → calm content)
* Session-level stats and streaks
* Custom feeds
* Optional “hard mode” (no scrolling, just vibes)

---

## 🪦 Disclaimer

This project does **not**:

* Increase productivity
* Reduce screen time
* Cure dopamine addiction

It simply **closes the distraction at the right moment**.
