const express  = require('express');
const fs       = require('fs');
const path     = require('path');
const { randomUUID } = require('crypto');
const sgMail   = require('@sendgrid/mail');
const { requireAuth, renderLayout, getIsAdmin } = require('./layout');

sgMail.setApiKey(process.env.SENDGRID_API_KEY || '');

async function sendInviteEmail(toEmail, toName, inviteUrl) {
  if (!process.env.SENDGRID_API_KEY) {
    console.warn('[sendInviteEmail] SENDGRID_API_KEY not set — skipping email');
    return;
  }
  try {
    await sgMail.send({
      to:   { email: toEmail, name: toName },
      from: { email: process.env.SENDGRID_FROM_EMAIL, name: 'Iron & Ink' },
      subject: "You're invited to Iron & Ink",
      text: `${toName},\n\nYour invitation to Iron & Ink has been approved. Click the link below to set up your account and begin your study.\n\n${inviteUrl}\n\nThis link expires in 48 hours.\n\nSoli Deo Gloria,\nIron & Ink`,
      html: `<p>${toName},</p>
<p>Your invitation to Iron &amp; Ink has been approved. Click the link below to set up your account and begin your study.</p>
<p><a href="${inviteUrl}">${inviteUrl}</a></p>
<p>This link expires in 48 hours.</p>
<p><em>Soli Deo Gloria,</em><br>Iron &amp; Ink</p>`,
    });
    console.log('[sendInviteEmail] sent to', toEmail);
  } catch (err) {
    console.error('[sendInviteEmail] failed for', toEmail, ':', err.message);
  }
}

