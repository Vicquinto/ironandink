const fs   = require('fs');
const path = require('path');
const USERS_PATH_L = path.join(__dirname, '../data/users.json');

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect('/');
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

function getShouldShowWelcome(req) {
  if (!req.session.userId) return false;
  try {
    const users = JSON.parse(fs.readFileSync(USERS_PATH_L, 'utf8'));
    const user  = users.find(u => u.id === req.session.userId);
    return !!(user && user.hasSeenWelcome === false);
  } catch { return false; }
}

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
    { id: 'rooms',       label: 'Live Rooms',  href: '/rooms',       icon: '&#9689;' },
    { id: 'my-articles', label: 'My Articles', href: '/my-articles', icon: '&#9634;' },
    { id: 'settings',    label: 'Settings',    href: '/settings',    icon: '&#9881;' },
  ];

  const isAdmin       = getIsAdmin(req);
  const showWelcome   = getShouldShowWelcome(req);

  const navHTML = navItems.map(item => `
        <a href="${item.href}" class="nav-item${item.id === activeSection ? ' active' : ''}">
          <span class="nav-icon">${item.icon}</span>
          <span class="nav-label">${item.label}</span>
        </a>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — Iron &amp; Ink</title>
  <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/styles.css?v=14">
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
      <nav class="sidebar-nav">
        ${navHTML}
      </nav>
      <div class="sidebar-footer">
        ${isAdmin ? `<a href="/admin" class="nav-item admin-link${activeSection === 'admin' ? ' active' : ''}">
          <span class="nav-icon">&#9873;</span>
          <span class="nav-label">Admin</span>
        </a>` : ''}
        <a href="/copyright" class="nav-item copyright-link">
          <span class="nav-icon">&#169;</span>
          <span class="nav-label">Copyright</span>
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
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <script src="/js/modal.js?v=8"></script>
  <script src="/js/app.js?v=8"></script>
  <script src="/js/dictionary.js?v=8"></script>
  ${scripts}
  ${showWelcome ? `<div class="welcome-overlay" id="welcomeOverlay">
  <div class="welcome-modal">
    <div class="welcome-modal-eyebrow">Iron &amp; Ink</div>
    <h2 class="welcome-modal-title">Welcome</h2>
    <p class="welcome-modal-subtitle">A quick orientation before you begin.</p>
    <ul class="welcome-feature-list">
      <li class="welcome-feature-item">
        <span class="welcome-feature-name">Study</span>
        <span class="welcome-feature-desc">Generate a full Reformed study guide on any theological topic, passage, or question.</span>
      </li>
      <li class="welcome-feature-item">
        <span class="welcome-feature-name">Dialogue</span>
        <span class="welcome-feature-desc">Sharpen your understanding by defending the Reformed position against an AI trained to raise the strongest objections.</span>
      </li>
      <li class="welcome-feature-item">
        <span class="welcome-feature-name">Writing</span>
        <span class="welcome-feature-desc">Compose articles, sermons, or letters in your own voice, scaffolded by guiding questions.</span>
      </li>
      <li class="welcome-feature-item">
        <span class="welcome-feature-name">Library</span>
        <span class="welcome-feature-desc">Everything you save lives here: studies, tagged and searchable, ready to revisit.</span>
      </li>
      <li class="welcome-feature-item">
        <span class="welcome-feature-name">Scripture</span>
        <span class="welcome-feature-desc">Read the Bible directly, track your reading, and look up any verse.</span>
      </li>
      <li class="welcome-feature-item">
        <span class="welcome-feature-name">Selah</span>
        <span class="welcome-feature-desc">Your private journal for prayer and reflection before the Lord.</span>
      </li>
      <li class="welcome-feature-item">
        <span class="welcome-feature-name">Live Rooms</span>
        <span class="welcome-feature-desc">Study together with others in real time, host or join a room, and discuss as you go.</span>
      </li>
    </ul>
    <div class="welcome-highlight-note">
      <strong>One feature works everywhere:</strong> Highlight any word or phrase of text on the page, and a small toolbar will appear &mdash; letting you define it, ask a question about it, or look up a related verse, right where you&#39;re reading.
    </div>
    <button class="welcome-dismiss-btn" id="welcomeDismiss">Got it &mdash; let&#39;s begin</button>
  </div>
</div>
<script>(function(){var b=document.getElementById('welcomeDismiss');if(b)b.addEventListener('click',function(){fetch('/api/welcome-seen',{method:'POST'});document.getElementById('welcomeOverlay').style.display='none';});})();</script>` : ''}

</body>
</html>`;
}

module.exports = { requireAuth, renderLayout, getIsAdmin };
