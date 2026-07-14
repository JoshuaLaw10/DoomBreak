#!/usr/bin/env node
// scripts/package.mjs
// =================================================================
// Builds the Chrome Web Store upload zip in dist/.
//
// Run:  npm run package            (refuses to build with an empty feed)
//       npm run package -- --force (dev build without clips)
//
// Only ships runtime files — no tests, docs, node_modules, or tooling.
// =================================================================

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');
const FORCE     = process.argv.includes('--force');

const SHIP = [
  'manifest.json',
  'content_script.js',
  'service_worker.js',
  'popup.html',
  'popup.js',
  'icons/icon-16.png',
  'icons/icon-32.png',
  'icons/icon-48.png',
  'icons/icon-128.png',
  'data/keywords.js',
  'data/slogans.js',
  'data/feed.js',
  'platforms/chatgpt.js',
  'platforms/gemini.js',
  'platforms/registry.js',
];

const errors = [];

// Every shipped file must exist.
for (const f of SHIP) {
  if (!existsSync(join(ROOT, f))) errors.push('missing shipped file: ' + f);
}

// Manifest must parse, and every content-script/icon path it names must ship.
const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf-8'));
for (const cs of manifest.content_scripts || []) {
  for (const js of cs.js || []) {
    if (!SHIP.includes(js)) errors.push('manifest content script not in SHIP list: ' + js);
  }
}

// Feed must have clips, and every clip must exist in media/.
const feedSrc = readFileSync(join(ROOT, 'data/feed.js'), 'utf-8');
const clipFiles = [...feedSrc.matchAll(/\bfile:\s*"([^"]+)"/g)].map(m => m[1]);
if (!clipFiles.length && !FORCE) {
  errors.push('data/feed.js has no clips. Run `npm run source` then `npm run feed`, or pass --force for a dev build.');
}
for (const clip of clipFiles) {
  if (!existsSync(join(ROOT, 'media', clip))) errors.push('feed references missing clip: media/' + clip);
}

if (errors.length) {
  errors.forEach(e => console.error('✗ ' + e));
  process.exit(1);
}

const version = manifest.version;
const distDir = join(ROOT, 'dist');
const zipPath = join(distDir, 'doombreak-v' + version + '.zip');
mkdirSync(distDir, { recursive: true });
rmSync(zipPath, { force: true });

const mediaFiles = existsSync(join(ROOT, 'media'))
  ? readdirSync(join(ROOT, 'media')).filter(f => f.endsWith('.mp4')).map(f => 'media/' + f)
  : [];

execFileSync('zip', ['-q', zipPath, ...SHIP, ...mediaFiles], { cwd: ROOT });

const mb = (statSync(zipPath).size / 1024 / 1024).toFixed(2);
console.log('✓ dist/doombreak-v' + version + '.zip (' + mb + ' MB, ' +
  (SHIP.length + mediaFiles.length) + ' files, ' + clipFiles.length + ' clips in feed)');
if (FORCE && !clipFiles.length) console.log('⚠ dev build: feed is empty — NOT suitable for store upload.');
