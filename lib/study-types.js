'use strict';

// ── Study types & depth levels — the one list ────────────────────────────────
// Every place that names the study types or levels reads them from here:
//   - GET /study renders the type cards and the Study Level <select> from it
//   - POST /api/study/suggest-type classifies against it
//   - the Study Planner (routes/planner.js) recommends from it and validates
//     every "Build this study" result against these keys
// To add or rename a type or level, change it HERE. The generate route
// (routes/study.js) maps each type key to its prompt and each level key to its
// writing register — a new key also needs its entry there.
//
// label / desc are exactly what members read on the cards and in the select.
// noLevel: the type has no depth dial (the level field is hidden for it).
// storyMode: the level overrides the study type entirely (told as a story).

const STUDY_TYPES = [
  { key: 'doctrinal',  label: 'Doctrinal',         desc: 'Reformed doctrine, confessions & historical voices' },
  { key: 'explore',    label: 'Explore',           desc: 'Big subject? Get oriented, then branch into further studies.', noLevel: true },
  { key: 'historical', label: 'Historical',        desc: 'Timeline, places, and what happened' },
  { key: 'scripture',  label: 'Scripture & Verse', desc: 'Study a specific passage, verse by verse' },
  { key: 'people',     label: 'Subject',           desc: 'A person, place, or thing in Scripture & its place in God\'s plan' },
  { key: 'pathway',    label: 'Pathway',           desc: 'A full study that follows the subject where it leads — and opens further paths.' },
  { key: 'open',       label: 'Open',              desc: 'Not sure which to pick? Start here — fits the study to the subject.' },
  { key: 'book',       label: 'Book',              desc: 'A whole book of the Bible — who wrote it, when, why, and its place in Scripture.' },
];

const DEFAULT_STUDY_TYPE = 'doctrinal';

// In the order the select shows them. desc is for the planner (members see
// only the label); it summarizes each level's writing register in routes/study.js.
const STUDY_LEVELS = [
  { key: 'children',    label: 'Children\'s', desc: 'A Bible story told warmly for a young child. Told as a story whatever the study type.', storyMode: true },
  { key: 'foundations', label: 'Apprentice',  desc: 'New to the topic: the core, settled doctrine in plain language, with terms explained.' },
  { key: 'journeyman',  label: 'Journeyman',  desc: 'Some theological vocabulary: the main contours and the distinctions that matter.' },
  { key: 'scholar',     label: 'Scholar',     desc: 'Comfortable with theology: full depth — the debates, the history, the hard nuances.' },
];

const TYPE_KEYS  = STUDY_TYPES.map(t => t.key);
const LEVEL_KEYS = STUDY_LEVELS.map(l => l.key);

function findType(key)  { return STUDY_TYPES.find(t => t.key === key) || null; }
function findLevel(key) { return STUDY_LEVELS.find(l => l.key === key) || null; }

module.exports = { STUDY_TYPES, STUDY_LEVELS, DEFAULT_STUDY_TYPE, TYPE_KEYS, LEVEL_KEYS, findType, findLevel };
