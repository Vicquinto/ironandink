(function () {
  'use strict';

  // ─── Languages lesson page ────────────────────────────────────────────────
  // LEFT: the lesson materials, rendered from the server's boot data (course
  // files + orig/, lib/languages.js lessonMaterials). RIGHT: the lesson teacher,
  // on the Teacher page's pattern (public/js/teacher.js): the server owns and
  // saves the transcript, this page sends only the new message or control, and
  // "Pick up where you left off" redraws the saved conversation with NO AI call.
  // Everything from the data is set with textContent; teacher replies are
  // escaped first and pass the shared sanitizer.

  var BOOT = window.LANG_LESSON_BOOT || {};
  var M = BOOT.materials || {};
  var LANG = (M.course && M.course.lang) || 'grc';
  var DIR  = (M.course && M.course.direction) || 'ltr';
  var GENERIC_ERROR = 'The teacher couldn\'t respond. Please try again.';
  var SESSION_URL = '/api/languages/' + encodeURIComponent(BOOT.course) + '/' + encodeURIComponent(BOOT.lessonId) + '/session';

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  // Original-language text. Hebrew sits in an inner span at 1.25× the size the
  // element would have for Greek (vowel points are small); it scales with A−/A/A+.
  var HEB = LANG === 'he';
  function greek(tag, text, cls) {
    var t = String(text || '').normalize('NFC');
    var e = el(tag, 'ucp-orig-script' + (cls ? ' ' + cls : ''), HEB ? null : t);
    e.lang = LANG; e.dir = DIR;
    if (HEB) e.appendChild(el('span', 'lang-he-scale', t));
    return e;
  }
  function section(title) {
    var s = el('section', 'lang-sec');
    if (title) s.appendChild(el('h3', 'lang-sec-title', title));
    return s;
  }
  function note(parent, text) { if (text) parent.appendChild(el('p', 'lang-note', text)); }

  if (window.IronInkOrigWords) window.IronInkOrigWords.loadFonts();

  // ── Materials ────────────────────────────────────────────────────────────
  var pane = document.getElementById('langMaterials');

  function exampleLine(ex) {
    var span = el('span', 'lang-ex');
    span.appendChild(greek('span', ex.display, 'lang-ex-greek'));
    var bits = [ex.translit, ex.gloss].filter(Boolean).join(', ');
    if (ex.isForm && ex.lemma && ex.lemma !== ex.display) bits = 'a form of ' + ex.lemma + (bits ? '; ' + bits : '');
    if (bits) span.appendChild(el('span', 'lang-ex-gloss', ' (' + bits + ')'));
    return span;
  }
  function examplesCell(list, fallback) {
    var d = el('div', 'lang-examples');
    (list || []).forEach(function (ex, i) {
      if (i) d.appendChild(document.createTextNode(' · '));
      d.appendChild(exampleLine(ex));
    });
    if (!(list || []).length && fallback) d.appendChild(el('span', 'lang-ex-gloss', fallback));
    return d;
  }

  // ── Hear it clips ─────────────────────────────────────────────────────────
  // Short clips of single sounds (courses/sounds.json, via M.sounds), only in
  // the Sound cell of the alphabet-table rows the server marked with a clip.
  // One shared <audio> element: one clip at a time; pressing the playing
  // button again stops it. MP3 only.
  var CLIPS = {};
  (M.sounds || []).forEach(function (s) { if (s && s.id && s.src) CLIPS[s.id] = s; });
  var player = null, playingBtn = null;
  function clipStopped() {
    if (playingBtn) { playingBtn.classList.remove('is-playing'); playingBtn.setAttribute('aria-pressed', 'false'); }
    playingBtn = null;
  }
  function playClip(s, btn) {
    var again = playingBtn === btn;
    if (player) player.pause();
    clipStopped();
    if (again) return;
    if (!player) {
      player = document.createElement('audio');
      player.preload = 'none';
      player.addEventListener('ended', clipStopped);
      player.addEventListener('error', clipStopped);
    }
    if (player.getAttribute('src') !== s.src) player.src = s.src;
    try { player.currentTime = 0; } catch (e) { /* not loaded yet */ }
    playingBtn = btn;
    btn.classList.add('is-playing'); btn.setAttribute('aria-pressed', 'true');
    var p = player.play();
    if (p && typeof p.catch === 'function') p.catch(clipStopped);
  }
  function clipFor(row) { return (row && row.clip && Object.prototype.hasOwnProperty.call(CLIPS, row.clip)) ? CLIPS[row.clip] : null; }
  function addHearIt(td, row) {
    var s = clipFor(row);
    if (!s) return;
    var wrap = el('span', 'lang-hear');
    var b = el('button', 'lang-hear-btn', 'Hear it');
    b.type = 'button';
    b.setAttribute('aria-pressed', 'false');
    b.setAttribute('aria-label', 'Hear it: ' + (row.name || '') + ' ' + s.caption);
    b.addEventListener('click', function () { playClip(s, b); });
    wrap.appendChild(b);
    if (s.caption) wrap.appendChild(el('span', 'lang-hear-cap', s.caption));
    td.appendChild(wrap);
  }
  // One credit line under a table, for only the clips in that table: authors in
  // order of first use, each clip name linking to its Commons file page.
  function clipCredit(parent, rows) {
    var used = [];
    rows.forEach(function (r) { var s = clipFor(r); if (s && used.indexOf(s) < 0) used.push(s); });
    if (!used.length) return;
    function txt(t) { return document.createTextNode(t); }
    function link(href, t) { var a = el('a', null, t); a.href = href; a.target = '_blank'; a.rel = 'noopener'; return a; }
    var groups = [];
    used.forEach(function (s) {
      var g = null;
      groups.forEach(function (x) { if (x.author === s.author) g = x; });
      if (!g) { g = { author: s.author, clips: [] }; groups.push(g); }
      g.clips.push(s);
    });
    var licenses = [];
    used.forEach(function (s) { if (!licenses.some(function (l) { return l.license === s.license; })) licenses.push(s); });
    var p = el('p', 'lang-credit lang-clip-credit');
    p.appendChild(txt('Sound clips: '));
    groups.forEach(function (g, gi) {
      if (gi) p.appendChild(txt(gi === groups.length - 1 ? ' and ' : ', '));
      p.appendChild(txt(g.author + ' ('));
      g.clips.forEach(function (s, i) { if (i) p.appendChild(txt(', ')); p.appendChild(link(s.commonsUrl, s.label)); });
      p.appendChild(txt(')'));
    });
    p.appendChild(txt(', via Wikimedia Commons, '));
    licenses.forEach(function (s, i) { if (i) p.appendChild(txt(' / ')); p.appendChild(link(s.licenseUrl, s.license)); });
    p.appendChild(txt('. Converted to MP3.'));
    parent.appendChild(p);
  }

  // ── Hebrew alphabet.json sections (consonants, vowels, shewa, dagesh, …) ──
  var HE_TITLES = {
    finalForms: 'Final forms', readingDirection: 'Reading right to left', begadkephat: 'Begadkephat: six letters with a dot',
    dagesh: 'Dagesh', mappiq: 'Mappiq', vowels: 'Vowel points', furtivePatach: 'Furtive patach', shewa: 'Shewa',
    hatephVowels: 'Hateph vowels', syllables: 'Syllables and stress', marks: 'Maqqef, sof pasuq and other marks',
  };
  function refsLine(parent, refs) { if (refs && refs.length) parent.appendChild(el('p', 'lang-ex-gloss', 'See ' + refs.join(', ') + ' below.')); }
  function heVowelTable(list) {
    var table = el('table', 'lang-table lang-alpha-table');
    var hr = el('tr');
    ['Sign', 'Name', 'Sound', 'Length', 'Written', 'Example'].forEach(function (h) { hr.appendChild(el('th', null, h)); });
    var th = el('thead'); th.appendChild(hr); table.appendChild(th);
    var tb = el('tbody');
    list.forEach(function (x) {
      var tr = el('tr');
      var c1 = el('td', 'lang-alpha-big'); c1.setAttribute('data-label', 'Sign'); c1.appendChild(greek('span', x.sign));
      var cells = [c1, ['Name', x.name], ['Sound', x.sound], ['Length', x['class'] || ''], ['Written', x.translit]];
      cells.forEach(function (c, i) {
        if (i === 0) { tr.appendChild(c); return; }
        var td = el('td', c[0] === 'Written' ? 'lang-translit' : null, c[1]); td.setAttribute('data-label', c[0]); tr.appendChild(td);
      });
      var ex = el('td'); ex.setAttribute('data-label', 'Example'); ex.appendChild(examplesCell(x.examples, x.note || x.noExampleNote));
      if (x.note && x.examples && x.examples.length) ex.appendChild(el('div', 'lang-ex-gloss', x.note));
      tr.appendChild(ex);
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    return table;
  }
  // One alphabet part of any shape: text, a list of items, or an object with
  // a description, examples, verse refs and sub-items (shewa: vocal / silent).
  function heNode(node, parent) {
    if (typeof node === 'string') { parent.appendChild(el('p', null, node)); return; }
    if (Array.isArray(node)) {
      var dl = el('dl', 'lang-dl');
      node.forEach(function (x) {
        var dt = el('dt', null, x.name || '');
        var mark = x.sign || x.form || x.mark;
        if (mark) dt.appendChild(greek('span', ' ' + mark, 'lang-mark'));
        var dd = el('dd', null, [x.description, x.sound, x.rule].filter(Boolean).join(' '));
        if (x.examples && x.examples.length) dd.appendChild(examplesCell(x.examples));
        if (x.noExampleNote) dd.appendChild(el('div', 'lang-ex-gloss', x.noExampleNote));
        refsLine(dd, x.exampleRefs);
        dl.appendChild(dt); dl.appendChild(dd);
      });
      parent.appendChild(dl);
      return;
    }
    if (!node || typeof node !== 'object') return;
    if (node.letters || node.sign || node.mark) parent.appendChild(el('p')).appendChild(greek('span', [].concat(node.letters || node.sign || node.mark).join(' '), 'lang-mark'));
    if (node.description) parent.appendChild(el('p', null, node.description));
    if (node.examples && node.examples.length) parent.appendChild(examplesCell(node.examples));
    refsLine(parent, node.exampleRefs);
    ['vocal', 'silent'].forEach(function (k) {
      var sub = node[k];
      if (!sub) return;
      var dl = el('dl', 'lang-dl');
      var dt = el('dt', null, k === 'vocal' ? 'Vocal shewa' : 'Silent shewa');
      var dd = el('dd', null, (sub.rule || '') + (sub.translit ? ' Written: ' + sub.translit + '.' : ''));
      if (sub.examples && sub.examples.length) dd.appendChild(examplesCell(sub.examples));
      dl.appendChild(dt); dl.appendChild(dd);
      parent.appendChild(dl);
    });
  }
  function renderHebrewAlphabet(A) {
    if (A.consonants) {
      var s = section('The consonants');
      if (A.direction === 'rtl') note(s, 'Hebrew is read from right to left.');
      if (A.pronunciation) note(s, 'Pronunciation: ' + A.pronunciation + '.');
      var table = el('table', 'lang-table lang-alpha-table');
      var hr = el('tr');
      ['Letter', 'Final form', 'Name', 'Sound', 'Sounds like', 'Written', 'Example'].forEach(function (h) { hr.appendChild(el('th', null, h)); });
      var th = el('thead'); th.appendChild(hr); table.appendChild(th);
      var tb = el('tbody');
      A.consonants.forEach(function (x) {
        var tr = el('tr');
        var c1 = el('td', 'lang-alpha-big'); c1.setAttribute('data-label', 'Letter');
        c1.appendChild(greek('span', x.variants ? x.variants.map(function (v) { return v.form; }).join(' ') : x.form));
        var c2 = el('td', 'lang-alpha-big'); c2.setAttribute('data-label', 'Final form'); if (x.finalForm) c2.appendChild(greek('span', x.finalForm));
        tr.appendChild(c1); tr.appendChild(c2);
        [['Name', x.name], ['Sound', x.sound], ['Sounds like', x.soundAlike], ['Written', x.translit]].forEach(function (c) {
          var td = el('td', c[0] === 'Written' ? 'lang-translit' : null, c[1]); td.setAttribute('data-label', c[0]); tr.appendChild(td);
          if (c[0] === 'Sound') addHearIt(td, x);
        });
        var ex = el('td'); ex.setAttribute('data-label', 'Example'); ex.appendChild(examplesCell(x.examples, x.noExampleNote));
        tr.appendChild(ex);
        tb.appendChild(tr);
      });
      table.appendChild(tb);
      s.appendChild(table);
      clipCredit(s, A.consonants);
      pane.appendChild(s);
    }
    (A.parts || []).forEach(function (pt) {
      if (pt.name === 'hatephNote') { var last = pane.lastChild; if (last) note(last, pt.content); return; }
      var sec = section(HE_TITLES[pt.name] || pt.name);
      if (pt.name === 'vowels' || pt.name === 'hatephVowels') sec.appendChild(heVowelTable(pt.content));
      else heNode(pt.content, sec);
      pane.appendChild(sec);
    });
    if (A.transliteration) { var tsec = pane.lastChild || pane; note(tsec, 'Transliteration: ' + A.transliteration); }
  }

  function renderAlphabet(A) {
    if (A.consonants || A.parts) { renderHebrewAlphabet(A); return; }
    if (A.letters) {
      var s = section('The letters');
      if (A.pronunciation) note(s, 'Pronunciation: ' + A.pronunciation + '.');
      var table = el('table', 'lang-table lang-alpha-table');
      var thead = el('thead');
      var hr = el('tr');
      ['Capital', 'Small', 'Name', 'Sound (Erasmian)', 'Sounds like', 'Written', 'Example'].forEach(function (h) { hr.appendChild(el('th', null, h)); });
      thead.appendChild(hr); table.appendChild(thead);
      var tb = el('tbody');
      A.letters.forEach(function (x) {
        var tr = el('tr');
        var c1 = el('td', 'lang-alpha-big'); c1.setAttribute('data-label', 'Capital'); c1.appendChild(greek('span', x.capital));
        var c2 = el('td', 'lang-alpha-big'); c2.setAttribute('data-label', 'Small'); c2.appendChild(greek('span', x.small + (x.finalSmall ? ' ' + x.finalSmall : '')));
        var c3 = el('td', null, x.name); c3.setAttribute('data-label', 'Name');
        var c4 = el('td', null, x.sound); c4.setAttribute('data-label', 'Sound'); addHearIt(c4, x);
        var c5 = el('td', null, x.soundAlike); c5.setAttribute('data-label', 'Sounds like');
        var c6 = el('td', 'lang-translit', x.translit); c6.setAttribute('data-label', 'Written');
        var c7 = el('td'); c7.setAttribute('data-label', 'Example'); c7.appendChild(examplesCell(x.examples, x.note));
        [c1, c2, c3, c4, c5, c6, c7].forEach(function (c) { tr.appendChild(c); });
        tb.appendChild(tr);
      });
      table.appendChild(tb);
      s.appendChild(table);
      clipCredit(s, A.letters);
      if (A.transliteration) note(s, 'Transliteration: ' + A.transliteration);
      pane.appendChild(s);
    }
    if (A.diphthongs) {
      var d = section('Diphthongs: two vowels, one sound');
      var dl = el('dl', 'lang-dl');
      A.diphthongs.forEach(function (x) {
        var dt = el('dt'); dt.appendChild(greek('span', x.letters)); dt.appendChild(el('span', 'lang-translit', ' ' + x.translit));
        var dd = el('dd', null, x.sound); dd.appendChild(examplesCell(x.examples, x.note));
        dl.appendChild(dt); dl.appendChild(dd);
      });
      d.appendChild(dl); pane.appendChild(d);
    }
    if (A.breathings) {
      var b = section('Breathing marks');
      var bl = el('dl', 'lang-dl');
      A.breathings.forEach(function (x) {
        var dt = el('dt', null, x.name); if (x.mark) dt.appendChild(greek('span', ' ' + x.mark, 'lang-mark'));
        var dd = el('dd', null, x.description); dd.appendChild(examplesCell(x.examples));
        bl.appendChild(dt); bl.appendChild(dd);
      });
      b.appendChild(bl); pane.appendChild(b);
    }
    if (A.iotaSubscript) {
      var io = section('Iota subscript');
      var p = el('p'); p.appendChild(greek('span', A.iotaSubscript.letters.join(' '), 'lang-mark')); io.appendChild(p);
      io.appendChild(el('p', null, A.iotaSubscript.description));
      io.appendChild(examplesCell(A.iotaSubscript.examples));
      pane.appendChild(io);
    }
    if (A.accents) {
      var ac = section('Accents (to recognize, not to write)');
      ac.appendChild(el('p', null, A.accents.description));
      var al = el('dl', 'lang-dl');
      A.accents.marks.forEach(function (x) {
        var dt = el('dt', null, x.name); dt.appendChild(greek('span', ' ' + x.mark, 'lang-mark'));
        var dd = el('dd', null, x.description); dd.appendChild(examplesCell(x.examples));
        al.appendChild(dt); al.appendChild(dd);
      });
      ac.appendChild(al);
      A.accents.extra.forEach(function (x) { ac.appendChild(el('p', null, x.description)); ac.appendChild(examplesCell(x.examples)); });
      pane.appendChild(ac);
    }
    if (A.otherMarks) {
      var om = section('Other marks');
      var ol = el('dl', 'lang-dl');
      A.otherMarks.forEach(function (x) {
        var dt = el('dt', null, x.name); if (x.mark) dt.appendChild(greek('span', ' ' + x.mark, 'lang-mark'));
        var dd = el('dd', null, x.description); dd.appendChild(examplesCell(x.examples, x.note));
        ol.appendChild(dt); ol.appendChild(dd);
      });
      om.appendChild(ol); pane.appendChild(om);
    }
    if (A.punctuation) {
      var pu = section('Punctuation');
      var pl = el('dl', 'lang-dl');
      A.punctuation.forEach(function (x) {
        var dt = el('dt'); dt.appendChild(greek('span', x.mark, 'lang-mark')); dt.appendChild(document.createTextNode(' ' + x.name));
        pl.appendChild(dt); pl.appendChild(el('dd', null, x.meaning));
      });
      pu.appendChild(pl); note(pu, A.punctuationNote); pane.appendChild(pu);
    }
  }

  function renderWords(words) {
    var s = section('New words');
    var grid = el('div', 'lang-vocab');
    words.forEach(function (w) {
      var card = el('div', 'lang-vocab-card');
      if (w.bound) card.appendChild(el('div', 'lang-vocab-bound', w.bound));   // Hebrew prefix / suffix
      card.appendChild(greek('div', w.display, 'lang-vocab-greek'));
      card.appendChild(el('div', 'lang-vocab-translit', w.translit));
      card.appendChild(el('div', 'lang-vocab-gloss', w.gloss));
      card.appendChild(el('div', 'lang-vocab-freq', w.freqText));
      if (w.note) card.appendChild(el('div', 'lang-vocab-note', w.note));
      grid.appendChild(card);
    });
    s.appendChild(grid);
    pane.appendChild(s);
  }

  // Paradigm tables: form + cell label. A header row only when every row has
  // one cell per column (pronoun rows with emphatic/unemphatic forms don't).
  function renderParadigm(P) {
    var s = section(P.title);
    var cols = P.columns || [];
    var even = P.rows.every(function (r) { return r.cells.length === cols.length; });
    var table = el('table', 'lang-table lang-paradigm');
    if (HEB) table.dir = 'rtl';   // Hebrew forms right to left; labels stay English
    if (even && cols.length) {
      var thead = el('thead'); var hr = el('tr');
      hr.appendChild(el('th', null, ''));
      cols.forEach(function (c) { hr.appendChild(el('th', null, c)); });
      thead.appendChild(hr); table.appendChild(thead);
    }
    var tb = el('tbody');
    P.rows.forEach(function (r) {
      var tr = el('tr');
      tr.appendChild(el('th', 'lang-paradigm-row', r.label));
      r.cells.forEach(function (c) {
        var td = el('td');
        td.appendChild(greek('div', c.form, 'lang-form'));
        td.appendChild(el('div', 'lang-cell-label', c.cellLabel));
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    s.appendChild(table);
    note(s, P.note);
    pane.appendChild(s);
  }

  // Verses word by word with the Original tab's word cards. Words not learned
  // yet are muted and keep their gloss; learned words show the Greek alone.
  // Hebrew: ask the server to add the word's parts to the verified data block.
  function explain(pos, ref, w) {
    if (HEB && Array.isArray(w.parts) && w.parts.length) pos = Object.assign({}, pos, { withParts: true });
    if (window.IronInkPanel && window.IronInkPanel.explainWord) window.IronInkPanel.explainWord(pos, ref, w);
  }
  function renderVerse(entry, heading) {
    if (!window.IronInkOrigWords || !entry || !entry.data) return null;
    return window.IronInkOrigWords.render(entry.data, {
      heading: heading || function (v) { return v.ref; },
      decorate: function (card, w) {
        // A split word marks each part instead (orig-words.js is-known / is-new).
        if (Array.isArray(w.parts) && w.parts.length) { card.classList.add('lang-w-split'); return; }
        card.classList.add(w.learned ? 'lang-w-known' : 'lang-w-new');
        if (!w.learned) card.title = 'Not learned yet';
      },
      detailExtra: function (dl, w, row) {
        row(dl, 'In this course', w.learned ? 'Learned' : 'Not learned yet');
      },
      onExplain: (window.IronInkPanel && window.IronInkPanel.explainWord) ? explain : null,
    });
  }

  // Outside listening (course.json "listening", via BOOT.listening, not part of
  // the materials the teacher sees): plain text plus external links, which open
  // in a new tab and are marked with an arrow and "(opens in a new tab)".
  function listeningNote(parent) {
    var items = BOOT.listening;
    if (!Array.isArray(items) || !items.length) return;
    var p = el('p', 'lang-note lang-listen');
    items.forEach(function (it) {
      if (!it || typeof it.text !== 'string') return;
      if (!it.href) { p.appendChild(document.createTextNode(it.text)); return; }
      if (!/^https:\/\//.test(it.href)) { p.appendChild(document.createTextNode(it.text)); return; }
      var a = el('a', 'lang-ext-link', it.text);
      a.href = it.href; a.target = '_blank'; a.rel = 'noopener noreferrer';
      var arrow = el('span', 'lang-ext-icon', '↗'); arrow.setAttribute('aria-hidden', 'true');
      a.appendChild(arrow);
      a.appendChild(el('span', 'lang-sr-only', ' (opens in a new tab)'));
      p.appendChild(a);
    });
    parent.appendChild(p);
  }

  function renderMaterials() {
    if (!pane) return;
    var L = M.lesson || {};
    var head = section('');
    head.appendChild(el('h3', 'lang-sec-title', 'In this lesson'));
    var ol = el('ol', 'lang-goals');
    (L.goals || []).forEach(function (g) { ol.appendChild(el('li', null, String(g).normalize('NFC'))); });
    head.appendChild(ol);
    if (L.prereqs && L.prereqs.length) {
      var p = L.prereqs.length > 3 ? '1–' + L.prereqs[L.prereqs.length - 1] : L.prereqs.join(', ');
      head.appendChild(el('p', 'lang-builds', 'Builds on lesson' + (L.prereqs.length > 1 ? 's ' : ' ') + p));
    }
    (L.notes || []).forEach(function (n) { note(head, String(n).normalize('NFC')); });
    (L.recognition || []).forEach(function (n) { note(head, n); });
    listeningNote(head);
    pane.appendChild(head);

    if (M.alphabet) renderAlphabet(M.alphabet);
    if (M.words && M.words.length) renderWords(M.words);
    (M.paradigms || []).forEach(renderParadigm);

    if (M.examples && M.examples.length) {
      var ex = section('Example verses');
      note(ex, HEB
        ? 'Each word is shown split into its parts, right to left. Parts you haven’t learned yet are lighter, with their meaning under them. Click any word for details.'
        : 'Words you haven’t learned yet are shown lighter, with their meaning under them. Click any word for details.');
      M.examples.forEach(function (e) { var w = renderVerse(e); if (w) ex.appendChild(w); });
      pane.appendChild(ex);
    }
    if (M.reading) {
      var rd = section(M.reading.passage || 'The passage');
      note(rd, HEB
        ? 'Read right to left. Each word is split into its parts: parts you have learned are plain; parts not yet learned show their meaning in the passage under them. Click any word for details.'
        : 'Words you have learned are plain. Words not yet learned show their meaning in the passage under them. Click any word for details.');
      M.reading.verses.forEach(function (e) {
        var w = renderVerse(e, function (v) { return 'Verse ' + v.verse; });
        if (w) rd.appendChild(w);
      });
      pane.appendChild(rd);
    }
    if (window.IronInkOrigWords) pane.appendChild(window.IronInkOrigWords.attribution());
  }

  // ── Materials text size: the highlight panel's A−/A/A+ and saved setting ──
  var FONT_DEFAULT = 18, FONT_MIN = 12, FONT_MAX = 28, FONT_STEP = 2;
  var FONT_KEY = 'ironink_panel_font_size';
  var fontSize = FONT_DEFAULT;
  try { var fv = parseInt(localStorage.getItem(FONT_KEY), 10); if (fv) fontSize = Math.min(FONT_MAX, Math.max(FONT_MIN, fv)); } catch (e) {}
  function applyFont(size, save) {
    fontSize = Math.min(FONT_MAX, Math.max(FONT_MIN, size));
    if (pane) pane.style.fontSize = fontSize + 'px';
    if (save) { try { localStorage.setItem(FONT_KEY, fontSize); } catch (e) {} }
  }
  applyFont(fontSize, false);
  function bindFont(id, fn) { var b = document.getElementById(id); if (b) b.addEventListener('click', fn); }
  bindFont('langFontDec',   function () { applyFont(fontSize - FONT_STEP, true); });
  bindFont('langFontReset', function () { applyFont(FONT_DEFAULT, true); });
  bindFont('langFontInc',   function () { applyFont(fontSize + FONT_STEP, true); });

  // ── Mark lesson complete / Undo ──────────────────────────────────────────
  var completeEl  = document.getElementById('langComplete');
  var completedAt = BOOT.completedAt || null;
  var completeBusy = false;
  function fmtDate(iso) {
    var d = new Date(iso);
    return (!iso || isNaN(d)) ? '' : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }
  function renderComplete() {
    if (!completeEl) return;
    completeEl.textContent = '';
    if (!completedAt) {
      var btn = el('button', 'study-complete-btn', 'Mark lesson complete');
      btn.type = 'button';
      btn.addEventListener('click', function () { changeCompletion(true); });
      completeEl.appendChild(btn);
      return;
    }
    completeEl.appendChild(el('span', 'study-complete-done', '✓ Completed · ' + fmtDate(completedAt)));
    var undo = el('button', 'study-complete-undo', 'Undo');
    undo.type = 'button';
    undo.addEventListener('click', function () { changeCompletion(false); });
    completeEl.appendChild(undo);
    if (BOOT.next) {
      var a = el('a', 'lang-next-link', 'Next: Lesson ' + BOOT.next.number + ' →');
      a.href = '/languages/' + encodeURIComponent(BOOT.course) + '/' + encodeURIComponent(BOOT.next.id);
      completeEl.appendChild(a);
    }
  }
  function showAlertSafe(msg) { if (typeof window.showAlert === 'function') window.showAlert(msg); else window.alert(msg); }
  function changeCompletion(completed) {
    if (completeBusy) return;
    completeBusy = true;
    completeEl.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
    fetch('/api/languages/' + encodeURIComponent(BOOT.course) + '/' + encodeURIComponent(BOOT.lessonId) + '/complete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ completed: completed }),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.success) throw new Error(d.error);
        completedAt = d.completedAt || null;
      })
      .catch(function (err) { showAlertSafe((err && err.message) || 'Could not update this lesson. Please try again.'); })
      .then(function () { completeBusy = false; renderComplete(); });
  }

  // ── Conversation (the Teacher page's client, trimmed) ────────────────────
  var messagesEl   = document.getElementById('langMessages');
  var inputEl      = document.getElementById('langInput');
  var sendBtn      = document.getElementById('langSendBtn');
  var stopBtn      = document.getElementById('langStopBtn');
  var quickBtns    = document.querySelectorAll('#langConversation .teacher-quick-btn');
  var resumePanel  = document.getElementById('langResume');
  var resumeText   = document.getElementById('langResumeText');
  var resumeBtn    = document.getElementById('langResumeBtn');
  var startOverBtn = document.getElementById('langStartOverBtn');
  var deleteBtn    = document.getElementById('langDeleteBtn');
  var abortController = null, isGenerating = false, sessionActive = false;
  var ACTION_LABELS = { continue: 'Continue', simpler: 'Say that more simply', quiz: 'Quiz me' };

  function esc(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  // teacher.js renderTeacherText: escape first, then **bold** / *italic* and
  // set-apart verse lines, then the shared sanitizer.
  function renderText(text) {
    var lines = String(text).normalize('NFC').replace(/\s+$/, '').split('\n');
    var html = lines.map(function (line) {
      var bq = line.match(/^>\s?(.*)$/);
      var body = esc(bq ? bq[1] : line).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>');
      return bq ? '<blockquote class="guide-bq">' + body + '</blockquote>' : body;
    }).join('\n')
      .replace(/\n*(<blockquote)/g, '$1').replace(/(<\/blockquote>)\n*/g, '$1')
      .replace(/\n\n/g, '<br><br>').replace(/\n/g, '<br>');
    return window.IronInkSanitize ? window.IronInkSanitize.sanitize(html, 'markdown') : html;
  }
  function scrollChat() { messagesEl.scrollTop = messagesEl.scrollHeight; }
  function addTeacherMessage(text) {
    var div = el('div', 'chat-msg engine-msg');
    div.appendChild(el('div', 'msg-role', 'Teacher'));
    var c = el('div', 'msg-content'); c.innerHTML = renderText(text);
    div.appendChild(c);
    messagesEl.appendChild(div); scrollChat();
    return div;
  }
  function addUserMessage(text) {
    var div = el('div', 'chat-msg user-msg');
    div.appendChild(el('div', 'msg-role', 'You'));
    div.appendChild(el('div', 'msg-content', text));
    messagesEl.appendChild(div); scrollChat();
    return div;
  }
  function addSystemMsg(text) {
    var div = el('div', 'chat-msg system-msg');
    div.appendChild(el('div', 'msg-content', text));
    messagesEl.appendChild(div); scrollChat();
  }
  function showTyping() {
    hideTyping();
    var div = el('div', 'chat-msg engine-msg'); div.id = 'langTyping';
    div.appendChild(el('div', 'msg-role', 'Teacher'));
    var t = el('div', 'typing-indicator');
    for (var i = 0; i < 3; i++) t.appendChild(el('span', 'typing-dot'));
    div.appendChild(t);
    messagesEl.appendChild(div); scrollChat();
  }
  function hideTyping() { var t = document.getElementById('langTyping'); if (t) t.remove(); }
  function setGenerating(val) {
    isGenerating = val;
    var can = sessionActive && !val;
    stopBtn.style.display = val ? 'inline-block' : 'none';
    sendBtn.disabled = !can; inputEl.disabled = !can;
    quickBtns.forEach(function (b) { b.disabled = !can; });
    if (!val) abortController = null;
  }

  async function streamExchange(body) {
    abortController = new AbortController();
    var msgEl = null;
    try {
      var response = await fetch('/api/languages/exchange', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({ course: BOOT.course, lessonId: BOOT.lessonId }, body)),
        signal: abortController.signal,
      });
      if (!response.ok) {
        var info = null;
        try { info = await response.json(); } catch (e) {}
        if (response.status === 402 && info && info.upgradeUrl) window.location.href = info.upgradeUrl;
        throw new Error((info && info.error && info.error !== 'member_feature') ? info.error : GENERIC_ERROR);
      }
      hideTyping();
      msgEl = addTeacherMessage('');
      msgEl.classList.add('streaming');
      var contentEl = msgEl.querySelector('.msg-content');
      var reader = response.body.getReader(), decoder = new TextDecoder();
      var buffer = '', fullText = '';
      while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        var parts = buffer.split('\n\n');
        buffer = parts.pop();
        for (var i = 0; i < parts.length; i++) {
          var lines = parts[i].split('\n');
          for (var j = 0; j < lines.length; j++) {
            if (lines[j].indexOf('data: ') !== 0) continue;
            var data = lines[j].slice(6);
            if (data === '[DONE]') continue;
            var parsed; try { parsed = JSON.parse(data); } catch (e) { continue; }
            if (parsed.error) throw new Error(parsed.error);
            if (parsed.text) { fullText += parsed.text; contentEl.innerHTML = renderText(fullText); scrollChat(); }
          }
        }
      }
      if (!fullText) throw new Error(GENERIC_ERROR);
      msgEl.classList.remove('streaming');
      return fullText;
    } catch (err) {
      hideTyping();
      if (msgEl) msgEl.remove();
      throw err;
    }
  }

  async function runTurn(body, userText) {
    if (isGenerating) return false;
    var userEl = userText ? addUserMessage(userText) : null;
    showTyping();
    setGenerating(true);
    try {
      await streamExchange(body);
      return true;
    } catch (err) {
      if (userEl) { userEl.remove(); if (body.message) inputEl.value = userText; }
      if (err.name !== 'AbortError') addSystemMsg(err.message || GENERIC_ERROR);
      return false;
    } finally {
      setGenerating(false);
    }
  }

  async function startNew() {
    hideResume();
    messagesEl.textContent = '';
    sessionActive = false;
    var ok = await runTurn({ start: true });
    if (ok) {
      sessionActive = true; setGenerating(false);
      if (BOOT.status === null) BOOT.status = 'in_progress';
      inputEl.focus();
    } else if (!messagesEl.querySelector('.engine-msg')) {
      showPanel('Ready when you are.', true);
    }
  }

  // "Pick up where you left off": redraw the saved conversation, no AI call.
  async function resumeSaved() {
    hideResume();
    messagesEl.textContent = '';
    var data;
    try {
      var res = await fetch(SESSION_URL);
      data = await res.json();
    } catch (err) {
      addSystemMsg('Your saved session couldn\'t be loaded. Please refresh and try again.');
      return;
    }
    if (!data || !data.success || !data.session) { BOOT.saved = null; showPanel('Ready when you are.', true); return; }
    (data.session.transcript || []).forEach(function (m) {
      if (m.role === 'assistant') addTeacherMessage(m.content); else addUserMessage(m.content);
    });
    sessionActive = true;
    setGenerating(false);
    var teacherMsgs = messagesEl.querySelectorAll('.engine-msg');
    var last = teacherMsgs.length ? teacherMsgs[teacherMsgs.length - 1] : null;
    if (last) {
      var p = el('p', 'teacher-welcome-back', 'Welcome back. This is where we stopped. Tap Continue when you\'re ready.');
      last.insertAdjacentElement('afterend', p);
      messagesEl.scrollTop += last.getBoundingClientRect().top - messagesEl.getBoundingClientRect().top;
      inputEl.addEventListener('input', function once() { p.remove(); inputEl.removeEventListener('input', once); });
    }
    inputEl.focus({ preventScroll: true });
  }

  function hideResume() { resumePanel.style.display = 'none'; }
  function showPanel(text, begin, beginLabel) {
    resumeText.textContent = text;
    resumeBtn.textContent = begin ? (beginLabel || 'Begin') : 'Pick up where you left off';
    startOverBtn.style.display = begin ? 'none' : '';
    deleteBtn.style.display = begin ? 'none' : '';
    resumeBtn.onclick = begin ? startNew : resumeSaved;
    resumePanel.style.display = 'block';
  }
  function confirmThen(message, label, fn) {
    if (typeof window.showConfirm === 'function') window.showConfirm(message, label, fn);
    else if (window.confirm(message)) fn();
  }
  startOverBtn.addEventListener('click', function () {
    confirmThen('Start over? Your saved conversation for this lesson will be replaced once the teacher replies.', 'Start over', startNew);
  });
  deleteBtn.addEventListener('click', function () {
    confirmThen('Delete your saved conversation for this lesson?', 'Delete', function () {
      fetch(SESSION_URL, { method: 'DELETE' })
        .then(function (r) { return r.json().then(function (d) { if (!d.success && r.status !== 404) throw new Error(); }); })
        .then(function () { BOOT.saved = null; messagesEl.textContent = ''; addSystemMsg('Saved session deleted.'); showPanel('Ready when you are.', true); })
        .catch(function () { showAlertSafe('The saved session couldn\'t be deleted. Please try again.'); });
    });
  });

  function send(text) {
    text = String(text || '').trim();
    if (!text || isGenerating || !sessionActive) return;
    inputEl.value = '';
    runTurn({ message: text }, text);
  }
  sendBtn.addEventListener('click', function () { send(inputEl.value); });
  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(inputEl.value); }
  });
  quickBtns.forEach(function (b) {
    b.addEventListener('click', function () {
      var a = b.getAttribute('data-action');
      if (!Object.prototype.hasOwnProperty.call(ACTION_LABELS, a) || isGenerating || !sessionActive) return;
      runTurn({ action: a }, ACTION_LABELS[a]);
    });
  });
  stopBtn.addEventListener('click', function () { if (abortController) abortController.abort(); });

  // ── Boot ─────────────────────────────────────────────────────────────────
  renderMaterials();
  renderComplete();
  setGenerating(false);
  if (BOOT.saved) {
    var when = fmtDate(BOOT.saved.updatedAt);
    showPanel('You have a saved conversation for this lesson' + (when ? ' (last worked on ' + when + ')' : '') + '.', false);
  } else {
    // No saved session: nothing starts (and no AI call) until the learner asks.
    // The lesson becomes "in progress" only once the teacher's first reply is
    // saved (routes/languages.js), so browsing lessons never marks them.
    showPanel('Your teacher will walk you through this lesson.', true, 'Start the lesson');
  }
})();
