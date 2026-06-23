const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { requireAuth, renderLayout, getIsAdmin } = require('./layout');

const router = express.Router();

const STUDY_LENGTH_CONFIG = {
  Short:    { wordCount: 800,  maxTokens: 1600 },
  Standard: { wordCount: 1500, maxTokens: 2800 },
  Deep:     { wordCount: 3000, maxTokens: 5000 },
};

const STUDY_LEVEL_INSTRUCTIONS = {
  foundations: "WRITING REGISTER: FOUNDATIONAL. Write for a reader who is new to this topic and may not yet have much theological vocabulary. Define theological terms in plain language as you introduce them. Assume the reader holds very little theological vocabulary. Nearly every specialized term — theological, confessional, or original-language — should be carried in plain language the first time it appears, per the Core Governing Principle. Err strongly toward carrying a term rather than assuming it. Take time to explain reasoning step by step rather than assuming familiarity with how these arguments typically run. This does NOT mean simplifying the actual content, shortening the study, or omitting hard questions — every hard question must still be fully resolved per the Core Governing Principle. It means writing with more patience and more explanation for someone earlier in their theological reading, while still producing a real, substantive, adult treatment of the subject.\n\nIMPORTANT — patience is not the same as expansiveness: do not use this lower assumed-background level as license to cover MORE ground, explore MORE tangents, or include MORE separate word-studies than you would at Standard or Advanced. If a single original-language term is genuinely the key to understanding a passage, you may briefly explain it in plain terms — but do not stack multiple etymological or word-study asides within a single thread or section just because the register is more patient. The goal is the SAME scope explained more gently, not a more thorough or more exhaustive treatment. If you find yourself adding a third or fourth separate term-by-term breakdown within one section, stop and ask whether that's actually necessary for a reader new to the topic, or whether it's scope creep.",
  journeyman:  "WRITING REGISTER: STANDARD. Write for a reader with some working theological vocabulary and familiarity with how Reformed argumentation typically proceeds. Assume the reader has some working theological vocabulary, but do NOT assume fluency with confessional or historical-theological shorthand. Terms such as 'confessionally Reformed,' 'the affections,' 'federal headship,' 'covenant of grace,' 'common grace,' and similar specialized or confessional language must still be carried plainly the first time they appear, per the Core Governing Principle — these are specialized, not basic. You may move briskly past genuinely common terms, but when in doubt, carry it. The Core Governing Principle applies fully: every hard question and objection must be resolved in-line, never deferred to the reader.",
  scholar:     "WRITING REGISTER: ADVANCED. Write for a reader who is comfortable with theological vocabulary, confessional language, and the typical shape of Reformed exegetical and doctrinal argument. Assume the reader is comfortable with standard theological, confessional, and exegetical vocabulary. You need not pause for common terms. Per the Core Governing Principle, still carry genuinely rare, technical, or contested terms the first time they appear — fluency is not omniscience. The Core Governing Principle applies fully: every hard question and objection must be resolved in-line, never deferred to the reader.",
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
      <select id="studyLevelSelect" class="study-level-select" title="Writing register">
        <option value="foundations">Foundational</option>
        <option value="journeyman">Standard</option>
        <option value="scholar">Advanced</option>
      </select>
      <button id="generateBtn" class="btn-primary">Generate Guide</button>
      <button id="appointedStudyBtn" class="btn-warm">Appointed Study</button>
    </div>

    <div class="study-length-picker" id="studyLengthPicker" aria-label="Study length" style="display:none;">
      <button class="study-length-btn study-length-btn--active" data-length="Short">Short</button>
      <button class="study-length-btn" data-length="Standard">Standard</button>
      <button class="study-length-btn" data-length="Deep">Deep</button>
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
      <!-- TEMP: admin word-count monitor for Study Length tuning — remove later -->
      <div id="studyAdminWc" style="display:none;margin-top:8px;font-size:0.78rem;color:#9a8060;font-family:'EB Garamond',Georgia,serif;letter-spacing:0.03em;"></div>
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

  const isAdmin = getIsAdmin(req);
  res.send(renderLayout({
    req,
    activeSection: 'study',
    title: 'Study',
    content,
    scripts: `<script src="/js/study.js"></script><script src="/js/library.js?v=20"></script>
<script>
window.IS_ADMIN        = ${isAdmin};
window.USER_STUDY_LEVEL = ${JSON.stringify((req.session.user && req.session.user.settings && req.session.user.settings.studyLevel) || 'journeyman')};
</script>
<script>
(function() {
  var APPOINTED_TOPICS = [
    // Theology Proper
    "The Existence of God",
    "The Trinity: One God in Three Persons",
    "The Aseity of God",
    "The Immutability of God",
    "The Omniscience of God",
    "The Omnipotence of God",
    "The Omnipresence of God",
    "The Holiness of God",
    "The Justice of God",
    "The Wrath of God",
    "The Love of God",
    "The Sovereignty of God",
    "Divine Simplicity",
    "Divine Eternity and Timelessness",
    "The Eternal Generation of the Son",
    "The Procession of the Holy Spirit",
    "The Filioque Controversy",
    "Trinitarian Relations and Perichoresis",
    // Christology
    "The Hypostatic Union",
    "The Communicatio Idiomatum",
    "The Humiliation and Exaltation of Christ",
    "The Threefold Office of Christ: Prophet, Priest, and King",
    "The Virgin Birth",
    "The Impeccability of Christ",
    "The Resurrection of Christ",
    "The Ascension and Session of Christ",
    "The Active and Passive Obedience of Christ",
    "Penal Substitutionary Atonement",
    // Pneumatology
    "The Personality of the Holy Spirit",
    "The Deity of the Holy Spirit",
    "The Work of the Holy Spirit in Regeneration",
    "The Sealing of the Holy Spirit",
    "Cessationism and the Gifts of the Spirit",
    // Anthropology
    "The Image of God (Imago Dei)",
    "The Fall and Original Sin",
    "Total Depravity",
    "The Bondage of the Will",
    "Original Sin and Imputation",
    // Soteriology
    "Unconditional Election",
    "Definite Atonement",
    "Irresistible Grace",
    "Perseverance of the Saints",
    "The Ordo Salutis",
    "Effectual Calling",
    "Regeneration",
    "Saving Faith",
    "Repentance",
    "Justification by Faith Alone",
    "The Imputation of Christ's Righteousness",
    "Adoption into the Family of God",
    "Sanctification",
    "Union with Christ",
    "Glorification",
    "Assurance of Salvation",
    // Covenant Theology
    "The Covenant of Works",
    "The Covenant of Grace",
    "The Covenant of Redemption (Pactum Salutis)",
    "Law and Gospel",
    "The New Covenant",
    "Israel and the Church in Covenant Theology",
    "Infant Baptism and Covenant Theology",
    // Ecclesiology
    "The Invisible and Visible Church",
    "The Marks of a True Church",
    "Church Discipline",
    "The Keys of the Kingdom",
    "Baptism: Mode and Meaning",
    "The Lord's Supper: Reformed Doctrine",
    "Presbyterian Church Government",
    "The Regulative Principle of Worship",
    "Preaching as a Means of Grace",
    // Eschatology
    "Amillennialism",
    "Postmillennialism",
    "The Return of Christ",
    "The General Resurrection",
    "The Final Judgment",
    "Heaven and the Beatific Vision",
    "Hell and Eternal Punishment",
    "The New Creation",
    // Bibliology
    "The Inspiration of Scripture",
    "The Inerrancy of Scripture",
    "The Sufficiency of Scripture",
    "Sola Scriptura",
    "The Canon of Scripture",
    "The Perspicuity of Scripture",
    "Grammatical-Historical Hermeneutics",
    "Scripture Interprets Scripture",
    // Biblical Theology
    "The Kingdom of God in Biblical Theology",
    "Typology in the Old Testament",
    "The Messianic Psalms",
    "Prophecy and Fulfillment in the Old Testament",
    "The Servant Songs of Isaiah",
    // Books of the Bible
    "The Book of Job: Suffering and Sovereignty",
    "The Psalms: Theology and Worship",
    "Proverbs and the Fear of the LORD",
    "Isaiah and the Suffering Servant",
    "Jeremiah and the New Covenant",
    "Daniel: Prophecy and the Sovereignty of God",
    "Romans: The Gospel of Justification",
    "Galatians: Freedom from the Law",
    "Ephesians: Election and the Church",
    "Hebrews: Christ as High Priest",
    "James: Faith and Works",
    "Revelation: The Victory of the Lamb",
    "The Gospel of John: The Incarnate Word",
    "The Gospel of Matthew: The Kingdom of Heaven",
    "Romans 8 and the Assurance of the Elect",
    "Romans 9 to 11 and Divine Sovereignty",
    "Ephesians 1 and the Blessings of Election",
    "The Beatitudes: Matthew 5",
    "The Lord's Prayer: Theology and Practice",
    "Psalm 119 and the Love of God's Law",
    "The High Priestly Prayer of John 17",
    "The New Covenant in Hebrews",
    // Church History
    "The Council of Nicaea and the Nicene Creed",
    "Augustine of Hippo: Grace and Predestination",
    "The Pelagian Controversy",
    "Anselm and the Satisfaction Theory of Atonement",
    "The Medieval Church and Scholasticism",
    // The Reformation
    "Martin Luther and Justification by Faith",
    "The Five Solas of the Reformation",
    "John Calvin and the Institutes of the Christian Religion",
    "Calvin on the Knowledge of God",
    "Calvin on Predestination",
    "Calvin on the Lord's Supper",
    "Ulrich Zwingli and the Swiss Reformation",
    "The Heidelberg Catechism",
    "The Belgic Confession",
    "The Canons of Dort",
    "The Synod of Dort and Arminianism",
    "The Westminster Confession of Faith",
    "The Westminster Shorter Catechism",
    "The Westminster Larger Catechism",
    "Theodore Beza and Reformed Scholasticism",
    "Sola Fide: The Article on Which the Church Stands or Falls",
    "Solus Christus: Christ Alone",
    "Soli Deo Gloria: For the Glory of God Alone",
    // Puritan Theology
    "John Owen: The Death of Death in the Death of Christ",
    "John Owen: Communion with God",
    "John Owen: The Holy Spirit",
    "John Owen: Mortification of Sin",
    "Thomas Goodwin on Union with Christ",
    "Richard Sibbes and the Bruised Reed",
    "John Bunyan: Grace Abounding to the Chief of Sinners",
    "Thomas Watson: A Body of Divinity",
    "William Perkins and Covenant Theology",
    "The Puritans on Prayer",
    "The Puritan Doctrine of Sanctification",
    "The Puritan Conscience and Assurance",
    // Jonathan Edwards
    "Jonathan Edwards: Religious Affections",
    "Jonathan Edwards: Freedom of the Will",
    "Jonathan Edwards: Original Sin",
    "Jonathan Edwards: The End for Which God Created the World",
    "The Great Awakening and Reformed Revival",
    "Edwards on Heaven and the Beauty of God",
    // Charles Spurgeon
    "Spurgeon on the Doctrines of Grace",
    "Spurgeon on Justification",
    "Spurgeon on Prayer",
    "Spurgeon: Calvinism and Evangelism",
    "Spurgeon on the Atonement",
    // B.B. Warfield
    "B.B. Warfield on Biblical Inerrancy",
    "B.B. Warfield on the Person of Christ",
    "B.B. Warfield on Perfectionism",
    "Warfield and the Princeton Theology",
    // J. Gresham Machen
    "Machen: Christianity and Liberalism",
    "Machen on the Virgin Birth",
    "Machen and the Founding of Westminster Seminary",
    "The Modernist-Fundamentalist Controversy",
    // Other Key Figures
    "Abraham Kuyper and Common Grace",
    "Herman Bavinck on the Doctrine of God",
    "Herman Bavinck on Holy Scripture",
    "Francis Turretin and Reformed Orthodoxy",
    "John Murray: Redemption Accomplished and Applied",
    "Louis Berkhof: Systematic Theology",
    "Geerhardus Vos: Biblical Theology",
    "R.C. Sproul on the Holiness of God",
    "The Marrow Controversy",
    // Key Doctrines
    "The Sabbath and the Lord's Day",
    "Common Grace",
    "Natural Law and General Revelation",
    "The Two Kingdoms Doctrine",
    "Christian Vocation and the Glory of God",
    "The Third Use of the Law",
    "The Mortification of Sin",
    "The Fear of the LORD",
    "The Doctrine of Providence",
    "Miracles and the Cessation of Gifts",
    "The Regulative Principle of Worship",
    "The Problem of Evil in Reformed Thought",
    "Spiritual Warfare and the Christian Life",
    "Suffering and Providence",
    "The Means of Grace",
    // Polemics and Comparative Theology
    "Calvinism vs. Arminianism",
    "Justification: Trent vs. the Reformation",
    "The Federal Vision Controversy",
    "New Perspective on Paul: A Reformed Critique",
    "Open Theism: A Reformed Response",
    "Word-Faith Theology: A Reformed Critique",
    "Antinomianism and the Third Use of the Law",
    "Theistic Evolution and Reformed Anthropology",
    "The Doxology of Romans 11:36: From Him, Through Him, To Him",
  ];

  var btn = document.getElementById('appointedStudyBtn');
  if (!btn) return;

  btn.addEventListener('click', function() {
    var topic = APPOINTED_TOPICS[Math.floor(Math.random() * APPOINTED_TOPICS.length)];
    var input = document.getElementById('topicInput');
    if (input) {
      input.value = topic;
      input.focus();
    }
  });
})();
</script>`,
  }));
});

