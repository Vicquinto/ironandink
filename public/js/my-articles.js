(function () {
  'use strict';

  var articleList      = document.getElementById('myArticleList');
  var myArticleReading = document.getElementById('myArticleReading');
  var readingTitle     = document.getElementById('readingTitle');
  var readingBody      = document.getElementById('readingBody');
  var readingBackBtn   = document.getElementById('readingBackBtn');
  var readingBadges    = document.getElementById('readingBadges');

  // ── View switching ────────────────────────────────────────────────────────
  function showList() {
    if (myArticleReading) myArticleReading.style.display = 'none';
    if (articleList)      articleList.style.display      = 'block';
  }

  function showReading(article) {
    if (!myArticleReading || !readingTitle || !readingBody) return;
    articleList.style.display      = 'none';
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

  function renderArticles(articles) {
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
        submitBtn = '<a href="/community" class="link-accent" style="font-size:0.82rem;">View in Community &#8594;</a>';
      }

      return '<div class="article-card">' +
        '<div class="article-card-header">' +
          '<span class="article-card-title">' + esc(a.title) + '</span>' +
          '<button class="card-delete-btn article-delete-btn" data-id="' + esc(a.id) + '" title="Delete">&#10005;</button>' +
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
      btn.addEventListener('click', async function () {
        if (!confirm('Submit this article for admin review?')) return;
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

    articleList.querySelectorAll('.article-delete-btn').forEach(function (btn) {
      btn.addEventListener('click', async function (e) {
        e.stopPropagation();
        if (!confirm('Delete this article? This cannot be undone.')) return;
        try {
          var res  = await fetch('/api/articles/' + encodeURIComponent(btn.dataset.id), { method: 'DELETE' });
          var data = await res.json();
          if (data.success) loadArticles();
          else showToast('Delete failed.', true);
        } catch (err) {
          showToast('Error: ' + err.message, true);
        }
      });
    });
  }

  // ── Reading text renderer ─────────────────────────────────────────────────
  function renderReadingText(text) {
    var escaped = String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    var paragraphs = escaped.split(/\n\n+/).map(function (para) {
      return para
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/\n/g, '<br>');
    });

    return '<p>' + paragraphs.join('</p><p>') + '</p>';
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

  loadArticles();
})();
