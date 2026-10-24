const express = require('express');
const { escapeHtml, inlineJson } = require('../lib/html');
const fs      = require('fs');
const path    = require('path');
const { randomUUID } = require('crypto');
const { createJsonStore } = require('../lib/jsonStore');
const { requireAuth, renderLayout } = require('./layout');
const nasb = require('../lib/nasb');
const { chapterVerses: asvChapterVerses, NASB_ATTRIBUTION } = require('../lib/asv');

const router       = express.Router();
const KJV_PATH     = path.join(__dirname, '../data/kjv.json');
const TRACKER_PATH = path.join(__dirname, '../data/reading_tracker.json');
const NOTES_PATH   = path.join(__dirname, '../data/scripture_notes.json');

// Public-domain fallback notice, shown when a chapter resolved to ASV (NASB not
// cached and API.Bible unreachable) so Scripture never fails to display.
const ASV_COPYRIGHT = 'American Standard Version (1901, public domain)';

// data/kjv.json is retained ONLY as the reader's book/chapter SKELETON — book
// names, abbreviations, and chapter counts for the navigation dropdowns. Its KJV
// verse text is NEVER displayed; verse text now comes from NASB 1995 (lib/nasb,
// on-demand cache) with a silent ASV fallback (lib/asv). The book names in
// data/kjv.json are the canonical names that key both data/asv.json and the NASB
// cache, so a book resolves across all three by name.
let _bible = null;
function getBible() {
  // Lazy-load once. Strip a leading UTF-8 BOM (U+FEFF) before parsing: JSON.parse
  // throws on a BOM ("Unexpected token"), so a BOM-carrying copy of data/kjv.json
  // would otherwise 500 the whole reader. The slice is a no-op on a clean file.
  if (!_bible) {
    let raw = fs.readFileSync(KJV_PATH, 'utf8');
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    _bible = JSON.parse(raw);
  }
  return _bible;
}

function readTracker() {
  try {
    if (!fs.existsSync(TRACKER_PATH)) return {};
    return JSON.parse(fs.readFileSync(TRACKER_PATH, 'utf8'));
  } catch { return {}; }
}

function writeTracker(data) {
  fs.writeFileSync(TRACKER_PATH, JSON.stringify(data, null, 2));
}

// Resolve a chapter to verse text: NASB 1995 (cached, lazily fetched) as primary,
// ASV as the silent fallback. Returns { verses:[{verse,text}], source, copyright }.
// Never fetches ESV. Never fails for a valid canonical book/chapter — ASV backs it.
async function resolveChapter(bookName, chapterNum) {
  const { map, source } = await nasb.ensureChapter(bookName, chapterNum);
  if (map && source) {
    const verses = Object.keys(map)
      .map(Number)
      .filter(n => Number.isFinite(n))
      .sort((a, b) => a - b)
      .map(n => ({ verse: n, text: String(map[String(n)]).trim() }));
    if (verses.length) {
      return { verses, source, copyright: NASB_ATTRIBUTION };
    }
  }
  const asvVerses = asvChapterVerses(bookName, chapterNum) || [];
  return { verses: asvVerses, source: 'ASV', copyright: ASV_COPYRIGHT };
}

// Server-side render of a chapter body (verses + copyright footer), matching the
// markup the client produces so the SSR initial paint and later client renders
// are identical. Joined with no whitespace between verses, exactly as the client
// does: chapter notes anchor on the body's text (quote + occurrence), so a note
// saved on the first paint must find the same text after a client re-render.
function renderVerses(verses) {
  return verses.map(v =>
    `<p class="scripture-verse"><sup class="verse-num">${escapeHtml(v.verse)}</sup>${escapeHtml(v.text)}</p>`
  ).join('');
}
function renderChapterBody(verses, copyright) {
  return renderVerses(verses) + `<p class="scripture-copyright">${escapeHtml(copyright)}</p>`;
}

