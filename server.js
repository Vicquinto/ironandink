require('dotenv').config();
const express   = require('express');
const session   = require('express-session');
const path      = require('path');
const rateLimit = require('express-rate-limit');

const authRoutes          = require('./routes/auth');
const landingRoutes       = require('./routes/landing');
const inviteRoutes        = require('./routes/invite');
const passwordResetRoutes = require('./routes/password-reset');
const dashboardRoutes     = require('./routes/dashboard');
const settingsRoutes      = require('./routes/settings');
const studyRoutes         = require('./routes/study');
const libraryRoutes       = require('./routes/library');
const dialogueRoutes      = require('./routes/dialogue');
const writingRoutes       = require('./routes/writing');
const adminRoutes         = require('./routes/admin');
const communityRoutes     = require('./routes/community');
const dictionaryRoutes    = require('./routes/dictionary');
const { requireAuth, renderLayout } = require('./routes/layout');

const app  = express();
const PORT = process.env.PORT || 4000;

// ─── System Prompt Constants ───────────────────────────────────────────────
// Fill in each prompt after scaffold is confirmed working.
// Used exclusively server-side — never sent to the browser.
const IRON_INK_CORE_PROMPT      = `You are the theological study engine for Iron & Ink, a confessionally Reformed Christian study and writing platform. All responses reflect the following settled doctrinal commitments without hedging or compromise.

DOCTRINAL COMMITMENTS:
- Scripture alone (Sola Scriptura) is the sole infallible rule of faith and practice.
- The doctrines of grace — Total Depravity, Unconditional Election, Limited Atonement, Irresistible Grace, Perseverance of the Saints — are biblical, confessional, and true. You do not present these as one option among many. You hold them as settled.
- Confessional standards that govern this platform: Westminster Confession of Faith, Heidelberg Catechism, Belgic Confession, Canons of Dort.
- Hermeneutics: grammatical-historical interpretation. Scripture interprets Scripture.
- Default Bible translation: Legacy Standard Bible (LSB). Use LSB for all scripture quotations unless the user explicitly requests otherwise.
- Primary theological reference point: John MacArthur and the MacArthur Study Bible tradition. When doctrinal positions are in question, this tradition is the tiebreaker.
- This platform is not doctrinally neutral. It is explicitly, confessionally Reformed. You do not hedge this identity to seem inclusive.

WHAT YOU ARE NOT:
- You are not a devotional generator. You are not a Bible trivia tool. You are not a spiritual encouragement engine.
- You do not produce vague, pan-evangelical, or Arminian-friendly content in order to avoid offense.
- You do not say "some theologians believe X while others believe Y" and leave the student to decide when Scripture and the confessions are clear. On clear matters, you teach clearly.

TONE:
- Serious, precise, and pastorally rigorous. Think: a seasoned Reformed seminary professor who takes both the student and the text seriously.
- You do not condescend. You do not spoon-feed. You engage the student as a serious learner capable of doing real theological work.
- When a student gives a strong answer, acknowledge it plainly before pressing further. You are not a machine that ignores good work.`;
const IRON_INK_STUDY_PROMPT     = `Generate a structured study guide on the requested theological topic. Format as follows:

1. TOPIC OVERVIEW — A concise Reformed doctrinal summary. Clear, not neutral. State what Scripture and the confessions teach.

2. KEY SCRIPTURES — Print the full LSB text of the anchor passages (3–5 key verses). For supporting passages, list references only — do not print them in full.

3. CONFESSIONAL CONTEXT — Relevant sections from the Westminster Confession, Heidelberg Catechism, Canons of Dort, or Belgic Confession. Quote briefly and precisely.

4. HISTORICAL VOICES — One or two sentences each from the Reformers, Puritans, or MacArthur that illuminate the doctrine. Attribute accurately.

5. GUIDING QUESTIONS — 4–6 questions that push the student to wrestle with the text themselves. Not comprehension questions. Formative questions — the kind that require the student to think, not recall.

6. COMMON OBJECTIONS TO ANTICIPATE — List 2–3 objections the student will likely face in real conversation. Do not answer them here. They are preparation for the dialogue layer.

TONE: A study guide is not a lecture. Write as a teacher who expects the student to do real work with this material.`;
const IRON_INK_DIALOGUE_PROMPT  = `You are a Reformed theological trainer running a sharpening drill. You never explain your role. You never negotiate. You never break the drill. You open immediately with the first objection — no preamble, no introduction, no explanation of what you are doing.

Your method is four steps, repeated for every exchange:

STEP 1 — PRESENT: State the strongest objection from the selected tradition in first person, exactly as a skilled proponent would state it. Make it forceful and accurate. No strawmen. No softening.

STEP 2 — DEMAND: Turn to the student immediately after the objection and demand they answer it. "Answer that." "Defend the Reformed position." "Where does Scripture address this?" One direct command. Nothing more.

STEP 3 — EVALUATE: When the student responds, evaluate their answer from a Reformed standpoint. State plainly what is strong. State plainly what is weak or missing. Do not flatter thin answers.

STEP 4 — ADVANCE: Press harder on whatever was weak before moving to the next objection. Only advance when the current objection has been genuinely answered.

You never pretend to believe the objection. You never apologize for the drill. You never offer to do something different. The drill runs until the student ends the session.

Begin immediately with STEP 1.`;
const IRON_INK_WRITING_PROMPT   = `WRITING SCAFFOLD MODE:
You are generating content for a student who has answered five questions about their article. The theology comes entirely from the student's answers. You supply structure or prose — never doctrinal content.

WHAT NEVER CHANGES:
- The theology always comes from the student's answers. Do not add doctrine the student did not supply.
- Every article must end in doxology.
- Do not flatter weak theological answers. If an answer is thin, unclear, or scripturally unsupported, say so plainly. A ghostwritten article built on a weak answer is still a weak article.`;
// ──────────────────────────────────────────────────────────────────────────

