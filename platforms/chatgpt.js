// platforms/chatgpt.js
// ============================================================
// Platform adapter for chatgpt.com.
//
// PUBLIC INTERFACE (consumed by content_script.js):
//   ChatGPT.detectGenerating()       → boolean
//   ChatGPT.getLastUserPrompt()      → string
//   ChatGPT.getAssistantTurnCount()  → number
//   ChatGPT.getAssistantSignature()  → number
//   ChatGPT.getObserverTarget()      → Element
//   ChatGPT.getSelectorTelemetry()   → { [key]: { lastMatch, count } }
//   ChatGPT.getStopSelectorKeys()    → string[]
//
// All DOM selectors are consolidated here. When OpenAI changes their
// markup, this is the ONLY file that needs updating.
//
// SELECTOR TELEMETRY:
//   Every successful selector match is recorded in memory and flushed
//   to chrome.storage.local at most once per 60 seconds. This data
//   powers the popup health check, which surfaces a warning when no
//   stop-button selector has matched in N days. The canary fires in
//   production, on real ChatGPT, with zero added infrastructure.
//
// Loaded as a plain script — exposes window.ChatGPT.
// ============================================================

'use strict';

// ---------------------------------------------------------------------------
// Selector catalogue
// Each entry has a stable KEY used for telemetry and a SELECTOR string.
// Listed from most-specific (most stable) to least-specific (broadest fallback).
// ---------------------------------------------------------------------------

var _STOP_SELECTORS = [
  { key: 'stop:testid',        sel: '[data-testid="stop-button"]' },
  { key: 'stop:button-testid', sel: 'button[data-testid="stop-button"]' },
  { key: 'stop:aria-stop-gen', sel: 'button[aria-label="Stop generating"]' },
  { key: 'stop:aria-stop-str', sel: 'button[aria-label="Stop streaming"]' },
];

var _STOP_FALLBACK_KEY = 'stop:composer-aria';

var _TURN_SELECTOR_PARTS = [
  // <section> observed on live chatgpt.com as of 2026-07 (fixture capture);
  // <article>/<div> kept as fallbacks for older/alternate shells.
  { key: 'turn:section-testid', sel: 'section[data-testid^="conversation-turn-"]' },
  { key: 'turn:article-testid', sel: 'article[data-testid^="conversation-turn-"]' },
  { key: 'turn:div-testid',     sel: 'div[data-testid^="conversation-turn-"]' },
];
var _TURN_SELECTOR_COMBINED = _TURN_SELECTOR_PARTS.map(function(p) { return p.sel; }).join(', ');

var _ASSISTANT_ROLE_ATTR = '[data-message-author-role="assistant"]';
var _USER_ROLE_ATTR      = '[data-message-author-role="user"]';

var _CONTENT_SELECTORS = [
  { key: 'content:markdown', sel: '.markdown' },
  { key: 'content:prose',    sel: '.prose' },
  { key: 'content:msg-attr', sel: '[data-message-content]' },
];

// ---------------------------------------------------------------------------
// Telemetry buffer
// Kept in memory; flushed to chrome.storage.local at most once per 60s.
// ---------------------------------------------------------------------------

var _telemetry = {
  selectors:    {}, // key -> { lastMatch: timestamp, count: number }
  lastFlushAt:  0,
  dirty:        false,
  hydrated:     false,
};

var _FLUSH_INTERVAL_MS  = 60 * 1000;
var _STORAGE_KEY        = 'selectorTelemetry';
var _MAX_SELECTORS_KEPT = 32; // cap to prevent unbounded growth

