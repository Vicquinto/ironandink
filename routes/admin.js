const express  = require('express');
const fs       = require('fs');
const path     = require('path');
const { randomUUID } = require('crypto');
const sgMail   = require('@sendgrid/mail');
const { requireAuth, renderLayout, getIsAdmin } = require('./layout');
const { listDevotionals, deleteDevotional, clearAllDevotionals } = require('./dashboard');

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
const STUDIES_PATH         = path.join(__dirname, '../data/studies.json');
const USERS_PATH           = path.join(__dirname, '../data/users.json');
const AMENS_PATH           = path.join(__dirname, '../data/community.json');
const COMMENTS_PATH        = path.join(__dirname, '../data/comments.json');
const INVITES_PATH         = path.join(__dirname, '../data/invites.json');
const INVITE_REQUESTS_PATH = path.join(__dirname, '../data/invite_requests.json');
const ROOMS_PATH           = path.join(__dirname, '../data/rooms.json');
const FEEDBACK_PATH        = path.join(__dirname, '../data/feedback.json');

function requireAdmin(req, res, next) {
  if (!req.session.userId) return res.redirect('/');
  if (getIsAdmin(req)) return next();
  return res.redirect('/dashboard');
}

// ─── Admin tab registry ───────────────────────────────────────────────────────
// Single source of truth for the admin panel's tabs. Drives three things:
//   1. the tab buttons rendered below,
//   2. which panel is shown/hidden on switch (public/js/admin.js),
//   3. which loader(s) run when a tab is opened.
//
// `key`   — matches both the button's data-tab value and the panel element id,
//           which is 'adminTab' + the key capitalised (pending → adminTabPending).
// `label` — button text.
// `load`  — names of the client-side loader functions to call when the tab is
//           opened, or null if the panel needs no fetch. Pending and Published
//           are null because they load eagerly once at startup instead.
//
// Adding a tab: add one entry here plus its panel div in the template below.
const ADMIN_TABS = [
  { key: 'pending',     label: 'Pending Submissions', load: null },
  { key: 'published',   label: 'Published Articles',  load: null },
  { key: 'content',     label: 'Content Management',  load: ['loadContentStudies'] },
  { key: 'invitations', label: 'Invitations',         load: ['loadInviteRequests', 'loadSentInvites'] },
  { key: 'rooms',       label: 'Live Rooms',          load: ['loadAdminRooms'] },
  { key: 'members',     label: 'Members',             load: ['loadMembers'] },
  { key: 'feedback',    label: 'Feedback',            load: ['loadFeedback'] },
  { key: 'devotionals', label: 'Devotionals',         load: ['loadDevotionals'] },
  { key: 'usage',       label: 'Usage',               load: ['loadUsage'] },
];