// ─── GET /scripture ──────────────────────────────────────────────────────────
router.get('/scripture', requireAuth, async (req, res) => {
  const bible     = getBible();
  const firstBook = bible[0];

  const bookOptions = bible.map(b =>
    `<option value="${b.abbrev}" data-chapters="${b.chapters.length}"${b.abbrev === 'gn' ? ' selected' : ''}>${b.name}</option>`
  ).join('\n        ');

  const chapterOptions = Array.from({ length: firstBook.chapters.length }, (_, i) =>
    `<option value="${i + 1}"${i === 0 ? ' selected' : ''}>${i + 1}</option>`
  ).join('\n        ');

  // Initial paint: Genesis 1, NASB 1995 (cached/lazily fetched) with ASV fallback.
  const initChapter = await resolveChapter(firstBook.name, 1);
  const initBody    = renderChapterBody(initChapter.verses, initChapter.copyright);

  const subtitle  = 'New American Standard Bible 1995';
  const bookNames = JSON.stringify(bible.map(b => b.name));

  const content = `
    <div class="scripture-page-layout">
      <div class="scripture-main-col">
        <div class="page-header">
          <h2 class="page-title">Scripture</h2>
          <p class="page-subtitle">${subtitle}</p>
        </div>

        <div class="scripture-nav">
          <select id="bookSelect" class="scripture-select">
            ${bookOptions}
          </select>
          <select id="chapterSelect" class="scripture-select">
            ${chapterOptions}
          </select>
          <span class="scripture-audio" id="scriptureAudio" style="display:none;">
            <button class="guide-print-btn" id="ttsPlay" type="button" title="Read the chapter aloud">Read Aloud</button>
            <button class="guide-print-btn" id="ttsStop" type="button" disabled>Stop</button>
            <select class="scripture-select scripture-audio-select" id="ttsRate" aria-label="Reading speed" title="Reading speed">
              <option value="0.75">0.75&times;</option>
              <option value="0.9">0.9&times;</option>
              <option value="1" selected>1&times;</option>
              <option value="1.1">1.1&times;</option>
              <option value="1.25">1.25&times;</option>
              <option value="1.5">1.5&times;</option>
            </select>
            <select class="scripture-select scripture-audio-select scripture-audio-voice" id="ttsVoice" aria-label="Voice" title="Voice"></select>
          </span>
          <button class="guide-print-btn scripture-notes-toggle" id="scriptureNotesToggle" type="button" title="Hide or show the notes panel">Hide Notes</button>
        </div>

        <div class="scripture-card" id="scriptureCard">
          <h3 class="scripture-heading" id="scriptureHeading">Genesis 1</h3>
          <div class="guide-font-toolbar">
            <button class="guide-font-btn guide-font-btn-sm" id="scriptFontDec">A&#8722;</button>
            <button class="guide-font-btn guide-font-btn-md" id="scriptFontReset">A</button>
            <button class="guide-font-btn guide-font-btn-lg" id="scriptFontInc">A+</button>
          </div>
          <div class="scripture-body" id="scriptureBody">${initBody}</div>
        </div>

        <div class="tracker-section">
          <h3 class="tracker-heading">Reading Tracker</h3>
          <div class="tracker-grid" id="trackerGrid">
            <p class="scripture-loading">Loading tracker&#8230;</p>
          </div>
        </div>
      </div>

      <div class="scripture-pin-sidebar" id="scripturePinSidebar">
        <div class="spot-note-wrap" id="spotNoteWrap" style="display:none;">
          <div class="sps-heading">Last Marked</div>
          <div class="spot-note-list" id="spotNoteList"></div>
        </div>
        <div class="scripture-notes-wrap" id="scriptureNotesWrap">
          <div class="sps-heading">Chapter Notes</div>
          <div class="scripture-notes-composer" id="scriptureNotesComposer" style="display:none;">
            <div class="notepad-anchor-banner" id="scriptureNotesAnchor"></div>
            <textarea class="notepad-input" id="scriptureNotesInput" rows="3" maxlength="5000"
              placeholder="Write a note… (markdown: **bold**, *italic*, &gt; quote, - list)"></textarea>
            <div class="notepad-composer-actions">
              <button class="notepad-cancel-anchor" id="scriptureNotesCancel" type="button">Cancel</button>
              <button class="notepad-add-btn" id="scriptureNotesSave" type="button">Save Note</button>
            </div>
          </div>
          <div class="sps-empty-msg" id="scriptureNotesEmpty">Highlight a passage and choose Add Note to keep a note on this chapter.</div>
          <div class="scripture-notes-list" id="scriptureNotesList"></div>
        </div>
        <div class="sps-legacy-pins" id="spsLegacyPins" style="display:none;">
          <div class="sps-heading">Pinned Notes</div>
          <div class="sps-empty-msg" id="spsEmpty">Pin a tooltip result to keep it here.</div>
          <div class="sps-list" id="spsList"></div>
        </div>
      </div>
    </div>

    <div class="tracker-goal-overlay" id="trackerGoalOverlay" style="display:none;" role="dialog" aria-modal="true">
      <div class="tracker-goal-box">
        <p id="trackerGoalMsg"></p>
        <div style="width:90px;margin:0 auto;">
          <input type="number" id="trackerGoalInput" min="1" max="999" class="form-input" style="text-align:center;">
        </div>
        <div class="tracker-goal-actions">
          <button id="trackerGoalCancel" class="btn-warm" style="padding:10px 20px;">Cancel</button>
          <button id="trackerGoalConfirm" class="btn-primary" style="padding:10px 20px;">Set Goal &amp; Mark</button>
        </div>
      </div>
    </div>

    <script>window._bibleBooks = ${bookNames};</script>
    <div class="spot-toast" id="spotToast">Spot saved ✓</div>`;

  res.send(renderLayout({
    req,
    activeSection: 'scripture',
    title:         'Scripture',
    content,
    scripts:       `<script src="/js/study-badges.js?v=4"></script><script src="/js/render-markdown.js?v=2"></script><script src="/js/enhance-further-studies.js?v=2"></script><script src="/js/scripture.js?v=11"></script><script src="/js/scripture-notes.js?v=5"></script><script src="/js/scripture-audio.js?v=2"></script><script src="/js/library.js?v=68"></script>`,
  }));
});