// ─── POST /api/study/generate ────────────────────────────────────────────────
router.post('/api/study/generate', requireAuth, async (req, res) => {
  const { topic, studyLevel, length } = req.body;
  if (!topic || !topic.trim()) {
    return res.status(400).json({ success: false, error: 'Topic is required.' });
  }

  const userSettings  = req.session.user && req.session.user.settings;
  const translation   = (userSettings && userSettings.bibleTranslation) || 'LSB';
  // Length tier system suspended — tiers kept in STUDY_LENGTH_CONFIG but bypassed for now
  const studyLength   = STUDY_LENGTH_CONFIG[length] ? length : 'Short';

  const { IRON_INK_CORE_PROMPT, IRON_INK_STUDY_PROMPT } = req.app.locals.prompts;
  const resolvedStudyLevel = (studyLevel && STUDY_LEVEL_INSTRUCTIONS[studyLevel])
    ? studyLevel
    : ((userSettings && userSettings.studyLevel) || 'journeyman');
  const studyLevelInstruction = STUDY_LEVEL_INSTRUCTIONS[resolvedStudyLevel] || STUDY_LEVEL_INSTRUCTIONS.journeyman;
  const systemPrompt = studyLevelInstruction + '\n\n' + IRON_INK_CORE_PROMPT + '\n\n' + IRON_INK_STUDY_PROMPT;

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const message = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 6000,
      system:     systemPrompt,
      messages: [{
        role:    'user',
        content: `Generate a Reformed theological study guide on the following topic from a biblical and confessional perspective: ${topic.trim()}\n\nBible translation preference: ${translation}`,
      }],
    });

    const content = message.content[0].text;
    res.json({ success: true, content, topic: topic.trim(), translation, studyLength, studyLevel: resolvedStudyLevel });
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
