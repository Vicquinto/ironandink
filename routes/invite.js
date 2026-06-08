const express  = require('express');
const bcrypt   = require('bcrypt');
const fs       = require('fs');
const path     = require('path');
const { randomUUID } = require('crypto');

const router = express.Router();

const USERS_PATH           = path.join(__dirname, '../data/users.json');
const INVITES_PATH         = path.join(__dirname, '../data/invites.json');
const INVITE_REQUESTS_PATH = path.join(__dirname, '../data/invite_requests.json');

function readJSON(p) {
  try {
    if (!fs.existsSync(p)) return [];
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch { return []; }
}

function writeJSON(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

function publicStyles() {
  return `
    <link rel="stylesheet" href="/css/styles.css">
    <style>
      body { display:flex; align-items:center; justify-content:center; min-height:100vh; }
      .pub-container { width:100%; max-width:480px; padding:24px; }
      .pub-header { text-align:center; margin-bottom:32px; }
      .pub-title { font-size:2.2rem; color:var(--accent); font-weight:400; letter-spacing:0.06em; }
      .pub-subtitle { font-size:0.88rem; color:var(--warm-brown); font-style:italic; margin-top:8px; }
      .pub-card {
        background:var(--card-bg); border:1px solid rgba(179,140,51,0.25);
        border-radius:8px; padding:32px;
      }
      .form-group { margin-bottom:18px; }
      .form-label {
        display:block; font-size:0.75rem; color:var(--dark-cream);
        margin-bottom:6px; letter-spacing:0.07em; text-transform:uppercase;
      }
      .form-input, .form-textarea, .form-select {
        width:100%; background:var(--bg);
        border:1px solid rgba(179,140,51,0.3);
        color:var(--text); padding:11px 13px;
        font-size:0.95rem; font-family:'EB Garamond',Georgia,serif;
        border-radius:4px; outline:none; transition:border-color 0.15s;
      }
      .form-input:focus, .form-textarea:focus, .form-select:focus { border-color:var(--accent); }
      .form-input[readonly] { opacity:0.6; cursor:not-allowed; }
      .form-textarea { resize:vertical; min-height:90px; }
      .form-select option { background:#1A0F0A; }
      .btn-pub {
        width:100%; background:var(--accent); color:#1A0F0A;
        border:none; padding:13px; font-size:1rem;
        font-family:'EB Garamond',Georgia,serif; font-weight:600;
        border-radius:4px; cursor:pointer; letter-spacing:0.04em;
        margin-top:4px; transition:background 0.15s;
      }
      .btn-pub:hover { background:#c9a040; }
      .error-msg {
        background:rgba(180,60,60,0.15); border:1px solid rgba(180,60,60,0.4);
        color:#e08080; padding:10px 14px; border-radius:4px;
        font-size:0.85rem; margin-bottom:16px; display:none;
      }
      .error-msg.visible { display:block; }
      .success-box {
        background:rgba(80,140,80,0.1); border:1px solid rgba(80,140,80,0.3);
        color:#a0d0a0; padding:20px 24px; border-radius:8px;
        font-size:1rem; line-height:1.7; text-align:center;
      }
      .pub-footer { text-align:center; font-size:0.75rem; color:var(--warm-brown); margin-top:20px; }
      .pub-footer a { color:var(--warm-brown); text-decoration:none; }
    </style>`;
}

// ─── GET /invite-request ──────────────────────────────────────────────────────
router.get('/invite-request', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Iron &amp; Ink — Request an Invitation</title>
  ${publicStyles()}
</head>
<body>
  <div class="pub-container">
    <div class="pub-header">
      <h1 class="pub-title">Iron &amp; Ink</h1>
      <p class="pub-subtitle">Request an Invitation</p>
    </div>
    <div class="pub-card">
      <div class="error-msg" id="errMsg"></div>
      <div id="successBox" style="display:none;" class="success-box">
        Your request has been received. The administrator will review it and send you an invitation if approved.
      </div>
      <form id="inviteForm">
        <div class="form-group">
          <label class="form-label">Full Name</label>
          <input class="form-input" type="text" id="name" required placeholder="Your full name">
        </div>
        <div class="form-group">
          <label class="form-label">Email Address</label>
          <input class="form-input" type="email" id="email" required placeholder="your@email.com">
        </div>
        <div class="form-group">
          <label class="form-label">Why do you want to join Iron &amp; Ink?</label>
          <textarea class="form-textarea" id="reason" required
            placeholder="Tell us briefly about your theological background and what you hope to gain&#8230;"></textarea>
        </div>
        <button class="btn-pub" type="submit">Submit Request</button>
      </form>
    </div>
    <p class="pub-footer"><a href="/">&#8592; Back to home</a></p>
  </div>
  <script>
    document.getElementById('inviteForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      var errEl = document.getElementById('errMsg');
      errEl.classList.remove('visible');
      var btn = e.target.querySelector('button');
      btn.disabled = true;
      try {
        var res  = await fetch('/api/invite-request', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            name:   document.getElementById('name').value.trim(),
            email:  document.getElementById('email').value.trim(),
            reason: document.getElementById('reason').value.trim(),
          }),
        });
        var data = await res.json();
        if (data.success) {
          document.getElementById('inviteForm').style.display = 'none';
          document.getElementById('successBox').style.display = 'block';
        } else {
          errEl.textContent = data.error || 'Submission failed.';
          errEl.classList.add('visible');
          btn.disabled = false;
        }
      } catch (err) {
        errEl.textContent = 'Error: ' + err.message;
        errEl.classList.add('visible');
        btn.disabled = false;
      }
    });
  </script>
