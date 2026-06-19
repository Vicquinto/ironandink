(function () {
  'use strict';

  var saveBtn    = document.getElementById('saveSelahBtn');
  var reflectBtn = document.getElementById('reflectBtn');
  var titleInput = document.getElementById('selahTitle');
  var bodyInput  = document.getElementById('selahBody');
  var reflectBox = document.getElementById('selahReflect');
  var reflectTxt = document.getElementById('selahReflectText');
  var entryList  = document.getElementById('selahEntriesList');
  var filterTabs = document.getElementById('selahFilterTabs');
  var catPicker  = document.getElementById('selahCatPicker');

  var allEntries    = [];
  var activeFilter  = 'All';
  var activeCategory = 'Journal';

  // ── Category picker ────────────────────────────────────────────────────────
  if (catPicker) {
    catPicker.querySelectorAll('.selah-cat-pick-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        catPicker.querySelectorAll('.selah-cat-pick-btn').forEach(function (b) {
          b.classList.remove('selah-cat-pick-btn--active');
        });
        btn.classList.add('selah-cat-pick-btn--active');
        activeCategory = btn.dataset.cat;
      });
    });
  }

  // ── Filter tabs ────────────────────────────────────────────────────────────
  if (filterTabs) {
    filterTabs.querySelectorAll('.selah-filter-tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        filterTabs.querySelectorAll('.selah-filter-tab').forEach(function (t) {
          t.classList.remove('active');
        });
        tab.classList.add('active');
        activeFilter = tab.dataset.filter;
        applyFilter();
      });
    });
  }

  function applyFilter() {
    var filtered = activeFilter === 'All'
      ? allEntries
      : allEntries.filter(function (e) {
          return (e.category || 'Journal') === activeFilter;
        });
    renderEntries(filtered, activeFilter);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatDate(iso) {
    return new Date(iso).toLocaleDateString('en-US', {
      weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
    });
  }

  // ── Render entries ─────────────────────────────────────────────────────────
  function renderEntries(entries, filter) {
    if (!entries || entries.length === 0) {
      var msg = (filter && filter !== 'All')
        ? 'No ' + filter + ' entries yet.'
        : 'No entries yet. Begin writing above.';
      entryList.innerHTML = '<p class="selah-no-entries">' + msg + '</p>';
      return;
    }

    entryList.innerHTML = entries.map(function (e) {
      var cat      = e.category || 'Journal';
      var catSlug  = cat.toLowerCase();
      var catBadge = '<span class="selah-cat-badge selah-cat-badge--' + catSlug + '">' + escapeHtml(cat) + '</span>';

      var titleHtml = e.title
        ? '<span class="selah-entry-title">'                         + escapeHtml(e.title) + '</span>'
        : '<span class="selah-entry-title selah-entry-untitled">Untitled</span>';

      var preview = e.content.length > 200
        ? e.content.slice(0, 200) + '…'
        : e.content;

      return (
        '<div class="selah-entry" data-id="' + e.id + '">' +
          '<div class="selah-entry-header">' +
            '<div class="selah-entry-header-left">' +
              catBadge +
              titleHtml +
            '</div>' +
            '<span class="selah-entry-date">' + formatDate(e.createdAt) + '</span>' +
          '</div>' +
          '<div class="selah-entry-preview">' + escapeHtml(preview) + '</div>' +
          '<div class="selah-entry-full" id="full-' + e.id + '" style="display:none;">' + escapeHtml(e.content) + '</div>' +
          (e.reflectionText
            ? '<div class="selah-entry-reflection" id="refl-' + e.id + '" style="display:none;">' +
                '<div class="selah-reflect-label">A word for your reflection</div>' +
                '<div class="selah-reflect-text">' + escapeHtml(e.reflectionText) + '</div>' +
              '</div>'
            : '') +
          '<div class="selah-entry-footer">' +
            '<button class="selah-expand-btn" data-id="' + e.id + '">Read</button>' +
            '<button class="selah-delete-btn" data-id="' + e.id + '">Delete</button>' +
          '</div>' +
        '</div>'
      );
    }).join('');

    entryList.querySelectorAll('.selah-expand-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id      = btn.dataset.id;
        var fullDiv = document.getElementById('full-' + id);
        var reflDiv = document.getElementById('refl-' + id);
        var entry   = btn.closest('.selah-entry');
        var preview = entry.querySelector('.selah-entry-preview');
        var expanded = fullDiv.style.display !== 'none';
        fullDiv.style.display             = expanded ? 'none'  : 'block';
        preview.style.display             = expanded ? 'block' : 'none';
        if (reflDiv) reflDiv.style.display = expanded ? 'none'  : 'block';
        btn.textContent                   = expanded ? 'Read'  : 'Collapse';
      });
    });

    entryList.querySelectorAll('.selah-delete-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { deleteEntry(btn.dataset.id); });
    });
  }

  // ── Load / Delete ──────────────────────────────────────────────────────────
  function loadEntries() {
    fetch('/api/selah/entries')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.success) {
          allEntries = data.entries;
          applyFilter();
        }
      })
      .catch(function () {
        entryList.innerHTML = '<p class="selah-no-entries">Could not load entries.</p>';
      });
  }

  function deleteEntry(id) {
    if (!confirm('Delete this entry? This cannot be undone.')) return;
    fetch('/api/selah/entry/' + id, { method: 'DELETE' })
      .then(function (r) { return r.json(); })
      .then(function (data) { if (data.success) loadEntries(); });
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  saveBtn.addEventListener('click', function () {
    var title   = titleInput.value.trim();
    var content = bodyInput.value.trim();
    if (!content) { bodyInput.focus(); return; }

    var reflectionText = (reflectBox.style.display !== 'none' && reflectTxt.textContent.trim())
      ? reflectTxt.textContent.trim()
      : '';

    saveBtn.disabled    = true;
    saveBtn.textContent = 'Saving…';

    fetch('/api/selah/save', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        title:          title,
        content:        content,
        reflectionText: reflectionText,
        category:       activeCategory,
      }),
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      saveBtn.disabled    = false;
      saveBtn.textContent = 'Save Entry';
      if (data.success) {
        titleInput.value         = '';
        bodyInput.value          = '';
        reflectBox.style.display = 'none';
        // Reset picker to Journal
        if (catPicker) {
          catPicker.querySelectorAll('.selah-cat-pick-btn').forEach(function (b) {
            b.classList.toggle('selah-cat-pick-btn--active', b.dataset.cat === 'Journal');
          });
          activeCategory = 'Journal';
        }
        loadEntries();
      }
    })
    .catch(function () {
      saveBtn.disabled    = false;
      saveBtn.textContent = 'Save Entry';
    });
  });

  // ── Reflect ────────────────────────────────────────────────────────────────
  reflectBtn.addEventListener('click', function () {
    var content = bodyInput.value.trim();
    if (!content) { bodyInput.focus(); return; }

    reflectBtn.disabled    = true;
    reflectBtn.textContent = 'Reflecting…';
    reflectBox.style.display = 'none';

    fetch('/api/selah/reflect', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ content: content }),
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      reflectBtn.disabled    = false;
      reflectBtn.textContent = 'Reflect with AI';
      if (data.success) {
        reflectTxt.textContent   = data.reflection;
        reflectBox.style.display = 'block';
        reflectBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    })
    .catch(function () {
      reflectBtn.disabled    = false;
      reflectBtn.textContent = 'Reflect with AI';
    });
  });

  // ── Initial render ─────────────────────────────────────────────────────────
  if (typeof SELAH_INIT_ENTRIES !== 'undefined') {
    allEntries = SELAH_INIT_ENTRIES;
    applyFilter();
  } else {
    loadEntries();
  }
})();
