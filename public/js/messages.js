(function () {
  'use strict';

  var dm        = window.__dm || { threads: [], users: [], me: '' };
  var THREADS   = dm.threads;   // mutable list kept in sync
  var ALL_USERS = dm.users;
  var ME        = dm.me;
  var activeId  = null;         // thread id currently open in the right panel

  // ── Utilities ─────────────────────────────────────────────────────────────

  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function nl2br(str) { return esc(str).replace(/\n/g, '<br>'); }

  function fmtTime(iso) {
    if (!iso) return '';
    var d    = new Date(iso);
    var now  = new Date();
    var diff = now - d;
    if (diff < 60000)     return 'just now';
    if (diff < 3600000)   return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000)  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (diff < 604800000) return d.toLocaleDateString([], { weekday: 'short' }) + ' ' +
                                 d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function getUserName(userId) {
    var u = ALL_USERS.find(function (x) { return x.id === userId; });
    return u ? u.fullName : 'Unknown';
  }

  // ── Refresh global unread badge via server count ──────────────────────────

  function fetchUnreadCount() {
    fetch('/api/messages/unread-count')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (typeof d.count === 'number') {
          window.dispatchEvent(new CustomEvent('dm:unread-update', { detail: { count: d.count } }));
        }
      })
      .catch(function () {});
  }

  // ── Thread list ───────────────────────────────────────────────────────────

  function renderThreadList() {
    var list  = document.getElementById('dmThreadList');
    var empty = document.getElementById('dmEmpty');
    if (!list) return;

    if (!THREADS.length) {
      list.innerHTML = '';
      if (empty) empty.style.display = '';
      return;
    }
    if (empty) empty.style.display = 'none';

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
      el.addEventListener('click', function () { loadThread(el.getAttribute('data-tid')); });
    });
  }

  // ── Append a single message bubble to the open thread ────────────────────

  function appendMessage(msg) {
    var msgList = document.getElementById('dmMsgList');
    if (!msgList) return;
    var mine = msg.senderId === ME;
    var div  = document.createElement('div');
    div.className = 'dm-msg ' + (mine ? 'mine' : 'theirs');
    div.innerHTML =
      '<div class="dm-sender">' +
        (mine ? 'You' : esc(msg.senderName || getUserName(msg.senderId))) +
        ' &middot; <span class="dm-time">' + fmtTime(msg.sentAt) + '</span>' +
      '</div>' +
      '<div class="dm-bubble">' + nl2br(msg.text) + '</div>';
    msgList.appendChild(div);
    msgList.scrollTop = msgList.scrollHeight;
  }

  // ── Attach send-form handlers ─────────────────────────────────────────────

  function attachSendHandlers(params) {
    var btn   = document.getElementById('dmSendBtn');
    var input = document.getElementById('dmSendInput');
    if (!btn || !input) return;
    btn.addEventListener('click', function () { doSend(params); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(params); }
    });
  }

  // ── Load + render a thread via API ────────────────────────────────────────

  function loadThread(tid) {
    activeId = tid;
    window.__dmActiveThread = tid;   // tells dm-badge.js which thread is open
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
      .then(function (data) {
        renderThread(data.thread);
        fetchUnreadCount();   // messages marked as read server-side; refresh badge
      })
      .catch(function () {
        view.innerHTML = '<div class="dm-placeholder">Could not load conversation.</div>';
      });
  }

  function renderThread(thread) {
    var otherId   = thread.participants.find(function (p) { return p !== ME; });
    var otherName = esc(getUserName(otherId));

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
      '<div class="dm-view-header"><div class="dm-view-name">' + otherName + '</div></div>' +
      '<div class="dm-msg-list" id="dmMsgList">' +
        (msgs || '<div style="padding:24px;color:var(--warm-brown);font-style:italic;text-align:center;">No messages yet. Say something!</div>') +
      '</div>' +
      '<div class="dm-send-area">' +
        '<textarea class="dm-send-input" id="dmSendInput" placeholder="Write a message…" rows="1" aria-label="Message"></textarea>' +
        '<button class="dm-send-btn" id="dmSendBtn">Send</button>' +
      '</div>';

    var msgList = document.getElementById('dmMsgList');
    msgList.scrollTop = msgList.scrollHeight;

    attachSendHandlers({ threadId: thread.id });
  }

  // ── Open a compose view (new conversation, no thread yet) ─────────────────

  function openCompose(recipId, recipName) {
    closeModal();
    activeId = null;
    window.__dmActiveThread = null;
    renderThreadList();
    history.replaceState(null, '', '/messages?r=' + recipId);

    var view = document.getElementById('dmView');
    view.innerHTML =
      '<div class="dm-view-header"><div class="dm-view-name">' + esc(recipName) + '</div></div>' +
      '<div class="dm-msg-list" id="dmMsgList">' +
        '<div style="padding:24px;color:var(--warm-brown);font-style:italic;text-align:center;">' +
          'Start a conversation with ' + esc(recipName) + '.' +
        '</div>' +
      '</div>' +
      '<div class="dm-send-area">' +
        '<textarea class="dm-send-input" id="dmSendInput" placeholder="Write a message…" rows="1" aria-label="Message"></textarea>' +
        '<button class="dm-send-btn" id="dmSendBtn">Send</button>' +
      '</div>';

    attachSendHandlers({ recipientId: recipId });
    var input = document.getElementById('dmSendInput');
    if (input) input.focus();
  }

  // ── Send a message ────────────────────────────────────────────────────────

  function doSend(params) {
    var input = document.getElementById('dmSendInput');
    var btn   = document.getElementById('dmSendBtn');
    if (!input) return;
    var text = input.value.trim();
    if (!text) return;

    input.value = '';
    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }

    var body = Object.assign({ text: text }, params);

    fetch('/api/messages/send', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.ok) {
          input.value = text;
          alert(data.error || 'Failed to send message.');
          if (btn) { btn.disabled = false; btn.textContent = 'Send'; }
          return;
        }

        var tid = data.threadId;
        var now = new Date().toISOString();

        var existing = THREADS.find(function (t) { return t.id === tid; });
        if (existing) {
          existing.lastText = text;
          existing.lastAt   = now;
          THREADS = [existing].concat(THREADS.filter(function (t) { return t.id !== tid; }));
        } else {
          var recipId   = params.recipientId || '';
          var recipUser = ALL_USERS.find(function (u) { return u.id === recipId; }) || {};
          THREADS.unshift({
            id:        tid,
            otherId:   recipId,
            otherName: recipUser.fullName || 'Unknown',
            lastText:  text,
            lastAt:    now,
            unread:    0,
          });
        }

        if (activeId !== tid) {
          activeId = tid;
          history.replaceState(null, '', '/messages?t=' + tid);
          renderThreadList();
          loadThread(tid);
        } else {
          renderThreadList();
          appendMessage({
            id:         data.messageId,
            senderId:   ME,
            senderName: 'You',
            text:       text,
            sentAt:     now,
          });
          if (btn) { btn.disabled = false; btn.textContent = 'Send'; }
        }
      })
      .catch(function () {
        input.value = text;
        alert('Failed to send message. Please try again.');
        if (btn) { btn.disabled = false; btn.textContent = 'Send'; }
      });
  }

  // ── New Message modal ────────────────────────────────────────────────────

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
    var list = document.getElementById('dmMemberList');
    if (!list) return;
    var q    = query.toLowerCase().trim();
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
        var existing = THREADS.find(function (t) { return t.otherId === uid; });
        if (existing) {
          closeModal();
          loadThread(existing.id);
        } else {
          openCompose(uid, uname);
        }
      });
    });
  }

  // ── Socket.io — reuse the connection dm-badge.js already created ──────────

  function initSocket() {
    var socket = window.__socket;
    if (!socket) return;

    socket.on('dm:new-message', function (payload) {
      var tid = payload.threadId;
      var msg = payload.message;

      if (tid === activeId) {
        // Thread is open — append immediately and correct badge from server
        appendMessage(msg);
        fetchUnreadCount();
      }

      // Update in-memory thread list regardless
      var existing = THREADS.find(function (t) { return t.id === tid; });
      if (existing) {
        existing.lastText = msg.text;
        existing.lastAt   = msg.sentAt;
        if (tid !== activeId) existing.unread = (existing.unread || 0) + 1;
        THREADS = [existing].concat(THREADS.filter(function (t) { return t.id !== tid; }));
      } else {
        THREADS.unshift({
          id:        tid,
          otherId:   msg.senderId,
          otherName: payload.senderName || getUserName(msg.senderId),
          lastText:  msg.text,
          lastAt:    msg.sentAt,
          unread:    tid !== activeId ? 1 : 0,
        });
      }

      renderThreadList();
    });
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', function () {
    renderThreadList();

    var params  = new URLSearchParams(window.location.search);
    var initTid = params.get('t');
    var initRid = params.get('r');

    if (initTid) {
      loadThread(initTid);
    } else if (initRid) {
      var user = ALL_USERS.find(function (u) { return u.id === initRid; });
      if (user) openCompose(user.id, user.fullName);
    }

    var newBtn = document.getElementById('dmNewBtn');
    if (newBtn) newBtn.addEventListener('click', openModal);

    var closeBtn = document.getElementById('dmModalClose');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);

    var overlay = document.getElementById('dmOverlay');
    if (overlay) overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeModal();
    });

    var searchInput = document.getElementById('dmSearchInput');
    if (searchInput) searchInput.addEventListener('input', function () {
      renderMemberList(searchInput.value);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeModal();
    });

    initSocket();
  });
})();
