// ─── Languages: original-language reading courses ─────────────────────────────
// Course data (courses/<id>/, built by scripts/build-greek-course.js) + the
// original-language text (orig/, lib/original.js) → everything the Languages
// pages and the lesson teacher need. Nothing here comes from the AI: every
// Greek word a learner or the teacher sees is read from those files.
//
// A course is registered in COURSES. A Hebrew course drops in as another entry
// with the same files in courses/hebrew/ (course.json, vocab.json,
// paradigms.json, alphabet.json, a reading file) and its own teacher prompt.
//
// Member data lives in two JSON stores (lib/jsonStore.js — fail closed, atomic
// writes, one write at a time):
//   data/lang_sessions.json  one saved teacher conversation per (userId, course, lessonId)
//   data/lang_progress.json  one record per (userId, course): lessons + vocabulary review

const fs   = require('fs');
const path = require('path');
const original = require('./original');
const { parseReference } = require('./asv');
const { createJsonStore } = require('./jsonStore');

const ROOT = path.join(__dirname, '..');
const nfc  = s => String(s == null ? '' : s).normalize('NFC');

const COURSES = {
  greek: {
    id: 'greek', status: 'open',
    name: 'Greek', title: 'Greek: read the New Testament',
    blurb: 'From the alphabet to reading 1 John 1 in Greek, one short lesson at a time.',
    dir: path.join(ROOT, 'courses', 'greek'),
    lang: 'grc', direction: 'ltr', languageName: 'Greek',
    promptKey: 'IRON_INK_GREEK_TEACHER_PROMPT',
    credit: 'Greek data: STEP Bible (STEPBible.org), based on work at Tyndale House, Cambridge. CC BY 4.0.',
  },
  hebrew: {
    id: 'hebrew', status: 'soon',
    name: 'Hebrew', title: 'Hebrew: read the Old Testament',
    blurb: 'Coming soon.',
  },
};
const COURSE_ORDER = ['greek', 'hebrew'];

const TYPE_LABELS = { alphabet: 'Alphabet', vocab: 'Vocabulary', grammar: 'Grammar', reading: 'Reading' };

// Review boxes: "I knew it" moves a word up one box; its next review is this
// many days later (box 5 stays at 35).
const BOX_DAYS = [1, 3, 7, 16, 35];
const MAX_BOX  = BOX_DAYS.length;

// ── Course data (loaded once per process; it changes only with a deploy) ──────
const courseCache = new Map();

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

function getCourse(id) {
  const def = Object.prototype.hasOwnProperty.call(COURSES, id) ? COURSES[id] : null;
  if (!def || def.status !== 'open') return null;
  if (courseCache.has(id)) return courseCache.get(id);
  let c;
  try {
    const course    = readJson(path.join(def.dir, 'course.json'));
    const files     = course.files || {};
    const vocab     = readJson(path.join(def.dir, files.vocab || 'vocab.json'));
    const paradigms = readJson(path.join(def.dir, files.paradigms || 'paradigms.json'));
    const alphabet  = readJson(path.join(def.dir, files.alphabet || 'alphabet.json'));
    const reading   = files.reading ? readJson(path.join(def.dir, files.reading)) : null;
    const words = (vocab.words || []).concat((vocab.passageSupplement && vocab.passageSupplement.words) || []);
    const byStrongs = new Map(words.map(w => [w.strongs, w]));
    const byKey     = new Map(words.map(w => [nfc(w.key), w]));
    const lessons   = course.lessons || [];
    const lessonById = new Map(lessons.map((L, i) => [L.id, Object.assign({ index: i }, L)]));
    // key → the lesson that teaches it
    const taughtIn = new Map();
    lessons.forEach(L => (L.vocab || []).forEach(s => { const w = byStrongs.get(s); if (w) taughtIn.set(nfc(w.key), L.id); }));
    c = {
      def, course, vocab, paradigms, alphabet, reading, words, byStrongs, byKey, lessons, lessonById, taughtIn,
      splits: vocab.splits || {},
      paradigmById: new Map((paradigms.paradigms || []).map(p => [p.id, p])),
    };
  } catch (err) {
    console.error('[languages] course ' + id + ' could not be loaded:', err.message);
    return null;
  }
  courseCache.set(id, c);
  return c;
}

