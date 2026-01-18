// Doomscroll Break (content script)
// - Full-screen 3-panel reels overlay while ChatGPT is generating
// - Detects thinking -> typing properly (no "typing" immediately on start)
// - Prevents same clip simultaneously + avoids immediate cross-panel repeats
// - TOPBAR gradient overlay style (same positions)
// - Safer autoplay handling
// - Moves Thinking/Typing beside spinner
// - Adds slogan beside title + reward rotation (only changes AFTER manual close)
// - Prompt-aware mode: filters FEED by detectedTag (from prompt heuristic) using item.tags
// - UPDATE: surprise popup moved to CLOSE button (right-click or Shift+click)
// - UPDATE: "SHORTS • For You" badge more transparent
// - UPDATE: title + slogan bolder (and fixed invalid font-weight 1500)
// - FIX: capture last user prompt BEFORE it disappears, so prompt-aware tagging works reliably
// - NEW: daily auto-close streak counter (how many times it auto-closed today)
// - NEW: Close button inline with Sound button + thinner sound button
// - FIX: typing state wins over thinking; detect changes even if length doesn't strictly increase

console.log("[DoomscrollOverlay] injected:", location.href);

let overlayEl = null;
let soundOnCached = false;
let lastState = null; // "idle" | "thinking" | "typing"
let debounceTimer = null;

// If user closes overlay manually, suppress it until generation ends
let suppressUntilDone = false;

// Track assistant output changes to distinguish "thinking" vs "typing"
let lastAssistantLen = 0;
let lastAssistantChangeAt = 0;
let lastAssistantSig = 0; // chatgpt.com-safe change signature


// Make state transitions robust
let wasGenerating = false;
let genStartAt = 0;

// Capture prompt text before it clears (CRITICAL FIX)
let lastUserPrompt = "";

/* -----------------------------
   DAILY STREAK (AUTO-CLOSE COUNT)
-------------------------------- */

function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

async function getDailyAutoCloseCount() {
  try {
    const { dailyAutoClose } = await chrome.storage.local.get(["dailyAutoClose"]);
    const today = todayKey();
    if (!dailyAutoClose || dailyAutoClose.date !== today) return 0;
    return Number(dailyAutoClose.count) || 0;
  } catch {
    return 0;
  }
}

async function incrementDailyAutoClose() {
  try {
    const today = todayKey();
    const { dailyAutoClose } = await chrome.storage.local.get(["dailyAutoClose"]);
    let data = dailyAutoClose && typeof dailyAutoClose === "object" ? dailyAutoClose : null;

    if (!data || data.date !== today) {
      data = { date: today, count: 0 };
    }
    data.count = (Number(data.count) || 0) + 1;

    await chrome.storage.local.set({ dailyAutoClose: data });
    updateStreakUIFromStorage(); // refresh overlay UI if open
  } catch {}
}

async function updateStreakUIFromStorage() {
  if (!overlayEl) return;
  const el = overlayEl.querySelector("#doom_streak");
  if (!el) return;
  const n = await getDailyAutoCloseCount();
  el.textContent = `Today: ${n}`;
}

/* -----------------------------
   REWARD MECHANISM
-------------------------------- */

const REWARD_KEYS = {
  sloganIndex: "doom_slogan_index",
  closeIndex: "doom_close_index"
};

const SLOGANS = [
  "controlled doomscrolling",
  "disciplined distraction",
  "intentional scrolling (allegedly)",
  "dopamine… responsibly?",
  "curated procrastination",
  "productivity cosplay",
  "brain break, not brain rot"
];

const CLOSE_TEXTS = [
  "🧠 Self-Control +1",
  "🛑 Kill Infinite Scroll",
  "🥋 Train Anti-Scroll",
  "🥲 Save Me From Myself",
  "🧘 Exit Doom. Enter Discipline.",
  "🧯 Put Out The Scrollfire",
  "🪦 R.I.P. Infinite Scroll"
];

/**
 * FEED
 * - src: packaged local mp4 (web_accessible_resources)
 * - platform: label
 * - tags: ['calm','sport','funny'] etc
 * - sourceUrl: used only for oEmbed (optional)
 */
