const express = require('express');
const { randomUUID } = require('crypto');
const rateLimit = require('express-rate-limit');
const { requireAuth, renderLayout } = require('./layout');
const { escapeHtml, inlineJson } = require('../lib/html');
const { sessionsStore, keptStore } = require('../lib/teacher-store');
const teacher = require('./teacher');
const notepad = require('./notepad');
const { notesStore, findRecord, capturePoint, shownRange, POINT_MAX, NOTE_MAX, POINTS_MAX } = require('../lib/study-notes');

// ─── Study Notes ───────────────────────────────────────────────────────────────
// One page per study for the member's OWN notes, section by section: their
// study-text notes and the full teaching (the lesson conversation itself).
// Teacher sessions, kept lessons and notepads are only read here; saved points
// (lib/study-notes.js) are the one thing written. userId always comes from the session. Behind the Teacher's gate.
//
// A lesson message belongs to a section by its saved tag (routes/teacher.js
// saveExchange): id + section, plus endsSection on a reply that also finished
// the section before. Messages saved before tagging have no id; nothing is
// guessed about them (they show as one "Earlier conversation" block). Check my
// understanding sessions are not shown.

const router = express.Router();

// id AND section: before tagging, a jump's own message already had a section.
function isTagged(m) { return !!m && typeof m.id === 'string' && Number.isInteger(m.section); }
function inSection(m, n) { return isTagged(m) && (m.section === n || m.endsSection === n); }
// Hidden instructions never show; a button tap shows as its label.
function visible(messages) {
  return (messages || []).map((m, i) => m && Object.assign({}, m, { storedIndex: i })).filter(m => m && teacher.isReaderVisible(m));
}

// The member's lessons on a study, newest first: the current one, then the
// conversations Start over kept. Throws if a store is damaged.
function lessonsFor(userId, studyId) {
  const out = [];
  const cur = sessionsStore.read().find(s => s && s.userId === userId && s.studyId === studyId && s.kind === 'lesson');
  if (cur) {
    out.push({ key: 'current', sessionId: cur.id, current: true, date: cur.updatedAt || null, sections: cur.lessonSections, topic: cur.studyTopic, messages: visible(cur.messages) });
  }
  keptStore.read()
    .filter(k => k && k.userId === userId && k.studyId === studyId && !(cur && k.sessionId === cur.id))
    .sort((a, b) => (Date.parse(b.endedAt) || 0) - (Date.parse(a.endedAt) || 0))
    .forEach(k => out.push({ key: k.sessionId, sessionId: k.sessionId, current: false, date: k.endedAt || null, sections: k.lessonSections, topic: k.studyTopic, messages: visible(k.messages) }));
  return out;
}

function messagePage(req, res, status, text) {
  res.status(status).send(renderLayout({
    req, activeSection: 'library', title: 'Study Notes',
    content: `
      <div class="page-header">
        <h2 class="page-title">Study Notes</h2>
        <p class="page-subtitle">${escapeHtml(text)}</p>
      </div>
      <a class="btn-warm" href="/library">Back to Library</a>`,
  }));
}

// ─── GET /api/study-notes/available ───────────────────────────────────────────
// Which studies have something to see, for the links in the Library.
// Declared before the /:studyId routes.
router.get('/api/study-notes/available', requireAuth, (req, res) => {
  if (teacher.memberGated(req)) return res.json({ success: true, allowed: false, studyIds: [] });
  const userId = req.session.userId;
  const ids = new Set();
  const add = fn => { try { fn(); } catch (err) { console.error('[study-notes] available:', err.message); } };
  add(() => notepad.studyIdsWithNotes(userId).forEach(id => ids.add(id)));
  add(() => sessionsStore.read().forEach(s => {
    if (s && s.userId === userId && s.kind === 'lesson' && typeof s.studyId === 'string') ids.add(s.studyId);
  }));
  add(() => notesStore.read().forEach(r => { if (r && r.userId === userId && (r.points || []).length) ids.add(r.studyId); }));
  add(() => keptStore.read().forEach(k => { if (k && k.userId === userId && typeof k.studyId === 'string') ids.add(k.studyId); }));
  res.json({ success: true, allowed: true, studyIds: Array.from(ids) });
});

