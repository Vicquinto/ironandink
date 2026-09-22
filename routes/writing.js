const express    = require('express');
const Anthropic  = require('@anthropic-ai/sdk');
const fs         = require('fs');
const path       = require('path');
const { randomUUID } = require('crypto');
const { requireAuth, renderLayout } = require('./layout');
const { injectWithAttribution, injectVersesTracked, NASB_ATTRIBUTION_MD } = require('../lib/asv');
const { logEvent } = require('../lib/usageLog');
const { getEntitlements } = require('../lib/entitlements');

const router       = express.Router();

// ── Member-only gate (dark unless BILLING_ENABLED=true) ──────────────────────
// Article / writing is a paid-tier feature — this covers both the Writing composer
// (/writing) and the My Articles library (/my-articles), plus the generate/save
// endpoints. Enforce at the authenticated HTTP layer from the FRESH users.json
// record. Returns true only for a real free member with billing on; always false
// while dark, so today's behavior and nav are unchanged.
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
const ARTICLES_PATH = path.join(__dirname, '../data/articles.json');

function readArticles() {
  try {
    if (!fs.existsSync(ARTICLES_PATH)) return [];
    return JSON.parse(fs.readFileSync(ARTICLES_PATH, 'utf8'));
  } catch (err) {
    // Log genuine corruption instead of silently masking it as "no articles".
    console.error('readArticles() failed to read/parse articles.json:', err);
    return [];
  }
}

function writeArticles(data) {
  fs.writeFileSync(ARTICLES_PATH, JSON.stringify(data, null, 2));
}

