(function () {
  'use strict';

  // Study Notes page (routes/study-notes.js). Read only. Study-text notes are
  // placed under their section with the notepad's own matcher (notepad.js
  // placeMarker), against the study drawn off the page. Full teaching loads
  // only when opened. Everything is built with createElement/textContent, except
  // note bodies (renderMarkdown) and teacher replies (IronInkTeacher.renderReply),
  // which both end in the shared sanitizer.

  var BOOT = window.STUDY_NOTES_BOOT || {};
  var body = document.getElementById('snBody');
  if (!body) return;

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

  // ── Which section each note belongs to: { noteId: N }. Notes not listed are
  // general: free notes, a quote not found, or text outside the lesson's
  // sections (the introduction, Further Studies).
  function placeNotes() {
    var out = {};
    if (!BOOT.content || !window.renderMarkdown || !window.__notepad || !window.IronInkTeacher) return out;
    var box = document.createElement('div');
    box.innerHTML = window.renderMarkdown(BOOT.content);
    var all = window.IronInkTeacher.sectionHeadings(box);
    var teachable = window.IronInkTeacher.teachableHeadings(box);
    (BOOT.notes || []).forEach(function (note) {
      if (!note.quote) return;
      // repair: find notes whose saved position is too high, as the reader does,
      // but report nothing back (this page writes nothing).
      var marker = window.__notepad.placeMarker(box, note, null, { repair: function () {} });
      if (!marker) return;
      var heading = null;
      all.forEach(function (h) {
        if (h.compareDocumentPosition(marker) & Node.DOCUMENT_POSITION_FOLLOWING) heading = h;
      });
      var n = heading ? teachable.indexOf(heading) + 1 : 0;
      if (n > 0) out[note.id] = n;
    });
    return out;
  }

  function noteCard(note) {
    var card = el('div', 'sn-note');
    if (note.quote) card.appendChild(el('blockquote', 'sn-note-quote', note.quote));
    if (note.question) card.appendChild(el('p', 'sn-note-question', note.question));
    if (note.content) {
      var c = el('div', 'sn-note-content');
      if (window.renderMarkdown) c.innerHTML = window.renderMarkdown(note.content);
      else c.textContent = note.content;
      card.appendChild(c);
    }
    if (note.quote && BOOT.openHref) {
      var a = el('a', 'sn-link sn-note-open', 'Open in the study');
      a.href = BOOT.openHref;
      card.appendChild(a);
    }
    return card;
  }

  function notesBlock(parent, title, notes) {
    if (!notes.length) return;
    if (title) parent.appendChild(el('h4', 'sn-sub', title));
    notes.forEach(function (n) { parent.appendChild(noteCard(n)); });
  }

  // ── Full teaching: a closed block that loads when first opened ───────────
  function teachingBlock(parent, label, query, showDates) {
    var d = el('details', 'sn-teaching');
    d.appendChild(el('summary', 'sn-teaching-label', label));
    var inner = el('div', 'sn-teaching-body');
    d.appendChild(inner);
    var loaded = false, busy = false;
    d.addEventListener('toggle', function () {
      if (!d.open || loaded || busy) return;
      busy = true;
      inner.textContent = '';
      inner.appendChild(el('p', 'sn-muted', 'Loading…'));
      fetch('/api/study-notes/' + encodeURIComponent(BOOT.studyId) + '/teaching?' + query)
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (!data || !data.success) throw new Error();
          loaded = true;
          inner.textContent = '';
          if (!data.lessons.length) { inner.appendChild(el('p', 'sn-muted', 'There is nothing here any more.')); return; }
          data.lessons.forEach(function (lesson) { renderLesson(inner, lesson, showDates); });
        })
        .catch(function () {
          inner.textContent = '';
          inner.appendChild(el('p', 'sn-muted', 'The teaching couldn’t be loaded. Close this and open it again to retry.'));
        })
        .then(function () { busy = false; });
    });
    parent.appendChild(d);
  }

  function renderLesson(parent, lesson, showDate) {
    var when = fmtDate(lesson.date);
    if (showDate) {
      parent.appendChild(el('p', 'sn-lesson-date', (lesson.current ? 'Current lesson' : 'Earlier lesson') + (when ? ' · ' + when : '')));
    }
    var box = el('div', 'sn-conversation');
    (lesson.messages || []).forEach(function (m) {
      var fromTeacher = m.role === 'assistant';
      var msg = el('div', 'chat-msg ' + (fromTeacher ? 'engine-msg' : 'user-msg'));
      msg.appendChild(el('div', 'msg-role', fromTeacher ? 'Teacher' : 'You'));
      var c = el('div', 'msg-content');
      if (fromTeacher && window.IronInkTeacher && window.IronInkTeacher.renderReply) c.innerHTML = window.IronInkTeacher.renderReply(m.content);
      else c.textContent = m.content;
      msg.appendChild(c);
      box.appendChild(msg);
    });
    parent.appendChild(box);
  }

  // ── Page ─────────────────────────────────────────────────────────────────
  var placed = placeNotes();
  var sections = BOOT.sections || [];
  var known = {};
  sections.forEach(function (s) { known[s.n] = true; });

  sections.forEach(function (s) {
    var notes = (BOOT.notes || []).filter(function (n) { return placed[n.id] === s.n; });
    var sec = el('section', 'sn-section' + (notes.length || s.teaching ? '' : ' is-empty'));
    sec.appendChild(el('h3', 'sn-title', s.title));
    notesBlock(sec, 'Your notes on the study', notes);
    if (s.teaching) teachingBlock(sec, 'Full teaching', 'section=' + s.n, true);
    body.appendChild(sec);
  });

  var general = (BOOT.notes || []).filter(function (n) { return !known[placed[n.id]]; });
  if (general.length) {
    var g = el('section', 'sn-section');
    g.appendChild(el('h3', 'sn-title', 'General notes'));
    notesBlock(g, null, general);
    body.appendChild(g);
  }

  var earlier = BOOT.earlier || [];
  var current = earlier.filter(function (e) { return e.current; });
  var kept    = earlier.filter(function (e) { return !e.current; });
  if (current.length) {
    var c = el('section', 'sn-section');
    c.appendChild(el('h3', 'sn-title', 'Earlier conversation'));
    c.appendChild(el('p', 'sn-muted', 'From before Study Notes began marking which section each part belongs to.'));
    current.forEach(function (e) { teachingBlock(c, 'Show the conversation', 'earlier=' + encodeURIComponent(e.key), false); });
    body.appendChild(c);
  }
  if (kept.length) {
    var k = el('section', 'sn-section');
    k.appendChild(el('h3', 'sn-title', 'Earlier lessons'));
    kept.forEach(function (e) {
      var when = fmtDate(e.date);
      teachingBlock(k, when ? 'Lesson from ' + when : 'Earlier lesson', 'earlier=' + encodeURIComponent(e.key), false);
    });
    body.appendChild(k);
  }
  if (!body.children.length) body.appendChild(el('p', 'sn-muted', 'Nothing here yet.'));

  if (window.IronInkTextSize) {
    window.IronInkTextSize.attach({
      target: body, key: 'ironink_study_notes_font_size',
      dec: 'snFontDec', reset: 'snFontReset', inc: 'snFontInc',
    });
  }
})();
