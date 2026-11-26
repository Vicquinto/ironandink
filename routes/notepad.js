const express        = require('express');
const fs             = require('fs');
const path           = require('path');
const { randomUUID } = require('crypto');
const { requireAuth } = require('./layout');
const rateLimit = require('express-rate-limit');
const { createJsonStore } = require('../lib/jsonStore');
const { parseLessonSections } = require('./teacher');
const geo = require('../lib/geo');

const router        = express.Router();
const NOTEPADS_PATH = path.join(__dirname, '../data/notepads.json');
const STUDIES_PATH  = path.join(__dirname, '../data/studies.json');

// Notepad store shape: an array of notepad records, one per (studyId, userId):
//   { studyId, userId, notes: [ note, ... ] }
// note: { id, marker, quote, occurrence, question, content, source, ts, updatedAt? }
//   marker     — sequential number per notepad for anchored notes; null for free notes
//   quote      — the highlighted study text a note is anchored to; null for free notes
//   occurrence — 0-based index of which occurrence of quote was highlighted; null if n/a
//   question — what was asked (Explore); null otherwise
//   content  — the note body (markdown text from the editor)
//   source   — 'define' | 'explore' | 'verse' | 'personal' | 'free'
//   section, sectionTitle — optional, notes with no quote only: the study section
//              the member filed it under (the Teacher's numbering); absent = none.
//   geo      — optional map references from a pinned tooltip answer:
//              { places: ['<pleiadesId>', …], roads: ['<road name>', …] },
//              validated by lib/geo.js sanitizeGeoRefs; absent when none.

// Fail-closed, atomic, one-write-at-a-time store (lib/jsonStore.js). read()
// throws if the file exists but is damaged; update() never overwrites it then.
const notepadStore = createJsonStore(NOTEPADS_PATH, 'notepads');

// The store file is damaged (already logged by the store): nothing was changed.
function storeUnavailable(res) {
  return res.status(500).json({ success: false, error: 'Notes are unavailable right now. Nothing was changed.' });
}

function readStudies() {
  try {
    if (!fs.existsSync(STUDIES_PATH)) return [];
    return JSON.parse(fs.readFileSync(STUDIES_PATH, 'utf8'));
  } catch { return []; }
}

const VALID_SOURCES = ['define', 'explore', 'verse', 'personal', 'free'];

// Filing a note under a section: one of this study's sections now, or null.
// Returns { n, title } / null, or false when the number isn't one of them.
function sectionOf(studyId, value) {
  if (value === null || value === undefined) return null;
  const study = readStudies().find(s => s && s.id === studyId);
  const list  = study ? parseLessonSections(study.content) : [];
  return (Number.isInteger(value) && list.find(s => s.n === value)) || false;
}
const sectionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max:      30,
  message:  { success: false, error: 'Too many requests. Please wait a moment and try again.' },
  standardHeaders: true,
  legacyHeaders:   false,
});

function findNotepad(pads, studyId, userId) {
  return pads.find(p => p.studyId === studyId && p.userId === userId);
}

// Cascade helper: remove the notepad (and all its notes) for a given study. Used
// when a study is deleted from the Library so notes are never left orphaned. If
// userId is provided, only that user's notepad for the study is removed; pass null
// to remove every user's notepad for the study. Resolves with the number of pads
// removed; rejects (removing nothing) if the store can't be read.
function deleteNotepadsForStudy(studyId, userId) {
  return notepadStore.update(pads => {
    const before = pads.length;
    for (let i = pads.length - 1; i >= 0; i--) {
      const p = pads[i];
      if (p.studyId === studyId && (userId == null || p.userId === userId)) pads.splice(i, 1);
    }
    return { changed: pads.length !== before, removed: before - pads.length };
  }).then(r => r.removed);
}

function sortNotes(notes) {
  // Anchored notes first (by marker), then free notes (by time)
  return notes.slice().sort((a, b) => {
    const am = typeof a.marker === 'number' ? a.marker : Infinity;
    const bm = typeof b.marker === 'number' ? b.marker : Infinity;
    if (am !== bm) return am - bm;
    return new Date(a.ts) - new Date(b.ts);
  });
}

