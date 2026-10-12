const express        = require('express');
const fs             = require('fs');
const path           = require('path');
const { randomUUID } = require('crypto');
const { requireAuth } = require('./layout');
const { STUDY_TYPES, STUDY_LEVELS, findType, findLevel } = require('../lib/study-types');
const { getMap } = require('../lib/study-map');

// ─── Study Ideas ──────────────────────────────────────────────────────────────
// A private list of studies the member wants to do later, on the Study page
// beside Plan a Study (public/js/study-ideas.js) and linked from the Study Map.
// Stored server-side so ideas follow the member across devices; every route is
// owner-only (filtered by session userId). Nothing here counts or totals ideas.
//
// Store shape (data/study-ideas.json, gitignored): an array of
//   { id, userId, title, notes, type, level, subject, source, createdAt, updatedAt }
//   title   — the idea, short; what "Build it" puts in the study creator
//   notes   — optional free text
//   type    — a lib/study-types.js type key, or null (leave the creator's type)
//   level   — a lib/study-types.js level key, or null (leave the creator's level)
//   subject — the Study Map subject of the Library study it was saved from
//             ("Save as idea and delete"), else null
//   source  — 'member' (added on the Study page) | 'library' (saved from a study)

const router      = express.Router();
const IDEAS_PATH   = path.join(__dirname, '../data/study-ideas.json');
const STUDIES_PATH = path.join(__dirname, '../data/studies.json');

const MAX_IDEAS      = 200;    // per member
const MAX_TITLE      = 200;    // matches the planner's subject cap
const MAX_NOTES      = 1000;
const FULL_ERROR     = 'Your Study Ideas list is full. Remove an idea you no longer need, then try again.';

