(function () {
  'use strict';

  // Floating Notepad — take notes while reading a study without ever altering the
  // study. Shell modeled on the mini-inbox (dm-widget.js): fixed-position, built
  // once, toggled by a keyboard shortcut (Ctrl+Alt+N), exposed on window. Adds
  // dragging, a minimize control, and position memory (localStorage). The editor
  // is a plain textarea; notes are written and stored as markdown (rendered with
  // the app-global `marked` on display), mirroring the Selah editor pattern.

  var POS_KEY = 'ironink_notepad_pos';

  var widgetEl     = null;
  var isOpen       = false;
  var isMinimized  = false;
  var curStudyId   = null;
  var curStudyName = '';
  var notesCache   = [];      // notes for the current study
  var pendingAnchor = null;   // { quote } while composing an anchored personal note
  var editingId    = null;    // note id currently being edited inline

  // ── Utilities ─────────────────────────────────────────────────────────────

  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderMd(text) {
    if (!text) return '';
    try {
      if (typeof marked !== 'undefined') {
        return typeof marked.parse === 'function' ? marked.parse(text) : marked(text);
      }
    } catch (e) { /* fall through */ }
    return '<p>' + esc(text).replace(/\n/g, '<br>') + '</p>';
  }

  var SOURCE_LABEL = {
    define:   'Define',
    explore:  'Explore',
    verse:    'Verse',
    personal: 'Note',
    free:     'Note',
  };

  function toast(msg) {
    // Reuse the app's toast if present; otherwise no-op quietly.
    if (typeof window.showToast === 'function') { window.showToast(msg); }
  }

  // ── Position memory ─────────────────────────────────────────────────────────

  function loadPos() {
    try { return JSON.parse(localStorage.getItem(POS_KEY) || '{}') || {}; }
    catch { return {}; }
  }

  function savePos() {
    if (!widgetEl) return;
    var pos = {
      left:      widgetEl.style.left,
      top:       widgetEl.style.top,
      minimized: isMinimized,
    };
    localStorage.setItem(POS_KEY, JSON.stringify(pos));
  }

  // ── Draggable header (clamped to viewport; ignores clicks on buttons) ───────
  function makeDraggable(el, handle) {
    var off = null;
    handle.addEventListener('mousedown', function (e) {
      if (e.target.closest('button')) return;
      var r = el.getBoundingClientRect();
      off = { x: e.clientX - r.left, y: e.clientY - r.top };
      document.body.style.userSelect = 'none';
    });
    document.addEventListener('mousemove', function (e) {
      if (!off) return;
      var vw = window.innerWidth, vh = window.innerHeight;
      var pw = el.offsetWidth,  ph = el.offsetHeight;
      el.style.left = Math.min(Math.max(0, e.clientX - off.x), vw - pw) + 'px';
      el.style.top  = Math.min(Math.max(0, e.clientY - off.y), vh - ph) + 'px';
    });
    document.addEventListener('mouseup', function () {
      if (!off) return;
      off = null;
      document.body.style.userSelect = '';
      savePos();
    });
  }

  // ── Widget DOM (created once, reused) ───────────────────────────────────────

  function createWidget() {
    var el = document.createElement('div');
    el.id = 'notepadWidget';
    el.className = 'notepad-widget';
    el.style.display = 'none';
    el.setAttribute('aria-label', 'Notepad');
    el.innerHTML = [
      '<div class="notepad-header">',
        '<span class="notepad-title">Notepad</span>',
        '<kbd class="notepad-hint">Ctrl+Alt+N</kbd>',
        '<button class="notepad-min" id="notepadMin" aria-label="Minimize" title="Minimize">&#8211;</button>',
        '<button class="notepad-close" id="notepadClose" aria-label="Close" title="Close">&times;</button>',
      '</div>',
      '<div class="notepad-study" id="notepadStudy"></div>',
      '<div class="notepad-body" id="notepadBody">',
        '<div class="notepad-notes-list" id="notepadNotesList"></div>',
      '</div>',
      '<div class="notepad-composer" id="notepadComposer">',
        '<div class="notepad-anchor-banner" id="notepadAnchorBanner" style="display:none;"></div>',
        '<textarea class="notepad-input" id="notepadInput" rows="3" ',
          'placeholder="Write a note… (markdown: **bold**, *italic*, &gt; quote, # heading, - list)"></textarea>',
        '<div class="notepad-composer-actions">',
          '<button class="notepad-cancel-anchor" id="notepadCancelAnchor" style="display:none;">Cancel</button>',
          '<button class="notepad-add-btn" id="notepadAddBtn">Add Note</button>',
        '</div>',
      '</div>',
    ].join('');
    document.body.appendChild(el);

    // Restore saved position / minimized state
    var pos = loadPos();
    if (pos.left) el.style.left = pos.left;
    if (pos.top)  el.style.top  = pos.top;
    if (!pos.left && !pos.top) {
      // Default: bottom-right, mirroring the mini-inbox resting place
      el.style.right  = '20px';
      el.style.bottom = '20px';
    }

    document.getElementById('notepadClose').addEventListener('click', closeWidget);
    document.getElementById('notepadMin').addEventListener('click', toggleMinimize);
    document.getElementById('notepadAddBtn').addEventListener('click', addComposedNote);
    document.getElementById('notepadCancelAnchor').addEventListener('click', clearPendingAnchor);

    makeDraggable(el, el.querySelector('.notepad-header'));

    if (pos.minimized) { isMinimized = true; el.classList.add('notepad-minimized'); }

    return el;
  }

  // ── Open / close / minimize ─────────────────────────────────────────────────

  function toggleWidget() {
    if (isOpen) { closeWidget(); } else { openWidget(); }
  }

  function openWidget() {
    if (!widgetEl) widgetEl = createWidget();
    widgetEl.style.display = 'flex';
    isOpen = true;
    renderStudyLabel();
    refresh();
  }

  function closeWidget() {
    if (widgetEl) widgetEl.style.display = 'none';
    isOpen = false;
  }

  function toggleMinimize() {
    if (!widgetEl) return;
    isMinimized = !isMinimized;
    widgetEl.classList.toggle('notepad-minimized', isMinimized);
    var btn = document.getElementById('notepadMin');
    if (btn) btn.innerHTML = isMinimized ? '&#9633;' : '&#8211;';
    savePos();
  }

  // ── Study context ───────────────────────────────────────────────────────────

  function setStudy(studyId, studyName) {
    var changed = (studyId !== curStudyId);
    curStudyId   = studyId || null;
    curStudyName = studyName || '';
    if (changed) { notesCache = []; clearPendingAnchor(); }
    if (isOpen) { renderStudyLabel(); refresh(); }
  }

  function clearStudy() {
    curStudyId   = null;
    curStudyName = '';
    notesCache   = [];
    clearPendingAnchor();
    if (isOpen) { renderStudyLabel(); renderNotesList(); }
  }

  function renderStudyLabel() {
    var el = document.getElementById('notepadStudy');
    if (!el) return;
    el.textContent = curStudyId ? curStudyName : 'No study open';
    el.classList.toggle('notepad-study--empty', !curStudyId);
    var composer = document.getElementById('notepadComposer');
    if (composer) composer.style.display = curStudyId ? '' : 'none';
  }

  // ── Fetch + render notes ────────────────────────────────────────────────────

  function refresh() {
    if (!curStudyId) { notesCache = []; renderNotesList(); return; }
    var listEl = document.getElementById('notepadNotesList');
    if (listEl && !notesCache.length) {
      listEl.innerHTML = '<div class="notepad-empty">Loading…</div>';
    }
    fetch('/api/notepad/' + encodeURIComponent(curStudyId))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.success) { notesCache = data.notepad.notes || []; renderNotesList(); }
      })
      .catch(function () {
        if (listEl) listEl.innerHTML = '<div class="notepad-empty">Could not load notes.</div>';
      });
  }

  function noteHtml(note) {
    var markerBadge = (note.marker != null)
      ? '<span class="notepad-note-marker">' + esc(String(note.marker)) + '</span>'
      : '';
    var sourceBadge = '<span class="notepad-note-source notepad-src-' + esc(note.source) + '">' +
      esc(SOURCE_LABEL[note.source] || 'Note') + '</span>';
    var quoteHtml = note.quote
      ? '<div class="notepad-note-quote">' + esc(note.quote) + '</div>'
      : '';
    var questionHtml = note.question
      ? '<div class="notepad-note-question">Asked: ' + esc(note.question) + '</div>'
      : '';
    var bodyHtml = (editingId === note.id)
      ? '<div class="notepad-note-edit">' +
          '<textarea class="notepad-edit-input" rows="4">' + esc(note.content || '') + '</textarea>' +
          '<div class="notepad-edit-actions">' +
            '<button class="notepad-edit-cancel" data-id="' + esc(note.id) + '">Cancel</button>' +
            '<button class="notepad-edit-save" data-id="' + esc(note.id) + '">Save</button>' +
          '</div>' +
        '</div>'
      : '<div class="notepad-note-content">' +
          (note.content ? renderMd(note.content) : '<em class="notepad-note-blank">No note text yet — click Edit to add.</em>') +
        '</div>';

    return '<div class="notepad-note" data-note-id="' + esc(note.id) + '"' +
             (note.marker != null ? ' data-marker="' + esc(String(note.marker)) + '"' : '') + '>' +
        '<div class="notepad-note-head">' +
          markerBadge + sourceBadge +
          '<span class="notepad-note-spacer"></span>' +
          '<button class="notepad-note-edit-btn" data-id="' + esc(note.id) + '" title="Edit">&#9998;</button>' +
          '<button class="notepad-note-del-btn" data-id="' + esc(note.id) + '" title="Delete">&times;</button>' +
        '</div>' +
        quoteHtml + questionHtml + bodyHtml +
      '</div>';
  }

  function renderNotesList() {
    var listEl = document.getElementById('notepadNotesList');
    if (!listEl) return;

    if (!curStudyId) {
      listEl.innerHTML = '<div class="notepad-empty">Open a study in the Library to take notes.</div>';
      return;
    }
    if (!notesCache.length) {
      listEl.innerHTML = '<div class="notepad-empty">No notes yet. Highlight text in the study, or write one below.</div>';
      return;
    }

    listEl.innerHTML = notesCache.map(noteHtml).join('');

    listEl.querySelectorAll('.notepad-note-del-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { deleteNote(btn.dataset.id); });
    });
    listEl.querySelectorAll('.notepad-note-edit-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { editingId = btn.dataset.id; renderNotesList(); focusEdit(); });
    });
    listEl.querySelectorAll('.notepad-edit-cancel').forEach(function (btn) {
      btn.addEventListener('click', function () { editingId = null; renderNotesList(); });
    });
    listEl.querySelectorAll('.notepad-edit-save').forEach(function (btn) {
      btn.addEventListener('click', function () { saveEdit(btn.dataset.id); });
    });
  }

  function focusEdit() {
    var ta = document.querySelector('.notepad-edit-input');
    if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
  }

  // ── Composer (free note or pending anchored personal note) ──────────────────

  function setPendingAnchor(quote) {
    pendingAnchor = { quote: quote };
    var banner = document.getElementById('notepadAnchorBanner');
    var cancel = document.getElementById('notepadCancelAnchor');
    if (banner) {
      banner.style.display = '';
      banner.innerHTML = '<span class="notepad-anchor-label">Anchored to:</span> ' +
        '<span class="notepad-anchor-quote">“' + esc(quote) + '”</span>';
    }
    if (cancel) cancel.style.display = '';
    var addBtn = document.getElementById('notepadAddBtn');
    if (addBtn) addBtn.textContent = 'Save Anchored Note';
  }

  function clearPendingAnchor() {
    pendingAnchor = null;
    var banner = document.getElementById('notepadAnchorBanner');
    var cancel = document.getElementById('notepadCancelAnchor');
    if (banner) { banner.style.display = 'none'; banner.innerHTML = ''; }
    if (cancel) cancel.style.display = 'none';
    var addBtn = document.getElementById('notepadAddBtn');
    if (addBtn) addBtn.textContent = 'Add Note';
  }

  function addComposedNote() {
    if (!curStudyId) return;
    var input = document.getElementById('notepadInput');
    if (!input) return;
    var text = input.value.trim();
    // Free note requires text; anchored personal note may start empty (rare) but we
    // require at least the quote — which pendingAnchor guarantees.
    if (!text && !pendingAnchor) { input.focus(); return; }

    var payload = pendingAnchor
      ? { quote: pendingAnchor.quote, question: null, content: text, source: 'personal' }
      : { quote: null,                question: null, content: text, source: 'free' };

    var addBtn = document.getElementById('notepadAddBtn');
    if (addBtn) addBtn.disabled = true;

    postNote(payload, function (ok) {
      if (addBtn) addBtn.disabled = false;
      if (!ok) return;
      input.value = '';
      clearPendingAnchor();
      refreshAndMarkers();
    });
  }

  function postNote(payload, cb) {
    fetch('/api/notepad/' + encodeURIComponent(curStudyId) + '/note', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.success && data.note) {
          notesCache.push(data.note);
          notesCache = sortNotes(notesCache);
        }
        if (cb) cb(!!data.success, data.note);
      })
      .catch(function () { if (cb) cb(false); });
  }

  function sortNotes(notes) {
    return notes.slice().sort(function (a, b) {
      var am = (typeof a.marker === 'number') ? a.marker : Infinity;
      var bm = (typeof b.marker === 'number') ? b.marker : Infinity;
      if (am !== bm) return am - bm;
      return new Date(a.ts) - new Date(b.ts);
    });
  }

  function saveEdit(noteId) {
    var ta = document.querySelector('.notepad-note[data-note-id="' + cssEsc(noteId) + '"] .notepad-edit-input');
    if (!ta) return;
    var content = ta.value;
    fetch('/api/notepad/' + encodeURIComponent(curStudyId) + '/note/' + encodeURIComponent(noteId), {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ content: content }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.success) {
          var n = notesCache.find(function (x) { return x.id === noteId; });
          if (n) n.content = content;
          editingId = null;
          renderNotesList();
        }
      })
      .catch(function () {});
  }

  function deleteNote(noteId) {
    if (!window.confirm('Delete this note? This cannot be undone.')) return;
    fetch('/api/notepad/' + encodeURIComponent(curStudyId) + '/note/' + encodeURIComponent(noteId), {
      method: 'DELETE',
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.success) {
          notesCache = notesCache.filter(function (x) { return x.id !== noteId; });
          if (editingId === noteId) editingId = null;
          refreshAndMarkers();
        }
      })
      .catch(function () {});
  }

  function cssEsc(s) {
    return String(s).replace(/["\\]/g, '\\$&');
  }

  // Re-render the notes list and, if a study reader is on the page, refresh its
  // markers so numbering stays in sync after add/delete.
  function refreshAndMarkers() {
    renderNotesList();
    if (typeof window.__notepadRerenderMarkers === 'function') {
      window.__notepadRerenderMarkers();
    }
  }

  // ── Public entry points used by the tooltip (library.js) ────────────────────

  // (c) Anchored personal note: capture quote, open notepad, let the user write.
  function startAnchoredNote(studyId, studyName, quote) {
    setStudy(studyId, studyName);
    if (isMinimized) toggleMinimize();
    openWidget();
    setPendingAnchor(quote);
    var input = document.getElementById('notepadInput');
    if (input) { input.value = ''; setTimeout(function () { input.focus(); }, 40); }
  }

  // (b) Anchored lookup: save the highlighted quote + question + AI result. The
  // note is editable afterward so the user can trim long results.
  function saveLookupNote(studyId, studyName, data, doneCb) {
    setStudy(studyId, studyName);
    postNote({
      quote:    data.quote,
      question: data.question || null,
      content:  data.content || '',
      source:   data.source || 'personal',
    }, function (ok, note) {
      if (ok) {
        renderNotesList();
        if (typeof window.__notepadRerenderMarkers === 'function') window.__notepadRerenderMarkers();
      }
      if (doneCb) doneCb(ok, note);
    });
  }

  // ── Display-only markers in the study reader ────────────────────────────────
  // Injects superscript markers into an already-rendered container by matching
  // each anchored note's quote text. Never touches stored study content. If a
  // quote can't be found, no marker is rendered (the note still lists normally).
  function injectMarkers(container, studyId) {
    if (!container || !studyId) return;
    // Always clear any prior markers first so re-injection can't duplicate.
    removeMarkers(container);
    fetch('/api/notepad/' + encodeURIComponent(studyId))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.success) return;
        if (studyId === curStudyId) notesCache = data.notepad.notes || [];
        var anchored = (data.notepad.notes || []).filter(function (n) {
          return n.marker != null && n.quote;
        }).sort(function (a, b) { return a.marker - b.marker; });
        anchored.forEach(function (note) { placeMarker(container, note); });
      })
      .catch(function () {});
  }

  function removeMarkers(container) {
    container.querySelectorAll('.notepad-marker').forEach(function (m) { m.remove(); });
  }

  function placeMarker(container, note) {
    var quote = String(note.quote || '').trim();
    if (!quote) return;

    var walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
    var node;
    while ((node = walker.nextNode())) {
      var parent = node.parentNode;
      if (!parent) continue;
      if (parent.classList && parent.classList.contains('notepad-marker')) continue;
      var idx = node.nodeValue.indexOf(quote);
      if (idx !== -1) {
        var after = node.splitText(idx + quote.length);
        var sup = document.createElement('sup');
        sup.className = 'notepad-marker';
        sup.setAttribute('data-note-id', note.id);
        sup.setAttribute('data-marker', String(note.marker));
        sup.setAttribute('role', 'button');
        sup.setAttribute('tabindex', '0');
        sup.title = 'Note ' + note.marker;
        sup.textContent = note.marker;
        parent.insertBefore(sup, after);
        return; // one marker per note
      }
    }
    // Not found → graceful no-op.
  }

  // Marker click → open notepad and reveal the note.
  document.addEventListener('click', function (e) {
    var marker = e.target.closest ? e.target.closest('.notepad-marker') : null;
    if (!marker) return;
    e.preventDefault();
    var noteId = marker.getAttribute('data-note-id');
    openWidget();
    if (isMinimized) toggleMinimize();
    revealNote(noteId);
  });

  function revealNote(noteId) {
    // Ensure the list reflects the latest notes, then scroll + flash.
    function doReveal() {
      var el = document.querySelector('.notepad-note[data-note-id="' + cssEsc(noteId) + '"]');
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('notepad-note--flash');
      setTimeout(function () { el.classList.remove('notepad-note--flash'); }, 1600);
    }
    var exists = notesCache.some(function (n) { return n.id === noteId; });
    if (exists) { renderNotesList(); setTimeout(doReveal, 30); }
    else {
      // notesCache may be stale (e.g. panel first opened) — fetch then reveal
      fetch('/api/notepad/' + encodeURIComponent(curStudyId))
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.success) { notesCache = data.notepad.notes || []; renderNotesList(); setTimeout(doReveal, 30); }
        })
        .catch(function () {});
    }
  }

  // ── Keyboard shortcut: Ctrl+Alt+N (mirrors dm-badge.js's Ctrl+Alt+M) ────────

  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey && e.altKey && (e.key === 'n' || e.key === 'N')) {
      var tag = document.activeElement ? document.activeElement.tagName : '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      toggleWidget();
    }
  });

  // ── Public API ──────────────────────────────────────────────────────────────
  window.__notepad = {
    toggle:            toggleWidget,
    open:              openWidget,
    close:             closeWidget,
    setStudy:          setStudy,
    clearStudy:        clearStudy,
    refresh:           refresh,
    startAnchoredNote: startAnchoredNote,
    saveLookupNote:    saveLookupNote,
    injectMarkers:     injectMarkers,
    revealNote:        revealNote,
  };
})();
