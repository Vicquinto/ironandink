(function () {
  'use strict';

  // Study Map (routes/study-map.js) — the page's three views, its All /
  // Studying / Completed filter, and "Not now" on a Revisit or Continue
  // suggestion (also used by the Dashboard snapshot). All content is
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

  // All / Studying / Completed — one filter across all three views, remembered
  // the same way as the view. Entries carry data-status; groups with nothing
  // left are hidden; a section marked data-filterable="note" says so, one
  // marked "hide" is hidden; book tiles with no study in that state are quieted.
  var FILTER_KEY = 'ironink_study_map_filter';
  var FILTERS = ['all', 'studying', 'completed'];
  var EMPTY_NOTE = { studying: 'No studies in progress here.', completed: 'No completed studies here yet.' };

  function initFilter() {
    var btns = document.querySelectorAll('.sm-filter-btn');
    if (!btns.length) return;

    function apply(filter, remember) {
      if (FILTERS.indexOf(filter) === -1) filter = 'all';
      btns.forEach(function (b) {
        var on = b.dataset.filter === filter;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      function shows(el) { return filter === 'all' || el.dataset.status === filter; }

      document.querySelectorAll('.sm-entry[data-status]').forEach(function (li) { li.hidden = !shows(li); });
      document.querySelectorAll('.sm-entries').forEach(function (ul) {
        ul.hidden = !ul.querySelector('.sm-entry:not([hidden])');
      });
      document.querySelectorAll('.sm-group').forEach(function (g) {
        g.hidden = !g.querySelector('.sm-entry:not([hidden])');
      });
      document.querySelectorAll('[data-filterable]').forEach(function (sec) {
        var any = !!sec.querySelector('.sm-entry:not([hidden])');
        if (sec.dataset.filterable === 'hide') { sec.hidden = !any; return; }
        var note = sec.querySelector('.sm-filter-empty');
        if (note) {
          note.textContent = EMPTY_NOTE[filter] || '';
          note.hidden = any;
        }
      });
      document.querySelectorAll('.sm-book-tile[data-statuses]').forEach(function (t) {
        var has = filter === 'all' || t.dataset.statuses.split(' ').indexOf(filter) !== -1;
        t.classList.toggle('is-filtered-out', !has);
      });
      if (remember) { try { localStorage.setItem(FILTER_KEY, filter); } catch (e) {} }
    }

    btns.forEach(function (b) {
      b.addEventListener('click', function () { apply(b.dataset.filter, true); });
    });
    var start = null;
    try { start = localStorage.getItem(FILTER_KEY); } catch (e) {}
    apply(start || 'all', false);
  }

  function init() { initViews(); initFilter(); initRevisit(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
