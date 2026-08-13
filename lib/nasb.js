// ─── New American Standard Bible 1995 (NASB, licensed — Lockman Foundation) ───
// The platform's PRIMARY displayed Scripture text. Like ASV, real verse text is
// served from a LOCAL store and inserted by the server AFTER generation — the AI
// model NEVER writes Scripture (see SCRIPTURE_RULE in lib/asv.js). NASB is a
// licensed text, so it is NOT committed to git: it lives in a local, on-demand
// cache (data/nasb-cache.json) populated from API.Bible and refreshed on a TTL.
//
// This module is the NASB source. It exposes:
//   • synchronous, cache-only reads (getVerse / lookupChapterMap) for the hot
//     injection path in lib/asv.js — a miss returns null and the caller silently
//     falls back to ASV. This path NEVER performs a network call.
//   • asynchronous fetch/refresh helpers (fetchChapter / ensureChapter /
//     refreshStale) used out-of-band by the Scripture reader route, the monthly
//     cron, and the manual warm script. Only these touch the network.
//
// Cache shape (data/nasb-cache.json):
//   {
//     "meta":   { "bibleId": "...", "fetchedAt": { "John|3": "2026-08-12T..." } },
//     "verses": { "John": { "3": { "16": "For God so loved..." } } }
//   }
// The `verses` tree mirrors data/asv.json exactly (canonical Book → chapter →
// verse), so lib/asv.js reuses its parse/lookup machinery verbatim. fetchedAt is
// timestamped PER CHAPTER (the unit we fetch and expire), keyed "Book|chapter".

const fs   = require('fs');
const path = require('path');

const CACHE_PATH = path.join(__dirname, '../data/nasb-cache.json');

// NASB 1995 on API.Bible. The Bible id is public (it identifies the translation,
// not a credential); the API key is read from the environment and never hardcoded.
const NASB_BIBLE_ID = process.env.API_BIBLE_ID || 'b8ee27bcd1cae43a-01';
const API_BASE      = (process.env.API_BIBLE_BASE || 'https://rest.api.bible').replace(/\/+$/, '');

// Per-chapter freshness. API.Bible / Lockman permit locally caching fetched text
// for up to 30 days; we refresh at 25 to keep every cached verse comfortably
// inside that ceiling. Injection reads ignore staleness (any cached text beats an
// ASV fallback); only the async refreshers act on it.
const REFRESH_AFTER_DAYS = 25;
const MAX_AGE_MS         = REFRESH_AFTER_DAYS * 24 * 60 * 60 * 1000;

// Canonical book names, in canonical order, EXACTLY as they key data/asv.json and
// data/nasb-cache.json — paired with their USFM ids (what API.Bible addresses
// books by). chapterId sent to API.Bible is `${USFM}.${chapter}` (e.g. JHN.3).
const BOOKS = [
  ['Genesis', 'GEN'], ['Exodus', 'EXO'], ['Leviticus', 'LEV'], ['Numbers', 'NUM'],
  ['Deuteronomy', 'DEU'], ['Joshua', 'JOS'], ['Judges', 'JDG'], ['Ruth', 'RUT'],
  ['1 Samuel', '1SA'], ['2 Samuel', '2SA'], ['1 Kings', '1KI'], ['2 Kings', '2KI'],
  ['1 Chronicles', '1CH'], ['2 Chronicles', '2CH'], ['Ezra', 'EZR'], ['Nehemiah', 'NEH'],
  ['Esther', 'EST'], ['Job', 'JOB'], ['Psalms', 'PSA'], ['Proverbs', 'PRO'],
  ['Ecclesiastes', 'ECC'], ['Song of Solomon', 'SNG'], ['Isaiah', 'ISA'], ['Jeremiah', 'JER'],
  ['Lamentations', 'LAM'], ['Ezekiel', 'EZK'], ['Daniel', 'DAN'], ['Hosea', 'HOS'],
  ['Joel', 'JOL'], ['Amos', 'AMO'], ['Obadiah', 'OBA'], ['Jonah', 'JON'], ['Micah', 'MIC'],
  ['Nahum', 'NAM'], ['Habakkuk', 'HAB'], ['Zephaniah', 'ZEP'], ['Haggai', 'HAG'],
  ['Zechariah', 'ZEC'], ['Malachi', 'MAL'], ['Matthew', 'MAT'], ['Mark', 'MRK'],
  ['Luke', 'LUK'], ['John', 'JHN'], ['Acts', 'ACT'], ['Romans', 'ROM'],
  ['1 Corinthians', '1CO'], ['2 Corinthians', '2CO'], ['Galatians', 'GAL'],
  ['Ephesians', 'EPH'], ['Philippians', 'PHP'], ['Colossians', 'COL'],
  ['1 Thessalonians', '1TH'], ['2 Thessalonians', '2TH'], ['1 Timothy', '1TI'],
  ['2 Timothy', '2TI'], ['Titus', 'TIT'], ['Philemon', 'PHM'], ['Hebrews', 'HEB'],
  ['James', 'JAS'], ['1 Peter', '1PE'], ['2 Peter', '2PE'], ['1 John', '1JN'],
  ['2 John', '2JN'], ['3 John', '3JN'], ['Jude', 'JUD'], ['Revelation', 'REV'],
];
const NAME_TO_USFM = {};
BOOKS.forEach(([name, usfm]) => { NAME_TO_USFM[name] = usfm; });

