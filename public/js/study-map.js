(function () {
  'use strict';

  // Study Map (routes/study-map.js) — the page's three views, and "Not now" on
  // a Revisit suggestion (also used by the Dashboard snapshot). All content is
  // rendered and escaped on the server; this only shows, hides and dismisses.

  var VIEW_KEY = 'ironink_study_map_view';
  var VIEWS = ['areas', 'books', 'timeline'];

  function initViews() {
    var tabs  = document.querySelectorAll('.sm-tabs .lib-tab');
    var panes = document.querySelectorAll('.sm-view');
    if (!tabs.length || !panes.length) return;

    function show(view, remember) {
      if (VIEWS.indexOf(view) === -1) view = 'areas';
      tabs.forEach(function (t) {
        var on = t.dataset.view === view;
        t.classList.toggle('active', on);
        t.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      panes.forEach(function (p) { p.hidden = p.dataset.view !== view; });
      if (remember) { try { localStorage.setItem(VIEW_KEY, view); } catch (e) {} }
    }

    tabs.forEach(function (t) {
      t.addEventListener('click', function () { show(t.dataset.view, true); });
    });

    // A link to a book or area (e.g. from the Dashboard) opens the view that
    // holds it; otherwise the member's last view.
    var hash = (window.location.hash || '').replace(/^#/, '');
    var start = null;
    if (/^book-/.test(hash)) start = 'books';
    else if (/^area-/.test(hash)) start = 'areas';
    else if (VIEWS.indexOf(hash) !== -1) start = hash;
    if (!start) { try { start = localStorage.getItem(VIEW_KEY); } catch (e) {} }
    show(start || 'areas', false);
    if (hash && /^(book|area)-/.test(hash)) {
      var target = document.getElementById(hash);
      if (target && target.scrollIntoView) target.scrollIntoView({ block: 'start' });
    }
  }

  function initRevisit() {
    document.querySelectorAll('.sm-revisit').forEach(function (card) {
      var btn = card.querySelector('.sm-revisit-dismiss');
      if (!btn) return;
      btn.addEventListener('click', function () {
        // Hide at once; the server remembers so it stays hidden. A failed save
        // only means the suggestion may come back on a later visit.
        card.hidden = true;
        fetch('/api/study-map/revisit/dismiss', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ studyId: card.dataset.studyId }),
        }).catch(function () {});
      });
    });
  }

  function init() { initViews(); initRevisit(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
