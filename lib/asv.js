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
const nasb = require('./nasb');

const ASV_PATH = path.join(__dirname, '../data/asv.json');

// Required Lockman attribution, rendered verbatim wherever NASB text is shown.
const NASB_ATTRIBUTION =
  'New American Standard Bible®, Copyright © 1995, The Lockman Foundation. ' +
  'All rights reserved. lockman.org';
// Markdown footer form appended to an injected piece that contains ≥1 NASB verse.
const NASB_ATTRIBUTION_MD = '\n\n*' + NASB_ATTRIBUTION + '*';

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

// data/asv.json stores some characters as HTML entities: the right single quote
// (&#8217;, ~1999×), the em dash (&#8212;, ~41×), and the Hebrew letters in the
// Psalm 119 acrostic headers (&#1489;–&#1514;). Surfaces that insert verse text
// via innerHTML or raw server HTML let the browser decode these, so they look
// right; the study loading screen paints the verse with textContent, which does
// NOT decode, so the raw "A man&#8217;s heart…" showed through. Decode once here,
// at the single choke point every consumer reads through (the VERSES waiting-pool,
// injectVerses, the verse-lookup paths), so all surfaces receive real characters.
//
// One regex pass decodes each entity exactly once, so a stored "&amp;" is turned
// into "&" and never re-scanned — double-decoding is structurally impossible.
const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
};
function decodeEntities(str) {
  return str.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body) => {
    if (body[0] === '#') {
      const code = (body[1] === 'x' || body[1] === 'X')
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      if (Number.isFinite(code) && code >= 0 && code <= 0x10FFFF) {
        return String.fromCodePoint(code);
      }
      return match; // out-of-range / unparseable → leave untouched
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named != null ? named : match; // unknown named entity → leave untouched
  });
}

// A parsed reference's verses from the ASV as [{ n, text }] (entity-decoded), or
// null if it cannot be resolved with confidence. If ANY verse in a range is
// missing, returns null rather than a partial quote — never guess.
function asvVerses(p) {
  if (!p) return null;
  const asv = getAsv();
  const chap = asv[p.book] && asv[p.book][p.chapter];
  if (!chap) return null;
  const out = [];
  for (let v = p.verseStart; v <= p.verseEnd; v++) {
    const t = chap[String(v)];
    if (t == null) return null;
    out.push({ n: v, text: decodeEntities(String(t).trim()) });
  }
  return out.length ? out : null;
}

// Resolve a reference to ASV text (verses joined by a space for a range), or null.
// Entity-decoded so every caller gets real characters, not raw "&#8217;"-style codes.
function resolveAsv(ref) {
  const v = asvVerses(parseReference(ref));
  return v ? v.map(x => x.text).join(' ') : null;
}

// Whole-chapter ASV accessor for the Scripture reader's fallback path. Returns an
// ordered [{ verse, text }] array (entity-decoded), or null if the chapter is not
// in the corpus. ASV is complete (31,086 verses), so this fallback effectively
// always succeeds for a valid book/chapter.
function chapterVerses(book, chapter) {
  const asv = getAsv();
  const chap = asv[book] && asv[book][String(chapter)];
  if (!chap) return null;
  return Object.keys(chap)
    .map(Number)
    .filter(n => Number.isFinite(n))
    .sort((a, b) => a - b)
    .map(n => ({ verse: n, text: decodeEntities(String(chap[String(n)]).trim()) }));
}

// Resolve a reference to NASB text from the LOCAL cache only (lib/nasb performs no
// network call on this path). Same all-or-nothing rule as ASV: if any verse of a
// range is not cached, returns null so the caller falls back to ASV for the whole
// reference — never a NASB/ASV-spliced quotation, never a partial quote.
function nasbVerses(p) {
  if (!p) return null;
  const out = [];
  for (let v = p.verseStart; v <= p.verseEnd; v++) {
    const t = nasb.getVerse(p.book, p.chapter, v);
    if (t == null) return null;
    out.push({ n: v, text: decodeEntities(String(t).trim()) });
  }
  return out.length ? out : null;
}

// Unified resolver: NASB (primary, licensed) wins; ASV (public domain) is the
// silent per-reference fallback. Returns { text, source, verses } or null, where
// verses is the per-verse [{ n, text }] behind text (text = their texts joined by
// one space). The AI never produces any of this text — it emits {{verse:...}}
// markers and the server injects the verified text resolved here (see injectVerses).
function resolve(ref) {
  const p = parseReference(ref);
  const n = nasbVerses(p);
  if (n) return { text: n.map(x => x.text).join(' '), source: 'NASB 1995', verses: n };
  const a = asvVerses(p);
  if (a) return { text: a.map(x => x.text).join(' '), source: 'ASV', verses: a };
  return null;
}

