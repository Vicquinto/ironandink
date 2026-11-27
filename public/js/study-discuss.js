(function () {
  'use strict';

  // "Discuss this" on Study Notes (routes/study-shares.js). A small dialog: the
  // item's label and quote (built by the server from the stored item), who it
  // goes to, a message box, Send / Cancel. The message is sent as this member in
  // their Messages thread with the other person. Loaded before study-notes.js,
  // which adds the buttons; built with createElement/textContent only.

  var BOOT = window.STUDY_NOTES_BOOT || {};
  if (!BOOT.canDiscuss) return;
  var MAX = 2000;

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
  // Whose notes these are, for the server: the share (recipient) or the study (owner).
  function scope() { return BOOT.readOnly ? { shareId: BOOT.shareId } : { studyId: BOOT.studyId }; }

  var dlg = null;
  function close() {
    if (!dlg) return;
    document.removeEventListener('keydown', dlg.onKey);
    dlg.overlay.remove();
    var back = dlg.opener;
    dlg = null;
    if (back && document.body.contains(back)) back.focus();
  }

  function open(item, opener) {
    if (dlg) close();
    var overlay = el('div', 'ss-overlay');
    var card = el('div', 'ss-dialog');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    var h = el('h3', 'ss-title', 'Discuss this');
    h.id = 'sdTitle';
    card.setAttribute('aria-labelledby', 'sdTitle');
    var x = button('×', 'ss-close', close);
    x.setAttribute('aria-label', 'Close');
    var inner = el('div', 'ss-inner');
    [x, h, inner].forEach(function (n) { card.appendChild(n); });
    overlay.appendChild(card);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    function onKey(e) {
      if (e.key === 'Escape') { close(); return; }
      if (e.key !== 'Tab') return;
      var f = Array.prototype.filter.call(card.querySelectorAll('button, input, textarea, a[href]'), function (n) { return !n.disabled && n.offsetParent !== null; });
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    dlg = { overlay: overlay, onKey: onKey, opener: opener };

    var status = el('p', 'ss-status', 'Loading…');
    status.setAttribute('role', 'status');
    inner.appendChild(status);
    x.focus();

    var q = new URLSearchParams(scope());
    q.set('kind', item.kind);
    if (item.section !== undefined && item.section !== null) q.set('section', String(item.section));
    if (item.id) q.set('id', item.id);
    fetch('/api/study-notes/discuss/preview?' + q.toString())
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.success) throw new Error((d && d.error) || 'Please try again.');
        if (!dlg || dlg.overlay !== overlay) return;
        compose(inner, item, d);
      })
      .catch(function (err) { status.textContent = err.message; });
  }

  function compose(inner, item, d) {
    inner.textContent = '';
    inner.appendChild(el('p', 'sd-label', d.label));
    if (d.quote) inner.appendChild(el('blockquote', 'sd-quote', d.quote));

    // Who it goes to: the owner (from a share), or one of the people the owner
    // shares this part with.
    var to = d.to || [];
    var picked = to.length === 1 ? to[0] : null;
    if (to.length === 1) {
      inner.appendChild(el('p', 'ss-text', 'To ' + to[0].name + ', in Messages.'));
    } else {
      var fs = el('fieldset', 'sd-to');
      fs.appendChild(el('legend', 'ss-label', 'Send to'));
      to.forEach(function (t, i) {
        var row = el('label', 'ss-part');
        var r = el('input');
        r.type = 'radio'; r.name = 'sdTo'; r.value = t.id;
        r.addEventListener('change', function () { picked = t; update(); });
        row.appendChild(r);
        row.appendChild(el('span', 'ss-part-text', t.name));
        fs.appendChild(row);
        if (i === 0) r.id = 'sdToFirst';
      });
      inner.appendChild(fs);
    }

    var label = el('label', 'ss-label', 'Your message');
    var text = el('textarea', 'form-input sd-text');
    text.id = 'sdText'; text.maxLength = MAX; text.rows = 4;
    label.htmlFor = text.id;
    inner.appendChild(label);
    inner.appendChild(text);
    var status = el('p', 'ss-status');
    status.setAttribute('role', 'status');
    inner.appendChild(status);

    var row = el('div', 'ss-actions');
    var send = button('Send', 'btn-primary ss-primary', function () {
      send.disabled = true;
      status.textContent = 'Sending…';
      var body = scope();
      body.item = item;
      body.text = text.value;
      if (picked && !BOOT.readOnly) body.to = picked.id;
      fetch('/api/study-notes/discuss', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (!res || !res.success) throw new Error((res && res.error) || 'Nothing was sent. Please try again.');
          sent(inner, res);
        })
        .catch(function (err) { send.disabled = false; status.textContent = err.message; });
    });
    row.appendChild(send);
    row.appendChild(button('Cancel', 'sn-btn', close));
    inner.appendChild(row);

    function update() { send.disabled = !text.value.trim() || !picked; }
    text.addEventListener('input', update);
    update();
    text.focus();
  }

  function sent(inner, res) {
    inner.textContent = '';
    var p = el('p', 'ss-text sd-sent', 'Sent to ' + res.name + ' in Messages. ');
    var a = el('a', 'sn-link', 'Open conversation');
    a.href = '/messages?t=' + encodeURIComponent(res.threadId);
    p.appendChild(a);
    inner.appendChild(p);
    var row = el('div', 'ss-actions');
    var done = button('Close', 'btn-primary ss-primary', close);
    row.appendChild(done);
    inner.appendChild(row);
    done.focus();
  }

  window.IronInkDiscuss = { open: open };
})();
