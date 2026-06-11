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

  var adminTabPending     = document.getElementById('adminTabPending');
  var adminTabPublished   = document.getElementById('adminTabPublished');
  var adminTabInvitations = document.getElementById('adminTabInvitations');

  var inviteRequestList  = document.getElementById('inviteRequestList');
  var inviteRequestEmpty = document.getElementById('inviteRequestEmpty');
  var sentInviteList     = document.getElementById('sentInviteList');
  var sentInviteEmpty    = document.getElementById('sentInviteEmpty');
  if (sentInviteList) {
    sentInviteList.addEventListener('click', async function (e) {
      var btn = e.target.closest('[data-delete-invite]');
      if (!btn) return;
      var id = btn.getAttribute('data-delete-invite');
      if (!confirm('Are you sure you want to delete this invite?')) return;
      btn.disabled = true;
      btn.textContent = 'Deleting…';
      try {
        var r    = await fetch('/api/admin/invites/' + id, { method: 'DELETE' });
        var data = await r.json();
        if (data.success) { loadSentInvites(); }
        else { btn.disabled = false; btn.textContent = 'Delete'; }
      } catch (err) { btn.disabled = false; btn.textContent = 'Delete'; }
    });
  }
  var inviteLinkBox      = document.getElementById('inviteLinkBox');
  var inviteLinkText     = document.getElementById('inviteLinkText');
  var copyInviteLinkBtn  = document.getElementById('copyInviteLinkBtn');

  var currentRejectId = null;

  // ── Tabs ──────────────────────────────────────────────────────────────────
  document.querySelectorAll('.admin-tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.admin-tab').forEach(function (t) { t.classList.remove('active'); });
      tab.classList.add('active');
      var which = tab.dataset.tab;
      adminTabPending.style.display     = which === 'pending'     ? 'block' : 'none';
      adminTabPublished.style.display   = which === 'published'   ? 'block' : 'none';
      adminTabInvitations.style.display = which === 'invitations' ? 'block' : 'none';
      if (which === 'invitations') { loadInviteRequests(); loadSentInvites(); }
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

  // ── Copy invite link ──────────────────────────────────────────────────────
  if (copyInviteLinkBtn) {
    copyInviteLinkBtn.addEventListener('click', function () {
      var link = inviteLinkText ? inviteLinkText.textContent : '';
      if (!link) return;
      navigator.clipboard.writeText(link).then(function () {
        showToast('Invite link copied.');
      }).catch(function () {
        showToast('Could not copy — select the link manually.', true);
      });
    });
  }

  // ── Load invite requests ──────────────────────────────────────────────────
  async function loadInviteRequests() {
    try {
      var res  = await fetch('/api/admin/invite-requests');
      var data = await res.json();
      renderInviteRequests(data.requests || []);
    } catch (err) {
      if (inviteRequestList) inviteRequestList.innerHTML = '<p class="writing-empty">Could not load requests.</p>';
    }
  }

  function renderInviteRequests(requests) {
    if (!requests.length) {
      if (inviteRequestEmpty) inviteRequestEmpty.style.display = 'block';
      if (inviteRequestList)  inviteRequestList.innerHTML = '';
      return;
    }
    if (inviteRequestEmpty) inviteRequestEmpty.style.display = 'none';

    inviteRequestList.innerHTML = requests.map(function (r) {
      return '<div class="article-card">' +
        '<div class="article-card-header">' +
          '<span class="article-card-title">' + esc(r.name) + '</span>' +
          '<span class="article-status-badge status-pending">Pending</span>' +
        '</div>' +
        '<div class="article-card-meta">' +
          '<span class="community-card-author">' + esc(r.email) + '</span>' +
          '<span class="article-card-date">' + fmtDate(r.submittedAt) + '</span>' +
        '</div>' +
        '<p style="font-size:0.85rem; color:var(--dark-cream); margin-top:10px; line-height:1.55; font-style:italic;">"' + esc(r.reason) + '"</p>' +
        '<div style="display:flex; gap:10px; margin-top:12px;">' +
          '<button class="btn-primary invite-send-btn" data-id="' + esc(r.id) + '" style="font-size:0.82rem; padding:6px 14px;">Send Invite</button>' +
          '<button class="btn-reject invite-decline-btn" data-id="' + esc(r.id) + '" style="font-size:0.82rem; padding:6px 14px;">Decline</button>' +
        '</div>' +
      '</div>';
    }).join('');

    inviteRequestList.querySelectorAll('.invite-send-btn').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        btn.disabled = true;
        btn.textContent = 'Sending…';
        try {
          var res  = await fetch('/api/admin/invite-requests/' + encodeURIComponent(btn.dataset.id) + '/invite', { method: 'POST' });
          var data = await res.json();
          if (data.success) {
            if (inviteLinkBox)  inviteLinkBox.style.display  = 'block';
            if (inviteLinkText) inviteLinkText.textContent   = data.inviteUrl;
            loadInviteRequests();
            loadSentInvites();
          } else {
            showToast('Failed: ' + (data.error || ''), true);
            btn.disabled = false;
            btn.textContent = 'Send Invite';
          }
        } catch (err) {
          showToast('Error: ' + err.message, true);
          btn.disabled = false;
          btn.textContent = 'Send Invite';
        }
      });
    });

    inviteRequestList.querySelectorAll('.invite-decline-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        showConfirm('Decline this invitation request?', 'Decline', async function () {
          try {
            var res  = await fetch('/api/admin/invite-requests/' + encodeURIComponent(btn.dataset.id) + '/decline', { method: 'POST' });
            var data = await res.json();
            if (data.success) { showToast('Request declined.'); loadInviteRequests(); }
            else showToast('Failed: ' + (data.error || ''), true);
          } catch (err) { showToast('Error: ' + err.message, true); }
        });
      });
    });
  }

  // ── Load sent invites ─────────────────────────────────────────────────────
  async function loadSentInvites() {
    try {
      var res  = await fetch('/api/admin/invites');
      var data = await res.json();
      renderSentInvites(data.invites || []);
    } catch (err) {
      if (sentInviteList) sentInviteList.innerHTML = '<p class="writing-empty">Could not load invites.</p>';
    }
  }

  function renderSentInvites(invites) {
    if (!invites.length) {
      if (sentInviteEmpty) sentInviteEmpty.style.display = 'block';
      if (sentInviteList)  sentInviteList.innerHTML = '';
      return;
    }
    if (sentInviteEmpty) sentInviteEmpty.style.display = 'none';

    sentInviteList.innerHTML = invites.map(function (i) {
      var usedLabel  = i.used ? 'Used' : 'Pending';
      var usedClass  = i.used ? 'status-published' : 'status-pending';
      var tokenShort = i.token ? i.token.substring(0, 8) + '…' : '';
      var expired    = !i.used && new Date(i.expiresAt) < new Date();
      return '<div class="article-card">' +
        '<div class="article-card-header">' +
          '<span class="article-card-title">' + esc(i.name) + '</span>' +
          '<span class="article-status-badge ' + usedClass + '">' + (expired && !i.used ? 'Expired' : usedLabel) + '</span>' +
        '</div>' +
        '<div class="article-card-meta">' +
          '<span class="community-card-author">' + esc(i.email) + '</span>' +
          '<span class="article-card-date">Sent ' + fmtDate(i.createdAt) + '</span>' +
          '<span class="article-card-date">Expires ' + fmtDate(i.expiresAt) + '</span>' +
          '<span style="font-family:\'Courier New\',monospace; font-size:0.72rem; color:var(--warm-brown);">' + esc(tokenShort) + '</span>' +
        '</div>' +
        '<div style="padding:6px 12px 10px;">' +
          '<button class="btn-discard" data-delete-invite="' + esc(i.id) + '" style="font-size:0.78rem;">Delete</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  loadPending();
  loadPublished();
})();
