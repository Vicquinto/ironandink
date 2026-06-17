(function () {
  'use strict';

  let currentGuide    = null;
  let selectedRating  = 0;
  let abortController = null;
  let studyGenerated  = false;

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
  const confirmSaveBtn  = document.getElementById('confirmSaveBtn');
  const cancelSaveBtn   = document.getElementById('cancelSaveBtn');
  const topicBrowser    = document.getElementById('topicBrowser');
  const stars           = document.querySelectorAll('.star');
  const fontDecBtn      = document.getElementById('fontDecBtn');
  const fontResetBtn    = document.getElementById('fontResetBtn');
  const fontIncBtn      = document.getElementById('fontIncBtn');

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
        body:    JSON.stringify({ topic }),
        signal:  abortController.signal,
      });
      var data = await res.json();

      if (!data.success) throw new Error(data.error || 'Generation failed.');

      currentGuide = data;
      guideTitle.textContent   = data.topic;
      guideBadge.textContent   = data.translation || 'LSB';
      guideBody.innerHTML      = renderMarkdown(data.content);
      showState('guide');
      studyGenerated = true;
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

    if (state === 'loading') {
      studyLoading.style.display = 'flex';
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
        showToast('Saved to Library.');
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

      if (ulM) {
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

})();