// ─── GET /api/scripture/:abbrev/:chapter ─────────────────────────────────────
router.get('/api/scripture/:abbrev/:chapter', requireAuth, async (req, res) => {
  const { abbrev, chapter } = req.params;
  const bible = getBible();
  const book  = bible.find(b => b.abbrev === abbrev);
  if (!book) return res.status(404).json({ success: false, error: 'Book not found.' });

  const idx = parseInt(chapter, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= book.chapters.length) {
    return res.status(404).json({ success: false, error: 'Chapter not found.' });
  }

  // NASB 1995 (cached, lazily fetched) with a silent ASV fallback. book.name is the
  // canonical name shared by the NASB cache and data/asv.json.
  try {
    const { verses, source, copyright } = await resolveChapter(book.name, idx + 1);
    res.json({ success: true, book: book.name, chapter: idx + 1, verses, source, copyright });
  } catch (err) {
    console.error('[scripture] chapter load error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load chapter.' });
  }
});

// ─── GET /api/reading/tracker ────────────────────────────────────────────────
router.get('/api/reading/tracker', requireAuth, (req, res) => {
  const email   = req.session.user.email;
  const tracker = readTracker();
  res.json({ success: true, tracker: tracker[email] || {} });
});

// ─── POST /api/reading/mark-complete ─────────────────────────────────────────
router.post('/api/reading/mark-complete', requireAuth, (req, res) => {
  const { bookName } = req.body;
  if (!bookName) return res.status(400).json({ success: false, error: 'bookName required.' });

  const email   = req.session.user.email;
  const tracker = readTracker();
  if (!tracker[email]) tracker[email] = {};
  if (!tracker[email][bookName]) tracker[email][bookName] = { count: 0, goal: 0, history: [] };

  const book  = tracker[email][bookName];
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' });
  book.count += 1;
  if (!Array.isArray(book.history)) book.history = [];
  book.history.push(today);

  writeTracker(tracker);
  res.json({ success: true, book });
});

