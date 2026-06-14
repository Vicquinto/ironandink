(function () {
  'use strict';

  var currentStudy      = null;
  var currentAbortCtrl  = null;
  var roomCode          = window.ROOM_CODE;
  var isHost            = !!(window.CURRENT_USER && window.CURRENT_USER.email === window.ROOM_HOST);

  console.log('isHost: ' + isHost);

  var generateBtn       = document.getElementById('roomGenerateBtn');
  var topicInput        = document.getElementById('roomTopicInput');
  var roomLoading       = document.getElementById('roomLoading');
  var guideArea         = document.getElementById('roomGuideArea');
  var guideTitle        = document.getElementById('roomGuideTitle');
  var guideBadge        = document.getElementById('roomGuideBadge');
  var guideBody         = document.getElementById('roomGuideBody');
  var saveBtn           = document.getElementById('roomSaveBtn');
  var membersLabel      = document.getElementById('roomMembersLabel');
  var chatInput         = document.getElementById('roomChatInput');
  var chatBtn           = document.getElementById('roomChatBtn');
  var chatMessages      = document.getElementById('roomChatMessages');
  var fontDecBtn        = document.getElementById('roomFontDecBtn');
  var fontResetBtn      = document.getElementById('roomFontResetBtn');
  var fontIncBtn        = document.getElementById('roomFontIncBtn');

  // ── Font size control ─────────────────────────────────────────────────────
  var FONT_DEFAULT  = 16;
  var FONT_MIN      = 12;
  var FONT_MAX      = 28;
  var FONT_STEP     = 2;
  var roomFontSize  = parseInt(localStorage.getItem('ironink_room_font_size'), 10) || FONT_DEFAULT;

  function applyRoomFontSize(size) {
    roomFontSize = Math.min(FONT_MAX, Math.max(FONT_MIN, size));
    if (guideBody) guideBody.style.fontSize = roomFontSize + 'px';
    localStorage.setItem('ironink_room_font_size', roomFontSize);
  }

  applyRoomFontSize(roomFontSize);

  if (fontDecBtn) {
    fontDecBtn.addEventListener('click',   function () { applyRoomFontSize(roomFontSize - FONT_STEP); });
    fontResetBtn.addEventListener('click', function () { applyRoomFontSize(FONT_DEFAULT); });
    fontIncBtn.addEventListener('click',   function () { applyRoomFontSize(roomFontSize + FONT_STEP); });
  }

  // ── Socket.io ──────────────────────────────────────────────────────────────
  var socket = io();
  window.roomSocket = socket;
  window.isHost     = isHost;
  socket.emit('join-room', roomCode);

  socket.on('room-study-result', function (data) {
    displayStudy(data);
  });

  socket.on('room-closed', function () {
    showToast('The host has ended this study. Redirecting…');
    setTimeout(function () { window.location.href = '/rooms'; }, 1800);
  });


  socket.on('room-chat-message', function (data) {
    appendChatMessage(data.senderName, data.message);
  });

  socket.on('room-tooltip-broadcast', function (data) {
    if (!chatMessages) return;
    var div = document.createElement('div');
    div.style.cssText = 'background:#f0e6c8;border-left:4px solid #5C1A28;border-radius:4px;padding:0.5rem 0.75rem;margin:0.25rem 0;font-size:0.875rem;';
    div.innerHTML =
      '<div style="font-weight:700;color:#5C1A28;margin-bottom:0.25rem;">' +
        escHtml(data.type) + ': ' + escHtml(data.term) +
      '</div>' +
      '<div>' + renderMarkdown(data.response) + '</div>';
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  });

  // ── Member count ───────────────────────────────────────────────────────────
  function loadMemberCount() {
    fetch('/api/rooms/list')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.success) return;
        var room = (data.rooms || []).find(function (r) { return r.code === roomCode; });
        if (room && membersLabel) {
          membersLabel.textContent = room.members.length + ' member' +
            (room.members.length !== 1 ? 's' : '');
        }
      })
      .catch(function () {});
  }

  // ── Generate Study ─────────────────────────────────────────────────────────

  // Inject Cancel button into the search bar, hidden by default
  var cancelBtn = null;
  if (generateBtn && generateBtn.parentNode) {
    cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.className   = 'btn-warm';
    cancelBtn.style.display = 'none';
    generateBtn.parentNode.insertBefore(cancelBtn, generateBtn.nextSibling);
  }

  if (cancelBtn) {
    cancelBtn.addEventListener('click', function () {
      if (currentAbortCtrl) currentAbortCtrl.abort();
    });
  }

  if (generateBtn) {
    generateBtn.addEventListener('click', function () {
      var topic = topicInput ? topicInput.value.trim() : '';
      if (!topic) { if (topicInput) topicInput.focus(); return; }
      generateStudy(topic);
    });
  }

  if (topicInput) {
    topicInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        var topic = topicInput.value.trim();
        if (topic) generateStudy(topic);
      }
    });
  }

  async function generateStudy(topic) {
    currentAbortCtrl = new AbortController();

    if (roomLoading)  roomLoading.style.display  = 'flex';
    if (guideArea)    guideArea.style.display     = 'none';
    if (generateBtn)  generateBtn.disabled        = true;
    if (cancelBtn)    cancelBtn.style.display     = 'inline-block';

    try {
      var res  = await fetch('/api/study/generate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ topic: topic }),
        signal:  currentAbortCtrl.signal,
      });
      var data = await res.json();
      if (!data.success) throw new Error(data.error || 'Generation failed.');

      displayStudy(data);
      socket.emit('room-study-result', { roomCode: roomCode, data: data });

      fetch('/api/rooms/' + encodeURIComponent(roomCode) + '/save-study', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ topic: data.topic, content: data.content, translation: data.translation }),
      }).catch(function () {});
    } catch (err) {
      if (roomLoading) roomLoading.style.display = 'none';
      if (err.name !== 'AbortError') showToast('Error: ' + err.message, true);
    } finally {
      if (generateBtn)  generateBtn.disabled    = false;
      if (cancelBtn)    cancelBtn.style.display = 'none';
      currentAbortCtrl = null;
    }
  }


  // ── Display Study ──────────────────────────────────────────────────────────
  function displayStudy(data) {
    currentStudy = data;
    if (guideTitle)      guideTitle.textContent  = data.topic || '';
    if (guideBadge)      guideBadge.textContent  = data.translation || 'LSB';
    if (guideBody)       guideBody.innerHTML     = renderMarkdown(data.content || '');
    if (roomLoading)     roomLoading.style.display   = 'none';
    if (guideArea)       guideArea.style.display     = 'block';
  }

  // ── Save to Library ────────────────────────────────────────────────────────
  if (saveBtn) {
    saveBtn.addEventListener('click', async function () {
      if (!currentStudy) return;
      saveBtn.disabled = true;
      try {
        var res  = await fetch('/api/library/save', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            topic:       currentStudy.topic,
            content:     currentStudy.content,
            translation: currentStudy.translation,
            tags:        '',
            rating:      0,
            createdAt:   new Date().toISOString(),
          }),
        });
        var data = await res.json();
        if (data.success) {
          showToast('Saved to Library.');
        } else {
          showToast('Error: ' + (data.error || 'Save failed.'), true);
        }
      } catch (err) {
        showToast('Error: ' + err.message, true);
      } finally {
        saveBtn.disabled = false;
      }
    });
  }

  // ── Chat ──────────────────────────────────────────────────────────────────
  function sendChat() {
    if (!chatInput) return;
    var msg = chatInput.value.trim();
    if (!msg) return;
    socket.emit('room-chat', {
      roomCode:   roomCode,
      message:    msg,
      senderName: window.CURRENT_USER ? window.CURRENT_USER.name : 'Anonymous',
    });
    chatInput.value = '';
  }

  function appendChatMessage(sender, message) {
    if (!chatMessages) return;
    var div = document.createElement('div');
    div.style.cssText = 'padding:0.25rem 0;font-size:0.9rem;border-bottom:1px solid #e8d9b8;';
    div.innerHTML = '<strong>' + escHtml(sender) + '</strong>: ' + escHtml(message);
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  if (chatBtn) {
    chatBtn.addEventListener('click', sendChat);
  }

  if (chatInput) {
    chatInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') sendChat();
    });
  }

  // ── Markdown renderer ──────────────────────────────────────────────────────
  function renderMarkdown(text) {
    if (!text) return '';

    var html = text
      .replace(/^#### (.+)$/gm, '<h5 class="guide-h5">$1</h5>')
      .replace(/^### (.+)$/gm,  '<h4 class="guide-h4">$1</h4>')
      .replace(/^## (.+)$/gm,   '<h3 class="guide-h3">$1</h3>')
      .replace(/^# (.+)$/gm,    '<h2 class="guide-h2">$1</h2>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g,     '<em>$1</em>')
      .replace(/^---$/gm,        '<hr class="guide-hr">');

    var lines  = html.split('\n');
    var result = [];
    var inUl = false, inOl = false;

    lines.forEach(function (line) {
      var ulM = line.match(/^[-*] (.+)/);
      var olM = line.match(/^\d+\. (.+)/);

      if (ulM) {
        if (inOl) { result.push('</ol>'); inOl = false; }
        if (!inUl) { result.push('<ul class="guide-list">'); inUl = true; }
        result.push('<li>' + ulM[1] + '</li>');
      } else if (olM) {
        if (inUl) { result.push('</ul>'); inUl = false; }
        if (!inOl) { result.push('<ol class="guide-list guide-ol">'); inOl = true; }
        result.push('<li>' + olM[1] + '</li>');
      } else {
        if (inUl) { result.push('</ul>'); inUl = false; }
        if (inOl) { result.push('</ol>'); inOl = false; }
        var t = line.trim();
        if (!t) {
          result.push('<div class="guide-spacer"></div>');
        } else if (t.startsWith('<h') || t.startsWith('<hr')) {
          result.push(t);
        } else {
          result.push('<p class="guide-p">' + t + '</p>');
        }
      }
    });

    if (inUl) result.push('</ul>');
    if (inOl) result.push('</ol>');
    return result.join('\n');
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
    }, 2800);
  }

  // ── Host-only UI ──────────────────────────────────────────────────────────
  if (!isHost) {
    var searchBar = document.querySelector('.study-search-bar');
    if (searchBar) searchBar.style.display = 'none';
  }

  if (isHost) {
    var roomHeader = document.querySelector('.room-header');
    if (roomHeader) {
      // ── End Study modal ──────────────────────────────────────────────────
      var endModal = document.createElement('div');
      endModal.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;align-items:center;justify-content:center;';
      endModal.innerHTML =
        '<div style="background:#E8D9B8;border:1px solid #5C1A28;border-radius:8px;padding:2rem 2.25rem;max-width:380px;width:90%;font-family:\'EB Garamond\',Georgia,serif;box-shadow:0 8px 32px rgba(0,0,0,0.35);">' +
          '<h4 style="margin:0 0 0.75rem;color:#5C1A28;font-size:1.15rem;font-weight:600;">End Study Session</h4>' +
          '<p style="margin:0 0 1.5rem;color:#3a2a1a;font-size:0.97rem;line-height:1.55;">This will close the room for everyone. Are you sure?</p>' +
          '<div style="display:flex;gap:0.75rem;justify-content:flex-end;">' +
            '<button class="btn-warm" id="endModalCancel">Cancel</button>' +
            '<button id="endModalConfirm" style="background:#8B0000;color:#fff;border:none;border-radius:4px;padding:6px 16px;font-size:0.9rem;font-family:inherit;cursor:pointer;">End Study</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(endModal);

      var endModalCancel  = endModal.querySelector('#endModalCancel');
      var endModalConfirm = endModal.querySelector('#endModalConfirm');

      endModalCancel.addEventListener('click', function () {
        endModal.style.display = 'none';
      });

      endModal.addEventListener('click', function (e) {
        if (e.target === endModal) endModal.style.display = 'none';
      });

      endModalConfirm.addEventListener('click', async function () {
        endModalConfirm.disabled = true;
        endModalConfirm.textContent = 'Closing…';
        try {
          var r    = await fetch('/api/rooms/' + encodeURIComponent(roomCode), { method: 'DELETE' });
          var data = await r.json();
          if (data.success) {
            window.location.href = '/rooms';
          } else {
            showToast('Error: ' + (data.error || 'Could not close room.'), true);
            endModal.style.display = 'none';
            endModalConfirm.disabled = false;
            endModalConfirm.textContent = 'End Study';
          }
        } catch (err) {
          showToast('Error: ' + err.message, true);
          endModal.style.display = 'none';
          endModalConfirm.disabled = false;
          endModalConfirm.textContent = 'End Study';
        }
      });

      // ── End Study trigger button ─────────────────────────────────────────
      var endBtn = document.createElement('button');
      endBtn.textContent = 'End Study';
      endBtn.style.cssText = 'background:#8B0000;color:#fff;border:none;border-radius:4px;padding:3px 10px;font-size:0.78rem;cursor:pointer;margin-top:0.5rem;';
      endBtn.addEventListener('click', function () {
        endModal.style.display = 'flex';
      });
      roomHeader.appendChild(endBtn);
    }
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  loadMemberCount();

  if (window.ROOM_STUDY) {
    displayStudy(window.ROOM_STUDY);
  }

}());