// ─── Cache load / save ───────────────────────────────────────────────────────
// Lazy, memoized (mirrors getAsv in lib/asv.js). A missing/corrupt file yields an
// empty cache so the platform runs verse-less on NASB and silently uses ASV until
// the cache is warmed — it never throws on the read path.
let _cache = null;
function getCache() {
  if (_cache) return _cache;
  try {
    const raw = fs.readFileSync(CACHE_PATH, 'utf8');
    const parsed = JSON.parse(raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw);
    _cache = normalizeCache(parsed);
  } catch {
    _cache = normalizeCache(null);
  }
  return _cache;
}

function normalizeCache(obj) {
  const c = obj && typeof obj === 'object' ? obj : {};
  if (!c.meta || typeof c.meta !== 'object') c.meta = {};
  if (!c.meta.bibleId) c.meta.bibleId = NASB_BIBLE_ID;
  if (!c.meta.fetchedAt || typeof c.meta.fetchedAt !== 'object') c.meta.fetchedAt = {};
  if (!c.verses || typeof c.verses !== 'object') c.verses = {};
  return c;
}

// Atomic write: serialize to a temp file, then rename over the target. A rename is
// atomic on the same filesystem, so a reader never sees a half-written cache and a
// crash mid-write leaves the previous good file intact.
function saveCache() {
  if (!_cache) return;
  const tmp = CACHE_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(_cache));
  fs.renameSync(tmp, CACHE_PATH);
}

// ─── Synchronous cache reads (hot injection path — never hits the network) ────
function lookupChapterMap(book, chapter) {
  const c = getCache();
  const b = c.verses[book];
  const chap = b && b[String(chapter)];
  return chap && typeof chap === 'object' ? chap : null;
}

// Text of a single verse from cache, or null. lib/asv.js decodes entities and
// joins ranges; this returns the raw stored string for one verse.
function getVerse(book, chapter, verse) {
  const chap = lookupChapterMap(book, chapter);
  if (!chap) return null;
  const t = chap[String(verse)];
  return (t == null) ? null : String(t);
}

function chapterKey(book, chapter) { return book + '|' + String(chapter); }

function fetchedAtMs(book, chapter) {
  const c = getCache();
  const ts = c.meta.fetchedAt[chapterKey(book, chapter)];
  const ms = ts ? Date.parse(ts) : NaN;
  return Number.isFinite(ms) ? ms : 0;
}

// A chapter is "present" if it has any cached verses; "fresh" if it was fetched
// within the TTL. Injection ignores freshness; only refreshers use isChapterStale.
function hasChapter(book, chapter) {
  const chap = lookupChapterMap(book, chapter);
  return !!chap && Object.keys(chap).length > 0;
}
function isChapterStale(book, chapter) {
  return (Date.now() - fetchedAtMs(book, chapter)) > MAX_AGE_MS;
}

// ─── API.Bible fetch (async, out-of-band only) ────────────────────────────────
// Parse API.Bible `content-type=json` structured content into a { verseNum: text }
// map. The JSON tree is an array of block nodes; a `verse` tag is a milestone
// marker carrying attrs.number, and the verse's text lives in the sibling text
// nodes that follow it (possibly across paragraphs, for poetry) until the next
// verse marker. We walk depth-first, keeping the "current verse" cursor, and
// append every text node to it. The verse marker's own items (the printed number)
// are skipped. Notes/titles are excluded by request params, so no note text leaks
// into a verse.
function parseChapterContent(content) {
  const verses = {};
  let current = null;

  function walk(node) {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') return;

    if (node.name === 'verse' && node.attrs && node.attrs.number != null) {
      // A verse marker may denote a range ("1-2"); key by the first number so the
      // range's text lands under a real verse slot rather than a compound key.
      current = String(node.attrs.number).split(/[^0-9]/)[0];
      if (current && !verses[current]) verses[current] = [];
      return; // skip the marker's own child (the printed verse number)
    }
    if (node.type === 'text' && typeof node.text === 'string') {
      if (current) verses[current].push(node.text);
      return;
    }
    if (node.items) walk(node.items);
  }

  walk(content);

  const out = {};
  for (const [num, parts] of Object.entries(verses)) {
    const text = parts.join('').replace(/\s+/g, ' ').trim();
    if (text) out[num] = text;
  }
  return out;
}

