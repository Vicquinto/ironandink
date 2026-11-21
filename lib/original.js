// ─── Original languages (Hebrew OT / Greek NT), word by word ────────────────
// Serves the highlight panel's "Original" tab (public/js/library.js) and the
// verified data block behind its "Explain this word" button (routes/library.js
// /api/library/ask). Every Hebrew/Greek word, transliteration, gloss, parsing
// and definition comes from STEPBible-Data (STEPBible.org, based on work at
// Tyndale House, Cambridge — CC BY 4.0), built into orig/ by
// scripts/build-original-data.js. NOTHING here comes from the AI — same
// principle as the {{verse:}} markers (lib/asv.js) and map pins (lib/geo.js).
//
// Memory (the droplet has 1 GB): book files load lazily on first request into
// a small most-recently-used cache (MAX_BOOKS); the lexicons and morphology
// tables load once, on first use. A missing orig/ (not built yet) is not an
// error — available() is false and the route answers with a gracious notice.

const fs   = require('fs');
const path = require('path');
const { resolveBook, chapterVerses, BOOKS } = require('./asv');

const ORIG_DIR   = path.join(__dirname, '../orig');
const MAX_BOOKS  = 15;
const MAX_VERSES = 10;

const ATTRIBUTION = {
  text: 'Original-language data: STEP Bible (STEPBible.org), based on work at Tyndale House, Cambridge. CC BY 4.0.',
  url:  'https://www.STEPBible.org',
  source: 'https://github.com/STEPBible/STEPBible-Data',
};

const NT_START = BOOKS.indexOf('Matthew');
function isNT(book) { return BOOKS.indexOf(book) >= NT_START; }
function fileOf(book) {
  return path.join(ORIG_DIR, isNT(book) ? 'nt' : 'ot', book.replace(/ /g, '_') + '.json');
}

function available() {
  try { return fs.existsSync(path.join(ORIG_DIR, 'lexicon-grk.json')); } catch (e) { return false; }
}

// ── Lazy loads ──────────────────────────────────────────────────────────────
const bookCache = new Map();   // insertion order = recency (oldest first)

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { return null; }
}

function loadBook(book) {
  if (bookCache.has(book)) {
    const data = bookCache.get(book);
    bookCache.delete(book);          // refresh recency
    bookCache.set(book, data);
    return data;
  }
  const data = readJson(fileOf(book));
  if (!data) return null;
  bookCache.set(book, data);
  while (bookCache.size > MAX_BOOKS) bookCache.delete(bookCache.keys().next().value);
  return data;
}

let tables = null;
function getTables() {
  if (tables) return tables;
  tables = {
    lexHeb:   readJson(path.join(ORIG_DIR, 'lexicon-heb.json')) || {},
    lexGrk:   readJson(path.join(ORIG_DIR, 'lexicon-grk.json')) || {},
    morphHeb: readJson(path.join(ORIG_DIR, 'morph-heb.json'))   || {},
    morphGrk: readJson(path.join(ORIG_DIR, 'morph-grk.json'))   || {},
  };
  return tables;
}

// ── Morphology → plain English ──────────────────────────────────────────────
// Hebrew codes are per morpheme ("HR/Ncfsa" = preposition + noun); the
// language letter of the first segment applies to the rest. Greek merged words
// (crasis) carry "CONJ + P-1NS".
function grammarOf(code, greek) {
  const t = getTables();
  if (!code) return '';
  if (greek) {
    return String(code).split(' + ').map(c => t.morphGrk[c] || c).join(' + ');
  }
  const segs = String(code).split('/').filter(Boolean);
  if (!segs.length) return '';
  const lang = segs[0].charAt(0);
  return segs.map((s, i) => {
    const full = i === 0 ? s : lang + s;
    return t.morphHeb[full] || s;
  }).join(' + ');
}

function enrich(word, greek) {
  const t   = getTables();
  const lex = (greek ? t.lexGrk : t.lexHeb)[word.s] || null;
  const out = {
    w: word.w,
    t: word.t,
    g: word.g,
    s: word.s,
    m: word.m,
    l: word.l || (lex && lex.lemma) || '',
    lt: lex ? lex.translit : '',     // dictionary form, transliterated
    lg: lex ? lex.gloss : '',        // lexicon gloss
    def: lex ? lex.def : '',         // short lexicon definition
    gram: grammarOf(word.m, greek),  // plain-English grammar
  };
  if (word.v) out.v = word.v;
  return out;
}

