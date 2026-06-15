const express = require('express');
const fs      = require('fs');
const path    = require('path');
const { requireAuth, renderLayout } = require('./layout');

const router   = express.Router();
const KJV_PATH = path.join(__dirname, '../data/kjv.json');

const ESV_COPYRIGHT = 'ESV® Bible, Copyright © 2001 by Crossway';

let _bible = null;
function getBible() {
  if (!_bible) _bible = JSON.parse(fs.readFileSync(KJV_PATH, 'utf8'));
  return _bible;
}

function cleanText(text) {
  return text.replace(/\{[^}]*\}/g, '').replace(/\s+/g, ' ').trim();
}

function renderKjvVerses(verses) {
  return verses.map(v =>
    `<p class="scripture-verse"><sup class="verse-num">${v.verse}</sup>${v.text}</p>`
  ).join('\n        ');
}

function renderEsvText(text) {
  const paragraphs = text.trim().split(/\n\s*\n/);
  return paragraphs.map(para => {
    const html = para.trim()
      .replace(/\[(\d+)\]/g, '<sup class="verse-num">$1</sup>')
      .replace(/\n/g, ' ');
    return `<p class="scripture-verse">${html}</p>`;
  }).join('\n        ') +
    `\n        <p class="scripture-copyright">${ESV_COPYRIGHT}</p>`;
}

async function fetchEsvChapter(bookName, chapterNum) {
  const url = 'https://api.esv.org/v3/passage/text/?' + new URLSearchParams({
    q:                            `${bookName} ${chapterNum}`,
    'include-headings':           false,
    'include-footnotes':          false,
    'include-verse-numbers':      true,
    'include-short-copyright':    false,
    'include-passage-references': false,
  });
  const esvRes = await fetch(url, {
    headers: { Authorization: `Token ${process.env.ESV_API_KEY}` },
  });
  const data = await esvRes.json();
  return (data.passages && data.passages[0]) ? data.passages[0].trim() : null;
}

// ─── GET /scripture ──────────────────────────────────────────────────────────
router.get('/scripture', requireAuth, async (req, res) => {
  const bible     = getBible();
  const firstBook = bible[0];
  const usingEsv  = !!process.env.ESV_API_KEY;

  const bookOptions = bible.map(b =>
    `<option value="${b.abbrev}" data-chapters="${b.chapters.length}"${b.abbrev === 'gn' ? ' selected' : ''}>${b.name}</option>`
  ).join('\n        ');

  const chapterOptions = Array.from({ length: firstBook.chapters.length }, (_, i) =>
    `<option value="${i + 1}"${i === 0 ? ' selected' : ''}>${i + 1}</option>`
  ).join('\n        ');

  let initBody;

  if (usingEsv) {
    try {
      const esvText = await fetchEsvChapter('Genesis', 1);
      if (esvText) initBody = renderEsvText(esvText);
    } catch (err) {
      console.error('ESV initial load error:', err.message);
    }
  }

  if (!initBody) {
    const initVerses = firstBook.chapters[0].map((text, i) => ({
      verse: i + 1,
      text:  cleanText(text),
    }));
    initBody = renderKjvVerses(initVerses);
  }

  const subtitle = usingEsv ? 'English Standard Version' : 'King James Version';

  const content = `
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
    </div>

    <div class="scripture-card" id="scriptureCard">
      <h3 class="scripture-heading" id="scriptureHeading">Genesis 1</h3>
      <div class="scripture-body" id="scriptureBody">
        ${initBody}
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
router.get('/api/scripture/:abbrev/:chapter', requireAuth, async (req, res) => {
  const { abbrev, chapter } = req.params;
  const bible = getBible();
  const book  = bible.find(b => b.abbrev === abbrev);
  if (!book) return res.status(404).json({ success: false, error: 'Book not found.' });

  const idx = parseInt(chapter, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= book.chapters.length) {
    return res.status(404).json({ success: false, error: 'Chapter not found.' });
  }

  if (process.env.ESV_API_KEY) {
    try {
      const text = await fetchEsvChapter(book.name, idx + 1);
      if (text) {
        return res.json({ success: true, book: book.name, chapter: idx + 1, text, source: 'esv' });
      }
    } catch (err) {
      console.error('ESV API error:', err.message);
    }
  }

  const verses = book.chapters[idx].map((text, i) => ({
    verse: i + 1,
    text:  cleanText(text),
  }));
  res.json({ success: true, book: book.name, chapter: idx + 1, verses, source: 'kjv' });
});

module.exports = router;