// ─── GET /api/study-notes/:studyId/teaching ───────────────────────────────────
// ?section=N      → that section's tagged messages, one entry per lesson
// ?earlier=<key>  → one lesson's untagged messages ('current' or a kept session id)
router.get('/api/study-notes/:studyId/teaching', requireAuth, (req, res) => {
  if (teacher.memberGated(req)) return res.status(402).json({ success: false, error: 'member_feature', upgradeUrl: '/pricing' });
  let lessons;
  try { lessons = lessonsFor(req.session.userId, req.params.studyId); }
  catch { return res.status(500).json({ success: false, error: 'The teaching is unavailable right now.' }); }

  let pick;
  if (typeof req.query.earlier === 'string') {
    lessons = lessons.filter(l => l.key === req.query.earlier);
    pick = m => !isTagged(m);
  } else {
    const n = parseInt(req.query.section, 10);
    if (!(n >= 0)) return res.status(400).json({ success: false, error: 'Unknown section.' });
    pick = m => inSection(m, n);
  }
  const out = lessons.map(l => {
    const picked = l.messages.filter(pick);
    const last = picked[picked.length - 1];
    return { current: l.current, sessionId: l.sessionId, date: (last && last.at) || l.date, messages: teacher.displayMessages(picked) };
  }).filter(l => l.messages.length);
  res.json({ success: true, lessons: out });
});

// ─── GET /study-notes/:studyId ────────────────────────────────────────────────
router.get('/study-notes/:studyId', requireAuth, (req, res) => {
  if (teacher.memberGated(req)) return res.redirect('/pricing?from=teacher');
  const userId  = req.session.userId;
  const studyId = req.params.studyId;
  const study   = teacher.findReadableStudy(req, studyId);

  let lessons, notes, record;
  try {
    record  = findRecord(notesStore.read(), userId, studyId);
    lessons = lessonsFor(userId, studyId);
    notes   = notepad.notesFor(studyId, userId);
  } catch {
    return messagePage(req, res, 500, 'Study Notes are unavailable right now. Nothing was changed. Please try again later.');
  }
  const points = (record && record.points) || [];
  if (!study && !lessons.length && !notes.length && !points.length) {
    return messagePage(req, res, 404, 'That study isn’t available. It may have been deleted or un-shared.');
  }

  // Sections: the study's own, numbered as the Teacher numbers them; from the
  // member's lessons when the study can no longer be read.
  let sections = study ? teacher.parseLessonSections(study.content) : [];
  if (!study) {
    const withList = lessons.find(l => Array.isArray(l.sections) && l.sections.length);
    if (withList) sections = withList.sections;
    else if (record && Array.isArray(record.sections)) sections = record.sections;
  }
  const has = n => lessons.some(l => l.messages.some(m => inSection(m, n)));
  const list = sections.map(s => ({ n: s.n, title: s.title, teaching: has(s.n) }));
  // A study with no sections is taught as one piece (section 0).
  if (has(0)) list.unshift({ n: 0, title: 'The whole study', teaching: true });

  const earlier = lessons
    .filter(l => l.messages.some(m => !isTagged(m)))
    .map(l => ({ key: l.key, current: l.current, date: l.date }));

  const topic   = (study && study.topic) || (lessons[0] && lessons[0].topic) || (record && record.studyTopic) || 'Untitled study';
  const isOwner = !!study && study.userId === userId;
  const openHref = isOwner ? '/library?open=' + encodeURIComponent(studyId) : '/community?study=' + encodeURIComponent(studyId);
  const hasCurrent = lessons.some(l => l.current);

  const boot = {
    studyId, topic,
    content:  study ? study.content : null,
    openHref: study ? openHref : null,
    sections: list,
    // Only what the page shows.
    notes: notes.map(n => ({
      id: n.id, marker: n.marker, quote: n.quote, occurrence: n.occurrence, question: n.question,
      content: n.content, ts: n.ts,
    })),
    points: points.map(p => ({
      id: p.id, kind: p.kind, section: p.section, part1: p.part1 === true, note: p.note || '',
      content: teacher.displayMessages([{ role: 'assistant', content: p.text }])[0].content,
      // Where "Show in the teaching" goes: only a lesson still on this page.
      show: p.kind === 'lesson' ? showTarget(lessons, p) : null,
    })),
    earlier,
  };

  res.send(renderLayout({
    req, activeSection: 'library', title: 'Study Notes',
    content: `
    <div class="sn-page">
      <div class="sn-header">
        <div class="sn-header-meta">
          <span class="teacher-topbar-label">Study Notes</span>
          <h2 class="teacher-topbar-title">${escapeHtml(topic)}</h2>
        </div>
        <div class="sn-header-tools">
          ${study ? `<a class="sn-link" href="${escapeHtml(openHref)}">Open the study</a>` : ''}
          ${study && hasCurrent ? `<a class="sn-link" href="/teacher/${escapeHtml(encodeURIComponent(studyId))}?mode=lesson&amp;resume=1">Continue the lesson</a>` : ''}
          <span class="ucp-zoom" role="group" aria-label="Study Notes text size">
            <button type="button" class="guide-font-btn guide-font-btn-sm" id="snFontDec" title="Smaller notes text" aria-label="Smaller notes text">A&#8722;</button>
            <button type="button" class="guide-font-btn guide-font-btn-md" id="snFontReset" title="Default notes text" aria-label="Default notes text">A</button>
            <button type="button" class="guide-font-btn guide-font-btn-lg" id="snFontInc" title="Larger notes text" aria-label="Larger notes text">A+</button>
          </span>
        </div>
      </div>
      ${study ? '' : '<p class="sn-unavailable">This study is no longer available.</p>'}
      <div class="sn-body" id="snBody"></div>
    </div>`,
    scripts: `<script src="/js/render-markdown.js?v=2"></script>
<script src="/js/teacher-entry.js?v=10"></script>
<script src="/js/text-size.js?v=1"></script>
<script>window.STUDY_NOTES_BOOT = ${inlineJson(boot)};</script>
<script src="/js/study-notes.js?v=3"></script>`,
  }));
});