const FEED = [
  { src: "media/clip1.mp4", platform: "SHORTS", tags: [], sourceUrl: "https://www.youtube.com/watch?v=PMGq9ZYKySo" },
  { src: "media/clip2.mp4", platform: "SHORTS", tags: [], sourceUrl: "https://www.youtube.com/watch?v=GkPaw1A-2Bw" },
  { src: "media/clip3.mp4", platform: "SHORTS", tags: ["sport"], sourceUrl: "https://www.youtube.com/shorts/gUHgT18oGMg" },
  { src: "media/clip4.mp4", platform: "SHORTS", tags: ["funny"], sourceUrl: "https://www.youtube.com/watch?v=2k7_leV5dScE" },
  { src: "media/clip5.mp4", platform: "SHORTS", tags: ["funny"], sourceUrl: "https://www.youtube.com/watch?v=DS079qX_8XM" },
  { src: "media/clip6.mp4", platform: "SHORTS", tags: [], sourceUrl: "https://www.youtube.com/watch?v=vhc3EyNy4oo" },
  { src: "media/clip7.mp4", platform: "SHORTS", tags: ["sport"], sourceUrl: "https://www.youtube.com/watch?v=i--cUraBMlg" },
  { src: "media/clip8.mp4", platform: "SHORTS", tags: ["sport"], sourceUrl: "https://www.youtube.com/watch?v=YjVgMDe_UmY" },
  { src: "media/clip9.mp4", platform: "SHORTS", tags: ["sport"], sourceUrl: "https://www.youtube.com/watch?v=xfyYp67R2WE" },
  { src: "media/clip10.mp4", platform: "SHORTS", tags: ["sport", "funny"], sourceUrl: "https://www.youtube.com/watch?v=Kd9664kqshU" },
  { src: "media/clip11.mp4", platform: "SHORTS", tags: ["funny", "focus"], sourceUrl: "https://www.youtube.com/watch?v=dV3zu4QY1Gc" },
  { src: "media/clip12.mp4", platform: "SHORTS", tags: ["funny"], sourceUrl: "https://www.youtube.com/watch?v=Z2F2oaPJ_Lw" },
  { src: "media/clip13.mp4", platform: "SHORTS", tags: ["calm"], sourceUrl: "https://www.youtube.com/watch?v=YJrsgiGKKQ4" },
  { src: "media/clip14.mp4", platform: "SHORTS", tags: ["calm"], sourceUrl: "https://www.youtube.com/watch?v=76W1ZtZfgFk" },
  { src: "media/clip15.mp4", platform: "SHORTS", tags: ["funny", "calm"], sourceUrl: "https://www.youtube.com/watch?v=wBhWCFVL0WI" },
  { src: "media/clip16.mp4", platform: "SHORTS", tags: ["funny", "calm"], sourceUrl: "https://www.youtube.com/watch?v=EM41yq0OUQ4" },
  { src: "media/clip17.mp4", platform: "SHORTS", tags: ["focus", "calm"], sourceUrl: "https://www.youtube.com/watch?v=X4yl0f5TJdY" },
  { src: "media/clip18.mp4", platform: "SHORTS", tags: [], sourceUrl: "https://www.youtube.com/shorts/iHR0kN5SLvA" },
  { src: "media/clip19.mp4", platform: "SHORTS", tags: ["calm"], sourceUrl: "https://www.youtube.com/watch?v=y72ZjofvLLo" },
  { src: "media/clip20.mp4", platform: "SHORTS", tags: ["funny"], sourceUrl: "https://www.youtube.com/watch?v=1gPPlRi_ULg" },
  { src: "media/clip21.mp4", platform: "SHORTS", tags: [], sourceUrl: "https://www.youtube.com/watch?v=1f7QqxhBUqE" },
  { src: "media/clip22.mp4", platform: "SHORTS", tags: ["sport"], sourceUrl: "https://www.youtube.com/watch?v=eq_hLNLtyS8" },
  { src: "media/clip23.mp4", platform: "SHORTS", tags: ["calm"], sourceUrl: "https://www.youtube.com/watch?v=yPrTcKa5eFs" },
  { src: "media/clip24.mp4", platform: "SHORTS", tags: [], sourceUrl: "https://www.youtube.com/watch?v=tiDWrsa6MiI" },
  { src: "media/clip25.mp4", platform: "SHORTS", tags: ["funny", "sport"], sourceUrl: "https://www.youtube.com/watch?v=YJrsgiGKKQ4" },
  { src: "media/clip26.mp4", platform: "SHORTS", tags: ["calm"], sourceUrl: "https://www.youtube.com/watch?v=vCeC2TiqPHo" },
  { src: "media/clip27.mp4", platform: "SHORTS", tags: ["calm"], sourceUrl: "https://www.youtube.com/watch?v=HuKJXHnCEHM" },
  { src: "media/clip28.mp4", platform: "SHORTS", tags: ["calm"], sourceUrl: "https://www.youtube.com/watch?v=whsbfUnnDDE" },
  { src: "media/clip29.mp4", platform: "SHORTS", tags: ["funny"], sourceUrl: "https://www.youtube.com/watch?v=-yNrUolYu2w" },
  { src: "media/clip30.mp4", platform: "SHORTS", tags: ["funny"], sourceUrl: "https://www.youtube.com/watch?v=p5fK1KpBkZ0" },
  { src: "media/clip31.mp4", platform: "SHORTS", tags: ["funny"], sourceUrl: "https://www.youtube.com/shorts/3YIu0b1bX1k" },
  { src: "media/clip32.mp4", platform: "SHORTS", tags: ["sport"], sourceUrl: "https://www.youtube.com/shorts/5rtUBGbhVpg" },
  { src: "media/clip33.mp4", platform: "SHORTS", tags: ["calm"], sourceUrl: "https://www.youtube.com/shorts/4gYZLNcSpQw" },
  { src: "media/clip34.mp4", platform: "SHORTS", tags: ["sport"], sourceUrl: "https://www.youtube.com/shorts/CcclLP6UDaM" },
  { src: "media/clip35.mp4", platform: "SHORTS", tags: ["sport", "funny"], sourceUrl: "https://www.youtube.com/shorts/1xDST2L7y7Q" },
  { src: "media/clip36.mp4", platform: "SHORTS", tags: ["calm"], sourceUrl: "https://www.youtube.com/shorts/qooBjVQRPlM" },
  { src: "media/clip37.mp4", platform: "SHORTS", tags: ["calm"], sourceUrl: "https://www.youtube.com/shorts/VeJPhH3X8I0" },
  { src: "media/clip38.mp4", platform: "SHORTS", tags: ["calm"], sourceUrl: "https://www.youtube.com/shorts/TUhXBbT5Hrg" },
  { src: "media/clip39.mp4", platform: "SHORTS", tags: ["calm"], sourceUrl: "https://www.youtube.com/shorts/LID5iG6ozf4" },
  { src: "media/clip40.mp4", platform: "SHORTS", tags: ["calm"], sourceUrl: "https://www.youtube.com/shorts/R_CD6ellkyk" }
];

