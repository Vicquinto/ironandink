(function (global) {
  'use strict';

  // A−/A/A+ for one pane: same steps and limits as the site's other text size
  // controls. Used by Dialogue and the paused Live Room.
  //   target  element whose font-size is set (its content is em-based)
  //   key     localStorage key (read on load, written only on a press)
  //   dec, reset, inc   button ids
  // At the default no size is set, so the pane looks as it does without this.
  var DEFAULT = 16, MIN = 12, MAX = 28, STEP = 2;

  function clamp(n) { return Math.min(MAX, Math.max(MIN, n)); }

  // The element that scrolls the target: itself, an ancestor, or the page.
  function scrollerOf(el) {
    for (var e = el; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
      if (e.scrollHeight > e.clientHeight && /^(auto|scroll)$/.test(getComputedStyle(e).overflowY)) return e;
    }
    return document.scrollingElement || document.documentElement;
  }

  // Resize without losing the reader's place: note the first visible block and
  // how far into it the view starts, apply, then scroll back to that point. A
  // view at its end stays there; one at the very top stays there.
  function keepPlace(target, apply) {
    var scroller = scrollerOf(target);
    var isPage = scroller === document.scrollingElement || scroller === document.documentElement;
    function viewTop() { return isPage ? 0 : scroller.getBoundingClientRect().top; }
    var atEnd = scroller === target && scroller.scrollTop > 0 &&
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 4;
    var top = viewTop(), anchor = null, into = 0, gap = 0;
    for (var i = 0; i < target.children.length; i++) {
      var rect = target.children[i].getBoundingClientRect();
      if (!rect.height || rect.bottom <= top) continue;
      anchor = target.children[i];
      if (rect.top < top) into = (top - rect.top) / rect.height;
      else gap = rect.top - top;
      break;
    }
    apply();
    if (atEnd) { scroller.scrollTop = scroller.scrollHeight; return; }
    if (!anchor || (!into && scroller.scrollTop === 0)) return;
    var now = anchor.getBoundingClientRect();
    scroller.scrollTop += now.top + into * now.height - gap - viewTop();
  }

  function attach(opts) {
    var target = opts.target;
    if (!target) return;
    var size = DEFAULT;
    try { var saved = parseInt(localStorage.getItem(opts.key), 10); if (saved) size = clamp(saved); } catch (e) {}
    function apply() { target.style.fontSize = size === DEFAULT ? '' : size + 'px'; }
    function change(n) {
      keepPlace(target, function () { size = clamp(n); apply(); });
      try { localStorage.setItem(opts.key, size); } catch (e) {}
    }
    function bind(id, fn) { var b = document.getElementById(id); if (b) b.addEventListener('click', fn); }
    apply();
    bind(opts.dec,   function () { change(size - STEP); });
    bind(opts.reset, function () { change(DEFAULT); });
    bind(opts.inc,   function () { change(size + STEP); });
  }

  global.IronInkTextSize = { attach: attach };
}(window));