/** Hydrate the in-memory buffer from storage. Called once at module load. */
function _hydrateTelemetry() {
  if (_telemetry.hydrated) return;
  _telemetry.hydrated = true;

  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;

  try {
    chrome.storage.local.get([_STORAGE_KEY], function(result) {
      if (chrome.runtime && chrome.runtime.lastError) return;
      var saved = result && result[_STORAGE_KEY];
      if (!saved || typeof saved !== 'object') return;

      // Race condition: matches recorded between module load and hydrate
      // completion are already in _telemetry.selectors. We must merge,
      // not overwrite — taking the max of counts and lastMatch so we
      // never lose data either way.
      for (var key in saved) {
        var stored = saved[key];
        var live   = _telemetry.selectors[key];
        if (!live) {
          _telemetry.selectors[key] = stored;
        } else {
          _telemetry.selectors[key] = {
            count:     Math.max(stored.count     || 0, live.count     || 0),
            lastMatch: Math.max(stored.lastMatch || 0, live.lastMatch || 0),
          };
        }
      }
    });
  } catch (_) {
    // Storage unavailable (e.g. test environment) — silently no-op.
  }
}
_hydrateTelemetry();

/** Record that a selector successfully matched. */
function _recordMatch(selectorKey) {
  var now   = Date.now();
  var entry = _telemetry.selectors[selectorKey];
  if (!entry) {
    if (Object.keys(_telemetry.selectors).length >= _MAX_SELECTORS_KEPT) return;
    entry = _telemetry.selectors[selectorKey] = { lastMatch: now, count: 0 };
  }
  entry.lastMatch = now;
  entry.count++;
  _telemetry.dirty = true;
  _maybeFlush();
}

/** Flush telemetry to storage if 60s have passed since last flush. */
function _maybeFlush() {
  if (!_telemetry.dirty) return;
  var now = Date.now();
  if (now - _telemetry.lastFlushAt < _FLUSH_INTERVAL_MS) return;
  _telemetry.lastFlushAt = now;
  _telemetry.dirty       = false;

  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;

  try {
    var payload = {};
    payload[_STORAGE_KEY] = _telemetry.selectors;
    chrome.storage.local.set(payload);
  } catch (_) {
    _telemetry.dirty = true; // retry on next match
  }
}

// ---------------------------------------------------------------------------
// Internal helpers (each records telemetry when a selector matches)
// ---------------------------------------------------------------------------

function _findStopButton() {
  for (var i = 0; i < _STOP_SELECTORS.length; i++) {
    var s  = _STOP_SELECTORS[i];
    var el = document.querySelector(s.sel);
    if (el) { _recordMatch(s.key); return el; }
  }

  var form = document.querySelector('form');
  if (form) {
    var btn = form.querySelector('button[aria-label*="Stop"], button[aria-label*="stop"]');
    if (btn) { _recordMatch(_STOP_FALLBACK_KEY); return btn; }
  }

  return null;
}

function _findTurns() {
  for (var i = 0; i < _TURN_SELECTOR_PARTS.length; i++) {
    var p     = _TURN_SELECTOR_PARTS[i];
    var nodes = document.querySelectorAll(p.sel);
    if (nodes.length) {
      _recordMatch(p.key);
      // Use the combined selector for the actual return so we don't miss
      // turns that match a different variant simultaneously.
      return document.querySelectorAll(_TURN_SELECTOR_COMBINED);
    }
  }
  return document.querySelectorAll(_TURN_SELECTOR_COMBINED); // empty NodeList
}

function _contentEl(assistantEl) {
  for (var i = 0; i < _CONTENT_SELECTORS.length; i++) {
    var s  = _CONTENT_SELECTORS[i];
    var el = assistantEl.querySelector(s.sel);
    if (el) { _recordMatch(s.key); return el; }
  }
  return assistantEl;
}

function _assistantElFromTurn(turn) {
  if (turn.matches && turn.matches(_ASSISTANT_ROLE_ATTR)) return turn;
  return turn.querySelector(_ASSISTANT_ROLE_ATTR);
}

function _userElFromTurn(turn) {
  if (turn.matches && turn.matches(_USER_ROLE_ATTR)) return turn;
  return turn.querySelector(_USER_ROLE_ATTR);
}

// ---------------------------------------------------------------------------
// State derivation primitives (single source of truth)
//
// Both the individual public methods and getStateSnapshot delegate here.
// Each takes a pre-fetched `turns` NodeList so callers that need multiple
// values pay for only one DOM walk.
// ---------------------------------------------------------------------------