// ─── GET /writing ─────────────────────────────────────────────────────────────
router.get('/writing', requireAuth, (req, res) => {
  if (memberGated(req)) return res.redirect('/pricing?from=article');
  const content = `
    <div id="writingMain">
      <div class="page-header">
        <h2 class="page-title">Writing</h2>
        <p class="page-subtitle">Theological articles in your own voice.</p>
      </div>
      <button class="btn-primary" id="beginArticleBtn">Begin a New Article</button>
      <div id="articleList" class="article-list-container"></div>
    </div>

    <!-- Two-pane writing workspace. #writingEditor stays the show/hide toggle
         (showState('editor') sets its display); the flex row lives on the inner
         .writing-workspace so an inline display:block on the wrapper can't
         collapse the split. LEFT = conversation shell (inert in Step 2 — no
         behavior wired yet, that's Step 3). RIGHT = the existing editor, moved
         verbatim into #writingEditorPane. -->
    <div id="writingEditor" style="display:none;">
      <div class="writing-workspace">

        <div id="writingConversation" class="writing-conversation">
          <div class="conversation-header">Writing companion</div>
          <div id="conversationMessages" class="chat-messages">
            <p class="conversation-empty">Your conversation will appear here.</p>
          </div>
          <div class="chat-input-area">
            <textarea id="conversationInput" class="chat-textarea" rows="3" placeholder="Type your message&#8230;"></textarea>
            <div class="chat-input-actions">
              <button class="btn-primary" id="conversationSendBtn">Send</button>
              <button class="btn-stop" id="conversationStopBtn" style="display:none;">Stop</button>
            </div>
            <!-- Tier 3 only: primary action to write a full draft from the
                 conversation into the article pane. Shown/hidden client-side by
                 selectedTier. -->
            <button class="btn-draft-it" id="conversationDraftBtn" style="display:none;">Draft it into the article &#8594;</button>
          </div>
        </div>

        <div id="writingEditorPane" class="writing-editor-pane">
          <div class="editor-topbar">
            <div class="editor-meta-row">
              <span id="editorTierBadge" class="tier-badge-main"></span>
              <span id="editorWordCount" class="word-count-display">0 words</span>
              <!-- Whiteboard conveniences (Phase C): display-only text zoom +
                   client-side download/print. Reuses the reading-view font-btn
                   styling. These never alter saved content. -->
              <span class="editor-zoom" role="group" aria-label="Text size">
                <button class="guide-font-btn guide-font-btn-sm" id="editorFontDec" title="Smaller text" aria-label="Smaller text">A&#8722;</button>
                <button class="guide-font-btn guide-font-btn-md" id="editorFontReset" title="Reset text size" aria-label="Reset text size">A</button>
                <button class="guide-font-btn guide-font-btn-lg" id="editorFontInc" title="Larger text" aria-label="Larger text">A+</button>
              </span>
              <button class="guide-print-btn" id="editorPrintBtn" title="Print or Save as PDF">Print / Download</button>
              <button class="guide-print-btn" id="findToggleBtn" title="Find in article (Ctrl+F)">Find</button>
            </div>
            <div class="editor-topbar-actions">
              <button class="btn-end-session" id="clearBoardBtn">Clear Board</button>
              <button class="btn-end-session" id="backBtn">&#8592; Back</button>
            </div>
          </div>
          <input type="text" id="editorTitle" class="editor-title-input" placeholder="Article title&#8230;">

          <!-- Find-in-article bar. Navigation only — never touches
               #editorContent.value. Hidden by default, toggled via the Find
               button above or Ctrl/Cmd+F while the workspace is open; closed
               via the × or Escape. Docked above the textarea so it can never
               visually collide with the rewrite toolbar, which is docked
               BELOW the textarea. -->
          <div id="findBar" class="find-bar" style="display:none;">
            <input type="text" id="findInput" class="find-input" placeholder="Find in article&#8230;">
            <button type="button" id="findGoBtn" class="find-nav-btn" aria-label="Find" title="Find (Enter)">Go</button>
            <span id="findCount" class="find-count"></span>
            <!-- Prev/Next are hidden by default and shown by JS only when there are 2+ matches. -->
            <button type="button" id="findPrevBtn" class="find-nav-btn" aria-label="Previous match" title="Previous match" style="display:none;">&#8593;</button>
            <button type="button" id="findNextBtn" class="find-nav-btn" aria-label="Next match" title="Next match" style="display:none;">&#8595;</button>
            <button type="button" id="findCloseBtn" class="find-close-btn" aria-label="Close find">&#10005;</button>
          </div>

          <textarea id="editorContent" class="editor-content-textarea" placeholder="Your article will appear here&#8230;"></textarea>

          <!-- Highlight-to-revise toolbar (Capability 1). Docked in this fixed
               layout slot between the textarea and the action row (Option B) —
               NOT floating at the caret, since a plain <textarea> exposes no
               per-character geometry to float over. Shown when #editorContent
               has a live, non-empty selection; hidden otherwise. Card look
               matches the reading-view dictionary tooltip / .restyle-picker
               family for visual consistency. -->
          <div id="rewriteToolbar" class="rewrite-toolbar" style="display:none;">
            <div class="rewrite-toolbar-head">
              <span class="rewrite-toolbar-label">Revise selection</span>
              <button type="button" id="rewriteDismissBtn" class="rewrite-dismiss-btn" aria-label="Dismiss">&#10005;</button>
            </div>
            <div class="rewrite-toolbar-body">
              <input type="text" id="rewriteInstruction" class="rewrite-instruction-input" placeholder="What should Claude change about this?">
              <div class="rewrite-quick-actions">
                <button type="button" class="rewrite-quick-btn" data-instruction="Make this more concise">Concise</button>
                <button type="button" class="rewrite-quick-btn" data-instruction="Strengthen this">Strengthen</button>
                <button type="button" class="rewrite-quick-btn" data-instruction="Simplify the language">Simplify</button>
                <button type="button" class="rewrite-quick-btn" data-instruction="Make this warmer">Warmer</button>
              </div>
            </div>
            <div class="rewrite-toolbar-foot">
              <span id="rewriteStatus" class="rewrite-status"></span>
              <button type="button" class="btn-primary" id="rewriteApplyBtn">Apply</button>
            </div>
          </div>

          <div class="editor-action-row">
            <button class="btn-primary" id="saveDraftBtn">Save Draft</button>
            <button class="btn-warm" id="markCompleteBtn">Mark Complete</button>
            <!-- Writing Types (Phase B): Restyle button + its popover picker.
                 The wrap is position:relative so the picker anchors to the button. -->
            <div class="restyle-menu-wrap">
              <button class="btn-warm" id="restyleBtn">Restyle</button>
              <div id="restylePicker" class="restyle-picker" style="display:none;">
                <div class="restyle-picker-title">Rewrite in a different voice</div>
                <button class="restyle-picker-item" data-style="warmer">Warmer</button>
                <button class="restyle-picker-item" data-style="encouraging">Encouraging</button>
                <button class="restyle-picker-item" data-style="conviction">With Conviction</button>
                <button class="restyle-picker-item" data-style="respond">Call to Respond</button>
                <button class="restyle-picker-item" data-style="lyrical">More Lyrical</button>
                <button class="restyle-picker-item" data-style="plainer">Plainer</button>
              </div>
            </div>
            <!-- One-step undo: shown only after an Accept, hidden otherwise. -->
            <button class="btn-warm restyle-undo-btn" id="restyleUndoBtn" style="display:none;">&#8630; Undo restyle</button>
            <!-- One-step undo for a highlight-to-revise Apply (Capability 1); same pattern as restyleUndoBtn. -->
            <button class="btn-warm restyle-undo-btn" id="rewriteUndoBtn" style="display:none;">&#8630; Undo revision</button>
          </div>
        </div>

      </div>

      <!-- Writing Types preview overlay. Streams the restyled draft WITHOUT
           touching the live editor; Accept swaps it in, Discard/Stop leave it. -->
      <div id="restyleOverlay" class="restyle-overlay" style="display:none;">
        <div class="restyle-overlay-card">
          <div class="restyle-overlay-header">
            <h3 class="restyle-overlay-title" id="restyleOverlayTitle">Restyled</h3>
          </div>
          <div id="restylePreviewContent" class="restyle-preview-content"></div>
          <div class="restyle-overlay-footer">
            <button class="btn-primary" id="restyleAcceptBtn">Accept</button>
            <button class="btn-warm" id="restyleDiscardBtn">Discard</button>
            <button class="btn-stop" id="restyleStopBtn" style="display:none;">Stop</button>
          </div>
        </div>
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
            <label class="form-option">
              <input type="radio" name="writingForm" value="teaching">
              <div class="form-option-body">
                <div class="form-option-icon">&#127891;</div>
                <div class="form-option-label">Teaching Guide</div>
                <div class="form-option-desc">A spoken study script for leading a group or teaching to camera.</div>
              </div>
            </label>
          </div>
          <div class="writing-modal-footer">
            <button class="btn-primary" id="formContinueBtn" disabled>Continue</button>
            <button class="btn-discard" id="cancelFormModalBtn">Cancel</button>
          </div>
        </div>

        <div id="wModalStep1" style="display:none;">
          <h3 class="writing-modal-title">Where would you like to begin?</h3>
          <div class="form-options">
            <label class="form-option">
              <input type="radio" name="writingTier" value="1">
              <div class="form-option-body">
                <div class="form-option-text">
                  <div class="form-option-label">I&#8217;ll write it</div>
                  <div class="form-option-desc">You do the writing. I&#8217;ll help you find the idea, develop it, and sharpen it as you go.</div>
                </div>
              </div>
            </label>
            <label class="form-option">
              <input type="radio" name="writingTier" value="2">
              <div class="form-option-body">
                <div class="form-option-text">
                  <div class="form-option-label">Let&#8217;s write it together</div>
                  <div class="form-option-desc">We build it side by side, trading lines and shaping it as we talk.</div>
                </div>
              </div>
            </label>
            <label class="form-option">
              <input type="radio" name="writingTier" value="3">
              <div class="form-option-body">
                <div class="form-option-text">
                  <div class="form-option-label">Write it for me</div>
                  <div class="form-option-desc">Give me your direction and I&#8217;ll draft it. You steer and refine from there.</div>
                </div>
              </div>
            </label>
          </div>
          <div class="writing-modal-footer">
            <button class="btn-primary" id="tierContinueBtn" disabled>Continue</button>
            <button class="btn-discard" id="doorsBackBtn">Back</button>
          </div>
        </div>

        <div id="wModalStep2" style="display:none;">
          <h3 class="writing-modal-title">Start from a study?</h3>
          <div class="form-options">
            <label class="form-option">
              <input type="radio" name="writingSource" value="mine">
              <div class="form-option-body">
                <div class="form-option-icon">&#128218;</div>
                <div class="form-option-label">Build from one of my studies</div>
                <div class="form-option-desc">Seed the companion with a study you&#8217;ve saved. It builds from it &mdash; your draft pane stays empty.</div>
              </div>
            </label>
            <label class="form-option">
              <input type="radio" name="writingSource" value="community">
              <div class="form-option-body">
                <div class="form-option-icon">&#128101;</div>
                <div class="form-option-label">Build from a community study</div>
                <div class="form-option-desc">Seed the companion with a study shared by the community.</div>
              </div>
            </label>
            <label class="form-option">
              <input type="radio" name="writingSource" value="paste">
              <div class="form-option-body">
                <div class="form-option-icon">&#128203;</div>
                <div class="form-option-label">Paste in text</div>
                <div class="form-option-desc">Paste source material for the companion to build from.</div>
              </div>
            </label>
            <label class="form-option">
              <input type="radio" name="writingSource" value="fresh">
              <div class="form-option-body">
                <div class="form-option-icon">&#10024;</div>
                <div class="form-option-label">Start fresh (no study)</div>
                <div class="form-option-desc">Begin with a blank slate &mdash; no source material.</div>
              </div>
            </label>
          </div>
          <div id="wSourcePanelMine" style="display:none;max-height:240px;overflow-y:auto;margin-top:12px;padding-right:4px;"></div>
          <div id="wSourcePanelCommunity" style="display:none;max-height:240px;overflow-y:auto;margin-top:12px;padding-right:4px;"></div>
          <div id="wSourcePanelPaste" style="display:none;margin-top:12px;">
            <textarea id="wSourcePasteText" placeholder="Paste your source text here&#8230;" style="width:100%;box-sizing:border-box;min-height:170px;padding:10px 12px;border:1px solid #c4a882;border-radius:8px;font-family:inherit;font-size:0.95rem;line-height:1.5;resize:vertical;"></textarea>
          </div>
          <div class="writing-modal-footer">
            <button class="btn-primary" id="sourceContinueBtn" disabled>Continue</button>
            <button class="btn-discard" id="sourceBackBtn">Back</button>
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
  if (memberGated(req)) return res.redirect('/pricing?from=article');
  const content = `
    <div class="page-header">
      <h2 class="page-title">My Articles</h2>
      <p class="page-subtitle">Your saved drafts and completed articles.</p>
    </div>
    <div id="myArticleList" class="article-list-container"></div>
    <div id="myTrashSection" style="display:none; margin-top:36px;">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; border-top:1px solid var(--border-cream); padding-top:20px;">
        <h3 class="community-section-label" style="margin:0;">&#128465; Ready for Permanent Deletion</h3>
        <button class="btn-delete-article" id="emptyTrashBtn">Empty Trash</button>
      </div>
      <p class="page-subtitle" style="margin:6px 0 16px;">Trashed articles are kept here so you can restore them. Deleting permanently cannot be undone.</p>
      <div id="myTrashList" class="article-list-container"></div>
    </div>
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
  try {
    if (memberGated(req)) return res.status(402).json({ success: false, error: 'member_feature', upgradeUrl: '/pricing' });
    const { title, content, tier, form, answers, status, conversation, pendingMessage } = req.body;
    if (!title) return res.status(400).json({ success: false, error: 'Title is required.' });

    const now          = new Date().toISOString();
    const userSettings = req.session.user && req.session.user.settings;
    const article = {
      id:         randomUUID(),
      userId:     req.session.userId,
      title:      title.trim(),
      content:    content || '',
      tier:       tier || 1,
      form:       form || 'article',
      answers:    answers || {},
      status:     status || 'Draft',
      conversation: conversation || [],
      pendingMessage: pendingMessage || '',
      studyLevel: (userSettings && userSettings.studyLevel) || 'journeyman',
      createdAt:  now,
      updatedAt:  now,
    };

    const articles = readArticles();
    articles.push(article);
    writeArticles(articles);
    const wu = req.session.user || {};
    logEvent(wu.id || req.session.userId, wu.fullName, 'article_written', {});
    res.json({ success: true, article });
  } catch (err) {
    console.error('POST /api/articles failed:', err);
    res.status(500).json({ success: false, error: 'Save failed. Please try again.' });
  }
});

