#!/usr/bin/env node
// scripts/build-greek-course.js — data side of the Greek course (Phase A).
//
//   node scripts/build-greek-course.js
//
// Reads the NA27 words built into orig/ (STEPBible TAGNT/TBESG/TEGMC, see
// orig/SOURCES.md) and the hand-written course files, and writes:
//
//   courses/greek/vocab.json           150 most frequent NT lemmas (generated)
//   courses/greek/paradigm-check.json  every paradigm cell checked against orig/nt (generated)
//   courses/greek/reading-1john1.json  1 John 1:1–10, word by word: taught yet? where? (generated)
//   courses/greek/course-check.json    lesson-plan validation + example-verse coverage (generated)
//
// Hand-written inputs (never touched by this script):
//   courses/greek/course.json, alphabet.json, paradigms.json
//
// Node built-ins only. Deterministic: same orig/ + same inputs → byte-identical
// output (no timestamps; every sort has a full tie-break). Exits non-zero if the
// lesson plan or alphabet refers to anything the data doesn't back up.
//
// The layout is language-neutral on purpose: a Hebrew course would sit in
// courses/hebrew/ with the same files, read orig/ot + lexicon-heb + morph-heb.

'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ORIG = path.join(ROOT, 'orig');
const OUT = path.join(ROOT, 'courses', 'greek');
const VOCAB_SIZE = 150;
const READING = { book: '1 John', chapter: 1, from: 1, to: 10 };

const NT_BOOKS = ['Matthew', 'Mark', 'Luke', 'John', 'Acts', 'Romans', '1 Corinthians',
  '2 Corinthians', 'Galatians', 'Ephesians', 'Philippians', 'Colossians',
  '1 Thessalonians', '2 Thessalonians', '1 Timothy', '2 Timothy', 'Titus', 'Philemon',
  'Hebrews', 'James', '1 Peter', '2 Peter', '1 John', '2 John', '3 John', 'Jude', 'Revelation'];
// exampleRefs preference: 1 John first, then John, then canonical order.
const PREFERRED = ['1 John', 'John'];

