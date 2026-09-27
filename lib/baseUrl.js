'use strict';

// ── Public base URL for links sent by email ─────────────────────────────────
// Password-reset and invite links are built from APP_BASE_URL (.env), never
// from the request's Host header: Host is chosen by whoever sends the request,
// so a forged one would put a working token inside a genuine Iron & Ink email
// pointing at someone else's site. Returns the configured origin
// ("https://example.com" — any path, query or trailing slash is dropped), or
// null when APP_BASE_URL is unset or not an http(s) URL; callers must then
// refuse to build a link rather than fall back to the request.
function appBaseUrl() {
  const raw = (process.env.APP_BASE_URL || '').trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.origin;
  } catch {
    return null;
  }
}

module.exports = { appBaseUrl };