</body>
</html>`);
});

// ─── POST /api/invite-request ─────────────────────────────────────────────────
router.post('/api/invite-request', (req, res) => {
  const { name, email, reason } = req.body;
  if (!name || !email || !reason) {
    return res.status(400).json({ success: false, error: 'All fields are required.' });
  }
  const requests = readJSON(INVITE_REQUESTS_PATH);
  const existing = requests.find(r => r.email.toLowerCase() === email.toLowerCase() && r.status === 'pending');
  if (existing) {
    return res.json({ success: false, error: 'A request from this email is already pending.' });
  }
  const record = {
    id:          randomUUID(),
    name:        name.trim(),
    email:       email.trim().toLowerCase(),
    reason:      reason.trim(),
    status:      'pending',
    submittedAt: new Date().toISOString(),
  };
  requests.push(record);
  writeJSON(INVITE_REQUESTS_PATH, requests);
  res.json({ success: true });
});

// ─── GET /register?token=xxx ──────────────────────────────────────────────────
router.get('/register', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');

  const { token } = req.query;
  const invites   = readJSON(INVITES_PATH);
  const invite    = invites.find(i => i.token === token);

  if (!invite || invite.used || new Date(invite.expiresAt) < new Date()) {
    return res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Iron &amp; Ink — Invalid Invitation</title>
  ${publicStyles()}
</head>
<body>
  <div class="pub-container">
    <div class="pub-header">
      <h1 class="pub-title">Iron &amp; Ink</h1>
    </div>
    <div class="pub-card">
      <p style="color:var(--dark-cream); line-height:1.7; text-align:center;">
        This invitation link is invalid or has expired.<br>
        Please <a href="/invite-request" style="color:var(--accent);">request a new invitation</a>.
      </p>
    </div>
    <p class="pub-footer"><a href="/">&#8592; Back to home</a></p>
  </div>
</body>
</html>`);
  }

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Iron &amp; Ink — Create Your Account</title>
  ${publicStyles()}
