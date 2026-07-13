// ─── American Standard Version (ASV, 1901, public domain) ────────────────────
// The platform's Scripture text for AI-generated study content. Real verse text
// is served from data/asv.json and inserted by the server AFTER generation — the
// AI model NEVER writes Scripture (see the SCRIPTURE QUOTATION RULE in the study
// prompts). This module loads the text once and resolves reference strings.
//
// Data shape: asv["John"]["3"]["16"] === "For God so loved the world, ..."
// 66 books, canonical full names ("Genesis", "1 Samuel", "Psalms", "Song of
// Solomon", "Revelation"), 31,086 verses.

const fs   = require('fs');
const path = require('path');

const ASV_PATH = path.join(__dirname, '../data/asv.json');

let _asv = null;
function getAsv() {
  if (!_asv) _asv = JSON.parse(fs.readFileSync(ASV_PATH, 'utf8'));
  return _asv;
}

// Canonical keys exactly as they appear in data/asv.json.
const CANONICAL = [
  'Genesis','Exodus','Leviticus','Numbers','Deuteronomy','Joshua','Judges','Ruth',
  '1 Samuel','2 Samuel','1 Kings','2 Kings','1 Chronicles','2 Chronicles','Ezra',
  'Nehemiah','Esther','Job','Psalms','Proverbs','Ecclesiastes','Song of Solomon',
  'Isaiah','Jeremiah','Lamentations','Ezekiel','Daniel','Hosea','Joel','Amos',
  'Obadiah','Jonah','Micah','Nahum','Habakkuk','Zephaniah','Haggai','Zechariah',
  'Malachi','Matthew','Mark','Luke','John','Acts','Romans','1 Corinthians',
  '2 Corinthians','Galatians','Ephesians','Philippians','Colossians',
  '1 Thessalonians','2 Thessalonians','1 Timothy','2 Timothy','Titus','Philemon',
  'Hebrews','James','1 Peter','2 Peter','1 John','2 John','3 John','Jude','Revelation',
];

// Normalize a book token for matching: lowercase, drop periods, turn ordinal
// words/suffixes into digits ("first"/"1st" → "1"), collapse whitespace.
function normBook(s) {
  return String(s)
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\b(i{1,3})\b/g, (m) => String(m.length))            // i, ii, iii → 1,2,3
    .replace(/\bfirst\b/g, '1').replace(/\bsecond\b/g, '2').replace(/\bthird\b/g, '3')
    .replace(/(\d)(st|nd|rd|th)\b/g, '$1')                          // 1st → 1
    .replace(/\s+/g, ' ')
    .trim();
}

// alias (normalized) → canonical name
const BOOK_ALIASES = {};
function addAlias(alias, canonical) { BOOK_ALIASES[normBook(alias)] = canonical; }

CANONICAL.forEach((name) => addAlias(name, name));

