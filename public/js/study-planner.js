(function () {
  'use strict';

  // Plan a Study — the planning conversation beside the study creator on /study.
  // The streaming client is the Tutor/Teacher page's (public/js/teacher.js:
  // streamExchange / setGenerating / typing indicator / A-/A/A+ zoom), but
  // nothing is saved on the server: the conversation lives in this browser
  // (localStorage, so a refresh doesn't lose it) until the member clicks Start
  // fresh or it expires (STORE_TTL_MS). Building a study keeps it, so the member
  // can come back for the next study in a plan. Nothing goes to the Library.
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
    // plan:      the planned sequence (2-4 studies) the member is building from —
    //            shown above the input as "Next in your plan".
    // built:     keys (planKey) of studies already filled into the creator, so
    //            their Build buttons are marked "Built" everywhere they appear.
    var state = loadState();
    var abortController = null;
    var isGenerating    = false;
    var isBuilding      = false;

    function emptyState() { return { messages: [], plan: [], built: [], open: false, at: Date.now() }; }

    function loadState() {
      try {
        var s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
        if (s && Array.isArray(s.messages) && (Date.now() - (s.at || 0)) < STORE_TTL_MS) {
          // v1 stored only the unbuilt rest of a sequence as "remaining".
          if (!Array.isArray(s.plan)) s.plan = Array.isArray(s.remaining) ? s.remaining : [];
          if (!Array.isArray(s.built)) s.built = [];
          delete s.remaining;
          return s;
        }
      } catch (e) {}
      return emptyState();
    }

    function saveState() {
      state.at = Date.now();
      try {
        if (!state.messages.length && !state.plan.length && !state.open) localStorage.removeItem(STORE_KEY);
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
    // server. Labels and subject go in via textContent only. A study already
    // built is marked (check + "Built") but stays clickable to fill it in again.
    function planKey(p) {
      return [p.type, p.level || '', String(p.subject || '').toLowerCase()].join('|');
    }
    function isBuilt(p) { return state.built.indexOf(planKey(p)) !== -1; }

    function buildButton(plan, sequence, index) {
      var built = isBuilt(plan);
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'plan-build-option' + (built ? ' is-built' : '');
      if (built) b.title = 'Already filled into the study creator — click to fill it in again';
      var head = document.createElement('span');
      head.className = 'plan-build-option-head';
      head.textContent = (built ? '✓ ' : '') + (sequence.length > 1 ? (index + 1) + '. ' : '') +
        (built ? 'Built: ' : 'Build: ') + plan.subject;
      var meta = document.createElement('span');
      meta.className = 'plan-build-option-meta';
      meta.textContent = plan.typeLabel + (plan.levelLabel ? ' · ' + plan.levelLabel : '') + (built ? ' · Built' : '');
      b.appendChild(head);
      b.appendChild(meta);
      b.addEventListener('click', function () { applyPlan(plan, sequence); });
      return b;
    }

    // ── Save to Ideas ──────────────────────────────────────────────────────
    // An unbuilt planned study can go to the member's Study Ideas
    // (routes/study-ideas.js) instead: its subject becomes the idea's title,
    // with its type and level. The server skips a title already listed.
    function postIdea(plan) {
      return fetch('/api/study-ideas', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ title: plan.subject, type: plan.type || null, level: plan.level || null }),
      }).then(function (r) {
        return r.json().catch(function () { return null; }).then(function (data) {
          if (!data || !data.success) throw new Error((data && data.error) || 'That couldn\'t be saved to your Study Ideas. Please try again.');
          return data;
        });
      });
    }

    // One at a time, in plan order; resolves to the saved ideas' results.
    function saveIdeas(plans) {
      var results = [];
      return plans.reduce(function (p, plan) {
        return p.then(function () { return postIdea(plan).then(function (d) { results.push(d); }); });
      }, Promise.resolve()).then(function () { return results; }, function (err) {
        refreshIdeas();   // any saved before the failure still show
        throw err;
      });
    }

    function refreshIdeas() {
      if (window.__ironStudyIdeas) window.__ironStudyIdeas.refresh();
    }

    function saveIdeaButton(plan) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'plan-save-idea-btn';
      b.textContent = 'Save to Ideas';
      b.title = 'Keep this study in your Study Ideas for later';
      b.addEventListener('click', function () {
        if (b.disabled) return;
        b.disabled = true;
        b.textContent = 'Saving…';
        saveIdeas([plan]).then(function (results) {
          refreshIdeas();
          b.textContent = (results[0] && results[0].existing) ? '✓ Already in Study Ideas' : '✓ Saved to Study Ideas';
          setTimeout(function () { b.textContent = 'Save to Ideas'; b.disabled = false; }, 2500);
        }).catch(function (err) {
          b.textContent = 'Save to Ideas';
          b.disabled = false;
          addSystemMsg(err.message);
        });
      });
      return b;
    }

    // A Build button, with Save to Ideas beside it while it isn't built yet.
    function buildRow(plan, sequence, index) {
      var row = document.createElement('div');
      row.className = 'plan-build-row';
      row.appendChild(buildButton(plan, sequence, index));
      if (!isBuilt(plan)) row.appendChild(saveIdeaButton(plan));
      return row;
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
      plans.forEach(function (plan, i) { wrap.appendChild(buildRow(plan, plans, i)); });
      return wrap;
    }

    // Buttons under a planner reply that offered a plan.
    function attachBuilds(msgEl, builds) {
      if (!builds || !builds.length) return;
      msgEl.appendChild(buildList(builds, builds.length > 1 ? 'Your study plan — build them one at a time:' : null));
      scrollChat();
    }

    // The area above the input: the planned sequence ("Next in your plan"),
    // set when a study is built from a sequence or "Build this study" returns one.
    function showBuildsArea(plans, label) {
      buildsEl.innerHTML = '';
      if (!plans || !plans.length) { buildsEl.style.display = 'none'; return; }
      buildsEl.appendChild(buildList(plans, label));
      buildsEl.style.display = '';
    }

    function applyPlan(plan, sequence) {
      if (isGenerating || isBuilding) return;
      var creator = window.__ironStudyCreator;
      if (!creator || !creator.fill(plan)) {
        addSystemMsg('The study creator couldn\'t be filled in. Please refresh the page and try again.');
        return;
      }
      // Building keeps the conversation: the member can come back for the next
      // study, or keep talking. The study is marked Built, and a sequence it came
      // from becomes "Next in your plan". Only Start fresh (or expiry) clears it.
      if (!isBuilt(plan)) state.built = state.built.concat([planKey(plan)]).slice(-50);
      if (sequence && sequence.length > 1) state.plan = sequence;
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
      var anyBuilt = state.plan.some(isBuilt);
      showBuildsArea(state.plan, anyBuilt ? 'Next in your plan:' : 'Your study plan — build them one at a time:');
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
        else { state.plan = data.studies; saveState(); render(); }
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

    // The studies in the current plan not built yet: the planned sequence
    // ("Next in your plan") if there is one, else the Build buttons under the
    // latest reply that offered any. One per subject.
    function unbuiltPlans() {
      var source = state.plan;
      if (!source.length) {
        for (var i = state.messages.length - 1; i >= 0; i--) {
          var m = state.messages[i];
          if (m.role === 'assistant' && Array.isArray(m.builds) && m.builds.length) { source = m.builds; break; }
        }
      }
      var seen = {};
      return (source || []).filter(function (p) {
        var k = String(p && p.subject || '').toLowerCase();
        if (!k || seen[k] || isBuilt(p)) return false;
        seen[k] = true;
        return true;
      });
    }

    function saveUnbuiltAndStartFresh(plans) {
      freshBtn.disabled = true;
      saveIdeas(plans).then(function () {
        refreshIdeas();
        startFresh();
        addSystemMsg('Saved to Study Ideas: ' + plans.map(function (p) { return '“' + p.subject + '”'; }).join(', ') + '.');
      }).catch(function (err) {
        syncControls();
        addSystemMsg((err && err.message ? err.message + ' ' : '') + 'Your conversation was kept, so you can try again.');
      });
    }

    freshBtn.addEventListener('click', function () {
      if (!state.messages.length && !state.plan.length) { startFresh(); return; }
      var msg = 'Start fresh? This planning conversation will be cleared.';
      var unbuilt = unbuiltPlans();
      if (unbuilt.length && typeof showChoice === 'function') {
        msg += '\n\nNot built yet:\n' + unbuilt.map(function (p) { return '• ' + p.subject; }).join('\n');
        showChoice(msg, [
          { label: 'Save them to Study Ideas and start fresh', primary: true, onClick: function () { saveUnbuiltAndStartFresh(unbuilt); } },
          { label: 'Start fresh without saving', onClick: startFresh },
          { label: 'Cancel', cancel: true, onClick: function () {} },
        ]);
        return;
      }
      if (typeof showConfirm === 'function') showConfirm(msg, 'Start fresh', startFresh, function () {});
      else if (window.confirm(msg)) startFresh();
    });

    // ── Boot ───────────────────────────────────────────────────────────────
    render();
    // Reopen after a refresh when there's a conversation (or plan) in progress.
    if (state.open && (state.messages.length || state.plan.length)) setOpen(true, false);
    else if (state.open) { state.open = false; saveState(); }

    // "Plan it" on a Study Idea (study-ideas.js): open the planner with the
    // idea waiting in the box — never sent on its own. Text the member had
    // already typed is kept, with the idea after it.
    window.__ironStudyPlanner = {
      prefill: function (text) {
        text = String(text || '').trim().slice(0, 4000);
        if (!text) return false;
        setOpen(true, true);
        var had = inputEl.value.trim();
        inputEl.value = had && had !== text ? (had + '\n\n' + text).slice(0, 4000) : text;
        try { inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length); } catch (e) {}
        return true;
      },
    };

    // ?plan=<area> — the Study Map's "Plan a study" link on an area not studied
    // yet. Opens the planner with that area as the starting idea, waiting in the
    // box for the member to send (or change). Nothing is sent on its own, and an
    // existing conversation is kept. The parameter is dropped from the address
    // so a refresh doesn't fill the box again.
    var planIdea = '';
    try { planIdea = (new URLSearchParams(window.location.search).get('plan') || '').replace(/\s+/g, ' ').trim().slice(0, 80); } catch (e) {}
    if (planIdea) {
      try {
        var u = new URL(window.location.href);
        u.searchParams.delete('plan');
        window.history.replaceState(null, '', u.pathname + u.search + u.hash);
      } catch (e) {}
      setOpen(true, true);
      if (!inputEl.value.trim()) {
        inputEl.value = 'I haven\'t studied ' + planIdea + ' yet. Could you help me plan a study in that area?';
      }
    }
  }

  // PLANNER_BOOT is assigned by an inline script after this file — wait for it.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
