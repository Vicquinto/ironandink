const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');
const { randomUUID } = require('crypto');
const { requireAuth, renderLayout } = require('./layout');

const USERS_PATH_H   = path.join(__dirname, '../data/users.json');
const FEEDBACK_PATH  = path.join(__dirname, '../data/feedback.json');

function readJSON(p) {
  try {
    if (!fs.existsSync(p)) return [];
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch { return []; }
}

function writeJSON(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

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

        <hr class="copy-rule">

        <div class="copy-section-heading">Suggestions &amp; Feedback</div>
        <p class="copy-body" style="margin-bottom:16px;">Have an idea, a comment, or something that isn&#39;t working as you&#39;d expect? Send it our way &mdash; we read every note.</p>
        <textarea id="feedbackInput" class="chat-textarea" rows="5"
                  placeholder="Share a suggestion, comment, or piece of feedback&#8230;"></textarea>
        <div style="display:flex; align-items:center; gap:14px; margin-top:14px;">
          <button class="btn-primary" id="feedbackSubmitBtn" style="margin-bottom:0;">Submit</button>
          <span id="feedbackMsg" style="display:none; font-size:0.9rem; color:var(--warm-brown);"></span>
        </div>

        <div class="copy-back">
          <a href="/dashboard">&#8592; Back to Dashboard</a>
        </div>
      </div>
    </div>`;

  res.send(renderLayout({
    req,
    activeSection: 'help',
    title: 'Getting Started',
    content,
    scripts: `<script>
(function () {
  var input = document.getElementById('feedbackInput');
  var btn   = document.getElementById('feedbackSubmitBtn');
  var msg   = document.getElementById('feedbackMsg');
  if (!input || !btn) return;

  function showMsg(text, isError) {
    msg.textContent = text;
    msg.style.color = isError ? '#c06060' : 'var(--warm-brown)';
    msg.style.display = 'inline';
  }

  btn.addEventListener('click', async function () {
    var text = input.value.trim();
    if (!text) { showMsg('Please enter some feedback first.', true); input.focus(); return; }
    btn.disabled = true;
    msg.style.display = 'none';
    try {
      var r    = await fetch('/api/feedback', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ text: text }),
      });
      var data = await r.json();
      if (data.success) {
        input.value = '';
        showMsg('Thank you — your feedback has been sent.', false);
      } else {
        showMsg(data.error || 'Could not send feedback. Please try again.', true);
      }
    } catch (err) {
      showMsg('Error: ' + err.message, true);
    } finally {
      btn.disabled = false;
    }
  });
}());
</script>`,
  }));
});

const VALID_TOUR_PAGES = ['study','scripture','selah','rooms','library','dialogue','writing'];

router.post('/api/tour-seen', requireAuth, (req, res) => {
  const { page } = req.body;
  if (!page || !VALID_TOUR_PAGES.includes(page)) return res.json({ success: false });
  try {
    const users = JSON.parse(fs.readFileSync(USERS_PATH_H, 'utf8'));
    const idx   = users.findIndex(u => u.id === req.session.userId);
    if (idx !== -1) {
      if (!users[idx].toursSeen) users[idx].toursSeen = {};
      users[idx].toursSeen[page] = true;
      fs.writeFileSync(USERS_PATH_H, JSON.stringify(users, null, 2));
    }
    res.json({ success: true });
  } catch {
    res.json({ success: false });
  }
});

// ─── POST /api/feedback ───────────────────────────────────────────────────────
// Members submit suggestions/feedback from the Help page. The submitter's id and
// name come from the session — they never type their own name.
router.post('/api/feedback', requireAuth, (req, res) => {
  const text = (req.body && req.body.text ? String(req.body.text) : '').trim();
  if (!text) {
    return res.status(400).json({ success: false, error: 'Feedback cannot be empty.' });
  }

  const user = req.session.user || {};
  const feedback = readJSON(FEEDBACK_PATH);
  feedback.push({
    id:          randomUUID(),
    userId:      user.id || req.session.userId,
    fullName:    user.fullName || 'Unknown',
    text,
    submittedAt: new Date().toISOString(),
  });
  writeJSON(FEEDBACK_PATH, feedback);

  res.json({ success: true });
});

module.exports = router;