// ── text helpers ────────────────────────────────────────────────────────────
// The STEP data mixes Unicode forms (oxia U+1F79 vs tonos U+03CC), so every
// comparison goes through NFC. Output lemmas are NFC too.
const nfc = s => String(s).normalize('NFC');
// Word as printed → comparable form: NFC, no trailing punctuation, no elision
// mark, grave accent read as acute (a grave is just an acute before another word).
function formKey(s) {
  return nfc(String(s).normalize('NFD')
    .replace(/[̀]/g, '́')
    .replace(/[᾽᾿ʼ’'᾽·.,;:·;!?⸀⸂⸃\[\]()]+$/g, '')
    .replace(/^[\[\]()⸀⸂⸃]+/, '')).toLowerCase();
}
// Accent-blind form (breathings, iota subscript and diaeresis kept) — the second
// try for enclitics such as ἐστίν / ἐστιν, which the text often leaves unaccented.
function bareKey(s) {
  return nfc(formKey(s).normalize('NFD').replace(/[́͂]/g, ''));
}
const refOf = (book, ch, v) => `${book} ${ch}:${v}`;

// STEP's transliteration scheme, as the TAGNT `t` field spells words (this
// function reproduces the data's own spelling for 99.4% of NT words; the rest
// are words where the data drops a rough breathing written together with an
// accent — ἵνα "ina", αἵματος "aimatos"). Letters: α a · β b · γ g (γγ ng; γκ gk,
// γχ gch kept) · δ d · ε e · ζ z · η ē · θ th · ι i · κ k · λ l · μ m · ν n · ξ x ·
// ο o · π p · ρ r (initial rh) · σ/ς s · τ t · υ u · φ ph · χ ch · ψ ps · ω ō.
// Rough breathing = h (before the whole diphthong: οὗτος houtos); smooth
// breathing, accents and iota subscript are not written; after an initial
// h-vowel that does not form a diphthong with the next vowel an apostrophe marks
// the break (ἑαυτοῦ he'autou, ἑωράκαμεν he'ōrakamen).
const TR = { α: 'a', β: 'b', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'ē', θ: 'th', ι: 'i', κ: 'k', λ: 'l', μ: 'm', ν: 'n', ξ: 'x', ο: 'o', π: 'p', ρ: 'r', σ: 's', ς: 's', τ: 't', υ: 'u', φ: 'ph', χ: 'ch', ψ: 'ps', ω: 'ō' };
const VOWELS = 'αεηιουω';
const DIPHTHONGS = ['αι', 'ει', 'οι', 'υι', 'αυ', 'ευ', 'ηυ', 'ου'];
function translit(word) {
  const d = String(word).normalize('NFD').replace(/[᾽᾿ʼ’'᾽·.,;:!?·;⸀⸂⸃\[\]()]/g, '');
  const ch = [];
  for (const c of d) {
    if (/[̀-ͯ]/.test(c)) { if (ch.length) ch[ch.length - 1].m += c; }
    else ch.push({ c: c.toLowerCase(), up: c !== c.toLowerCase(), m: '' });
  }
  let out = '';
  for (let i = 0; i < ch.length; i++) {
    const { c, m, up } = ch[i];
    let s = TR[c];
    if (s === undefined) { out += c; continue; }
    if (c === 'γ' && ch[i + 1] && ch[i + 1].c === 'γ') s = 'n';
    let pre = '';
    const rough = m.includes('̔');
    if (rough && c !== 'ρ' && !(i === 1 && DIPHTHONGS.includes(ch[0].c + c))) pre = 'h';
    if (i === 0 && ch[1] && DIPHTHONGS.includes(c + ch[1].c) && ch[1].m.includes('̔')) pre = 'h';
    if (c === 'ρ' && (rough || i === 0)) s = 'rh';
    let piece = pre + s;
    if (up) piece = piece[0].toUpperCase() + piece.slice(1);
    out += piece;
    if (i === 0 && pre && VOWELS.includes(c) && ch[1] && VOWELS.includes(ch[1].c) && !DIPHTHONGS.includes(c + ch[1].c)) out += "'";
  }
  return out;
}

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function writeJson(name, obj) {
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

// ── load orig/ ──────────────────────────────────────────────────────────────
const lexicon = readJson(path.join(ORIG, 'lexicon-grk.json'));
const morph = readJson(path.join(ORIG, 'morph-grk.json'));
const describe = code => morph[code] || code;

const tokens = [];              // canonical order
const verseTokens = new Map();  // ref → tokens
for (const book of NT_BOOKS) {
  const data = readJson(path.join(ORIG, 'nt', book.replace(/ /g, '_') + '.json'));
  const chs = Object.keys(data).map(Number).sort((a, b) => a - b);
  for (const ch of chs) {
    const vs = Object.keys(data[ch]).map(Number).sort((a, b) => a - b);
    for (const v of vs) {
      const ref = refOf(book, ch, v);
      const list = data[ch][v].map((w, i) => ({
        book, ch, v, ref, i, w: w.w, t: w.t, s: w.s, m: w.m, l: nfc(w.l), varies: !!w.v,
      }));
      verseTokens.set(ref, list);
      tokens.push(...list);
    }
  }
}

// ── 1. vocabulary ───────────────────────────────────────────────────────────
// Counted by dictionary form (the data's lemma). STEP splits some lemmas over
// several disambiguated Strong's numbers (ἐγώ = G1473 + G3165 for the oblique
// forms; εἴδω = G1492H/I "see/know" + G6063 οἶδα), so the lemma is the unit and
// every Strong's number under it is listed in strongsAll; `strongs` is the one
// the lexicon files under this lemma (else the commonest).
const lemmas = new Map();
for (const tk of tokens) {
  let e = lemmas.get(tk.l);
  if (!e) lemmas.set(tk.l, e = { lemma: tk.l, n: 0, strongs: new Map(), morph: new Map(), refs: [], translit: new Map() });
  e.n++;
  e.strongs.set(tk.s, (e.strongs.get(tk.s) || 0) + 1);
  e.morph.set(tk.m, (e.morph.get(tk.m) || 0) + 1);
  e.refs.push(tk.ref);
  // translit of the dictionary form as the text itself spells it (when it occurs)
  if (formKey(tk.w) === formKey(tk.l.split(',')[0])) e.translit.set(tk.t, (e.translit.get(tk.t) || 0) + 1);
}
const byCount = m => [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

function primaryStrongs(e) {
  const ranked = byCount(e.strongs);
  const head = e.lemma.split(',')[0].trim();
  const own = ranked.find(([s]) => lexicon[s] && nfc(lexicon[s].lemma) === head);
  return (own || ranked[0])[0];
}
// Gloss: the lexicon gloss of the primary number with the sense-split suffix cut
// ("to perceive: see" → "to perceive"); other numbers carrying ≥10% of the
// occurrences add their own gloss when it differs ("to perceive; to know").
function glossOf(e, primary) {
  const head = g => String(g || '').split(':')[0].trim();
  const out = [];
  const add = g => { g = head(g); if (g && !out.includes(g)) out.push(g); };
  add(lexicon[primary] && lexicon[primary].gloss);
  for (const [s, n] of byCount(e.strongs)) if (s !== primary && n / e.n >= 0.10) add(lexicon[s] && lexicon[s].gloss);
  return out.join('; ');
}
function posOf(e) {
  const [code] = byCount(e.morph)[0];
  const d = describe(code);
  const pos = d.split(' · ')[0];
  const name = (d.match(/name: ([a-z ]+)/) || [])[1] || null;   // individual / location / title / …
  return { pos, name, code };
}
function exampleRefs(refs) {
  const uniq = [...new Set(refs)];
  const rank = r => { const b = r.replace(/ \d+:\d+$/, ''); const p = PREFERRED.indexOf(b); return p < 0 ? PREFERRED.length : p; };
  // stable: refs are already canonical, sort only by preference bucket
  return uniq.map((r, i) => [r, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).slice(0, 3).map(x => x[0]);
}

const ranked = [...lemmas.values()].sort((a, b) => b.n - a.n || (a.lemma < b.lemma ? -1 : 1));
const vocab = ranked.slice(0, VOCAB_SIZE).map((e, idx) => {
  const strongs = primaryStrongs(e);
  const { pos, name, code } = posOf(e);
  // translit: the STEP scheme applied to the dictionary form; translitInText is
  // how the TAGNT text itself spells that form when the two differ.
  const tl = byCount(e.translit)[0];
  const mine = e.lemma.split(',').map(x => translit(x.trim())).join(', ');
  const entry = {
    rank: idx + 1,
    strongs,
    strongsAll: byCount(e.strongs).map(([s]) => s),
    lemma: e.lemma,
    translit: mine,
    gloss: glossOf(e, strongs),
    partOfSpeech: pos,
    properName: name === 'individual' || name === 'location' || /gentilic/.test(name || ''),
    nameType: name,
    commonMorph: code,
    frequency: e.n,
    exampleRefs: exampleRefs(e.refs),
  };
  if (tl && tl[0] !== mine.split(', ')[0]) entry.translitInText = tl[0];
  return entry;
});
const vocabByStrongs = new Map(vocab.map(v => [v.strongs, v]));
const vocabByLemma = new Map(vocab.map(v => [v.lemma, v]));
writeJson('vocab.json', {
  source: 'orig/nt (STEPBible TAGNT, NA27 words) · glosses orig/lexicon-grk.json (TBESG) · parts of speech orig/morph-grk.json (TEGMC). CC BY 4.0, STEP Bible (STEPBible.org), based on work at Tyndale House, Cambridge.',
  generatedBy: 'scripts/build-greek-course.js',
  note: 'Counted by dictionary form (lemma). strongs = the lexicon entry for that lemma; strongsAll = every disambiguated Strong\'s number the data files under it. Lemmas are Unicode NFC. Total NT words counted: ' + tokens.length + '.',
  count: vocab.length,
  words: vocab,
});

// ── 2. lesson plan validation ───────────────────────────────────────────────
const problems = [];
const course = readJson(path.join(OUT, 'course.json'));
const taughtIn = new Map();      // lemma → lesson id
const lessonIndex = new Map();
course.lessons.forEach((L, i) => {
  if (lessonIndex.has(L.id)) problems.push(`duplicate lesson id ${L.id}`);
  lessonIndex.set(L.id, i);
  if (L.number !== i + 1) problems.push(`${L.id}: number ${L.number}, expected ${i + 1}`);
  for (const p of L.prereqs || []) if (!(lessonIndex.has(p) && lessonIndex.get(p) < i)) problems.push(`${L.id}: prereq ${p} is not an earlier lesson`);
  for (const s of L.vocab || []) {
    const v = vocabByStrongs.get(s);
    if (!v) { problems.push(`${L.id}: ${s} is not in vocab.json`); continue; }
    if (taughtIn.has(v.lemma)) problems.push(`${L.id}: ${s} already taught in ${taughtIn.get(v.lemma)}`);
    else taughtIn.set(v.lemma, L.id);
  }
  for (const r of L.exampleRefs || []) if (!verseTokens.has(r)) problems.push(`${L.id}: exampleRef ${r} not found in orig/nt`);
});
const notTaught = vocab.filter(v => !taughtIn.has(v.lemma));
// Example-verse coverage: share of each verse's words whose lemma is taught by
// the end of that lesson (the lesson's own words count).
function knownAt(lessonPos) {
  const set = new Set();
  course.lessons.slice(0, lessonPos + 1).forEach(L => (L.vocab || []).forEach(s => { const v = vocabByStrongs.get(s); if (v) set.add(v.lemma); }));
  return set;
}
const lessonChecks = course.lessons.map((L, i) => {
  const known = knownAt(i);
  return {
    id: L.id, number: L.number, type: L.type, vocabCount: (L.vocab || []).length,
    knownLemmasSoFar: known.size,
    examples: (L.exampleRefs || []).filter(r => verseTokens.has(r)).map(r => {
      const ws = verseTokens.get(r);
      const k = ws.filter(w => known.has(w.l)).length;
      return { ref: r, words: ws.length, known: k, pct: Math.round(100 * k / ws.length) };
    }),
  };
});

// ── 3. alphabet: example words must come from vocab.json ────────────────────
const alphabet = readJson(path.join(OUT, 'alphabet.json'));
(function walk(node, where) {
  if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${where}[${i}]`));
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node.examples)) for (const ex of node.examples) {
    const v = vocabByStrongs.get(ex.strongs);
    if (!v) problems.push(`alphabet ${where}: example ${ex.strongs} not in vocab.json`);
    else if (ex.lemma !== undefined && nfc(ex.lemma) !== v.lemma) problems.push(`alphabet ${where}: example lemma ${ex.lemma} ≠ vocab ${v.lemma}`);
    else if (ex.form !== undefined && !tokens.some(tk => tk.l === v.lemma && nfc(tk.w).replace(/[·;·;]+$/, '') === nfc(ex.form)))
      problems.push(`alphabet ${where}: form ${ex.form} does not occur in orig/nt under ${v.lemma}`);
  }
  for (const r of node.exampleRefs || []) if (!verseTokens.has(r)) problems.push(`alphabet ${where}: exampleRef ${r} not found in orig/nt`);
  for (const k of Object.keys(node)) if (k !== 'examples') walk(node[k], `${where}.${k}`);
})(alphabet, 'alphabet');

writeJson('course-check.json', {
  generatedBy: 'scripts/build-greek-course.js',
  problems,
  vocabNotTaught: notTaught.map(v => ({ strongs: v.strongs, lemma: v.lemma, rank: v.rank })),
  lessons: lessonChecks,
});

// ── 4. paradigm check ───────────────────────────────────────────────────────
// Index: formKey → [{lemma, code}] and bareKey → same.
const formIdx = new Map(), bareIdx = new Map();
for (const tk of tokens) {
  for (const [idx, key] of [[formIdx, formKey(tk.w)], [bareIdx, bareKey(tk.w)]]) {
    let a = idx.get(key); if (!a) idx.set(key, a = new Map());
    const k = tk.l + '\u0000' + tk.m;
    a.set(k, (a.get(k) || 0) + 1);
  }
}
// "λύουσι(ν)" → ["λύουσι", "λύουσιν"]; "ἐστί(ν)" likewise.
const variants = f => /\(ν\)/.test(f) ? [f.replace('(ν)', ''), f.replace('(ν)', 'ν')] : [f];
// Data descriptions may carry name/title tags the table doesn't (θεός is
// "· name: title"); those are dropped before comparing.
const plain = d => d.replace(/ · (name: [^·]+|title [^·]+)$/, '').trim();

const lemmaForms = new Set([...lemmas.keys()].flatMap(l => l.split(',').map(x => formKey(x.trim()))));
// Greek words typed in titles/notes (not cells) must occur in the NT as a word or a lemma,
// so a typo can't slip into prose the check otherwise wouldn't see.
function checkGreekProse(text, where) {
  for (const word of String(text || '').match(/[Ͱ-Ͽἀ-῿]+/g) || []) {
    if ([...word.normalize('NFD').replace(/[̀-ͯ]/g, '')].length < 3) continue;   // letters / endings
    if (!formIdx.has(formKey(word)) && !bareIdx.has(bareKey(word)) && !lemmaForms.has(formKey(word))) problems.push(`${where}: "${word}" does not occur in orig/nt`);
  }
}
const paradigms = readJson(path.join(OUT, 'paradigms.json'));
const cellResults = [];
for (const P of paradigms.paradigms) {
  checkGreekProse(P.title, `paradigm ${P.id} title`);
  checkGreekProse(P.note, `paradigm ${P.id} note`);
  if (!course.lessons.some(L => L.id === P.lessonId && (L.paradigmIds || []).includes(P.id))) problems.push(`paradigm ${P.id}: lesson ${P.lessonId} does not list it`);
  const lemma = nfc(P.lemma);
  for (const row of P.rows) for (const cell of row.cells) {
    if (!cell || !cell.form) continue;
    const res = { paradigm: P.id, cellLabel: cell.cellLabel, form: cell.form, parse: cell.parse };
    let best = null;
    for (const f of variants(cell.form)) {
      for (const [idx, key, how] of [[formIdx, formKey(f), 'exact'], [bareIdx, bareKey(f), 'ignoring accents']]) {
        const hits = idx.get(key);
        if (!hits) continue;
        const seen = [...hits.entries()].map(([k, n]) => { const [l, code] = k.split('\u0000'); return { lemma: l, code, parse: describe(code), n }; })
          .sort((a, b) => b.n - a.n || (a.code < b.code ? -1 : 1));
        const sameLemma = seen.filter(s => s.lemma === lemma);
        const match = sameLemma.filter(s => plain(s.parse) === cell.parse);
        let status;
        if (match.length) status = 'attested-match';
        else status = 'attested-other';
        const cand = { status, matchedForm: f, how, occurrences: match.reduce((a, s) => a + s.n, 0),
          seenAs: (match.length ? match : (sameLemma.length ? sameLemma : seen)).slice(0, 6).map(s => ({ lemma: s.lemma, code: s.code, parse: s.parse, n: s.n })),
          otherLemma: !match.length && !sameLemma.length };
        const score = c => (c.status === 'attested-match' ? 4 : 2) + (c.how === 'exact' ? 1 : 0) - (c.otherLemma ? 1 : 0);
        if (!best || score(cand) > score(best)) best = cand;
      }
    }
    if (!best) Object.assign(res, { status: 'unattested' });
    else Object.assign(res, best);
    cellResults.push(res);
  }
}
const paradigmIds = new Set(paradigms.paradigms.map(P => P.id));
for (const L of course.lessons) for (const id of L.paradigmIds || []) if (!paradigmIds.has(id)) problems.push(`${L.id}: paradigm ${id} not in paradigms.json`);
// alphabet prose + each letter's transliteration against the scheme above
(function walkText(node, where) {
  if (Array.isArray(node)) return node.forEach((n, i) => walkText(n, `${where}[${i}]`));
  if (!node || typeof node !== 'object') return;
  for (const k of ['note', 'sound', 'soundAlike', 'description']) if (typeof node[k] === 'string') checkGreekProse(node[k], `${where}.${k}`);
  for (const k of Object.keys(node)) if (node[k] && typeof node[k] === 'object') walkText(node[k], `${where}.${k}`);
})(alphabet, 'alphabet');
for (const L of alphabet.letters || []) {
  for (const f of [L.small, L.capital, L.finalSmall].filter(Boolean)) {
    const got = translit('α' + f.toLowerCase()).slice(1);   // mid-word value (initial ρ is rh)
    if (got !== String(L.translit).toLowerCase()) problems.push(`alphabet ${L.name}: translit "${L.translit}" but the scheme gives "${got}" for ${f}`);
  }
}

const tally = { 'attested-match': 0, 'attested-other': 0, unattested: 0 };
cellResults.forEach(c => tally[c.status]++);
writeJson('paradigm-check.json', {
  generatedBy: 'scripts/build-greek-course.js',
  rules: {
    'attested-match': 'the form occurs in orig/nt under the paradigm\'s lemma with a morph code whose description (minus any "name:" tag) equals the cell\'s parse',
    'attested-other': 'the form occurs, but not with that lemma + parse (seenAs lists what the data has; otherLemma = only under other lemmas) — check these',
    unattested: 'the form does not occur in the NT',
    matching: 'forms compared in Unicode NFC with grave read as acute and punctuation/elision marks dropped; if no exact hit, retried ignoring accents (how = "ignoring accents"); "(ν)" = movable nu, both spellings tried',
  },
  summary: tally,
  cells: cellResults,
});

// ── 5. reading lesson: 1 John 1:1–10 ────────────────────────────────────────
const lessonById = new Map(course.lessons.map(L => [L.id, L]));
const readingLesson = course.lessons.find(L => L.type === 'reading');
const verses = [];
let tokTotal = 0, tokTaught = 0, tokTop = 0;
const lemmaSeen = new Map();
for (let v = READING.from; v <= READING.to; v++) {
  const ref = refOf(READING.book, READING.chapter, v);
  const ws = verseTokens.get(ref) || [];
  verses.push({
    ref,
    words: ws.map(w => {
      const voc = vocabByLemma.get(w.l);
      const lid = taughtIn.get(w.l) || null;
      tokTotal++; if (lid) tokTaught++; if (voc) tokTop++;
      lemmaSeen.set(w.l, { strongs: w.s, inVocab: !!voc, lesson: lid });
      const out = { index: w.i, strongs: w.s, lemma: w.l, taught: !!lid };
      if (lid) { out.lessonId = lid; out.lessonNumber = lessonById.get(lid).number; }
      else out.note = 'help shown';
      if (voc) out.vocabRank = voc.rank;
      return out;
    }),
  });
}
const lemList = [...lemmaSeen.entries()];
writeJson('reading-1john1.json', {
  generatedBy: 'scripts/build-greek-course.js',
  lessonId: readingLesson ? readingLesson.id : null,
  passage: `${READING.book} ${READING.chapter}:${READING.from}–${READING.to}`,
  note: 'Word text, transliteration and gloss are read from orig/ at display time (index = position in the verse\'s word list). lemma here is copied from orig/ by the script, not typed.',
  coverage: {
    tokens: tokTotal,
    tokensTaught: tokTaught,
    tokensInTop150: tokTop,
    lemmas: lemList.length,
    lemmasTaught: lemList.filter(([, x]) => x.lesson).length,
    lemmasInTop150: lemList.filter(([, x]) => x.inVocab).length,
    lemmasNotTaught: lemList.filter(([, x]) => !x.lesson).map(([l, x]) => ({ lemma: l, strongs: x.strongs, inVocab: x.inVocab })),
  },
  verses,
});

// ── console summary ─────────────────────────────────────────────────────────
console.log(`NT words: ${tokens.length} · lemmas: ${lemmas.size} · vocab: ${vocab.length} (top lemma ${vocab[0].lemma} ${vocab[0].frequency}, #150 ${vocab[vocab.length - 1].lemma} ${vocab[vocab.length - 1].frequency})`);
console.log(`Lessons: ${course.lessons.length} · vocab taught: ${taughtIn.size}/${vocab.length}`);
console.log(`Paradigm cells: ${cellResults.length} · ${JSON.stringify(tally)}`);
console.log(`1 John 1:1–10: tokens ${tokTaught}/${tokTotal} taught, ${tokTop} in top 150 · lemmas ${lemList.filter(([, x]) => x.lesson).length}/${lemList.length} taught`);
if (problems.length) { console.error('PROBLEMS:\n  ' + problems.join('\n  ')); process.exitCode = 1; }