function readIdeas() {
  try {
    if (!fs.existsSync(IDEAS_PATH)) return [];
    const list = JSON.parse(fs.readFileSync(IDEAS_PATH, 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

function writeIdeas(data) {
  fs.writeFileSync(IDEAS_PATH, JSON.stringify(data, null, 2));
}

function readStudies() {
  try {
    if (!fs.existsSync(STUDIES_PATH)) return [];
    return JSON.parse(fs.readFileSync(STUDIES_PATH, 'utf8'));
  } catch { return []; }
}

// ── Validation ────────────────────────────────────────────────────────────────
function cleanTitle(s) {
  return String(s == null ? '' : s).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
}

function cleanNotes(s) {
  return String(s == null ? '' : s).replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_NOTES);
}

// Type/level as the planner validates them: real keys only; a type with no
// depth dial (Explore) takes no level unless it is a story-mode level.
function cleanTypeLevel(rawType, rawLevel) {
  const type  = (typeof rawType === 'string' && findType(rawType)) || null;
  let level   = (typeof rawLevel === 'string' && findLevel(rawLevel)) || null;
  if (type && type.noLevel && level && !level.storyMode) level = null;
  return { type: type ? type.key : null, level: level ? level.key : null };
}

// What the client sees: no userId.
function publicIdea(i) {
  return {
    id:        i.id,
    title:     i.title,
    notes:     i.notes || '',
    type:      i.type || null,
    level:     i.level || null,
    subject:   i.subject || null,
    source:    i.source === 'library' ? 'library' : 'member',
    createdAt: i.createdAt,
    updatedAt: i.updatedAt || null,
  };
}

function memberIdeas(all, userId) {
  return all
    .filter(i => i && i.userId === userId)
    .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
}

// The member's idea with this title (case-insensitive), if any — so the same
// study is never listed twice (Save to Ideas, Start fresh, Library, Undo).
function findSameTitle(mine, title) {
  const key = String(title).toLowerCase();
  return mine.find(i => String(i.title).toLowerCase() === key) || null;
}

// For the planner's context (routes/planner.js): the member's ideas, newest first.
function ideasForMember(userId) {
  return memberIdeas(readIdeas(), userId).map(publicIdea);
}

// ─── GET /api/study-ideas ─────────────────────────────────────────────────────
router.get('/api/study-ideas', requireAuth, (req, res) => {
  res.json({ success: true, ideas: ideasForMember(req.session.userId) });
});

// ─── POST /api/study-ideas ────────────────────────────────────────────────────
// Body: { title, notes?, type?, level? }
// An idea with the same title already on the member's list is returned as is
// ({ existing: true }) rather than added again.
router.post('/api/study-ideas', requireAuth, (req, res) => {
  const body  = req.body || {};
  const title = cleanTitle(body.title);
  if (!title) return res.status(400).json({ success: false, error: 'Give your idea a title.' });
  if (String(body.notes || '').length > MAX_NOTES * 2) {
    return res.status(400).json({ success: false, error: 'Those notes are too long. Please shorten them.' });
  }
  const { type, level } = cleanTypeLevel(body.type, body.level);

  try {
    const all  = readIdeas();
    const mine = memberIdeas(all, req.session.userId);
    const same = findSameTitle(mine, title);
    if (same) return res.json({ success: true, idea: publicIdea(same), existing: true });
    if (mine.length >= MAX_IDEAS) {
      return res.status(400).json({ success: false, error: FULL_ERROR });
    }
    const now  = new Date().toISOString();
    const idea = {
      id:        randomUUID(),
      userId:    req.session.userId,
      title,
      notes:     cleanNotes(body.notes),
      type,
      level,
      subject:   null,
      source:    'member',
      createdAt: now,
      updatedAt: null,
    };
    all.push(idea);
    writeIdeas(all);
    res.json({ success: true, idea: publicIdea(idea) });
  } catch (err) {
    console.error('[study-ideas] add failed:', err.message);
    res.status(500).json({ success: false, error: 'Could not save that idea. Please try again.' });
  }
});

// ─── PUT /api/study-ideas/:id ─────────────────────────────────────────────────
// Body: { title, notes?, type?, level? } — the subject/source are kept.
router.put('/api/study-ideas/:id', requireAuth, (req, res) => {
  const body  = req.body || {};
  const title = cleanTitle(body.title);
  if (!title) return res.status(400).json({ success: false, error: 'Give your idea a title.' });
  if (String(body.notes || '').length > MAX_NOTES * 2) {
    return res.status(400).json({ success: false, error: 'Those notes are too long. Please shorten them.' });
  }
  try {
    const all  = readIdeas();
    const idea = all.find(i => i && i.id === req.params.id && i.userId === req.session.userId);
    if (!idea) return res.status(404).json({ success: false, error: 'Idea not found.' });
    const { type, level } = cleanTypeLevel(body.type, body.level);
    idea.title     = title;
    idea.notes     = cleanNotes(body.notes);
    idea.type      = type;
    idea.level     = level;
    idea.updatedAt = new Date().toISOString();
    writeIdeas(all);
    res.json({ success: true, idea: publicIdea(idea) });
  } catch (err) {
    console.error('[study-ideas] edit failed:', err.message);
    res.status(500).json({ success: false, error: 'Could not save that idea. Please try again.' });
  }
});

// ─── DELETE /api/study-ideas/:id ──────────────────────────────────────────────
// Also used when an idea has been built and its study generated.
router.delete('/api/study-ideas/:id', requireAuth, (req, res) => {
  try {
    const all  = readIdeas();
    const rest = all.filter(i => !(i && i.id === req.params.id && i.userId === req.session.userId));
    if (rest.length === all.length) return res.status(404).json({ success: false, error: 'Idea not found.' });
    writeIdeas(rest);
    res.json({ success: true });
  } catch (err) {
    console.error('[study-ideas] delete failed:', err.message);
    res.status(500).json({ success: false, error: 'Could not remove that idea. Please try again.' });
  }
});

// ─── POST /api/study-ideas/from-study/:studyId ────────────────────────────────
// "Save as idea and delete" in the Library, step one: keep the member's own
// study's title, Study Map subject, type and depth as an idea. The client then
// deletes the study through the existing DELETE /api/library/:id, so the delete
// (and its notepad cascade) is exactly the Library's. Saving first means a
// failed save never costs the member a study. An idea with the same title is
// reused rather than duplicated (e.g. a retry after the delete step failed).
router.post('/api/study-ideas/from-study/:studyId', requireAuth, (req, res) => {
  const study = readStudies().find(s => s && s.id === req.params.studyId && s.userId === req.session.userId);
  if (!study) return res.status(404).json({ success: false, error: 'Study not found.' });

  const title = cleanTitle(study.topic) || 'Untitled study';
  try {
    const all  = readIdeas();
    const mine = memberIdeas(all, req.session.userId);
    const same = findSameTitle(mine, title);
    if (same) return res.json({ success: true, idea: publicIdea(same), existing: true });
    if (mine.length >= MAX_IDEAS) return res.status(400).json({ success: false, error: FULL_ERROR });

    let subject = null;
    try { subject = cleanTitle(getMap(study).subject) || null; } catch { subject = null; }
    if (subject && subject.toLowerCase() === title.toLowerCase()) subject = null;

    const { type, level } = cleanTypeLevel(study.studyType, study.studyLevel);
    const idea = {
      id:        randomUUID(),
      userId:    req.session.userId,
      title,
      notes:     '',
      type,
      level,
      subject,
      source:    'library',
      createdAt: new Date().toISOString(),
      updatedAt: null,
    };
    all.push(idea);
    writeIdeas(all);
    res.json({ success: true, idea: publicIdea(idea) });
  } catch (err) {
    console.error('[study-ideas] from-study failed:', err.message);
    res.status(500).json({ success: false, error: 'Could not save that idea. Please try again.' });
  }
});

// The type/level options for the Study page's idea form (labels as members see them).
function ideaOptions() {
  return {
    types:  STUDY_TYPES.map(t => ({ key: t.key, label: t.label, noLevel: !!t.noLevel })),
    levels: STUDY_LEVELS.map(l => ({ key: l.key, label: l.label, storyMode: !!l.storyMode })),
  };
}

module.exports = { router, ideasForMember, ideaOptions };
