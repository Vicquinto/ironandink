'use strict';

// Study Notes: "Key points" for one section of a lesson. A separate short AI call
// made AFTER the reply that left the section is saved (routes/teacher.js), or when
// the member asks for one (routes/study-notes.js). It summarizes only that
// section's own conversation; everything it returns is checked before it is saved,
// and anything wrong saves nothing.

const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { createJsonStore } = require('./jsonStore');
const { injectVersesTracked, resolve, NASB_ATTRIBUTION } = require('./asv');
const { notesStore, findRecord, inSection } = require('./study-notes');

// One record per member: { userId, day, count }: recap calls made that day
// (America/Denver). Every call counts, whether or not it produced a recap.
const usageStore = createJsonStore(path.join(__dirname, '../data/recap_usage.json'), 'Recap usage');
const DAILY_MAX = 60;

const LINES_MIN = 3, LINES_MAX = 5, LINE_CHARS = 400, MARKERS_MAX = 2;
const QUOTE_WORDS = 8;   // a quotation, or a run of a cited verse's own words, this long is refused
const MARKER_RE = /\{\{\s*verse\s*:\s*([^}]+?)\s*\}\}/gi;

function todayStr() { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' }); }

// Takes one of today's calls, or says there are none left.
async function takeCall(userId) {
  const r = await usageStore.update(list => {
    const day = todayStr();
    let rec = list.find(x => x && x.userId === userId);
    if (!rec) { rec = { userId, day, count: 0 }; list.push(rec); }
    if (rec.day !== day) { rec.day = day; rec.count = 0; }
    if (rec.count >= DAILY_MAX) return { changed: false, ok: false };
    rec.count++;
    return { changed: true, ok: true };
  });
  return r.ok;
}

// A section's own visible messages (tagged; hidden instructions left out).
function isVisible(m) { return !m.hidden || !!m.display; }
function sectionMessages(messages, n) {
  return (messages || []).filter(m => m && inSection(m, n) && isVisible(m));
}
// The last tagged message of a section, or null when the teacher never replied in it.
function throughId(messages, n) {
  const list = sectionMessages(messages, n);
  return list.some(m => m.role === 'assistant') ? list[list.length - 1].id : null;
}

const refKey = ref => String(ref).replace(/\s+/g, ' ').trim().toLowerCase();
const words  = s => String(s).toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);

// The longest run of QUOTE_WORDS or more words in a row that `line` shares with one
// of these verses: { n, ref }, or null.
function verseRun(line, verses) {
  const w = words(line);
  let best = null;
  for (const v of verses) {
    for (let i = 0; i < w.length; i++) {
      let n = best ? best.n + 1 : QUOTE_WORDS;
      while (i + n <= w.length && v.text.includes(' ' + w.slice(i, i + n).join(' ') + ' ')) { best = { n, ref: v.ref }; n++; }
    }
  }
  return best;
}

// The reply's JSON. Only a markdown code fence around it (and white space) is
// taken off; anything else that isn't valid JSON throws.
function parseReply(text) {
  const t = String(text || '').trim();
  const fenced = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return JSON.parse(fenced ? fenced[1] : t);
}

// The model's points → { lines }, or { fail, sample } when they can't be trusted:
// which check failed, and the point it failed on.
function checkPoints(points, conversation) {
  if (!Array.isArray(points)) return { fail: 'no points list' };
  if (points.length < LINES_MIN || points.length > LINES_MAX) return { fail: 'wrong number of points (' + points.length + ')' };
  const allowed = new Map();   // the references this section's conversation used as markers
  conversation.forEach(m => {
    for (const x of String(m.content || '').matchAll(MARKER_RE)) allowed.set(refKey(x[1]), x[1].trim());
  });
  const verses = [];
  allowed.forEach(ref => { const r = resolve(ref); if (r) verses.push({ ref, text: ' ' + words(r.text).join(' ') + ' ' }); });

  let markers = 0;
  const lines = [];
  for (const p of points) {
    if (typeof p !== 'string') return { fail: 'point is not text', sample: JSON.stringify(p) };
    const line = p.replace(/\s+/g, ' ').trim()
      .replace(/^>\s*/, '')
      .replace(MARKER_RE, (_m, ref) => {
        const ok = allowed.get(refKey(ref));
        if (!ok || markers >= MARKERS_MAX) return ref.trim();   // a plain reference
        markers++;
        return '{{verse:' + ok + '}}';
      });
    if (!line) return { fail: 'empty point', sample: p };
    if (line.length >= LINE_CHARS) return { fail: 'point over ' + LINE_CHARS + ' chars (' + line.length + ')', sample: line };
    const bare = line.replace(MARKER_RE, '');
    if (/\{\{|\}\}/.test(bare)) return { fail: 'bad marker ' + (bare.match(/\{\{[^}]*\}{0,2}|\}\}/) || [''])[0], sample: line };
    if (/[{}]|\[\[|\]\]/.test(bare)) return { fail: 'stray brackets/tags', sample: line };
    const quoted = bare.match(/“[^”]*”|"[^"]*"/g) || [];
    const longQuote = Math.max(0, ...quoted.map(q => words(q).length));
    if (longQuote >= QUOTE_WORDS) return { fail: 'quotation of ' + longQuote + ' words', sample: line };
    const run = verseRun(bare, verses);
    if (run) return { fail: 'verse run of ' + run.n + ' words from ' + run.ref, sample: line };
    lines.push(line);
  }
  return { lines };
}

// The second attempt's extra message: the reason the log records, and for a point
// that ran long, what to do about it.
function retryMessage(fail) {
  const tip = fail.startsWith('point over') ? '; keep each point under 50 words' : '';
  return 'Your previous answer was not accepted: ' + fail + tip + '. Write the points again, following all the rules.';
}

