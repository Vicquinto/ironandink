const express    = require('express');
const Anthropic  = require('@anthropic-ai/sdk');
const fs         = require('fs');
const path       = require('path');
const { randomUUID } = require('crypto');
const { requireAuth, renderLayout } = require('./layout');

const router       = express.Router();
const ARTICLES_PATH = path.join(__dirname, '../data/articles.json');

function readArticles() {
  try {
    if (!fs.existsSync(ARTICLES_PATH)) return [];
    return JSON.parse(fs.readFileSync(ARTICLES_PATH, 'utf8'));
  } catch { return []; }
}

function writeArticles(data) {
  fs.writeFileSync(ARTICLES_PATH, JSON.stringify(data, null, 2));
}

// ─── GET /writing ─────────────────────────────────────────────────────────────
router.get('/writing', requireAuth, (req, res) => {
  const content = `
    <div id="writingMain">
      <div class="page-header">
        <h2 class="page-title">Writing</h2>
        <p class="page-subtitle">Theological articles in your own voice.</p>
      </div>
      <button class="btn-primary" id="beginArticleBtn">Begin a New Article</button>
      <div id="articleList" class="article-list-container"></div>
    </div>

    <div id="writingEditor" style="display:none;">
      <div class="editor-topbar">
        <div class="editor-meta-row">
          <span id="editorTierBadge" class="tier-badge-main"></span>
          <span id="editorWordCount" class="word-count-display">0 words</span>
        </div>
        <button class="btn-end-session" id="startOverBtn">&#8592; Start Over</button>
      </div>
      <input type="text" id="editorTitle" class="editor-title-input" placeholder="Article title&#8230;">
      <textarea id="editorContent" class="editor-content-textarea" placeholder="Your article will appear here&#8230;"></textarea>
      <div class="editor-action-row">
        <button class="btn-primary" id="saveDraftBtn">Save Draft</button>
        <button class="btn-warm" id="markCompleteBtn">Mark Complete</button>
      </div>
    </div>

    <div id="writingLoading" style="display:none;" class="study-loading">
      <div class="study-spinner"></div>
      <p class="loading-text" id="writingLoadingText">Preparing your article&#8230;</p>
    </div>

    <div id="writingModal" class="writing-modal-overlay" style="display:none;">
      <div class="writing-modal-card">
        <div class="writing-modal-header">
          <button class="modal-close-btn" id="closeWritingModalBtn">&#10005;</button>
        </div>

        <div id="wModalStep0" style="display:none;">
          <h3 class="writing-modal-title">What are you writing?</h3>
          <div class="form-options">
            <label class="form-option">
              <input type="radio" name="writingForm" value="article">
              <div class="form-option-body">
                <div class="form-option-icon">&#128196;</div>
                <div class="form-option-label">Article / Essay</div>
                <div class="form-option-desc">A theological argument for reading and sharing. Structured for a reader who will sit with it.</div>
              </div>
            </label>
            <label class="form-option">
              <input type="radio" name="writingForm" value="sermon">
              <div class="form-option-body">
                <div class="form-option-icon">&#127908;</div>
                <div class="form-option-label">Sermon / Exhortation</div>
                <div class="form-option-desc">A proclamation written to be heard. Structured for a listener — with rhythm, repetition, and application.</div>
              </div>
            </label>
            <label class="form-option">
              <input type="radio" name="writingForm" value="letter">
              <div class="form-option-body">
                <div class="form-option-icon">&#9993;</div>
                <div class="form-option-label">Letter</div>
                <div class="form-option-desc">A personal doctrinal letter to a specific person. Pastoral in tone, direct in address.</div>
              </div>
            </label>
          </div>
          <div class="writing-modal-footer">
            <button class="btn-primary" id="formContinueBtn" disabled>Continue</button>
            <button class="btn-discard" id="cancelFormModalBtn">Cancel</button>
          </div>
        </div>

        <div id="wModalStep1" style="display:none;">
          <h3 class="writing-modal-title">Choose your writing mode</h3>
          <div class="tier-options">
            <label class="tier-option">
              <input type="radio" name="writingTier" value="1">
              <div class="tier-option-body">
                <div class="tier-option-label">Tier 1 &mdash; Full Scaffold</div>
                <div class="tier-option-desc">"I will answer five questions. You give me an outline. I write every word."</div>
              </div>
            </label>
            <label class="tier-option">
              <input type="radio" name="writingTier" value="2">
              <div class="tier-option-body">
                <div class="tier-option-label">Tier 2 &mdash; Guided Draft</div>
                <div class="tier-option-desc">"I will answer five questions. You write a first draft in my voice. I edit and own it."</div>
              </div>
            </label>
            <label class="tier-option">
              <input type="radio" name="writingTier" value="3">
              <div class="tier-option-body">
                <div class="tier-option-label">Tier 3 &mdash; Full Ghostwrite</div>
                <div class="tier-option-desc">"I will answer five questions. You write a complete publishable article. I review and publish."</div>
              </div>
            </label>
          </div>
          <div class="writing-modal-footer">
            <button class="btn-primary" id="tierContinueBtn" disabled>Continue</button>
            <button class="btn-discard" id="cancelWritingModalBtn">Cancel</button>
          </div>
        </div>

        <div id="wModalStep2" style="display:none;">
          <div class="question-progress">Question <span id="questionNum">1</span> of 5</div>
          <p id="questionText" class="question-text"></p>
          <textarea id="questionAnswer" class="chat-textarea" rows="4" placeholder="Your answer&#8230;"></textarea>
          <div class="writing-modal-footer">
            <button class="btn-primary" id="questionNextBtn" disabled>Next</button>
          </div>
        </div>
      </div>
    </div>`;

  res.send(renderLayout({
    req,
    activeSection: 'writing',
    title:         'Writing',
    content,
    scripts:       '<script src="/js/writing.js"></script>',
  }));
});

