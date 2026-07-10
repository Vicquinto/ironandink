const express    = require('express');
const fs         = require('fs');
const path       = require('path');
const { randomUUID } = require('crypto');
const { requireAuth, renderLayout, getIsAdmin } = require('./layout');

const router        = express.Router();
const ARTICLES_PATH = path.join(__dirname, '../data/articles.json');
const STUDIES_PATH  = path.join(__dirname, '../data/studies.json');
const USERS_PATH    = path.join(__dirname, '../data/users.json');
const AMENS_PATH    = path.join(__dirname, '../data/community.json');
const COMMENTS_PATH = path.join(__dirname, '../data/comments.json');

// Prayer board stores — mirror the article amens/comments split exactly:
//   PRAYERS_PATH    = the requests           (cf. ARTICLES_PATH)
//   PRAYING_PATH    = the "praying" toggles  (cf. AMENS_PATH)
//   PCOMMENTS_PATH  = the prayer comments    (cf. COMMENTS_PATH)
const PRAYERS_PATH   = path.join(__dirname, '../data/prayers.json');
const PRAYING_PATH   = path.join(__dirname, '../data/prayer-praying.json');
const PCOMMENTS_PATH = path.join(__dirname, '../data/prayer-comments.json');

function readJSON(p) {
  try {
    if (!fs.existsSync(p)) return [];
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch { return []; }
}

function writeJSON(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

function getAuthorName(userId) {
  try {
    const users = JSON.parse(fs.readFileSync(USERS_PATH, 'utf8'));
    const user  = users.find(u => u.id === userId);
    return user ? user.fullName : 'Unknown';
  } catch { return 'Unknown'; }
}

// ─── GET /community ───────────────────────────────────────────────────────────
router.get('/community', requireAuth, (req, res) => {
  const isAdmin = getIsAdmin(req);

  const content = `
    <div class="believe-tabs community-tabs">
      <button class="believe-tab community-tab active" data-ctab="articles">Articles</button>
      <button class="believe-tab community-tab" data-ctab="studies">Studies</button>
      <button class="believe-tab community-tab" data-ctab="prayers">Prayer Requests</button>
    </div>

    <div id="communityFeed">
      <div class="page-header">
        <h2 class="page-title">Community</h2>
        <p class="page-subtitle">Articles published by the Iron &amp; Ink community.</p>
      </div>
      <div id="communityLoading" class="study-loading" style="display:none;">
        <div class="study-spinner"></div>
        <p class="loading-text">Loading&#8230;</p>
      </div>
      <div id="featuredSection" style="display:none;">
        <h3 class="community-section-label">&#128204; Featured</h3>
        <div id="featuredList" class="community-feed-list"></div>
      </div>
      <div id="feedList" class="community-feed-list"></div>
      <p id="communityEmpty" class="writing-empty" style="display:none;">No articles have been published yet.</p>
    </div>

    <div id="communityReading" style="display:none;">
      <div class="reading-topbar">
        <button class="btn-warm" id="communityBackBtn">&#8592; Back to Community</button>
        <div id="communityReadBadges" class="reading-badges"></div>
      </div>
      <div class="reading-card community-reading-card">
        <h2 id="communityReadTitle" class="reading-title"></h2>
        <p id="communityReadMeta" class="community-read-meta-text"></p>
        <div class="guide-font-toolbar" id="communityFontToolbar">
          <button class="guide-font-btn guide-font-btn-sm" id="communityFontDec">A&#8722;</button>
          <button class="guide-font-btn guide-font-btn-md" id="communityFontReset">A</button>
          <button class="guide-font-btn guide-font-btn-lg" id="communityFontInc">A+</button>
        </div>
        <div id="communityReadBody" class="reading-body" style="margin-top:24px;"></div>

        <div class="amen-section">
          <button id="amenBtn" class="btn-amen">&#9825; Amen &nbsp;<span id="amenCount">0</span></button>
        </div>

        <div class="comments-section">
          <h4 class="comments-label">Comments</h4>
          <div class="comment-input-row">
            <textarea id="commentInput" class="comment-textarea" rows="2"
                      placeholder="Add a comment&#8230;"></textarea>
            <button class="btn-primary" id="postCommentBtn" style="margin-top:8px; font-size:0.82rem;">Post Comment</button>
          </div>
          <div id="commentList" class="comment-list"></div>
        </div>
      </div>
    </div>

    <div id="studiesBoard" style="display:none;">
      <div class="page-header">
        <h2 class="page-title">Community Studies</h2>
        <p class="page-subtitle">Study guides shared by the Iron &amp; Ink community.</p>
      </div>
      <div id="studiesLoading" class="study-loading" style="display:none;">
        <div class="study-spinner"></div>
        <p class="loading-text">Loading&#8230;</p>
      </div>
      <div id="studiesList" class="community-feed-list"></div>
      <p id="studiesEmpty" class="writing-empty" style="display:none;">No studies have been shared yet.</p>
    </div>

    <div id="prayerBoard" style="display:none;">
      <div class="page-header">
        <h2 class="page-title">Prayer Requests</h2>
        <p class="page-subtitle">Share a request and pray for one another.</p>
      </div>
      <div class="prayer-compose">
        <textarea id="prayerInput" class="comment-textarea prayer-compose-input" rows="6"
                  placeholder="Share a prayer request&#8230;"></textarea>
        <label class="prayer-anon-row">
          <input type="checkbox" id="prayerAnon">
          <span>Post anonymously (your name will be hidden)</span>
        </label>
        <p id="prayerAnonNote" class="prayer-anon-note" style="display:none;">
          Hidden from other members &mdash; but the administrators can still see who posted, for your safety and care.
        </p>
        <p class="prayer-privacy-note">
          Your prayer requests are shared with the Iron &amp; Ink community. You may post anonymously &mdash;
          your name will be hidden from other members. Please know that the administrators can still see who
          posted, only so we can care for and protect our members. Share what&rsquo;s on your heart; we&rsquo;ll
          lift it up together.
        </p>
        <button class="btn-primary" id="postPrayerBtn" style="margin-top:8px;">Post Request</button>
      </div>
      <div id="prayerLoading" class="study-loading" style="display:none;">
        <div class="study-spinner"></div>
        <p class="loading-text">Loading&#8230;</p>
      </div>
      <div id="prayerList" class="community-feed-list" style="margin-top:24px;"></div>
      <p id="prayerEmpty" class="writing-empty" style="display:none;">No prayer requests yet. Be the first to share.</p>
    </div>`;

  res.send(renderLayout({
    req,
    activeSection: 'community',
    title:         'Community',
    content,
    scripts: `
      <script>
        window.IS_ADMIN = ${isAdmin};
        window.CURRENT_USER_ID = ${JSON.stringify(req.session.userId)};
      </script>
      <script src="/js/community.js?v=14"></script>`,
  }));
});

// ─── GET /api/community/articles ──────────────────────────────────────────────
router.get('/api/community/articles', requireAuth, (req, res) => {
  const amens    = readJSON(AMENS_PATH);
  const comments = readJSON(COMMENTS_PATH);
  const articles = readJSON(ARTICLES_PATH)
    .filter(a => a.status === 'Published')
    .map(a => ({
      ...a,
      authorName:   getAuthorName(a.userId),
      amenCount:    amens.filter(x => x.articleId === a.id).length,
      commentCount: comments.filter(x => x.articleId === a.id).length,
    }))
    .sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return new Date(b.publishedAt || b.updatedAt) - new Date(a.publishedAt || a.updatedAt);
    });
  res.json({ success: true, articles });
});

