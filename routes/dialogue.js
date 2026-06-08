const express  = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const fs        = require('fs');
const path      = require('path');
const { randomUUID } = require('crypto');
const { requireAuth, renderLayout } = require('./layout');

const router         = express.Router();
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

// ─── GET /dialogue ────────────────────────────────────────────────────────────
router.get('/dialogue', requireAuth, (req, res) => {
  const studiesRaw = (() => {
    try {
      if (!fs.existsSync(STUDIES_PATH)) return [];
      return JSON.parse(fs.readFileSync(STUDIES_PATH, 'utf8'));
    } catch { return []; }
  })();

  const userStudies = studiesRaw
    .filter(s => s.userId === req.session.userId)
    .sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));

  const studyOptions = userStudies.length
    ? userStudies.map(s =>
        `<option value="${esc(s.id)}">${esc(s.topic)} &#8212; ${esc(fmtDate(s.savedAt))}</option>`
      ).join('')
    : '<option value="">No saved studies yet</option>';

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
              <input type="radio" name="entryType" value="fresh" checked>
              <div class="entry-option-content">
                <span class="entry-option-title">Fresh Topic</span>
                <span class="entry-option-desc">Begin a cold adversarial dialogue on any theological topic</span>
              </div>
            </label>
            <label class="entry-option">
              <input type="radio" name="entryType" value="study">
              <div class="entry-option-content">
                <span class="entry-option-title">Linked to a Saved Study</span>
                <span class="entry-option-desc">The engine challenges you on doctrine drawn from your prior study</span>
              </div>
            </label>
          </div>
        </div>

        <div id="freshTopicSection" class="setup-section">
          <label class="form-label" for="freshTopicInput">Topic</label>
          <input type="text" id="freshTopicInput" class="form-input"
                 placeholder="e.g. Unconditional Election, Total Depravity&#8230;" autocomplete="off">
        </div>

        <div id="studyLinkSection" class="setup-section" style="display:none;">
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
        <button class="btn-end-session" id="endSessionBtn">End Session</button>
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
        <div id="endSessionConfirm" style="display:none;">
          <p class="end-confirm-text">Session saved to your Library.</p>
        </div>
        <div id="endSessionActions" class="end-session-actions">
          <button class="btn-primary" id="saveSessionBtn">Save this session</button>
          <button class="btn-warm" id="discardSessionBtn">Discard</button>
        </div>
      </div>
    </div>`;

  res.send(renderLayout({
    req,
    activeSection: 'dialogue',
    title: 'Dialogue',
    content,
    scripts: '<script src="/js/dialogue.js"></script>',
  }));
});

// ─── POST /api/dialogue/exchange (streaming SSE) ──────────────────────────────
router.post('/api/dialogue/exchange', requireAuth, async (req, res) => {
  const { messages, topic, adversarialPosition, linkedStudyId, isOpening } = req.body;

  if (!topic || !topic.trim()) {
    return res.status(400).json({ error: 'Topic is required.' });
  }

  // Fetch linked study content when requested
  let linkedStudyContent = null;
  if (linkedStudyId) {
    try {
      const studies = JSON.parse(fs.readFileSync(STUDIES_PATH, 'utf8'));
      const study   = studies.find(s => s.id === linkedStudyId && s.userId === req.session.userId);
      if (study) linkedStudyContent = study.content;
    } catch {}
  }

  // Build system prompt
  const { IRON_INK_CORE_PROMPT, IRON_INK_DIALOGUE_PROMPT } = req.app.locals.prompts;
  let systemPrompt = IRON_INK_CORE_PROMPT + '\n\n' + IRON_INK_DIALOGUE_PROMPT;
  systemPrompt += `\n\nFor this session you are arguing strictly from the ${adversarialPosition} perspective. Stay fully in role throughout. Do not break character, soften your position, or acknowledge it as merely adversarial.`;
  if (linkedStudyContent) {
    systemPrompt += `\n\nThe student has completed a prior study on this topic. Study guide content for your reference:\n\n${linkedStudyContent}`;
  }

  // Build API messages — must always start with 'user'
  let apiMessages;
  if (isOpening) {
    apiMessages = [{
      role: 'user',
      content: `Open the adversarial dialogue now. Topic: "${topic.trim()}". Begin your challenge immediately. No preamble, no self-introduction, no meta-commentary. The very first word you write should be part of the challenge itself.`
    }];
  } else {
    apiMessages = [
      {
        role: 'user',
        content: `[Adversarial dialogue session on "${topic.trim()}". Your position: ${adversarialPosition}. The exchange history follows.]`
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

    stream.on('text', (text) => {
      if (!closed && !res.writableEnded) {
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }
    });

    await stream.done();

    if (!closed && !res.writableEnded) {
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
  const { topic, adversarialPosition, linkedStudyId, transcript } = req.body;

  if (!topic || !transcript || !transcript.length) {
    return res.status(400).json({ success: false, error: 'Topic and transcript are required.' });
  }

  const dialogue = {
    id:                 randomUUID(),
    userId:             req.session.userId,
    topic:              topic.trim(),
    adversarialPosition: adversarialPosition || 'Unknown',
    linkedStudyId:      linkedStudyId || null,
    transcript,
    savedAt:            new Date().toISOString(),
  };

  const dialogues = readDialogues();
  dialogues.push(dialogue);
  writeDialogues(dialogues);

  res.json({ success: true, dialogue });
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