function getLesson(c, lessonId) {
  return (c && typeof lessonId === 'string' && c.lessonById.get(lessonId)) || null;
}

// The course's word key for an orig/ word: its data lemma, except where the
// course splits one data lemma into two words by Strong's number.
function keyOf(c, lemma, strongs) {
  const l = nfc(lemma);
  const split = c.splits[l];
  return nfc((split && split[strongs]) || l);
}

// Keys taught in lessons 1..(index of lessonId), inclusive.
function taughtKeysThrough(c, lessonId) {
  const L = getLesson(c, lessonId);
  const set = new Set();
  if (!L) return set;
  c.lessons.slice(0, L.index + 1).forEach(x => (x.vocab || []).forEach(s => { const w = c.byStrongs.get(s); if (w) set.add(nfc(w.key)); }));
  return set;
}

// "occurs 2,000+ times" — rounded down to a round number.
function freqText(n) {
  n = Number(n) || 0;
  if (n < 10) return 'occurs ' + n + (n === 1 ? ' time' : ' times');
  const step = n >= 1000 ? 1000 : n >= 100 ? 100 : 10;
  const r = Math.floor(n / step) * step;
  return 'occurs ' + r.toLocaleString('en-US') + '+ times';
}

// What a learner sees for a course word.
function wordView(w) {
  return {
    key:       nfc(w.key),
    strongs:   w.strongs,
    display:   nfc(w.displayLemma || w.lemma),
    lemma:     nfc(w.lemma),
    translit:  w.displayTranslit || w.translit || '',
    gloss:     w.courseGloss || w.gloss || '',
    note:      w.displayNote || '',
    freq:      w.frequency || 0,
    freqText:  freqText(w.frequency),
    exampleRef: (w.exampleRefs && w.exampleRefs[0]) || '',
    partOfSpeech: w.partOfSpeech || '',
  };
}

function lessonSummary(c, L) {
  return {
    id: L.id, number: L.number, title: L.title, type: L.type,
    typeLabel: TYPE_LABELS[L.type] || L.type,
    prereqs: (L.prereqs || []).map(id => c.lessonById.get(id)).filter(Boolean).map(p => p.number),
  };
}

// ── Verses, word by word, from orig/ ──────────────────────────────────────────
function lookupRef(ref) {
  const p = parseReference(String(ref || ''));
  if (!p) return null;
  const verses = p.verseEnd > p.verseStart ? p.verseStart + '-' + p.verseEnd : String(p.verseStart);
  const r = original.lookup(p.book, p.chapter, verses);
  return r.status === 200 ? r.body : null;
}

// Each word gets `learned` (its key is taught in this or an earlier lesson).
// Words are NFC-normalized here so every later comparison is like for like.
function versesWithLearned(c, refs, known) {
  const out = [];
  for (const ref of refs) {
    const body = lookupRef(ref);
    if (!body) continue;
    body.verses.forEach(v => v.words.forEach(w => {
      w.w = nfc(w.w); w.l = nfc(w.l);
      w.key = keyOf(c, w.l, w.s);
      w.learned = known.has(w.key);
    }));
    out.push({ ref, data: body });
  }
  return out;
}

