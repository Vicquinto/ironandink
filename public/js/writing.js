(function () {
  'use strict';

  // ── State ─────────────────────────────────────────────────────────────────
  var selectedTier        = 0;
  var answers             = ['', '', '', '', ''];
  var currentQ            = 0;
  var currentArticleId    = null;
  var currentArticleStatus = 'Draft';

  var QUESTIONS = [
    'What is the central doctrinal claim of this article? State it in one sentence.',
    'What are your two or three primary scripture arguments for this claim? Give the passages and a brief statement of what each one establishes.',
    'Who is your intended reader — a skeptic, a curious believer, a fellow Reformed student? How does that shape your tone?',
    'What is the strongest objection your reader will raise? How will you answer it?',
    'How does this doctrine connect to the life of the believer? Where does this end in worship and doxology?'
  ];

  // ── DOM refs ──────────────────────────────────────────────────────────────
  var writingMain     = document.getElementById('writingMain');
  var writingEditor   = document.getElementById('writingEditor');
  var writingLoading  = document.getElementById('writingLoading');
  var writingModal    = document.getElementById('writingModal');
  var beginArticleBtn = document.getElementById('beginArticleBtn');
  var articleList     = document.getElementById('articleList');

  var wModalStep1           = document.getElementById('wModalStep1');
  var wModalStep2           = document.getElementById('wModalStep2');
  var tierContinueBtn       = document.getElementById('tierContinueBtn');
  var cancelWritingModalBtn = document.getElementById('cancelWritingModalBtn');
  var closeWritingModalBtn  = document.getElementById('closeWritingModalBtn');

  var questionNum    = document.getElementById('questionNum');
  var questionText   = document.getElementById('questionText');
  var questionAnswer = document.getElementById('questionAnswer');
  var questionNextBtn = document.getElementById('questionNextBtn');

  var editorTitle      = document.getElementById('editorTitle');
  var editorContent    = document.getElementById('editorContent');
  var editorTierBadge  = document.getElementById('editorTierBadge');
  var editorWordCount  = document.getElementById('editorWordCount');
  var saveDraftBtn     = document.getElementById('saveDraftBtn');
  var markCompleteBtn  = document.getElementById('markCompleteBtn');
  var startOverBtn     = document.getElementById('startOverBtn');
  var writingLoadingText = document.getElementById('writingLoadingText');

  // ── State control ─────────────────────────────────────────────────────────
  function showState(state) {
    writingMain.style.display    = 'none';
    writingEditor.style.display  = 'none';
    writingLoading.style.display = 'none';
    writingModal.style.display   = 'none';

    if (state === 'main') {
      writingMain.style.display = 'block';
    } else if (state === 'editor') {
      writingEditor.style.display = 'block';
    } else if (state === 'loading') {
      writingLoading.style.display = 'flex';
    } else if (state === 'modal') {
      writingMain.style.display  = 'block';
      writingModal.style.display = 'flex';
    }
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() {
    loadArticleList();
    var params    = new URLSearchParams(window.location.search);
    var articleId = params.get('article');
    if (articleId) openArticleById(articleId);
  }

  // ── Begin New Article ─────────────────────────────────────────────────────
  beginArticleBtn.addEventListener('click', function () {
    selectedTier = 0;
    document.querySelectorAll('input[name="writingTier"]').forEach(function (r) { r.checked = false; });
    tierContinueBtn.disabled = true;
    wModalStep1.style.display = 'block';
    wModalStep2.style.display = 'none';
    showState('modal');
  });

  // ── Close / cancel modal ──────────────────────────────────────────────────
  function closeModal() { showState('main'); }
  cancelWritingModalBtn.addEventListener('click', closeModal);
  closeWritingModalBtn.addEventListener('click', closeModal);

  // ── Tier selection ────────────────────────────────────────────────────────
  document.querySelectorAll('input[name="writingTier"]').forEach(function (radio) {
    radio.addEventListener('change', function () {
      selectedTier = parseInt(radio.value, 10);
      tierContinueBtn.disabled = false;
    });
  });

  tierContinueBtn.addEventListener('click', function () {
    if (!selectedTier) return;
    answers  = ['', '', '', '', ''];
    currentQ = 0;
    wModalStep1.style.display = 'none';
    wModalStep2.style.display = 'block';
    showQuestion(0);
  });

  // ── Question flow ─────────────────────────────────────────────────────────
  function showQuestion(index) {
    currentQ = index;
    questionNum.textContent  = index + 1;
    questionText.textContent = QUESTIONS[index];
    questionAnswer.value     = answers[index] || '';
    questionNextBtn.disabled = questionAnswer.value.trim() === '';
    questionNextBtn.textContent = index === 4 ? 'Generate' : 'Next';
    questionAnswer.focus();
  }

  questionAnswer.addEventListener('input', function () {
    questionNextBtn.disabled = questionAnswer.value.trim() === '';
  });

  questionNextBtn.addEventListener('click', function () {
    answers[currentQ] = questionAnswer.value.trim();
    if (currentQ < 4) {
      showQuestion(currentQ + 1);
    } else {
      generateArticle();
    }
  });

  // ── Generate ──────────────────────────────────────────────────────────────
  async function generateArticle() {
    var labels = { 1: 'Preparing your outline…', 2: 'Preparing your draft…', 3: 'Preparing your article…' };
    writingLoadingText.textContent = labels[selectedTier] || 'Generating…';
    showState('loading');

    try {
      var res = await fetch('/api/writing/generate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          tier:    selectedTier,
          answers: { q1: answers[0], q2: answers[1], q3: answers[2], q4: answers[3], q5: answers[4] },
          topic:   answers[0],
        }),
      });
      var data = await res.json();
      if (!data.success) throw new Error(data.error || 'Generation failed.');

      currentArticleId     = null;
      currentArticleStatus = 'Draft';
      editorTitle.value    = answers[0];
      editorContent.value  = data.content;
      setTierBadge(selectedTier);
      updateWordCount();
      showState('editor');
    } catch (err) {
      showState('main');
      showToast('Error: ' + err.message, true);
    }
  }

  // ── Open article ──────────────────────────────────────────────────────────
  async function openArticleById(id) {
    try {
      var res  = await fetch('/api/articles/' + encodeURIComponent(id));
      var data = await res.json();
      if (data.success) loadArticleIntoEditor(data.article);
      else showToast('Could not load article.', true);
    } catch (err) {
      showToast('Could not load article.', true);
    }
  }

  function loadArticleIntoEditor(article) {
    currentArticleId     = article.id;
    currentArticleStatus = article.status;
    selectedTier         = article.tier;
    if (article.answers) {
      answers = [
        article.answers.q1 || '',
        article.answers.q2 || '',
        article.answers.q3 || '',
        article.answers.q4 || '',
        article.answers.q5 || '',
      ];
    }
    editorTitle.value   = article.title;
    editorContent.value = article.content;
    setTierBadge(article.tier);
    updateWordCount();
    showState('editor');
  }

  // ── Save / Mark Complete ──────────────────────────────────────────────────
  saveDraftBtn.addEventListener('click',    function () { saveArticle('Draft'); });
  markCompleteBtn.addEventListener('click', function () { saveArticle('Complete'); });

  async function saveArticle(status) {
    var title   = editorTitle.value.trim();
    var content = editorContent.value;
    if (!title) { editorTitle.focus(); showToast('Please add a title.', true); return; }

    var body = {
      title,
      content,
      tier:    selectedTier,
      answers: { q1: answers[0], q2: answers[1], q3: answers[2], q4: answers[3], q5: answers[4] },
      status,
    };

    try {
      var res, data;
      if (currentArticleId) {
        res  = await fetch('/api/articles/' + encodeURIComponent(currentArticleId), {
          method:  'PUT',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(body),
        });
      } else {
        res  = await fetch('/api/articles', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(body),
        });
      }
      data = await res.json();
      if (data.success) {
        currentArticleId     = data.article.id;
        currentArticleStatus = data.article.status;
        showToast(status === 'Complete' ? 'Marked complete.' : 'Draft saved.');
      } else {
        showToast('Error: ' + (data.error || 'Save failed.'), true);
      }
    } catch (err) {
      showToast('Error: ' + err.message, true);
    }
  }

  // ── Start Over ────────────────────────────────────────────────────────────
  startOverBtn.addEventListener('click', function () {
    currentArticleId     = null;
    currentArticleStatus = 'Draft';
    selectedTier         = 0;
    answers              = ['', '', '', '', ''];
    editorTitle.value    = '';
    editorContent.value  = '';
    updateWordCount();
    loadArticleList();
    showState('main');
    if (window.history.replaceState) window.history.replaceState({}, '', '/writing');
  });

  // ── Article list ──────────────────────────────────────────────────────────
  async function loadArticleList() {
    try {
      var res  = await fetch('/api/articles');
      var data = await res.json();
      renderArticleList(data.articles || []);
    } catch (err) {
      articleList.innerHTML = '<p class="writing-empty">Could not load articles.</p>';
    }
  }

  function renderArticleList(articles) {
    if (!articles.length) {
      articleList.innerHTML = '<p class="writing-empty">No articles yet. Begin your first.</p>';
      return;
    }
    articleList.innerHTML = articles.map(function (a) {
      var statusClass = a.status === 'Complete' ? 'status-complete' : 'status-draft';
      return '<div class="article-card">' +
        '<div class="article-card-header">' +
          '<span class="article-card-title">' + esc(a.title) + '</span>' +
          '<button class="card-delete-btn article-delete-btn" data-id="' + esc(a.id) + '" title="Delete">&#10005;</button>' +
        '</div>' +
        '<div class="article-card-meta">' +
          '<span class="tier-badge-sm">Tier ' + a.tier + '</span>' +
          '<span class="article-card-date">' + fmtDate(a.updatedAt || a.createdAt) + '</span>' +
          '<span class="article-status-badge ' + statusClass + '">' + a.status + '</span>' +
        '</div>' +
        '<button class="btn-warm article-open-btn" data-id="' + esc(a.id) + '" style="margin-top:12px; font-size:0.82rem; padding:7px 18px;">Open</button>' +
      '</div>';
    }).join('');

    articleList.querySelectorAll('.article-open-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { openArticleById(btn.dataset.id); });
    });

    articleList.querySelectorAll('.article-delete-btn').forEach(function (btn) {
      btn.addEventListener('click', async function (e) {
        e.stopPropagation();
        if (!confirm('Delete this article? This cannot be undone.')) return;
        try {
          var res  = await fetch('/api/articles/' + encodeURIComponent(btn.dataset.id), { method: 'DELETE' });
          var data = await res.json();
          if (data.success) loadArticleList();
          else showToast('Delete failed.', true);
        } catch (err) {
          showToast('Error: ' + err.message, true);
        }
      });
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function setTierBadge(tier) {
    var labels = { 1: 'Tier 1 — Scaffold', 2: 'Tier 2 — Draft', 3: 'Tier 3 — Ghostwrite' };
    editorTierBadge.textContent = labels[tier] || 'Tier ' + tier;
  }

  function updateWordCount() {
    var text  = editorContent.value.trim();
    var words = text ? text.split(/\s+/).length : 0;
    editorWordCount.textContent = words + ' word' + (words !== 1 ? 's' : '');
  }

  editorContent.addEventListener('input', updateWordCount);

  function fmtDate(iso) {
    var d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function showToast(msg, isError) {
    var toast = document.createElement('div');
    toast.className   = 'toast-msg' + (isError ? ' toast-error' : '');
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

  init();
})();