function conversationText(list) {
  return list.map(m => {
    if (m.role === 'assistant') return 'Teacher: ' + m.content;
    if (m.display) return 'Member (tapped a button): ' + m.display;
    return 'Member: ' + m.content;
  }).join('\n\n');
}

// One section at a time per member and study; a second request waits for the first.
const running = new Map();
const runKey = (userId, studyId, n) => userId + '|' + studyId + '|' + n;

// job: { prompts, userId, studyId, studyTopic, sections, section, sessionId, messages, part }
//   part: 1 or 2 for an Opposing Views study, else null.
// Resolves with { recap } or { reason: 'nothing'|'limit'|'failed' }; never rejects.
function makeRecap(job) {
  const key = runKey(job.userId, job.studyId, job.section);
  const before = running.get(key) || Promise.resolve();
  const p = before.then(() => run(job)).catch(err => {
    console.error('[Teacher/recap]', err.status || '', err.message);
    return { reason: 'failed' };
  });
  running.set(key, p);
  p.then(() => { if (running.get(key) === p) running.delete(key); });
  return p;
}
// Waits for a recap being made, if there is one.
function waitFor(userId, studyId, n) { return running.get(runKey(userId, studyId, n)) || Promise.resolve(null); }

// Waits for every recap being made for a member's study (before deleting its notes,
// so one can't be saved back afterwards).
function waitForAll(userId, studyId) {
  return Promise.all(Array.from(running.entries()).filter(([k]) => k.startsWith(userId + '|' + studyId + '|')).map(([, p]) => p));
}

async function run(job) {
  const list    = sectionMessages(job.messages, job.section);
  const through = throughId(job.messages, job.section);
  const sec     = (job.sections || []).find(s => s.n === job.section);
  if (!through || !sec) return { reason: 'nothing' };

  // Already made from exactly this teaching (asked twice, or two triggers at once).
  const rec = findRecord(notesStore.read(), job.userId, job.studyId);
  const made = rec && (rec.recaps || []).find(x => x.section === sec.n && x.throughMessageId === through);
  if (made) return { recap: made };

  const { IRON_INK_CORE_PROMPT, IRON_INK_RECAP_PROMPT } = job.prompts;
  const content = 'SECTION: ' + sec.title + '\n' +
    (job.part ? 'This is an Opposing Views study; this section is in Part ' + job.part + '.\n' : '') +
    '\nCONVERSATION:\n' + conversationText(list);
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0, timeout: 60 * 1000 });

  let lines = null, lastFail = null;
  for (let attempt = 0; attempt < 2 && !lines; attempt++) {
    if (!(await takeCall(job.userId))) return { reason: 'limit' };
    let message;
    try {
      message = await client.messages.create({
        model:         'claude-opus-5-5',
        max_tokens:    4000,
        output_config: { effort: 'low' },
        system:        IRON_INK_CORE_PROMPT + '\n\n' + IRON_INK_RECAP_PROMPT,
        messages:      [{ role: 'user', content }].concat(lastFail ? [{ role: 'user', content: retryMessage(lastFail) }] : []),
      });
    } catch (err) {
      console.error('[Teacher/recap] API error — status:', err.status, '| message:', err.message);
      continue;
    }
    const u = message.usage || {};
    console.log(`[Teacher/recap] usage — input:${u.input_tokens} cache_read:${u.cache_read_input_tokens} cache_write:${u.cache_creation_input_tokens} output:${u.output_tokens} stop:${message.stop_reason}`);
    if (message.stop_reason === 'refusal') return { reason: 'failed' };
    const text = message.content.filter(b => b.type === 'text').map(b => b.text).join('');
    let parsed, checked;
    try { parsed = parseReply(text); } catch { checked = { fail: 'not JSON' }; }
    if (!checked) checked = checkPoints(parsed && parsed.points, list);
    if (checked.lines) lines = checked.lines;
    else {
      lastFail = checked.fail;
      // Server log only; the sample is quoted so the line stays one line.
      const sample = JSON.stringify(String(checked.sample === undefined ? text : checked.sample).slice(0, 300));
      console.warn('[Teacher/recap] failed check (attempt ' + (attempt + 1) + ', section ' + sec.n + '): ' + checked.fail + ' | ' + sample);
    }
  }
  if (!lines) return { reason: 'failed' };

  const now = new Date().toISOString();
  const recap = { section: sec.n, sectionTitle: sec.title, sessionId: job.sessionId, lines, throughMessageId: through, createdAt: now };
  await notesStore.update(all => {
    let rec = findRecord(all, job.userId, job.studyId);
    if (!rec) { rec = { userId: job.userId, studyId: job.studyId, points: [], recaps: [] }; all.push(rec); }
    rec.studyTopic = job.studyTopic;
    rec.sections   = job.sections;
    rec.recaps     = (rec.recaps || []).filter(x => x.section !== sec.n).concat([recap]);
    rec.updatedAt  = now;
    return { changed: true };
  });
  return { recap };
}

// A recap for the page: verse markers filled with verified text.
function displayRecap(recap) {
  if (!recap) return null;
  let nasb = false;
  const lines = recap.lines.map(line => {
    const r = injectVersesTracked(line, true, { verseNumbers: true });
    if (r.sources.nasb) nasb = true;
    return r.text;
  });
  return { section: recap.section, title: recap.sectionTitle, lines, notice: nasb ? NASB_ATTRIBUTION : null };
}

module.exports = { makeRecap, waitFor, waitForAll, throughId, displayRecap, checkPoints, parseReply, retryMessage, DAILY_MAX };