// Common abbreviations / variant spellings. Kept conflict-free (ambiguous short
// forms like "ez"/"hb" are deliberately omitted — better to return null than guess).
const ALIAS_TABLE = {
  'Genesis': ['gen', 'ge', 'gn'],
  'Exodus': ['ex', 'exo', 'exod'],
  'Leviticus': ['lev', 'lv'],
  'Numbers': ['num', 'nu', 'nm', 'nb'],
  'Deuteronomy': ['deut', 'dt', 'deu'],
  'Joshua': ['josh', 'jos', 'jsh'],
  'Judges': ['judg', 'jdg', 'jg', 'jdgs'],
  'Ruth': ['rth', 'ru'],
  '1 Samuel': ['1 sam', '1sa', '1 sm', '1 sa'],
  '2 Samuel': ['2 sam', '2sa', '2 sm', '2 sa'],
  '1 Kings': ['1 kgs', '1ki', '1 kin', '1 kg'],
  '2 Kings': ['2 kgs', '2ki', '2 kin', '2 kg'],
  '1 Chronicles': ['1 chr', '1ch', '1 chron'],
  '2 Chronicles': ['2 chr', '2ch', '2 chron'],
  'Ezra': ['ezr'],
  'Nehemiah': ['neh', 'ne'],
  'Esther': ['est', 'esth', 'es'],
  'Job': ['jb'],
  'Psalms': ['psalm', 'ps', 'psa', 'pss', 'psm', 'pslm'],
  'Proverbs': ['prov', 'prv', 'pr'],
  'Ecclesiastes': ['eccl', 'ecc', 'qoh', 'ec'],
  'Song of Solomon': ['song of songs', 'song', 'songs', 'canticles', 'cant', 'sos', 'song of sol'],
  'Isaiah': ['isa', 'is'],
  'Jeremiah': ['jer', 'je', 'jr'],
  'Lamentations': ['lam', 'la'],
  'Ezekiel': ['ezek', 'eze', 'ezk'],
  'Daniel': ['dan', 'da', 'dn'],
  'Hosea': ['hos', 'ho'],
  'Joel': ['joe', 'jl'],
  'Amos': ['amo', 'am'],
  'Obadiah': ['obad', 'ob'],
  'Jonah': ['jon', 'jnh'],
  'Micah': ['mic', 'mi'],
  'Nahum': ['nah', 'na'],
  'Habakkuk': ['hab'],
  'Zephaniah': ['zeph', 'zep', 'zp'],
  'Haggai': ['hag', 'hg'],
  'Zechariah': ['zech', 'zec', 'zc'],
  'Malachi': ['mal', 'ml'],
  'Matthew': ['matt', 'mt'],
  'Mark': ['mrk', 'mk', 'mr'],
  'Luke': ['luk', 'lk'],
  'John': ['jn', 'jhn'],
  'Acts': ['act', 'ac'],
  'Romans': ['rom', 'ro', 'rm'],
  '1 Corinthians': ['1 cor', '1co', '1 co'],
  '2 Corinthians': ['2 cor', '2co', '2 co'],
  'Galatians': ['gal', 'ga'],
  'Ephesians': ['eph', 'ephes'],
  'Philippians': ['phil', 'php', 'pp'],
  'Colossians': ['col', 'co'],
  '1 Thessalonians': ['1 thess', '1th', '1 thes', '1 th'],
  '2 Thessalonians': ['2 thess', '2th', '2 thes', '2 th'],
  '1 Timothy': ['1 tim', '1ti', '1 ti'],
  '2 Timothy': ['2 tim', '2ti', '2 ti'],
  'Titus': ['tit', 'ti'],
  'Philemon': ['philem', 'phm', 'phlm'],
  'Hebrews': ['heb', 'hbr'],
  'James': ['jas', 'jm'],
  '1 Peter': ['1 pet', '1pe', '1 pe'],
  '2 Peter': ['2 pet', '2pe', '2 pe'],
  '1 John': ['1 jn', '1jo', '1 jhn', '1 jo'],
  '2 John': ['2 jn', '2jo', '2 jhn', '2 jo'],
  '3 John': ['3 jn', '3jo', '3 jhn', '3 jo'],
  'Jude': ['jud', 'jd'],
  'Revelation': ['rev', 're', 'rv', 'apocalypse'],
};
Object.keys(ALIAS_TABLE).forEach((canon) => {
  ALIAS_TABLE[canon].forEach((a) => addAlias(a, canon));
});

function resolveBook(raw) {
  return BOOK_ALIASES[normBook(raw)] || null;
}

// Single-chapter books: references are commonly written verse-only ("Jude 3",
// "Philemon 6"), meaning chapter 1. All have exactly one chapter in the data.
const SINGLE_CHAPTER = { 'Obadiah': 1, 'Philemon': 1, '2 John': 1, '3 John': 1, 'Jude': 1 };