// ════════════════════════════════════════════════════════════════════════════
// SHARED STUDIES  (direct-publish — no admin approval gate)
// A study becomes community-visible the moment its owner sets shared === true.
// ════════════════════════════════════════════════════════════════════════════

// ─── GET /api/community/studies — feed of shared studies (newest-shared first) ─
router.get('/api/community/studies', requireAuth, (req, res) => {
  const studies = readJSON(STUDIES_PATH)
    .filter(s => s.shared === true)          // missing flag === not shared
    .map(s => ({
      id:          s.id,
      topic:       s.topic,                  // studies use `topic`, not `title`
      content:     s.content,
      translation: s.translation || 'LSB',
      studyLevel:  s.studyLevel || null,
      studyType:   s.studyType || 'doctrinal',
      tags:        s.tags || [],
      authorName:  getAuthorName(s.userId),
      sharedAt:    s.sharedAt || s.savedAt || s.createdAt || null,
    }))
    .sort((a, b) => new Date(b.sharedAt || 0) - new Date(a.sharedAt || 0));
  res.json({ success: true, studies });
});

// ─── GET /api/community/articles/:id ─────────────────────────────────────────
router.get('/api/community/articles/:id', requireAuth, (req, res) => {
  const articles = readJSON(ARTICLES_PATH);
  const article  = articles.find(a => a.id === req.params.id && a.status === 'Published');
  if (!article) return res.status(404).json({ success: false, error: 'Article not found.' });

  const amens    = readJSON(AMENS_PATH);
  const userAmen = amens.find(x => x.articleId === article.id && x.userId === req.session.userId);

  res.json({
    success: true,
    article: {
      ...article,
      authorName: getAuthorName(article.userId),
      amenCount:  amens.filter(x => x.articleId === article.id).length,
      userAmened: !!userAmen,
    },
  });
});

