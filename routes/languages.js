const express   = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const fs        = require('fs');
const path      = require('path');
const { randomUUID } = require('crypto');
const { requireAuth, renderLayout } = require('./layout');
const { escapeHtml, inlineJson } = require('../lib/html');
const { injectVersesTracked, injectWithAttribution, NASB_ATTRIBUTION_MD } = require('../lib/asv');
const { logEvent } = require('../lib/usageLog');
const { getEntitlements } = require('../lib/entitlements');
const { aiLimiter } = require('../middleware/rateLimit');
const original = require('../lib/original');
const lang = require('../lib/languages');
const { TEACHER_ACTIONS } = require('./teacher');

// ─── Languages ─────────────────────────────────────────────────────────────────
// /languages                       course cards (Greek open, Hebrew coming soon)
// /languages/:course               the lesson list
// /languages/:course/review        vocabulary review, one card at a time
// /languages/:course/:lessonId     the lesson page: materials LEFT, lesson teacher RIGHT
//
// The lesson teacher runs on the Teacher engine's pattern (routes/teacher.js):
// the server owns the transcript (data/lang_sessions.json, one per user per
// course per lesson), saves each completed exchange, and "Pick up where you left
// off" redraws the saved conversation with no AI call. Its context — the lesson
// materials and the learner's learned words — is built here from courses/ and
// orig/ (lib/languages.js), never taken from the client.
//
// Course and lesson ids are always checked against course.json; userId always
// comes from the session.

const router = express.Router();

// Member-only gate for the AI teacher (dark unless BILLING_ENABLED=true) — the
// Teacher's idiom. Pages and review are open to every logged-in member.
const ENT_USERS_PATH = path.join(__dirname, '../data/users.json');
function memberGated(req) {
  try {
    const users = JSON.parse(fs.readFileSync(ENT_USERS_PATH, 'utf8'));
    const ent = getEntitlements(users.find(u => u.id === req.session.userId));
    return ent.billingEnabled && !ent.canUseMemberFeatures;
  } catch { return false; }
}

const MAX_MESSAGE_CHARS    = 4000;
const MAX_SESSION_MESSAGES = 300;
const GENERIC_ERROR = "The teacher couldn't respond. Please try again.";
const VERSE_NUMBERS = { verseNumbers: true };

