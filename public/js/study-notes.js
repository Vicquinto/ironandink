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
  function pointApi(path, method, data) {
    return fetch('/api/study-notes/' + encodeURIComponent(BOOT.studyId) + '/points/' + path, {
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

  function pointCard(p, order) {
    var card = el('div', 'sn-note sn-point');
    card.setAttribute('data-order', String(order));
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
    row.appendChild(moveControl(p, card));
    row.appendChild(linkButton('Delete', function () {
      function go() {
        pointApi(p.id, 'DELETE').then(function () { card.remove(); settle(groups[groupKey(p)]); }).catch(function (err) { alertSafe(err.message); });
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
  // ── Move to section… ─────────────────────────────────────────────────────
  function noSectionLabel(p) { return p.kind === 'check' ? 'From your understanding check' : 'Other points'; }
  function moveControl(p, card) {
    var list = null;
    var btn = linkButton('Move to section…', function () { if (list) close(true); else open(); });
    btn.setAttribute('aria-expanded', 'false');

    function close(focusBack) {
      if (!list) return;
      list.remove(); list = null;
      btn.setAttribute('aria-expanded', 'false');
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onOutside);
      if (focusBack) btn.focus();
    }
    function onKey(e) { if (e.key === 'Escape') close(true); }
    function onOutside(e) { if (list && !list.contains(e.target) && e.target !== btn) close(false); }
    function open() {
      list = el('ul', 'sn-move-list');
      list.setAttribute('aria-label', 'Move this point to');
      var here = groupKey(p);
      sections.filter(function (s) { return s.n >= 1; })
        .map(function (s) { return { section: s.n, title: s.title }; })
        .concat([{ section: null, title: noSectionLabel(p) }])
        .forEach(function (o) {
          var isHere = o.section === null ? here === 'none-' + p.kind : here === 's' + o.section;
          var b = el('button', 'sn-move-option' + (isHere ? ' is-here' : ''), o.title);
          b.type = 'button';
          if (isHere) {
            b.setAttribute('aria-current', 'true');
            b.appendChild(el('span', 'sn-move-here', ' (here now)'));
          }
          b.addEventListener('click', function () { if (isHere) close(true); else move(o, b); });
          var li = el('li');
          li.appendChild(b);
          list.appendChild(li);
        });
      card.appendChild(list);
      btn.setAttribute('aria-expanded', 'true');
      document.addEventListener('keydown', onKey);
      document.addEventListener('click', onOutside);
      var first = list.querySelector('.is-here') || list.querySelector('button');
      if (first) first.focus();
    }
    function move(o) {
      var buttons = list.querySelectorAll('button');
      buttons.forEach(function (b) { b.disabled = true; });
      pointApi(p.id + '/section', 'PUT', { section: o.section })
        .then(function (d) {
          p.section = d.section === undefined ? null : d.section;
          close(false);
          placePoint(p, card);
          btn.focus({ preventScroll: true });
          card.scrollIntoView({ block: 'nearest' });
          if (liveEl) liveEl.textContent = 'Moved to ' + o.title;
        })
        .catch(function (err) {
          if (list) buttons.forEach(function (b) { b.disabled = false; });
          alertSafe(err.message);
        });
    }
    return btn;
  }

  // ── Where points sit: one group per section, and one for each kind of point
  // without a section. A group's heading goes with the last of its points.
  var groups = {};
  function addGroup(key, section, before, title, whenEmpty) {
    groups[key] = { section: section, before: before, title: title, whenEmpty: whenEmpty, wrap: null };
  }
  function groupKey(p) { return groups['s' + p.section] ? 's' + p.section : 'none-' + p.kind; }
  function settle(g) {
    if (g.wrap && !g.wrap.querySelector('.sn-point')) { g.wrap.remove(); g.wrap = null; }
    g.whenEmpty(!g.wrap);
  }
  function placePoint(p, card) {
    Object.keys(groups).forEach(function (k) {
      var old = groups[k];
      if (old.wrap && old.wrap.contains(card)) { card.remove(); settle(old); }
    });
    var g = groups[groupKey(p)];
    if (!g.wrap) {
      g.wrap = el('div', 'sn-points');
      if (g.title) g.wrap.appendChild(el('h4', 'sn-sub', g.title));
      g.section.insertBefore(g.wrap, g.before);
    }
    // In the order they were saved.
    var next = null;
    Array.prototype.slice.call(g.wrap.querySelectorAll('.sn-point')).forEach(function (c) {
      if (!next && +c.getAttribute('data-order') > +card.getAttribute('data-order')) next = c;
    });
    g.wrap.insertBefore(card, next);
    settle(g);
  }

  // ── Page ─────────────────────────────────────────────────────────────────
  var liveEl = el('p', 'lang-sr-only');
  liveEl.setAttribute('role', 'status');
  body.parentNode.appendChild(liveEl);
  var placed = placeNotes();
  var sections = BOOT.sections || [];
  var known = {};
  sections.forEach(function (s) { known[s.n] = true; });

  sections.forEach(function (s) {
    var notes = (BOOT.notes || []).filter(function (n) { return placed[n.id] === s.n; });
    var sec = el('section', 'sn-section');
    var h = el('h3', 'sn-title');
    // Opens the Teacher at this section, as "Teach me this section" does.
    if (BOOT.openHref && s.n >= 1 && window.IronInkTeacher && window.IronInkTeacher.teacherUrl) {
      var a = el('a', 'sn-title-link', s.title);
      a.href = window.IronInkTeacher.teacherUrl(BOOT.studyId, 'section', s.n);
      a.setAttribute('aria-label', 'Study this section with the Teacher: ' + s.title);
      h.appendChild(a);
    } else h.textContent = s.title;
    sec.appendChild(h);
    notesBlock(sec, 'Your notes on the study', notes);
    if (s.teaching) teachingBlock(sec, 'Full teaching', 'section=' + s.n, true);
    addGroup('s' + s.n, sec, h.nextSibling, 'Your saved points', function (none) {
      sec.classList.toggle('is-empty', none && !notes.length && !s.teaching);
    });
    settle(groups['s' + s.n]);
    body.appendChild(sec);
  });

  [['lesson', 'Other points'], ['check', 'From your understanding check']].forEach(function (x) {
    var o = el('section', 'sn-section');
    o.appendChild(el('h3', 'sn-title', x[1]));
    addGroup('none-' + x[0], o, null, null, function (none) { o.hidden = none; });
    settle(groups['none-' + x[0]]);
    body.appendChild(o);
  });
  (BOOT.points || []).forEach(function (p, i) { placePoint(p, pointCard(p, i)); });

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
  if (!body.querySelector('.sn-section:not([hidden])')) body.appendChild(el('p', 'sn-muted', 'Nothing here yet.'));

  if (window.IronInkTextSize) {
    window.IronInkTextSize.attach({
      target: body, key: 'ironink_study_notes_font_size',
      dec: 'snFontDec', reset: 'snFontReset', inc: 'snFontInc',
    });
  }
})();
