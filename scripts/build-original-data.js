#!/usr/bin/env node
// ─── Build orig/ for the highlight panel's "Original" tab ───────────────────
// Downloads STEPBible-Data (STEPBible.org, based on work at Tyndale House,
// Cambridge — CC BY 4.0) and writes slim files to orig/ (top level — NOT data/,
// which is member data and backed up nightly):
//
//   orig/ot/<Book>.json     Hebrew OT (TAHOT, Leningrad codex), word by word
//   orig/nt/<Book>.json     Greek NT  (TAGNT, the words in NA27 — see below)
//       { "<chapter>": { "<verse>": [ { w, t, g, s, m, l, v? }, ... ] } }
//       w original word (Hebrew pointed / Greek polytonic), t transliteration,
//       g English gloss, s Strong's (STEP disambiguated), m morph code,
//       l dictionary form, v variant flag (present only when set — see below)
//   orig/lexicon-heb.json   Strong's → { lemma, translit, gloss, def }  (TBESH)
//   orig/lexicon-grk.json   Strong's → { lemma, translit, gloss, def }  (TBESG)
//   orig/morph-heb.json     morph segment code → plain English         (TEHMC)
//   orig/morph-grk.json     morph code → plain English                 (TEGMC)
//   orig/SOURCES.md         sources, snapshot, license, attribution
//
// Node built-ins only (global fetch, Node 18+). Re-runnable any time to refresh.
//
//   node scripts/build-original-data.js             # download fresh, build orig/
//   node scripts/build-original-data.js --cached    # reuse the previous downloads
//
// Downloads (~110 MB) go to <os tmpdir>/iron-ink-orig-build and are left there for
// --cached; delete that folder to reclaim the space. Read by lib/original.js.
//
// LICENSE GATE: the build refuses to run unless the repository README still
// declares CC BY 4.0 (an older STEPBible wiki page listed a non-commercial
// licence; the repository is the authority).
//
// VERSIFICATION — every verse is keyed to ENGLISH (NASB) chapter:verse.
//   TAHOT and TAGNT both key each word by its English reference "as defined by
//   the NRSV", with the Hebrew / KJV / NA reference in brackets when different
//   (e.g. "Psa.51.1(51.3)", "Mal.4.5(3.23)", "3Jn.1.15[1.14]"). The English
//   (unbracketed) reference is what we key by. Psalm titles are verse 0 in the
//   data (NASB does not number them); they are kept under "0".
//   NASB 1995 follows the NRSV/English numbering here except at the verse-level
//   renumberings in NT_KJV_CHAPTERS, where it follows the traditional (KJV)
//   division — there the bracketed KJV reference is used instead.
//
// GREEK EDITIONS — TAGNT is an amalgamated text: each word lists the editions
//   that contain it ("NA28+NA27+Tyn+SBL+WH+Treg+TR+Byz") and a word type
//   ("NKO" = in all editions; N = Nestle-Aland, K = KJV/TR, O = others; brackets
//   / lower case = differs in those). We keep the words whose editions include
//   NA27 — the critical text the NASB 1995 was translated from (NA28 differs
//   from it in ~130 words, mostly the Catholic Epistles). v: 1 marks a word whose
//   word type is not "NKO" (the editions differ there) or that is not in NA28.
//   Alternate readings are not kept (not displayed yet).
//
// HEBREW TEXT TYPE — TAHOT follows Leningrad (L), the Qere where the scribes
//   corrected the text (Q, as translators do), restores Jos.21.36-37 / Neh.7.67b
//   (R), and adds a few LXX-attested words (X). v holds that type letter when it
//   is not plain Leningrad.

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const ROOT    = path.join(__dirname, '..');
const OUT     = path.join(ROOT, 'orig');
const CACHE   = path.join(os.tmpdir(), 'iron-ink-orig-build');
const CACHED  = process.argv.includes('--cached');
const REPO    = 'https://raw.githubusercontent.com/STEPBible/STEPBible-Data/master/';
const API     = 'https://api.github.com/repos/STEPBible/STEPBible-Data/commits/master';

