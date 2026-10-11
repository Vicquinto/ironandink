#!/usr/bin/env node
// ─── Study Map tags for existing studies ──────────────────────────────────────
// New studies are tagged when they're generated (routes/study.js → the member's
// session → routes/library.js on save). This tags the rest: every study in
// data/studies.json with no Study Map tags, or with 'derived' tags only (worked
// out without AI — a study saved when the tagging call failed). Each one gets a
// short Claude Haiku 5.5 classification of that study alone (lib/study-map.js
// tagStudy): its theology areas (validated against the fixed list; Church History
// only for the church after the New Testament), its subject (drawn from its own
// title and content — never another study's), and the Bible books/passages it
// centers on.
//
//   node scripts/tag-studies.js                   # dry run: classify and report, writes nothing
//   node scripts/tag-studies.js --apply           # classify, back up studies.json, then write
//   node scripts/tag-studies.js --force           # dry run that re-tags EVERY study, including
//                                                 # ones already tagged by AI
//   node scripts/tag-studies.js --force --apply   # re-tag every study and write — use this to
//                                                 # re-apply a later tagging improvement
//
// (--all is accepted as another name for --force.)
//
// The dry run makes the same Haiku calls as --apply (a fraction of a cent per
// study) so its report shows the real tags; --apply classifies afresh, so a few
// tags may differ slightly from the dry run's. With --force, a study whose tags
// change shows what it had before.
//
// --apply writes a timestamped backup FIRST (data/studies.backup-study-map-<time>.json),
// then re-reads the live file and writes the tags straight away, so the window in
// which a save from the running app could be lost is a few milliseconds. Only the
// `map` field of each study is touched. Needs ANTHROPIC_API_KEY (from .env); without
// it, studies get 'derived' tags only and the report says so.

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs   = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { AREAS, tagStudy, sanitizeMap, getMap, groupStudies } = require(path.join(__dirname, '../lib/study-map'));

const args  = process.argv.slice(2);
const apply = args.includes('--apply');
const force = args.includes('--force') || args.includes('--all');
const FILE  = path.join(__dirname, '../data/studies.json');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const CONCURRENCY = 4;   // studies classified in parallel

function readStudies() {
  if (!fs.existsSync(FILE)) return null;
  const list = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  return Array.isArray(list) ? list : [];
}

function hasAiTags(s) {
  const m = sanitizeMap(s.map);
  return !!(m && m.source === 'ai');
}
function needsTags(s) { return force || !hasAiTags(s); }

function when(s) { return Date.parse(s.savedAt || s.createdAt) || 0; }
function describe(m) {
  return `areas: ${m.areas.join(', ') || '(none)'} | subject: ${m.subject} | passages: ${m.passages.join(', ') || '(none)'}`;
}

