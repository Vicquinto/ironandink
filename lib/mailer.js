'use strict';

// ── Outbound email ───────────────────────────────────────────────────────────
// Every email the app sends goes through sendMail() here. DigitalOcean blocks
// outbound SMTP from the droplet, so messages are POSTed over HTTPS to a small
// PHP relay on the GreenGeeks cPanel hosting (mail-relay/iron-ink-mail-relay.php),
// which hands them to that server's local mail system.
//
// Env (.env):
//   MAIL_RELAY_URL     https URL of the uploaded relay script
//   MAIL_RELAY_SECRET  shared secret — identical to RELAY_SECRET in the PHP file
//   MAIL_FROM          sender address — must equal FROM_ADDRESS in the PHP file
//   MAIL_FROM_NAME     display name (default "Iron & Ink")
//
// Each request is signed: X-Relay-Timestamp (unix seconds) and
// X-Relay-Signature = hex HMAC-SHA256(secret, timestamp + "." + body). The body
// carries a random id so two identical messages never share a signature (the
// relay accepts each signature only once).
//
// sendMail() NEVER throws. It resolves { ok: true, messageId } or
// { ok: false, error } and logs the real failure server-side, so callers keep
// their existing user-facing behaviour. Neither the recipient address nor the
// message body is logged here; pass `tag` to label log lines.

const https  = require('https');
const http   = require('http');
const crypto = require('crypto');

const TIMEOUT_MS = 20000;

function config() {
  return {
    url:      (process.env.MAIL_RELAY_URL || '').trim(),
    secret:   process.env.MAIL_RELAY_SECRET || '',
    from:     (process.env.MAIL_FROM || '').trim(),
    fromName: (process.env.MAIL_FROM_NAME || 'Iron & Ink').trim() || 'Iron & Ink',
  };
}

// Plain single address, no display name, no header-breaking characters.
function isPlainAddress(s) {
  return typeof s === 'string' && s.length <= 254 &&
    !/[\r\n\0,;<>"\s]/.test(s) && /^[^@]+@[^@]+\.[^@]+$/.test(s);
}

// Collapse anything that could break a mail header (CR/LF/control chars).
function oneLine(s) {
  return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
}

function sign(secret, timestamp, body) {
  return crypto.createHmac('sha256', secret).update(timestamp + '.' + body).digest('hex');
}

// POST `body` to the relay; resolves { status, text } or rejects on network error.
function post(urlString, headers, body) {
  return new Promise((resolve, reject) => {
    const url   = new URL(urlString);
    const agent = url.protocol === 'https:' ? https : http;
    const req = agent.request(url, { method: 'POST', headers, timeout: TIMEOUT_MS }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { if (text.length < 20000) text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('timeout', () => req.destroy(new Error('timed out after ' + TIMEOUT_MS + 'ms')));
    req.on('error', reject);
    req.end(body);
  });
}

/**
 * Send one email. `to` must be a single plain address.
 * @returns {Promise<{ok: true, messageId: string} | {ok: false, error: string}>}
 */
async function sendMail({ to, subject, html, text, tag }) {
  const label = '[mailer' + (tag ? ':' + tag : '') + ']';
  const fail  = (error) => { console.error(label, 'send failed:', error); return { ok: false, error }; };

  const cfg = config();
  if (!cfg.url || !cfg.secret || !cfg.from) {
    return fail('mail relay not configured (MAIL_RELAY_URL, MAIL_RELAY_SECRET and MAIL_FROM are required)');
  }
  let relayUrl;
  try { relayUrl = new URL(cfg.url); } catch { return fail('MAIL_RELAY_URL is not a valid URL'); }
  const local = relayUrl.hostname === 'localhost' || relayUrl.hostname === '127.0.0.1';
  if (relayUrl.protocol !== 'https:' && !(local && relayUrl.protocol === 'http:')) {
    return fail('MAIL_RELAY_URL must be https (message contents include reset and invite links)');
  }
  if (cfg.secret.length < 32) return fail('MAIL_RELAY_SECRET is too short (use at least 32 characters)');

  const recipient = String(to == null ? '' : to).trim();
  if (!isPlainAddress(recipient)) return fail('invalid recipient address');
  const cleanSubject = oneLine(subject).slice(0, 200);
  if (!cleanSubject) return fail('empty subject');
  if (!html && !text) return fail('empty message body');

  const body = JSON.stringify({
    id:       crypto.randomUUID(),
    to:       recipient,
    subject:  cleanSubject,
    html:     html ? String(html) : '',
    text:     text ? String(text) : '',
    from:     cfg.from,
    fromName: oneLine(cfg.fromName).slice(0, 100),
  });
  const timestamp = String(Math.floor(Date.now() / 1000));

  let res;
  try {
    res = await post(relayUrl.toString(), {
      'Content-Type':      'application/json',
      'Content-Length':    Buffer.byteLength(body),
      'X-Relay-Timestamp': timestamp,
      'X-Relay-Signature': sign(cfg.secret, timestamp, body),
      'User-Agent':        'IronInk-Mailer/1',
    }, body);
  } catch (err) {
    return fail('relay unreachable: ' + (err && err.message ? err.message : String(err)));
  }

  let parsed = null;
  try { parsed = JSON.parse(res.text); } catch { /* non-JSON reply */ }
  if (res.status >= 200 && res.status < 300 && parsed && parsed.ok === true) {
    return { ok: true, messageId: parsed.messageId || '' };
  }
  const detail = parsed && parsed.error ? parsed.error : ('non-JSON response: ' + String(res.text).slice(0, 200));
  return fail('relay HTTP ' + res.status + ' — ' + detail);
}

module.exports = { sendMail, sign, isPlainAddress };
