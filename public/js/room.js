(function () {
  'use strict';

  var currentStudy      = null;
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
  var followUpSection   = document.getElementById('roomFollowUp');
  var followUpInput     = document.getElementById('roomFollowUpInput');
  var followUpBtn       = document.getElementById('roomFollowUpBtn');
  var saveBtn           = document.getElementById('roomSaveBtn');
  var membersLabel      = document.getElementById('roomMembersLabel');
  var chatInput         = document.getElementById('roomChatInput');
  var chatBtn           = document.getElementById('roomChatBtn');
  var chatMessages      = document.getElementById('roomChatMessages');

  // ── Socket.io ──────────────────────────────────────────────────────────────
  var socket = io();
  socket.emit('join-room', roomCode);

  socket.on('room-study-result', function (data) {
    displayStudy(data);
  });

  socket.on('room-followup-result', function (data) {
    displayStudy(data);
  });

  socket.on('room-chat-message', function (data) {
    appendChatMessage(data.senderName, data.message);
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
    if (roomLoading)  roomLoading.style.display  = 'flex';
    if (guideArea)    guideArea.style.display     = 'none';
    if (generateBtn)  generateBtn.disabled        = true;

    try {
      var res  = await fetch('/api/study/generate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ topic: topic }),
      });
      var data = await res.json();
      if (!data.success) throw new Error(data.error || 'Generation failed.');

      displayStudy(data);
      socket.emit('room-study-result', { roomCode: roomCode, data: data });
    } catch (err) {
      if (roomLoading) roomLoading.style.display = 'none';
      showToast('Error: ' + err.message, true);
    } finally {
      if (generateBtn) generateBtn.disabled = false;
    }
  }

  // ── Follow-up ──────────────────────────────────────────────────────────────
  if (followUpBtn) {
    followUpBtn.addEventListener('click', function () {
      var q = followUpInput ? followUpInput.value.trim() : '';
      if (!q) { if (followUpInput) followUpInput.focus(); return; }
      doFollowUp(q);
    });
  }

  if (followUpInput) {
    followUpInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        var q = followUpInput.value.trim();
        if (q) doFollowUp(q);
      }
    });
  }

  async function doFollowUp(question) {
    if (followUpBtn) followUpBtn.disabled = true;
    if (roomLoading) roomLoading.style.display = 'flex';
    if (guideArea)   guideArea.style.display   = 'none';

    try {
      var res  = await fetch('/api/study/generate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ topic: question }),
      });
      var data = await res.json();
      if (!data.success) throw new Error(data.error || 'Request failed.');

      displayStudy(data);
      socket.emit('room-followup-result', { roomCode: roomCode, data: data });
      if (followUpInput) followUpInput.value = '';
    } catch (err) {
      if (roomLoading) roomLoading.style.display = 'none';
      showToast('Error: ' + err.message, true);
    } finally {
      if (followUpBtn) followUpBtn.disabled = false;
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
    if (followUpSection) followUpSection.style.display = 'block';
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

  // ── Init ───────────────────────────────────────────────────────────────────
  loadMemberCount();

}());
