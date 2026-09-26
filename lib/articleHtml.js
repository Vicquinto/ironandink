'use strict';

// ── Article HTML sanitizer (server) ──────────────────────────────────────────
// Articles written on the Writing page's Quill board are stored as HTML
// (`contentHtml`, from quill.getSemanticHTML()) alongside a plain-text copy
// (`content`). This is the server-side allowlist every contentHtml passes
// through before it is saved, and again before it is handed to another user
// (Community / Admin). The client twin lives in public/js/article-html.js —
// keep the two allowlists identical.
//
// Allowlist = exactly what the board's toolbar can produce:
//   p, br                       paragraphs / empty lines
//   strong, em, u               bold / italic / underline
//   h2, h3                      headings
//   ul, ol, li                  bulleted / numbered lists
//   blockquote                  blockquote
//   span class="ql-size-*"      text size (small / large / huge)
//   span style="background-color: <hex|rgb()>"   highlight
// Every other tag is dropped (its text kept); script-like tags are dropped
// WITH their content; every other attribute is dropped. Dependency-free on
// purpose — production deploys with `git pull` only, no `npm install`.

const ALLOWED_TAGS = new Set(['p', 'br', 'strong', 'em', 'u', 'h2', 'h3', 'ul', 'ol', 'li', 'blockquote', 'span']);
const DROP_WITH_CONTENT = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'textarea',
  'title', 'svg', 'math', 'select', 'xmp', 'noembed', 'noframes', 'plaintext', 'head',
]);
const SIZE_CLASS_RE = /^ql-size-(small|large|huge)$/;
const COLOR_RE = /^(#[0-9a-f]{3}|#[0-9a-f]{6}|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\))$/i;

// A tag: name, then attributes (quoted values may contain '>').
const TAG_RE  = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/y;
const ATTR_RE = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const ENTITY_RE = /^&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z][a-z0-9]{1,31});/i;

// Text between tags is already HTML source: keep valid entities, escape
// everything that could open markup.
function escapeText(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '<') out += '&lt;';
    else if (c === '>') out += '&gt;';
    else if (c === '&') {
      const m = ENTITY_RE.exec(s.slice(i, i + 40));
      if (m) { out += m[0]; i += m[0].length - 1; } else out += '&amp;';
    } else out += c;
  }
  return out;
}

function cleanSpanAttrs(raw) {
  let cls = '';
  let bg  = '';
  ATTR_RE.lastIndex = 0;
  let m;
  while ((m = ATTR_RE.exec(raw))) {
    const name  = m[1].toLowerCase();
    const value = m[2] != null ? m[2] : m[3] != null ? m[3] : m[4] != null ? m[4] : '';
    if (name === 'class') {
      const keep = value.split(/\s+/).filter(t => SIZE_CLASS_RE.test(t));
      if (keep.length) cls = keep[keep.length - 1];
    } else if (name === 'style') {
      value.split(';').forEach(decl => {
        const idx = decl.indexOf(':');
        if (idx === -1) return;
        const prop = decl.slice(0, idx).trim().toLowerCase();
        const val  = decl.slice(idx + 1).trim();
        if (prop === 'background-color' && COLOR_RE.test(val)) bg = val;
      });
    }
  }
  return (cls ? ' class="' + cls + '"' : '') + (bg ? ' style="background-color: ' + bg + ';"' : '');
}

function sanitizeArticleHtml(html) {
  if (typeof html !== 'string' || !html) return '';
  let out = '';
  let i = 0;
  const len   = html.length;
  const stack = [];          // open allowed tags, closed in order (keeps output balanced)
  let skipUntil = null;      // inside a drop-with-content tag

  while (i < len) {
    const lt = html.indexOf('<', i);
    const textEnd = lt === -1 ? len : lt;
    if (textEnd > i) {
      if (!skipUntil) out += escapeText(html.slice(i, textEnd));
      i = textEnd;
      continue;
    }
    if (html.startsWith('<!--', i)) {                 // comments: drop
      const end = html.indexOf('-->', i + 4);
      i = end === -1 ? len : end + 3;
      continue;
    }
    TAG_RE.lastIndex = i;
    const m = TAG_RE.exec(html);
    if (!m) {                                          // stray '<' — text, not markup
      if (!skipUntil) out += '&lt;';
      i += 1;
      continue;
    }
    i = TAG_RE.lastIndex;
    const closing = m[1] === '/';
    const name    = m[2].toLowerCase();

    if (skipUntil) {
      if (closing && name === skipUntil) skipUntil = null;
      continue;
    }
    if (DROP_WITH_CONTENT.has(name)) {
      if (!closing && !/\/\s*$/.test(m[3])) skipUntil = name;
      continue;
    }
    if (!ALLOWED_TAGS.has(name)) continue;             // unknown tag: drop tag, keep text
    if (name === 'br') { if (!closing) out += '<br>'; continue; }

    if (closing) {
      const idx = stack.lastIndexOf(name);
      if (idx === -1) continue;                        // unmatched close: drop
      while (stack.length > idx) out += '</' + stack.pop() + '>';
      continue;
    }
    out += '<' + name + (name === 'span' ? cleanSpanAttrs(m[3]) : '') + '>';
    stack.push(name);
  }
  while (stack.length) out += '</' + stack.pop() + '>';
  return out;
}

module.exports = { sanitizeArticleHtml };