async function main() {
  console.log(apply ? 'APPLY — studies.json will be backed up, then written.' : 'DRY RUN — nothing will be written. Re-run with --apply to write.');
  if (force) console.log('--force: every study will be re-tagged, including ones already tagged.');

  const studies = readStudies();
  if (!studies) { console.log('data/studies.json: not found — nothing to do.'); return; }

  const hasKey = !!process.env.ANTHROPIC_API_KEY;
  if (!hasKey) console.log('\nNOTE: ANTHROPIC_API_KEY is not set — studies will get derived (non-AI) tags only.');
  const client = hasKey ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;

  const all  = studies.filter(s => s && s.id);
  const todo = all.filter(needsTags).sort((a, b) => when(a) - when(b));
  console.log(`\n${all.length} studies in total; ${todo.length} to tag.`);

  const results = {};   // id → map
  let done = 0, fellBack = 0, changed = 0;
  const queue = todo.slice();

  async function worker() {
    while (queue.length) {
      const s = queue.shift();
      const map = await tagStudy({
        topic: String(s.topic || ''), content: String(s.content || ''),
        timeoutMs: 30000, maxRetries: 3, client, quiet: true,
      });
      if (hasKey && map.source !== 'ai') fellBack++;
      results[s.id] = map;
      done++;
      const before = sanitizeMap(s.map);
      const differs = before && describe(before) !== describe(map);
      if (differs) changed++;
      console.log(`  [${done}/${todo.length}] ${s.id} "${String(s.topic || '').slice(0, 60)}"\n` +
        `      ${describe(map)}${map.source === 'ai' ? '' : '  [derived]'}` +
        (differs ? `\n      was: ${describe(before)}${before.source === 'ai' ? '' : '  [derived]'}` : ''));
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));

  // ── Report ──────────────────────────────────────────────────────────────────
  const counted = all.map(s => ({ s, map: results[s.id] || getMap(s) }));
  const tally = list => {
    const t = {};
    AREAS.forEach(a => { t[a] = 0; });
    let none = 0;
    list.forEach(({ map }) => { if (!map.areas.length) none++; map.areas.forEach(a => { t[a]++; }); });
    return { t, none };
  };
  const pad = s => (s + '                    ').slice(0, 18);

  const tagged = tally(counted.filter(c => results[c.s.id]));
  const overall = tally(counted);
  console.log('\nStudies per area (a study can be in up to 3 areas):');
  console.log('  ' + pad('Area') + 'tagged now   all studies after this run');
  AREAS.forEach(a => console.log('  ' + pad(a) + String(tagged.t[a]).padStart(9) + String(overall.t[a]).padStart(14)));
  console.log('  ' + pad('(no area)') + String(tagged.none).padStart(9) + String(overall.none).padStart(14));

  // Topics exactly as the Study Map will group them: per member, newest first,
  // matching subjects AND a shared area or overlapping passages.
  const byUser = {};
  counted.forEach(c => { (byUser[c.s.userId] || (byUser[c.s.userId] = [])).push(c); });
  const multi = [];
  Object.keys(byUser).forEach(u => {
    const list = byUser[u].sort((a, b) => when(b.s) - when(a.s));
    groupStudies(list).forEach(g => { if (g.entries.length > 1) multi.push(g); });
  });
  console.log(`\nTopics with more than one study (grouped on the Study Map): ${multi.length}`);
  multi.slice(0, 40).forEach(g => console.log(`  ${g.subject} — ${g.entries.length} studies: ` +
    g.entries.map(e => `"${String(e.s.topic || '').slice(0, 40)}"`).join(', ')));
  if (multi.length > 40) console.log(`  … and ${multi.length - 40} more`);

  const withBooks = counted.filter(c => c.map.books.length).length;
  console.log(`\nStudies centered on particular books/passages: ${withBooks} of ${counted.length}`);
  if (force) console.log(`Already-tagged studies whose tags would change: ${changed}`);
  if (hasKey && fellBack) console.log(`${fellBack} study(ies) could not be classified by AI and got derived tags (a later run will retry them).`);

  if (!apply) { console.log('\nDry run complete — nothing written.'); return; }
  if (!Object.keys(results).length) { console.log('\nNothing to write.'); return; }

  // ── Write ───────────────────────────────────────────────────────────────────
  const backup = path.join(path.dirname(FILE), 'studies.backup-study-map-' + stamp + '.json');
  fs.copyFileSync(FILE, backup);
  console.log(`\nstudies.json: backed up to ${path.relative(process.cwd(), backup)}`);

  // Re-read right before writing so a save made while this ran isn't lost.
  const fresh = readStudies() || [];
  let written = 0;
  fresh.forEach(s => {
    if (!s || !results[s.id]) return;
    // Without --force, a study tagged by AI while this ran keeps its own tags.
    if (!force && hasAiTags(s)) return;
    s.map = results[s.id];
    written++;
  });
  fs.writeFileSync(FILE, JSON.stringify(fresh, null, 2));
  console.log(`studies.json: written — ${written} study(ies) tagged.`);
}

main().catch(err => { console.error('Failed:', err); process.exit(1); });
