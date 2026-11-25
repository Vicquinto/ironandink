(function () {
  'use strict';

  // Study with a Teacher — page client (one page, two kinds of session:
  // BOOT.kind is 'lesson' or 'check'). The streaming client is cloned from
  // Dialogue (public/js/dialogue.js: streamExchange / setGenerating / typing
  // indicator / end-of-session review), but the transcript and the lesson state
  // live on the server: this page sends only the new message or reader action,
  // and the server saves each exchange and reports where the lesson now is.

  var BOOT = window.TEACHER_BOOT || {};
  var sections = BOOT.sections || [];
  var KIND = BOOT.kind === 'check' ? 'check' : 'lesson';
  var WHO  = 'Teacher';                                          // role label on messages
  var GENERIC_ERROR = 'The teacher couldn\'t respond. Please try again.';
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
  var nowEl           = document.getElementById('teacherNow');
  var otherPanel      = document.getElementById('teacherOther');
  var otherText       = document.getElementById('teacherOtherText');
  var otherContinue   = document.getElementById('teacherOtherContinue');
  var otherNewBtn     = document.getElementById('teacherOtherNew');
  var alsoEl          = document.getElementById('teacherAlso');
  var alsoLink        = document.getElementById('teacherAlsoLink');

  // ── The other saved session (lesson ↔ understanding check) ───────────────
  // BOOT.sessions: { lesson, check }, each { exists, updatedAt, resumeText } or
  // null (routes/teacher.js sessionsSummary). The links carry resume=1: the
  // page they open shows its saved session and never starts a new one.
  var SESSIONS = BOOT.sessions || {};
  var OTHER    = KIND === 'lesson' ? (SESSIONS.check || null) : (SESSIONS.lesson || null);
  var PAGE_URL = '/teacher/' + encodeURIComponent(BOOT.studyId);
  var CHECK_URL  = PAGE_URL + '?mode=check&resume=1';
  var LESSON_URL = PAGE_URL + '?mode=lesson&resume=1';

  // "November 15, 2026, 3:42 PM" — '' for a missing or bad date.
  function formatWhen(iso) {
    var d = new Date(iso);
    if (!iso || isNaN(d)) return '';
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) + ', ' +
           d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  // One muted line pointing to the other kind's saved session. It sits just
  // under the resume panel, or under the header when there is no panel.
  function showAlso() {
    if (!alsoEl || !alsoLink || !OTHER) return;
    alsoLink.textContent = KIND === 'lesson' ? 'You also have a saved understanding check.' : 'You also have a saved lesson.';
    alsoLink.href = KIND === 'lesson' ? CHECK_URL : LESSON_URL;
    alsoEl.hidden = false;
  }
  function hideAlso() { if (alsoEl) alsoEl.hidden = true; }

  // A lesson opened with NO saved lesson but a saved understanding check:
  // nothing starts until the reader picks.
  function showOtherPanel() {
    var when = formatWhen(OTHER && OTHER.updatedAt);
    otherText.textContent = 'You have a saved understanding check for this study' +
      (when ? ' (last worked on ' + when + ')' : '') + '.';
    otherContinue.href = CHECK_URL;
    hideAlso();
    otherPanel.style.display = 'block';
  }
  function hideOther() { if (otherPanel) otherPanel.style.display = 'none'; }
  if (otherNewBtn) {
    otherNewBtn.addEventListener('click', function () {
      hideOther();
      showAlso();
      startNew();
    });
  }

  // Reader controls: each posts an action; the bubble shows the button's label.
  var ACTION_LABELS = {
    continue: 'Continue',
    deeper:   'Go deeper',
    simpler:  'Say that more simply',
    quiz:     'Ask me a question',
    hint:     'Give me a hint',
    notsure:  'I’m not sure',
  };

  // A check shows "Give me a hint" / "I'm not sure" while its questions are
  // asked, then "Continue" / "Say that more simply" once the Teacher has moved
  // to teaching (the server's checkPhase, from the hidden [[phase:teach]] tag).
  // Buttons carry data-phase; a lesson's buttons have none and always show.
  var checkPhase = 'questions';
  function setCheckPhase(phase) {
    if (KIND !== 'check') return;
    checkPhase = phase === 'teach' ? 'teach' : 'questions';
    quickBtns.forEach(function (b) {
      var p = b.getAttribute('data-phase');
      if (p) b.hidden = p !== checkPhase;
    });
  }

  // ── The study (left pane) ────────────────────────────────────────────────
  // renderMarkdown output is sanitized by the shared allowlist sanitizer.
  // Each lesson section heading (Further Studies skipped, numbered like the
  // server's lesson sections) gets an id so the lesson and review links can
  // jump straight to it.
  var heads = [];
  if (studyBody && window.renderMarkdown) {
    studyBody.innerHTML = window.renderMarkdown(BOOT.content || '');
    heads = window.IronInkTeacher ? window.IronInkTeacher.teachableHeadings(studyBody)
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
  var shownSection = null;   // the section the pane last moved to for the lesson
  if (BOOT.entry && BOOT.entry.mode === 'section' && BOOT.entry.section) {
    shownSection = BOOT.entry.section;
    setTimeout(function () { scrollToSection(BOOT.entry.section); }, 50);
  }

  // ── The pane follows the lesson ──────────────────────────────────────────
  // The current section's heading carries a quiet "current" style, finished
  // ones are slightly muted, and the header names the section. The pane
  // scrolls only when the section CHANGES, never on every reply, so it doesn't
  // pull away from wherever the reader is looking.
  function setLessonState(lesson) {
    if (!lesson) return;
    setCheckPhase(lesson.checkPhase);
    var cur  = parseInt(lesson.currentSection, 10) || 0;
    var done = Array.isArray(lesson.doneSections) ? lesson.doneSections : [];
    heads.forEach(function (h, i) {
      var n = i + 1;
      h.classList.toggle('teacher-sec-current', n === cur);
      h.classList.toggle('teacher-sec-done', n !== cur && done.indexOf(n) !== -1);
    });
    var title = cur && sections[cur - 1] ? sections[cur - 1].title : '';
    if (nowEl) nowEl.textContent = title ? 'Now: ' + title : '';
    if (cur && cur !== shownSection) scrollToSection(cur);
    shownSection = cur;
  }

  // Start over: clear the old lesson's marks before the new opening arrives.
  function resetLessonView() {
    heads.forEach(function (h) { h.classList.remove('teacher-sec-current', 'teacher-sec-done'); });
    if (nowEl) nowEl.textContent = '';
    shownSection = (BOOT.entry && BOOT.entry.mode === 'section') ? BOOT.entry.section : null;
    setCheckPhase('questions');
  }

  // Drop ?mode=section&section=N once the lesson has moved there, so a reload
  // continues the lesson instead of jumping again.
  function settleUrl() {
    if (KIND !== 'lesson' || !window.history || !window.history.replaceState) return;
    try {
      window.history.replaceState(null, '', '/teacher/' + encodeURIComponent(BOOT.studyId) + '?mode=lesson');
    } catch (e) {}
  }

  // Resize a pane without losing the reader's place: note the first visible
  // block and how far into it the view starts, apply the change, then scroll
  // back to that point. A pane scrolled to its end stays there.
  function keepPlace(scroller, blocks, viewTop, apply) {
    var atEnd = scroller.scrollTop > 0 && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 4;
    var top = viewTop(), anchor = null, into = 0, gap = 0;
    for (var i = 0; i < blocks.length; i++) {
      var rect = blocks[i].getBoundingClientRect();
      if (!rect.height || rect.bottom <= top) continue;
      anchor = blocks[i];
      if (rect.top < top) into = (top - rect.top) / rect.height;
      else gap = rect.top - top;
      break;
    }
    apply();
    if (atEnd) { scroller.scrollTop = scroller.scrollHeight; return; }
    // Unscrolled: stay at the very top.
    if (!anchor || (!into && scroller.scrollTop === 0)) return;
    var now = anchor.getBoundingClientRect();
    scroller.scrollTop += now.top + into * now.height - gap - viewTop();
  }

  // ── Study text size ──────────────────────────────────────────────────────
  // The study-reading setting shared with the Study page, Library and Community
  // (same key, default, bounds and step), so a chosen size carries over.
  (function () {
    var DEF = 16, MIN = 12, MAX = 28, STEP = 2, KEY = 'ironink_study_font_size';
    var pane = studyBody && studyBody.parentNode;
    var tools = document.getElementById('teacherStudyTools');
    if (!pane || !tools) return;
    var size = DEF;
    function clamp(n) { return Math.min(MAX, Math.max(MIN, n)); }
    try { var saved = parseInt(localStorage.getItem(KEY), 10); if (saved) size = clamp(saved); } catch (e) {}
    studyBody.style.fontSize = size + 'px';
    function change(n) {
      keepPlace(pane, studyBody.children, function () { return tools.getBoundingClientRect().bottom; }, function () {
        size = clamp(n);
        studyBody.style.fontSize = size + 'px';
      });
      try { localStorage.setItem(KEY, size); } catch (e) {}
    }
    document.getElementById('studyFontDec').addEventListener('click',   function () { change(size - STEP); });
    document.getElementById('studyFontReset').addEventListener('click', function () { change(DEF); });
    document.getElementById('studyFontInc').addEventListener('click',   function () { change(size + STEP); });
  })();

  // ── Conversation zoom ────────────────────────────────────────────────────
  // Writing companion's CFONT_* pattern (public/js/writing.js): same default,
  // bounds and step, persisted in localStorage — under its OWN key, so it never
  // changes the Writing page's setting. Sets the conversation pane's font-size;
  // messages, input and quick replies are em-based (styles.css) and scale off it.
  // The default (16px) is the study pane's reading size.
  var TFONT_DEFAULT = 16, TFONT_MIN = 12, TFONT_MAX = 28, TFONT_STEP = 2;
  var TFONT_KEY = 'ironink_teacher_conversation_font_size';

  var conversationEl = document.getElementById('teacherConversation');
  var teacherFontDec   = document.getElementById('teacherFontDec');
  var teacherFontReset = document.getElementById('teacherFontReset');
  var teacherFontInc   = document.getElementById('teacherFontInc');

  function loadTeacherFont() {
    try {
      var v = parseInt(localStorage.getItem(TFONT_KEY), 10);
      if (v) return Math.min(TFONT_MAX, Math.max(TFONT_MIN, v));
    } catch (e) {}
    return TFONT_DEFAULT;
  }
  function saveTeacherFont(v) {
    try { localStorage.setItem(TFONT_KEY, v); } catch (e) {}
  }

  var teacherFontSize = loadTeacherFont();

  function applyTeacherFontSize(size) {
    teacherFontSize = Math.min(TFONT_MAX, Math.max(TFONT_MIN, size));
    if (conversationEl) conversationEl.style.fontSize = teacherFontSize + 'px';
    saveTeacherFont(teacherFontSize);
  }

  applyTeacherFontSize(teacherFontSize);
  function zoomTeacher(size) {
    keepPlace(messagesEl, messagesEl.children, function () { return messagesEl.getBoundingClientRect().top; },
      function () { applyTeacherFontSize(size); });
  }

  if (teacherFontDec)   teacherFontDec.addEventListener('click',   function () { zoomTeacher(teacherFontSize - TFONT_STEP); });
  if (teacherFontReset) teacherFontReset.addEventListener('click', function () { zoomTeacher(TFONT_DEFAULT); });
  if (teacherFontInc)   teacherFontInc.addEventListener('click',   function () { zoomTeacher(teacherFontSize + TFONT_STEP); });

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
            if (parsed.lesson) setLessonState(parsed.lesson);
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
  // a Stop it is removed again and, if typed, put back in the input (nothing
  // was saved). A button's label is never put in the input.
  async function runTurn(body, userText) {
    if (isGenerating) return false;
    clearWelcomeBack();
    var userEl = userText ? addUserMessage(userText) : null;
    showTypingIndicator();
    setGenerating(true);
    try {
      await streamExchange(body);
      return true;
    } catch (err) {
      if (userEl) {
        userEl.remove();
        if (body.message) inputEl.value = userText;
      }
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
    hideOther();
    messagesEl.innerHTML = '';
    sessionActive = false;
    resetLessonView();
    var ok = await runTurn({ start: { mode: BOOT.entry.mode, section: BOOT.entry.section } });
    if (ok) { sessionActive = true; setGenerating(false); settleUrl(); inputEl.focus(); }
    else if (!messagesEl.querySelector('.engine-msg')) showRetry();
  }

  function showRetry() {
    showResumePanel('Ready when you are.', { begin: true });
  }

  // Redraws the saved transcript. Resolves to the saved session (with its lesson
  // state), or null when there is none.
  async function loadSaved() {
    var res  = await fetch(SESSION_URL);
    var data = await res.json();
    if (!data.success || !data.session) return null;
    (data.session.transcript || []).forEach(function (m) {
      if (m.role === 'assistant') addTeacherMessage(m.content); else addUserMessage(m.content);
    });
    return data.session;
  }

  // "Welcome back" note under the last Teacher message — on this page only:
  // never sent, never stored, gone as soon as the reader does anything.
  var welcomeEl = null;
  function clearWelcomeBack() {
    if (welcomeEl) { welcomeEl.remove(); welcomeEl = null; }
  }

  // "Pick up where we left off": NO AI call, for a lesson or a check. Redraw the
  // saved conversation, put the start of the last Teacher message at the top of
  // the conversation pane (briefly highlighted), move the study pane to the
  // saved section, and wait for the reader. Nothing is saved or changed.
  async function resumeSaved() {
    hideResume();
    messagesEl.innerHTML = '';
    clearWelcomeBack();
    var saved;
    try {
      saved = await loadSaved();
    } catch (err) {
      addSystemMsg('Your saved session couldn\'t be loaded. Please refresh and try again.');
      return;
    }
    if (!saved) { BOOT.saved = null; showRetry(); return; }   // deleted elsewhere
    setLessonState(saved);
    sessionActive = true;
    setGenerating(false);

    var teacherMsgs = messagesEl.querySelectorAll('.engine-msg');
    var last = teacherMsgs.length ? teacherMsgs[teacherMsgs.length - 1] : null;
    if (last) {
      welcomeEl = document.createElement('p');
      welcomeEl.className = 'teacher-welcome-back';
      welcomeEl.textContent = (KIND === 'check' && checkPhase === 'questions')
        ? 'Welcome back. This is where we stopped. Answer below when you\'re ready.'
        : 'Welcome back. This is where we stopped. Tap Continue when you\'re ready.';
      last.insertAdjacentElement('afterend', welcomeEl);
      messagesEl.scrollTop += last.getBoundingClientRect().top - messagesEl.getBoundingClientRect().top;
      last.classList.remove('teacher-msg-return');
      void last.offsetWidth;                  // restart the highlight animation
      last.classList.add('teacher-msg-return');
    }
    inputEl.focus({ preventScroll: true });
  }

  // "Teach me this section" with a lesson already saved: carry on in the SAME
  // lesson, moved to that section (no resume panel).
  async function jumpInSaved(n) {
    hideResume();
    messagesEl.innerHTML = '';
    try {
      if (!(await loadSaved())) { await startNew(); return; }   // no lesson to move: begin one at N
    } catch (err) {
      addSystemMsg('Your saved session couldn\'t be loaded. Please refresh and try again.');
      return;
    }
    sessionActive = true;
    var title = sections[n - 1] ? sections[n - 1].title : '';
    var ok = await runTurn({ action: 'jump', section: n }, 'Teach me this section: ' + title);
    setGenerating(false);
    if (ok) { settleUrl(); inputEl.focus(); }
  }

  function hideResume() { resumePanel.style.display = 'none'; }

  // The resume panel doubles as the "begin" panel after a delete or a failed start.
  function showResumePanel(text, opts) {
    resumeText.textContent = text;
    resumeBtn.textContent  = opts.begin ? 'Begin' : 'Pick up where we left off';
    startOverBtn.style.display = opts.begin ? 'none' : '';
    deleteBtn.style.display    = opts.begin ? 'none' : '';
    resumeBtn.onclick = opts.begin ? startNew : resumeSaved;
    resumePanel.style.display = 'block';
  }

  function startOverLabel() {
    if (KIND === 'check') return 'Start a fresh understanding check';
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
  inputEl.addEventListener('input', clearWelcomeBack);
  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(inputEl.value); }
  });
  // Reader controls. Only the known actions are sent; the server checks
  // them again.
  function sendAction(action) {
    if (!Object.prototype.hasOwnProperty.call(ACTION_LABELS, action)) return;
    if (isGenerating || !sessionActive) return;
    runTurn({ action: action }, ACTION_LABELS[action]);
  }
  quickBtns.forEach(function (b) {
    b.addEventListener('click', function () { sendAction(b.getAttribute('data-action')); });
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
    clearWelcomeBack();
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
        showCompleteOffer();
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

  // "Ready to mark this study complete?" — offered on the review of the member's
  // OWN study while it isn't completed. Only their click marks it (the server
  // checks ownership too); afterwards it reads "Completed · <date>" with Undo.
  var completeOffer = document.getElementById('teacherCompleteOffer');
  var completedAt   = BOOT.completedAt || null;
  var completeBusy  = false;

  function renderCompleteOffer() {
    if (!completeOffer) return;
    completeOffer.textContent = '';
    if (!completedAt) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'study-complete-btn';
      btn.textContent = 'Ready to mark this study complete?';
      btn.addEventListener('click', function () { changeCompletion(true); });
      completeOffer.appendChild(btn);
      return;
    }
    var done = document.createElement('span');
    done.className = 'study-complete-done';
    done.textContent = '✓ Completed · ' + window.IronInkTeacher.formatCompletedDate(completedAt);
    var undo = document.createElement('button');
    undo.type = 'button';
    undo.className = 'study-complete-undo';
    undo.textContent = 'Undo';
    undo.addEventListener('click', function () { changeCompletion(false); });
    completeOffer.appendChild(done);
    completeOffer.appendChild(undo);
  }

  function changeCompletion(completed) {
    if (completeBusy || !window.IronInkTeacher) return;
    completeBusy = true;
    completeOffer.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
    window.IronInkTeacher.setCompletion(BOOT.studyId, completed)
      .then(function (at) { completedAt = at; })
      .catch(function (err) { showAlertSafe(err.message || 'Could not update this study. Please try again.'); })
      .then(function () { completeBusy = false; renderCompleteOffer(); });
  }

  function showAlertSafe(msg) {
    if (typeof window.showAlert === 'function') window.showAlert(msg); else window.alert(msg);
  }

  // Shown with a review only when the member owns the study and it isn't
  // completed yet (once marked here, it stays visible so Undo is at hand).
  var offerShown = false;
  function showCompleteOffer() {
    if (!completeOffer || !BOOT.isOwner || !window.IronInkTeacher) return;
    if (!completedAt) offerShown = true;
    completeOffer.hidden = !offerShown;
    if (offerShown) renderCompleteOffer();
  }

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

  // "I'm done with this session": off the in-progress list (done: true), the
  // conversation stays saved; then back to the study, like Back.
  var doneBtn = document.getElementById('teacherDoneBtn');
  var doneBusy = false;
  if (doneBtn) {
    doneBtn.addEventListener('click', async function () {
      if (doneBusy) return;
      doneBusy = true;
      doneBtn.disabled = true;
      try {
        var res  = await fetch('/api/teacher/' + encodeURIComponent(BOOT.studyId) + '/session/done?kind=' + KIND, { method: 'PUT' });
        var data = await res.json();
        if (!data.success) throw new Error();
        closeReview();
        window.location.href = BOOT.isOwner
          ? '/library?open=' + encodeURIComponent(BOOT.studyId)
          : '/community?study=' + encodeURIComponent(BOOT.studyId);
      } catch (err) {
        doneBusy = false;
        doneBtn.disabled = false;
        showAlertSafe('This session couldn\'t be marked done. Please try again.');
      }
    });
  }

  reviewDeleteBtn.addEventListener('click', function () {
    confirmThen('Delete your saved session for this study?', 'Delete', function () {
      deleteSaved(function () {
        window.location.href = backLink ? backLink.getAttribute('href') : '/library';
      });
    });
  });

  // ── Boot ─────────────────────────────────────────────────────────────────
  setGenerating(false);
  if (BOOT.saved && KIND === 'lesson' && BOOT.entry.mode === 'section' && BOOT.entry.section) {
    // Mark where the lesson was, without moving the pane off the chosen section.
    var jumpTo = BOOT.entry.section;
    shownSection = parseInt(BOOT.saved.currentSection, 10) || 0;
    setLessonState(BOOT.saved);
    shownSection = jumpTo;
    jumpInSaved(jumpTo);
    showAlso();
  } else if (BOOT.saved) {
    setLessonState(BOOT.saved);
    startOverBtn.textContent = startOverLabel();
    // The line comes from the server (routes/teacher.js resumeText).
    showResumePanel(BOOT.saved.resumeText || 'Last time we had just started the lesson.', { begin: false });
    showAlso();
  } else if (KIND === 'lesson' && OTHER) {
    // No saved lesson, but a saved understanding check: ask first.
    showOtherPanel();
  } else if (BOOT.entry && BOOT.entry.resume) {
    // Came here to pick a session up (a "saved session" link), but it is gone:
    // offer to begin rather than starting one unasked.
    showRetry();
    showAlso();
  } else {
    showAlso();   // a check that starts at once: the line sits under the header
    startNew();
  }

})();
