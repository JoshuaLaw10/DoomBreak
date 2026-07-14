// content_script.js
// ============================================================
// Doomscroll Break — main content script.
//
// Loaded after (manifest.json load order):
//   data/keywords.js   → window.KEYWORDS
//   data/slogans.js    → window.SLOGANS
//   data/feed.js       → window.FEED
//   platforms/chatgpt.js → window.ChatGPT
//
// ARCHITECTURE
//   - All DOM selectors live in platforms/chatgpt.js.
//     This file NEVER touches raw CSS selectors.
//   - Detection runs via an edge-triggered MutationObserver
//     backed by a 250 ms heartbeat.
//   - ChatGPT.getStateSnapshot() is the single DOM-read
//     per tick (one querySelectorAll pass, not four).
//   - State machine: idle → thinking → typing → idle.
//   - Video elements are tracked and released on close/unload
//     to prevent memory leaks.
//   - Adaptive cooldown: 400 ms default; 700 ms when prompt-
//     aware mode is on (gives clip selection time to settle).
// ============================================================

'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
var HEARTBEAT_MS        = 250;   // polling cadence while generating
var COOLDOWN_DEFAULT_MS = 400;   // debounce on observer mutations
var COOLDOWN_AWARE_MS   = 700;   // debounce when prompt-aware mode is on
var SLOGAN_STORAGE_KEY  = 'sloganIndex';
var STREAK_STORAGE_KEY  = 'autoCloseStreak';
var SOUND_STORAGE_KEY   = 'soundOn';
var ENABLED_STORAGE_KEY = 'enabled';
var PROMPT_MODE_KEY     = 'promptMode';
var FEED_TAGS_KEY       = 'feedTags';    // array of enabled tags; missing = all
var OVERLAY_MODE_KEY    = 'overlayMode'; // 'full' (default) | 'pip'
var PANEL_COUNT         = 3;

// ---------------------------------------------------------------------------
// Module state  (reset in _resetForTest)
// ---------------------------------------------------------------------------
var _state          = 'idle';  // 'idle' | 'thinking' | 'typing'
var _overlayEl      = null;
var _observer       = null;
var _heartbeatTimer = null;
var _cooldownTimer  = null;
var _suppressUntilDone = false;
var _lastSignature  = 0;
var _soundOn        = false;
var _promptMode     = false;
var _feedTags       = null;    // enabled vibe tags; null = no filter (all clips)
var _overlayMode    = 'full';  // 'full' | 'pip'
var _activeTag      = null;    // tag detected from last prompt
var _videos         = [];      // tracked <video> elements for cleanup
var _sloganIndex    = 0;

// ---------------------------------------------------------------------------
// Helpers — storage
// ---------------------------------------------------------------------------

function _storageGet(keys, cb) {
  try {
    chrome.storage.local.get(keys, cb);
  } catch (_) {
    var fallback = {};
    keys.forEach(function(k) { fallback[k] = undefined; });
    cb(fallback);
  }
}

function _storageSet(obj) {
  try { chrome.storage.local.set(obj); } catch (_) { /* no-op in tests */ }
}

// ---------------------------------------------------------------------------
// Helpers — daily streak
// ---------------------------------------------------------------------------

function _todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function _incrementStreak(cb) {
  _storageGet([STREAK_STORAGE_KEY], function(res) {
    var raw   = res[STREAK_STORAGE_KEY] || {};
    var key   = _todayKey();
    var count = (raw[key] || 0) + 1;
    raw[key]  = count;

    // Prune entries older than 7 days to keep storage tidy
    var cutoff = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
    Object.keys(raw).forEach(function(k) {
      if (k < cutoff) delete raw[k];
    });

    _storageSet({ [STREAK_STORAGE_KEY]: raw });
    if (cb) cb(count);
  });
}

function _getTodayStreak(cb) {
  _storageGet([STREAK_STORAGE_KEY], function(res) {
    var raw = res[STREAK_STORAGE_KEY] || {};
    cb(raw[_todayKey()] || 0);
  });
}

// ---------------------------------------------------------------------------
// Helpers — slogans
// ---------------------------------------------------------------------------

