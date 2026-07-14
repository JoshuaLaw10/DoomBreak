// platforms/claude.js
// ============================================================
// ⚠️ EXPERIMENTAL / UNVERIFIED — platform adapter for claude.ai.
//
// Selectors below are best-effort drafts and have NOT been
// validated against a logged-in claude.ai session (claude.ai has
// no logged-out chat, so the fixture-capture flow used for
// chatgpt.js doesn't work here). Before enabling this platform
// in a store build:
//   1. Capture fixtures per tests/fixtures/CAPTURE.md from a
//      logged-in claude.ai session (idle / thinking / typing).
//   2. Add a fixture test block mirroring the ChatGPT one.
//   3. Fix whatever the tests catch.
//
// Failure mode is safe: if no selector ever matches, the overlay
// simply never appears on claude.ai.
//
// Same public interface as platforms/chatgpt.js.
// ============================================================

'use strict';

var _CLAUDE_STOP_SELECTORS = [
  'button[aria-label="Stop response"]',
  'button[aria-label*="Stop"]',
  '[data-is-streaming="true"]', // streaming container doubles as a signal
];

var _CLAUDE_ASSISTANT_SEL = '[data-is-streaming], .font-claude-message, [data-testid="assistant-message"]';
var _CLAUDE_USER_SEL      = '[data-testid="user-message"]';

function _claudeFindStop() {
  for (var i = 0; i < _CLAUDE_STOP_SELECTORS.length; i++) {
    var el = document.querySelector(_CLAUDE_STOP_SELECTORS[i]);
    if (el) return el;
  }
  return null;
}

function _claudeAssistantEls() {
  return document.querySelectorAll(_CLAUDE_ASSISTANT_SEL);
}

var ClaudeAI = {
  detectGenerating: function() {
    return !!_claudeFindStop();
  },

  getLastUserPrompt: function() {
    var els = document.querySelectorAll(_CLAUDE_USER_SEL);
    for (var i = els.length - 1; i >= 0; i--) {
      var text = (els[i].textContent || '').trim();
      if (text) return text;
    }
    return '';
  },

  getAssistantTurnCount: function() {
    return _claudeAssistantEls().length;
  },

  getAssistantSignature: function() {
    var els = _claudeAssistantEls();
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
      document.querySelector('[role="main"]') ||
      document.documentElement
    );
  },

  // Telemetry is chatgpt-only for now; return empties so the popup and
  // content script degrade gracefully.
  getSelectorTelemetry: function() { return {}; },
  getStopSelectorKeys:  function() { return []; },

  getStateSnapshot: function() {
    return {
      generating:     !!_claudeFindStop(),
      turnCount:      this.getAssistantTurnCount(),
      signature:      this.getAssistantSignature(),
      lastUserPrompt: this.getLastUserPrompt(),
    };
  },
};

if (typeof window !== 'undefined') {
  window.__DB_PLATFORMS = window.__DB_PLATFORMS || [];
  window.__DB_PLATFORMS.push({ hosts: ['claude.ai'], adapter: ClaudeAI });
}

if (typeof module !== 'undefined') {
  module.exports = { ClaudeAI: ClaudeAI };
}