// ─── GET /my-articles ─────────────────────────────────────────────────────────
router.get('/my-articles', requireAuth, (req, res) => {
  const content = `
    <div class="page-header">
      <h2 class="page-title">My Articles</h2>
      <p class="page-subtitle">Your saved drafts and completed articles.</p>
    </div>
    <div id="myArticleList" class="article-list-container"></div>
    <div id="myArticleReading" class="reading-view-container" style="display:none;">
      <div class="reading-topbar">
        <button class="btn-warm" id="readingBackBtn">&#8592; Back</button>
        <div id="readingBadges" class="reading-badges"></div>
      </div>
      <div class="reading-card">
        <h2 id="readingTitle" class="reading-title"></h2>
        <div class="guide-font-toolbar" id="articleFontToolbar">
          <button class="guide-font-btn guide-font-btn-sm" id="articleFontDec">A&#8722;</button>
          <button class="guide-font-btn guide-font-btn-md" id="articleFontReset">A</button>
          <button class="guide-font-btn guide-font-btn-lg" id="articleFontInc">A+</button>
        </div>
        <div id="readingBody" class="reading-body"></div>
      </div>
    </div>`;

  res.send(renderLayout({
    req,
    activeSection: 'my-articles',
    title:         'My Articles',
    content,
    scripts:       '<script src="/js/my-articles.js"></script>',
  }));
});

// ─── GET /api/articles ────────────────────────────────────────────────────────
router.get('/api/articles', requireAuth, (req, res) => {
  const articles = readArticles()
    .filter(a => a.userId === req.session.userId)
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
  res.json({ success: true, articles });
});

// ─── GET /api/articles/:id ────────────────────────────────────────────────────
router.get('/api/articles/:id', requireAuth, (req, res) => {
  const articles = readArticles();
  const article  = articles.find(a => a.id === req.params.id && a.userId === req.session.userId);
  if (!article) return res.status(404).json({ success: false, error: 'Article not found.' });
  res.json({ success: true, article });
});

// ─── POST /api/articles ───────────────────────────────────────────────────────
router.post('/api/articles', requireAuth, (req, res) => {
  const { title, content, tier, form, answers, status } = req.body;
  if (!title) return res.status(400).json({ success: false, error: 'Title is required.' });

  const now     = new Date().toISOString();
  const article = {
    id:        randomUUID(),
    userId:    req.session.userId,
    title:     title.trim(),
    content:   content || '',
    tier:      tier || 1,
    form:      form || 'article',
    answers:   answers || {},
    status:    status || 'Draft',
    createdAt: now,
    updatedAt: now,
  };

  const articles = readArticles();
  articles.push(article);
  writeArticles(articles);
  res.json({ success: true, article });
});

// ─── PUT /api/articles/:id ────────────────────────────────────────────────────
router.put('/api/articles/:id', requireAuth, (req, res) => {
  const articles = readArticles();
  const idx      = articles.findIndex(a => a.id === req.params.id && a.userId === req.session.userId);
  if (idx === -1) return res.status(404).json({ success: false, error: 'Article not found.' });

  const { title, content, tier, form, answers, status } = req.body;
  articles[idx] = {
    ...articles[idx],
    title:     title !== undefined ? title.trim() : articles[idx].title,
    content:   content !== undefined ? content : articles[idx].content,
    tier:      tier   || articles[idx].tier,
    form:      form   || articles[idx].form || 'article',
    answers:   answers || articles[idx].answers,
    status:    status  || articles[idx].status,
    updatedAt: new Date().toISOString(),
  };

  writeArticles(articles);
  res.json({ success: true, article: articles[idx] });
});

