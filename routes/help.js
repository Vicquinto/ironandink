const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');
const { requireAuth, renderLayout } = require('./layout');

const USERS_PATH_H = path.join(__dirname, '../data/users.json');

router.get('/help', requireAuth, (req, res) => {
  const content = `
    <div class="help-wrap">
      <div class="copy-card">
        <div class="copy-site-name">Iron &amp; Ink</div>
        <h1 class="copy-page-title">Getting Started</h1>

        <div class="copy-section-heading">Welcome</div>
        <p class="copy-body">A quick orientation before you begin.</p>

        <hr class="copy-rule">

        <div class="copy-section-heading">Features</div>
        <ul class="welcome-feature-list" style="margin-top:16px;">
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

        <hr class="copy-rule">

        <div class="welcome-highlight-note">
          <strong>One feature works everywhere:</strong> Highlight any word or phrase of text on the page, and a small toolbar will appear &mdash; letting you define it, ask a question about it, or look up a related verse, right where you&#39;re reading.
        </div>

        <div class="copy-back">
          <a href="/dashboard">&#8592; Back to Dashboard</a>
        </div>
      </div>
    </div>`;

  res.send(renderLayout({ req, activeSection: 'help', title: 'Getting Started', content }));
});

router.post('/api/welcome-seen', requireAuth, (req, res) => {
  try {
    const users = JSON.parse(fs.readFileSync(USERS_PATH_H, 'utf8'));
    const idx   = users.findIndex(u => u.id === req.session.userId);
    if (idx !== -1) {
      users[idx].hasSeenWelcome = true;
      fs.writeFileSync(USERS_PATH_H, JSON.stringify(users, null, 2));
    }
    res.json({ success: true });
  } catch {
    res.json({ success: false });
  }
});

module.exports = router;