// ── Lesson materials (the left pane) ──────────────────────────────────────────
// For an alphabet lesson, course.json says which parts of alphabet.json it
// needs: { letters: [from, to], parts: ['diphthongs', …] }.
function exampleWord(c, ex) {
  const w = ex && c.byStrongs.get(ex.strongs);
  if (!w) return null;
  const v = wordView(w);
  return { display: ex.form ? nfc(ex.form) : v.display, translit: v.translit, gloss: v.gloss, isForm: !!ex.form, lemma: v.display };
}
function alphabetFor(c, L) {
  const sel = L.alphabetSections;
  if (!sel) return null;
  const A = c.alphabet;
  const mapEx = list => (list || []).map(ex => exampleWord(c, ex)).filter(Boolean);
  const out = { pronunciation: A.pronunciation || '' };
  if (Array.isArray(sel.letters)) {
    const [a, b] = sel.letters;
    out.letters = (A.letters || []).filter(x => x.order >= a && x.order <= b).map(x => ({
      order: x.order, name: x.name, capital: x.capital, small: x.small, finalSmall: x.finalSmall || '',
      translit: x.translit, sound: x.sound, soundAlike: x.soundAlike,
      examples: mapEx(x.examples), exampleRefs: x.exampleRefs || [], note: x.noExampleNote || '',
    }));
    out.transliteration = A.transliteration ? A.transliteration.summary : '';
  }
  const parts = sel.parts || [];
  if (parts.includes('diphthongs')) out.diphthongs = (A.diphthongs || []).map(d => ({ letters: d.letters, translit: d.translit, sound: d.sound, examples: mapEx(d.examples), note: d.noExampleNote || '' }));
  if (parts.includes('breathings')) out.breathings = (A.breathings || []).map(b => ({ name: b.name, mark: b.mark || '', description: b.description, examples: mapEx(b.examples) }));
  if (parts.includes('iotaSubscript') && A.iotaSubscript) out.iotaSubscript = { letters: A.iotaSubscript.letters, description: A.iotaSubscript.description, examples: mapEx(A.iotaSubscript.examples) };
  if (parts.includes('accents') && A.accents) {
    out.accents = {
      description: A.accents.description,
      marks: (A.accents.marks || []).map(m => ({ name: m.name, mark: m.mark, description: m.description, examples: mapEx(m.examples) })),
      extra: [A.accents.accentPair, A.accents.enclitics].filter(Boolean).map(x => ({ description: x.description, examples: mapEx(x.examples) })),
    };
  }
  if (parts.includes('otherMarks')) out.otherMarks = (A.otherMarks || []).map(m => ({ name: m.name, mark: m.mark || '', description: m.description, examples: mapEx(m.examples), note: m.noExampleNote || '' }));
  if (parts.includes('punctuation')) { out.punctuation = (A.punctuation || []).map(p => ({ mark: p.mark, name: p.name, meaning: p.meaning })); out.punctuationNote = A.punctuationNote || ''; }
  // Verse refs used by this lesson's alphabet parts (shown word by word below).
  return out;
}

function paradigmView(P) {
  return {
    id: P.id, title: P.title, note: P.note || '', columns: P.columns || [],
    rows: (P.rows || []).map(r => ({ label: r.label, cells: (r.cells || []).map(x => ({ form: nfc(x.form), cellLabel: x.cellLabel, parse: x.parse })) })),
  };
}

function lessonMaterials(courseId, lessonId) {
  const c = getCourse(courseId);
  const L = getLesson(c, lessonId);
  if (!L) return null;
  const known = taughtKeysThrough(c, lessonId);
  const m = {
    course: { id: c.def.id, name: c.def.name, lang: c.def.lang, direction: c.def.direction, credit: c.def.credit },
    lesson: Object.assign(lessonSummary(c, L), {
      goals: L.goals || [], notes: L.notes || [], grammarTopic: L.grammarTopic || '',
      recognition: (L.recognition || []).map(r => r.note),
    }),
    words: (L.vocab || []).map(s => c.byStrongs.get(s)).filter(Boolean).map(wordView),
    paradigms: (L.paradigmIds || []).map(id => c.paradigmById.get(id)).filter(Boolean).map(paradigmView),
    alphabet: alphabetFor(c, L),
    examples: [],
    reading: null,
  };
  if (L.type === 'reading' && c.reading) {
    m.reading = readingVerses(c);
  } else {
    m.examples = versesWithLearned(c, L.exampleRefs || [], known);
  }
  return m;
}

