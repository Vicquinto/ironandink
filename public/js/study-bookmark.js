(function (global) {
  'use strict';

  // Study bookmarks — "Mark my place" and "Pick up where you left off".
  //
  // One bookmark per study per member, saved to the account
  // (routes/study-bookmarks.js). teacher-entry.js calls
  // IronInkStudyBookmark.attach(container, opts) from its own attach(), so the
  // same views that have Listen get it: the Study page, the Library inline
  // reader and the Community shared reader. Not the Teacher page or Scripture.
  //
  // A place is a block of the rendered study, by the SAME block list Listen
  // reads (IronInkStudyListen.collectBlocks: headings, paragraphs, list items,
  // quotations; Further Studies left out). Saved with it: the start of the
  // block's text (snippet) and the nearest section heading (sectionTitle).
  //
  // Set from the highlight panel's "Mark my place" (library.js → markAt) or by
  // Listen when reading is stopped (study-listen.js → saveFromBlocks).
  //
  // Shows: a small oxblood ribbon in the margin beside the marked block, and —
  // when a study opens with a saved place — a slim bar at the top:
  //   You stopped in “<section>”.  [Go to my place]  Remove bookmark  ×
  //
  // Everything it adds carries .teacher-entry, so the notepad's text walker and
  // Listen skip it, print CSS hides it, and teacher-entry's remove() clears it.
  // Text is set with textContent only.

  var SNIPPET_LEN = 80;
  var FLASH_MS    = 2600;
  var RIBBON_CLASS = 'study-bookmark-ribbon';
  var MARKED_CLASS = 'study-bookmark-block';
  var FLASH_CLASS  = 'study-bookmark-flash';

  // Plain words of a block or heading: no Teacher buttons, ribbon, verse
  // numbers or note markers. Whitespace collapsed the same way the server
  // cleans it, so a saved snippet compares equal later.
  function plainText(el) {
    if (!el) return '';
    var c = el.cloneNode(true);
    c.querySelectorAll('.teacher-entry, [data-anchor-skip], .guide-vnum, .notepad-marker, .scripture-note-marker, .verse-num, sup, button, script, style')
      .forEach(function (n) { n.remove(); });
    if (el.tagName === 'LI') c.querySelectorAll('ul, ol').forEach(function (n) { n.remove(); });
    return (c.textContent || '')
      .replace(/[\x00-\x1F\x7F-\x9F]/g, ' ')   // control characters; \s below also covers U+2028/2029
      .replace(/\s+/g, ' ')
      .trim();
  }

  function snippetOf(el) { return plainText(el).slice(0, SNIPPET_LEN); }

  // A "## " section heading, in either rendering: renderMarkdown emits it as
  // h3.guide-h3 (its "# " title is h2.guide-h2); marked emits a plain <h2>.
  // Same rule as teacher-entry.js sectionHeadings().
  function isSectionHeading(el) {
    if (!el || !el.tagName) return false;
    if (el.tagName === 'H3' && el.classList.contains('guide-h3')) return true;
    return el.tagName === 'H2' && !el.classList.contains('guide-h2');
  }

  function sectionTitleFor(blocks, i) {
    for (var j = Math.min(i, blocks.length - 1); j >= 0; j--) {
      if (isSectionHeading(blocks[j])) return plainText(blocks[j]).slice(0, 200);
    }
    return '';
  }

  function collect(container) {
    var L = global.IronInkStudyListen;
    return (L && typeof L.collectBlocks === 'function') ? L.collectBlocks(container) : [];
  }

  function makeEl(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (text) el.textContent = text;
    return el;
  }

  function apiUrl(id) { return '/api/study-bookmarks/' + encodeURIComponent(id); }

  // Let the Library cards (library.js) keep their "Stopped at" line current.
  function announce(studyId, mark) {
    try {
      document.dispatchEvent(new CustomEvent('ironink:study-bookmark', {
        detail: { studyId: studyId, sectionTitle: mark ? (mark.sectionTitle || '') : null, removed: !mark },
      }));
    } catch (e) { /* very old browser — the card updates on the next load */ }
  }

  function attach(container, opts) {
    if (!container) return null;
    opts = opts || {};
    destroy(container);

    var dead     = false;
    var mark     = null;    // { blockIndex, snippet, sectionTitle } — the saved place
    var version  = 0;       // bumped on every local change; a late GET can't overwrite it
    var bar      = null;
    var barText  = null;
    var barClosed = false;

    // The study's id, if it has one now. A fresh draft on the Study page has
    // none until saved; once the notepad (or anything else) has saved it, the
    // page's notepad binding names it.
    function currentId() {
      if (typeof opts.getId === 'function') {
        var id = opts.getId();
        if (id) return id;
      }
      var np = global.__notepadStudy;
      if (np && np.id && np.body === container) return np.id;
      return null;
    }

    // ── Re-finding the block ──────────────────────────────────────────────
    // 1) a block whose text starts with the saved snippet (nearest to
    //    blockIndex if several); 2) blockIndex, if in range; 3) none.
    function findBlock(m) {
      if (!m) return null;
      var blocks = collect(container);
      if (!blocks.length) return null;
      var snip = m.snippet || '';
      if (snip) {
        var best = null, bestDist = Infinity;
        blocks.forEach(function (b, i) {
          if (plainText(b).indexOf(snip) !== 0) return;
          var d = Math.abs(i - (m.blockIndex || 0));
          if (d < bestDist) { best = b; bestDist = d; }
        });
        if (best) return best;
      }
      var idx = m.blockIndex;
      if (typeof idx === 'number' && idx >= 0 && idx < blocks.length) return blocks[idx];
      return null;
    }

    function findSectionHeading(title) {
      if (!title) return null;
      var hs = container.querySelectorAll('h3.guide-h3, h2:not(.guide-h2)');
      for (var i = 0; i < hs.length; i++) {
        if (isSectionHeading(hs[i]) && plainText(hs[i]) === title) return hs[i];
      }
      return null;
    }

    // ── Ribbon ────────────────────────────────────────────────────────────
    function clearRibbon() {
      container.querySelectorAll('.' + RIBBON_CLASS).forEach(function (n) { n.remove(); });
      container.querySelectorAll('.' + MARKED_CLASS).forEach(function (n) { n.classList.remove(MARKED_CLASS); });
    }
    function drawRibbon(block) {
      clearRibbon();
      if (!block || !container.contains(block)) return;
      var r = makeEl('span', 'teacher-entry ' + RIBBON_CLASS);
      r.setAttribute('role', 'img');
      r.setAttribute('aria-label', 'Your place');
      r.title = 'Your place';
      block.classList.add(MARKED_CLASS);
      block.insertBefore(r, block.firstChild);
      placeRibbon();
    }

    // Line the ribbon up in the margin left of the study's text, whatever the
    // block's own indent (a list item sits further in). Where there is no
    // margin (phones), it stays inside the screen edge. A hidden study can't be
    // measured — the CSS default stands until it can.
    function placeRibbon() {
      var r = container.querySelector('.' + RIBBON_CLASS);
      var block = r && r.parentNode;
      if (!block || !container.getClientRects().length) return;
      var cs = global.getComputedStyle(container);
      var cr = container.getBoundingClientRect();
      var br = block.getBoundingClientRect();
      var contentLeft = cr.left + (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.paddingLeft) || 0);
      var x = Math.max(2, contentLeft - 18);
      r.style.left = Math.round(x - br.left) + 'px';
    }
    var resizeQueued = false;
    function onResize() {
      if (resizeQueued) return;
      resizeQueued = true;
      global.requestAnimationFrame(function () { resizeQueued = false; if (!dead) placeRibbon(); });
    }
    global.addEventListener('resize', onResize);

    // ── Pick up where you left off ────────────────────────────────────────
    function barMessage() {
      var t = mark && mark.sectionTitle;
      return t ? 'You stopped in “' + t + '”.' : 'You have a saved place in this study.';
    }
    function hideBar() { if (bar) bar.hidden = true; }
    function showBar() {
      if (barClosed || !mark) return;
      if (!bar) {
        bar = makeEl('div', 'teacher-entry study-bookmark-bar');
        bar.setAttribute('role', 'region');
        bar.setAttribute('aria-label', 'Your place in this study');
        barText = makeEl('span', 'study-bookmark-bar-text');
        var go = makeEl('button', 'study-bookmark-go', 'Go to my place');
        go.type = 'button';
        var rm = makeEl('button', 'study-bookmark-remove', 'Remove bookmark');
        rm.type = 'button';
        var x = makeEl('button', 'study-bookmark-close', '×');
        x.type = 'button';
        x.title = 'Hide';
        x.setAttribute('aria-label', 'Hide this message');
        go.addEventListener('click', goToPlace);
        rm.addEventListener('click', function () { rm.disabled = true; removeMark(function () { rm.disabled = false; }); });
        x.addEventListener('click', function () { barClosed = true; hideBar(); });
        bar.appendChild(barText);
        bar.appendChild(go);
        bar.appendChild(rm);
        bar.appendChild(x);
        container.insertBefore(bar, container.firstChild);
      }
      barText.textContent = barMessage();
      bar.hidden = false;
    }
    function refreshBar() { if (bar && !bar.hidden) barText.textContent = barMessage(); }

    // Scroll the place near the top of the view, below a sticky Listen bar,
    // and give it a brief highlight that fades.
    function goToPlace() {
      if (!mark) return;
      var target = findBlock(mark);
      var isBlock = !!target;
      if (!target) target = findSectionHeading(mark.sectionTitle);
      if (!target) return;               // nothing to find — just don't scroll
      // A place inside a collapsed Opposing Views Part 2: open it first, or
      // there is nothing to scroll to.
      if (global.IronInkOpposingViews) global.IronInkOpposingViews.reveal(target);
      if (isBlock) drawRibbon(target); else placeRibbon();
      var listenBar = container.querySelector('.study-listen-bar');
      var offset = 16 + ((listenBar && !listenBar.hidden) ? listenBar.getBoundingClientRect().height : 0);
      target.style.scrollMarginTop = offset + 'px';
      try { target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      catch (e) { target.scrollIntoView(true); }
      target.classList.remove(FLASH_CLASS);
      void target.offsetWidth;           // restart the fade if clicked again
      target.classList.add(FLASH_CLASS);
      setTimeout(function () {
        target.classList.remove(FLASH_CLASS);
        target.style.scrollMarginTop = '';
      }, FLASH_MS);
    }

    // ── Saving ────────────────────────────────────────────────────────────
    // how.beacon — leaving the page: navigator.sendBeacon to the POST route
    // how.ui     — false when the container already shows something else
    function send(id, info, how) {
      var body = JSON.stringify(info);
      if (how && how.beacon && global.navigator && typeof global.navigator.sendBeacon === 'function') {
        try {
          if (global.navigator.sendBeacon(apiUrl(id), new Blob([body], { type: 'application/json' }))) return Promise.resolve(true);
        } catch (e) { /* fall through to fetch */ }
      }
      return fetch(apiUrl(id), {
        method:    (how && how.beacon) ? 'POST' : 'PUT',
        headers:   { 'Content-Type': 'application/json' },
        body:      body,
        keepalive: true,
      })
        .then(function (r) { return r.json().catch(function () { return {}; }); })
        .then(function (d) { return !!(d && d.success); })
        .catch(function () { return false; });
    }

    function placeInfo(blocks, i) {
      return {
        blockIndex:   i,
        snippet:      snippetOf(blocks[i]),
        sectionTitle: sectionTitleFor(blocks, i),
      };
    }

    // Listen (or anything holding a block list) saves block i. No id (an
    // unsaved draft) → nothing is saved; a draft is never saved on its own.
    function saveFromBlocks(blocks, i, how) {
      how = how || {};
      if (!blocks || !blocks[i]) return Promise.resolve(false);
      var id = currentId();
      if (!id) return Promise.resolve(false);
      var info = placeInfo(blocks, i);
      if (how.ui !== false && !dead) {
        version++;
        mark = info;
        drawRibbon(blocks[i]);
        refreshBar();
      }
      announce(id, info);
      return send(id, info, how);
    }

    // The block holding `node` (deepest one — a nested list item comes after
    // its parent in the list). A node outside every block (Further Studies,
    // the Teacher row) takes the last block before it; before them all, the first.
    function blockIndexFor(blocks, node) {
      var hit = -1;
      for (var i = 0; i < blocks.length; i++) if (blocks[i].contains(node)) hit = i;
      if (hit !== -1) return hit;
      for (var j = blocks.length - 1; j >= 0; j--) {
        if (blocks[j].compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) return j;
      }
      return 0;
    }

    // "Mark my place" from the highlight panel: the block holding the start of
    // the highlight. A fresh draft is saved to the Library first (as Mark
    // complete does). cb(ok).
    function markAt(node, cb) {
      cb = cb || function () {};
      if (dead || !node) { cb(false); return; }
      var blocks = collect(container);
      if (!blocks.length) { cb(false); return; }
      var i = blockIndexFor(blocks, node.nodeType === 3 ? node.parentNode : node);
      var info = placeInfo(blocks, i);
      function withId(id) {
        if (!id || dead) { cb(false); return; }
        send(id, info, {}).then(function (ok) {
          if (!ok || dead) { cb(false); return; }
          version++;
          mark = info;
          drawRibbon(blocks[i]);
          refreshBar();
          announce(id, info);
          cb(true);
        });
      }
      var id = currentId();
      if (id) { withId(id); return; }
      if (typeof opts.resolveId === 'function') opts.resolveId(function (rid) { withId(rid); });
      else cb(false);
    }

    function removeMark(done) {
      var id = currentId();
      if (!id) { done && done(); return; }
      fetch(apiUrl(id), { method: 'DELETE' })
        .then(function (r) { return r.json().catch(function () { return {}; }); })
        .then(function (d) {
          if (!d || !d.success) throw new Error((d && d.error) || 'Could not remove the bookmark.');
          if (dead) return;
          version++;
          mark = null;
          clearRibbon();
          hideBar();
          announce(id, null);
        })
        .catch(function (err) {
          if (typeof global.showAlert === 'function') global.showAlert(err.message || 'Could not remove the bookmark. Please try again.');
        })
        .then(function () { if (done) done(); });
    }

    // ── Load the saved place, if any ──────────────────────────────────────
    var startId = currentId();
    if (startId) {
      var v0 = version;
      fetch(apiUrl(startId))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (dead || version !== v0 || !d || !d.success || !d.bookmark) return;
          mark = {
            blockIndex:   d.bookmark.blockIndex,
            snippet:      d.bookmark.snippet || '',
            sectionTitle: d.bookmark.sectionTitle || '',
          };
          var b = findBlock(mark);
          if (b) drawRibbon(b);
          showBar();
        })
        .catch(function () { /* no bar — the study reads as always */ });
    }

    var ctrl = {
      markAt:         markAt,
      saveFromBlocks: saveFromBlocks,
      currentId:      currentId,
      hasId:          function () { return !!currentId() || typeof opts.resolveId === 'function'; },
      // The study was marked complete: the server has dropped the bookmark;
      // clear it here too (no request).
      forget: function (id) {
        if (dead) return;
        version++;
        mark = null;
        clearRibbon();
        hideBar();
        announce(id || currentId(), null);
      },
      destroy: function () {
        dead = true;
        global.removeEventListener('resize', onResize);
        clearRibbon();
        if (bar) bar.remove();
        bar = null;
      },
    };
    container.__studyBookmark = ctrl;
    return ctrl;
  }

  function destroy(container) {
    if (container && container.__studyBookmark) {
      container.__studyBookmark.destroy();
      container.__studyBookmark = null;
    }
  }

  // The bookmark controller for the study holding `node`, or null (Scripture,
  // the Teacher page, anything that isn't a study view with bookmarks).
  function forNode(node) {
    var el = node && (node.nodeType === 3 ? node.parentNode : node);
    while (el && el !== document) {
      if (el.__studyBookmark) return el.__studyBookmark;
      el = el.parentNode;
    }
    return null;
  }

  global.IronInkStudyBookmark = {
    attach:  attach,
    destroy: destroy,
    forNode: forNode,
  };

}(window));