/* -----------------------------
   PROMPT CAPTURE (CRITICAL FIX)
-------------------------------- */

function getLatestPromptText() {
  const ta = document.querySelector("textarea");
  if (ta && ta.value) return ta.value;

  const ce =
    document.querySelector('[contenteditable="true"]') ||
    document.querySelector('div[role="textbox"][contenteditable="true"]');

  if (ce) return (ce.textContent || "").trim();
  return "";
}

function installPromptCapture() {
  // Capture on Enter (send)
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Enter") return;
      if (e.shiftKey) return; // allow newline
      const text = getLatestPromptText();
      if (text) lastUserPrompt = text;
    },
    true
  );

  // Capture on clicking send button
  document.addEventListener(
    "click",
    (e) => {
      const btn = e.target.closest?.('button[type="submit"], button[data-testid="send-button"]');
      if (!btn) return;
      const text = getLatestPromptText();
      if (text) lastUserPrompt = text;
    },
    true
  );
}
installPromptCapture();

/* -----------------------------
   PROMPT-AWARE FEED SELECTION
-------------------------------- */

let ACTIVE_FEED = FEED;
let cachedDetectedTag = null;
let cachedPromptMode = null;
let cachedPromptUsed = "";

// Prompt → one or more tags
function detectTagsFromPromptText(promptText) {
  const t = (promptText || "").toLowerCase();

  const sportWords = [
    "sport", "sports", "football", "soccer", "basketball", "ski", "skiing",
    "gym", "workout", "training", "drill", "exercise", "athlete",
    "match", "game", "highlight", "goal", "shot", "trick", "skills",
    "race", "run", "marathon", "fitness", "competition", "tournament", "snow", "surf"
  ];

  const funnyWords = [
    "joke", "funny", "meme", "roast", "chaos", "random", "silly",
    "stupid", "weird", "laugh", "comedy", "satire", "parody",
    "prank", "shitpost", "unhinged", "absurd", "troll"
  ];

  const calmWords = [
    "calm", "relax", "relaxing", "sleep", "meditation", "breathe",
    "peaceful", "soothing", "zen", "quiet", "cozy", "chill",
    "ambient", "asmr", "satisfying", "nature"
  ];

  const score = { sport: 0, funny: 0, calm: 0 };

  for (const w of sportWords) if (t.includes(w)) score.sport++;
  for (const w of funnyWords) if (t.includes(w)) score.funny++;
  for (const w of calmWords) if (t.includes(w)) score.calm++;

  const entries = Object.entries(score).sort((a, b) => b[1] - a[1]);
  if (!entries.length || entries[0][1] === 0) return [];

  const top = entries[0][1];
  return entries.filter(([_, v]) => v === top).map(([k]) => k);
}

function itemMatchesAnyTag(item, desiredTags) {
  if (!desiredTags || !desiredTags.length) return false;
  const tags = item.tags || [];
  return tags.some((tag) => desiredTags.includes(tag));
}

async function isPromptMode() {
  const { promptMode } = await chrome.storage.local.get(["promptMode"]);
  return !!promptMode;
}

async function updateActiveFeedForCurrentPrompt() {
  const promptMode = await isPromptMode();
  cachedPromptMode = promptMode;

  if (!promptMode) {
    ACTIVE_FEED = FEED; // OFF: allow everything (tagged + untagged)
    cachedDetectedTag = null;
    cachedPromptUsed = "";
    return;
  }

  const taggedOnly = FEED.filter((item) => (item.tags || []).length > 0);

  // FIX: prefer captured prompt (lastUserPrompt) if textbox is empty
  const live = getLatestPromptText();
  const promptText = (live && live.trim()) ? live : (lastUserPrompt || "");
  cachedPromptUsed = promptText;

  const detectedTags = detectTagsFromPromptText(promptText);
  cachedDetectedTag = detectedTags.length ? detectedTags.join("+") : null;

  // ON but no confident tags -> only tagged content (no untagged chaos)
  if (!detectedTags.length) {
    ACTIVE_FEED = FEED;
    return;
  }

  // ON with 1+ tags -> clips matching ANY of those tags
  const themed = taggedOnly.filter((item) => itemMatchesAnyTag(item, detectedTags));
  ACTIVE_FEED = themed.length ? themed : taggedOnly;
}

/* -----------------------------
   PANEL SHUFFLE / SELECTION
-------------------------------- */

const panels = [
  { i: 0, order: [], idx: 0 },
  { i: 1, order: [], idx: 0 },
  { i: 2, order: [], idx: 0 }
];

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function ensureOrder(p) {
  if (!p.order.length || p.idx >= p.order.length) {
    p.order = shuffle(ACTIVE_FEED);
    p.idx = 0;
  }
}

const currentlyPlaying = new Set();
const GLOBAL_COOLDOWN = 21;
const globalRecent = [];

function pushRecent(list, value, maxLen) {
  list.push(value);
  if (list.length > maxLen) list.splice(0, list.length - maxLen);
}
function isInGlobalRecent(src) {
  return globalRecent.includes(src);
}

