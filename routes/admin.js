const express = require('express');
const fs      = require('fs');
const path    = require('path');
const { requireAuth, renderLayout, getIsAdmin } = require('./layout');

const router        = express.Router();
const ARTICLES_PATH = path.join(__dirname, '../data/articles.json');
const USERS_PATH    = path.join(__dirname, '../data/users.json');
const AMENS_PATH    = path.join(__dirname, '../data/community.json');
const COMMENTS_PATH = path.join(__dirname, '../data/comments.json');

function requireAdmin(req, res, next) {
  if (!req.session.userId) return res.redirect('/');
  if (getIsAdmin(req)) return next();
  return res.redirect('/dashboard');
}

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

// ─── GET /admin ───────────────────────────────────────────────────────────────
router.get('/admin', requireAuth, requireAdmin, (req, res) => {
  const content = `
    <div class="page-header">
      <h2 class="page-title">Admin Panel</h2>
      <p class="page-subtitle">Review submissions and manage the community feed.</p>
    </div>

    <div id="adminFeed">
      <div class="admin-tabs">
        <button class="admin-tab active" data-tab="pending">Pending Submissions</button>
        <button class="admin-tab" data-tab="published">Published Articles</button>
      </div>

      <div id="adminTabPending" class="admin-tab-content">
        <div id="pendingList" class="article-list-container"></div>
        <p id="pendingEmpty" class="writing-empty" style="display:none;">No pending submissions.</p>
      </div>

      <div id="adminTabPublished" class="admin-tab-content" style="display:none;">
        <div id="publishedList" class="article-list-container"></div>
        <p id="publishedEmpty" class="writing-empty" style="display:none;">No published articles.</p>
      </div>
    </div>

    <div id="adminReading" style="display:none;">
      <div class="reading-topbar">
        <button class="btn-warm" id="adminBackBtn">&#8592; Back to Admin</button>
        <div id="adminReadBadges" class="reading-badges"></div>
      </div>
      <div class="reading-card">
        <h2 id="adminReadTitle" class="reading-title"></h2>
        <p id="adminReadMeta" class="community-read-meta-text" style="margin-bottom:20px;color:rgba(26,15,10,0.5);font-size:0.78rem;"></p>
        <div id="adminReadBody" class="reading-body"></div>
      </div>
      <div id="adminReadActions" class="admin-read-actions"></div>
    </div>

    <div id="rejectModal" class="end-modal-overlay" style="display:none;">
      <div class="end-session-card">
        <h4 style="color:var(--text); margin-bottom:14px; font-size:1rem;">Rejection Note</h4>
        <p style="color:var(--warm-brown); font-size:0.82rem; margin-bottom:12px;">This note will be shown to the author on their My Articles page.</p>
        <textarea id="rejectNoteInput" class="chat-textarea" rows="3"
                  placeholder="Reason for rejection (shown to author)&#8230;"></textarea>
        <div class="end-session-actions" style="margin-top:14px;">
          <button class="btn-primary" id="rejectConfirmBtn">Confirm Rejection</button>
          <button class="btn-discard" id="rejectCancelBtn">Cancel</button>
        </div>
      </div>
    </div>`;

  res.send(renderLayout({
    req,
    activeSection: 'admin',
    title:         'Admin Panel',
    content,
    scripts:       '<script src="/js/admin.js"></script>',
  }));
});

// ─── GET /api/admin/pending ───────────────────────────────────────────────────
router.get('/api/admin/pending', requireAuth, requireAdmin, (req, res) => {
  const amens    = readJSON(AMENS_PATH);
  const comments = readJSON(COMMENTS_PATH);
  const articles = readJSON(ARTICLES_PATH)
    .filter(a => a.status === 'Pending')
    .map(a => ({
      ...a,
      authorName:   getAuthorName(a.userId),
      amenCount:    amens.filter(x => x.articleId === a.id).length,
      commentCount: comments.filter(x => x.articleId === a.id).length,
    }))
    .sort((a, b) => new Date(a.updatedAt) - new Date(b.updatedAt));
  res.json({ success: true, articles });
});

// ─── GET /api/admin/published ─────────────────────────────────────────────────
router.get('/api/admin/published', requireAuth, requireAdmin, (req, res) => {
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

// ─── GET /api/admin/articles/:id ─────────────────────────────────────────────
router.get('/api/admin/articles/:id', requireAuth, requireAdmin, (req, res) => {
  const articles = readJSON(ARTICLES_PATH);
  const article  = articles.find(a => a.id === req.params.id);
  if (!article) return res.status(404).json({ success: false, error: 'Article not found.' });
  res.json({ success: true, article: { ...article, authorName: getAuthorName(article.userId) } });
});

// ─── POST /api/admin/:id/approve ─────────────────────────────────────────────
router.post('/api/admin/:id/approve', requireAuth, requireAdmin, (req, res) => {
  const articles = readJSON(ARTICLES_PATH);
  const idx      = articles.findIndex(a => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, error: 'Article not found.' });
  articles[idx].status        = 'Published';
  articles[idx].publishedAt   = new Date().toISOString();
  articles[idx].pinned        = articles[idx].pinned || false;
  articles[idx].rejectionNote = null;
  articles[idx].updatedAt     = new Date().toISOString();
  writeJSON(ARTICLES_PATH, articles);
  res.json({ success: true, article: articles[idx] });
});

// ─── POST /api/admin/:id/reject ───────────────────────────────────────────────
router.post('/api/admin/:id/reject', requireAuth, requireAdmin, (req, res) => {
  const { note }  = req.body;
  const articles  = readJSON(ARTICLES_PATH);
  const idx       = articles.findIndex(a => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, error: 'Article not found.' });
  articles[idx].status        = 'Complete';
  articles[idx].rejectionNote = (note || '').trim() || 'Returned for revision.';
  articles[idx].updatedAt     = new Date().toISOString();
  writeJSON(ARTICLES_PATH, articles);
  res.json({ success: true, article: articles[idx] });
});

// ─── PATCH /api/admin/:id/pin ─────────────────────────────────────────────────
router.patch('/api/admin/:id/pin', requireAuth, requireAdmin, (req, res) => {
  const articles = readJSON(ARTICLES_PATH);
  const idx      = articles.findIndex(a => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, error: 'Article not found.' });
  articles[idx].pinned    = !articles[idx].pinned;
  articles[idx].updatedAt = new Date().toISOString();
  writeJSON(ARTICLES_PATH, articles);
  res.json({ success: true, pinned: articles[idx].pinned });
});

// ─── PATCH /api/admin/:id/unpublish ──────────────────────────────────────────
router.patch('/api/admin/:id/unpublish', requireAuth, requireAdmin, (req, res) => {
  const articles = readJSON(ARTICLES_PATH);
  const idx      = articles.findIndex(a => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, error: 'Article not found.' });
  articles[idx].status      = 'Complete';
  articles[idx].publishedAt = null;
  articles[idx].pinned      = false;
  articles[idx].updatedAt   = new Date().toISOString();
  writeJSON(ARTICLES_PATH, articles);
  res.json({ success: true, article: articles[idx] });
});

module.exports = router;