// ─── PUT /api/articles/:id ────────────────────────────────────────────────────
router.put('/api/articles/:id', requireAuth, (req, res) => {
  try {
    if (memberGated(req)) return res.status(402).json({ success: false, error: 'member_feature', upgradeUrl: '/pricing' });
    const articles = readArticles();
    const idx      = articles.findIndex(a => a.id === req.params.id && a.userId === req.session.userId);
    if (idx === -1) return res.status(404).json({ success: false, error: 'Article not found.' });

    const { title, content, tier, form, answers, status, conversation, pendingMessage } = req.body;
    articles[idx] = {
      ...articles[idx],
      title:     title !== undefined ? title.trim() : articles[idx].title,
      content:   content !== undefined ? content : articles[idx].content,
      tier:      tier   || articles[idx].tier,
      form:      form   || articles[idx].form || 'article',
      answers:   answers || articles[idx].answers,
      status:    status  || articles[idx].status,
      conversation: conversation !== undefined ? conversation : (articles[idx].conversation || []),
      pendingMessage: pendingMessage !== undefined ? pendingMessage : (articles[idx].pendingMessage || ''),
      updatedAt: new Date().toISOString(),
    };

    writeArticles(articles);
    res.json({ success: true, article: articles[idx] });
  } catch (err) {
    console.error('PUT /api/articles/:id failed:', err);
    res.status(500).json({ success: false, error: 'Save failed. Please try again.' });
  }
});

// ─── PATCH /api/articles/:id/submit — Submit for review ──────────────────────
router.patch('/api/articles/:id/submit', requireAuth, (req, res) => {
  try {
    if (memberGated(req)) return res.status(402).json({ success: false, error: 'member_feature', upgradeUrl: '/pricing' });
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
  } catch (err) {
    console.error('PATCH /api/articles/:id/submit failed:', err);
    res.status(500).json({ success: false, error: 'Save failed. Please try again.' });
  }
});

