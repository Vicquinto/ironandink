const express = require('express');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');

const router = express.Router();
const USERS_PATH = path.join(__dirname, '../data/users.json');

function readUsers() {
  return JSON.parse(fs.readFileSync(USERS_PATH, 'utf8'));
}

function writeUsers(users) {
  fs.writeFileSync(USERS_PATH, JSON.stringify(users, null, 2));
}

// GET /login — login page (redirect to dashboard if already logged in)
router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  const notice = req.query.reset === '1' ? 'Password updated. Please sign in.' : null;
  res.send(renderLoginPage({ error: null, notice }));
});

// POST /api/login
router.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.json({ success: false, error: 'Email and password are required.' });
  }

  const users = readUsers();
  const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());

  if (!user) {
    return res.json({ success: false, error: 'Invalid email or password.' });
  }

  if (user.needsSetup) {
    req.session.setupEmail = user.email;
    return res.json({ success: false, redirect: '/setup-password' });
  }

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) {
    return res.json({ success: false, error: 'Invalid email or password.' });
  }

  req.session.userId = user.id;
  req.session.user = {
    id:       user.id,
    email:    user.email,
    fullName: user.fullName,
    settings: user.settings,
    stats:    user.stats,
    isAdmin:  user.role === 'admin' || user.isAdmin === true,
  };

  return res.json({ success: true, redirect: '/dashboard' });
});

// GET /setup-password — first-run password setup
router.get('/setup-password', (req, res) => {
  if (!req.session.setupEmail) return res.redirect('/');
  res.send(renderSetupPage({ error: null }));
});

// POST /api/setup-password
router.post('/api/setup-password', async (req, res) => {
  const { password, confirm } = req.body;
  const email = req.session.setupEmail;

  if (!email) return res.json({ success: false, error: 'Session expired. Please start over.' });
  if (!password || password.length < 8) {
    return res.json({ success: false, error: 'Password must be at least 8 characters.' });
  }
  if (password !== confirm) {
    return res.json({ success: false, error: 'Passwords do not match.' });
  }

  const users = readUsers();
  const idx = users.findIndex(u => u.email === email);
  if (idx === -1) return res.json({ success: false, error: 'User not found.' });

  users[idx].passwordHash = await bcrypt.hash(password, 10);
  users[idx].needsSetup = false;
  writeUsers(users);

  delete req.session.setupEmail;
  req.session.userId = users[idx].id;
  req.session.user = {
    id:       users[idx].id,
    email:    users[idx].email,
    fullName: users[idx].fullName,
    settings: users[idx].settings,
    stats:    users[idx].stats,
    isAdmin:  users[idx].role === 'admin' || users[idx].isAdmin === true,
  };

  return res.json({ success: true, redirect: '/dashboard' });
});

// GET /logout
router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// ─── HTML Renderers ────────────────────────────────────────────────────────

function loginStyles() {
  return `
    <style>
      :root {
        --bg: #1A0F0A; --accent: #B38C33; --text: #F7F0E0;
        --dark-cream: #EBD9C6; --warm-brown: #7A5C3B;
        --card-bg: #2A1A0F; --ink: #141009;
      }
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        background: var(--bg); color: var(--text);
        font-family: Georgia, 'Times New Roman', serif;
        min-height: 100vh; display: flex;
        align-items: center; justify-content: center;
      }
      .login-container { width: 100%; max-width: 420px; padding: 20px; }
      .login-header { text-align: center; margin-bottom: 36px; }
      .login-title {
        font-size: 2.6rem; color: var(--accent);
        letter-spacing: 0.08em; font-weight: normal; margin-bottom: 10px;
      }
      .login-tagline { font-size: 0.9rem; color: var(--warm-brown); font-style: italic; }
      .login-card {
        background: var(--card-bg);
        border: 1px solid rgba(179,140,51,0.25);
        border-radius: 8px; padding: 36px;
      }
      .form-group { margin-bottom: 20px; }
      .form-label {
        display: block; font-size: 0.78rem; color: var(--dark-cream);
        margin-bottom: 7px; letter-spacing: 0.07em; text-transform: uppercase;
      }
      .form-input {
        width: 100%; background: var(--bg);
        border: 1px solid rgba(179,140,51,0.3);
        color: var(--text); padding: 12px 14px;
        font-size: 0.95rem; font-family: Georgia, serif;
        border-radius: 4px; outline: none; transition: border-color 0.15s;
      }
      .form-input:focus { border-color: var(--accent); }
      .btn-submit {
        width: 100%; background: var(--accent); color: var(--ink);
        border: none; padding: 13px; font-size: 1rem;
        font-family: Georgia, serif; border-radius: 4px;
        cursor: pointer; letter-spacing: 0.05em; margin-top: 6px;
        transition: background 0.15s;
      }
      .btn-submit:hover { background: #c9a040; }
      .error-msg {
        background: rgba(180,60,60,0.15);
        border: 1px solid rgba(180,60,60,0.4);
        color: #e08080; padding: 10px 14px;
        border-radius: 4px; font-size: 0.85rem;
        margin-bottom: 18px; display: none;
      }
      .error-msg.visible { display: block; }
      .footer-text {
        text-align: center; font-size: 0.75rem;
        color: var(--warm-brown); margin-top: 22px;
      }
      .welcome-text {
        font-size: 0.9rem; color: var(--dark-cream);
        margin-bottom: 22px; line-height: 1.6;
      }
    </style>`;
}

