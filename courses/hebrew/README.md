# courses/hebrew — Hebrew course data (Phase A)

From the alphabet to reading Genesis 1:1–5 with help. Standard academic (modern Israeli-based)
pronunciation, full vowel pointing. Audio is limited to short clips of individual sounds that English speakers don't already have. No spoken lessons, words, verses or readings.
Data only: no pages, routes or UI read these files yet.
Same files and checks as `courses/greek/`.

| File | Kind | What it holds |
|---|---|---|
| `course.json` | hand-written | 30 lessons: id, number, title, type, goals, vocab (Strong's numbers), grammarTopic, paradigmIds, alphabetSections, exampleRefs, prereqs |
| `alphabet.json` | hand-written | consonants and final forms, begadkephat and dagesh, mappiq, vowels, shewa, hateph vowels, furtive patach, syllables, maqqef, sof pasuq, transliteration scheme |
| `paradigms.json` | hand-written | grammar tables; each cell `{ form, code, parse, cellLabel, scope, key? }` |
| `display.json` | hand-written | course display forms (displayLemma, displayNote) and beginner glosses (courseGloss) |
| `vocab.json` | generated | the 250 most frequent OT words, the 42 prefixes and suffixes (morphemes), and the Genesis 1:1–5 passage supplement |
| `paradigm-check.json` | generated | every paradigm cell checked against the OT |
| `reading-gen1.json` | generated | Genesis 1:1–5 word by word and morpheme by morpheme: taught yet, and in which lesson |
| `course-check.json` | generated | lesson-plan validation, example-verse coverage, grammar coverage of the passage |
| `examples.json` | generated | every exampleRef and Genesis 1:1–5, word by word with each word's parts in order (prefix / word / suffix): form, strongs, code, grammar, gloss, taughtIn |

Regenerate:

    node scripts/build-hebrew-course.js [--tahot <dir>]

The script needs STEPBible's TAHOT files (`tahot1.txt`–`tahot4.txt`) for the morpheme split.
`scripts/build-original-data.js` leaves them in `<os tmpdir>/iron-ink-orig-build/`; pass
`--tahot <dir>` to point elsewhere. Every word is checked against `orig/ot`.

If that cache is gone (a cleared temp folder, or a new machine), download the files again, then
re-run the Hebrew script. This rebuilds every generated file, `examples.json` included:

    node scripts/build-original-data.js
    node scripts/build-hebrew-course.js

The first command downloads STEPBible-Data afresh and also rebuilds `orig/`. If STEPBible has
changed since the snapshot in `orig/SOURCES.md`, the Hebrew script will stop on any word that no
longer matches, rather than build from mismatched data. The script uses Node
built-ins only, gives the same output on every run, and exits non-zero on any problem.

Prefixes (and, the, in, to, like, from) and pronoun suffixes are counted and taught as their own
items, never as part of the word they attach to. Hebrew is typed only in `alphabet.json`,
`paradigms.json`, `display.json` and notes, and the script checks it against `orig/ot`. Data:
STEP Bible (STEPBible.org), based on work at Tyndale House, Cambridge. CC BY 4.0
(see `orig/SOURCES.md`).

Hear it clips: an alphabet consonants row may carry `"clip": "<id>"`, an id in `courses/sounds.json`
(file, IPA, Commons page, author, license, conversion note). The MP3s are in `public/audio/sounds/`;
the lesson page shows a Hear it button in that row's Sound cell and a credit line under the table,
and the build script checks that every clip id and MP3 file exists.
