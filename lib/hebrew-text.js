// ─── Hebrew text comparison ──────────────────────────────────────────────────
// One normalization for every Hebrew comparison: the Hebrew course build
// (scripts/build-hebrew-course.js), the Languages pages and the Hebrew
// teacher's stray-text check (lib/languages.js). Node built-ins only.
//
//   hebrewKey(s)    comparable form of one word or part: NFC, with cantillation
//                   (U+0591–U+05AF, which includes the ole of dictionary forms),
//                   meteg (U+05BD), paseq, sof pasuq, upper/lower dots, maqqef,
//                   morpheme separators, spaces and a trailing paragraph letter
//                   (פ / ס after a space) removed. Vowels, dagesh and shin/sin
//                   dots are kept.
//   hebrewStrip(s)  the same marks removed from running text, but word breaks
//                   kept (maqqef becomes a space), for searching a passage.

'use strict';

const MARKS = /[֑-ֽ֯׀׃ׅׄ]/g;

function hebrewKey(s) {
  return String(s == null ? '' : s).normalize('NFD')
    .replace(/\s+[פס]$/, '')
    .replace(/[֑-ֽ֯׀׃ׅׄ־\/\\\s]/g, '')
    .normalize('NFC');
}

function hebrewStrip(s) {
  return String(s == null ? '' : s).normalize('NFD')
    .replace(MARKS, '')
    .replace(/־/g, ' ')
    .normalize('NFC');
}

// Hebrew letter runs (with their points) in a text.
const HEBREW_RUN_RE = /[֑-״יִ-ﭏ]+/g;

module.exports = { hebrewKey, hebrewStrip, HEBREW_RUN_RE };
