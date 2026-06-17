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
  var loadLibraryBtn    = document.getElementById('roomLoadLibraryBtn');
  var libraryPanel      = document.getElementById('roomLibraryPanel');
  var askAIBtn          = document.getElementById('roomAskAIBtn');
  var askAIPanel        = document.getElementById('roomAskAIPanel');
  var askAIInput        = document.getElementById('roomAskAIInput');
  var askAISubmit       = document.getElementById('roomAskAISubmit');

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
  socket.emit('join-room', {
    roomCode: roomCode,
    name:     window.CURRENT_USER ? window.CURRENT_USER.name : '',
  });

  socket.on('room-study-result', function (data) {
    displayStudy(data);
  });

  socket.on('room-closed', function () {
    showToast('The host has ended this study. Redirecting…');
    setTimeout(function () { window.location.href = '/rooms'; }, 1800);
  });

  socket.on('room-topic-update', function (data) {
    var topicEl = document.getElementById('roomCurrentTopic');
    if (topicEl && data.topic) topicEl.textContent = 'Currently studying: ' + data.topic;
  });


  socket.on('room-member-joined', function (data) {
    loadMembersList();
    var joinerName = (data && data.name) ? data.name : 'A new member';
    showToast(joinerName + ' joined the room.');
    playJoinChime();
  });

  socket.on('room-chat-message', function (data) {
    appendChatMessage(data.senderName, data.message);
    loadMembersList();
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

  // ── Members list ──────────────────────────────────────────────────────────
  function loadMembersList() {
    fetch('/api/rooms/' + encodeURIComponent(roomCode) + '/members')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.success) return;
        var container = document.getElementById('roomMembersBadges');
        if (!container) return;
        container.innerHTML = ' ' + (data.members || []).map(function (m) {
          return '<span style="background:#f5ede0;border:1px solid #c4a882;border-radius:12px;padding:2px 10px;font-size:0.8rem;margin-right:4px;display:inline-block;">' +
            (m.isHost ? '&#9679; ' : '') + escHtml(m.name) +
          '</span>';
        }).join('');
      })
      .catch(function () {});
  }

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

  // ── Load from Library ──────────────────────────────────────────────────────
  function loadLibraryPanel() {
    if (!libraryPanel) return;
    libraryPanel.innerHTML = '<p style="font-size:0.9rem;color:var(--text-muted);">Loading…</p>';
    libraryPanel.style.display = 'block';

    fetch('/api/library')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var studies = (data.success && data.studies) ? data.studies : [];
        if (!studies.length) {
          libraryPanel.innerHTML = '<p style="font-size:0.9rem;color:var(--text-muted);">No saved studies yet.</p>';
          return;
        }

        var studyMap = {};
        studies.forEach(function (s) { studyMap[s.id] = s; });

        libraryPanel.innerHTML =
          '<p style="font-size:0.85rem;color:#5C1A28;font-weight:600;margin:0 0 0.75rem;">Select a study to load into the room</p>' +
          studies.map(function (s) {
            var date = new Date(s.savedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            return '<div class="room-lib-card" data-id="' + escHtml(s.id) + '" style="background:#fff;border:1px solid #c4a882;border-radius:8px;padding:0.75rem 1rem;margin-bottom:0.5rem;cursor:pointer;">' +
              '<span style="font-weight:600;font-size:1rem;color:#3a2a1a;display:block;margin-bottom:0.25rem;">' + escHtml(s.topic) + '</span>' +
              '<span style="font-size:0.8rem;color:#8a7a6a;">' + date + '</span>' +
            '</div>';
          }).join('');

        libraryPanel.querySelectorAll('.room-lib-card').forEach(function (card) {
          card.addEventListener('mouseenter', function () { card.style.background = '#f5ede0'; });
          card.addEventListener('mouseleave', function () { card.style.background = '#fff'; });
          card.addEventListener('click', function () {
            var study = studyMap[card.dataset.id];
            if (!study) return;
            var studyData = { topic: study.topic, content: study.content, translation: study.translation || 'LSB', success: true };
            displayStudy(studyData);
            socket.emit('room-study-result', { roomCode: roomCode, data: studyData });
            fetch('/api/rooms/' + encodeURIComponent(roomCode) + '/save-study', {
              method:  'POST',
              headers: { 'Content-Type': 'application/json' },
              body:    JSON.stringify({ topic: study.topic, content: study.content, translation: study.translation || 'LSB' }),
            }).catch(function () {});
            libraryPanel.style.display = 'none';
          });
        });
      })
      .catch(function () {
        libraryPanel.innerHTML = '<p style="font-size:0.9rem;color:#c05050;">Failed to load library.</p>';
      });
  }

  // ── Ask AI ────────────────────────────────────────────────────────────────
  if (askAIBtn) {
    askAIBtn.addEventListener('click', function () {
      if (askAIPanel && askAIPanel.style.display !== 'none') {
        askAIPanel.style.display = 'none';
        return;
      }
      if (askAIPanel) askAIPanel.style.display = 'block';
      if (askAIInput) askAIInput.focus();
    });
  }

  if (askAISubmit) {
    askAISubmit.addEventListener('click', function () {
      var question = askAIInput ? askAIInput.value.trim() : '';
      if (!question) { if (askAIInput) askAIInput.focus(); return; }

      askAISubmit.disabled     = true;
      askAISubmit.textContent  = 'Asking…';

      fetch('/api/study/generate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ topic: question, studyLevel: window.ROOM_STUDY_LEVEL || '' }),
      })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.success) throw new Error(data.error || 'Request failed.');

        var term = question.length > 50 ? question.slice(0, 50) + '…' : question;

        console.log('isHost in askAI handler: ' + isHost);
        if (isHost) {
          socket.emit('room-tooltip-broadcast', { roomCode: roomCode, type: 'Inquire', term: term, response: data.content });
        } else {
          var prev = document.getElementById('roomAskAIResponse');
          if (prev) prev.remove();
          var responseDiv = document.createElement('div');
          responseDiv.id = 'roomAskAIResponse';
          responseDiv.style.cssText = 'background:#f0e6c8;border-left:4px solid #5C1A28;border-radius:4px;padding:0.75rem 1rem;margin-top:0.75rem;font-size:0.9rem;max-height:300px;overflow-y:auto;';
          responseDiv.innerHTML = renderMarkdown(data.content);
          askAIPanel.appendChild(responseDiv);
        }

        if (askAIInput) askAIInput.value = '';
      })
      .catch(function (err) {
        showToast('Error: ' + err.message, true);
      })
      .finally(function () {
        askAISubmit.disabled    = false;
        askAISubmit.textContent = 'Ask';
      });
    });
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
        body:    JSON.stringify({ topic: topic, studyLevel: window.ROOM_STUDY_LEVEL || '' }),
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

    var topicEl = document.getElementById('roomCurrentTopic');
    if (topicEl && data.topic) topicEl.textContent = 'Currently studying: ' + data.topic;

    socket.emit('room-topic-update', { roomCode: roomCode, topic: data.topic });
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

  // ── Join chime ─────────────────────────────────────────────────────────────
  function playJoinChime() {
    try {
      var Ctx  = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      var ctx  = new Ctx();
      var osc  = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      // Soft two-note ascending chime: C5 → E5
      osc.frequency.setValueAtTime(523.25, ctx.currentTime);
      osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.13);
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.11, ctx.currentTime + 0.02);
      gain.gain.setValueAtTime(0.11, ctx.currentTime + 0.13);
      gain.gain.linearRampToValueAtTime(0.09, ctx.currentTime + 0.15);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.75);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.75);
      setTimeout(function () { try { ctx.close(); } catch (e) {} }, 900);
    } catch (e) {}
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
    if (loadLibraryBtn) {
      loadLibraryBtn.addEventListener('click', function () {
        if (libraryPanel && libraryPanel.style.display !== 'none') {
          libraryPanel.style.display = 'none';
          return;
        }
        loadLibraryPanel();
      });
    }

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
  loadMembersList();

  if (window.ROOM_STUDY) {
    displayStudy(window.ROOM_STUDY);
  }

}());
