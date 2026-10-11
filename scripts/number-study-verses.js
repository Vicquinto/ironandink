#!/usr/bin/env node
// ─── Add verse numbers to studies saved before they existed ──────────────────
// Studies store their Scripture already resolved (the {{verse:...}} markers are
// injected at generation, routes/study.js), so a study saved before verse
// numbers has no verse boundaries in it. This re-resolves each multi-verse
// quotation and adds the numbers — but ONLY where the stored quotation is
// exactly today's verified text for that reference and translation (see
// numberStoredVerses in lib/asv.js). Anything else is left untouched and
// counted: older study formats, a NASB text refreshed since the study was made,
// unresolvable references. Safe to run more than once (numbered quotes skip).
//
// Note anchors are unaffected: notes match the study text with the numbers left
// out (notepad.js buildCleanText), which is byte-for-byte the text before.
//
// Covers data/studies.json and the study copies loaded into Live Rooms
// (data/rooms.json → room.study.content).
//
//   node scripts/number-study-verses.js           # dry run: report only, writes nothing
//   node scripts/number-study-verses.js --apply   # back up each file, then write
//
// --apply writes a timestamped backup next to each file FIRST
// (data/studies.backup-verse-numbers-<time>.json), then re-reads the live file
// and writes the numbered version straight away, so the window in which a save
// from the running app could be lost is a few milliseconds.
//
// Needs data/nasb-cache.json on this machine (the server has it) — without it,
// NASB quotations can't be checked and are reported as unresolved, unchanged.

const fs   = require('fs');
const path = require('path');
const { numberStoredVerses } = require(path.join(__dirname, '../lib/asv'));

const apply = process.argv.slice(2).includes('--apply');
const DATA  = path.join(__dirname, '../data');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// Number every study-like record in `list`; get/set reach the content string.
function processList(list, label, get, set, log) {
  const total = { numbered: 0, already: 0, mismatched: 0, unresolved: 0, records: 0 };
  (Array.isArray(list) ? list : []).forEach(rec => {
    const content = get(rec);
    if (typeof content !== 'string') return;
    const { content: out, tally } = numberStoredVerses(content);
    if (tally.numbered + tally.already + tally.mismatched + tally.unresolved === 0) return;
    Object.keys(tally).forEach(k => { total[k] += tally[k]; });
    if (out !== content) { set(rec, out); total.records++; }
    if (log) {
      console.log(`  ${label} ${rec.id || '?'} "${String(rec.topic || (rec.study && rec.study.topic) || '').slice(0, 60)}"` +
        ` — numbered ${tally.numbered}, already ${tally.already}, left unchanged: ${tally.mismatched} text differs, ${tally.unresolved} unresolved`);
    }
  });
  return total;
}

function run(fileName, label, get, set) {
  const file = path.join(DATA, fileName);
  const data = readJson(file);
  if (!data) { console.log(`${fileName}: not found — skipped.`); return; }

  console.log(`\n${fileName}:`);
  const total = processList(data, label, get, set, true);
  console.log(`${fileName}: ${total.records} record(s) would change — ${total.numbered} quotation(s) numbered, ` +
    `${total.already} already numbered, ${total.mismatched} left unchanged (text differs), ${total.unresolved} unresolved.`);

  if (!apply || !total.records) return;

  const backup = path.join(DATA, fileName.replace(/\.json$/, '') + '.backup-verse-numbers-' + stamp + '.json');
  fs.copyFileSync(file, backup);
  console.log(`${fileName}: backed up to ${path.relative(process.cwd(), backup)}`);

  // Re-read right before writing so a save made while this ran isn't lost.
  const fresh = readJson(file);
  const done  = processList(fresh, label, get, set, false);
  fs.writeFileSync(file, JSON.stringify(fresh, null, 2));
  console.log(`${fileName}: written — ${done.records} record(s), ${done.numbered} quotation(s) numbered.`);
}

console.log(apply ? 'APPLY — files will be backed up, then written.' : 'DRY RUN — nothing will be written. Re-run with --apply to write.');

run('studies.json', 'study',
  s => s && s.content,
  (s, v) => { s.content = v; });

run('rooms.json', 'room',
  r => r && r.study && r.study.content,
  (r, v) => { r.study.content = v; });
