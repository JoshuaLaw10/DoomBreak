#!/usr/bin/env node
// scripts/source-clips.mjs
// =================================================================
// Downloads portrait clips from the Pexels API into media/ and writes
// metadata.json, ready for `npm run feed`.
//
// Setup (one-time, ~2 min):
//   1. Get a free API key: https://www.pexels.com/api/
//   2. export PEXELS_API_KEY=your_key
//
// Run:  npm run source            (4 clips per tag = 20 total)
//       npm run source -- --per-tag 8
//       npm run source -- --only cats,dogs --per-tag 12
//
// Oversampling: for each tag, downloads up to CANDIDATE_MULTIPLIER×per-tag
// candidates, measures real audio volume on each (ffmpeg volumedetect —
// a stream can exist and still be pure digital silence, so presence alone
// is not enough), then keeps the --per-tag best: audible clips first
// (louder first), silent clips filling any remaining slots in their
// original relevance order. Rejected candidates are deleted, not shipped.
//
// Requires ffmpeg on PATH (compresses each clip to fit the ≤700KB
// bundle budget enforced by generate-feed.mjs).
//
// Licensing: Pexels License permits free commercial use and
// redistribution without attribution (we attribute anyway in
// metadata.json). Do NOT point this at any other source.
// =================================================================

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, statSync, rmSync, existsSync, readFileSync, renameSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');
const MEDIA_DIR = join(ROOT, 'media');
const TMP_DIR   = join(ROOT, '.clip-tmp');
const METADATA  = join(ROOT, 'metadata.json');

const API_KEY = process.env.PEXELS_API_KEY;
if (!API_KEY) {
  console.error('✗ PEXELS_API_KEY is not set.');
  console.error('  Get a free key at https://www.pexels.com/api/ then:');
  console.error('  PEXELS_API_KEY=xxx npm run source');
  process.exit(1);
}

try {
  execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
} catch {
  console.error('✗ ffmpeg not found on PATH. Install it (brew install ffmpeg) and retry.');
  process.exit(1);
}

const onlyArg = process.argv.indexOf('--only');
const ONLY = onlyArg !== -1 ? process.argv[onlyArg + 1].split(',').map(t => t.trim()) : null;

const perTagArg = process.argv.indexOf('--per-tag');
const PER_TAG   = perTagArg !== -1 ? parseInt(process.argv[perTagArg + 1], 10) : 4;
if (!Number.isInteger(PER_TAG) || PER_TAG < 1 || PER_TAG > 20) {
  console.error('✗ --per-tag must be an integer between 1 and 20.');
  process.exit(1);
}

const multArg = process.argv.indexOf('--oversample');
const CANDIDATE_MULTIPLIER = multArg !== -1 ? parseFloat(process.argv[multArg + 1]) : 2.5;

// Search queries per tag — biased toward clips that are both fun to watch
// AND likely to carry real audio (impact sounds, barks, cheering, ambient
// noise) rather than generic silent B-roll. 'general' maps to untagged clips.
const QUERIES = {
  calm:    ['ocean waves crashing rocks', 'heavy rain on window', 'forest stream sound', 'thunderstorm dark clouds', 'campfire crackling night'],
  funny:   ['funny dog fail', 'cat knocks something over', 'dog zoomies excited', 'puppy stumbling clumsy', 'parrot talking funny'],
  sport:   ['crowd cheering basketball', 'skateboard trick fail', 'surfing big wave', 'soccer goal celebration', 'snowboard jump crash'],
  focus:   ['mechanical keyboard typing asmr', 'pouring coffee asmr', 'pencil writing notebook', 'chess clock tournament', 'pages turning book'],
  cats:    ['cat meowing', 'kitten playing yarn', 'cat pouncing toy', 'cats playing together', 'cat purring close up'],
  dogs:    ['dog barking happy', 'puppy playing fetch', 'dog shaking water off', 'dog howling', 'puppies playing together'],
  general: ['crowd city night traffic', 'aerial coastline drone', 'busy street market sounds', 'fireworks night sky', 'street food sizzling'],
};

const MAX_CLIP_SECONDS = 10;
const TARGET_BYTES     = 700 * 1024; // must match generate-feed.mjs budget
const AUDIBLE_DB        = -35;        // must match generate-feed.mjs AUDIBLE_DB

async function pexels(path) {
  const res = await fetch('https://api.pexels.com/videos/' + path, {
    headers: { Authorization: API_KEY },
  });
  if (!res.ok) throw new Error('Pexels API ' + res.status + ' for ' + path);
  return res.json();
}

