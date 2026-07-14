// platforms/gemini.js
// ============================================================
// ⚠️ EXPERIMENTAL / UNVERIFIED — platform adapter for
// gemini.google.com. Same caveats as platforms/claude.js: these
// selectors are drafts, unvalidated without a logged-in session.
// Capture fixtures + add tests before enabling in a store build.
//
// Failure mode is safe: no selector match → no overlay.
// ============================================================

'use strict';

var _GEMINI_STOP_SELECTORS = [
  'button[aria-label="Stop response"]',
  'button[aria-label*="Stop"]',
  '.stop-icon',
];

var _GEMINI_ASSISTANT_SEL = 'model-response, message-content, [id^="model-response-message"]';
var _GEMINI_USER_SEL      = 'user-query, .query-text';

function _geminiFindStop() {
  for (var i = 0; i < _GEMINI_STOP_SELECTORS.length; i++) {
    var el = document.querySelector(_GEMINI_STOP_SELECTORS[i]);
    if (el) return el;
  }
  return null;
}

var GeminiAI = {
  detectGenerating: function() {
    return !!_geminiFindStop();
  },

  getLastUserPrompt: function() {
    var els = document.querySelectorAll(_GEMINI_USER_SEL);
    for (var i = els.length - 1; i >= 0; i--) {
      var text = (els[i].textContent || '').trim();
      if (text) return text;
    }
    return '';
  },

  getAssistantTurnCount: function() {
    return document.querySelectorAll(_GEMINI_ASSISTANT_SEL).length;
  },

  getAssistantSignature: function() {
    var els = document.querySelectorAll(_GEMINI_ASSISTANT_SEL);
    for (var i = els.length - 1; i >= 0; i--) {
      var text = (els[i].textContent || '').trim();
      var html = (els[i].innerHTML   || '').trim();
      if (!text.length && !html.length) continue;
      return (text.length * 1000) + Math.min(html.length, 200000);
    }
    return 0;
  },

  getObserverTarget: function() {
    return (
      document.querySelector('main') ||
      document.querySelector('chat-window') ||
      document.documentElement
    );
  },

  getSelectorTelemetry: function() { return {}; },
  getStopSelectorKeys:  function() { return []; },

  getStateSnapshot: function() {
    return {
      generating:     !!_geminiFindStop(),
      turnCount:      this.getAssistantTurnCount(),
      signature:      this.getAssistantSignature(),
      lastUserPrompt: this.getLastUserPrompt(),
    };
  },
};

if (typeof window !== 'undefined') {
  window.__DB_PLATFORMS = window.__DB_PLATFORMS || [];
  window.__DB_PLATFORMS.push({ hosts: ['gemini.google.com'], adapter: GeminiAI });
}

if (typeof module !== 'undefined') {
  module.exports = { GeminiAI: GeminiAI };
}