// ─── POST /api/reading/set-goal ──────────────────────────────────────────────
router.post('/api/reading/set-goal', requireAuth, (req, res) => {
  const { bookName, goal } = req.body;
  if (!bookName || goal === undefined) {
    return res.status(400).json({ success: false, error: 'bookName and goal required.' });
  }

  const email   = req.session.user.email;
  const tracker = readTracker();
  if (!tracker[email]) tracker[email] = {};
  if (!tracker[email][bookName]) tracker[email][bookName] = { count: 0, goal: 0, history: [] };

  tracker[email][bookName].goal = Math.max(1, parseInt(goal, 10) || 1);
  writeTracker(tracker);
  res.json({ success: true, book: tracker[email][bookName] });
});

// ─── POST /api/reading/mark-spot ─────────────────────────────────────────────
router.post('/api/reading/mark-spot', requireAuth, (req, res) => {
  const { bookName, chapter, verse } = req.body;
  if (!bookName || !chapter) {
    return res.status(400).json({ success: false, error: 'bookName and chapter required.' });
  }

  const email   = req.session.user.email;
  const tracker = readTracker();
  if (!tracker[email]) tracker[email] = {};
  if (!tracker[email][bookName]) tracker[email][bookName] = { count: 0, goal: 0, history: [] };

  const spot = {
    chapter: parseInt(chapter, 10),
    savedAt: new Date().toISOString(),
  };
  if (verse) spot.verse = parseInt(verse, 10);

  tracker[email][bookName].spot = spot;
  writeTracker(tracker);
  res.json({ success: true, spot });
});

// ─── DELETE /api/reading/mark-spot/:bookName ─────────────────────────────────
router.delete('/api/reading/mark-spot/:bookName', requireAuth, (req, res) => {
  const bookName = decodeURIComponent(req.params.bookName);
  const email    = req.session.user.email;
  const tracker  = readTracker();
  if (tracker[email] && tracker[email][bookName]) {
    delete tracker[email][bookName].spot;
    writeTracker(tracker);
  }
  res.json({ success: true });
});

// ─── POST /api/reading/set-count ─────────────────────────────────────────────
router.post('/api/reading/set-count', requireAuth, (req, res) => {
  const { bookName, count } = req.body;
  if (!bookName || count === undefined) {
    return res.status(400).json({ success: false, error: 'bookName and count required.' });
  }

  const parsed = parseInt(count, 10);
  if (isNaN(parsed) || parsed < 0) {
    return res.status(400).json({ success: false, error: 'count must be a non-negative integer.' });
  }

  const email   = req.session.user.email;
  const tracker = readTracker();
  if (!tracker[email]) tracker[email] = {};
  if (!tracker[email][bookName]) tracker[email][bookName] = { count: 0, goal: 0, history: [] };

  tracker[email][bookName].count = parsed;
  writeTracker(tracker);
  res.json({ success: true, book: tracker[email][bookName] });
});

// ─── Chapter notes ───────────────────────────────────────────────────────────
// Personal notes pinned to a passage of a Scripture chapter. Modeled on the study
// notepad (routes/notepad.js): same note fields and the same quote + occurrence
// anchor, plus where in Scripture the passage sits. Shown only on this page.
//
// Store shape: an array of chapter records, one per (userId, book, chapter):
//   { userId, book, chapter, notes: [ note, ... ] }
// note: { id, marker, quote, displayQuote, occurrence, verseStart, verseEnd,
//         question, content, source, ts, updatedAt? }
//   marker     — sequential number per chapter record (as in the study notepad)
//   quote      — the highlighted chapter text, verse numbers left out and verses
//                run together: the anchor that markers are placed by
//   displayQuote — the same passage with a space between verses, shown on the
//                card only (never used to place a marker). null on notes saved
//                before it existed; the card then shows quote.
//   occurrence — 0-based index of which occurrence of quote in the chapter body
//   verseStart / verseEnd — the verse range the highlight covers
//   question   — what was asked (Explore); null otherwise
//   content    — the note body (markdown text)
//   source     — 'define' | 'explore' | 'verse' | 'personal'
//
// Every note is anchored: there are no free notes on a chapter.