function nextItemForPanel(panelIndex) {
  const p = panels[panelIndex];

  for (let tries = 0; tries < 250; tries++) {
    ensureOrder(p);
    const candidate = p.order[p.idx++];
    if (!candidate) continue;

    const src = candidate.src;
    if (currentlyPlaying.has(src)) continue;
    if (isInGlobalRecent(src)) continue;
    return candidate;
  }

  for (let tries = 0; tries < 250; tries++) {
    ensureOrder(p);
    const candidate = p.order[p.idx++];
    if (!candidate) continue;

    const src = candidate.src;
    if (!currentlyPlaying.has(src)) return candidate;
  }

  ensureOrder(p);
  return p.order[p.idx++] || ACTIVE_FEED[0] || FEED[0];
}

async function isEnabled() {
  if (chrome?.storage?.local) {
    const { enabled } = await chrome.storage.local.get(["enabled"]);
    return !!enabled;
  }
  return true;
}

/* -----------------------------
   REWARD PERSISTENCE
-------------------------------- */

async function getStoredIndex(key, maxLen) {
  try {
    if (chrome?.storage?.local) {
      const obj = await chrome.storage.local.get([key]);
      let idx = Number(obj[key]);
      if (!Number.isFinite(idx) || idx < 0) idx = 0;
      if (maxLen > 0) idx = idx % maxLen;
      return idx;
    }
    return 0;
  } catch {
    return 0;
  }
}

async function bumpStoredIndex(key, maxLen) {
  if (chrome?.storage?.local) {
    const idx = await getStoredIndex(key, maxLen);
    const next = (idx + 1) % maxLen;
    await chrome.storage.local.set({ [key]: next });
    return next;
  }
  return 0;
}

/* -----------------------------
   SOUND PREF (muted autoplay)
-------------------------------- */

async function getSoundPref() {
  if (chrome?.storage?.local) {
    const { soundOn } = await chrome.storage.local.get(["soundOn"]);
    return !!soundOn;
  }
  return false;
}
async function setSoundPref(on) {
  if (chrome?.storage?.local) {
    await chrome.storage.local.set({ soundOn: !!on });
  }
}

function applySoundState(on) {
  soundOnCached = !!on;
  if (!overlayEl) return;
  overlayEl.querySelectorAll("video").forEach((v) => {
    v.muted = !on;
    v.volume = on ? 0.8 : 0;
    v.play().catch(() => {});
  });

  const b = overlayEl.querySelector("#doom_unmute_btn");
  if (b) b.innerHTML = on ? `<span class="btnLabel">🔊 Sound</span>` : `<span class="btnLabel">🔇 Muted</span>`;
}

/* -----------------------------
   GENERATING DETECTION
-------------------------------- */

let heartbeat = null;

function startHeartbeat() {
  if (heartbeat) return;
  heartbeat = setInterval(() => scheduleCheck(), 250);
}
function stopHeartbeat() {
  if (!heartbeat) return;
  clearInterval(heartbeat);
  heartbeat = null;
}

function detectGenerating() {
  const stopBtn =
    document.querySelector('button[aria-label="Stop generating"]') ||
    document.querySelector('button[aria-label*="Stop"]') ||
    document.querySelector('button[aria-label*="stop"]') ||
    document.querySelector('[data-testid="stop-button"]') ||
    document.querySelector('button[data-testid="stop-button"]');

  if (stopBtn) return true;

  const composer = document.querySelector("form") || document.querySelector("textarea")?.closest("form");
  if (composer) {
    const possibleStop = composer.querySelector('button[aria-label*="Stop"], button[aria-label*="stop"]');
    if (possibleStop) return true;
  }
  return false;
}
function getAssistantSig() {
  // chatgpt.com streaming often changes markup without monotonic text length increases.
  // We build a signature from latest assistant turn using both text+html length.

  const turnSelector = [
    'article[data-testid^="conversation-turn-"]',
    'div[data-testid^="conversation-turn-"]',
    'div[data-message-author-role="assistant"]'
  ].join(", ");

  const turns = document.querySelectorAll(turnSelector);
  if (!turns.length) return 0;

  for (let i = turns.length - 1; i >= 0 && i >= turns.length - 12; i--) {
    const turn = turns[i];

    const assistant =
      (turn.matches?.('div[data-message-author-role="assistant"]') ? turn : null) ||
      turn.querySelector?.('div[data-message-author-role="assistant"]');

    const root = assistant || turn;

    const content =
      root.querySelector?.(".markdown") ||
      root.querySelector?.(".prose") ||
      root.querySelector?.('[data-message-content]') ||
      root;

    const text = (content.textContent || "").trim();
    const html = (content.innerHTML || "").trim();

    if (text.length > 0 || html.length > 0) {
      // signature changes during streaming; cap html to avoid huge numbers
      const htmlLen = Math.min(html.length, 200000);
      return (text.length * 1000) + htmlLen;
    }
  }

  return 0;
}

function detectState() {
  const generating = detectGenerating();
  const now = Date.now();

  if (generating && !wasGenerating) {
    wasGenerating = true;
    genStartAt = now;

    lastAssistantSig = getAssistantSig();
    lastAssistantChangeAt = 0;

    return "thinking";
  }

  if (!generating && wasGenerating) {
    wasGenerating = false;
    genStartAt = 0;
    lastAssistantChangeAt = 0;
    return "idle";
  }

  if (!generating) return "idle";

  // Typing detection on chatgpt.com:
  // treat ANY change in signature as typing (markup/text changes during streaming)
  const sig = getAssistantSig();
  if (sig !== lastAssistantSig) {
    lastAssistantSig = sig;
    lastAssistantChangeAt = now;
  }

  const TYPING_GRACE_MS = 1800;
  const STARTUP_THINK_MS = 400;

  if (lastAssistantChangeAt && now - lastAssistantChangeAt < TYPING_GRACE_MS) return "typing";
  if (genStartAt && now - genStartAt < STARTUP_THINK_MS) return "thinking";
  return "thinking";
}