// ─── POST /api/community/amens/:articleId — toggle ────────────────────────────
router.post('/api/community/amens/:articleId', requireAuth, (req, res) => {
  const amens = readJSON(AMENS_PATH);
  const idx   = amens.findIndex(x => x.articleId === req.params.articleId && x.userId === req.session.userId);
  let userAmened;
  if (idx !== -1) {
    amens.splice(idx, 1);
    userAmened = false;
  } else {
    amens.push({ articleId: req.params.articleId, userId: req.session.userId, createdAt: new Date().toISOString() });
    userAmened = true;
  }
  writeJSON(AMENS_PATH, amens);
  const count = amens.filter(x => x.articleId === req.params.articleId).length;
  res.json({ success: true, count, userAmened });
});

// ─── GET /api/community/comments/:articleId ───────────────────────────────────
router.get('/api/community/comments/:articleId', requireAuth, (req, res) => {
  const comments = readJSON(COMMENTS_PATH)
    .filter(c => c.articleId === req.params.articleId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ success: true, comments });
});

// ─── POST /api/community/comments ────────────────────────────────────────────
router.post('/api/community/comments', requireAuth, (req, res) => {
  const { articleId, content } = req.body;
  if (!articleId || !content || !content.trim()) {
    return res.status(400).json({ success: false, error: 'Article ID and content are required.' });
  }
  const articles = readJSON(ARTICLES_PATH);
  if (!articles.find(a => a.id === articleId && a.status === 'Published')) {
    return res.status(404).json({ success: false, error: 'Article not found.' });
  }
  const comment = {
    id:         randomUUID(),
    articleId,
    userId:     req.session.userId,
    authorName: req.session.user.fullName || 'Unknown',
    content:    content.trim(),
    createdAt:  new Date().toISOString(),
  };
  const comments = readJSON(COMMENTS_PATH);
  comments.push(comment);
  writeJSON(COMMENTS_PATH, comments);
  res.json({ success: true, comment });
});

