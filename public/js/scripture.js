(function () {
  'use strict';

  var ESV_COPYRIGHT = 'ESV® Bible, Copyright © 2001 by Crossway';

  // ── Chapter reader ──────────────────────────────────────────────────────────

  var bookSelect    = document.getElementById('bookSelect');
  var chapterSelect = document.getElementById('chapterSelect');
  var heading       = document.getElementById('scriptureHeading');
  var body          = document.getElementById('scriptureBody');

  var pendingScrollVerse = null;

  function setLoading() {
    body.innerHTML = '<p class="scripture-loading">Loading…</p>';
  }

  function scrollToVerse(verse) {
    var sups = body.querySelectorAll('.verse-num');
    for (var i = 0; i < sups.length; i++) {
      if (parseInt(sups[i].textContent, 10) === verse) {
        var p = sups[i].closest('p');
        if (!p) break;
        p.scrollIntoView({ behavior: 'smooth', block: 'center' });
        p.classList.add('verse-highlight');
        setTimeout(function () { p.classList.remove('verse-highlight'); }, 1600);
        return;
      }
    }
  }

  function renderEsv(bookName, chapter, text) {
    heading.textContent = bookName + ' ' + chapter;
    var paragraphs = text.trim().split(/\n\s*\n/);
    var html = paragraphs.map(function (para) {
      return '<p class="scripture-verse">' +
        para.trim()
          .replace(/\[(\d+)\]/g, '<sup class="verse-num">$1</sup>')
          .replace(/\n/g, ' ') +
        '</p>';
    }).join('');
    html += '<p class="scripture-copyright">' + ESV_COPYRIGHT + '</p>';
    body.innerHTML = html;
    var v = pendingScrollVerse;
    pendingScrollVerse = null;
    if (v !== null) {
      setTimeout(function () { scrollToVerse(v); }, 80);
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function renderKjv(bookName, chapter, verses) {
    heading.textContent = bookName + ' ' + chapter;
    body.innerHTML = verses.map(function (v) {
      return '<p class="scripture-verse"><sup class="verse-num">' + v.verse + '</sup>' + v.text + '</p>';
    }).join('');
    var v = pendingScrollVerse;
    pendingScrollVerse = null;
    if (v !== null) {
      setTimeout(function () { scrollToVerse(v); }, 80);
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function loadChapter(abbrev, chapter) {
    setLoading();
    fetch('/api/scripture/' + abbrev + '/' + chapter)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.success) {
          if (data.source === 'esv') {
            renderEsv(data.book, data.chapter, data.text);
          } else {
            renderKjv(data.book, data.chapter, data.verses);
          }
        } else {
          body.innerHTML = '<p class="scripture-loading">Failed to load chapter.</p>';
        }
      })
      .catch(function () {
        body.innerHTML = '<p class="scripture-loading">An error occurred.</p>';
      });
  }

  function rebuildChapterSelect(count, selectedChapter) {
    chapterSelect.innerHTML = '';
    for (var i = 1; i <= count; i++) {
      var opt = document.createElement('option');
      opt.value       = i;
      opt.textContent = i;
      if (i === selectedChapter) opt.selected = true;
      chapterSelect.appendChild(opt);
    }
  }

  bookSelect.addEventListener('change', function () {
    var selected     = bookSelect.options[bookSelect.selectedIndex];
    var chapterCount = parseInt(selected.dataset.chapters, 10);
    rebuildChapterSelect(chapterCount, 1);
    localStorage.setItem('ironink_scripture_book', bookSelect.value);
    localStorage.setItem('ironink_scripture_chapter', 1);
    loadChapter(bookSelect.value, 1);
    renderSpotNote();
  });

  chapterSelect.addEventListener('change', function () {
    var chapter = parseInt(chapterSelect.value, 10);
    localStorage.setItem('ironink_scripture_book', bookSelect.value);
    localStorage.setItem('ironink_scripture_chapter', chapter);
    loadChapter(bookSelect.value, chapter);
  });

  // ── Restore last position ───────────────────────────────────────────────────
  (function () {
    var savedBook    = localStorage.getItem('ironink_scripture_book');
    var savedChapter = parseInt(localStorage.getItem('ironink_scripture_chapter'), 10) || 1;
    if (!savedBook) return;
    for (var i = 0; i < bookSelect.options.length; i++) {
      if (bookSelect.options[i].value === savedBook) {
        bookSelect.selectedIndex = i;
        var chapterCount = parseInt(bookSelect.options[i].dataset.chapters, 10);
        rebuildChapterSelect(chapterCount, savedChapter);
        loadChapter(savedBook, savedChapter);
        break;
      }
    }
  })();

  // ── Reading Tracker ─────────────────────────────────────────────────────────

  var trackerData     = {};
  var pendingMarkBook = null;

  var trackerGrid    = document.getElementById('trackerGrid');
  var goalOverlay    = document.getElementById('trackerGoalOverlay');
  var goalMsg        = document.getElementById('trackerGoalMsg');
  var goalInput      = document.getElementById('trackerGoalInput');
  var goalCancelBtn  = document.getElementById('trackerGoalCancel');
  var goalConfirmBtn = document.getElementById('trackerGoalConfirm');

  function fetchTracker() {
    fetch('/api/reading/tracker')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.success) {
          trackerData = data.tracker || {};
          renderTrackerGrid();
          renderSpotNote();
        }
      })
      .catch(function () {
        trackerGrid.innerHTML = '<p class="scripture-loading">Failed to load tracker.</p>';
      });
  }

  function renderTrackerGrid() {
    var books = window._bibleBooks || [];
    if (!books.length) return;

    var html = books.map(function (name) {
      var book  = trackerData[name] || { count: 0, goal: 0, history: [] };
      var count = book.count || 0;
      var goal  = book.goal  || 0;
      var pct   = goal > 0 ? Math.min(100, Math.round((count / goal) * 100)) : 0;
      var done  = goal > 0 && count >= goal;

      var countLabel = goal > 0 ? count + '/' + goal : (count > 0 ? count : '');
      var check      = done ? '<span class="tracker-complete-check">✓</span>' : '';
      var bar        = goal > 0
        ? '<div class="tracker-progress"><div class="tracker-progress-fill" style="width:' + pct + '%"></div></div>'
        : '<div class="tracker-progress"><div class="tracker-progress-fill" style="width:0%"></div></div>';
      var editBtn    = (goal > 0 && count > 0)
        ? '<button class="tracker-edit-btn" data-book="' + name + '">edit count</button>'
        : '';

      return '<div class="tracker-book-card">' +
        '<span class="tracker-book-name">' + name + '</span>' +
        '<span class="tracker-book-count">' + countLabel + '</span>' +
        bar +
        check +
        '<button class="tracker-mark-btn" data-book="' + name + '">' + (goal > 0 ? 'Mark Complete' : 'Set Goal') + '</button>' +
        editBtn +
        '</div>';
    }).join('');

    trackerGrid.innerHTML = html;
  }

  // Single delegated listener for all tracker interactions
  trackerGrid.addEventListener('click', function (e) {
    var target = e.target;

    if (target.classList.contains('tracker-mark-btn')) {
      handleMarkComplete(target.getAttribute('data-book'));
      return;
    }

    if (target.classList.contains('tracker-edit-btn')) {
      handleEditCount(target);
      return;
    }

    if (target.classList.contains('tracker-edit-save')) {
      saveCount(target);
      return;
    }
  });

  trackerGrid.addEventListener('keydown', function (e) {
    if (e.target.classList.contains('tracker-edit-input') && e.key === 'Enter') {
      var saveBtn = e.target.closest('.tracker-edit-inline').querySelector('.tracker-edit-save');
      if (saveBtn) saveBtn.click();
    }
  });

  function handleMarkComplete(bookName) {
    var book = trackerData[bookName] || { count: 0, goal: 0 };
    if (!book.goal || book.goal === 0) {
      showGoalModal(bookName);
    } else {
      markComplete(bookName);
    }
  }

  function handleEditCount(btn) {
    var bookName = btn.getAttribute('data-book');
    var card     = btn.closest('.tracker-book-card');
    var existing = card.querySelector('.tracker-edit-inline');
    if (existing) { existing.remove(); return; }

    var count  = (trackerData[bookName] && trackerData[bookName].count) || 0;
    var inline = document.createElement('div');
    inline.className = 'tracker-edit-inline';
    inline.innerHTML =
      '<span class="tracker-edit-label">Adjust count for ' + bookName + ':</span>' +
      '<div class="tracker-edit-row">' +
        '<input type="number" class="tracker-edit-input" value="' + count + '" min="0" max="9999">' +
        '<button class="tracker-edit-save" data-book="' + bookName + '">Save</button>' +
      '</div>';
    card.appendChild(inline);
    inline.querySelector('.tracker-edit-input').focus();
    inline.querySelector('.tracker-edit-input').select();
  }

  function saveCount(btn) {
    var bookName = btn.getAttribute('data-book');
    var input    = btn.closest('.tracker-edit-inline').querySelector('.tracker-edit-input');
    var count    = parseInt(input.value, 10);
    if (isNaN(count) || count < 0) { input.focus(); return; }

    fetch('/api/reading/set-count', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ bookName: bookName, count: count }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.success) {
          trackerData[bookName] = data.book;
          renderTrackerGrid();
        }
      });
  }

  function showGoalModal(bookName) {
    pendingMarkBook      = bookName;
    goalMsg.textContent  = 'How many times do you want to read ' + bookName + '? (Enter your goal)';
    goalInput.value      = '';
    goalOverlay.style.display = 'flex';
    setTimeout(function () { goalInput.focus(); }, 50);
  }

  function hideGoalModal() {
    goalOverlay.style.display = 'none';
    pendingMarkBook = null;
  }

  goalCancelBtn.addEventListener('click', hideGoalModal);

  goalOverlay.addEventListener('click', function (e) {
    if (e.target === goalOverlay) hideGoalModal();
  });

  goalInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') goalConfirmBtn.click();
    if (e.key === 'Escape') hideGoalModal();
  });

  goalConfirmBtn.addEventListener('click', function () {
    var goal     = parseInt(goalInput.value, 10);
    if (!goal || goal < 1) { goalInput.focus(); return; }
    var bookName = pendingMarkBook;
    hideGoalModal();
    fetch('/api/reading/set-goal', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ bookName: bookName, goal: goal }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.success) {
          if (!trackerData[bookName]) trackerData[bookName] = { count: 0, goal: 0, history: [] };
          trackerData[bookName].goal = goal;
          markComplete(bookName);
        }
      });
  });

  function markComplete(bookName) {
    fetch('/api/reading/mark-complete', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ bookName: bookName }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.success) {
          trackerData[bookName] = data.book;
          renderTrackerGrid();
        }
      });
  }

  // ── Mark My Spot — verse-level ──────────────────────────────────────────────

  body.addEventListener('click', function (e) {
    if (e.target.classList.contains('verse-num')) {
      var verse = parseInt(e.target.textContent, 10);
      if (!isNaN(verse)) markVerseSpot(verse);
    }
  });

  function markVerseSpot(verse) {
    var bookName = bookSelect.options[bookSelect.selectedIndex].text;
    var chapter  = parseInt(chapterSelect.value, 10);
    fetch('/api/reading/mark-spot', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ bookName: bookName, chapter: chapter, verse: verse }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.success) {
          if (!trackerData[bookName]) trackerData[bookName] = { count: 0, goal: 0, history: [] };
          trackerData[bookName].spot = data.spot;
          showSpotToast('Spot marked: ' + bookName + ' ' + chapter + ':' + verse);
          renderSpotNote();
        }
      })
      .catch(function () {});
  }

  function showSpotToast(msg) {
    var toast = document.getElementById('spotToast');
    if (!toast) return;
    toast.textContent = msg || 'Spot marked';
    toast.classList.add('visible');
    setTimeout(function () { toast.classList.remove('visible'); }, 2500);
  }

  function renderSpotNote() {
    var wrap = document.getElementById('spotNoteWrap');
    var list = document.getElementById('spotNoteList');
    if (!wrap || !list) return;

    var spots = [];
    Object.keys(trackerData).forEach(function (bookName) {
      var spot = trackerData[bookName] && trackerData[bookName].spot;
      if (spot && spot.chapter) {
        spots.push({
          bookName: bookName,
          chapter:  spot.chapter,
          verse:    spot.verse || null,
          savedAt:  spot.savedAt || '',
        });
      }
    });

    if (spots.length === 0) {
      wrap.style.display = 'none';
      return;
    }

    spots.sort(function (a, b) { return b.savedAt.localeCompare(a.savedAt); });

    list.innerHTML = '';
    spots.forEach(function (s) {
      var ref    = s.bookName + ' ' + s.chapter + (s.verse ? ':' + s.verse : '');
      var row    = document.createElement('div');
      row.className = 'spot-note-row';

      var refSpan = document.createElement('span');
      refSpan.className   = 'spot-note-ref';
      refSpan.textContent = ref;

      var goBtn = document.createElement('button');
      goBtn.className   = 'spot-note-go';
      goBtn.type        = 'button';
      goBtn.textContent = 'Go there';
      goBtn.onclick     = (function (snap) { return function () { goToSpot(snap); }; })(s);

      var delBtn = document.createElement('button');
      delBtn.className          = 'sps-remove-btn';
      delBtn.type               = 'button';
      delBtn.setAttribute('aria-label', 'Remove mark');
      delBtn.setAttribute('title', 'Remove');
      delBtn.textContent        = '×';
      delBtn.onclick            = (function (name) { return function () { deleteSpot(name); }; })(s.bookName);

      row.appendChild(refSpan);
      row.appendChild(goBtn);
      row.appendChild(delBtn);
      list.appendChild(row);
    });

    wrap.style.display = '';
  }

  function deleteSpot(bookName) {
    fetch('/api/reading/mark-spot/' + encodeURIComponent(bookName), { method: 'DELETE' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.success) {
          if (trackerData[bookName]) delete trackerData[bookName].spot;
          renderSpotNote();
        }
      })
      .catch(function () {});
  }

  function goToSpot(spot) {
    var curBookName = bookSelect.options[bookSelect.selectedIndex].text;

    if (spot.bookName !== curBookName) {
      for (var b = 0; b < bookSelect.options.length; b++) {
        if (bookSelect.options[b].text === spot.bookName) {
          bookSelect.selectedIndex = b;
          var chCount = parseInt(bookSelect.options[b].dataset.chapters, 10);
          rebuildChapterSelect(chCount, spot.chapter);
          localStorage.setItem('ironink_scripture_book', bookSelect.value);
          localStorage.setItem('ironink_scripture_chapter', spot.chapter);
          if (spot.verse) pendingScrollVerse = spot.verse;
          loadChapter(bookSelect.value, spot.chapter);
          return;
        }
      }
    }

    var curChapter = parseInt(chapterSelect.value, 10);
    if (spot.chapter === curChapter) {
      if (spot.verse) scrollToVerse(spot.verse);
    } else {
      if (spot.verse) pendingScrollVerse = spot.verse;
      for (var i = 0; i < chapterSelect.options.length; i++) {
        if (parseInt(chapterSelect.options[i].value, 10) === spot.chapter) {
          chapterSelect.selectedIndex = i;
          break;
        }
      }
      localStorage.setItem('ironink_scripture_chapter', spot.chapter);
      loadChapter(bookSelect.value, spot.chapter);
    }
  }

  // ── Scripture font size controls ───────────────────────────────────────────
  (function () {
    var FONT_DEFAULT = 18, FONT_MIN = 12, FONT_MAX = 32, FONT_STEP = 2;
    var LS_KEY = 'ironink_scripture_font_size';

    var styleTag = document.createElement('style');
    document.head.appendChild(styleTag);

    var fontSize = parseInt(localStorage.getItem(LS_KEY), 10) || FONT_DEFAULT;

    function applySize() {
      styleTag.textContent =
        '#scriptureBody .scripture-verse { font-size: ' + fontSize + 'px; }' +
        '#scriptureBody .scripture-copyright { font-size: ' + Math.max(11, fontSize - 4) + 'px; }';
    }

    function setSize(s) {
      fontSize = Math.min(FONT_MAX, Math.max(FONT_MIN, s));
      applySize();
      localStorage.setItem(LS_KEY, fontSize);
    }

    applySize();

    var decBtn   = document.getElementById('scriptFontDec');
    var resetBtn = document.getElementById('scriptFontReset');
    var incBtn   = document.getElementById('scriptFontInc');
    if (decBtn)   decBtn.addEventListener('click', function () { setSize(fontSize - FONT_STEP); });
    if (resetBtn) resetBtn.addEventListener('click', function () { setSize(FONT_DEFAULT); });
    if (incBtn)   incBtn.addEventListener('click', function () { setSize(fontSize + FONT_STEP); });
  })();

  fetchTracker();
})();
