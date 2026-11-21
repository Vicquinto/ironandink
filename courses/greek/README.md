# courses/greek — Greek course data (Phase A)

From the alphabet to reading 1 John 1:1–10 with help. Erasmian pronunciation, no audio.
Data only: no pages, routes or UI read these files yet.

| File | Kind | What it holds |
|---|---|---|
| `course.json` | hand-written | 24 lessons: id, number, title, type (alphabet / vocab / grammar / reading), goals, vocab (Strong's numbers), grammarTopic, paradigmIds, exampleRefs, prereqs |
| `alphabet.json` | hand-written | letters, Erasmian sounds and sound-alikes, transliteration scheme, diphthongs, breathings, iota subscript, accents, punctuation |
| `paradigms.json` | hand-written | grammar tables, each cell `{ form, parse, cellLabel }` |
| `vocab.json` | generated | the 150 most frequent NT lemmas |
| `paradigm-check.json` | generated | every paradigm cell checked against the NT: attested-match / attested-other / unattested |
| `reading-1john1.json` | generated | 1 John 1:1–10 word by word: taught yet, and in which lesson |
| `course-check.json` | generated | lesson-plan validation and how much of each example verse is already known |

Regenerate after changing a hand-written file or rebuilding `orig/`:

    node scripts/build-greek-course.js

It uses Node built-ins only, gives the same output on every run, and exits non-zero if
the lesson plan or alphabet points at anything the data does not have.

Rules: Greek is typed only in `paradigms.json` and `alphabet.json`, and the script checks
it against `orig/nt`. Lesson files hold verse references only; verse text comes from `orig/`
when it is shown. Data: STEP Bible (STEPBible.org), based on work at Tyndale House,
Cambridge. CC BY 4.0 (see `orig/SOURCES.md`).

A Hebrew course would go in `courses/hebrew/` with the same files, built from `orig/ot`,
`lexicon-heb.json` and `morph-heb.json`.
