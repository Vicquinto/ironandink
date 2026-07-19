const express = require('express');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');
const { requireAuth, renderLayout } = require('./layout');

const router = express.Router();
const USERS_PATH = path.join(__dirname, '../data/users.json');

function readUsers() { return JSON.parse(fs.readFileSync(USERS_PATH, 'utf8')); }
function writeUsers(u) { fs.writeFileSync(USERS_PATH, JSON.stringify(u, null, 2)); }

function sel(current, value) {
  return current === value ? ' selected' : '';
}

router.get('/settings', requireAuth, (req, res) => {
  const user = req.session.user;
  const s = user.settings || {};

  const content = `
    <div class="page-header">
      <h2 class="page-title">Settings</h2>
      <p class="page-subtitle">Manage your profile and preferences.</p>
    </div>

    <div class="settings-section">
      <div class="settings-section-title">Profile</div>
      <form id="profileForm">
        <div class="form-group">
          <label class="form-label">Full Name</label>
          <input class="form-input" type="text" id="fullName" value="${escapeHtml(user.fullName || '')}" required>
        </div>
        <div class="form-group">
          <label class="form-label">Email</label>
          <input class="form-input" type="email" id="email" value="${escapeHtml(user.email || '')}" required>
        </div>
        <div class="settings-save-row">
          <button class="btn-primary" type="submit">Save Profile</button>
          <span class="save-message" id="profileMsg">Saved.</span>
        </div>
      </form>
    </div>

    <div class="settings-section">
      <div class="settings-section-title">Change Password</div>
      <form id="passwordForm">
        <div class="form-group">
          <label class="form-label">Current Password</label>
          <div style="position:relative;">
            <input class="form-input" type="password" id="currentPassword" autocomplete="current-password">
            <button type="button" tabindex="-1" onclick="var i=this.previousElementSibling;i.type=i.type==='password'?'text':'password';" style="background:none;border:none;cursor:pointer;position:absolute;right:0.75rem;top:50%;transform:translateY(-50%);font-size:1.1rem;color:#6B4226;line-height:1;">&#128065;</button>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">New Password</label>
          <div style="position:relative;">
            <input class="form-input" type="password" id="newPassword" minlength="8" autocomplete="new-password">
            <button type="button" tabindex="-1" onclick="var i=this.previousElementSibling;i.type=i.type==='password'?'text':'password';" style="background:none;border:none;cursor:pointer;position:absolute;right:0.75rem;top:50%;transform:translateY(-50%);font-size:1.1rem;color:#6B4226;line-height:1;">&#128065;</button>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Confirm New Password</label>
          <div style="position:relative;">
            <input class="form-input" type="password" id="confirmPassword" autocomplete="new-password">
            <button type="button" tabindex="-1" onclick="var i=this.previousElementSibling;i.type=i.type==='password'?'text':'password';" style="background:none;border:none;cursor:pointer;position:absolute;right:0.75rem;top:50%;transform:translateY(-50%);font-size:1.1rem;color:#6B4226;line-height:1;">&#128065;</button>
          </div>
        </div>
        <div class="settings-save-row">
          <button class="btn-primary" type="submit">Change Password</button>
          <span class="save-message" id="passwordMsg">Password updated.</span>
        </div>
      </form>
    </div>

    <div class="settings-section">
      <div class="settings-section-title">Study Preferences</div>
      <form id="prefsForm">
        <div class="form-group">
          <label class="form-label">Preferred Bible Translation</label>
          <select class="form-select" id="bibleTranslation" disabled>
            <option value="ASV" selected>ASV — American Standard Version (1901)</option>
          </select>
          <p class="form-hint" style="margin-top:0.4rem;font-size:0.85rem;color:var(--text-muted);">Study Scripture is served as the verified public-domain ASV, inserted by the system.</p>
        </div>
        <div class="form-group">
          <label class="form-label">Default Writing Tier</label>
          <select class="form-select" id="defaultWritingTier">
            <option value="tier1"${sel(s.defaultWritingTier, 'tier1')}>Tier 1 — Full Scaffold</option>
            <option value="tier2"${sel(s.defaultWritingTier, 'tier2')}>Tier 2 — Guided Draft</option>
            <option value="tier3"${sel(s.defaultWritingTier, 'tier3')}>Tier 3 — Full Ghostwrite</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Writing Register</label>
          <select class="form-select" id="studyLevel">
            <option value="foundations"${sel(s.studyLevel || 'journeyman', 'foundations')}>Apprentice</option>
            <option value="journeyman"${sel(s.studyLevel || 'journeyman', 'journeyman')}>Journeyman</option>
            <option value="scholar"${sel(s.studyLevel || 'journeyman', 'scholar')}>Scholar</option>
          </select>
        </div>
        <div class="settings-save-row">
          <button class="btn-primary" type="submit">Save Preferences</button>
          <span class="save-message" id="prefsMsg">Saved.</span>
        </div>
      </form>
    </div>`;

  const scripts = `
  <script>
    async function postJSON(url, body) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      return res.json();
    }

    function flash(id, isError, msg) {
      const el = document.getElementById(id);
      el.textContent = msg || el.textContent;
      el.style.color = isError ? '#5a0a0a' : '#2D5A3E';
      el.classList.add('visible');
      setTimeout(() => el.classList.remove('visible'), 3000);
    }

    document.getElementById('profileForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = await postJSON('/api/settings/profile', {
        fullName: document.getElementById('fullName').value,
        email: document.getElementById('email').value,
      });
      flash('profileMsg', !data.success, data.error || 'Saved.');
    });

    document.getElementById('passwordForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const newPass = document.getElementById('newPassword').value;
      const confirm = document.getElementById('confirmPassword').value;
      if (newPass !== confirm) return flash('passwordMsg', true, 'Passwords do not match.');
      const data = await postJSON('/api/settings/password', {
        currentPassword: document.getElementById('currentPassword').value,
        newPassword: newPass,
      });
      flash('passwordMsg', !data.success, data.error || 'Password updated.');
      if (data.success) document.getElementById('passwordForm').reset();
    });

    document.getElementById('prefsForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = await postJSON('/api/settings/preferences', {
        bibleTranslation:   document.getElementById('bibleTranslation').value,
        defaultWritingTier: document.getElementById('defaultWritingTier').value,
        studyLevel:         document.getElementById('studyLevel').value,
      });
      flash('prefsMsg', !data.success, data.error || 'Saved.');
    });
  </script>`;

  res.send(renderLayout({ req, activeSection: 'settings', title: 'Settings', content, scripts }));
});

