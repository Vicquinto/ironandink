(function () {
  'use strict';

  // Study Notes page (routes/study-notes.js). Study-text notes are
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
  // Keyed by query, so a saved point can open the block it came from.
  var blocks = {};
  function teachingBlock(parent, label, query, showDates) {
    var d = el('details', 'sn-teaching');
    d.appendChild(el('summary', 'sn-teaching-label', label));
    var inner = el('div', 'sn-teaching-body');
    d.appendChild(inner);
    var loaded = false, busy = false, want = null;
    function reveal() {
      if (!want || !loaded) return;
      var target = null;
      inner.querySelectorAll('.chat-msg').forEach(function (m) {
        if (m.getAttribute('data-session') === want.sessionId && m.getAttribute('data-index') === String(want.index)) target = m;
      });
      want = null;
      if (!target) return;
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      target.classList.remove('teacher-msg-return');
      void target.offsetWidth;
      target.classList.add('teacher-msg-return');
    }
    blocks[query] = function (show) {
      want = show;
      d.open = true;      // loads it, if it hasn't been opened yet
      reveal();
    };
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
          reveal();
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
      msg.setAttribute('data-session', lesson.sessionId);
      msg.setAttribute('data-index', String(m.index));
      msg.appendChild(el('div', 'msg-role', fromTeacher ? 'Teacher' : 'You'));
      var c = el('div', 'msg-content');
      if (fromTeacher && window.IronInkTeacher && window.IronInkTeacher.renderReply) c.innerHTML = window.IronInkTeacher.renderReply(m.content);
      else c.textContent = m.content;
      msg.appendChild(c);
      box.appendChild(msg);
    });
    parent.appendChild(box);
  }

  // ── Saved points ─────────────────────────────────────────────────────────
  function queryFor(show) {
    return show.earlier ? 'earlier=' + encodeURIComponent(show.earlier) : 'section=' + show.section;
  }
  function pointApi(id, method, data) {
    return fetch('/api/study-notes/' + encodeURIComponent(BOOT.studyId) + '/points/' + encodeURIComponent(id), {
      method: method, headers: { 'Content-Type': 'application/json' }, body: data ? JSON.stringify(data) : undefined,
    })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (!d || !d.success) throw new Error((d && d.error) || 'Please try again.'); return d; });
  }
  function alertSafe(msg) { if (typeof window.showAlert === 'function') window.showAlert(msg); else window.alert(msg); }
  function linkButton(text, onClick) {
    var b = el('button', 'sn-btn', text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  function pointCard(p, onGone) {
    var card = el('div', 'sn-note sn-point');
    if (p.part1) card.appendChild(el('p', 'sn-part1', 'From Part 1 (the opposing view)'));
    var text = el('div', 'sn-point-text');
    if (window.IronInkTeacher && window.IronInkTeacher.renderReply) text.innerHTML = window.IronInkTeacher.renderReply(p.content);
    else text.textContent = p.content;
    card.appendChild(text);
    var note = el('p', 'sn-point-note', p.note);
    note.hidden = !p.note;
    card.appendChild(note);
    var row = el('div', 'sn-point-row');
    card.appendChild(row);

    function edit() {
      row.hidden = true; note.hidden = true;
      var form = el('div', 'sn-point-form');
      var label = el('label', 'sn-muted', 'Your note');
      var input = el('textarea', 'point-note');
      input.id = 'note-' + p.id; label.htmlFor = input.id;
      input.rows = 3; input.maxLength = 500; input.value = p.note;
      var btns = el('div', 'sn-point-row');
      function done() { form.remove(); row.hidden = false; note.textContent = p.note; note.hidden = !p.note; editBtn.textContent = p.note ? 'Edit note' : 'Add a note'; }
      var save = linkButton('Save', function () {
        save.disabled = true;
        pointApi(p.id, 'PUT', { note: input.value })
          .then(function (d) { p.note = d.note || ''; done(); })
          .catch(function (err) { save.disabled = false; alertSafe(err.message); });
      });
      btns.appendChild(save); btns.appendChild(linkButton('Cancel', done));
      [label, input, btns].forEach(function (n) { form.appendChild(n); });
      card.appendChild(form);
      input.focus();
    }
    var editBtn = linkButton(p.note ? 'Edit note' : 'Add a note', edit);
    row.appendChild(editBtn);
    row.appendChild(linkButton('Delete', function () {
      function go() {
        pointApi(p.id, 'DELETE').then(function () { card.remove(); onGone(); }).catch(function (err) { alertSafe(err.message); });
      }
      var q = 'Delete this saved point and your note on it?';
      if (typeof window.showConfirm === 'function') window.showConfirm(q, 'Delete', go);
      else if (window.confirm(q)) go();
    }));
    if (p.show) {
      row.appendChild(linkButton('Show in the teaching', function () {
        var open = blocks[queryFor(p.show)];
        if (open) open(p.show);
      }));
    }
    return card;
  }
  // The points under one heading; the heading goes with the last of them.
  function pointsBlock(parent, title, points) {
    if (!points.length) return;
    var wrap = el('div', 'sn-points');
    if (title) wrap.appendChild(el('h4', 'sn-sub', title));
    points.forEach(function (p) {
      wrap.appendChild(pointCard(p, function () { if (!wrap.querySelector('.sn-point')) wrap.remove(); }));
    });
    parent.appendChild(wrap);
  }

  // ── Page ─────────────────────────────────────────────────────────────────
  var placed = placeNotes();
  var sections = BOOT.sections || [];
  var known = {};
  sections.forEach(function (s) { known[s.n] = true; });

  sections.forEach(function (s) {
    var notes = (BOOT.notes || []).filter(function (n) { return placed[n.id] === s.n; });
    var points = (BOOT.points || []).filter(function (p) { return p.section === s.n; });
    var sec = el('section', 'sn-section' + (notes.length || points.length || s.teaching ? '' : ' is-empty'));
    sec.appendChild(el('h3', 'sn-title', s.title));
    pointsBlock(sec, 'Your saved points', points);
    notesBlock(sec, 'Your notes on the study', notes);
    if (s.teaching) teachingBlock(sec, 'Full teaching', 'section=' + s.n, true);
    body.appendChild(sec);
  });

  [['lesson', 'Other points'], ['check', 'From your understanding check']].forEach(function (x) {
    var rest = (BOOT.points || []).filter(function (p) { return p.kind === x[0] && !known[p.section]; });
    if (!rest.length) return;
    var o = el('section', 'sn-section');
    o.appendChild(el('h3', 'sn-title', x[1]));
    pointsBlock(o, null, rest);
    body.appendChild(o);
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
