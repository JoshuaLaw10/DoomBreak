// service_worker.js
// ============================================================
// Doomscroll Break — background service worker (MV3).
//
// Responsibilities:
//   1. Initialise chrome.storage.local on first install.
//   2. Route messages from the popup / content script.
//
// NOTE: No external network calls are made. The old oEmbed
// integration has been removed — all clips are local MP4 assets.
// ============================================================

'use strict';

// ---------------------------------------------------------------------------
// Install / update handler
// ---------------------------------------------------------------------------
chrome.runtime.onInstalled.addListener(function(details) {
  // Fill in defaults for MISSING keys only. 'install' can re-fire for the
  // same profile (reinstall, unpacked dev reload) — blind set() here would
  // wipe the user's streak, prefs, and selector telemetry.
  if (details.reason !== 'install') return;

  var DEFAULTS = {
    enabled:     true,    // extension on by default
    soundOn:     false,   // sound off by default
    promptMode:  false,   // prompt-aware mode off by default
    sloganIndex: 0,
    autoCloseStreak: {},
    selectorTelemetry: {},
  };

  chrome.storage.local.get(Object.keys(DEFAULTS), function(existing) {
    var toSet = {};
    for (var key in DEFAULTS) {
      if (existing[key] === undefined) toSet[key] = DEFAULTS[key];
    }
    if (Object.keys(toSet).length) chrome.storage.local.set(toSet);
  });
});

// ---------------------------------------------------------------------------
// Keyboard command routing
// The manifest registers "toggle-overlay" (Cmd/Ctrl+Shift+D). Chrome consumes
// the keystroke before the page sees it, so the content script's keydown
// fallback only fires if the command failed to register (shortcut conflict).
// ---------------------------------------------------------------------------
chrome.commands.onCommand.addListener(function(command) {
  if (command !== 'toggle-overlay') return;
  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    if (!tabs || !tabs[0] || tabs[0].id === undefined) return;
    chrome.tabs.sendMessage(tabs[0].id, { type: 'TOGGLE_OVERLAY' }, function() {
      // Swallow "no receiving end" when the active tab isn't chatgpt.com.
      void chrome.runtime.lastError;
    });
  });
});

// ---------------------------------------------------------------------------
// Message routing
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener(function(msg, _sender, sendResponse) {
  if (!msg || typeof msg.type !== 'string') return;

  if (msg.type === 'PING') {
    sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
    return; // synchronous
  }

  // Unrecognised message type — respond gracefully.
  sendResponse({ ok: false, error: 'unknown message type: ' + msg.type });
});
