(function () {
  'use strict';

  var dm            = window.__dm || { threads: [], users: [], me: '' };
  var THREADS       = dm.threads;
  var ALL_USERS     = dm.users;
  var ME            = dm.me;
  var activeId      = null;   // currently open thread id

  // ── Utilities ────────────────────────────────────────────────────────────────

  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function nl2br(str) {
    return esc(str).replace(/\n/g, '<br>');
  }

  function fmtTime(iso) {
    if (!iso) return '';
    var d    = new Date(iso);
    var now  = new Date();
    var diff = now - d;
    if (diff < 60000)    return 'just now';
    if (diff < 3600000)  return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (diff < 604800000) {
      return d.toLocaleDateString([], { weekday: 'short' }) + ' ' +
             d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function userName(userId) {
    var u = ALL_USERS.find(function (x) { return x.id === userId; });
    return u ? u.fullName : 'Unknown';
  }

  // ── Thread list ───────────────────────────────────────────────────────────────

  function renderThreadList() {
    var list  = document.getElementById('dmThreadList');
    var empty = document.getElementById('dmEmpty');
    if (!list) return;

    if (!THREADS.length) {
      list.innerHTML = '';
      empty.style.display = '';
      return;
    }
    empty.style.display = 'none';

    list.innerHTML = THREADS.map(function (t) {
      var active  = t.id === activeId ? ' active' : '';
      var preview = t.lastText
        ? esc(t.lastText.length > 58 ? t.lastText.slice(0, 55) + '…' : t.lastText)
        : '<em style="opacity:.5">No messages yet</em>';
      var badge = t.unread > 0
        ? '<span class="dm-unread-badge">' + t.unread + '</span>'
        : '';
      return (
        '<div class="dm-thread-item' + active + '" data-tid="' + esc(t.id) + '">' +
          '<div class="dm-thread-name">' + esc(t.otherName) + badge + '</div>' +
          '<div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline;">' +
            '<div class="dm-thread-preview">' + preview + '</div>' +
            '<div class="dm-thread-time">' + fmtTime(t.lastAt) + '</div>' +
          '</div>' +
        '</div>'
      );
    }).join('');

    list.querySelectorAll('.dm-thread-item').forEach(function (el) {
      el.addEventListener('click', function () {
        loadThread(el.getAttribute('data-tid'));
      });
    });
  }

  // ── Load + render a thread ────────────────────────────────────────────────────

  function loadThread(tid) {
    activeId = tid;
    renderThreadList();
    var view = document.getElementById('dmView');
    if (!view) return;
    view.innerHTML = '<div class="dm-placeholder">Loading…</div>';
    history.replaceState(null, '', '/messages?t=' + tid);

    fetch('/api/messages/threads/' + tid)
      .then(function (r) {
        if (!r.ok) throw new Error(r.status);
        return r.json();
      })
      .then(function (data) { renderThread(data.thread); })
      .catch(function () {
        view.innerHTML = '<div class="dm-placeholder">Could not load conversation.</div>';
      });
  }

  function renderThread(thread) {
    var otherId   = thread.participants.find(function (p) { return p !== ME; });
    var otherName = esc(userName(otherId));

    var msgs = thread.messages.map(function (m) {
      var mine = m.senderId === ME;
      return (
        '<div class="dm-msg ' + (mine ? 'mine' : 'theirs') + '">' +
          '<div class="dm-sender">' +
            (mine ? 'You' : esc(m.senderName || otherName)) +
            ' &middot; <span class="dm-time">' + fmtTime(m.sentAt) + '</span>' +
          '</div>' +
          '<div class="dm-bubble">' + nl2br(m.text) + '</div>' +
        '</div>'
      );
    }).join('');

    var view = document.getElementById('dmView');
    view.innerHTML =
      '<div class="dm-view-header">' +
        '<div class="dm-view-name">' + otherName + '</div>' +
      '</div>' +
      '<div class="dm-msg-list" id="dmMsgList">' +
        (msgs || '<div style="padding:24px;color:var(--warm-brown);font-style:italic;text-align:center;">No messages yet. Say something!</div>') +
      '</div>' +
      '<div class="dm-send-area">' +
        '<textarea class="dm-send-input" id="dmSendInput" placeholder="Write a message…" rows="1" aria-label="Message"></textarea>' +
        '<button class="dm-send-btn" id="dmSendBtn">Send</button>' +
      '</div>';

    var msgList = document.getElementById('dmMsgList');
    msgList.scrollTop = msgList.scrollHeight;

    document.getElementById('dmSendBtn').addEventListener('click', function () {
      doSend({ threadId: thread.id });
    });
    document.getElementById('dmSendInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend({ threadId: thread.id }); }
    });
  }

  // ── Open a new (compose) view before first message is sent ───────────────────

  function openCompose(recipId, recipName) {
    closeModal();
    activeId = null;
    renderThreadList();
    history.replaceState(null, '', '/messages?r=' + recipId);

    var view = document.getElementById('dmView');
    view.innerHTML =
      '<div class="dm-view-header">' +
        '<div class="dm-view-name">' + esc(recipName) + '</div>' +
      '</div>' +
      '<div class="dm-msg-list" id="dmMsgList">' +
        '<div style="padding:24px;color:var(--warm-brown);font-style:italic;text-align:center;">' +
          'Start a conversation with ' + esc(recipName) + '.' +
        '</div>' +
      '</div>' +
      '<div class="dm-send-area">' +
        '<textarea class="dm-send-input" id="dmSendInput" placeholder="Write a message…" rows="1" aria-label="Message"></textarea>' +
        '<button class="dm-send-btn" id="dmSendBtn">Send</button>' +
      '</div>';

    document.getElementById('dmSendBtn').addEventListener('click', function () {
      doSend({ recipientId: recipId });
    });
    document.getElementById('dmSendInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend({ recipientId: recipId }); }
    });

    document.getElementById('dmSendInput').focus();
  }

  // ── Send a message ─────────────────────────────────────────────────────────────

  function doSend(params) {
    var input = document.getElementById('dmSendInput');
    var btn   = document.getElementById('dmSendBtn');
    if (!input) return;
    var text = input.value.trim();
    if (!text) return;

    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }

    var body = Object.assign({ text: text }, params);

    fetch('/api/messages/send', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.ok) {
          window.location.href = '/messages?t=' + data.threadId;
        } else {
          alert(data.error || 'Failed to send message.');
          if (btn) { btn.disabled = false; btn.textContent = 'Send'; }
        }
      })
      .catch(function () {
        alert('Failed to send message. Please try again.');
        if (btn) { btn.disabled = false; btn.textContent = 'Send'; }
      });
  }

  // ── New Message modal ──────────────────────────────────────────────────────────

  function openModal() {
    var overlay = document.getElementById('dmOverlay');
    var search  = document.getElementById('dmSearchInput');
    if (!overlay) return;
    overlay.style.display = 'flex';
    renderMemberList('');
    if (search) { search.value = ''; search.focus(); }
  }

  function closeModal() {
    var overlay = document.getElementById('dmOverlay');
    if (overlay) overlay.style.display = 'none';
  }

  function renderMemberList(query) {
    var list  = document.getElementById('dmMemberList');
    if (!list) return;
    var q     = query.toLowerCase().trim();
    var shown = ALL_USERS.filter(function (u) {
      return !q || u.fullName.toLowerCase().indexOf(q) !== -1;
    });

    if (!shown.length) {
      list.innerHTML = '<div style="padding:16px 20px;color:var(--warm-brown);font-style:italic;font-size:0.88rem;">No members found.</div>';
      return;
    }

    list.innerHTML = shown.map(function (u) {
      return '<div class="dm-member-item" data-uid="' + esc(u.id) + '" data-uname="' + esc(u.fullName) + '">' +
        esc(u.fullName) +
      '</div>';
    }).join('');

    list.querySelectorAll('.dm-member-item').forEach(function (el) {
      el.addEventListener('click', function () {
        var uid   = el.getAttribute('data-uid');
        var uname = el.getAttribute('data-uname');
        // if thread already exists, open it; otherwise open compose view
        var existing = THREADS.find(function (t) { return t.otherId === uid; });
        if (existing) {
          loadThread(existing.id);
          closeModal();
        } else {
          openCompose(uid, uname);
        }
      });
    });
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', function () {
    renderThreadList();

    // auto-open from URL params
    var params   = new URLSearchParams(window.location.search);
    var initTid  = params.get('t');
    var initRid  = params.get('r');

    if (initTid) {
      loadThread(initTid);
    } else if (initRid) {
      var user = ALL_USERS.find(function (u) { return u.id === initRid; });
      if (user) openCompose(user.id, user.fullName);
    }

    // New message button
    var newBtn = document.getElementById('dmNewBtn');
    if (newBtn) newBtn.addEventListener('click', openModal);

    // Modal close
    var closeBtn = document.getElementById('dmModalClose');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);

    var overlay = document.getElementById('dmOverlay');
    if (overlay) {
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) closeModal();
      });
    }

    // Live search inside modal
    var searchInput = document.getElementById('dmSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        renderMemberList(searchInput.value);
      });
    }

    // Esc key closes modal
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeModal();
    });
  });
})();
