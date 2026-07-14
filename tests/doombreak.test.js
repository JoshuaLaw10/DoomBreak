// tests/doombreak.test.js
// Tests for content_script.js — state machine, overlay lifecycle, and utilities.
//
// Isolation: vi.resetModules() + dynamic import per test ensures each test
// gets a fresh module with reset singleton state. The _resetForTest() helper
// also tears down timers and DOM side-effects.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — established before each module load
// ---------------------------------------------------------------------------

function makeChromeStub(overrides) {
  return Object.assign({
    storage: {
      local: {
        get:  vi.fn((_keys, cb) => { if (cb) cb({}); }),
        set:  vi.fn(),
      },
      onChanged: { addListener: vi.fn() },
    },
    runtime: {
      lastError: null,
      getURL: vi.fn(path => 'chrome-extension://fakeid/' + path),
    },
  }, overrides);
}

function makeChatGPTStub(overrides) {
  return Object.assign({
    detectGenerating:      vi.fn(() => false),
    getStateSnapshot:      vi.fn(() => ({ generating: false, turnCount: 0, signature: 0, lastUserPrompt: '' })),
    getLastUserPrompt:     vi.fn(() => ''),
    getAssistantTurnCount: vi.fn(() => 0),
    getAssistantSignature: vi.fn(() => 0),
    getObserverTarget:     vi.fn(() => document.body),
    getSelectorTelemetry:  vi.fn(() => ({})),
    getStopSelectorKeys:   vi.fn(() => ['stop:testid', 'stop:composer-aria']),
  }, overrides);
}

// ---------------------------------------------------------------------------
// Load helpers — each call re-imports the module with fresh state
// ---------------------------------------------------------------------------

async function loadModule() {
  vi.resetModules();
  // Set up globals BEFORE dynamic import so module top-level code sees them
  global.chrome  = makeChromeStub();
  global.ChatGPT = makeChatGPTStub();

  // Data globals (normally injected by manifest load order)
  global.KEYWORDS = [
    { pattern: /\bsport\b/, tag: 'sport' },
    { pattern: /\bcalm\b/,  tag: 'calm'  },
    { pattern: /\bfunny\b/, tag: 'funny' },
    { pattern: /\bfocus\b/, tag: 'focus' },
  ];
  global.SLOGANS = ['Slogan A', 'Slogan B', 'Slogan C'];
  global.FEED    = [
    { file: 'sport_001.mp4', tags: ['sport'], title: 'S1', creator: 'A', license: 'Pexels', source: 'https://pexels.com/1' },
    { file: 'calm_001.mp4',  tags: ['calm'],  title: 'C1', creator: 'B', license: 'Pexels', source: 'https://pexels.com/2' },
    { file: 'funny_001.mp4', tags: ['funny'], title: 'F1', creator: 'C', license: 'Pexels', source: 'https://pexels.com/3' },
    { file: 'focus_001.mp4', tags: ['focus'], title: 'K1', creator: 'D', license: 'Pexels', source: 'https://pexels.com/4' },
    { file: 'sport_002.mp4', tags: ['sport'], title: 'S2', creator: 'E', license: 'Pexels', source: 'https://pexels.com/5' },
  ];

  const mod = await import('../content_script.js?t=' + Date.now());
  return mod;
}

let mod;
beforeEach(async () => {
  document.body.innerHTML = '';
  mod = await loadModule();
  mod._resetForTest();
});