/** Smallest portrait-ish file that is still at least ~540px wide. */
function pickFile(video) {
  const candidates = (video.video_files || [])
    .filter(f => f.file_type === 'video/mp4' && f.width && f.height && f.height > f.width)
    .sort((a, b) => (a.width * a.height) - (b.width * b.height));
  return candidates.find(f => f.width >= 480) || candidates[candidates.length - 1] || null;
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('download failed ' + res.status);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

function compress(src, dest) {
  // Portrait 540px wide, capped duration + bitrate to land under budget.
  execFileSync('ffmpeg', [
    '-y', '-i', src,
    '-t', String(MAX_CLIP_SECONDS),
    '-vf', 'scale=540:-2',
    '-c:v', 'libx264', '-preset', 'veryfast',
    '-b:v', '400k', '-maxrate', '500k', '-bufsize', '1000k',
    '-c:a', 'aac', '-b:a', '96k', // a bit richer than before — these clips need to actually be heard
    '-movflags', '+faststart',
    dest,
  ], { stdio: 'ignore' });
  return statSync(dest).size;
}

/** Real perceptible volume, not just stream presence (see generate-feed.mjs). */
function meanVolumeDb(file) {
  const res = spawnSync('ffmpeg', [
    '-i', file, '-af', 'volumedetect', '-f', 'null', '-',
  ], { encoding: 'utf-8' });
  const m = (res.stderr || '').match(/mean_volume:\s*(-?[\d.]+)\s*dB/);
  return m ? parseFloat(m[1]) : -Infinity;
}

const metadata = existsSync(METADATA) ? JSON.parse(readFileSync(METADATA, 'utf-8')) : {};
for (const k of Object.keys(metadata)) if (k.startsWith('_')) delete metadata[k];

mkdirSync(MEDIA_DIR, { recursive: true });
mkdirSync(TMP_DIR, { recursive: true });

const usedIds = new Set();
let totalSourced = 0, totalFailed = 0;

for (const [tag, queries] of Object.entries(QUERIES)) {
  if (ONLY && !ONLY.includes(tag)) continue;

  // This is a full re-source of the tag, not an append — clear its old
  // clips/metadata first so stale files (from a previous, smaller or
  // differently-ranked run) don't linger alongside the new batch.
  const stalePrefix = tag + '_';
  for (const f of readdirSync(MEDIA_DIR)) {
    if (f.startsWith(stalePrefix) && f.endsWith('.mp4')) {
      rmSync(join(MEDIA_DIR, f), { force: true });
      delete metadata[f];
    }
  }

  const targetCandidates = Math.ceil(PER_TAG * CANDIDATE_MULTIPLIER);
  const candidates = []; // { tmpPath, video, query, dB }
  let failed = 0;

  // Round-robin across queries, a small page at a time, instead of
  // exhausting one query before trying the next. A broad query like "ocean
  // waves" can return far more usable results than a narrower one like
  // "campfire crackling" — fetching depth-first would let it fill the
  // entire candidate budget before the others are ever tried, collapsing
  // visual variety within the tag.
  const qstate = queries.map(() => ({ page: 1, exhausted: false }));
  let round = 0;

  while (candidates.length < targetCandidates && qstate.some(s => !s.exhausted) && round < 8) {
    for (let qi = 0; qi < queries.length; qi++) {
      if (candidates.length >= targetCandidates) break;
      if (qstate[qi].exhausted) continue;
      const query = queries[qi];

      let data;
      try {
        data = await pexels('search?query=' + encodeURIComponent(query) +
          '&orientation=portrait&size=medium&per_page=6&page=' + qstate[qi].page);
      } catch (e) {
        console.error('✗ search failed for "' + query + '": ' + e.message);
        qstate[qi].exhausted = true;
        continue;
      }

      const videos = (data.videos || []).filter(v => !usedIds.has(v.id) && v.duration >= 5);
      if (!videos.length) { qstate[qi].exhausted = true; continue; }
      qstate[qi].page++;

      for (const video of videos) {
        if (candidates.length >= targetCandidates) break;
        const file = pickFile(video);
        if (!file) continue;

        const tmp = join(TMP_DIR, tag + '_cand_' + candidates.length + '.mp4');
        try {
          process.stdout.write('… [' + tag + '] pexels #' + video.id + ' (' + query + ') ');
          await download(file.link, tmp);
          const size = compress(tmp, tmp + '.out.mp4');
          renameSync(tmp + '.out.mp4', tmp);
          if (size > TARGET_BYTES) {
            rmSync(tmp, { force: true });
            console.log('skipped (' + Math.round(size / 1024) + 'KB over budget)');
            continue;
          }
          const dB = meanVolumeDb(tmp);
          usedIds.add(video.id);
          candidates.push({ tmpPath: tmp, video, query, dB, audible: dB > AUDIBLE_DB });
          console.log((dB > AUDIBLE_DB ? '🔊' : '🔈') + ' ' + dB.toFixed(1) + 'dB, ' + Math.round(size / 1024) + 'KB');
        } catch (e) {
          failed++; totalFailed++;
          console.log('✗ ' + e.message);
        }
      }
    }
    round++;
  }

  // Rank: audible first (loudest first), then silent in discovery order —
  // discovery order is Pexels relevance, a reasonable quality proxy.
  candidates.sort((a, b) => {
    if (a.audible !== b.audible) return a.audible ? -1 : 1;
    if (a.audible) return b.dB - a.dB;
    return 0;
  });

  const kept = candidates.slice(0, PER_TAG);
  const dropped = candidates.slice(PER_TAG);
  for (const c of dropped) rmSync(c.tmpPath, { force: true });

  kept.forEach((c, i) => {
    const name = tag + '_' + String(i + 1).padStart(2, '0') + '.mp4';
    renameSync(c.tmpPath, join(MEDIA_DIR, name));
    metadata[name] = {
      tags:    tag === 'general' ? [] : [tag],
      audible: c.audible,
      creator: '@' + ((c.video.user && c.video.user.name) || 'unknown').replace(/\s+/g, ''),
      title:   c.query,
      license: 'Pexels License',
      source:  c.video.url,
    };
    totalSourced++;
  });

  const audibleKept = kept.filter(c => c.audible).length;
  console.log('[' + tag + '] kept ' + kept.length + '/' + PER_TAG + ' (' + audibleKept + ' audible) from ' + candidates.length + ' candidates');
  if (kept.length < PER_TAG) {
    console.warn('⚠ tag "' + tag + '": only sourced ' + kept.length + '/' + PER_TAG + ' clips.');
  }
}

rmSync(TMP_DIR, { recursive: true, force: true });
writeFileSync(METADATA, JSON.stringify(metadata, null, 2) + '\n');

console.log('\nDone: ' + totalSourced + ' clips kept' + (totalFailed ? ', ' + totalFailed + ' failed' : '') + '.');
console.log('metadata.json written. Now run:  npm run feed');
