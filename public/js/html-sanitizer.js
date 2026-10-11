(function (global) {
  'use strict';

  // ── Shared HTML allowlist sanitizer ─────────────────────────────────────────
  // Every piece of stored or generated content that reaches the page as HTML —
  // markdown rendered by marked or by renderMarkdown (studies, devotionals,
  // pins, notes, AI answers) and the Writing board's formatted article HTML —
  // is run through here before it is assigned to innerHTML. Loaded on every
  // layout page (routes/layout.js), before any page script.
  //
  // Approach (same as the article sanitizer it grew out of): parse into an
  // inert DOMParser document (no script execution, no resource loads), walk
  // it, keep only allowlisted elements with allowlisted attributes, unwrap
  // unknown elements (keeping their text), drop script-like elements with
  // their content, then serialize. Two profiles:
  //   article   exactly what the Quill board's toolbar produces — the client
  //             twin of lib/articleHtml.js (keep the two identical)
  //   markdown  what marked / renderMarkdown output for normal content:
  //             headings, paragraphs, lists, blockquotes, emphasis, code,
  //             tables, rules, links (http/https/mailto only), plus the
  //             guide-* classes renderMarkdown emits (study styling and the
  //             p.guide-p hook enhance-further-studies.js relies on)

  var DROP_WITH_CONTENT = {
    SCRIPT: 1, STYLE: 1, IFRAME: 1, FRAME: 1, FRAMESET: 1, OBJECT: 1, EMBED: 1, NOSCRIPT: 1,
    TEMPLATE: 1, TEXTAREA: 1, TITLE: 1, SVG: 1, MATH: 1, SELECT: 1, XMP: 1, NOEMBED: 1,
    NOFRAMES: 1, PLAINTEXT: 1, HEAD: 1, LINK: 1, META: 1, BASE: 1,
  };

  function tagSet(list) {
    var o = {};
    list.split(/\s+/).forEach(function (t) { if (t) o[t] = 1; });
    return o;
  }

  var SIZE_CLASS_RE  = /^ql-size-(small|large|huge)$/;
  var GUIDE_CLASS_RE = /^guide-(h2|h3|h4|h5|hr|bq|list|ol|spacer|p|vnum)$/;
  var COLOR_RE = /^(#[0-9a-f]{3}|#[0-9a-f]{6}|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\))$/i;
  var SAFE_HREF_RE = /^(https?:|mailto:)/i;

  var PROFILES = {
    article: {
      tags:      tagSet('P BR STRONG EM U H2 H3 UL OL LI BLOCKQUOTE SPAN'),
      classOk:   function (t) { return SIZE_CLASS_RE.test(t); },
      highlight: true,
      links:     false,
    },
    markdown: {
      tags: tagSet('P BR HR DIV SPAN H1 H2 H3 H4 H5 H6 STRONG B EM I U S DEL SUP SUB ' +
                   'CODE PRE BLOCKQUOTE UL OL LI A TABLE THEAD TBODY TR TH TD'),
      classOk:   function (t) { return GUIDE_CLASS_RE.test(t) || SIZE_CLASS_RE.test(t); },
      highlight: true,
      links:     true,
      verseNums: true,
    },
  };

  // ── Verse numbers ───────────────────────────────────────────────────────────
  // Multi-verse quotations in studies store each verse's number as Unicode
  // superscript digits ("¹⁰And not only this… ¹¹for though…" — lib/asv.js),
  // plain text that every renderer passes through safely. Here, on the inert
  // parsed tree (after cleaning, so nothing from the input can ride along), each
  // run becomes <sup class="guide-vnum">10</sup>: small and styled, and a real
  // element that note anchoring (notepad.js buildCleanText), copy and the Ask
  // panel can skip — so the text around it is exactly what it was before verse
  // numbers existed. Built with createElement/textContent only; never strings.
  var SUPER_DIGITS = '⁰¹²³⁴⁵⁶⁷⁸⁹';
  var SUPER_RUN_RE = /[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g;
  var VNUM_SKIP = { CODE: 1, PRE: 1, SUP: 1, SUB: 1, A: 1 };

  function plainDigits(run) {
    var out = '';
    for (var i = 0; i < run.length; i++) out += String(SUPER_DIGITS.indexOf(run.charAt(i)));
    return out;
  }

  function markVerseNumbers(doc, root) {
    var walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */, null);
    var nodes = [], node;
    while ((node = walker.nextNode())) {
      if (!/[⁰¹²³⁴⁵⁶⁷⁸⁹]/.test(node.nodeValue || '')) continue;
      var skip = false;
      for (var p = node.parentNode; p && p !== root; p = p.parentNode) {
        if (VNUM_SKIP[String(p.tagName).toUpperCase()]) { skip = true; break; }
      }
      if (!skip) nodes.push(node);
    }
    nodes.forEach(function (tn) {
      var text = tn.nodeValue, frag = doc.createDocumentFragment(), last = 0, m;
      SUPER_RUN_RE.lastIndex = 0;
      while ((m = SUPER_RUN_RE.exec(text))) {
        if (m.index > last) frag.appendChild(doc.createTextNode(text.slice(last, m.index)));
        var sup = doc.createElement('sup');
        sup.className = 'guide-vnum';
        // The trailing space lives INSIDE the number, so a double-click on the
        // first word selects "for", not "11for" — and since anchoring, copy and
        // the Ask panel skip the whole <sup>, the space never reaches their text.
        sup.textContent = plainDigits(m[0]) + ' ';
        frag.appendChild(sup);
        last = m.index + m[0].length;
      }
      if (last < text.length) frag.appendChild(doc.createTextNode(text.slice(last)));
      tn.parentNode.replaceChild(frag, tn);
    });
  }

  // The selected/copied text of a Range WITHOUT verse numbers (or note markers):
  // what the reader means when they highlight "Isaac; for though the twins".
  // Returns null when the range holds no number, so callers keep their usual
  // Selection.toString() result unchanged in every other case.
  function rangeTextWithoutNumbers(range) {
    if (!range) return null;
    var frag = range.cloneContents();
    if (!frag.querySelector || !frag.querySelector('.guide-vnum')) return null;
    frag.querySelectorAll('.guide-vnum, .notepad-marker').forEach(function (el) { el.remove(); });
    return frag.textContent || '';
  }

  // Copy from a study: leave the verse numbers out, so pasted Scripture reads
  // "…Isaac; for though…" rather than "…Isaac; 11for though…". Only steps in when
  // the selection actually contains a number; anything else copies as normal.
  document.addEventListener('copy', function (e) {
    try {
      var sel = global.getSelection && global.getSelection();
      if (!sel || !sel.rangeCount || !e.clipboardData) return;
      var parts = [], html = [], found = false;
      for (var i = 0; i < sel.rangeCount; i++) {
        var r = sel.getRangeAt(i);
        var t = rangeTextWithoutNumbers(r);
        if (t != null) found = true;
        var frag = r.cloneContents();
        frag.querySelectorAll('.guide-vnum, .notepad-marker').forEach(function (el) { el.remove(); });
        var box = document.createElement('div');
        box.appendChild(frag);
        html.push(box.innerHTML);
        parts.push(t != null ? t : r.toString());
      }
      if (!found) return;
      e.clipboardData.setData('text/plain', parts.join('\n'));
      e.clipboardData.setData('text/html', html.join('\n'));
      e.preventDefault();
    } catch (err) { /* fall back to the browser's own copy */ }
  });

  function cleanAttributes(el, tag, profile) {
    var classes = [];
    var bg = '';
    var href = '';
    var start = '';
    (el.getAttribute('class') || '').split(/\s+/).forEach(function (t) {
      if (t && profile.classOk(t)) classes.push(t);
    });
    if (profile.highlight && tag === 'SPAN') {
      (el.getAttribute('style') || '').split(';').forEach(function (decl) {
        var idx = decl.indexOf(':');
        if (idx === -1) return;
        var prop = decl.slice(0, idx).trim().toLowerCase();
        var val  = decl.slice(idx + 1).trim();
        if (prop === 'background-color' && COLOR_RE.test(val)) bg = val;
      });
    }
    if (profile.links && tag === 'A') {
      var h = (el.getAttribute('href') || '').trim();
      if (SAFE_HREF_RE.test(h)) href = h;
    }
    if (tag === 'OL') {
      var s = (el.getAttribute('start') || '').trim();
      if (/^\d{1,6}$/.test(s)) start = s;
    }
    while (el.attributes.length) el.removeAttribute(el.attributes[0].name);
    if (classes.length) el.setAttribute('class', classes.join(' '));
    if (bg)    el.setAttribute('style', 'background-color: ' + bg + ';');
    if (start) el.setAttribute('start', start);
    if (href) {
      el.setAttribute('href', href);
      el.setAttribute('rel', 'noopener noreferrer nofollow');
      el.setAttribute('target', '_blank');
    }
  }

  function cleanChildren(parent, profile) {
    var child = parent.firstChild;
    while (child) {
      var next = child.nextSibling;
      if (child.nodeType === 1) {
        var tag = String(child.tagName).toUpperCase();
        if (DROP_WITH_CONTENT[tag]) {
          parent.removeChild(child);
        } else if (profile.tags[tag]) {
          cleanAttributes(child, tag, profile);
          cleanChildren(child, profile);
        } else {
          // Unknown element: keep its (cleaned) children, drop the element.
          cleanChildren(child, profile);
          while (child.firstChild) parent.insertBefore(child.firstChild, child);
          parent.removeChild(child);
        }
      } else if (child.nodeType !== 3) {
        parent.removeChild(child);   // comments, processing instructions, …
      }
      child = next;
    }
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // sanitize(html, 'article' | 'markdown') → safe HTML string.
  function sanitize(html, profileName) {
    if (!html) return '';
    var profile = PROFILES[profileName] || PROFILES.markdown;
    var doc = new DOMParser().parseFromString('<!DOCTYPE html><body>' + String(html) + '</body>', 'text/html');
    cleanChildren(doc.body, profile);
    if (profile.verseNums) markVerseNumbers(doc, doc.body);
    return doc.body.innerHTML;
  }

  // Minimal escape-first fallback used when marked isn't loaded: paragraphs on
  // blank lines, **bold**, *italic*, single newlines → <br>. Safe by
  // construction (escaped before any tag is added).
  function simpleMarkdown(text) {
    var escaped = String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return '<p>' + escaped.split(/\n\n+/).map(function (p) {
      return p.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
              .replace(/\*(.+?)\*/g, '<em>$1</em>')
              .replace(/\n/g, '<br>');
    }).join('</p><p>') + '</p>';
  }

  // Markdown text → safe HTML: marked (loaded globally by the layout) when
  // present, else simpleMarkdown; either way sanitized with the markdown
  // profile. marked passes raw HTML in its input straight through, which is
  // exactly why its output must never reach innerHTML unsanitized.
  function markdown(text) {
    if (!text) return '';
    var html;
    try {
      var m = global.marked;
      if (m) html = typeof m.parse === 'function' ? m.parse(String(text)) : m(String(text));
    } catch (e) { html = null; }
    if (html == null) html = simpleMarkdown(text);
    return sanitize(html, 'markdown');
  }

  global.IronInkSanitize = {
    sanitize: sanitize,
    markdown: markdown,
    escape:   escapeHtml,
    rangeTextWithoutNumbers: rangeTextWithoutNumbers,
  };
}(window));