function _nextSlogan() {
  var slogans = (typeof SLOGANS !== 'undefined' && SLOGANS.length) ? SLOGANS : ['Taking a break…'];
  _sloganIndex = (_sloganIndex + 1) % slogans.length;
  _storageSet({ [SLOGAN_STORAGE_KEY]: _sloganIndex });
  return slogans[_sloganIndex];
}

function _currentSlogan() {
  var slogans = (typeof SLOGANS !== 'undefined' && SLOGANS.length) ? SLOGANS : ['Taking a break…'];
  return slogans[_sloganIndex % slogans.length];
}

function _loadSloganIndex(cb) {
  _storageGet([SLOGAN_STORAGE_KEY], function(res) {
    _sloganIndex = res[SLOGAN_STORAGE_KEY] || 0;
    if (cb) cb();
  });
}

// ---------------------------------------------------------------------------
// Helpers — prompt-aware tag detection
// ---------------------------------------------------------------------------

function _detectTag(prompt) {
  if (!prompt || typeof prompt !== 'string') return null;
  var lower = prompt.toLowerCase();
  var keywords = (typeof KEYWORDS !== 'undefined') ? KEYWORDS : [];
  for (var i = 0; i < keywords.length; i++) {
    if (keywords[i].pattern.test(lower)) return keywords[i].tag;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helpers — clip selection
// ---------------------------------------------------------------------------

function _pickClips(count) {
  var feed = (typeof FEED !== 'undefined' && FEED.length) ? FEED : [];
  if (!feed.length) return [];

  // 1. Vibe filter — user-selected tags from the popup. Untagged (general)
  //    clips only appear when no filter is active. If the filter empties the
  //    pool (e.g. a stale tag), fall back to the full feed rather than
  //    showing blank panels.
  var pool = feed;
  if (Array.isArray(_feedTags) && _feedTags.length) {
    var vibed = feed.filter(function(c) {
      if (!Array.isArray(c.tags) || !c.tags.length) return false;
      for (var i = 0; i < c.tags.length; i++) {
        if (_feedTags.indexOf(c.tags[i]) !== -1) return true;
      }
      return false;
    });
    if (vibed.length) pool = vibed;
  }

  // 2. Prompt-aware ranking — only within the vibe-enabled pool, and only if
  //    the detected tag isn't excluded by the user's vibe selection.
  if (_promptMode && _activeTag &&
      (!Array.isArray(_feedTags) || !_feedTags.length || _feedTags.indexOf(_activeTag) !== -1)) {
    var tagged = pool.filter(function(c) {
      return Array.isArray(c.tags) && c.tags.indexOf(_activeTag) !== -1;
    });
    if (tagged.length >= count) pool = tagged;
    // If not enough tagged clips, fall back to the vibe pool
  }

  // Shuffle and pick `count` unique clips
  var shuffled = pool.slice().sort(function() { return Math.random() - 0.5; });
  return shuffled.slice(0, count);
}

// ---------------------------------------------------------------------------
// Overlay — build DOM
// ---------------------------------------------------------------------------

function _buildOverlay(clips) {
  var el = document.createElement('div');
  el.id = 'doombreak-overlay';
  if (_overlayMode === 'pip') el.className = 'db-pip';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Doomscroll Break');

  var panelTarget = _overlayMode === 'pip' ? 1 : PANEL_COUNT;

  el.innerHTML = [
    '<style>',
    '#doombreak-overlay {',
    '  position:fixed;inset:0;z-index:2147483647;background:#000;',
    '  display:flex;flex-direction:column;font-family:system-ui,sans-serif;',
    '  animation:db-fadein .25s ease;',
    '}',
    '@keyframes db-fadein{from{opacity:0}to{opacity:1}}',
    '#doombreak-header {',
    '  position:absolute;top:0;left:0;right:0;z-index:2;',
    '  padding:14px 18px 32px;',
    '  background:linear-gradient(to bottom,rgba(0,0,0,.85) 0%,transparent 100%);',
    '  display:flex;align-items:center;gap:12px;',
    '}',
    '#doombreak-title { color:#fff;font-weight:800;font-size:15px;letter-spacing:.01em; }',
    '#doombreak-slogan { color:rgba(255,255,255,.65);font-size:12.5px; }',
    '#doombreak-badge {',
    '  margin-left:auto;display:flex;align-items:center;gap:6px;',
    '  background:rgba(255,255,255,.12);backdrop-filter:blur(6px);',
    '  border-radius:20px;padding:4px 10px;',
    '}',
    '#doombreak-badge-dot {',
    '  width:7px;height:7px;border-radius:50%;background:#facc15;',
    '  animation:db-pulse 1.2s ease-in-out infinite;',
    '}',
    '@keyframes db-pulse{0%,100%{opacity:1}50%{opacity:.35}}',
    '#doombreak-badge-text { color:#fff;font-size:11.5px;font-weight:700; }',
    '#doombreak-panels { display:flex;flex:1;gap:2px; }',
    '.db-panel { flex:1;overflow:hidden;position:relative;background:#111; }',
    '.db-panel video { width:100%;height:100%;object-fit:cover;display:block; }',
    '#doombreak-footer {',
    '  position:absolute;bottom:0;left:0;right:0;z-index:2;',
    '  padding:32px 18px 18px;',
    '  background:linear-gradient(to top,rgba(0,0,0,.85) 0%,transparent 100%);',
    '  display:flex;align-items:center;justify-content:space-between;',
    '}',
    '#doombreak-streak { color:rgba(255,255,255,.8);font-size:12px; }',
    '#doombreak-controls { display:flex;gap:10px; }',
    '.db-btn {',
    '  background:rgba(255,255,255,.15);backdrop-filter:blur(6px);',
    '  border:none;border-radius:20px;color:#fff;',
    '  padding:6px 14px;font-size:12px;font-weight:700;cursor:pointer;',
    '  transition:background .15s;',
    '}',
    '.db-btn:hover { background:rgba(255,255,255,.28); }',
    /* PiP (mini player) variant — corner overlay instead of full-screen */
    '#doombreak-overlay.db-pip {',
    '  inset:auto; right:18px; bottom:18px;',
    '  width:300px; height:480px;',
    '  border-radius:18px; overflow:hidden;',
    '  box-shadow:0 12px 40px rgba(0,0,0,.55);',
    '}',
    '#doombreak-overlay.db-pip #doombreak-slogan { display:none; }',
    '#doombreak-overlay.db-pip #doombreak-header { padding:10px 12px 24px; gap:8px; }',
    '#doombreak-overlay.db-pip #doombreak-title  { font-size:12.5px; }',
    '#doombreak-overlay.db-pip #doombreak-footer { padding:24px 12px 12px; }',
    '#doombreak-overlay.db-pip .db-btn { padding:5px 10px; font-size:11px; }',
    '</style>',

    '<div id="doombreak-header">',
    '  <span id="doombreak-title">🧠 Doomscroll Break</span>',
    '  <span id="doombreak-slogan">' + _escHtml(_currentSlogan()) + '</span>',
    '  <div id="doombreak-badge">',
    '    <div id="doombreak-badge-dot"></div>',
    '    <span id="doombreak-badge-text">Thinking</span>',
    '  </div>',
    '</div>',

    '<div id="doombreak-panels">',
    clips.map(function(clip) {
      var src = clip.file
        ? (typeof chrome !== 'undefined' && chrome.runtime
            ? chrome.runtime.getURL('media/' + clip.file)
            : 'media/' + clip.file)
        : '';
      return [
        '<div class="db-panel">',
        src ? '<video autoplay muted loop playsinline src="' + _escHtml(src) + '"></video>' : '',
        '</div>',
      ].join('');
    }).join(''),
    // Pad to the panel target if fewer clips
    Array(Math.max(0, panelTarget - clips.length)).fill('<div class="db-panel"></div>').join(''),
    '</div>',

    '<div id="doombreak-footer">',
    '  <span id="doombreak-streak"></span>',
    '  <div id="doombreak-controls">',
    '    <button class="db-btn" id="doombreak-sound">🔇 Sound</button>',
    '    <button class="db-btn" id="doombreak-close">✕ Close</button>',
    '  </div>',
    '</div>',
  ].join('\n');

  return el;
}

function _escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Overlay — lifecycle
// ---------------------------------------------------------------------------

function _showOverlay() {
  if (_overlayEl) return; // already showing

  var clips = _pickClips(_overlayMode === 'pip' ? 1 : PANEL_COUNT);
  _overlayEl = _buildOverlay(clips);
  document.body.appendChild(_overlayEl);

  // Track video elements for cleanup
  _videos = Array.from(_overlayEl.querySelectorAll('video'));

  // Apply sound preference
  _applySound();

  // Populate streak
  _getTodayStreak(function(count) {
    var el = document.getElementById('doombreak-streak');
    if (el) el.textContent = count > 0 ? '🔥 ' + count + ' break' + (count === 1 ? '' : 's') + ' today' : '';
  });

  // Wire close button
  var closeBtn = document.getElementById('doombreak-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', function() {
      _suppressUntilDone = true;
      _nextSlogan(); // rotate slogan on manual close
      _hideOverlay();
    });
  }

  // Wire sound button
  var soundBtn = document.getElementById('doombreak-sound');
  if (soundBtn) {
    soundBtn.addEventListener('click', function() {
      _soundOn = !_soundOn;
      _storageSet({ [SOUND_STORAGE_KEY]: _soundOn });
      _applySound();
    });
  }
}

function _hideOverlay() {
  if (!_overlayEl) return;
  _releaseVideos();
  _overlayEl.remove();
  _overlayEl = null;
}

function _autoClose() {
  if (!_overlayEl) return;
  _incrementStreak(function(count) {
    // Brief flash of the streak before closing
    var el = document.getElementById('doombreak-streak');
    if (el) el.textContent = '✅ ' + count + ' break' + (count === 1 ? '' : 's') + ' today';
    setTimeout(_hideOverlay, 600);
  });
}

function _setBadge(state) {
  var dot  = document.getElementById('doombreak-badge-dot');
  var text = document.getElementById('doombreak-badge-text');
  if (!text) return;
  if (state === 'thinking') {
    text.textContent = 'Thinking';
    if (dot) dot.style.background = '#facc15'; // yellow
  } else if (state === 'typing') {
    text.textContent = 'Typing';
    if (dot) dot.style.background = '#4ade80'; // green
  }
}

function _applySound() {
  var soundBtn = document.getElementById('doombreak-sound');
  _videos.forEach(function(v) { v.muted = !_soundOn; });
  if (soundBtn) soundBtn.textContent = _soundOn ? '🔊 Sound' : '🔇 Sound';
}

function _releaseVideos() {
  _videos.forEach(function(v) {
    v.pause();
    v.removeAttribute('src');
    v.load(); // release media resources
  });
  _videos = [];
}

// ---------------------------------------------------------------------------
// State machine — tick
// Receives a snapshot from ChatGPT.getStateSnapshot().
// Called on every observer notification and heartbeat.
// ---------------------------------------------------------------------------

function _tick(snapshot) {
  var generating = snapshot.generating;
  var signature  = snapshot.signature;

  if (generating) {
    if (_state === 'idle') {
      // Generation just started
      if (!_suppressUntilDone) {
        _state = 'thinking';
        _showOverlay();
        _setBadge('thinking');
      } else {
        _state = 'thinking'; // track internally even while suppressed
      }
      _lastSignature = signature;
    } else if (_state === 'thinking') {
      // Check if response text has started appearing
      if (signature !== 0 && signature !== _lastSignature) {
        _state = 'typing';
        _setBadge('typing');
        _lastSignature = signature;
      }
    } else if (_state === 'typing') {
      _lastSignature = signature;
    }
  } else {
    // Not generating
    if (_state !== 'idle') {
      // Generation just ended
      var wasVisible = !!_overlayEl;
      _state         = 'idle';
      _suppressUntilDone = false;
      _lastSignature  = 0;

      if (wasVisible) _autoClose();
    }
  }
}

// ---------------------------------------------------------------------------
// Observer + heartbeat lifecycle
// ---------------------------------------------------------------------------

function _platform() {
  // Registry-selected adapter for this host (platforms/registry.js), with a
  // ChatGPT fallback for tests and pre-registry load orders.
  if (typeof Platform !== 'undefined' && Platform) return Platform;
  if (typeof ChatGPT !== 'undefined') return ChatGPT;
  return null;
}

function _getSnapshot() {
  var p = _platform();
  if (p) return p.getStateSnapshot();
  return { generating: false, turnCount: 0, signature: 0, lastUserPrompt: '' };
}

function _onMutation() {
  // Capture the prompt while DOM is still intact
  var snap = _getSnapshot();
  if (snap.generating && snap.lastUserPrompt) {
    _activeTag = _detectTag(snap.lastUserPrompt);
  }
  _tick(snap);
}

function _startHeartbeat() {
  if (_heartbeatTimer) return;
  _heartbeatTimer = setInterval(function() {
    // Disconnect observer during heartbeat to avoid double-firing
    if (_observer) _observer.disconnect();
    var snap = _getSnapshot();
    _tick(snap);
    _reconnectObserver();
  }, HEARTBEAT_MS);
}

function _stopHeartbeat() {
  if (_heartbeatTimer) {
    clearInterval(_heartbeatTimer);
    _heartbeatTimer = null;
  }
}

function _reconnectObserver() {
  if (!_observer) return;
  var p = _platform();
  var target = p ? p.getObserverTarget() : document.body;
  _observer.observe(target || document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

function _startObserver() {
  if (_observer) return;
  _observer = new MutationObserver(function() {
    if (_cooldownTimer) return; // already pending
    var cooldown = _promptMode ? COOLDOWN_AWARE_MS : COOLDOWN_DEFAULT_MS;
    _cooldownTimer = setTimeout(function() {
      _cooldownTimer = null;
      _onMutation();
    }, cooldown);
  });
  _reconnectObserver();
}

function _teardown() {
  _stopHeartbeat();
  if (_observer) { _observer.disconnect(); _observer = null; }
  if (_cooldownTimer) { clearTimeout(_cooldownTimer); _cooldownTimer = null; }
  _hideOverlay();
  document.removeEventListener('keydown', _onKeyDown);
  // Reset the state machine so a toggle message arriving while disabled
  // can't resurrect the overlay (_toggleOverlay is a no-op from idle).
  _state             = 'idle';
  _suppressUntilDone = false;
  _lastSignature     = 0;
}

// ---------------------------------------------------------------------------
// Overlay toggle — shared by the extension command (via service worker
// message) and the in-page keyboard fallback.
// ---------------------------------------------------------------------------

function _toggleOverlay() {
  if (_overlayEl) {
    _suppressUntilDone = true;
    _nextSlogan();
    _hideOverlay();
  } else if (_state !== 'idle') {
    // Re-show overlay if generating but suppressed
    _suppressUntilDone = false;
    _showOverlay();
    _setBadge(_state === 'typing' ? 'typing' : 'thinking');
  }
}

// Keyboard fallback (Command/Ctrl+Shift+D). Only reachable when the manifest
// command failed to register (e.g. shortcut conflict), since Chrome consumes
// registered command keystrokes before the page sees them.
function _onKeyDown(e) {
  var mod = e.metaKey || e.ctrlKey;
  if (mod && e.shiftKey && !e.altKey && (e.key === 'd' || e.key === 'D')) {
    _toggleOverlay();
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function _boot() {
  // Load persisted preferences
  _storageGet([SOUND_STORAGE_KEY, PROMPT_MODE_KEY, ENABLED_STORAGE_KEY, FEED_TAGS_KEY, OVERLAY_MODE_KEY], function(res) {
    _soundOn     = !!res[SOUND_STORAGE_KEY];
    _promptMode  = !!res[PROMPT_MODE_KEY];
    _feedTags    = Array.isArray(res[FEED_TAGS_KEY]) ? res[FEED_TAGS_KEY] : null;
    _overlayMode = res[OVERLAY_MODE_KEY] === 'pip' ? 'pip' : 'full';
    var enabled  = res[ENABLED_STORAGE_KEY] !== false; // default enabled

    if (!enabled) return;

    _loadSloganIndex(function() {
      _startObserver();
      _startHeartbeat();
      document.addEventListener('keydown', _onKeyDown);
    });
  });
}

// Tear down when the page is hidden for navigation ('unload' is deprecated
// and blocks back/forward cache). Re-boot on bfcache restore.
window.addEventListener('pagehide', _teardown);
window.addEventListener('pageshow', function(e) {
  if (e.persisted) _boot();
});

// Toggle command relayed by the service worker (chrome.commands)
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener(function(msg) {
    if (msg && msg.type === 'TOGGLE_OVERLAY') _toggleOverlay();
  });
}

// Listen for storage changes (toggling enabled/promptMode from popup)
if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener(function(changes, area) {
    if (area !== 'local') return;
    if (changes[ENABLED_STORAGE_KEY]) {
      var nowEnabled = changes[ENABLED_STORAGE_KEY].newValue !== false;
      if (!nowEnabled) _teardown();
      else _boot();
    }
    if (changes[PROMPT_MODE_KEY]) {
      _promptMode = !!changes[PROMPT_MODE_KEY].newValue;
    }
    if (changes[FEED_TAGS_KEY]) {
      var v = changes[FEED_TAGS_KEY].newValue;
      _feedTags = Array.isArray(v) ? v : null;
    }
    if (changes[OVERLAY_MODE_KEY]) {
      _overlayMode = changes[OVERLAY_MODE_KEY].newValue === 'pip' ? 'pip' : 'full';
      // Applies on the next overlay; a visible overlay keeps its layout.
    }
  });
}

_boot();

// ---------------------------------------------------------------------------
// Test exports — expose internals for unit tests.
// The `if (typeof module !== 'undefined')` guard means this block
// never runs in the browser context.
// ---------------------------------------------------------------------------
if (typeof module !== 'undefined') {
  module.exports = {
    // State accessors
    getState:       function() { return _state; },
    getOverlay:     function() { return _overlayEl; },
    isSuppressed:   function() { return _suppressUntilDone; },
    getActiveTag:   function() { return _activeTag; },
    getLastSig:     function() { return _lastSignature; },
    getSoundOn:     function() { return _soundOn; },
    getPromptMode:  function() { return _promptMode; },
    getFeedTags:    function() { return _feedTags; },
    getOverlayMode: function() { return _overlayMode; },

    // Functions under test
    _tick:          _tick,
    _detectTag:     _detectTag,
    _pickClips:     _pickClips,
    _escHtml:       _escHtml,
    _currentSlogan: _currentSlogan,
    _nextSlogan:    _nextSlogan,
    _todayKey:      _todayKey,
    _setBadge:      _setBadge,
    _showOverlay:   _showOverlay,
    _hideOverlay:   _hideOverlay,
    _autoClose:     _autoClose,
    _boot:          _boot,
    _teardown:      _teardown,
    _toggleOverlay: _toggleOverlay,

    // Test helpers
    _resetForTest: function() {
      _teardown();
      _state             = 'idle';
      _overlayEl         = null;
      _observer          = null;
      _heartbeatTimer    = null;
      _cooldownTimer     = null;
      _suppressUntilDone = false;
      _lastSignature     = 0;
      _soundOn           = false;
      _promptMode        = false;
      _feedTags          = null;
      _overlayMode       = 'full';
      _activeTag         = null;
      _videos            = [];
      _sloganIndex       = 0;
    },

    _setState:   function(s) { _state = s; },
    _setSuppressed: function(v) { _suppressUntilDone = v; },
    _setActiveTag:  function(t) { _activeTag = t; },
    _setPromptMode: function(v) { _promptMode = v; },
    _setFeedTags:   function(v) { _feedTags = v; },
    _setOverlayMode:function(v) { _overlayMode = v; },
    _setSoundOn:    function(v) { _soundOn = v; },
    _setLastSig:    function(v) { _lastSignature = v; },
    _setOverlay:    function(v) { _overlayEl = v; },
  };
}
