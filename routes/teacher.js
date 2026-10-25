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

// ─── Study with a Teacher ──────────────────────────────────────────────────────
// One AI teacher who walks the reader through a study in order, section by
// section, with the study open beside the conversation. Two kinds of saved
// session on ONE engine (same page, streaming, save/resume, reader controls and
// review — only the opening turn differs):
//   lesson — the walk-through (top button, and "Teach me this section")
//   check  — "Check my understanding"
// Saved sessions are kept per user, per study, PER KIND. Records from the old
// Tutor/Teacher modes (kind "tutor" / "teacher" / no kind) are left in the file
// untouched and never matched here.
// Built on the Dialogue engine (marker-safe SSE streaming + end-of-session review)
// and the Writing companion's study-as-context handling (cached system block).
//
// Unlike Dialogue, the transcript lives on the SERVER: one saved session per user
// per study per kind (data/teacher-sessions.json). The client sends only the new
// message or action; the server owns the history and the lesson state (where the
// lesson is, which sections are done), saves each completed exchange
// automatically, and stores assistant turns RAW (verse markers intact, progress
// tags stripped) so the model never sees verse text it might echo. Verse text is
// injected on the way out.

const router = express.Router();

const STUDIES_PATH  = path.join(__dirname, '../data/studies.json');
const SESSIONS_PATH = path.join(__dirname, '../data/teacher-sessions.json');

// Member-only gate (dark unless BILLING_ENABLED=true) — same idiom as dialogue.js.
const ENT_USERS_PATH = path.join(__dirname, '../data/users.json');
function readUsersEnt() { return JSON.parse(fs.readFileSync(ENT_USERS_PATH, 'utf8')); }
function memberGated(req) {
  const ent = getEntitlements(readUsersEnt().find(u => u.id === req.session.userId));
  return ent.billingEnabled && !ent.canUseMemberFeatures;
}

function readStudies() {
  try {
    if (!fs.existsSync(STUDIES_PATH)) return [];
    return JSON.parse(fs.readFileSync(STUDIES_PATH, 'utf8'));
  } catch { return []; }
}

function readSessions() {
  try {
    if (!fs.existsSync(SESSIONS_PATH)) return [];
    return JSON.parse(fs.readFileSync(SESSIONS_PATH, 'utf8'));
  } catch { return []; }
}

function writeSessions(data) {
  fs.writeFileSync(SESSIONS_PATH, JSON.stringify(data, null, 2));
}

// Old records with no kind were Tutor sessions; like "tutor" and "teacher" they
// match neither of today's kinds, so they are never read, replaced or deleted.
function sessionKind(s) { return s.kind || 'tutor'; }
function findSessionIndex(sessions, userId, studyId, kind) {
  return sessions.findIndex(s => s.userId === userId && s.studyId === studyId && sessionKind(s) === kind);
}
function findSession(sessions, userId, studyId, kind) {
  const i = findSessionIndex(sessions, userId, studyId, kind);
  return i === -1 ? null : sessions[i];
}

// A study the reader may be taught from: their own, or one shared to Community.
function findReadableStudy(req, id) {
  if (!id || typeof id !== 'string') return null;
  const study = readStudies().find(s => s.id === id);
  if (!study) return null;
  if (study.userId === req.session.userId || study.shared === true) return study;
  return null;
}