/* -----------------------------
   OEMBED (optional)
-------------------------------- */

const metaCache = new Map();
const panelMetaKey = ["", "", ""];

function requestOEmbed(url) {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    if (metaCache.has(url)) return resolve(metaCache.get(url));

    chrome.runtime.sendMessage({ type: "OEMBED_REQUEST", url }, (resp) => {
      if (!resp?.ok) return resolve(null);
      metaCache.set(url, resp.data);
      resolve(resp.data);
    });
  });
}

function formatHandle(name) {
  if (!name) return "@unknown";
  return "@" + name.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
}

function ensureEngagement(item) {
  if (!item.likes) item.likes = (Math.random() * 240 + 5).toFixed(1) + "K";
  if (!item.comments) item.comments = (Math.random() * 9 + 0.2).toFixed(1) + "K";
}

/* -----------------------------
   UI BUILD
-------------------------------- */

function setOverlaySubtitle(state) {
  if (!overlayEl) return;
  const status = overlayEl.querySelector("#doom_status_spinner");
  if (!status) return;

  if (state === "typing") status.textContent = "Typing";
  else if (state === "thinking") status.textContent = "Thinking";
  else status.textContent = "";
}

function showTinyToast(text) {
  if (!overlayEl) return;

  const old = document.getElementById("__doom_toast__");
  if (old) old.remove();

  const msg = document.createElement("div");
  msg.id = "__doom_toast__";
  msg.textContent = text;

  Object.assign(msg.style, {
    position: "fixed",
    top: "54px",
    right: "18px",
    padding: "10px 12px",
    borderRadius: "14px",
    background: "rgba(0,0,0,0.55)",
    border: "1px solid rgba(255,255,255,0.16)",
    backdropFilter: "blur(10px)",
    fontWeight: "900",
    fontSize: "12px",
    zIndex: "2147483647"
  });

  document.documentElement.appendChild(msg);
  setTimeout(() => msg.remove(), 1100);
}

