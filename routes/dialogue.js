const express  = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const fs        = require('fs');
const path      = require('path');
const { randomUUID } = require('crypto');
const { requireAuth, renderLayout } = require('./layout');
const { injectVersesTracked, NASB_ATTRIBUTION_MD } = require('../lib/asv');
const { logEvent } = require('../lib/usageLog');
const { getEntitlements } = require('../lib/entitlements');

const router         = express.Router();

// ── Member-only gate (dark unless BILLING_ENABLED=true) ──────────────────────
// Dialogue is a paid-tier feature. Enforce at the authenticated HTTP layer using
// the FRESH users.json record (never client identity). Returns true when a real
// free member should be blocked; always false while billing is dark, so today's
// behavior is unchanged. Same throwing readUsers idiom as study.js / rooms.js.
const ENT_USERS_PATH = path.join(__dirname, '../data/users.json');
function readUsersEnt() { return JSON.parse(fs.readFileSync(ENT_USERS_PATH, 'utf8')); }
function memberGated(req) {
  const ent = getEntitlements(readUsersEnt().find(u => u.id === req.session.userId));
  return ent.billingEnabled && !ent.canUseMemberFeatures;
}

const STUDY_LEVEL_INSTRUCTIONS = {
  foundations: "WRITING REGISTER: FOUNDATIONAL. Write for a reader who is new to this topic and may not yet have much theological vocabulary. Define theological terms in plain language as you introduce them. Take time to explain reasoning step by step rather than assuming familiarity with how these arguments typically run. This does NOT mean simplifying the actual content, shortening the study, or omitting hard questions — every hard question must still be fully resolved per the Core Governing Principle. It means writing with more patience and more explanation for someone earlier in their theological reading, while still producing a real, substantive, adult treatment of the subject.\n\nIMPORTANT — patience is not the same as expansiveness: do not use this lower assumed-background level as license to cover MORE ground, explore MORE tangents, or include MORE separate word-studies than you would at Standard or Advanced. If a single original-language term is genuinely the key to understanding a passage, you may briefly explain it in plain terms — but do not stack multiple etymological or word-study asides within a single thread or section just because the register is more patient. The goal is the SAME scope explained more gently, not a more thorough or more exhaustive treatment. If you find yourself adding a third or fourth separate term-by-term breakdown within one section, stop and ask whether that's actually necessary for a reader new to the topic, or whether it's scope creep.",
  journeyman:  "WRITING REGISTER: STANDARD. Write for a reader with some working theological vocabulary and familiarity with how Reformed argumentation typically proceeds. You do not need to define every basic term, but should still clarify genuinely technical or less common terminology as it arises. The Core Governing Principle applies fully: every hard question and objection must be resolved in-line, never deferred to the reader.",
  scholar:     "WRITING REGISTER: ADVANCED. Write for a reader who is comfortable with theological vocabulary, confessional language, and the typical shape of Reformed exegetical and doctrinal argument. You do not need to pause to define common theological terms, but should still be clear and precise. The Core Governing Principle applies fully: every hard question and objection must be resolved in-line, never deferred to the reader.",
};

function getStudyLevelInstruction(settings) {
  const level = (settings && settings.studyLevel) || 'journeyman';
  return STUDY_LEVEL_INSTRUCTIONS[level] || STUDY_LEVEL_INSTRUCTIONS.journeyman;
}
const DIALOGUES_PATH = path.join(__dirname, '../data/dialogues.json');
const STUDIES_PATH   = path.join(__dirname, '../data/studies.json');

function readDialogues() {
  try {
    if (!fs.existsSync(DIALOGUES_PATH)) return [];
    return JSON.parse(fs.readFileSync(DIALOGUES_PATH, 'utf8'));
  } catch { return []; }
}

