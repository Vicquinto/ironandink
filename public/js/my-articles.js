(function () {
  'use strict';

  var articleList      = document.getElementById('myArticleList');
  var trashSection     = document.getElementById('myTrashSection');
  var trashList        = document.getElementById('myTrashList');
  var emptyTrashBtn    = document.getElementById('emptyTrashBtn');
  var myArticleReading = document.getElementById('myArticleReading');
  var readingTitle     = document.getElementById('readingTitle');
  var readingBody      = document.getElementById('readingBody');
  var readingBackBtn   = document.getElementById('readingBackBtn');
  var readingBadges    = document.getElementById('readingBadges');

  // Whether the holding area currently has any trashed items (drives its
  // visibility when returning to the list view).
  var hasTrash = false;

  // ── View switching ────────────────────────────────────────────────────────
  function showList() {
    if (myArticleReading) myArticleReading.style.display = 'none';
    if (articleList)      articleList.style.display      = 'block';
    if (trashSection)     trashSection.style.display     = hasTrash ? 'block' : 'none';
  }

  function showReading(article) {
    if (!myArticleReading || !readingTitle || !readingBody) return;
    articleList.style.display      = 'none';
    if (trashSection) trashSection.style.display = 'none';
    myArticleReading.style.display = 'block';

    readingTitle.textContent = article.title;
    readingBody.innerHTML    = renderReadingText(article.content || '');

    if (readingBadges) {
      var formLabel   = formDisplayLabel(article.form);
      var statusClass = statusBadgeClass(article.status);
      readingBadges.innerHTML =
        '<span class="tier-badge-sm">Tier ' + article.tier + '</span> ' +
        '<span class="form-badge form-badge-' + esc(article.form || 'article') + '">' + formLabel + '</span> ' +
        '<span class="article-status-badge ' + statusClass + '">' + article.status + '</span>';
    }
  }

  if (readingBackBtn) readingBackBtn.addEventListener('click', showList);

  // ── Load articles (all — Draft + Complete + Pending + Published) ──────────
  async function loadArticles() {
    try {
      var res  = await fetch('/api/articles');
      var data = await res.json();
      renderArticles(data.articles || []);
    } catch (err) {
      articleList.innerHTML = '<p class="writing-empty">Could not load articles.</p>';
    }
  }

  function renderArticles(allArticles) {
    // Split into the active list and the trash holding area.
    var articles = (allArticles || []).filter(function (a) { return !a.deleted; });
    var trashed  = (allArticles || []).filter(function (a) { return a.deleted; });

    renderTrash(trashed);

    if (!articles.length) {
      articleList.innerHTML = '<p class="writing-empty">No articles yet. <a href="/writing" class="link-accent">Begin your first.</a></p>';
      return;
    }

    articleList.innerHTML = articles.map(function (a) {
      var formLabel   = formDisplayLabel(a.form);
      var statusClass = statusBadgeClass(a.status);
      var text        = a.content || '';
      var words       = text.trim() ? text.trim().split(/\s+/).length : 0;

      var rejectionHtml = '';
      if (a.status === 'Complete' && a.rejectionNote) {
        rejectionHtml = '<div class="rejection-note">Returned by admin: ' + esc(a.rejectionNote) + '</div>';
      }

      var submitBtn = '';
      if (a.status === 'Complete') {
        submitBtn = '<button class="btn-submit-review article-submit-btn" data-id="' + esc(a.id) + '">Submit for Review</button>';
      } else if (a.status === 'Pending') {
        submitBtn = '<span class="pending-label">&#8987; Awaiting admin review</span>';
      } else if (a.status === 'Published') {
        submitBtn = '<button class="btn-submit-review article-unpublish-btn" data-id="' + esc(a.id) + '">Unpublish</button>' +
          '<a href="/community" class="link-accent" style="font-size:0.82rem;">View in Community &#8594;</a>';
      }

      return '<div class="article-card">' +
        '<div class="article-card-header">' +
          '<span class="article-card-title">' + esc(a.title) + '</span>' +
        '</div>' +
        '<div class="article-card-meta">' +
          '<span class="tier-badge-sm">Tier ' + a.tier + '</span>' +
          '<span class="form-badge form-badge-' + esc(a.form || 'article') + '">' + formLabel + '</span>' +
          '<span class="article-card-date">' + fmtDate(a.updatedAt || a.createdAt) + '</span>' +
          '<span class="article-status-badge ' + statusClass + '">' + a.status + '</span>' +
          '<span class="article-word-count">' + words + ' words</span>' +
        '</div>' +
        rejectionHtml +
        '<div style="display:flex; gap:10px; align-items:center; margin-top:12px; flex-wrap:wrap;">' +
          '<button class="btn-warm article-open-btn" data-id="' + esc(a.id) + '" ' +
            'style="font-size:0.82rem; padding:7px 18px;">Open</button>' +
          submitBtn +
          '<button class="btn-delete-article article-delete-btn" data-id="' + esc(a.id) + '">Delete</button>' +
        '</div>' +
      '</div>';
    }).join('');

    articleList.querySelectorAll('.article-open-btn').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        try {
          var res  = await fetch('/api/articles/' + encodeURIComponent(btn.dataset.id));
          var data = await res.json();
          if (data.success) showReading(data.article);
          else showToast('Could not load article.', true);
        } catch (err) {
          showToast('Error: ' + err.message, true);
        }
      });
    });

    articleList.querySelectorAll('.article-submit-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        showConfirm('Submit this article for admin review?', 'Submit', async function () {
          btn.disabled = true;
          try {
            var res  = await fetch('/api/articles/' + encodeURIComponent(btn.dataset.id) + '/submit', { method: 'PATCH' });
            var data = await res.json();
            if (data.success) {
              showToast('Your article has been submitted for admin review.');
              loadArticles();
            } else {
              showToast('Submit failed: ' + (data.error || ''), true);
              btn.disabled = false;
            }
          } catch (err) {
            showToast('Error: ' + err.message, true);
            btn.disabled = false;
          }
        });
      });
    });

    articleList.querySelectorAll('.article-unpublish-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        showConfirm('Unpublish this article? It will be removed from the Community board and returned to your drafts as Complete, so you can edit it. Your amens and comments are kept, and you can re-submit it for review afterward.', 'Unpublish', async function () {
          btn.disabled = true;
          try {
            var res  = await fetch('/api/articles/' + encodeURIComponent(btn.dataset.id) + '/unpublish', { method: 'PATCH' });
            var data = await res.json();
            if (data.success) {
              showToast('Article unpublished and returned to your drafts as Complete.');
              loadArticles();
            } else {
              showToast('Unpublish failed: ' + (data.error || ''), true);
              btn.disabled = false;
            }
          } catch (err) {
            showToast('Error: ' + err.message, true);
            btn.disabled = false;
          }
        });
      });
    });

    articleList.querySelectorAll('.article-delete-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        showConfirm('Move this article to trash? You can restore it or delete it permanently from the trash.', 'Move to Trash', async function () {
          try {
            var res  = await fetch('/api/articles/' + encodeURIComponent(btn.dataset.id) + '/trash', { method: 'PATCH' });
            var data = await res.json();
            if (data.success) { showToast('Moved to trash.'); loadArticles(); }
            else showToast('Move to trash failed: ' + (data.error || ''), true);
          } catch (err) {
            showToast('Error: ' + err.message, true);
          }
        });
      });
    });
  }

  // ── Trash holding area ──────────────────────────────────────────────────────
  function renderTrash(trashed) {
    hasTrash = trashed.length > 0;
    if (trashSection) trashSection.style.display = hasTrash ? 'block' : 'none';
    if (!trashList) return;

    if (!hasTrash) { trashList.innerHTML = ''; return; }

    trashList.innerHTML = trashed.map(function (a) {
      var formLabel = formDisplayLabel(a.form);
      var text      = a.content || '';
      var words     = text.trim() ? text.trim().split(/\s+/).length : 0;

      return '<div class="article-card article-card-trashed">' +
        '<div class="article-card-header">' +
          '<span class="article-card-title">' + esc(a.title) + '</span>' +
        '</div>' +
        '<div class="article-card-meta">' +
          '<span class="tier-badge-sm">Tier ' + a.tier + '</span>' +
          '<span class="form-badge form-badge-' + esc(a.form || 'article') + '">' + formLabel + '</span>' +
          '<span class="article-card-date">Trashed ' + fmtDate(a.deletedAt || a.updatedAt) + '</span>' +
          '<span class="article-word-count">' + words + ' words</span>' +
        '</div>' +
        '<div style="display:flex; gap:10px; align-items:center; margin-top:12px; flex-wrap:wrap;">' +
          '<button class="btn-warm article-restore-btn" data-id="' + esc(a.id) + '" ' +
            'style="font-size:0.82rem; padding:7px 18px;">Restore</button>' +
          '<button class="btn-delete-article article-purge-btn" data-id="' + esc(a.id) + '">Delete Permanently</button>' +
        '</div>' +
      '</div>';
    }).join('');

    trashList.querySelectorAll('.article-restore-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        btn.disabled = true;
        (async function () {
          try {
            var res  = await fetch('/api/articles/' + encodeURIComponent(btn.dataset.id) + '/restore', { method: 'PATCH' });
            var data = await res.json();
            if (data.success) { showToast('Article restored.'); loadArticles(); }
            else { showToast('Restore failed: ' + (data.error || ''), true); btn.disabled = false; }
          } catch (err) {
            showToast('Error: ' + err.message, true); btn.disabled = false;
          }
        })();
      });
    });

    trashList.querySelectorAll('.article-purge-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        showConfirm('Permanently delete this article? This cannot be undone.', 'Delete Permanently', async function () {
          try {
            var res  = await fetch('/api/articles/' + encodeURIComponent(btn.dataset.id), { method: 'DELETE' });
            var data = await res.json();
            if (data.success) { showToast('Article permanently deleted.'); loadArticles(); }
            else showToast('Delete failed: ' + (data.error || ''), true);
          } catch (err) {
            showToast('Error: ' + err.message, true);
          }
        });
      });
    });
  }

  // ── Reading text renderer ─────────────────────────────────────────────────
  function renderReadingText(text) {
    if (window.marked) {
      return window.marked.parse ? window.marked.parse(String(text)) : window.marked(String(text));
    }
    var escaped = String(text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return '<p>' + escaped.split(/\n\n+/).map(function (p) {
      return p.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
              .replace(/\*(.+?)\*/g, '<em>$1</em>')
              .replace(/\n/g, '<br>');
    }).join('</p><p>') + '</p>';
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function formDisplayLabel(form) {
    var labels = { article: 'Article', sermon: 'Sermon', letter: 'Letter' };
    return labels[form] || 'Article';
  }

  function statusBadgeClass(status) {
    var map = {
      'Draft':     'status-draft',
      'Complete':  'status-complete',
      'Pending':   'status-pending',
      'Published': 'status-published',
    };
    return map[status] || 'status-draft';
  }

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

  // ── Reading font size ─────────────────────────────────────────────────────
  var RFONT_DEFAULT = 16, RFONT_MIN = 12, RFONT_MAX = 28, RFONT_STEP = 2;
  var rfontSize = parseInt(localStorage.getItem('ironink_study_font_size'), 10) || RFONT_DEFAULT;

  function applyArticleFontSize(size) {
    rfontSize = Math.min(RFONT_MAX, Math.max(RFONT_MIN, size));
    if (readingBody) readingBody.style.fontSize = rfontSize + 'px';
    localStorage.setItem('ironink_study_font_size', rfontSize);
  }

  applyArticleFontSize(rfontSize);

  var aFontDec   = document.getElementById('articleFontDec');
  var aFontReset = document.getElementById('articleFontReset');
  var aFontInc   = document.getElementById('articleFontInc');
  if (aFontDec) {
    aFontDec.addEventListener('click',   function () { applyArticleFontSize(rfontSize - RFONT_STEP); });
    aFontReset.addEventListener('click', function () { applyArticleFontSize(RFONT_DEFAULT); });
    aFontInc.addEventListener('click',   function () { applyArticleFontSize(rfontSize + RFONT_STEP); });
  }

  // Empty Trash — static button, wired once.
  if (emptyTrashBtn) {
    emptyTrashBtn.addEventListener('click', function () {
      showConfirm('Permanently delete ALL articles in the trash? This cannot be undone.', 'Empty Trash', async function () {
        try {
          var res  = await fetch('/api/articles/trash/empty', { method: 'DELETE' });
          var data = await res.json();
          if (data.success) { showToast('Trash emptied.'); loadArticles(); }
          else showToast('Empty trash failed: ' + (data.error || ''), true);
        } catch (err) {
          showToast('Error: ' + err.message, true);
        }
      });
    });
  }

  loadArticles();
})();
