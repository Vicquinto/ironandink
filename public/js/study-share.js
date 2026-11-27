(function () {
  'use strict';

  // "Share with a member" on the owner's Study Notes page (routes/study-shares.js).
  // Pick a member, tick what they can read, see a preview, share; then, from the
  // "Shared with" line, change what's shared, copy the link or stop sharing.
  // Built with createElement/textContent only.

  var BOOT = window.STUDY_NOTES_BOOT || {};
  if (BOOT.readOnly || !BOOT.canShare) return;
  var shareBtn = document.getElementById('snShareBtn');
  var line = document.getElementById('snShares');
  if (!shareBtn || !line) return;

  var shares = Array.isArray(BOOT.shares) ? BOOT.shares : null;
  var counts = BOOT.shareCounts || {};
  var PARTS = [
    { k: 'recaps',   label: 'Key points',              on: true },
    { k: 'points',   label: 'Your saved points',       on: true },
    { k: 'notes',    label: 'Your notes on the study', on: true },
    { k: 'teaching', label: 'Full teaching',           on: false,
      note: 'The full teaching includes your own questions and answers in the lesson.' },
  ];

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function button(text, cls, onClick) {
    var b = el('button', cls || 'sn-btn', text);
    b.type = 'button';
    if (onClick) b.addEventListener('click', onClick);
    return b;
  }
  function api(method, path, data) {
    return fetch('/api/study-shares/' + path, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: data ? JSON.stringify(data) : undefined,
    })
      .then(function (r) { return r.json().catch(function () { return null; }); })
      .then(function (d) {
        if (d && d.error === 'member_feature') throw new Error('Sharing Study Notes is part of membership.');
        if (!d || !d.success) throw new Error((d && d.error) || 'Please try again.');
        return d;
      });
  }
  function studyPath(rest) { return encodeURIComponent(BOOT.studyId) + (rest ? '/' + encodeURIComponent(rest) : ''); }

  // ── The "Shared with" line ───────────────────────────────────────────────
  function drawLine() {
    line.textContent = '';
    if (shares === null) {
      line.hidden = false;
      line.appendChild(el('span', 'sn-muted', 'Who these notes are shared with can’t be shown right now.'));
      return;
    }
    line.hidden = !shares.length;
    if (!shares.length) return;
    line.appendChild(el('span', 'sn-shares-label', 'Shared with '));
    shares.forEach(function (s, i) {
      if (i) line.appendChild(document.createTextNode(', '));
      var b = button(s.name + (s.active ? '' : ' (account not active)'), 'sn-share-name', function () { openChange(s, b); });
      b.setAttribute('aria-label', 'Shared with ' + s.name + ': change what’s shared or stop sharing');
      line.appendChild(b);
    });
  }

  // ── Dialog shell ─────────────────────────────────────────────────────────
  var dlg = null;
  function closeDialog() {
    if (!dlg) return;
    var back = dlg.opener;
    document.removeEventListener('keydown', dlg.onKey);
    dlg.overlay.remove();
    dlg = null;
    if (back && document.body.contains(back)) back.focus();
    else shareBtn.focus();
  }
  function openDialog(title, opener) {
    if (dlg) closeDialog();
    var overlay = el('div', 'ss-overlay');
    var card = el('div', 'ss-dialog');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    var h = el('h3', 'ss-title', title);
    h.id = 'ssTitle';
    card.setAttribute('aria-labelledby', 'ssTitle');
    var close = button('×', 'ss-close', closeDialog);
    close.setAttribute('aria-label', 'Close');
    var inner = el('div', 'ss-inner');
    [close, h, inner].forEach(function (n) { card.appendChild(n); });
    overlay.appendChild(card);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeDialog(); });
    function onKey(e) {
      if (e.key === 'Escape') { closeDialog(); return; }
      if (e.key !== 'Tab') return;
      // Keep Tab inside the dialog.
      var f = Array.prototype.filter.call(card.querySelectorAll('button, input, a[href], textarea'), function (n) { return !n.disabled && n.offsetParent !== null; });
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    dlg = { overlay: overlay, card: card, title: h, inner: inner, onKey: onKey, opener: opener || shareBtn };
    return dlg;
  }
  function setView(title, build) {
    dlg.title.textContent = title;
    dlg.inner.textContent = '';
    build(dlg.inner);
    var first = dlg.inner.querySelector('input, button, a[href]');
    if (first) first.focus();
  }
  function statusLine(parent) {
    var p = el('p', 'ss-status');
    p.setAttribute('role', 'status');
    parent.appendChild(p);
    return p;
  }

  // ── Pick a member ────────────────────────────────────────────────────────
  var members = null;
  function openPick() {
    openDialog('Share these Study Notes', shareBtn);
    setView('Share these Study Notes', function (box) {
      box.appendChild(el('p', 'ss-text', 'Choose a member. They’ll be able to read what you tick next, and nothing else. You can change it or stop sharing at any time.'));
      var label = el('label', 'ss-label', 'Search members');
      var input = el('input', 'form-input ss-search');
      input.type = 'text'; input.id = 'ssSearch'; input.autocomplete = 'off';
      label.htmlFor = input.id;
      var list = el('ul', 'ss-members');
      list.setAttribute('aria-label', 'Members');
      var status = statusLine(box);
      box.insertBefore(label, status);
      box.insertBefore(input, status);
      box.insertBefore(list, status);
      function draw() {
        list.textContent = '';
        var q = input.value.toLowerCase().trim();
        var shown = (members || []).filter(function (m) { return !q || m.fullName.toLowerCase().indexOf(q) !== -1; });
        status.textContent = members && !shown.length ? 'No members found.' : '';
        shown.slice(0, 50).forEach(function (m) {
          var already = (shares || []).find(function (s) { return s.recipientId === m.id; });
          var b = button(m.fullName, 'ss-member', function () {
            if (already) openChange(already, shareBtn);
            else ticksView(m);
          });
          if (already) b.appendChild(el('span', 'ss-member-note', ' — already shared'));
          var li = el('li');
          li.appendChild(b);
          list.appendChild(li);
        });
      }
      input.addEventListener('input', draw);
      if (members) { draw(); return; }
      status.textContent = 'Loading…';
      fetch('/api/study-shares/members')
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d && d.error === 'member_feature') throw new Error('Sharing Study Notes is part of membership.');
          if (!d || !d.success) throw new Error((d && d.error) || 'The list of members couldn’t be loaded. Please try again.');
          members = d.members || [];
          draw();
        })
        .catch(function (err) { status.textContent = err.message; });
    });
  }

  // ── What to share ────────────────────────────────────────────────────────
  function countText(k) {
    if (k === 'teaching') return counts.teaching ? '' : ' (none yet; it will be shared as you add to it)';
    var n = counts[k] || 0;
    return n ? ' (' + n + ')' : ' (none yet; new ones will be shared as you add them)';
  }
  // The tick boxes; returns a function giving { recaps, points, notes, teaching }.
  function ticks(box, start, onChange) {
    var fs = el('fieldset', 'ss-parts');
    fs.appendChild(el('legend', 'ss-label', 'What they can read'));
    var inputs = {};
    PARTS.forEach(function (p) {
      var row = el('label', 'ss-part');
      var c = el('input');
      c.type = 'checkbox';
      c.checked = start ? !!start[p.k] : p.on;
      c.addEventListener('change', onChange);
      inputs[p.k] = c;
      row.appendChild(c);
      var t = el('span', 'ss-part-text', p.label);
      t.appendChild(el('span', 'ss-part-count', countText(p.k)));
      row.appendChild(t);
      fs.appendChild(row);
      if (p.note) fs.appendChild(el('p', 'ss-part-note', p.note));
    });
    box.appendChild(fs);
    return function () {
      var out = {};
      PARTS.forEach(function (p) { out[p.k] = inputs[p.k].checked; });
      return out;
    };
  }
  function anyTicked(parts) { return PARTS.some(function (p) { return parts[p.k]; }); }
  function previewLink(getParts) {
    var a = el('a', 'sn-link ss-preview', 'See what they’ll see');
    a.target = '_blank';
    a.rel = 'noopener';
    function update() {
      var parts = getParts();
      var list = PARTS.filter(function (p) { return parts[p.k]; }).map(function (p) { return p.k; });
      a.href = '/study-notes/' + encodeURIComponent(BOOT.studyId) + '/preview?parts=' + list.join(',');
      a.hidden = !list.length;
    }
    a.update = update;
    return a;
  }

  function ticksView(member) {
    setView('Share with ' + member.fullName, function (box) {
      var get, prev, go;
      function changed() { prev.update(); go.disabled = !anyTicked(get()); }
      get = ticks(box, null, function () { changed(); });
      prev = previewLink(function () { return get(); });
      box.appendChild(prev);
      var status = statusLine(box);
      var row = el('div', 'ss-actions');
      go = button('Share', 'btn-primary ss-primary', function () {
        go.disabled = true;
        status.textContent = 'Sharing…';
        api('POST', studyPath(), { recipientId: member.id, parts: get() })
          .then(function (d) {
            if (Array.isArray(d.shares)) shares = d.shares;
            drawLine();
            doneView(member.fullName, d.share, d.messageSent);
          })
          .catch(function (err) { go.disabled = false; status.textContent = err.message; });
      });
      row.appendChild(go);
      row.appendChild(button('Back', 'sn-btn', openPick));
      box.appendChild(row);
      changed();
    });
  }

  // ── The link: shown after sharing and when changing a share ──────────────
  function linkRow(box, share) {
    if (!share || !share.url) return;
    var url = window.location.origin + share.url;
    var label = el('label', 'ss-label', 'Link to these Study Notes');
    var input = el('input', 'form-input ss-link');
    input.type = 'text'; input.readOnly = true; input.value = url; input.id = 'ssLink';
    label.htmlFor = input.id;
    var status = el('p', 'ss-status');
    status.setAttribute('role', 'status');
    var copy = button('Copy link', 'sn-btn', function () {
      function done() { status.textContent = 'Link copied.'; }
      function fallback() {
        input.focus(); input.select();
        try { if (document.execCommand('copy')) { done(); return; } } catch (e) {}
        status.textContent = 'Select the link and copy it.';
      }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, fallback);
      else fallback();
    });
    var wrap = el('div', 'ss-link-row');
    wrap.appendChild(input);
    wrap.appendChild(copy);
    [label, wrap, status].forEach(function (n) { box.appendChild(n); });
  }

  // messageSent: true (a Message with the link went to them), false (it couldn't
  // be sent), null (nothing new was shared, so no message).
  function doneView(name, share, messageSent) {
    setView('Shared with ' + name, function (box) {
      var text = messageSent === true
        ? 'They’ll get a message from you in Messages with the link, and can also find these Study Notes in their Library, under Shared with me.'
        : messageSent === false
          ? 'Shared with ' + name + '. The message couldn’t be sent, but it’s in their Library under Shared with me.'
          : 'They can find these Study Notes in their Library, under Shared with me.';
      box.appendChild(el('p', 'ss-text', text));
      box.appendChild(el('p', 'ss-text', 'To send them the link yourself, copy it here.'));
      linkRow(box, share);
      var row = el('div', 'ss-actions');
      row.appendChild(button('Done', 'btn-primary ss-primary', closeDialog));
      box.appendChild(row);
    });
  }

  // ── Change what's shared / Stop sharing ──────────────────────────────────
  function openChange(share, opener) {
    if (!dlg) openDialog('Shared with ' + share.name, opener);
    else dlg.opener = opener;
    setView('Shared with ' + share.name, function (box) {
      if (!share.active) box.appendChild(el('p', 'ss-text', 'This member’s account is not active, so they can’t see these notes now.'));
      var get, prev, save;
      function changed() { prev.update(); save.disabled = !anyTicked(get()); }
      get = ticks(box, share.parts, function () { changed(); });
      prev = previewLink(function () { return get(); });
      box.appendChild(prev);
      var status = statusLine(box);
      var row = el('div', 'ss-actions');
      save = button('Save', 'btn-primary ss-primary', function () {
        save.disabled = true;
        status.textContent = 'Saving…';
        api('PUT', studyPath(share.id), { parts: get() })
          .then(function (d) {
            if (Array.isArray(d.shares)) shares = d.shares;
            drawLine();
            status.textContent = 'Saved. ' + share.name + ' now sees what is ticked.';
            share = (shares || []).find(function (s) { return s.id === share.id; }) || share;
            changed();
          })
          .catch(function (err) { save.disabled = false; status.textContent = err.message; });
      });
      row.appendChild(save);
      row.appendChild(button('Stop sharing', 'btn-discard', function () {
        var name = share.name, id = share.id;
        closeDialog();
        var q = 'Stop sharing these Study Notes with ' + name + '? They won’t be able to see them any more.';
        function go() {
          api('DELETE', studyPath(id))
            .then(function (d) { shares = Array.isArray(d.shares) ? d.shares : (shares || []).filter(function (s) { return s.id !== id; }); drawLine(); shareBtn.focus(); })
            .catch(function (err) { if (typeof window.showAlert === 'function') window.showAlert(err.message); else window.alert(err.message); });
        }
        if (typeof window.showConfirm === 'function') window.showConfirm(q, 'Stop sharing', go);
        else if (window.confirm(q)) go();
      }));
      row.appendChild(button('Close', 'sn-btn', closeDialog));
      box.appendChild(row);
      linkRow(box, share);
      changed();
    });
  }

  shareBtn.addEventListener('click', openPick);
  drawLine();
})();