const router               = express.Router();
const ARTICLES_PATH        = path.join(__dirname, '../data/articles.json');
const USERS_PATH           = path.join(__dirname, '../data/users.json');
const AMENS_PATH           = path.join(__dirname, '../data/community.json');
const COMMENTS_PATH        = path.join(__dirname, '../data/comments.json');
const INVITES_PATH         = path.join(__dirname, '../data/invites.json');
const INVITE_REQUESTS_PATH = path.join(__dirname, '../data/invite_requests.json');

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
        <button class="admin-tab" data-tab="invitations">Invitations</button>
      </div>

      <div id="adminTabPending" class="admin-tab-content">
        <div id="pendingList" class="article-list-container"></div>
        <p id="pendingEmpty" class="writing-empty" style="display:none;">No pending submissions.</p>
      </div>

      <div id="adminTabPublished" class="admin-tab-content" style="display:none;">
        <div id="publishedList" class="article-list-container"></div>
        <p id="publishedEmpty" class="writing-empty" style="display:none;">No published articles.</p>
      </div>

      <div id="adminTabInvitations" class="admin-tab-content" style="display:none;">

        <div style="background:var(--card-bg); border:1px solid rgba(160,132,92,0.25); border-radius:6px; padding:20px 24px; margin-bottom:28px;">
          <h3 class="community-section-label" style="margin-bottom:14px;">Direct Invite</h3>
          <div id="directInviteErr" style="display:none; color:#c06060; font-size:0.9rem; margin-bottom:10px;"></div>
          <div id="directInviteLink" style="display:none; background:rgba(160,132,92,0.1); border:1px solid rgba(160,132,92,0.3); border-radius:5px; padding:12px 16px; margin-bottom:12px;">
            <p style="font-size:0.9rem; color:var(--dark-cream); margin-bottom:6px;">Invite link:</p>
            <p id="directInviteLinkText" style="font-family:'Courier New',monospace; font-size:0.8rem; color:var(--accent); word-break:break-all;"></p>
            <button class="btn-warm" id="copyDirectLinkBtn" style="margin-top:10px; font-size:0.82rem; padding:5px 14px;">Copy</button>
          </div>
          <form id="directInviteForm" style="display:flex; gap:12px; align-items:flex-end; flex-wrap:wrap;">
            <div style="flex:1; min-width:140px;">
              <label style="display:block; font-size:0.78rem; color:var(--dark-cream); margin-bottom:5px; text-transform:uppercase; letter-spacing:0.05em;">Name</label>
              <input class="form-input" type="text" id="directInviteName" placeholder="Full name">
            </div>
            <div style="flex:2; min-width:200px;">
              <label style="display:block; font-size:0.78rem; color:var(--dark-cream); margin-bottom:5px; text-transform:uppercase; letter-spacing:0.05em;">Email</label>
              <input class="form-input" type="email" id="directInviteEmail" placeholder="email@example.com">
            </div>
            <button class="btn-primary" type="submit" id="directInviteBtn" style="white-space:nowrap; margin-bottom:0;">Send Invite</button>
          </form>
        </div>

        <h3 class="community-section-label" style="margin-bottom:16px;">Pending Requests</h3>
        <div id="inviteRequestList" class="article-list-container"></div>
        <p id="inviteRequestEmpty" class="writing-empty" style="display:none;">No pending requests.</p>

        <div id="inviteLinkBox" style="display:none; margin:20px 0; background:rgba(179,140,51,0.1); border:1px solid rgba(179,140,51,0.3); border-radius:6px; padding:16px 18px;">
          <p style="color:var(--dark-cream); font-size:0.85rem; margin-bottom:10px;">Invite link generated. Copy and send this to the applicant:</p>
          <p id="inviteLinkText" style="font-family:'Courier New',monospace; font-size:0.8rem; color:var(--accent); word-break:break-all;"></p>
          <button class="btn-warm" id="copyInviteLinkBtn" style="margin-top:12px; font-size:0.78rem; padding:6px 14px;">Copy Link</button>
        </div>

        <h3 class="community-section-label" style="margin-top:32px; margin-bottom:16px;">Sent Invites</h3>
        <div id="sentInviteList" class="article-list-container"></div>
        <p id="sentInviteEmpty" class="writing-empty" style="display:none;">No invites sent yet.</p>
      </div>
    </div>

    <div id="adminReading" style="display:none;">
      <div class="reading-topbar">
        <button class="btn-warm" id="adminBackBtn">&#8592; Back to Admin</button>
        <div id="adminReadBadges" class="reading-badges"></div>
      </div>
      <div class="reading-card">
        <h2 id="adminReadTitle" class="reading-title"></h2>
        <p id="adminReadMeta" class="community-read-meta-text" style="margin-bottom:20px;"></p>
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
    scripts: `<script src="/js/admin.js?v=8"></script>
<script>
(function () {
  var form     = document.getElementById('directInviteForm');
  var errEl    = document.getElementById('directInviteErr');
  var linkBox  = document.getElementById('directInviteLink');
  var linkText = document.getElementById('directInviteLinkText');
  var copyBtn  = document.getElementById('copyDirectLinkBtn');
  var btn      = document.getElementById('directInviteBtn');
  if (!form) return;
  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    errEl.style.display = 'none';
    linkBox.style.display = 'none';
    btn.disabled = true;
    btn.textContent = 'Sending…';
    try {
      var r    = await fetch('/api/admin/invite/send', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          name:  document.getElementById('directInviteName').value.trim(),
          email: document.getElementById('directInviteEmail').value.trim(),
        }),
      });
      var data = await r.json();
      if (data.success) {
        linkText.textContent  = data.inviteUrl;
        linkBox.style.display = 'block';
        form.reset();
      } else {
        errEl.textContent   = data.error || 'Failed to generate invite.';
        errEl.style.display = 'block';
      }
    } catch (err) {
      errEl.textContent   = 'Error: ' + err.message;
      errEl.style.display = 'block';
    }
    btn.disabled    = false;
    btn.textContent = 'Send Invite';
  });
  copyBtn.addEventListener('click', function () {
    navigator.clipboard.writeText(linkText.textContent).then(function () {
      copyBtn.textContent = 'Copied!';
      setTimeout(function () { copyBtn.textContent = 'Copy'; }, 2000);
    });
  });
}());
</script>`,
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

