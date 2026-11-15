(function () {
  'use strict';

  // Read-aloud on the Scripture reader, using the browser's own speech
  // (speechSynthesis). No server, no external service. Speaks one verse at a
  // time — Chrome cuts off long utterances — highlighting the verse being read.
  // At the end of a chapter it loads the next (across books) and carries on,
  // stopping after Revelation. It stops if the member changes chapter
  // themselves or leaves the page.
  //
  // The voice list, speed, utterance queue, Chrome long-utterance handling,
  // pause/resume/stop and page-leave handling live in the shared engine
  // (read-aloud.js, also used by studies). This file supplies the verses and the
  // chapter-to-chapter carry-on.
  //
  // Uses the reader's hooks: 'scripture:chapter-change' / 'scripture:chapter-
  // rendered' events and window.__scriptureReader (scripture.js). A verse-number
  // click while reading is routed here via window.__scriptureAudio.

  var wrap = document.getElementById('scriptureAudio');
  var body = document.getElementById('scriptureBody');
  if (!wrap || !body) return;
  // No speech support → the controls stay hidden and nothing else changes.
  var RA = window.IronInkReadAloud;
  if (!RA || !RA.supported()) return;

  var playBtn  = document.getElementById('ttsPlay');
  var stopBtn  = document.getElementById('ttsStop');
  var rateSel  = document.getElementById('ttsRate');
  var voiceSel = document.getElementById('ttsVoice');
  if (!playBtn || !stopBtn || !rateSel || !voiceSel) return;

  var READING_CLASS = 'scripture-reading-verse';
  var LOAD_TIMEOUT  = 30000;   // give up waiting for the next chapter after this

  var awaitKey   = null;       // chapter we asked the reader to load next
  var awaitTimer = null;

  // ── Utilities ─────────────────────────────────────────────────────────────

  function key(book, chapter) { return book + '|' + chapter; }

  function verseEls() { return body.querySelectorAll('.scripture-verse'); }

  // NASB editorial symbols, kept on the page but not spoken: * marks a verb in
  // the historical present ("Jesus *said"); [ ] enclose passages absent from the
  // earliest manuscripts (e.g. Mark 16:9-20); ¶ † ‡ in case an edition uses
  // them. Voices otherwise read them out ("asterisk").
  var UNSPOKEN = /[*\[\]¶†‡]/g;

  // The words of a verse only, as they should be spoken: no verse number, no
  // note markers, no editorial symbols.
  function verseText(p) {
    var c = p.cloneNode(true);
    c.querySelectorAll('.verse-num, .scripture-note-marker, .notepad-marker')
      .forEach(function (n) { n.remove(); });
    return (c.textContent || '').replace(UNSPOKEN, '').replace(/\s+/g, ' ').trim();
  }

  // ── Highlight ─────────────────────────────────────────────────────────────

  function clearHighlight() {
    body.querySelectorAll('.' + READING_CLASS).forEach(function (p) { p.classList.remove(READING_CLASS); });
  }

  // Mark the verse being read; scroll only when it is out of view, so the page
  // doesn't jump on every verse.
  function highlight(p) {
    clearHighlight();
    p.classList.add(READING_CLASS);
    var r = p.getBoundingClientRect();
    if (r.top < 70 || r.bottom > window.innerHeight - 20) {
      p.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function clearAwait() {
    awaitKey = null;
    if (awaitTimer) { clearTimeout(awaitTimer); awaitTimer = null; }
  }

  // ── Player ────────────────────────────────────────────────────────────────

  var player = RA.createPlayer({
    playBtn: playBtn, stopBtn: stopBtn, rateSel: rateSel, voiceSel: voiceSel,
    labels:    { idle: 'Read Aloud', playing: 'Pause', paused: 'Resume' },
    voiceRank: /natural|online|premium|enhanced/i,
    count:     function () { return verseEls().length; },
    textAt:    function (i) { var els = verseEls(); return els[i] ? verseText(els[i]) : ''; },
    onBlock:   function (i) { var els = verseEls(); if (els[i]) highlight(els[i]); },
    onClear:   clearHighlight,
    onStart:   clearAwait,
    onStop:    clearAwait,
    onEnd:     advanceChapter,
  });
  if (!player) return;

  // End of the chapter: ask the reader for the next one and wait for it to
  // render. Stops after Revelation.
  function advanceChapter() {
    var R    = window.__scriptureReader;
    var next = (R && R.nextChapterRef) ? R.nextChapterRef() : null;
    if (!next || !R.goToChapter) { player.stop(); return; }
    clearHighlight();
    awaitKey = key(next.book, next.chapter);
    player.setLoading();
    awaitTimer = setTimeout(function () { if (awaitKey) player.stop(); }, LOAD_TIMEOUT);
    if (!R.goToChapter(next.book, next.chapter)) player.stop();
  }

  // ── Reader events ─────────────────────────────────────────────────────────

  // A chapter change we didn't ask for is the member navigating: stop.
  document.addEventListener('scripture:chapter-change', function (e) {
    var k = e.detail ? key(e.detail.book, e.detail.chapter) : null;
    if (awaitKey && k === awaitKey) return;   // our own move to the next chapter
    if (player.getState() !== 'idle') player.stop();
  });

  document.addEventListener('scripture:chapter-rendered', function (e) {
    var k = e.detail ? key(e.detail.book, e.detail.chapter) : null;
    if (!awaitKey || k !== awaitKey) return;
    clearAwait();
    if (player.getState() === 'loading') player.startAt(0);
    else player.setIndex(0);                  // paused while it loaded
  });

  // Called by scripture.js on a verse-number click. While reading (playing or
  // paused) it reads from that verse and returns true; otherwise false, and the
  // click marks the spot as before.
  function readFromVerse(n) {
    if (player.getState() === 'idle') return false;
    var els = verseEls();
    for (var i = 0; i < els.length; i++) {
      var sup = els[i].querySelector('.verse-num');
      if (sup && parseInt(sup.textContent, 10) === n) { player.startAt(i); return true; }
    }
    return false;
  }

  window.__scriptureAudio = { readFromVerse: readFromVerse };

  wrap.style.display = '';
})();
