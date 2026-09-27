const express  = require('express');
const bcrypt   = require('bcrypt');
const fs       = require('fs');
const path     = require('path');
const crypto   = require('crypto');
const { sendMail } = require('../lib/mailer');
const { escapeHtml } = require('../lib/html');
const { appBaseUrl } = require('../lib/baseUrl');

const router = express.Router();

const DATA_DIR     = path.join(__dirname, '../data');
const USERS_PATH   = path.join(DATA_DIR, 'users.json');
const RESETS_PATH  = path.join(DATA_DIR, 'password_resets.json');

// ── Password reset: how it works ─────────────────────────────────────────────
// 1. POST /api/forgot-password always answers with the same GENERIC_MESSAGE —
//    whether or not the email has an account — and does the real work after
//    the response is sent, so neither the body nor the timing reveals which
//    emails are registered. The reset link is ONLY ever emailed; it is never
//    returned in a response or shown on a page.
// 2. The link is built from APP_BASE_URL (env), never the request's Host
//    header (which a client controls).
// 3. Tokens are 256-bit random values. Only their SHA-256 is stored, so the
//    data file alone can't be used to reset anyone. A token is single-use,
//    expires RESET_TTL_MS after it is issued, and is invalidated when the same
//    account requests a newer one or completes a reset.
// 4. A successful reset stamps users[].passwordChangedAt and ends every
//    stored session belonging to that user (requireAuth also refuses any
//    session authenticated before passwordChangedAt — see routes/layout.js).
// 5. Records are kept (used / invalidated) for RECORD_KEEP_MS as an audit
//    trail — scripts/reset-audit.js reads them.
// Both endpoints sit behind rate limiters (server.js).
const RESET_TTL_MS    = 60 * 60 * 1000;              // 60 minutes
const RECORD_KEEP_MS  = 90 * 24 * 60 * 60 * 1000;    // audit trail: 90 days
const GENERIC_MESSAGE = 'If that email has an account, a reset link is on its way.';
const INVALID_LINK    = 'This reset link is invalid or has expired.';

