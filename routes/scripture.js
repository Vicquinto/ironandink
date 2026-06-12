const express = require('express');
const fs      = require('fs');
const path    = require('path');
const { requireAuth, renderLayout } = require('./layout');

const router   = express.Router();
const KJV_PATH = path.join(__dirname, '../data/kjv.json');

let _bible = null;
function getBible() {
  if (!_bible) _bible = JSON.parse(fs.readFileSync(KJV_PATH, 'utf8'));
  return _bible;
}

function cleanText(text) {
  return text.replace(/\{[^}]*\}/g, '').replace(/\s+/g, ' ').trim();
}

function renderVerses(verses) {
  return verses.map(v =>
    `<p class="scripture-verse"><sup class="verse-num">${v.verse}</sup>${v.text}</p>`
  ).join('\n        ');
}

// ─── GET /scripture ──────────────────────────────────────────────────────────
router.get('/scripture', requireAuth, (req, res) => {
  const bible     = getBible();
  const firstBook = bible[0];
  const initVerses = firstBook.chapters[0].map((text, i) => ({
    verse: i + 1,
    text:  cleanText(text),
  }));

  const bookOptions = bible.map(b =>
    `<option value="${b.abbrev}" data-chapters="${b.chapters.length}"${b.abbrev === 'gn' ? ' selected' : ''}>${b.name}</option>`
  ).join('\n        ');

  const chapterOptions = Array.from({ length: firstBook.chapters.length }, (_, i) =>
    `<option value="${i + 1}"${i === 0 ? ' selected' : ''}>${i + 1}</option>`
  ).join('\n        ');

  const content = `
    <div class="page-header">
      <h2 class="page-title">Scripture</h2>
      <p class="page-subtitle">King James Version</p>
    </div>

    <div class="scripture-nav">
      <select id="bookSelect" class="scripture-select">
        ${bookOptions}
      </select>
      <select id="chapterSelect" class="scripture-select">
        ${chapterOptions}
      </select>
    </div>

    <div class="scripture-card" id="scriptureCard">
      <h3 class="scripture-heading" id="scriptureHeading">Genesis 1</h3>
      <div class="scripture-body" id="scriptureBody">
        ${renderVerses(initVerses)}
      </div>
    </div>`;

  res.send(renderLayout({
    req,
    activeSection: 'scripture',
    title:         'Scripture',
    content,
    scripts:       '<script src="/js/scripture.js"></script>',
  }));
});

// ─── GET /api/scripture/:abbrev/:chapter ─────────────────────────────────────
router.get('/api/scripture/:abbrev/:chapter', requireAuth, (req, res) => {
  const { abbrev, chapter } = req.params;
  const book = getBible().find(b => b.abbrev === abbrev);
  if (!book) return res.status(404).json({ success: false, error: 'Book not found.' });

  const idx = parseInt(chapter, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= book.chapters.length) {
    return res.status(404).json({ success: false, error: 'Chapter not found.' });
  }

  const verses = book.chapters[idx].map((text, i) => ({
    verse: i + 1,
    text:  cleanText(text),
  }));
  res.json({ success: true, book: book.name, chapter: idx + 1, verses });
});

module.exports = router;
