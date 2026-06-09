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
          <input class="form-input" type="password" id="currentPassword" autocomplete="current-password">
        </div>
        <div class="form-group">
          <label class="form-label">New Password</label>
          <input class="form-input" type="password" id="newPassword" minlength="8" autocomplete="new-password">
        </div>
        <div class="form-group">
          <label class="form-label">Confirm New Password</label>
          <input class="form-input" type="password" id="confirmPassword" autocomplete="new-password">
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
          <select class="form-select" id="bibleTranslation">
            <option value="LSB"${sel(s.bibleTranslation, 'LSB')}>LSB — Legacy Standard Bible</option>
            <option value="ESV"${sel(s.bibleTranslation, 'ESV')}>ESV — English Standard Version</option>
            <option value="NASB"${sel(s.bibleTranslation, 'NASB')}>NASB — New American Standard Bible</option>
            <option value="KJV"${sel(s.bibleTranslation, 'KJV')}>KJV — King James Version</option>
            <option value="NKJV"${sel(s.bibleTranslation, 'NKJV')}>NKJV — New King James Version</option>
            <option value="CSB"${sel(s.bibleTranslation, 'CSB')}>CSB — Christian Standard Bible</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Doctrinal Tradition</label>
          <select class="form-select" id="doctrinalTradition">
            <option value="Reformed/Calvinist"${sel(s.doctrinalTradition, 'Reformed/Calvinist')}>Reformed / Calvinist</option>
            <option value="Presbyterian"${sel(s.doctrinalTradition, 'Presbyterian')}>Presbyterian</option>
            <option value="Reformed Baptist"${sel(s.doctrinalTradition, 'Reformed Baptist')}>Reformed Baptist</option>
            <option value="Continental Reformed"${sel(s.doctrinalTradition, 'Continental Reformed')}>Continental Reformed</option>
            <option value="Other"${sel(s.doctrinalTradition, 'Other')}>Other</option>
          </select>
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
          <label class="form-label">Study Level</label>
          <select class="form-select" id="studyLevel">
            <option value="foundations"${sel(s.studyLevel || 'journeyman', 'foundations')}>Foundations — Beginner</option>
            <option value="journeyman"${sel(s.studyLevel || 'journeyman', 'journeyman')}>Journeyman — Intermediate</option>
            <option value="scholar"${sel(s.studyLevel || 'journeyman', 'scholar')}>Scholar — Advanced</option>
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
      el.style.color = isError ? '#e08080' : '#6abf69';
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
        doctrinalTradition: document.getElementById('doctrinalTradition').value,
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
  const { bibleTranslation, doctrinalTradition, defaultWritingTier, studyLevel } = req.body;

  const users = readUsers();
  const idx = users.findIndex(u => u.id === req.session.userId);
  if (idx === -1) return res.json({ success: false, error: 'User not found.' });

  users[idx].settings = { bibleTranslation, doctrinalTradition, defaultWritingTier, studyLevel };
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