// Fetch ONE chapter from API.Bible, store it in the cache, and return its
// { verseNum: text } map. Returns null on any failure (no key, network error,
// non-200, empty parse) so callers can fall back to ASV. Never throws.
async function fetchChapter(bookName, chapterNum) {
  const usfm = NAME_TO_USFM[bookName];
  const apiKey = process.env.API_BIBLE_KEY;
  if (!usfm || !apiKey) return null;

  const chapterId = usfm + '.' + String(chapterNum);
  const url = API_BASE + '/v1/bibles/' + NASB_BIBLE_ID + '/chapters/' + chapterId + '?' +
    new URLSearchParams({
      'content-type':           'json',
      'include-notes':          'false',
      'include-titles':         'false',
      'include-chapter-numbers':'false',
      'include-verse-numbers':  'true',
      'include-verse-spans':    'false',
    });

  try {
    const res = await fetch(url, { headers: { 'api-key': apiKey } });
    if (!res.ok) {
      console.error('[nasb] fetch ' + chapterId + ' HTTP ' + res.status);
      return null;
    }
    const json = await res.json();
    const content = json && json.data && json.data.content;
    if (!content) return null;

    const map = parseChapterContent(content);
    if (!map || Object.keys(map).length === 0) return null;

    const c = getCache();
    if (!c.verses[bookName]) c.verses[bookName] = {};
    c.verses[bookName][String(chapterNum)] = map;
    c.meta.fetchedAt[chapterKey(bookName, chapterNum)] = new Date().toISOString();
    saveCache();
    return map;
  } catch (err) {
    console.error('[nasb] fetch ' + chapterId + ' error:', err && err.message ? err.message : err);
    return null;
  }
}

// Reader helper: return a chapter's verse map plus its source, fetching lazily on
// a cache miss or when stale. Falls back to null on failure so the reader can
// serve ASV. `source` is 'NASB 1995' when the map came from NASB, else null.
async function ensureChapter(bookName, chapterNum) {
  if (hasChapter(bookName, chapterNum) && !isChapterStale(bookName, chapterNum)) {
    return { map: lookupChapterMap(bookName, chapterNum), source: 'NASB 1995' };
  }
  const map = await fetchChapter(bookName, chapterNum);
  if (map) return { map, source: 'NASB 1995' };
  // Fetch failed: serve any stale cached copy rather than nothing; else give up.
  if (hasChapter(bookName, chapterNum)) {
    return { map: lookupChapterMap(bookName, chapterNum), source: 'NASB 1995' };
  }
  return { map: null, source: null };
}

// Cron helper: re-fetch every CACHED chapter whose fetchedAt is older than the
// TTL. Does NOT cold-fill uncached chapters (that is the warm script's job). Paces
// requests with a small delay to stay polite under the free-tier rate limit.
// Returns counts; never throws into the scheduler.
async function refreshStale(opts) {
  const delayMs = (opts && opts.delayMs != null) ? opts.delayMs : 300;
  const c = getCache();
  const stale = [];
  for (const book of Object.keys(c.verses)) {
    for (const chapter of Object.keys(c.verses[book])) {
      if (isChapterStale(book, chapter)) stale.push([book, chapter]);
    }
  }
  let refreshed = 0, failed = 0;
  for (const [book, chapter] of stale) {
    const map = await fetchChapter(book, Number(chapter));
    if (map) refreshed++; else failed++;
    if (delayMs) await new Promise(r => setTimeout(r, delayMs));
  }
  return { stale: stale.length, refreshed, failed };
}

module.exports = {
  // sync reads (injection)
  getVerse, lookupChapterMap, hasChapter, isChapterStale,
  // async fetch/refresh (out-of-band)
  fetchChapter, ensureChapter, refreshStale,
  // metadata / helpers
  BOOKS, NAME_TO_USFM, NASB_BIBLE_ID, REFRESH_AFTER_DAYS,
  parseChapterContent, // exported for the warm script / tests
};