const FILES = {
  readme:  'README.md',
  tahot1:  'Translators Amalgamated OT+NT/TAHOT Gen-Deu - Translators Amalgamated Hebrew OT - STEPBible.org CC BY.txt',
  tahot2:  'Translators Amalgamated OT+NT/TAHOT Jos-Est - Translators Amalgamated Hebrew OT - STEPBible.org CC BY.txt',
  tahot3:  'Translators Amalgamated OT+NT/TAHOT Job-Sng - Translators Amalgamated Hebrew OT - STEPBible.org CC BY.txt',
  tahot4:  'Translators Amalgamated OT+NT/TAHOT Isa-Mal - Translators Amalgamated Hebrew OT - STEPBible.org CC BY.txt',
  tagnt1:  'Translators Amalgamated OT+NT/TAGNT Mat-Jhn - Translators Amalgamated Greek NT - STEPBible.org CC-BY.txt',
  tagnt2:  'Translators Amalgamated OT+NT/TAGNT Act-Rev - Translators Amalgamated Greek NT - STEPBible.org CC-BY.txt',
  tbesh:   'Lexicons/TBESH - Translators Brief lexicon of Extended Strongs for Hebrew - STEPBible.org CC BY.txt',
  tbesg:   'Lexicons/TBESG - Translators Brief lexicon of Extended Strongs for Greek - STEPBible.org CC BY.txt',
  tehmc:   'Morphology codes/TEHMC - Translators Expansion of Hebrew Morphology Codes - STEPBible.org CC BY.txt',
  tegmc:   'Morphology codes/TEGMC - Translators Expansion of Greek Morphhology Codes - STEPBible.org CC BY.txt',
};

// STEP book abbreviations → the canonical names that key data/asv.json.
const BOOKS = [
  ['Gen', 'Genesis'], ['Exo', 'Exodus'], ['Lev', 'Leviticus'], ['Num', 'Numbers'],
  ['Deu', 'Deuteronomy'], ['Jos', 'Joshua'], ['Jdg', 'Judges'], ['Rut', 'Ruth'],
  ['1Sa', '1 Samuel'], ['2Sa', '2 Samuel'], ['1Ki', '1 Kings'], ['2Ki', '2 Kings'],
  ['1Ch', '1 Chronicles'], ['2Ch', '2 Chronicles'], ['Ezr', 'Ezra'], ['Neh', 'Nehemiah'],
  ['Est', 'Esther'], ['Job', 'Job'], ['Psa', 'Psalms'], ['Pro', 'Proverbs'],
  ['Ecc', 'Ecclesiastes'], ['Sng', 'Song of Solomon'], ['Isa', 'Isaiah'], ['Jer', 'Jeremiah'],
  ['Lam', 'Lamentations'], ['Ezk', 'Ezekiel'], ['Dan', 'Daniel'], ['Hos', 'Hosea'],
  ['Jol', 'Joel'], ['Amo', 'Amos'], ['Oba', 'Obadiah'], ['Jon', 'Jonah'], ['Mic', 'Micah'],
  ['Nam', 'Nahum'], ['Hab', 'Habakkuk'], ['Zep', 'Zephaniah'], ['Hag', 'Haggai'],
  ['Zec', 'Zechariah'], ['Mal', 'Malachi'],
  ['Mat', 'Matthew'], ['Mrk', 'Mark'], ['Luk', 'Luke'], ['Jhn', 'John'], ['Act', 'Acts'],
  ['Rom', 'Romans'], ['1Co', '1 Corinthians'], ['2Co', '2 Corinthians'], ['Gal', 'Galatians'],
  ['Eph', 'Ephesians'], ['Php', 'Philippians'], ['Col', 'Colossians'],
  ['1Th', '1 Thessalonians'], ['2Th', '2 Thessalonians'], ['1Ti', '1 Timothy'],
  ['2Ti', '2 Timothy'], ['Tit', 'Titus'], ['Phm', 'Philemon'], ['Heb', 'Hebrews'],
  ['Jas', 'James'], ['1Pe', '1 Peter'], ['2Pe', '2 Peter'], ['1Jn', '1 John'],
  ['2Jn', '2 John'], ['3Jn', '3 John'], ['Jud', 'Jude'], ['Rev', 'Revelation'],
];
const ABBR = new Map(BOOKS);