// ─── POST /api/admin/invite/send ─────────────────────────────────────────────
router.post('/api/admin/invite/send', requireAuth, requireAdmin, (req, res) => {
  const { name, email } = req.body;
  if (!name || !email) {
    return res.status(400).json({ success: false, error: 'Name and email are required.' });
  }

  const token   = randomUUID();
  const now     = new Date();
  const expires = new Date(now.getTime() + 48 * 60 * 60 * 1000);

  const invites  = readJSON(INVITES_PATH);
  const existing = invites.find(i => i.email.toLowerCase() === email.trim().toLowerCase() && !i.used);
  if (existing) {
    return res.json({ success: false, error: 'An active invite for this email already exists.' });
  }

  invites.push({
    id:        randomUUID(),
    token,
    email:     email.trim().toLowerCase(),
    name:      name.trim(),
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    used:      false,
  });
  writeJSON(INVITES_PATH, invites);

  const host      = req.get('host') || 'localhost:4000';
  const protocol  = req.secure ? 'https' : 'http';
  const inviteUrl = `${protocol}://${host}/register?token=${token}`;

  sendInviteEmail(email.trim().toLowerCase(), name.trim(), inviteUrl);

  res.json({ success: true, inviteUrl });
});

// ─── GET /api/admin/invite-requests ──────────────────────────────────────────
router.get('/api/admin/invite-requests', requireAuth, requireAdmin, (req, res) => {
  const requests = readJSON(INVITE_REQUESTS_PATH)
    .filter(r => r.status === 'pending')
    .sort((a, b) => new Date(a.submittedAt) - new Date(b.submittedAt));
  res.json({ success: true, requests });
});

// ─── POST /api/admin/invite-requests/:id/invite ───────────────────────────────
router.post('/api/admin/invite-requests/:id/invite', requireAuth, requireAdmin, (req, res) => {
  const requests = readJSON(INVITE_REQUESTS_PATH);
  const idx      = requests.findIndex(r => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, error: 'Request not found.' });

  const record  = requests[idx];
  const token   = randomUUID();
  const now     = new Date();
  const expires = new Date(now.getTime() + 48 * 60 * 60 * 1000);

  const invites = readJSON(INVITES_PATH);
  invites.push({
    id:        randomUUID(),
    token,
    email:     record.email,
    name:      record.name,
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    used:      false,
  });
  writeJSON(INVITES_PATH, invites);

  requests[idx].status   = 'invited';
  requests[idx].invitedAt = now.toISOString();
  writeJSON(INVITE_REQUESTS_PATH, requests);

  const host      = req.get('host') || 'localhost:4000';
  const protocol  = req.secure ? 'https' : 'http';
  const inviteUrl = `${protocol}://${host}/register?token=${token}`;

  sendInviteEmail(record.email, record.name, inviteUrl);

  res.json({ success: true, inviteUrl });
});

// ─── POST /api/admin/invite-requests/:id/decline ─────────────────────────────
router.post('/api/admin/invite-requests/:id/decline', requireAuth, requireAdmin, (req, res) => {
  const requests = readJSON(INVITE_REQUESTS_PATH);
  const idx      = requests.findIndex(r => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, error: 'Request not found.' });
  requests[idx].status     = 'declined';
  requests[idx].declinedAt = new Date().toISOString();
  writeJSON(INVITE_REQUESTS_PATH, requests);
  res.json({ success: true });
});

// ─── GET /api/admin/invites ───────────────────────────────────────────────────
router.get('/api/admin/invites', requireAuth, requireAdmin, (req, res) => {
  const invites = readJSON(INVITES_PATH)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ success: true, invites });
});

// ─── DELETE /api/admin/invites/:id ───────────────────────────────────────────
router.delete('/api/admin/invites/:id', requireAuth, requireAdmin, (req, res) => {
  const invites = readJSON(INVITES_PATH);
  const idx     = invites.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, error: 'Invite not found.' });
  invites.splice(idx, 1);
  writeJSON(INVITES_PATH, invites);
  res.json({ success: true });
});

module.exports = router;
