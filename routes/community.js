const express    = require('express');
const fs         = require('fs');
const path       = require('path');
const { randomUUID } = require('crypto');
const { requireAuth, renderLayout, getIsAdmin } = require('./layout');

const router        = express.Router();
const ARTICLES_PATH = path.join(__dirname, '../data/articles.json');
const USERS_PATH    = path.join(__dirname, '../data/users.json');
const AMENS_PATH    = path.join(__dirname, '../data/community.json');
const COMMENTS_PATH = path.join(__dirname, '../data/comments.json');

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
      <script src="/js/community.js"></script>`,
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

module.exports = router;