// ─── GET /api/notepad/all ─────────────────────────────────────────────────────
// All of this user's notes across every study, grouped by parent study. Declared
// before /:studyId so "all" is never captured as a studyId param.
router.get('/api/notepad/all', requireAuth, (req, res) => {
  const userId  = req.session.userId;
  let pads;
  try { pads = notepadStore.read().filter(p => p.userId === userId); }
  catch { return storeUnavailable(res); }
  const studies = readStudies();

  const titleById = {};
  studies.forEach(s => { titleById[s.id] = s.topic; });

  const groups = pads
    .map(p => ({
      studyId:     p.studyId,
      studyTitle:  titleById[p.studyId] || 'Untitled study',
      studyExists: Object.prototype.hasOwnProperty.call(titleById, p.studyId),
      notes:       sortNotes(p.notes || []),
    }))
    .filter(g => g.notes.length > 0)
    .sort((a, b) => {
      const at = a.notes.reduce((m, n) => Math.max(m, +new Date(n.updatedAt || n.ts)), 0);
      const bt = b.notes.reduce((m, n) => Math.max(m, +new Date(n.updatedAt || n.ts)), 0);
      return bt - at;
    });

  res.json({ success: true, groups });
});

// ─── GET /api/notepad/:studyId ────────────────────────────────────────────────
router.get('/api/notepad/:studyId', requireAuth, (req, res) => {
  const userId = req.session.userId;
  let pad;
  try { pad = findNotepad(notepadStore.read(), req.params.studyId, userId); }
  catch { return storeUnavailable(res); }
  res.json({
    success:  true,
    notepad: { studyId: req.params.studyId, notes: pad ? sortNotes(pad.notes) : [] },
  });
});

// ─── POST /api/notepad/:studyId/note ──────────────────────────────────────────
router.post('/api/notepad/:studyId/note', requireAuth, async (req, res) => {
  const userId    = req.session.userId;
  const { studyId } = req.params;
  const { quote, question, content, source, occurrence } = req.body;

  const src      = VALID_SOURCES.includes(source) ? source : 'free';
  const hasQuote = quote != null && String(quote).trim() !== '';
  const geoRefs  = geo.sanitizeGeoRefs(req.body.geo);
  const sec      = hasQuote ? null : sectionOf(studyId, req.body.section);
  if (sec === false) return res.status(400).json({ success: false, error: 'That section isn’t part of this study.' });

  let result;
  try {
    result = await notepadStore.update(pads => {
      let pad = findNotepad(pads, studyId, userId);
      if (!pad) { pad = { studyId, userId, notes: [] }; pads.push(pad); }

      // Marker: sequential per notepad, assigned only to anchored notes.
      let marker = null;
      if (hasQuote) {
        const maxMarker = pad.notes.reduce(
          (m, n) => (typeof n.marker === 'number' && n.marker > m ? n.marker : m), 0);
        marker = maxMarker + 1;
      }

      const note = {
        id:       randomUUID(),
        marker,
        quote:    hasQuote ? String(quote) : null,
        // 0-based index of which occurrence of `quote` in the study body was
        // highlighted, so the display-only marker lands on the right one. null when
        // not anchored or not provided (older clients) → render falls back to first.
        occurrence: (hasQuote && typeof occurrence === 'number' && occurrence >= 0) ? occurrence : null,
        question: (question != null && String(question).trim() !== '') ? String(question) : null,
        content:  content != null ? String(content) : '',
        source:   src,
        ts:       new Date().toISOString(),
      };
      if (geoRefs) note.geo = geoRefs;
      if (sec) { note.section = sec.n; note.sectionTitle = sec.title; }

      pad.notes.push(note);
      return { changed: true, note };
    });
  } catch { return storeUnavailable(res); }
  res.json({ success: true, note: result.note });
});

// ─── PUT /api/notepad/:studyId/note/:noteId ───────────────────────────────────
router.put('/api/notepad/:studyId/note/:noteId', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const { studyId, noteId } = req.params;
  const { content } = req.body;

  let result;
  try {
    result = await notepadStore.update(pads => {
      const pad = findNotepad(pads, studyId, userId);
      if (!pad) return { changed: false, error: 'Notepad not found.' };

      const note = pad.notes.find(n => n.id === noteId);
      if (!note) return { changed: false, error: 'Note not found.' };

      note.content   = content != null ? String(content) : '';
      note.updatedAt = new Date().toISOString();
      return { changed: true, note };
    });
  } catch { return storeUnavailable(res); }
  if (result.error) return res.status(404).json({ success: false, error: result.error });
  res.json({ success: true, note: result.note });
});

