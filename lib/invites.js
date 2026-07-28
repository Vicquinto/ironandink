// ─── Invite provisioning ─────────────────────────────────────────────────────
// Single source of truth for creating an invite record + emailing the invite
// link. Both automatic seams and the admin panel funnel through here so the
// invite token, the 48h expiry, the /register?token=… URL shape, and the email
// copy can never drift between them.
//
// Today two callers use this:
//   • POST /api/invite-request        — auto-invite on submission (no admin step)
//   • POST /api/admin/invite-requests/:id/invite  — admin approve button
//   • POST /api/admin/invite/send     — admin manual send
//
// FUTURE: a billing/Stripe-webhook "payment succeeded → grant access" handler
// will live alongside this as a parallel automatic seam, reusing this exact
// invite-creation + email infrastructure (call createAndSendInvite from the
// webhook once the payment is verified). No billing is built here yet — this note
// only marks where that seam attaches so it reuses this code rather than
// re-inlining a fourth copy.

const fs   = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const sgMail = require('@sendgrid/mail');

sgMail.setApiKey(process.env.SENDGRID_API_KEY || '');

const INVITES_PATH = path.join(__dirname, '../data/invites.json');

// Missing file is treated as an empty array and created on first write. Mirrors
// the readJSON/writeJSON idiom used across the route files.
function readInvites() {
  try {
    if (!fs.existsSync(INVITES_PATH)) return [];
    return JSON.parse(fs.readFileSync(INVITES_PATH, 'utf8'));
  } catch { return []; }
}

function writeInvites(invites) {
  fs.writeFileSync(INVITES_PATH, JSON.stringify(invites, null, 2));
}

// Send the invitation email to the applicant. Self-contained and best-effort:
// returns true on a successful send, false on any failure (missing key or a
// SendGrid error). Never throws into its caller — the caller decides what to do
// with a false result.
async function sendInviteEmail(toEmail, toName, inviteUrl) {
  if (!process.env.SENDGRID_API_KEY) {
    console.warn('[sendInviteEmail] SENDGRID_API_KEY not set — skipping email');
    return false;
  }
  try {
    await sgMail.send({
      to:   { email: toEmail, name: toName },
      from: { email: process.env.SENDGRID_FROM_EMAIL, name: 'Iron & Ink' },
      subject: "You're invited to Iron & Ink",
      text: `${toName},\n\nYour invitation to Iron & Ink has been approved. Click the link below to set up your account and begin your study.\n\n${inviteUrl}\n\nThis link expires in 48 hours.\n\nSoli Deo Gloria,\nIron & Ink`,
      html: `<p>${toName},</p>
<p>Your invitation to Iron &amp; Ink has been approved. Click the link below to set up your account and begin your study.</p>
<p><a href="${inviteUrl}">${inviteUrl}</a></p>
<p>This link expires in 48 hours.</p>
<p><em>Soli Deo Gloria,</em><br>Iron &amp; Ink</p>`,
    });
    console.log('[sendInviteEmail] sent to', toEmail);
    return true;
  } catch (err) {
    console.error('[sendInviteEmail] failed for', toEmail, ':', err.message);
    return false;
  }
}

// Find an existing invite for an email that is still usable (not yet redeemed
// and not past its 48h expiry). Used by callers to avoid minting a second link
// when a live one already exists. Returns the invite record or null.
function findActiveInvite(email) {
  const norm = String(email || '').trim().toLowerCase();
  const now  = new Date();
  return readInvites().find(i =>
    i.email && i.email.toLowerCase() === norm &&
    !i.used &&
    new Date(i.expiresAt) > now
  ) || null;
}

// Create an invite record, persist it, and email the link to the applicant.
// Returns { invite, inviteUrl, emailSent }. The email is AWAITED and its result
// surfaced via emailSent — callers must not ignore it.
async function createAndSendInvite(email, name, { host, protocol }) {
  const cleanEmail = String(email).trim().toLowerCase();
  const cleanName  = String(name).trim();
  const token      = randomUUID();
  const now        = new Date();
  const expires    = new Date(now.getTime() + 48 * 60 * 60 * 1000);

  const invite = {
    id:        randomUUID(),
    token,
    email:     cleanEmail,
    name:      cleanName,
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    used:      false,
  };

  const invites = readInvites();
  invites.push(invite);
  writeInvites(invites);

  const inviteUrl = `${protocol}://${host}/register?token=${token}`;
  const emailSent = await sendInviteEmail(cleanEmail, cleanName, inviteUrl);

  return { invite, inviteUrl, emailSent };
}

module.exports = {
  INVITES_PATH,
  readInvites,
  writeInvites,
  findActiveInvite,
  sendInviteEmail,
  createAndSendInvite,
};