// ── Verse numbers in multi-verse quotations (studies only) ────────────────────
// A study's multi-verse quotation carries each verse's number at the start of
// that verse, so the Tutor/Teacher can say "verse 11" and the reader can find it:
//   > “¹⁰And not only this… ¹¹for though the twins…” — Romans 9:10-13 (NASB 1995)
// The numbers are stored as Unicode SUPERSCRIPT DIGITS — plain text, not markup —
// so they survive every renderer (the escape-first ones too) and can never let
// HTML through or show up as tags or brackets. The shared sanitizer
// (public/js/html-sanitizer.js) turns each run into <sup class="guide-vnum">,
// which note anchoring, copy and the Ask panel skip, so the text around them is
// exactly what it was before numbers existed. Neither corpus contains a
// superscript digit (checked), so a run of them is always a verse number.
// A single-verse quotation gets no number — its reference already gives it.
const SUPERSCRIPT_DIGITS = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];
const SUPERSCRIPT_RUN_RE = /[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g;

function superscriptNumber(n) {
  return String(n).split('').map(d => SUPERSCRIPT_DIGITS[+d] || '').join('');
}

// [{ n, text }] → "¹⁰text ¹¹text …". Removing the superscript runs gives back the
// plain joined text exactly (same single-space join), which is what keeps old
// note anchors valid.
function numberedVerseText(verses) {
  return verses.map(v => superscriptNumber(v.n) + v.text).join(' ');
}

// Back-compat text-only resolver (NASB-first, ASV fallback). Existing callers that
// only need the string keep working; callers that need the translation label use
// resolve() instead.
function lookup(ref) {
  const r = resolve(ref);
  return r ? r.text : null;
}

// {{verse:REF}} marker → real ASV text. Unresolvable refs collapse to the plain
// reference text (never model-invented verse text). Safe to run on any string:
// text with no markers is returned unchanged.
//
// Two forms, chosen by where the marker sits:
//
//   block  (marker starts its line)  →  > “text” — Ref (ASV)
//   inline (marker mid-sentence)     →  *“text”* — Ref
//
// Both forms render italic, by different routes: the block form through the
// .guide-bq blockquote style (public/css/styles.css), the inline form through
// markdown emphasis, since a mid-sentence quotation gets no blockquote styling
// of its own. Asterisk, not underscore — renderMarkdown converts **bold** and
// *em* and has no underscore rule at all, so _text_ would render literally.
// The emphasis wraps the quotation marks (*“text”*, not “*text*”) so the whole
// quotation is italic as it is in the block form, and stops before the em dash
// so the reference stays plain in both forms.
//
// The inline form drops the "> " because markdown blockquotes only exist at the
// start of a line — renderMarkdown (public/js/render-markdown.js) matches /^> /
// per line, so a "> " landing mid-paragraph renders as a literal ">" character.
// It also drops "(ASV)": the study already carries an ASV attribution, and the
// model routinely wraps inline markers in its own parentheses, which turned the
// label into nested "(… (ASV))". Quotation marks and the em-dash reference are
// identical in both forms.
//
// atLineStart tells us whether index 0 of `text` is itself at the start of a
// line. It defaults to true (a whole document begins a line) and matters only
// for streamed callers that inject successive slices of one response — see
// routes/dialogue.js.
const MARKER_RE = /\{\{\s*verse\s*:\s*([^}]+?)\s*\}\}/gi;

// Core injector. Returns { text, sources } where sources flags which translations
// actually appeared, so a caller can decide whether to render the Lockman
// attribution (see injectWithAttribution). The block form now carries a PER-VERSE
// translation label — (NASB 1995) when the reference resolved to NASB, (ASV) when
// it silently fell back — because NASB and ASV can now both appear in one piece.
//
// opts.verseNumbers: number each verse of a multi-verse quotation (see
// numberedVerseText). Studies, and the Tutor/Teacher replies about them, pass it;
// every other surface (devotionals, Selah, Writing, Dialogue, …) leaves it off.
function injectVersesTracked(text, atLineStart, opts) {
  const sources = { nasb: false, asv: false };
  if (typeof text !== 'string' || text.indexOf('{{') === -1) return { text, sources };
  const startsLine = atLineStart !== false;
  const numbered = !!(opts && opts.verseNumbers);
  const out = text.replace(MARKER_RE, (_match, rawRef, offset, whole) => {
    const ref = String(rawRef).trim();
    const r = resolve(ref);
    if (r == null) return ref; // could not resolve → reference only, never invented text
    const verseText = (numbered && r.verses.length > 1) ? numberedVerseText(r.verses) : r.text;
    if (r.source === 'NASB 1995') sources.nasb = true; else sources.asv = true;

    // Block context: only whitespace between the preceding newline and the
    // marker. With no preceding newline, the marker is at the head of `text`,
    // which begins a line only if the caller says this slice does.
    const nl     = whole.lastIndexOf('\n', offset - 1);
    const before = nl === -1 ? whole.slice(0, offset) : whole.slice(nl + 1, offset);
    const isBlock = before.trim() === '' && (nl !== -1 || startsLine);

    // Neither corpus contains an asterisk in any verse, so wrapping in *…* is
    // safe — but an asterisk in the text would break the emphasis parsing, so
    // fall back to an unemphasised inline quotation rather than emit mangled
    // markdown if that ever stops being true.
    const inlineQuote = verseText.indexOf('*') === -1
      ? '*“' + verseText + '”*'
      : '“' + verseText + '”';

    return isBlock
      ? '> “' + verseText + '” — ' + ref + ' (' + r.source + ')'
      : inlineQuote + ' — ' + ref;
  });
  return { text: out, sources };
}