function renderLoginPage({ error, notice }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Iron &amp; Ink — Login</title>
  ${loginStyles()}
</head>
<body>
  <div class="login-container">
    <div class="login-header">
      <h1 class="login-title">Iron &amp; Ink</h1>
      <p class="login-tagline">Iron sharpens iron — Proverbs 27:17</p>
    </div>
    <div class="login-card">
      ${notice ? `<div style="background:rgba(80,140,80,0.12);border:1px solid rgba(80,140,80,0.3);color:#a0d0a0;padding:10px 14px;border-radius:4px;font-size:0.85rem;margin-bottom:16px;">${notice}</div>` : ''}
      <div class="error-msg${error ? ' visible' : ''}" id="errorMsg">${error || ''}</div>
      <form id="loginForm">
        <div class="form-group">
          <label class="form-label" for="email">Email</label>
          <input class="form-input" type="email" id="email" name="email" required autocomplete="email">
        </div>
        <div class="form-group">
          <label class="form-label" for="password">Password</label>
          <input class="form-input" type="password" id="password" name="password" required autocomplete="current-password">
        </div>
        <button class="btn-submit" type="submit">Enter</button>
      </form>
      <p style="text-align:center; margin-top:16px;">
        <a href="/forgot-password" style="font-size:0.78rem; color:var(--warm-brown); text-decoration:none;">Forgot password?</a>
      </p>
    </div>
    <p class="footer-text">A Reformed Theological Study Platform &mdash; <a href="/" style="color:var(--warm-brown); text-decoration:none;">Home</a></p>
  </div>
  <script>
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('email').value;
      const password = document.getElementById('password').value;
      const errEl = document.getElementById('errorMsg');
      errEl.classList.remove('visible');

      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();

      if (data.success || data.redirect) {
        window.location.href = data.redirect;
      } else {
        errEl.textContent = data.error || 'Login failed.';
        errEl.classList.add('visible');
      }
    });
  </script>
</body>
</html>`;
}

function renderSetupPage({ error }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Iron &amp; Ink — Set Password</title>
  ${loginStyles()}
</head>
<body>
  <div class="login-container">
    <div class="login-header">
      <h1 class="login-title">Iron &amp; Ink</h1>
      <p class="login-tagline">Welcome — set your password to begin</p>
    </div>
    <div class="login-card">
      <p class="welcome-text">
        Welcome, Carlo. This is your first login. Please set a password to secure your account.
      </p>
      <div class="error-msg${error ? ' visible' : ''}" id="errorMsg">${error || ''}</div>
      <form id="setupForm">
        <div class="form-group">
          <label class="form-label" for="password">New Password</label>
          <input class="form-input" type="password" id="password" required minlength="8" placeholder="Minimum 8 characters">
        </div>
        <div class="form-group">
          <label class="form-label" for="confirm">Confirm Password</label>
          <input class="form-input" type="password" id="confirm" required placeholder="Repeat password">
        </div>
        <button class="btn-submit" type="submit">Set Password &amp; Enter</button>
      </form>
    </div>
  </div>
  <script>
    document.getElementById('setupForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const password = document.getElementById('password').value;
      const confirm = document.getElementById('confirm').value;
      const errEl = document.getElementById('errorMsg');
      errEl.classList.remove('visible');

      const res = await fetch('/api/setup-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, confirm })
      });
      const data = await res.json();

      if (data.success) {
        window.location.href = data.redirect;
      } else {
        errEl.textContent = data.error || 'Setup failed.';
        errEl.classList.add('visible');
      }
    });
  </script>
</body>
</html>`;
}

module.exports = router;