function _deriveTurnCount(turns) {
  var count = 0;
  for (var i = 0; i < turns.length; i++) {
    if (_assistantElFromTurn(turns[i])) count++;
  }
  return count;
}

function _deriveSignature(turns) {
  var scanFrom = Math.max(0, turns.length - 4);
  for (var i = turns.length - 1; i >= scanFrom; i--) {
    var assistantEl = _assistantElFromTurn(turns[i]);
    if (!assistantEl) continue;

    var content = _contentEl(assistantEl);
    var text    = (content.textContent || '').trim();
    var html    = (content.innerHTML   || '').trim();

    if (text.length === 0 && html.length === 0) continue;

    return (text.length * 1000) + Math.min(html.length, 200000);
  }
  return 0;
}

function _deriveLastUserPrompt(turns) {
  for (var i = turns.length - 1; i >= 0; i--) {
    var userEl = _userElFromTurn(turns[i]);
    if (!userEl) continue;
    var text = (userEl.textContent || '').trim();
    if (text) return text;
  }
  return '';
}

// ---------------------------------------------------------------------------
// PUBLIC API
// ---------------------------------------------------------------------------

var ChatGPT = {

  detectGenerating: function() {
    return !!_findStopButton();
  },

  getLastUserPrompt: function() {
    return _deriveLastUserPrompt(_findTurns());
  },

  getAssistantTurnCount: function() {
    return _deriveTurnCount(_findTurns());
  },

  getAssistantSignature: function() {
    return _deriveSignature(_findTurns());
  },

  getObserverTarget: function() {
    return (
      document.querySelector('main') ||
      document.querySelector('[role="main"]') ||
      document.querySelector('#__next') ||
      document.documentElement
    );
  },

  /** Snapshot of in-memory telemetry. Returned object is safe to mutate. */
  getSelectorTelemetry: function() {
    var out = {};
    for (var key in _telemetry.selectors) {
      out[key] = {
        lastMatch: _telemetry.selectors[key].lastMatch,
        count:     _telemetry.selectors[key].count,
      };
    }
    return out;
  },

  /** All selector keys that participate in detectGenerating. */
  getStopSelectorKeys: function() {
    var keys = _STOP_SELECTORS.map(function(s) { return s.key; });
    keys.push(_STOP_FALLBACK_KEY);
    return keys;
  },

  /**
   * Derives all state-detection values in a single DOM pass.
   * Called every 250ms during streaming, so cheaper than calling each
   * accessor individually (which would do multiple full querySelectorAll
   * walks on the conversation tree per tick).
   *
   * Returns: { generating, turnCount, signature, lastUserPrompt }
   *
   * Individual methods (detectGenerating, getAssistantTurnCount, etc.)
   * remain for tests and external use; the hot path uses this snapshot.
   */
  getStateSnapshot: function() {
    var turns = _findTurns();
    return {
      generating:     !!_findStopButton(),
      turnCount:      _deriveTurnCount(turns),
      signature:      _deriveSignature(turns),
      lastUserPrompt: _deriveLastUserPrompt(turns),
    };
  },
};

// Register with the multi-platform registry (platforms/registry.js).
if (typeof window !== 'undefined') {
  window.__DB_PLATFORMS = window.__DB_PLATFORMS || [];
  window.__DB_PLATFORMS.push({ hosts: ['chatgpt.com'], adapter: ChatGPT });
}

// ---------------------------------------------------------------------------
// Test exports — expose internals for telemetry tests.
// ---------------------------------------------------------------------------
if (typeof module !== 'undefined') {
  module.exports = {
    ChatGPT: ChatGPT,
    _resetTelemetry: function() {
      _telemetry.selectors    = {};
      _telemetry.lastFlushAt  = 0;
      _telemetry.dirty        = false;
    },
    _forceFlush: function() {
      _telemetry.lastFlushAt = 0;
      _maybeFlush();
    },
    _getTelemetryBuffer: function() {
      return _telemetry;
    },
  };
}
