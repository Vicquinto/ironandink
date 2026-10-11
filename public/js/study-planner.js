(function () {
  'use strict';

  // Plan a Study — the planning conversation beside the study creator on /study.
  // The streaming client is the Tutor/Teacher page's (public/js/teacher.js:
  // streamExchange / setGenerating / typing indicator / A-/A/A+ zoom), but
  // nothing is saved on the server: the conversation lives in this browser
  // (localStorage, so a refresh doesn't lose it) only until the member builds a
  // study or clicks Start fresh. Nothing goes to the Library.
  //
  // "Build" fills the study creator through study.js's bridge
  // (window.__ironStudyCreator.fill); the member reviews and clicks Generate.

  var GENERIC_ERROR = 'The planner couldn\'t respond. Please try again.';
  var BUILD_ERROR   = 'The study couldn\'t be built just now. Please try again.';
  var GREETING = 'What would you like to study? Tell me what\'s on your mind — a passage, a question, a person, a doctrine, or just a hunch — and we\'ll shape it into a study together.';
  var STORE_TTL_MS = 7 * 24 * 60 * 60 * 1000;   // an abandoned plan is dropped after a week

  function init() {
    var openBtn     = document.getElementById('planStudyBtn');
    var panel       = document.getElementById('planPanel');
    var row         = document.getElementById('studyCreatorRow');
    var messagesEl  = document.getElementById('planMessages');
    var buildsEl    = document.getElementById('planBuilds');
    var inputEl     = document.getElementById('planInput');
    var sendBtn     = document.getElementById('planSendBtn');
    var stopBtn     = document.getElementById('planStopBtn');
    var buildBtn    = document.getElementById('planBuildBtn');
    var freshBtn    = document.getElementById('planFreshBtn');
    var closeBtn    = document.getElementById('planCloseBtn');
    if (!openBtn || !panel || !messagesEl || !inputEl) return;

    var BOOT = window.PLANNER_BOOT || {};
    var STORE_KEY = 'ironink_study_plan_v1:' + (BOOT.userKey || 'me');

    // ── State (held in the browser only) ───────────────────────────────────
    // messages:  [{ role, content, display?, builds? }] — content is what goes
    //            back to the server (verse markers raw, tags stripped); display
    //            is what was shown; builds are a reply's validated Build buttons.
    // remaining: the rest of a planned sequence after one study was built.
    var state = loadState();
    var abortController = null;
    var isGenerating    = false;
    var isBuilding      = false;

    function emptyState() { return { messages: [], remaining: [], open: false, at: Date.now() }; }

    function loadState() {
      try {
        var s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
        if (s && Array.isArray(s.messages) && (Date.now() - (s.at || 0)) < STORE_TTL_MS) {
          if (!Array.isArray(s.remaining)) s.remaining = [];
          return s;
        }
      } catch (e) {}
      return emptyState();
    }

    function saveState() {
      state.at = Date.now();
      try {
        if (!state.messages.length && !state.remaining.length && !state.open) localStorage.removeItem(STORE_KEY);
        else localStorage.setItem(STORE_KEY, JSON.stringify(state));
      } catch (e) { /* storage full or blocked — the conversation still works in this tab */ }
    }

    // ── Conversation zoom ──────────────────────────────────────────────────
    // The Tutor/Teacher page's TFONT_* pattern under its OWN key: sets the
    // panel's font-size; messages and input are em-based (styles.css).
    var PFONT_DEFAULT = 16, PFONT_MIN = 12, PFONT_MAX = 28, PFONT_STEP = 2;
    var PFONT_KEY = 'ironink_planner_conversation_font_size';
    var planFontSize = (function () {
      try {
        var v = parseInt(localStorage.getItem(PFONT_KEY), 10);
        if (v) return Math.min(PFONT_MAX, Math.max(PFONT_MIN, v));
      } catch (e) {}
      return PFONT_DEFAULT;
    })();
    function applyPlanFontSize(size) {
      planFontSize = Math.min(PFONT_MAX, Math.max(PFONT_MIN, size));
      panel.style.fontSize = planFontSize + 'px';
      try { localStorage.setItem(PFONT_KEY, planFontSize); } catch (e) {}
    }
    applyPlanFontSize(planFontSize);
    var fontDec = document.getElementById('planFontDec');
    var fontReset = document.getElementById('planFontReset');
    var fontInc = document.getElementById('planFontInc');
    if (fontDec)   fontDec.addEventListener('click',   function () { applyPlanFontSize(planFontSize - PFONT_STEP); });
    if (fontReset) fontReset.addEventListener('click', function () { applyPlanFontSize(PFONT_DEFAULT); });
    if (fontInc)   fontInc.addEventListener('click',   function () { applyPlanFontSize(planFontSize + PFONT_STEP); });

    // ── Rendering (escape-first, then sanitized) ───────────────────────────
    function esc(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    // teacher.js's renderTeacherText: everything is escaped BEFORE any markup is
    // added, and the result still passes through the shared sanitizer.
    function renderPlannerText(text) {
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

    function scrollChat() { messagesEl.scrollTop = messagesEl.scrollHeight; }

    function addPlannerMessage(text) {
      var div = document.createElement('div');
      div.className = 'chat-msg engine-msg';
      div.innerHTML = '<div class="msg-role">Planner</div><div class="msg-content"></div>';
      div.querySelector('.msg-content').innerHTML = renderPlannerText(text);
      messagesEl.appendChild(div);
      scrollChat();
      return div;
    }

    function addUserMessage(text) {
      var div = document.createElement('div');
      div.className = 'chat-msg user-msg';
      div.innerHTML = '<div class="msg-role">You</div><div class="msg-content"></div>';
      div.querySelector('.msg-content').textContent = text;
      messagesEl.appendChild(div);
      scrollChat();
      return div;
    }

    function addSystemMsg(text) {
      var div = document.createElement('div');
      div.className = 'chat-msg system-msg';
      div.innerHTML = '<div class="msg-content"></div>';
      div.querySelector('.msg-content').textContent = text;
      messagesEl.appendChild(div);
      scrollChat();
      return div;
    }

    function showTypingIndicator() {
      hideTypingIndicator();
      var div = document.createElement('div');
      div.id        = 'planTyping';
      div.className = 'chat-msg engine-msg';
      div.innerHTML =
        '<div class="msg-role">Planner</div>' +
        '<div class="typing-indicator">' +
          '<span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>' +
        '</div>';
      messagesEl.appendChild(div);
      scrollChat();
    }

    function hideTypingIndicator() {
      var ind = document.getElementById('planTyping');
      if (ind) ind.remove();
    }

    // ── Build buttons ──────────────────────────────────────────────────────
    // A plan is { type, typeLabel, level, levelLabel, subject } — validated on the
    // server. Labels and subject go in via textContent only.
    function buildButton(plan, sequence, index) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'plan-build-option';
      var head = document.createElement('span');
      head.className = 'plan-build-option-head';
      head.textContent = (sequence.length > 1 ? (index + 1) + '. ' : '') + 'Build: ' + plan.subject;
      var meta = document.createElement('span');
      meta.className = 'plan-build-option-meta';
      meta.textContent = plan.typeLabel + (plan.levelLabel ? ' · ' + plan.levelLabel : '');
      b.appendChild(head);
      b.appendChild(meta);
      b.addEventListener('click', function () { applyPlan(plan, sequence); });
      return b;
    }

    function buildList(plans, label) {
      var wrap = document.createElement('div');
      wrap.className = 'plan-build-list';
      if (label) {
        var p = document.createElement('p');
        p.className = 'plan-build-list-label';
        p.textContent = label;
        wrap.appendChild(p);
      }
      plans.forEach(function (plan, i) { wrap.appendChild(buildButton(plan, plans, i)); });
      return wrap;
    }

    // Buttons under a planner reply that offered a plan.
    function attachBuilds(msgEl, builds) {
      if (!builds || !builds.length) return;
      msgEl.appendChild(buildList(builds, builds.length > 1 ? 'Your study plan — build them one at a time:' : null));
      scrollChat();
    }

    // The area above the input: the rest of a sequence after one was built, or
    // the result of "Build this study".
    function showBuildsArea(plans, label) {
      buildsEl.innerHTML = '';
      if (!plans || !plans.length) { buildsEl.style.display = 'none'; return; }
      buildsEl.appendChild(buildList(plans, label));
      buildsEl.style.display = '';
    }

    function samePlan(a, b) {
      return a && b && a.subject === b.subject && a.type === b.type && a.level === b.level;
    }

    function applyPlan(plan, sequence) {
      if (isGenerating || isBuilding) return;
      var creator = window.__ironStudyCreator;
      if (!creator || !creator.fill(plan)) {
        addSystemMsg('The study creator couldn\'t be filled in. Please refresh the page and try again.');
        return;
      }
      // Built → the conversation ends here (nothing is kept). The rest of a planned
      // sequence stays as Build buttons until it's built or Start fresh.
      state.messages  = [];
      state.remaining = (sequence || []).filter(function (p) { return !samePlan(p, plan); });
      saveState();
      render();
      addSystemMsg('Filled in the study creator: “' + plan.subject + '” — ' + plan.typeLabel +
        (plan.levelLabel ? ', ' + plan.levelLabel : '') + '. Review it and click Generate Study.');

      // Show the member the filled-in creator (it's above the panel when stacked).
      var gen = document.getElementById('generateBtn');
      var creatorEl = document.getElementById('studyCreator');
      if (creatorEl && creatorEl.scrollIntoView) creatorEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      if (gen) { try { gen.focus({ preventScroll: true }); } catch (e) { gen.focus(); } }
    }

    // ── Whole-panel render from state ──────────────────────────────────────
    function render() {
      messagesEl.innerHTML = '';
      addPlannerMessage(GREETING);
      state.messages.forEach(function (m) {
        if (m.role === 'user') addUserMessage(m.content);
        else attachBuilds(addPlannerMessage(m.display || m.content), m.builds);
      });
      showBuildsArea(state.remaining, state.remaining.length ? 'Next in your plan:' : null);
      syncControls();
    }

    function hasMemberTurn() {
      return state.messages.some(function (m) { return m.role === 'user'; });
    }

    function syncControls() {
      var busy = isGenerating || isBuilding;
      stopBtn.style.display = isGenerating ? 'inline-block' : 'none';
      sendBtn.disabled  = busy;
      inputEl.disabled  = busy;
      buildBtn.disabled = busy || !hasMemberTurn();
      freshBtn.disabled = busy;
    }

    // ── Open / close ───────────────────────────────────────────────────────
    function setOpen(open, focus) {
      state.open = !!open;
      panel.hidden = !open;
      if (row) row.classList.toggle('is-planning', !!open);
      openBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      openBtn.classList.toggle('is-active', !!open);
      saveState();
      if (open) {
        scrollChat();
        if (focus) {
          if (panel.scrollIntoView) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          try { inputEl.focus({ preventScroll: true }); } catch (e) { inputEl.focus(); }
        }
      }
    }

    openBtn.addEventListener('click', function () { setOpen(panel.hidden, true); });
    closeBtn.addEventListener('click', function () { setOpen(false); openBtn.focus(); });

    // ── Streaming exchange ─────────────────────────────────────────────────
    // POST /api/planner/exchange with the whole conversation; resolves to
    // { display, raw, builds }. Pre-stream failures arrive as short JSON errors.
    async function streamExchange(messages) {
      abortController = new AbortController();
      var msgEl = null;
      try {
        var response = await fetch('/api/planner/exchange', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ messages: messages }),
          signal:  abortController.signal,
        });

        if (!response.ok) {
          var info = null;
          try { info = await response.json(); } catch (e) { /* not JSON */ }
          if (response.status === 402 && info && info.upgradeUrl) { window.location.href = info.upgradeUrl; }
          throw new Error((info && info.error && info.error !== 'member_feature') ? info.error : GENERIC_ERROR);
        }

        hideTypingIndicator();
        msgEl = addPlannerMessage('');
        msgEl.classList.add('streaming');
        var contentEl = msgEl.querySelector('.msg-content');

        var reader   = response.body.getReader();
        var decoder  = new TextDecoder();
        var buffer   = '';
        var fullText = '';
        var done     = null;

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
              if (parsed.done) { done = parsed; continue; }
              if (parsed.text) {
                fullText += parsed.text;
                contentEl.innerHTML = renderPlannerText(fullText);
                scrollChat();
              }
            }
          }
        }

        if (!fullText || !done || typeof done.raw !== 'string') throw new Error(GENERIC_ERROR);
        msgEl.classList.remove('streaming');
        return { el: msgEl, display: fullText, raw: done.raw, builds: Array.isArray(done.builds) ? done.builds : [] };
      } catch (err) {
        hideTypingIndicator();
        if (msgEl) msgEl.remove();
        throw err;
      }
    }

    async function send(text) {
      text = String(text || '').trim();
      if (!text || isGenerating || isBuilding) return;
      if (text.length > 4000) { addSystemMsg('That message is too long. Please shorten it.'); return; }

      inputEl.value = '';
      state.messages.push({ role: 'user', content: text });
      saveState();
      var userEl = addUserMessage(text);
      showTypingIndicator();
      isGenerating = true;
      syncControls();

      try {
        var reply = await streamExchange(state.messages.map(function (m) { return { role: m.role, content: m.content }; }));
        state.messages.push({ role: 'assistant', content: reply.raw, display: reply.display, builds: reply.builds });
        saveState();
        attachBuilds(reply.el, reply.builds);
      } catch (err) {
        // Nothing came back (an error or Stop): take the message back out and put
        // it in the box again, so the transcript never ends on an unanswered turn.
        state.messages.pop();
        saveState();
        userEl.remove();
        inputEl.value = text;
        if (err.name !== 'AbortError') addSystemMsg(err.message || GENERIC_ERROR);
      } finally {
        isGenerating = false;
        abortController = null;
        syncControls();
        if (!panel.hidden) { try { inputEl.focus({ preventScroll: true }); } catch (e) {} }
      }
    }

    sendBtn.addEventListener('click', function () { send(inputEl.value); });
    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(inputEl.value); }
    });
    stopBtn.addEventListener('click', function () { if (abortController) abortController.abort(); });

    // ── Build this study (anytime) ─────────────────────────────────────────
    buildBtn.addEventListener('click', async function () {
      if (isGenerating || isBuilding || !hasMemberTurn()) return;
      isBuilding = true;
      buildBtn.textContent = 'Building…';
      syncControls();
      try {
        var res = await fetch('/api/planner/build', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ messages: state.messages.map(function (m) { return { role: m.role, content: m.content }; }) }),
        });
        var data = null;
        try { data = await res.json(); } catch (e) { /* not JSON */ }
        if (res.status === 402 && data && data.upgradeUrl) { window.location.href = data.upgradeUrl; return; }
        if (!data || !data.success || !Array.isArray(data.studies) || !data.studies.length) {
          addSystemMsg((data && data.error && data.error !== 'member_feature') ? data.error : BUILD_ERROR);
          return;
        }
        isBuilding = false;
        if (data.studies.length === 1) applyPlan(data.studies[0], data.studies);
        else showBuildsArea(data.studies, 'Your study plan — build them one at a time:');
      } catch (err) {
        addSystemMsg(BUILD_ERROR);
      } finally {
        isBuilding = false;
        buildBtn.textContent = 'Build this study';
        syncControls();
      }
    });

    // ── Start fresh ────────────────────────────────────────────────────────
    function startFresh() {
      if (abortController) abortController.abort();
      var open = state.open;
      state = emptyState();
      state.open = open;
      saveState();
      inputEl.value = '';
      render();
      try { inputEl.focus({ preventScroll: true }); } catch (e) {}
    }

    freshBtn.addEventListener('click', function () {
      if (!state.messages.length && !state.remaining.length) { startFresh(); return; }
      var msg = 'Start fresh? This planning conversation will be cleared.';
      if (typeof showConfirm === 'function') showConfirm(msg, 'Start fresh', startFresh, function () {});
      else if (window.confirm(msg)) startFresh();
    });

    // ── Boot ───────────────────────────────────────────────────────────────
    render();
    // Reopen after a refresh when there's a conversation (or plan) in progress.
    if (state.open && (state.messages.length || state.remaining.length)) setOpen(true, false);
    else if (state.open) { state.open = false; saveState(); }
  }

  // PLANNER_BOOT is assigned by an inline script after this file — wait for it.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
