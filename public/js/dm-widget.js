(function () {
  'use strict';

  var ME             = '';
  var isOpen         = false;
  var activeThreadId = null;
  var widgetThreads  = [];
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

  // ── Load thread list + auto-open most recent ──────────────────────────────

  function fetchAndRender() {
    setBody('<div class="dm-widget-empty">Loading…</div>');

    fetch('/api/messages/widget')
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (data) {
        widgetThreads = data.threads || [];
        ME = data.me || ME;
        if (widgetThreads.length > 0) {
          renderListInBackground();
          openWidgetThread(widgetThreads[0].id);
        } else {
          renderThreadList();
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

  // ── Thread list view ──────────────────────────────────────────────────────

  function renderListInBackground() {
    widgetThreads.sort(function (a, b) { return new Date(b.lastAt) - new Date(a.lastAt); });
  }

  function renderThreadList() {
    activeThreadId = null;
    window.__dmActiveThread = null;

    if (widgetThreads.length === 0) {
      setBody('<div class="dm-widget-empty">No conversations yet.<br>Press <strong>+ New</strong> on the Messages page to start one.</div>');
      return;
    }

    var rows = widgetThreads.map(function (t) {
      var active  = t.id === activeThreadId ? ' active' : '';
      var preview = t.lastText
        ? esc(t.lastText.length > 42 ? t.lastText.slice(0, 39) + '…' : t.lastText)
        : '<em style="opacity:.6">No messages yet</em>';
      var badge = t.unread > 0
        ? '<span class="dm-widget-unread">' + t.unread + '</span>'
        : '';
      return [
        '<div class="dm-widget-thread-item' + active + '" data-tid="' + esc(t.id) + '">',
          '<div class="dm-widget-thread-name">' + esc(t.otherName) + badge + '</div>',
          '<div class="dm-widget-thread-preview">' + preview + '</div>',
        '</div>',
      ].join('');
    }).join('');

    setBody('<div class="dm-widget-thread-list" id="dmWidgetThreadList">' + rows + '</div>');

    document.querySelectorAll('.dm-widget-thread-item').forEach(function (el) {
      el.addEventListener('click', function () {
        openWidgetThread(el.getAttribute('data-tid'));
      });
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

    document.getElementById('dmWidgetBack').addEventListener('click', function () {
      renderThreadList();
    });

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

  // ── Send ──────────────────────────────────────────────────────────────────

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

  // ── Socket — single listener for real-time delivery ───────────────────────

  function initSocket() {
    var socket = window.__socket;
    if (!socket) return;

    socket.on('dm:new-message', function (payload) {
      if (!isOpen) return;

      var tid = payload.threadId;
      var msg = payload.message;

      // Update in-memory thread list
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
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', function () {
    ME = window.__currentUserId || '';
    initSocket();
  });

  window.__dmWidget = { toggle: toggleWidget, open: openWidget, close: closeWidget };
})();