// The reading lesson: every verse of the passage from orig/, each word marked
// taught (plain) or not (help shown) from the reading file — checked word by
// word against orig/ by position and lemma; on any mismatch the flag is
// worked out from the course instead.
function readingVerses(c) {
  const R = c.reading;
  const lastId = c.lessons.length ? c.lessons[c.lessons.length - 1].id : null;
  const known = taughtKeysThrough(c, lastId);
  const out = [];
  for (const rv of R.verses || []) {
    const body = lookupRef(rv.ref);
    if (!body) continue;
    const flags = new Map((rv.words || []).map(w => [w.index, w]));
    body.verses.forEach(v => v.words.forEach((w, i) => {
      w.w = nfc(w.w); w.l = nfc(w.l);
      w.key = keyOf(c, w.l, w.s);
      const f = flags.get(i);
      w.learned = (f && nfc(f.lemma) === w.l) ? !!f.taught : known.has(w.key);
      if (f && f.lessonNumber) w.lessonNumber = f.lessonNumber;
    }));
    out.push({ ref: rv.ref, data: body });
  }
  return { passage: R.passage || '', verses: out };
}

// ── Teacher context blocks (built on the server, never from the client) ───────
function wordLine(v) {
  return v.display + (v.translit ? ' (' + v.translit + ')' : '') + ' — ' + v.gloss +
    (v.lemma !== v.display ? ' [dictionary form in the data: ' + v.lemma + ']' : '') +
    (v.note ? '; ' + v.note : '');
}
function verseLines(entry, lines, mark) {
  entry.data.verses.forEach(v => {
    lines.push(v.ref + ':');
    v.words.forEach((w, i) => {
      lines.push('  ' + (i + 1) + '. ' + w.w + ' | ' + (w.t || '') + ' | dictionary form ' + w.l + ' | "' + (w.g || '') + '" | ' + (w.gram || w.m || '') +
        (mark ? (w.learned ? ' | learned' : ' | not yet learned (meaning shown to the learner)') : ''));
    });
  });
}