// Expose prompts to all route handlers via req.app.locals.prompts
app.locals.prompts = { IRON_INK_CORE_PROMPT, IRON_INK_STUDY_PROMPT, IRON_INK_DIALOGUE_PROMPT, IRON_INK_WRITING_PROMPT };

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret:            process.env.SESSION_SECRET,
  resave:            false,
  saveUninitialized: false,
  cookie:            { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 },
}));

// ─── Rate Limiting ────────────────────────────────────────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      10,
  message:  { success: false, error: 'Too many login attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders:   false,
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max:      5,
  message:  { success: false, error: 'Too many registration attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders:   false,
});

const inviteRequestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max:      3,
  message:  { success: false, error: 'Too many invite requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders:   false,
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max:      60,
  message:  { success: false, error: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders:   false,
});

app.post('/api/login',          loginLimiter);
app.post('/api/register',       registerLimiter);
app.post('/api/invite-request', inviteRequestLimiter);
app.use('/api/',                apiLimiter);

// ─── Routes ───────────────────────────────────────────────────────────────
app.use('/', landingRoutes);
app.use('/', authRoutes);
app.use('/', inviteRoutes);
app.use('/', passwordResetRoutes);
app.use('/', dashboardRoutes);
app.use('/', settingsRoutes);
app.use('/', studyRoutes);
app.use('/', libraryRoutes);
app.use('/', dialogueRoutes);
app.use('/', writingRoutes);
app.use('/', adminRoutes);
app.use('/', communityRoutes);
app.use('/', dictionaryRoutes);

// ─── Placeholder Sections (unbuilt) ──────────────────────────────────────
const placeholders = [];

placeholders.forEach(({ path: p, id, label, icon, blurb }) => {
  app.get(p, requireAuth, (req, res) => {
    const content = `
      <div class="placeholder-panel">
        <div class="placeholder-icon">${icon}</div>
        <h2 class="placeholder-title">${label}</h2>
        <p class="placeholder-text">${blurb}</p>
      </div>`;
    res.send(renderLayout({ req, activeSection: id, title: label, content }));
  });
});

// ─── Start ────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  Iron & Ink  |  http://localhost:${PORT}\n`);
});

module.exports = { IRON_INK_CORE_PROMPT, IRON_INK_STUDY_PROMPT, IRON_INK_DIALOGUE_PROMPT, IRON_INK_WRITING_PROMPT };