function writeDialogues(data) {
  fs.writeFileSync(DIALOGUES_PATH, JSON.stringify(data, null, 2));
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function readStudies() {
  try {
    if (!fs.existsSync(STUDIES_PATH)) return [];
    return JSON.parse(fs.readFileSync(STUDIES_PATH, 'utf8'));
  } catch { return []; }
}

// One line, at most 100 characters: the same trim the position always gets.
function oneLine(str) {
  return String(str || '').replace(/\s+/g, ' ').trim().slice(0, 100);
}

// ── "Defender of" opponent (Debate this view, from an Opposing Views study) ──
// The opponent is a defender of the view the member's own Opposing Views study
// sets out. The view always comes from the SAVED study's topic, looked up by id
// and owner, never from position text the browser sends. defenderTopicFor
// returns the trimmed topic, or null when the study is missing or not an
// Opposing Views study (callers pass only a study already matched to the member).
const DEFENDER_OPPONENT = 'defender';
function defenderTopicFor(study) {
  if (!study || study.studyType !== 'opposing') return null;
  return oneLine(study.topic) || null;
}
function defenderLabel(topic) { return 'Defender of: ' + topic; }
function defenderBlock(topic) {
  return `OPPONENT FROM AN OPPOSING VIEWS STUDY. You are arguing as a skilled, well-informed defender of this view: ${topic}. The member's Opposing Views study of this view is linked above. Part 1 of that study sets out the view's case as its own defenders make it; argue that case at full strength, in the view's own terms. Part 2 is the member's side, not yours.
Rules:
- Argue as a real, informed defender of the view would, never as a caricature. Use the view's own vocabulary and its strongest arguments and evidence.
- Never invent a source, author, book, quotation, statistic, study, date or URL. If you are not certain a source exists and says what you would claim, make the argument without citing it.
- Do not quote the Qur'an, the Hadith, the Book of Mormon, the Doctrine and Covenants, the Pearl of Great Price, the Catechism of the Catholic Church, or any comparable text from memory. Paraphrase it, and give its reference only if you are confident of it.
- When you appeal to the Bible, give the reference and explain how the view reads it. Do not write out Bible verse text from memory.
- Be serious and respectful. No mockery, contempt or insults toward the member, Christians, or the Bible.
- Stay in role as the defender for the whole drill. Do not concede points to make the member comfortable, and do not rebut your own view.`;
}

// ─── GET /dialogue ────────────────────────────────────────────────────────────
router.get('/dialogue', requireAuth, (req, res) => {
  if (memberGated(req)) return res.redirect('/pricing?from=dialogue');
  const studiesRaw = readStudies();

  const userStudies = studiesRaw
    .filter(s => s.userId === req.session.userId)
    .sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));

  // ?fromStudy=<id> ("Debate this view" on an Opposing Views study): only the
  // member's own Opposing Views study counts. Anything else (missing id, not
  // theirs, not found, another type) opens the page as usual, no error shown.
  const fromId    = typeof req.query.fromStudy === 'string' ? req.query.fromStudy : '';
  const fromStudy = fromId ? userStudies.find(s => s.id === fromId) : null;
  const fromTopic = defenderTopicFor(fromStudy);
  const defender  = fromTopic ? { id: fromStudy.id, topic: fromTopic } : null;

  const studyOptions = userStudies.length
    ? userStudies.map(s =>
        `<option value="${esc(s.id)}"${defender && s.id === defender.id ? ' selected' : ''}>${esc(s.topic)} &#8212; ${esc(fmtDate(s.savedAt))}</option>`
      ).join('')
    : '<option value="">No saved studies yet</option>';
  // The six fixed opponents stay as they are; a "Defender of" option is added,
  // selected, for this page load only. Its value is a marker, not a position:
  // the server builds the position from the saved study on every turn.
  const defenderOption = defender
    ? `<option value="__defender__" data-study-id="${esc(defender.id)}" data-topic="${esc(defender.topic)}" selected>${esc(defenderLabel(defender.topic))}</option>`
    : '';

  const content = `
    <div id="dialogueSetup" class="dialogue-setup">
      <div class="page-header">
        <h2 class="page-title">Dialogue</h2>
        <p class="page-subtitle">Choose your entry point and begin the adversarial session.</p>
      </div>

      <div class="setup-card">
        <div class="setup-section">
          <h4 class="setup-section-label">Entry Point</h4>
          <div class="entry-options">
            <label class="entry-option">
              <input type="radio" name="entryType" value="fresh"${defender ? '' : ' checked'}>
              <div class="entry-option-content">
                <span class="entry-option-title">Fresh Topic</span>
                <span class="entry-option-desc">Begin a cold adversarial dialogue on any theological topic</span>
              </div>
            </label>
            <label class="entry-option">
              <input type="radio" name="entryType" value="study"${defender ? ' checked' : ''}>
              <div class="entry-option-content">
                <span class="entry-option-title">Linked to a Saved Study</span>
                <span class="entry-option-desc">The engine challenges you on doctrine drawn from your prior study</span>
              </div>
            </label>
          </div>
        </div>

        <div id="freshTopicSection" class="setup-section"${defender ? ' style="display:none;"' : ''}>
          <label class="form-label" for="freshTopicInput">Topic</label>
          <input type="text" id="freshTopicInput" class="form-input"
                 placeholder="e.g. Unconditional Election, Total Depravity&#8230;" autocomplete="off"${defender ? ` value="${esc(defender.topic)}"` : ''}>
        </div>

        <div id="studyLinkSection" class="setup-section"${defender ? '' : ' style="display:none;"'}>
          <label class="form-label" for="savedStudySelect">Select a Saved Study</label>
          <select id="savedStudySelect" class="form-select">
            ${studyOptions}
          </select>
        </div>

        <div class="setup-section">
          <label class="form-label" for="adversarialPosition">Adversarial Position</label>
          <select id="adversarialPosition" class="form-select">
            <option value="Arminian">Arminian</option>
            <option value="Open Theist">Open Theist</option>
            <option value="Roman Catholic">Roman Catholic</option>
            <option value="Lutheran">Lutheran</option>
            <option value="Socinian / Anti-Trinitarian">Socinian / Anti-Trinitarian</option>
            <option value="General Skeptic">General Skeptic</option>
            ${defenderOption}
          </select>
        </div>

        <button class="btn-primary" id="beginDialogueBtn">Begin Dialogue</button>
      </div>
    </div>

    <div id="dialogueSession" class="dialogue-session" style="display:none;">
      <div class="dialogue-session-header">
        <div class="dialogue-session-meta">
          <span class="session-topic-label" id="sessionTopicLabel"></span>
          <span class="position-badge" id="sessionPositionBadge"></span>
        </div>
        <div class="dialogue-session-tools">
          <span class="ucp-zoom" role="group" aria-label="Dialogue text size">
            <button type="button" class="guide-font-btn guide-font-btn-sm" id="dialogueFontDec" title="Smaller dialogue text" aria-label="Smaller dialogue text">A&#8722;</button>
            <button type="button" class="guide-font-btn guide-font-btn-md" id="dialogueFontReset" title="Default dialogue text" aria-label="Default dialogue text">A</button>
            <button type="button" class="guide-font-btn guide-font-btn-lg" id="dialogueFontInc" title="Larger dialogue text" aria-label="Larger dialogue text">A+</button>
          </span>
          <button class="btn-end-session" id="endSessionBtn">End Session</button>
        </div>
      </div>

      <div id="chatMessages" class="chat-messages"></div>

      <div class="chat-input-area">
        <textarea id="userResponseInput" class="chat-textarea"
                  placeholder="Your response&#8230;" rows="3"></textarea>
        <div class="chat-input-actions">
          <button class="btn-primary" id="sendResponseBtn">Send</button>
          <button class="btn-stop" id="stopDialogueBtn" style="display:none;">Stop</button>
        </div>
      </div>
    </div>

    <div id="endSessionModal" class="end-modal-overlay" style="display:none;">
      <div class="end-session-card">
        <p class="end-session-quote">&#8220;The session is complete. What you wrestled with today is yours.&#8221;</p>
        <div id="gapLoading" class="gap-loading" style="display:none;">
          <div class="study-spinner gap-spinner"></div>
          <p class="loading-text">Analyzing your session&#8230;</p>
        </div>
        <div id="gapResults" style="display:none;">
          <div class="gap-summary-box gap-strengths-box">
            <p class="gap-part-label">What you did well</p>
            <p id="gapStrengthsText"></p>
          </div>
          <div class="gap-summary-box">
            <p class="gap-part-label">Where to sharpen</p>
            <p id="gapSummaryText"></p>
          </div>
          <p class="gap-study-next-label">The adversary pressed hardest on: <em id="gapStudyNextText"></em></p>
        </div>
        <div id="endSessionConfirm" style="display:none;">
          <p class="end-confirm-text">Session saved to your Library.</p>
        </div>
        <div id="endSessionActions" class="end-session-actions" style="display:none;">
          <button class="btn-primary" id="studyNextBtn">Study this next &#8594;</button>
          <button class="btn-warm" id="saveSessionBtn">Save session</button>
          <button class="btn-discard" id="discardSessionBtn">Discard</button>
        </div>
      </div>
    </div>`;

  res.send(renderLayout({
    req,
    activeSection: 'dialogue',
    title: 'Dialogue',
    content,
    scripts: '<script src="/js/text-size.js?v=1"></script><script src="/js/dialogue.js?v=4"></script>',
  }));
});