function materialsText(courseId, lessonId) {
  const m = lessonMaterials(courseId, lessonId);
  if (!m) return '';
  const L = m.lesson;
  const lines = ['LESSON MATERIALS', 'Course: ' + m.course.name + ' (pronunciation: Erasmian)',
    'Lesson ' + L.number + ' of the course: "' + L.title + '" (' + L.typeLabel + ')'];
  if (L.prereqs.length) lines.push('Builds on lessons ' + L.prereqs.join(', '));
  lines.push('', 'Goals, in order:');
  L.goals.forEach((g, i) => lines.push((i + 1) + '. ' + g));
  if (L.grammarTopic) lines.push('', 'Grammar topic: ' + L.grammarTopic);
  if (L.notes.length) { lines.push('', 'Teaching notes:'); L.notes.forEach(n => lines.push('- ' + n)); }
  if (L.recognition.length) { lines.push('', 'Recognition notes:'); L.recognition.forEach(n => lines.push('- ' + n)); }
  if (m.alphabet) {
    const A = m.alphabet;
    lines.push('', 'ALPHABET CONTENT (as the learner sees it):');
    if (A.letters) {
      A.letters.forEach(x => lines.push(x.capital + ' ' + x.small + (x.finalSmall ? ' (final ' + x.finalSmall + ')' : '') + ' — ' + x.name +
        ' — transliteration ' + x.translit + ' — Erasmian sound: ' + x.sound + ' — sound-alike: ' + x.soundAlike +
        (x.examples.length ? ' — examples: ' + x.examples.map(e => e.display + ' (' + e.translit + ', ' + e.gloss + ')').join('; ') : '') +
        (x.note ? ' — ' + x.note : '')));
      if (A.transliteration) lines.push('Transliteration scheme: ' + A.transliteration);
    }
    (A.diphthongs || []).forEach(d => lines.push('Diphthong ' + d.letters + ' — ' + d.translit + ' — ' + d.sound +
      (d.examples.length ? ' — examples: ' + d.examples.map(e => e.display + ' (' + e.translit + ')').join('; ') : '') + (d.note ? ' — ' + d.note : '')));
    (A.breathings || []).forEach(b => lines.push('Breathing: ' + b.name + (b.mark ? ' ' + b.mark : '') + ' — ' + b.description +
      (b.examples.length ? ' — examples: ' + b.examples.map(e => e.display + ' (' + e.translit + ')').join('; ') : '')));
    if (A.iotaSubscript) lines.push('Iota subscript ' + A.iotaSubscript.letters.join(' ') + ' — ' + A.iotaSubscript.description +
      ' — examples: ' + A.iotaSubscript.examples.map(e => e.display + ' (' + e.translit + ')').join('; '));
    if (A.accents) {
      lines.push('Accents: ' + A.accents.description);
      A.accents.marks.forEach(x => lines.push('  ' + x.name + ' ' + x.mark + ' — ' + x.description + (x.examples.length ? ' — examples: ' + x.examples.map(e => e.display).join('; ') : '')));
      A.accents.extra.forEach(x => lines.push('  ' + x.description + (x.examples.length ? ' — examples: ' + x.examples.map(e => e.display).join('; ') : '')));
    }
    (A.otherMarks || []).forEach(x => lines.push(x.name + (x.mark ? ' ' + x.mark : '') + ' — ' + x.description +
      (x.examples.length ? ' — examples: ' + x.examples.map(e => e.display).join('; ') : '') + (x.note ? ' — ' + x.note : '')));
    (A.punctuation || []).forEach(p => lines.push('Punctuation ' + p.mark + ' (' + p.name + ') — ' + p.meaning));
    if (A.punctuationNote) lines.push(A.punctuationNote);
  }
  if (m.words.length) {
    lines.push('', 'NEW WORDS IN THIS LESSON (display form (transliteration) — meaning):');
    m.words.forEach(v => lines.push('- ' + wordLine(v) + '; ' + v.freqText + ' in the New Testament'));
  }
  if (m.paradigms.length) {
    lines.push('', 'GRAMMAR TABLES:');
    m.paradigms.forEach(P => {
      lines.push(P.title + (P.note ? ' — note: ' + P.note : ''));
      P.rows.forEach(r => r.cells.forEach(x => lines.push('  ' + x.cellLabel + ': ' + x.form + ' (' + x.parse + ')')));
    });
  }
  if (m.examples.length) {
    lines.push('', 'EXAMPLE VERSES, word by word (form | transliteration | dictionary form | meaning here | grammar | whether the learner has learned the word):');
    m.examples.forEach(e => verseLines(e, lines, true));
  }
  if (m.reading) {
    lines.push('', 'THE READING PASSAGE, ' + m.reading.passage + ', word by word (form | transliteration | dictionary form | meaning here | grammar | learned or not):');
    m.reading.verses.forEach(e => verseLines(e, lines, true));
  }
  return lines.join('\n');
}

function learnedWordsText(courseId, lessonId) {
  const c = getCourse(courseId);
  const L = getLesson(c, lessonId);
  if (!L) return '';
  const lines = ['LEARNED WORDS (every word taught in this lesson and the earlier ones; display form (transliteration) — meaning):'];
  c.lessons.slice(0, L.index + 1).forEach(x => {
    const ws = (x.vocab || []).map(s => c.byStrongs.get(s)).filter(Boolean).map(wordView);
    if (!ws.length) return;
    lines.push('Lesson ' + x.number + ':');
    ws.forEach(v => lines.push('- ' + wordLine(v)));
  });
  if (lines.length === 1) lines.push('(none yet: the alphabet lessons come before any vocabulary)');
  return lines.join('\n');
}

