const express = require('express');
const { requireAuth, renderLayout } = require('./layout');

const router = express.Router();

router.get('/dashboard', requireAuth, (req, res) => {
  const user = req.session.user;
  const firstName = (user.fullName || 'Scholar').split(' ')[0];
  const stats = user.stats || { studiesCompleted: 0, dialogueSessions: 0, articlesWritten: 0 };

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
        <div class="stat-value">${stats.studiesCompleted}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Dialogue Sessions</div>
        <div class="stat-value">${stats.dialogueSessions}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Articles Written</div>
        <div class="stat-value">${stats.articlesWritten}</div>
      </div>
    </div>

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
