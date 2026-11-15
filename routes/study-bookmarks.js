const express   = require('express');
const fs        = require('fs');
const path      = require('path');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('./layout');
const { createJsonStore } = require('../lib/jsonStore');

// Study bookmarks — "Mark my place" / "Pick up where you left off".
//
// One bookmark per (userId, studyId), saved to the account so it follows the
// member across devices. Store: data/study_bookmarks.json, an array of
//   { userId, studyId, blockIndex, snippet, sectionTitle, updatedAt }
//   blockIndex   — index of the block in the rendered study, by the block list
//                  study-listen.js reads (headings, paragraphs, list items,
//                  quotations; Further Studies left out)
//   snippet      — the start of that block's plain text, to re-find it if the
//                  index has shifted
//   sectionTitle — the nearest "## " heading above it, for display
//
// userId is always the session's — never anything from the body. A member may
// bookmark a study they can read: their own, or one shared to the Community.
// Same fail-closed, atomic, one-write-at-a-time store as the notes
// (lib/jsonStore.js).

const router         = express.Router();
const BOOKMARKS_PATH = path.join(__dirname, '../data/study_bookmarks.json');
const STUDIES_PATH   = path.join(__dirname, '../data/studies.json');
const TEXT_MAX       = 200;
const MAX_BLOCK      = 100000;   // far beyond any real study; guards silly values

const bookmarkStore = createJsonStore(BOOKMARKS_PATH, 'study bookmarks');

// Saving a place is a light, occasional action (a click, or Listen stopping);
// this sits under the global /api/ limiter as a second, tighter guard on writes.
const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max:      30,
  message:  { success: false, error: 'Too many requests. Please wait a moment and try again.' },
  standardHeaders: true,
  legacyHeaders:   false,
});

function storeUnavailable(res) {
  return res.status(500).json({ success: false, error: 'Bookmarks are unavailable right now. Nothing was changed.' });
}

function readStudies() {
  try {
    if (!fs.existsSync(STUDIES_PATH)) return [];
    return JSON.parse(fs.readFileSync(STUDIES_PATH, 'utf8'));
  } catch { return []; }
}

// The member can read this study: their own, or one shared to the Community.
function canRead(study, userId) {
  return !!study && (study.userId === userId || study.shared === true);
}
function readableStudy(studyId, userId) {
  const s = readStudies().find(x => x && x.id === studyId);
  return canRead(s, userId) ? s : null;
}

// Trim, strip control characters, collapse whitespace, cap the length.
function cleanText(v) {
  if (v == null) return '';
  return String(v)
    .replace(/[\x00-\x1F\x7F-\x9F]/g, ' ')   // control characters; \s below also covers U+2028/2029
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, TEXT_MAX);
}

function publicShape(b) {
  return {
    studyId:      b.studyId,
    blockIndex:   b.blockIndex,
    snippet:      b.snippet || '',
    sectionTitle: b.sectionTitle || '',
    updatedAt:    b.updatedAt,
  };
}

// ─── GET /api/study-bookmarks ─────────────────────────────────────────────────
// The member's bookmarks as { studyId: { sectionTitle, updatedAt } }, for the
// Library cards. Only studies the member can still read are listed.
router.get('/api/study-bookmarks', requireAuth, (req, res) => {
  const userId = req.session.userId;
  let marks;
  try { marks = bookmarkStore.read().filter(b => b && b.userId === userId); }
  catch { return storeUnavailable(res); }
  const studies = readStudies();
  const byId = {};
  studies.forEach(s => { if (s && s.id) byId[s.id] = s; });
  const bookmarks = {};
  marks.forEach(b => {
    if (!canRead(byId[b.studyId], userId)) return;
    bookmarks[b.studyId] = { sectionTitle: b.sectionTitle || '', updatedAt: b.updatedAt };
  });
  res.json({ success: true, bookmarks });
});

// ─── GET /api/study-bookmarks/:studyId ────────────────────────────────────────
router.get('/api/study-bookmarks/:studyId', requireAuth, (req, res) => {
  const userId  = req.session.userId;
  const studyId = req.params.studyId;
  if (!readableStudy(studyId, userId)) return res.status(404).json({ success: false, error: 'Study not found.' });
  let mark;
  try { mark = bookmarkStore.read().find(b => b && b.userId === userId && b.studyId === studyId); }
  catch { return storeUnavailable(res); }
  if (!mark) return res.status(404).json({ success: false, error: 'No bookmark.' });
  res.json({ success: true, bookmark: publicShape(mark) });
});

// ─── PUT / POST /api/study-bookmarks/:studyId ─────────────────────────────────
// Set or replace. POST is the same, for navigator.sendBeacon (which can only POST).
// Body: { blockIndex, snippet, sectionTitle }.
async function setBookmark(req, res) {
  const userId  = req.session.userId;
  const studyId = req.params.studyId;
  const body    = req.body || {};
  const blockIndex = body.blockIndex;
  if (!Number.isInteger(blockIndex) || blockIndex < 0 || blockIndex > MAX_BLOCK) {
    return res.status(400).json({ success: false, error: 'Invalid place in the study.' });
  }
  if ((body.snippet != null && String(body.snippet).length > TEXT_MAX * 4) ||
      (body.sectionTitle != null && String(body.sectionTitle).length > TEXT_MAX * 4)) {
    return res.status(400).json({ success: false, error: 'Bookmark text is too long.' });
  }
  if (!readableStudy(studyId, userId)) return res.status(404).json({ success: false, error: 'Study not found.' });

  const record = {
    userId,
    studyId,
    blockIndex,
    snippet:      cleanText(body.snippet),
    sectionTitle: cleanText(body.sectionTitle),
    updatedAt:    new Date().toISOString(),
  };
  try {
    await bookmarkStore.update(marks => {
      const i = marks.findIndex(b => b && b.userId === userId && b.studyId === studyId);
      if (i === -1) marks.push(record); else marks[i] = record;
      return { changed: true };
    });
  } catch { return storeUnavailable(res); }
  res.json({ success: true, bookmark: publicShape(record) });
}
router.put('/api/study-bookmarks/:studyId',  requireAuth, writeLimiter, setBookmark);
router.post('/api/study-bookmarks/:studyId', requireAuth, writeLimiter, setBookmark);

// ─── DELETE /api/study-bookmarks/:studyId ─────────────────────────────────────
// Removes only the session member's own bookmark. No study check: a member can
// always clear their own record, even for a study that has gone private.
router.delete('/api/study-bookmarks/:studyId', requireAuth, writeLimiter, async (req, res) => {
  try {
    await deleteBookmarksForStudy(req.params.studyId, req.session.userId);
  } catch { return storeUnavailable(res); }
  res.json({ success: true });
});

// Cascade helper: remove bookmarks for a study — one member's (userId given) or
// every member's (userId null: the study was deleted). Resolves with the count
// removed; rejects (removing nothing) if the store can't be read.
function deleteBookmarksForStudy(studyId, userId) {
  return bookmarkStore.update(marks => {
    const before = marks.length;
    for (let i = marks.length - 1; i >= 0; i--) {
      const b = marks[i];
      if (b && b.studyId === studyId && (userId == null || b.userId === userId)) marks.splice(i, 1);
    }
    return { changed: marks.length !== before, removed: before - marks.length };
  }).then(r => r.removed);
}

module.exports = router;
module.exports.deleteBookmarksForStudy = deleteBookmarksForStudy;
