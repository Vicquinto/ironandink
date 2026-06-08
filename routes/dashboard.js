const express = require('express');
const fs      = require('fs');
const path    = require('path');
const { requireAuth, renderLayout, getIsAdmin } = require('./layout');

const router          = express.Router();
const STUDIES_PATH    = path.join(__dirname, '../data/studies.json');
const DIALOGUES_PATH  = path.join(__dirname, '../data/dialogues.json');
const ARTICLES_PATH   = path.join(__dirname, '../data/articles.json');

function getStudiesCount(userId) {
  try {
    if (!fs.existsSync(STUDIES_PATH)) return 0;
    const data = JSON.parse(fs.readFileSync(STUDIES_PATH, 'utf8'));
    return data.filter(s => s.userId === userId).length;
  } catch { return 0; }
}

function getDialoguesCount(userId) {
  try {
    if (!fs.existsSync(DIALOGUES_PATH)) return 0;
    const data = JSON.parse(fs.readFileSync(DIALOGUES_PATH, 'utf8'));
    return data.filter(d => d.userId === userId).length;
  } catch { return 0; }
}

function getArticlesCount(userId) {
  try {
    if (!fs.existsSync(ARTICLES_PATH)) return 0;
    const data = JSON.parse(fs.readFileSync(ARTICLES_PATH, 'utf8'));
    return data.filter(a => a.userId === userId && (a.status === 'Complete' || a.status === 'Published')).length;
  } catch { return 0; }
}

function getPendingCount() {
  try {
    if (!fs.existsSync(ARTICLES_PATH)) return 0;
    const data = JSON.parse(fs.readFileSync(ARTICLES_PATH, 'utf8'));
    return data.filter(a => a.status === 'Pending').length;
  } catch { return 0; }
}

router.get('/dashboard', requireAuth, (req, res) => {
  const user           = req.session.user;
  const firstName      = (user.fullName || 'Scholar').split(' ')[0];
  const studyCount     = getStudiesCount(req.session.userId);
  const dialogueCount  = getDialoguesCount(req.session.userId);
  const articlesCount  = getArticlesCount(req.session.userId);
  const isAdmin        = getIsAdmin(req);
  const pendingCount   = isAdmin ? getPendingCount() : 0;

  const content = `
    <div class="page-header">
      <h2 class="page-title" id="greeting">Good day, ${firstName}.</h2>
      <p class="page-subtitle">May your study be fruitful to the glory of God.</p>
    </div>

    <div class="verse-card">
      <div class="verse-label">Verse of the Day</div>
      <div class="verse-text">"Iron sharpens iron, and one man sharpens another."</div>
      <div class="verse-ref">Proverbs 27:17 — Legacy Standard Bible</div>
    </div>

    <div class="stat-cards">
      <div class="stat-card">
        <div class="stat-label">Studies Completed</div>
        <div class="stat-value">${studyCount}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Dialogue Sessions</div>
        <div class="stat-value">${dialogueCount}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Articles Written</div>
        <div class="stat-value">${articlesCount}</div>
      </div>
    </div>

    ${isAdmin && pendingCount > 0 ? `
    <a href="/admin" class="admin-pending-alert">
      &#9873; ${pendingCount} article${pendingCount !== 1 ? 's' : ''} awaiting your review &#8594;
    </a>` : ''}

    <a href="/study" class="btn-primary">Begin a Study</a>`;

  const scripts = `
  <script>
    (function() {
      const h = new Date().getHours();
      const greeting = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
      document.getElementById('greeting').textContent = greeting + ', ${firstName}.';
    })();
  </script>`;

  res.send(renderLayout({ req, activeSection: 'dashboard', title: 'Dashboard', content, scripts }));
});

module.exports = router;
