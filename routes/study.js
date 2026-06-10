const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { requireAuth, renderLayout } = require('./layout');

const router = express.Router();

const STUDY_LEVEL_INSTRUCTIONS = {
  foundations: "STUDY LEVEL: This user is a beginner. Use plain conversational language. Define all theological terms when first introduced. Avoid academic jargon. Build explanations from the ground up. Use simple sentence structure.",
  journeyman:  "STUDY LEVEL: This user has solid familiarity with Reformed theology. Engage at a serious but readable level. Assume basic doctrinal literacy.",
  scholar:     "STUDY LEVEL: This user is at an advanced level. Use full academic register. Assume seminary-level vocabulary. Reference primary sources freely. Engage with technical theological distinctions.",
};

function getStudyLevelInstruction(settings) {
  const level = (settings && settings.studyLevel) || 'journeyman';
  return STUDY_LEVEL_INSTRUCTIONS[level] || STUDY_LEVEL_INSTRUCTIONS.journeyman;
}

const CATEGORIES = [
  {
    name: 'The Doctrines of Grace',
    topics: [
      'Total Depravity',
      'Unconditional Election',
      'Definite Atonement (Limited Atonement)',
      'Irresistible Grace',
      'Perseverance of the Saints',
    ],
  },
  {
    name: 'Soteriology',
    topics: [
      'Justification by Faith Alone',
      'Sanctification',
      'Regeneration',
      'Adoption',
      'The Ordo Salutis',
      'Union with Christ',
      'Glorification',
    ],
  },
  {
    name: 'Christology',
    topics: [
      'The Hypostatic Union',
      'The Atonement',
      'The Resurrection',
      'The Offices of Christ (Prophet, Priest, King)',
      'The Virgin Birth',
    ],
  },
  {
    name: 'The Attributes of God',
    topics: [
      'The Sovereignty of God',
      'The Holiness of God',
      'The Justice of God',
      'The Love of God',
      'The Omniscience of God',
      'The Immutability of God',
    ],
  },
  {
    name: 'Covenant Theology',
    topics: [
      'The Covenant of Works',
      'The Covenant of Grace',
      'The Covenant of Redemption',
      'Law and Gospel',
    ],
  },
  {
    name: 'Ecclesiology',
    topics: [
      'The Nature of the Church',
      'The Marks of a True Church',
      'Baptism',
      'The Lord\'s Supper',
      'Church Discipline',
    ],
  },
  {
    name: 'Eschatology',
    topics: [
      'The Return of Christ',
      'The Resurrection of the Dead',
      'Final Judgment',
      'Heaven and Hell',
    ],
  },
  {
    name: 'The Christian Life',
    topics: [
      'Prayer',
      'Scripture and the Means of Grace',
      'Repentance and Faith',
      'Spiritual Warfare',
      'Suffering and Providence',
    ],
  },
];

function buildTopicBrowser() {
  return CATEGORIES.map((cat, i) => `
    <div class="topic-category" id="cat-${i}">
      <button class="topic-cat-header" data-idx="${i}">
        <span class="topic-cat-name">${cat.name}</span>
        <span class="topic-cat-chevron">&#9660;</span>
      </button>
      <div class="topic-cat-body">
        ${cat.topics.map(t => `
          <button class="topic-item" data-topic="${t.replace(/"/g, '&quot;')}">${t}</button>
        `).join('')}
      </div>
    </div>`).join('');
}