// ─── Hidden turns (verbatim) ─────────────────────────────────────────────────
// Reading-lesson openings, per course (verbatim).
const READING_OPENINGS = {
  hebrew: '(The learner opened the reading lesson, Genesis 1:1–5. In two or three sentences explain how it works: they will read the passage verse by verse, right to left; each word is shown split into its parts, and parts not yet learned show their meaning beside them; they can click any word for details. Then begin with verse 1: take the first word, and ask the learner to find its parts and say what each means. In this lesson, let the learner do the reading and help them only as much as they need.)',
};
function openingTurn(L, courseId) {
  if (L.type === 'reading' && READING_OPENINGS[courseId]) return READING_OPENINGS[courseId];
  if (L.type === 'reading') {
    return '(The learner opened the reading lesson, 1 John 1:1–10. In two or three sentences explain how it works: they will read the passage verse by verse; words not yet learned show their meaning in the passage beside them; they can click any word for details. Then begin with verse 1: take the first short phrase, and ask the learner to try the words they know, one at a time. In this lesson, let the learner do the reading and help them only as much as they need.)';
  }
  return "(The learner opened lesson " + L.number + ", '" + L.title + "'. Greet them in one short sentence, say in one sentence what this lesson covers, then begin teaching the first goal. Do not ask a question in this reply.)";
}
const ACTIONS = {
  continue: { label: 'Continue', text: '(The learner tapped Continue. Carry on teaching from exactly where you stopped.)' },
  simpler:  { label: 'Say that more simply', text: TEACHER_ACTIONS.simpler.text },
  quiz:     { label: 'Quiz me', text: "(The learner tapped Quiz me. Ask ONE short question on this lesson's material that they can answer from what has been taught: what a word means, which case, person or number a form shows, or what a short phrase from an example verse says. Use only Greek from the materials. Wait for the answer, respond honestly and briefly, then offer another question or to carry on.)" },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
function openCourse(req) {
  const id = String(req.params.course || '');
  return lang.getCourse(id) ? id : null;
}
function isVisible(m) { return !m.hidden || !!m.display; }
function displayTranscript(s) {
  return (s.messages || []).filter(isVisible).map(m => ({
    role: m.role,
    content: m.role === 'assistant' ? injectWithAttribution(m.content, undefined, VERSE_NUMBERS) : (m.display || m.content),
  }));
}
function savedSummary(s) {
  if (!s) return null;
  return { updatedAt: s.updatedAt || null, turns: (s.messages || []).filter(m => m.role === 'user' && isVisible(m)).length };
}
function notFound(req, res, msg) {
  res.status(404).send(renderLayout({
    req, activeSection: 'languages', title: 'Languages',
    content: `
      <div class="page-header">
        <h2 class="page-title">Languages</h2>
        <p class="page-subtitle">${escapeHtml(msg)}</p>
      </div>
      <a class="btn-warm" href="/languages">Back to Languages</a>`,
  }));
}
function formatDate(iso) {
  const d = new Date(iso);
  if (!iso || isNaN(d)) return '';
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Denver' });
}

// ─── GET /languages ──────────────────────────────────────────────────────────
router.get('/languages', requireAuth, (req, res) => {
  const cards = lang.COURSE_ORDER.map(id => {
    const C = lang.COURSES[id];
    if (C.status === 'open' && lang.getCourse(id)) {
      return `
        <a class="lang-course-card" href="/languages/${escapeHtml(id)}">
          <h3 class="lang-course-title">${escapeHtml(C.title)}</h3>
          <p class="lang-course-blurb">${escapeHtml(C.blurb)}</p>
          <span class="lang-course-go">Open the course &#8594;</span>
        </a>`;
    }
    return `
        <div class="lang-course-card is-soon" aria-disabled="true">
          <h3 class="lang-course-title">${escapeHtml(C.title)}</h3>
          <p class="lang-course-blurb">Coming soon</p>
        </div>`;
  }).join('');
  res.send(renderLayout({
    req, activeSection: 'languages', title: 'Languages',
    content: `
      <div class="page-header">
        <h2 class="page-title">Languages</h2>
        <p class="page-subtitle">Learn to read Scripture in the language it was written in.</p>
      </div>
      <div class="lang-courses">${cards}
      </div>`,
  }));
});

// ─── GET /languages/:course ──────────────────────────────────────────────────
router.get('/languages/:course', requireAuth, (req, res) => {
  const courseId = openCourse(req);
  if (!courseId) return notFound(req, res, 'That course isn’t available.');
  const C = lang.COURSES[courseId];
  const st = lang.courseState(req.session.userId, courseId);
  const nextId = st.next ? st.next.id : null;

  const rows = st.lessons.map(l => {
    const status = l.status === 'completed'
      ? `<span class="lang-lesson-status">Completed &#183; ${escapeHtml(formatDate(l.completedAt))}</span>`
      : l.status === 'in_progress' ? '<span class="lang-lesson-status">In progress</span>' : '';
    const builds = l.prereqs.length
      ? `<span class="lang-lesson-builds">Builds on lesson${l.prereqs.length > 1 ? 's' : ''} ${escapeHtml(l.prereqs.length > 3 ? '1–' + l.prereqs[l.prereqs.length - 1] : l.prereqs.join(', '))}</span>`
      : '';
    const go = l.id === nextId
      ? `<a class="btn-primary lang-lesson-go" href="/languages/${escapeHtml(courseId)}/${escapeHtml(l.id)}">${l.status === 'in_progress' ? 'Continue' : 'Start'}</a>`
      : '';
    return `
        <li class="lang-lesson-row${l.id === nextId ? ' is-next' : ''}">
          <span class="lang-lesson-num">${l.number}</span>
          <div class="lang-lesson-main">
            <a class="lang-lesson-title" href="/languages/${escapeHtml(courseId)}/${escapeHtml(l.id)}">${escapeHtml(l.title)}</a>
            <div class="lang-lesson-meta">
              <span class="lang-lesson-type">${escapeHtml(l.typeLabel)}</span>${status ? ' &#183; ' + status : ''}${builds ? ' &#183; ' + builds : ''}
            </div>
          </div>
          ${go}
        </li>`;
  }).join('');

  // "Why learn" intro and manuscript image (course.json "manuscript").
  const extLink = (href, text) => `<a class="lang-ext-link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(text)}<span class="lang-ext-icon" aria-hidden="true">↗</span><span class="lang-sr-only"> (opens in a new tab)</span></a>`;
  const introData = lang.manuscriptIntro(courseId);
  const imageData = lang.manuscriptImage(courseId);
  const intro = introData ? `
      <section class="lang-intro">
        <h3 class="lang-intro-title">${escapeHtml(introData.heading)}</h3>
        <p>${escapeHtml(introData.text)}</p>
      </section>` : '';
  const image = imageData ? `
      <figure class="lang-ms-figure">
        <a href="${escapeHtml(imageData.href)}" target="_blank" rel="noopener noreferrer"><img src="${escapeHtml(imageData.src)}" alt="${escapeHtml(imageData.alt)}" loading="lazy"><span class="lang-sr-only"> (opens in a new tab)</span></a>
        <figcaption>${imageData.caption.map(it => it.href ? extLink(it.href, it.text) : escapeHtml(it.text)).join('')}</figcaption>
      </figure>` : '';
  const listenText = lang.listeningOverview(courseId);
  const listenNote = listenText ? `
      <p class="lang-listen-note">${escapeHtml(listenText)}</p>` : '';
  const review = `
      <p class="lang-review-link"><a href="/languages/${escapeHtml(courseId)}/review">Vocabulary review</a>${st.due ? ` &#183; ${st.due} word${st.due === 1 ? '' : 's'} to review` : ''}</p>`;

  res.send(renderLayout({
    req, activeSection: 'languages', title: C.title,
    content: `
      <div class="page-header">
        <h2 class="page-title">${escapeHtml(C.title)}</h2>
        <p class="page-subtitle">${escapeHtml(C.blurb)}</p>
      </div>
      ${intro}${image}${review}${listenNote}
      <ol class="lang-lessons">${rows}
      </ol>
      <p class="lang-credit">${escapeHtml(C.credit)}</p>
      <a class="lang-back" href="/languages">&#8592; All languages</a>`,
  }));
});

// ─── GET /languages/:course/review ───────────────────────────────────────────
router.get('/languages/:course/review', requireAuth, (req, res) => {
  const courseId = openCourse(req);
  if (!courseId) return notFound(req, res, 'That course isn’t available.');
  const C = lang.COURSES[courseId];
  const boot = { course: courseId, lang: C.lang, direction: C.direction || 'ltr', cards: lang.dueCards(req.session.userId, courseId) };
  res.send(renderLayout({
    req, activeSection: 'languages', title: 'Vocabulary review',
    content: `
      <div class="page-header">
        <h2 class="page-title">Vocabulary review</h2>
        <p class="page-subtitle">${escapeHtml(C.name)}</p>
      </div>
      <div class="lang-review" id="langReview" aria-live="polite"></div>
      <p class="lang-credit">${escapeHtml(C.credit)}</p>
      <a class="lang-back" href="/languages/${escapeHtml(courseId)}">&#8592; Back to the course</a>`,
    scripts: `<script>window.LANG_REVIEW_BOOT = ${inlineJson(boot)};</script>
<script src="/js/lang-review.js?v=2"></script>`,
  }));
});

// ─── GET /languages/:course/:lessonId ────────────────────────────────────────
router.get('/languages/:course/:lessonId', requireAuth, (req, res) => {
  const courseId = openCourse(req);
  if (!courseId) return notFound(req, res, 'That course isn’t available.');
  const c = lang.getCourse(courseId);
  const L = lang.getLesson(c, req.params.lessonId);
  if (!L) return notFound(req, res, 'That lesson isn’t part of this course.');
  const C = lang.COURSES[courseId];
  const materials = lang.lessonMaterials(courseId, L.id);
  const progress = lang.readProgress(req.session.userId, courseId);
  const st = progress.lessons[L.id] || null;
  let saved = null;
  try { saved = savedSummary(lang.readSession(req.session.userId, courseId, L.id)); } catch (err) { console.error('[languages] sessions:', err.message); }
  const next = c.lessons[L.index + 1] || null;

  const boot = {
    course: courseId, lessonId: L.id, number: L.number, title: L.title, type: L.type,
    materials, saved,
    listening: lang.listeningForLesson(courseId, L.id),
    manuscript: lang.manuscriptForLesson(courseId, L.id),
    wordVoice: lang.wordVoice(courseId),
    status: st ? st.status : null,
    completedAt: st && st.status === 'completed' ? st.completedAt : null,
    next: next ? { id: next.id, number: next.number, title: next.title } : null,
    courseUrl: '/languages/' + courseId,
  };

  const content = `
    <div class="teacher-page lang-lesson-page">
      <div class="teacher-topbar">
        <div class="teacher-topbar-meta">
          <span class="teacher-topbar-label">${escapeHtml(C.name)} &#183; Lesson ${L.number} &#183; ${escapeHtml(lang.TYPE_LABELS[L.type] || L.type)}</span>
          <h2 class="teacher-topbar-title">${escapeHtml(L.title)}</h2>
        </div>
        <div class="lang-topbar-tools">
          <span class="lang-complete" id="langComplete"></span>
          <a class="btn-warm teacher-back-link" href="/languages/${escapeHtml(courseId)}">&#8592; All lessons</a>
        </div>
      </div>

      <div class="teacher-workspace">
        <section class="teacher-study-pane lang-materials-pane" aria-label="Lesson materials">
          <div class="lang-materials-tools">
            <!-- The highlight panel's A−/A/A+ and its saved size (library.js UCP_FONT_*). -->
            <span class="ucp-zoom" role="group" aria-label="Lesson text size">
              <button class="guide-font-btn guide-font-btn-sm" id="langFontDec" title="Smaller text" aria-label="Smaller text">A&#8722;</button>
              <button class="guide-font-btn guide-font-btn-md" id="langFontReset" title="Reset text size" aria-label="Reset text size">A</button>
              <button class="guide-font-btn guide-font-btn-lg" id="langFontInc" title="Larger text" aria-label="Larger text">A+</button>
            </span>
          </div>
          <div class="lang-materials" id="langMaterials"></div>
          <p class="lang-credit">${escapeHtml(C.credit)}</p>
        </section>

        <section class="teacher-conversation" id="langConversation" aria-label="Conversation">
          <div class="conversation-header">
            <span class="teacher-header-meta">
              <span class="conversation-header-title">Your ${escapeHtml(C.name)} teacher</span>
            </span>
            <span class="ucp-zoom lang-teacher-zoom" role="group" aria-label="Teacher text size">
              <button type="button" class="guide-font-btn guide-font-btn-sm" id="langTeacherFontDec" title="Smaller teacher text" aria-label="Smaller teacher text">A&#8722;</button>
              <button type="button" class="guide-font-btn guide-font-btn-md" id="langTeacherFontReset" title="Default teacher text" aria-label="Default teacher text">A</button>
              <button type="button" class="guide-font-btn guide-font-btn-lg" id="langTeacherFontInc" title="Larger teacher text" aria-label="Larger teacher text">A+</button>
            </span>
          </div>

          <div id="langResume" class="teacher-resume" style="display:none;">
            <p class="teacher-resume-text" id="langResumeText"></p>
            <div class="teacher-resume-actions">
              <button class="btn-primary" id="langResumeBtn">Pick up where you left off</button>
              <button class="btn-warm" id="langStartOverBtn">Start over</button>
              <button class="btn-discard" id="langDeleteBtn">Delete saved session</button>
            </div>
          </div>

          <div id="langMessages" class="chat-messages teacher-messages" aria-live="polite"></div>

          <div class="chat-input-area teacher-input-area">
            <textarea id="langInput" class="chat-textarea" rows="2" placeholder="Ask a question, or answer&#8230;" disabled></textarea>
            <div class="teacher-quick-replies">
              <button type="button" class="teacher-quick-btn" data-action="continue" disabled>Continue</button>
              <button type="button" class="teacher-quick-btn" data-action="simpler" disabled>Say that more simply</button>
              <button type="button" class="teacher-quick-btn" data-action="quiz" disabled>Quiz me</button>
            </div>
            <div class="chat-input-actions">
              <button class="btn-primary" id="langSendBtn" disabled>Send</button>
              <button class="btn-stop" id="langStopBtn" style="display:none;">Stop</button>
            </div>
          </div>
        </section>
      </div>
    </div>`;

  res.send(renderLayout({
    req, activeSection: 'languages', title: L.title,
    content,
    scripts: `<script src="/js/render-markdown.js?v=2"></script>
<script src="/js/orig-words.js?v=2"></script>
<script src="/js/geo-map.js?v=3"></script><script src="/js/library.js?v=88"></script>
<script>window.LANG_LESSON_BOOT = ${inlineJson(boot)};</script>
<script src="/js/lang-lesson.js?v=10"></script>`,
  }));
});

// ─── Saved session: GET / DELETE ─────────────────────────────────────────────
function lessonFromParams(req) {
  const courseId = openCourse(req);
  if (!courseId) return null;
  const L = lang.getLesson(lang.getCourse(courseId), req.params.lessonId);
  return L ? { courseId, L } : null;
}

router.get('/api/languages/:course/:lessonId/session', requireAuth, (req, res) => {
  const hit = lessonFromParams(req);
  if (!hit) return res.status(404).json({ success: false, error: 'Lesson not found.' });
  let s;
  try { s = lang.readSession(req.session.userId, hit.courseId, hit.L.id); }
  catch (err) { return res.status(500).json({ success: false, error: 'Your saved session couldn’t be loaded.' }); }
  if (!s) return res.json({ success: true, session: null });
  res.json({ success: true, session: Object.assign(savedSummary(s), { transcript: displayTranscript(s) }) });
});

router.delete('/api/languages/:course/:lessonId/session', requireAuth, async (req, res) => {
  const hit = lessonFromParams(req);
  if (!hit) return res.status(404).json({ success: false, error: 'Lesson not found.' });
  try {
    const r = await lang.sessionsStore.update(list => {
      const i = list.findIndex(s => s.userId === req.session.userId && s.course === hit.courseId && s.lessonId === hit.L.id);
      if (i === -1) return { changed: false, found: false };
      list.splice(i, 1);
      return { changed: true, found: true };
    });
    if (!r.found) return res.status(404).json({ success: false, error: 'No saved session.' });
    res.json({ success: true });
  } catch (err) {
    console.error('[languages] delete session:', err.message);
    res.status(500).json({ success: false, error: 'The saved session couldn’t be deleted.' });
  }
});

// ─── Mark lesson complete / Undo ─────────────────────────────────────────────
router.post('/api/languages/:course/:lessonId/complete', requireAuth, async (req, res) => {
  const hit = lessonFromParams(req);
  if (!hit) return res.status(404).json({ success: false, error: 'Lesson not found.' });
  const completed = !!(req.body && req.body.completed === true);
  try {
    const r = await lang.setCompleted(req.session.userId, hit.courseId, hit.L.id, completed);
    const st = r.record.lessons[hit.L.id] || null;
    res.json({ success: true, status: st ? st.status : null, completedAt: st && st.status === 'completed' ? st.completedAt : null });
  } catch (err) {
    console.error('[languages] complete:', err.message);
    res.status(500).json({ success: false, error: 'Could not update this lesson. Please try again.' });
  }
});

// ─── Vocabulary review ───────────────────────────────────────────────────────
router.get('/api/languages/:course/review', requireAuth, (req, res) => {
  const courseId = openCourse(req);
  if (!courseId) return res.status(404).json({ success: false, error: 'Course not found.' });
  res.json({ success: true, cards: lang.dueCards(req.session.userId, courseId) });
});

router.post('/api/languages/:course/review', requireAuth, async (req, res) => {
  const courseId = openCourse(req);
  if (!courseId) return res.status(404).json({ success: false, error: 'Course not found.' });
  const key = req.body && typeof req.body.key === 'string' ? req.body.key.slice(0, 80) : '';
  const result = req.body && req.body.result;
  if (!key || (result !== 'knew' && result !== 'notyet')) return res.status(400).json({ success: false, error: 'Invalid review.' });
  try {
    const r = await lang.recordReview(req.session.userId, courseId, key, result);
    if (r.error) return res.status(400).json({ success: false, error: r.error });
    res.json({ success: true, box: r.card.box, due: r.card.due });
  } catch (err) {
    console.error('[languages] review:', err.message);
    res.status(500).json({ success: false, error: 'That couldn’t be saved. Please try again.' });
  }
});

// ─── POST /api/languages/exchange (streaming SSE) ────────────────────────────
// Body: { course, lessonId, start?: true, action?: 'continue'|'simpler'|'quiz', message?: string }
//   start  → begin a NEW session for this lesson (replaces a saved one once the
//            teacher replies)
//   action → a learner control
//   else   → the learner's typed message in the saved session
router.post('/api/languages/exchange', requireAuth, aiLimiter, async (req, res) => {
  if (memberGated(req)) return res.status(402).json({ success: false, error: 'member_feature', upgradeUrl: '/pricing' });
  const body = req.body || {};
  const courseId = typeof body.course === 'string' && lang.getCourse(body.course) ? body.course : null;
  if (!courseId) return res.status(404).json({ success: false, error: 'That course isn’t available.' });
  const L = lang.getLesson(lang.getCourse(courseId), body.lessonId);
  if (!L) return res.status(404).json({ success: false, error: 'That lesson isn’t part of this course.' });
  const userId = req.session.userId;

  let existing;
  try { existing = lang.readSession(userId, courseId, L.id); }
  catch (err) { return res.status(500).json({ success: false, error: 'Your saved session couldn’t be read. Please try again later.' }); }

  let session, newTurn;
  const start = body.start === true;
  if (start) {
    const now = new Date().toISOString();
    session = { id: randomUUID(), userId, course: courseId, lessonId: L.id, messages: [], createdAt: now, updatedAt: now };
    newTurn = { role: 'user', content: openingTurn(L, courseId), hidden: true };
    const du = req.session.user || {};
    logEvent(du.id || userId, du.fullName, 'language_lesson_started', { course: courseId, lesson: L.id });
  } else {
    if (!existing) return res.status(409).json({ success: false, error: 'No saved session to continue. Please start again.' });
    session = existing;
    const action = body.action;
    if (action !== undefined && action !== null) {
      if (typeof action !== 'string' || !Object.prototype.hasOwnProperty.call(ACTIONS, action)) {
        return res.status(400).json({ success: false, error: 'Unknown action.' });
      }
      newTurn = { role: 'user', content: ACTIONS[action].text, hidden: true, display: ACTIONS[action].label, action };
    } else {
      const text = typeof body.message === 'string' ? body.message.trim() : '';
      if (!text) return res.status(400).json({ success: false, error: 'Please type a question or an answer first.' });
      if (text.length > MAX_MESSAGE_CHARS) return res.status(400).json({ success: false, error: 'That message is too long. Please shorten it.' });
      newTurn = { role: 'user', content: text };
    }
    if ((session.messages || []).length >= MAX_SESSION_MESSAGES) {
      return res.status(400).json({ success: false, error: 'This session has grown very long. Please start over.' });
    }
  }

  const prompts = req.app.locals.prompts;
  const teacherPrompt = prompts[lang.COURSES[courseId].promptKey];
  const materials = lang.materialsText(courseId, L.id);
  const learned   = lang.learnedWordsText(courseId, L.id);
  const contextText = materials + '\n\n' + learned;
  // Prompt, then the lesson's materials + learned words (stable per lesson, so
  // cached), as the Teacher does with the study text.
  const systemBlocks = [
    { type: 'text', text: prompts.IRON_INK_CORE_PROMPT + '\n\n' + teacherPrompt },
    { type: 'text', text: contextText, cache_control: { type: 'ephemeral' } },
  ];
  const history = (session.messages || []).map(m => ({ role: m.role, content: m.content }));
  const apiMessages = history.concat([{ role: 'user', content: [{ type: 'text', text: newTurn.content, cache_control: { type: 'ephemeral' } }] }]);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  let closed = false;
  try {
    const stream = client.messages.stream({
      model:         'claude-opus-5-5',
      max_tokens:    6000,
      output_config: { effort: 'medium' },
      system:        systemBlocks,
      messages:      apiMessages,
    });
    req.on('close', () => { closed = true; try { stream.abort(); } catch {} });

    // Marker-safe streaming (the Teacher's flush): an in-progress {{verse:…}}
    // marker is held back until it closes, then becomes verified verse text.
    let raw = '', buf = '', atLineStart = true, usedNasb = false;
    function flush(final) {
      if (closed || res.writableEnded) { buf = ''; return; }
      let cut = buf.length;
      if (!final) {
        const i = buf.lastIndexOf('{{');
        if (i !== -1 && buf.indexOf('}}', i) === -1) cut = i;
        else if (buf.endsWith('{')) cut = buf.length - 1;
      }
      const slice = buf.slice(0, cut);
      buf = buf.slice(cut);
      const { text: emit, sources } = injectVersesTracked(slice, atLineStart, VERSE_NUMBERS);
      if (sources.nasb) usedNasb = true;
      if (slice) atLineStart = slice.endsWith('\n');
      if (emit) res.write(`data: ${JSON.stringify({ text: emit })}\n\n`);
    }
    stream.on('text', (text) => {
      raw += text;
      if (closed || res.writableEnded) return;
      buf += text;
      flush(false);
    });

    const finalMsg = await stream.finalMessage();
    const u = finalMsg.usage || {};
    console.log(`[Languages/${courseId}/${L.id}] usage — input:${u.input_tokens} cache_read:${u.cache_read_input_tokens} cache_write:${u.cache_creation_input_tokens} output:${u.output_tokens} stop:${finalMsg.stop_reason}`);
    if (finalMsg.stop_reason === 'refusal') {
      console.error(`[Languages/${courseId}] refusal — category:`, finalMsg.stop_details && finalMsg.stop_details.category);
    }
    const reply = raw.trim();
    if (!reply) {
      if (!closed && !res.writableEnded) { res.write(`data: ${JSON.stringify({ error: GENERIC_ERROR })}\n\n`); res.end(); }
      return;
    }

    // Monitoring only (the reply is never altered): Greek the teacher wrote that
    // is not in the materials or learned-words blocks, compared NFC-normalized.
    // Hebrew is compared with the shared normalization (lib/hebrew-text.js).
    const stray = lang.strayScript(courseId, reply, contextText);
    if (stray.length) console.warn(`[Languages/${courseId}/${L.id}] WARNING ${lang.COURSES[courseId].languageName} not in materials: ${stray.slice(0, 12).join(' ')}`);

    // Persist the completed exchange (an aborted turn is never saved). Inside the
    // store's queue: re-read, so a delete or another tab isn't lost or undone.
    let saved = false;
    if (!closed) {
      try {
        const r = await lang.sessionsStore.update(list => {
          const i = list.findIndex(s => s.userId === userId && s.course === courseId && s.lessonId === L.id);
          let rec;
          if (start) {
            if (i !== -1) list.splice(i, 1);
            rec = session;
            list.push(rec);
          } else {
            if (i === -1 || list[i].id !== session.id) return { changed: false };   // deleted or replaced mid-turn
            rec = list[i];
          }
          rec.messages = (rec.messages || []).concat([newTurn, { role: 'assistant', content: reply }]);
          rec.updatedAt = new Date().toISOString();
          return { changed: true };
        });
        saved = !!r.changed;
      } catch (err) {
        console.error('[languages] save session:', err.message);
      }
      if (saved && start) {
        try { await lang.markStarted(userId, courseId, L.id); } catch (err) { console.error('[languages] mark started:', err.message); }
      }
    }

    if (!closed && !res.writableEnded) {
      flush(true);
      if (usedNasb) res.write(`data: ${JSON.stringify({ text: NASB_ATTRIBUTION_MD })}\n\n`);
      res.write(`data: ${JSON.stringify({ saved })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  } catch (err) {
    if (!res.writableEnded) {
      if (!closed) {
        console.error(`[Languages/${courseId}] API error — status:`, err.status, '| type:', err.error?.type, '| message:', err.message);
        res.write(`data: ${JSON.stringify({ error: GENERIC_ERROR })}\n\n`);
      }
      res.end();
    }
  }
});

module.exports = router;
