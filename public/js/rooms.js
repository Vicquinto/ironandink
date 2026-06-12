(function () {
  'use strict';

  var startRoomBtn      = document.getElementById('startRoomBtn');
  var joinCodeInput     = null;
  var joinCodeBtn       = null;
  var createModal       = document.getElementById('roomsCreateModal');
  var createConfirm     = document.getElementById('roomsCreateConfirm');
  var createCancel      = document.getElementById('roomsCreateCancel');
  var roomNameInput     = document.getElementById('roomNameInput');
  var roomInviteEmail   = document.getElementById('roomInviteEmail');
  var roomVisibility    = document.getElementById('roomVisibility');
  var createError       = document.getElementById('roomsCreateError');
  var notifSection      = document.getElementById('roomsNotifications');
  var notifList         = document.getElementById('roomsNotifList');
  var roomsList         = document.getElementById('roomsList');
  var roomsEmpty        = document.getElementById('roomsEmpty');

  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Toast ──────────────────────────────────────────────────────────────────
  function showToast(msg, isError) {
    var toast = document.createElement('div');
    toast.className = 'toast-msg' + (isError ? ' toast-error' : '');
    toast.textContent = msg;
    document.body.appendChild(toast);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { toast.classList.add('visible'); });
    });
    setTimeout(function () {
      toast.classList.remove('visible');
      setTimeout(function () { toast.remove(); }, 350);
    }, 3000);
  }

  // ── Notifications ──────────────────────────────────────────────────────────
  function loadNotifications() {
    fetch('/api/rooms/notifications')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.success) return;
        var unread = (data.notifications || []).filter(function (n) {
          return n.type === 'room_invite' && !n.read;
        });
        if (!unread.length) return;

        notifList.innerHTML = '';
        unread.forEach(function (n) {
          var li = document.createElement('li');
          li.className = 'rooms-notif-item';
          li.dataset.id = n.id;
          li.innerHTML =
            '<span class="rooms-notif-msg">' +
              esc(n.from) + ' invited you to a live study: <strong>' + esc(n.roomName) + '</strong>' +
            '</span>' +
            '<div class="rooms-notif-actions">' +
              '<a class="btn-warm rooms-notif-join" href="/room/' + esc(n.roomCode) + '">Join Room</a>' +
              '<button class="rooms-dismiss-btn" data-id="' + esc(n.id) + '">Dismiss</button>' +
            '</div>';
          notifList.appendChild(li);
        });

        notifSection.style.display = 'block';

        notifList.addEventListener('click', function (e) {
          var btn = e.target.closest('.rooms-dismiss-btn');
          if (!btn) return;
          var id = btn.dataset.id;
          fetch('/api/rooms/notifications/read', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ id: id }),
          }).then(function () {
            var item = notifList.querySelector('[data-id="' + id + '"]');
            if (item) item.remove();
            if (!notifList.querySelector('.rooms-notif-item')) {
              notifSection.style.display = 'none';
            }
          });
        });
      })
      .catch(function () {});
  }

  // ── Room List ──────────────────────────────────────────────────────────────
  function loadRooms() {
    fetch('/api/rooms/list')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.success) return;
        var rooms = data.rooms || [];
        if (!rooms.length) {
          roomsEmpty.style.display = 'block';
          return;
        }
        roomsEmpty.style.display = 'none';
        var html = rooms.map(function (room) {
          var badge = room.visibility === 'private'
            ? '<span class="rooms-badge rooms-badge-private">Private</span>'
            : '<span class="rooms-badge rooms-badge-open">Open</span>';
          return '<div class="rooms-card" style="background:#f5ede0;border:1px solid #c4a882;border-radius:10px;padding:1.25rem 1.5rem;margin-bottom:1.25rem;max-width:420px;box-shadow:0 2px 6px rgba(0,0,0,0.08);">' +
            '<div style="display:block;font-size:1.15rem;font-weight:700;margin-bottom:4px;">' + esc(room.name) + '</div>' +
            '<div style="display:block;margin-bottom:4px;">' + badge + '</div>' +
            '<div style="display:block;font-size:0.85rem;color:var(--text-muted);margin-bottom:4px;">Host: ' + esc(room.hostName) + '</div>' +
            '<div style="display:block;font-size:0.85rem;color:var(--text-muted);margin-bottom:12px;">' + room.members.length + ' member' + (room.members.length !== 1 ? 's' : '') + '</div>' +
            '<a class="rooms-join-btn" href="/room/' + esc(room.code) + '" style="display:block;width:100%;padding:0.6rem;background:#5C1A28;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:0.95rem;margin-top:0.5rem;text-align:center;text-decoration:none;box-sizing:border-box;">Join Room</a>' +
          '</div>';
        }).join('');
        roomsList.insertAdjacentHTML('afterbegin', html);
      })
      .catch(function () {});
  }

  // ── Create Modal ───────────────────────────────────────────────────────────
  startRoomBtn.addEventListener('click', function () {
    createError.style.display = 'none';
    roomNameInput.value       = '';
    roomInviteEmail.value     = '';
    roomVisibility.value      = 'open';
    createModal.style.display = 'flex';
    roomNameInput.focus();
  });

  createCancel.addEventListener('click', function () {
    createModal.style.display = 'none';
  });

  createModal.addEventListener('mousedown', function (e) {
    if (e.target === createModal) createModal.style.display = 'none';
  });

  createConfirm.addEventListener('click', function () {
    var name        = roomNameInput.value.trim();
    var inviteEmail = roomInviteEmail.value.trim();
    var visibility  = roomVisibility.value;

    if (!name) {
      createError.textContent    = 'Please enter a room name.';
      createError.style.display  = 'block';
      roomNameInput.focus();
      return;
    }

    createConfirm.disabled = true;
    createError.style.display = 'none';

    fetch('/api/rooms/create', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name: name, visibility: visibility, inviteEmail: inviteEmail }),
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data.success) {
        window.location.href = '/room/' + data.code;
      } else {
        createError.textContent   = data.error || 'Failed to create room.';
        createError.style.display = 'block';
        createConfirm.disabled    = false;
      }
    })
    .catch(function (err) {
      showToast('Error: ' + err.message, true);
      createConfirm.disabled = false;
    });
  });

  // ── Style Start button ─────────────────────────────────────────────────────
  if (startRoomBtn) {
    startRoomBtn.style.cssText = 'display:block;background:#5C1A28;color:#fff;border:none;border-radius:8px;padding:0.75rem 1.75rem;font-size:1rem;cursor:pointer;margin-bottom:1.25rem;';
  }

  // ── Join with Code ─────────────────────────────────────────────────────────
  if (startRoomBtn) {
    startRoomBtn.insertAdjacentHTML('afterend',
      '<div style="display:flex;gap:0.75rem;align-items:center;margin-bottom:1.5rem;max-width:420px;">' +
        '<input type="text" id="joinCodeInput" placeholder="Enter room code" maxlength="6" autocomplete="off" style="flex:1;padding:0.6rem 0.75rem;border:1px solid #c4a882;border-radius:6px;font-size:0.95rem;">' +
        '<button id="joinCodeBtn" style="background:#5C1A28;color:#fff;border:none;border-radius:6px;padding:0.6rem 1.25rem;font-size:0.95rem;cursor:pointer;white-space:nowrap;">Join Room</button>' +
      '</div>'
    );
    joinCodeInput = document.getElementById('joinCodeInput');
    joinCodeBtn   = document.getElementById('joinCodeBtn');
  }

  if (joinCodeBtn) {
    joinCodeBtn.addEventListener('click', function () {
      var code = joinCodeInput.value.trim().toUpperCase();
      if (!code) {
        showToast('Please enter a room code.', true);
        joinCodeInput.focus();
        return;
      }
      window.location.href = '/room/' + code;
    });
  }

  if (joinCodeInput) {
    joinCodeInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        var code = joinCodeInput.value.trim().toUpperCase();
        if (!code) {
          showToast('Please enter a room code.', true);
          return;
        }
        window.location.href = '/room/' + code;
      }
    });
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  loadNotifications();
  loadRooms();

}());
