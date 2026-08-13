#!/usr/bin/env node
// ─── NASB 1995 cache warmer ──────────────────────────────────────────────────
// Cold-fills (or force-refreshes) the local NASB cache (data/nasb-cache.json) by
// fetching every chapter of the Protestant canon from API.Bible, one call per
// chapter. The whole canon is 1,189 chapters — a single full warm is 1,189 calls,
// well under the 5,000/month free-tier cap. Run once after adding API_BIBLE_KEY to
// .env; the monthly cron in server.js keeps it fresh thereafter.
//
//   node scripts/warm-nasb.js            # fetch only missing/stale chapters
//   node scripts/warm-nasb.js --force    # refetch every chapter regardless of age
//   node scripts/warm-nasb.js --delay=500  # ms between calls (default 300)
//
// The chapter structure is read from data/asv.json (complete, public domain), so
// the warmer needs no separate chapter-count table and mirrors the canonical
// book/chapter shape exactly.

require('dotenv').config();
const path = require('path');
const asv  = require(path.join(__dirname, '../data/asv.json'));
const nasb = require(path.join(__dirname, '../lib/nasb'));

const args   = process.argv.slice(2);
const force  = args.includes('--force');
const delayA = args.find(a => a.startsWith('--delay='));
const delay  = delayA ? Math.max(0, parseInt(delayA.split('=')[1], 10) || 0) : 300;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  if (!process.env.API_BIBLE_KEY) {
    console.error('API_BIBLE_KEY is not set in .env — cannot warm the NASB cache.');
    process.exit(1);
  }

  // Build the work list in canonical order from lib/nasb.BOOKS, taking each book's
  // chapter numbers from data/asv.json (its keys are chapter-number strings).
  const jobs = [];
  for (const [book] of nasb.BOOKS) {
    const chapters = asv[book] ? Object.keys(asv[book]).map(Number).filter(Number.isFinite).sort((a, b) => a - b) : [];
    for (const ch of chapters) jobs.push([book, ch]);
  }

  console.log(`[warm-nasb] canon: ${jobs.length} chapters | force=${force} | delay=${delay}ms`);

  let fetched = 0, skipped = 0, failed = 0;
  for (let i = 0; i < jobs.length; i++) {
    const [book, ch] = jobs[i];
    if (!force && nasb.hasChapter(book, ch) && !nasb.isChapterStale(book, ch)) {
      skipped++;
      continue;
    }
    const map = await nasb.fetchChapter(book, ch);
    if (map) {
      fetched++;
      if (fetched % 50 === 0) console.log(`[warm-nasb] progress: ${fetched} fetched, ${skipped} skipped, ${failed} failed (${i + 1}/${jobs.length})`);
    } else {
      failed++;
      console.warn(`[warm-nasb] FAILED ${book} ${ch}`);
    }
    if (delay) await sleep(delay);
  }

  console.log(`[warm-nasb] done — fetched:${fetched} skipped:${skipped} failed:${failed}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch(err => {
  console.error('[warm-nasb] fatal:', err && err.message ? err.message : err);
  process.exit(1);
});