// NT chapters where NASB 1995 follows the traditional (KJV) verse division
// rather than the NRSV's: 2 Cor 13:12–14 (NRSV 13:12b–13) and Rev 13:1a
// (NRSV 12:18). Everywhere else NASB 1995 numbers as the NRSV does — notably
// 3 John 1:15 and Phil 1:16–17, where the KJV numbering differs and NASB does
// not follow it. Word-level boundary shifts elsewhere follow the NRSV.
const NT_KJV_CHAPTERS = new Set(['2Co.13', 'Rev.12']);

function fileName(book) { return book.replace(/ /g, '_') + '.json'; }

// ── Download ────────────────────────────────────────────────────────────────
// Saves each file to the cache folder and returns its path. Files are read one
// at a time while parsing (readSrc) so the build stays small enough for a 1 GB
// droplet running the app alongside it.
async function download(key) {
  const dest = path.join(CACHE, key + '.txt');
  if (CACHED && fs.existsSync(dest)) return dest;
  const url = REPO + FILES[key].split('/').map(encodeURIComponent).join('/');
  const res = await fetch(url);
  if (!res.ok) throw new Error('Download failed (' + res.status + '): ' + FILES[key]);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}
function readSrc(key) { return fs.readFileSync(path.join(CACHE, key + '.txt'), 'utf8'); }

// Line by line over a cached file in 1 MB chunks, so the large TAHOT / TAGNT
// files are never held whole in memory.
function eachLine(key, fn) {
  const { StringDecoder } = require('string_decoder');
  const fd  = fs.openSync(path.join(CACHE, key + '.txt'), 'r');
  const buf = Buffer.alloc(1 << 20);
  const dec = new StringDecoder('utf8');
  let rest = '', n;
  try {
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      const parts = (rest + dec.write(buf.subarray(0, n))).split(/\r?\n/);
      rest = parts.pop();
      for (const line of parts) fn(line);
    }
    rest += dec.end();
    if (rest) fn(rest);
  } finally { fs.closeSync(fd); }
}

async function repoCommit() {
  try {
    const res = await fetch(API, { headers: { 'User-Agent': 'iron-ink-build', Accept: 'application/vnd.github+json' } });
    if (!res.ok) return null;
    const j = await res.json();
    return { sha: j.sha, date: j.commit && j.commit.committer && j.commit.committer.date };
  } catch (e) { return null; }
}

// ── Helpers ─────────────────────────────────────────────────────────────────
const WORD_LINE = /^([0-9A-Za-z]{3})\.(\d+)\.(\d+)([^#\t]*)#(\d+)=([^\t]*)\t/;

function stripHtml(s) {
  return String(s || '')
    .replace(/<ref=[^>]*>/gi, '').replace(/<\/ref>/gi, '')
    .replace(/<br\s*\/?>/gi, '; ').replace(/<lb\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/__/g, '')
    .replace(/\s+/g, ' ')
    .replace(/(;\s*)+/g, '; ')
    .replace(/^[\s;]+|[\s;]+$/g, '')
    .trim();
}

function clip(s, max) {
  s = String(s || '').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sp  = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:]+$/, '') + '…';
}

const DEF_MAX = 260;

// Hebrew brief meaning: a numbered sense list ("1) father …<br>2) …").
function hebDef(raw) {
  return clip(stripHtml(raw), DEF_MAX);
}

// Greek brief entry (Abbott-Smith): the bold runs after the headword are the
// senses ("<b>to deem right</b> … <b>to do one justice</b>"). Fall back to
// the stripped text when there are none.
function grkDef(raw, lemma) {
  const bolds = [];
  const re = /<b>([^<]+)<\/b>/gi;
  let m;
  while ((m = re.exec(String(raw || '')))) {
    const b = m[1].replace(/\s+/g, ' ').trim().replace(/[,.;:]+$/, '');
    if (!b) continue;
    if (/[Ͱ-Ͽἀ-῿]/.test(b)) continue;   // headword / Greek forms
    if (bolds.indexOf(b) === -1) bolds.push(b);
  }
  if (bolds.length) return clip(bolds.join('; '), DEF_MAX);
  return clip(stripHtml(raw), DEF_MAX);
}

