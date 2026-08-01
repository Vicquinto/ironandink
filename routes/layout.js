const fs   = require('fs');
const path = require('path');
const { BILLING_ENABLED, getEntitlements } = require('../lib/entitlements');
const USERS_PATH_L    = path.join(__dirname, '../data/users.json');
const MESSAGES_PATH_L = path.join(__dirname, '../data/messages.json');
const INVITE_REQUESTS_PATH_L = path.join(__dirname, '../data/invite_requests.json');

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect('/');
  // Mid-session suspension check: bounce an already-logged-in member whose
  // account was suspended. Strict === false so legacy records without the
  // field are unaffected. Fail open on a read error — don't lock everyone out.
  try {
    const users = JSON.parse(fs.readFileSync(USERS_PATH_L, 'utf8'));
    const user  = users.find(u => u.id === req.session.userId);
    if (user && user.isActive === false) {
      return req.session.destroy(() => res.redirect('/login?suspended=1'));
    }
  } catch { /* fail open */ }
  next();
}

function getIsAdmin(req) {
  if (req.session.user && req.session.user.isAdmin) return true;
  if (req.session.userId) {
    try {
      const users = JSON.parse(fs.readFileSync(USERS_PATH_L, 'utf8'));
      const user  = users.find(u => u.id === req.session.userId);
      return !!(user && (user.role === 'admin' || user.isAdmin === true));
    } catch { return false; }
  }
  return false;
}

function getToursSeen(req) {
  if (!req.session.userId) return {};
  try {
    const users = JSON.parse(fs.readFileSync(USERS_PATH_L, 'utf8'));
    const user  = users.find(u => u.id === req.session.userId);
    return (user && user.toursSeen) ? user.toursSeen : {};
  } catch { return {}; }
}

function getDmUnreadCount(userId) {
  if (!userId) return 0;
  try {
    if (!fs.existsSync(MESSAGES_PATH_L)) return 0;
    const data = JSON.parse(fs.readFileSync(MESSAGES_PATH_L, 'utf8'));
    return (data.threads || [])
      .filter(t => t.participants && t.participants.includes(userId))
      .reduce((sum, t) => {
        return sum + (t.messages || []).filter(m => m.senderId !== userId && !(m.readBy || []).includes(userId)).length;
      }, 0);
  } catch { return 0; }
}

// Count invite requests still awaiting admin approval (status === 'pending').
// Mirrors getDmUnreadCount: read-only, fails closed to 0 on any error so a bad
// file never blocks page rendering.
function getPendingInviteCount() {
  try {
    if (!fs.existsSync(INVITE_REQUESTS_PATH_L)) return 0;
    const data = JSON.parse(fs.readFileSync(INVITE_REQUESTS_PATH_L, 'utf8'));
    return (Array.isArray(data) ? data : []).filter(r => r.status === 'pending').length;
  } catch { return 0; }
}

// True only when billing is ON and this member lacks member features (a real free
// member). Always false while dark, so the nav renders byte-for-byte as today.
// Fails safe to false (unlocked) on any read error — never lock the nav on a hiccup.
function isMemberLocked(req) {
  if (!BILLING_ENABLED) return false;
  if (!req.session || !req.session.userId) return false;
  try {
    const users = JSON.parse(fs.readFileSync(USERS_PATH_L, 'utf8'));
    const ent = getEntitlements(users.find(u => u.id === req.session.userId));
    return ent.billingEnabled && !ent.canUseMemberFeatures;
  } catch { return false; }
}

// Member-only nav items and the /pricing?from= tag each links to when locked.
const MEMBER_LOCKED_NAV = { dialogue: 'dialogue', writing: 'article', 'my-articles': 'article', selah: 'selah' };