function buildOverlay(sloganText, closeText) {
  const el = document.createElement("div");
  el.id = "__doomscroll_overlay__";

  Object.assign(el.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483647",
    background: "#000",
    color: "#fff",
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
  });

  const style = document.createElement("style");
  style.textContent = `
    #__doomscroll_overlay__{ animation: doom_in 140ms ease-out; }
    @keyframes doom_in { from { opacity:0; transform: scale(1.01); } to { opacity:1; transform: scale(1); } }
    #__doomscroll_overlay__.closing{ animation: doom_out 120ms ease-in forwards; }
    @keyframes doom_out { to { opacity:0; transform: scale(0.995); } }

    #__doomscroll_overlay__ .topbar{
      position:absolute; top:0; left:0; right:0;
      padding:12px 16px;
      display:flex; align-items:center; justify-content:space-between;
      background: linear-gradient(to bottom, rgba(0,0,0,0.82), rgba(0,0,0,0));
      pointer-events:none;
      z-index:50;
    }

    #__doomscroll_overlay__ .brand{
      display:flex;
      align-items:baseline;
      gap:10px;
      pointer-events:none;
      transform: translateY(-10px);
      min-width:0;
    }

    #__doomscroll_overlay__ .title{
      font-weight: 950;
      font-size: 24px;
      line-height: 1.05;
      opacity: 0.98;
      white-space: nowrap;
      letter-spacing: 0.2px;
      text-shadow: 0 2px 14px rgba(0,0,0,0.55);
    }

    #__doomscroll_overlay__ .slogan{
      font-size: 14px;
      font-weight: 950;
      opacity: 0.92;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 52vw;
      letter-spacing: 0.15px;
      text-shadow: 0 2px 14px rgba(0,0,0,0.45);
    }

    #__doomscroll_overlay__ .rightCluster{
      display:flex;
      align-items:center;
      gap:10px;
      pointer-events:auto;
    }

    #__doomscroll_overlay__ .spinner{
      width:18px; height:18px; border-radius:999px;
      border:2px solid rgba(255,255,255,0.25);
      border-top-color: rgba(255,255,255,0.95);
      animation: doomspin 0.7s linear infinite;
    }
    @keyframes doomspin { to { transform: rotate(360deg); } }

    #__doomscroll_overlay__ .stateText{
      font-size:12px;
      font-weight:900;
      opacity:0.78;
      width:64px;
      text-align:left;
      white-space:nowrap;
    }

    #__doomscroll_overlay__ .streakText{
      font-size:11px;
      font-weight:900;
      opacity:0.62;
      white-space:nowrap;
      transform: translateY(0.5px);
      margin-left:2px;
    }

    #__doomscroll_overlay__ .doomBtn{
      padding: 9px 12px;
      border-radius: 999px;
      border: 1px solid rgba(255,255,255,0.16);
      background: rgba(0,0,0,0.35);
      color: white;
      font-weight: 950;
      font-size: 12px;
      letter-spacing: 0.2px;
      cursor: pointer;
      backdrop-filter: blur(10px);
      box-shadow: 0 6px 16px rgba(0,0,0,0.25);
      transition: transform 80ms ease, background 120ms ease, border-color 120ms ease, opacity 120ms ease;
    }
    #__doomscroll_overlay__ .doomBtn:hover{
      background: rgba(255,255,255,0.10);
      border-color: rgba(255,255,255,0.22);
    }
    #__doomscroll_overlay__ .doomBtn:active{
      transform: translateY(1px) scale(0.99);
    }
    #__doomscroll_overlay__ .doomBtn.secondary{
      background: rgba(255,255,255,0.10);
      border-color: rgba(255,255,255,0.18);
    }
    #__doomscroll_overlay__ .doomBtn.secondary:hover{
      background: rgba(255,255,255,0.14);
    }
    #__doomscroll_overlay__ .doomBtn .btnLabel{
      display:inline-block;
      transform: translateY(-0.5px);
    }

    /* NEW: thinner sound button */
    #__doomscroll_overlay__ .doomBtn.soundThin{
      padding: 7px 10px;
      font-size: 11px;
      letter-spacing: 0.15px;
      opacity: 0.92;
    }

    #__doomscroll_overlay__ .grid{
      position:absolute; inset:0;
      display:grid; grid-template-columns: 1fr 1fr 1fr;
      gap:10px; padding:12px;
      background:
        radial-gradient(circle at 30% 20%, rgba(255,0,128,0.16), transparent 40%),
        radial-gradient(circle at 70% 80%, rgba(0,255,255,0.12), transparent 40%),
        #000;
    }

    #__doomscroll_overlay__ .col{
      border-radius: 24px;
      overflow:hidden;
      position:relative;
      background:#000;
      outline: 1px solid rgba(255,255,255,0.12);
    }

    #__doomscroll_overlay__ .stage{ position:absolute; inset:0; background:#000; overflow:hidden; }
    #__doomscroll_overlay__ .layer{ position:absolute; inset:0; transform: translateY(0%); will-change: transform; }
    #__doomscroll_overlay__ .layer.next{ transform: translateY(100%); }

    #__doomscroll_overlay__ video{
      width:100%; height:100%;
      object-fit: cover;
      background:#000;
    }

    #__doomscroll_overlay__ .stage.scrolling .layer.current{
      transition: transform 220ms cubic-bezier(.2,.9,.2,1);
      transform: translateY(-100%);
    }
    #__doomscroll_overlay__ .stage.scrolling .layer.next{
      transition: transform 220ms cubic-bezier(.2,.9,.2,1);
      transform: translateY(0%);
    }

    #__doomscroll_overlay__ .badge{
      position:absolute; top:12px; left:12px;
      font-size:12px; font-weight:950;
      padding:7px 12px; border-radius:999px;
      background: rgba(0,0,0,0.28);
      outline: 1px solid rgba(255,255,255,0.10);
      backdrop-filter: blur(10px);
      z-index:40;
      pointer-events:none;
      opacity: 0.88;
    }

    #__doomscroll_overlay__ .icons{
      position:absolute; right:12px; bottom:92px;
      display:flex; flex-direction:column; gap:16px;
      z-index:40;
      pointer-events:none;
    }
    #__doomscroll_overlay__ .icon{
      width:52px; height:52px;
      border-radius:18px;
      display:flex; flex-direction:column;
      align-items:center; justify-content:center;
      gap:4px;
      background: rgba(0,0,0,0.45);
      outline: 1px solid rgba(255,255,255,0.14);
      backdrop-filter: blur(10px);
      color:#fff;
      font: 900 16px system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    }
    #__doomscroll_overlay__ .count{ font: 800 10px system-ui, -apple-system, Segoe UI, Roboto, sans-serif; opacity:0.9; }
    #__doomscroll_overlay__ .caption{
      position:absolute; left:14px; right:80px; bottom:18px;
      z-index:40;
      pointer-events:none;
      color:#fff;
      text-shadow: 0 2px 12px rgba(0,0,0,0.7);
    }
    #__doomscroll_overlay__ .user{ font-weight:900; font-size:12px; margin-bottom:6px; }
    #__doomscroll_overlay__ .text{ font-weight:650; font-size:12px; line-height:1.2; opacity:0.95; margin-bottom:6px; }
    #__doomscroll_overlay__ .audio{ font-weight:650; font-size:11px; opacity:0.8; }

    #__doomscroll_overlay__ .shield{
      position:absolute; inset:0;
      z-index:10;
      background: transparent;
      pointer-events: auto;
    }
  `;
  el.appendChild(style);

  const topbar = document.createElement("div");
  topbar.className = "topbar";
  topbar.innerHTML = `
    <div class="brand">
      <div class="title">Doomscroll Break</div>
      <div class="slogan" id="doom_slogan">${sloganText}</div>
    </div>

    <div class="rightCluster">
      <div class="spinner" aria-hidden="true"></div>
      <div id="doom_status_spinner" class="stateText">…</div>
      <div id="doom_streak" class="streakText">Today: 0</div>
      <div id="doom_controls" style="display:flex; gap:8px; align-items:center;"></div>
    </div>
  `;
  el.appendChild(topbar);

  const controls = topbar.querySelector("#doom_controls");
  if (controls) {
    // Sound button (thinner)
    const soundBtn = document.createElement("button");
    soundBtn.id = "doom_unmute_btn";
    soundBtn.className = "doomBtn soundThin";
    soundBtn.innerHTML = `<span class="btnLabel">🔇 Muted</span>`;
    controls.appendChild(soundBtn);

    soundBtn.onclick = async () => {
      const on = !(await getSoundPref());
      await setSoundPref(on);
      applySoundState(on);
    };

    // Close button (inline with sound)
    const closeBtn = document.createElement("button");
    closeBtn.id = "doom_close_btn";
    closeBtn.className = "doomBtn secondary";
    closeBtn.innerHTML = `<span class="btnLabel">${closeText}</span>`;
    closeBtn.title = "Tip: right-click or Shift+click for +1 discipline";
    controls.appendChild(closeBtn);

    closeBtn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showTinyToast("✨ Training Arc +1 ✨");
    });

    closeBtn.addEventListener("click", async (e) => {
      if (e.shiftKey) {
        showTinyToast("✨ Training Arc +1 ✨");
        return;
      }

      suppressUntilDone = true;

      await bumpStoredIndex(REWARD_KEYS.sloganIndex, SLOGANS.length);
      await bumpStoredIndex(REWARD_KEYS.closeIndex, CLOSE_TEXTS.length);

      hideOverlay();
      console.log("[DoomscrollOverlay] manually closed; suppressed until done");
    });
  }

  const grid = document.createElement("div");
  grid.className = "grid";

  for (let i = 0; i < 3; i++) {
    const col = document.createElement("div");
    col.className = "col";
    col.dataset.panel = String(i);

    const shield = document.createElement("div");
    shield.className = "shield";

    const badge = document.createElement("div");
    badge.className = "badge";
    badge.textContent = "…";

    const stage = document.createElement("div");
    stage.className = "stage";

    const layerA = document.createElement("div");
    layerA.className = "layer current";
    const vidA = document.createElement("video");
    vidA.muted = true;
    vidA.autoplay = true;
    vidA.playsInline = true;
    vidA.preload = "auto";
    vidA.loop = false;
    vidA.setAttribute("playsinline", "");
    layerA.appendChild(vidA);

    const layerB = document.createElement("div");
    layerB.className = "layer next";
    const vidB = document.createElement("video");
    vidB.muted = true;
    vidB.autoplay = true;
    vidB.playsInline = true;
    vidB.preload = "auto";
    vidB.loop = false;
    vidB.setAttribute("playsinline", "");
    layerB.appendChild(vidB);

    stage.appendChild(layerA);
    stage.appendChild(layerB);

    const icons = document.createElement("div");
    icons.className = "icons";
    icons.innerHTML = `
      <div class="icon">♥<div class="count" data-like>0</div></div>
      <div class="icon">💬<div class="count" data-comment>0</div></div>
      <div class="icon">↗<div class="count">share</div></div>
    `;

    const caption = document.createElement("div");
    caption.className = "caption";
    caption.innerHTML = `
      <div class="user" data-user>@…</div>
      <div class="text" data-title>…</div>
      <div class="audio">♫ original audio</div>
    `;

    col.appendChild(shield);
    col.appendChild(badge);
    col.appendChild(stage);
    col.appendChild(icons);
    col.appendChild(caption);
    grid.appendChild(col);
  }

  el.appendChild(grid);
  return el;
}