// ── Progress store ────────────────────────────────────────────────────────────
const progressStore = createJsonStore(path.join(ROOT, 'data', 'lang_progress.json'), 'Language progress');
const sessionsStore = createJsonStore(path.join(ROOT, 'data', 'lang_sessions.json'), 'Language sessions');

// "Today" as the app counts days elsewhere (the devotional): America/Denver.
function todayStr(d) { return (d || new Date()).toLocaleDateString('en-CA', { timeZone: 'America/Denver' }); }
function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

function emptyProgress(userId, courseId) { return { userId, course: courseId, lessons: {}, vocab: {}, updatedAt: null }; }

function readProgress(userId, courseId) {
  let list = [];
  try { list = progressStore.read(); } catch (err) { return emptyProgress(userId, courseId); }
  return list.find(p => p.userId === userId && p.course === courseId) || emptyProgress(userId, courseId);
}

function withProgress(userId, courseId, fn) {
  return progressStore.update(list => {
    let rec = list.find(p => p.userId === userId && p.course === courseId);
    const fresh = !rec;
    if (!rec) rec = emptyProgress(userId, courseId);
    rec.lessons = rec.lessons || {};
    rec.vocab = rec.vocab || {};
    const result = fn(rec) || {};
    if (result.changed) {
      rec.updatedAt = new Date().toISOString();
      if (fresh) list.push(rec);
    }
    return Object.assign({ record: rec }, result);
  });
}

// A lesson becomes "in_progress" when its teacher session starts.
function markStarted(userId, courseId, lessonId) {
  return withProgress(userId, courseId, rec => {
    if (rec.lessons[lessonId]) return { changed: false };
    rec.lessons[lessonId] = { status: 'in_progress', startedAt: new Date().toISOString() };
    return { changed: true };
  });
}

// Mark complete: the lesson's words join review (box 1, due today) unless
// already there. Undo: back to in progress, and the words this lesson added are
// taken out of review again (review only ever holds words of completed lessons).
function setCompleted(userId, courseId, lessonId, completed) {
  const c = getCourse(courseId);
  const L = getLesson(c, lessonId);
  if (!L) return Promise.reject(new Error('Unknown lesson.'));
  const keys = (L.vocab || []).map(s => c.byStrongs.get(s)).filter(Boolean).map(w => nfc(w.key));
  return withProgress(userId, courseId, rec => {
    const now = new Date().toISOString();
    const cur = rec.lessons[lessonId] || null;
    if (completed) {
      if (cur && cur.status === 'completed') return { changed: false };
      rec.lessons[lessonId] = { status: 'completed', startedAt: (cur && cur.startedAt) || now, completedAt: now };
      const today = todayStr();
      keys.forEach(k => { if (!rec.vocab[k]) rec.vocab[k] = { box: 1, due: today }; });
      return { changed: true };
    }
    if (!cur || cur.status !== 'completed') return { changed: false };
    rec.lessons[lessonId] = { status: 'in_progress', startedAt: cur.startedAt || now };
    keys.forEach(k => { delete rec.vocab[k]; });
    return { changed: true };
  });
}

function completedKeys(c, rec) {
  const set = new Set();
  c.lessons.forEach(L => {
    const st = rec.lessons && rec.lessons[L.id];
    if (st && st.status === 'completed') (L.vocab || []).forEach(s => { const w = c.byStrongs.get(s); if (w) set.add(nfc(w.key)); });
  });
  return set;
}