// Parse "Book Chapter:VerseStart(-VerseEnd)" → {book, chapter, verseStart, verseEnd}
// or null. Forgiving on spacing/dashes/aliases, but never guesses: an unresolvable
// book, a malformed shape, or a cross-chapter range returns null.
function parseReference(ref) {
  if (ref == null) return null;
  const s = String(ref).trim().replace(/[‒–—―]/g, '-'); // various dashes → hyphen

  // Standard "Book Chapter:Verse(-Verse)"
  const m = s.match(/^(.+?)\s+(\d+)\s*:\s*(\d+)(?:\s*-\s*(\d+))?$/);
  if (m) {
    const book = resolveBook(m[1]);
    if (!book) return null;
    const verseStart = parseInt(m[3], 10);
    const verseEnd = m[4] ? parseInt(m[4], 10) : verseStart;
    if (verseEnd < verseStart) return null;
    return { book, chapter: m[2], verseStart, verseEnd };
  }

  // Verse-only "Book Verse(-Verse)" — valid only for single-chapter books (chapter 1).
  const sc = s.match(/^(.+?)\s+(\d+)(?:\s*-\s*(\d+))?$/);
  if (sc) {
    const book = resolveBook(sc[1]);
    if (!book || !SINGLE_CHAPTER[book]) return null;
    const verseStart = parseInt(sc[2], 10);
    const verseEnd = sc[3] ? parseInt(sc[3], 10) : verseStart;
    if (verseEnd < verseStart) return null;
    return { book, chapter: String(SINGLE_CHAPTER[book]), verseStart, verseEnd };
  }

  return null;
}

// Resolve a reference to its ASV text (verses joined by a space for a range), or
// null if it cannot be resolved with confidence. If ANY verse in a range is
// missing, returns null rather than a partial quote — never guess.
function lookup(ref) {
  const p = parseReference(ref);
  if (!p) return null;
  const asv = getAsv();
  const chap = asv[p.book] && asv[p.book][p.chapter];
  if (!chap) return null;
  const parts = [];
  for (let v = p.verseStart; v <= p.verseEnd; v++) {
    const t = chap[String(v)];
    if (t == null) return null;
    parts.push(String(t).trim());
  }
  if (!parts.length) return null;
  return parts.join(' ');
}

// {{verse:REF}} marker → real ASV text, as a markdown blockquote line carrying the
// reference + translation attribution. Unresolvable refs collapse to the plain
// reference text (never model-invented verse text). Safe to run on any string:
// text with no markers is returned unchanged.
const MARKER_RE = /\{\{\s*verse\s*:\s*([^}]+?)\s*\}\}/gi;
function injectVerses(text) {
  if (typeof text !== 'string' || text.indexOf('{{') === -1) return text;
  return text.replace(MARKER_RE, (_match, rawRef) => {
    const ref = String(rawRef).trim();
    const verseText = lookup(ref);
    if (verseText == null) return ref; // could not resolve → reference only, never invented text
    return '> “' + verseText + '” — ' + ref + ' (ASV)';
  });
}

// The absolute Scripture Quotation Rule, shared by every generator prompt so the
// model never writes verse text from memory. injectVerses() turns the markers it
// mandates into real ASV text. Keep this the single source of truth for the rule.
const SCRIPTURE_RULE =
  'SCRIPTURE QUOTATION RULE (absolute): You must NEVER write out the text of a Bible verse. ' +
  'You do not have an authorized Bible text, and any verse text you produce from memory may be ' +
  'inaccurate. When you wish to quote Scripture, emit ONLY a marker in this exact form: ' +
  '{{verse:Book Chapter:Verse}} (e.g. {{verse:Romans 3:23-25}}). The system will insert the real, ' +
  'verified verse text. You may refer to Scripture by reference in prose ("Paul argues in Romans 3 ' +
  'that..."), and you may discuss, explain, and expound Scripture freely — but you must NEVER ' +
  'reproduce the words of a verse yourself, not even partially, not even as a phrase inside a ' +
  'sentence, and never in quotation marks. All verse text comes from markers only.';

module.exports = { lookup, injectVerses, parseReference, MARKER_RE, SCRIPTURE_RULE };
