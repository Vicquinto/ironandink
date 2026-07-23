const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { requireAuth, renderLayout, getIsAdmin } = require('./layout');
const { VERSES } = require('./dashboard'); // reuse the Verse-of-the-Day pool for the patience loading screen
const { assertNoEsvText } = require('./esvGuard');
const { injectVerses } = require('../lib/asv');
const { aiLimiter } = require('../middleware/rateLimit');

const router = express.Router();

const STUDY_LENGTH_CONFIG = {
  Short:    { wordCount: 800,  maxTokens: 1600 },
  Standard: { wordCount: 1500, maxTokens: 2800 },
  Deep:     { wordCount: 3000, maxTokens: 5000 },
};

const STUDY_LEVEL_INSTRUCTIONS = {
  foundations: "WRITING REGISTER: FOUNDATIONAL. Write for a reader who is new to this topic, in patient, accessible prose that explains its reasoning step by step rather than assuming familiarity with how these arguments typically run. TERMINOLOGY: assume very little theological vocabulary — nearly every specialized term (theological, confessional, or original-language) must be carried in plain language the first time it appears, per the Core Governing Principle; err strongly toward carrying a term rather than assuming it. DEPTH OF ENTRY: teach at the introductory stratum — this is the intro course, not the graduate seminar taught slowly. Assume NO prior theological training. Establish the core, settled doctrine itself: what it is and why it matters. Do NOT open advanced intramural debates, contested edge cases, lapsarian-type controversies, or scholarly nuances that assume a foundation the reader does not yet have — those belong at the Standard and Advanced levels. This is NOT about producing less content or a narrower study: the study is still complete, whole, and satisfying; it simply enters the material at the foundational stratum. RESOLVE WHAT YOU RAISE: whatever hard questions the study does raise must still be fully resolved in-line and never left dangling, per the Core Governing Principle — but at this level, do not RAISE the advanced debates in the first place.",
  journeyman:  "WRITING REGISTER: STANDARD. Write in normal prose for a capable adult reader with some working theological vocabulary and familiarity with how Reformed argumentation typically proceeds. TERMINOLOGY: do NOT assume fluency with confessional or historical-theological shorthand — terms such as 'confessionally Reformed,' 'the affections,' 'federal headship,' 'covenant of grace,' 'common grace,' and similar specialized or confessional language must still be carried plainly the first time they appear, per the Core Governing Principle; these are specialized, not basic. You may move briskly past genuinely common terms, but when in doubt, carry it. DEPTH OF ENTRY: teach at the intermediate stratum. Assume the foundational doctrine is already in place, and build its main contours and most important nuances on top of it: introduce the significant distinctions and debates that matter for a real understanding of the subject — but do not go exhaustively into every scholarly controversy or fine edge case (those belong at the Advanced level). The study remains complete and whole; it simply enters above the introductory stratum. RESOLVE WHAT YOU RAISE: every hard question and objection the study raises must be resolved in-line, never deferred to the reader, per the Core Governing Principle.",
  scholar:     "WRITING REGISTER: ADVANCED. Write in sophisticated prose for a reader comfortable with theological vocabulary, confessional language, and the typical shape of Reformed exegetical and doctrinal argument; you need not pause for common terms. TERMINOLOGY: assume comfort with standard theological, confessional, and exegetical vocabulary, but still carry genuinely rare, technical, or contested terms the first time they appear, per the Core Governing Principle — fluency is not omniscience. DEPTH OF ENTRY: teach at the advanced stratum — the graduate seminar. Assume the foundation and the main contours are already known, and go to the full depth of the subject: the intramural debates, the historical development, the contested edges, and the hard nuances. RESOLVE WHAT YOU RAISE: every hard question and objection the study raises must be resolved in-line, never deferred to the reader, per the Core Governing Principle.",
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
      <p class="page-subtitle">Select a curated topic or enter your own to generate a study.</p>
    </div>

    <div class="study-type-picker" id="studyTypePicker" role="radiogroup" aria-label="Study type">
      <button class="study-type-option study-type-option--active" data-type="doctrinal" role="radio" aria-checked="true">
        <span class="study-type-name">Doctrinal</span>
        <span class="study-type-sub">Reformed doctrine, confessions &amp; historical voices</span>
      </button>
      <button class="study-type-option" data-type="explore" role="radio" aria-checked="false">
        <span class="study-type-name">Explore</span>
        <span class="study-type-sub">Big subject? Get oriented, then branch into further studies.</span>
      </button>
      <button class="study-type-option" data-type="historical" role="radio" aria-checked="false">
        <span class="study-type-name">Historical</span>
        <span class="study-type-sub">Timeline, places, and what happened</span>
      </button>
      <button class="study-type-option" data-type="scripture" role="radio" aria-checked="false">
        <span class="study-type-name">Scripture &amp; Verse</span>
        <span class="study-type-sub">Study a specific passage, verse by verse</span>
      </button>
      <button class="study-type-option" data-type="people" role="radio" aria-checked="false">
        <span class="study-type-name">Subject</span>
        <span class="study-type-sub">A person, place, or thing in Scripture &amp; its place in God&#39;s plan</span>
      </button>
      <button class="study-type-option" data-type="pathway" role="radio" aria-checked="false">
        <span class="study-type-name">Pathway</span>
        <span class="study-type-sub">A full study that follows the subject where it leads — and opens further paths.</span>
      </button>
      <button class="study-type-option" data-type="open" role="radio" aria-checked="false">
        <span class="study-type-name">Open</span>
        <span class="study-type-sub">Not sure which to pick? Start here — fits the study to the subject.</span>
      </button>
      <button class="study-type-option" data-type="book" role="radio" aria-checked="false">
        <span class="study-type-name">Book</span>
        <span class="study-type-sub">A whole book of the Bible — who wrote it, when, why, and its place in Scripture.</span>
      </button>
    </div>

    <div class="study-search-bar">
      <input type="text" id="topicInput" class="form-input study-topic-input"
             placeholder="Study any topic..." autocomplete="off">
      <div class="study-level-field" id="studyLevelField">
        <label class="form-label" for="studyLevelSelect">Study Level</label>
        <select id="studyLevelSelect" class="study-level-select" title="Writing register">
          <option value="foundations">Apprentice</option>
          <option value="journeyman">Journeyman</option>
          <option value="scholar">Scholar</option>
        </select>
      </div>
      <button id="generateBtn" class="btn-primary">Generate Study</button>
      <button id="appointedStudyBtn" class="btn-warm">Appointed Study</button>
      <button id="suggestTypeBtn" class="btn-warm" disabled>Suggest a study type</button>
    </div>

    <div class="study-length-picker" id="studyLengthPicker" aria-label="Study length" style="display:none;">
      <button class="study-length-btn study-length-btn--active" data-length="Short">Short</button>
      <button class="study-length-btn" data-length="Standard">Standard</button>
      <button class="study-length-btn" data-length="Deep">Deep</button>
    </div>

    <div id="studyLoading" class="study-loading" style="display:none;">
      <p class="loading-text">Preparing your study on <strong id="loadingTopicName"></strong>&#8230;</p>
      <p class="study-patience-msg">Please be patient &#8212; deep theological study takes time. Generation can take up to 2 minutes.</p>
      <div class="study-verse-rotator" id="studyVerseRotator">
        <blockquote class="study-verse-text" id="studyVerseText"></blockquote>
        <cite class="study-verse-ref" id="studyVerseRef"></cite>
      </div>
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
      <div class="form-group">
        <label class="share-toggle-row">
          <input type="checkbox" id="saveShareInput">
          <span class="share-toggle-label">Share to Community</span>
        </label>
        <p class="share-toggle-note">Publishes this study to the Community Studies feed under your name. You can un-share it later from your Library.</p>
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
    scripts: `<script src="/js/study-badges.js?v=2"></script><script src="/js/render-markdown.js?v=1"></script><script src="/js/enhance-further-studies.js?v=2"></script><script src="/js/study.js?v=20"></script><script src="/js/library.js?v=57"></script>
<script>
window.IS_ADMIN        = ${isAdmin};
window.USER_STUDY_LEVEL = ${JSON.stringify((req.session.user && req.session.user.settings && req.session.user.settings.studyLevel) || 'journeyman')};
window.STUDY_VERSES    = ${JSON.stringify(VERSES)};
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

// Detect an Anthropic platform content-filter block (HTTP 400). Robust against
// slight rephrasings of the English message: matches either a broadened,
// case-insensitive text signal OR the typed SDK error (BadRequestError /
// invalid_request_error). NOT a local blocklist — this only classifies errors
// the API itself returned.
function isContentFilterError(err) {
  if (!err || err.status !== 400) return false;

  // Text signal — checked across the SDK message and the structured body,
  // lowercased and broadened so a reworded message still matches.
  const text = [
    err.message,
    err.error && err.error.error && err.error.error.message,
    err.error && err.error.message,
  ].filter(Boolean).join(' ').toLowerCase();
  const messageMatch =
    text.includes('content filtering policy') ||  // original exact phrase
    text.includes('content filter') ||
    text.includes('blocked by content');

  // Typed signal — a content-filter block surfaces as a 400 BadRequestError /
  // invalid_request_error. Less fragile than the text match if Anthropic
  // rephrases the message.
  const typedMatch =
    (typeof Anthropic.BadRequestError === 'function' && err instanceof Anthropic.BadRequestError) ||
    (err.error && err.error.error && err.error.error.type === 'invalid_request_error') ||
    (err.error && err.error.type === 'invalid_request_error') ||
    err.type === 'invalid_request_error';

  return messageMatch || typedMatch;
}

// ─── POST /api/study/generate ────────────────────────────────────────────────
router.post('/api/study/generate', requireAuth, async (req, res) => {
  const { topic, studyLevel, studyType, length } = req.body;
  if (!topic || !topic.trim()) {
    return res.status(400).json({ success: false, error: 'Topic is required.' });
  }

  const userSettings  = req.session.user && req.session.user.settings;
  // All study Scripture is verified ASV, inserted by the server from data/asv.json
  // via {{verse:...}} markers — the model never writes verse text — so the study's
  // translation label is always ASV regardless of any legacy per-user preference.
  const translation   = 'ASV';
  // Length tier system suspended — tiers kept in STUDY_LENGTH_CONFIG but bypassed for now
  const studyLength   = STUDY_LENGTH_CONFIG[length] ? length : 'Short';

  const {
    IRON_INK_CORE_PROMPT,
    IRON_INK_STUDY_PROMPT,
    IRON_INK_EXPLORE_PROMPT,
    IRON_INK_HISTORICAL_PROMPT,
    IRON_INK_SCRIPTURE_PROMPT,
    IRON_INK_OPEN_PROMPT,
    IRON_INK_PEOPLE_PROMPT,
    IRON_INK_PATHWAY_PROMPT,
    IRON_INK_BOOK_PROMPT,
  } = req.app.locals.prompts;

  // Study-type → prompt map. Doctrinal is the default (unchanged legacy behavior).
  const STUDY_TYPE_PROMPTS = {
    doctrinal:  IRON_INK_STUDY_PROMPT,
    explore:    IRON_INK_EXPLORE_PROMPT,
    historical: IRON_INK_HISTORICAL_PROMPT,
    scripture:  IRON_INK_SCRIPTURE_PROMPT,
    open:       IRON_INK_OPEN_PROMPT,
    people:     IRON_INK_PEOPLE_PROMPT,
    pathway:    IRON_INK_PATHWAY_PROMPT,
    book:       IRON_INK_BOOK_PROMPT,
  };
  const resolvedStudyType = STUDY_TYPE_PROMPTS[studyType] ? studyType : 'doctrinal';
  const studyPrompt       = STUDY_TYPE_PROMPTS[resolvedStudyType];

  const resolvedStudyLevel = (studyLevel && STUDY_LEVEL_INSTRUCTIONS[studyLevel])
    ? studyLevel
    : ((userSettings && userSettings.studyLevel) || 'journeyman');
  const studyLevelInstruction = STUDY_LEVEL_INSTRUCTIONS[resolvedStudyLevel] || STUDY_LEVEL_INSTRUCTIONS.journeyman;

  // Depth rule: the writing register (studyLevel) applies to every type EXCEPT
  // explore (doctrinal, historical, scripture, and open all get the level prefix).
  // Explore has no depth dial by design, so it alone gets no level-register prefix —
  // its system prompt is CORE + the Explore prompt alone.
  const systemPrompt = (resolvedStudyType === 'explore')
    ? IRON_INK_CORE_PROMPT + '\n\n' + studyPrompt
    : studyLevelInstruction + '\n\n' + IRON_INK_CORE_PROMPT + '\n\n' + studyPrompt;

  const reqStart = Date.now();
  console.log(`[study-gen] START topic="${topic.trim()}" type="${resolvedStudyType}" level="${resolvedStudyLevel}" time=${new Date().toISOString()}`);

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const userMessage = `Generate a Reformed theological study guide on the following topic from a biblical and confessional perspective: ${topic.trim()}\n\nRemember: do not write any Bible verse text yourself. Quote Scripture only by emitting {{verse:Book Chapter:Verse}} markers; the system inserts the verified ASV text.`;

  // The content filter blocks the specific generated OUTPUT, which differs on
  // every call — so a fresh regeneration usually passes. Retry up to 3 times
  // total on a content-filter block before giving up.
  const MAX_ATTEMPTS = 3;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const attemptStart = Date.now();
    try {
      console.log(`[study-gen] Calling Anthropic API — attempt ${attempt} time=${new Date().toISOString()}`);
      // Crossway ESV compliance: the study prompt carries only the topic and
      // instructions (verse text is inserted post-generation from ASV, never
      // fetched), but guard defensively so ESV text can never enter this prompt.
      assertNoEsvText('study/generate', systemPrompt, userMessage);
      const message = await client.messages.create({
        model:      'claude-sonnet-4-6',
        max_tokens: 8000,
        system:     systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      });
      console.log(`[study-gen] API call ${attempt} finished in ${Date.now() - attemptStart}ms — success`);
      console.log(`[study-gen] stop_reason: ${message.stop_reason}`);

      // Replace every {{verse:...}} marker with real, verified ASV text from
      // data/asv.json. The model never writes Scripture; all verse text is
      // inserted here. Unresolvable markers collapse to the plain reference —
      // never model-generated verse text.
      const content = injectVerses(message.content[0].text);
      console.log(`[study-gen] DONE total time=${Date.now() - reqStart}ms`);
      return res.json({ success: true, content, topic: topic.trim(), translation, studyLength, studyLevel: resolvedStudyLevel, studyType: resolvedStudyType });
    } catch (err) {
      if (isContentFilterError(err)) {
        console.log(`[study-gen] API call ${attempt} finished in ${Date.now() - attemptStart}ms — filtered`);
        const requestId = err.request_id || err.requestID ||
          (err.headers && (err.headers['request-id'] || err.headers['x-request-id'])) || 'unknown';
        console.log(`Study generation — content-filter block on attempt ${attempt}/${MAX_ATTEMPTS} (request_id: ${requestId})`);

        if (attempt < MAX_ATTEMPTS) {
          console.log(`[study-gen] Content filter triggered retry ${attempt}/${MAX_ATTEMPTS}`);
          console.log(`Study generation — retrying with a fresh generation (attempt ${attempt + 1}/${MAX_ATTEMPTS})`);
          continue; // fresh API call; the output differs, so a retry has a good chance of passing
        }

        // All attempts were blocked by the content filter — give up with an honest message.
        console.log('Study generation — all attempts blocked by content filter; returning friendly message.');
        console.log(`[study-gen] DONE total time=${Date.now() - reqStart}ms`);
        return res.status(400).json({
          success: false,
          error: "We couldn't generate a study on this topic right now. This occasionally happens with weighty subjects. Please try again, or try rephrasing the topic slightly.",
        });
      }

      // Any other error — preserve existing behavior (generic 500), no retry.
      console.log(`[study-gen] API call ${attempt} finished in ${Date.now() - attemptStart}ms — failure`);
      console.error('Study generation error — status:', err.status);
      console.error('Study generation error — message:', err.message);
      console.error('Study generation error — full:', err);
      console.log(`[study-gen] DONE total time=${Date.now() - reqStart}ms`);
      return res.status(500).json({ success: false, error: 'Generation failed. Please try again.' });
    }
  }
});

// ─── POST /api/study/suggest-type ────────────────────────────────────────────
// Recommends which of the seven study types best fits a topic. Advisory only —
// the client highlights the suggestion in the picker, and whatever the member has
// selected at Generate is what gets used.
//
// Classification is on the shape of the SUBJECT, never the reader: no study level
// or depth is inferred here.

// The keys the picker uses, with the exact card descriptions members read. Kept
// in step with the .study-type-option cards in GET /study below — if a card's
// wording changes, change it here too so the model classifies against what the
// member actually sees.
const SUGGEST_TYPE_OPTIONS = [
  { key: 'doctrinal',  label: 'Doctrinal',         desc: 'Reformed doctrine, confessions & historical voices' },
  { key: 'explore',    label: 'Explore',           desc: 'Big subject? Get oriented, then branch into further studies.' },
  { key: 'historical', label: 'Historical',        desc: 'Timeline, places, and what happened' },
  { key: 'scripture',  label: 'Scripture & Verse', desc: 'Study a specific passage, verse by verse' },
  { key: 'people',     label: 'Subject',           desc: 'A person, place, or thing in Scripture & its place in God\'s plan' },
  { key: 'pathway',    label: 'Pathway',           desc: 'A full study that follows the subject where it leads — and opens further paths.' },
  { key: 'open',       label: 'Open',              desc: 'Not sure which to pick? Start here — fits the study to the subject.' },
  { key: 'book',       label: 'Book',              desc: 'A study of an entire book of the Bible — its authorship, date, themes, and structure.' },
];

const SUGGEST_VALID_KEYS = SUGGEST_TYPE_OPTIONS.map(o => o.key);

// Strip ``` fences before parsing. Asking for bare JSON usually gets bare JSON,
// but a fenced reply is the common failure and is cheap to recover from.
function parseSuggestion(raw) {
  let text = String(raw || '').trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '').trim();
  }
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