// ─── PATCH /api/articles/:id/unpublish — writer self-service unpublish ────────
// Reverse of publish: pull the writer's OWN published article off the Community
// board back to Complete (private) so they can revise and re-submit. Modeled on
// the submit handler above — ownership-gated (NOT admin), same memberGated check
// and try/catch. Sets the same fields the admin unpublish sets. Amens/comments
// are keyed by article id and are intentionally LEFT ALONE (they reattach if the
// article is re-published).
router.patch('/api/articles/:id/unpublish', requireAuth, (req, res) => {
  try {
    if (memberGated(req)) return res.status(402).json({ success: false, error: 'member_feature', upgradeUrl: '/pricing' });
    const articles = readArticles();
    const idx      = articles.findIndex(a => a.id === req.params.id && a.userId === req.session.userId);
    if (idx === -1) return res.status(404).json({ success: false, error: 'Article not found.' });
    if (articles[idx].status !== 'Published') {
      return res.status(400).json({ success: false, error: 'Only a published article can be unpublished.' });
    }
    articles[idx].status      = 'Complete';
    articles[idx].publishedAt = null;
    articles[idx].pinned      = false;
    articles[idx].updatedAt   = new Date().toISOString();
    writeArticles(articles);
    res.json({ success: true, article: articles[idx] });
  } catch (err) {
    console.error('PATCH /api/articles/:id/unpublish failed:', err);
    res.status(500).json({ success: false, error: 'Save failed. Please try again.' });
  }
});

// ─── PATCH /api/articles/:id/trash — soft-delete into the holding area ─────────
// Move the writer's OWN article to the "Ready for Permanent Deletion" holding
// area instead of destroying it. Modeled on submit/unpublish (requireAuth +
// ownership + memberGated + try/catch). Sets a `deleted` flag rather than
// changing status, AND neutralizes publish state exactly like unpublish so a
// trashed article can never match a Published/Pending board or admin filter —
// which is why the Community routes, admin routes, and dashboard need no change.
// Amens/comments are keyed by article id and are LEFT ALONE (they reattach if
// the article is later restored and re-published).
router.patch('/api/articles/:id/trash', requireAuth, (req, res) => {
  try {
    if (memberGated(req)) return res.status(402).json({ success: false, error: 'member_feature', upgradeUrl: '/pricing' });
    const articles = readArticles();
    const idx      = articles.findIndex(a => a.id === req.params.id && a.userId === req.session.userId);
    if (idx === -1) return res.status(404).json({ success: false, error: 'Article not found.' });
    articles[idx].deleted     = true;
    articles[idx].deletedAt   = new Date().toISOString();
    // Neutralize publish state — a trashed article is never board/queue-eligible.
    articles[idx].status      = 'Complete';
    articles[idx].publishedAt = null;
    articles[idx].pinned      = false;
    articles[idx].updatedAt   = new Date().toISOString();
    writeArticles(articles);
    res.json({ success: true, article: articles[idx] });
  } catch (err) {
    console.error('PATCH /api/articles/:id/trash failed:', err);
    res.status(500).json({ success: false, error: 'Save failed. Please try again.' });
  }
});

// ─── PATCH /api/articles/:id/restore — pull back out of the holding area ───────
// Clears the `deleted` flag so the article returns to the active list. Status is
// left as-is ('Complete' from the trash step, or its natural value) — restore
// returns it as Complete/editable, NOT re-published. Precondition: it must
// actually be trashed.
router.patch('/api/articles/:id/restore', requireAuth, (req, res) => {
  try {
    if (memberGated(req)) return res.status(402).json({ success: false, error: 'member_feature', upgradeUrl: '/pricing' });
    const articles = readArticles();
    const idx      = articles.findIndex(a => a.id === req.params.id && a.userId === req.session.userId);
    if (idx === -1) return res.status(404).json({ success: false, error: 'Article not found.' });
    if (articles[idx].deleted !== true) {
      return res.status(400).json({ success: false, error: 'Only a trashed article can be restored.' });
    }
    articles[idx].deleted   = false;
    articles[idx].deletedAt = null;
    articles[idx].updatedAt = new Date().toISOString();
    writeArticles(articles);
    res.json({ success: true, article: articles[idx] });
  } catch (err) {
    console.error('PATCH /api/articles/:id/restore failed:', err);
    res.status(500).json({ success: false, error: 'Save failed. Please try again.' });
  }
});

// ─── DELETE /api/articles/trash/empty — Empty Trash (this user only) ───────────
// Permanently removes ALL of the CURRENT user's trashed articles. Only touches
// this user's rows with deleted === true — never anyone else's, never active
// ones. Registered BEFORE the /:id route below so "trash" is not captured as an
// article id.
router.delete('/api/articles/trash/empty', requireAuth, (req, res) => {
  try {
    const articles = readArticles();
    const before   = articles.length;
    const kept     = articles.filter(a => !(a.userId === req.session.userId && a.deleted === true));
    const removed  = before - kept.length;
    writeArticles(kept);
    res.json({ success: true, count: removed });
  } catch (err) {
    console.error('DELETE /api/articles/trash/empty failed:', err);
    res.status(500).json({ success: false, error: 'Delete failed. Please try again.' });
  }
});

// ─── DELETE /api/articles/:id — Delete Permanently (must be trashed first) ─────
router.delete('/api/articles/:id', requireAuth, (req, res) => {
  try {
    const articles = readArticles();
    const idx      = articles.findIndex(a => a.id === req.params.id && a.userId === req.session.userId);
    if (idx === -1) return res.status(404).json({ success: false, error: 'Article not found.' });
    // Two-step guard: nothing is hard-deleted without going through trash first.
    if (articles[idx].deleted !== true) {
      return res.status(400).json({ success: false, error: 'Move the article to trash before deleting it permanently.' });
    }

    articles.splice(idx, 1);
    writeArticles(articles);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/articles/:id failed:', err);
    res.status(500).json({ success: false, error: 'Delete failed. Please try again.' });
  }
});

