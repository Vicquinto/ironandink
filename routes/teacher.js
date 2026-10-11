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
const { getStudyLevelInstruction } = require('./dialogue');

// ─── Study with a Tutor / Study with a Teacher ─────────────────────────────────
// AI conversations that teach the reader one study, one question at a time, in
// two kinds on ONE engine (same page, streaming, save/resume, quick replies and
// review — only the instructions differ):
//   tutor   — section by section (modes full / section / check); [[at:N]] tag
//   teacher — the big questions behind the study (mode teacher); [[topic:…]] tag
// Saved sessions are kept per user, per study, PER KIND, so a Tutor session and
// a Teacher session on the same study never overwrite each other. (Sessions
// saved before the split carry no kind and are read as tutor.)
// Built on the Dialogue engine (marker-safe SSE streaming + end-of-session review)
// and the Writing companion's study-as-context handling (cached system block).
//
// Unlike Dialogue, the transcript lives on the SERVER: one saved session per user
// per study (data/teacher-sessions.json). The client sends only the new message;
// the server owns the history, saves each completed exchange automatically, and
// stores assistant turns RAW (verse markers intact, progress tag stripped) so the
// model never sees verse text it might echo. Verse text is injected on the way out.

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

// Sections are the study's "## " headings, numbered from 1 in document order.
// This is the same line rule renderMarkdown uses for <h3 class="guide-h3"> (and
// marked uses for <h2>), so the client's heading count lines up with these numbers.
function cleanHeading(s) {
  return String(s).replace(/\r$/, '').replace(/[*_`]/g, '').trim();
}
function parseSections(content) {
  const out = [];
  String(content || '').split('\n').forEach(line => {
    const m = line.match(/^## (.+)$/);
    if (m) out.push({ n: out.length + 1, title: cleanHeading(m[1]) });
  });
  return out;
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

// Multi-verse quotations in Tutor/Teacher replies carry verse numbers, the same
// as the study beside them (lib/asv.js numberedVerseText).
const VERSE_NUMBERS = { verseNumbers: true };

const VALID_MODES = ['full', 'section', 'check', 'teacher'];
const KINDS = ['tutor', 'teacher'];
function kindOfMode(mode) { return mode === 'teacher' ? 'teacher' : 'tutor'; }
function cleanKind(k) { return KINDS.includes(k) ? k : 'tutor'; }
const KIND_LABEL = {
  tutor:   { title: 'Study with a Tutor',   who: 'tutor',   Who: 'Tutor' },
  teacher: { title: 'Study with a Teacher', who: 'teacher', Who: 'Teacher' },
};
const MAX_MESSAGE_CHARS  = 4000;
const MAX_SESSION_MESSAGES = 300;

// Hidden tags each reply ends with: [[at:N]] (Tutor — the section it's in) or
// [[topic:…]] (Teacher — what the conversation is on). Both are stripped from
// everything the reader sees and stored; the last one of each wins.
const TAG_RE = /\s*\[\[\s*(at|topic)\s*:\s*([^\]\n]*?)\s*\]\]/gi;
function stripTags(text) {
  let at = null, topic = null;
  const out = String(text).replace(TAG_RE, (_m, kind, val) => {
    if (kind.toLowerCase() === 'at') { const n = parseInt(val, 10); if (n >= 0) at = n; }
    else topic = String(val).replace(/[{}\[\]<>]/g, '').trim().slice(0, 80) || topic;
    return '';
  });
  return { text: out, at, topic };
}

function coveredLabel(session, sections) {
  if (!session) return '';
  if (sessionKind(session) === 'teacher') return session.coveredTopic || 'the big question behind this study';
  const n = session.coveredSection;
  if (n && sections[n - 1]) return sections[n - 1].title;
  if (session.mode === 'check') return 'a check of your understanding';
  if (session.mode === 'section' && sections[session.startSection - 1]) return sections[session.startSection - 1].title;
  return 'the opening of the study';
}

// Transcript for display: hidden (system-authored) turns dropped, assistant turns
// get verified verse text injected plus the Lockman notice when NASB appears.
function displayTranscript(session) {
  return (session.messages || [])
    .filter(m => !m.hidden)
    .map(m => ({
      role:    m.role,
      content: m.role === 'assistant' ? injectWithAttribution(m.content, undefined, VERSE_NUMBERS) : m.content,
    }));
}

function savedSummary(session, sections) {
  if (!session) return null;
  return {
    kind:         sessionKind(session),
    mode:         session.mode,
    coveredLabel: coveredLabel(session, sections),
    updatedAt:    session.updatedAt,
    turns:        (session.messages || []).filter(m => !m.hidden && m.role === 'user').length,
  };
}

// The opening (hidden) user turn for each entry point.
const HOW_IT_WORKS = 'Open with ONE short line explaining how this works: one question at a time, and "I don\'t know" is a great answer.';
function openingTurn(mode, sectionNum, sections) {
  if (mode === 'section') {
    const s = sections[sectionNum - 1];
    return 'The reader tapped "Tutor me on this section" on section ' + s.n + ', "' + s.title + '". ' + HOW_IT_WORKS +
      ' Then begin teaching that section: one or two plain sentences to orient them, then your first question on it.';
  }
  if (mode === 'check') {
    return 'The reader has finished the study and tapped "Check my understanding". ' + HOW_IT_WORKS +
      ' Say you will start with a few quick check questions. Then ask 3-4 short check questions covering the study\'s main points — ONE per reply, waiting for each answer. During the check, respond to each answer with at most one short sentence (a brief affirmation or a gentle note) before the next question; save fuller teaching for afterward. After the last check question is answered, tell them in a sentence or two what they have well, then teach whatever they missed, one point at a time, following your normal teaching method.';
  }
  if (mode === 'teacher') {
    return 'The reader tapped "Study with a Teacher" to talk through the big questions behind this study. Open with ONE short line explaining how this works: we\'ll talk through the big questions together, one question at a time, and "I don\'t know" is a great answer. ' +
      'Then state, in plain everyday words, the BIG question the whole study answers, and ask what the reader already understands about it. Do not start teaching yet.';
  }
  return 'The reader wants to be taught this study from the beginning. ' + HOW_IT_WORKS +
    ' Then ask which section of the study they have already reached, so you know where to begin. Do not start teaching yet.';
}

const RESUME_TURN = '(The reader has come back to continue this session after a break. In one short sentence, remind them where you were, then ask your last question again — or the next one, if they had already answered it.)';

// ─── GET /teacher/:studyId ────────────────────────────────────────────────────
router.get('/teacher/:studyId', requireAuth, (req, res) => {
  if (memberGated(req)) return res.redirect('/pricing?from=teacher');
  const study = findReadableStudy(req, req.params.studyId);
  if (!study) {
    return res.status(404).send(renderLayout({
      req,
      activeSection: 'teacher',
      title: 'Study with a Tutor or Teacher',
      content: `
        <div class="page-header">
          <h2 class="page-title">Study with a Tutor or Teacher</h2>
          <p class="page-subtitle">That study isn&#8217;t available. It may have been deleted or un-shared.</p>
        </div>
        <a class="btn-warm" href="/library">Back to Library</a>`,
    }));
  }

  const sections = parseSections(study.content);
  let mode = VALID_MODES.includes(req.query.mode) ? req.query.mode : 'full';
  let section = parseInt(req.query.section, 10);
  if (mode === 'section' && !(section >= 1 && section <= sections.length)) mode = 'full';
  if (mode !== 'section') section = null;
  const kind  = kindOfMode(mode);
  const label = KIND_LABEL[kind];

  const saved = findSession(readSessions(), req.session.userId, study.id, kind);
  const isOwner = study.userId === req.session.userId;

  const boot = {
    studyId:     study.id,
    topic:       study.topic,
    content:     study.content,
    translation: study.translation || 'ASV',
    sections,
    kind,
    entry:       { mode, section },
    saved:       savedSummary(saved, sections),
    isOwner,
    rootId:      study.rootId || study.id,
    // Completion is the owner's alone: sent only for their own study.
    completedAt: isOwner ? (study.completedAt || null) : null,
  };

  const content = `
    <div class="teacher-page">
      <div class="teacher-topbar">
        <div class="teacher-topbar-meta">
          <span class="teacher-topbar-label">${label.title}</span>
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
            <span class="conversation-header-title">Your ${label.who}</span>
            <span class="teacher-header-tools">
              <!-- Display-only zoom for the conversation (messages, input, quick
                   replies) — Writing companion's pattern, own localStorage key;
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
              <button class="btn-primary" id="teacherResumeBtn">Continue</button>
              <button class="btn-warm" id="teacherStartOverBtn">Start over</button>
              <button class="btn-discard" id="teacherDeleteBtn">Delete saved session</button>
            </div>
          </div>

          <div id="teacherMessages" class="chat-messages teacher-messages" aria-live="polite"></div>

          <div class="chat-input-area teacher-input-area">
            <textarea id="teacherInput" class="chat-textarea" rows="2"
                      placeholder="Your answer&#8230;" disabled></textarea>
            <div class="teacher-quick-replies" id="teacherQuickReplies">
              <button type="button" class="teacher-quick-btn" data-reply="I don't know" disabled>I don&#8217;t know</button>
              <button type="button" class="teacher-quick-btn" data-reply="Give me a hint" disabled>Give me a hint</button>
              <button type="button" class="teacher-quick-btn" data-reply="Explain that" disabled>Explain that</button>
              <button type="button" class="teacher-quick-btn" data-reply="Slow down" disabled>Slow down</button>
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
    title: label.title,
    content,
    scripts: `<script src="/js/render-markdown.js?v=2"></script>
<script src="/js/teacher-entry.js?v=3"></script>
<script>window.TEACHER_BOOT = ${inlineJson(boot)};</script>
<script src="/js/teacher.js?v=4"></script>`,
  }));
});