// ─── PATCH /api/articles/:id/submit — Submit for review ──────────────────────
router.patch('/api/articles/:id/submit', requireAuth, (req, res) => {
  const articles = readArticles();
  const idx      = articles.findIndex(a => a.id === req.params.id && a.userId === req.session.userId);
  if (idx === -1) return res.status(404).json({ success: false, error: 'Article not found.' });
  if (articles[idx].status !== 'Complete') {
    return res.status(400).json({ success: false, error: 'Article must be Complete to submit for review.' });
  }
  articles[idx].status        = 'Pending';
  articles[idx].rejectionNote = null;
  articles[idx].updatedAt     = new Date().toISOString();
  writeArticles(articles);
  res.json({ success: true, article: articles[idx] });
});

// ─── DELETE /api/articles/:id ─────────────────────────────────────────────────
router.delete('/api/articles/:id', requireAuth, (req, res) => {
  const articles = readArticles();
  const idx      = articles.findIndex(a => a.id === req.params.id && a.userId === req.session.userId);
  if (idx === -1) return res.status(404).json({ success: false, error: 'Article not found.' });

  articles.splice(idx, 1);
  writeArticles(articles);
  res.json({ success: true });
});

// ─── POST /api/writing/generate ───────────────────────────────────────────────
router.post('/api/writing/generate', requireAuth, async (req, res) => {
  const { tier, answers, topic, form } = req.body;
  if (!tier || !answers) {
    return res.status(400).json({ success: false, error: 'Tier and answers are required.' });
  }

  const { IRON_INK_CORE_PROMPT, IRON_INK_WRITING_PROMPT } = req.app.locals.prompts;

  const formInstructions = {
    article: 'This is an article or essay. Structure it with a clear introduction, logical argument movements, objection and answer, and a doxological conclusion. It is written to be read, not heard.',
    sermon:  'This is a sermon or exhortation. Structure it with a compelling opening, expository body with clear movements, at least one illustration prompt [ILLUSTRATION: describe what kind of illustration would work here], and a direct application landing that tells the listener what to do or believe. Use repetition deliberately. Write for the ear, not the eye. End with a call to the congregation.',
    letter:  'This is a personal doctrinal letter to a specific person. Open by addressing them directly by their relationship to the writer (friend, sister, neighbor — whatever was stated in Q3/Q5). Write in a warm but doctrinally serious pastoral voice. Do not structure it like an essay — let it read like a genuine letter. Close with an expression of care and a prayer or blessing.',
  };
  const formInstruction = formInstructions[form] || formInstructions.article;

  const systemPrompt = IRON_INK_CORE_PROMPT + '\n\n' + IRON_INK_WRITING_PROMPT + '\n\n' + formInstruction;

  const tierInstructions = {
    1: "The student has chosen FULL SCAFFOLD mode. Produce a structured outline only — introduction, main arguments, objection and answer, doxological conclusion. Do not write any prose body.",
    2: "The student has chosen GUIDED DRAFT mode. Write a complete first draft using only the student's answers as theological source material. Label it clearly as 'First Draft — yours to edit.' Do not add doctrine the student did not supply.",
    3: "The student has chosen FULL GHOSTWRITE mode. Write a complete, polished, publishable article using only the student's answers as theological source material. Do not add doctrine the student did not supply.",
  };

  const tierLabel = tier === 1 ? 'outline' : tier === 2 ? 'first draft' : 'complete article';
  const userPrompt = `${tierInstructions[tier]}

The student's answers to the five questions are as follows:

Q1 (Central doctrinal claim): ${answers.q1}
Q2 (Scripture arguments): ${answers.q2}
Q3 (Intended reader and tone): ${answers.q3}
Q4 (Strongest objection and answer): ${answers.q4}
Q5 (Connection to life and doxology): ${answers.q5}

Generate the ${tierLabel} now.`;

  const model  = tier === 3 ? 'claude-opus-4-8' : 'claude-sonnet-4-6';
  const tokens = tier === 3 ? 4000 : tier === 2 ? 3000 : 1500;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    const message = await client.messages.create({
      model,
      max_tokens: tokens,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userPrompt }],
    });

    res.json({ success: true, content: message.content[0].text });
  } catch (err) {
    console.error('[Writing/generate]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
