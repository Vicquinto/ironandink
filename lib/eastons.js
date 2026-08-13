// ─── Easton's Bible Dictionary (M.G. Easton, 1897, public domain) ─────────────
// Primary source for the Define lookup. The text is public-domain Easton's; only
// the machine-readable packaging is third-party (see data provenance below), so —
// unlike a licensed translation such as the NASB — it carries no licensing
// constraint and is safe on every path (it never involves an AI call).
//
// Data shape (data/eastons.json): a lowercased headword key → { word, senses },
// where `word` preserves the original headword capitalization (proper nouns) and
// `senses` is an array of one or more definition paragraphs. Built deterministically
// from the line-delimited public-domain source (garydavenport73/eastons-bible-
// dictionary-json, itself derived from JWBickel/BibleDictionaries) — [N] footnote
// markers stripped, whitespace normalized, senses preserved verbatim otherwise.
// ~3,961 headwords.

const fs   = require('fs');
const path = require('path');

const EASTONS_PATH = path.join(__dirname, '../data/eastons.json');

let _eastons = null;
function getEastons() {
  if (!_eastons) _eastons = JSON.parse(fs.readFileSync(EASTONS_PATH, 'utf8'));
  return _eastons;
}

// Lowercase, collapse internal whitespace, trim. Matches the key form used when
// data/eastons.json was built, so a lookup key lines up with a stored key.
function normalize(word) {
  return String(word).toLowerCase().replace(/\s+/g, ' ').trim();
}

// Resolve a word/phrase to its Easton's entry, or null. Case-insensitive. Tries an
// exact headword match first, then light plural normalization (strip a trailing
// "es" or "s") so a plural/demonym has a chance of reaching its base headword when
// that headword exists. Never guesses beyond that — a miss returns null cleanly so
// the caller can fall through to the general dictionary.
//
// Returns { word, senses, matched }: `word` is the canonical headword (original
// capitalization), `senses` the definition paragraphs, `matched` one of
// 'exact' | 'plural' (useful for showing provenance when the headword differs).
function lookup(word) {
  if (word == null) return null;
  const q = normalize(word);
  if (!q) return null;

  const data = getEastons();

  if (data[q]) {
    return { word: data[q].word, senses: data[q].senses, matched: 'exact' };
  }

  // Light plural stripping: "es" first (e.g. "-es"), then a bare trailing "s".
  const candidates = [];
  if (/es$/.test(q)) candidates.push(q.slice(0, -2));
  if (/s$/.test(q))  candidates.push(q.slice(0, -1));
  for (const c of candidates) {
    if (c && data[c]) {
      return { word: data[c].word, senses: data[c].senses, matched: 'plural' };
    }
  }

  return null;
}

// Render an entry's senses to readable markdown for the Define panel. A lone sense
// is returned as-is; multiple senses are numbered so distinct meanings stay
// distinct. Scripture references are already inline in the source text and pass
// through untouched.
function toMarkdown(entry) {
  if (!entry || !Array.isArray(entry.senses) || !entry.senses.length) return '';
  if (entry.senses.length === 1) return entry.senses[0];
  return entry.senses.map((s, i) => '**' + (i + 1) + '.** ' + s).join('\n\n');
}

module.exports = { lookup, toMarkdown };
