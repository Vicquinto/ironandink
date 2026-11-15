'use strict';

// Study with a Teacher — which saved sessions are "in progress", in ONE place.
// Used by routes/teacher.js (GET /api/teacher/in-progress, the resume line) and
// routes/study-map.js (the Dashboard's "Pick up where you left off").
//
// In progress = a saved session of kind "lesson" or "check" for this member,
// with at least one reader turn beyond the hidden opening, that is NOT:
//   - a lesson with finished === true,
//   - marked done (done: true — "I'm done with this session" in the review),
//   - hidden from the list (hidden: true — the × on a list item),
//   - on a study the member can no longer read (deleted, or no longer theirs
//     and no longer shared).
// Old Tutor/Teacher records (kind "tutor" / "teacher" / none) never count.
// Archived studies still count; each item says whether its study is archived.

const fs   = require('fs');
const path = require('path');

const SESSIONS_PATH = path.join(__dirname, '../data/teacher-sessions.json');
const STUDIES_PATH  = path.join(__dirname, '../data/studies.json');

function readJson(file) {
  try {
    if (!fs.existsSync(file)) return [];
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

function sectionTitle(session, n) {
  const s = (session.lessonSections || [])[n - 1];
  return s ? s.title : '';
}

// The resume panel's line. "Just started" while the only teaching reply so far
// is the opening; otherwise where the lesson stands in its current section.
function resumeText(session) {
  if (!session) return '';
  if (session.kind === 'check') return 'Last time we were partway through checking your understanding.';
  const replies = (session.messages || []).filter(m => m.role === 'assistant').length;
  const cur = session.currentSection || 0;
  const t = cur ? sectionTitle(session, cur) : '';
  if (replies <= 1 || !t) return 'Last time we had just started the lesson.';
  if ((session.doneSections || []).includes(cur)) {
    const next = sectionTitle(session, cur + 1);
    return next ? 'Last time we finished “' + t + '”. Next is “' + next + '”.'
                : 'Last time we finished “' + t + '”, the last section.';
  }
  return 'Last time we were partway through “' + t + '”.';
}

// A turn the reader made: typed text, or a button tap (stored hidden, with the
// button's label as `display`). The opening is hidden with no display.
function isReaderTurn(m) {
  return !!m && m.role === 'user' && (!m.hidden || !!m.display);
}

function isInProgress(s) {
  if (!s || (s.kind !== 'lesson' && s.kind !== 'check')) return false;
  if (s.kind === 'lesson' && s.finished === true) return false;
  if (s.done === true || s.hidden === true) return false;
  return (s.messages || []).some(isReaderTurn);
}

// The member's in-progress sessions, newest first:
// [{ studyId, studyTopic, kind, updatedAt, resumeText, archived }]
function inProgressList(userId) {
  if (!userId) return [];
  const studies = new Map();
  readJson(STUDIES_PATH).forEach(st => { if (st && st.id) studies.set(st.id, st); });
  return readJson(SESSIONS_PATH)
    .filter(s => s && s.userId === userId && typeof s.studyId === 'string' && isInProgress(s))
    .map(s => {
      const st = studies.get(s.studyId);
      // Same rule as routes/teacher.js findReadableStudy: own, or shared.
      if (!st || !(st.userId === userId || st.shared === true)) return null;
      return {
        studyId:    s.studyId,
        studyTopic: String(st.topic || s.studyTopic || 'Untitled study'),
        kind:       s.kind,
        updatedAt:  s.updatedAt || null,
        resumeText: resumeText(s),
        archived:   st.userId === userId && st.archived === true,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
}

// Where Continue goes: the resume panel, never a fresh start (resume=1).
function continueHref(item) {
  return '/teacher/' + encodeURIComponent(item.studyId) +
    '?mode=' + (item.kind === 'check' ? 'check' : 'lesson') + '&resume=1';
}

module.exports = { inProgressList, isInProgress, isReaderTurn, resumeText, sectionTitle, continueHref };