function renderLayout({ req, activeSection, title, content, scripts = '' }) {
  const navItems = [
    { id: 'dashboard',   label: 'Dashboard',   href: '/dashboard',   icon: '&#9685;' },
    { id: 'devotional',  label: 'Devotional',  href: '/devotional',  icon: '&#9788;' },
    { id: 'study',       label: 'Study',       href: '/study',       icon: '&#10016;' },
    { id: 'dialogue',    label: 'Dialogue',    href: '/dialogue',    icon: '&#9993;' },
    { id: 'writing',     label: 'Writing',     href: '/writing',     icon: '&#9998;' },
    { id: 'library',     label: 'Library',     href: '/library',     icon: '&#8801;' },
    { id: 'scripture',   label: 'Scripture',   href: '/scripture',   icon: '&#10070;' },
    { id: 'selah',       label: 'Selah',       href: '/selah',       icon: '&#10022;' },
    { id: 'community',   label: 'Community',   href: '/community',   icon: '&#9678;' },
    { id: 'messages',    label: 'Messages',    href: '/messages',    icon: '&#9743;' },
    { id: 'rooms',       label: 'Live Rooms',  href: '/rooms',       icon: '&#9689;' },
    { id: 'my-articles', label: 'My Articles', href: '/my-articles', icon: '&#9634;' },
    { id: 'settings',    label: 'Settings',    href: '/settings',    icon: '&#9881;' },
  ];

  const isAdmin     = getIsAdmin(req);
  const toursSeen   = getToursSeen(req);
  const userId      = req.session ? req.session.userId : '';
  const dmUnread    = getDmUnreadCount(userId);
  const pendingInvites = isAdmin ? getPendingInviteCount() : 0;
  const memberLocked   = isMemberLocked(req);

  const navHTML = navItems.map(item => {
    const isMessages = item.id === 'messages';
    // Member-only lock (dark => never applies; nav is identical to today). A locked
    // item advertises the upgrade: it keeps its icon and label, gains a muted
    // "Member" badge, and points at /pricing?from=<feature> instead of the feature.
    const lockFrom = memberLocked ? MEMBER_LOCKED_NAV[item.id] : undefined;
    const isLocked = !!lockFrom;
    const href     = isLocked ? `/pricing?from=${lockFrom}` : item.href;
    const lockBadge = isLocked
      ? ` <span class="nav-member-badge" style="margin-left:6px;font-size:0.6rem;letter-spacing:0.06em;text-transform:uppercase;color:#A0845C;border:1px solid rgba(160,132,92,0.5);border-radius:3px;padding:1px 5px;vertical-align:middle;white-space:nowrap;">Member</span>`
      : '';
    const badgeHtml  = isMessages
      ? `<span id="dmBadge" class="sidebar-dm-badge" style="display:none;"></span>`
      : '';
    return `
        <a href="${href}" class="nav-item${item.id === activeSection ? ' active' : ''}${isLocked ? ' nav-item-locked' : ''}">
          <span class="nav-icon"${isMessages ? ' style="position:relative;"' : ''}>${item.icon}${badgeHtml}</span>
          <span class="nav-label">${item.label}${lockBadge}</span>
        </a>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — Iron &amp; Ink</title>
  <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/shepherd.css">
  <link rel="stylesheet" href="/css/styles.css?v=72">
  <link rel="icon" href="/favicon.ico" type="image/x-icon">
</head>
<body>
  <div class="app-container">
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-header">
        <div class="logo-area">
          <div class="logo-title">Iron &amp; Ink</div>
          <div class="logo-tagline">Iron sharpens iron</div>
          <div class="sidebar-rule"></div>
        </div>
        <button class="sidebar-toggle" id="sidebarToggle" title="Toggle sidebar">&#9776;</button>
      </div>
      <div class="sidebar-nav-wrap" id="sidebarNavWrap">
        <nav class="sidebar-nav" id="sidebarNav">
          ${navHTML}
        </nav>
      </div>
      <div class="sidebar-footer">
        ${isAdmin ? `<a href="/admin" class="nav-item admin-link${activeSection === 'admin' ? ' active' : ''}">
          <span class="nav-icon" style="position:relative;">&#9873;${pendingInvites > 0 ? `<span class="sidebar-dm-badge">${pendingInvites > 99 ? '99+' : pendingInvites}</span>` : ''}</span>
          <span class="nav-label">Admin</span>
        </a>` : ''}
        ${BILLING_ENABLED ? `<a href="/pricing" class="nav-item upgrade-link${activeSection === 'pricing' ? ' active' : ''}">
          <span class="nav-icon">&#9733;</span>
          <span class="nav-label">Upgrade</span>
        </a>` : ''}
        <a href="/what-we-believe" class="nav-item believe-link${activeSection === 'believe' ? ' active' : ''}">
          <span class="nav-icon">&#10013;</span>
          <span class="nav-label">About</span>
        </a>
        <a href="/copyright" class="nav-item copyright-link">
          <span class="nav-icon">&#169;</span>
          <span class="nav-label">Copyright</span>
        </a>
        <a href="/terms" class="nav-item terms-link">
          <span class="nav-icon">&#167;</span>
          <span class="nav-label">Terms</span>
        </a>
        <a href="/privacy" class="nav-item privacy-link">
          <span class="nav-icon">&#182;</span>
          <span class="nav-label">Privacy</span>
        </a>
        <a href="/cancellation-refund" class="nav-item refund-link">
          <span class="nav-icon">&#8634;</span>
          <span class="nav-label">Cancellation &amp; Refund</span>
        </a>
        <a href="/help" class="nav-item help-link${activeSection === 'help' ? ' active' : ''}">
          <span class="nav-icon">&#9432;</span>
          <span class="nav-label">Help</span>
        </a>
        <a href="/logout" class="logout-link">
          <span class="nav-icon">&#8617;</span>
          <span class="nav-label">Logout</span>
        </a>
      </div>
    </aside>
    <main class="main-content" id="mainContent">
      ${content}
    </main>
  </div>
  <script>
    window.__currentPage    = '${activeSection}';
    window.__toursSeen      = ${JSON.stringify(toursSeen)};
    window.__dmUnread       = ${dmUnread};
    window.__currentUserId  = ${JSON.stringify(userId || '')};
  </script>
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <script src="/js/modal.js?v=10"></script>
  <script src="/js/app.js?v=8"></script>
  <script src="/js/dictionary.js?v=10"></script>
  <script src="/socket.io/socket.io.js"></script>
  <script src="/js/dm-badge.js?v=3"></script>
  <script src="/js/dm-widget.js?v=2"></script>
  <script src="/js/notepad.js?v=6"></script>
  ${scripts}
  <script type="module" src="/js/tour-runner.js?v=4"></script>
  <script>
  (function () {
    function updateSidebarFade() {
      var nav  = document.getElementById('sidebarNav');
      var wrap = document.getElementById('sidebarNavWrap');
      if (!nav || !wrap) return;
      var overflows = nav.scrollHeight > nav.clientHeight;
      var atBottom  = nav.scrollTop + nav.clientHeight >= nav.scrollHeight - 1;
      wrap.classList.toggle('has-below', overflows && !atBottom);
    }
    document.addEventListener('DOMContentLoaded', function () {
      var nav = document.getElementById('sidebarNav');
      if (!nav) return;
      updateSidebarFade();
      nav.addEventListener('scroll', updateSidebarFade, { passive: true });
      window.addEventListener('resize', updateSidebarFade);
    });
  })();
  </script>
</body>
</html>`;
}

module.exports = { requireAuth, renderLayout, getIsAdmin };
