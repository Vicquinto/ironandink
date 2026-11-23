#!/usr/bin/env node
// scripts/build-hebrew-course.js — data side of the Hebrew course (Phase A).
//
//   node scripts/build-hebrew-course.js [--tahot <dir>]
//
// The Hebrew twin of scripts/build-greek-course.js: same files, same checks, in
// courses/hebrew/. Writes (generated):
//   vocab.json           the 250 most frequent OT lemmas + the bound morphemes
//                        (prefixes, suffixes) + the Genesis 1:1–5 passage supplement
//   paradigm-check.json  every paradigm cell checked against the OT
//   reading-gen1.json    Genesis 1:1–5 word by word AND morpheme by morpheme
//   course-check.json    lesson-plan validation, example-verse coverage, grammar coverage
// Hand-written inputs (never touched here): course.json, alphabet.json,
//   paradigms.json, display.json.
//
// SOURCE. orig/ot (built by scripts/build-original-data.js from STEPBible TAHOT)
// keeps one Strong's number per word and removes TAHOT's morpheme separators. So
// the morpheme split is read from the same TAHOT files that build used — its
// download cache (<os tmpdir>/iron-ink-orig-build/tahot1-4.txt, kept by
// `node scripts/build-original-data.js --cached`), or --tahot <dir> — and every
// word is checked against orig/ot: the same words, in the same verses and order,
// with the same text once the separators are removed. Any mismatch stops the
// build. How TAHOT marks the parts:
//   Hebrew      "וְ/הָ/אָ֗רֶץ"     "/" between morphemes, "\" before a mark that
//                                 is not a morpheme (maqqef ־, sof pasuq ׃, …)
//   dStrongs    "H9002/H9009/{H0776G}"   one number per morpheme; prefixes and
//                                 suffixes are H9xxx; the main word is in {}
//   Grammar     "HC/Td/Ncfsa"     one code per morpheme; the language letter (H
//                                 Hebrew, A Aramaic) is written on the first only
//   Expanded    "H9002=ו=and/H9009=ה=the/{H0776G=אֶ֫רֶץ=…}"  each morpheme's
//                                 number = dictionary form = gloss
//   (Rd = a preposition with the article merged into its vowel: בַּ.)
//
// Node built-ins only; deterministic (no timestamps, full tie-breaks); exits
// non-zero on any problem. All Hebrew is compared in NFC with cantillation
// marks removed (formKey).

'use strict';
const fs   = require('fs');
const os   = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ORIG = path.join(ROOT, 'orig');
const OUT  = path.join(ROOT, 'courses', 'hebrew');
const VOCAB_SIZE  = 250;
const PASSAGE_MIN = 2;
const READING = { book: 'Genesis', chapter: 1, from: 1, to: 5 };
const argDir = (() => { const i = process.argv.indexOf('--tahot'); return i > 0 ? process.argv[i + 1] : null; })();
const TAHOT_DIR = argDir || path.join(os.tmpdir(), 'iron-ink-orig-build');

const OT_BOOKS = [
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
];
const ABBR = new Map(OT_BOOKS);
const BOOK_ORDER = OT_BOOKS.map(b => b[1]);
// exampleRefs preference: Genesis 1–3, then Psalms, then canonical order.
function refRank(book, ch) { return book === 'Genesis' && ch <= 3 ? 0 : book === 'Psalms' ? 1 : 2; }