router.post('/api/study/suggest-type', requireAuth, aiLimiter, async (req, res) => {
  const { topic } = req.body;
  if (!topic || !String(topic).trim()) {
    return res.status(400).json({ success: false, error: 'Enter a topic first.' });
  }

  const cleanTopic = String(topic).trim().slice(0, 300);

  // Note the label/key split: `people` is shown to members as "Subject". The model
  // is told to return the KEY, and the key is validated below — otherwise a
  // sensible-looking "subject" would silently fall back to Open.
  const typeList = SUGGEST_TYPE_OPTIONS
    .map(o => `- ${o.key} (shown as "${o.label}"): ${o.desc}`)
    .join('\n');

  const systemPrompt =
    'You help a Reformed Bible study platform choose which study type best fits a topic.\n\n' +
    'The seven study types are:\n' + typeList + '\n\n' +
    'Choose the ONE type that best fits the shape of the subject itself — what kind of thing ' +
    'it is and how it is best studied. Do not consider the reader\'s experience level, and do ' +
    'not comment on difficulty or depth.\n\n' +
    'If the topic does not clearly fit a named type, answer "open" — that is a legitimate ' +
    'answer, not a failure, and Open adapts the study to the subject.\n\n' +
    'Respond with JSON only, in exactly this form:\n' +
    '{"type": "<key>", "reason": "<one short sentence>"}\n\n' +
    'Use one of these exact keys: ' + SUGGEST_VALID_KEYS.join(', ') + '. ' +
    'The reason must be one short sentence explaining the fit, addressed to the member. ' +
    'No preamble, no explanation outside the JSON, no markdown code fences.';

  const userMessage = `Topic: ${cleanTopic}`;

  try {
    assertNoEsvText('study/suggest-type', systemPrompt, userMessage);

    const client  = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const message = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system:     systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const parsed = parseSuggestion(message.content[0].text);

    // Any unusable answer degrades to Open rather than failing the request — Open
    // is a real option that fits the study to the subject, so it is a safe default.
    if (!parsed) {
      return res.json({
        success: true,
        type:    'open',
        reason:  'No single type stood out for this topic — Open adapts the study to the subject.',
      });
    }

    const type = SUGGEST_VALID_KEYS.includes(parsed.type)
      ? parsed.type
      : 'open';

    let reason = typeof parsed.reason === 'string' ? parsed.reason.trim() : '';
    if (!reason) reason = 'Suggested based on the shape of this topic.';
    reason = reason.slice(0, 240);

    return res.json({ success: true, type, reason });

  } catch (err) {
    if (err && err.code === 'ESV_TEXT_BLOCKED') {
      console.error('ESV guard:', err.message);
      return res.status(422).json({ success: false, error: 'That selection cannot be sent to the AI.' });
    }
    console.error('[study/suggest-type]', err.message);
    return res.status(500).json({ success: false, error: 'Could not suggest a type. Please try again.' });
  }
});

module.exports = router;
