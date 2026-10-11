#!/usr/bin/env node
// ─── Study Map tags for studies saved before the Study Map ───────────────────
// New studies are tagged when they're generated (routes/study.js → the member's
// session → routes/library.js on save). This tags the rest: every study in
// data/studies.json with no Study Map tags, or with 'derived' tags only (worked
// out without AI — a study saved when the tagging call failed). Each one gets a
// short Claude Haiku 5.5 classification (lib/study-map.js tagStudy): its theology
// areas (validated against the fixed list), its subject — reusing the subject of
// an earlier study by the same member when it's the same topic, so they group
// together — and the Bible books/passages it centers on.
//
// Studies are tagged member by member, oldest first, so a member's earlier
// subjects are known when their later studies are tagged.
//
//   node scripts/tag-studies.js           # dry run: classify and report, writes nothing
//   node scripts/tag-studies.js --apply   # classify, back up studies.json, then write
//   node scripts/tag-studies.js --all     # (with or without --apply) re-tag every study,
//                                         # including ones already tagged by AI
//
// The dry run makes the same Haiku calls as --apply (a fraction of a cent per
// study) so its report shows the real tags; --apply classifies afresh, so a few
// tags may differ slightly from the dry run's.
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
const { AREAS, tagStudy, sanitizeMap, getMap, groupKey } = require(path.join(__dirname, '../lib/study-map'));

const args  = process.argv.slice(2);
const apply = args.includes('--apply');
const all   = args.includes('--all');
const FILE  = path.join(__dirname, '../data/studies.json');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const CONCURRENCY = 4;   // members tagged in parallel; each member's studies in order

function readStudies() {
  if (!fs.existsSync(FILE)) return null;
  const list = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  return Array.isArray(list) ? list : [];
}

function needsTags(s) {
  if (all) return true;
  const m = sanitizeMap(s.map);
  return !m || m.source !== 'ai';
}

function when(s) { return Date.parse(s.savedAt || s.createdAt) || 0; }

async function main() {
  console.log(apply ? 'APPLY — studies.json will be backed up, then written.' : 'DRY RUN — nothing will be written. Re-run with --apply to write.');
  if (all) console.log('--all: every study will be re-tagged.');

  const studies = readStudies();
  if (!studies) { console.log('data/studies.json: not found — nothing to do.'); return; }

  const hasKey = !!process.env.ANTHROPIC_API_KEY;
  if (!hasKey) console.log('\nNOTE: ANTHROPIC_API_KEY is not set — studies will get derived (non-AI) tags only.');
  const client = hasKey ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;

  const todo = studies.filter(s => s && s.id && needsTags(s));
  console.log(`\n${studies.length} studies in total; ${todo.length} to tag.`);

  // Member by member, oldest first.
  const byUser = {};
  studies.filter(s => s && s.id).forEach(s => { (byUser[s.userId] || (byUser[s.userId] = [])).push(s); });
  const users = Object.keys(byUser);
  users.forEach(u => byUser[u].sort((a, b) => when(a) - when(b)));

  const results = {};   // id → map
  let done = 0, fellBack = 0;

  async function tagUser(userId) {
    const own = byUser[userId];
    const subjects = [];
    for (const s of own) {
      if (!needsTags(s)) { subjects.push(getMap(s).subject); continue; }
      const map = await tagStudy({
        topic: String(s.topic || ''), content: String(s.content || ''),
        priorSubjects: subjects.slice().reverse(),   // newest first
        timeoutMs: 30000, maxRetries: 3, client, quiet: true,
      });
      if (hasKey && map.source !== 'ai') fellBack++;
      results[s.id] = map;
      subjects.push(map.subject);
      done++;
      console.log(`  [${done}/${todo.length}] ${s.id} "${String(s.topic || '').slice(0, 60)}"\n` +
        `      areas: ${map.areas.join(', ') || '(none)'} | subject: ${map.subject} | passages: ${map.passages.join(', ') || '(none)'}` +
        (map.source === 'ai' ? '' : '  [derived]'));
    }
  }

  const queue = users.filter(u => byUser[u].some(needsTags));
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) await tagUser(queue.shift());
  }));

  // ── Report ──────────────────────────────────────────────────────────────────
  const counted = studies.filter(s => s && s.id).map(s => ({ s, map: results[s.id] || getMap(s) }));
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

  const groups = {};
  counted.forEach(({ s, map }) => {
    const k = s.userId + '|' + groupKey(map.subject);
    (groups[k] || (groups[k] = [])).push(map.subject);
  });
  const multi = Object.keys(groups).filter(k => groups[k].length > 1);
  console.log(`\nTopics with more than one study (grouped on the Study Map): ${multi.length}`);
  multi.slice(0, 40).forEach(k => console.log(`  ${groups[k][0]} — ${groups[k].length} studies`));
  if (multi.length > 40) console.log(`  … and ${multi.length - 40} more`);

  const withBooks = counted.filter(c => c.map.books.length).length;
  console.log(`\nStudies centered on particular books/passages: ${withBooks} of ${counted.length}`);
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
    // A study tagged by AI while this ran (e.g. regenerated) keeps its own tags.
    if (!all && sanitizeMap(s.map) && sanitizeMap(s.map).source === 'ai') return;
    s.map = results[s.id];
    written++;
  });
  fs.writeFileSync(FILE, JSON.stringify(fresh, null, 2));
  console.log(`studies.json: written — ${written} study(ies) tagged.`);
}

main().catch(err => { console.error('Failed:', err); process.exit(1); });
