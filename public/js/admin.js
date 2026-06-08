(function () {
  'use strict';

  var adminFeed     = document.getElementById('adminFeed');
  var adminReading  = document.getElementById('adminReading');
  var adminBackBtn  = document.getElementById('adminBackBtn');
  var adminReadBadges  = document.getElementById('adminReadBadges');
  var adminReadTitle   = document.getElementById('adminReadTitle');
  var adminReadMeta    = document.getElementById('adminReadMeta');
  var adminReadBody    = document.getElementById('adminReadBody');
  var adminReadActions = document.getElementById('adminReadActions');

  var pendingList    = document.getElementById('pendingList');
  var pendingEmpty   = document.getElementById('pendingEmpty');
  var publishedList  = document.getElementById('publishedList');
  var publishedEmpty = document.getElementById('publishedEmpty');

  var rejectModal      = document.getElementById('rejectModal');
  var rejectNoteInput  = document.getElementById('rejectNoteInput');
  var rejectConfirmBtn = document.getElementById('rejectConfirmBtn');
  var rejectCancelBtn  = document.getElementById('rejectCancelBtn');

  var adminTabPending   = document.getElementById('adminTabPending');
  var adminTabPublished = document.getElementById('adminTabPublished');

  var currentRejectId = null;

  // ── Tabs ──────────────────────────────────────────────────────────────────
  document.querySelectorAll('.admin-tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.admin-tab').forEach(function (t) { t.classList.remove('active'); });
      tab.classList.add('active');
      var which = tab.dataset.tab;
      adminTabPending.style.display   = which === 'pending'   ? 'block' : 'none';
      adminTabPublished.style.display = which === 'published' ? 'block' : 'none';
    });
  });

  // ── Back button ───────────────────────────────────────────────────────────
  if (adminBackBtn) {
    adminBackBtn.addEventListener('click', function () {
      adminReading.style.display = 'none';
      adminFeed.style.display    = 'block';
    });
  }

  // ── Load pending ──────────────────────────────────────────────────────────
  async function loadPending() {
    try {
      var res  = await fetch('/api/admin/pending');
      var data = await res.json();
      renderPending(data.articles || []);
    } catch (err) {
      if (pendingList) pendingList.innerHTML = '<p class="writing-empty">Could not load pending submissions.</p>';
    }
  }

  function renderPending(articles) {
    if (!articles.length) {
      if (pendingEmpty)  pendingEmpty.style.display = 'block';
      if (pendingList)   pendingList.innerHTML = '';
      return;
    }
    if (pendingEmpty) pendingEmpty.style.display = 'none';

    pendingList.innerHTML = articles.map(function (a) {
      var words     = a.content ? a.content.trim().split(/\s+/).length : 0;
      var formLabel = formDisplayLabel(a.form);
      return '<div class="article-card">' +
        '<div class="article-card-header">' +
          '<span class="article-card-title">' + esc(a.title) + '</span>' +
          '<span class="article-status-badge status-pending">Pending</span>' +
        '</div>' +
        '<div class="article-card-meta">' +
          '<span class="tier-badge-sm">Tier ' + a.tier + '</span>' +
          '<span class="form-badge form-badge-' + esc(a.form || 'article') + '">' + formLabel + '</span>' +
          '<span class="community-card-author">' + esc(a.authorName || '') + '</span>' +
          '<span class="article-card-date">' + fmtDate(a.updatedAt) + '</span>' +
          '<span class="article-word-count">' + words + ' words</span>' +
        '</div>' +
        '<div style="display:flex; gap:10px; margin-top:12px;">' +
          '<button class="btn-warm admin-read-btn" data-id="' + esc(a.id) + '" data-ctx="pending" style="font-size:0.82rem; padding:6px 14px;">Read</button>' +
          '<button class="btn-primary admin-approve-btn" data-id="' + esc(a.id) + '" style="font-size:0.82rem; padding:6px 14px;">Approve</button>' +
          '<button class="btn-reject admin-reject-btn" data-id="' + esc(a.id) + '" style="font-size:0.82rem; padding:6px 14px;">Reject</button>' +
        '</div>' +
      '</div>';
    }).join('');

    pendingList.querySelectorAll('.admin-read-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { openReadView(btn.dataset.id, 'pending'); });
    });
    pendingList.querySelectorAll('.admin-approve-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        showConfirm('Approve and publish this article?', 'Approve', async function () {
          await approveArticle(btn.dataset.id);
        });
      });
    });
    pendingList.querySelectorAll('.admin-reject-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        currentRejectId = btn.dataset.id;
        rejectNoteInput.value = '';
        rejectModal.style.display = 'flex';
      });
    });
  }

  // ── Load published ────────────────────────────────────────────────────────
  async function loadPublished() {
    try {
      var res  = await fetch('/api/admin/published');
      var data = await res.json();
      renderPublished(data.articles || []);
    } catch (err) {
      if (publishedList) publishedList.innerHTML = '<p class="writing-empty">Could not load published articles.</p>';
    }
  }

  function renderPublished(articles) {
    if (!articles.length) {
      if (publishedEmpty)  publishedEmpty.style.display = 'block';
      if (publishedList)   publishedList.innerHTML = '';
      return;
    }
    if (publishedEmpty) publishedEmpty.style.display = 'none';

    publishedList.innerHTML = articles.map(function (a) {
      var words     = a.content ? a.content.trim().split(/\s+/).length : 0;
      var formLabel = formDisplayLabel(a.form);
      var pinLabel  = a.pinned ? 'Unpin' : 'Pin to Top';
      return '<div class="article-card">' +
        '<div class="article-card-header">' +
          '<span class="article-card-title">' + (a.pinned ? '&#128204; ' : '') + esc(a.title) + '</span>' +
          '<span class="article-status-badge status-published">Published</span>' +
        '</div>' +
        '<div class="article-card-meta">' +
          '<span class="tier-badge-sm">Tier ' + a.tier + '</span>' +
          '<span class="form-badge form-badge-' + esc(a.form || 'article') + '">' + formLabel + '</span>' +
          '<span class="community-card-author">' + esc(a.authorName || '') + '</span>' +
          '<span class="article-card-date">' + fmtDate(a.publishedAt || a.updatedAt) + '</span>' +
          '<span class="article-word-count">' + words + ' words</span>' +
          '<span style="color:var(--accent); font-size:0.75rem;">&#9825; ' + (a.amenCount || 0) + '</span>' +
          '<span style="color:var(--warm-brown); font-size:0.75rem;">&#128172; ' + (a.commentCount || 0) + '</span>' +
        '</div>' +
        '<div style="display:flex; gap:10px; margin-top:12px;">' +
          '<button class="btn-warm admin-read-btn" data-id="' + esc(a.id) + '" data-ctx="published" style="font-size:0.82rem; padding:6px 14px;">Read</button>' +
          '<button class="btn-warm admin-pin-btn" data-id="' + esc(a.id) + '" style="font-size:0.82rem; padding:6px 14px;">' + pinLabel + '</button>' +
          '<button class="btn-reject admin-unpublish-btn" data-id="' + esc(a.id) + '" style="font-size:0.82rem; padding:6px 14px;">Unpublish</button>' +
        '</div>' +
      '</div>';
    }).join('');

    publishedList.querySelectorAll('.admin-read-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { openReadView(btn.dataset.id, 'published'); });
    });
    publishedList.querySelectorAll('.admin-pin-btn').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        try {
          var res  = await fetch('/api/admin/' + encodeURIComponent(btn.dataset.id) + '/pin', { method: 'PATCH' });
          var data = await res.json();
          if (data.success) { showToast(data.pinned ? 'Pinned to top.' : 'Unpinned.'); loadPublished(); }
          else showToast('Pin failed.', true);
        } catch (err) { showToast('Error: ' + err.message, true); }
      });
    });
    publishedList.querySelectorAll('.admin-unpublish-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        showConfirm('Unpublish this article? It will return to Complete status.', 'Unpublish', async function () {
          try {
            var res  = await fetch('/api/admin/' + encodeURIComponent(btn.dataset.id) + '/unpublish', { method: 'PATCH' });
            var data = await res.json();
            if (data.success) { showToast('Article unpublished.'); loadPublished(); }
            else showToast('Unpublish failed.', true);
          } catch (err) { showToast('Error: ' + err.message, true); }
        });
      });
    });
  }

  // ── Reading view ──────────────────────────────────────────────────────────
  async function openReadView(id, context) {
    try {
      var res  = await fetch('/api/admin/articles/' + encodeURIComponent(id));
      var data = await res.json();
      if (!data.success) { showToast('Could not load article.', true); return; }

      var a = data.article;
      adminReadTitle.textContent = a.title;
      adminReadMeta.textContent  = (a.authorName || '') + ' · ' + fmtDate(a.updatedAt);

      var formLabel = formDisplayLabel(a.form);
      adminReadBadges.innerHTML =
        '<span class="tier-badge-sm">Tier ' + a.tier + '</span> ' +
        '<span class="form-badge form-badge-' + esc(a.form || 'article') + '">' + formLabel + '</span>';

      adminReadBody.innerHTML = renderReadingText(a.content || '');

      if (context === 'pending') {
        adminReadActions.innerHTML =
          '<button class="btn-primary admin-approve-read-btn" data-id="' + esc(id) + '">Approve &amp; Publish</button>' +
          '<button class="btn-reject" data-id="' + esc(id) + '" id="adminRejectReadBtn">Reject</button>';

        adminReadActions.querySelector('.admin-approve-read-btn').addEventListener('click', function () {
          showConfirm('Approve and publish this article?', 'Approve', async function () {
            await approveArticle(id);
            adminReading.style.display = 'none';
            adminFeed.style.display    = 'block';
          });
        });
        document.getElementById('adminRejectReadBtn').addEventListener('click', function () {
          currentRejectId = id;
          rejectNoteInput.value = '';
          rejectModal.style.display = 'flex';
        });
      } else {
        adminReadActions.innerHTML = '';
      }

      adminFeed.style.display    = 'none';
      adminReading.style.display = 'block';
    } catch (err) {
      showToast('Error: ' + err.message, true);
    }
  }

  // ── Approve ───────────────────────────────────────────────────────────────
  async function approveArticle(id) {
    try {
      var res  = await fetch('/api/admin/' + encodeURIComponent(id) + '/approve', { method: 'POST' });
      var data = await res.json();
      if (data.success) {
        showToast('Article approved and published.');
        loadPending();
        loadPublished();
      } else {
        showToast('Approve failed: ' + (data.error || ''), true);
      }
    } catch (err) {
      showToast('Error: ' + err.message, true);
    }
  }

  // ── Reject modal ──────────────────────────────────────────────────────────
  if (rejectCancelBtn) {
    rejectCancelBtn.addEventListener('click', function () {
      rejectModal.style.display = 'none';
      currentRejectId = null;
    });
  }

  if (rejectConfirmBtn) {
    rejectConfirmBtn.addEventListener('click', async function () {
      if (!currentRejectId) return;
      var note = rejectNoteInput.value.trim();
      rejectConfirmBtn.disabled = true;
      try {
        var res  = await fetch('/api/admin/' + encodeURIComponent(currentRejectId) + '/reject', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ note }),
        });
        var data = await res.json();
        if (data.success) {
          showToast('Article returned to author.');
          rejectModal.style.display = 'none';
          if (adminReading.style.display !== 'none') {
            adminReading.style.display = 'none';
            adminFeed.style.display    = 'block';
          }
          currentRejectId = null;
          loadPending();
        } else {
          showToast('Reject failed: ' + (data.error || ''), true);
        }
      } catch (err) {
        showToast('Error: ' + err.message, true);
      } finally {
        rejectConfirmBtn.disabled = false;
      }
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
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

  function formDisplayLabel(form) {
    var labels = { article: 'Article', sermon: 'Sermon', letter: 'Letter' };
    return labels[form] || 'Article';
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

  loadPending();
  loadPublished();
})();