const ADMIN_DEFAULT_TAB = 'pending';

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
      <!-- Always-visible live-presence indicator: the "quick glance before I deploy"
           surface. Populated and refreshed client-side from GET /api/presence. -->
      <div id="adminPresenceBar" style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; background:var(--card-bg); border:1px solid rgba(160,132,92,0.3); border-radius:6px; padding:10px 14px; margin-bottom:18px; font-size:0.85rem; color:var(--dark-cream);">
        <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#9a6a1f; flex-shrink:0;" id="adminPresenceDot"></span>
        <span style="font-weight:600; color:var(--text);">Currently active:</span>
        <span id="adminPresenceNames">Checking…</span>
      </div>

      <div class="admin-tabs">
        ${ADMIN_TABS.map(t =>
          `<button class="admin-tab${t.key === ADMIN_DEFAULT_TAB ? ' active' : ''}" data-tab="${t.key}">${t.label}</button>`
        ).join('\n        ')}
      </div>

      <div id="adminTabPending" class="admin-tab-content">
        <div id="pendingList" class="article-list-container"></div>
        <p id="pendingEmpty" class="writing-empty" style="display:none;">No pending submissions.</p>
      </div>

      <div id="adminTabPublished" class="admin-tab-content" style="display:none;">
        <div id="publishedList" class="article-list-container"></div>
        <p id="publishedEmpty" class="writing-empty" style="display:none;">No published articles.</p>
      </div>

      <div id="adminTabRooms" class="admin-tab-content" style="display:none;">
        <div id="adminRoomsList"></div>
        <p id="adminRoomsEmpty" class="writing-empty" style="display:none;">No active rooms.</p>
      </div>

      <div id="adminTabMembers" class="admin-tab-content" style="display:none;">
        <div id="memberList" class="article-list-container"></div>
        <p id="memberEmpty" class="writing-empty" style="display:none;">No members.</p>
      </div>

      <div id="adminTabContent" class="admin-tab-content" style="display:none;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:16px;">
          <p style="font-size:0.82rem; color:var(--dark-cream); line-height:1.5; margin:0; max-width:70ch;">Studies shared to the Community. Open a study's footprint to see everywhere it lives before removing it. Members' private studies are not listed here.</p>
          <label style="font-size:0.82rem; color:var(--dark-cream); display:flex; align-items:center; gap:8px; white-space:nowrap; cursor:pointer;">
            <input type="checkbox" id="contentShowAll"> Include private studies
          </label>
        </div>
        <div id="contentStudyList" class="article-list-container"></div>
        <p id="contentStudyEmpty" class="writing-empty" style="display:none;">No shared studies.</p>

        <div class="admin-testing-utils" style="background:var(--card-bg); border:1px solid rgba(160,132,92,0.25); border-radius:6px; padding:16px 20px; margin-top:32px;">
          <h3 class="community-section-label" style="margin-bottom:8px;">Testing Utilities</h3>
          <p style="font-size:0.82rem; color:var(--dark-cream); margin-bottom:12px; line-height:1.5;">Reset your own guided tours so the onboarding pop-ups show again as you visit each page. Only affects your account.</p>
          <button class="btn-warm" id="resetMyToursBtn" style="font-size:0.82rem; padding:6px 16px;">Reset my tours</button>
        </div>
      </div>

      <div id="adminTabFeedback" class="admin-tab-content" style="display:none;">
        <div id="feedbackList" class="article-list-container"></div>
        <p id="feedbackEmpty" class="writing-empty" style="display:none;">No feedback submissions yet.</p>
      </div>

      <div id="adminTabDevotionals" class="admin-tab-content" style="display:none;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:16px;">
          <p style="font-size:0.82rem; color:var(--dark-cream); line-height:1.5; margin:0; max-width:60ch;">Archived daily devotionals. Scripture in newly generated devotionals is verified ASV; older entries generated before that change may contain unverified text and can be deleted here. Deleting today's entry lets it regenerate as ASV.</p>
          <button class="btn-discard" id="devotionalsClearAllBtn" style="white-space:nowrap;">Clear all</button>
        </div>
        <div id="devotionalsList" class="article-list-container"></div>
        <p id="devotionalsEmpty" class="writing-empty" style="display:none;">No archived devotionals.</p>
      </div>

      <div id="adminTabUsage" class="admin-tab-content" style="display:none;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:16px;">
          <p style="font-size:0.82rem; color:var(--dark-cream); line-height:1.5; margin:0; max-width:70ch;">Live presence — who is signed in and connected right now, with their self-set status. This view refreshes on open and will grow to hold historical usage in a later phase.</p>
          <span id="usageOnlineCount" class="article-status-badge status-published" style="white-space:nowrap;">—</span>
        </div>
        <div id="usageOnlineList" class="article-list-container"></div>
        <p id="usageOnlineEmpty" class="writing-empty" style="display:none;">No one is currently online.</p>
      </div>

      <div id="adminTabInvitations" class="admin-tab-content" style="display:none;">

        <div style="background:var(--card-bg); border:1px solid rgba(160,132,92,0.25); border-radius:6px; padding:20px 24px; margin-bottom:28px;">
          <h3 class="community-section-label" style="margin-bottom:14px;">Direct Invite</h3>
          <div id="directInviteErr" style="display:none; color:#5a0a0a; font-size:0.9rem; margin-bottom:10px;"></div>
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
    scripts: `<script>window.ADMIN_TABS = ${JSON.stringify(ADMIN_TABS)};</script>
<script src="/js/study-badges.js?v=2"></script>
<script src="/js/admin.js?v=18"></script>
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

// ─── GET /api/admin/studies — Content Management list ────────────────────────
// Defaults to shared studies only: those are the ones published to the Community
// and therefore the ones content management is actually responsible for. Pass
// ?all=1 to include members' private studies — an explicit, opt-in action, since
// browsing private studies is a real privacy intrusion and should never be the
// default view. Returns metadata only; study bodies are never included here.
router.get('/api/admin/studies', requireAuth, requireAdmin, (req, res) => {
  const includeAll = req.query.all === '1';
  const studies    = readJSON(STUDIES_PATH);

  const list = studies
    .filter(s => includeAll || s.shared === true)
    .map(s => ({
      id:         s.id,
      topic:      s.topic,
      studyType:  s.studyType  || null,
      studyLevel: s.studyLevel || null,
      shared:     s.shared === true,
      sharedAt:   s.sharedAt || null,
      savedAt:    s.savedAt || s.createdAt || null,
      ownerName:  getAuthorName(s.userId),
    }))
    .sort((a, b) => new Date(b.savedAt || 0) - new Date(a.savedAt || 0));

  res.json({ success: true, studies: list, includeAll });
});

// ─── GET /api/admin/studies/:id/footprint ────────────────────────────────────
// Everywhere a study currently lives, gathered before any destructive action.
//
// Deliberately does NOT report Live Room usage: a room stores a snapshot copy of
// a study ({topic, content, translation}) with no study id, so there is no stored
// reference to query — and equally, no risk, since deleting a study cannot affect
// a room that already holds its own copy.
router.get('/api/admin/studies/:id/footprint', requireAuth, requireAdmin, (req, res) => {
  const id      = req.params.id;
  const studies = readJSON(STUDIES_PATH);
  const study   = studies.find(s => s.id === id);

  if (!study) return res.status(404).json({ success: false, error: 'Study not found.' });

  // Notes live in the notepad store keyed by studyId. One pad per (studyId, userId),
  // so sum across pads rather than assuming a single pad.
  const notepads  = readJSON(path.join(__dirname, '../data/notepads.json'));
  const noteCount = notepads
    .filter(p => p.studyId === id)
    .reduce((sum, p) => sum + ((p.notes || []).length), 0);

  const childCount    = studies.filter(s => s.parentId === id).length;
  const dialogueCount = readJSON(path.join(__dirname, '../data/dialogues.json'))
    .filter(d => d.linkedStudyId === id).length;

  res.json({
    success: true,
    footprint: {
      id:            study.id,
      topic:         study.topic,
      studyType:     study.studyType  || null,
      studyLevel:    study.studyLevel || null,
      savedAt:       study.savedAt || study.createdAt || null,
      ownerName:     getAuthorName(study.userId),
      shared:        study.shared === true,
      sharedAt:      study.sharedAt || null,
      noteCount,
      childCount,
      dialogueCount,
    },
  });
});

// ─── PATCH /api/admin/studies/:id/unshare — admin backstop ───────────────────
// Removes a study from the Community feed by setting shared === false. This does
// NOT delete the study — it returns to being private in the owner's Library.
router.patch('/api/admin/studies/:id/unshare', requireAuth, requireAdmin, (req, res) => {
  const studies = readJSON(STUDIES_PATH);
  const idx     = studies.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, error: 'Study not found.' });
  studies[idx].shared   = false;
  studies[idx].sharedAt = null;
  writeJSON(STUDIES_PATH, studies);
  res.json({ success: true });
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

// ─── GET /api/admin/rooms ────────────────────────────────────────────────────
router.get('/api/admin/rooms', requireAuth, requireAdmin, (req, res) => {
  const rooms = readJSON(ROOMS_PATH);
  const users = readJSON(USERS_PATH);
  const result = rooms.map(r => {
    const host = users.find(u => u.id === r.host);
    return {
      code:        r.code,
      name:        r.name,
      hostName:    r.hostName || (host ? host.fullName : 'Unknown'),
      memberCount: Array.isArray(r.members) ? r.members.length : 0,
      createdAt:   r.createdAt,
      visibility:  r.visibility,
      // Drives which of Pause / Resume the admin list offers. Same default as
      // the room page uses for records saved before status was introduced.
      status:      r.status || 'active',
    };
  }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ success: true, rooms: result });
});

// ─── GET /api/admin/members ──────────────────────────────────────────────────
// Read-only roster. Explicitly whitelists fields — passwordHash and any other
// sensitive data are never serialized into the response.
router.get('/api/admin/members', requireAuth, requireAdmin, (req, res) => {
  const members = readJSON(USERS_PATH).map(u => {
    const stats = u.stats || {};
    return {
      id:               u.id,
      fullName:         u.fullName || 'Unknown',
      email:            u.email || '',
      role:             u.role === 'admin' ? 'Admin' : 'Member',
      isActive:         u.isActive !== false,
      comped:           u.comped === true,
      lastLogin:        u.lastLogin || null,
      accountStatus:    u.needsSetup ? 'Pending setup' : 'Active',
      studiesCompleted: stats.studiesCompleted || 0,
      dialogueSessions: stats.dialogueSessions || 0,
      articlesWritten:  stats.articlesWritten  || 0,
    };
  }).sort((a, b) => a.fullName.localeCompare(b.fullName));
  res.json({ success: true, members });
});

// ─── POST /api/admin/members/:id/suspend ─────────────────────────────────────
// Reversible suspension (blocks login, keeps all data). Only flips isActive.
router.post('/api/admin/members/:id/suspend', requireAuth, requireAdmin, (req, res) => {
  const users = readJSON(USERS_PATH);
  const idx   = users.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, error: 'Member not found.' });
  if (users[idx].id === req.session.userId) {
    return res.status(400).json({ success: false, error: 'You cannot suspend your own account.' });
  }
  if (users[idx].role === 'admin') {
    return res.status(400).json({ success: false, error: 'Administrators cannot be suspended.' });
  }
  users[idx].isActive = false;
  writeJSON(USERS_PATH, users);
  res.json({ success: true });
});

// ─── POST /api/admin/members/:id/reinstate ───────────────────────────────────
router.post('/api/admin/members/:id/reinstate', requireAuth, requireAdmin, (req, res) => {
  const users = readJSON(USERS_PATH);
  const idx   = users.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, error: 'Member not found.' });
  users[idx].isActive = true;
  writeJSON(USERS_PATH, users);
  res.json({ success: true });
});

// ─── Comp toggle (billing groundwork) ────────────────────────────────────────
// Sets/clears the `comped` flag on a user record. Purely additive and inert:
// nothing in login, presence, or study flows reads `comped` yet — this is
// groundwork for future billing. Both routes use the whole-object rewrite idiom
// (readJSON → mutate one field → writeJSON), so every other field is preserved.
router.post('/api/admin/members/:id/comp', requireAuth, requireAdmin, (req, res) => {
  const users = readJSON(USERS_PATH);
  const idx   = users.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, error: 'Member not found.' });
  users[idx].comped = true;
  writeJSON(USERS_PATH, users);
  res.json({ success: true, comped: true });
});

router.post('/api/admin/members/:id/uncomp', requireAuth, requireAdmin, (req, res) => {
  const users = readJSON(USERS_PATH);
  const idx   = users.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, error: 'Member not found.' });
  users[idx].comped = false;
  writeJSON(USERS_PATH, users);
  res.json({ success: true, comped: false });
});

// ─── POST /api/admin/reset-my-tours ──────────────────────────────────────────
// Testing utility: resets ONLY the currently-logged-in admin's toursSeen flags
// back to all-false, so every guided tour fires again on their next visit.
// Touches nothing but this one user's toursSeen. Valid pages come from help.js's
// VALID_TOUR_PAGES so the list stays in sync (required lazily; require() is
// cached, and this avoids any module load-order fragility).
router.post('/api/admin/reset-my-tours', requireAuth, requireAdmin, (req, res) => {
  try {
    const { VALID_TOUR_PAGES } = require('./help');
    const pages = Array.isArray(VALID_TOUR_PAGES) ? VALID_TOUR_PAGES : [];

    const users = readJSON(USERS_PATH);
    const idx   = users.findIndex(u => u.id === req.session.userId);
    if (idx === -1) return res.status(404).json({ success: false, error: 'User not found.' });

    // Rebuild toursSeen as all-false for every valid tour page — this user only.
    const toursSeen = {};
    pages.forEach(p => { toursSeen[p] = false; });
    users[idx].toursSeen = toursSeen;

    writeJSON(USERS_PATH, users);
    res.json({ success: true, pages });
  } catch (err) {
    console.error('[reset-my-tours]', err.message);
    res.status(500).json({ success: false, error: 'Could not reset tours.' });
  }
});

// ─── GET /api/admin/feedback ─────────────────────────────────────────────────
// Read-only list of member-submitted suggestions/feedback, newest first.
router.get('/api/admin/feedback', requireAuth, requireAdmin, (req, res) => {
  const feedback = readJSON(FEEDBACK_PATH)
    .slice()
    .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
  res.json({ success: true, feedback });
});

// ─── Devotional archive management (admin) ───────────────────────────────────
// List every archived devotional (newest first) so an admin can review/purge.
router.get('/api/admin/devotionals', requireAuth, requireAdmin, (req, res) => {
  res.json({ success: true, devotionals: listDevotionals() });
});

// Delete one archived devotional by its date (YYYY-MM-DD). Regenerates as verified
// ASV on the next visit/cron if it was today's.
router.delete('/api/admin/devotionals/:date', requireAuth, requireAdmin, (req, res) => {
  const removed = deleteDevotional(req.params.date);
  res.json({ success: true, removed });
});

// Purge the entire devotional archive (for the ASV cleanup).
router.delete('/api/admin/devotionals', requireAuth, requireAdmin, (req, res) => {
  const removed = clearAllDevotionals();
  res.json({ success: true, removed });
});

module.exports = router;
