(function () {
  'use strict';

  // ── Session state ────────────────────────────────────────────────────────
  var sessionTopic    = '';
  var sessionPosition = '';
  var sessionStudyId  = null;
  var history         = [];
  var abortController = null;
  var isGenerating    = false;
  var gapStudyNextValue = '';

  // ── DOM refs ─────────────────────────────────────────────────────────────
  var setupScreen         = document.getElementById('dialogueSetup');
  var sessionScreen       = document.getElementById('dialogueSession');
  var endSessionModal     = document.getElementById('endSessionModal');
  var chatMessages        = document.getElementById('chatMessages');
  var userResponseInput   = document.getElementById('userResponseInput');
  var sendResponseBtn     = document.getElementById('sendResponseBtn');
  var stopDialogueBtn     = document.getElementById('stopDialogueBtn');
  var endSessionBtn       = document.getElementById('endSessionBtn');
  var studyNextBtn        = document.getElementById('studyNextBtn');
  var saveSessionBtn      = document.getElementById('saveSessionBtn');
  var discardSessionBtn   = document.getElementById('discardSessionBtn');
  var sessionTopicLabel   = document.getElementById('sessionTopicLabel');
  var sessionPositionBadge = document.getElementById('sessionPositionBadge');
  var freshTopicSection   = document.getElementById('freshTopicSection');
  var studyLinkSection    = document.getElementById('studyLinkSection');
  var freshTopicInput     = document.getElementById('freshTopicInput');
  var beginDialogueBtn    = document.getElementById('beginDialogueBtn');
  var endSessionActions   = document.getElementById('endSessionActions');
  var endSessionConfirm   = document.getElementById('endSessionConfirm');
  var gapLoading          = document.getElementById('gapLoading');
  var gapResults          = document.getElementById('gapResults');
  var gapSummaryText      = document.getElementById('gapSummaryText');
  var gapStudyNextText    = document.getElementById('gapStudyNextText');

  // ── Entry point radio toggle ──────────────────────────────────────────────
  document.querySelectorAll('input[name="entryType"]').forEach(function (radio) {
    radio.addEventListener('change', function () {
      if (radio.value === 'fresh') {
        freshTopicSection.style.display = 'block';
        studyLinkSection.style.display  = 'none';
      } else {
        freshTopicSection.style.display = 'none';
        studyLinkSection.style.display  = 'block';
      }
    });
  });

  // ── Begin Dialogue ────────────────────────────────────────────────────────
  beginDialogueBtn.addEventListener('click', function () {
    var entryType = document.querySelector('input[name="entryType"]:checked').value;

    if (entryType === 'fresh') {
      sessionTopic = freshTopicInput.value.trim();
      if (!sessionTopic) { freshTopicInput.focus(); return; }
      sessionStudyId = null;
    } else {
      var sel = document.getElementById('savedStudySelect');
      if (!sel || !sel.value) { return; }
      sessionTopic   = sel.options[sel.selectedIndex].text.split(' — ')[0].trim();
      sessionStudyId = sel.value;
    }

    sessionPosition = document.getElementById('adversarialPosition').value;
    history = [];

    setupScreen.style.display   = 'none';
    sessionScreen.style.display = 'flex';

    sessionTopicLabel.textContent    = sessionTopic;
    sessionPositionBadge.textContent = sessionPosition;

    getOpeningChallenge();
  });

  // ── Opening challenge ─────────────────────────────────────────────────────
  async function getOpeningChallenge() {
    showTypingIndicator();
    setGenerating(true);

    try {
      var text = await streamExchange([], true);
      if (text) {
        history.push({ role: 'assistant', content: text });
      }
    } catch (err) {
      hideTypingIndicator();
      if (err.name !== 'AbortError') {
        addSystemMsg('The adversary could not be reached. Please end and try again.');
      }
    } finally {
      setGenerating(false);
    }
  }

  // ── Send response ─────────────────────────────────────────────────────────
  sendResponseBtn.addEventListener('click', sendResponse);

  userResponseInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendResponse();
    }
  });

  async function sendResponse() {
    if (isGenerating) return;
    var text = userResponseInput.value.trim();
    if (!text) { userResponseInput.focus(); return; }

    addUserMessage(text);
    userResponseInput.value = '';
    history.push({ role: 'user', content: text });

    showTypingIndicator();
    setGenerating(true);

    try {
      var response = await streamExchange(history, false);
      if (response) {
        history.push({ role: 'assistant', content: response });
      }
    } catch (err) {
      hideTypingIndicator();
      if (err.name === 'AbortError') {
        history.pop();
      } else {
        addSystemMsg('Error receiving response. Please try again.');
      }
    } finally {
      setGenerating(false);
    }
  }

  // ── Stream exchange ───────────────────────────────────────────────────────
  async function streamExchange(messages, isOpening) {
    abortController = new AbortController();
    var msgEl = null;

    try {
      var response = await fetch('/api/dialogue/exchange', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          messages:            messages,
          topic:               sessionTopic,
          adversarialPosition: sessionPosition,
          linkedStudyId:       sessionStudyId,
          isOpening:           isOpening,
        }),
        signal: abortController.signal,
      });

      if (!response.ok) throw new Error('Server error ' + response.status);

      hideTypingIndicator();
      msgEl = createStreamingMsg();

      var reader   = response.body.getReader();
      var decoder  = new TextDecoder();
      var buffer   = '';
      var fullText = '';

      while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;

        buffer += decoder.decode(chunk.value, { stream: true });
        var parts = buffer.split('\n\n');
        buffer = parts.pop();

        for (var i = 0; i < parts.length; i++) {
          var lines = parts[i].split('\n');
          for (var j = 0; j < lines.length; j++) {
            if (!lines[j].startsWith('data: ')) continue;
            var data = lines[j].slice(6);
            if (data === '[DONE]') break;
            try {
              var parsed = JSON.parse(data);
              if (parsed.error) throw new Error(parsed.error);
              if (parsed.text) {
                fullText += parsed.text;
                msgEl.querySelector('.msg-content').innerHTML = renderText(fullText);
                chatMessages.scrollTop = chatMessages.scrollHeight;
              }
            } catch (e) {
              if (!(e instanceof SyntaxError)) throw e;
            }
          }
        }
      }

      msgEl.classList.remove('streaming');
      return fullText;

    } catch (err) {
      if (msgEl) msgEl.remove();
      throw err;
    }
  }

  // ── Message UI ────────────────────────────────────────────────────────────
  function createStreamingMsg() {
    var div = document.createElement('div');
    div.className = 'chat-msg engine-msg streaming';
    div.innerHTML =
      '<div class="msg-role">Adversary</div>' +
      '<div class="msg-content"></div>';
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return div;
  }

  function addUserMessage(text) {
    var div = document.createElement('div');
    div.className = 'chat-msg user-msg';
    div.innerHTML =
      '<div class="msg-role">You</div>' +
      '<div class="msg-content">' + esc(text) + '</div>';
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function addSystemMsg(text) {
    var div = document.createElement('div');
    div.className = 'chat-msg system-msg';
    div.innerHTML = '<div class="msg-content">' + esc(text) + '</div>';
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function showTypingIndicator() {
    var div = document.createElement('div');
    div.id        = 'typingIndicator';
    div.className = 'chat-msg engine-msg';
    div.innerHTML =
      '<div class="msg-role">Adversary</div>' +
      '<div class="typing-indicator">' +
        '<span class="typing-dot"></span>' +
        '<span class="typing-dot"></span>' +
        '<span class="typing-dot"></span>' +
      '</div>';
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function hideTypingIndicator() {
    var ind = document.getElementById('typingIndicator');
    if (ind) ind.remove();
  }

  function setGenerating(val) {
    isGenerating = val;
    stopDialogueBtn.style.display = val ? 'inline-block' : 'none';
    sendResponseBtn.disabled      = val;
    userResponseInput.disabled    = val;
    if (!val) abortController = null;
  }

  // ── Stop generation ───────────────────────────────────────────────────────
  stopDialogueBtn.addEventListener('click', function () {
    if (abortController) abortController.abort();
  });

  // ── End session — gap analysis first ─────────────────────────────────────
  endSessionBtn.addEventListener('click', async function () {
    gapLoading.style.display    = 'none';
    gapResults.style.display    = 'none';
    endSessionConfirm.style.display = 'none';
    endSessionActions.style.display = 'none';
    gapStudyNextValue = '';
    endSessionModal.style.display = 'flex';

    if (!history.length) {
      endSessionActions.style.display = 'flex';
      return;
    }

    gapLoading.style.display = 'block';

    try {
      var res = await fetch('/api/dialogue/gaps', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          transcript:          history,
          topic:               sessionTopic,
          adversarialPosition: sessionPosition,
        }),
      });
      var data = await res.json();

      if (data.success && data.summary && data.studyNext) {
        gapStudyNextValue = data.studyNext;
        gapSummaryText.textContent    = data.summary;
        gapStudyNextText.textContent  = data.studyNext;
        gapResults.style.display = 'block';
      }
    } catch (err) {
      // Gap analysis failed — still show buttons
    } finally {
      gapLoading.style.display = 'none';
      endSessionActions.style.display = 'flex';
    }
  });

  // ── Save helper ───────────────────────────────────────────────────────────
  async function performSave() {
    var res = await fetch('/api/dialogue/save', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        topic:               sessionTopic,
        adversarialPosition: sessionPosition,
        linkedStudyId:       sessionStudyId,
        transcript:          history,
      }),
    });
    return await res.json();
  }

  // ── Study this next — auto-save then navigate ─────────────────────────────
  studyNextBtn.addEventListener('click', async function () {
    studyNextBtn.disabled = true;
    try {
      await performSave();
    } catch (err) { /* navigate regardless */ }
    var dest = '/study';
    if (gapStudyNextValue) dest += '?studyNext=' + encodeURIComponent(gapStudyNextValue);
    window.location.href = dest;
  });

  // ── Save session ──────────────────────────────────────────────────────────
  saveSessionBtn.addEventListener('click', async function () {
    saveSessionBtn.disabled = true;
    try {
      var data = await performSave();
      if (data.success) {
        endSessionActions.style.display = 'none';
        endSessionConfirm.style.display = 'block';
        setTimeout(resetSession, 1800);
      } else {
        alert('Save failed: ' + (data.error || 'Unknown error.'));
        saveSessionBtn.disabled = false;
      }
    } catch (err) {
      alert('Error: ' + err.message);
      saveSessionBtn.disabled = false;
    }
  });

  // ── Discard session ───────────────────────────────────────────────────────
  discardSessionBtn.addEventListener('click', resetSession);

  function resetSession() {
    history           = [];
    sessionTopic      = '';
    sessionPosition   = '';
    sessionStudyId    = null;
    gapStudyNextValue = '';

    chatMessages.innerHTML          = '';
    userResponseInput.value         = '';
    saveSessionBtn.disabled         = false;
    studyNextBtn.disabled           = false;
    endSessionModal.style.display   = 'none';
    endSessionActions.style.display = 'none';
    endSessionConfirm.style.display = 'none';
    gapLoading.style.display        = 'none';
    gapResults.style.display        = 'none';

    sessionScreen.style.display = 'none';
    setupScreen.style.display   = 'block';
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderText(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g,     '<em>$1</em>')
      .replace(/\n\n/g, '<br><br>')
      .replace(/\n/g,   '<br>');
  }

})();