// ─── GET /api/teacher/:studyId/session ────────────────────────────────────────
router.get('/api/teacher/:studyId/session', requireAuth, (req, res) => {
  const study = findReadableStudy(req, req.params.studyId);
  if (!study) return res.status(404).json({ success: false, error: 'Study not found.' });
  const session = findSession(readSessions(), req.session.userId, study.id, cleanKind(req.query.kind));
  if (!session) return res.json({ success: true, session: null });
  const sections = parseSections(study.content);
  res.json({
    success: true,
    session: Object.assign(savedSummary(session, sections), {
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
// Body: { studyId, kind, start?: { mode, section }, resume?: true, message?: string }
//   start  → begin a NEW session (replaces any saved one of the same kind; the
//            kind comes from start.mode)
//   resume → continue the saved session with a hidden "welcome back" turn
//   else   → the reader's next message in the saved session
router.post('/api/teacher/exchange', requireAuth, aiLimiter, async (req, res) => {
  if (memberGated(req)) return res.status(402).json({ success: false, error: 'member_feature', upgradeUrl: '/pricing' });
  const { studyId, start, resume, message } = req.body || {};
  const kind = start ? kindOfMode(start.mode) : cleanKind(req.body && req.body.kind);

  const study = findReadableStudy(req, studyId);
  if (!study) return res.status(404).json({ success: false, error: 'That study is no longer available.' });
  const sections = parseSections(study.content);

  const sessions = readSessions();
  const existing = findSession(sessions, req.session.userId, study.id, kind);

  // Work out the session this turn belongs to and the new user turn to add.
  let session;
  let newTurn;
  if (start) {
    let mode = VALID_MODES.includes(start.mode) ? start.mode : 'full';
    let sectionNum = parseInt(start.section, 10);
    if (mode === 'section' && !(sectionNum >= 1 && sectionNum <= sections.length)) mode = 'full';
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
      coveredSection: mode === 'section' ? sectionNum : null,
      coveredTopic:   null,
      messages:       [],
      review:         null,
      createdAt:      now,
      updatedAt:      now,
    };
    newTurn = { role: 'user', content: openingTurn(mode, sectionNum, sections), hidden: true };
    const du = req.session.user || {};
    logEvent(du.id || req.session.userId, du.fullName, 'teacher_started', { kind, mode });
  } else {
    if (!existing) return res.status(409).json({ success: false, error: 'No saved session to continue. Please start again.' });
    session = existing;
    if (resume) {
      newTurn = { role: 'user', content: RESUME_TURN, hidden: true };
    } else {
      const text = typeof message === 'string' ? message.trim() : '';
      if (!text) return res.status(400).json({ success: false, error: 'Please type an answer first.' });
      if (text.length > MAX_MESSAGE_CHARS) return res.status(400).json({ success: false, error: 'That message is too long. Please shorten it.' });
      newTurn = { role: 'user', content: text };
    }
    if ((session.messages || []).length >= MAX_SESSION_MESSAGES) {
      return res.status(400).json({ success: false, error: 'This session has grown very long. Please end it and start fresh.' });
    }
  }

  const { IRON_INK_CORE_PROMPT, IRON_INK_TUTOR_PROMPT, IRON_INK_TEACHER_PROMPT } = req.app.locals.prompts;
  const modePrompt = kind === 'teacher' ? IRON_INK_TEACHER_PROMPT : IRON_INK_TUTOR_PROMPT;
  const userSettings = req.session.user && req.session.user.settings;
  const studyLevelInstruction = getStudyLevelInstruction(userSettings);

  // System prompt as blocks (Writing companion pattern): the Tutor/Teacher prompt, then
  // the study itself. The cache breakpoint sits on the study block, so a long
  // study is billed at the cached rate on every turn after the first.
  const sectionList = sections.length
    ? sections.map(s => s.n + '. ' + s.title).join('\n')
    : '(This study has no numbered sections.' + (kind === 'tutor' ? ' Use [[at:0]].)' : ')');
  const systemBlocks = [
    { type: 'text', text: studyLevelInstruction + '\n\n' + IRON_INK_CORE_PROMPT + '\n\n' + modePrompt },
    {
      type: 'text',
      text: 'THE STUDY YOU ARE TEACHING\nTitle: ' + study.topic + '\n\n' +
        'SECTION LIST' + (kind === 'tutor' ? ' (numbers for the [[at:N]] tag)' : '') + ':\n' + sectionList + '\n\n' +
        'FULL STUDY TEXT (the reader sees this rendered beside the conversation; verse markers in it are filled with real text on their screen). ' +
        'In a multi-verse quotation, each verse begins with its verse number in superscript (e.g. "¹¹for though the twins…" is verse 11), and the reader sees those numbers too — so you can point them to a verse by number ("look at verse 11"):\n"""\n' +
        study.content + '\n"""',
      cache_control: { type: 'ephemeral' },
    },
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
  const GENERIC_ERROR = 'The ' + KIND_LABEL[kind].who + " couldn't respond. Please try again.";

  try {
    // Opus 5.5 always thinks and thinking counts toward max_tokens, so the
    // ceiling carries headroom well above these replies (Teacher's run fuller).
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
    // marker ("{{") AND an in-progress progress tag ("[["), so neither is ever
    // split across SSE chunks. Completed progress tags are stripped (the reader
    // never sees them); completed verse markers become real verse text.
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

    const { text: replyText, at, topic } = stripTags(raw);
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
        session = all[idx];
      }
      if (session) {
        session.messages = (session.messages || []).concat([newTurn, { role: 'assistant', content: reply }]);
        if (kind === 'tutor' && at && sections[at - 1]) session.coveredSection = at;
        if (kind === 'teacher' && topic) session.coveredTopic = topic;
        session.review    = null;          // a stale review no longer describes the session
        session.updatedAt = new Date().toISOString();
        writeSessions(all);
      }
    }

    if (!closed && !res.writableEnded) {
      flush(true);
      if (usedNasb) res.write(`data: ${JSON.stringify({ text: NASB_ATTRIBUTION_MD })}\n\n`);
      if (session) res.write(`data: ${JSON.stringify({ coveredLabel: coveredLabel(session, sections) })}\n\n`);
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
// reader understands well, what's worth revisiting (each tied to a study section),
// and one suggested next study — from this study's own Further Studies when one fits.
router.post('/api/teacher/review', requireAuth, aiLimiter, async (req, res) => {
  if (memberGated(req)) return res.status(402).json({ success: false, error: 'member_feature', upgradeUrl: '/pricing' });
  const { studyId } = req.body || {};
  const kind = cleanKind(req.body && req.body.kind);
  const study = findReadableStudy(req, studyId);
  if (!study) return res.status(404).json({ success: false, error: 'That study is no longer available.' });

  const session = findSession(readSessions(), req.session.userId, study.id, kind);
  const visible = session ? (session.messages || []).filter(m => !m.hidden) : [];
  if (!visible.some(m => m.role === 'user')) {
    return res.json({ success: true, review: null });   // nothing answered yet — nothing to review
  }

  const sections = parseSections(study.content);
  const further  = parseFurtherPrompts(study.content);

  const transcriptText = visible
    .map(m => (m.role === 'assistant' ? KIND_LABEL[kind].Who : 'Reader') + ': ' + m.content)
    .join('\n\n');
  const sectionList = sections.length ? sections.map(s => s.n + '. ' + s.title).join('\n') : '(none)';
  const furtherList = further.length ? further.map((p, i) => (i + 1) + '. ' + p).join('\n') : '(none)';

  const userPrompt =
    'A reader has just finished a one-on-one ' +
      (kind === 'teacher' ? 'big-picture conversation with a teacher about' : 'tutoring session, section by section, on') +
      ' the study "' + study.topic + '".\n\n' +
    'STUDY SECTIONS:\n' + sectionList + '\n\n' +
    'THIS STUDY\'S FURTHER STUDIES LIST:\n' + furtherList + '\n\n' +
    'SESSION TRANSCRIPT:\n' + transcriptText + '\n\n' +
    'Write a warm, honest review for the reader, addressed to them as "you". Never grade or score them.\n' +
    '1. understandWell — 1 to 3 things the reader showed they genuinely understand. Be concrete, never flattery. If they struggled throughout, name something real (for example, a point they grasped once it was explained).\n' +
    '2. revisit — 1 to 3 points worth going back over, where their answers were thin or the teaching had to correct them. If nothing needs revisiting, return an empty list.\n' +
    'Each item is one plain sentence (no Scripture quotations, no verse markers) plus the number of the study section it belongs to (from STUDY SECTIONS), or null if none fits.\n' +
    (kind === 'teacher'
      ? 'This conversation was free to range beyond the study. For a revisit item that no study section fits, set section to null and give "topic": the outside subject or passage worth revisiting, in 8 words or fewer (for example "Romans 8 and the Spirit\'s work"). Otherwise set "topic" to null.\n'
      : '') +
    '3. nextStudy — one study to take up next. If an item on the FURTHER STUDIES LIST fits what this reader most needs, give its number as furtherIndex. Otherwise set furtherIndex to null and give a topic of 8 words or fewer.\n\n' +
    'Return ONLY this JSON: { "understandWell": [{ "point": "...", "section": 1 }], "revisit": [{ "point": "...", "section": 2' + (kind === 'teacher' ? ', "topic": null' : '') + ' }], "nextStudy": { "furtherIndex": 1, "topic": "..." } }';

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
    // An outside topic (Teacher only) is kept only when no study section fits.
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
      revisit:        items(parsed.revisit, kind === 'teacher'),
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
