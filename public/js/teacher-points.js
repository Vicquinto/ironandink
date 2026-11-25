(function (global) {
  'use strict';

  // Save this point (Teacher page). Select words inside ONE finished Teacher
  // reply → "Save this point" → an optional note → Study Notes. The server works
  // out the words from the reply's stored text (lib/study-notes.js); this page
  // sends only where the selection is. teacher.js marks each saved reply with
  // data-session and data-index (and data-mid when it has an id) and calls
  // init(), ready(msgEl) and reload().
  //
  // Positions are counted in visible characters with white space and verse
  // numbers left out, the same on the server, so line breaks can't shift them.

  var cfg = null, pane = null, messagesEl = null;
  var button = null, panel = null;
  var pending = null;        // the captured selection
  var pressing = false;      // a press on the button must not lose it to a collapsed selection
  var savedPoints = [];      // this study's points, for the faint highlights

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function api(path) { return '/api/study-notes/' + encodeURIComponent(cfg.studyId) + '/points' + (path || ''); }
  function send(method, path, body) {
    return fetch(api(path), { method: method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.success) throw new Error((d && d.error) || 'That couldn’t be saved. Please try again.');
        return d;
      });
  }
  function squash(s) { return String(s || '').replace(/\s+/g, ''); }

  // A Range's text without verse numbers.
  function rangeText(range) {
    var frag = range.cloneContents();
    frag.querySelectorAll('.guide-vnum').forEach(function (n) { n.remove(); });
    return frag.textContent || '';
  }

  // ── Reading the selection ────────────────────────────────────────────────
  function contentOf(node) {
    var e = node && (node.nodeType === 3 ? node.parentElement : node);
    return e && e.closest ? e.closest('.engine-msg .msg-content') : null;
  }
  function readSelection() {
    var sel = global.getSelection && global.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return null;
    var range = sel.getRangeAt(0);
    var content = contentOf(range.startContainer);
    if (!content || !messagesEl.contains(content)) return null;
    if (contentOf(range.endContainer) !== content) {
      // A triple-click can end at the very start of the next element: fine when
      // nothing outside this reply is actually selected.
      var outside = range.cloneRange();
      outside.setStart(content, content.childNodes.length);
      if (squash(outside.toString())) return null;
      range = range.cloneRange();
      range.setEnd(content, content.childNodes.length);
    }
    var msg = content.closest('.engine-msg');
    if (!msg || msg.classList.contains('streaming') || !msg.getAttribute('data-session')) return null;
    if (!cfg.canSave()) return null;
    var text = rangeText(range);
    if (squash(text).length < 3) return null;
    var before = document.createRange();
    before.selectNodeContents(content);
    before.setEnd(range.startContainer, range.startOffset);
    var start = squash(rangeText(before)).length;
    return {
      sessionId: msg.getAttribute('data-session'),
      messageId: msg.getAttribute('data-mid') || null,
      index:     parseInt(msg.getAttribute('data-index'), 10),
      start:     start,
      text:      text,
      rect:      range.getBoundingClientRect(),
    };
  }

  // ── The button ───────────────────────────────────────────────────────────
  function isPhone() {
    return !!(global.matchMedia && global.matchMedia('(max-width: 900px), (pointer: coarse)').matches);
  }
  function hideButton() {
    if (button) button.remove();
    button = null;
  }
  function showButton() {
    hideButton();
    closePanel();
    button = el('button', 'point-save-btn' + (isPhone() ? ' is-bar' : ''), 'Save this point');
    button.type = 'button';
    button.addEventListener('pointerdown', function (e) {
      pressing = true;
      e.preventDefault();      // keep the selection
      setTimeout(function () { pressing = false; }, 800);
    });
    button.addEventListener('mousedown', function (e) { e.preventDefault(); });
    button.addEventListener('click', openForm);
    pane.insertBefore(button, messagesEl.nextSibling);
    if (button.classList.contains('is-bar')) return;
    var r = pending.rect, box = button.getBoundingClientRect();
    var top = r.bottom + 6;
    if (top + box.height > global.innerHeight - 8) top = Math.max(8, r.top - box.height - 6);
    button.style.top  = top + 'px';
    button.style.left = Math.min(Math.max(8, r.left), global.innerWidth - box.width - 8) + 'px';
  }
  function onSelection() {
    if (pressing || (panel && panel.getAttribute('data-state') === 'form')) return;
    var got = readSelection();
    if (got) { pending = got; showButton(); }
    else if (button && document.activeElement !== button) { hideButton(); pending = null; }
  }

  // ── The note form and the "Saved" line, at the bottom of the pane ─────────
  function closePanel() {
    if (panel) panel.remove();
    panel = null;
  }
  function openPanel(state) {
    closePanel();
    panel = el('div', 'point-panel');
    panel.setAttribute('data-state', state);
    pane.insertBefore(panel, messagesEl.nextSibling);
    return panel;
  }
  function openForm() {
    var what = pending;
    pressing = false;
    hideButton();
    if (!what) return;
    var box = openPanel('form');
    var label = el('label', 'point-label', 'Add a note of your own (optional)');
    var input = el('textarea', 'point-note');
    input.id = 'pointNote'; label.htmlFor = 'pointNote';
    input.rows = 2; input.maxLength = 500;
    var row = el('div', 'point-row');
    var save = el('button', 'btn-primary point-btn', 'Save'), cancel = el('button', 'btn-warm point-btn', 'Cancel');
    save.type = 'button'; cancel.type = 'button';
    var err = el('p', 'point-msg');
    err.setAttribute('role', 'alert');
    row.appendChild(save); row.appendChild(cancel);
    [label, input, row, err].forEach(function (n) { box.appendChild(n); });
    cancel.addEventListener('click', function () { closePanel(); pending = null; });
    save.addEventListener('click', function () {
      save.disabled = true; cancel.disabled = true; err.textContent = '';
      send('POST', '', {
        kind: cfg.kind, sessionId: what.sessionId, messageId: what.messageId, index: what.index,
        start: what.start, text: what.text, note: input.value,
      }).then(function (d) {
        pending = null;
        savedPoints.push(d.point);
        highlight(d.point);
        showSaved(d.point);
      }).catch(function (e) {
        save.disabled = false; cancel.disabled = false;
        err.textContent = e.message;
      });
    });
    input.focus({ preventScroll: true });
  }
  function showSaved(point) {
    var box = openPanel('saved');
    var line = el('p', 'point-msg', 'Saved to Study Notes');
    line.setAttribute('role', 'status');
    var undo = el('button', 'point-undo', 'Undo');
    undo.type = 'button';
    undo.addEventListener('click', function () {
      undo.disabled = true;
      send('DELETE', '/' + encodeURIComponent(point.id)).then(function () {
        savedPoints = savedPoints.filter(function (p) { return p.id !== point.id; });
        unhighlight(point.id);
        closePanel();
      }).catch(function () { undo.disabled = false; line.textContent = 'That couldn’t be undone. You can delete it in Study Notes.'; });
    });
    box.appendChild(line); box.appendChild(undo);
  }

  // ── Faint highlight of saved passages ────────────────────────────────────
  function highlight(point) {
    if (!point.shown) return;
    messagesEl.querySelectorAll('.engine-msg[data-session]').forEach(function (msg) {
      if (msg.getAttribute('data-session') !== point.sessionId || msg.getAttribute('data-index') !== String(point.index)) return;
      var content = msg.querySelector('.msg-content');
      var walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, null), node, nodes = [];
      while ((node = walker.nextNode())) {
        if (!node.parentNode.closest('.guide-vnum')) nodes.push(node);
      }
      var count = 0;
      nodes.forEach(function (n) {
        var v = n.nodeValue, a = -1, b = -1;
        for (var i = 0; i < v.length; i++) {
          if (/\s/.test(v.charAt(i))) continue;
          if (count >= point.shown.start && count < point.shown.end) { if (a === -1) a = i; b = i + 1; }
          count++;
        }
        if (a === -1) return;
        var r = document.createRange();
        r.setStart(n, a); r.setEnd(n, b);
        var span = el('span', 'point-saved');
        span.setAttribute('data-point', point.id);
        r.surroundContents(span);
      });
    });
  }
  function unhighlight(id) {
    messagesEl.querySelectorAll('.point-saved').forEach(function (s) {
      if (s.getAttribute('data-point') !== id) return;
      var parent = s.parentNode;
      while (s.firstChild) parent.insertBefore(s.firstChild, s);
      s.remove();
      parent.normalize();
    });
  }

  // ── teacher.js calls these ───────────────────────────────────────────────
  // After a saved conversation is redrawn. Best effort: no highlights without it.
  function reload() {
    if (!cfg) return;
    send('GET', '?kind=' + cfg.kind).then(function (d) {
      savedPoints = d.points || [];
      savedPoints.forEach(function (p) { if (!messagesEl.querySelector('.point-saved[data-point="' + p.id + '"]')) highlight(p); });
    }).catch(function () {});
  }
  function clear() { hideButton(); closePanel(); pending = null; }

  function init(options) {
    cfg = options;
    messagesEl = document.getElementById('teacherMessages');
    pane = document.getElementById('teacherConversation');
    if (!messagesEl || !pane || !global.getSelection) { cfg = null; return; }
    var timer = null;
    document.addEventListener('selectionchange', function () {
      clearTimeout(timer);
      timer = setTimeout(onSelection, 250);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (button || panel) clear();
    });
    // The floating button belongs to a place on the screen: gone when it moves.
    messagesEl.addEventListener('scroll', function () {
      if (button && !button.classList.contains('is-bar')) hideButton();
    });
    global.addEventListener('resize', hideButton);
  }

  global.IronInkTeacherPoints = { init: init, reload: reload, clear: clear };
}(window));