// The block and message a point came from: { section } or { earlier: key }, with
// the message's place. null when that conversation is gone.
function showTarget(lessons, p) {
  const l = lessons.find(x => x.sessionId === p.sessionId);
  const m = l && l.messages.find(x => p.messageId ? x.id === p.messageId : x.storedIndex === p.messageIndex);
  if (!m) return null;
  const at = { sessionId: l.sessionId, index: m.storedIndex };
  return isTagged(m) ? Object.assign(at, { section: m.section }) : Object.assign(at, { earlier: l.key });
}

// ─── Saved points ─────────────────────────────────────────────────────────────
// Light, occasional writes; a second, tighter guard under the global /api/ limiter.
const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max:      30,
  message:  { success: false, error: 'Too many requests. Please wait a moment and try again.' },
  standardHeaders: true,
  legacyHeaders:   false,
});
function notesUnavailable(res) {
  return res.status(500).json({ success: false, error: 'Study Notes are unavailable right now. Nothing was changed.' });
}
function gate(req, res, next) {
  if (teacher.memberGated(req)) return res.status(402).json({ success: false, error: 'member_feature', upgradeUrl: '/pricing' });
  next();
}
function cleanNote(v) {
  return typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim().slice(0, NOTE_MAX) : '';
}
// Sections before an Opposing Views study's "# Part 2" heading present the view.
function inPart1(study, section) {
  if (!study || study.studyType !== 'opposing' || !section) return false;
  const at = String(study.content || '').search(/^#\s+part\s*(?:2|two)\b/im);
  return at !== -1 && section <= teacher.parseLessonSections(study.content.slice(0, at)).length;
}

// The saved points of the session now on the Teacher page, with where each one
// is in what the page shows (never any text).
router.get('/api/study-notes/:studyId/points', requireAuth, gate, (req, res) => {
  const userId = req.session.userId;
  const kind = req.query.kind === 'check' ? 'check' : 'lesson';
  let record, session;
  try {
    record  = findRecord(notesStore.read(), userId, req.params.studyId);
    session = teacher.findSession(sessionsStore.read(), userId, req.params.studyId, kind);
  } catch { return notesUnavailable(res); }
  const points = [];
  if (session) {
    ((record && record.points) || []).filter(p => p.sessionId === session.id).forEach(p => {
      const m = (session.messages || [])[p.messageIndex];
      if (!m || m.role !== 'assistant') return;
      points.push({ id: p.id, sessionId: p.sessionId, index: p.messageIndex, shown: shownRange(m.content, p.raw) });
    });
  }
  res.json({ success: true, points });
});

// Body: { kind, sessionId, messageId, index, start, text, note }
router.post('/api/study-notes/:studyId/points', requireAuth, gate, writeLimiter, async (req, res) => {
  const userId  = req.session.userId;
  const studyId = req.params.studyId;
  const b = req.body || {};
  const kind = b.kind === 'check' ? 'check' : 'lesson';
  if (typeof b.text !== 'string' || !b.text.trim() || b.text.length > POINT_MAX * 10 ||
      !Number.isInteger(b.start) || b.start < 0 || !Number.isInteger(b.index) || b.index < 0) {
    return res.status(400).json({ success: false, error: 'Please select part of a reply first.' });
  }
  const study = teacher.findReadableStudy(req, studyId);
  if (!study) return res.status(404).json({ success: false, error: 'That study is no longer available.' });

  let session;
  try { session = teacher.findSession(sessionsStore.read(), userId, studyId, kind); }
  catch { return notesUnavailable(res); }
  const m = session && session.id === b.sessionId ? (session.messages || [])[b.index] : null;
  if (!m || m.role !== 'assistant' || (b.messageId && m.id !== b.messageId)) {
    return res.status(409).json({ success: false, error: 'That reply is no longer in your saved session.' });
  }
  if (kind === 'check' && session.checkPhase !== 'teach') {
    return res.status(400).json({ success: false, error: 'Points can be saved once the questions are finished.' });
  }

  const got = capturePoint(m.content, { start: b.start, text: b.text });
  if (!got) return res.status(422).json({ success: false, error: 'That selection couldn’t be saved. Try selecting whole sentences.' });
  if (got.text.length > POINT_MAX) return res.status(400).json({ success: false, error: 'That’s a lot for one point. Please select a shorter part.' });

  const tagged  = isTagged(m) && m.section >= 1;
  const section = tagged ? m.section : null;
  const list    = Array.isArray(session.lessonSections) ? session.lessonSections : teacher.parseLessonSections(study.content);
  const sec     = section ? list.find(s => s.n === section) : null;
  const now     = new Date().toISOString();
  const point = {
    id: randomUUID(), kind, sessionId: session.id,
    messageId: typeof m.id === 'string' ? m.id : null, messageIndex: b.index,
    section, sectionTitle: sec ? sec.title : null, part1: inPart1(study, section),
    text: got.text, raw: got.raw, note: cleanNote(b.note), ts: now,
  };
  let r;
  try {
    r = await notesStore.update(all => {
      let rec = findRecord(all, userId, studyId);
      if (rec && (rec.points || []).length >= POINTS_MAX) return { changed: false, full: true };
      if (!rec) { rec = { userId, studyId, points: [], recaps: [] }; all.push(rec); }
      rec.studyTopic = study.topic;
      rec.sections   = list;
      rec.points     = (rec.points || []).concat([point]);
      rec.updatedAt  = now;
      return { changed: true };
    });
  } catch (err) {
    console.error('[study-notes] save point:', err.message);
    return notesUnavailable(res);
  }
  if (r.full) return res.status(400).json({ success: false, error: 'Study Notes for this study are full. Delete a point you no longer need first.' });
  res.json({ success: true, point: { id: point.id, sessionId: point.sessionId, index: point.messageIndex, shown: shownRange(m.content, point.raw) } });
});

// Edit the member's own note on a point (body: { note }), or delete the point.
// Both work even if the study can no longer be read: these are the member's own.
function changePoint(change) {
  return async (req, res) => {
    const userId = req.session.userId;
    let r;
    try {
      r = await notesStore.update(all => {
        const rec = findRecord(all, userId, req.params.studyId);
        const i = rec ? (rec.points || []).findIndex(p => p.id === req.params.pointId) : -1;
        if (i === -1) return { changed: false, found: false };
        const now = new Date().toISOString();
        const out = change(rec.points, i, req.body || {}, now, { req, rec });
        if (out.refused) return { changed: false, found: true, refused: true };
        rec.updatedAt = now;
        return Object.assign({ changed: true, found: true }, out);
      });
    } catch (err) {
      console.error('[study-notes] change point:', err.message);
      return notesUnavailable(res);
    }
    if (!r.found) return res.status(404).json({ success: false, error: 'That point is no longer here.' });
    if (r.refused) return res.status(400).json({ success: false, error: 'That section isn’t part of this study.' });
    res.json({ success: true, note: r.note, section: r.section });
  };
}
router.put('/api/study-notes/:studyId/points/:pointId', requireAuth, gate, writeLimiter, changePoint((points, i, body, now) => {
  points[i].note = cleanNote(body.note);
  points[i].updatedAt = now;
  return { note: points[i].note };
}));
// Move a point: body { section: N } (one of the study's sections) or
// { section: null } (no section). Only its place on the page changes; part1 and
// the link to the teaching still say where the words came from.
router.put('/api/study-notes/:studyId/points/:pointId/section', requireAuth, gate, writeLimiter, changePoint((points, i, body, now, { req, rec }) => {
  if (!Object.prototype.hasOwnProperty.call(body, 'section')) return { refused: true };
  let sec = null;
  if (body.section !== null) {
    const study = teacher.findReadableStudy(req, req.params.studyId);
    const list  = study ? teacher.parseLessonSections(study.content) : (Array.isArray(rec.sections) ? rec.sections : []);
    sec = Number.isInteger(body.section) ? list.find(s => s.n === body.section) : null;
    if (!sec) return { refused: true };
  }
  points[i].section      = sec ? sec.n : null;
  points[i].sectionTitle = sec ? sec.title : null;
  points[i].updatedAt    = now;
  return { section: points[i].section };
}));
router.delete('/api/study-notes/:studyId/points/:pointId', requireAuth, gate, writeLimiter, changePoint((points, i) => {
  points.splice(i, 1);
  return {};
}));

module.exports = router;
