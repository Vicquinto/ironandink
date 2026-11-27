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
  // Read only: Study Notes shared with this member, or the owner's preview of a
  // share (routes/study-shares.js). The boot holds only the parts that are
  // shared; nothing on the page changes anything.
  var RO = BOOT.readOnly === true;
  function teachingBase() {
    return BOOT.teachingUrl || ('/api/study-notes/' + encodeURIComponent(BOOT.studyId) + '/teaching');
  }
  // "Discuss this" (study-discuss.js): only where the boot allows it (a shared
  // view, or the owner's page while the study is shared), and only on parts that
  // are shared. need: the part the item belongs to. The server checks again.
  function discussBtn(item, need) {
    if (!BOOT.canDiscuss || !window.IronInkDiscuss) return null;
    if (need && !(BOOT.discussParts || {})[need]) return null;
    var b = el('button', 'sn-btn sn-discuss', 'Discuss this');
    b.type = 'button';
    b.addEventListener('click', function () { window.IronInkDiscuss.open(item, b); });
    return b;
  }

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

  function noteCard(note, order) {
    var card = el('div', 'sn-note sn-studynote');
    card.setAttribute('data-order', String(order));
    card.setAttribute('data-item', 'n' + note.id);
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
    // A note with no quote can be filed under another section; one on
    // highlighted text stays with its text.
    var row = el('div', 'sn-point-row');
    if (!note.quote && !RO) row.appendChild(moveControl(note, card, noteMover));
    var talk = discussBtn({ kind: 'note', id: note.id }, 'notes');
    if (talk) row.appendChild(talk);
    if (row.firstChild) card.appendChild(row);
    return card;
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
      openSectionOf(d);
      d.open = true;      // loads it, if it hasn't been opened yet
      reveal();
    };
    d.addEventListener('toggle', function () {
      if (!d.open || loaded || busy) return;
      busy = true;
      inner.textContent = '';
      inner.appendChild(el('p', 'sn-muted', 'Loading…'));
      fetch(teachingBase() + '?' + query)
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
      msg.appendChild(el('div', 'msg-role', fromTeacher ? 'Teacher' : (RO ? (BOOT.ownerName || 'Member') : 'You')));
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
    card.setAttribute('data-item', 'p' + p.id);
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
    var editBtn = null;
    if (!RO) {
      editBtn = linkButton(p.note ? 'Edit note' : 'Add a note', edit);
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
    }
    if (p.show) {
      row.appendChild(linkButton('Show in the teaching', function () {
        var open = blocks[queryFor(p.show)];
        if (open) open(p.show);
      }));
    }
    var talk = discussBtn({ kind: 'point', id: p.id }, 'points');
    if (talk) row.appendChild(talk);
    row.hidden = !row.firstChild;
    return card;
  }
  // ── Move to section… ─────────────────────────────────────────────────────
  function noSectionLabel(p) { return p.kind === 'check' ? 'From your understanding check' : 'Other points'; }
  // What Move to section… does for a saved point and for a note.
  var pointMover = {
    what: 'point',
    none: function (p) { return noSectionLabel(p); },
    here: function (p) { return groupKey(p); },
    key:  function (p, section) { return section === null ? 'none-' + p.kind : 's' + section; },
    save: function (p, section) { return pointApi(p.id + '/section', 'PUT', { section: section }); },
    place: function (p, card) { placePoint(p, card); },
  };
  var noteMover = {
    what: 'note',
    none: function () { return 'Whole study (general)'; },
    here: function (n) { return noteKey(n.section); },
    key:  function (n, section) { return section === null ? 'note-general' : 'note-s' + section; },
    save: function (n, section) {
      return fetch('/api/notepad/' + encodeURIComponent(BOOT.studyId) + '/note/' + encodeURIComponent(n.id) + '/section', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ section: section }),
      })
        .then(function (r) { return r.json(); })
        .then(function (d) { if (!d || !d.success) throw new Error((d && d.error) || 'Please try again.'); return d; });
    },
    place: function (n, card) { placeInto(noteKey(n.section), card); },
  };
  function moveControl(p, card, mover) {
    mover = mover || pointMover;
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
      list.setAttribute('aria-label', 'Move this ' + mover.what + ' to');
      var here = mover.here(p);
      sections.filter(function (s) { return s.n >= 1; })
        .map(function (s) { return { section: s.n, title: s.title }; })
        .concat([{ section: null, title: mover.none(p) }])
        .forEach(function (o) {
          var isHere = here === mover.key(p, o.section);
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
      mover.save(p, o.section)
        .then(function (d) {
          p.section = d.section === undefined ? null : d.section;
          close(false);
          mover.place(p, card);
          openSectionOf(card);
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
  // card: the class of the cards this group holds.
  function addGroup(key, section, before, title, whenEmpty, card) {
    groups[key] = { section: section, before: before, title: title, whenEmpty: whenEmpty, wrap: null, card: card || 'sn-point' };
  }
  function noteKey(section) { return groups['note-s' + section] ? 'note-s' + section : 'note-general'; }
  function groupKey(p) { return groups['s' + p.section] ? 's' + p.section : 'none-' + p.kind; }
  function settle(g) {
    if (g.wrap && !g.wrap.querySelector('.' + g.card)) { g.wrap.remove(); g.wrap = null; }
    g.whenEmpty(!g.wrap);
  }
  function placePoint(p, card) { placeInto(groupKey(p), card); }
  function placeInto(key, card) {
    Object.keys(groups).forEach(function (k) {
      var old = groups[k];
      if (old.wrap && old.wrap.contains(card)) { card.remove(); settle(old); }
    });
    var g = groups[key];
    if (!g.wrap) {
      g.wrap = el('div', g.card === 'sn-point' ? 'sn-points' : 'sn-studynotes');
      if (g.title) g.wrap.appendChild(el('h4', 'sn-sub', g.title));
      g.section.insertBefore(g.wrap, g.before);
    }
    // In the order they were saved.
    var next = null;
    Array.prototype.slice.call(g.wrap.querySelectorAll('.' + g.card)).forEach(function (c) {
      if (!next && +c.getAttribute('data-order') > +card.getAttribute('data-order')) next = c;
    });
    g.wrap.insertBefore(card, next);
    settle(g);
  }

  // ── Key points: the section's recap, or a way to make one ────────────────
  function keyPoints(sec, s) {
    if (!s.recap && (RO || !s.canRecap)) return;
    var box = el('div', 'sn-keypoints');
    sec.appendChild(box);
    function draw() {
      box.textContent = '';
      box.appendChild(el('h4', 'sn-sub', 'Key points'));
      if (s.recap) {
        if (s.unfinished) box.insertBefore(el('p', 'sn-muted', 'You were partway through this section.'), box.firstChild);
        box.appendChild(window.IronInkTeacher.recapList(s.recap));
        box.appendChild(el('p', 'sn-muted', s.teaching ? 'An AI summary of the teaching below.' : 'An AI summary of the teaching.'));
        box.setAttribute('data-item', 'k' + s.n);
        var talk = discussBtn({ kind: 'recap', section: s.n }, 'recaps');
        if (talk) box.appendChild(talk);
        return;
      }
      box.appendChild(el('p', 'sn-muted', s.partway ? 'You were partway through this section.' : 'No recap yet.'));
      var status = el('p', 'sn-muted');
      status.setAttribute('role', 'status');
      var btn = linkButton('Create recap', function () {
        btn.disabled = true;
        status.textContent = 'Making the recap…';
        fetch('/api/study-notes/' + encodeURIComponent(BOOT.studyId) + '/recaps', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ section: s.n }),
        })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (!d || !d.success || !d.recap) throw new Error((d && d.error) || 'The recap couldn’t be made this time. Please try again.');
            s.recap = d.recap;
            draw();
            if (s.refresh) s.refresh();
          })
          .catch(function (err) { btn.disabled = false; status.textContent = err.message; });
      });
      box.appendChild(btn);
      box.appendChild(status);
    }
    draw();
  }

  // ── Collapsible sections ─────────────────────────────────────────────────
  // All closed to begin with; which ones are open is remembered per study in this
  // browser. Closing is done with a class (.is-collapsed), so print can show all.
  var OPEN_KEY = 'ironink_study_notes_open_' + (BOOT.foldKey || BOOT.studyId);
  var openKeys = {};
  try { (JSON.parse(localStorage.getItem(OPEN_KEY)) || []).forEach(function (k) { openKeys[k] = true; }); } catch (e) {}
  function saveOpen() {
    var list = Object.keys(openKeys).filter(function (k) { return openKeys[k]; });
    try {
      if (list.length) localStorage.setItem(OPEN_KEY, JSON.stringify(list));
      else localStorage.removeItem(OPEN_KEY);
    } catch (e) {}
  }
  function count(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  var folds = {};
  // inside(): what the section holds, as short phrases; none → a plain title with
  // no toggle. teachHref: the "Teach me this section" link, if there is one.
  function foldSection(key, title, teachHref) {
    var sec = el('section', 'sn-section');
    sec.setAttribute('data-key', key);
    var head = el('div', 'sn-head');
    var h = el('h3', 'sn-title');
    head.appendChild(h);
    if (teachHref) {
      var a = el('a', 'sn-link sn-teach', 'Teach me this section');
      a.href = teachHref;
      a.setAttribute('aria-label', 'Study this section with the Teacher: ' + title);
      head.appendChild(a);
    }
    var summary = el('p', 'sn-summary');
    var content = el('div', 'sn-content');
    content.id = 'sn-content-' + key;
    [head, summary, content].forEach(function (n) { sec.appendChild(n); });

    var btn = null;
    function show() {
      var open = !!openKeys[key];
      sec.classList.toggle('is-collapsed', !!btn && !open);
      if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    var fold = {
      title: title,
      content: content,
      sec: sec,
      inside: function () { return []; },
      refresh: function () {
        var parts = fold.inside();
        summary.textContent = parts.length ? parts.join(' · ') : (RO && /^s\d+$/.test(key) ? 'Nothing shared in this section.' : '');
        sec.classList.toggle('is-empty', !parts.length);
        if (parts.length && !btn) {
          h.textContent = '';
          btn = el('button', 'sn-toggle');
          btn.type = 'button';
          btn.setAttribute('aria-controls', content.id);
          var chev = el('span', 'sn-chevron', '▸');
          chev.setAttribute('aria-hidden', 'true');
          btn.appendChild(chev);
          btn.appendChild(el('span', 'sn-toggle-text', title));
          btn.addEventListener('click', function () { fold.set(!openKeys[key]); saveOpen(); });
          h.appendChild(btn);
        } else if (!parts.length) {
          btn = null;
          h.textContent = title;
        }
        show();
      },
      set: function (open) { openKeys[key] = open; show(); },
    };
    folds[key] = fold;
    return fold;
  }
  function openSectionOf(node) {
    var sec = node.closest('.sn-section');
    var fold = sec && folds[sec.getAttribute('data-key')];
    if (fold) { fold.set(true); saveOpen(); }
  }
  function setAll(open) {
    Object.keys(folds).forEach(function (k) { folds[k].set(open); });
    saveOpen();
  }

  // ── Page ─────────────────────────────────────────────────────────────────
  var liveEl = el('p', 'lang-sr-only');
  liveEl.setAttribute('role', 'status');
  body.parentNode.appendChild(liveEl);
  var placed = placeNotes();
  var sections = BOOT.sections || [];
  var known = {};
  sections.forEach(function (s) { known[s.n] = true; });

  function pointCount(fold) { return fold.content.querySelectorAll('.sn-point').length; }
  function noteCount(fold) { return fold.content.querySelectorAll('.sn-studynote').length; }
  // A note's section: where its quote is in the study, else the section it was
  // filed under, else none (General notes).
  function noteSection(n) {
    if (placed[n.id]) return placed[n.id];
    return (Number.isInteger(n.section) && known[n.section] && n.section >= 1) ? n.section : null;
  }

  sections.forEach(function (s) {
    // Opens the Teacher at this section, as the study's own buttons do.
    var canTeach = !RO && BOOT.openHref && s.n >= 1 && window.IronInkTeacher && window.IronInkTeacher.teacherUrl;
    var fold = foldSection('s' + s.n, s.title, canTeach ? window.IronInkTeacher.teacherUrl(BOOT.studyId, 'section', s.n) : null);
    var box = fold.content;
    fold.sec.setAttribute('data-item', 's' + s.n);
    // A thought about the section as a whole.
    var talkSec = discussBtn({ kind: 'section', section: s.n }, s.n === 0 ? 'teaching' : null);
    if (talkSec) fold.sec.querySelector('.sn-head').appendChild(talkSec);
    keyPoints(box, s);
    var pointSlot = box.appendChild(el('div', 'sn-slot'));
    var noteSlot  = box.appendChild(el('div', 'sn-slot'));
    if (s.teaching) teachingBlock(box, 'Full teaching', 'section=' + s.n, true);
    fold.inside = function () {
      var parts = [], points = pointCount(fold), notes = noteCount(fold);
      if (s.recap) parts.push('Key points');
      if (points) parts.push(count(points, 'saved point', 'saved points'));
      if (notes) parts.push(count(notes, 'note on the study', 'notes on the study'));
      if (s.teaching) parts.push('Full teaching');
      return parts;
    };
    s.refresh = fold.refresh;
    addGroup('s' + s.n, pointSlot, null, RO ? 'Their saved points' : 'Your saved points', fold.refresh);
    addGroup('note-s' + s.n, noteSlot, null, RO ? 'Their notes on the study' : 'Your notes on the study', fold.refresh, 'sn-studynote');
    fold.refresh();
    body.appendChild(fold.sec);
  });

  [['lesson', 'Other points'], ['check', 'From your understanding check']].forEach(function (x) {
    var fold = foldSection('none-' + x[0], x[1]);
    fold.inside = function () { var n = pointCount(fold); return n ? [count(n, 'saved point', 'saved points')] : []; };
    addGroup('none-' + x[0], fold.content, null, null, function (none) { fold.sec.hidden = none; fold.refresh(); });
    settle(groups['none-' + x[0]]);
    body.appendChild(fold.sec);
  });
  (function () {
    var fold = foldSection('general', 'General notes');
    fold.inside = function () { var n = noteCount(fold); return n ? [count(n, 'note', 'notes')] : []; };
    addGroup('note-general', fold.content, null, null, function (none) { fold.sec.hidden = none; fold.refresh(); }, 'sn-studynote');
    settle(groups['note-general']);
    body.appendChild(fold.sec);
  })();
  (BOOT.points || []).forEach(function (p, i) { placePoint(p, pointCard(p, i)); });
  (BOOT.notes || []).forEach(function (n, i) { n.section = noteSection(n); placeInto(noteKey(n.section), noteCard(n, i)); });

  function group(key, title, parts, fill) {
    var fold = foldSection(key, title);
    fold.inside = function () { return parts; };
    fill(fold.content);
    fold.refresh();
    body.appendChild(fold.sec);
  }

  var earlier = BOOT.earlier || [];
  var current = earlier.filter(function (e) { return e.current; });
  var kept    = earlier.filter(function (e) { return !e.current; });
  if (current.length) {
    group('earlier', 'Earlier conversation', ['Conversation'], function (box) {
      box.appendChild(el('p', 'sn-muted', 'From before Study Notes began marking which section each part belongs to.'));
      current.forEach(function (e) { teachingBlock(box, 'Show the conversation', 'earlier=' + encodeURIComponent(e.key), false); });
    });
  }
  if (kept.length) {
    group('kept', 'Earlier lessons', [count(kept.length, 'lesson', 'lessons')], function (box) {
      kept.forEach(function (e) {
        var when = fmtDate(e.date);
        teachingBlock(box, when ? 'Lesson from ' + when : 'Earlier lesson', 'earlier=' + encodeURIComponent(e.key), false);
      });
    });
  }

  [['snExpandAll', true], ['snCollapseAll', false]].forEach(function (x) {
    var b = document.getElementById(x[0]);
    if (b) b.addEventListener('click', function () { setAll(x[1]); });
  });
  if (!body.querySelector('.sn-section:not([hidden])')) body.appendChild(el('p', 'sn-muted', RO ? 'Nothing has been shared yet.' : 'Nothing here yet.'));

  // ── #item=<key>: a "Discuss this" link from Messages ─────────────────────
  // Opens the item's section and scrolls to it. Keys: s<N> section, k<N> key
  // points, p<id> saved point, n<id> note (data-item on each).
  var missingEl = null;
  function showItem() {
    var m = /^#item=([A-Za-z0-9_-]{1,80})$/.exec(window.location.hash || '');
    if (missingEl) { missingEl.remove(); missingEl = null; }
    if (!m) return;
    var target = body.querySelector('[data-item="' + m[1] + '"]');
    if (!target) {
      missingEl = el('p', 'sn-muted sn-missing', 'The part of these Study Notes that message was about is no longer here.');
      body.insertBefore(missingEl, body.firstChild);
      return;
    }
    openSectionOf(target);
    target.scrollIntoView({ block: 'start' });
    target.classList.remove('sn-flash');
    void target.offsetWidth;
    target.classList.add('sn-flash');
  }
  showItem();
  window.addEventListener('hashchange', showItem);

  // ── Delete these Study Notes ─────────────────────────────────────────────
  var foot = document.getElementById('snFoot');
  if (foot && BOOT.canDelete && !RO) {
    var del = el('button', 'btn-discard', 'Delete these Study Notes');
    del.type = 'button';
    del.addEventListener('click', function () {
      if (typeof window.showConfirm !== 'function') return;
      window.showConfirm(
        'Delete your saved points and section recaps for this study? This can\'t be undone. Your notes on the study text are not affected; they stay with the study.',
        'Delete',
        function (lessons) {
          del.disabled = true;
          fetch('/api/study-notes/' + encodeURIComponent(BOOT.studyId), {
            method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lessons: lessons === true }),
          })
            .then(function (r) { return r.json(); })
            .then(function (d) { if (!d || !d.success) throw new Error((d && d.error) || 'Please try again.'); window.location.reload(); })
            .catch(function (err) { del.disabled = false; alertSafe(err.message); });
        },
        null, { tick: 'Also delete earlier lessons kept from Start over' });
    });
    foot.appendChild(del);
  }

  // ── Print ────────────────────────────────────────────────────────────────
  // The site's print area (styles.css #printArea): a copy of every section, open,
  // without the controls; the full teaching only if asked for.
  function printCopy(content) {
    var copy = content.cloneNode(true);
    copy.removeAttribute('id');
    copy.querySelectorAll('.sn-keypoints').forEach(function (k) { if (!k.querySelector('.recap-lines')) k.remove(); });
    copy.querySelectorAll('button, form, textarea, label, details, .sn-point-row, .sn-point-form, .sn-move-list, .sn-note-open, [hidden], [role="status"]')
      .forEach(function (n) { n.remove(); });
    copy.querySelectorAll('[id]').forEach(function (n) { n.removeAttribute('id'); });
    return copy;
  }
  function printLessons(box, lessons) {
    if (!lessons || !lessons.length) return;
    var wrap = el('div');
    wrap.appendChild(el('h4', null, 'Full teaching'));
    lessons.forEach(function (l) { renderLesson(wrap, l, true); });
    box.appendChild(wrap);
  }
  function printNow(teaching) {
    var area = document.getElementById('printArea');
    if (!area) {
      area = el('div');
      area.id = 'printArea';
      area.setAttribute('aria-hidden', 'true');
      document.body.appendChild(area);
    }
    area.textContent = '';
    area.appendChild(el('h1', null, BOOT.topic));
    area.appendChild(el('p', null, 'Study Notes'));
    if (RO && BOOT.ownerName) area.appendChild(el('p', null, 'Notes by ' + BOOT.ownerName));
    area.appendChild(el('p', null, 'Printed ' + fmtDate(new Date().toISOString())));
    Object.keys(folds).sort(function (a, b) {
      return folds[a].sec.compareDocumentPosition(folds[b].sec) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    }).forEach(function (key) {
      var fold = folds[key];
      if (fold.sec.hidden) return;
      // Conversations with no notes of their own print only with the teaching.
      if (!teaching && (key === 'earlier' || key === 'kept')) return;
      area.appendChild(el('h2', null, fold.title));
      var copy = printCopy(fold.content);
      if (teaching) {
        if (/^s\d+$/.test(key)) printLessons(copy, teaching.sections[key.slice(1)]);
        if (key === 'earlier') current.forEach(function (e) { printLessons(copy, teaching.earlier[e.key]); });
        if (key === 'kept') kept.forEach(function (e) { printLessons(copy, teaching.earlier[e.key]); });
      }
      area.appendChild(copy);
    });
    // One NASB notice at the end, in place of one under each passage.
    var nasb = BOOT.studyNasb && !!area.querySelector('.sn-note-quote');
    area.querySelectorAll('.recap-notice, em').forEach(function (n) {
      if (n.textContent.trim() !== BOOT.nasbNotice) return;
      nasb = true;
      n.remove();
    });
    if (!nasb && /NASB/.test(area.textContent)) nasb = true;
    if (nasb) area.appendChild(el('p', null, BOOT.nasbNotice));
    area.querySelectorAll('a').forEach(function (a) { a.replaceWith(document.createTextNode(a.textContent)); });

    document.body.classList.add('is-printing');
    window.addEventListener('afterprint', function done() {
      window.removeEventListener('afterprint', done);
      document.body.classList.remove('is-printing');
      area.textContent = '';
    });
    window.print();
  }
  var printBtn = document.getElementById('snPrint');
  if (printBtn) {
    printBtn.addEventListener('click', function () {
      // The full teaching can be printed only where it is on the page.
      var canTeaching = !RO || !!BOOT.teachingUrl;
      if (typeof window.showConfirm !== 'function' || !canTeaching) { printNow(null); return; }
      window.showConfirm('Print these Study Notes?', 'Print', function (withTeaching) {
        if (!withTeaching) { printNow(null); return; }
        fetch(teachingBase() + '?all=1')
          .then(function (r) { return r.json(); })
          .then(function (d) { if (!d || !d.success) throw new Error(); printNow(d); })
          .catch(function () { alertSafe('The full teaching couldn’t be loaded, so nothing was printed. Please try again.'); });
      }, null, { tick: 'Include the full teaching' });
    });
  }

  if (window.IronInkTextSize) {
    window.IronInkTextSize.attach({
      target: body, key: 'ironink_study_notes_font_size',
      dec: 'snFontDec', reset: 'snFontReset', inc: 'snFontInc',
    });
  }
})();
