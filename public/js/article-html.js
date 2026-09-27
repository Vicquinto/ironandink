(function (global) {
  'use strict';

  // ── Article HTML (client) ───────────────────────────────────────────────────
  // Articles written on the Quill board carry `contentHtml` (sanitized HTML)
  // plus `content` (plain text). Every surface that renders an article body
  // (Writing print, My Articles, Community, Admin) goes through
  // renderArticleBody(): sanitized contentHtml when present, else the page's
  // existing plain-text/markdown renderer for articles saved before the Quill
  // board existed. The allowlists themselves live in the shared sanitizer
  // (public/js/html-sanitizer.js, loaded by the layout): the 'article'
  // profile mirrors lib/articleHtml.js on the server; legacy markdown output
  // uses the 'markdown' profile.

  // Fail closed if the shared sanitizer somehow didn't load: show text, never markup.
  function sanitizeArticleHtml(html, opts) {
    if (!html) return '';
    var S = global.IronInkSanitize;
    var profile = opts && opts.legacy ? 'markdown' : 'article';
    if (S) return S.sanitize(html, profile);
    var d = document.createElement('div');
    d.textContent = new DOMParser().parseFromString(String(html), 'text/html').body.textContent || '';
    return d.innerHTML;
  }

  // Body HTML for an article record. `fallback(text)` is the calling page's
  // existing renderer for legacy plain-text articles (no contentHtml); its
  // output is sanitized with the markdown profile.
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