// ── Lookup ──────────────────────────────────────────────────────────────────
// Validated request → { status, body }. book is resolved through the same
// alias table as Verse Lookup; chapter/verse ranges are checked against the
// data and the English (ASV) verse list, so a verse that exists in English
// Bibles but not in the critical text (Matthew 17:21) gets a note, while a
// verse that exists nowhere is a 404.
function lookup(bookRaw, chapterRaw, versesRaw) {
  if (!available()) {
    return { status: 503, body: { success: false, error: 'Original-language data is not installed on this server yet.' } };
  }
  const book = resolveBook(String(bookRaw || ''));
  if (!book) return { status: 400, body: { success: false, error: 'Unknown book.' } };

  const ch = String(chapterRaw || '');
  if (!/^\d{1,3}$/.test(ch)) return { status: 400, body: { success: false, error: 'Invalid chapter.' } };
  const vm = String(versesRaw || '').match(/^(\d{1,3})(?:-(\d{1,3}))?$/);
  if (!vm) return { status: 400, body: { success: false, error: 'Invalid verse.' } };
  const vStart = parseInt(vm[1], 10);
  const vEnd   = vm[2] ? parseInt(vm[2], 10) : vStart;
  if (vStart < 1 || vEnd < vStart) return { status: 400, body: { success: false, error: 'Invalid verse range.' } };
  if (vEnd - vStart + 1 > MAX_VERSES) {
    return { status: 400, body: { success: false, error: 'Up to ' + MAX_VERSES + ' verses at a time.' } };
  }

  const data = loadBook(book);
  if (!data) return { status: 503, body: { success: false, error: 'Original-language data is unavailable for ' + book + '.' } };
  const chap = data[ch];
  // Highest verse number in the chapter, by the data or the English (ASV) text.
  // A number below it with no words is a verse the critical text omits — the
  // ASV omits some of those too (Matthew 17:21), so gaps count, not membership.
  const engNums = (chapterVerses(book, ch) || []).map(v => v.verse);
  const dataNums = chap ? Object.keys(chap).map(Number).filter(n => n > 0) : [];
  const maxVerse = Math.max(0, ...engNums, ...dataNums);
  if (!maxVerse) return { status: 404, body: { success: false, error: book + ' ' + ch + ' was not found.' } };

  const greek = isNT(book);
  const verses = [];
  for (let v = vStart; v <= vEnd; v++) {
    const words = chap && chap[String(v)];
    const ref = book + ' ' + ch + ':' + v;
    if (words && words.length) {
      verses.push({ ref, verse: v, words: words.map(w => enrich(w, greek)) });
    } else if (v <= maxVerse) {
      verses.push({
        ref, verse: v, words: [],
        note: greek
          ? 'This verse is not in the critical text this data follows.'
          : 'No original-language data for this verse.',
      });
    } else if (v === vStart) {
      return { status: 404, body: { success: false, error: ref + ' was not found.' } };
    } else {
      break;   // range ran past the end of the chapter
    }
  }

  // Nothing to show at all (e.g. Matthew 17:21 alone) → a graceful 404 that
  // still carries the note, so the tab can say why.
  const none = verses.every(v => !v.words.length);
  return {
    status: none ? 404 : 200,
    body: {
      success: !none,
      note: none ? verses[0].note : undefined,
      book, chapter: Number(ch),
      testament: greek ? 'NT' : 'OT',
      language:  greek ? 'greek' : 'hebrew',
      direction: greek ? 'ltr' : 'rtl',
      verses,
      attribution: ATTRIBUTION,
    },
  };
}

// ── Explain this word ───────────────────────────────────────────────────────
// The client names the word by position ({ book, chapter, verse, index }); the
// data block is rebuilt here from orig/, so what the AI receives is always the
// verified data, never client-supplied text.
const ORIGINAL_RULE =
  'ORIGINAL LANGUAGE RULE: You have been given verified data for one Hebrew or Greek word. ' +
  'Use only that data for the word\'s form, spelling, dictionary form, and grammar; never write ' +
  'Hebrew or Greek words, forms, or parsings from memory, and never correct the data. You may ' +
  'explain what the grammar means, why it matters in this verse, how the word is used elsewhere ' +
  'in Scripture (by reference), and how faithful translations render it. If the reader asks ' +
  'about a different word, tell them to select it in the Original tab.';

function wordAt(sel) {
  if (!sel || typeof sel !== 'object' || !available()) return null;
  const book = resolveBook(String(sel.book || ''));
  const ch = parseInt(sel.chapter, 10), v = parseInt(sel.verse, 10), i = parseInt(sel.index, 10);
  if (!book || !(ch > 0) || !(v > 0) || !(i >= 0) || i > 500) return null;
  const data = loadBook(book);
  const words = data && data[String(ch)] && data[String(ch)][String(v)];
  if (!words || !words[i]) return null;
  const greek = isNT(book);
  return { ref: book + ' ' + ch + ':' + v, greek, word: enrich(words[i], greek) };
}

function explainBlock(sel) {
  const hit = wordAt(sel);
  if (!hit) return null;
  const w = hit.word;
  const lines = [
    'VERIFIED ORIGINAL-LANGUAGE DATA (STEP Bible, Tyndale House — do not alter):',
    'Reference: ' + hit.ref,
    'Language: ' + (hit.greek ? 'Greek' : 'Hebrew'),
    'Original word: ' + w.w,
    'Transliteration: ' + w.t,
    'Dictionary form: ' + w.l + (w.lt ? ' (' + w.lt + ')' : ''),
    "Strong's number: " + w.s,
    'Gloss in this verse: ' + w.g,
    'Grammar: ' + w.gram,
    'Lexicon definition: ' + [w.lg, w.def].filter(Boolean).join(' — '),
  ];
  return { ref: hit.ref, word: w.w, text: lines.join('\n') };
}

// Hebrew (incl. presentation forms) and Greek (incl. extended/polytonic) runs.
const ORIG_RUN_RE = /[֐-׿יִ-ﭏͰ-Ͽἀ-῿]+(?:[֐-׿יִ-ﭏͰ-Ͽἀ-῿̀-ͯ'’᾽־]+)*/g;

// For monitoring only (never alters the reply): Hebrew/Greek runs the AI wrote
// that do not appear in the data block. Compared NFC-normalised.
function unverifiedRuns(reply, block) {
  const hay = String(block && block.text || '').normalize('NFC');
  const out = [];
  const seen = new Set();
  const runs = String(reply || '').normalize('NFC').match(ORIG_RUN_RE) || [];
  for (const r of runs) {
    if (seen.has(r)) continue;
    seen.add(r);
    if (hay.indexOf(r) === -1) out.push(r);
  }
  return out;
}

module.exports = {
  available, lookup, explainBlock, unverifiedRuns,
  ORIGINAL_RULE, ATTRIBUTION, MAX_VERSES,
};
