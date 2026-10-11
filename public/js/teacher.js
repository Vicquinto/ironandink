(function () {
  'use strict';

  // Study with a Tutor / Study with a Teacher — page client (one page, two
  // kinds: BOOT.kind is 'tutor' or 'teacher'). The streaming client is cloned from
  // Dialogue (public/js/dialogue.js: streamExchange / setGenerating / typing
  // indicator / end-of-session review), but the transcript lives on the server:
  // this page sends only the new message and the server saves each exchange.

  var BOOT = window.TEACHER_BOOT || {};
  var sections = BOOT.sections || [];
  var KIND = BOOT.kind === 'teacher' ? 'teacher' : 'tutor';
  var WHO  = KIND === 'teacher' ? 'Teacher' : 'Tutor';          // role label on messages
  var GENERIC_ERROR = 'The ' + WHO.toLowerCase() + ' couldn\'t respond. Please try again.';
  var SESSION_URL = '/api/teacher/' + encodeURIComponent(BOOT.studyId) + '/session?kind=' + KIND;

  // ── State ────────────────────────────────────────────────────────────────
  var abortController = null;
  var isGenerating    = false;
  var sessionActive   = false;   // a session is loaded/started and accepting answers
  var nextStudy       = null;

  // ── DOM refs ─────────────────────────────────────────────────────────────
  var studyBody       = document.getElementById('teacherStudyBody');
  var messagesEl      = document.getElementById('teacherMessages');
  var inputEl         = document.getElementById('teacherInput');
  var sendBtn         = document.getElementById('teacherSendBtn');
  var stopBtn         = document.getElementById('teacherStopBtn');
  var endBtn          = document.getElementById('teacherEndBtn');
  var quickBtns       = document.querySelectorAll('.teacher-quick-btn');
  var resumePanel     = document.getElementById('teacherResume');
  var resumeText      = document.getElementById('teacherResumeText');
  var resumeBtn       = document.getElementById('teacherResumeBtn');
  var startOverBtn    = document.getElementById('teacherStartOverBtn');
  var deleteBtn       = document.getElementById('teacherDeleteBtn');
  var reviewModal     = document.getElementById('teacherReviewModal');
  var reviewLoading   = document.getElementById('teacherReviewLoading');
  var reviewResults   = document.getElementById('teacherReviewResults');
  var reviewError     = document.getElementById('teacherReviewError');
  var reviewActions   = document.getElementById('teacherReviewActions');
  var wellBox         = document.getElementById('teacherWellBox');
  var wellList        = document.getElementById('teacherWellList');
  var revisitBox      = document.getElementById('teacherRevisitBox');
  var revisitList     = document.getElementById('teacherRevisitList');
  var nextLine        = document.getElementById('teacherNextLine');
  var nextText        = document.getElementById('teacherNextText');
  var nextBtn         = document.getElementById('teacherNextBtn');
  var keepBtn         = document.getElementById('teacherKeepBtn');
  var reviewDeleteBtn = document.getElementById('teacherReviewDeleteBtn');
  var backLink        = document.querySelector('.teacher-back-link');

  // ── The study (left pane) ────────────────────────────────────────────────
  // renderMarkdown output is sanitized by the shared allowlist sanitizer.
  // Each section heading gets an id so review links can jump straight to it.
  if (studyBody && window.renderMarkdown) {
    studyBody.innerHTML = window.renderMarkdown(BOOT.content || '');
    var heads = window.IronInkTeacher ? window.IronInkTeacher.sectionHeadings(studyBody)
                                      : Array.prototype.slice.call(studyBody.querySelectorAll('h3.guide-h3'));
    heads.forEach(function (h, i) { h.id = 'teacher-sec-' + (i + 1); });
  }

  function scrollToSection(n) {
    var h = document.getElementById('teacher-sec-' + n);
    if (!h) return;
    h.scrollIntoView({ behavior: 'smooth', block: 'start' });
    h.classList.remove('teacher-sec-flash');
    void h.offsetWidth;                     // restart the highlight animation
    h.classList.add('teacher-sec-flash');
  }

  // Open at the section the reader picked, so the text matches the teacher.
  if (BOOT.entry && BOOT.entry.mode === 'section' && BOOT.entry.section) {
    setTimeout(function () { scrollToSection(BOOT.entry.section); }, 50);
  }

  // ── Rendering (escape-first, then sanitized) ─────────────────────────────
  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Dialogue's renderText, plus set-apart verse lines: the server injects block
  // verses as "> “…” — Ref (NASB 1995)". Everything is escaped BEFORE any markup
  // is added, and the result still passes through the shared sanitizer.
  function renderTeacherText(text) {
    var lines = String(text).replace(/\s+$/, '').split('\n');
    var html = lines.map(function (line) {
      var bq = line.match(/^>\s?(.*)$/);
      var body = esc(bq ? bq[1] : line)
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g,     '<em>$1</em>');
      return bq ? '<blockquote class="guide-bq">' + body + '</blockquote>' : body;
    }).join('\n')
      .replace(/\n*(<blockquote)/g, '$1')
      .replace(/(<\/blockquote>)\n*/g, '$1')
      .replace(/\n\n/g, '<br><br>')
      .replace(/\n/g, '<br>');
    return window.IronInkSanitize ? window.IronInkSanitize.sanitize(html, 'markdown') : html;
  }

  // ── Message UI ───────────────────────────────────────────────────────────
  function scrollChat() { messagesEl.scrollTop = messagesEl.scrollHeight; }

  function addTeacherMessage(text) {
    var div = document.createElement('div');
    div.className = 'chat-msg engine-msg';
    div.innerHTML = '<div class="msg-role"></div><div class="msg-content"></div>';
    div.querySelector('.msg-role').textContent = WHO;
    div.querySelector('.msg-content').innerHTML = renderTeacherText(text);
    messagesEl.appendChild(div);
    scrollChat();
    return div;
  }

  function createStreamingMsg() {
    var div = addTeacherMessage('');
    div.classList.add('streaming');
    return div;
  }

  function addUserMessage(text) {
    var div = document.createElement('div');
    div.className = 'chat-msg user-msg';
    div.innerHTML = '<div class="msg-role">You</div><div class="msg-content">' + esc(text) + '</div>';
    messagesEl.appendChild(div);
    scrollChat();
    return div;
  }

  function addSystemMsg(text) {
    var div = document.createElement('div');
    div.className = 'chat-msg system-msg';
    div.innerHTML = '<div class="msg-content">' + esc(text) + '</div>';
    messagesEl.appendChild(div);
    scrollChat();
  }

  function showTypingIndicator() {
    hideTypingIndicator();
    var div = document.createElement('div');
    div.id        = 'teacherTyping';
    div.className = 'chat-msg engine-msg';
    div.innerHTML =
      '<div class="msg-role">' + WHO + '</div>' +
      '<div class="typing-indicator">' +
        '<span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>' +
      '</div>';
    messagesEl.appendChild(div);
    scrollChat();
  }

  function hideTypingIndicator() {
    var ind = document.getElementById('teacherTyping');
    if (ind) ind.remove();
  }

  function setGenerating(val) {
    isGenerating = val;
    var canAnswer = sessionActive && !val;
    stopBtn.style.display = val ? 'inline-block' : 'none';
    sendBtn.disabled  = !canAnswer;
    inputEl.disabled  = !canAnswer;
    endBtn.disabled   = !sessionActive || val;
    quickBtns.forEach(function (b) { b.disabled = !canAnswer; });
    if (!val) abortController = null;
  }

  // ── Streaming exchange ───────────────────────────────────────────────────
  // POST /api/teacher/exchange; resolves to the full reply text. Pre-stream
  // failures arrive as JSON with a short, already-sanitized message.
  async function streamExchange(body) {
    abortController = new AbortController();
    var msgEl = null;
    try {
      var response = await fetch('/api/teacher/exchange', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(Object.assign({ studyId: BOOT.studyId, kind: KIND }, body)),
        signal:  abortController.signal,
      });

      if (!response.ok) {
        var info = null;
        try { info = await response.json(); } catch (e) { /* not JSON */ }
        if (response.status === 402 && info && info.upgradeUrl) { window.location.href = info.upgradeUrl; }
        throw new Error((info && info.error && info.error !== 'member_feature') ? info.error : GENERIC_ERROR);
      }

      hideTypingIndicator();
      msgEl = createStreamingMsg();
      var contentEl = msgEl.querySelector('.msg-content');

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
            if (data === '[DONE]') continue;
            var parsed;
            try { parsed = JSON.parse(data); } catch (e) { continue; }
            if (parsed.error) throw new Error(parsed.error);
            if (parsed.text) {
              fullText += parsed.text;
              contentEl.innerHTML = renderTeacherText(fullText);
              scrollChat();
            }
          }
        }
      }

      if (!fullText) throw new Error(GENERIC_ERROR);
      msgEl.classList.remove('streaming');
      return fullText;
    } catch (err) {
      hideTypingIndicator();
      if (msgEl) msgEl.remove();
      throw err;
    }
  }

  // Runs one exchange. userText (optional) is shown as the reader's bubble; on
  // a Stop it is removed again and put back in the input (nothing was saved).
  async function runTurn(body, userText) {
    if (isGenerating) return false;
    var userEl = userText ? addUserMessage(userText) : null;
    showTypingIndicator();
    setGenerating(true);
    try {
      await streamExchange(body);
      return true;
    } catch (err) {
      if (userEl) { userEl.remove(); inputEl.value = userText; }
      if (err.name !== 'AbortError') {
        addSystemMsg(err.message || GENERIC_ERROR);
      }
      return false;
    } finally {
      setGenerating(false);
    }
  }

  // ── Starting / resuming ──────────────────────────────────────────────────
  async function startNew() {
    hideResume();
    messagesEl.innerHTML = '';
    sessionActive = false;
    var ok = await runTurn({ start: { mode: BOOT.entry.mode, section: BOOT.entry.section } });
    if (ok) { sessionActive = true; setGenerating(false); inputEl.focus(); }
    else if (!messagesEl.querySelector('.engine-msg')) showRetry();
  }

  function showRetry() {
    showResumePanel('Ready when you are.', { begin: true });
  }

  async function resumeSaved() {
    hideResume();
    messagesEl.innerHTML = '';
    try {
      var res  = await fetch(SESSION_URL);
      var data = await res.json();
      if (!data.success || !data.session) { await startNew(); return; }
      (data.session.transcript || []).forEach(function (m) {
        if (m.role === 'assistant') addTeacherMessage(m.content); else addUserMessage(m.content);
      });
    } catch (err) {
      addSystemMsg('Your saved session couldn\'t be loaded. Please refresh and try again.');
      return;
    }
    sessionActive = true;
    var ok = await runTurn({ resume: true });
    setGenerating(false);
    if (ok) inputEl.focus();
  }

  function hideResume() { resumePanel.style.display = 'none'; }

  // The resume panel doubles as the "begin" panel after a delete or a failed start.
  function showResumePanel(text, opts) {
    resumeText.textContent = text;
    resumeBtn.textContent  = opts.begin ? 'Begin' : 'Continue';
    startOverBtn.style.display = opts.begin ? 'none' : '';
    deleteBtn.style.display    = opts.begin ? 'none' : '';
    resumeBtn.onclick = opts.begin ? startNew : resumeSaved;
    resumePanel.style.display = 'block';
  }

  function startOverLabel() {
    if (KIND === 'teacher') return 'Start a fresh conversation';
    if (BOOT.entry.mode === 'section' && sections[BOOT.entry.section - 1]) {
      return 'Start over at “' + sections[BOOT.entry.section - 1].title + '”';
    }
    if (BOOT.entry.mode === 'check') return 'Start a fresh understanding check';
    return 'Start over';
  }

  async function deleteSaved(onDone) {
    try {
      var res  = await fetch(SESSION_URL, { method: 'DELETE' });
      var data = await res.json();
      if (!data.success && res.status !== 404) throw new Error();
      onDone();
    } catch (err) {
      if (typeof showAlert === 'function') showAlert('The saved session couldn\'t be deleted. Please try again.');
    }
  }

  function confirmThen(message, label, fn) {
    if (typeof showConfirm === 'function') showConfirm(message, label, fn);
    else if (window.confirm(message)) fn();
  }

  startOverBtn.addEventListener('click', function () {
    confirmThen('Start over? Your saved session will be replaced once the teacher replies.', 'Start over', startNew);
  });
  deleteBtn.addEventListener('click', function () {
    confirmThen('Delete your saved session for this study?', 'Delete', function () {
      deleteSaved(function () {
        BOOT.saved = null;
        messagesEl.innerHTML = '';
        addSystemMsg('Saved session deleted.');
        showRetry();
      });
    });
  });

  // ── Sending ──────────────────────────────────────────────────────────────
  function send(text) {
    text = String(text || '').trim();
    if (!text || isGenerating || !sessionActive) return;
    inputEl.value = '';
    runTurn({ message: text }, text);
  }

  sendBtn.addEventListener('click', function () { send(inputEl.value); });
  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(inputEl.value); }
  });
  quickBtns.forEach(function (b) {
    b.addEventListener('click', function () { send(b.getAttribute('data-reply')); });
  });
  stopBtn.addEventListener('click', function () { if (abortController) abortController.abort(); });

  // ── End of session — review ──────────────────────────────────────────────
  function reviewItem(item) {
    var li = document.createElement('li');
    var p  = document.createElement('span');
    p.className = 'teacher-review-point';
    p.textContent = item.point;
    li.appendChild(p);
    if (item.section && item.sectionTitle) {
      var link = document.createElement('button');
      link.type = 'button';
      link.className = 'teacher-review-link';
      link.textContent = '→ ' + item.sectionTitle;
      link.addEventListener('click', function () {
        closeReview();
        scrollToSection(item.section);
      });
      li.appendChild(document.createTextNode(' '));
      li.appendChild(link);
    } else if (item.topic) {
      var out = document.createElement('a');
      out.className = 'teacher-review-link teacher-review-outside';
      out.href = '/study?studyNext=' + encodeURIComponent(item.topic);
      out.textContent = '→ Study: ' + item.topic;
      out.title = 'Outside this study — opens a new study on it';
      li.appendChild(document.createTextNode(' '));
      li.appendChild(out);
    }
    return li;
  }

  function fillList(box, listEl, items) {
    listEl.innerHTML = '';
    (items || []).forEach(function (it) { listEl.appendChild(reviewItem(it)); });
    box.style.display = (items && items.length) ? '' : 'none';
  }

  function closeReview() {
    reviewModal.style.display = 'none';
    document.body.style.overflow = '';
  }

  endBtn.addEventListener('click', async function () {
    if (isGenerating) return;
    reviewModal.style.display     = 'flex';
    reviewLoading.style.display   = 'block';
    reviewResults.style.display   = 'none';
    reviewError.style.display     = 'none';
    reviewActions.style.display   = 'none';
    nextBtn.style.display         = 'none';
    nextStudy = null;

    try {
      var res  = await fetch('/api/teacher/review', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ studyId: BOOT.studyId, kind: KIND }),
      });
      var data = await res.json();
      if (!data.success) throw new Error();
      var review = data.review;
      if (!review) {
        reviewError.textContent = 'Answer a question or two first, and there will be something to review. Your session is saved.';
        reviewError.style.display = 'block';
      } else {
        fillList(wellBox, wellList, review.understandWell);
        fillList(revisitBox, revisitList, review.revisit);
        nextStudy = review.nextStudy || null;
        nextText.textContent  = nextStudy ? nextStudy.topic : '';
        nextLine.style.display = nextStudy ? '' : 'none';
        nextBtn.style.display  = nextStudy ? '' : 'none';
        reviewResults.style.display = 'block';
      }
    } catch (err) {
      reviewError.textContent = 'The review couldn\'t be prepared this time. Your session is still saved.';
      reviewError.style.display = 'block';
    } finally {
      reviewLoading.style.display = 'none';
      reviewActions.style.display = 'flex';
    }
  });

  keepBtn.addEventListener('click', closeReview);
  reviewModal.addEventListener('click', function (e) { if (e.target === reviewModal) closeReview(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && reviewModal.style.display !== 'none') closeReview();
  });

  // Study this next → the study page, pre-filled. A pick from this study's own
  // Further Studies list on the reader's OWN study also carries branch lineage,
  // via the same consume-once sessionStorage blob the Library uses.
  nextBtn.addEventListener('click', function () {
    if (!nextStudy || !nextStudy.topic) return;
    if (nextStudy.fromFurther && BOOT.isOwner) {
      try {
        sessionStorage.setItem('ironBranchPending', JSON.stringify({
          parentId:     BOOT.studyId,
          rootId:       BOOT.rootId || BOOT.studyId,
          parentTopic:  BOOT.topic,
          sourcePrompt: nextStudy.topic,
          topic:        nextStudy.topic,
        }));
      } catch (err) { /* sessionStorage blocked — topic-only prefill */ }
    }
    window.location.href = '/study?studyNext=' + encodeURIComponent(nextStudy.topic);
  });

  reviewDeleteBtn.addEventListener('click', function () {
    confirmThen('Delete your saved session for this study?', 'Delete', function () {
      deleteSaved(function () {
        window.location.href = backLink ? backLink.getAttribute('href') : '/library';
      });
    });
  });

  // ── Boot ─────────────────────────────────────────────────────────────────
  setGenerating(false);
  if (BOOT.saved) {
    startOverBtn.textContent = startOverLabel();
    var lastTime = KIND === 'teacher'
      ? 'Last time we talked about ' + (BOOT.saved.coveredLabel || 'the big question behind this study')
      : 'Last time we covered ' + (BOOT.saved.coveredLabel || 'part of this study');
    showResumePanel(lastTime + '. Ready to continue?', { begin: false });
  } else {
    startNew();
  }

})();