</head>
<body>
  <div class="pub-container">
    <div class="pub-header">
      <h1 class="pub-title">Iron &amp; Ink</h1>
      <p class="pub-subtitle">Create your account</p>
    </div>
    <div class="pub-card">
      <div class="error-msg" id="errMsg"></div>
      <form id="registerForm">
        <input type="hidden" id="token" value="${escHtml(token)}">
        <div class="form-group">
          <label class="form-label">Full Name</label>
          <input class="form-input" type="text" id="fullName" required value="${escHtml(invite.name)}">
        </div>
        <div class="form-group">
          <label class="form-label">Email Address</label>
          <input class="form-input" type="email" id="email" readonly value="${escHtml(invite.email)}">
        </div>
        <div class="form-group">
          <label class="form-label">Password <span style="font-size:0.7rem; color:var(--warm-brown);">(min 8 characters)</span></label>
          <input class="form-input" type="password" id="password" required minlength="8" placeholder="Choose a strong password">
        </div>
        <div class="form-group">
          <label class="form-label">Confirm Password</label>
          <input class="form-input" type="password" id="confirm" required placeholder="Repeat your password">
        </div>
        <div class="form-group">
          <label class="form-label">Preferred Bible Translation</label>
          <select class="form-select" id="translation">
            <option value="LSB" selected>Legacy Standard Bible (LSB)</option>
            <option value="ESV">English Standard Version (ESV)</option>
            <option value="NASB">New American Standard Bible (NASB)</option>
            <option value="KJV">King James Version (KJV)</option>
            <option value="NKJV">New King James Version (NKJV)</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Doctrinal Tradition</label>
          <select class="form-select" id="tradition">
            <option value="Reformed/Calvinist" selected>Reformed / Calvinist</option>
            <option value="Presbyterian">Presbyterian</option>
            <option value="Reformed Baptist">Reformed Baptist</option>
            <option value="Anglican">Anglican</option>
            <option value="Lutheran">Lutheran</option>
            <option value="Other Protestant">Other Protestant</option>
          </select>
        </div>
        <button class="btn-pub" type="submit">Create My Account</button>
      </form>
    </div>
    <p class="pub-footer"><a href="/">&#8592; Back to home</a></p>
  </div>
  <script>
    document.getElementById('registerForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      var errEl = document.getElementById('errMsg');
      errEl.classList.remove('visible');
      var btn = e.target.querySelector('button');
      btn.disabled = true;
      btn.textContent = 'Creating account…';
      try {
        var res  = await fetch('/api/register', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            token:       document.getElementById('token').value,
            fullName:    document.getElementById('fullName').value.trim(),
            password:    document.getElementById('password').value,
            confirm:     document.getElementById('confirm').value,
            translation: document.getElementById('translation').value,
            tradition:   document.getElementById('tradition').value,
          }),
        });
        var data = await res.json();
        if (data.success) {
          window.location.href = data.redirect;
        } else {
          errEl.textContent = data.error || 'Registration failed.';
          errEl.classList.add('visible');
          btn.disabled = false;
          btn.textContent = 'Create My Account';
        }
      } catch (err) {
        errEl.textContent = 'Error: ' + err.message;
        errEl.classList.add('visible');
        btn.disabled = false;
        btn.textContent = 'Create My Account';
      }
    });
  </script>
</body>
</html>`);
});

// ─── POST /api/register ───────────────────────────────────────────────────────
router.post('/api/register', async (req, res) => {
  const { token, fullName, password, confirm, translation, tradition } = req.body;

  if (!token || !fullName || !password || !confirm) {
    return res.status(400).json({ success: false, error: 'All fields are required.' });
  }
  if (password.length < 8) {
    return res.json({ success: false, error: 'Password must be at least 8 characters.' });
  }
  if (password !== confirm) {
    return res.json({ success: false, error: 'Passwords do not match.' });
  }

  const invites = readJSON(INVITES_PATH);
  const idx     = invites.findIndex(i => i.token === token);
  const invite  = invites[idx];

  if (!invite || invite.used || new Date(invite.expiresAt) < new Date()) {
    return res.json({ success: false, error: 'This invitation link is invalid or has expired.' });
  }

  const users    = readJSON(USERS_PATH);
  const existing = users.find(u => u.email.toLowerCase() === invite.email.toLowerCase());
  if (existing) {
    return res.json({ success: false, error: 'An account with this email already exists.' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const now          = new Date().toISOString();
  const user = {
    id:           randomUUID(),
    email:        invite.email.toLowerCase(),
    fullName:     fullName.trim(),
    passwordHash,
    isAdmin:      false,
    role:         'user',
    needsSetup:   false,
    settings: {
      translation: translation || 'LSB',
      tradition:   tradition   || 'Reformed/Calvinist',
    },
    stats:     {},
    createdAt: now,
    updatedAt: now,
  };

  users.push(user);
  writeJSON(USERS_PATH, users);

  invites[idx].used   = true;
  invites[idx].usedAt = now;
  writeJSON(INVITES_PATH, invites);

  req.session.userId     = user.id;
  req.session.firstLogin = true;
  req.session.user = {
    id:       user.id,
    email:    user.email,
    fullName: user.fullName,
    settings: user.settings,
    stats:    user.stats,
    isAdmin:  false,
  };

  res.json({ success: true, redirect: '/dashboard' });
});

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = router;
