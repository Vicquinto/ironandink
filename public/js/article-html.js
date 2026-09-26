(function (global) {
  'use strict';

  // ── Article HTML (client) ───────────────────────────────────────────────────
  // Client twin of lib/articleHtml.js — keep the two allowlists identical.
  // Articles written on the Quill board carry `contentHtml` (sanitized HTML)
  // plus `content` (plain text). Every surface that renders an article body
  // (Writing print, My Articles, Community, Admin) goes through
  // renderArticleBody(): sanitized contentHtml when present, else the page's
  // existing plain-text/markdown renderer for articles saved before the Quill
  // board existed.

  var ALLOWED = { P: 1, BR: 1, STRONG: 1, EM: 1, U: 1, H2: 1, H3: 1, UL: 1, OL: 1, LI: 1, BLOCKQUOTE: 1, SPAN: 1 };
  var DROP_WITH_CONTENT = {
    SCRIPT: 1, STYLE: 1, IFRAME: 1, OBJECT: 1, EMBED: 1, NOSCRIPT: 1, TEMPLATE: 1, TEXTAREA: 1,
    TITLE: 1, SVG: 1, MATH: 1, SELECT: 1, XMP: 1, NOEMBED: 1, NOFRAMES: 1, PLAINTEXT: 1, HEAD: 1,
  };
  // Legacy (pre-Quill) articles are markdown rendered by marked, which passes
  // raw HTML straight through — so that output is sanitized too, with the
  // extra tags plain markdown produces. Links keep only an http(s)/mailto href.
  var LEGACY_EXTRA = {
    H1: 1, H4: 1, H5: 1, H6: 1, HR: 1, A: 1, B: 1, I: 1, S: 1, DEL: 1, CODE: 1, PRE: 1,
    TABLE: 1, THEAD: 1, TBODY: 1, TR: 1, TH: 1, TD: 1,
  };
  var SAFE_HREF_RE = /^(https?:|mailto:)/i;
  var SIZE_CLASS_RE = /^ql-size-(small|large|huge)$/;
  var COLOR_RE = /^(#[0-9a-f]{3}|#[0-9a-f]{6}|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\))$/i;

  function cleanAttributes(el) {
    var cls  = '';
    var bg   = '';
    var href = '';
    if (el.tagName.toUpperCase() === 'A') {
      var h = (el.getAttribute('href') || '').trim();
      if (SAFE_HREF_RE.test(h)) href = h;
    }
    if (el.tagName.toUpperCase() === 'SPAN') {
      (el.getAttribute('class') || '').split(/\s+/).forEach(function (t) {
        if (SIZE_CLASS_RE.test(t)) cls = t;
      });
      (el.getAttribute('style') || '').split(';').forEach(function (decl) {
        var idx = decl.indexOf(':');
        if (idx === -1) return;
        var prop = decl.slice(0, idx).trim().toLowerCase();
        var val  = decl.slice(idx + 1).trim();
        if (prop === 'background-color' && COLOR_RE.test(val)) bg = val;
      });
    }
    while (el.attributes.length) el.removeAttribute(el.attributes[0].name);
    if (cls) el.setAttribute('class', cls);
    if (bg)  el.setAttribute('style', 'background-color: ' + bg + ';');
    if (href) {
      el.setAttribute('href', href);
      el.setAttribute('rel', 'noopener noreferrer nofollow');
      el.setAttribute('target', '_blank');
    }
  }

  function cleanChildren(parent, legacy) {
    var child = parent.firstChild;
    while (child) {
      var next = child.nextSibling;
      if (child.nodeType === 1) {
        var tag = String(child.tagName).toUpperCase();
        if (DROP_WITH_CONTENT[tag]) {
          parent.removeChild(child);
        } else if (ALLOWED[tag] || (legacy && LEGACY_EXTRA[tag])) {
          cleanAttributes(child);
          cleanChildren(child, legacy);
        } else {
          // Unknown element: keep its (cleaned) children, drop the element.
          cleanChildren(child, legacy);
          while (child.firstChild) parent.insertBefore(child.firstChild, child);
          parent.removeChild(child);
        }
      } else if (child.nodeType !== 3) {
        parent.removeChild(child);   // comments, processing instructions, …
      }
      child = next;
    }
  }

  // DOMParser documents are inert (no script execution, no resource loads),
  // so parsing untrusted HTML here is safe; only the cleaned result is ever
  // inserted into the live page.
  // opts.legacy: also allow the markdown-output tags in LEGACY_EXTRA.
  function sanitizeArticleHtml(html, opts) {
    if (!html) return '';
    var doc = new DOMParser().parseFromString('<!DOCTYPE html><body>' + String(html) + '</body>', 'text/html');
    cleanChildren(doc.body, !!(opts && opts.legacy));
    return doc.body.innerHTML;
  }

  // Body HTML for an article record. `fallback(text)` is the calling page's
  // existing renderer for legacy plain-text articles (no contentHtml); its
  // output is sanitized with the legacy allowlist.
  function renderArticleBody(article, fallback) {
    var html = article && typeof article.contentHtml === 'string' ? article.contentHtml : '';
    if (html.trim()) return sanitizeArticleHtml(html);
    var text = (article && article.content) || '';
    return fallback ? sanitizeArticleHtml(fallback(text), { legacy: true }) : '';
  }

  global.IronInkArticleHtml = {
    sanitize:   sanitizeArticleHtml,
    renderBody: renderArticleBody,
  };
}(window));
