(function () {
  'use strict';

  // Read-aloud on the Scripture reader, using the browser's own speech
  // (speechSynthesis). No server, no external service. Speaks one verse at a
  // time — Chrome cuts off long utterances — highlighting the verse being read.
  // At the end of a chapter it loads the next (across books) and carries on,
  // stopping after Revelation. It stops if the member changes chapter
  // themselves or leaves the page.
  //
  // Uses the reader's hooks: 'scripture:chapter-change' / 'scripture:chapter-
  // rendered' events and window.__scriptureReader (scripture.js). A verse-number
  // click while reading is routed here via window.__scriptureAudio.

  var wrap = document.getElementById('scriptureAudio');
  var body = document.getElementById('scriptureBody');
  if (!wrap || !body) return;
  // No speech support → the controls stay hidden and nothing else changes.
  if (!('speechSynthesis' in window) || typeof window.SpeechSynthesisUtterance !== 'function') return;

  var synth    = window.speechSynthesis;
  var playBtn  = document.getElementById('ttsPlay');
  var stopBtn  = document.getElementById('ttsStop');
  var rateSel  = document.getElementById('ttsRate');
  var voiceSel = document.getElementById('ttsVoice');
  if (!playBtn || !stopBtn || !rateSel || !voiceSel) return;

  var RATE_KEY      = 'ironink_scripture_tts_rate';
  var VOICE_KEY     = 'ironink_scripture_tts_voice';
  var READING_CLASS = 'scripture-reading-verse';
  var CHUNK_MAX     = 220;     // a very long verse is spoken in sentence-sized parts
  var LOAD_TIMEOUT  = 30000;   // give up waiting for the next chapter after this

  // 'idle' | 'playing' | 'paused' | 'loading' (moving to the next chapter)
  var state     = 'idle';
  var index     = 0;           // verse being read (index into .scripture-verse)
  var gen       = 0;           // bumped on every start/stop; stale callbacks check it
  var current   = null;        // the live utterance (kept referenced: Chrome can
                               // garbage-collect it and never fire onend)
  var voices    = [];
  var awaitKey  = null;        // chapter we asked the reader to load next
  var awaitTimer = null;

  // ── Utilities ─────────────────────────────────────────────────────────────

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  function key(book, chapter) { return book + '|' + chapter; }

  function verseEls() { return body.querySelectorAll('.scripture-verse'); }

  // The words of a verse only: no verse number, no note markers.
  function verseText(p) {
    var c = p.cloneNode(true);
    c.querySelectorAll('.verse-num, .scripture-note-marker, .notepad-marker')
      .forEach(function (n) { n.remove(); });
    return (c.textContent || '').replace(/\s+/g, ' ').trim();
  }

  // Split a long verse at sentence (then comma, then word) boundaries so no one
  // utterance runs long. Short verses — almost all — come back whole.
  function chunkText(t) {
    if (t.length <= CHUNK_MAX) return [t];
    var parts = t.match(/[^.;:?!]+[.;:?!]+["'’”)\]]*\s*|[^.;:?!]+$/g) || [t];
    var merged = [], buf = '';
    parts.forEach(function (p) {
      if (buf && (buf + p).length > CHUNK_MAX) { merged.push(buf.trim()); buf = ''; }
      buf += p;
    });
    if (buf.trim()) merged.push(buf.trim());
    var out = [];
    merged.forEach(function (c) {
      while (c.length > CHUNK_MAX) {
        var cut = c.lastIndexOf(', ', CHUNK_MAX);
        if (cut < CHUNK_MAX / 2) cut = c.lastIndexOf(' ', CHUNK_MAX);
        if (cut <= 0) cut = CHUNK_MAX;
        out.push(c.slice(0, cut + 1).trim());
        c = c.slice(cut + 1).trim();
      }
      if (c) out.push(c);
    });
    return out;
  }

  // ── Voices ────────────────────────────────────────────────────────────────
  // English voices only. Edge's high-quality voices ("… Online (Natural) …")
  // sort first, then US English, then by name; the first is the default unless
  // a saved choice is still available.

  function isEnglish(v) { return /^en([-_]|$)/i.test(v.lang || ''); }
  function voiceRank(v) {
    return (/natural|online/i.test(v.name) ? 2 : 0) + (/^en[-_]us$/i.test(v.lang || '') ? 1 : 0);
  }

  function loadVoices() {
    var all = [];
    try { all = synth.getVoices() || []; } catch (e) {}
    voices = all.filter(isEnglish).sort(function (a, b) {
      return (voiceRank(b) - voiceRank(a)) || a.name.localeCompare(b.name);
    });

    var saved = lsGet(VOICE_KEY);
    var keep  = voiceSel.value || saved;
    voiceSel.innerHTML = '';
    if (!voices.length) {
      var def = document.createElement('option');
      def.value = '';
      def.textContent = 'Default voice';
      voiceSel.appendChild(def);
      return;
    }
    voices.forEach(function (v) {
      var opt = document.createElement('option');
      opt.value = v.voiceURI;
      opt.textContent = v.name + (v.lang ? ' (' + v.lang + ')' : '');
      voiceSel.appendChild(opt);
    });
    var found = voices.some(function (v) { return v.voiceURI === keep; });
    voiceSel.value = found ? keep : voices[0].voiceURI;
  }

  function selectedVoice() {
    for (var i = 0; i < voices.length; i++) if (voices[i].voiceURI === voiceSel.value) return voices[i];
    return null;
  }

  // ── Speed ─────────────────────────────────────────────────────────────────

  (function initRate() {
    var saved = lsGet(RATE_KEY);
    for (var i = 0; i < rateSel.options.length; i++) {
      if (rateSel.options[i].value === saved) { rateSel.value = saved; break; }
    }
  })();

  function currentRate() {
    var r = parseFloat(rateSel.value);
    return (r >= 0.75 && r <= 1.5) ? r : 1;
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

  // ── Playback ──────────────────────────────────────────────────────────────

  function updateUi() {
    playBtn.textContent = (state === 'playing' || state === 'loading') ? 'Pause'
      : (state === 'paused' ? 'Resume' : 'Read Aloud');
    stopBtn.disabled = (state === 'idle');
  }

  function cancelSpeech() {
    gen++;
    current = null;
    try { synth.cancel(); } catch (e) {}
  }

  // Start (or restart) reading at verse i. When something was speaking, wait a
  // moment after cancel(): Chrome sometimes drops an utterance queued straight
  // after one. A fresh start speaks at once, inside the click — iOS Safari only
  // allows speech that begins in a user gesture.
  function startAt(i) {
    if (!verseEls().length) return;   // chapter still loading — nothing to read
    var busy = synth.speaking || synth.pending;
    cancelSpeech();
    clearAwait();
    index = i;
    state = 'playing';
    updateUi();
    if (!busy) { speakVerse(); return; }
    var token = gen;
    setTimeout(function () {
      if (token === gen && state === 'playing') speakVerse();
    }, 60);
  }

  function speakVerse() {
    var els = verseEls();
    if (!els.length) { stop(); return; }
    while (index < els.length && !verseText(els[index])) index++;
    if (index >= els.length) { advanceChapter(); return; }
    highlight(els[index]);
    speakChunks(chunkText(verseText(els[index])), 0);
  }

  function speakChunks(chunks, ci) {
    var u = new window.SpeechSynthesisUtterance(chunks[ci]);
    var v = selectedVoice();
    if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = 'en-US'; }
    u.rate = currentRate();
    var my = ++gen;
    u.onend = function () {
      if (my !== gen || state !== 'playing') return;
      if (ci + 1 < chunks.length) { speakChunks(chunks, ci + 1); return; }
      index++;
      speakVerse();
    };
    u.onerror = function (e) {
      if (my !== gen) return;
      // Our own cancel() (pause / stop / restart) reports as interrupted.
      if (e && (e.error === 'interrupted' || e.error === 'canceled')) return;
      stop();
    };
    current = u;
    synth.speak(u);
  }

  // Pause by cancelling and remembering the verse; Resume restarts that verse.
  // (speechSynthesis.pause()/resume() is unreliable — on Android Chrome it does
  // nothing, and Chrome can leave the queue stuck after a long pause.)
  function pause() {
    if (state !== 'playing' && state !== 'loading') return;
    if (state === 'playing') cancelSpeech();
    state = 'paused';
    updateUi();
  }

  function stop() {
    cancelSpeech();
    clearAwait();
    state = 'idle';
    index = 0;
    clearHighlight();
    updateUi();
  }

  function clearAwait() {
    awaitKey = null;
    if (awaitTimer) { clearTimeout(awaitTimer); awaitTimer = null; }
  }

  // End of the chapter: ask the reader for the next one and wait for it to
  // render. Stops after Revelation.
  function advanceChapter() {
    var R    = window.__scriptureReader;
    var next = (R && R.nextChapterRef) ? R.nextChapterRef() : null;
    if (!next || !R.goToChapter) { stop(); return; }
    clearHighlight();
    state    = 'loading';
    awaitKey = key(next.book, next.chapter);
    updateUi();
    awaitTimer = setTimeout(function () { if (awaitKey) stop(); }, LOAD_TIMEOUT);
    if (!R.goToChapter(next.book, next.chapter)) stop();
  }

  // ── Reader events ─────────────────────────────────────────────────────────

  // A chapter change we didn't ask for is the member navigating: stop.
  document.addEventListener('scripture:chapter-change', function (e) {
    var k = e.detail ? key(e.detail.book, e.detail.chapter) : null;
    if (awaitKey && k === awaitKey) return;   // our own move to the next chapter
    if (state !== 'idle') stop();
  });

  document.addEventListener('scripture:chapter-rendered', function (e) {
    var k = e.detail ? key(e.detail.book, e.detail.chapter) : null;
    if (!awaitKey || k !== awaitKey) return;
    clearAwait();
    if (state === 'loading') startAt(0);
    else index = 0;                           // paused while it loaded
  });

  // Leaving the page: stop. Chrome otherwise keeps speaking after navigation.
  window.addEventListener('pagehide', function () {
    try { synth.cancel(); } catch (e) {}
  });
  // Back/forward cache restore: the old speech is gone; reset the controls.
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) stop();
  });

  // ── Controls ──────────────────────────────────────────────────────────────

  playBtn.addEventListener('click', function () {
    if (state === 'playing' || state === 'loading') pause();
    else if (state === 'paused') startAt(index);
    else startAt(0);
  });

  stopBtn.addEventListener('click', stop);

  // A new speed or voice applies at once: the current verse restarts with it.
  rateSel.addEventListener('change', function () {
    lsSet(RATE_KEY, rateSel.value);
    if (state === 'playing') startAt(index);
  });

  voiceSel.addEventListener('change', function () {
    lsSet(VOICE_KEY, voiceSel.value);
    if (state === 'playing') startAt(index);
  });

  // Called by scripture.js on a verse-number click. While reading (playing or
  // paused) it reads from that verse and returns true; otherwise false, and the
  // click marks the spot as before.
  function readFromVerse(n) {
    if (state === 'idle') return false;
    var els = verseEls();
    for (var i = 0; i < els.length; i++) {
      var sup = els[i].querySelector('.verse-num');
      if (sup && parseInt(sup.textContent, 10) === n) { startAt(i); return true; }
    }
    return false;
  }

  window.__scriptureAudio = { readFromVerse: readFromVerse };

  // ── Init ──────────────────────────────────────────────────────────────────

  loadVoices();
  // Voices often arrive after load (Chrome, Edge).
  if (typeof synth.addEventListener === 'function') synth.addEventListener('voiceschanged', loadVoices);
  else synth.onvoiceschanged = loadVoices;

  updateUi();
  wrap.style.display = '';
})();
