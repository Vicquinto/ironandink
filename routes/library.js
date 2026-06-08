const express = require('express');
const fs      = require('fs');
const path    = require('path');
const { randomUUID } = require('crypto');
const { requireAuth, renderLayout } = require('./layout');

const router      = express.Router();
const STUDIES_PATH = path.join(__dirname, '../data/studies.json');

function readStudies() {
  try {
    if (!fs.existsSync(STUDIES_PATH)) return [];
    return JSON.parse(fs.readFileSync(STUDIES_PATH, 'utf8'));
  } catch { return []; }
}

function writeStudies(data) {
  fs.writeFileSync(STUDIES_PATH, JSON.stringify(data, null, 2));
}

// ─── GET /library ─────────────────────────────────────────────────────────────
router.get('/library', requireAuth, (req, res) => {
  const content = `
    <div class="page-header">
      <h2 class="page-title">Library</h2>
      <p class="page-subtitle">Your saved study guides and dialogue sessions.</p>
    </div>

    <div class="lib-tabs">
      <button class="lib-tab active" data-tab="studies">Studies</button>
      <button class="lib-tab" data-tab="dialogues">Dialogues</button>
    </div>

    <div id="tab-studies" class="lib-tab-content">
      <div class="library-filter-bar">
        <input type="text" id="filterTag" class="form-input library-filter-input"
               placeholder="Filter by tag&#8230;">
        <select id="filterRating" class="form-select library-filter-select">
          <option value="">All ratings</option>
          <option value="5">&#9733;&#9733;&#9733;&#9733;&#9733; &nbsp;5 stars</option>
          <option value="4">&#9733;&#9733;&#9733;&#9733; &nbsp;4+ stars</option>
          <option value="3">&#9733;&#9733;&#9733; &nbsp;3+ stars</option>
          <option value="1">Any rated</option>
        </select>
      </div>
      <div id="studyCardsGrid" class="study-cards-grid">
        <p class="library-loading-msg">Loading&#8230;</p>
      </div>
    </div>

    <div id="tab-dialogues" class="lib-tab-content" style="display:none;">
      <div id="dialogueCardsGrid" class="study-cards-grid">
        <p class="library-loading-msg">Loading&#8230;</p>
      </div>
    </div>

    <div id="guideModal" class="guide-modal" style="display:none;" role="dialog" aria-modal="true">
      <div class="guide-modal-inner">
        <div class="guide-modal-header">
          <div>
            <h3 class="guide-modal-title" id="modalTitle"></h3>
            <span class="guide-translation-badge" id="modalBadge"></span>
          </div>
          <button class="modal-close-btn" id="closeModal" title="Close">&#10005;</button>
        </div>
        <div class="guide-font-toolbar" id="modalFontToolbar">
          <button class="guide-font-btn guide-font-btn-sm" id="modalFontDec">A&#8722;</button>
          <button class="guide-font-btn guide-font-btn-md" id="modalFontReset">A</button>
          <button class="guide-font-btn guide-font-btn-lg" id="modalFontInc">A+</button>
        </div>
        <div class="guide-modal-body" id="modalBody"></div>
      </div>
    </div>`;

  res.send(renderLayout({
    req,
    activeSection: 'library',
    title: 'Library',
    content,
    scripts: '<script src="/js/library.js"></script>',
  }));
});

// ─── GET /api/library ─────────────────────────────────────────────────────────
router.get('/api/library', requireAuth, (req, res) => {
  const studies = readStudies().filter(s => s.userId === req.session.userId);
  studies.sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
  res.json({ success: true, studies });
});

// ─── POST /api/library/save ──────────────────────────────────────────────────
router.post('/api/library/save', requireAuth, (req, res) => {
  const { topic, content, translation, tags, rating, createdAt } = req.body;
  if (!topic || !content) {
    return res.status(400).json({ success: false, error: 'Topic and content are required.' });
  }

  const parsedTags = Array.isArray(tags)
    ? tags.map(t => t.trim()).filter(Boolean)
    : (tags || '').split(',').map(t => t.trim()).filter(Boolean);

  const study = {
    id:          randomUUID(),
    userId:      req.session.userId,
    topic:       topic.trim(),
    content,
    translation: translation || 'LSB',
    tags:        parsedTags,
    rating:      Math.min(5, Math.max(0, parseInt(rating) || 0)),
    createdAt:   createdAt || new Date().toISOString(),
    savedAt:     new Date().toISOString(),
  };

  const studies = readStudies();
  studies.push(study);
  writeStudies(studies);

  res.json({ success: true, study });
});

// ─── PUT /api/library/:id ────────────────────────────────────────────────────
router.put('/api/library/:id', requireAuth, (req, res) => {
  const { topic, tags, rating } = req.body;
  const studies = readStudies();
  const idx = studies.findIndex(
    s => s.id === req.params.id && s.userId === req.session.userId
  );
  if (idx === -1) return res.status(404).json({ success: false, error: 'Study not found.' });

  if (topic !== undefined) studies[idx].topic = String(topic).trim();
  if (tags !== undefined) {
    studies[idx].tags = String(tags).split(',').map(t => t.trim()).filter(Boolean);
  }
  if (rating !== undefined) {
    studies[idx].rating = Math.min(5, Math.max(0, parseInt(rating) || 0));
  }
  writeStudies(studies);
  res.json({ success: true, study: studies[idx] });
});

// ─── DELETE /api/library/:id ──────────────────────────────────────────────────
router.delete('/api/library/:id', requireAuth, (req, res) => {
  const studies = readStudies();
  const idx = studies.findIndex(
    s => s.id === req.params.id && s.userId === req.session.userId
  );
  if (idx === -1) return res.status(404).json({ success: false, error: 'Study not found.' });

  studies.splice(idx, 1);
  writeStudies(studies);
  res.json({ success: true });
});

module.exports = router;
