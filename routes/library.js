const express   = require('express');
const fs        = require('fs');
const path      = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { randomUUID } = require('crypto');
const { requireAuth, renderLayout } = require('./layout');
const notepadRoutes = require('./notepad');
const { injectWithAttribution, resolve, NASB_ATTRIBUTION } = require('../lib/asv');

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
      <p class="page-subtitle">Your saved studies and dialogue sessions.</p>
    </div>

    <div class="lib-tabs">
      <button class="lib-tab active" data-tab="studies">Studies</button>
      <button class="lib-tab" data-tab="dialogues">Dialogues</button>
      <button class="lib-tab" data-tab="notes">Notes</button>
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

      <div id="libGuideArea" style="display:none;">
        <div class="guide-header-bar">
          <h3 class="guide-display-title" id="libGuideTitle"></h3>
          <span class="guide-translation-badge" id="libGuideBadge"></span>
        </div>
        <div id="libLineageCrumb" class="lib-lineage-crumb" style="display:none;"></div>
        <div class="guide-font-toolbar">
          <button class="guide-font-btn guide-font-btn-sm" id="libFontDecBtn">A&#8722;</button>
          <button class="guide-font-btn guide-font-btn-md" id="libFontResetBtn">A</button>
          <button class="guide-font-btn guide-font-btn-lg" id="libFontIncBtn">A+</button>
          <button class="guide-print-btn" id="libPrintBtn" title="Print or save as PDF">&#9113; Print / Download</button>
        </div>
        <div class="guide-body" id="libGuideBody"></div>
        <div id="libBranchesList" class="lib-branches-list" style="display:none;"></div>
        <div id="libTreeLaunch" class="lib-tree-launch" style="display:none;">
          <button type="button" class="lib-view-tree-btn" id="libViewTreeBtn">&#127795; View full tree</button>
        </div>
        <div class="guide-actions">
          <button class="btn-warm" id="libBackBtn">Back to Library</button>
        </div>
      </div>
    </div>

    <div id="tab-dialogues" class="lib-tab-content" style="display:none;">
      <div id="dialogueCardsGrid" class="study-cards-grid">
        <p class="library-loading-msg">Loading&#8230;</p>
      </div>
    </div>

    <div id="tab-notes" class="lib-tab-content" style="display:none;">
      <div id="notesAllGrid">
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
          <button class="guide-print-btn" id="modalPrint" title="Print or save as PDF">&#9113; Print / Download</button>
        </div>
        <div class="guide-modal-body" id="modalBody"></div>
      </div>
    </div>

    <div id="treeModal" class="guide-modal" style="display:none;" role="dialog" aria-modal="true" aria-label="Study tree">
      <div class="guide-modal-inner tree-modal-inner">
        <div class="guide-modal-header">
          <div>
            <h3 class="guide-modal-title" id="treeModalTitle">&#127795; Study Tree</h3>
            <span class="tree-modal-sub" id="treeModalSub"></span>
          </div>
          <button class="modal-close-btn" id="closeTreeModal" title="Close">&#10005;</button>
        </div>
        <div class="tree-modal-body" id="treeModalBody"></div>
      </div>
    </div>`;

  res.send(renderLayout({
    req,
    activeSection: 'library',
    title: 'Library',
    content,
    scripts: '<script src="/js/study-badges.js?v=3"></script><script src="/js/render-markdown.js?v=1"></script><script src="/js/enhance-further-studies.js?v=2"></script><script src="/js/library.js?v=60"></script>',
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
  const { topic, content, translation, tags, rating, studyLength, studyLevel, studyType, createdAt, shared } = req.body;
  if (!topic || !content) {
    return res.status(400).json({ success: false, error: 'Topic and content are required.' });
  }

  const parsedTags = Array.isArray(tags)
    ? tags.map(t => t.trim()).filter(Boolean)
    : (tags || '').split(',').map(t => t.trim()).filter(Boolean);

  const userSettings = req.session.user && req.session.user.settings;
  const validLevels  = ['children', 'foundations', 'journeyman', 'scholar'];
  const validTypes   = ['doctrinal', 'explore', 'historical', 'scripture', 'open', 'people', 'pathway', 'book'];
  const now          = new Date().toISOString();
  const isShared     = shared === true;

  // Branch lineage (optional, additive). A study created by "branching" from
  // another carries parentId (the study it branched from) and rootId (the study
  // at the top of that branch's tree). Both default to null for a study created
  // normally (not by branching). Only a non-empty string is a valid id shape;
  // anything else (number, object, empty string, missing) coerces to null rather
  // than erroring. Dangling references are tolerated by design (graceful
  // orphaning) — we do NOT verify the referenced ids exist at save time.
  const coerceId = (v) => (typeof v === 'string' && v.trim() !== '') ? v : null;
  const parentId = coerceId(req.body.parentId);
  const rootId   = coerceId(req.body.rootId);

  // Branch provenance (optional, additive). sourcePrompt is the exact "Further
  // Studies" prompt text this study was branched from — used to gate that prompt
  // (one branch per prompt) when its parent is later viewed in the Library. It is
  // prompt text, not an id, so we trim to a non-empty string or null (never
  // coerceId). Null for any study not created by clicking a Further-Studies prompt.
  const coerceText = (v) => (typeof v === 'string' && v.trim() !== '') ? v.trim() : null;
  const sourcePrompt = coerceText(req.body.sourcePrompt);

  // Defense in depth: a branch (has a parentId) may never be an Explore study.
  // Explore STARTS a study journey; a branch CONTINUES one with a bounded type.
  // The client already disables Explore in branch mode, but the client can be
  // bypassed — so coerce a branch's Explore to the branch default here. Gentle
  // (matches the validTypes coercion pattern) and applies only to this new save;
  // existing records are never rewritten.
  let resolvedType = validTypes.includes(studyType) ? studyType : 'doctrinal';
  if (parentId && resolvedType === 'explore') resolvedType = 'pathway';

  const study = {
    id:          randomUUID(),
    userId:      req.session.userId,
    topic:       topic.trim(),
    content,
    translation: translation || 'ASV',
    tags:        parsedTags,
    rating:      Math.min(5, Math.max(0, parseInt(rating) || 0)),
    studyLevel:  validLevels.includes(studyLevel)
      ? studyLevel
      : ((userSettings && userSettings.studyLevel) || 'journeyman'),
    studyLength: ['Short', 'Standard', 'Deep'].includes(studyLength) ? studyLength : 'Short',
    studyType:   resolvedType,                // branches can never be 'explore' (coerced above)
    parentId,                                 // id of the study this branched from; null if not a branch
    rootId,                                   // id of the tree root for this branch; null if not a branch
    sourcePrompt,                             // exact Further-Studies prompt text this branched from; null if not a prompt-branch
    shared:      isShared,                    // community-sharing flag (default false)
    sharedAt:    isShared ? now : null,       // stamp when first shared, for feed sort
    createdAt:   createdAt || now,
    savedAt:     now,
  };

  const studies = readStudies();
  studies.push(study);
  writeStudies(studies);

  res.json({ success: true, study });
});

// ─── PUT /api/library/:id ────────────────────────────────────────────────────
router.put('/api/library/:id', requireAuth, (req, res) => {
  const { topic, tags, rating, shared } = req.body;
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
  if (shared !== undefined) {
    const nextShared = shared === true;
    // Stamp sharedAt only on the private → shared transition so the community
    // feed can sort by "when shared". Leave the original stamp if already shared.
    if (nextShared && studies[idx].shared !== true) {
      studies[idx].sharedAt = new Date().toISOString();
    }
    studies[idx].shared = nextShared;
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

  // Graceful orphaning: remove ONLY this one record. Do NOT walk the branch
  // tree, and do NOT touch, delete, or re-parent any study whose parentId/rootId
  // points at this id — children are left with their now-dangling lineage refs,
  // which a later UI phase surfaces as "parent study no longer available"
  // (mirroring the notepad studyExists pattern). No other record is modified.
  studies.splice(idx, 1);
  writeStudies(studies);

  // Cascade: delete this study's notepad + all its notes so nothing is orphaned.
  try {
    notepadRoutes.deleteNotepadsForStudy(req.params.id, req.session.userId);
  } catch (err) {
    console.error('Notepad cascade delete failed:', err.message);
  }

  res.json({ success: true });
});

// ─── POST /api/library/ask ────────────────────────────────────────────────────
router.post('/api/library/ask', requireAuth, async (req, res) => {
  const { question, highlightedText, studyTopic, history } = req.body;
  const hasHistory = history && Array.isArray(history) && history.length > 0;
  if (!hasHistory && (!question || !String(question).trim())) {
    return res.status(400).json({ success: false, error: 'Question is required.' });
  }

  const { IRON_INK_CORE_PROMPT } = req.app.locals.prompts;
  const systemPrompt = IRON_INK_CORE_PROMPT +
    '\n\nYou are answering inline questions from a student reading a saved study guide. ' +
    'Be concise and precise — 2–4 sentences for quick questions, more thorough for follow-ups in a chat. ' +
    'Stay within the confessionally Reformed framework at all times.';

  let messages;
  if (hasHistory) {
    messages = history;
  } else {
    let content = String(question).trim();
    if (highlightedText) {
      content = `I am reading a study on "${studyTopic || 'theology'}" and have selected this passage:\n\n"${String(highlightedText).trim()}"\n\n${content}`;
    }
    messages = [{ role: 'user', content }];
  }

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const message = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 800,
      system:     systemPrompt,
      messages,
    });
    // Inline answers use the core prompt, so the model quotes Scripture via
    // {{verse:...}} markers too — insert the verified verse text (NASB primary,
    // ASV fallback) and append the Lockman notice when NASB text appears.
    res.json({ success: true, answer: injectWithAttribution(message.content[0].text) });
  } catch (err) {
    console.error('Inline ask error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to get answer. Please try again.' });
  }
});

// ─── POST /api/library/verse ─────────────────────────────────────────────────
router.post('/api/library/verse', requireAuth, async (req, res) => {
  const { reference } = req.body;
  if (!reference || !String(reference).trim()) {
    return res.status(400).json({ success: false, error: 'Reference is required.' });
  }

  const ref = String(reference).trim();

  // Local, offline lookup: NASB (primary, from the on-demand cache) with a silent
  // ASV fallback — the same resolver the injection pipeline uses. No external Bible
  // API. When the resolved text is NASB, append the Lockman notice; an ASV fallback
  // gets the public-domain ASV note. Unresolvable → a gracious not-found.
  const r = resolve(ref);
  if (r) {
    const notice = r.source === 'NASB 1995'
      ? NASB_ATTRIBUTION
      : 'American Standard Version (1901, public domain)';
    const verse = '“' + r.text + '” — ' + ref + '\n\n' + notice;
    return res.json({ success: true, verse, source: r.source });
  }
  return res.json({ success: false, error: 'Verse not found. Check the reference format (e.g. John 3:16).' });
});

module.exports = router;
