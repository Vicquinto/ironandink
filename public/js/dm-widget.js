(function () {
  'use strict';

  var ME             = '';
  var isOpen         = false;
  var activeThreadId = null;
  var widgetThreads  = [];   // threads the current user is part of
  var WIDGET_ONLINE  = [];   // full presence list from server
  var widgetEl       = null;

  // ── Utilities ─────────────────────────────────────────────────────────────

  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escNl(str) {
    return esc(str).replace(/\n/g, '<br>');
  }

  function fmtTime(iso) {
    if (!iso) return '';
    var d    = new Date(iso);
    var now  = new Date();
    var diff = now - d;
    if (diff < 60000)     return 'just now';
    if (diff < 3600000)   return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000)  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function statusLabel(s) {
    if (s === 'away') return 'Away';
    if (s === 'dnd')  return 'DND';
    return 'Available';
  }

  // ── Widget DOM (created once, reused) ─────────────────────────────────────

  function createWidget() {
    var el = document.createElement('div');
    el.id = 'dmWidget';
    el.className = 'dm-widget';
    el.style.display = 'none';
    el.setAttribute('aria-label', 'Messages');
    el.innerHTML = [
      '<div class="dm-widget-header">',
        '<span class="dm-widget-title">Messages</span>',
        '<kbd class="dm-widget-hint">Ctrl+Alt+M</kbd>',
        '<button class="dm-widget-close" id="dmWidgetClose" aria-label="Close">×</button>',
      '</div>',
      '<div class="dm-widget-body" id="dmWidgetBody">',
        '<div class="dm-widget-empty">Loading…</div>',
      '</div>',
    ].join('');
    document.body.appendChild(el);
    document.getElementById('dmWidgetClose').addEventListener('click', closeWidget);
    return el;
  }

  // ── Open / close / toggle ─────────────────────────────────────────────────

  function toggleWidget() {
    if (isOpen) { closeWidget(); } else { openWidget(); }
  }

  function openWidget() {
    if (!widgetEl) widgetEl = createWidget();
    widgetEl.style.display = 'flex';
    isOpen = true;
    fetchAndRender();
  }

  function closeWidget() {
    if (widgetEl) widgetEl.style.display = 'none';
    isOpen = false;
    activeThreadId = null;
    window.__dmActiveThread = null;
  }

  // ── Fetch data + auto-open most recent thread ─────────────────────────────

  function fetchAndRender() {
    setBody('<div class="dm-widget-empty">Loading…</div>');

    fetch('/api/messages/widget')
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (data) {
        widgetThreads = data.threads || [];
        WIDGET_ONLINE = data.online  || [];
        ME = data.me || ME;
        if (widgetThreads.length > 0) {
          openWidgetThread(widgetThreads[0].id);
        } else {
          renderHomeScreen();
        }
      })
      .catch(function () {
        setBody('<div class="dm-widget-empty">Could not load messages.</div>');
      });
  }

  function setBody(html) {
    var body = document.getElementById('dmWidgetBody');
    if (body) body.innerHTML = html;
  }

  // ── Home screen: online members first, offline threads below ──────────────

  function renderHomeScreen() {
    activeThreadId = null;
    window.__dmActiveThread = null;

    // Online members excluding self
    var onlineOthers = WIDGET_ONLINE.filter(function (u) { return u.userId !== ME; });

    // Index of online userIds for deduplication
    var onlineIdSet = {};
    onlineOthers.forEach(function (u) { onlineIdSet[u.userId] = true; });

    // Offline threads: other person is not currently online
    var offlineThreads = widgetThreads.filter(function (t) { return !onlineIdSet[t.otherId]; });

    if (onlineOthers.length === 0 && offlineThreads.length === 0) {
      setBody([
        '<div class="dm-widget-empty">',
          'No one online and no past conversations.<br>',
          'Use the <strong>Messages</strong> page to start one.',
        '</div>',
      ].join(''));
      return;
    }

    var html = '';

    // ── Online members ──────────────────────────────────────────────────────
    if (onlineOthers.length > 0) {
      html += '<div class="dm-widget-section-label">Online</div>';
      html += onlineOthers.map(function (u) {
        var existingThread = widgetThreads.find(function (t) { return t.otherId === u.userId; });
        var badge = (existingThread && existingThread.unread > 0)
          ? '<span class="dm-widget-unread">' + existingThread.unread + '</span>'
          : '';
        var tid   = existingThread ? esc(existingThread.id) : '';
        return [
          '<div class="dm-widget-home-item"',
            ' data-uid="' + esc(u.userId) + '"',
            ' data-uname="' + esc(u.fullName) + '"',
            (tid ? ' data-tid="' + tid + '"' : ''),
          '>',
            '<span class="dm-online-dot dm-dot-' + u.status + '"></span>',
            '<span class="dm-widget-home-name">' + esc(u.fullName) + '</span>',
            '<span class="dm-widget-home-status">' + statusLabel(u.status) + '</span>',
            badge,
          '</div>',
        ].join('');
      }).join('');
    }

    // ── Offline threads ─────────────────────────────────────────────────────
    if (offlineThreads.length > 0) {
      if (onlineOthers.length > 0) {
        html += '<div class="dm-widget-section-divider"></div>';
      }
      html += offlineThreads.map(function (t) {
        var preview = t.lastText
          ? esc(t.lastText.length > 38 ? t.lastText.slice(0, 35) + '…' : t.lastText)
          : '<em style="opacity:.55">No messages yet</em>';
        var badge = t.unread > 0
          ? '<span class="dm-widget-unread">' + t.unread + '</span>'
          : '';
        return [
          '<div class="dm-widget-home-item dm-widget-home-thread" data-tid="' + esc(t.id) + '">',
            '<span class="dm-online-dot dm-dot-offline"></span>',
            '<div class="dm-widget-home-thread-info">',
              '<div class="dm-widget-home-thread-name">' + esc(t.otherName) + badge + '</div>',
              '<div class="dm-widget-thread-preview">' + preview + '</div>',
            '</div>',
          '</div>',
        ].join('');
      }).join('');
    }

    setBody('<div class="dm-widget-home-list">' + html + '</div>');

    // Wire click handlers
    document.querySelectorAll('.dm-widget-home-item').forEach(function (el) {
      el.addEventListener('click', function () {
        var tid   = el.getAttribute('data-tid');
        var uid   = el.getAttribute('data-uid');
        var uname = el.getAttribute('data-uname');
        if (tid) {
          openWidgetThread(tid);
        } else if (uid) {
          openWidgetCompose(uid, uname || 'Unknown');
        }
      });
    });
  }

  // ── Compose view (first message to someone with no existing thread) ────────

  function openWidgetCompose(uid, uname) {
    activeThreadId = null;
    window.__dmActiveThread = null;

    var body = document.getElementById('dmWidgetBody');
    if (!body) return;

    body.innerHTML = [
      '<div class="dm-widget-chat-header">',
        '<button class="dm-widget-back-btn" id="dmWidgetBack" aria-label="Back">&#8592;</button>',
        '<span class="dm-widget-chat-name">' + esc(uname) + '</span>',
      '</div>',
      '<div class="dm-widget-msg-list" id="dmWidgetMsgList">',
        '<div class="dm-widget-empty" style="flex:1;min-height:0;">',
          'Start a conversation with ' + esc(uname) + '.',
        '</div>',
      '</div>',
      '<div class="dm-widget-send-area">',
        '<textarea class="dm-widget-send-input" id="dmWidgetInput" placeholder="Write a message…" rows="1" aria-label="Message"></textarea>',
        '<button class="dm-widget-send-btn" id="dmWidgetSend">Send</button>',
      '</div>',
    ].join('');

    document.getElementById('dmWidgetBack').addEventListener('click', renderHomeScreen);

    var input   = document.getElementById('dmWidgetInput');
    var sendBtn = document.getElementById('dmWidgetSend');
    if (input) input.focus();
    sendBtn.addEventListener('click', function () { widgetSendNew(uid, uname); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); widgetSendNew(uid, uname); }
    });
  }

  function widgetSendNew(recipientId, recipientName) {
    var input = document.getElementById('dmWidgetInput');
    var btn   = document.getElementById('dmWidgetSend');
    if (!input) return;
    var text = input.value.trim();
    if (!text) return;

    input.value = '';
    if (btn) { btn.disabled = true; btn.textContent = '…'; }

    fetch('/api/messages/send', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ recipientId: recipientId, text: text }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.ok) {
          if (btn) { btn.disabled = false; btn.textContent = 'Send'; }
          input.value = text;
          return;
        }
        var now = new Date().toISOString();
        widgetThreads.unshift({
          id:        data.threadId,
          otherId:   recipientId,
          otherName: recipientName,
          lastText:  text,
          lastAt:    now,
          unread:    0,
        });
        openWidgetThread(data.threadId);
      })
      .catch(function () {
        if (btn) { btn.disabled = false; btn.textContent = 'Send'; }
        input.value = text;
      });
  }

  // ── Chat view ─────────────────────────────────────────────────────────────

  function openWidgetThread(tid) {
    activeThreadId = tid;
    window.__dmActiveThread = tid;

    setBody('<div class="dm-widget-empty">Loading…</div>');

    fetch('/api/messages/threads/' + tid)
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (data) {
        renderWidgetChat(data.thread);
        refreshBadge();
        var t = widgetThreads.find(function (x) { return x.id === tid; });
        if (t) t.unread = 0;
      })
      .catch(function () {
        setBody('<div class="dm-widget-empty">Could not load conversation.</div>');
      });
  }

  function renderWidgetChat(thread) {
    var t         = widgetThreads.find(function (x) { return x.id === thread.id; });
    var otherName = t ? esc(t.otherName) : 'Unknown';

    var msgsHtml = thread.messages.map(function (m) {
      var mine = m.senderId === ME;
      return [
        '<div class="dm-widget-msg ' + (mine ? 'mine' : 'theirs') + '">',
          '<div class="dm-widget-bubble">' + escNl(m.text) + '</div>',
          '<div class="dm-widget-msg-time">' + fmtTime(m.sentAt) + '</div>',
        '</div>',
      ].join('');
    }).join('');

    var body = document.getElementById('dmWidgetBody');
    if (!body) return;

    body.innerHTML = [
      '<div class="dm-widget-chat-header">',
        '<button class="dm-widget-back-btn" id="dmWidgetBack" aria-label="Back">&#8592;</button>',
        '<span class="dm-widget-chat-name">' + otherName + '</span>',
      '</div>',
      '<div class="dm-widget-msg-list" id="dmWidgetMsgList">',
        msgsHtml || '<div class="dm-widget-empty" style="flex:1;min-height:0;">No messages yet. Say something!</div>',
      '</div>',
      '<div class="dm-widget-send-area">',
        '<textarea class="dm-widget-send-input" id="dmWidgetInput" placeholder="Write a message…" rows="1" aria-label="Message"></textarea>',
        '<button class="dm-widget-send-btn" id="dmWidgetSend">Send</button>',
      '</div>',
    ].join('');

    var msgList = document.getElementById('dmWidgetMsgList');
    if (msgList) msgList.scrollTop = msgList.scrollHeight;

    document.getElementById('dmWidgetBack').addEventListener('click', renderHomeScreen);

    var sendBtn = document.getElementById('dmWidgetSend');
    var input   = document.getElementById('dmWidgetInput');
    sendBtn.addEventListener('click', function () { widgetSend(thread.id); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); widgetSend(thread.id); }
    });
  }

  function appendWidgetMessage(msg) {
    var list = document.getElementById('dmWidgetMsgList');
    if (!list) return;
    var mine = msg.senderId === ME;
    var div  = document.createElement('div');
    div.className = 'dm-widget-msg ' + (mine ? 'mine' : 'theirs');
    div.innerHTML =
      '<div class="dm-widget-bubble">' + escNl(msg.text) + '</div>' +
      '<div class="dm-widget-msg-time">' + fmtTime(msg.sentAt) + '</div>';
    list.appendChild(div);
    list.scrollTop = list.scrollHeight;
  }

  // ── Send (existing thread) ────────────────────────────────────────────────

  function widgetSend(threadId) {
    var input = document.getElementById('dmWidgetInput');
    var btn   = document.getElementById('dmWidgetSend');
    if (!input) return;
    var text = input.value.trim();
    if (!text) return;

    input.value = '';
    if (btn) { btn.disabled = true; btn.textContent = '…'; }

    fetch('/api/messages/send', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ threadId: threadId, text: text }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (btn) { btn.disabled = false; btn.textContent = 'Send'; }
        if (!data.ok) { input.value = text; return; }
        var now = new Date().toISOString();
        appendWidgetMessage({ id: data.messageId, senderId: ME, text: text, sentAt: now });
        var t = widgetThreads.find(function (x) { return x.id === threadId; });
        if (t) { t.lastText = text; t.lastAt = now; }
      })
      .catch(function () {
        if (btn) { btn.disabled = false; btn.textContent = 'Send'; }
        input.value = text;
      });
  }

  // ── Badge refresh ─────────────────────────────────────────────────────────

  function refreshBadge() {
    fetch('/api/messages/unread-count')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (typeof d.count === 'number') {
          window.dispatchEvent(new CustomEvent('dm:unread-update', { detail: { count: d.count } }));
        }
      })
      .catch(function () {});
  }

  // ── Socket: real-time delivery + presence updates ─────────────────────────

  function initSocket() {
    var socket = window.__socket;
    if (!socket) return;

    socket.on('dm:new-message', function (payload) {
      if (!isOpen) return;
      var tid = payload.threadId;
      var msg = payload.message;

      var t = widgetThreads.find(function (x) { return x.id === tid; });
      if (t) {
        t.lastText = msg.text;
        t.lastAt   = msg.sentAt;
        if (tid !== activeThreadId) t.unread = (t.unread || 0) + 1;
        widgetThreads = [t].concat(widgetThreads.filter(function (x) { return x.id !== tid; }));
      } else {
        widgetThreads.unshift({
          id:        tid,
          otherId:   msg.senderId,
          otherName: payload.senderName || 'Unknown',
          lastText:  msg.text,
          lastAt:    msg.sentAt,
          unread:    tid !== activeThreadId ? 1 : 0,
        });
      }

      if (tid === activeThreadId) {
        appendWidgetMessage(msg);
      }
    });

    socket.on('presence:update', function (payload) {
      WIDGET_ONLINE = payload.online || [];
      if (!activeThreadId) {
        renderHomeScreen();
      }
    });
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', function () {
    ME = window.__currentUserId || '';
    initSocket();
  });

  window.__dmWidget = { toggle: toggleWidget, open: openWidget, close: closeWidget };
})();
