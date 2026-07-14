// tests/registry.test.js
// Host-matching logic for the multi-platform registry.

import { describe, it, expect } from 'vitest';
import { _select } from '../platforms/registry.js';

const A = { name: 'A' };
const B = { name: 'B' };

const regs = [
  { hosts: ['chatgpt.com'], adapter: A },
  { hosts: ['claude.ai', 'gemini.google.com'], adapter: B },
];

describe('registry _select()', () => {
  it('matches an exact host', () => {
    expect(_select('chatgpt.com', regs)).toBe(A);
  });

  it('matches a subdomain', () => {
    expect(_select('www.chatgpt.com', regs)).toBe(A);
  });

  it('matches any host in a multi-host registration', () => {
    expect(_select('claude.ai', regs)).toBe(B);
    expect(_select('gemini.google.com', regs)).toBe(B);
  });

  it('does not match a lookalike suffix', () => {
    expect(_select('notchatgpt.com', regs)).toBeNull();
    expect(_select('evilchatgpt.com', regs)).toBeNull();
  });

  it('returns null when nothing matches', () => {
    expect(_select('example.com', regs)).toBeNull();
  });

  it('first registration wins on overlap', () => {
    const overlap = [
      { hosts: ['claude.ai'], adapter: A },
      { hosts: ['claude.ai'], adapter: B },
    ];
    expect(_select('claude.ai', overlap)).toBe(A);
  });
});