// ─── POST /api/dialogue/exchange (streaming SSE) ──────────────────────────────
router.post('/api/dialogue/exchange', requireAuth, async (req, res) => {
  if (memberGated(req)) return res.status(402).json({ success: false, error: 'member_feature', upgradeUrl: '/pricing' });
  const { messages, topic, adversarialPosition, linkedStudyId, isOpening, opponent } = req.body;

  if (!topic || !topic.trim()) {
    return res.status(400).json({ error: 'Topic is required.' });
  }

  // A session "begins" on the opening exchange only — subsequent turns reuse the
  // same handler with isOpening false, so gating here yields one event per session.
  if (isOpening) {
    const du = req.session.user || {};
    logEvent(du.id || req.session.userId, du.fullName, 'dialogue_started', {});
  }

  // Fetch linked study content when requested
  let linkedStudyContent = null;
  let linkedStudy = null;
  if (linkedStudyId) {
    linkedStudy = readStudies().find(s => s.id === linkedStudyId && s.userId === req.session.userId) || null;
    if (linkedStudy) linkedStudyContent = linkedStudy.content;
  }
  // "Defender of": the view comes only from the linked study, owned by this
  // member (matched above) and of type 'opposing'. A defender request without
  // one gets the General Skeptic, never the browser's position text.
  const isDefender    = opponent === DEFENDER_OPPONENT;
  const defenderTopic = isDefender ? defenderTopicFor(linkedStudy) : null;

  // Build system prompt — Core Identity prompt is deliberately excluded here.
  // The Reformed guardrails in IRON_INK_CORE_PROMPT prevent the model from
  // arguing opposing positions. Dialogue uses its own standalone prompt.
  const { IRON_INK_DIALOGUE_PROMPT } = req.app.locals.prompts;
  const userSettings = req.session.user && req.session.user.settings;
  const studyLevelInstruction = getStudyLevelInstruction(userSettings);
  // The selected tradition goes in the system prompt so it reaches the model on
  // every turn, the opening turn included (the opening user turn names only the
  // topic). The value comes from the setup <select>, but it is client-sent, so
  // keep it to one short line.
  const position = defenderTopic
    ? 'a skilled, well-informed defender of ' + defenderTopic
    : (isDefender ? 'General Skeptic' : (oneLine(adversarialPosition) || 'General Skeptic'));
  let systemPrompt = studyLevelInstruction + '\n\n' + IRON_INK_DIALOGUE_PROMPT +
    '\n\nYou are arguing from the position of: ' + position + '. Every objection you raise is stated as a skilled proponent of that position would state it.';
  if (linkedStudyContent) {
    systemPrompt += `\n\nThe student has completed a prior study on this topic. Study guide content for your reference:\n\n${linkedStudyContent}`;
  }
  // After the linked study, which the block refers to ("linked above").
  if (defenderTopic) systemPrompt += '\n\n' + defenderBlock(defenderTopic);

  // Build API messages — must always start with 'user'
  let apiMessages;
  if (isOpening) {
    apiMessages = [{
      role: 'user',
      content: `Begin the drill. Topic: "${topic.trim()}".`
    }];
  } else {
    apiMessages = [
      {
        role: 'user',
        content: `[Adversarial dialogue session on "${topic.trim()}". Your position: ${position}. The exchange history follows.]`
      },
      ...messages
    ];
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  let closed = false;

  try {
    const stream = client.messages.stream({
      model:      'claude-opus-4-8',
      max_tokens: 1500,
      system:     systemPrompt,
      messages:   apiMessages,
    });

    req.on('close', () => {
      closed = true;
      try { stream.abort(); } catch {}
    });

    // Marker-safe streaming: the model may emit {{verse:...}} markers, which must
    // become real verse text (NASB primary, ASV fallback) and must never be split
    // across SSE chunks. Buffer the stream, hold back any in-progress marker (an
    // unclosed "{{" or a trailing "{"), inject completed markers, and emit only the
    // safe prefix.
    let buf = '';
    // injectVerses picks the block or inline verse form by whether a marker
    // starts its line. Each flush hands it only a slice of the response, so
    // track whether that slice itself begins a line — otherwise a marker at
    // slice[0] that is really mid-sentence would be injected as a blockquote.
    let atLineStart = true;
    // Track whether any NASB verse was injected across the whole turn, so the
    // Lockman notice is appended ONCE at the end (not per slice).
    let usedNasb = false;
    function flush(final) {
      if (closed || res.writableEnded) { buf = ''; return; }
      let cut = buf.length;
      if (!final) {
        const open = buf.lastIndexOf('{{');
        if (open !== -1 && buf.indexOf('}}', open) === -1) cut = open;      // unclosed marker
        else if (buf.endsWith('{')) cut = buf.length - 1;                    // lone trailing brace
      }
      const slice = buf.slice(0, cut);
      const { text: emit, sources } = injectVersesTracked(slice, atLineStart);
      if (sources.nasb) usedNasb = true;
      buf = buf.slice(cut);
      if (slice) atLineStart = slice.endsWith('\n');
      if (emit) res.write(`data: ${JSON.stringify({ text: emit })}\n\n`);
    }

    stream.on('text', (text) => {
      if (closed || res.writableEnded) return;
      buf += text;
      flush(false);
    });

    await stream.done();

    if (!closed && !res.writableEnded) {
      flush(true);
      // Append the Lockman notice as a trailing slice when this turn quoted NASB.
      if (usedNasb) res.write(`data: ${JSON.stringify({ text: NASB_ATTRIBUTION_MD })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  } catch (err) {
    if (!res.writableEnded) {
      if (!closed) {
        console.error('[Dialogue] API error — status:', err.status, '| type:', err.error?.type, '| message:', err.message);
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      }
      res.end();
    }
  }
});

// ─── POST /api/dialogue/save ──────────────────────────────────────────────────
router.post('/api/dialogue/save', requireAuth, (req, res) => {
  if (memberGated(req)) return res.status(402).json({ success: false, error: 'member_feature', upgradeUrl: '/pricing' });
  const { topic, adversarialPosition, linkedStudyId, transcript, opponent } = req.body;

  if (!topic || !transcript || !transcript.length) {
    return res.status(400).json({ success: false, error: 'Topic and transcript are required.' });
  }

  // A "Defender of" session saves the label built from the owned Opposing Views
  // study (as the drill's position was), never the browser's text.
  let positionLabel = adversarialPosition || 'Unknown';
  let savedOpponent = null;
  if (opponent === DEFENDER_OPPONENT) {
    const study = linkedStudyId
      ? readStudies().find(s => s.id === linkedStudyId && s.userId === req.session.userId)
      : null;
    const dTopic = defenderTopicFor(study);
    positionLabel = dTopic ? defenderLabel(dTopic) : 'General Skeptic';
    if (dTopic) savedOpponent = DEFENDER_OPPONENT;
  }

  const dialogue = {
    id:                 randomUUID(),
    userId:             req.session.userId,
    topic:              topic.trim(),
    adversarialPosition: positionLabel,
    linkedStudyId:      linkedStudyId || null,
    transcript,
    savedAt:            new Date().toISOString(),
  };
  if (savedOpponent) dialogue.opponent = savedOpponent;

  const dialogues = readDialogues();
  dialogues.push(dialogue);
  writeDialogues(dialogues);

  res.json({ success: true, dialogue });
});

// ─── POST /api/dialogue/gaps ──────────────────────────────────────────────────
router.post('/api/dialogue/gaps', requireAuth, async (req, res) => {
  if (memberGated(req)) return res.status(402).json({ success: false, error: 'member_feature', upgradeUrl: '/pricing' });
  const { transcript, topic, adversarialPosition } = req.body;

  const { IRON_INK_CORE_PROMPT } = req.app.locals.prompts;

  const transcriptText = Array.isArray(transcript)
    ? transcript.map(m => (m.role === 'assistant' ? 'Adversary' : 'Student') + ': ' + m.content).join('\n\n')
    : String(transcript || '');

  const userPrompt = `You have just completed an adversarial dialogue session on "${topic}" from the ${adversarialPosition} position. Here is the full transcript:\n\n${transcriptText}\n\nGive the student warm, honest, pastoral feedback in three parts:\n\n1. STRENGTHS — In 1-2 sentences, affirm specifically what the student argued well, defended soundly, or handled rightly. Be genuine and concrete, never flattery. If the student genuinely struggled throughout, stay honest but still find something real to encourage (for example their willingness to engage a hard objection) rather than inventing praise.\n\n2. GROWTH — In 1-2 sentences, identify where the student's answers were weakest or where a challenge went unanswered.\n\n3. NEXT TOPIC — In 5 words or fewer, the single most important topic the student should study next to strengthen their position.\n\nReturn your response in this exact JSON format: { "strengths": "1-2 sentences", "growth": "1-2 sentences", "nextTopic": "topic in 5 words or fewer" }`;

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    const message = await client.messages.create({
      model:      'claude-opus-4-8',
      max_tokens: 400,
      system:     IRON_INK_CORE_PROMPT,
      messages:   [{ role: 'user', content: userPrompt }],
    });

    const text      = message.content[0].text.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');
    const parsed = JSON.parse(jsonMatch[0]);

    // Accept the new three-part shape, and fall back to the old key names
    // (summary/studyNext) so a stale or partial response still renders. Inject
    // verified verse text (NASB primary, ASV fallback) for any {{verse:...}}
    // marker; if any field quoted NASB, append the Lockman notice once to growth.
    const s = injectVersesTracked(parsed.strengths || '');
    const g = injectVersesTracked(parsed.growth    || parsed.summary   || '');
    const n = injectVersesTracked(parsed.nextTopic || parsed.studyNext || '');
    const usedNasb = s.sources.nasb || g.sources.nasb || n.sources.nasb;
    res.json({
      success:   true,
      strengths: s.text,
      growth:    usedNasb ? g.text + NASB_ATTRIBUTION_MD : g.text,
      nextTopic: n.text,
    });
  } catch (err) {
    console.error('[Dialogue/gaps]', err.message);
    res.json({ success: false, error: err.message });
  }
});

// ─── GET /api/dialogues ───────────────────────────────────────────────────────
router.get('/api/dialogues', requireAuth, (req, res) => {
  const dialogues = readDialogues()
    .filter(d => d.userId === req.session.userId)
    .sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
  res.json({ success: true, dialogues });
});

// ─── DELETE /api/dialogues/:id ────────────────────────────────────────────────
router.delete('/api/dialogues/:id', requireAuth, (req, res) => {
  const dialogues = readDialogues();
  const idx = dialogues.findIndex(
    d => d.id === req.params.id && d.userId === req.session.userId
  );
  if (idx === -1) return res.status(404).json({ success: false, error: 'Dialogue not found.' });

  dialogues.splice(idx, 1);
  writeDialogues(dialogues);
  res.json({ success: true });
});

module.exports = router;
// Shared with routes/teacher.js so the reading register stays identical.
module.exports.getStudyLevelInstruction = getStudyLevelInstruction;
