#!/usr/bin/env node
// scripts/generate-feed.mjs
// =================================================================
// Validates media/ + metadata.json and (re)generates data/feed.js.
//
// Run:  node scripts/generate-feed.mjs
//
// Validation:
//   - every file in media/ has a matching metadata entry (and vice versa)
//   - every file is ≤700KB (bundle budget)
//   - every metadata entry has all required fields
//   - tags are from the allowed set
//   - file naming convention matches the tag (e.g. sport_*.mp4 has 'sport' tag)
//   - placeholder TODO values are flagged but allowed (warning, not error)
//
// On success: overwrites data/feed.js with the generated FEED array.
// On failure: prints errors and exits 1 without touching data/feed.js.
// =================================================================

import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');
const MEDIA_DIR = join(ROOT, 'media');
const METADATA  = join(ROOT, 'metadata.json');
const FEED_OUT  = join(ROOT, 'data', 'feed.js');

const ALLOWED_TAGS = new Set(['calm', 'funny', 'sport', 'focus', 'cats', 'dogs']);
const MAX_BYTES    = 700 * 1024; // 700 KB per clip

const REQUIRED_FIELDS = ['tags', 'creator', 'title', 'license', 'source'];

// ── Logging helpers ───────────────────────────────────────────────────────
const RED     = '\x1b[31m';
const YELLOW  = '\x1b[33m';
const GREEN   = '\x1b[32m';
const RESET   = '\x1b[0m';

const errors   = [];
const warnings = [];

function err(msg)  { errors.push(msg);   console.error(RED    + '✗ ' + msg + RESET); }
function warn(msg) { warnings.push(msg); console.warn (YELLOW + '⚠ ' + msg + RESET); }
function ok(msg)   {                     console.log  (GREEN  + '✓ ' + msg + RESET); }

// ── Step 1: load metadata ─────────────────────────────────────────────────

if (!existsSync(METADATA)) {
  err('metadata.json not found. Copy metadata.template.json to metadata.json and fill in the fields.');
  process.exit(1);
}

let metadata;
try {
  const raw = readFileSync(METADATA, 'utf-8');
  metadata  = JSON.parse(raw);
} catch (e) {
  err('Failed to parse metadata.json: ' + e.message);
  process.exit(1);
}

// Strip _comment / _schema keys.
delete metadata._comment;
delete metadata._schema;

// ── Step 2: scan media/ ───────────────────────────────────────────────────

if (!existsSync(MEDIA_DIR)) {
  err('media/ directory not found. Create it and add your re-encoded mp4 files.');
  process.exit(1);
}

const mediaFiles = readdirSync(MEDIA_DIR).filter(f => f.endsWith('.mp4'));

if (mediaFiles.length === 0) {
  err('No .mp4 files found in media/. See docs/SOURCING.md.');
  process.exit(1);
}

ok(`Found ${mediaFiles.length} clips in media/`);

// ── Step 3: cross-validate metadata vs media ──────────────────────────────

const metadataKeys = Object.keys(metadata);

// Files that have no metadata entry.
const orphanFiles = mediaFiles.filter(f => !metadata[f]);
for (const f of orphanFiles) err(`media/${f} has no entry in metadata.json`);

// Metadata entries with no corresponding file.
const orphanMeta = metadataKeys.filter(k => !mediaFiles.includes(k));
for (const k of orphanMeta) err(`metadata.json has entry for "${k}" but media/${k} is missing`);

// ── Step 4: validate each metadata entry ──────────────────────────────────

let placeholderCount = 0;

for (const filename of metadataKeys) {
  const entry = metadata[filename];

  // Required fields.
  for (const field of REQUIRED_FIELDS) {
    if (entry[field] === undefined || entry[field] === null) {
      err(`${filename}: missing required field "${field}"`);
    }
  }

  // Tags must be an array of allowed values.
  if (entry.tags !== undefined) {
    if (!Array.isArray(entry.tags)) {
      err(`${filename}: tags must be an array`);
    } else {
      for (const tag of entry.tags) {
        if (!ALLOWED_TAGS.has(tag)) {
          err(`${filename}: unknown tag "${tag}" (allowed: ${[...ALLOWED_TAGS].join(', ')})`);
        }
      }
    }
  }

  // Placeholder warnings — allowed during development, flagged before ship.
  if (entry.creator === '@TODO' || entry.title === 'TODO' ||
      (typeof entry.source === 'string' && entry.source.endsWith('/TODO'))) {
    placeholderCount++;
  }

  // Filename → tag consistency check.
  // sport_*.mp4 should have "sport" in tags, etc. general_*.mp4 should have no tags.
  const prefix = filename.split('_')[0];
  if (prefix === 'general') {
    if (Array.isArray(entry.tags) && entry.tags.length > 0) {
      warn(`${filename}: filename suggests untagged ('general_*') but has tags ${JSON.stringify(entry.tags)}`);
    }
  } else if (ALLOWED_TAGS.has(prefix)) {
    if (Array.isArray(entry.tags) && !entry.tags.includes(prefix)) {
      warn(`${filename}: filename suggests "${prefix}" but tag is missing from ${JSON.stringify(entry.tags)}`);
    }
  }
}

if (placeholderCount > 0) {
  warn(`${placeholderCount} clip(s) still have @TODO / TODO placeholders. Fill them in before publishing.`);
}