// "Function=Verb; Tense=Aorist; Voice=Passive; Form=Participle; …" → "Verb ·
// aorist · passive · participle · …". Top-level ";" only (Hebrew values carry
// "(hence Action=Simple; Voice=Active)" which becomes "(simple, active)").
function plainMorph(desc) {
  const parts = [];
  let depth = 0, cur = '';
  for (const ch of String(desc)) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ';' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  const out = [];
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq < 0) continue;
    const key = p.slice(0, eq).trim();
    let val = p.slice(eq + 1).trim();
    let hence = '';
    const hm = val.match(/^(.*?)\s*\(hence\s+(.*)\)\s*$/i);
    if (hm) {
      val = hm[1].trim();
      hence = hm[2].split(';').map(x => (x.split('=')[1] || '').trim().toLowerCase()).filter(Boolean).join(', ');
    }
    if (!val) continue;
    if (key === 'Function' || key === 'Stem' || key === 'Name type' || key === 'Language') {
      // proper terms keep their case (Verb, Qal, Niphal)
    } else {
      val = val.toLowerCase();
    }
    if (key === 'Person') val = val + ' person';
    if (key === 'Name type') val = 'name: ' + val.toLowerCase();
    out.push(hence ? val + ' (' + hence + ')' : val);
  }
  return out.join(' · ');
}

function parseMorphTable(text) {
  const table = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9\-]+)\t(Function=[^\t]*)/);
    if (!m) continue;
    if (table[m[1]]) continue;
    const plain = plainMorph(m[2]);
    if (plain) table[m[1]] = plain;
  }
  return table;
}

function parseLexicon(text, isGreek) {
  const lex = {};
  for (const line of text.split(/\r?\n/)) {
    const f = line.split('\t');
    if (f.length < 8 || !/^[HG]\d{4}/.test(f[0])) continue;
    const d = (f[1] || '').split('=')[0].trim();
    if (!/^[HG]\d{4}[A-Za-z]?$/.test(d)) continue;
    if (lex[d]) continue;
    const lemma = f[3].trim(), translit = f[4].trim(), gloss = f[6].trim();
    lex[d] = {
      lemma, translit, gloss,
      def: isGreek ? grkDef(f[7], lemma) : hebDef(f[7]),
    };
  }
  return lex;
}

function put(tree, ch, vs, word) {
  (tree[ch] = tree[ch] || {});
  (tree[ch][vs] = tree[ch][vs] || []).push(word);
}

