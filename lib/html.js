'use strict';

// ── Server-side HTML helpers ─────────────────────────────────────────────────
// escapeHtml: for any stored / user-supplied value interpolated into a
//   server-rendered HTML template (text or a double-quoted attribute).
// inlineJson: for any value embedded in an inline <script> as a JS literal.
//   Plain JSON.stringify is NOT safe there: a string containing "</script>"
//   (a chat message, a study, a name) would end the script block early and
//   inject markup. Escaping every '<' as a JSON unicode escape makes that
//   impossible while JS evaluation still yields the identical string. The
//   U+2028 / U+2029 separators are escaped too so the literal is valid in
//   older JS engines. (Characters are built with fromCharCode so this source
//   file contains no escape sequences an editor could mangle.)

const BS   = String.fromCharCode(92);     // backslash
const LT   = /</g;
const LSEP = new RegExp(String.fromCharCode(0x2028), 'g');
const PSEP = new RegExp(String.fromCharCode(0x2029), 'g');

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inlineJson(v) {
  return JSON.stringify(v === undefined ? null : v)
    .replace(LT, BS + 'u003c')
    .replace(LSEP, BS + 'u2028')
    .replace(PSEP, BS + 'u2029');
}

module.exports = { escapeHtml, inlineJson };
