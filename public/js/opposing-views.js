(function (global) {
  'use strict';

  // Opposing Views — the two-part study's page furniture. Shared by the study
  // page (study.js), the Library inline view and modal (library.js) and the
  // Community reader (community.js); called only for studyType 'opposing'.
  // Live Rooms and the Teacher page show both parts with none of this.
  //
  // What it adds, after the study is rendered and sanitized (it works on the
  // DOM, so nothing here goes through the markdown or the sanitizer):
  //   - a fixed note under the Part 1 heading;
  //   - a Hide / Show button on the Part 2 heading, with everything after that
  //     heading moved into one container the button hides. Part 2 is OPEN on
  //     every render; the state is never remembered.
  //   - optionally, "Start an article from this study" and "Debate this view"
  //     at the end (opts.writeLink: { studyId } or { resolveId }).
  //
  // Both renderers: render-markdown.js turns "# Part 2 — …" into h2.guide-h2;
  // marked (Community) turns it into a plain <h1>. Either is found here.
  //
  // Everything added carries data-anchor-skip, so notes and highlights
  // (notepad.js NON_TEXT_SELECTOR), Listen (study-listen.js) and bookmarks
  // (study-bookmark.js) never read, count or quote it. It deliberately does NOT
  // carry .teacher-entry: teacher-entry.js remove() deletes every .teacher-entry
  // element on a re-attach, which would strand a hidden Part 2 with no button.
  // Moving Part 2's nodes into the container keeps their text and document
  // order, so notes anchor exactly as before.
  //
  // Call it BEFORE IronInkTeacher.attach(): teacher-entry appends its end block
  // ("Check my understanding") as the container's last child, and that block
  // must stay outside Part 2. (Anything carrying .teacher-entry is also left in
  // place if it is ever found, as a safeguard.)
  //
  // Built with createElement / textContent only — never innerHTML.

  var PART1_NOTE  = 'Presented as its own defenders would present it. Our response follows in Part 2.';
  var HIDE_LABEL  = 'Hide Part 2 for now';
  var SHOW_LABEL  = 'Show Part 2';
  var WRITE_LABEL = 'Start an article from this study';
  var DEBATE_LABEL = 'Debate this view';

  var PART1_RE = /^\s*part\s*(?:1|one)\b/i;
  var PART2_RE = /^\s*part\s*(?:2|two)\b/i;

  var uid = 0;

  function headingText(h) {
    var c = h.cloneNode(true);
    c.querySelectorAll('button, [data-anchor-skip], .teacher-entry').forEach(function (n) { n.remove(); });
    return (c.textContent || '').replace(/[*_`]/g, '').trim();
  }

  // The Part 1 / Part 2 heading: the top-level "# " line in either renderer
  // (h2.guide-h2 or h1), falling back to any h1-h3 if the AI used a smaller
  // heading for it.
  function findPartHeading(container, re) {
    var sets = ['h2.guide-h2, h1', 'h1, h2, h3'];
    for (var s = 0; s < sets.length; s++) {
      var list = container.querySelectorAll(sets[s]);
      for (var i = 0; i < list.length; i++) {
        if (re.test(headingText(list[i]))) return list[i];
      }
    }
    return null;
  }

  function el(tag, className, text) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (text) e.textContent = text;
    e.setAttribute('data-anchor-skip', '');
    return e;
  }

  function setOpen(state, open) {
    state.body.hidden = !open;
    state.btn.textContent = open ? HIDE_LABEL : SHOW_LABEL;
    state.btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function enhance(container, opts) {
    if (!container) return;
    opts = opts || {};
    // Idempotent per render: a container that already has its Part 2 body (the
    // same render enhanced twice) is left alone.
    if (container.__opposingViews && container.contains(container.__opposingViews.body)) return;
    container.__opposingViews = null;

    var p1 = findPartHeading(container, PART1_RE);
    if (p1) {
      var note = el('div', 'ov-part1-note', PART1_NOTE);
      p1.parentNode.insertBefore(note, p1.nextSibling);
    }

    var p2 = findPartHeading(container, PART2_RE);
    if (p2) {
      var body = document.createElement('div');
      body.className = 'ov-part2-body';
      body.id = 'ovPart2Body' + (++uid);
      // Move everything after the Part 2 heading (at its own level) into the
      // body, in order. Injected Teacher/Listen UI stays where it is.
      var parent = p2.parentNode;
      var n = p2.nextSibling;
      while (n) {
        var next = n.nextSibling;
        var skip = n.nodeType === 1 && n.classList && n.classList.contains('teacher-entry');
        if (!skip) body.appendChild(n);
        n = next;
      }
      parent.insertBefore(body, p2.nextSibling);

      var btn = el('button', 'ov-part2-toggle');
      btn.type = 'button';
      btn.setAttribute('aria-controls', body.id);
      p2.appendChild(btn);

      var state = { heading: p2, body: body, btn: btn };
      setOpen(state, true);   // open by default, every time
      btn.addEventListener('click', function () { setOpen(state, state.body.hidden); });
      container.__opposingViews = state;
    }

    if (opts.writeLink) addWriteLink(container, opts.writeLink);
  }

  // The study's end links, own saved studies only: "Start an article from this
  // study" (Writing) and "Debate this view" (Dialogue, opponent a defender of
  // the view). Both carry only the study id. A fresh draft on the study page is
  // saved first (resolveId, the same save Teacher uses), once for both.
  function addWriteLink(container, cfg) {
    var wrap = el('div', 'ov-write');
    function linkButton(label, title, dest) {
      var btn = el('button', 'btn-warm ov-write-btn', label);
      btn.type = 'button';
      btn.title = title;
      btn.addEventListener('click', function () {
        function go(id) { global.location.href = dest + encodeURIComponent(id); }
        if (cfg.studyId) { go(cfg.studyId); return; }
        if (typeof cfg.resolveId !== 'function') return;
        btn.disabled = true;
        cfg.resolveId(function (err, id) {
          btn.disabled = false;
          if (err || !id) {
            if (typeof global.showAlert === 'function') global.showAlert('The study needs to be saved to your Library first. Please try again.');
            return;
          }
          cfg.studyId = id;
          go(id);
        });
      });
      wrap.appendChild(btn);
    }
    linkButton(WRITE_LABEL, 'Open Writing with this study as your source', '/writing?study=');
    linkButton(DEBATE_LABEL, 'Open Dialogue with a skilled defender of this view', '/dialogue?fromStudy=');
    // After the study text (and after Part 2's body), before any Teacher end
    // block that may already be there.
    var end = null;
    for (var c = container.lastElementChild; c; c = c.previousElementSibling) {
      if (c.classList.contains('teacher-entry-end')) { end = c; break; }
    }
    container.insertBefore(wrap, end);
  }

  // Open Part 2 if `node` is inside it and it is hidden. Listen calls this
  // before tinting a block; bookmarks before scrolling to a place.
  function reveal(node) {
    if (!node || !node.closest) return false;
    var body = node.closest('.ov-part2-body');
    if (!body || !body.hidden) return false;
    var root = body.parentNode;
    while (root && !root.__opposingViews) root = root.parentNode;
    if (root && root.__opposingViews && root.__opposingViews.body === body) setOpen(root.__opposingViews, true);
    else body.hidden = false;
    return true;
  }

  global.IronInkOpposingViews = { enhance: enhance, reveal: reveal };

}(window));