function readJSON(p) {
  try {
    if (!fs.existsSync(p)) return [];
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch { return []; }
}

function writeJSON(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

// ── One-time invalidation of pre-fix tokens ──────────────────────────────────
// Records written by the old flow stored the token in plain text, and any of
// them could have been obtained through the old endpoint (which returned the
// link to whoever asked). On first start they are removed from the live file
// — so they can never be accepted — but NOT destroyed: they are moved to
// data/password_resets_legacy_<timestamp>.json with the token value replaced
// by its SHA-256 (still matchable against access logs, useless for a reset),
// for scripts/reset-audit.js and your own review. Records in the new format
// (tokenHash) are untouched, so this is a no-op on every later start.
(function invalidateLegacyTokens() {
  let records;
  try {
    if (!fs.existsSync(RESETS_PATH)) return;
    records = JSON.parse(fs.readFileSync(RESETS_PATH, 'utf8'));
  } catch (err) {
    console.error('[passwordReset] could not read reset records for legacy invalidation:', err.message);
    return;
  }
  if (!Array.isArray(records)) return;
  const legacy = records.filter(r => r && r.tokenHash == null);
  if (!legacy.length) return;

  const stamp   = new Date().toISOString();
  const archive = {
    archivedAt: stamp,
    reason:     'Pre-fix plaintext reset tokens, invalidated when the hashed reset flow first started. ' +
                'Token values replaced by their SHA-256. The old flow deleted used tokens, so every record here was unused.',
    records: legacy.map(r => {
      const copy = Object.assign({}, r);
      copy.tokenSha256 = r.token != null ? hashToken(r.token) : null;
      delete copy.token;
      const exp = Date.parse(r.expiresAt);
      copy.derivedCreatedAt = isNaN(exp) ? null : new Date(exp - RESET_TTL_MS).toISOString();
      return copy;
    }),
  };
  const archiveFile = path.join(DATA_DIR, 'password_resets_legacy_' + stamp.replace(/[:.]/g, '-') + '.json');
  try {
    fs.writeFileSync(archiveFile, JSON.stringify(archive, null, 2));
  } catch (err) {
    // Evidence must not vanish silently: put it in the pm2 log instead.
    console.error('[passwordReset] could not write legacy archive (' + err.message + '); records follow:',
      JSON.stringify(archive));
  }
  writeJSON(RESETS_PATH, records.filter(r => r && r.tokenHash != null));
  console.warn('[passwordReset] invalidated ' + legacy.length + ' legacy plaintext reset token(s); archived to ' +
    path.basename(archiveFile));
})();

// Index of the live (unused, not invalidated, unexpired) record for `token`, or -1.
function findValidRecord(records, token) {
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return -1;
  const h   = hashToken(token);
  const now = Date.now();
  return records.findIndex(r =>
    r && r.tokenHash === h && !r.usedAt && !r.invalidatedAt && Date.parse(r.expiresAt) > now);
}

// Mark every still-live token of `userId` invalidated (reason recorded), and
// drop records older than the audit window.
function invalidateUserTokens(records, userId, whenIso, reason) {
  const cutoff = Date.now() - RECORD_KEEP_MS;
  return records.filter(r => r && Date.parse(r.createdAt || r.expiresAt) > cutoff).map(r => {
    if (r.userId === userId && !r.usedAt && !r.invalidatedAt) {
      return Object.assign({}, r, { invalidatedAt: whenIso, invalidatedReason: reason });
    }
    return r;
  });
}

// ── Email ─────────────────────────────────────────────────────────────────────
// Sent through lib/mailer.js. Best-effort: failures are logged server-side (the
// mailer logs the real cause), never surfaced to the requester — who always sees
// the same generic message. Neither the address nor the link is logged.
async function sendResetEmail(user, resetUrl) {
  const name = (user.fullName || '').trim() || 'Friend';
  const result = await sendMail({
    tag:     'passwordReset',
    to:      user.email,
    subject: 'Reset your Iron & Ink password',
    text: `${name},\n\nWe received a request to reset the password for your Iron & Ink account. ` +
      `Use the link below to choose a new one:\n\n${resetUrl}\n\n` +
      `This link works once and expires in 60 minutes. If you didn't ask for this, you can ignore this email — ` +
      `your password stays the same.\n\nSoli Deo Gloria,\nIron & Ink`,
    html: `<p>${escapeHtml(name)},</p>
<p>We received a request to reset the password for your Iron &amp; Ink account. Use the link below to choose a new one:</p>
<p><a href="${escapeHtml(resetUrl)}">Reset my password</a></p>
<p style="font-size:0.9em;color:#555;">Or paste this address into your browser:<br>${escapeHtml(resetUrl)}</p>
<p>This link works once and expires in 60 minutes. If you didn't ask for this, you can ignore this email &mdash; your password stays the same.</p>
<p><em>Soli Deo Gloria,</em><br>Iron &amp; Ink</p>`,
  });
  if (result.ok) console.log('[passwordReset] reset email sent for user', user.id);
  else console.error('[passwordReset] reset email failed for user', user.id);
}

// Issue a token for `email` if (and only if) it belongs to an active account.
// Runs AFTER the generic response has been sent.
function issueReset(email) {
  const user = readJSON(USERS_PATH).find(u => String(u.email || '').toLowerCase() === email);
  if (!user || user.isActive === false) return;

  const base = appBaseUrl();
  if (!base) {
    console.error('[passwordReset] APP_BASE_URL is not set to a valid http(s) URL — cannot build a reset link, no email sent');
    return;
  }

  const token = crypto.randomBytes(32).toString('hex');
  const now   = new Date();
  const records = invalidateUserTokens(readJSON(RESETS_PATH), user.id, now.toISOString(), 'superseded by a newer request');
  records.push({
    id:            crypto.randomUUID(),
    tokenHash:     hashToken(token),
    userId:        user.id,
    createdAt:     now.toISOString(),
    expiresAt:     new Date(now.getTime() + RESET_TTL_MS).toISOString(),
    usedAt:        null,
    invalidatedAt: null,
  });
  writeJSON(RESETS_PATH, records);

  sendResetEmail(user, base + '/reset-password?token=' + token)
    .catch(err => console.error('[passwordReset] unexpected:', err && err.message));
}

// End every stored session belonging to `userId` (session-file-store: list()
// yields "<sid>.json" file names; get/destroy take the bare sid). Resolves to
// the number of sessions ended; never rejects.
function endUserSessions(store, userId) {
  return new Promise(resolve => {
    if (!store || typeof store.list !== 'function' || typeof store.get !== 'function') return resolve(0);
    store.list((err, files) => {
      if (err || !Array.isArray(files) || !files.length) return resolve(0);
      let pending = files.length;
      let ended   = 0;
      const done  = () => { if (--pending === 0) resolve(ended); };
      files.forEach(file => {
        const sid = String(file).replace(/\.json$/, '');
        store.get(sid, (getErr, sess) => {
          if (!getErr && sess && sess.userId === userId) {
            ended++;
            store.destroy(sid, done);
          } else {
            done();
          }
        });
      });
    });
  });
}

function publicStyles() {
  return `
    <link rel="stylesheet" href="/css/styles.css?v=72">
    <style>
      body { display:flex; align-items:center; justify-content:center; min-height:100vh; }
      .pub-container { width:100%; max-width:480px; padding:24px; }
      .pub-header { text-align:center; margin-bottom:32px; }
      .pub-brand { display:block; width:100%; max-width:340px; height:auto; margin:0 auto 16px; }
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
        width:100%; background:var(--accent); color:#E8D9B8;
        border:none; padding:13px; font-size:1rem;
        font-family:'EB Garamond',Georgia,serif; font-weight:600;
        border-radius:4px; cursor:pointer; letter-spacing:0.04em;
        margin-top:4px; transition:background 0.15s;
      }
      .btn-pub:hover { background:#c9a040; color:#1A0F0A; }
      .error-msg {
        background:rgba(180,60,60,0.15); border:1px solid rgba(180,60,60,0.4);
        color:#5a0a0a; padding:10px 14px; border-radius:4px;
        font-size:0.85rem; margin-bottom:16px; display:none;
      }
      .error-msg.visible { display:block; }
      .info-box {
        background:rgba(179,140,51,0.1); border:1px solid rgba(179,140,51,0.3);
        color:var(--dark-cream); padding:16px 18px; border-radius:6px;
        font-size:0.9rem; line-height:1.7; word-break:break-all;
      }
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
  <link rel="icon" href="/favicon.ico" type="image/x-icon">
</head>
<body>
  <div class="pub-container">
    <div class="pub-header">
      <img src="/images/brand.jpg" alt="Iron & Ink — Iron sharpens iron, Proverbs 27:17" class="pub-brand">
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
          // Same message for every address — the link itself only ever goes by email.
          document.getElementById('forgotForm').style.display = 'none';
          var box = document.getElementById('resultBox');
          var msg = document.createElement('p');
          msg.style.color = 'var(--dark-cream)';
          msg.textContent = data.message || 'If that email has an account, a reset link is on its way.';
          var hint = document.createElement('p');
          hint.style.cssText = 'margin-top:10px; font-size:0.8rem; color:var(--warm-brown);';
          hint.textContent = 'Check your inbox (and spam folder). The link works once and expires in 60 minutes.';
          box.appendChild(msg);
          box.appendChild(hint);
          box.style.display = 'block';
        } else {
          errEl.textContent = data.error || 'Something went wrong. Please try again.';
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
// Same response for every well-formed address; the work happens after the
// response is sent (see issueReset). Rate-limited in server.js.
router.post('/api/forgot-password', (req, res) => {
  const email = typeof (req.body && req.body.email) === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!email || email.length > 254 || email.indexOf('@') < 1) {
    return res.status(400).json({ success: false, error: 'Please enter a valid email address.' });
  }
  res.json({ success: true, message: GENERIC_MESSAGE });
  setImmediate(() => {
    try { issueReset(email); }
    catch (err) { console.error('[passwordReset] issue failed:', err.message); }
  });
});

// ─── GET /reset-password?token=xxx ───────────────────────────────────────────
router.get('/reset-password', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');

  // The token is in this URL: never cache the page, and never send the URL
  // onward as a Referer.
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');

  const { token } = req.query;
  if (findValidRecord(readJSON(RESETS_PATH), token) === -1) {
    return res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Iron &amp; Ink — Invalid Reset Link</title>
  ${publicStyles()}
  <link rel="icon" href="/favicon.ico" type="image/x-icon">
</head>
<body>
  <div class="pub-container">
    <div class="pub-header"><img src="/images/brand.jpg" alt="Iron & Ink — Iron sharpens iron, Proverbs 27:17" class="pub-brand"></div>
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
  <link rel="icon" href="/favicon.ico" type="image/x-icon">
</head>
<body>
  <div class="pub-container">
    <div class="pub-header">
      <img src="/images/brand.jpg" alt="Iron & Ink — Iron sharpens iron, Proverbs 27:17" class="pub-brand">
      <p class="pub-subtitle">Choose a new password</p>
    </div>
    <div class="pub-card">
      <div class="error-msg" id="errMsg"></div>
      <form id="resetForm">
        <input type="hidden" id="token" value="${escHtml(token)}">
        <div class="form-group">
          <label class="form-label">New Password <span style="font-size:0.7rem; color:var(--warm-brown);">(min 8 characters)</span></label>
          <div style="position:relative;">
            <input class="form-input" type="password" id="password" required minlength="8" placeholder="New password">
            <button type="button" tabindex="-1" onclick="var i=this.previousElementSibling;i.type=i.type==='password'?'text':'password';" style="background:none;border:none;cursor:pointer;position:absolute;right:0.75rem;top:50%;transform:translateY(-50%);font-size:1.1rem;color:#6B4226;line-height:1;">&#128065;</button>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Confirm New Password</label>
          <div style="position:relative;">
            <input class="form-input" type="password" id="confirm" required placeholder="Repeat new password">
            <button type="button" tabindex="-1" onclick="var i=this.previousElementSibling;i.type=i.type==='password'?'text':'password';" style="background:none;border:none;cursor:pointer;position:absolute;right:0.75rem;top:50%;transform:translateY(-50%);font-size:1.1rem;color:#6B4226;line-height:1;">&#128065;</button>
          </div>
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
// Rate-limited in server.js. The token is consumed BEFORE the (async) password
// hash, so two concurrent submits of one link can't both succeed.
router.post('/api/reset-password', async (req, res) => {
  const { token, password, confirm } = req.body || {};

  if (!token || !password || !confirm) {
    return res.status(400).json({ success: false, error: 'All fields are required.' });
  }
  if (typeof password !== 'string' || typeof confirm !== 'string') {
    return res.status(400).json({ success: false, error: 'All fields are required.' });
  }
  if (password.length < 8) {
    return res.json({ success: false, error: 'Password must be at least 8 characters.' });
  }
  if (password !== confirm) {
    return res.json({ success: false, error: 'Passwords do not match.' });
  }

  let records = readJSON(RESETS_PATH);
  const idx   = findValidRecord(records, token);
  if (idx === -1) return res.json({ success: false, error: INVALID_LINK });
  const userId = records[idx].userId;

  const user = readJSON(USERS_PATH).find(u => u.id === userId);
  if (!user || user.isActive === false) return res.json({ success: false, error: INVALID_LINK });

  // Single use: mark this token used and every other live token of the account
  // invalidated, and persist that first.
  const usedAt = new Date().toISOString();
  records[idx] = Object.assign({}, records[idx], { usedAt });
  records = invalidateUserTokens(records, userId, usedAt, 'password reset completed');
  writeJSON(RESETS_PATH, records);

  let passwordHash;
  try {
    passwordHash = await bcrypt.hash(password, 10);
  } catch (err) {
    console.error('[passwordReset] hash failed:', err.message);
    return res.status(500).json({ success: false, error: 'Something went wrong. Please request a new reset link.' });
  }

  // Re-read after the await so a concurrent write to users.json isn't lost.
  const users   = readJSON(USERS_PATH);
  const userIdx = users.findIndex(u => u.id === userId);
  if (userIdx === -1) return res.json({ success: false, error: INVALID_LINK });
  const changedAt = new Date().toISOString();
  users[userIdx].passwordHash      = passwordHash;
  users[userIdx].passwordChangedAt = changedAt;
  users[userIdx].updatedAt         = changedAt;
  writeJSON(USERS_PATH, users);

  // Sign the account out everywhere (requireAuth's passwordChangedAt check is
  // the backstop for anything this misses).
  const ended = await endUserSessions(req.sessionStore, userId);
  console.log('[passwordReset] password reset completed for user', userId, '- ended', ended, 'session(s)');

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
