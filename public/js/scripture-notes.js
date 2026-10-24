(function () {
  'use strict';

  // Chapter notes on the Scripture reader — personal notes pinned to a passage,
  // kept per chapter on the member's account (routes/scripture.js). They follow
  // the study notepad (notepad.js) and share its code: the same quote +
  // occurrence anchor (occurrenceOf / placeMarker), the same display-only
  // superscript marker, and the same note card (noteHtml). Notes are taken from
  // the highlight panel (library.js), which calls window.__scriptureNotes.
  //
  // The reader (scripture.js) announces 'scripture:chapter-change' when a chapter
  // starts loading and 'scripture:chapter-rendered' once its text is on the page;
  // the panel swaps notes on the first and redraws markers on the second.

  var body       = document.getElementById('scriptureBody');
  var sidebar    = document.getElementById('scripturePinSidebar');
  var listEl     = document.getElementById('scriptureNotesList');
  var emptyEl    = document.getElementById('scriptureNotesEmpty');
  var composer   = document.getElementById('scriptureNotesComposer');
  var anchorEl   = document.getElementById('scriptureNotesAnchor');
  var inputEl    = document.getElementById('scriptureNotesInput');
  var saveBtn    = document.getElementById('scriptureNotesSave');
  var cancelBtn  = document.getElementById('scriptureNotesCancel');
  var toggleBtn  = document.getElementById('scriptureNotesToggle');
  var bookSelect    = document.getElementById('bookSelect');
  var chapterSelect = document.getElementById('chapterSelect');
  if (!body || !sidebar || !listEl || !bookSelect || !chapterSelect) return;

  var MARKER_CLASS = 'scripture-note-marker';
  var NOTE_MAX     = 5000;   // same caps as the server (routes/scripture.js)
  var QUOTE_MAX    = 2000;
  var SNIPPET_MAX  = 90;     // quote shown on a card is a short snippet

  var cur           = { book: '', chapter: 0 };
  var notes         = [];
  var loadedKey     = null;  // chapter whose notes are in `notes`
  var renderedKey   = null;  // chapter whose text is in the reader
  var editingId     = null;
  var pendingAnchor = null;  // anchor while composing a note in the panel

  // ── Utilities ─────────────────────────────────────────────────────────────

  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function cssEsc(s) {
    return String(s).replace(/["\\]/g, '\\$&');
  }

  // Shared anchoring + card helpers live in notepad.js (loaded on every page).
  function np() { return window.__notepad || null; }

  function key(book, chapter) { return book + '|' + chapter; }
  function curKey() { return key(cur.book, cur.chapter); }

  function apiBase(book, chapter) {
    return '/api/scripture-notes/' + encodeURIComponent(book) + '/' + encodeURIComponent(chapter);
  }

  function refLabel(note) {
    var r = cur.book + ' ' + cur.chapter + ':' + note.verseStart;
    if (note.verseEnd && note.verseEnd !== note.verseStart) r += '–' + note.verseEnd;
    return r;
  }

  // Verse order, then the order written — the same order the server returns.
  function sortNotes(list) {
    return list.slice().sort(function (a, b) {
      return (a.verseStart - b.verseStart) ||
             (a.verseEnd - b.verseEnd) ||
             (new Date(a.ts) - new Date(b.ts));
    });
  }

  function toast(msg, isError) {
    var t = document.createElement('div');
    t.className = 'toast-msg' + (isError ? ' toast-error' : '');
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { t.classList.add('visible'); });
    });
    setTimeout(function () {
      t.classList.remove('visible');
      setTimeout(function () { t.remove(); }, 350);
    }, 2800);
  }

  // ── Selection → anchor ────────────────────────────────────────────────────
  // Called by the highlight panel while the selection is still live. Returns
  // { book, chapter, quote, text, occurrence, verseStart, verseEnd }, or null
  // when the selection holds no verse text. The quote leaves verse numbers and
  // markers out, so it matches the clean text placeMarker searches — verses run
  // straight together in it ("…life.For God…"), as they do in that text. `text`
  // is the same passage with a space between verses: what the panel shows and
  // looks up. Only `quote` is ever used as the anchor.

  function stripNonText(frag) {
    frag.querySelectorAll('.verse-num, .' + MARKER_CLASS).forEach(function (n) { n.remove(); });
    return frag.textContent || '';
  }

  function verseNumOf(p) {
    var sup = p.querySelector('.verse-num');
    var n = sup ? parseInt(sup.textContent, 10) : NaN;
    return isNaN(n) ? null : n;
  }

  function captureSelection() {
    if (renderedKey !== curKey()) return null;
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return null;
    var range = sel.getRangeAt(0);
    if (!body.contains(range.commonAncestorContainer)) return null;

    var quote = stripNonText(range.cloneContents()).trim();
    if (!quote || quote.length > QUOTE_MAX) return null;   // same cap as the server

    // Verses the highlight actually covers: those whose own text (number left
    // out) overlaps the selection. Robust to a triple-click, which ends the range
    // at the very start of the next verse.
    var verses = [], parts = [];
    body.querySelectorAll('.scripture-verse').forEach(function (p) {
      if (!range.intersectsNode(p)) return;
      var r = document.createRange();
      r.selectNodeContents(p);
      if (range.compareBoundaryPoints(Range.START_TO_START, r) > 0) r.setStart(range.startContainer, range.startOffset);
      if (range.compareBoundaryPoints(Range.END_TO_END, r) < 0) r.setEnd(range.endContainer, range.endOffset);
      var part = stripNonText(r.cloneContents()).trim();
      if (part) {
        parts.push(part);
        var n = verseNumOf(p);
        if (n != null) verses.push(n);
      }
    });
    if (!verses.length) return null;
    var text = parts.join(' ');
    if (text.length > QUOTE_MAX) return null;   // stored as displayQuote, same cap

    var occurrence = (np() && np().occurrenceOf)
      ? np().occurrenceOf(body, quote, range.startContainer, range.startOffset) : 0;

    return {
      book:       cur.book,
      chapter:    cur.chapter,
      quote:      quote,
      text:       text,
      occurrence: occurrence,
      verseStart: Math.min.apply(null, verses),
      verseEnd:   Math.max.apply(null, verses),
    };
  }

  // ── Load + render ─────────────────────────────────────────────────────────

  function fetchNotes() {
    var k = curKey(), book = cur.book, chapter = cur.chapter;
    fetch(apiBase(book, chapter))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (k !== curKey()) return;   // moved on to another chapter meanwhile
        if (!data.success) { showListMessage('Could not load notes.'); return; }
        notes     = sortNotes(data.notes || []);
        loadedKey = k;
        renderList();
        drawMarkers();
      })
      .catch(function () {
        if (k === curKey()) showListMessage('Could not load notes.');
      });
  }

  function showListMessage(msg) {
    if (emptyEl) emptyEl.style.display = 'none';
    listEl.innerHTML = '';
    var m = document.createElement('div');
    m.className = 'sps-empty-msg';
    m.textContent = msg;
    listEl.appendChild(m);
  }

  function renderList() {
    if (loadedKey !== curKey()) { showListMessage('Loading…'); return; }
    if (emptyEl) emptyEl.style.display = (notes.length || pendingAnchor) ? 'none' : '';
    if (!np() || !np().noteHtml) { listEl.innerHTML = ''; return; }
    listEl.innerHTML = notes.map(function (n) {
      return np().noteHtml(n, {
        // The spaced copy on notes that have one; older notes show the stored
        // quote. Display only — markers are placed from n.quote.
        quote:    n.displayQuote || n.quote,
        editing:  editingId === n.id,
        refLabel: refLabel(n),
        quoteMax: SNIPPET_MAX,
      });
    }).join('');
  }

  // Markers are drawn only once BOTH this chapter's notes and its text are in.
  // A note whose passage can't be found in the text on the page (e.g. it was
  // saved on NASB and the chapter came back as the ASV fallback) simply gets no
  // marker — its card stays in the panel with its verse reference.
  function drawMarkers() {
    if (!np() || !np().placeMarker) return;
    np().removeMarkers(body, MARKER_CLASS);
    if (loadedKey !== curKey() || renderedKey !== curKey()) return;
    notes.slice().sort(function (a, b) { return a.marker - b.marker; }).forEach(function (n) {
      // looseSpace: a note saved on text spaced differently from today's (the
      // NASB small-caps fix turned "B ehold ," into "Behold,") still finds its
      // passage. Exact matching is tried first.
      np().placeMarker(body, n, MARKER_CLASS, { looseSpace: true });
    });
  }

  function onChapterChange(book, chapter) {
    cur         = { book: book, chapter: chapter };
    notes       = [];
    loadedKey   = null;
    renderedKey = null;
    editingId   = null;
    clearPendingAnchor();
    renderList();
    fetchNotes();
  }

  document.addEventListener('scripture:chapter-change', function (e) {
    if (e.detail) onChapterChange(e.detail.book, e.detail.chapter);
  });

  document.addEventListener('scripture:chapter-rendered', function (e) {
    if (!e.detail || key(e.detail.book, e.detail.chapter) !== curKey()) return;
    renderedKey = curKey();
    drawMarkers();
  });

  // ── Card interactions (edit / delete / go to the passage) ─────────────────

  listEl.addEventListener('click', function (e) {
    var t = e.target;
    var btn = t.closest('button');
    if (btn && btn.classList.contains('notepad-note-del-btn'))  { deleteNote(btn.dataset.id); return; }
    if (btn && btn.classList.contains('notepad-note-edit-btn')) { editingId = btn.dataset.id; renderList(); focusEdit(); return; }
    if (btn && btn.classList.contains('notepad-edit-cancel'))   { editingId = null; renderList(); return; }
    if (btn && btn.classList.contains('notepad-edit-save'))     { saveEdit(btn.dataset.id); return; }
    if (btn || t.closest('a, textarea')) return;

    var card = t.closest('.notepad-note');
    if (card) goToNote(card.getAttribute('data-note-id'));
  });

  function findNote(id) {
    for (var i = 0; i < notes.length; i++) if (notes[i].id === id) return notes[i];
    return null;
  }

  // Scroll to the note's verse (the reader's own scroll + verse flash) and flash
  // its marker, when it has one.
  function goToNote(id) {
    var note = findNote(id);
    if (!note) return;
    if (window.__scriptureReader) window.__scriptureReader.scrollToVerse(note.verseStart);
    var marker = body.querySelector('.' + MARKER_CLASS + '[data-note-id="' + cssEsc(id) + '"]');
    if (marker) {
      marker.classList.add('scripture-note-marker--flash');
      setTimeout(function () { marker.classList.remove('scripture-note-marker--flash'); }, 1600);
    }
  }

  function focusEdit() {
    var ta = listEl.querySelector('.notepad-edit-input');
    if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
  }

  function saveEdit(id) {
    var ta = listEl.querySelector('.notepad-note[data-note-id="' + cssEsc(id) + '"] .notepad-edit-input');
    if (!ta) return;
    var content = ta.value;
    if (content.length > NOTE_MAX) { toast('Note is too long (' + NOTE_MAX + ' characters max).', true); return; }
    var k = curKey();
    fetch(apiBase(cur.book, cur.chapter) + '/note/' + encodeURIComponent(id), {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ content: content }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (k !== curKey()) return;
        if (!data.success) { toast(data.error || 'Could not save the note.', true); return; }
        var n = findNote(id);
        if (n) n.content = content;
        editingId = null;
        renderList();
      })
      .catch(function () { toast('Could not save the note.', true); });
  }

  function deleteNote(id) {
    // Same styled confirmation the study notepad uses (modal.js).
    var k = curKey(), book = cur.book, chapter = cur.chapter;
    var doDelete = function () {
      fetch(apiBase(book, chapter) + '/note/' + encodeURIComponent(id), { method: 'DELETE' })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (k !== curKey() || !data.success) return;
          notes = notes.filter(function (x) { return x.id !== id; });
          if (editingId === id) editingId = null;
          renderList();
          drawMarkers();
        })
        .catch(function () {});
    };
    if (typeof window.showConfirm === 'function') {
      window.showConfirm('Delete this note? This cannot be undone.', 'Delete', doDelete);
    } else {
      doDelete();
    }
  }

  // ── Saving (from the highlight panel, or the composer below) ──────────────

  // anchor: from captureSelection(). data: { question, content, source }.
  // cb(ok) — errors are reported here, so callers only handle success.
  function saveNote(anchor, data, cb) {
    data = data || {};
    if (!anchor) { if (cb) cb(false); return; }
    var content = data.content != null ? String(data.content) : '';
    if (content.length > NOTE_MAX) {
      toast('Note is too long to keep (' + NOTE_MAX + ' characters max).', true);
      if (cb) cb(false);
      return;
    }
    fetch(apiBase(anchor.book, anchor.chapter) + '/note', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        quote:      anchor.quote,
        // Card display only; the note is anchored by quote + occurrence alone.
        displayQuote: anchor.text || null,
        occurrence: anchor.occurrence,
        verseStart: anchor.verseStart,
        verseEnd:   anchor.verseEnd,
        question:   data.question || null,
        content:    content,
        source:     data.source || 'personal',
      }),
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res.success || !res.note) {
          toast(res.error || 'Could not save the note.', true);
          if (cb) cb(false);
          return;
        }
        if (key(anchor.book, anchor.chapter) === curKey() && loadedKey === curKey()) {
          notes = sortNotes(notes.concat([res.note]));
          renderList();
          drawMarkers();
        }
        setCollapsed(false);   // reveal the panel so the note is seen landing
        if (cb) cb(true, res.note);
      })
      .catch(function () {
        toast('Could not save the note.', true);
        if (cb) cb(false);
      });
  }

  // Open the composer in the panel, anchored to a highlighted passage (the study
  // notepad's "Anchored to:" composer, here in the side panel).
  function startNote(anchor) {
    if (!anchor || key(anchor.book, anchor.chapter) !== curKey() || !composer) return;
    pendingAnchor = anchor;
    // Display only: the spaced passage. The note still saves against anchor.quote.
    var shown   = anchor.text || anchor.quote;
    var snippet = shown.length > SNIPPET_MAX
      ? shown.slice(0, SNIPPET_MAX).replace(/\s+\S*$/, '') + '…'
      : shown;
    var ref = anchor.book + ' ' + anchor.chapter + ':' + anchor.verseStart +
      (anchor.verseEnd !== anchor.verseStart ? '–' + anchor.verseEnd : '');
    anchorEl.innerHTML = '<span class="notepad-anchor-label">Anchored to ' + esc(ref) + ':</span> ' +
      '<span class="notepad-anchor-quote">“' + esc(snippet) + '”</span>';
    inputEl.value = '';
    composer.style.display = '';
    if (emptyEl) emptyEl.style.display = 'none';
    setCollapsed(false);
    composer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    setTimeout(function () { inputEl.focus(); }, 40);
  }

  function clearPendingAnchor() {
    pendingAnchor = null;
    if (composer) composer.style.display = 'none';
    if (inputEl) inputEl.value = '';
    if (emptyEl && loadedKey === curKey()) emptyEl.style.display = notes.length ? 'none' : '';
  }

  if (saveBtn) saveBtn.addEventListener('click', function () {
    if (!pendingAnchor) return;
    saveBtn.disabled = true;
    saveNote(pendingAnchor, { question: null, content: inputEl.value.trim(), source: 'personal' }, function (ok) {
      saveBtn.disabled = false;
      if (ok) clearPendingAnchor();
    });
  });
  if (cancelBtn) cancelBtn.addEventListener('click', clearPendingAnchor);

  // ── Marker click → reveal the note in the panel ───────────────────────────
  // Mirrors the study marker, which opens the notepad on its note.
  body.addEventListener('click', function (e) {
    var marker = e.target.closest ? e.target.closest('.' + MARKER_CLASS) : null;
    if (!marker) return;
    e.preventDefault();
    setCollapsed(false);
    var card = listEl.querySelector('.notepad-note[data-note-id="' + cssEsc(marker.getAttribute('data-note-id')) + '"]');
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    card.classList.add('notepad-note--flash');
    setTimeout(function () { card.classList.remove('notepad-note--flash'); }, 1600);
  });

  // ── Show / hide the panel ─────────────────────────────────────────────────
  // Same shape as the Writing page's Companion toggle (writing.js): toggle a
  // class that drops the panel from the flex row, persist to localStorage.
  var COLLAPSED_KEY = 'ironink_scripture_notes_collapsed';

  function setCollapsed(collapsed) {
    sidebar.classList.toggle('collapsed', collapsed);
    if (toggleBtn) toggleBtn.textContent = collapsed ? 'Show Notes' : 'Hide Notes';
    try { localStorage.setItem(COLLAPSED_KEY, collapsed); } catch (e) {}
  }

  (function initCollapsed() {
    var collapsed = false;
    try { collapsed = localStorage.getItem(COLLAPSED_KEY) === 'true'; } catch (e) {}
    setCollapsed(collapsed);
  })();

  if (toggleBtn) {
    toggleBtn.addEventListener('click', function () {
      setCollapsed(!sidebar.classList.contains('collapsed'));
    });
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  // scripture.js has already run: either the server's first paint is showing
  // (verses in the body) or a restored chapter is loading — in which case its
  // 'chapter-change' fired before this script, and 'chapter-rendered' is to come.
  onChapterChange(bookSelect.options[bookSelect.selectedIndex].text, parseInt(chapterSelect.value, 10));
  if (body.querySelector('.scripture-verse')) {
    renderedKey = curKey();
    drawMarkers();
  }

  window.__scriptureNotes = {
    captureSelection: captureSelection,
    saveNote:         saveNote,
    startNote:        startNote,
  };
})();
