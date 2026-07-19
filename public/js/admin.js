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

  // Tab panels are resolved by id convention in tabPanel() below — no refs needed here.

  var adminRoomsList  = document.getElementById('adminRoomsList');
  var adminRoomsEmpty = document.getElementById('adminRoomsEmpty');

  var memberList  = document.getElementById('memberList');
  var memberEmpty = document.getElementById('memberEmpty');

  var feedbackList     = document.getElementById('feedbackList');
  var feedbackEmpty    = document.getElementById('feedbackEmpty');

  var devotionalsList     = document.getElementById('devotionalsList');
  var devotionalsEmpty    = document.getElementById('devotionalsEmpty');
  var devotionalsClearAll = document.getElementById('devotionalsClearAllBtn');

  var inviteRequestList  = document.getElementById('inviteRequestList');
  var inviteRequestEmpty = document.getElementById('inviteRequestEmpty');
  var sentInviteList     = document.getElementById('sentInviteList');
  var sentInviteEmpty    = document.getElementById('sentInviteEmpty');

  document.body.insertAdjacentHTML('beforeend',
    '<div id="inviteConfirmModal" class="invite-confirm-overlay" style="display:none;">' +
      '<div class="invite-confirm-card">' +
        '<h4 class="invite-confirm-heading">Delete Invite</h4>' +
        '<p class="invite-confirm-msg">Are you sure you want to delete this invite? This cannot be undone.</p>' +
        '<div class="invite-confirm-actions">' +
          '<button class="btn-warm invite-confirm-cancel-btn" id="inviteConfirmCancel">Cancel</button>' +
          '<button class="invite-confirm-delete-btn" id="inviteConfirmDelete">Delete</button>' +
        '</div>' +
      '</div>' +
    '</div>'
  );

  function showInviteConfirm() {
    return new Promise(function (resolve) {
      var overlay = document.getElementById('inviteConfirmModal');
      overlay.style.display = 'flex';
      function onDelete() { cleanup(); resolve(true); }
      function onCancel() { cleanup(); resolve(false); }
      function cleanup() {
        overlay.style.display = 'none';
        document.getElementById('inviteConfirmDelete').removeEventListener('click', onDelete);
        document.getElementById('inviteConfirmCancel').removeEventListener('click', onCancel);
      }
      document.getElementById('inviteConfirmDelete').addEventListener('click', onDelete);
      document.getElementById('inviteConfirmCancel').addEventListener('click', onCancel);
    });
  }

  if (sentInviteList) {
    sentInviteList.addEventListener('click', async function (e) {
      var btn = e.target.closest('[data-delete-invite]');
      if (!btn) return;
      var id = btn.getAttribute('data-delete-invite');
      var confirmed = await showInviteConfirm();
      if (!confirmed) return;
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
  // Driven entirely by window.ADMIN_TABS, the descriptor array defined in
  // routes/admin.js (which also renders the buttons). Adding a tab needs one
  // entry there and its panel div — nothing changes in this file.
  var ADMIN_TABS = window.ADMIN_TABS || [];

  // Maps the loader names in the descriptors to the real functions below.
  // These are function declarations, so they are hoisted and safe to reference here.
  var tabLoaders = {
    loadInviteRequests: loadInviteRequests,
    loadSentInvites:    loadSentInvites,
    loadAdminRooms:     loadAdminRooms,
    loadMembers:        loadMembers,
    loadFeedback:       loadFeedback,
    loadDevotionals:    loadDevotionals
  };

  // Panel id convention: 'adminTab' + capitalised key (rooms → adminTabRooms).
  function tabPanel(key) {
    return document.getElementById('adminTab' + key.charAt(0).toUpperCase() + key.slice(1));
  }

  document.querySelectorAll('.admin-tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.admin-tab').forEach(function (t) { t.classList.remove('active'); });
      tab.classList.add('active');
      var which = tab.dataset.tab;

      ADMIN_TABS.forEach(function (t) {
        var panel = tabPanel(t.key);
        if (panel) panel.style.display = t.key === which ? 'block' : 'none';
      });

      ADMIN_TABS.forEach(function (t) {
        if (t.key !== which || !t.load) return;
        t.load.forEach(function (name) {
          if (typeof tabLoaders[name] === 'function') tabLoaders[name]();
        });
      });
    });
  });

  // ── Devotionals archive management ──────────────────────────────────────────
  function loadDevotionals() {
    if (!devotionalsList) return;
    devotionalsList.innerHTML = '<p class="writing-empty">Loading&#8230;</p>';
    fetch('/api/admin/devotionals')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.success) { devotionalsList.innerHTML = ''; return; }
        var items = data.devotionals || [];
        if (devotionalsClearAll) devotionalsClearAll.style.display = items.length ? '' : 'none';
        if (!items.length) {
          devotionalsList.innerHTML = '';
          if (devotionalsEmpty) devotionalsEmpty.style.display = 'block';
          return;
        }
        if (devotionalsEmpty) devotionalsEmpty.style.display = 'none';
        devotionalsList.innerHTML = items.map(function (d) {
          return '<div class="article-list-item" style="display:flex; align-items:flex-start; justify-content:space-between; gap:14px;">' +
              '<div style="min-width:0;">' +
                '<div style="font-weight:600; color:var(--text);">' + esc(d.date) +
                  (d.scripture ? ' <span style="color:var(--warm-brown); font-weight:400;">&middot; ' + esc(d.scripture) + '</span>' : '') +
                '</div>' +
                '<div style="font-size:0.85rem; color:var(--dark-cream); margin-top:4px; line-height:1.45;">' + esc(d.snippet) + '</div>' +
              '</div>' +
              '<button class="btn-discard devotional-del-btn" data-date="' + esc(d.date) + '" style="white-space:nowrap;">Delete</button>' +
            '</div>';
        }).join('');
        devotionalsList.querySelectorAll('.devotional-del-btn').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var date = btn.dataset.date;
            showConfirm('Delete the devotional for ' + date + '? This cannot be undone.', 'Delete', function () {
              fetch('/api/admin/devotionals/' + encodeURIComponent(date), { method: 'DELETE' })
                .then(function (r) { return r.json(); })
                .then(function (res) { if (res.success) loadDevotionals(); })
                .catch(function () {});
            });
          });
        });
      })
      .catch(function () { devotionalsList.innerHTML = ''; });
  }

  if (devotionalsClearAll) {
    devotionalsClearAll.addEventListener('click', function () {
      showConfirm('Delete ALL archived devotionals? This cannot be undone.', 'Clear all', function () {
        fetch('/api/admin/devotionals', { method: 'DELETE' })
          .then(function (r) { return r.json(); })
          .then(function (res) { if (res.success) loadDevotionals(); })
          .catch(function () {});
      });
    });
  }

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

  // ── Reset my tours (testing utility) ──────────────────────────────────────
  var resetMyToursBtn = document.getElementById('resetMyToursBtn');
  if (resetMyToursBtn) {
    resetMyToursBtn.addEventListener('click', async function () {
      resetMyToursBtn.disabled    = true;
      var original                = resetMyToursBtn.textContent;
      resetMyToursBtn.textContent = 'Resetting…';
      try {
        var r    = await fetch('/api/admin/reset-my-tours', { method: 'POST' });
        var data = await r.json();
        if (data.success) {
          showToast("Tours reset — they'll show again as you visit each page.");
        } else {
          showToast('Reset failed: ' + (data.error || 'Unknown error.'), true);
        }
      } catch (err) {
        showToast('Error: ' + err.message, true);
      }
      resetMyToursBtn.disabled    = false;
      resetMyToursBtn.textContent = original;
    });
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

  var DOCTRINE_LABELS = [
    ['scriptureAuthority',    'Scripture Authority'],
    ['totalDepravity',        'Total Depravity'],
    ['unconditionalElection', 'Uncond. Election'],
    ['particularAtonement',   'Part. Atonement'],
    ['irresistibleGrace',     'Irres. Grace'],
    ['perseverance',          'Perseverance'],
  ];

  function renderDoctrineAnswers(doctrines) {
    if (!doctrines) return '';
    var items = DOCTRINE_LABELS.map(function (pair) {
      var val   = doctrines[pair[0]] || '—';
      var color = val === 'Yes' ? '#4a9a60' : val === 'No' ? '#b03030' : '#a0845c';
      return (
        '<span style="font-size:0.78rem;color:var(--dark-cream);">' + pair[1] + ': </span>' +
        '<span style="font-size:0.78rem;font-weight:600;color:' + color + ';">' + esc(val) + '</span>'
      );
    });
    return (
      '<div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:6px 18px;padding:9px 12px;' +
        'background:rgba(179,140,51,0.06);border:1px solid rgba(179,140,51,0.18);border-radius:4px;">' +
        items.join('') +
      '</div>'
    );
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
        renderDoctrineAnswers(r.doctrines) +
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
          '<span style="font-family:\'Courier New\',monospace; font-size:0.95rem; color:var(--warm-brown);">' + esc(tokenShort) + '</span>' +
        '</div>' +
        '<div style="padding:6px 12px 10px; display:flex; justify-content:flex-end;">' +
          '<button class="btn-discard" data-delete-invite="' + esc(i.id) + '">Delete</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  // ── Admin room management ─────────────────────────────────────────────────
  async function loadAdminRooms() {
    if (!adminRoomsList) return;
    adminRoomsList.innerHTML = '<p class="writing-empty">Loading…</p>';
    try {
      var res  = await fetch('/api/admin/rooms');
      var data = await res.json();
      renderAdminRooms(data.rooms || []);
    } catch (err) {
      adminRoomsList.innerHTML = '<p class="writing-empty">Could not load rooms.</p>';
    }
  }

  function renderAdminRooms(rooms) {
    if (!rooms.length) {
      if (adminRoomsEmpty) adminRoomsEmpty.style.display = 'block';
      if (adminRoomsList)  adminRoomsList.innerHTML = '';
      return;
    }
    if (adminRoomsEmpty) adminRoomsEmpty.style.display = 'none';

    adminRoomsList.innerHTML = rooms.map(function (r) {
      return '<div class="article-card">' +
        '<div class="article-card-header">' +
          '<span class="article-card-title">' + esc(r.name) + '</span>' +
          '<span class="article-status-badge status-published">' + esc(r.visibility || 'open') + '</span>' +
        '</div>' +
        '<div class="article-card-meta">' +
          '<span style="font-family:\'Courier New\',monospace; font-size:0.85rem; color:var(--warm-brown);">' + esc(r.code) + '</span>' +
          '<span class="community-card-author">Host: ' + esc(r.hostName) + '</span>' +
          '<span class="article-card-date">' + r.memberCount + ' member' + (r.memberCount !== 1 ? 's' : '') + '</span>' +
          '<span class="article-card-date">Created ' + fmtDate(r.createdAt) + '</span>' +
        '</div>' +
        '<div style="display:flex; gap:10px; margin-top:12px;">' +
          '<button class="btn-reject admin-room-delete-btn" data-code="' + esc(r.code) + '" style="font-size:0.82rem; padding:6px 14px;">Delete Room</button>' +
        '</div>' +
      '</div>';
    }).join('');

    adminRoomsList.querySelectorAll('.admin-room-delete-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var code = btn.getAttribute('data-code');
        showConfirm('Delete room ' + code + '? All members will be redirected.', 'Delete', async function () {
          btn.disabled = true;
          btn.textContent = 'Deleting…';
          try {
            var res  = await fetch('/api/rooms/' + encodeURIComponent(code), { method: 'DELETE' });
            var data = await res.json();
            if (data.success) { showToast('Room closed.'); loadAdminRooms(); }
            else { showToast('Error: ' + (data.error || 'Delete failed.'), true); btn.disabled = false; btn.textContent = 'Delete Room'; }
          } catch (err) { showToast('Error: ' + err.message, true); btn.disabled = false; btn.textContent = 'Delete Room'; }
        });
      });
    });
  }

  // ── Member roster (read-only) ─────────────────────────────────────────────
  async function loadMembers() {
    if (!memberList) return;
    memberList.innerHTML = '<p class="writing-empty">Loading…</p>';
    try {
      var res  = await fetch('/api/admin/members');
      var data = await res.json();
      renderMembers(data.members || []);
    } catch (err) {
      memberList.innerHTML = '<p class="writing-empty">Could not load members.</p>';
    }
  }

  function renderMembers(members) {
    if (!members.length) {
      if (memberEmpty) memberEmpty.style.display = 'block';
      if (memberList)  memberList.innerHTML = '';
      return;
    }
    if (memberEmpty) memberEmpty.style.display = 'none';

    var meId = String(window.__currentUserId || '');

    memberList.innerHTML = members.map(function (m) {
      // Mirror the backend guardrail: no moderation control on the admin's own
      // row or on any other admin row.
      var isSelf      = String(m.id) === meId;
      var isAdminRow  = m.role === 'Admin';
      var canModerate = !isSelf && !isAdminRow;

      // High-contrast badge colors (white text on solid fill). Scoped to the
      // Members roster via inline styles so other tabs' badges are untouched.
      // Color meaning preserved: green=active, amber=pending, red=suspended.
      var badgeStyle;
      if (!m.isActive) {
        badgeStyle = 'background:#b03030; color:#fff; border:1px solid #8a2525;';        // red
      } else if (m.accountStatus === 'Active') {
        badgeStyle = 'background:#2f7d34; color:#fff; border:1px solid #246128;';        // green
      } else {
        badgeStyle = 'background:#9a6a1f; color:#fff; border:1px solid #7d551a;';        // amber
      }
      var badgeLabel  = m.isActive ? m.accountStatus : 'Suspended';
      var statusBadge = '<span class="article-status-badge" style="' + badgeStyle + '">' +
        esc(badgeLabel) + '</span>';

      // Suspend = solid red, Reinstate = solid green; both white text for legibility.
      var btnStyle = m.isActive
        ? 'background:#b03030; color:#fff; border:1px solid #8a2525;'
        : 'background:#2f7d34; color:#fff; border:1px solid #246128;';
      var actionRow = canModerate
        ? '<div style="display:flex; gap:10px; margin-top:12px;">' +
            '<button class="btn-primary member-moderate-btn" ' +
              'data-id="' + esc(m.id) + '" data-action="' + (m.isActive ? 'suspend' : 'reinstate') + '" ' +
              'style="font-size:0.82rem; padding:6px 14px; ' + btnStyle + '">' +
              (m.isActive ? 'Suspend' : 'Reinstate') +
            '</button>' +
          '</div>'
        : '';

      return '<div class="article-card">' +
        '<div class="article-card-header">' +
          '<span class="article-card-title">' + esc(m.fullName) + '</span>' +
          statusBadge +
        '</div>' +
        '<div class="article-card-meta">' +
          '<span class="community-card-author">' + esc(m.email) + '</span>' +
          '<span class="article-card-date">Role: ' + esc(m.role) + '</span>' +
          '<span class="article-word-count">Studies: ' + m.studiesCompleted +
            ' · Dialogues: ' + m.dialogueSessions +
            ' · Articles: ' + m.articlesWritten + '</span>' +
        '</div>' +
        actionRow +
      '</div>';
    }).join('');

    memberList.querySelectorAll('.member-moderate-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id     = btn.dataset.id;
        var action = btn.dataset.action;
        var verb   = action === 'suspend' ? 'Suspend' : 'Reinstate';
        showConfirm(verb + ' this member?', verb, async function () {
          btn.disabled = true;
          try {
            var res  = await fetch('/api/admin/members/' + encodeURIComponent(id) + '/' + action, { method: 'POST' });
            var data = await res.json();
            if (data.success) {
              showToast('Member ' + (action === 'suspend' ? 'suspended' : 'reinstated') + '.');
              loadMembers();
            } else {
              showToast(data.error || 'Action failed.', true);
              btn.disabled = false;
            }
          } catch (err) {
            showToast('Error: ' + err.message, true);
            btn.disabled = false;
          }
        });
      });
    });
  }

  // ── Feedback (read-only) ──────────────────────────────────────────────────
  async function loadFeedback() {
    if (!feedbackList) return;
    feedbackList.innerHTML = '<p class="writing-empty">Loading…</p>';
    try {
      var res  = await fetch('/api/admin/feedback');
      var data = await res.json();
      renderFeedback(data.feedback || []);
    } catch (err) {
      feedbackList.innerHTML = '<p class="writing-empty">Could not load feedback.</p>';
    }
  }

  function renderFeedback(items) {
    if (!items.length) {
      if (feedbackEmpty) feedbackEmpty.style.display = 'block';
      if (feedbackList)  feedbackList.innerHTML = '';
      return;
    }
    if (feedbackEmpty) feedbackEmpty.style.display = 'none';

    feedbackList.innerHTML = items.map(function (f) {
      return '<div class="article-card">' +
        '<div class="article-card-header">' +
          '<span class="article-card-title">' + esc(f.fullName || 'Unknown') + '</span>' +
        '</div>' +
        '<div class="article-card-meta">' +
          '<span class="article-card-date">' + fmtDateTime(f.submittedAt) + '</span>' +
        '</div>' +
        '<p style="font-size:0.9rem; color:var(--dark-cream); margin-top:10px; line-height:1.6; white-space:pre-wrap;">' +
          esc(f.text || '') +
        '</p>' +
      '</div>';
    }).join('');
  }

  function fmtDateTime(iso) {
    var d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
      ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  loadPending();
  loadPublished();
})();
