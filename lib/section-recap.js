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

const LINES_MIN = 3, LINES_MAX = 5, LINE_CHARS = 300, MARKERS_MAX = 2;
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

// true when `line` repeats QUOTE_WORDS words in a row of any of these texts.
function repeats(line, texts) {
  const w = words(line);
  for (let i = 0; i + QUOTE_WORDS <= w.length; i++) {
    const run = ' ' + w.slice(i, i + QUOTE_WORDS).join(' ') + ' ';
    if (texts.some(t => t.includes(run))) return true;
  }
  return false;
}

// The model's points → clean lines, or null when they can't be trusted.
function checkPoints(points, conversation) {
  if (!Array.isArray(points) || points.length < LINES_MIN || points.length > LINES_MAX) return null;
  const allowed = new Map();   // the references this section's conversation used as markers
  conversation.forEach(m => {
    for (const x of String(m.content || '').matchAll(MARKER_RE)) allowed.set(refKey(x[1]), x[1].trim());
  });
  const verseTexts = [];
  allowed.forEach(ref => { const r = resolve(ref); if (r) verseTexts.push(' ' + words(r.text).join(' ') + ' '); });

  let markers = 0;
  const lines = [];
  for (const p of points) {
    if (typeof p !== 'string') return null;
    const line = p.replace(/\s+/g, ' ').trim()
      .replace(/^>\s*/, '')
      .replace(MARKER_RE, (_m, ref) => {
        const ok = allowed.get(refKey(ref));
        if (!ok || markers >= MARKERS_MAX) return ref.trim();   // a plain reference
        markers++;
        return '{{verse:' + ok + '}}';
      });
    if (!line || line.length >= LINE_CHARS) return null;
    const bare = line.replace(MARKER_RE, '');
    if (/[{}]|\[\[|\]\]/.test(bare)) return null;             // a broken marker or a progress tag
    const quoted = bare.match(/“[^”]*”|"[^"]*"/g) || [];
    if (quoted.some(q => words(q).length >= QUOTE_WORDS)) return null;
    if (repeats(bare, verseTexts)) return null;
    lines.push(line);
  }
  return lines;
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

  let lines = null;
  for (let attempt = 0; attempt < 2 && !lines; attempt++) {
    if (!(await takeCall(job.userId))) return { reason: 'limit' };
    let message;
    try {
      message = await client.messages.create({
        model:         'claude-opus-5-5',
        max_tokens:    4000,
        output_config: { effort: 'low' },
        system:        IRON_INK_CORE_PROMPT + '\n\n' + IRON_INK_RECAP_PROMPT,
        messages:      [{ role: 'user', content }],
      });
    } catch (err) {
      console.error('[Teacher/recap] API error — status:', err.status, '| message:', err.message);
      continue;
    }
    const u = message.usage || {};
    console.log(`[Teacher/recap] usage — input:${u.input_tokens} cache_read:${u.cache_read_input_tokens} cache_write:${u.cache_creation_input_tokens} output:${u.output_tokens} stop:${message.stop_reason}`);
    if (message.stop_reason === 'refusal') return { reason: 'failed' };
    const text = message.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const json = text.match(/\{[\s\S]*\}/);
    try { lines = checkPoints(json && JSON.parse(json[0]).points, list); } catch { lines = null; }
    if (!lines) console.warn('[Teacher/recap] reply did not pass the checks (attempt ' + (attempt + 1) + ')');
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

module.exports = { makeRecap, waitFor, throughId, displayRecap, checkPoints, DAILY_MAX };
