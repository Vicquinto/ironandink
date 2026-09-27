#!/usr/bin/env node
'use strict';

// ── Password-reset evidence audit (READ-ONLY) ────────────────────────────────
// Prints every trace of password-reset activity the app's own data holds, so
// past use of the old /api/forgot-password hole (which handed a working reset
// link to anyone who typed a member's email) can be reviewed. Changes nothing.
//
//   node scripts/reset-audit.js
//
// Sources, and what each can and cannot show:
//  1. data/password_resets_legacy_*.json — the pre-fix token records the new
//     code moved aside on its first start (token value replaced by its SHA-256
//     so it still matches access logs but can never be used). The OLD flow
//     DELETED a token the moment it was used and REPLACED a user's token on
//     each new request, so these are only the requested-but-UNUSED tokens.
//  2. data/password_resets.json — legacy records if the fix hasn't started yet;
//     afterwards the new hashed records (each request, and when it was used).
//  3. data/users.json — the old reset flow is the only code that ever changed
//     a user's `updatedAt` after registration (billing writes a nested
//     subscription.updatedAt, not this one), so updatedAt later than createdAt
//     marks a password reset — the only trace of a USED old token. Only the
//     LATEST reset per user survives. New flow: passwordChangedAt.
//  4. data/usage_events.json — logins, to see who signed in after a reset.
// Not visible here: web-server access logs (nginx etc.), which would show every
// POST /api/forgot-password and GET /reset-password?token=… — see the notes at
// the end of the output.

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const DATA = path.join(__dirname, '..', 'data');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, file), 'utf8')); }
  catch (e) { return fallback; }
}
function iso(t) { const d = new Date(t); return isNaN(d) ? String(t) : d.toISOString(); }
function sha256(s) { return crypto.createHash('sha256').update(String(s)).digest('hex'); }

const users  = readJson('users.json', []);
const byId   = {};
users.forEach(u => { byId[u.id] = u; });
const who    = id => (byId[id] ? byId[id].email + ' (' + (byId[id].fullName || '?') + ')' : 'unknown user ' + id);
const now    = Date.now();

console.log('Password-reset evidence audit — ' + new Date().toISOString());
console.log('Data directory: ' + DATA + '\n');

// 1 + 2. Token records ─────────────────────────────────────────────────────────
function printRecords(label, records) {
  console.log('== ' + label + ': ' + records.length + ' record(s)');
  records.forEach(r => {
    const expires = r.expiresAt ? Date.parse(r.expiresAt) : NaN;
    const created = r.createdAt ? Date.parse(r.createdAt) : (isNaN(expires) ? NaN : expires - 60 * 60 * 1000);
    const legacy  = r.token != null || r.tokenSha256 != null;
    console.log('  - account:   ' + who(r.userId) + (r.email ? '  [record email: ' + r.email + ']' : ''));
    console.log('    requested: ' + (isNaN(created) ? '?' : iso(created)) + (r.createdAt ? '' : '  (derived: expiresAt − 60 min)'));
    console.log('    expires:   ' + (r.expiresAt ? iso(r.expiresAt) : '?') + (expires < now ? '  (expired)' : '  (NOT yet expired)'));
    if (legacy) {
      console.log('    used:      no — the old flow deleted used tokens, so every legacy record here was never used');
      console.log('    token sha256: ' + (r.tokenSha256 || sha256(r.token)));
    } else {
      console.log('    used:      ' + (r.usedAt ? iso(r.usedAt) : 'no') +
        (r.invalidatedAt ? '   invalidated: ' + iso(r.invalidatedAt) + ' (' + (r.invalidatedReason || '') + ')' : ''));
    }
  });
  console.log('');
}

const archives = fs.existsSync(DATA)
  ? fs.readdirSync(DATA).filter(f => /^password_resets_legacy_.*\.json$/.test(f)).sort()
  : [];
archives.forEach(f => {
  const a = readJson(f, {});
  console.log('(archive ' + f + ', archived ' + (a.archivedAt || '?') + ')');
  printRecords('Legacy tokens archived in ' + f, Array.isArray(a.records) ? a.records : []);
});
if (!archives.length) console.log('== No legacy archive yet (the fixed code has not started on this data).\n');

const current = readJson('password_resets.json', []);
printRecords('Current data/password_resets.json', Array.isArray(current) ? current : []);

// 3. Password changes visible on user records ─────────────────────────────────
console.log('== Password changes visible on user records');
let changes = 0;
users.forEach(u => {
  const created = Date.parse(u.createdAt);
  const updated = Date.parse(u.updatedAt);
  const lines = [];
  if (u.passwordChangedAt) lines.push('passwordChangedAt ' + iso(u.passwordChangedAt) + ' (new reset flow)');
  // The new flow also sets updatedAt (= passwordChangedAt); only an updatedAt it
  // doesn't explain is a trace of the old flow.
  const explained = u.passwordChangedAt && Date.parse(u.passwordChangedAt) === updated;
  if (!isNaN(updated) && !explained && (isNaN(created) || updated - created > 5000)) {
    lines.push('updatedAt ' + iso(u.updatedAt) + ' is after createdAt ' + (u.createdAt ? iso(u.createdAt) : '(none recorded)') +
      ' → most recent password reset via the OLD flow');
  }
  if (!lines.length) return;
  changes++;
  console.log('  - ' + who(u.id) + (u.role === 'admin' || u.isAdmin ? '  [ADMIN]' : ''));
  lines.forEach(l => console.log('      ' + l));
  console.log('      lastLogin ' + (u.lastLogin ? iso(u.lastLogin) : 'never recorded'));
});
if (!changes) console.log('  none — no user record shows a password change after registration');
console.log('  (Accounts created before createdAt/updatedAt existed carry neither field and cannot be checked this way.)\n');

// 4. Logins after each visible password change ───────────────────────────────
const eventsRaw = readJson('usage_events.json', []);
const events    = Array.isArray(eventsRaw) ? eventsRaw : (eventsRaw.events || []);
console.log('== Logins within 7 days after each visible password change');
users.forEach(u => {
  const t = Date.parse(u.passwordChangedAt || u.updatedAt);
  const c = Date.parse(u.createdAt);
  if (isNaN(t) || (!u.passwordChangedAt && !isNaN(c) && t - c <= 5000)) return;
  const logins = events.filter(e => e.userId === u.id && e.type === 'login' &&
    Date.parse(e.at) >= t && Date.parse(e.at) <= t + 7 * 864e5);
  console.log('  - ' + who(u.id) + ': ' + (logins.length ? logins.map(e => iso(e.at)).join(', ') : 'none recorded'));
});
console.log('  (usage_events.json records when a login happened, not from where — no IP address is stored.)\n');

console.log('== Check your web-server access logs too (not visible to this script), e.g. for nginx:');
console.log("   sudo zgrep -h 'forgot-password\\|reset-password' /var/log/nginx/access.log*");
console.log('   Each GET /reset-password?token=… line: sha256 the token and compare it with the hashes above.');
console.log('   pm2 logs: pm2 logs ironandink --lines 5000 --nostream | grep -i reset');
