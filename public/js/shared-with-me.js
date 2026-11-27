(function () {
  'use strict';

  // Library: the "Shared with me" tab. Study Notes other members have shared with
  // this member (routes/study-shares.js). The tab shows only when there is at
  // least one. library.js switches tabs; this fills the list, and refreshes it
  // each time the tab is opened. Built with createElement/textContent only.

  var tab  = document.getElementById('libSharedTab');
  var list = document.getElementById('sharedWithMeList');
  if (!tab || !list) return;

  var PART_NAMES = { recaps: 'Key points', points: 'Saved points', notes: 'Notes on the study', teaching: 'Full teaching' };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function fmtDate(iso) {
    var d = new Date(iso);
    return (!iso || isNaN(d)) ? '' : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }

  function load(showTab) {
    return fetch('/api/study-shares/with-me')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.success) throw new Error((d && d.error) || 'Shared Study Notes couldn’t be loaded.');
        var shares = d.shares || [];
        if (shares.length) tab.hidden = false;
        else if (showTab) tab.hidden = true;
        draw(shares);
      })
      .catch(function (err) {
        list.textContent = '';
        list.appendChild(el('p', 'library-loading-msg', err.message));
      });
  }

  function draw(shares) {
    list.textContent = '';
    if (!shares.length) {
      list.appendChild(el('p', 'library-loading-msg', 'Nothing is shared with you right now.'));
      return;
    }
    shares.forEach(function (s) {
      var card = el('div', 'shared-entry');
      card.appendChild(el('h3', 'shared-entry-title', s.topic));
      var when = fmtDate(s.sharedAt);
      card.appendChild(el('p', 'shared-entry-meta', 'Study Notes by ' + s.ownerName + (when ? ' · shared ' + when : '')));
      card.appendChild(el('p', 'shared-entry-parts', (s.parts || []).map(function (k) { return PART_NAMES[k] || k; }).join(' · ')));
      var row = el('div', 'shared-entry-actions');
      var open = el('a', 'sn-link', 'Open Study Notes');
      open.href = s.url;
      var study = el('a', 'sn-link', 'Read the study');
      study.href = s.studyUrl;
      var remove = el('button', 'sn-btn', 'Remove from my list');
      remove.type = 'button';
      remove.addEventListener('click', function () {
        var q = 'Remove this from your list? ' + s.ownerName + ' is still sharing it, and its link will still work.';
        function go() {
          remove.disabled = true;
          fetch('/api/study-shares/with-me/' + encodeURIComponent(s.id) + '/hide', { method: 'PUT' })
            .then(function (r) { return r.json(); })
            .then(function (d) { if (!d || !d.success) throw new Error((d && d.error) || 'Please try again.'); load(false); })
            .catch(function (err) {
              remove.disabled = false;
              if (typeof window.showAlert === 'function') window.showAlert(err.message); else window.alert(err.message);
            });
        }
        if (typeof window.showConfirm === 'function') window.showConfirm(q, 'Remove', go);
        else if (window.confirm(q)) go();
      });
      [open, study, remove].forEach(function (n) { row.appendChild(n); });
      card.appendChild(row);
      list.appendChild(card);
    });
  }

  tab.addEventListener('click', function () { load(false); });
  load(true);
})();