const NOTE_SOURCES    = ['define', 'explore', 'verse', 'personal'];
const NOTE_MAX        = 5000;
const NOTE_QUOTE_MAX  = 2000;
const NOTE_QUESTION_MAX = 1000;

// Fail-closed, atomic, one-write-at-a-time store (lib/jsonStore.js), shared
// with the study notepad. read() throws if the file exists but is damaged, and
// update() then writes nothing.
const chapterNoteStore = createJsonStore(NOTES_PATH, 'scripture_notes');

// The store file is damaged (already logged by the store): nothing was changed.
function notesUnavailable(res) {
  return res.status(500).json({ success: false, error: 'Notes are unavailable right now. Nothing was changed.' });
}

// Resolve :book/:chapter to a canonical book name and chapter number, or null.
// The book must be one of the reader's own book names; the chapter must exist.
function resolveNoteChapter(params) {
  const book = getBible().find(b => b.name === params.book);
  if (!book) return null;
  const chapter = /^\d+$/.test(String(params.chapter)) ? parseInt(params.chapter, 10) : NaN;
  if (!(chapter >= 1 && chapter <= book.chapters.length)) return null;
  // Verse ceiling: the skeleton's count, with slack for translations whose
  // versification runs a verse or two longer than the KJV skeleton.
  const verseMax = (Array.isArray(book.chapters[chapter - 1]) ? book.chapters[chapter - 1].length : 176) + 5;
  return { book: book.name, chapter, verseMax };
}

function findChapterRecord(records, userId, book, chapter) {
  return records.find(r => r.userId === userId && r.book === book && r.chapter === chapter);
}

// Verse order (first verse, then last), then the order they were written.
function sortChapterNotes(notes) {
  return notes.slice().sort((a, b) =>
    (a.verseStart - b.verseStart) ||
    (a.verseEnd - b.verseEnd) ||
    (new Date(a.ts) - new Date(b.ts)));
}

function isVerseNum(v, max) {
  return Number.isInteger(v) && v >= 1 && v <= max;
}

// ─── GET /api/scripture-notes/:book/:chapter ─────────────────────────────────
router.get('/api/scripture-notes/:book/:chapter', requireAuth, (req, res) => {
  const ref = resolveNoteChapter(req.params);
  if (!ref) return res.status(400).json({ success: false, error: 'Unknown book or chapter.' });
  let rec;
  try { rec = findChapterRecord(chapterNoteStore.read(), req.session.userId, ref.book, ref.chapter); }
  catch { return notesUnavailable(res); }
  res.json({ success: true, book: ref.book, chapter: ref.chapter, notes: rec ? sortChapterNotes(rec.notes) : [] });
});