// ─── PUT /api/notepad/:studyId/note/:noteId/occurrence ────────────────────────
// Quiet repair of an anchored note's position, sent by the reader when it had
// to find the note by its quote (public/js/notepad.js placeMarker). Only for
// notes saved since the Listen release (b5b191d), whose saved position may be
// too high; older notes are never changed. `from` must equal the stored value,
// so a stale tab can't overwrite a newer correction. Only the caller's own
// notepad is touched (userId from the session).
const OCCURRENCE_REPAIR_SINCE = Date.parse('2026-11-15T00:32:49Z');
router.put('/api/notepad/:studyId/note/:noteId/occurrence', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const { studyId, noteId } = req.params;
  const { from, occurrence } = req.body || {};
  if (!Number.isInteger(occurrence) || occurrence < 0 || occurrence > 100000) {
    return res.status(400).json({ success: false, error: 'Invalid position.' });
  }
  if (from !== null && !(Number.isInteger(from) && from >= 0)) {
    return res.status(400).json({ success: false, error: 'Invalid position.' });
  }

  let result;
  try {
    result = await notepadStore.update(pads => {
      const pad = findNotepad(pads, studyId, userId);
      if (!pad) return { changed: false, error: 'Notepad not found.' };
      const note = pad.notes.find(n => n.id === noteId);
      if (!note || !note.quote) return { changed: false, error: 'Note not found.' };
      const saved = Date.parse(note.ts);
      if (isNaN(saved) || saved < OCCURRENCE_REPAIR_SINCE) return { changed: false, refused: true };
      const cur = (typeof note.occurrence === 'number') ? note.occurrence : null;
      if (cur !== from) return { changed: false, refused: true };
      if (cur === occurrence) return { changed: false };
      note.occurrence = occurrence;
      return { changed: true };
    });
  } catch { return storeUnavailable(res); }
  if (result.error) return res.status(404).json({ success: false, error: result.error });
  if (result.refused) return res.status(409).json({ success: false, error: 'Not changed.' });
  res.json({ success: true });
});

// ─── PUT /api/notepad/:studyId/note/:noteId/section ───────────────────────────
// File a note with no quote under another section (Study Notes "Move to
// section…"). Body: { section: N | null }. A note on highlighted text stays with
// its text. Only the caller's own notepad.
router.put('/api/notepad/:studyId/note/:noteId/section', requireAuth, sectionLimiter, async (req, res) => {
  const userId = req.session.userId;
  const { studyId, noteId } = req.params;
  if (!req.body || !Object.prototype.hasOwnProperty.call(req.body, 'section')) {
    return res.status(400).json({ success: false, error: 'Choose a section.' });
  }
  const sec = sectionOf(studyId, req.body.section);
  if (sec === false) return res.status(400).json({ success: false, error: 'That section isn’t part of this study.' });

  let result;
  try {
    result = await notepadStore.update(pads => {
      const pad  = findNotepad(pads, studyId, userId);
      const note = pad && pad.notes.find(n => n.id === noteId);
      if (!note) return { changed: false, error: 'Note not found.' };
      if (note.quote) return { changed: false, anchored: true };
      if (sec) { note.section = sec.n; note.sectionTitle = sec.title; }
      else { delete note.section; delete note.sectionTitle; }
      note.updatedAt = new Date().toISOString();
      return { changed: true, section: sec ? sec.n : null };
    });
  } catch { return storeUnavailable(res); }
  if (result.error) return res.status(404).json({ success: false, error: result.error });
  if (result.anchored) return res.status(400).json({ success: false, error: 'A note on highlighted text stays with its text.' });
  res.json({ success: true, section: result.section });
});

// ─── DELETE /api/notepad/:studyId/note/:noteId ────────────────────────────────
router.delete('/api/notepad/:studyId/note/:noteId', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const { studyId, noteId } = req.params;

  let result;
  try {
    result = await notepadStore.update(pads => {
      const pad = findNotepad(pads, studyId, userId);
      if (!pad) return { changed: false, error: 'Notepad not found.' };

      const before = pad.notes.length;
      pad.notes = pad.notes.filter(n => n.id !== noteId);
      if (pad.notes.length === before) return { changed: false, error: 'Note not found.' };
      return { changed: true };
    });
  } catch { return storeUnavailable(res); }
  if (result.error) return res.status(404).json({ success: false, error: result.error });
  res.json({ success: true });
});

module.exports = router;
// Expose the cascade helper so the Library delete route can clean up notes.
module.exports.deleteNotepadsForStudy = deleteNotepadsForStudy;
// Read only, for Study Notes (routes/study-notes.js). Both throw if the store
// is damaged.
module.exports.notesFor = (studyId, userId) => {
  const pad = findNotepad(notepadStore.read(), studyId, userId);
  return pad ? sortNotes(pad.notes || []) : [];
};
module.exports.studyIdsWithNotes = userId => notepadStore.read()
  .filter(p => p.userId === userId && (p.notes || []).length)
  .map(p => p.studyId);