function setUIForPanel(panelIndex, item) {
  if (!overlayEl) return;
  const col = overlayEl.querySelector(`.col[data-panel="${panelIndex}"]`);
  if (!col) return;

  col.querySelector(".badge").textContent = `${item.platform} • For You`;
  col.querySelector("[data-user]").textContent = item.creator || "@unknown";
  col.querySelector("[data-title]").textContent = item.title || "Untitled";
  col.querySelector("[data-like]").textContent = item.likes || "0";
  col.querySelector("[data-comment]").textContent = item.comments || "0";
}
function safePlay(videoEl) {
  if (!videoEl) return;

  // Respect current sound setting
  videoEl.muted = !soundOnCached;
  videoEl.volume = soundOnCached ? 0.8 : 0;

  const p = videoEl.play();
  if (p && typeof p.catch === "function") p.catch(() => {});
}


function scrollToNext(panelIndex) {
  if (!overlayEl) return;

  const col = overlayEl.querySelector(`.col[data-panel="${panelIndex}"]`);
  if (!col) return;

  const stage = col.querySelector(".stage");
  const currentLayer = stage.querySelector(".layer.current");
  const nextLayer = stage.querySelector(".layer.next");

  const currentVideo = currentLayer.querySelector("video");
  const nextVideo = nextLayer.querySelector("video");

  const oldSrc = col.dataset.currentSrc;
  if (oldSrc) currentlyPlaying.delete(oldSrc);

  const item = nextItemForPanel(panelIndex);

  currentlyPlaying.add(item.src);
  col.dataset.currentSrc = item.src;
  pushRecent(globalRecent, item.src, GLOBAL_COOLDOWN);

  ensureEngagement(item);

  setUIForPanel(panelIndex, { ...item, creator: "@loading", title: "Loading title…" });

  panelMetaKey[panelIndex] = item.sourceUrl || "";
  requestOEmbed(item.sourceUrl).then((meta) => {
    if (!overlayEl) return;
    if ((item.sourceUrl || "") !== panelMetaKey[panelIndex]) return;
    if (!meta) return;

    setUIForPanel(panelIndex, {
      ...item,
      creator: formatHandle(meta.author_name),
      title: meta.title || "Untitled"
    });
  });

  const url = chrome.runtime.getURL(item.src);

  try {
    nextVideo.pause();
    nextVideo.removeAttribute("src");
    nextVideo.load();
  } catch {}

  nextVideo.src = url;
  nextVideo.currentTime = 0;

  safePlay(nextVideo);

  stage.classList.add("scrolling");

  setTimeout(() => {
    try { currentVideo.pause(); } catch {}
    try {
      currentVideo.removeAttribute("src");
      currentVideo.load();
    } catch {}

    currentLayer.classList.remove("current");
    currentLayer.classList.add("next");
    nextLayer.classList.remove("next");
    nextLayer.classList.add("current");

    stage.classList.remove("scrolling");

    const newCurrentVideo = stage.querySelector(".layer.current video");
    newCurrentVideo.onended = () => {
      if (!overlayEl) return;
      scrollToNext(panelIndex);
    };
  }, 240);
}

