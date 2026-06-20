(function () {
  'use strict';

  var badge        = null;
  var unreadCount  = 0;

  // ── Badge display ─────────────────────────────────────────────────────────

  function renderBadge() {
    if (!badge) return;
    if (unreadCount > 0) {
      badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
      badge.style.display = '';
    } else {
      badge.textContent = '';
      badge.style.display = 'none';
    }
  }

  function setBadge(n) {
    unreadCount = Math.max(0, n);
    renderBadge();
  }

  function incrementBadge() {
    setBadge(unreadCount + 1);
  }

  // ── Custom event: another script (messages.js) signals fresh count ────────

  window.addEventListener('dm:unread-update', function (e) {
    if (e.detail && typeof e.detail.count === 'number') setBadge(e.detail.count);
  });

  // ── Socket.io ─────────────────────────────────────────────────────────────

  function initSocket() {
    if (typeof io === 'undefined') return;

    var socket = io({ transports: ['websocket', 'polling'] });
    window.__socket = socket;  // share with page-specific scripts (messages.js)

    socket.on('connect', function () {
      var userId = window.__currentUserId;
      if (userId) socket.emit('dm-register', userId);
    });

    socket.on('dm:new-message', function (payload) {
      // If messages.js has this thread open it handles the read + badge correction.
      // Skip incrementing here so we don't double-count.
      if (window.__dmActiveThread === payload.threadId) return;
      incrementBadge();
    });
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', function () {
    badge = document.getElementById('dmBadge');
    unreadCount = window.__dmUnread || 0;
    renderBadge();
    initSocket();
  });
})();
