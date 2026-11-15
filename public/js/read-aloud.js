(function (global) {
  'use strict';

  // Shared read-aloud engine (browser speechSynthesis — no server, no external
  // service). Used by the Scripture reader (scripture-audio.js) and by studies
  // (study-listen.js). It owns what both need and nothing page-specific:
  //
  //   • the English voice list (high-quality voices sorted first) and the speed
  //     select, both remembered under the Scripture page's localStorage keys so
  //     a member's choice carries over between Scripture and studies
  //   • a block queue: the page says how many blocks there are and what each one
  //     says; the engine speaks them in order, one utterance per block, a long
  //     block in sentence-sized parts (Chrome cuts off long utterances, and can
  //     garbage-collect a live utterance so onend never fires — it is kept
  //     referenced)
  //   • Play / Pause / Resume / Stop. Pause cancels and Resume restarts the
  //     current block from its beginning: speechSynthesis.pause()/resume() is
  //     unreliable (Android Chrome ignores it; Chrome can leave the queue stuck)
  //   • leaving the page stops speech (Chrome otherwise keeps talking)
  //
  // The page supplies the blocks and reacts to them through callbacks:
  //   count()           → number of blocks
  //   textAt(i)         → what block i says ('' = skip it)
  //   onBlock(i)        → block i is about to be spoken (highlight it)
  //   onClear()         → reading stopped (remove the highlight)
  //   onEnd(player)     → ran past the last block (stop, or load more and go on)
  //   onStart()/onStop()→ optional hooks at the start of startAt / in stop
  //   pauseAfter(i)     → optional ms of silence after block i (headings)
  //   labels            → { idle, playing, paused } for the play button
  //   voiceRank         → RegExp of voice names to sort first

  var RATE_KEY  = 'ironink_scripture_tts_rate';
  var VOICE_KEY = 'ironink_scripture_tts_voice';
  var CHUNK_MAX = 220;     // a very long block is spoken in sentence-sized parts

  function supported() {
    return ('speechSynthesis' in global) && typeof global.SpeechSynthesisUtterance === 'function';
  }

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  // Split a long text at sentence (then comma, then word) boundaries so no one
  // utterance runs long. Short texts — almost all — come back whole.
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

  function isEnglish(v) { return /^en([-_]|$)/i.test(v.lang || ''); }

  // Only one player speaks at a time (there is one speechSynthesis per page).
  var players = [];
  var lifecycleBound = false;
  function bindLifecycle(synth) {
    if (lifecycleBound) return;
    lifecycleBound = true;
    // Leaving the page: stop. Chrome otherwise keeps speaking after navigation.
    global.addEventListener('pagehide', function () {
      try { synth.cancel(); } catch (e) {}
    });
    // Back/forward cache restore: the old speech is gone; reset the controls.
    global.addEventListener('pageshow', function (e) {
      if (e.persisted) players.forEach(function (p) { p.stop(); });
    });
  }

  function createPlayer(opts) {
    if (!supported()) return null;
    var synth    = global.speechSynthesis;
    var playBtn  = opts.playBtn, stopBtn = opts.stopBtn;
    var rateSel  = opts.rateSel, voiceSel = opts.voiceSel;
    var labels   = opts.labels || { idle: 'Read Aloud', playing: 'Pause', paused: 'Resume' };
    var rankRe   = opts.voiceRank || /natural|online/i;

    // 'idle' | 'playing' | 'paused' | 'loading' (the page is fetching more)
    var state   = 'idle';
    var index   = 0;        // block being read
    var gen     = 0;        // bumped on every start/stop; stale callbacks check it
    var current = null;     // the live utterance (kept referenced — see top)
    var voices  = [];
    var dead    = false;

    function noop() {}
    var count   = opts.count;
    var textAt  = opts.textAt;
    var onBlock = opts.onBlock || noop;
    var onClear = opts.onClear || noop;
    var onEnd   = opts.onEnd   || function (p) { p.stop(); };
    var onStart = opts.onStart || noop;
    var onStop  = opts.onStop  || noop;
    var pauseAfter = opts.pauseAfter || function () { return 0; };

    // ── Voices ──────────────────────────────────────────────────────────────
    // English voices only. High-quality voices (rankRe) sort first, then US
    // English, then by name; the first is the default unless a saved choice is
    // still available.
    function voiceRank(v) {
      return (rankRe.test(v.name) ? 2 : 0) + (/^en[-_]us$/i.test(v.lang || '') ? 1 : 0);
    }

    function loadVoices() {
      if (dead) return;
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

    // ── Speed ───────────────────────────────────────────────────────────────
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

    // ── Playback ────────────────────────────────────────────────────────────
    function updateUi() {
      playBtn.textContent = (state === 'playing' || state === 'loading') ? labels.playing
        : (state === 'paused' ? labels.paused : labels.idle);
      stopBtn.disabled = (state === 'idle');
    }

    function cancelSpeech() {
      gen++;
      current = null;
      try { synth.cancel(); } catch (e) {}
    }

    // Start (or restart) reading at block i. When something was speaking, wait
    // a moment after cancel(): Chrome sometimes drops an utterance queued
    // straight after one. A fresh start speaks at once, inside the click — iOS
    // Safari only allows speech that begins in a user gesture.
    function startAt(i) {
      if (dead || !count()) return;   // nothing (yet) to read
      var busy = synth.speaking || synth.pending;
      players.forEach(function (p) { if (p !== api && p.getState() !== 'idle') p.stop(); });
      cancelSpeech();
      onStart();
      index = i;
      state = 'playing';
      updateUi();
      if (!busy) { speakBlock(); return; }
      var token = gen;
      setTimeout(function () {
        if (token === gen && state === 'playing') speakBlock();
      }, 60);
    }

    function speakBlock() {
      var n = count();
      if (!n) { stop(); return; }
      while (index < n && !textAt(index)) index++;
      if (index >= n) { onEnd(api); return; }
      onBlock(index);
      speakChunks(chunkText(textAt(index)), 0, function () {
        var wait = pauseAfter(index) || 0;
        index++;
        if (!wait) { speakBlock(); return; }
        var token = gen;
        setTimeout(function () {
          if (token === gen && state === 'playing') speakBlock();
        }, wait);
      });
    }

    function utter(text) {
      var u = new global.SpeechSynthesisUtterance(text);
      var v = selectedVoice();
      if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = 'en-US'; }
      u.rate = currentRate();
      return u;
    }

    function speakChunks(chunks, ci, done) {
      var u  = utter(chunks[ci]);
      var my = ++gen;
      u.onend = function () {
        if (my !== gen || state !== 'playing') return;
        if (ci + 1 < chunks.length) { speakChunks(chunks, ci + 1, done); return; }
        done();
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

    // A closing line ("End of study.") with no block of its own; then done().
    function speakLine(text, done) {
      if (state !== 'playing') return;
      speakChunks(chunkText(text), 0, done || stop);
    }

    function pause() {
      if (state !== 'playing' && state !== 'loading') return;
      if (state === 'playing') cancelSpeech();
      state = 'paused';
      updateUi();
    }

    function stop() {
      cancelSpeech();
      onStop();
      state = 'idle';
      index = 0;
      onClear();
      updateUi();
    }

    function toggle() {
      if (state === 'playing' || state === 'loading') pause();
      else if (state === 'paused') startAt(index);
      else startAt(0);
    }

    function setLoading() { state = 'loading'; updateUi(); }

    // ── Controls ────────────────────────────────────────────────────────────
    function onPlayClick() { toggle(); }
    // A new speed or voice applies at once: the current block restarts with it.
    function onRate() {
      lsSet(RATE_KEY, rateSel.value);
      if (state === 'playing') startAt(index);
    }
    function onVoice() {
      lsSet(VOICE_KEY, voiceSel.value);
      if (state === 'playing') startAt(index);
    }
    playBtn.addEventListener('click', onPlayClick);
    stopBtn.addEventListener('click', stop);
    rateSel.addEventListener('change', onRate);
    voiceSel.addEventListener('change', onVoice);

    // Voices often arrive after load (Chrome, Edge).
    loadVoices();
    var usedProp = false;
    if (typeof synth.addEventListener === 'function') synth.addEventListener('voiceschanged', loadVoices);
    else { synth.onvoiceschanged = loadVoices; usedProp = true; }

    function destroy() {
      if (state !== 'idle') stop();
      dead = true;
      playBtn.removeEventListener('click', onPlayClick);
      stopBtn.removeEventListener('click', stop);
      rateSel.removeEventListener('change', onRate);
      voiceSel.removeEventListener('change', onVoice);
      if (!usedProp && typeof synth.removeEventListener === 'function') synth.removeEventListener('voiceschanged', loadVoices);
      players = players.filter(function (p) { return p !== api; });
    }

    var api = {
      startAt:    startAt,
      pause:      pause,
      stop:       stop,
      toggle:     toggle,
      setLoading: setLoading,
      speakLine:  speakLine,
      destroy:    destroy,
      getState:   function () { return state; },
      getIndex:   function () { return index; },
      setIndex:   function (i) { index = i; },
    };
    players.push(api);
    bindLifecycle(synth);
    updateUi();
    return api;
  }

  global.IronInkReadAloud = {
    supported:    supported,
    createPlayer: createPlayer,
    chunkText:    chunkText,
  };

}(window));