// ─── GET /study ──────────────────────────────────────────────────────────────
router.get('/study', requireAuth, (req, res) => {
  const content = `
    <div class="page-header">
      <h2 class="page-title">Study</h2>
      <p class="page-subtitle">Select a curated topic or enter your own to generate a study guide.</p>
    </div>

    <div class="study-search-bar">
      <input type="text" id="topicInput" class="form-input study-topic-input"
             placeholder="Study any topic..." autocomplete="off">
      <button id="generateBtn" class="btn-primary">Generate Guide</button>
    </div>

    <div id="studyLoading" class="study-loading" style="display:none;">
      <div class="study-spinner"></div>
      <p class="loading-text">Preparing your study on <strong id="loadingTopicName"></strong>&#8230;</p>
      <button id="stopGenerationBtn" class="btn-stop">Stop Generation</button>
    </div>

    <div id="guideArea" style="display:none;">
      <div class="guide-header-bar">
        <h3 class="guide-display-title" id="guideTitle"></h3>
        <span class="guide-translation-badge" id="guideBadge"></span>
      </div>
      <div class="guide-font-toolbar">
        <button class="guide-font-btn guide-font-btn-sm" id="fontDecBtn">A&#8722;</button>
        <button class="guide-font-btn guide-font-btn-md" id="fontResetBtn">A</button>
        <button class="guide-font-btn guide-font-btn-lg" id="fontIncBtn">A+</button>
      </div>
      <div class="guide-body" id="guideBody"></div>
      <div class="guide-actions">
        <button class="btn-primary" id="saveLibraryBtn">Save to Library</button>
        <button class="btn-warm" id="dismissGuideBtn">Dismiss</button>
      </div>
    </div>

    <div id="savePanel" class="save-panel" style="display:none;">
      <h4 class="save-panel-title">Save to Library</h4>
      <div class="form-group">
        <label class="form-label">Topic Name</label>
        <input type="text" class="form-input" id="saveTopicInput">
      </div>
      <div class="form-group">
        <label class="form-label">Tags <span class="form-hint">(comma-separated)</span></label>
        <input type="text" class="form-input" id="saveTagsInput"
               placeholder="e.g. soteriology, election, TULIP">
      </div>
      <div class="form-group">
        <label class="form-label">Rating</label>
        <div class="star-rating" id="starRating">
          <span class="star" data-val="1">&#9733;</span>
          <span class="star" data-val="2">&#9733;</span>
          <span class="star" data-val="3">&#9733;</span>
          <span class="star" data-val="4">&#9733;</span>
          <span class="star" data-val="5">&#9733;</span>
        </div>
      </div>
      <div class="save-panel-btns">
        <button class="btn-primary" id="confirmSaveBtn">Save</button>
        <button class="btn-warm" id="cancelSaveBtn">Cancel</button>
      </div>
    </div>

    <div id="topicBrowser" class="topic-browser">
      <p class="topic-browser-label">Or choose from the curated list:</p>
      ${buildTopicBrowser()}
    </div>`;

  res.send(renderLayout({
    req,
    activeSection: 'study',
    title: 'Study',
    content,
    scripts: '<script src="/js/study.js"></script><script src="/js/library.js?v=8"></script>',
  }));
});

// ─── POST /api/study/generate ────────────────────────────────────────────────
router.post('/api/study/generate', requireAuth, async (req, res) => {
  const { topic } = req.body;
  if (!topic || !topic.trim()) {
    return res.status(400).json({ success: false, error: 'Topic is required.' });
  }

  const userSettings = req.session.user && req.session.user.settings;
  const translation  = (userSettings && userSettings.bibleTranslation) || 'LSB';

  const { IRON_INK_CORE_PROMPT, IRON_INK_STUDY_PROMPT } = req.app.locals.prompts;
  const studyLevelInstruction = getStudyLevelInstruction(userSettings);
  const systemPrompt = studyLevelInstruction + '\n\n' + IRON_INK_CORE_PROMPT + '\n\n' + IRON_INK_STUDY_PROMPT;

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const message = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 4000,
      system:     systemPrompt,
      messages: [{
        role:    'user',
        content: `Generate a Reformed theological study guide on the following topic from a biblical and confessional perspective: ${topic.trim()}\n\nBible translation preference: ${translation}`,
      }],
    });

    const content = message.content[0].text;
    res.json({ success: true, content, topic: topic.trim(), translation });
  } catch (err) {
    console.error('Study generation error — status:', err.status);
    console.error('Study generation error — message:', err.message);
    console.error('Study generation error — full:', err);

    const isContentFilter = err.status === 400 &&
      err.message && err.message.includes('content filtering policy');

    if (isContentFilter) {
      return res.status(400).json({
        success: false,
        error: 'This topic could not be generated due to content filtering. Try rephrasing — for example, "The origin of evil and angelic rebellion" instead of "when did satan fall".',
      });
    }

    res.status(500).json({ success: false, error: 'Generation failed. Please try again.' });
  }
});

module.exports = router;