// Sections are the study's "## " headings in document order — the same line rule
// renderMarkdown uses for <h3 class="guide-h3"> (and marked uses for <h2>).
// "Further Studies" is a jumping-off list, not something to be taught, so the
// lesson's sections skip it and are numbered 1..N without it; teacher-entry.js
// numbers the headings on the page the same way, so the numbers agree.
function cleanHeading(s) {
  return String(s).replace(/\r$/, '').replace(/[*_`]/g, '').trim();
}
const NOT_TEACHABLE_RE = /further\s+stud/i;
function parseLessonSections(content) {
  const out = [];
  String(content || '').split('\n').forEach(line => {
    const m = line.match(/^## (.+)$/);
    if (!m) return;
    const title = cleanHeading(m[1]);
    if (NOT_TEACHABLE_RE.test(title)) return;
    out.push({ n: out.length + 1, title });
  });
  return out;
}
function sessionSections(session, study) {
  return (session && Array.isArray(session.lessonSections)) ? session.lessonSections : parseLessonSections(study.content);
}

// "Further Studies" prompts — same anchor enhance-further-studies.js matches on
// the rendered paragraph text (asterisks are emphasis markup, so ignore them).
function parseFurtherPrompts(content) {
  const out = [];
  String(content || '').split('\n').forEach(line => {
    const t = line.replace(/\r$/, '').replace(/\*+/g, '');
    const m = t.match(/^\s*Study prompt:\s*"([^"]+)"\s*$/);
    if (m && !out.includes(m[1])) out.push(m[1]);
  });
  return out;
}

// Multi-verse quotations in Teacher replies carry verse numbers, the same as the
// study beside them (lib/asv.js numberedVerseText).
const VERSE_NUMBERS = { verseNumbers: true };

// Entry modes: lesson (top button), section ("Teach me this section"), check.
// Links saved before the rebuild (mode=full / mode=teacher) open the lesson.
const VALID_MODES = ['lesson', 'section', 'check'];
function cleanMode(m) {
  if (m === 'full' || m === 'teacher') return 'lesson';
  return VALID_MODES.includes(m) ? m : 'lesson';
}
const KINDS = ['lesson', 'check'];
function kindOfMode(mode) { return mode === 'check' ? 'check' : 'lesson'; }
function cleanKind(k) { return KINDS.includes(k) ? k : 'lesson'; }
const MAX_MESSAGE_CHARS  = 4000;
const MAX_SESSION_MESSAGES = 300;
const GENERIC_ERROR = "The teacher couldn't respond. Please try again.";

// The Teacher's own reading-level line, from the member's study level setting.
// (Study generation keeps dialogue.js's STUDY_LEVEL_INSTRUCTIONS, which are
// written for writing studies, not teaching them.)
const TEACHING_LEVEL_INSTRUCTIONS = {
  foundations: 'TEACHING LEVEL: FOUNDATIONAL. The reader is newer to theology. Define terms in plain words as they come up, explain each step of reasoning, and take smaller steps. Same substance as any level; more patience in the explaining.',
  journeyman:  "TEACHING LEVEL: STANDARD. The reader has some working theological vocabulary. Define genuinely technical or uncommon terms as they come up; don't stop to define the basics.",
  scholar:     "TEACHING LEVEL: ADVANCED. The reader is comfortable with theological and confessional vocabulary and the shape of Reformed exegetical argument. Be precise and don't pause on common terms. You may engage original-language detail and the confessions more directly.",
};
function getTeachingLevelInstruction(settings) {
  const level = (settings && settings.studyLevel) || 'journeyman';
  return TEACHING_LEVEL_INSTRUCTIONS[level] || TEACHING_LEVEL_INSTRUCTIONS.journeyman;
}

// Hidden tags each reply ends with: [[at:N]] (the section it's teaching) and,
// when a reply finishes a section, [[done:N]]. Both are stripped from everything
// the reader sees and stored; the last [[at]] wins, every [[done]] counts.
const TAG_RE = /\s*\[\[\s*(at|done)\s*:\s*([^\]\n]*?)\s*\]\]/gi;
function stripTags(text) {
  let at = null;
  const done = [];
  const out = String(text).replace(TAG_RE, (_m, kind, val) => {
    const n = parseInt(val, 10);
    if (n >= 0) {
      if (kind.toLowerCase() === 'at') at = n;
      else done.push(n);
    }
    return '';
  });
  return { text: out, at, done };
}

// Lesson state from a reply's tags. The SERVER keeps the lesson in order; the
// tags are only proposals:
//   opening (top button)      → section 1, whatever the tags say; [[done]] ignored
//   opening (section N) / jump → section N; [[done]] ignored
//   any other reply           → [[done:N]] only for N = the current section, and
//       only if an EARLIER reply was already teaching it (taughtSections);
//       [[at:N]] only for the current section, or the next one once the current
//       section is done (a [[done]] accepted in this same reply counts)
// So a section can never be started and finished in the reply that first enters
// it, and the lesson can never skip a section. A check session isn't a
// walk-through: any valid [[at]] is accepted there, [[done]] never.
// Returns what was accepted, for the log line.
function applyTags(session, turnType, at, done, jumpSection) {
  const len     = (session.lessonSections || []).length;
  const doneSet = new Set(session.doneSections || []);
  const taught  = new Set(session.taughtSections || []);
  const prev    = session.currentSection || 0;
  let cur = prev;
  const acceptedDone = [];
  if (session.kind === 'check') {
    if (at !== null && at >= 0 && at <= len) cur = at;
  } else if (turnType === 'opening') {
    cur = session.mode === 'section' ? (session.startSection || 0) : (len ? 1 : 0);
  } else if (turnType === 'jump') {
    cur = jumpSection;
  } else {
    if (prev >= 1 && taught.has(prev) && done.includes(prev) && !doneSet.has(prev)) {
      doneSet.add(prev);
      acceptedDone.push(prev);
    }
    if (at !== null && at === prev + 1 && at <= len && (prev === 0 || doneSet.has(prev))) cur = at;
  }
  if (cur >= 1) taught.add(cur);           // this reply was teaching `cur`
  session.currentSection = cur;
  session.doneSections   = Array.from(doneSet).sort((a, b) => a - b);
  session.taughtSections = Array.from(taught).sort((a, b) => a - b);
  session.finished       = len > 0 && doneSet.has(len);
  return { at: cur, done: acceptedDone };
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

function lessonSummary(session) {
  return {
    currentSection: session.currentSection || 0,
    doneSections:   session.doneSections || [],
    finished:       !!session.finished,
    currentTitle:   session.currentSection ? sectionTitle(session, session.currentSection) : '',
    resumeText:     resumeText(session),
  };
}

// A reader turn the transcript shows: typed text, or a button tap (stored as a
// hidden instruction with the button's label as `display`).
function isReaderVisible(m) { return !m.hidden || !!m.display; }

// Transcript for display: hidden (system-authored) turns dropped, button taps
// shown by their label, assistant turns get verified verse text injected plus
// the Lockman notice when NASB appears.
function displayTranscript(session) {
  return (session.messages || [])
    .filter(isReaderVisible)
    .map(m => ({
      role:    m.role,
      content: m.role === 'assistant'
        ? injectWithAttribution(m.content, undefined, VERSE_NUMBERS)
        : (m.display || m.content),
    }));
}

function savedSummary(session) {
  if (!session) return null;
  return Object.assign({
    kind:      sessionKind(session),
    mode:      session.mode,
    updatedAt: session.updatedAt,
    turns:     (session.messages || []).filter(m => m.role === 'user' && isReaderVisible(m)).length,
  }, lessonSummary(session));
}

// ─── Hidden turns ─────────────────────────────────────────────────────────────
// The opening (hidden) user turn for each entry point.
function openingTurn(mode, sec) {
  if (mode === 'section') {
    return "(The reader tapped Teach me this section on section " + sec.n + ", '" + sec.title + "'. In one or two sentences, tell them where this section sits in the study's argument and what came before it. Then begin teaching section " + sec.n + ' — actually teach its first part. Do not ask the reader any question in this reply.)';
  }
  if (mode === 'check') {
    return 'The reader has finished the study and tapped "Check my understanding". Open with one short line saying you\'ll ask a few questions to see how the study has settled, and that \'I\'m not sure\' is a fine answer. Then ask 3-4 short check questions covering the study\'s main points — ONE per reply, waiting for each answer. During the check, respond to each answer with at most one short sentence (a brief affirmation or a gentle note) before the next question; save fuller teaching for afterward. After the last check question is answered, tell them in a sentence or two what they have well, then teach whatever they missed, one point at a time, following your normal teaching method.';
  }
  return '(The reader tapped Study with a Teacher. Begin the lesson. First, in one short paragraph, tell them what this study is about and why it matters for them. Then name the route in one sentence or a short plain list of the section titles from LESSON STATE. Then begin teaching section 1 — actually teach its first part, don\'t just introduce it. Do not ask the reader any question in this reply; end at a natural stopping place so they can tap Continue.)';
}

const RESUME_TURN = {
  lesson: '(The reader has come back to continue the lesson. In one sentence, remind them where you were. Then carry on teaching from there. Do not quiz them on what came before. If your last reply ended with a question the reader never answered, don\'t re-ask it; just carry on teaching.)',
  check:  '(The reader has come back to continue this session after a break. In one short sentence, remind them where you were, then ask your last question again — or the next one, if they had already answered it.)',
};

// Reader controls. Each button posts an action; the server adds the hidden
// instruction and the transcript shows the button's label as the reader's turn.
const ACTIONS = {
  continue: {
    label: 'Continue',
    text:  "(The reader tapped Continue. Carry on teaching from exactly where you stopped. If you had finished the current section, move into the next section in LESSON STATE. If you asked a question and they skipped it, don't repeat it; just teach on.)",
  },
  deeper: {
    label: 'Go deeper',
    text:  "(The reader tapped Go deeper. Stay on the point you were just teaching and take it further: more of the text, the reasoning, the connections to the rest of Scripture or the confessions, the objection a careful reader would raise and its answer. Don't move to new material in the study yet.)",
  },
  simpler: {
    label: 'Say that more simply',
    text:  "(The reader tapped Say that more simply. Re-teach your last point in plainer words, shorter sentences, and one fresh everyday picture. Then stop. Don't move ahead.)",
  },
  quiz: {
    label: 'Ask me a question',
    text:  '(The reader tapped Ask me a question. Ask ONE good question on what you have just taught — one that makes them think about the text or the argument, not recall a fact. Then wait for their answer. When they answer, respond to it honestly and warmly, then carry on teaching.)',
  },
};
function jumpTurn(sec) {
  return "(The reader wants to go to section " + sec.n + ", '" + sec.title + "'. In one or two sentences, connect it to where you were or to what comes before it in the study, then begin teaching that section.)";
}
function jumpLabel(sec) { return 'Teach me this section: ' + sec.title; }

// The per-turn LESSON STATE block (system, AFTER the cached study block).
function lessonStateText(session) {
  const sections = session.lessonSections || [];
  const lines = ['LESSON STATE'];
  if (session.kind === 'check') {
    lines.push('This session is "Check my understanding", not the walk-through: follow the check instructions given at the start. Inside this check, the rule about asking questions only when asked (or at the end of a section) does not apply. Use [[at:N]] for the section the current question or teaching is about (0 when it spans the whole study); [[done:N]] is not needed.');
  }
  if (!sections.length) {
    lines.push('Sections: (This study has no numbered sections. Teach it in order as one piece and use [[at:0]] throughout.)');
    return lines.join('\n');
  }
  lines.push('Sections:');
  sections.forEach(s => lines.push(s.n + '. ' + s.title));
  const cur = session.currentSection || 0;
  lines.push(cur ? 'Now in: section ' + cur + ', "' + sectionTitle(session, cur) + '"'
                 : 'Now in: the opening overview (no section begun yet)');
  const done = session.doneSections || [];
  lines.push('Finished: ' + (done.length ? done.join(', ') : 'none yet'));
  const next = sections[cur]; // the section after the current one (sections[0] while in the overview)
  lines.push(next ? 'Next: section ' + next.n + ', "' + next.title + '"' : 'Next: none — this is the last section');
  if (session.finished) lines.push('Every section has now been taught.');
  return lines.join('\n');
}

// ─── GET /teacher/:studyId ────────────────────────────────────────────────────
router.get('/teacher/:studyId', requireAuth, (req, res) => {
  if (memberGated(req)) return res.redirect('/pricing?from=teacher');
  const study = findReadableStudy(req, req.params.studyId);
  if (!study) {
    return res.status(404).send(renderLayout({
      req,
      activeSection: 'teacher',
      title: 'Study with a Teacher',
      content: `
        <div class="page-header">
          <h2 class="page-title">Study with a Teacher</h2>
          <p class="page-subtitle">That study isn&#8217;t available. It may have been deleted or un-shared.</p>
        </div>
        <a class="btn-warm" href="/library">Back to Library</a>`,
    }));
  }

  const lessonSections = parseLessonSections(study.content);
  let mode = cleanMode(req.query.mode);
  let section = parseInt(req.query.section, 10);
  if (mode === 'section' && !(section >= 1 && section <= lessonSections.length)) mode = 'lesson';
  if (mode !== 'section') section = null;
  const kind = kindOfMode(mode);

  const saved = findSession(readSessions(), req.session.userId, study.id, kind);
  const isOwner = study.userId === req.session.userId;

  const boot = {
    studyId:     study.id,
    topic:       study.topic,
    content:     study.content,
    translation: study.translation || 'ASV',
    sections:    sessionSections(saved, study),
    kind,
    entry:       { mode, section },
    saved:       savedSummary(saved),
    isOwner,
    rootId:      study.rootId || study.id,
    // Completion is the owner's alone: sent only for their own study.
    completedAt: isOwner ? (study.completedAt || null) : null,
  };

  const content = `
    <div class="teacher-page">
      <div class="teacher-topbar">
        <div class="teacher-topbar-meta">
          <span class="teacher-topbar-label">Study with a Teacher</span>
          <h2 class="teacher-topbar-title">${escapeHtml(study.topic)}</h2>
        </div>
        <a class="btn-warm teacher-back-link" href="${isOwner ? '/library' : '/community'}">&#8592; Back</a>
      </div>

      <div class="teacher-workspace">
        <section class="teacher-study-pane" aria-label="The study">
          <div class="guide-body teacher-study-body" id="teacherStudyBody"></div>
        </section>

        <section class="teacher-conversation" id="teacherConversation" aria-label="Conversation">
          <div class="conversation-header">
            <span class="teacher-header-meta">
              <span class="conversation-header-title">Your Teacher</span>
              <span class="teacher-now" id="teacherNow"></span>
            </span>
            <span class="teacher-header-tools">
              <!-- Display-only zoom for the conversation (messages, input, reader
                   controls) — Writing companion's pattern, own localStorage key;
                   see TFONT_* in teacher.js. -->
              <span class="conversation-zoom" role="group" aria-label="Conversation text size">
                <button class="guide-font-btn guide-font-btn-sm" id="teacherFontDec" title="Smaller text" aria-label="Smaller text">A&#8722;</button>
                <button class="guide-font-btn guide-font-btn-md" id="teacherFontReset" title="Reset text size" aria-label="Reset text size">A</button>
                <button class="guide-font-btn guide-font-btn-lg" id="teacherFontInc" title="Larger text" aria-label="Larger text">A+</button>
              </span>
              <button class="btn-end-session" id="teacherEndBtn" disabled>End Session</button>
            </span>
          </div>

          <div id="teacherResume" class="teacher-resume" style="display:none;">
            <p class="teacher-resume-text" id="teacherResumeText"></p>
            <div class="teacher-resume-actions">
              <button class="btn-primary" id="teacherResumeBtn">Pick up where we left off</button>
              <button class="btn-warm" id="teacherStartOverBtn">Start over</button>
              <button class="btn-discard" id="teacherDeleteBtn">Delete saved session</button>
            </div>
          </div>

          <div id="teacherMessages" class="chat-messages teacher-messages" aria-live="polite"></div>

          <div class="chat-input-area teacher-input-area">
            <textarea id="teacherInput" class="chat-textarea" rows="2"
                      placeholder="Ask a question, or answer&#8230;" disabled></textarea>
            <div class="teacher-quick-replies" id="teacherQuickReplies">
              <button type="button" class="teacher-quick-btn" data-action="continue" disabled>Continue</button>
              <button type="button" class="teacher-quick-btn" data-action="deeper" disabled>Go deeper</button>
              <button type="button" class="teacher-quick-btn" data-action="simpler" disabled>Say that more simply</button>
              <button type="button" class="teacher-quick-btn" data-action="quiz" disabled>Ask me a question</button>
            </div>
            <div class="chat-input-actions">
              <button class="btn-primary" id="teacherSendBtn" disabled>Send</button>
              <button class="btn-stop" id="teacherStopBtn" style="display:none;">Stop</button>
            </div>
          </div>
        </section>
      </div>
    </div>

    <div id="teacherReviewModal" class="end-modal-overlay" style="display:none;" role="dialog" aria-modal="true" aria-label="Session review">
      <div class="end-session-card teacher-review-card">
        <p class="end-session-quote">&#8220;Well done. Here is where you are.&#8221;</p>
        <div id="teacherReviewLoading" class="gap-loading" style="display:none;">
          <div class="study-spinner gap-spinner"></div>
          <p class="loading-text">Looking back over your session&#8230;</p>
        </div>
        <div id="teacherReviewResults" style="display:none;">
          <div class="gap-summary-box gap-strengths-box" id="teacherWellBox">
            <p class="gap-part-label">What you understand well</p>
            <ul class="teacher-review-list" id="teacherWellList"></ul>
          </div>
          <div class="gap-summary-box" id="teacherRevisitBox">
            <p class="gap-part-label">Worth revisiting</p>
            <ul class="teacher-review-list" id="teacherRevisitList"></ul>
          </div>
          <p class="gap-study-next-label" id="teacherNextLine">Suggested next study: <em id="teacherNextText"></em></p>
          <!-- Owner only, and only while the study is not completed: a gentle offer,
               never automatic (public/js/teacher.js). -->
          <div class="teacher-complete-offer" id="teacherCompleteOffer" hidden></div>
        </div>
        <p class="teacher-review-error" id="teacherReviewError" style="display:none;">The review couldn&#8217;t be prepared this time. Your session is still saved.</p>
        <div id="teacherReviewActions" class="end-session-actions" style="display:none;">
          <button class="btn-primary" id="teacherNextBtn" style="display:none;">Study this next &#8594;</button>
          <button class="btn-warm" id="teacherKeepBtn">Back to the study</button>
          <button class="btn-discard" id="teacherReviewDeleteBtn">Delete saved session</button>
        </div>
        <p class="teacher-review-saved-note">Your session is saved &#8212; you can pick it up again anytime.</p>
      </div>
    </div>`;

  res.send(renderLayout({
    req,
    activeSection: 'teacher',
    title: 'Study with a Teacher',
    content,
    scripts: `<script src="/js/render-markdown.js?v=2"></script>
<script src="/js/teacher-entry.js?v=4"></script>
<script>window.TEACHER_BOOT = ${inlineJson(boot)};</script>
<script src="/js/teacher.js?v=6"></script>`,
  }));
});

// ─── GET /api/teacher/:studyId/session ────────────────────────────────────────
router.get('/api/teacher/:studyId/session', requireAuth, (req, res) => {
  const study = findReadableStudy(req, req.params.studyId);
  if (!study) return res.status(404).json({ success: false, error: 'Study not found.' });
  const session = findSession(readSessions(), req.session.userId, study.id, cleanKind(req.query.kind));
  if (!session) return res.json({ success: true, session: null });
  res.json({
    success: true,
    session: Object.assign(savedSummary(session), {
      transcript: displayTranscript(session),
      review:     session.review || null,
    }),
  });
});

// ─── DELETE /api/teacher/:studyId/session ─────────────────────────────────────
// Keyed on the study id + the session's own userId, so it works even after the
// study itself was deleted or un-shared (the reader can always clear their data).
router.delete('/api/teacher/:studyId/session', requireAuth, (req, res) => {
  const sessions = readSessions();
  const idx = findSessionIndex(sessions, req.session.userId, req.params.studyId, cleanKind(req.query.kind));
  if (idx === -1) return res.status(404).json({ success: false, error: 'No saved session.' });
  sessions.splice(idx, 1);
  writeSessions(sessions);
  res.json({ success: true });
});

// ─── POST /api/teacher/exchange (streaming SSE) ───────────────────────────────
// Body: { studyId, kind, start?: { mode, section }, resume?: true,
//         action?: 'continue'|'deeper'|'simpler'|'quiz'|'jump', section?: N, message?: string }
//   start  → begin a NEW session (replaces any saved one of the same kind; the
//            kind comes from start.mode)
//   resume → continue the saved session with a hidden "welcome back" turn
//   action → a reader control (jump: move the saved lesson to section N)
//   else   → the reader's typed message in the saved session
router.post('/api/teacher/exchange', requireAuth, aiLimiter, async (req, res) => {
  if (memberGated(req)) return res.status(402).json({ success: false, error: 'member_feature', upgradeUrl: '/pricing' });
  const { studyId, start, resume, action, message } = req.body || {};
  const kind = start ? kindOfMode(cleanMode(start.mode)) : cleanKind(req.body && req.body.kind);

  const study = findReadableStudy(req, studyId);
  if (!study) return res.status(404).json({ success: false, error: 'That study is no longer available.' });

  const sessions = readSessions();
  const existing = findSession(sessions, req.session.userId, study.id, kind);

  // Work out the session this turn belongs to and the new user turn to add.
  let session;
  let newTurn;
  if (start) {
    const lessonSections = parseLessonSections(study.content);
    let mode = cleanMode(start.mode);
    let sectionNum = parseInt(start.section, 10);
    if (mode === 'section' && !(sectionNum >= 1 && sectionNum <= lessonSections.length)) mode = 'lesson';
    if (mode !== 'section') sectionNum = null;
    const now = new Date().toISOString();
    session = {
      id:             randomUUID(),
      userId:         req.session.userId,
      studyId:        study.id,
      studyTopic:     study.topic,
      kind,
      mode,
      startSection:   sectionNum,
      lessonSections,
      currentSection: sectionNum || 0,
      doneSections:   [],
      taughtSections: [],
      finished:       false,
      messages:       [],
      review:         null,
      createdAt:      now,
      updatedAt:      now,
    };
    newTurn = { role: 'user', content: openingTurn(mode, lessonSections[sectionNum - 1]), hidden: true };
    const du = req.session.user || {};
    logEvent(du.id || req.session.userId, du.fullName, 'teacher_started', { kind, mode });
  } else {
    if (!existing) return res.status(409).json({ success: false, error: 'No saved session to continue. Please start again.' });
    session = existing;
    if (!Array.isArray(session.lessonSections)) session.lessonSections = parseLessonSections(study.content);
    if (resume) {
      newTurn = { role: 'user', content: RESUME_TURN[kind], hidden: true };
    } else if (action !== undefined && action !== null) {
      if (typeof action !== 'string') return res.status(400).json({ success: false, error: 'Unknown action.' });
      if (action === 'jump') {
        if (kind !== 'lesson') return res.status(400).json({ success: false, error: 'Unknown action.' });
        const n = parseInt(req.body.section, 10);
        const sec = session.lessonSections.find(s => s.n === n);
        if (!sec) return res.status(400).json({ success: false, error: 'That section isn’t part of this lesson.' });
        newTurn = { role: 'user', content: jumpTurn(sec), hidden: true, display: jumpLabel(sec), action: 'jump', section: sec.n };
      } else if (Object.prototype.hasOwnProperty.call(ACTIONS, action)) {
        newTurn = { role: 'user', content: ACTIONS[action].text, hidden: true, display: ACTIONS[action].label, action };
      } else {
        return res.status(400).json({ success: false, error: 'Unknown action.' });
      }
    } else {
      const text = typeof message === 'string' ? message.trim() : '';
      if (!text) return res.status(400).json({ success: false, error: 'Please type a question or an answer first.' });
      if (text.length > MAX_MESSAGE_CHARS) return res.status(400).json({ success: false, error: 'That message is too long. Please shorten it.' });
      newTurn = { role: 'user', content: text };
    }
    if ((session.messages || []).length >= MAX_SESSION_MESSAGES) {
      return res.status(400).json({ success: false, error: 'This session has grown very long. Please end it and start fresh.' });
    }
  }

  const { IRON_INK_CORE_PROMPT, IRON_INK_TEACHER_PROMPT } = req.app.locals.prompts;
  const userSettings = req.session.user && req.session.user.settings;
  const levelInstruction = getTeachingLevelInstruction(userSettings);

  // System prompt as blocks (Writing companion pattern): the Teacher prompt, then
  // the study itself, then the lesson state. The cache breakpoint sits on the
  // study block, so the prompt + study are billed at the cached rate on every turn
  // after the first; the small LESSON STATE block comes after it, so a change in
  // the lesson's position never invalidates the study cache.
  const systemBlocks = [
    { type: 'text', text: levelInstruction + '\n\n' + IRON_INK_CORE_PROMPT + '\n\n' + IRON_INK_TEACHER_PROMPT },
    {
      type: 'text',
      text: 'THE STUDY YOU ARE TEACHING\nTitle: ' + study.topic + '\n\n' +
        'FULL STUDY TEXT (the reader sees this rendered beside the conversation; verse markers in it are filled with real text on their screen). ' +
        'In a multi-verse quotation, each verse begins with its verse number in superscript (e.g. "¹¹for though the twins…" is verse 11), and the reader sees those numbers too — so you can point them to a verse by number ("look at verse 11"):\n"""\n' +
        study.content + '\n"""',
      cache_control: { type: 'ephemeral' },
    },
    { type: 'text', text: lessonStateText(session) },
  ];

  // API messages — the stored history plus the new turn. The final user turn also
  // carries a cache breakpoint so the growing conversation is cached turn to turn.
  const history = (session.messages || []).map(m => ({ role: m.role, content: m.content }));
  const apiMessages = history.concat([{
    role: 'user',
    content: [{ type: 'text', text: newTurn.content, cache_control: { type: 'ephemeral' } }],
  }]);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  let closed = false;

  try {
    // Opus 5.5 always thinks and thinking counts toward max_tokens, so the
    // ceiling carries headroom well above these replies.
    const stream = client.messages.stream({
      model:         'claude-opus-5-5',
      max_tokens:    6000,
      output_config: { effort: 'medium' },
      system:        systemBlocks,
      messages:      apiMessages,
    });

    req.on('close', () => {
      closed = true;
      try { stream.abort(); } catch {}
    });

    // Marker-safe streaming (Dialogue's flush): hold back an in-progress verse
    // marker ("{{") AND an in-progress progress tag ("[[" — [[at:N]] / [[done:N]]),
    // so neither is ever split across SSE chunks. Completed progress tags are
    // stripped (the reader never sees them); completed verse markers become real
    // verse text.
    let raw = '';
    let buf = '';
    let atLineStart = true;
    let usedNasb = false;
    function heldFrom(s, open, close) {
      const i = s.lastIndexOf(open);
      return (i !== -1 && s.indexOf(close, i) === -1) ? i : -1;
    }
    function flush(final) {
      if (closed || res.writableEnded) { buf = ''; return; }
      let cut = buf.length;
      if (!final) {
        const holds = [heldFrom(buf, '{{', '}}'), heldFrom(buf, '[[', ']]')].filter(i => i !== -1);
        if (holds.length) cut = Math.min.apply(null, holds);
        else if (buf.endsWith('{') || buf.endsWith('[')) cut = buf.length - 1;
      }
      const slice = stripTags(buf.slice(0, cut)).text;
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
    console.log(`[Teacher/${kind}] usage — input:${u.input_tokens} cache_read:${u.cache_read_input_tokens} cache_write:${u.cache_creation_input_tokens} output:${u.output_tokens} stop:${finalMsg.stop_reason}`);

    const { text: replyText, at, done } = stripTags(raw);
    const reply = replyText.trim();

    // Opus 5.5 safety classifiers can decline with stop_reason 'refusal' (HTTP 200).
    if (finalMsg.stop_reason === 'refusal') {
      console.error('[Teacher/' + kind + '] refusal — category:', finalMsg.stop_details && finalMsg.stop_details.category);
    }
    if (!reply) {
      if (!closed && !res.writableEnded) {
        res.write(`data: ${JSON.stringify({ error: GENERIC_ERROR })}\n\n`);
        res.end();
      }
      return;
    }

    // Persist the completed exchange (a turn the reader aborted is never saved).
    // Re-read the file so a concurrent write (another tab, a delete) isn't lost.
    if (!closed) {
      const all = readSessions();
      const idx = findSessionIndex(all, req.session.userId, study.id, kind);
      if (start) {
        if (idx !== -1) all.splice(idx, 1);
        all.push(session);
      } else if (idx === -1 || all[idx].id !== session.id) {
        // The saved session was deleted or replaced mid-turn — don't resurrect it.
        session = null;
      } else {
        const lessonSections = session.lessonSections;
        session = all[idx];
        if (!Array.isArray(session.lessonSections)) session.lessonSections = lessonSections;
      }
      if (session) {
        session.messages = (session.messages || []).concat([newTurn, { role: 'assistant', content: reply }]);
        const turnType = start ? 'opening' : (newTurn.action === 'jump' ? 'jump' : 'reply');
        const accepted = applyTags(session, turnType, at, done, newTurn.section);
        console.log(`[Teacher/${kind}] tags at:${at === null ? 'none' : at} done:${done.length ? done.join(',') : 'none'}` +
          ` -> accepted at:${accepted.at} done:${accepted.done.length ? accepted.done.join(',') : 'none'} (${turnType})`);
        session.review    = null;          // a stale review no longer describes the session
        session.updatedAt = new Date().toISOString();
        writeSessions(all);
      }
    }

    if (!closed && !res.writableEnded) {
      flush(true);
      if (usedNasb) res.write(`data: ${JSON.stringify({ text: NASB_ATTRIBUTION_MD })}\n\n`);
      if (session) res.write(`data: ${JSON.stringify({ lesson: lessonSummary(session) })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  } catch (err) {
    if (!res.writableEnded) {
      if (!closed) {
        console.error('[Teacher/' + kind + '] API error — status:', err.status, '| type:', err.error?.type, '| message:', err.message);
        res.write(`data: ${JSON.stringify({ error: GENERIC_ERROR })}\n\n`);
      }
      res.end();
    }
  }
});

// ─── POST /api/teacher/review ─────────────────────────────────────────────────
// End-of-session review, adapted from Dialogue's /api/dialogue/gaps: what the
// reader understands well, what's worth revisiting (each tied to a study section,
// or an outside topic), and one suggested next study — from this study's own
// Further Studies when one fits. Built from the reader's own turns: button taps
// appear by label only, never as their hidden instructions.
router.post('/api/teacher/review', requireAuth, aiLimiter, async (req, res) => {
  if (memberGated(req)) return res.status(402).json({ success: false, error: 'member_feature', upgradeUrl: '/pricing' });
  const { studyId } = req.body || {};
  const kind = cleanKind(req.body && req.body.kind);
  const study = findReadableStudy(req, studyId);
  if (!study) return res.status(404).json({ success: false, error: 'That study is no longer available.' });

  const session = findSession(readSessions(), req.session.userId, study.id, kind);
  const visible = session ? (session.messages || []).filter(isReaderVisible) : [];
  if (!visible.some(m => m.role === 'user')) {
    return res.json({ success: true, review: null });   // nothing from the reader yet — nothing to review
  }

  const sections = sessionSections(session, study);
  const further  = parseFurtherPrompts(study.content);

  const transcriptText = visible
    .map(m => {
      if (m.role === 'assistant') return 'Teacher: ' + m.content;
      if (m.display) return 'Reader (tapped a button): ' + m.display;
      return 'Reader: ' + m.content;
    })
    .join('\n\n');
  const sectionList = sections.length ? sections.map(s => s.n + '. ' + s.title).join('\n') : '(none)';
  const taught = new Set(session.doneSections || []);
  if (session.currentSection) taught.add(session.currentSection);
  const taughtList = Array.from(taught).sort((a, b) => a - b)
    .filter(n => sections[n - 1])
    .map(n => n + '. ' + sections[n - 1].title).join('\n') || '(none yet — the session stayed on the overview)';
  const furtherList = further.length ? further.map((p, i) => (i + 1) + '. ' + p).join('\n') : '(none)';

  const userPrompt =
    'A reader has just had a one-on-one lesson with a teacher on the study "' + study.topic + '".\n\n' +
    (kind === 'check'
      ? 'This session was "Check my understanding": a few questions on the whole study, then teaching on whatever the reader missed.\n\n'
      : '') +
    'STUDY SECTIONS:\n' + sectionList + '\n\n' +
    'SECTIONS TAUGHT IN THIS SESSION:\n' + taughtList + '\n\n' +
    'THIS STUDY\'S FURTHER STUDIES LIST:\n' + furtherList + '\n\n' +
    'SESSION TRANSCRIPT:\n' + transcriptText + '\n\n' +
    'Write a warm, honest review for the reader, addressed to them as "you". Never grade or score them.\n' +
    'Base understandWell and revisit on the reader\'s OWN questions and answers in the transcript, not on what the teacher covered. Lines marked "Reader (tapped a button)" are button taps (Continue, Go deeper, Say that more simply, Ask me a question, or a jump to a section), not answers. If the reader mostly tapped Continue and asked or answered little, it is fine to say so gently and keep both lists short; do not invent understanding they did not show.\n' +
    '1. understandWell — up to 3 things the reader showed they genuinely understand, in their own questions or answers. Be concrete, never flattery. If they showed little either way, one item or an empty list is fine.\n' +
    '2. revisit — up to 3 points worth going back over, where their answers or questions were thin or the teaching had to correct them. If nothing needs revisiting, return an empty list.\n' +
    'Each item is one plain sentence (no Scripture quotations, no verse markers) plus the number of the study section it belongs to (from STUDY SECTIONS), or null if none fits.\n' +
    'The reader\'s questions may have reached beyond the study. For a revisit item that no study section fits, set section to null and give "topic": the outside subject or passage worth revisiting, in 8 words or fewer (for example "Romans 8 and the Spirit\'s work"). Otherwise set "topic" to null.\n' +
    '3. nextStudy — one study to take up next. If an item on the FURTHER STUDIES LIST fits what this reader most needs, give its number as furtherIndex. Otherwise set furtherIndex to null and give a topic of 8 words or fewer.\n\n' +
    'Return ONLY this JSON: { "understandWell": [{ "point": "...", "section": 1 }], "revisit": [{ "point": "...", "section": 2, "topic": null }], "nextStudy": { "furtherIndex": 1, "topic": "..." } }';

  const { IRON_INK_CORE_PROMPT } = req.app.locals.prompts;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    const message = await client.messages.create({
      model:         'claude-opus-5-5',
      max_tokens:    6000,
      output_config: { effort: 'medium' },
      system:        IRON_INK_CORE_PROMPT,
      messages:      [{ role: 'user', content: userPrompt }],
    });
    // The response can open with (empty) thinking blocks — read text blocks only.
    const text = message.content.filter(b => b.type === 'text').map(b => b.text).join('');
    if (message.stop_reason === 'refusal' || !text) {
      throw new Error('no text returned — stop_reason: ' + message.stop_reason);
    }
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');
    const parsed = JSON.parse(jsonMatch[0]);

    // Validate everything the model returned: plain strings only (any stray verse
    // marker collapses to its reference), section numbers checked against the
    // real section list, the next study resolved against the real Further list.
    const plain = s => String(s || '').replace(/\{\{\s*verse\s*:\s*([^}]+?)\s*\}\}/gi, '$1').trim().slice(0, 400);
    // An outside topic is kept only when no study section fits.
    const items = (list, allowTopic) => (Array.isArray(list) ? list : []).slice(0, 3).map(it => {
      const n = parseInt(it && it.section, 10);
      const sec = sections[n - 1] || null;
      const topic = (allowTopic && !sec) ? (plain(it && it.topic).slice(0, 80) || null) : null;
      return { point: plain(it && it.point), section: sec ? sec.n : null, sectionTitle: sec ? sec.title : null, topic };
    }).filter(it => it.point);

    let nextStudy = null;
    const ns = parsed.nextStudy || {};
    const fi = parseInt(ns.furtherIndex, 10);
    if (fi >= 1 && fi <= further.length) nextStudy = { topic: further[fi - 1], fromFurther: true };
    else if (plain(ns.topic)) nextStudy = { topic: plain(ns.topic).slice(0, 120), fromFurther: false };

    const review = {
      understandWell: items(parsed.understandWell, false),
      revisit:        items(parsed.revisit, true),
      nextStudy,
      at:             new Date().toISOString(),
    };

    // Keep the review with the saved session (best effort — re-read before write).
    const all = readSessions();
    const s = findSession(all, req.session.userId, study.id, kind);
    if (s && s.id === session.id) { s.review = review; writeSessions(all); }

    res.json({ success: true, review });
  } catch (err) {
    console.error('[Teacher/review]', err.status || '', err.message);
    res.status(500).json({ success: false, error: "The review couldn't be prepared. Please try again." });
  }
});

module.exports = router;
