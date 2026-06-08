const express  = require('express');
const bcrypt   = require('bcrypt');
const fs       = require('fs');
const path     = require('path');
const { randomUUID } = require('crypto');

const router = express.Router();

const USERS_PATH   = path.join(__dirname, '../data/users.json');
const RESETS_PATH  = path.join(__dirname, '../data/password_resets.json');

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
      .form-input {
        width:100%; background:var(--bg);
        border:1px solid rgba(179,140,51,0.3);
        color:var(--text); padding:11px 13px;
        font-size:0.95rem; font-family:'EB Garamond',Georgia,serif;
        border-radius:4px; outline:none; transition:border-color 0.15s;
      }
      .form-input:focus { border-color:var(--accent); }
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
      .info-box {
        background:rgba(179,140,51,0.1); border:1px solid rgba(179,140,51,0.3);
        color:var(--dark-cream); padding:16px 18px; border-radius:6px;
        font-size:0.9rem; line-height:1.7; word-break:break-all;
      }
      .reset-link { color:var(--accent); font-family:'Courier New',monospace; font-size:0.82rem; }
      .pub-footer { text-align:center; font-size:0.75rem; color:var(--warm-brown); margin-top:20px; }
      .pub-footer a { color:var(--warm-brown); text-decoration:none; }
    </style>`;
}

// ─── GET /forgot-password ─────────────────────────────────────────────────────
router.get('/forgot-password', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Iron &amp; Ink — Forgot Password</title>
  ${publicStyles()}
</head>
<body>
  <div class="pub-container">
    <div class="pub-header">
      <h1 class="pub-title">Iron &amp; Ink</h1>
      <p class="pub-subtitle">Reset your password</p>
    </div>
    <div class="pub-card">
      <div class="error-msg" id="errMsg"></div>
      <div id="resultBox" style="display:none;" class="info-box"></div>
      <form id="forgotForm">
        <div class="form-group">
          <label class="form-label">Email Address</label>
          <input class="form-input" type="email" id="email" required placeholder="your@email.com">
        </div>
        <button class="btn-pub" type="submit">Send Reset Link</button>
      </form>
    </div>
    <p class="pub-footer"><a href="/login">&#8592; Back to sign in</a></p>
  </div>
  <script>
    document.getElementById('forgotForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      var errEl = document.getElementById('errMsg');
      errEl.classList.remove('visible');
      var btn = e.target.querySelector('button');
      btn.disabled = true;
      try {
        var res  = await fetch('/api/forgot-password', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ email: document.getElementById('email').value.trim() }),
        });
        var data = await res.json();
        if (data.success) {
          document.getElementById('forgotForm').style.display = 'none';
          var box = document.getElementById('resultBox');
          box.innerHTML = '<p style="margin-bottom:12px; color:var(--dark-cream);">Your password reset link:</p>' +
            '<p class="reset-link">' + data.resetUrl + '</p>' +
            '<p style="margin-top:12px; font-size:0.8rem; color:var(--warm-brown);">Copy this link and open it in your browser. It expires in 1 hour.</p>' +
            '<p style="margin-top:8px; font-size:0.78rem; color:var(--warm-brown); font-style:italic;">Note: when deployed, this link will be sent via email instead.</p>';
          box.style.display = 'block';
        } else {
          errEl.textContent = data.error || 'Failed to generate reset link.';
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

// ─── POST /api/forgot-password ────────────────────────────────────────────────
router.post('/api/forgot-password', (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ success: false, error: 'Email is required.' });

  const users = readJSON(USERS_PATH);
  const user  = users.find(u => u.email.toLowerCase() === email.toLowerCase());

  if (!user) {
    return res.json({ success: false, error: 'No account found with that email address.' });
  }

  const token     = randomUUID();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  const resets = readJSON(RESETS_PATH).filter(r => r.userId !== user.id);
  resets.push({ id: randomUUID(), token, userId: user.id, email: user.email, expiresAt });
  writeJSON(RESETS_PATH, resets);

  const host     = req.get('host') || 'localhost:4000';
  const protocol = req.secure ? 'https' : 'http';
  const resetUrl = `${protocol}://${host}/reset-password?token=${token}`;

  res.json({ success: true, resetUrl });
});