// ── Hebrew (TAHOT) ──────────────────────────────────────────────────────────
// Columns: Ref&Type | Hebrew | Translit | Translation | dStrongs | Grammar |
//          Meaning variants | Spelling variants | Root dStrong+Instance |
//          Alternative Strongs | Conjoin word | Expanded Strong tags
function parseTahot(key, books, stats) {
  eachLine(key, line => {
    const m = line.match(WORD_LINE);
    if (!m) return;
    const book = ABBR.get(m[1]);
    if (!book) { stats.unknownBooks.add(m[1]); return; }
    if (m[4] && !/^\(\d+\.\d+\)$/.test(m[4])) stats.oddRefs.add(m[1] + '.' + m[2] + '.' + m[3] + m[4]);
    const f = line.split('\t');
    const type = (m[6] || '').trim();
    const dStrongs = (f[4] || '').trim();
    const main = (dStrongs.match(/\{([HA]\d{4}[A-Za-z]?)\}/) || [])[1] ||
                 (dStrongs.split(/[\/\\]/).map(s => s.trim()).find(s => /^H\d{4}/.test(s) && !/^H9\d{3}/.test(s))) || '';
    const expanded = f[11] || '';
    const lm = main ? expanded.match(new RegExp('\\{' + main + '=([^=}]+)=')) : null;
    const word = {
      w: (f[1] || '').replace(/[\/\\]/g, '').trim(),
      t: (f[2] || '').replace(/\//g, '').trim(),
      g: (f[3] || '').replace(/\//g, ' ').replace(/\s+/g, ' ').trim(),
      s: main,
      m: (f[5] || '').trim(),
      l: lm ? lm[1].trim() : '',
    };
    const typeLetter = type.charAt(0);
    if (typeLetter && typeLetter !== 'L') word.v = typeLetter;
    if (!word.w) return;
    books[book] = books[book] || {};
    put(books[book], m[2], m[3], word);
    stats.words++;
  });
}

// ── Greek (TAGNT) ───────────────────────────────────────────────────────────
// Columns: Word&Type | Greek (translit) | English | dStrongs=Grammar |
//          Dictionary form=Gloss | editions | Meaning variants | …
const GREEK_TRAILING = /[\s,.;:·’'"“”«»¶⸀⸁⸂⸃⸄⸅⸆⸇⸈⸉⸊⸋⸌⸍⸎⸏⸐⸑⸒⸓⸔⸕⸖⸗⸘⸙⸚⸛⸜⸝⸞⸟⸠⸡⸢⸣⸤⸥⸦⸧⸨⸩⸪⸫⸬⸭⸮ⸯ\[\]()]+$/;
const GREEK_LEADING  = /^[\s“”"‘’«»¶\[\]()⸀⸁⸂⸃⸄⸅]+/;

function parseTagnt(key, books, stats) {
  eachLine(key, line => {
    const m = line.match(WORD_LINE);
    if (!m) return;
    const abbr = m[1];
    const book = ABBR.get(abbr);
    if (!book) { stats.unknownBooks.add(abbr); return; }
    const f = line.split('\t');
    const editions = (f[5] || '').split('+').map(e => e.replace(/[»«].*$/, '').trim());
    const inNA27 = editions.includes('NA27');
    const inNA28 = editions.includes('NA28');
    if (!inNA27) { if (inNA28) stats.na28Only++; else stats.notNA++; return; }

    let ch = m[2], vs = m[3];
    const kjv = (m[4] || '').match(/\[(\d+)\.(\d+)\]/);
    if (kjv && NT_KJV_CHAPTERS.has(abbr + '.' + m[2])) { ch = kjv[1]; vs = kjv[2]; stats.kjvMapped++; }
    if (m[4] && !/^(\[\d+\.\d+\]|\(\d+\.\d+\)|\{\d+\.\d+\})$/.test(m[4])) stats.oddRefs.add(abbr + '.' + m[2] + '.' + m[3] + m[4]);

    const gm = (f[1] || '').match(/^(.*?)\s*\(([^)]*)\)\s*$/);
    const greek = (gm ? gm[1] : (f[1] || '')).replace(GREEK_TRAILING, '').replace(GREEK_LEADING, '').trim();
    const translit = gm ? gm[2].replace(/[᾽’']+$/, '').trim() : '';
    // "G1344=V-APP-NPM", or for a merged word "G2532=CONJ + G1473=P-1NS".
    const sgParts = (f[3] || '').split(/\s*\+\s*/).map(p => p.split('='));
    const dict = (f[4] || '').split('=');
    const type = (m[6] || '').trim();
    const word = {
      w: greek,
      t: translit,
      // A leading "[14] " / "[13.1] " is a verse-number note, not gloss text.
      g: (f[2] || '').replace(/^\s*\[\d+(?:\.\d+)?\]\s*/, '').replace(/[\s,.;:]+$/, '').replace(/¶/g, '').trim(),
      s: (sgParts[0][0] || '').trim(),
      m: sgParts.map(p => (p[1] || '').trim()).filter(Boolean).join(' + '),
      l: (dict[0] || '').trim(),
    };
    if (type !== 'NKO' || !inNA28) { word.v = 1; stats.variantFlagged++; }
    if (!word.w) return;
    books[book] = books[book] || {};
    put(books[book], ch, vs, word);
    stats.words++;
  });
}

// ── Versification cross-check against data/asv.json ─────────────────────────
// ASV numbers like the KJV; NASB 1995 numbers like the ASV except where noted.
// Lists every verse that exists in one and not the other, for the report.
function crossCheck(books) {
  let asv = null;
  try { asv = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/asv.json'), 'utf8')); } catch (e) { return null; }
  const onlyOrig = [], onlyAsv = [];
  for (const [, book] of BOOKS) {
    const o = books[book] || {}, a = asv[book] || {};
    const chs = new Set(Object.keys(o).concat(Object.keys(a)));
    for (const ch of chs) {
      const ov = new Set(Object.keys(o[ch] || {}).filter(v => v !== '0'));
      const av = new Set(Object.keys(a[ch] || {}));
      for (const v of ov) if (!av.has(v)) onlyOrig.push(book + ' ' + ch + ':' + v);
      for (const v of av) if (!ov.has(v)) onlyAsv.push(book + ' ' + ch + ':' + v);
    }
  }
  return { onlyOrig, onlyAsv };
}

function sizeOf(p) {
  const st = fs.statSync(p);
  if (!st.isDirectory()) return st.size;
  return fs.readdirSync(p).reduce((n, f) => n + sizeOf(path.join(p, f)), 0);
}
function mb(n) { return (n / 1048576).toFixed(2) + ' MB'; }

// ── Main ────────────────────────────────────────────────────────────────────
(async function main() {
  fs.mkdirSync(CACHE, { recursive: true });
  console.log('Source cache: ' + CACHE + (CACHED ? ' (--cached)' : ''));

  await download('readme');
  const readme = readSrc('readme');
  const licenseLine = readme.split(/\r?\n/).find(l => /CC BY/i.test(l)) || '';
  if (!/CC BY 4\.0/.test(licenseLine) || /\bNC\b|Non-?Commercial/i.test(licenseLine)) {
    console.error('LICENSE CHECK FAILED — README does not declare CC BY 4.0:\n  ' + licenseLine);
    process.exit(2);
  }
  console.log('License: ' + licenseLine.replace(/\*/g, '').trim());

  const commit = await repoCommit();
  for (const k of Object.keys(FILES)) {
    if (k === 'readme') continue;
    process.stdout.write('  ' + (CACHED ? 'cached ' : 'downloading ') + k + '… ');
    console.log(mb(fs.statSync(await download(k)).size));
  }

  // Parsed one source file at a time; each file holds whole books, which are
  // written out (to a staging folder, swapped in at the end so the running app
  // never sees a half-built orig/) and dropped before the next file is read.
  const STAGE = OUT + '.building';
  fs.rmSync(STAGE, { recursive: true, force: true });
  fs.mkdirSync(path.join(STAGE, 'ot'), { recursive: true });
  fs.mkdirSync(path.join(STAGE, 'nt'), { recursive: true });

  const hs = { words: 0, unknownBooks: new Set(), oddRefs: new Set() };
  const gs = { words: 0, unknownBooks: new Set(), oddRefs: new Set(), na28Only: 0, notNA: 0, variantFlagged: 0, kjvMapped: 0 };
  const usedH = new Set(), usedG = new Set(), usedMorphH = new Set(), usedMorphG = new Set();
  const verseKeys = {};   // book → chapter → { verse: 1 }, for the versification cross-check
  const written = new Set();

  // Hebrew morph: "HVqv2ms/Sp1bs" → segments "HVqv2ms", "HSp1bs" (the language
  // letter of the first segment applies to the rest).
  function hebSegments(code) {
    const segs = String(code || '').split('/').filter(Boolean);
    if (!segs.length) return [];
    const lang = segs[0].charAt(0);
    return segs.map((s, i) => (i === 0 ? s : lang + s));
  }

  function flush(tree, dir, collect) {
    for (const book of Object.keys(tree)) {
      const t = tree[book];
      verseKeys[book] = verseKeys[book] || {};
      for (const c of Object.keys(t)) {
        verseKeys[book][c] = verseKeys[book][c] || {};
        for (const v of Object.keys(t[c])) { verseKeys[book][c][v] = 1; t[c][v].forEach(collect); }
      }
      fs.writeFileSync(path.join(STAGE, dir, fileName(book)), JSON.stringify(t));
      written.add(book);
    }
  }
  const collectH = w => { if (w.s) usedH.add(w.s); hebSegments(w.m).forEach(c => usedMorphH.add(c)); };
  // Merged Greek words (crasis, e.g. κἀγώ) carry "CONJ + P-1NS": one code per part.
  const collectG = w => { if (w.s) usedG.add(w.s); String(w.m || '').split(' + ').filter(Boolean).forEach(c => usedMorphG.add(c)); };

  for (const k of ['tahot1', 'tahot2', 'tahot3', 'tahot4']) { const t = {}; parseTahot(k, t, hs); flush(t, 'ot', collectH); }
  for (const k of ['tagnt1', 'tagnt2']) { const t = {}; parseTagnt(k, t, gs); flush(t, 'nt', collectG); }
  for (const [, book] of BOOKS) if (!written.has(book)) console.warn('  !! no data for ' + book);

  const lexH = parseLexicon(readSrc('tbesh'), false);
  const lexG = parseLexicon(readSrc('tbesg'), true);
  const morH = parseMorphTable(readSrc('tehmc'));
  const morG = parseMorphTable(readSrc('tegmc'));

  // A disambiguated number the brief lexicon lacks (e.g. H0173 when only
  // H0173G/H/I exist) falls back to the base number, then to its first
  // disambiguated entry.
  function lexLookup(lex, s) {
    if (lex[s]) return lex[s];
    const base = s.replace(/[A-Za-z]$/, '');
    if (lex[base]) return lex[base];
    for (const suf of 'GHIJKLMNOPQRSTUVWXYZABCDEF') if (lex[base + suf]) return lex[base + suf];
    return null;
  }
  // Keep only the lexicon entries and morph codes the text uses.
  function pick(used, table, lookup) {
    const out = {}, miss = new Set();
    for (const k of used) { const e = lookup ? lookup(table, k) : table[k]; if (e) out[k] = e; else miss.add(k); }
    return { out, miss };
  }
  const LH = pick(usedH, lexH, lexLookup), LG = pick(usedG, lexG, lexLookup);
  const MH = pick(usedMorphH, morH), MG = pick(usedMorphG, morG);
  const usedLexH = LH.out, usedLexG = LG.out, usedMorH = MH.out, usedMorG = MG.out;
  const missLexH = LH.miss, missLexG = LG.miss, missMorH = MH.miss, missMorG = MG.miss;

  const FINAL = OUT;
  const OUTDIR = STAGE;
  fs.writeFileSync(path.join(OUTDIR, 'lexicon-heb.json'), JSON.stringify(usedLexH));
  fs.writeFileSync(path.join(OUTDIR, 'lexicon-grk.json'), JSON.stringify(usedLexG));
  fs.writeFileSync(path.join(OUTDIR, 'morph-heb.json'),   JSON.stringify(usedMorH));
  fs.writeFileSync(path.join(OUTDIR, 'morph-grk.json'),   JSON.stringify(usedMorG));

  const built = new Date().toISOString();
  const snap = commit ? 'commit ' + commit.sha + (commit.date ? ' (' + commit.date + ')' : '') : 'master as of ' + built;
  fs.writeFileSync(path.join(OUTDIR, 'SOURCES.md'),
`# orig/ — original-language data for the highlight panel's Original tab

Built by \`scripts/build-original-data.js\` on ${built}. Re-run it to refresh:

    node scripts/build-original-data.js

Read by \`lib/original.js\`. Not member data — kept out of \`data/\` on purpose.

## Source — STEPBible-Data

- Repository: https://github.com/STEPBible/STEPBible-Data (https://STEPBible.github.io/STEPBible-Data)
- Snapshot: ${snap}
- Created by www.STEPBible.org based on work at Tyndale House, Cambridge
- License: Creative Commons Attribution 4.0 (CC BY 4.0) — the repository README declares
  "${licenseLine.replace(/\*/g, '').trim()}"; each data file's header repeats CC BY 4.0
  and allows reformatting the data for an application.
- Required attribution: credit "STEP Bible" linked to www.STEPBible.org; attribute the data
  to Tyndale House and STEPBible.org and link https://STEPBible.github.io/STEPBible-Data
  as the source. Shown in the app as:
  "Original-language data: STEP Bible (STEPBible.org), based on work at Tyndale House,
  Cambridge. CC BY 4.0."
- Files used:
  - TAHOT — Translators Amalgamated Hebrew OT (Leningrad codex; Qere followed) — 4 files
  - TAGNT — Translators Amalgamated Greek NT — 2 files
  - TBESH / TBESG — Translators Brief lexicons of Extended Strongs (Hebrew / Greek)
  - TEHMC / TEGMC — Translators Expansion of Hebrew / Greek Morphology Codes

## Changes made to the data (as the license asks us to record)

Reformatted only — no corrections. Per word we keep the word, transliteration, English
gloss, disambiguated Strong's number, morphology code and dictionary form; morpheme
separators ("/", "\\") are removed from the Hebrew word and transliteration and trailing
punctuation from the Greek word. Lexicon definitions are shortened (HTML removed, clipped
to ${DEF_MAX} characters; for Greek, the bold sense glosses of the Abbott-Smith entry).
Morphology descriptions are rewritten from their "Function=…; Tense=…" form into one
plain-English line. Greek: only words whose editions include NA27 are kept; v: 1 marks
words where the editions differ or that NA28 lacks. Hebrew: v holds the text type when not
plain Leningrad (Q = Qere, R = restored, X = from the LXX).

Versification: keyed by the English (NRSV-defined) reference the data gives for every word;
NASB 1995 follows the traditional division at 2 Cor 13:12–14 and Rev 12:18/13:1, so the
bracketed KJV reference is used in those two chapters.
`);

  // Swap the finished build in.
  fs.rmSync(FINAL, { recursive: true, force: true });
  fs.renameSync(OUTDIR, FINAL);

  // ── Report ──
  console.log('\nHebrew words: ' + hs.words + '   Greek words (NA27): ' + gs.words);
  console.log('Greek: NA28-only words dropped ' + gs.na28Only + ', non-NA words dropped ' + gs.notNA +
              ', variant-flagged ' + gs.variantFlagged + ', KJV-mapped ' + gs.kjvMapped);
  console.log('Lexicon entries: heb ' + Object.keys(usedLexH).length + ' (missing ' + missLexH.size + ')' +
              ', grk ' + Object.keys(usedLexG).length + ' (missing ' + missLexG.size + ')');
  console.log('Morph codes: heb ' + Object.keys(usedMorH).length + ' (missing ' + missMorH.size + ')' +
              ', grk ' + Object.keys(usedMorG).length + ' (missing ' + missMorG.size + ')');
  if (missLexH.size) console.log('  missing heb lex: ' + [...missLexH].slice(0, 20).join(' '));
  if (missLexG.size) console.log('  missing grk lex: ' + [...missLexG].slice(0, 20).join(' '));
  if (missMorH.size) console.log('  missing heb morph: ' + [...missMorH].slice(0, 30).join(' '));
  if (missMorG.size) console.log('  missing grk morph: ' + [...missMorG].slice(0, 30).join(' '));
  if (hs.unknownBooks.size || gs.unknownBooks.size) console.log('  unknown books: ' + [...hs.unknownBooks, ...gs.unknownBooks].join(' '));
  if (hs.oddRefs.size || gs.oddRefs.size) console.log('  odd refs: ' + [...hs.oddRefs, ...gs.oddRefs].slice(0, 30).join(' '));

  const cc = crossCheck(verseKeys);
  if (cc) {
    console.log('\nVersification vs data/asv.json — verses only in orig/: ' + cc.onlyOrig.length + ', only in ASV: ' + cc.onlyAsv.length);
    if (cc.onlyOrig.length) console.log('  only in orig/: ' + cc.onlyOrig.join('; '));
    if (cc.onlyAsv.length)  console.log('  only in ASV:   ' + cc.onlyAsv.join('; '));
  }

  console.log('\nSizes:');
  console.log('  orig/ot          ' + mb(sizeOf(path.join(OUT, 'ot'))) + '  (' + fs.readdirSync(path.join(OUT, 'ot')).length + ' books)');
  console.log('  orig/nt          ' + mb(sizeOf(path.join(OUT, 'nt'))) + '  (' + fs.readdirSync(path.join(OUT, 'nt')).length + ' books)');
  ['lexicon-heb.json', 'lexicon-grk.json', 'morph-heb.json', 'morph-grk.json', 'SOURCES.md'].forEach(f =>
    console.log('  orig/' + f.padEnd(17) + mb(sizeOf(path.join(OUT, f)))));
  const total = sizeOf(OUT);
  console.log('  TOTAL            ' + mb(total));
  console.log('Peak memory (RSS): ' + mb(process.resourceUsage().maxRSS * 1024));
})().catch(err => { console.error(err); process.exit(1); });
