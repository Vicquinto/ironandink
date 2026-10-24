const express        = require('express');
const fs             = require('fs');
const path           = require('path');
const { randomUUID } = require('crypto');
const { requireAuth } = require('./layout');
const { createJsonStore } = require('../lib/jsonStore');

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