// ─── DELETE /api/community/comments/:id ──────────────────────────────────────
router.delete('/api/community/comments/:id', requireAuth, (req, res) => {
  const comments = readJSON(COMMENTS_PATH);
  const idx      = comments.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, error: 'Comment not found.' });

  const comment = comments[idx];
  if (comment.userId !== req.session.userId && !getIsAdmin(req)) {
    return res.status(403).json({ success: false, error: 'Not authorized.' });
  }
  comments.splice(idx, 1);
  writeJSON(COMMENTS_PATH, comments);
  res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════════════════
// PRAYER REQUEST BOARD
// Mirrors the article feed / amens / comments machinery above, scoped to prayers.
// ════════════════════════════════════════════════════════════════════════════

// ─── GET /api/community/prayers — feed (newest first) ─────────────────────────
router.get('/api/community/prayers', requireAuth, (req, res) => {
  const praying  = readJSON(PRAYING_PATH);
  const comments = readJSON(PCOMMENTS_PATH);
  const isAdmin  = getIsAdmin(req);
  // Build each row explicitly (no `...p` spread) so the real submitter name and
  // userId never leak to other members for anonymous posts — anonymity is
  // enforced in the RESPONSE, not just hidden with CSS on the client.
  const prayers  = readJSON(PRAYERS_PATH)
    .map(p => {
      const isOwner = p.userId === req.session.userId;
      const reveal  = !p.anonymous || isOwner || isAdmin;  // owner/admin see real identity
      return {
        id:           p.id,
        text:         p.text,
        answered:     !!p.answered,
        answeredAt:   p.answeredAt || null,
        createdAt:    p.createdAt,
        anonymous:    !!p.anonymous,
        // Real name withheld from non-owner/non-admin viewers of anonymous posts.
        authorName:   reveal ? (p.authorName || 'Unknown') : 'A brother or sister in Christ',
        prayingCount: praying.filter(x => x.prayerId === p.id).length,
        userPraying:  praying.some(x => x.prayerId === p.id && x.userId === req.session.userId),
        commentCount: comments.filter(x => x.prayerId === p.id).length,
        isOwner,  // computed server-side from session — still true for the owner's own anonymous posts
      };
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, prayers });
});

// ─── POST /api/community/prayers — new request ────────────────────────────────
router.post('/api/community/prayers', requireAuth, (req, res) => {
  const { text, anonymous } = req.body;
  if (!text || !text.trim()) {
    return res.status(400).json({ success: false, error: 'Prayer request text is required.' });
  }
  const prayer = {
    id:         randomUUID(),
    userId:     req.session.userId,                       // submitter id (always stored, even if anonymous)
    authorName: req.session.user.fullName || 'Unknown',   // real name (always stored; withheld from others if anonymous)
    text:       text.trim(),
    anonymous:  !!anonymous,                              // only affects what OTHER members see
    answered:   false,
    createdAt:  new Date().toISOString(),
  };
  const prayers = readJSON(PRAYERS_PATH);
  prayers.push(prayer);
  writeJSON(PRAYERS_PATH, prayers);
  res.json({ success: true, prayer });
});

// ─── POST /api/community/prayers/:id/praying — toggle (mirrors amens) ──────────
router.post('/api/community/prayers/:id/praying', requireAuth, (req, res) => {
  const prayer = readJSON(PRAYERS_PATH).find(p => p.id === req.params.id);
  if (!prayer) {
    return res.status(404).json({ success: false, error: 'Prayer request not found.' });
  }
  // Praying is frozen once a request is answered — enforce server-side so it's
  // blocked even if the UI is bypassed. Comments stay open on answered requests.
  if (prayer.answered) {
    return res.status(403).json({ success: false, error: 'This prayer request has been answered; praying is closed.' });
  }
  const praying = readJSON(PRAYING_PATH);
  const idx     = praying.findIndex(x => x.prayerId === req.params.id && x.userId === req.session.userId);
  let userPraying;
  if (idx !== -1) {
    praying.splice(idx, 1);
    userPraying = false;
  } else {
    praying.push({ prayerId: req.params.id, userId: req.session.userId, createdAt: new Date().toISOString() });
    userPraying = true;
  }
  writeJSON(PRAYING_PATH, praying);
  const count = praying.filter(x => x.prayerId === req.params.id).length;
  res.json({ success: true, count, userPraying });
});