// ─── POST /api/writing/generate ───────────────────────────────────────────────
router.post('/api/writing/generate', requireAuth, async (req, res) => {
  if (memberGated(req)) return res.status(402).json({ success: false, error: 'member_feature', upgradeUrl: '/pricing' });
  const { tier, answers, topic, form } = req.body;
  if (!tier || !answers) {
    return res.status(400).json({ success: false, error: 'Tier and answers are required.' });
  }

  const { IRON_INK_CORE_PROMPT, IRON_INK_WRITING_PROMPT } = req.app.locals.prompts;
  const userSettings = req.session.user && req.session.user.settings;
  const studyLevelInstruction = getStudyLevelInstruction(userSettings);

  const formInstructions = {
    article: 'This is an article or essay. Structure it with a clear introduction, logical argument movements, objection and answer, and a doxological conclusion. It is written to be read, not heard.',
    sermon:  'This is a sermon or exhortation. Structure it with a compelling opening, expository body with clear movements, at least one illustration prompt [ILLUSTRATION: describe what kind of illustration would work here], and a direct application landing that tells the listener what to do or believe. Use repetition deliberately. Write for the ear, not the eye. End with a call to the congregation.',
    letter:  'This is a personal doctrinal letter to a specific person. Open by addressing them directly by their relationship to the writer (friend, sister, neighbor — whatever was stated in Q3/Q5). Write in a warm but doctrinally serious pastoral voice. Do not structure it like an essay — let it read like a genuine letter. Close with an expression of care and a prayer or blessing.',
    teaching: 'This is a teaching guide — a fully-scripted study written to be spoken aloud by a host or teacher leading a group, or delivered to camera. Write it to be SPOKEN and HEARD, not silently read. The host holds this script and teaches from it.\n\nTHERE ARE TWO MODES, and you must choose based on the conversation:\n\nMODE A — COMPANION GUIDE (use this WHENEVER source study material was provided in this conversation). In this mode, assume every participant is holding a PRINTED COPY of that study. Your job is NOT to re-teach the study\'s content from scratch — they can read it themselves. Your job is to be the CONDUCTOR who leads the room THROUGH the handout they are holding: direct them to specific sections of the study ("Look at Section 4 in your handout — the part on Christ\'s presence"), draw their attention to the key sentences, the important word, the pivotal Scripture, and the turns in the argument. Read a passage aloud together, then unpack it. Pose the study\'s questions to the group and leave room to discuss. Add the host\'s live connective tissue — the transitions, the "here\'s why this matters," the pastoral application — that a printed study can\'t give, while the students follow along in the document. Reference the study by its sections and flow. Do NOT reproduce the whole study as prose; point to it.\n\nMODE B — STANDALONE TEACHING (use this ONLY when NO source study was provided — the writer started fresh). In this mode, assume the group has their BIBLES OPEN to the passage but NO handout. Teach the passage directly: direct them to specific verses ("Open your Bibles to 1 Corinthians 10, look at verse 16"), read the Scripture together, and teach the doctrine as you go, building the understanding live with the room. Here you DO teach the content fully, because there is no handout to carry it — the Bible is the shared document you are guiding them through.\n\nIN BOTH MODES: Open with something that draws the room in within the first minute — a question, a scene, a striking claim — not a throat-clearing preamble. Organize it in clear, speakable sections a host can move through, sized to run roughly 20-30 minutes aloud. Write in a warm, clear, generic teacher\'s voice usable by ANY host — not as one specific named person. Fully script it (complete sentences meant to be said), with natural spoken rhythm — shorter sentences than written prose. Where Scripture is quoted, emit the {{verse:Book Chapter:Verse}} marker as always, never the verse text yourself. End with application and a few discussion questions the group can talk through together. This is a teaching document a host holds and speaks from.',
  };
  const formInstruction = formInstructions[form] || formInstructions.article;

  const systemPrompt = studyLevelInstruction + '\n\n' + IRON_INK_CORE_PROMPT + '\n\n' + IRON_INK_WRITING_PROMPT + '\n\n' + formInstruction;

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

    // Core-prompt output quotes Scripture via {{verse:...}} markers — insert the
    // verified verse text (NASB primary, ASV fallback) and append the Lockman
    // notice when NASB text appears.
    res.json({ success: true, content: injectWithAttribution(message.content[0].text) });
  } catch (err) {
    console.error('[Writing/generate]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /api/writing/converse (streaming SSE) ───────────────────────────────
// Live writing-conversation engine for the split-screen composer. Modeled on the
// marker-safe streaming in POST /api/dialogue/exchange — but this conversation
// STAYS in the Reformed frame (Core prompt included) and keeps the Scripture rule,
// unlike Dialogue which deliberately excludes the Core prompt. Purely additive:
// the blocking /api/writing/generate route above is untouched.
router.post('/api/writing/converse', requireAuth, async (req, res) => {
  if (memberGated(req)) return res.status(402).json({ success: false, error: 'member_feature', upgradeUrl: '/pricing' });
  const { messages, tier, form, isOpening, sourceContent, sourceTopic, fullDraft } = req.body;

  const { IRON_INK_CORE_PROMPT, IRON_INK_WRITING_PROMPT } = req.app.locals.prompts;
  const userSettings = req.session.user && req.session.user.settings;
  const studyLevelInstruction = getStudyLevelInstruction(userSettings);

  // Same form instructions as /api/writing/generate — kept identical on purpose.
  const formInstructions = {
    article: 'This is an article or essay. Structure it with a clear introduction, logical argument movements, objection and answer, and a doxological conclusion. It is written to be read, not heard.',
    sermon:  'This is a sermon or exhortation. Structure it with a compelling opening, expository body with clear movements, at least one illustration prompt [ILLUSTRATION: describe what kind of illustration would work here], and a direct application landing that tells the listener what to do or believe. Use repetition deliberately. Write for the ear, not the eye. End with a call to the congregation.',
    letter:  'This is a personal doctrinal letter to a specific person. Open by addressing them directly by their relationship to the writer (friend, sister, neighbor — whatever was stated in Q3/Q5). Write in a warm but doctrinally serious pastoral voice. Do not structure it like an essay — let it read like a genuine letter. Close with an expression of care and a prayer or blessing.',
    teaching: 'This is a teaching guide — a fully-scripted study written to be spoken aloud by a host or teacher leading a group, or delivered to camera. Write it to be SPOKEN and HEARD, not silently read. The host holds this script and teaches from it.\n\nTHERE ARE TWO MODES, and you must choose based on the conversation:\n\nMODE A — COMPANION GUIDE (use this WHENEVER source study material was provided in this conversation). In this mode, assume every participant is holding a PRINTED COPY of that study. Your job is NOT to re-teach the study\'s content from scratch — they can read it themselves. Your job is to be the CONDUCTOR who leads the room THROUGH the handout they are holding: direct them to specific sections of the study ("Look at Section 4 in your handout — the part on Christ\'s presence"), draw their attention to the key sentences, the important word, the pivotal Scripture, and the turns in the argument. Read a passage aloud together, then unpack it. Pose the study\'s questions to the group and leave room to discuss. Add the host\'s live connective tissue — the transitions, the "here\'s why this matters," the pastoral application — that a printed study can\'t give, while the students follow along in the document. Reference the study by its sections and flow. Do NOT reproduce the whole study as prose; point to it.\n\nMODE B — STANDALONE TEACHING (use this ONLY when NO source study was provided — the writer started fresh). In this mode, assume the group has their BIBLES OPEN to the passage but NO handout. Teach the passage directly: direct them to specific verses ("Open your Bibles to 1 Corinthians 10, look at verse 16"), read the Scripture together, and teach the doctrine as you go, building the understanding live with the room. Here you DO teach the content fully, because there is no handout to carry it — the Bible is the shared document you are guiding them through.\n\nIN BOTH MODES: Open with something that draws the room in within the first minute — a question, a scene, a striking claim — not a throat-clearing preamble. Organize it in clear, speakable sections a host can move through, sized to run roughly 20-30 minutes aloud. Write in a warm, clear, generic teacher\'s voice usable by ANY host — not as one specific named person. Fully script it (complete sentences meant to be said), with natural spoken rhythm — shorter sentences than written prose. Where Scripture is quoted, emit the {{verse:Book Chapter:Verse}} marker as always, never the verse text yourself. End with application and a few discussion questions the group can talk through together. This is a teaching document a host holds and speaks from.',
  };
  const formInstruction = formInstructions[form] || formInstructions.article;

  // Posture by tier (which "door" the member picked). Governs how much the engine
  // writes vs. draws out — the theology always comes from the member.
  const postureInstructions = {
    1: "You are a writing companion in a live conversation. The member is writing this piece THEMSELVES — you do NOT write it for them. Your role is to help them find their idea, develop it, test it against Scripture and sound doctrine, and sharpen their thinking through questions and discussion. Draw the theology out of THEM. Ask good questions. Offer angles, push gently on weak points. You MAY offer a sentence or a short phrase now and then to illustrate or unstick them — but NEVER write a full paragraph, a full section, or a whole draft. If they seem to want you to write more of it for them, gently point them to switching modes ('if you'd like me to draft more of this, the \"Write it for me\" option is built for that') rather than quietly taking over the writing. The writing is theirs. Keep replies conversational and fairly short, like a thoughtful writing partner talking — not an essay, and never a finished article.",
    2: "You are a writing companion collaborating in a live conversation. You and the member build this piece together, trading ideas and lines as you talk. When it helps, you may offer a sentence, a paragraph, or a passage they can use — but keep it collaborative, checking direction with them rather than running ahead. Draw their theology out and build on it; do not import doctrine they did not affirm. Keep replies conversational.",
    3: "You are a writing companion in a live conversation, helping the member get a full draft down. Talk with them to understand what they want, then offer substantial drafted prose they can use, refining it as they steer. Still draw the core theology from what they tell you rather than importing your own positions. Keep the conversation natural — discuss, then draft, then refine.",
  };
  const postureInstruction = postureInstructions[tier] || postureInstructions[1];

  const systemPrompt = studyLevelInstruction + '\n\n' + IRON_INK_CORE_PROMPT + '\n\n' + IRON_INK_WRITING_PROMPT + '\n\n' + formInstruction + '\n\n' + postureInstruction;

  // Build API messages — must always start with 'user'.
  let apiMessages;
  if (isOpening) {
    // "Build from a study": when the opening turn carries source material, seed the
    // companion with it so it greets already knowing the study. The study rides in
    // the opening user turn ONLY (the client sends it just once) and is NOT written
    // to the article pane. When absent, the greeting path is exactly as before.
    let openingText;
    if (sourceContent) {
      openingText = 'The member wants to build a ' + (form || 'article') + ' from an existing study they have already written. Here is that study as source material:\n\n"""\n' + sourceContent + '\n"""\n\nRead it, then greet them warmly and briefly, acknowledge the study by its topic ("' + (sourceTopic || 'this study') + '"), and ask how they would like to shape it into a ' + (form || 'article') + '. Do NOT dump the study back to them — you are transforming it into the new form. Keep the greeting short.';
    } else {
      openingText = 'Begin a writing session. The member wants to write a ' + (form || 'article') + '. Greet them warmly and briefly, and ask what is on their heart to write about (or, if they are not sure yet, help them find a direction). Keep it short and inviting.';
    }
    apiMessages = [{ role: 'user', content: openingText }];
  } else {
    const hist = Array.isArray(messages) ? messages : [];
    // No adversarial framing to restate — the history speaks for itself. Guard
    // only against a history that doesn't open on a user turn.
    apiMessages = (hist[0] && hist[0].role === 'user')
      ? hist
      : [{ role: 'user', content: '(continue)' }, ...hist];
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const model  = tier === 3 ? 'claude-opus-4-8' : 'claude-sonnet-4-6';
  // Normal conversational replies stay at 1500. Only a deliberate full-draft turn
  // (runDraftIntoArticle sends fullDraft:true) gets the higher ceiling so a full
  // teaching guide isn't cut off mid-sentence. Not keyed off tier — that would
  // inflate ordinary Tier 3 chat replies.
  const maxTokens = fullDraft ? 4000 : 1500;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  let closed = false;

  try {
    const stream = client.messages.stream({
      model,
      max_tokens: maxTokens,
      system:     systemPrompt,
      messages:   apiMessages,
    });

    req.on('close', () => {
      closed = true;
      try { stream.abort(); } catch {}
    });

    // Marker-safe streaming (identical to Dialogue): the model may emit
    // {{verse:...}} markers that must become real verse text (NASB primary, ASV
    // fallback) and must never split across SSE chunks. Buffer, hold back any
    // in-progress marker, inject completed markers, emit only the safe prefix.
    let buf = '';
    let atLineStart = true;
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
      if (usedNasb) res.write(`data: ${JSON.stringify({ text: NASB_ATTRIBUTION_MD })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  } catch (err) {
    if (!res.writableEnded) {
      if (!closed) {
        console.error('[Writing/converse] API error — status:', err.status, '| type:', err.error?.type, '| message:', err.message);
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      }
      res.end();
    }
  }
});

// ─── POST /api/writing/restyle (streaming SSE) ────────────────────────────────
// Writing Types engine. One-shot transform: takes the current article draft and
// rewrites it in one of six voices, preserving the writer's theology and meaning.
// Cloned from POST /api/writing/converse — identical SSE + marker-safe flush() +
// injectVersesTracked + req.on('close')/abort + usedNasb/NASB_ATTRIBUTION_MD +
// [DONE] + error handling. Differences: body is { draft, style, form }, a single
// user turn (no conversation history), style-specific prompt, opus + 4000 tokens.
// Purely additive: /converse and /generate are untouched.
router.post('/api/writing/restyle', requireAuth, async (req, res) => {
  if (memberGated(req)) return res.status(402).json({ success: false, error: 'member_feature', upgradeUrl: '/pricing' });
  const { draft, style, form } = req.body;

  // Validate before opening the stream — nothing to rewrite means no request.
  if (!draft || !String(draft).trim()) {
    return res.status(400).json({ success: false, error: 'No draft to restyle.' });
  }

  const {
    IRON_INK_CORE_PROMPT, IRON_INK_WRITING_PROMPT,
    IRON_INK_STYLE_WARMER, IRON_INK_STYLE_ENCOURAGING, IRON_INK_STYLE_CONVICTION,
    IRON_INK_STYLE_RESPOND, IRON_INK_STYLE_LYRICAL, IRON_INK_STYLE_PLAINER,
  } = req.app.locals.prompts;
  const userSettings = req.session.user && req.session.user.settings;
  const studyLevelInstruction = getStudyLevelInstruction(userSettings);

  // Same form instructions as /api/writing/converse — kept identical on purpose.
  const formInstructions = {
    article: 'This is an article or essay. Structure it with a clear introduction, logical argument movements, objection and answer, and a doxological conclusion. It is written to be read, not heard.',
    sermon:  'This is a sermon or exhortation. Structure it with a compelling opening, expository body with clear movements, at least one illustration prompt [ILLUSTRATION: describe what kind of illustration would work here], and a direct application landing that tells the listener what to do or believe. Use repetition deliberately. Write for the ear, not the eye. End with a call to the congregation.',
    letter:  'This is a personal doctrinal letter to a specific person. Open by addressing them directly by their relationship to the writer (friend, sister, neighbor — whatever was stated in Q3/Q5). Write in a warm but doctrinally serious pastoral voice. Do not structure it like an essay — let it read like a genuine letter. Close with an expression of care and a prayer or blessing.',
    teaching: 'This is a teaching guide — a fully-scripted study written to be spoken aloud by a host or teacher leading a group, or delivered to camera. Write it to be SPOKEN and HEARD, not silently read. The host holds this script and teaches from it.\n\nTHERE ARE TWO MODES, and you must choose based on the conversation:\n\nMODE A — COMPANION GUIDE (use this WHENEVER source study material was provided in this conversation). In this mode, assume every participant is holding a PRINTED COPY of that study. Your job is NOT to re-teach the study\'s content from scratch — they can read it themselves. Your job is to be the CONDUCTOR who leads the room THROUGH the handout they are holding: direct them to specific sections of the study ("Look at Section 4 in your handout — the part on Christ\'s presence"), draw their attention to the key sentences, the important word, the pivotal Scripture, and the turns in the argument. Read a passage aloud together, then unpack it. Pose the study\'s questions to the group and leave room to discuss. Add the host\'s live connective tissue — the transitions, the "here\'s why this matters," the pastoral application — that a printed study can\'t give, while the students follow along in the document. Reference the study by its sections and flow. Do NOT reproduce the whole study as prose; point to it.\n\nMODE B — STANDALONE TEACHING (use this ONLY when NO source study was provided — the writer started fresh). In this mode, assume the group has their BIBLES OPEN to the passage but NO handout. Teach the passage directly: direct them to specific verses ("Open your Bibles to 1 Corinthians 10, look at verse 16"), read the Scripture together, and teach the doctrine as you go, building the understanding live with the room. Here you DO teach the content fully, because there is no handout to carry it — the Bible is the shared document you are guiding them through.\n\nIN BOTH MODES: Open with something that draws the room in within the first minute — a question, a scene, a striking claim — not a throat-clearing preamble. Organize it in clear, speakable sections a host can move through, sized to run roughly 20-30 minutes aloud. Write in a warm, clear, generic teacher\'s voice usable by ANY host — not as one specific named person. Fully script it (complete sentences meant to be said), with natural spoken rhythm — shorter sentences than written prose. Where Scripture is quoted, emit the {{verse:Book Chapter:Verse}} marker as always, never the verse text yourself. End with application and a few discussion questions the group can talk through together. This is a teaching document a host holds and speaks from.',
  };
  const formInstruction = formInstructions[form] || formInstructions.article;

  // Select the restyle instruction by style key; default to warmer if unrecognized.
  const styleInstructions = {
    warmer:      IRON_INK_STYLE_WARMER,
    encouraging: IRON_INK_STYLE_ENCOURAGING,
    conviction:  IRON_INK_STYLE_CONVICTION,
    respond:     IRON_INK_STYLE_RESPOND,
    lyrical:     IRON_INK_STYLE_LYRICAL,
    plainer:     IRON_INK_STYLE_PLAINER,
  };
  const styleInstruction = styleInstructions[style] || IRON_INK_STYLE_WARMER;

  const systemPrompt = studyLevelInstruction + '\n\n' + IRON_INK_CORE_PROMPT + '\n\n' + IRON_INK_WRITING_PROMPT + '\n\n' + formInstruction + '\n\n' + styleInstruction;

  // One-shot transform — a single user turn carrying the draft to rewrite. No
  // conversation history; the style instruction lives in the system prompt.
  const apiMessages = [{ role: 'user', content: 'Here is the draft to rewrite:\n\n' + draft }];

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const model  = 'claude-opus-4-8';   // quality-sensitive rewrite — stronger model
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  let closed = false;

  try {
    const stream = client.messages.stream({
      model,
      max_tokens: 4000,               // drafts can be long
      system:     systemPrompt,
      messages:   apiMessages,
    });

    req.on('close', () => {
      closed = true;
      try { stream.abort(); } catch {}
    });

    // Marker-safe streaming (identical to converse): hold back any in-progress
    // {{verse:...}} marker, inject completed markers, emit only the safe prefix.
    let buf = '';
    let atLineStart = true;
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
      if (usedNasb) res.write(`data: ${JSON.stringify({ text: NASB_ATTRIBUTION_MD })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  } catch (err) {
    if (!res.writableEnded) {
      if (!closed) {
        console.error('[Writing/restyle] API error — status:', err.status, '| type:', err.error?.type, '| message:', err.message);
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      }
      res.end();
    }
  }
});

// ─── POST /api/writing/rewrite (streaming SSE) ────────────────────────────────
// Highlight-to-revise (Capability 1). Takes ONE highlighted passage from the
// article pane plus a free-text instruction and returns ONLY the rewritten
// passage — never the whole draft, never commentary — so the client can splice
// it back into #editorContent at the original selection offsets. Cloned from
// POST /api/writing/restyle almost verbatim: identical SSE + marker-safe
// flush() + injectVersesTracked + req.on('close')/abort + [DONE] + error
// handling. Differences: body is { selection, instruction, form } (no style
// key — the instruction IS the directive), a single short user turn, and
// max_tokens 1500 (a passage, not a full draft).
//
// Deliberately DOES NOT append NASB_ATTRIBUTION_MD the way /restyle does: that
// footer is meant for the END of a whole piece, and this response gets spliced
// into the MIDDLE of an existing draft — appending it here would inject
// attribution text mid-paragraph every time a revision happened to touch a
// NASB verse. The article-level attribution from whenever the draft was first
// generated/restyled already covers it; usedNasb is tracked but intentionally
// unused. Purely additive: /restyle, /converse, /generate are untouched.
router.post('/api/writing/rewrite', requireAuth, async (req, res) => {
  if (memberGated(req)) return res.status(402).json({ success: false, error: 'member_feature', upgradeUrl: '/pricing' });
  // `form` is intentionally NOT read here: unlike /converse and /restyle, this
  // endpoint deliberately omits per-form essay scaffolding (see systemPrompt below).
  const { selection, instruction } = req.body;

  if (!selection || !String(selection).trim()) {
    return res.status(400).json({ success: false, error: 'No passage selected.' });
  }
  if (!instruction || !String(instruction).trim()) {
    return res.status(400).json({ success: false, error: 'No instruction given.' });
  }

  const { IRON_INK_CORE_PROMPT } = req.app.locals.prompts;

  // FOCUSED fragment-rewrite prompt — deliberately narrower than /converse and
  // /restyle. This endpoint rewrites a single short passage sitting INSIDE an
  // existing document, so it must NOT stack the whole-essay writing prompt
  // (IRON_INK_WRITING_PROMPT) or the per-form structure instruction ("clear
  // introduction, logical argument movements, objection and answer, doxological
  // conclusion," etc.). That essay scaffolding is exactly what made the model
  // over-produce on multi-word passages — returning the original PLUS a rewrite,
  // which the client then spliced into garble like "...directly.objection directly."
  // (single words happened to survive because the model returned just one word).
  // We keep only the non-negotiable guardrails: the Reformed doctrinal frame
  // (IRON_INK_CORE_PROMPT) and the Scripture marker rule (restated in the
  // directive below), plus a tight "return only the replacement fragment" order.
  const rewriteDirective =
    'You are revising a single short passage from within a larger existing document. ' +
    'Rewrite ONLY the passage below according to the instruction. Return ONLY the rewritten passage ' +
    'itself — no quotation marks, no preamble, no explanation, no restatement of the original, and ' +
    'nothing before or after it. Do not add structure, headings, transitions, or a conclusion; this ' +
    'is a fragment inside an existing document, not a standalone piece. Preserve the same Reformed ' +
    'doctrinal frame, voice, and meaning unless the instruction itself asks you to change tone, ' +
    'length, or emphasis. The Scripture quotation rule still applies in full — you must never write ' +
    'out verse text yourself; emit {{verse:Book Chapter:Verse}} markers only.';

  const systemPrompt = IRON_INK_CORE_PROMPT + '\n\n' + rewriteDirective;

  // One-shot transform — a single user turn carrying the instruction and the
  // passage to rewrite. No conversation history.
  const apiMessages = [{
    role: 'user',
    content: 'Rewrite only the following passage according to the instruction. Return only the rewritten passage.\n\nINSTRUCTION:\n' + instruction + '\n\nPASSAGE:\n' + selection,
  }];

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const model  = 'claude-opus-4-8';   // quality-sensitive rewrite — stronger model
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  let closed = false;

  try {
    const stream = client.messages.stream({
      model,
      max_tokens: 1500,               // a single passage, not a full draft
      system:     systemPrompt,
      messages:   apiMessages,
    });

    req.on('close', () => {
      closed = true;
      try { stream.abort(); } catch {}
    });

    // Marker-safe streaming (identical to restyle/converse): hold back any
    // in-progress {{verse:...}} marker, inject completed markers, emit only
    // the safe prefix.
    let buf = '';
    let atLineStart = true;
    let usedNasb = false;   // tracked for parity with restyle/converse; deliberately unused (see header comment)
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
      res.write('data: [DONE]\n\n');
      res.end();
    }
  } catch (err) {
    if (!res.writableEnded) {
      if (!closed) {
        console.error('[Writing/rewrite] API error — status:', err.status, '| type:', err.error?.type, '| message:', err.message);
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      }
      res.end();
    }
  }
});

module.exports = router;
