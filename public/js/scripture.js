(function () {
  'use strict';

  var bookSelect    = document.getElementById('bookSelect');
  var chapterSelect = document.getElementById('chapterSelect');
  var heading       = document.getElementById('scriptureHeading');
  var body          = document.getElementById('scriptureBody');

  function setLoading() {
    body.innerHTML = '<p class="scripture-loading">Loading…</p>';
  }

  function renderVerses(bookName, chapter, verses) {
    heading.textContent = bookName + ' ' + chapter;
    body.innerHTML = verses.map(function (v) {
      return '<p class="scripture-verse"><sup class="verse-num">' + v.verse + '</sup>' + v.text + '</p>';
    }).join('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function loadChapter(abbrev, chapter) {
    setLoading();
    fetch('/api/scripture/' + abbrev + '/' + chapter)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.success) {
          renderVerses(data.book, data.chapter, data.verses);
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
    var selected      = bookSelect.options[bookSelect.selectedIndex];
    var chapterCount  = parseInt(selected.dataset.chapters, 10);
    rebuildChapterSelect(chapterCount, 1);
    loadChapter(bookSelect.value, 1);
  });

  chapterSelect.addEventListener('change', function () {
    loadChapter(bookSelect.value, parseInt(chapterSelect.value, 10));
  });
})();
