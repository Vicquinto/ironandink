const express = require('express');
const { requireAuth, renderLayout } = require('./layout');
const { escapeHtml, inlineJson } = require('../lib/html');
const { sessionsStore, keptStore } = require('../lib/teacher-store');
const teacher = require('./teacher');
const notepad = require('./notepad');

// ─── Study Notes ───────────────────────────────────────────────────────────────
// One page per study for the member's OWN notes, section by section: their
// study-text notes and the full teaching (the lesson conversation itself).
// Read only: Teacher sessions, kept lessons and notepads are read here, never
// written. userId always comes from the session. Behind the Teacher's gate.
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
function visible(messages) { return (messages || []).filter(m => m && teacher.isReaderVisible(m)); }

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
    return { current: l.current, date: (last && last.at) || l.date, messages: teacher.displayMessages(picked) };
  }).filter(l => l.messages.length);
  res.json({ success: true, lessons: out });
});

// ─── GET /study-notes/:studyId ────────────────────────────────────────────────
router.get('/study-notes/:studyId', requireAuth, (req, res) => {
  if (teacher.memberGated(req)) return res.redirect('/pricing?from=teacher');
  const userId  = req.session.userId;
  const studyId = req.params.studyId;
  const study   = teacher.findReadableStudy(req, studyId);

  let lessons, notes;
  try {
    lessons = lessonsFor(userId, studyId);
    notes   = notepad.notesFor(studyId, userId);
  } catch {
    return messagePage(req, res, 500, 'Study Notes are unavailable right now. Nothing was changed. Please try again later.');
  }
  if (!study && !lessons.length && !notes.length) {
    return messagePage(req, res, 404, 'That study isn’t available. It may have been deleted or un-shared.');
  }

  // Sections: the study's own, numbered as the Teacher numbers them; from the
  // member's lessons when the study can no longer be read.
  let sections = study ? teacher.parseLessonSections(study.content) : [];
  if (!study) {
    const withList = lessons.find(l => Array.isArray(l.sections) && l.sections.length);
    if (withList) sections = withList.sections;
  }
  const has = n => lessons.some(l => l.messages.some(m => inSection(m, n)));
  const list = sections.map(s => ({ n: s.n, title: s.title, teaching: has(s.n) }));
  // A study with no sections is taught as one piece (section 0).
  if (has(0)) list.unshift({ n: 0, title: 'The whole study', teaching: true });

  const earlier = lessons
    .filter(l => l.messages.some(m => !isTagged(m)))
    .map(l => ({ key: l.key, current: l.current, date: l.date }));

  const topic   = (study && study.topic) || (lessons[0] && lessons[0].topic) || 'Untitled study';
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
<script src="/js/teacher-entry.js?v=9"></script>
<script src="/js/text-size.js?v=1"></script>
<script>window.STUDY_NOTES_BOOT = ${inlineJson(boot)};</script>
<script src="/js/study-notes.js?v=1"></script>`,
  }));
});

module.exports = router;
