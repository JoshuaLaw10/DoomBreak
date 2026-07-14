// tests/gemini.test.js
// Runs the Gemini platform adapter against real DOM snapshots captured from
// a logged-in gemini.google.com session on 2026-07-14 (npm run verify:gemini).
//
// Real-DOM notes encoded here:
//   - 'Stop response' button exists during thinking AND typing, gone at idle.
//   - <model-response> does NOT exist during early thinking → signature 0 is
//     the thinking signal (same behaviour as ChatGPT).
//   - <user-query> renders immediately after send (unlike ChatGPT).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(__dirname, 'fixtures');
const thinkingDoc = readFileSync(join(dir, 'gemini-thinking.html'), 'utf8');
const typingDoc   = readFileSync(join(dir, 'gemini-typing.html'),   'utf8');
const idleDoc     = readFileSync(join(dir, 'gemini-idle.html'),     'utf8');

let GeminiAI;
beforeEach(async () => {
  vi.resetModules();
  const mod = await import('../platforms/gemini.js?t=' + Date.now());
  GeminiAI = mod.GeminiAI;
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('Gemini DOM fixture tests', () => {
  it('[fixture] detectGenerating() returns false on idle page', () => {
    document.body.innerHTML = idleDoc;
    expect(GeminiAI.detectGenerating()).toBe(false);
  });

  it('[fixture] detectGenerating() returns true on thinking page', () => {
    document.body.innerHTML = thinkingDoc;
    expect(GeminiAI.detectGenerating()).toBe(true);
  });

  it('[fixture] detectGenerating() returns true on typing page', () => {
    document.body.innerHTML = typingDoc;
    expect(GeminiAI.detectGenerating()).toBe(true);
  });

  it('[fixture] getAssistantSignature() is 0 at start of thinking', () => {
    document.body.innerHTML = thinkingDoc;
    expect(GeminiAI.getAssistantSignature()).toBe(0);
  });

  it('[fixture] getAssistantSignature() is > 0 when typing has started', () => {
    document.body.innerHTML = typingDoc;
    expect(GeminiAI.getAssistantSignature()).toBeGreaterThan(0);
  });

  it('[fixture] getAssistantTurnCount() is > 0 on typing page', () => {
    document.body.innerHTML = typingDoc;
    expect(GeminiAI.getAssistantTurnCount()).toBeGreaterThan(0);
  });

  it('[fixture] getLastUserPrompt() is non-empty already on thinking page', () => {
    document.body.innerHTML = thinkingDoc;
    expect(GeminiAI.getLastUserPrompt().length).toBeGreaterThan(0);
  });

  it('[fixture] full state snapshot is coherent per phase', () => {
    document.body.innerHTML = thinkingDoc;
    let s = GeminiAI.getStateSnapshot();
    expect(s.generating).toBe(true);
    expect(s.signature).toBe(0);

    document.body.innerHTML = typingDoc;
    s = GeminiAI.getStateSnapshot();
    expect(s.generating).toBe(true);
    expect(s.signature).toBeGreaterThan(0);

    document.body.innerHTML = idleDoc;
    s = GeminiAI.getStateSnapshot();
    expect(s.generating).toBe(false);
  });
});