// {{verse:REF}} marker → real verse text (NASB primary, ASV fallback). Unresolvable
// refs collapse to the plain reference (never model-invented verse text). Safe to
// run on any string. See injectVersesTracked for the block/inline forms.
function injectVerses(text, atLineStart, opts) {
  return injectVersesTracked(text, atLineStart, opts).text;
}

// Convenience for single-piece surfaces (studies, devotional, Selah, writing,
// definitions, inline Ask): inject, then append the Lockman attribution footer
// when the piece actually contains ≥1 NASB verse. A piece that resolved only to
// ASV (public domain) gets no NASB notice.
function injectWithAttribution(text, atLineStart, opts) {
  const { text: out, sources } = injectVersesTracked(text, atLineStart, opts);
  return sources.nasb ? out + NASB_ATTRIBUTION_MD : out;
}

// ── Numbering quotations in studies saved before verse numbers existed ─────────
// Saved studies hold verse text already resolved (markers are injected at
// generation), so their verse boundaries are gone. This re-resolves each
// multi-verse quotation and adds the numbers ONLY when the stored quotation is
// exactly today's verified text for that reference and translation — anything
// else (an older study format, a NASB text that has since been refreshed, an
// unresolvable reference) is left untouched. Idempotent: an already-numbered
// quotation is skipped. Used by scripts/number-study-verses.js.
//   block:  > “TEXT” — REF (NASB 1995|ASV)      (translation known)
//   inline: *“TEXT”* — REF                       (tries NASB, then ASV)
const BLOCK_QUOTE_RE  = /^(>\s*“)([^\n]*)(” — )([^\n]+?)( \((NASB 1995|ASV)\)\s*)$/gm;
const INLINE_QUOTE_RE = /(\*“)([^”*\n]+)(”\* — )((?:[1-3] ?)?[A-Za-z][A-Za-z ]*? \d+:\d+\s*-\s*\d+)/g;

function numberQuotation(quote, ref, sources, tally) {
  if (/[⁰¹²³⁴⁵⁶⁷⁸⁹]/.test(quote)) { tally.already++; return null; }
  const p = parseReference(ref);
  if (!p || p.verseEnd === p.verseStart) return null;     // single verse — no number
  let resolvedAny = false;
  for (const src of sources) {
    const verses = src === 'ASV' ? asvVerses(p) : nasbVerses(p);
    if (!verses) continue;
    resolvedAny = true;
    if (verses.map(v => v.text).join(' ') === quote) { tally.numbered++; return numberedVerseText(verses); }
  }
  if (resolvedAny) tally.mismatched++; else tally.unresolved++;
  return null;
}

function numberStoredVerses(content) {
  const tally = { numbered: 0, already: 0, mismatched: 0, unresolved: 0 };
  if (typeof content !== 'string' || content.indexOf('“') === -1) return { content, tally };
  let out = content.replace(BLOCK_QUOTE_RE, (m, open, quote, dash, ref, tail, source) => {
    const n = numberQuotation(quote, ref.trim(), [source], tally);
    return n == null ? m : open + n + dash + ref + tail;
  });
  out = out.replace(INLINE_QUOTE_RE, (m, open, quote, dash, ref) => {
    const n = numberQuotation(quote, ref.trim(), ['NASB 1995', 'ASV'], tally);
    return n == null ? m : open + n + dash + ref;
  });
  return { content: out, tally };
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

module.exports = {
  lookup, resolve, chapterVerses,
  injectVerses, injectVersesTracked, injectWithAttribution,
  numberStoredVerses, SUPERSCRIPT_RUN_RE,
  parseReference, resolveBook, MARKER_RE, SCRIPTURE_RULE,
  NASB_ATTRIBUTION, NASB_ATTRIBUTION_MD,
  BOOKS: CANONICAL,   // the 66 books in canonical order (Study Map)
};
