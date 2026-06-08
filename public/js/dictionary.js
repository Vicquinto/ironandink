(function () {
  const READING_IDS = ['guideArea', 'modalBody', 'readingBody', 'communityReadBody'];

  function pageHasReadingContent() {
    return READING_IDS.some(function (id) { return document.getElementById(id); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    if (!pageHasReadingContent()) return;

    const definitionCache = new Map();
    let selectionTimer    = null;
    let tooltip           = null;
    let lastRect          = null;

    // Inject spin animation once
    var styleTag = document.createElement('style');
    styleTag.textContent = '@keyframes dictSpin{to{transform:rotate(360deg)}}';
    document.head.appendChild(styleTag);

    function buildTooltip() {
      var el = document.createElement('div');
      el.id = 'dictTooltip';
      el.setAttribute('role', 'tooltip');
      el.style.cssText = [
        'position:fixed',
        'z-index:99999',
        'max-width:320px',
        'width:max-content',
        'background:#2A1A0F',
        'border:1px solid #B38C33',
        'border-radius:6px',
        'padding:0.75rem 1rem',
        'box-shadow:0 4px 20px rgba(0,0,0,0.6)',
        'display:none',
        'pointer-events:auto',
      ].join(';');
      document.body.appendChild(el);
      return el;
    }

    function escapeHtml(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function positionTooltip(rect) {
      if (!tooltip) return;
      var ttWidth  = Math.min(320, window.innerWidth - 16);
      tooltip.style.maxWidth = ttWidth + 'px';

      // Force layout to measure height
      tooltip.style.visibility = 'hidden';
      tooltip.style.display    = 'block';
      var ttHeight = tooltip.offsetHeight;
      var margin   = 8;
      var vw = window.innerWidth;
      var vh = window.innerHeight;

      // Horizontal: centre on selection, clamp to viewport
      var left = rect.left + rect.width / 2 - ttWidth / 2;
      if (left < margin) left = margin;
      if (left + ttWidth + margin > vw) left = vw - ttWidth - margin;

      // Vertical: prefer above, fall back to below
      var top;
      if (rect.top >= ttHeight + margin) {
        top = rect.top - ttHeight - margin;
      } else {
        top = rect.bottom + margin;
      }

      tooltip.style.left       = left + 'px';
      tooltip.style.top        = top  + 'px';
      tooltip.style.visibility = 'visible';
    }

    function showLoading(term, rect) {
      if (!tooltip) tooltip = buildTooltip();
      lastRect = rect;

      tooltip.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">' +
          '<span style="font-family:\'EB Garamond\',Georgia,serif;color:#B38C33;font-size:14px;font-weight:bold;">' + escapeHtml(term) + '</span>' +
          '<button id="dictClose" style="background:none;border:none;color:#B38C33;cursor:pointer;font-size:14px;padding:0 0 0 8px;line-height:1;" aria-label="Close">&#10005;</button>' +
        '</div>' +
        '<div style="height:1px;background:#B38C33;opacity:0.35;margin-bottom:8px;"></div>' +
        '<div id="dictContent" style="color:#F7F0E0;font-size:13px;font-family:Georgia,serif;line-height:1.6;">' +
          '<div style="display:flex;align-items:center;gap:8px;">' +
            '<div style="width:14px;height:14px;border:2px solid rgba(179,140,51,0.25);border-top-color:#B38C33;border-radius:50%;animation:dictSpin 0.7s linear infinite;flex-shrink:0;"></div>' +
            '<span style="color:#EBD9C6;font-size:12px;">Looking up definition…</span>' +
          '</div>' +
        '</div>';

      positionTooltip(rect);

      document.getElementById('dictClose').addEventListener('click', function () {
        hideTooltip();
        if (window.getSelection) window.getSelection().removeAllRanges();
      });
    }

    function renderDefinition(data) {
      var el = document.getElementById('dictContent');
      if (!el) return;
      el.innerHTML = '<span>' + escapeHtml(data.definition) + '</span>';
      if (lastRect) positionTooltip(lastRect);
    }

    function renderError(msg) {
      var el = document.getElementById('dictContent');
      if (!el) return;
      el.innerHTML = '<span style="color:#EBD9C6;font-style:italic;">' + escapeHtml(msg) + '</span>';
      if (lastRect) positionTooltip(lastRect);
    }

    function hideTooltip() {
      if (tooltip) tooltip.style.display = 'none';
    }

    function countWords(str) {
      return str.trim().split(/\s+/).filter(Boolean).length;
    }

    function isInsideReadingContainer(node) {
      for (var i = 0; i < READING_IDS.length; i++) {
        var el = document.getElementById(READING_IDS[i]);
        if (el && el.contains(node)) return true;
      }
      return false;
    }

    function isEditableNode(node) {
      var el = node && (node.nodeType === 3 ? node.parentElement : node);
      if (!el) return false;
      var tag = (el.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return true;
      if (el.isContentEditable) return true;
      return false;
    }

    document.addEventListener('mouseup', function () {
      clearTimeout(selectionTimer);

      selectionTimer = setTimeout(function () {
        var sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return;

        var text = sel.toString().trim();
        if (!text) return;
        if (countWords(text) > 5) return;

        var anchorNode = sel.anchorNode;
        if (!anchorNode) return;
        if (isEditableNode(anchorNode)) return;
        if (!isInsideReadingContainer(anchorNode)) return;

        var range = sel.getRangeAt(0);
        var rect  = range.getBoundingClientRect();

        var cacheKey = text.toLowerCase();
        showLoading(text, rect);

        if (definitionCache.has(cacheKey)) {
          renderDefinition(definitionCache.get(cacheKey));
          return;
        }

        fetch('/api/dictionary/define', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ term: text }),
        })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (data.error) {
              renderError(data.error);
              return;
            }
            if (definitionCache.size >= 50) definitionCache.clear();
            definitionCache.set(cacheKey, data);
            renderDefinition(data);
          })
          .catch(function () {
            renderError('Definition unavailable. Try again.');
          });
      }, 400);
    });

    // Dismiss on outside click
    document.addEventListener('mousedown', function (e) {
      if (tooltip && tooltip.style.display !== 'none' && !tooltip.contains(e.target)) {
        hideTooltip();
      }
    });
  }
})();
