const express   = require('express');
const fs        = require('fs');
const path      = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const rateLimit = require('express-rate-limit');
const { randomUUID } = require('crypto');
const { requireAuth, renderLayout } = require('./layout');
const notepadRoutes = require('./notepad');
const { deleteBookmarksForStudy } = require('./study-bookmarks');
const { injectWithAttribution, resolve, NASB_ATTRIBUTION } = require('../lib/asv');
const { takeGeneratedMap, deriveMap } = require('../lib/study-map');
const geo = require('../lib/geo');
const original = require('../lib/original');
const { TYPE_KEYS } = require('../lib/study-types');

const router      = express.Router();
const STUDIES_PATH = path.join(__dirname, '../data/studies.json');

function readStudies() {
  try {
    if (!fs.existsSync(STUDIES_PATH)) return [];
    return JSON.parse(fs.readFileSync(STUDIES_PATH, 'utf8'));
  } catch { return []; }
}

// Atomic write: a temp file (pid in the name — pm2 reload overlaps two
// processes for a moment), then rename it over the store, so a crash mid-write
// leaves the previous file intact rather than a truncated one.
function writeStudies(data) {
  const tmp = `${STUDIES_PATH}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, STUDIES_PATH);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* already gone */ }
    throw err;
  }
}

// Archive is a light write; this sits under the global /api/ limiter as a
// second, tighter guard (the bulk route can carry up to ARCHIVE_BULK_MAX ids).
const archiveLimiter = rateLimit({
  windowMs: 60 * 1000,
  max:      30,
  message:  { success: false, error: 'Too many requests. Please wait a moment and try again.' },
  standardHeaders: true,
  legacyHeaders:   false,
});
const ARCHIVE_BULK_MAX = 200;

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
        <select id="filterStatus" class="form-select library-filter-select" aria-label="Show studies">
          <option value="">All studies</option>
          <option value="studying">Studying</option>
          <option value="completed">Completed</option>
          <option value="archived">Archived</option>
          <option value="in-progress">In progress</option>
        </select>
        <button type="button" id="libSelectBtn" class="lib-select-btn" aria-pressed="false">Select</button>
        <span id="libStudyCount" class="library-study-count" aria-live="polite"></span>
      </div>
      <div id="libSelectBar" class="lib-select-bar" role="toolbar" aria-label="Selected studies" hidden>
        <button type="button" id="libSelectAction" class="lib-select-action" disabled>Archive selected</button>
        <button type="button" id="libSelectAll" class="lib-select-link">Select all</button>
        <button type="button" id="libSelectCancel" class="lib-select-link">Cancel</button>
      </div>
      <div id="studyCardsGrid" class="study-cards-grid">
        <p class="library-loading-msg">Loading&#8230;</p>
      </div>
      <button type="button" id="libArchivedHint" class="lib-archived-hint" hidden></button>

      <div id="libGuideArea" style="display:none;">
        <div class="guide-header-bar">
          <h3 class="guide-display-title" id="libGuideTitle"></h3>
          <span class="guide-translation-badge" id="libGuideBadge"></span>
        </div>
        <div id="libArchivedNote" class="lib-archived-note" hidden>
          <span class="lib-archived-label">Archived</span>
          <button type="button" id="libUnarchiveBtn" class="lib-archived-unarchive">Unarchive</button>
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
    scripts: '<script src="/js/study-badges.js?v=5"></script><script src="/js/render-markdown.js?v=2"></script><script src="/js/enhance-further-studies.js?v=2"></script><script src="/js/read-aloud.js?v=1"></script><script src="/js/study-listen.js?v=3"></script><script src="/js/study-bookmark.js?v=2"></script><script src="/js/opposing-views.js?v=1"></script><script src="/js/teacher-entry.js?v=8"></script><script src="/js/geo-map.js?v=3"></script><script src="/js/orig-words.js?v=2"></script><script src="/js/library.js?v=85"></script>',
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
  // The shared type list (lib/study-types.js), so a new type can never be
  // silently saved as 'doctrinal' again.
  const validTypes   = TYPE_KEYS;
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
    // Study Map tags: the ones made when this study was generated (kept in the
    // member's session, matched by content — never taken from the client), or
    // tags worked out from the study itself, which the backfill later refines.
    map:         takeGeneratedMap(req.session, content) || deriveMap({ topic, content }),
    completedAt: null,                        // Studying until the member marks it complete
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

// ─── PUT /api/library/:id/completion ──────────────────────────────────────────
// "Mark complete" / "Undo". A study is Studying (no completedAt — every study
// saved before this existed) or Completed (completedAt = when it was marked).
// Only ever set by the member's own click: nothing marks a study complete on
// its own. Owner only — the lookup is by id AND the session's userId.
// Body: { completed: true | false }.
router.put('/api/library/:id/completion', requireAuth, (req, res) => {
  const completed = req.body && req.body.completed;
  if (typeof completed !== 'boolean') {
    return res.status(400).json({ success: false, error: 'Missing completion state.' });
  }
  const studies = readStudies();
  const idx = studies.findIndex(s => s.id === req.params.id && s.userId === req.session.userId);
  if (idx === -1) return res.status(404).json({ success: false, error: 'Study not found.' });

  if (completed) {
    // Marking an already-completed study again keeps its original date.
    if (!studies[idx].completedAt) studies[idx].completedAt = new Date().toISOString();
  } else {
    studies[idx].completedAt = null;   // Undo: back to Studying, date cleared
  }
  writeStudies(studies);

  // Finished: the member's saved place in it is no longer needed. Undo does
  // not bring it back. Best effort — a damaged bookmark store changes nothing.
  if (completed) {
    deleteBookmarksForStudy(req.params.id, req.session.userId)
      .catch(err => console.error('Bookmark cascade (complete) failed:', err.message));
  }
  res.json({ success: true, completedAt: studies[idx].completedAt || null });
});

// ─── Archive ──────────────────────────────────────────────────────────────────
// Archived studies are put away: hidden from the Library's main list (shown
// under "Archived"), everything else untouched — completion, Community sharing,
// notes, bookmarks, Teacher sessions, tags, rating and lineage all stay as they
// are. Fields: archived (true / false) and archivedAt (ISO, null when not
// archived). A record without them is not archived. Owner only — matched by id
// AND the session's userId.
function setArchived(study, archived, now) {
  if (archived) {
    if (study.archived !== true) { study.archived = true; study.archivedAt = now; return true; }
    return false;   // already archived: keep its original date
  }
  if (study.archived === true || study.archivedAt) { study.archived = false; study.archivedAt = null; return true; }
  return false;
}

// ─── PUT /api/library/:id/archive ─────────────────────────────────────────────
// Body: { archived: true | false }.
router.put('/api/library/:id/archive', requireAuth, archiveLimiter, (req, res) => {
  const archived = req.body && req.body.archived;
  if (typeof archived !== 'boolean') {
    return res.status(400).json({ success: false, error: 'Missing archive state.' });
  }
  const studies = readStudies();
  const study = studies.find(s => s && s.id === req.params.id && s.userId === req.session.userId);
  if (!study) return res.status(404).json({ success: false, error: 'Study not found.' });
  if (setArchived(study, archived, new Date().toISOString())) {
    try { writeStudies(studies); }
    catch (err) {
      console.error('[library/archive]', err.message);
      return res.status(500).json({ success: false, error: 'Could not update this study. Nothing was changed.' });
    }
  }
  res.json({ success: true, archived: study.archived === true, archivedAt: study.archivedAt || null });
});

// ─── POST /api/library/archive ────────────────────────────────────────────────
// Bulk. Body: { ids: [...], archived: true | false }. At most ARCHIVE_BULK_MAX
// ids; each one is checked against the session's userId, and any that isn't the
// member's own (or doesn't exist) is skipped and reported. One write for the batch.
router.post('/api/library/archive', requireAuth, archiveLimiter, (req, res) => {
  const body = req.body || {};
  const archived = body.archived;
  if (typeof archived !== 'boolean') {
    return res.status(400).json({ success: false, error: 'Missing archive state.' });
  }
  if (!Array.isArray(body.ids) || !body.ids.length) {
    return res.status(400).json({ success: false, error: 'No studies were chosen.' });
  }
  if (body.ids.length > ARCHIVE_BULK_MAX) {
    return res.status(400).json({ success: false, error: `Choose at most ${ARCHIVE_BULK_MAX} studies at a time.` });
  }
  const ids = [...new Set(body.ids.filter(id => typeof id === 'string' && id))];
  const userId  = req.session.userId;
  const studies = readStudies();
  const now     = new Date().toISOString();
  const byId    = new Map();
  studies.forEach(s => { if (s && s.id && s.userId === userId) byId.set(s.id, s); });

  const updated = [], skipped = [];
  let changed = false;
  ids.forEach(id => {
    const s = byId.get(id);
    if (!s) { skipped.push(id); return; }
    if (setArchived(s, archived, now)) changed = true;
    updated.push({ id, archived: s.archived === true, archivedAt: s.archivedAt || null });
  });
  // Non-string or empty entries are skipped too.
  const badCount = body.ids.length - body.ids.filter(id => typeof id === 'string' && id).length;

  if (changed) {
    try { writeStudies(studies); }
    catch (err) {
      console.error('[library/archive bulk]', err.message);
      return res.status(500).json({ success: false, error: 'Could not update these studies. Nothing was changed.' });
    }
  }
  res.json({ success: true, updated, skipped, skippedCount: skipped.length + badCount });
});

// ─── POST /api/library/:id/opened ─────────────────────────────────────────────
// Notes when the member opens one of their own studies, so the Dashboard's
// "Currently studying" can put the most recently opened first. Best effort and
// throttled (at most one write per study per 30 minutes); never an error the
// member sees.
const OPENED_THROTTLE_MS = 30 * 60 * 1000;
router.post('/api/library/:id/opened', requireAuth, (req, res) => {
  try {
    const studies = readStudies();
    const s = studies.find(x => x.id === req.params.id && x.userId === req.session.userId);
    if (!s) return res.json({ success: false });
    const last = Date.parse(s.openedAt) || 0;
    if (Date.now() - last > OPENED_THROTTLE_MS) {
      s.openedAt = new Date().toISOString();
      writeStudies(studies);
    }
    res.json({ success: true });
  } catch (err) {
    console.error('[library/opened]', err.message);
    res.json({ success: false });
  }
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
  // Queued with other notepad writes; if the notepad store is damaged it removes
  // nothing (the notes are left orphaned rather than the store overwritten).
  notepadRoutes.deleteNotepadsForStudy(req.params.id, req.session.userId)
    .catch(err => console.error('Notepad cascade delete failed:', err.message));
  // …and every member's bookmark in it (a shared study may have readers' marks).
  deleteBookmarksForStudy(req.params.id, null)
    .catch(err => console.error('Bookmark cascade delete failed:', err.message));

  res.json({ success: true });
});

// ─── POST /api/library/ask ────────────────────────────────────────────────────
router.post('/api/library/ask', requireAuth, async (req, res) => {
  const { question, highlightedText, studyTopic, history } = req.body;
  // The highlight panel's Explore conversation (public/js/library.js ucpRunAsk,
  // grounded) asks for map-aware answers. Every other caller — the Ask AI panel,
  // Study Chat — leaves it off and gets exactly what it always got.
  const geoMaps = req.body.geo === true;
  // "Explain this word" (the Original tab): the client names a word by position
  // only; the verified data block is rebuilt from orig/ (lib/original.js) and
  // goes in the system prompt, hidden from the visible thread. The ORIGINAL
  // LANGUAGE RULE is added only when that block is present.
  const origBlock = req.body.original ? original.explainBlock(req.body.original) : null;
  const hasHistory = history && Array.isArray(history) && history.length > 0;
  if (!hasHistory && (!question || !String(question).trim())) {
    return res.status(400).json({ success: false, error: 'Question is required.' });
  }

  const { IRON_INK_CORE_PROMPT } = req.app.locals.prompts;
  const systemPrompt = IRON_INK_CORE_PROMPT +
    '\n\nYou are answering inline questions from a student reading a saved study guide. ' +
    'Be concise and precise — 2–4 sentences for quick questions, more thorough for follow-ups in a chat. ' +
    'Stay within the confessionally Reformed framework at all times.' +
    (geoMaps ? '\n\n' + geo.GEO_RULE : '') +
    (origBlock ? '\n\n' + original.ORIGINAL_RULE + '\n\n' + origBlock.text : '');

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
    // Opus 5.5 always thinks and thinking counts toward max_tokens, so the old
    // 800-token ceiling gets headroom; answer length is set by the prompt.
    const message = await client.messages.create({
      model:         'claude-opus-5-5',
      max_tokens:    4000,
      output_config: { effort: 'low' },
      system:        systemPrompt,
      messages,
    });
    // The response can open with (empty) thinking blocks — read text blocks only.
    const text = message.content.filter(b => b.type === 'text').map(b => b.text).join('');
    if (message.stop_reason === 'refusal' || !text) {
      console.error('Inline ask: no text returned — stop_reason:', message.stop_reason);
      return res.status(500).json({ success: false, error: 'Failed to get answer. Please try again.' });
    }
    // Monitoring only (the reply is never altered): log Hebrew/Greek the AI wrote
    // that is not in the verified data block, so it can be watched in pm2.
    if (origBlock) {
      const stray = original.unverifiedRuns(text, origBlock);
      if (stray.length) {
        console.warn('[original] Explore reply for ' + origBlock.ref + ' (' + origBlock.word + ') has Hebrew/Greek not in the data block: ' +
          stray.slice(0, 8).join(' ') + (stray.length > 8 ? ' (+' + (stray.length - 8) + ' more)' : ''));
      }
    }
    // Map-aware answers: resolve {{place:...}} / {{road:...}} markers against the
    // gazetteer (plain names in the text, a map payload alongside).
    const geoOut = geoMaps ? geo.processGeoMarkers(text) : { text, map: null };
    // Inline answers use the core prompt, so the model quotes Scripture via
    // {{verse:...}} markers too — insert the verified verse text (NASB primary,
    // ASV fallback) and append the Lockman notice when NASB text appears.
    const out = { success: true, answer: injectWithAttribution(geoOut.text) };
    if (geoOut.map) out.map = geoOut.map;
    res.json(out);
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
