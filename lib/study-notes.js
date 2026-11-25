'use strict';

// Study Notes: the member's saved points (data/study_notes.json) and the clean
// capture behind "Save this point".
//
// Store: one record per (userId, studyId):
//   { userId, studyId, studyTopic, sections, points: [], recaps: [], updatedAt }
//   recap: { section, sectionTitle, sessionId, lines, throughMessageId, createdAt }, one
//   per section (lib/section-recap.js)
//   point: { id, kind: 'lesson'|'check', sessionId, messageId, messageIndex,
//            section (or null), sectionTitle, part1, text, raw: [a, b], note, ts, updatedAt? }
//     text — the saved words with {{verse:…}} markers, never verse text
//     raw  — where they sit in the reply's stored text, for the faint highlight
// Separate from the Teacher's sessions, so
//   starting over, deleting or finishing a session never touches it.

const path = require('path');
const { createJsonStore } = require('./jsonStore');
const { injectSegments } = require('./asv');

const notesStore = createJsonStore(path.join(__dirname, '../data/study_notes.json'), 'Study Notes');

// Which section a lesson message belongs to: its saved tag (routes/teacher.js
// saveExchange). id AND section: before tagging, a jump's own message already had a
// section. endsSection: this reply also finished the section before.
function isTagged(m) { return !!m && typeof m.id === 'string' && Number.isInteger(m.section); }
function inSection(m, n) { return isTagged(m) && (m.section === n || m.endsSection === n); }

const POINT_MAX = 2000;
const NOTE_MAX  = 500;
const POINTS_MAX = 200;

function findRecord(list, userId, studyId) {
  return list.find(r => r && r.userId === userId && r.studyId === studyId) || null;
}

// ── Clean capture ─────────────────────────────────────────────────────────────
// What the reader sees of a reply, worked out from its stored (raw) text exactly
// as the page does it: verses injected (lib/asv.js), then the reply renderer
// (public/js/teacher-entry.js renderReply: "> " lines, **bold**, *italic*), then
// verse numbers set apart (html-sanitizer.js), which are never counted. White
// space is ignored on both sides, so line breaks can't shift anything.
//
// Returns { segs, shown, skip }:
//   shown — the visible characters, in order: { c, seg, raw } (raw: the position
//           in the stored text; null inside an inserted verse)
//   skip  — stored positions that are marks, not words (* and the "> " of a line)
function displayModel(rawText) {
  const raw  = String(rawText || '');
  const segs = injectSegments(raw, undefined, { verseNumbers: true });
  const chars = [];
  segs.forEach(seg => {
    for (let i = 0; i < seg.out.length; i++) chars.push({ c: seg.out[i], seg, raw: seg.verse ? null : seg.start + i, off: false });
  });

  let from = 0;
  for (let i = 0; i <= chars.length; i++) {
    if (i < chars.length && chars[i].c !== '\n') continue;
    markLine(chars.slice(from, i));
    from = i + 1;
  }
  const skip = new Set();
  chars.forEach(ch => { if (ch.off && ch.raw !== null) skip.add(ch.raw); });
  const shown = chars.filter(ch => !ch.off && !/\s/.test(ch.c) && !/[⁰¹²³⁴⁵⁶⁷⁸⁹]/.test(ch.c));
  return { raw, segs, shown, skip };
}
function markLine(line) {
  const bq = line.map(ch => ch.c).join('').match(/^>\s?/);
  if (bq) for (let i = 0; i < bq[0].length; i++) line[i].off = true;
  [[/\*\*(.+?)\*\*/g, 2], [/\*(.+?)\*/g, 1]].forEach(([re, n]) => {
    const live = line.filter(ch => !ch.off);
    const text = live.map(ch => ch.c).join('');
    let m;
    while ((m = re.exec(text))) {
      for (let i = 0; i < n; i++) {
        live[m.index + i].off = true;
        live[m.index + m[0].length - 1 - i].off = true;
      }
    }
  });
}