// Due cards, oldest due first, then in course order. Only words of completed
// lessons count, whatever the store holds.
function dueCards(userId, courseId, today) {
  const c = getCourse(courseId);
  if (!c) return [];
  today = today || todayStr();
  const rec = readProgress(userId, courseId);
  const allowed = completedKeys(c, rec);
  const order = new Map(c.words.map((w, i) => [nfc(w.key), i]));
  const lessonOrder = k => { const id = c.taughtIn.get(k); const L = id && c.lessonById.get(id); return L ? L.index : 999; };
  return Object.keys(rec.vocab || {})
    .filter(k => allowed.has(k) && c.byKey.has(k) && String(rec.vocab[k].due || '') <= today)
    .sort((a, b) => String(rec.vocab[a].due).localeCompare(String(rec.vocab[b].due)) ||
      lessonOrder(a) - lessonOrder(b) || (order.get(a) || 0) - (order.get(b) || 0))
    .map(k => Object.assign(wordView(c.byKey.get(k)), { box: rec.vocab[k].box, due: rec.vocab[k].due }));
}

function dueCount(userId, courseId) { return dueCards(userId, courseId).length; }

// result: 'knew' → up one box (max 5), due today + BOX_DAYS[box-1];
//         'notyet' → box 1, due tomorrow.
function recordReview(userId, courseId, key, result) {
  const c = getCourse(courseId);
  if (!c) return Promise.reject(new Error('Unknown course.'));
  key = nfc(key);
  return withProgress(userId, courseId, rec => {
    const v = rec.vocab[key];
    if (!v || !completedKeys(c, rec).has(key)) return { changed: false, error: 'That word is not in your review.' };
    const today = todayStr();
    if (result === 'knew') {
      const box = Math.min(MAX_BOX, (parseInt(v.box, 10) || 1) + 1);
      rec.vocab[key] = { box, due: addDays(today, BOX_DAYS[box - 1]) };
    } else {
      rec.vocab[key] = { box: 1, due: addDays(today, 1) };
    }
    return { changed: true, card: rec.vocab[key] };
  });
}

// Course page / Dashboard: where the member is.
function courseState(userId, courseId) {
  const c = getCourse(courseId);
  if (!c) return null;
  const rec = readProgress(userId, courseId);
  const lessons = c.lessons.map(L => {
    const st = rec.lessons[L.id] || null;
    return Object.assign(lessonSummary(c, L), {
      status: st ? st.status : null,
      completedAt: st && st.status === 'completed' ? st.completedAt : null,
    });
  });
  const next = lessons.find(l => l.status !== 'completed') || null;
  const started = lessons.some(l => l.status);
  const last = lessons[lessons.length - 1];
  return { lessons, next, started, finished: !!(last && last.status === 'completed'), due: dueCount(userId, courseId) };
}

// The Dashboard's "Currently studying" row: the member has started the course
// and not completed its last lesson. null otherwise (or on any read problem).
function dashboardRows(userId) {
  const rows = [];
  COURSE_ORDER.forEach(id => {
    try {
      const st = courseState(userId, id);
      if (!st || !st.started || st.finished || !st.next) return;
      const inProg = st.lessons.find(l => l.status === 'in_progress');
      const L = inProg || st.next;
      rows.push({ course: id, name: COURSES[id].name, number: L.number, title: L.title, href: '/languages/' + id + '/' + L.id, due: st.due, reviewHref: '/languages/' + id + '/review' });
    } catch (err) { console.error('[languages] dashboard:', err.message); }
  });
  return rows;
}

// ── Saved teacher sessions ────────────────────────────────────────────────────
function findSession(list, userId, courseId, lessonId) {
  return list.find(s => s.userId === userId && s.course === courseId && s.lessonId === lessonId) || null;
}
function readSession(userId, courseId, lessonId) {
  return findSession(sessionsStore.read(), userId, courseId, lessonId);
}

module.exports = {
  COURSES, COURSE_ORDER, TYPE_LABELS, BOX_DAYS,
  getCourse, getLesson, lessonMaterials, materialsText, learnedWordsText,
  courseState, dueCards, dueCount, recordReview, setCompleted, markStarted, readProgress,
  dashboardRows, sessionsStore, findSession, readSession, todayStr, addDays, freqText, nfc,
};