afterEach(() => {
  mod._resetForTest();
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

// ===========================================================================
// _escHtml
// ===========================================================================
describe('_escHtml()', () => {
  it('escapes ampersands', () => {
    expect(mod._escHtml('a & b')).toBe('a &amp; b');
  });
  it('escapes less-than', () => {
    expect(mod._escHtml('<div>')).toBe('&lt;div&gt;');
  });
  it('escapes quotes', () => {
    expect(mod._escHtml('"hello"')).toBe('&quot;hello&quot;');
  });
  it('passes through safe strings unchanged', () => {
    expect(mod._escHtml('hello world 123')).toBe('hello world 123');
  });
  it('coerces non-strings', () => {
    expect(mod._escHtml(42)).toBe('42');
  });
});

// ===========================================================================
// _detectTag
// ===========================================================================
describe('_detectTag()', () => {
  it('detects sport tag', () => {
    expect(mod._detectTag('Tell me about sport training')).toBe('sport');
  });
  it('detects calm tag', () => {
    expect(mod._detectTag('Help me be calm')).toBe('calm');
  });
  it('detects funny tag', () => {
    expect(mod._detectTag('Write something funny')).toBe('funny');
  });
  it('detects focus tag', () => {
    expect(mod._detectTag('Help me focus on code')).toBe('focus');
  });
  it('returns null when no keyword matches', () => {
    expect(mod._detectTag('Tell me about the universe')).toBeNull();
  });
  it('returns null for empty string', () => {
    expect(mod._detectTag('')).toBeNull();
  });
  it('returns null for null input', () => {
    expect(mod._detectTag(null)).toBeNull();
  });
  it('is case-insensitive', () => {
    expect(mod._detectTag('SPORT SPORT')).toBe('sport');
  });
  it('matches first keyword, not second', () => {
    // KEYWORDS array: sport is first
    const result = mod._detectTag('sport and calm');
    expect(result).toBe('sport');
  });
});

// ===========================================================================
// _pickClips
// ===========================================================================
describe('_pickClips()', () => {
  it('returns the requested count when enough clips are in FEED', () => {
    const clips = mod._pickClips(3);
    expect(clips).toHaveLength(3);
  });

  it('returns fewer clips when FEED is smaller than requested', () => {
    global.FEED = [{ file: 'a.mp4', tags: ['calm'], title: 'A', creator: 'X', license: 'P', source: 'https://x.com' }];
    const clips = mod._pickClips(3);
    expect(clips.length).toBeLessThanOrEqual(1);
  });

  it('returns empty array when FEED is empty', () => {
    global.FEED = [];
    expect(mod._pickClips(3)).toEqual([]);
  });

  it('filters by active tag when promptMode is on', () => {
    mod._setPromptMode(true);
    mod._setActiveTag('sport');
    const clips = mod._pickClips(2);
    clips.forEach(c => expect(c.tags).toContain('sport'));
  });

  it('falls back to full feed if not enough tagged clips', () => {
    mod._setPromptMode(true);
    mod._setActiveTag('sport');
    // Only 2 sport clips in FEED; requesting 3 → falls back to full feed
    const clips = mod._pickClips(4);
    expect(clips.length).toBeGreaterThan(0);
  });

  it('ignores tag filter when promptMode is off', () => {
    mod._setPromptMode(false);
    mod._setActiveTag('sport');
    const clips = mod._pickClips(3);
    // Should draw from all tags — no filter applied
    expect(clips.length).toBe(3);
  });
});

// ===========================================================================
// _pickClips — vibe filter (feedTags)
// ===========================================================================
describe('_pickClips() vibe filter', () => {
  it('only returns clips matching enabled vibes', () => {
    mod._setFeedTags(['sport']);
    const clips = mod._pickClips(5);
    clips.forEach(c => expect(c.tags).toContain('sport'));
  });

  it('supports multiple enabled vibes', () => {
    mod._setFeedTags(['calm', 'funny']);
    const clips = mod._pickClips(5);
    clips.forEach(c =>
      expect(c.tags.includes('calm') || c.tags.includes('funny')).toBe(true));
  });

  it('excludes untagged (general) clips when a vibe filter is active', () => {
    global.FEED = [
      { file: 'general_01.mp4', tags: [],        title: 'G', creator: 'X', license: 'P', source: 'https://x.com' },
      { file: 'cats_01.mp4',    tags: ['cats'],  title: 'C', creator: 'X', license: 'P', source: 'https://x.com' },
    ];
    mod._setFeedTags(['cats']);
    const clips = mod._pickClips(2);
    expect(clips).toHaveLength(1);
    expect(clips[0].file).toBe('cats_01.mp4');
  });

  it('null feedTags means no filtering', () => {
    mod._setFeedTags(null);
    expect(mod._pickClips(3)).toHaveLength(3);
  });

  it('falls back to full feed when the filter matches nothing', () => {
    mod._setFeedTags(['dogs']); // stub FEED has no dogs clips
    const clips = mod._pickClips(3);
    expect(clips.length).toBe(3);
  });

  it('prompt-aware tag is ignored when excluded by the vibe filter', () => {
    mod._setPromptMode(true);
    mod._setActiveTag('sport');
    mod._setFeedTags(['calm']);
    const clips = mod._pickClips(1);
    expect(clips[0].tags).toContain('calm');
  });

  it('prompt-aware tag ranks within the vibe pool when enabled', () => {
    mod._setPromptMode(true);
    mod._setActiveTag('sport');
    mod._setFeedTags(['sport', 'calm']);
    const clips = mod._pickClips(2);
    clips.forEach(c => expect(c.tags).toContain('sport'));
  });
});

// ===========================================================================
// Scroll-to-advance reels
// ===========================================================================
describe('reels: _advanceReel()', () => {
  it('scrolling forward swaps in the next playlist clip', () => {
    mod._showOverlay();
    const before = mod.getVideos()[0].getAttribute('data-file');
    expect(mod._advanceReel(0, 1)).toBe(true);
    const after = mod.getVideos()[0].getAttribute('data-file');
    expect(after).not.toBe(before);
  });

  it('scrolling back restores the previous clip', () => {
    mod._showOverlay();
    const first = mod.getVideos()[0].getAttribute('data-file');
    mod._advanceReel(0, 1);
    expect(mod._advanceReel(0, -1)).toBe(true);
    expect(mod.getVideos()[0].getAttribute('data-file')).toBe(first);
  });

  it('scrolling back with no history is a no-op', () => {
    mod._showOverlay();
    expect(mod._advanceReel(0, -1)).toBe(false);
  });

  it('cycles the playlist without running out', () => {
    mod._showOverlay();
    for (let i = 0; i < 15; i++) expect(mod._advanceReel(1, 1)).toBe(true);
    expect(mod.getVideos()[1].getAttribute('data-file')).toBeTruthy();
  });

  it('panels advance independently', () => {
    mod._showOverlay();
    const p1 = mod.getVideos()[1].getAttribute('data-file');
    mod._advanceReel(0, 1);
    expect(mod.getVideos()[1].getAttribute('data-file')).toBe(p1);
  });

  it('interacting with a panel makes it the sound target', () => {
    mod._showOverlay();
    expect(mod.getSoundIdx()).toBe(1); // centre by default
    mod._advanceReel(2, 1);
    expect(mod.getSoundIdx()).toBe(2);
  });

  it('is a no-op when no overlay is showing', () => {
    expect(mod._advanceReel(0, 1)).toBe(false);
  });

  it('wheel handler ignores tiny deltas', () => {
    mod._showOverlay();
    const before = mod.getVideos()[0].getAttribute('data-file');
    mod._onReelWheel(0, 5, null);
    expect(mod.getVideos()[0].getAttribute('data-file')).toBe(before);
  });
});

// ===========================================================================
// Sound targets one panel
// ===========================================================================
describe('sound targeting', () => {
  it('sound on unmutes only the target panel', () => {
    mod._setSoundOn(true);
    mod._showOverlay();
    const muted = mod.getVideos().map(v => v.muted);
    expect(muted.filter(m => !m)).toHaveLength(1);
    expect(muted[mod.getSoundIdx()]).toBe(false);
  });

  it('sound off mutes every panel', () => {
    mod._setSoundOn(false);
    mod._showOverlay();
    expect(mod.getVideos().every(v => v.muted)).toBe(true);
  });
});

// ===========================================================================
// Prompt-aware default
// ===========================================================================
describe('prompt-aware default', () => {
  it('boots ON when storage has no promptMode key', async () => {
    mod._boot();
    await new Promise(r => setTimeout(r, 0));
    expect(mod.getPromptMode()).toBe(true);
  });
});

// ===========================================================================
// PiP (mini player) mode
// ===========================================================================
describe('PiP overlay mode', () => {
  it('full mode renders 3 panels without the pip class', () => {
    mod._showOverlay();
    const el = document.getElementById('doombreak-overlay');
    expect(el.classList.contains('db-pip')).toBe(false);
    expect(el.querySelectorAll('.db-panel')).toHaveLength(3);
  });

  it('pip mode renders a single panel with the pip class', () => {
    mod._setOverlayMode('pip');
    mod._showOverlay();
    const el = document.getElementById('doombreak-overlay');
    expect(el.classList.contains('db-pip')).toBe(true);
    expect(el.querySelectorAll('.db-panel')).toHaveLength(1);
  });

  it('pip overlay still has close and sound controls', () => {
    mod._setOverlayMode('pip');
    mod._showOverlay();
    expect(document.getElementById('doombreak-close')).not.toBeNull();
    expect(document.getElementById('doombreak-sound')).not.toBeNull();
  });
});

// ===========================================================================
// Slogans
// ===========================================================================
describe('slogans', () => {
  it('_currentSlogan() returns a string', () => {
    expect(typeof mod._currentSlogan()).toBe('string');
  });

  it('_nextSlogan() advances the index', () => {
    const first  = mod._currentSlogan();
    mod._nextSlogan();
    const second = mod._currentSlogan();
    expect(second).not.toBe(first);
  });

  it('_nextSlogan() wraps around', () => {
    // SLOGANS has 3 items; advance 3 times to wrap
    mod._nextSlogan();
    mod._nextSlogan();
    mod._nextSlogan();
    expect(mod._currentSlogan()).toBe(mod._currentSlogan()); // stable after wrap
  });
});

// ===========================================================================
// State machine — _tick()
// ===========================================================================
describe('_tick() state transitions', () => {
  function snap(overrides) {
    return Object.assign({ generating: false, turnCount: 0, signature: 0, lastUserPrompt: '' }, overrides);
  }

  // ── idle → thinking ──────────────────────────────────────────────────────
  it('transitions idle → thinking when generation starts', () => {
    expect(mod.getState()).toBe('idle');
    mod._tick(snap({ generating: true }));
    expect(mod.getState()).toBe('thinking');
  });

  it('shows the overlay on idle → thinking', () => {
    mod._tick(snap({ generating: true }));
    expect(document.getElementById('doombreak-overlay')).not.toBeNull();
  });

  // ── thinking → typing ────────────────────────────────────────────────────
  it('transitions thinking → typing when signature changes', () => {
    mod._tick(snap({ generating: true }));             // idle → thinking
    mod._tick(snap({ generating: true, signature: 500 })); // thinking → typing
    expect(mod.getState()).toBe('typing');
  });

  it('does NOT transition thinking → typing when signature is still 0', () => {
    mod._tick(snap({ generating: true }));
    mod._tick(snap({ generating: true, signature: 0 }));
    expect(mod.getState()).toBe('thinking');
  });

  it('stays typing while signature keeps changing', () => {
    mod._tick(snap({ generating: true }));
    mod._tick(snap({ generating: true, signature: 100 }));
    mod._tick(snap({ generating: true, signature: 200 }));
    expect(mod.getState()).toBe('typing');
  });

  // ── typing → idle ─────────────────────────────────────────────────────
  it('transitions typing → idle when generation stops', () => {
    mod._tick(snap({ generating: true }));
    mod._tick(snap({ generating: true, signature: 100 }));
    mod._tick(snap({ generating: false }));
    expect(mod.getState()).toBe('idle');
  });

  it('transitions thinking → idle when generation stops before typing', () => {
    mod._tick(snap({ generating: true }));
    mod._tick(snap({ generating: false }));
    expect(mod.getState()).toBe('idle');
  });

  // ── idle stability ────────────────────────────────────────────────────────
  it('stays idle when not generating', () => {
    mod._tick(snap({ generating: false }));
    mod._tick(snap({ generating: false }));
    expect(mod.getState()).toBe('idle');
  });

  // ── signature reset ────────────────────────────────────────────────────
  it('resets lastSignature to 0 after returning to idle', () => {
    mod._tick(snap({ generating: true }));
    mod._tick(snap({ generating: true, signature: 500 }));
    mod._tick(snap({ generating: false }));
    expect(mod.getLastSig()).toBe(0);
  });

  // ── suppress logic ────────────────────────────────────────────────────
  it('does NOT show overlay when suppressUntilDone is true', () => {
    mod._setSuppressed(true);
    mod._tick(snap({ generating: true }));
    expect(document.getElementById('doombreak-overlay')).toBeNull();
  });

  it('still tracks state internally while suppressed', () => {
    mod._setSuppressed(true);
    mod._tick(snap({ generating: true }));
    expect(mod.getState()).toBe('thinking');
  });

  it('clears suppressUntilDone when generation ends', () => {
    mod._setSuppressed(true);
    mod._tick(snap({ generating: true }));
    mod._tick(snap({ generating: false }));
    expect(mod.isSuppressed()).toBe(false);
  });

  it('shows overlay again after suppress is cleared (next generation)', () => {
    mod._setSuppressed(true);
    mod._tick(snap({ generating: true }));
    mod._tick(snap({ generating: false })); // clears suppress
    mod._tick(snap({ generating: true }));  // next generation
    expect(document.getElementById('doombreak-overlay')).not.toBeNull();
  });

  // ── multiple generation cycles ────────────────────────────────────────
  it('handles multiple full generation cycles cleanly', () => {
    for (let i = 0; i < 3; i++) {
      mod._tick(snap({ generating: true }));
      mod._tick(snap({ generating: true, signature: i * 100 + 1 }));
      mod._tick(snap({ generating: false }));
      expect(mod.getState()).toBe('idle');
    }
  });
});

// ===========================================================================
// Overlay lifecycle
// ===========================================================================
describe('overlay lifecycle', () => {
  it('_showOverlay() creates #doombreak-overlay in the DOM', () => {
    mod._showOverlay();
    expect(document.getElementById('doombreak-overlay')).not.toBeNull();
  });

  it('_showOverlay() is idempotent (calling twice is safe)', () => {
    mod._showOverlay();
    mod._showOverlay();
    expect(document.querySelectorAll('#doombreak-overlay').length).toBe(1);
  });

  it('_hideOverlay() removes the overlay from DOM', () => {
    mod._showOverlay();
    mod._hideOverlay();
    expect(document.getElementById('doombreak-overlay')).toBeNull();
  });

  it('_hideOverlay() is safe to call when no overlay exists', () => {
    expect(() => mod._hideOverlay()).not.toThrow();
  });

  it('overlay contains the panel container', () => {
    mod._showOverlay();
    expect(document.getElementById('doombreak-panels')).not.toBeNull();
  });

  it('overlay contains close button', () => {
    mod._showOverlay();
    expect(document.getElementById('doombreak-close')).not.toBeNull();
  });

  it('overlay contains sound button', () => {
    mod._showOverlay();
    expect(document.getElementById('doombreak-sound')).not.toBeNull();
  });

  it('overlay contains badge element', () => {
    mod._showOverlay();
    expect(document.getElementById('doombreak-badge')).not.toBeNull();
  });

  it('clicking close sets suppressUntilDone to true', () => {
    mod._showOverlay();
    document.getElementById('doombreak-close').click();
    expect(mod.isSuppressed()).toBe(true);
  });

  it('clicking close hides the overlay', () => {
    mod._showOverlay();
    document.getElementById('doombreak-close').click();
    expect(document.getElementById('doombreak-overlay')).toBeNull();
  });

  it('clicking sound toggles _soundOn', () => {
    mod._showOverlay();
    expect(mod.getSoundOn()).toBe(false);
    document.getElementById('doombreak-sound').click();
    expect(mod.getSoundOn()).toBe(true);
  });

  it('clicking sound twice returns to original state', () => {
    mod._showOverlay();
    document.getElementById('doombreak-sound').click();
    document.getElementById('doombreak-sound').click();
    expect(mod.getSoundOn()).toBe(false);
  });
});

// ===========================================================================
// _setBadge
// ===========================================================================
describe('_setBadge()', () => {
  it('sets text to "Thinking" for thinking state', () => {
    mod._showOverlay();
    mod._setBadge('thinking');
    expect(document.getElementById('doombreak-badge-text').textContent).toBe('Thinking');
  });

  it('sets text to "Typing" for typing state', () => {
    mod._showOverlay();
    mod._setBadge('typing');
    expect(document.getElementById('doombreak-badge-text').textContent).toBe('Typing');
  });

  it('does not throw if overlay is not present', () => {
    expect(() => mod._setBadge('thinking')).not.toThrow();
  });
});

// ===========================================================================
// _todayKey
// ===========================================================================
describe('_todayKey()', () => {
  it('returns a YYYY-MM-DD string', () => {
    const key = mod._todayKey();
    expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('matches today\'s date', () => {
    const expected = new Date().toISOString().slice(0, 10);
    expect(mod._todayKey()).toBe(expected);
  });
});

// ===========================================================================
// Prompt-aware tag detection integration
// ===========================================================================
describe('prompt-aware integration', () => {
  it('activeTag starts null', () => {
    expect(mod.getActiveTag()).toBeNull();
  });

  it('clips are filtered by detected tag when promptMode is on', () => {
    mod._setPromptMode(true);
    mod._setActiveTag('calm');
    const clips = mod._pickClips(1);
    if (clips.length > 0) {
      expect(clips[0].tags).toContain('calm');
    }
  });

  it('clips are unfiltered when promptMode is off regardless of activeTag', () => {
    mod._setPromptMode(false);
    mod._setActiveTag('sport');
    // Should not crash and should return clips from full pool
    const clips = mod._pickClips(3);
    expect(clips.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// _teardown
// ===========================================================================
describe('_teardown()', () => {
  it('removes overlay from DOM', () => {
    mod._showOverlay();
    expect(document.getElementById('doombreak-overlay')).not.toBeNull();
    mod._teardown();
    expect(document.getElementById('doombreak-overlay')).toBeNull();
  });

  it('is idempotent', () => {
    mod._teardown();
    expect(() => mod._teardown()).not.toThrow();
  });

  it('resets the state machine to idle', () => {
    mod._setState('thinking');
    mod._setSuppressed(true);
    mod._setLastSig(42);
    mod._teardown();
    expect(mod.getState()).toBe('idle');
    expect(mod.isSuppressed()).toBe(false);
    expect(mod.getLastSig()).toBe(0);
  });
});

// ===========================================================================
// _toggleOverlay (extension command + keyboard fallback)
// ===========================================================================
describe('_toggleOverlay()', () => {
  it('hides a visible overlay and suppresses until generation ends', () => {
    mod._setState('thinking');
    mod._showOverlay();
    mod._toggleOverlay();
    expect(document.getElementById('doombreak-overlay')).toBeNull();
    expect(mod.isSuppressed()).toBe(true);
  });

  it('re-shows the overlay while generating and suppressed', () => {
    mod._setState('thinking');
    mod._setSuppressed(true);
    mod._toggleOverlay();
    expect(document.getElementById('doombreak-overlay')).not.toBeNull();
    expect(mod.isSuppressed()).toBe(false);
  });

  it('restores the badge to the current state on re-show', () => {
    mod._setState('typing');
    mod._setSuppressed(true);
    mod._toggleOverlay();
    expect(document.getElementById('doombreak-badge-text').textContent).toBe('Typing');
  });

  it('does nothing when idle with no overlay', () => {
    mod._toggleOverlay();
    expect(document.getElementById('doombreak-overlay')).toBeNull();
  });

  it('cannot show the overlay after teardown (disabled mid-generation)', () => {
    mod._setState('thinking');
    mod._teardown();
    mod._toggleOverlay();
    expect(document.getElementById('doombreak-overlay')).toBeNull();
  });
});// ===========================================================================
// Fixture-based tests — run the REAL platform adapter against captured
// ChatGPT DOM snapshots (see tests/fixtures/CAPTURE.md; captured 2026-07-13
// from live chatgpt.com).
//
// Real-DOM note: in the earliest "thinking" moments the stop button exists
// but conversation turns have NOT rendered yet — so turn-count and
// last-user-prompt assertions run against the typing fixture, where turns
// are present. Signature=0 on thinking is exactly what the state machine
// relies on to distinguish thinking from typing.
// ===========================================================================

describe('ChatGPT DOM fixture tests', () => {
  let RealChatGPT, idleDoc, thinkingDoc, typingDoc;

  beforeEach(async () => {
    const fs   = await import('node:fs');
    const path = await import('node:path');
    const dir  = path.join(__dirname, 'fixtures');
    idleDoc     = fs.readFileSync(path.join(dir, 'chatgpt-idle.html'),     'utf8');
    thinkingDoc = fs.readFileSync(path.join(dir, 'chatgpt-thinking.html'), 'utf8');
    typingDoc   = fs.readFileSync(path.join(dir, 'chatgpt-typing.html'),   'utf8');

    // Load the real adapter (not the stub used by the other tests).
    vi.resetModules();
    global.chrome = makeChromeStub();
    const mod = await import('../platforms/chatgpt.js?fixture=' + Date.now());
    RealChatGPT = mod.ChatGPT;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('[fixture] detectGenerating() returns false on idle page', () => {
    document.body.innerHTML = idleDoc;
    expect(RealChatGPT.detectGenerating()).toBe(false);
  });

  it('[fixture] detectGenerating() returns true on thinking page', () => {
    document.body.innerHTML = thinkingDoc;
    expect(RealChatGPT.detectGenerating()).toBe(true);
  });

  it('[fixture] detectGenerating() returns true on typing page', () => {
    document.body.innerHTML = typingDoc;
    expect(RealChatGPT.detectGenerating()).toBe(true);
  });

  it('[fixture] getAssistantTurnCount() is > 0 on typing page', () => {
    document.body.innerHTML = typingDoc;
    expect(RealChatGPT.getAssistantTurnCount()).toBeGreaterThan(0);
  });

  it('[fixture] getAssistantSignature() is 0 at start of thinking', () => {
    document.body.innerHTML = thinkingDoc;
    // Thinking = stop button present but no assistant text yet
    expect(RealChatGPT.getAssistantSignature()).toBe(0);
  });

  it('[fixture] getAssistantSignature() is > 0 when typing has started', () => {
    document.body.innerHTML = typingDoc;
    expect(RealChatGPT.getAssistantSignature()).toBeGreaterThan(0);
  });

  it('[fixture] getLastUserPrompt() returns non-empty string on typing page', () => {
    document.body.innerHTML = typingDoc;
    expect(RealChatGPT.getLastUserPrompt().length).toBeGreaterThan(0);
  });
});
