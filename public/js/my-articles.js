(function () {
  'use strict';

  var articleList = document.getElementById('myArticleList');

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
      var text        = a.content || '';
      var words       = text.trim() ? text.trim().split(/\s+/).length : 0;
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
          '<span class="article-word-count">' + words + ' words</span>' +
        '</div>' +
        '<a href="/writing?article=' + encodeURIComponent(a.id) + '" class="btn-warm" ' +
          'style="display:inline-block; margin-top:12px; font-size:0.82rem; padding:7px 18px; text-decoration:none;">' +
          'Open in Editor' +
        '</a>' +
      '</div>';
    }).join('');

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