// POST /api/settings/profile
router.post('/api/settings/profile', requireAuth, (req, res) => {
  const { fullName, email } = req.body;
  if (!fullName || !email) return res.json({ success: false, error: 'Name and email are required.' });

  const users = readUsers();
  const idx = users.findIndex(u => u.id === req.session.userId);
  if (idx === -1) return res.json({ success: false, error: 'User not found.' });

  users[idx].fullName = fullName.trim();
  users[idx].email = email.trim().toLowerCase();
  writeUsers(users);

  req.session.user.fullName = users[idx].fullName;
  req.session.user.email = users[idx].email;
  res.json({ success: true });
});

// POST /api/settings/password
router.post('/api/settings/password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.json({ success: false, error: 'All password fields are required.' });
  }
  if (newPassword.length < 8) {
    return res.json({ success: false, error: 'New password must be at least 8 characters.' });
  }

  const users = readUsers();
  const idx = users.findIndex(u => u.id === req.session.userId);
  if (idx === -1) return res.json({ success: false, error: 'User not found.' });

  const match = await bcrypt.compare(currentPassword, users[idx].passwordHash);
  if (!match) return res.json({ success: false, error: 'Current password is incorrect.' });

  users[idx].passwordHash = await bcrypt.hash(newPassword, 10);
  writeUsers(users);
  res.json({ success: true });
});

// POST /api/settings/preferences
router.post('/api/settings/preferences', requireAuth, (req, res) => {
  const { bibleTranslation, defaultWritingTier, studyLevel } = req.body;

  const users = readUsers();
  const idx = users.findIndex(u => u.id === req.session.userId);
  if (idx === -1) return res.json({ success: false, error: 'User not found.' });

  users[idx].settings = Object.assign({}, users[idx].settings, { bibleTranslation, defaultWritingTier, studyLevel });
  writeUsers(users);

  req.session.user.settings = users[idx].settings;
  res.json({ success: true });
});

// POST /api/settings/study-level — lightweight single-field save used by the study-page selector
router.post('/api/settings/study-level', requireAuth, (req, res) => {
  const { studyLevel } = req.body;
  if (!['foundations', 'journeyman', 'scholar'].includes(studyLevel)) {
    return res.status(400).json({ success: false, error: 'Invalid level.' });
  }
  const users = readUsers();
  const idx   = users.findIndex(u => u.id === req.session.userId);
  if (idx === -1) return res.json({ success: false, error: 'User not found.' });
  users[idx].settings = Object.assign({}, users[idx].settings, { studyLevel });
  writeUsers(users);
  req.session.user.settings = users[idx].settings;
  res.json({ success: true });
});

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = router;
