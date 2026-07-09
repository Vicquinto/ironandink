(function () {
  'use strict';

  let currentGuide    = null;
  let selectedRating  = 0;
  let abortController = null;
  let studyGenerated  = false;
  var selectedLength  = 'Short';
  var selectedType    = 'doctrinal';

  // ── DOM refs ──────────────────────────────────────────────────────────────
  const topicInput       = document.getElementById('topicInput');
  const generateBtn      = document.getElementById('generateBtn');
  const studyLoading     = document.getElementById('studyLoading');
  const loadingTopicName = document.getElementById('loadingTopicName');
  const stopBtn          = document.getElementById('stopGenerationBtn');
  const guideArea       = document.getElementById('guideArea');
  const guideTitle      = document.getElementById('guideTitle');
  const guideBadge      = document.getElementById('guideBadge');
  const guideBody       = document.getElementById('guideBody');
  const saveLibraryBtn  = document.getElementById('saveLibraryBtn');
  const dismissGuideBtn = document.getElementById('dismissGuideBtn');
  const savePanel       = document.getElementById('savePanel');
  const saveTopicInput  = document.getElementById('saveTopicInput');
  const saveTagsInput   = document.getElementById('saveTagsInput');
  const saveShareInput  = document.getElementById('saveShareInput');
  const confirmSaveBtn  = document.getElementById('confirmSaveBtn');
  const cancelSaveBtn   = document.getElementById('cancelSaveBtn');
  const topicBrowser    = document.getElementById('topicBrowser');
  const stars           = document.querySelectorAll('.star');
  const fontDecBtn        = document.getElementById('fontDecBtn');
  const fontResetBtn      = document.getElementById('fontResetBtn');
  const fontIncBtn        = document.getElementById('fontIncBtn');
  const studyLevelSelect  = document.getElementById('studyLevelSelect');
  const studyTypePicker   = document.getElementById('studyTypePicker');
  const studyLevelField   = document.getElementById('studyLevelField');

  // ── Level selector — seed from server-saved preference, persist on change ─
  if (studyLevelSelect) {
    // Seed the select lazily: read window.USER_STUDY_LEVEL at the point of use,
    // not at init. study.js can execute before the inline <script> that assigns
    // window.USER_STUDY_LEVEL, so reading it at init would always fall back to
    // 'journeyman'. Deferring to DOMContentLoaded (or running now if the document
    // is already parsed) guarantees the global exists first — ordering-independent.
    var seedStudyLevel = function () {
      studyLevelSelect.value = window.USER_STUDY_LEVEL || 'journeyman';
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', seedStudyLevel);
    } else {
      seedStudyLevel();
    }
    studyLevelSelect.addEventListener('change', function () {
      fetch('/api/settings/study-level', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ studyLevel: studyLevelSelect.value }),
      });
    });
  }

  // ── Study-type picker — Doctrinal (default) / Deep Dive / Historical / Scripture ─
  // The Study Level (writing register) control is meaningful for every type except
  // Deep Dive (which is always deep), so the level field is hidden only while Deep
  // Dive is selected and shown for all other types, including Scripture & Verse.
  function updateLevelVisibility() {
    if (!studyLevelField) return;
    studyLevelField.style.display = (selectedType === 'deepdive') ? 'none' : '';
  }
  if (studyTypePicker) {
    studyTypePicker.querySelectorAll('.study-type-option').forEach(function (opt) {
      opt.addEventListener('click', function () {
        studyTypePicker.querySelectorAll('.study-type-option').forEach(function (o) {
          o.classList.remove('study-type-option--active');
          o.setAttribute('aria-checked', 'false');
        });
        opt.classList.add('study-type-option--active');
        opt.setAttribute('aria-checked', 'true');
        selectedType = opt.dataset.type || 'doctrinal';
        updateLevelVisibility();
      });
    });
    updateLevelVisibility(); // reflect the default selection on load
  }

  // ── Font size control ─────────────────────────────────────────────────────
  var FONT_DEFAULT = 16;
  var FONT_MIN     = 12;
  var FONT_MAX     = 28;
  var FONT_STEP    = 2;
  var studyFontSize = parseInt(localStorage.getItem('ironink_study_font_size'), 10) || FONT_DEFAULT;

  function applyFontSize(size) {
    studyFontSize = Math.min(FONT_MAX, Math.max(FONT_MIN, size));
    guideBody.style.fontSize = studyFontSize + 'px';
    localStorage.setItem('ironink_study_font_size', studyFontSize);
  }

  applyFontSize(studyFontSize);

  if (fontDecBtn) {
    fontDecBtn.addEventListener('click',   function () { applyFontSize(studyFontSize - FONT_STEP); });
    fontResetBtn.addEventListener('click', function () { applyFontSize(FONT_DEFAULT); });
    fontIncBtn.addEventListener('click',   function () { applyFontSize(studyFontSize + FONT_STEP); });
  }

  // ── Prefill from dialogue gap analysis ───────────────────────────────────
  var urlPrefill = new URLSearchParams(window.location.search).get('studyNext');
  if (urlPrefill && topicInput) { topicInput.value = urlPrefill; topicInput.focus(); }

  // ── Length picker ─────────────────────────────────────────────────────────
  var lengthPicker = document.getElementById('studyLengthPicker');
  if (lengthPicker) {
    lengthPicker.querySelectorAll('.study-length-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        lengthPicker.querySelectorAll('.study-length-btn').forEach(function (b) {
          b.classList.remove('study-length-btn--active');
        });
        btn.classList.add('study-length-btn--active');
        selectedLength = btn.dataset.length;
      });
    });
  }

  // ── Accordion ─────────────────────────────────────────────────────────────
  document.querySelectorAll('.topic-cat-header').forEach(function (btn) {
    btn.addEventListener('click', function () {
      btn.closest('.topic-category').classList.toggle('open');
    });
  });

  // ── Topic item click — populate input only, do not generate ──────────────
  document.querySelectorAll('.topic-item').forEach(function (btn) {
    btn.addEventListener('click', function () {
      topicInput.value = btn.dataset.topic;
      generateBtn.focus();
    });
  });

  // ── Generate button ────────────────────────────────────────────────────────
  generateBtn.addEventListener('click', function () {
    var topic = topicInput.value.trim();
    if (!topic) { topicInput.focus(); return; }
    generateGuide(topic);
  });

  topicInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      var topic = topicInput.value.trim();
      if (topic) generateGuide(topic);
    }
  });

  // ── Star rating ────────────────────────────────────────────────────────────
  stars.forEach(function (star) {
    star.addEventListener('mouseover', function () { highlightStars(parseInt(star.dataset.val)); });
    star.addEventListener('mouseout',  function () { highlightStars(selectedRating); });
    star.addEventListener('click',     function () {
      selectedRating = parseInt(star.dataset.val);
      highlightStars(selectedRating);
    });
  });

  function highlightStars(count) {
    stars.forEach(function (s) {
      s.classList.toggle('active', parseInt(s.dataset.val) <= count);
    });
  }

  // ── Stop button ────────────────────────────────────────────────────────────
  if (stopBtn) {
    stopBtn.addEventListener('click', function () {
      if (abortController) {
        abortController.abort();
      }
    });
  }

  // ── Patience loading screen — rotating Scripture verses ────────────────────
  // Reuses the Verse-of-the-Day pool injected as window.STUDY_VERSES. NOTE: the
  // verse pool is read LAZILY (inside the functions below), never cached at init —
  // study.js can load before the inline <script> that assigns window.STUDY_VERSES,
  // so caching it at init would freeze an empty array. Reading fresh makes the
  // script-tag ordering irrelevant.
  var verseTextEl  = document.getElementById('studyVerseText');
  var verseRefEl   = document.getElementById('studyVerseRef');
  var verseRotator = document.getElementById('studyVerseRotator');
  var verseTimer   = null;
  var lastVerseIdx = -1;

  function getVersePool() {
    return (window.STUDY_VERSES && window.STUDY_VERSES.length) ? window.STUDY_VERSES : [];
  }

  function paintVerse() {
    var versePool = getVersePool(); // read fresh every call
    if (!versePool.length || !verseTextEl) return;
    var idx = Math.floor(Math.random() * versePool.length);
    // Avoid repeating the same verse twice in a row.
    if (versePool.length > 1 && idx === lastVerseIdx) idx = (idx + 1) % versePool.length;
    lastVerseIdx = idx;
    var v = versePool[idx];
    // Fade out, swap, fade back in for a gentle transition.
    if (verseRotator) verseRotator.classList.remove('is-visible');
    setTimeout(function () {
      verseTextEl.textContent = '“' + v.text + '”';
      if (verseRefEl) verseRefEl.textContent = v.ref + ' — Legacy Standard Bible';
      if (verseRotator) verseRotator.classList.add('is-visible');
    }, 200);
  }

  function startVerseRotation() {
    var versePool = getVersePool(); // read fresh every call
    if (!versePool.length) return;
    stopVerseRotation();
    lastVerseIdx = -1;
    paintVerse();
    // Rotate to a new verse every 9s (within the requested 8–10s window).
    verseTimer = setInterval(paintVerse, 9000);
  }

  function stopVerseRotation() {
    if (verseTimer) { clearInterval(verseTimer); verseTimer = null; }
  }

  // ── Guide generation ───────────────────────────────────────────────────────
  async function generateGuide(topic) {
    studyGenerated = false;
    showState('loading');
    loadingTopicName.textContent = topic;

    abortController = new AbortController();

    try {
      var res  = await fetch('/api/study/generate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ topic, length: selectedLength, studyType: selectedType, studyLevel: studyLevelSelect ? studyLevelSelect.value : '' }),
        signal:  abortController.signal,
      });
      var data = await res.json();

      if (!data.success) throw new Error(data.error || 'Generation failed.');

      currentGuide = { studyLength: selectedLength, studyType: selectedType, ...data };
      guideTitle.textContent   = data.topic;
      guideBadge.textContent   = data.translation || 'LSB';
      guideBody.innerHTML      = renderMarkdown(data.content);
      showState('guide');
      studyGenerated = true;
      // TEMP: admin word-count monitor for Study Length tuning — remove later
      if (window.IS_ADMIN) { showAdminWordCount(data.content, 'studyAdminWc'); }
      window.scrollTo({ top: 0, behavior: 'smooth' });

    } catch (err) {
      if (err.name === 'AbortError') {
        showState('browser');
        return;
      }
      showState('browser');
      showToast('Error: ' + err.message, true);
    } finally {
      abortController = null;
    }
  }

  // ── UI state management ────────────────────────────────────────────────────
  function showState(state) {
    studyLoading.style.display = 'none';
    guideArea.style.display    = 'none';
    savePanel.style.display    = 'none';
    topicBrowser.style.display = 'none';
    stopVerseRotation(); // stop the loading-screen verse rotator on any state change

    if (state === 'loading') {
      studyLoading.style.display = 'flex';
      startVerseRotation();
    } else if (state === 'guide') {
      guideArea.style.display    = 'block';
    } else if (state === 'save') {
      savePanel.style.display    = 'block';
    } else {
      topicBrowser.style.display = 'block';
    }
  }

  // ── Dismiss guide ──────────────────────────────────────────────────────────
  dismissGuideBtn.addEventListener('click', function () {
    studyGenerated = false;
    currentGuide = null;
    topicInput.value = '';
    showState('browser');
  });

  // ── Open save panel ────────────────────────────────────────────────────────
  saveLibraryBtn.addEventListener('click', function () {
    if (!currentGuide) return;
    saveTopicInput.value = currentGuide.topic;
    saveTagsInput.value  = '';
    if (saveShareInput) saveShareInput.checked = false;
    selectedRating = 0;
    highlightStars(0);
    showState('save');
  });

  cancelSaveBtn.addEventListener('click', function () {
    showState('guide');
  });

  // ── Confirm save ───────────────────────────────────────────────────────────
  confirmSaveBtn.addEventListener('click', async function () {
    if (!currentGuide) return;

    var body = {
      topic:       saveTopicInput.value.trim() || currentGuide.topic,
      content:     currentGuide.content,
      translation: currentGuide.translation,
      tags:        saveTagsInput.value,
      rating:      selectedRating,
      studyLength: currentGuide.studyLength,
      studyLevel:  currentGuide.studyLevel,
      studyType:   currentGuide.studyType,
      shared:      !!(saveShareInput && saveShareInput.checked),
      createdAt:   new Date().toISOString(),
    };

    try {
      var res  = await fetch('/api/library/save', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });
      var data = await res.json();

      if (data.success) {
        studyGenerated = false;
        currentGuide = null;
        topicInput.value = '';
        showState('browser');
        showToast(body.shared ? 'Saved to Library and shared to Community.' : 'Saved to Library.');
      } else {
        showToast('Error: ' + (data.error || 'Save failed.'), true);
      }
    } catch (err) {
      showToast('Error: ' + err.message, true);
    }
  });

  // ── Markdown renderer ──────────────────────────────────────────────────────
  function renderMarkdown(text) {
    if (!text) return '';

    var html = text
      .replace(/^#### (.+)$/gm, '<h5 class="guide-h5">$1</h5>')
      .replace(/^### (.+)$/gm,  '<h4 class="guide-h4">$1</h4>')
      .replace(/^## (.+)$/gm,   '<h3 class="guide-h3">$1</h3>')
      .replace(/^# (.+)$/gm,    '<h2 class="guide-h2">$1</h2>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g,     '<em>$1</em>')
      .replace(/^---$/gm,        '<hr class="guide-hr">');

    var lines  = html.split('\n');
    var result = [];
    var inUl = false, inOl = false;

    lines.forEach(function (line) {
      var ulM = line.match(/^[-*] (.+)/);
      var olM = line.match(/^\d+\. (.+)/);
      var bqM = line.match(/^> (.+)/);

      if (bqM) {
        if (inUl) { result.push('</ul>'); inUl = false; }
        if (inOl) { result.push('</ol>'); inOl = false; }
        result.push('<blockquote class="guide-bq">' + bqM[1] + '</blockquote>');
      } else if (ulM) {
        if (inOl) { result.push('</ol>'); inOl = false; }
        if (!inUl) { result.push('<ul class="guide-list">'); inUl = true; }
        result.push('<li>' + ulM[1] + '</li>');
      } else if (olM) {
        if (inUl) { result.push('</ul>'); inUl = false; }
        if (!inOl) { result.push('<ol class="guide-list guide-ol">'); inOl = true; }
        result.push('<li>' + olM[1] + '</li>');
      } else {
        if (inUl) { result.push('</ul>'); inUl = false; }
        if (inOl) { result.push('</ol>'); inOl = false; }
        var t = line.trim();
        if (!t) {
          result.push('<div class="guide-spacer"></div>');
        } else if (t.startsWith('<h') || t.startsWith('<hr')) {
          result.push(t);
        } else {
          result.push('<p class="guide-p">' + t + '</p>');
        }
      }
    });

    if (inUl) result.push('</ul>');
    if (inOl) result.push('</ol>');
    return result.join('\n');
  }

  // ── Toast ──────────────────────────────────────────────────────────────────
  function showToast(msg, isError) {
    var toast = document.createElement('div');
    toast.className = 'toast-msg' + (isError ? ' toast-error' : '');
    toast.textContent = msg;
    document.body.appendChild(toast);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { toast.classList.add('visible'); });
    });
    setTimeout(function () {
      toast.classList.remove('visible');
      setTimeout(function () { toast.remove(); }, 350);
    }, 2800);
  }

  // ── Unsaved study guard ────────────────────────────────────────────────────
  window.addEventListener('beforeunload', function (e) {
    if (studyGenerated) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  document.querySelectorAll('.sidebar a').forEach(function (link) {
    link.addEventListener('click', function (e) {
      if (!studyGenerated) return;
      e.preventDefault();
      var href = link.getAttribute('href');
      showLeaveConfirm(
        'You have an unsaved study. If you leave now it will be lost.',
        function () { studyGenerated = false; window.location.href = href; },
        null
      );
    });
  });

  // TEMP: admin word-count monitor for Study Length tuning — remove later
  function showAdminWordCount(markdownContent, elId) {
    var el = document.getElementById(elId);
    if (!el) return;
    var words = (markdownContent || '').replace(/[#*_`>\-]/g, ' ').trim().split(/\s+/).filter(Boolean).length;
    el.textContent = words + ' words';
    el.style.display = 'block';
  }

})();