// ── text helpers ────────────────────────────────────────────────────────────
const nfc = s => String(s == null ? '' : s).normalize('NFC');
// Comparable Hebrew: NFC, no cantillation (U+0591–U+05AF, incl. the ole of
// dictionary forms), no meteg (U+05BD), paseq, sof pasuq, upper/lower dots,
// maqqef, separators, spaces or paragraph letters after a space.
// The shared helper (lib/hebrew-text.js), also used by the Languages pages.
const formKey = require('../lib/hebrew-text').hebrewKey;
const refOf = (book, ch, v) => `${book} ${ch}:${v}`;
function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function writeJson(name, obj) { fs.writeFileSync(path.join(OUT, name), JSON.stringify(obj, null, 2) + '\n', 'utf8'); }
const byCount = m => [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
function die(msg) { console.error('ERROR: ' + msg); process.exit(1); }

// ── load orig/ ──────────────────────────────────────────────────────────────
const lexicon = readJson(path.join(ORIG, 'lexicon-heb.json'));
const morph   = readJson(path.join(ORIG, 'morph-heb.json'));
const describeSeg = code => morph[code] || code;
// A full code ("HC/Td/Ncfsa") → its segments with the language letter on each.
function segCodes(code) {
  const segs = String(code || '').split('/').filter(Boolean);
  if (!segs.length) return [];
  const lang = segs[0].charAt(0);
  return segs.map((s, i) => (i === 0 ? s : lang + s));
}
const describeCode = code => segCodes(code).map(describeSeg).join(' + ');

const origBooks = new Map();
for (const book of BOOK_ORDER) origBooks.set(book, readJson(path.join(ORIG, 'ot', book.replace(/ /g, '_') + '.json')));

// ── TAHOT, morpheme by morpheme, checked against orig/ot ────────────────────
const WORD_LINE = /^([0-9A-Za-z]{3})\.(\d+)\.(\d+)([^#\t]*)#(\d+)=([^\t]*)\t/;
function eachLine(file, fn) {
  const { StringDecoder } = require('string_decoder');
  const fd = fs.openSync(file, 'r');
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

for (let i = 1; i <= 4; i++) {
  if (!fs.existsSync(path.join(TAHOT_DIR, 'tahot' + i + '.txt'))) {
    die(`TAHOT source not found in ${TAHOT_DIR} (tahot1-4.txt). Run "node scripts/build-original-data.js" (it keeps its downloads there), or pass --tahot <dir>.`);
  }
}

const raw = new Map();   // "Book ch:v" → [ raw words in order ]
for (let i = 1; i <= 4; i++) {
  eachLine(path.join(TAHOT_DIR, 'tahot' + i + '.txt'), line => {
    const m = line.match(WORD_LINE);
    if (!m) return;
    const book = ABBR.get(m[1]);
    if (!book) return;
    const f = line.split('\t');
    if (!(f[1] || '').replace(/[\/\\]/g, '').trim()) return;   // as build-original-data.js
    const ref = refOf(book, m[2], m[3]);
    (raw.get(ref) || raw.set(ref, []).get(ref)).push({ heb: f[1].trim(), tr: (f[2] || '').trim(), gl: (f[3] || '').trim(), ds: (f[4] || '').trim(), code: (f[5] || '').trim(), exp: (f[11] || '').trim() });
  });
}

// Split one TAHOT word into morphemes. Marks after "\" (maqqef, sof pasuq, …)
// are dropped. Returns null if the columns don't line up.
function splitWord(r) {
  const hebParts = r.heb.split('/').map(p => p.split('\\')[0]);
  const dsParts  = r.ds.split('/').map(p => p.split('\\')[0].trim());
  const codes    = segCodes(r.code);
  const expParts = r.exp.split('/').map(p => p.split('\\')[0]);
  const trParts  = r.tr.split('/');
  const glParts  = r.gl.split('/');
  if (hebParts.length !== dsParts.length || dsParts.length !== codes.length) return null;
  const mainIdx = dsParts.findIndex(d => /^\{/.test(d));
  return hebParts.map((h, i) => {
    const strongs = dsParts[i].replace(/[{}]/g, '');
    const e = (expParts[i] || '').replace(/[{}]/g, '').split('=');
    return {
      form: nfc(h), key: formKey(h), strongs, code: codes[i],
      tr: trParts.length === hebParts.length ? trParts[i].replace(/\\.*$/, '').replace(/[-\s]+$/, '').trim() : '',
      gl: glParts.length === hebParts.length ? glParts[i].trim() : '',
      role: i === mainIdx ? 'main' : (mainIdx === -1 || i < mainIdx ? 'prefix' : 'suffix'),
      expLemma: nfc(e[1] || ''), expGloss: (e[2] || '').trim(),
    };
  });
}

const tokens = [];                 // canonical order; one per word
const verseTokens = new Map();
const problems = [];
let aramaic = 0, misaligned = 0;
for (const book of BOOK_ORDER) {
  const data = origBooks.get(book);
  const chs = Object.keys(data).map(Number).sort((a, b) => a - b);
  for (const ch of chs) {
    const vs = Object.keys(data[ch]).map(Number).sort((a, b) => a - b);
    for (const v of vs) {
      const ref = refOf(book, ch, v);
      const ow = data[ch][v];
      const rw = raw.get(ref) || [];
      if (rw.length !== ow.length) die(`${ref}: TAHOT has ${rw.length} words, orig/ot has ${ow.length}`);
      const list = ow.map((w, i) => {
        const r = rw[i];
        const joined = r.heb.replace(/[\/\\]/g, '').trim();
        if (nfc(joined) !== nfc(w.w)) die(`${ref} word ${i}: TAHOT "${joined}" vs orig/ot "${w.w}"`);
        const arm = /^A/.test(w.m || '');
        if (arm) aramaic++;
        let parts = splitWord(r);
        if (!parts) { misaligned++; parts = [{ form: nfc(w.w), key: formKey(w.w), strongs: w.s, code: segCodes(w.m).join('/'), role: 'main', expLemma: nfc(w.l), expGloss: w.g }]; }
        return { book, ch, v, ref, i, w: nfc(w.w), key: formKey(w.w), t: w.t, g: w.g, s: w.s, m: w.m, l: nfc(w.l), aramaic: arm, parts };
      });
      verseTokens.set(ref, list);
      tokens.push(...list);
    }
  }
}
const hebrewTokens = tokens.filter(t => !t.aramaic);


// ── course keys ─────────────────────────────────────────────────────────────
// Bound morphemes (prefixes and suffixes: Strong's H9xxx) are their own course
// items, keyed by that number — also where TAHOT makes a pronoun suffix the
// "main" part of a word (ב/{H9033} "in him"). Every other part is keyed by its
// dictionary form, split by Strong's number where the data files clearly
// different words under one form (homographs, a name beside a common word, or
// TAHOT's mislabel of H1419 גָּדוֹל as גַּל). Each split-off key is the
// lexicon's own form for that number when it differs, else the form plus the
// number. Words a learner would take as one word (an adjective and its stative
// verb, a noun and its verb, two spellings of "I") are left together.
const SPLIT_OFF = {
  'אֵת':   ['H0854', 'H0855'], 'עַד': ['H5703', 'H5706'], 'שָׁנָה': ['H8138'], 'קָרָא': ['H7122'],
  'אַ֫יִן': ['H0370'], 'כֵּן': ['H3653', 'H3654'], 'בַּת': ['H1324'], 'אָדָם': ['H0121'],
  'גַּל':  ['H1419'], 'טוֹב': ['H2897'], 'צָבָא': ['H6633'], 'רָעָה': ['H7462'], 'עָנָה': ['H6031'],
  'אַף':   ['H0637'], 'שֶׁ֫בַע': ['H7652'], 'שֵׁשׁ': ['H8336'], 'אֵל': ['H0411'], 'בַּד': ['H0906', 'H0907'],
  'עֵדָה': ['H5713'], 'זֶ֫בַח': ['H2078'], 'מַ֫עַל': ['H4604'], 'כָּבֵד': ['H3516'], 'שָׁבַר': ['H7666'],
  'בַּ֫עַל': ['H1168'], 'יָמִין': ['H3226'],
};
const baseOf = s => String(s || '').replace(/[A-Z]$/, '');
function lexOf(base) {
  return lexicon[base] || lexicon[base + 'G'] || lexicon[base + 'A'] ||
    Object.keys(lexicon).filter(k => baseOf(k) === base).sort().map(k => lexicon[k])[0] || null;
}
// Keys are the dictionary form without cantillation marks (formKey), so
// "אֶ֫רֶץ" and "אֶרֶץ" are one key. A data lemma that lists two forms
// ("אֲנִי, אָֽנֹכִ֫י") is keyed per Strong's number by the lexicon's form.
const canon = s => formKey(s);
const SPLITS = {};
for (const [lemma, bases] of Object.entries(SPLIT_OFF)) {
  const l = canon(lemma);
  SPLITS[l] = {};
  for (const b of bases) {
    const lx = lexOf(b);
    const lf = lx ? canon(lx.lemma) : '';
    SPLITS[l][b] = lf && lf !== l ? lf : l + ' (' + b + ')';
  }
}
const isBound = s => /^H9\d{3}/.test(s);
function keyOfPart(p, tk) {
  if (isBound(p.strongs)) return baseOf(p.strongs);
  const lemma = canon(p.role === 'main' ? tk.l : p.expLemma);
  if (lemma.includes(',')) { const lx = lexOf(baseOf(p.strongs)); return canon((lx ? lx.lemma : lemma).split(',')[0]); }
  const split = SPLITS[lemma];
  return (split && split[baseOf(p.strongs)]) || lemma;
}
for (const tk of tokens) for (const p of tk.parts) p.ck = keyOfPart(p, tk);

// ── categories (grammar coverage) ───────────────────────────────────────────
// A morpheme's grammatical category from its code: verbs by stem · conjugation;
// nouns by state (absolute / construct), proper names apart; everything else
// by its first two description parts ("Particle · definite article (hebrew)").
function categoryOfSeg(seg) {
  const parts = describeSeg(seg).split(' · ');
  if (parts[0] === 'Verb') return parts.slice(0, 3).join(' · ');
  if (parts[0] === 'Noun') {
    if (/^proper/.test(parts[1] || '')) return 'Noun · proper name';
    const st = parts.find(x => /^(absolute|construct|determined)$/.test(x));
    return 'Noun · ' + (st || parts[1] || '');
  }
  return parts.slice(0, 2).join(' · ');
}

// ── 1. vocabulary ───────────────────────────────────────────────────────────
const display = readJson(path.join(OUT, 'display.json'));
const lex = new Map();     // lexical keys
const bound = new Map();   // bound morphemes
for (const tk of hebrewTokens) {
  for (const p of tk.parts) {
    const target = isBound(p.strongs) ? bound : lex;
    let e = target.get(p.ck);
    if (!e) target.set(p.ck, e = { key: p.ck, lemma: isBound(p.strongs) ? p.ck : nfc(p.role === 'main' ? tk.l : p.expLemma), n: 0, strongs: new Map(), codes: new Map(), forms: new Map(), tr: new Map(), refs: [], glosses: new Map(), roles: new Map() });
    e.n++;
    e.strongs.set(p.strongs, (e.strongs.get(p.strongs) || 0) + 1);
    e.codes.set(p.code, (e.codes.get(p.code) || 0) + 1);
    e.forms.set(p.form ? formKey(p.form) : '', (e.forms.get(formKey(p.form)) || 0) + 1);
    e.roles.set(p.role, (e.roles.get(p.role) || 0) + 1);
    if (p.expGloss) e.glosses.set(p.expGloss, (e.glosses.get(p.expGloss) || 0) + 1);
    if (p.tr) {
      const k = formKey(p.form) + '\u0000' + p.tr;
      e.tr.set(k, (e.tr.get(k) || 0) + 1);
    }
    e.refs.push([tk.ref, tk.book, tk.ch]);
  }
}
function primaryStrongs(e) {
  const ranked = byCount(e.strongs);
  const own = ranked.find(([s]) => lexicon[s] && formKey(lexicon[s].lemma) === formKey(e.key));
  return (own || ranked[0])[0];
}
const headGloss = g => String(g || '').split(':')[0].trim();
function glossOf(e, primary) {
  if (isBound(primary)) return headGloss((byCount(e.glosses)[0] || [''])[0]) || (lexicon[primary] && lexicon[primary].gloss) || '';
  const out = [];
  const add = g => { g = headGloss(g); if (g && !out.includes(g)) out.push(g); };
  add(lexicon[primary] && lexicon[primary].gloss);
  for (const [s, n] of byCount(e.strongs)) if (s !== primary && n / e.n >= 0.10) add(lexicon[s] && lexicon[s].gloss);
  return out.join('; ');
}
function exampleRefs(refs) {
  const seen = new Set(), list = [];
  refs.forEach(([r, b, c], i) => { if (!seen.has(r)) { seen.add(r); list.push([r, refRank(b, c), i]); } });
  return list.sort((a, b) => a[1] - b[1] || a[2] - b[2]).slice(0, 3).map(x => x[0]);
}
// Transliteration (STEP TAHOT scheme): how the text spells the dictionary form
// where it occurs as it stands, else the lexicon's (lower case, no stress).
function translitOf(e, primary, formWanted) {
  const want = formKey(formWanted);
  const hit = byCount(e.tr).find(([k]) => k.split('\u0000')[0] === want);
  if (hit) return hit[0].split('\u0000')[1];
  if (isBound(primary)) { const any = byCount(e.tr)[0]; return any ? any[0].split('\u0000')[1] : ''; }
  return (lexicon[primary] && lexicon[primary].translit) || '';
}
function makeEntry(e, rank) {
  const strongs = primaryStrongs(e);
  const [code] = byCount(e.codes)[0];
  const desc = describeSeg(code);
  const d = display.entries[e.key] || {};
  const bnd = isBound(strongs);
  const commonForm = (byCount(e.forms)[0] || [''])[0];
  const lexLemma = lexicon[strongs] ? nfc(lexicon[strongs].lemma) : '';
  const shown = nfc(d.displayLemma || (bnd ? commonForm : e.key));
  const entry = {
    rank,
    key: e.key,
    strongs,
    strongsAll: byCount(e.strongs).map(([s]) => s),
    lemma: e.lemma,
    ...(lexLemma && formKey(lexLemma) !== formKey(e.lemma) ? { lexiconLemma: lexLemma } : {}),
    displayLemma: shown,
    ...(d.displayNote ? { displayNote: d.displayNote } : {}),
    translit: translitOf(e, strongs, shown),
    gloss: glossOf(e, strongs),
    ...(d.courseGloss ? { courseGloss: d.courseGloss } : {}),
    partOfSpeech: desc.split(' · ')[0],
    category: categoryOfSeg(code),
    properName: /^Noun · proper/.test(desc),
    ...(bnd ? { bound: byCount(e.roles)[0][0] === 'prefix' ? 'prefix' : 'suffix', forms: byCount(e.forms).slice(0, 4).map(([f, n]) => ({ form: f, n })) } : {}),
    commonMorph: code,
    frequency: e.n,
    exampleRefs: exampleRefs(e.refs),
  };
  return entry;
}
const rankedLex = [...lex.values()].sort((a, b) => b.n - a.n || (a.key < b.key ? -1 : 1));
const vocab = rankedLex.slice(0, VOCAB_SIZE).map((e, i) => makeEntry(e, i + 1));
const top = new Set(vocab.map(v => v.key));
const morphemes = [...bound.values()].sort((a, b) => b.n - a.n || (a.key < b.key ? -1 : 1)).map(e => makeEntry(e, null));
const passageRefs = [];
for (let v = READING.from; v <= READING.to; v++) passageRefs.push(refOf(READING.book, READING.chapter, v));
const passageCount = new Map();
passageRefs.forEach(r => (verseTokens.get(r) || []).forEach(tk => tk.parts.forEach(p => passageCount.set(p.ck, (passageCount.get(p.ck) || 0) + 1))));
const ntRank = new Map(rankedLex.map((e, i) => [e.key, i + 1]));
const supplement = [...passageCount.entries()]
  .filter(([k, n]) => n >= PASSAGE_MIN && lex.has(k) && !top.has(k))
  .sort((a, b) => b[1] - a[1] || ntRank.get(a[0]) - ntRank.get(b[0]))
  .map(([k, n]) => Object.assign(makeEntry(lex.get(k), null), { otRank: ntRank.get(k), passageCount: n }));
const allWords = vocab.concat(supplement, morphemes);
const byStrongs = new Map(), byKey = new Map(allWords.map(w => [w.key, w]));
for (const w of allWords) {
  if (byStrongs.has(w.strongs)) problems.push(`vocab: Strong's ${w.strongs} is the primary number of both ${byStrongs.get(w.strongs).key} and ${w.key}`);
  byStrongs.set(w.strongs, w);
}
for (const k of Object.keys(display.entries)) if (!byKey.has(nfc(k))) problems.push(`display.json: ${k} is not a course word or morpheme`);
for (const k of Object.keys(display.entries)) if (k !== nfc(k)) problems.push(`display.json: key ${k} is not NFC`);
writeJson('vocab.json', {
  source: 'orig/ot + the STEPBible TAHOT morpheme split (Leningrad codex) · glosses orig/lexicon-heb.json (TBESH) · grammar orig/morph-heb.json (TEHMC). CC BY 4.0, STEP Bible (STEPBible.org), based on work at Tyndale House, Cambridge.',
  generatedBy: 'scripts/build-hebrew-course.js',
  note: `Counted by morpheme: prefixes (and, the, in, to, like, from …) and pronoun suffixes are counted on their own (morphemes), never as part of the word they attach to; words are the remaining parts, by dictionary form (key; split by Strong's number for the homographs in splits). Aramaic words (${aramaic}) are left out. lemma = the data's dictionary form; lexiconLemma = the lexicon's where it differs. displayLemma / displayNote / courseGloss come from display.json (course display only). translit = STEP TAHOT scheme (dotted syllables; a capital marks the stressed syllable). All Hebrew NFC. Hebrew words counted: ${hebrewTokens.length}; morphemes: ${hebrewTokens.reduce((a, t) => a + t.parts.length, 0)}.`,
  splits: SPLITS,
  count: vocab.length,
  words: vocab,
  morphemes: { note: 'Bound morphemes, keyed by Strong\'s number (H9xxx): prefixes and pronoun suffixes. forms = the commonest spellings in the text.', count: morphemes.length, words: morphemes },
  passageSupplement: {
    note: `Words of ${READING.book} ${READING.chapter}:${READING.from}–${READING.to} outside the top ${VOCAB_SIZE} that occur there at least ${PASSAGE_MIN} times, most frequent in the passage first. rank is null; otRank = place in the OT frequency list; passageCount = occurrences in the passage.`,
    count: supplement.length,
    words: supplement,
  },
});

// ── indexes for checks ──────────────────────────────────────────────────────
const morphIdx = new Map();   // formKey → Map(ck|segcode → n)
const wordIdx  = new Map();   // formKey → Map(mainck|fullcode → n)
const lemmaForms = new Set();
const add = (idx, key, id) => { let a = idx.get(key); if (!a) idx.set(key, a = new Map()); a.set(id, (a.get(id) || 0) + 1); };
for (const tk of hebrewTokens) {
  const main = tk.parts.find(p => p.role === 'main') || tk.parts[0];
  add(wordIdx, tk.key, main.ck + '\u0000' + tk.parts.map(p => p.code).join('/'));
  for (const p of tk.parts) add(morphIdx, p.key, p.ck + '\u0000' + p.code);
}
for (const e of lex.values()) { lemmaForms.add(formKey(e.key)); lemmaForms.add(formKey(e.lemma)); }
for (const k of Object.keys(lexicon)) lemmaForms.add(formKey(lexicon[k].lemma));
// Hebrew typed in prose must occur in the OT as a word, a morpheme or a
// dictionary form. Runs of one letter (with its points) are skipped.
function checkHebrewProse(text, where) {
  for (const run of String(text || '').replace(/־/g, ' ').match(/[֑-״יִ-ﭏ]+/g) || []) {
    const k = formKey(run);
    if ([...k.normalize('NFD').replace(/[ְ-ׇ]/g, '')].length < 2) continue;
    if (!wordIdx.has(k) && !morphIdx.has(k) && !lemmaForms.has(k)) problems.push(`${where}: "${run}" does not occur in orig/ot`);
  }
}
for (const w of allWords) {
  if (w.displayLemma !== w.key) checkHebrewProse(w.displayLemma, `display ${w.key} displayLemma`);
  checkHebrewProse(w.displayNote, `display ${w.key} note`);
}

// ── 2. lesson plan validation ───────────────────────────────────────────────
const course = readJson(path.join(OUT, 'course.json'));
const taughtIn = new Map();
const lessonIndex = new Map();
course.lessons.forEach((L, i) => {
  if (lessonIndex.has(L.id)) problems.push(`duplicate lesson id ${L.id}`);
  lessonIndex.set(L.id, i);
  if (L.number !== i + 1) problems.push(`${L.id}: number ${L.number}, expected ${i + 1}`);
  for (const p of L.prereqs || []) if (!(lessonIndex.has(p) && lessonIndex.get(p) < i)) problems.push(`${L.id}: prereq ${p} is not an earlier lesson`);
  for (const s of L.vocab || []) {
    const v = byStrongs.get(s);
    if (!v) { problems.push(`${L.id}: ${s} is not in vocab.json`); continue; }
    if (taughtIn.has(v.key)) problems.push(`${L.id}: ${s} already taught in ${taughtIn.get(v.key)}`);
    else taughtIn.set(v.key, L.id);
  }
  for (const r of L.exampleRefs || []) if (!verseTokens.has(r)) problems.push(`${L.id}: exampleRef ${r} not found in orig/ot`);
  checkHebrewProse(L.title, `${L.id} title`);
  (L.goals || []).forEach((g, j) => checkHebrewProse(g, `${L.id} goal ${j + 1}`));
  (L.notes || []).forEach((g, j) => checkHebrewProse(g, `${L.id} note ${j + 1}`));
  (L.recognition || []).forEach((r, j) => checkHebrewProse(r.note, `${L.id} recognition ${j + 1}`));
});
const lexicalAndSupp = vocab.concat(supplement);
const notTaught = lexicalAndSupp.filter(v => !taughtIn.has(v.key));
const morphemesNotTaught = morphemes.filter(v => !taughtIn.has(v.key));
function knownAt(pos) {
  const set = new Set();
  course.lessons.slice(0, pos + 1).forEach(L => (L.vocab || []).forEach(s => { const v = byStrongs.get(s); if (v) set.add(v.key); }));
  return set;
}
const lessonChecks = course.lessons.map((L, i) => {
  const known = knownAt(i);
  return {
    id: L.id, number: L.number, type: L.type, vocabCount: (L.vocab || []).length, knownSoFar: known.size,
    examples: (L.exampleRefs || []).filter(r => verseTokens.has(r)).map(r => {
      const ws = verseTokens.get(r);
      const parts = ws.flatMap(w => w.parts);
      const kp = parts.filter(p => known.has(p.ck)).length;
      const kw = ws.filter(w => w.parts.every(p => known.has(p.ck))).length;
      return { ref: r, words: ws.length, wordsKnown: kw, morphemes: parts.length, morphemesKnown: kp, pct: Math.round(100 * kp / parts.length) };
    }),
  };
});

// ── 3. alphabet ─────────────────────────────────────────────────────────────
const alphabet = readJson(path.join(OUT, 'alphabet.json'));
(function walk(node, where) {
  if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${where}[${i}]`));
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node.examples)) for (const ex of node.examples) {
    const v = byStrongs.get(ex.strongs);
    if (!v) problems.push(`alphabet ${where}: example ${ex.strongs} not in vocab.json`);
    else if (ex.key !== undefined && nfc(ex.key) !== v.key) problems.push(`alphabet ${where}: example key ${ex.key} ≠ vocab ${v.key}`);
    else if (ex.form !== undefined) {
      const k = formKey(ex.form);
      const hits = [...(wordIdx.get(k) || new Map()).keys(), ...(morphIdx.get(k) || new Map()).keys()];
      if (!hits.some(h => h.split('\u0000')[0] === v.key)) problems.push(`alphabet ${where}: form ${ex.form} does not occur in orig/ot as ${v.key}`);
    }
  }
  for (const r of node.exampleRefs || []) if (!verseTokens.has(r)) problems.push(`alphabet ${where}: exampleRef ${r} not found in orig/ot`);
  for (const k of ['note', 'sound', 'soundAlike', 'description', 'noExampleNote', 'rule', 'hatephNote', 'summary']) if (typeof node[k] === 'string') checkHebrewProse(node[k], `alphabet ${where}.${k}`);
  for (const k of Object.keys(node)) if (k !== 'examples' && node[k] && typeof node[k] === 'object') walk(node[k], `${where}.${k}`);
})(alphabet, 'alphabet');

// ── 3b. Hear it clips ───────────────────────────────────────────────────────
// Only the alphabet-table rows (consonants) may carry a "clip". Each id must be
// in courses/sounds.json, and its MP3 must be in public/audio/sounds/ (a real
// MP3, not an HTML error page saved under the name).
(function checkClips() {
  let sounds = [];
  try { sounds = readJson(path.join(ROOT, 'courses', 'sounds.json')).sounds || []; }
  catch (e) { problems.push('courses/sounds.json: ' + e.message); }
  const byId = new Map((Array.isArray(sounds) ? sounds : []).filter(s => s && s.id).map(s => [s.id, s]));
  const rows = new Set(alphabet.consonants || []);
  (function walk(node, where) {
    if (!node || typeof node !== 'object') return;
    if (node.clip !== undefined) {
      if (!rows.has(node)) problems.push(`alphabet ${where}: a clip is only allowed on a consonants row`);
      const s = byId.get(node.clip);
      if (!s) problems.push(`alphabet ${where}: clip ${node.clip} is not in courses/sounds.json`);
      else if (!/^[a-z0-9-]+\.mp3$/.test(s.file || '')) problems.push(`courses/sounds.json ${s.id}: file must be a plain .mp3 name`);
      else {
        const f = path.join(ROOT, 'public', 'audio', 'sounds', s.file);
        let head = null;
        try { const b = fs.readFileSync(f); head = b.length > 3 ? b : null; } catch (e) { /* missing */ }
        if (!head) problems.push(`alphabet ${where}: clip ${node.clip}: public/audio/sounds/${s.file} is missing`);
        else if (!(head.slice(0, 3).toString('latin1') === 'ID3' || (head[0] === 0xFF && (head[1] & 0xE0) === 0xE0))) problems.push(`public/audio/sounds/${s.file} is not an MP3 file`);
      }
    }
    for (const k of Object.keys(node)) if (k !== 'examples' && node[k] && typeof node[k] === 'object') walk(node[k], `${where}.${k}`);
  })(alphabet, 'alphabet');
})();

// ── 4. paradigm check ───────────────────────────────────────────────────────
// A cell is { form, code, parse, cellLabel, scope }. scope "word" compares
// whole words (prefixes and suffixes included: וַיֹּאמֶר), scope "morpheme" one
// part (the article הַ, a verb form without its prefix). parse must be the data's
// own description of code. The paradigm's key is the course key of the main part
// (or the H9xxx number of a bound morpheme).
const fullCode = c => segCodes(c).join('/');
const paradigms = readJson(path.join(OUT, 'paradigms.json'));
const cellResults = [];
for (const P of paradigms.paradigms) {
  checkHebrewProse(P.title, `paradigm ${P.id} title`);
  checkHebrewProse(P.note, `paradigm ${P.id} note`);
  if (!course.lessons.some(L => L.id === P.lessonId && (L.paradigmIds || []).includes(P.id))) problems.push(`paradigm ${P.id}: lesson ${P.lessonId} does not list it`);
  for (const row of P.rows) for (const cell of row.cells) {
    if (!cell || !cell.form) continue;
    const pkey = nfc(cell.key || P.key);
    const scope = cell.scope || P.scope || 'morpheme';
    const code = scope === 'word' ? fullCode(cell.code) : segCodes(cell.code)[0];
    const want = describeCode(cell.code);
    if (cell.parse !== want) problems.push(`paradigm ${P.id} ${cell.cellLabel}: parse "${cell.parse}" is not the data's description of ${cell.code} ("${want}")`);
    const res = { paradigm: P.id, cellLabel: cell.cellLabel, form: cell.form, code: cell.code, parse: cell.parse, scope };
    const hits = (scope === 'word' ? wordIdx : morphIdx).get(formKey(cell.form));
    if (!hits) { res.status = 'unattested'; cellResults.push(res); continue; }
    const seen = [...hits.entries()].map(([id, n]) => { const [k, c] = id.split('\u0000'); return { key: k, code: c, parse: describeCode(c), n }; })
      .sort((a, b) => b.n - a.n || (a.code < b.code ? -1 : 1));
    const same = seen.filter(s => s.key === pkey);
    const match = same.filter(s => s.code === code);
    res.status = match.length ? 'attested-match' : 'attested-other';
    res.occurrences = match.reduce((a, s) => a + s.n, 0);
    res.seenAs = (match.length ? match : (same.length ? same : seen)).slice(0, 6);
    if (!match.length && !same.length) res.otherKey = true;
    cellResults.push(res);
  }
}
const paradigmIds = new Set(paradigms.paradigms.map(P => P.id));
for (const L of course.lessons) for (const id of L.paradigmIds || []) if (!paradigmIds.has(id)) problems.push(`${L.id}: paradigm ${id} not in paradigms.json`);
const tally = { 'attested-match': 0, 'attested-other': 0, unattested: 0 };
cellResults.forEach(c => tally[c.status]++);
writeJson('paradigm-check.json', {
  generatedBy: 'scripts/build-hebrew-course.js',
  rules: {
    'attested-match': 'the form occurs in the OT (as a whole word for scope "word", as one morpheme for scope "morpheme") as the paradigm\'s word with exactly the cell\'s code',
    'attested-other': 'the form occurs, but not as that word with that code (seenAs lists what the data has; otherKey = only as other words) — check these',
    unattested: 'the form does not occur in the OT',
    matching: 'NFC, cantillation, meteg, maqqef, sof pasuq and paragraph letters removed; vowels, dagesh and shin/sin dots kept',
  },
  summary: tally,
  cells: cellResults,
});

// ── 5. grammar coverage of the passage ──────────────────────────────────────
const lessonById = new Map(course.lessons.map(L => [L.id, L]));
const readingLesson = course.lessons.find(L => L.type === 'reading');
const grammarHelpShown = (readingLesson && readingLesson.grammarHelpShown) || [];
const covers = new Map();
const addCover = (cat, id, via) => {
  let a = covers.get(cat); if (!a) covers.set(cat, a = []);
  if (!a.some(x => x.id === id && x.via === via)) a.push({ id, number: lessonById.get(id).number, via });
};
for (const P of paradigms.paradigms) for (const r of P.rows) for (const c of r.cells) if (c && c.code && lessonById.has(P.lessonId)) segCodes(c.code).forEach(sc => addCover(categoryOfSeg(sc), P.lessonId, 'paradigm ' + P.id));
for (const L of course.lessons) {
  for (const r of L.recognition || []) addCover(r.category, L.id, 'recognition note');
  for (const s of L.vocab || []) {
    const v = byStrongs.get(s);
    if (v && v.partOfSpeech !== 'Verb' && v.partOfSpeech !== 'Noun' && v.partOfSpeech !== 'Adjective') addCover(v.category, L.id, 'vocab ' + v.displayLemma);
  }
}
for (const a of covers.values()) a.sort((x, y) => x.number - y.number || (x.via < y.via ? -1 : 1));
const passageCats = new Map();
passageRefs.forEach(ref => (verseTokens.get(ref) || []).forEach(tk => tk.parts.forEach(p => {
  const cat = categoryOfSeg(p.code);
  let e = passageCats.get(cat); if (!e) passageCats.set(cat, e = { category: cat, morphemes: 0, codes: new Set(), refs: new Set() });
  e.morphemes++; e.codes.add(p.code); e.refs.add(ref.replace(READING.book + ' ', ''));
})));
const grammarCoverage = new Map();
for (const e of [...passageCats.values()].sort((a, b) => (a.category < b.category ? -1 : 1))) {
  const lessons = (covers.get(e.category) || []).slice(0, 4);
  const helpShown = grammarHelpShown.includes(e.category);
  grammarCoverage.set(e.category, { category: e.category, morphemes: e.morphemes, codes: [...e.codes].sort(), refs: [...e.refs], lessons, ...(helpShown ? { note: 'help shown' } : {}) });
  if (!lessons.length && !helpShown) problems.push(`grammar: "${e.category}" (${[...e.refs].join(', ')}) is used in the passage but no lesson covers it`);
}
for (const c of grammarHelpShown) if (!passageCats.has(c)) problems.push(`grammarHelpShown: "${c}" does not occur in the passage`);

// ── 6. reading lesson: Genesis 1:1–5, word and morpheme level ───────────────
const verses = [];
const cov = { words: 0, wordsTaught: 0, morphemes: 0, morphemesTaught: 0 };
const itemSeen = new Map();
for (const ref of passageRefs) {
  const ws = verseTokens.get(ref) || [];
  verses.push({
    ref,
    words: ws.map(tk => {
      const parts = tk.parts.map(p => {
        const lid = taughtIn.get(p.ck) || null;
        const cat = categoryOfSeg(p.code);
        const gc = grammarCoverage.get(cat);
        cov.morphemes++; if (lid) cov.morphemesTaught++;
        itemSeen.set(p.ck, { strongs: p.strongs, bound: isBound(p.strongs), lesson: lid, inTop: top.has(p.ck) });
        const o = { form: p.form, strongs: p.strongs, key: p.ck, role: p.role, taught: !!lid, grammar: cat };
        if (lid) { o.lessonId = lid; o.lessonNumber = lessonById.get(lid).number; } else o.note = 'help shown';
        if (gc && gc.lessons.length) o.grammarLesson = gc.lessons[0].id;
        return o;
      });
      const allTaught = parts.every(p => p.taught);
      cov.words++; if (allTaught) cov.wordsTaught++;
      return { index: tk.i, taught: allTaught, ...(allTaught ? {} : { note: 'help shown' }), parts };
    }),
  });
}
const items = [...itemSeen.entries()];
writeJson('reading-gen1.json', {
  generatedBy: 'scripts/build-hebrew-course.js',
  lessonId: readingLesson ? readingLesson.id : null,
  passage: `${READING.book} ${READING.chapter}:${READING.from}–${READING.to}`,
  grammarHelpShown,
  note: 'Word text, transliteration and gloss are read from orig/ot at display time (index = position in the verse\'s word list). parts = TAHOT\'s morphemes in order (form copied from the data by the script, not typed); a word is taught when all its parts are. grammar = the part\'s category; grammarLesson = the first lesson that covers it.',
  coverage: {
    words: cov.words, wordsTaught: cov.wordsTaught,
    morphemes: cov.morphemes, morphemesTaught: cov.morphemesTaught,
    items: items.length, itemsTaught: items.filter(([, x]) => x.lesson).length,
    itemsNotTaught: items.filter(([, x]) => !x.lesson).map(([k, x]) => ({ key: k, strongs: x.strongs, bound: x.bound, inTop250: x.inTop })),
  },
  verses,
});

// ── 7. example verses, morpheme by morpheme (for Phase B) ─────────────────
// Every exampleRef in course.json, then Genesis 1:1–5, each word with its parts
// in order. gloss = the course gloss when the part is a course item, else the
// TAHOT translation of that part in this verse (or of the whole word when
// TAHOT's columns don't line up).
const exampleRefList = [];
course.lessons.forEach(L => (L.exampleRefs || []).forEach(r => { if (!exampleRefList.includes(r)) exampleRefList.push(r); }));
passageRefs.forEach(r => { if (!exampleRefList.includes(r)) exampleRefList.push(r); });
const exampleVerses = {};
for (const ref of exampleRefList) {
  exampleVerses[ref] = (verseTokens.get(ref) || []).map(tk => ({
    index: tk.i,
    form: tk.w,
    parts: tk.parts.map(p => {
      const item = byKey.get(p.ck);
      const dataGloss = p.gl || (tk.parts.length === 1 ? tk.g : headGloss(p.expGloss));
      return {
        form: p.form, strongs: p.strongs, key: p.ck, code: p.code,
        grammar: describeSeg(p.code),
        gloss: item ? (item.courseGloss || item.gloss) : dataGloss,
        taughtIn: taughtIn.get(p.ck) || null,
      };
    }),
  }));
}
writeJson('examples.json', {
  generatedBy: 'scripts/build-hebrew-course.js',
  source: 'STEPBible TAHOT (morpheme split, Leningrad codex), checked word by word against orig/ot; grammar orig/morph-heb.json; glosses vocab.json (course items) or TAHOT. CC BY 4.0, STEP Bible (STEPBible.org), based on work at Tyndale House, Cambridge.',
  note: 'For each verse: its words in order (index = position in orig/ot\'s word list), each with its parts in order: prefix(es), word, suffix(es). form and strongs as in the data; key = the course key; code = the STEP morphology code; grammar = its plain-English description; gloss = courseGloss/gloss for a course item, else the data\'s translation of that part; taughtIn = the lesson that teaches the part, or null. All Hebrew NFC.',
  refs: exampleRefList,
  verses: exampleVerses,
});

writeJson('course-check.json', {
  generatedBy: 'scripts/build-hebrew-course.js',
  problems,
  vocabNotTaught: notTaught.map(v => ({ strongs: v.strongs, key: v.key, rank: v.rank })),
  morphemesNotTaught: morphemesNotTaught.map(v => ({ strongs: v.strongs, displayLemma: v.displayLemma, frequency: v.frequency })),
  grammarCoverage: {
    passage: `${READING.book} ${READING.chapter}:${READING.from}–${READING.to}`,
    rule: 'every morpheme of the passage by category (verbs by stem · conjugation; nouns by state; others by their first two description parts); lessons = the first lessons that cover it (paradigm cell, recognition note, or for particles/prepositions/conjunctions a taught word or morpheme of that category)',
    categories: [...grammarCoverage.values()],
  },
  lessons: lessonChecks,
});

console.log(`Hebrew words: ${hebrewTokens.length} (Aramaic left out: ${aramaic}; unsplit: ${misaligned}) · word keys: ${lex.size} · morphemes: ${bound.size}`);
console.log(`Vocab ${vocab.length} (#1 ${vocab[0].key} ${vocab[0].frequency}, #${VOCAB_SIZE} ${vocab[vocab.length - 1].key} ${vocab[vocab.length - 1].frequency}) + supplement ${supplement.length} + morphemes ${morphemes.length}`);
console.log(`Lessons: ${course.lessons.length} · words taught ${lexicalAndSupp.length - notTaught.length}/${lexicalAndSupp.length} · morphemes taught ${morphemes.length - morphemesNotTaught.length}/${morphemes.length}`);
console.log(`Paradigm cells: ${cellResults.length} · ${JSON.stringify(tally)}`);
console.log(`Grammar categories in the passage: ${grammarCoverage.size} · uncovered: ${[...grammarCoverage.values()].filter(c => !c.lessons.length).length}`);
console.log(`Genesis 1:1–5: words ${cov.wordsTaught}/${cov.words} · morphemes ${cov.morphemesTaught}/${cov.morphemes} · items ${items.filter(([, x]) => x.lesson).length}/${items.length}`);
if (problems.length) { console.error('PROBLEMS:\n  ' + problems.join('\n  ')); process.exitCode = 1; }
if (require.main !== module) module.exports = { tokens, hebrewTokens, verseTokens, formKey, describeCode, segCodes, categoryOfSeg };