// ─── GET /reset-password?token=xxx ───────────────────────────────────────────
router.get('/reset-password', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');

  const { token } = req.query;
  const resets    = readJSON(RESETS_PATH);
  const record    = resets.find(r => r.token === token);

  if (!record || new Date(record.expiresAt) < new Date()) {
    return res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Iron &amp; Ink — Invalid Reset Link</title>
  ${publicStyles()}
</head>
<body>
  <div class="pub-container">
    <div class="pub-header"><h1 class="pub-title">Iron &amp; Ink</h1></div>
    <div class="pub-card">
      <p style="color:var(--dark-cream); line-height:1.7; text-align:center;">
        This password reset link is invalid or has expired.<br>
        Please <a href="/forgot-password" style="color:var(--accent);">request a new one</a>.
      </p>
    </div>
    <p class="pub-footer"><a href="/login">&#8592; Back to sign in</a></p>
  </div>
</body>
</html>`);
  }

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Iron &amp; Ink — Reset Password</title>
  ${publicStyles()}
</head>
<body>
  <div class="pub-container">
    <div class="pub-header">
      <h1 class="pub-title">Iron &amp; Ink</h1>
      <p class="pub-subtitle">Choose a new password</p>
    </div>
    <div class="pub-card">
      <div class="error-msg" id="errMsg"></div>
      <form id="resetForm">
        <input type="hidden" id="token" value="${escHtml(token)}">
        <div class="form-group">
          <label class="form-label">New Password <span style="font-size:0.7rem; color:var(--warm-brown);">(min 8 characters)</span></label>
          <input class="form-input" type="password" id="password" required minlength="8" placeholder="New password">
        </div>
        <div class="form-group">
          <label class="form-label">Confirm New Password</label>
          <input class="form-input" type="password" id="confirm" required placeholder="Repeat new password">
        </div>
        <button class="btn-pub" type="submit">Update Password</button>
      </form>
    </div>
    <p class="pub-footer"><a href="/login">&#8592; Back to sign in</a></p>
  </div>
  <script>
    document.getElementById('resetForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      var errEl = document.getElementById('errMsg');
      errEl.classList.remove('visible');
      var btn = e.target.querySelector('button');
      btn.disabled = true;
      try {
        var res  = await fetch('/api/reset-password', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            token:    document.getElementById('token').value,
            password: document.getElementById('password').value,
            confirm:  document.getElementById('confirm').value,
          }),
        });
        var data = await res.json();
        if (data.success) {
          window.location.href = data.redirect;
        } else {
          errEl.textContent = data.error || 'Reset failed.';
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

// ─── POST /api/reset-password ─────────────────────────────────────────────────
router.post('/api/reset-password', async (req, res) => {
  const { token, password, confirm } = req.body;

  if (!token || !password || !confirm) {
    return res.status(400).json({ success: false, error: 'All fields are required.' });
  }
  if (password.length < 8) {
    return res.json({ success: false, error: 'Password must be at least 8 characters.' });
  }
  if (password !== confirm) {
    return res.json({ success: false, error: 'Passwords do not match.' });
  }

  const resets = readJSON(RESETS_PATH);
  const idx    = resets.findIndex(r => r.token === token);
  const record = resets[idx];

  if (!record || new Date(record.expiresAt) < new Date()) {
    return res.json({ success: false, error: 'This reset link is invalid or has expired.' });
  }

  const users   = readJSON(USERS_PATH);
  const userIdx = users.findIndex(u => u.id === record.userId);
  if (userIdx === -1) return res.json({ success: false, error: 'User not found.' });

  users[userIdx].passwordHash = await bcrypt.hash(password, 10);
  users[userIdx].updatedAt    = new Date().toISOString();
  writeJSON(USERS_PATH, users);

  resets.splice(idx, 1);
  writeJSON(RESETS_PATH, resets);

  res.json({ success: true, redirect: '/login?reset=1' });
});

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = router;
