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

function renderLayout({ req, activeSection, title, content, scripts = '' }) {
  const navItems = [
    { id: 'dashboard',   label: 'Dashboard',   href: '/dashboard',   icon: '&#9685;' },
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

  const isAdmin = getIsAdmin(req);

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
  <link rel="stylesheet" href="/css/styles.css?v=11">
</head>
<body>
  <div class="app-container">
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-header">
        <div class="logo-area">
          <div class="logo-title">Iron &amp; Ink</div>
          <div class="logo-tagline">Iron sharpens iron</div>
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
</body>
</html>`;
}

module.exports = { requireAuth, renderLayout, getIsAdmin };