function startPanels() {
  for (let i = 0; i < 3; i++) scrollToNext(i);
}

const SCROLL_COOLDOWN_MS = 1000;
const panelScrollLock = [false, false, false];

function addScrollControls() {
  if (!overlayEl) return;

  overlayEl.addEventListener(
    "wheel",
    (ev) => {
      const col = ev.target.closest?.(".col");
      if (!col) return;

      ev.preventDefault();

      const panelIndex = Number(col.dataset.panel);
      if (panelScrollLock[panelIndex]) return;

      panelScrollLock[panelIndex] = true;
      scrollToNext(panelIndex);

      setTimeout(() => (panelScrollLock[panelIndex] = false), SCROLL_COOLDOWN_MS);
    },
    { passive: false }
  );
}

async function showOverlay() {
  if (overlayEl) return;

  await updateActiveFeedForCurrentPrompt();
  panels.forEach((p) => { p.order = []; p.idx = 0; });

  console.log(
    "[DoomscrollOverlay] promptMode:", cachedPromptMode,
    "detected:", cachedDetectedTag,
    "ACTIVE_FEED size:", ACTIVE_FEED.length,
    "has untagged in active:", ACTIVE_FEED.some(x => !(x.tags||[]).length)
  );

  console.log(
    "[DoomscrollOverlay] promptMode:", cachedPromptMode,
    "detectedTag:", cachedDetectedTag,
    "activeFeedSize:", ACTIVE_FEED.length,
    "promptUsed:", JSON.stringify(cachedPromptUsed || "")
  );

  const sloganIdx = await getStoredIndex(REWARD_KEYS.sloganIndex, SLOGANS.length);
  const closeIdx = await getStoredIndex(REWARD_KEYS.closeIndex, CLOSE_TEXTS.length);

  overlayEl = buildOverlay(SLOGANS[sloganIdx], CLOSE_TEXTS[closeIdx]);
  document.documentElement.appendChild(overlayEl);

  setOverlaySubtitle(lastState || "thinking");
  updateStreakUIFromStorage();

  const on = await getSoundPref();
  applySoundState(on);
  

  startPanels();
  addScrollControls();

  const unlock = async () => {
    const wantSound = await getSoundPref();
    if (wantSound) applySoundState(true);

    window.removeEventListener("pointerdown", unlock, true);
    window.removeEventListener("keydown", unlock, true);
    window.removeEventListener("touchstart", unlock, true);
  };

  window.addEventListener("pointerdown", unlock, true);
  window.addEventListener("keydown", unlock, true);
  window.addEventListener("touchstart", unlock, true);
}

function hideOverlay() {
  if (!overlayEl) return;

  overlayEl.classList.add("closing");

  setTimeout(() => {
    if (!overlayEl) return;

    const cols = overlayEl.querySelectorAll(".col");
    cols.forEach((c) => {
      const src = c.dataset.currentSrc;
      if (src) currentlyPlaying.delete(src);
      c.dataset.currentSrc = "";
    });

    overlayEl.querySelectorAll("video").forEach((v) => {
      try { v.pause(); } catch {}
      try {
        v.removeAttribute("src");
        v.load();
      } catch {}
    });

    overlayEl.remove();
    overlayEl = null;
  }, 130);
}

async function updateOverlayState(shouldShow) {
  const enabled = await isEnabled();
  if (!enabled) {
    hideOverlay();
    return;
  }
  if (shouldShow) await showOverlay();
  else hideOverlay();
}

function scheduleCheck() {
  if (debounceTimer) clearTimeout(debounceTimer);

  debounceTimer = setTimeout(async () => {
    const enabled = await isEnabled();
    if (!enabled) {
      stopHeartbeat();
      hideOverlay();
      return;
    }

    const state = detectState();
    const hadOverlay = !!overlayEl;
    const prevState = lastState;


    if (state === "idle") stopHeartbeat();
    else startHeartbeat();

    // If user manually closed overlay, keep it suppressed until generation ends
    if (suppressUntilDone) {
      if (state === "idle") suppressUntilDone = false;
      hideOverlay();
      lastState = state;
      return;
    }

    // AUTO-CLOSE STREAK: count when we transition from active -> idle (and overlay was visible)
    if (state === "idle" && hadOverlay && prevState && prevState !== "idle") {
    incrementDailyAutoClose();
    }


    await updateOverlayState(state !== "idle");
    setOverlaySubtitle(state);

    if (state !== lastState) {
      lastState = state;
      console.log("[DoomscrollOverlay] state:", state, "sig:", lastAssistantSig);

    }
  }, 120);
}

function onKeydown(e) {
  if (e.key === "Escape") {
    suppressUntilDone = true;
    hideOverlay();
    console.log("[DoomscrollOverlay] ESC closed; suppressed until done");
  }
}
window.addEventListener("keydown", onKeydown, true);

new MutationObserver(scheduleCheck).observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  characterData: true
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.enabled && !changes.enabled.newValue) hideOverlay();
});

scheduleCheck();
