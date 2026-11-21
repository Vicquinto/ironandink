(function () {
  'use strict';

  // ─── Original-language word cards ─────────────────────────────────────────
  // The Hebrew / Greek behind a verse, word by word: one card per word (form,
  // transliteration, gloss) and, on click, a detail box with the word's data
  // and an "Explain this word" button. Shared by the highlight panel's Original
  // tab (library.js) and the Languages lesson pages (lang-lesson.js), so both
  // show the same component.
  //
  // `data` is the shape GET /api/original returns (lib/original.js lookup):
  // { book, chapter, language, direction, verses: [{ ref, verse, words: [...] }] }.
  // Every string is set with textContent: original-language text is data.

  var ATTRIB_URL = 'https://www.STEPBible.org';
  var CC_URL     = 'https://creativecommons.org/licenses/by/4.0/';
  var fontsLoaded = false;

  // Noto Serif Hebrew (pointed Hebrew) and Noto Serif (polytonic Greek).
  function loadFonts() {
    if (fontsLoaded) return;
    fontsLoaded = true;
    var link = document.createElement('link');
    link.rel  = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Noto+Serif+Hebrew:wght@400;600&family=Noto+Serif:wght@400;600&display=swap';
    document.head.appendChild(link);
  }

  function attribution() {
    var p = document.createElement('p');
    p.className = 'ucp-orig-attrib';
    p.appendChild(document.createTextNode('Original-language data: '));
    var a = document.createElement('a');
    a.href = ATTRIB_URL; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.textContent = 'STEP Bible (STEPBible.org)';
    p.appendChild(a);
    p.appendChild(document.createTextNode(', based on work at Tyndale House, Cambridge. '));
    var cc = document.createElement('a');
    cc.href = CC_URL; cc.target = '_blank'; cc.rel = 'noopener noreferrer';
    cc.textContent = 'CC BY 4.0';
    p.appendChild(cc);
    p.appendChild(document.createTextNode('.'));
    return p;
  }

  function message(container, text, isError) {
    var p = document.createElement('p');
    p.className = 'ucp-orig-msg' + (isError ? ' ucp-orig-error' : '');
    p.textContent = text;
    container.appendChild(p);
  }

  function detailRow(dl, label, value, lang, dir) {
    if (!value) return;
    var dt = document.createElement('dt');
    dt.textContent = label;
    var dd = document.createElement('dd');
    dd.textContent = value;
    if (lang) { dd.lang = lang; dd.dir = dir; dd.className = 'ucp-orig-script'; }
    dl.appendChild(dt);
    dl.appendChild(dd);
  }

  function showDetail(detail, data, v, idx, w, lang, dir, opts) {
    detail.textContent = '';
    var big = document.createElement('div');
    big.className = 'ucp-orig-detail-word ucp-orig-script';
    big.lang = lang; big.dir = dir;
    big.textContent = w.w;
    detail.appendChild(big);
    var dl = document.createElement('dl');
    dl.className = 'ucp-orig-dl';
    detailRow(dl, 'Transliteration', w.t);
    // Split words: each part in order with its grammar and gloss.
    if (Array.isArray(w.parts) && w.parts.length) {
      var ROLE = { prefix: 'Prefix', word: 'Word', suffix: 'Suffix' };
      w.parts.forEach(function (pt) {
        var dt = document.createElement('dt');
        dt.textContent = ROLE[pt.role] || 'Part';
        var dd = document.createElement('dd');
        var f = document.createElement('span');
        f.className = 'ucp-orig-script';
        f.lang = lang; f.dir = dir;
        f.textContent = pt.form;
        dd.appendChild(f);
        dd.appendChild(document.createTextNode(' — ' + [pt.gloss, pt.grammar].filter(Boolean).join(' — ') +
          (pt.learned === false ? ' (not learned yet)' : '')));
        dl.appendChild(dt);
        dl.appendChild(dd);
      });
    }
    detailRow(dl, 'Dictionary form', w.l, lang, dir);
    if (w.lt) detailRow(dl, 'Pronounced', w.lt);
    detailRow(dl, 'Strong’s', w.s);
    detailRow(dl, 'Gloss here', w.g);
    detailRow(dl, 'Grammar', w.gram);
    detailRow(dl, 'Lexicon', [w.lg, w.def].filter(Boolean).join(' — '));
    if (opts.detailExtra) opts.detailExtra(dl, w, detailRow);
    detail.appendChild(dl);
    if (opts.onExplain) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ucp-orig-explain';
      btn.textContent = 'Explain this word';
      btn.addEventListener('click', function () {
        opts.onExplain({ book: data.book, chapter: data.chapter, verse: v.verse, index: idx }, v.ref, w);
      });
      detail.appendChild(btn);
    }
    detail.style.display = '';
  }

  // Renders data's verses and returns the wrapper element.
  // opts:
  //   extraNote  — a note shown above the verses
  //   heading(v) — the verse heading (default "<ref> — Greek/Hebrew")
  //   tint(w)    — true → the card is tinted as a "possible match"
  //   decorate(card, w, v, idx) — extra classes / changes per card
  //   onExplain(pos, ref, w)    — shows "Explain this word" in the detail box
  //   detailExtra(dl, w, row)   — extra rows in the detail box
  function render(data, opts) {
    opts = opts || {};
    var greek = data.language === 'greek';
    var lang  = greek ? 'grc' : 'he';
    var dir   = data.direction === 'rtl' ? 'rtl' : 'ltr';
    var langName = greek ? 'Greek' : 'Hebrew';

    var wrap = document.createElement('div');
    wrap.className = 'ucp-orig';
    if (opts.extraNote) message(wrap, opts.extraNote, false);

    (data.verses || []).forEach(function (v) {
      var sec = document.createElement('section');
      sec.className = 'ucp-orig-verse';
      var h = document.createElement('h4');
      h.className = 'ucp-orig-ref';
      h.textContent = opts.heading ? opts.heading(v) : v.ref + ' — ' + langName;
      sec.appendChild(h);
      if (!v.words || !v.words.length) {
        message(sec, v.note || 'No original-language data for this verse.', false);
        wrap.appendChild(sec);
        return;
      }
      var row = document.createElement('div');
      row.className = 'ucp-orig-words';
      row.dir = dir;
      var detail = document.createElement('div');
      detail.className = 'ucp-orig-detail';
      detail.style.display = 'none';

      v.words.forEach(function (w, idx) {
        var card = document.createElement('button');
        card.type = 'button';
        card.className = 'ucp-orig-word';
        var ow = document.createElement('span');
        ow.className = 'ucp-orig-w ucp-orig-script';
        ow.lang = lang; ow.dir = dir;
        ow.textContent = w.w;
        var tr = document.createElement('span');
        tr.className = 'ucp-orig-t';
        tr.dir = 'ltr';
        tr.textContent = w.t || '';
        var gl = document.createElement('span');
        gl.className = 'ucp-orig-g';
        gl.dir = 'ltr';
        gl.textContent = w.g || '';
        if (Array.isArray(w.parts) && w.parts.length) {
          // A word split into its parts (Hebrew lesson pages): prefix · word ·
          // suffix, in reading order (right to left for Hebrew), each part with
          // its gloss under it, then the whole word's transliteration.
          card.classList.add('orig-split');
          var row2 = document.createElement('span');
          row2.className = 'orig-parts';
          row2.dir = dir;
          w.parts.forEach(function (pt, k) {
            if (k) {
              var sep = document.createElement('span');
              sep.className = 'orig-part-sep';
              sep.setAttribute('aria-hidden', 'true');
              sep.textContent = '·';
              row2.appendChild(sep);
            }
            var ps = document.createElement('span');
            ps.className = 'orig-part' + (pt.learned === true ? ' is-known' : pt.learned === false ? ' is-new' : '');
            var pf = document.createElement('span');
            pf.className = 'orig-part-w ucp-orig-script';
            pf.lang = lang; pf.dir = dir;
            pf.textContent = pt.form;
            var pg = document.createElement('span');
            pg.className = 'orig-part-g';
            pg.dir = 'ltr';
            pg.textContent = pt.gloss || '';
            ps.appendChild(pf); ps.appendChild(pg);
            row2.appendChild(ps);
          });
          card.appendChild(row2); card.appendChild(tr);
        } else {
          card.appendChild(ow); card.appendChild(tr); card.appendChild(gl);
        }
        if (opts.tint && opts.tint(w)) { card.classList.add('ucp-orig-match'); card.title = 'possible match'; }
        card.setAttribute('aria-label', (w.t || '') + ' — ' +
          (Array.isArray(w.parts) && w.parts.length ? w.parts.map(function (pt) { return pt.gloss; }).join(' · ') : (w.g || '')) +
          (card.title ? ' (possible match)' : ''));
        if (opts.decorate) opts.decorate(card, w, v, idx);
        card.addEventListener('click', function () {
          var open = card.classList.contains('ucp-orig-active');
          row.querySelectorAll('.ucp-orig-active').forEach(function (c) { c.classList.remove('ucp-orig-active'); });
          if (open) { detail.style.display = 'none'; return; }
          card.classList.add('ucp-orig-active');
          showDetail(detail, data, v, idx, w, lang, dir, opts);
        });
        row.appendChild(card);
      });
      sec.appendChild(row);
      sec.appendChild(detail);
      wrap.appendChild(sec);
    });
    return wrap;
  }

  window.IronInkOrigWords = { loadFonts: loadFonts, attribution: attribution, message: message, render: render };
})();
