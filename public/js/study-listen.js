(function (global) {
  'use strict';

  // Listen to a study — read-aloud for a rendered study, on the shared engine
  // (read-aloud.js, also behind the Scripture page's Read Aloud). Same voice and
  // speed settings as Scripture. No server, no external service.
  //
  // teacher-entry.js calls IronInkStudyListen.attach(container, topRow) from its
  // own attach(), so every view that shows a study through the shared renderer
  // and Teacher entry points gets it (study page, Library inline view, Community
  // reader). The Teacher page loads teacher-entry.js but not this file, so it
  // has no Listen button.
  //
  // Reads the study block by block — headings (with a short pause after),
  // paragraphs, list items and verse quotations (their reference first, said
  // naturally) — skipping Further Studies and the NASB/Lockman notice, then says
  // "End of study." The block being read is tinted and kept in view; while
  // playing or paused, a click on a block reads from there. When stopped, clicks
  // are left alone entirely.
  //
  // Everything it adds carries .teacher-entry, so the notepad's text walker
  // skips it, print CSS hides it, and teacher-entry's remove() clears it on a
  // re-render (attach() then stops the old reading first).

  var READING_CLASS  = 'study-reading-block';
  var HEADING_PAUSE  = 450;    // ms of silence after a heading
  var BLOCK_SEL      = 'h1, h2, h3, h4, h5, h6, p, li, blockquote';
  var WATCH_MS       = 1000;   // how often to check the study is still on screen

  var TRANSLATION_LABEL = /\(\s*(?:NASB(?:\s*1995)?|ASV|KJV|ESV|NIV|NKJV)\s*\)/g;
  var NOTICE_RE = /Lockman Foundation|New American Standard Bible\s*®|American Standard Version \(1901/i;

  function isHeading(el) { return /^H[1-6]$/.test(el.tagName); }
  function headingLevel(el) { return parseInt(el.tagName.charAt(1), 10); }

  // "3:23-25" → "3, verses 23 to 25"; "3:23" → "3, verse 23";
  // "3:23-4:2" → "3, verse 23, to chapter 4, verse 2". Only after a word, so
  // times and ratios elsewhere are rare to hit.
  function speakRefs(t) {
    return t.replace(/([A-Za-z]\.?\s+)(\d{1,3}):(\d{1,3})(?:\s*[-–]\s*(\d{1,3})(?::(\d{1,3}))?)?/g,
      function (m, pre, c, v, v2, v3) {
        if (v3) return pre + c + ', verse ' + v + ', to chapter ' + v2 + ', verse ' + v3;
        if (v2) return pre + c + ', verses ' + v + ' to ' + v2;
        return pre + c + ', verse ' + v;
      });
  }

  // Plain words only: no verse numbers, note markers, Teacher buttons,
  // markdown/HTML symbols, NASB historical-present asterisks or footnote
  // brackets.
  function cleanText(el) {
    var c = el.cloneNode(true);
    c.querySelectorAll('.teacher-entry, .guide-vnum, .notepad-marker, .scripture-note-marker, .verse-num, sup, button, script, style')
      .forEach(function (n) { n.remove(); });
    if (el.tagName === 'LI') c.querySelectorAll('ul, ol').forEach(function (n) { n.remove(); });
    var t = c.textContent || '';
    return t
      .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, ' ')                      // any stray superscript verse numbers
      .replace(/\[\s*(?:\d+(?:\s*[,–-]\s*\d+)*|[a-z])\s*\]/gi, '') // [1] [2, 3] [a] footnote / citation marks
      .replace(TRANSLATION_LABEL, '')
      .replace(/[*#_`~|\[\]¶†‡•]/g, ' ')
      .replace(/^\s*>+\s*/, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // What a block says. A set-apart verse quotation (“…” — Romans 3:23-25
  // (NASB 1995)) is read reference first, so the listener knows what's quoted.
  function blockSpeech(el) {
    var t = cleanText(el);
    if (!t || NOTICE_RE.test(t)) return '';
    if (el.tagName === 'BLOCKQUOTE') {
      var m = t.match(/^([“"][\s\S]*[”"])\s*[—–]\s*(.+?)\s*$/);
      if (m && /\d/.test(m[2])) return speakRefs(m[2]) + '. ' + m[1];
    }
    t = speakRefs(t);
    if (isHeading(el) && !/[.?!:]$/.test(t)) t += '.';
    return t;
  }

  // The study's readable blocks, in order. Paragraphs inside a list item or a
  // quotation belong to it; Further Studies (its heading through the next heading
  // of the same or higher rank) is left out.
  function collectBlocks(container) {
    var out = [], skipLevel = 0;
    container.querySelectorAll(BLOCK_SEL).forEach(function (el) {
      if (el.closest('.teacher-entry')) return;
      var parent = el.parentElement && el.parentElement.closest('li, blockquote');
      if (parent && container.contains(parent)) {
        // a nested list item stays its own block; anything else in a li/quote is part of it
        if (!(el.tagName === 'LI' && parent.tagName === 'LI')) return;
      }
      if (isHeading(el)) {
        var lvl = headingLevel(el);
        if (skipLevel && lvl <= skipLevel) skipLevel = 0;
        if (!skipLevel && /further\s+stud/i.test(el.textContent || '')) { skipLevel = lvl; return; }
      }
      if (skipLevel) return;
      out.push(el);
    });
    return out;
  }

  function onScreen(container) {
    return container.isConnected && container.getClientRects().length > 0;
  }

  function makeEl(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (text) el.textContent = text;
    return el;
  }

  var RATES = [['0.75', '0.75×'], ['0.9', '0.9×'], ['1', '1×'], ['1.1', '1.1×'], ['1.25', '1.25×'], ['1.5', '1.5×']];

  function attach(container, topRow) {
    if (!container || !topRow) return;
    var RA = global.IronInkReadAloud;
    if (!RA || !RA.supported()) return;   // no speech support → no Listen button

    // A re-render (another study, a fresh draft) stops the old reading.
    if (container.__studyListen) { container.__studyListen.destroy(); container.__studyListen = null; }

    // Listen button, beside Study with a Teacher / Mark complete.
    var choice = makeEl('div', 'teacher-entry-choice study-listen-choice');
    var listenBtn = makeEl('button', 'study-complete-btn study-listen-btn', 'Listen');
    listenBtn.type = 'button';
    listenBtn.title = 'Have this study read aloud to you';
    listenBtn.setAttribute('aria-expanded', 'false');
    choice.appendChild(listenBtn);
    var compSpot = topRow.querySelector('.study-complete');
    topRow.insertBefore(choice, compSpot || null);

    // The player bar: sticky at the top of the study while it scrolls.
    var bar = makeEl('div', 'teacher-entry study-listen-bar');
    bar.hidden = true;
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', 'Listen to this study');
    var playBtn = makeEl('button', 'guide-print-btn study-listen-play', 'Play');
    playBtn.type = 'button';
    var stopBtn = makeEl('button', 'guide-print-btn study-listen-stop', 'Stop');
    stopBtn.type = 'button';
    stopBtn.disabled = true;
    var rateSel = makeEl('select', 'scripture-select scripture-audio-select study-listen-rate');
    rateSel.setAttribute('aria-label', 'Reading speed');
    rateSel.title = 'Reading speed';
    RATES.forEach(function (r) {
      var o = makeEl('option', null, r[1]);
      o.value = r[0];
      if (r[0] === '1') o.selected = true;
      rateSel.appendChild(o);
    });
    var voiceSel = makeEl('select', 'scripture-select scripture-audio-select scripture-audio-voice study-listen-voice');
    voiceSel.setAttribute('aria-label', 'Voice');
    voiceSel.title = 'Voice';
    var closeBtn = makeEl('button', 'study-listen-close', '×');
    closeBtn.type = 'button';
    closeBtn.title = 'Close the player';
    closeBtn.setAttribute('aria-label', 'Close the player');
    bar.appendChild(playBtn);
    bar.appendChild(stopBtn);
    bar.appendChild(rateSel);
    bar.appendChild(voiceSel);
    bar.appendChild(closeBtn);
    container.insertBefore(bar, container.firstChild);

    var blocks = [], texts = [];
    var current = null;   // block element tinted now
    var watch = null;

    function refreshBlocks() {
      blocks = collectBlocks(container);
      texts  = blocks.map(blockSpeech);
    }

    function clearTint() {
      container.querySelectorAll('.' + READING_CLASS).forEach(function (el) { el.classList.remove(READING_CLASS); });
      current = null;
    }

    // Tint the block; scroll only when the block changes and it isn't fully in
    // view below the sticky bar.
    function tint(el) {
      if (el === current) return;
      clearTint();
      current = el;
      el.classList.add(READING_CLASS);
      var r = el.getBoundingClientRect();
      var topEdge = (bar.hidden ? 0 : bar.getBoundingClientRect().bottom) + 10;
      if (r.top < Math.max(70, topEdge) || r.bottom > window.innerHeight - 20) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }

    function startWatch() {
      if (watch) return;
      watch = setInterval(function () {
        if (player.getState() === 'idle') { clearInterval(watch); watch = null; return; }
        if (!onScreen(container)) player.stop();   // back to the list, another view, …
      }, WATCH_MS);
    }

    var player = RA.createPlayer({
      playBtn: playBtn, stopBtn: stopBtn, rateSel: rateSel, voiceSel: voiceSel,
      labels:     { idle: 'Play', playing: 'Pause', paused: 'Resume' },
      voiceRank:  /natural|online|premium|enhanced/i,
      count:      function () { return blocks.length; },
      textAt:     function (i) { return texts[i] || ''; },
      onBlock:    function (i) { if (blocks[i]) tint(blocks[i]); },
      onClear:    clearTint,
      // A start from Stop re-reads the blocks (markers or buttons may have been
      // added since); a jump, resume or new speed keeps the same list.
      onStart:    function () { if (player.getState() === 'idle') refreshBlocks(); startWatch(); },
      pauseAfter: function (i) { return (blocks[i] && isHeading(blocks[i])) ? HEADING_PAUSE : 0; },
      onEnd:      function (p) { clearTint(); p.speakLine('End of study.', p.stop); },
    });
    if (!player) { choice.remove(); bar.remove(); return; }

    function play() { refreshBlocks(); player.startAt(0); }

    function openBar() {
      bar.hidden = false;
      listenBtn.textContent = 'Hide player';
      listenBtn.setAttribute('aria-expanded', 'true');
    }
    function closeBar() {
      player.stop();
      bar.hidden = true;
      listenBtn.textContent = 'Listen';
      listenBtn.setAttribute('aria-expanded', 'false');
    }

    // Listen opens the player and starts reading at once (inside the click —
    // iOS only allows speech that begins in a user gesture).
    listenBtn.addEventListener('click', function () {
      if (bar.hidden) { openBar(); play(); }
      else closeBar();
    });
    closeBtn.addEventListener('click', closeBar);

    // Click a block while playing or paused → read from there. When stopped,
    // nothing here runs, so highlighting, the highlight panel, notes and links
    // behave as always. Links, buttons and a drag-selection are left alone.
    function onContainerClick(e) {
      var st = player.getState();
      if (st !== 'playing' && st !== 'paused') return;
      var t = e.target;
      if (!t || !t.closest || t.closest('a, button, input, select, textarea, label, .teacher-entry')) return;
      var sel = global.getSelection && global.getSelection();
      if (sel && !sel.isCollapsed && String(sel).trim()) return;
      var el = t.closest(BLOCK_SEL);
      while (el && container.contains(el)) {
        var i = blocks.indexOf(el);
        if (i !== -1) { player.startAt(i); return; }
        el = el.parentElement && el.parentElement.closest(BLOCK_SEL);
      }
    }
    container.addEventListener('click', onContainerClick);

    // Browser back/forward within the page's own history: stop.
    function onPop() { if (player.getState() !== 'idle') player.stop(); }
    global.addEventListener('popstate', onPop);

    container.__studyListen = {
      destroy: function () {
        player.destroy();
        clearTint();
        if (watch) { clearInterval(watch); watch = null; }
        container.removeEventListener('click', onContainerClick);
        global.removeEventListener('popstate', onPop);
      },
    };
  }

  global.IronInkStudyListen = { attach: attach };

}(window));