// ─── POST /api/community/prayers/:id/answered — original poster or admin only ──
router.post('/api/community/prayers/:id/answered', requireAuth, (req, res) => {
  const prayers = readJSON(PRAYERS_PATH);
  const prayer  = prayers.find(p => p.id === req.params.id);
  if (!prayer) return res.status(404).json({ success: false, error: 'Prayer request not found.' });

  // Ownership enforced on the BACKEND: only the submitter or an admin may resolve.
  if (prayer.userId !== req.session.userId && !getIsAdmin(req)) {
    return res.status(403).json({ success: false, error: 'Not authorized.' });
  }
  prayer.answered   = true;
  prayer.answeredAt = new Date().toISOString();
  writeJSON(PRAYERS_PATH, prayers);
  res.json({ success: true, prayer });
});

// ─── DELETE /api/community/prayers/:id — original poster or admin only ─────────
router.delete('/api/community/prayers/:id', requireAuth, (req, res) => {
  const prayers = readJSON(PRAYERS_PATH);
  const idx     = prayers.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, error: 'Prayer request not found.' });

  // Ownership enforced on the BACKEND: only the submitter or an admin may delete.
  if (prayers[idx].userId !== req.session.userId && !getIsAdmin(req)) {
    return res.status(403).json({ success: false, error: 'Not authorized.' });
  }
  prayers.splice(idx, 1);
  writeJSON(PRAYERS_PATH, prayers);

  // Cascade: drop this request's praying toggles and comments too.
  writeJSON(PRAYING_PATH,   readJSON(PRAYING_PATH).filter(x => x.prayerId !== req.params.id));
  writeJSON(PCOMMENTS_PATH, readJSON(PCOMMENTS_PATH).filter(x => x.prayerId !== req.params.id));
  res.json({ success: true });
});

// ─── GET /api/community/prayer-comments/:prayerId ─────────────────────────────
router.get('/api/community/prayer-comments/:prayerId', requireAuth, (req, res) => {
  const comments = readJSON(PCOMMENTS_PATH)
    .filter(c => c.prayerId === req.params.prayerId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, comments });
});

// ─── POST /api/community/prayer-comments ──────────────────────────────────────
router.post('/api/community/prayer-comments', requireAuth, (req, res) => {
  const { prayerId, content } = req.body;
  if (!prayerId || !content || !content.trim()) {
    return res.status(400).json({ success: false, error: 'Prayer ID and content are required.' });
  }
  if (!readJSON(PRAYERS_PATH).find(p => p.id === prayerId)) {
    return res.status(404).json({ success: false, error: 'Prayer request not found.' });
  }
  const comment = {
    id:         randomUUID(),
    prayerId,
    userId:     req.session.userId,
    authorName: req.session.user.fullName || 'Unknown',
    content:    content.trim(),
    createdAt:  new Date().toISOString(),
  };
  const comments = readJSON(PCOMMENTS_PATH);
  comments.push(comment);
  writeJSON(PCOMMENTS_PATH, comments);
  res.json({ success: true, comment });
});

// ─── DELETE /api/community/prayer-comments/:id — author or admin only ─────────
router.delete('/api/community/prayer-comments/:id', requireAuth, (req, res) => {
  const comments = readJSON(PCOMMENTS_PATH);
  const idx      = comments.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, error: 'Comment not found.' });

  if (comments[idx].userId !== req.session.userId && !getIsAdmin(req)) {
    return res.status(403).json({ success: false, error: 'Not authorized.' });
  }
  comments.splice(idx, 1);
  writeJSON(PCOMMENTS_PATH, comments);
  res.json({ success: true });
});

module.exports = router;