// ── Step 4.5: probe audio tracks ──────────────────────────────────────────
// Most stock footage is silent; the runtime uses this flag to steer the
// sound-target panel to a clip that can actually make sound.

let ffprobeOk = true;
try { execFileSync('ffprobe', ['-version'], { stdio: 'ignore' }); }
catch { ffprobeOk = false; warn('ffprobe not found — emitting audio:false for all clips'); }

const audioMap = {};
let audioCount = 0;
for (const f of mediaFiles) {
  let has = false;
  if (ffprobeOk) {
    try {
      const out = execFileSync('ffprobe', [
        '-v', 'quiet', '-select_streams', 'a',
        '-show_entries', 'stream=codec_type', '-of', 'csv=p=0',
        join(MEDIA_DIR, f),
      ]).toString();
      has = out.includes('audio');
    } catch { /* treat as silent */ }
  }
  audioMap[f] = has;
  if (has) audioCount++;
}
ok(`Audio tracks: ${audioCount}/${mediaFiles.length} clips`);

// ── Step 5: validate file sizes ───────────────────────────────────────────

let totalBytes = 0;
let oversized = 0;

for (const f of mediaFiles) {
  const path  = join(MEDIA_DIR, f);
  const size  = statSync(path).size;
  totalBytes += size;
  if (size > MAX_BYTES) {
    err(`media/${f} is ${(size / 1024).toFixed(0)}KB — exceeds ${MAX_BYTES / 1024}KB limit. Re-encode at lower bitrate.`);
    oversized++;
  }
}

ok(`Total media size: ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);

if (totalBytes > 50 * 1024 * 1024) {
  warn(`Bundle is ${(totalBytes / 1024 / 1024).toFixed(1)}MB — Chrome Web Store accepts but reviewers may scrutinise. Aim for <40MB.`);
}

// ── Step 6: bail if any errors ────────────────────────────────────────────

if (errors.length) {
  console.error(`\n${RED}Validation failed: ${errors.length} error(s), ${warnings.length} warning(s).${RESET}`);
  console.error('Fix errors and re-run. data/feed.js was NOT updated.');
  process.exit(1);
}

// ── Step 7: generate data/feed.js ─────────────────────────────────────────

// Stable order: sort files alphabetically for deterministic output.
const sortedFiles = [...mediaFiles].sort();

const feedEntries = sortedFiles.map(filename => {
  const m = metadata[filename];
  return {
    file:     filename,
    audio:    !!audioMap[filename],
    tags:     m.tags || [],
    creator:  m.creator,
    title:    m.title,
    license:  m.license,
    source:   m.source,
  };
});

// Emit a JS file matching the existing data/feed.js style.
const lines = [
  '// data/feed.js',
  '// AUTO-GENERATED by scripts/generate-feed.mjs — do not edit by hand.',
  '// Run `node scripts/generate-feed.mjs` after updating media/ or metadata.json.',
  '//',
  `// Generated: ${new Date().toISOString()}`,
  `// Source files: ${mediaFiles.length}`,
  `// Total bundle size: ${(totalBytes / 1024 / 1024).toFixed(1)} MB`,
  '',
  "'use strict';",
  '',
  'var FEED = [',
];

for (const entry of feedEntries) {
  lines.push('  {');
  lines.push(`    file: ${JSON.stringify(entry.file)}, audio: ${entry.audio},`);
  lines.push(`    tags: ${JSON.stringify(entry.tags)},`);
  lines.push(`    creator: ${JSON.stringify(entry.creator)}, title: ${JSON.stringify(entry.title)},`);
  lines.push(`    license: ${JSON.stringify(entry.license)}, source: ${JSON.stringify(entry.source)},`);
  lines.push('  },');
}

lines.push('];');
lines.push('');

// Runtime validation block (mirrors the original handwritten file).
lines.push('// Validate at load time so bad entries fail loudly during development.');
lines.push("if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {");
lines.push("  var _validTags = new Set(['calm', 'funny', 'sport', 'focus', 'cats', 'dogs']);");
lines.push('  FEED.forEach(function(item, i) {');
lines.push("    if (!item.file) throw new Error('FEED[' + i + ']: missing file');");
lines.push("    if (!item.creator) throw new Error('FEED[' + i + ']: missing creator');");
lines.push("    if (!item.title) throw new Error('FEED[' + i + ']: missing title');");
lines.push("    if (!item.license) throw new Error('FEED[' + i + ']: missing license');");
lines.push('    (item.tags || []).forEach(function(tag) {');
lines.push("      if (!_validTags.has(tag)) throw new Error('FEED[' + i + ']: unknown tag \"' + tag + '\"');");
lines.push('    });');
lines.push('  });');
lines.push('}');
lines.push('');
lines.push("// Allow test environments to import this file via CommonJS.");
lines.push("if (typeof module !== 'undefined') module.exports = { FEED };");
lines.push('');

writeFileSync(FEED_OUT, lines.join('\n'));

// ── Done ──────────────────────────────────────────────────────────────────

console.log(`\n${GREEN}✓ Generated ${FEED_OUT}${RESET}`);
console.log(`  ${feedEntries.length} clips, ${(totalBytes / 1024 / 1024).toFixed(1)}MB total`);
if (warnings.length) {
  console.log(`  ${warnings.length} warning(s) — review above.`);
}
console.log(`\nNext: run \`npx vitest run\` to confirm the new feed passes data tests.`);