// ─── POST /api/scripture-notes/:book/:chapter/note ───────────────────────────
router.post('/api/scripture-notes/:book/:chapter/note', requireAuth, async (req, res) => {
  const ref = resolveNoteChapter(req.params);
  if (!ref) return res.status(400).json({ success: false, error: 'Unknown book or chapter.' });

  const { quote, displayQuote, question, content, source, occurrence, verseStart, verseEnd } = req.body || {};
  const quoteStr   = quote != null ? String(quote).trim() : '';
  const displayStr = displayQuote != null ? String(displayQuote).trim() : '';
  const contentStr = content != null ? String(content) : '';
  const questionStr = (question != null && String(question).trim() !== '') ? String(question) : null;

  if (!quoteStr) return res.status(400).json({ success: false, error: 'A highlighted passage is required.' });
  if (quoteStr.length > NOTE_QUOTE_MAX) {
    return res.status(400).json({ success: false, error: 'The highlighted passage is too long to keep with a note.' });
  }
  if (displayStr.length > NOTE_QUOTE_MAX) {
    return res.status(400).json({ success: false, error: 'The highlighted passage is too long to keep with a note.' });
  }
  if (contentStr.length > NOTE_MAX) {
    return res.status(400).json({ success: false, error: `Note is too long (${NOTE_MAX} characters max).` });
  }
  if (questionStr && questionStr.length > NOTE_QUESTION_MAX) {
    return res.status(400).json({ success: false, error: 'Question is too long.' });
  }
  if (!isVerseNum(verseStart, ref.verseMax) || !isVerseNum(verseEnd, ref.verseMax) || verseEnd < verseStart) {
    return res.status(400).json({ success: false, error: 'Invalid verse.' });
  }

  const userId = req.session.userId;
  let result;
  try {
    result = await chapterNoteStore.update(records => {
      let rec = findChapterRecord(records, userId, ref.book, ref.chapter);
      if (!rec) {
        rec = { userId, book: ref.book, chapter: ref.chapter, notes: [] };
        records.push(rec);
      }

      const maxMarker = rec.notes.reduce(
        (m, n) => (typeof n.marker === 'number' && n.marker > m ? n.marker : m), 0);

      const note = {
        id:         randomUUID(),
        marker:     maxMarker + 1,
        quote:      quoteStr,
        displayQuote: displayStr || null,
        occurrence: (Number.isInteger(occurrence) && occurrence >= 0) ? occurrence : null,
        verseStart,
        verseEnd,
        question:   questionStr,
        content:    contentStr,
        source:     NOTE_SOURCES.includes(source) ? source : 'personal',
        ts:         new Date().toISOString(),
      };

      rec.notes.push(note);
      return { changed: true, note };
    });
  } catch { return notesUnavailable(res); }
  res.json({ success: true, note: result.note });
});

// ─── PUT /api/scripture-notes/:book/:chapter/note/:noteId ────────────────────
router.put('/api/scripture-notes/:book/:chapter/note/:noteId', requireAuth, async (req, res) => {
  const ref = resolveNoteChapter(req.params);
  if (!ref) return res.status(400).json({ success: false, error: 'Unknown book or chapter.' });

  const content = (req.body && req.body.content != null) ? String(req.body.content) : '';
  if (content.length > NOTE_MAX) {
    return res.status(400).json({ success: false, error: `Note is too long (${NOTE_MAX} characters max).` });
  }

  // Only the signed-in member's own record is ever searched, so a note id from
  // anyone else's notes is simply not found.
  const userId = req.session.userId;
  let result;
  try {
    result = await chapterNoteStore.update(records => {
      const rec  = findChapterRecord(records, userId, ref.book, ref.chapter);
      const note = rec && rec.notes.find(n => n.id === req.params.noteId);
      if (!note) return { changed: false };
      note.content   = content;
      note.updatedAt = new Date().toISOString();
      return { changed: true, note };
    });
  } catch { return notesUnavailable(res); }
  if (!result.note) return res.status(404).json({ success: false, error: 'Note not found.' });
  res.json({ success: true, note: result.note });
});

// ─── DELETE /api/scripture-notes/:book/:chapter/note/:noteId ─────────────────
router.delete('/api/scripture-notes/:book/:chapter/note/:noteId', requireAuth, async (req, res) => {
  const ref = resolveNoteChapter(req.params);
  if (!ref) return res.status(400).json({ success: false, error: 'Unknown book or chapter.' });

  const userId = req.session.userId;
  let result;
  try {
    result = await chapterNoteStore.update(records => {
      const rec = findChapterRecord(records, userId, ref.book, ref.chapter);
      if (!rec) return { changed: false };
      const before = rec.notes.length;
      rec.notes = rec.notes.filter(n => n.id !== req.params.noteId);
      return { changed: rec.notes.length !== before };
    });
  } catch { return notesUnavailable(res); }
  if (!result.changed) return res.status(404).json({ success: false, error: 'Note not found.' });
  res.json({ success: true });
});

module.exports = router;
