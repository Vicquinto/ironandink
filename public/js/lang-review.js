(function () {
  'use strict';

  // ─── Vocabulary review ────────────────────────────────────────────────────
  // One card at a time from the words due today (the server's list, oldest due
  // first). Front: the Greek display form. "Show" reveals transliteration,
  // course gloss, NT frequency and one example reference.
  //   I knew it → the server moves the word up a box (next review 1/3/7/16/35 days on)
  //   Not yet   → the server puts it back in box 1, due tomorrow; it is shown once
  //               more at the end of this session (that repeat is practice only:
  //               its answer does not change the schedule again)
  // No totals, streaks or scores.

  var BOOT = window.LANG_REVIEW_BOOT || {};
  var root = document.getElementById('langReview');
  if (!root) return;
  var LANG = BOOT.lang || 'grc';
  var queue = (BOOT.cards || []).map(function (c) { return { card: c, repeat: false }; });
  var busy = false;

  if (window.IronInkOrigWords) window.IronInkOrigWords.loadFonts();
  else {
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Noto+Serif+Hebrew:wght@400;600&family=Noto+Serif:wght@400;600&display=swap';
    document.head.appendChild(link);
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  function showDone() {
    root.textContent = '';
    var box = el('div', 'lang-review-empty');
    box.appendChild(el('p', null, 'Nothing to review today.'));
    var a = el('a', null, 'Back to the course');
    a.href = '/languages/' + encodeURIComponent(BOOT.course);
    box.appendChild(a);
    root.appendChild(box);
  }

  function showCard() {
    root.textContent = '';
    if (!queue.length) { showDone(); return; }
    var item = queue[0];
    var c = item.card;
    var card = el('div', 'lang-review-card');
    var front = el('div', 'lang-review-front ucp-orig-script', String(c.display || '').normalize('NFC'));
    front.lang = LANG;
    front.dir = BOOT.direction === 'rtl' ? 'rtl' : 'ltr';
    if (LANG === 'he') front.classList.add('lang-review-front-he');
    card.appendChild(front);

    var back = el('div', 'lang-review-back');
    back.hidden = true;
    if (c.bound) back.appendChild(el('div', 'lang-review-bound', c.bound));   // Hebrew prefix / suffix
    back.appendChild(el('div', 'lang-review-translit', c.translit));
    back.appendChild(el('div', 'lang-review-gloss', c.gloss));
    if (c.note) back.appendChild(el('div', 'lang-review-note', c.note));
    back.appendChild(el('div', 'lang-review-freq', c.freqText + (LANG === 'he' ? ' in the Old Testament' : ' in the New Testament')));
    if (c.exampleRef) back.appendChild(el('div', 'lang-review-ref', 'For example: ' + c.exampleRef));
    card.appendChild(back);

    var actions = el('div', 'lang-review-actions');
    var show = el('button', 'btn-primary lang-review-btn', 'Show');
    show.type = 'button';
    var notYet = el('button', 'btn-warm lang-review-btn', 'Not yet');
    var knew = el('button', 'btn-primary lang-review-btn', 'I knew it');
    notYet.type = 'button'; knew.type = 'button';
    notYet.hidden = true; knew.hidden = true;
    show.addEventListener('click', function () {
      back.hidden = false; show.hidden = true; notYet.hidden = false; knew.hidden = false;
      knew.focus();
    });
    notYet.addEventListener('click', function () { answer(item, 'notyet', [notYet, knew]); });
    knew.addEventListener('click', function () { answer(item, 'knew', [notYet, knew]); });
    actions.appendChild(show); actions.appendChild(notYet); actions.appendChild(knew);
    card.appendChild(actions);
    root.appendChild(card);
    show.focus();
  }

  function answer(item, result, buttons) {
    if (busy) return;
    if (item.repeat) {                    // the end-of-session repeat: practice only
      queue.shift();
      showCard();
      return;
    }
    busy = true;
    buttons.forEach(function (b) { b.disabled = true; });
    fetch('/api/languages/' + encodeURIComponent(BOOT.course) + '/review', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: item.card.key, result: result }),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.success) throw new Error(d.error);
        queue.shift();
        if (result === 'notyet') queue.push({ card: item.card, repeat: true });
        busy = false;
        showCard();
      })
      .catch(function (err) {
        busy = false;
        buttons.forEach(function (b) { b.disabled = false; });
        var msg = (err && err.message) || 'That couldn\'t be saved. Please try again.';
        if (typeof window.showAlert === 'function') window.showAlert(msg); else window.alert(msg);
      });
  }

  showCard();
})();