const squash = s => String(s || '').replace(/\s+/g, '');

// Every start of `needle` in `hay`, and the one nearest `near` (-1 if none).
function nearest(hay, needle, near) {
  let best = -1;
  if (!needle) return best;
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + 1)) {
    if (best === -1 || Math.abs(i - near) < Math.abs(best - near)) best = i;
  }
  return best;
}

// The stored stretch behind visible characters [s, e): a verse touched at all is
// taken whole, as its marker.
function rawRange(model, s, e) {
  const a = model.shown[s], b = model.shown[e - 1];
  return [a.raw === null ? a.seg.start : a.raw, b.raw === null ? b.seg.end : b.raw + 1];
}
function paragraphs(raw, a, b) {
  const before = raw.slice(0, a).match(/\n[ \t]*\n(?![\s\S]*\n[ \t]*\n)/);
  const start  = before ? before.index + before[0].length : 0;
  const after  = raw.slice(b).search(/\n[ \t]*\n/);
  return [start, after === -1 ? raw.length : b + after];
}
// The words to keep: marks removed, each verse as one marker.
function cleanText(model, a, b) {
  let out = '';
  model.segs.forEach(seg => {
    if (seg.verse) { if (seg.start < b && seg.end > a) out += '{{verse:' + seg.ref + '}}'; return; }
    for (let p = Math.max(a, seg.start); p < Math.min(b, seg.end); p++) if (!model.skip.has(p)) out += model.raw[p];
  });
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// rawText: the stored reply. sel: { start, text } — where the selection starts, in
// visible non-space characters, and the selected words, as the page counts them.
// Returns { text, raw: [a, b] } or null when nothing sensible was selected.
function capturePoint(rawText, sel) {
  const model = displayModel(rawText);
  const all   = model.shown.map(ch => ch.c).join('');
  const start = sel.start;
  const want  = squash(sel.text);
  if (!want || start >= all.length) return null;       // only a notice under the reply

  // A selection that runs on into the credit line under the reply ends with the reply.
  const end = Math.min(start + want.length, all.length);
  let range = null;
  if (all.slice(start, end) === want.slice(0, end - start)) {
    range = rawRange(model, start, end);
  } else {
    const at = nearest(all, want, start);
    if (at !== -1) range = rawRange(model, at, at + want.length);
  }
  if (!range) {
    // Not an exact match: the whole paragraphs it touches, from the first and the
    // last stretch of it (12 characters) that is really in the reply.
    const n = Math.min(12, want.length);
    let h = -1, t = -1;
    for (let i = 0; h === -1 && i + n <= want.length; i++) h = nearest(all, want.slice(i, i + n), start + i);
    if (h === -1) return null;
    for (let i = want.length - n; t === -1 && i >= 0; i--) t = nearest(all, want.slice(i, i + n), start + i);
    const r = rawRange(model, Math.min(h, t), Math.max(h, t) + n);
    range = paragraphs(model.raw, r[0], r[1]);
  }
  const text = cleanText(model, range[0], range[1]);
  return text ? { text, raw: range } : null;
}

// Where a saved stretch is now, in the page's visible characters: { start, end },
// or null.
function shownRange(rawText, range) {
  if (!Array.isArray(range)) return null;
  const model = displayModel(rawText);
  const inside = ch => ch.raw === null ? (ch.seg.start < range[1] && ch.seg.end > range[0]) : (ch.raw >= range[0] && ch.raw < range[1]);
  const start = model.shown.findIndex(inside);
  if (start === -1) return null;
  let end = start;
  model.shown.forEach((ch, i) => { if (inside(ch)) end = i + 1; });
  return { start, end };
}

module.exports = { notesStore, findRecord, isTagged, inSection, capturePoint, shownRange, displayModel, POINT_MAX, NOTE_MAX, POINTS_MAX };
