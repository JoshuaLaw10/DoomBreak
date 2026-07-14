// platforms/gemini.js
// ============================================================
// Platform adapter for gemini.google.com.
// VERIFIED live 2026-07-14: overlay appeared and auto-closed on a real
// logged-in session; fixtures in tests/fixtures/gemini-*.html.
// Real-DOM notes: <model-response> does not exist during early thinking
// (signature 0 = thinking, same as ChatGPT); <user-query> renders
// immediately after send.
// ============================================================

'use strict';

// Verified against live gemini.google.com 2026-07-14 (fixture capture):
// 'Stop response' aria-label present during thinking+typing, absent idle.
var _GEMINI_STOP_SELECTORS = [
  'button[aria-label="Stop response"]',
  'button[aria-label*="Stop"]',
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
