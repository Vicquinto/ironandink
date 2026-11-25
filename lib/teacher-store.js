'use strict';

// The Study with a Teacher sessions store: data/teacher-sessions.json, one
// record per (userId, studyId, kind). Fail-closed, atomic, one write at a time
// (lib/jsonStore.js). ONE instance for the whole app: the write queue only
// protects writers that share it, so nothing else may write this file.

const path = require('path');
const { createJsonStore } = require('./jsonStore');

const sessionsStore = createJsonStore(path.join(__dirname, '../data/teacher-sessions.json'), 'Teacher sessions');

// Lesson conversations that "Start over" replaces, kept for Study Notes:
// data/teacher_lessons_kept.json. One record per replaced lesson, at most
// KEPT_MAX per (userId, studyId); the oldest drops off. Deleting a saved session
// removes that conversation only, never these.
const keptStore = createJsonStore(path.join(__dirname, '../data/teacher_lessons_kept.json'), 'Kept lessons');
const KEPT_MAX = 3;

// Adds (or refreshes, by sessionId) one lesson to a kept-lessons list, in place.
// false when there is no teaching in it to keep.
function addKeptLesson(list, s) {
  if (!s || s.kind !== 'lesson' || !(s.messages || []).some(m => m && m.role === 'assistant')) return false;
  const mine = r => r && r.userId === s.userId && r.studyId === s.studyId;
  const at = list.findIndex(r => mine(r) && r.sessionId === s.id);
  if (at !== -1) list.splice(at, 1);
  list.push({
    userId:         s.userId,
    studyId:        s.studyId,
    sessionId:      s.id,
    studyTopic:     s.studyTopic,
    mode:           s.mode,
    startSection:   s.startSection,
    lessonSections: s.lessonSections,
    currentSection: s.currentSection,
    doneSections:   s.doneSections,
    taughtSections: s.taughtSections,
    messages:       s.messages,
    startedAt:      s.createdAt || null,
    endedAt:        s.updatedAt || null,
    keptAt:         new Date().toISOString(),
  });
  // Newest additions are at the end, so the first ones found are the oldest.
  while (list.filter(mine).length > KEPT_MAX) list.splice(list.findIndex(mine), 1);
  return true;
}

function keepLesson(session) {
  return keptStore.update(list => ({ changed: addKeptLesson(list, session) }));
}

// Removes a member's kept lessons for a study. Resolves with how many.
function deleteKeptLessons(userId, studyId) { return removeWhere(keptStore, r => r && r.userId === userId && r.studyId === studyId); }
// Removes a member's lesson and check sessions for a study (older Tutor records
// are left, as everywhere else).
function deleteSessions(userId, studyId) {
  return removeWhere(sessionsStore, s => s && s.userId === userId && s.studyId === studyId && (s.kind === 'lesson' || s.kind === 'check'));
}
function removeWhere(store, match) {
  return store.update(list => {
    const before = list.length;
    for (let i = list.length - 1; i >= 0; i--) if (match(list[i])) list.splice(i, 1);
    return { changed: list.length !== before, removed: before - list.length };
  }).then(r => r.removed);
}

module.exports = { sessionsStore, keptStore, deleteKeptLessons, deleteSessions, removeWhere, keepLesson, addKeptLesson, KEPT_MAX };
