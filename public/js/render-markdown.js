(function (global) {
  'use strict';

  // Shared study/markdown renderer. Single source of truth for both the
  // just-generated study view (study.js) and the saved-study view (library.js,
  // modal + inline). Consolidated from two byte-identical copies — do not fork
  // it again; edit here so both views always render identically.
  global.renderMarkdown = function renderMarkdown(text) {
    if (!text) return '';

    var html = text
      .replace(/^#### (.+)$/gm, '<h5 class="guide-h5">$1</h5>')
      .replace(/^### (.+)$/gm,  '<h4 class="guide-h4">$1</h4>')
      .replace(/^## (.+)$/gm,   '<h3 class="guide-h3">$1</h3>')
      .replace(/^# (.+)$/gm,    '<h2 class="guide-h2">$1</h2>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g,     '<em>$1</em>')
      .replace(/^---$/gm,        '<hr class="guide-hr">');

    var lines  = html.split('\n');
    var result = [];
    var inUl = false, inOl = false;

    lines.forEach(function (line) {
      var ulM = line.match(/^[-*] (.+)/);
      var olM = line.match(/^\d+\. (.+)/);
      var bqM = line.match(/^> (.+)/);

      if (bqM) {
        if (inUl) { result.push('</ul>'); inUl = false; }
        if (inOl) { result.push('</ol>'); inOl = false; }
        result.push('<blockquote class="guide-bq">' + bqM[1] + '</blockquote>');
      } else if (ulM) {
        if (inOl) { result.push('</ol>'); inOl = false; }
        if (!inUl) { result.push('<ul class="guide-list">'); inUl = true; }
        result.push('<li>' + ulM[1] + '</li>');
      } else if (olM) {
        if (inUl) { result.push('</ul>'); inUl = false; }
        if (!inOl) { result.push('<ol class="guide-list guide-ol">'); inOl = true; }
        result.push('<li>' + olM[1] + '</li>');
      } else {
        if (inUl) { result.push('</ul>'); inUl = false; }
        if (inOl) { result.push('</ol>'); inOl = false; }
        var t = line.trim();
        if (!t) {
          result.push('<div class="guide-spacer"></div>');
        } else if (t.startsWith('<h') || t.startsWith('<hr')) {
          result.push(t);
        } else {
          result.push('<p class="guide-p">' + t + '</p>');
        }
      }
    });

    if (inUl) result.push('</ul>');
    if (inOl) result.push('</ol>');
    return result.join('\n');
  };

}(window));
