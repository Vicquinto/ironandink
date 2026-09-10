(function () {
  'use strict';

  // ── State ─────────────────────────────────────────────────────────────────
  var selectedTier         = 0;
  var selectedForm         = '';
  var answers              = [];
  var currentArticleId     = null;
  var currentArticleStatus = 'Draft';

  // ── Conversation state (Step 3) ───────────────────────────────────────────
  // Mirrors Dialogue's streaming client. conversationHistory is the running
  // [{role, content}] array sent to /api/writing/converse each turn.
  var conversationHistory     = [];
  var writingAbortController  = null;
  var isConverseGenerating    = false;

  // NOTE (redesign): the five defining questions and their generate step were
  // removed from the live flow. Picking a "door" now lands the user in the blank
  // editor; AI generation is being rebuilt as a conversation in a later phase.
  // `generateArticle()` below is left defined but is no longer called by anything.

  // ── DOM refs ──────────────────────────────────────────────────────────────
  var writingMain     = document.getElementById('writingMain');
  var writingEditor   = document.getElementById('writingEditor');
  var writingLoading  = document.getElementById('writingLoading');
  var writingModal    = document.getElementById('writingModal');
  var beginArticleBtn = document.getElementById('beginArticleBtn');
  var articleList     = document.getElementById('articleList');

  var wModalStep0           = document.getElementById('wModalStep0');
  var wModalStep1           = document.getElementById('wModalStep1');
  var formContinueBtn       = document.getElementById('formContinueBtn');
  var cancelFormModalBtn    = document.getElementById('cancelFormModalBtn');
  var tierContinueBtn       = document.getElementById('tierContinueBtn');
  var doorsBackBtn          = document.getElementById('doorsBackBtn');
  var closeWritingModalBtn  = document.getElementById('closeWritingModalBtn');

  var editorTitle       = document.getElementById('editorTitle');
  var editorContent     = document.getElementById('editorContent');
  var editorTierBadge   = document.getElementById('editorTierBadge');
  var editorWordCount   = document.getElementById('editorWordCount');
  var saveDraftBtn      = document.getElementById('saveDraftBtn');
  var markCompleteBtn   = document.getElementById('markCompleteBtn');
  var startOverBtn      = document.getElementById('startOverBtn');
  var writingLoadingText = document.getElementById('writingLoadingText');

  // Conversation pane refs (wired in the "Writing conversation" section below).
  var conversationMessages = document.getElementById('conversationMessages');
  var conversationInput    = document.getElementById('conversationInput');
  var conversationSendBtn  = document.getElementById('conversationSendBtn');
  var conversationStopBtn  = document.getElementById('conversationStopBtn');
  var conversationDraftBtn = document.getElementById('conversationDraftBtn');

  // ── State control ─────────────────────────────────────────────────────────
  function showState(state) {
    writingMain.style.display    = 'none';
    writingEditor.style.display  = 'none';
    writingLoading.style.display = 'none';
    writingModal.style.display   = 'none';

    if (state === 'main') {
      writingMain.style.display = 'block';
    } else if (state === 'editor') {
      writingEditor.style.display = 'block';
    } else if (state === 'loading') {
      writingLoading.style.display = 'flex';
    } else if (state === 'modal') {
      writingMain.style.display  = 'block';
      writingModal.style.display = 'flex';
    }
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() {
    loadArticleList();
    var params    = new URLSearchParams(window.location.search);
    var articleId = params.get('article');
    if (articleId) openArticleById(articleId);
  }

  // ── Begin New Article ─────────────────────────────────────────────────────
  beginArticleBtn.addEventListener('click', function () {
    selectedTier = 0;
    selectedForm = '';
    document.querySelectorAll('input[name="writingForm"]').forEach(function (r) { r.checked = false; });
    document.querySelectorAll('input[name="writingTier"]').forEach(function (r) { r.checked = false; });
    if (formContinueBtn) formContinueBtn.disabled = true;
    tierContinueBtn.disabled = true;
    wModalStep0.style.display = 'block';
    wModalStep1.style.display = 'none';
    showState('modal');
  });

  // ── Close / cancel modal ──────────────────────────────────────────────────
  function closeModal() { showState('main'); }
  if (cancelFormModalBtn) cancelFormModalBtn.addEventListener('click', closeModal);
  closeWritingModalBtn.addEventListener('click', closeModal);

  // Back from the "Where would you like to begin?" doors → genre picker (Step 0).
  if (doorsBackBtn) {
    doorsBackBtn.addEventListener('click', function () {
      wModalStep1.style.display = 'none';
      wModalStep0.style.display = 'block';
    });
  }

  // ── Form selection (Step 0) ───────────────────────────────────────────────
  document.querySelectorAll('input[name="writingForm"]').forEach(function (radio) {
    radio.addEventListener('change', function () {
      selectedForm = radio.value;
      if (formContinueBtn) formContinueBtn.disabled = false;
    });
  });

  if (formContinueBtn) {
    formContinueBtn.addEventListener('click', function () {
      if (!selectedForm) return;
      wModalStep0.style.display = 'none';
      wModalStep1.style.display = 'block';
    });
  }

  // ── Tier selection (Step 1) ───────────────────────────────────────────────
  document.querySelectorAll('input[name="writingTier"]').forEach(function (radio) {
    radio.addEventListener('change', function () {
      selectedTier = parseInt(radio.value, 10);
      tierContinueBtn.disabled = false;
    });
  });

  // ── Doors → blank editor ──────────────────────────────────────────────────
  // New flow: choosing a "how to begin" door skips the old questions/generate
  // step and drops the user straight into a blank editor, carrying the selected
  // genre (selectedForm) and door (selectedTier) through for the badge + save.
  tierContinueBtn.addEventListener('click', function () {
    if (!selectedTier) return;
    currentArticleId     = null;
    currentArticleStatus = 'Draft';
    answers              = [];
    editorTitle.value    = '';
    editorContent.value  = '';
    setTierBadge(selectedTier, selectedForm);
    updateWordCount();
    showState('editor');
    // Left pane: greet the writer and ask what they want to write. Fire-and-forget
    // async (mirrors Dialogue's getOpeningChallenge call); the right-pane editor
    // stays independently usable while the opening turn streams in.
    openWritingConversation();
  });

  // ── Generate (DORMANT) ──────────────────────────────────────────────────────
  // No longer reached from the live flow — retained for the upcoming conversation
  // rebuild. Left intact so the generator wiring is easy to restore.
  async function generateArticle() {
    var labels = { 1: 'Preparing your outline…', 2: 'Preparing your draft…', 3: 'Preparing your article…' };
    writingLoadingText.textContent = labels[selectedTier] || 'Generating…';
    showState('loading');

    try {
      var res = await fetch('/api/writing/generate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          tier:    selectedTier,
          form:    selectedForm,
          answers: { q1: answers[0], q2: answers[1], q3: answers[2], q4: answers[3], q5: answers[4] },
          topic:   answers[0],
        }),
      });
      var data = await res.json();
      if (!data.success) throw new Error(data.error || 'Generation failed.');

      currentArticleId     = null;
      currentArticleStatus = 'Draft';
      editorTitle.value    = extractTitleFromContent(data.content, answers[0]);
      editorContent.value  = data.content;
      setTierBadge(selectedTier, selectedForm);
      updateWordCount();
      showState('editor');
    } catch (err) {
      showState('main');
      showToast('Error: ' + err.message, true);
    }
  }

  // ── Open article ──────────────────────────────────────────────────────────
  async function openArticleById(id) {
    try {
      var res  = await fetch('/api/articles/' + encodeURIComponent(id));
      var data = await res.json();
      if (data.success) loadArticleIntoEditor(data.article);
      else showToast('Could not load article.', true);
    } catch (err) {
      showToast('Could not load article.', true);
    }
  }

  function loadArticleIntoEditor(article) {
    currentArticleId     = article.id;
    currentArticleStatus = article.status;
    selectedTier         = article.tier;
    selectedForm         = article.form || 'article';
    if (article.answers) {
      answers = [
        article.answers.q1 || '',
        article.answers.q2 || '',
        article.answers.q3 || '',
        article.answers.q4 || '',
        article.answers.q5 || '',
      ];
    }
    editorTitle.value   = article.title;
    editorContent.value = article.content;
    setTierBadge(article.tier, article.form || 'article');
    updateWordCount();
    // Reopening a saved article: no live conversation (that's the door flow).
    // Stop any stream from a prior session and show the inert conversation shell
    // so no stale bubbles or Tier 3 draft button linger. (Transcript restore is 4B.)
    abortWritingConversation();
    resetConversationPane();
    showState('editor');
  }

  // ── Save / Mark Complete ──────────────────────────────────────────────────
  saveDraftBtn.addEventListener('click',    function () { saveArticle('Draft'); });
  markCompleteBtn.addEventListener('click', function () { saveArticle('Complete'); });

  async function saveArticle(status) {
    var title   = editorTitle.value.trim();
    var content = editorContent.value;
    if (!title) { editorTitle.focus(); showToast('Please add a title.', true); return; }

    var body = {
      title,
      content,
      tier:    selectedTier,
      form:    selectedForm,
      answers: { q1: answers[0], q2: answers[1], q3: answers[2], q4: answers[3], q5: answers[4] },
      status,
    };

    try {
      var res, data;
      if (currentArticleId) {
        res  = await fetch('/api/articles/' + encodeURIComponent(currentArticleId), {
          method:  'PUT',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(body),
        });
      } else {
        res  = await fetch('/api/articles', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(body),
        });
      }
      data = await res.json();
      if (data.success) {
        currentArticleId     = data.article.id;
        currentArticleStatus = data.article.status;
        showToast(status === 'Complete' ? 'Marked complete.' : 'Draft saved.');
        if (status === 'Complete') loadArticleList();
      } else {
        showToast('Error: ' + (data.error || 'Save failed.'), true);
      }
    } catch (err) {
      showToast('Error: ' + err.message, true);
    }
  }

  // ── Start Over ────────────────────────────────────────────────────────────
  startOverBtn.addEventListener('click', function () {
    // Leaving the editor: kill any in-progress conversation stream and reset
    // conversation state so nothing keeps streaming after the writer is gone.
    abortWritingConversation();
    resetConversationPane();
    currentArticleId     = null;
    currentArticleStatus = 'Draft';
    selectedTier         = 0;
    selectedForm         = '';
    answers              = ['', '', '', '', ''];
    editorTitle.value    = '';
    editorContent.value  = '';
    updateWordCount();
    loadArticleList();
    showState('main');
    if (window.history.replaceState) window.history.replaceState({}, '', '/writing');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ── Writing conversation (LEFT pane) ──────────────────────────────────────
  // Streaming client cloned from Dialogue (public/js/dialogue.js): streamExchange
  // / setGenerating / createStreamingMsg / renderText. Talks to
  // /api/writing/converse. Conversation only — nothing here touches the right-pane
  // editor (that's Step 4).
  // ══════════════════════════════════════════════════════════════════════════

  // Minimal inline-markdown renderer — clone of Dialogue's renderText (escape
  // first, then bold/italic, then newlines → <br>).
  function renderConvText(text) {
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

  // Streaming assistant bubble (mirrors createStreamingMsg; role label "Companion").
  function createCompanionMsg() {
    var div = document.createElement('div');
    div.className = 'chat-msg engine-msg streaming';
    div.innerHTML =
      '<div class="msg-role">Companion</div>' +
      '<div class="msg-content"></div>';
    conversationMessages.appendChild(div);
    conversationMessages.scrollTop = conversationMessages.scrollHeight;
    return div;
  }

  // Writer's own turn (mirrors addUserMessage; role label "You").
  function addConversationUserMessage(text) {
    var div = document.createElement('div');
    div.className = 'chat-msg user-msg';
    div.innerHTML =
      '<div class="msg-role">You</div>' +
      '<div class="msg-content">' + esc(text) + '</div>';
    conversationMessages.appendChild(div);
    conversationMessages.scrollTop = conversationMessages.scrollHeight;
  }

  // Mirror of Dialogue's setGenerating for the conversation controls.
  function setConverseGenerating(val) {
    isConverseGenerating = val;
    if (conversationStopBtn) conversationStopBtn.style.display = val ? 'inline-block' : 'none';
    if (conversationSendBtn) conversationSendBtn.disabled = val;
    if (conversationInput)   conversationInput.disabled   = val;
    if (!val) writingAbortController = null;
  }

  // Abort any in-progress stream and reset generating state (used on Start Over
  // and the Stop button).
  function abortWritingConversation() {
    if (writingAbortController) {
      try { writingAbortController.abort(); } catch (e) {}
    }
    setConverseGenerating(false);
  }

  // Clone of Dialogue's streamExchange — POSTs to /api/writing/converse and streams
  // the assistant turn into a new bubble. Returns the full accumulated text.
  // Shared SSE reader (extracted so the chat turn and the Tier 3 full-draft
   // both use the identical parse loop). Reads the response body, splits on
   // '\n\n', handles 'data:' lines, '[DONE]' ends, parsed.text accumulates and
   // fires onText(fullText), parsed.error throws, SyntaxError from partial JSON
   // is swallowed. Returns the full accumulated text. The server has already
   // resolved every {{verse:...}} marker into verified text before it streams,
   // so `fullText` is always clean — no raw markers can arrive here.
  async function pumpSSE(response, onText) {
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
              if (onText) onText(fullText);
            }
          } catch (e) {
            if (!(e instanceof SyntaxError)) throw e;
          }
        }
      }
    }
    return fullText;
  }

  async function streamWritingExchange(isOpening) {
    writingAbortController = new AbortController();
    var msgEl = null;

    try {
      var response = await fetch('/api/writing/converse', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          messages:  conversationHistory,
          tier:      selectedTier,
          form:      selectedForm,
          isOpening: isOpening,
        }),
        signal: writingAbortController.signal,
      });

      if (!response.ok) throw new Error('Server error ' + response.status);

      msgEl = createCompanionMsg();

      var fullText = await pumpSSE(response, function (full) {
        msgEl.querySelector('.msg-content').innerHTML = renderConvText(full);
        conversationMessages.scrollTop = conversationMessages.scrollHeight;
      });

      msgEl.classList.remove('streaming');
      // Completed companion message → offer to add its clean prose to the draft.
      attachAddToDraft(msgEl, fullText);
      return fullText;

    } catch (err) {
      if (msgEl) msgEl.remove();
      throw err;
    }
  }

  // ── Conversation → article bridge (Step 4A) ────────────────────────────────

  // Append clean text to #editorContent: two newlines then the text when the
  // draft already has content, else just the text. `text` is the message's
  // accumulated stream text — markdown with verse markers ALREADY resolved to
  // verified text by the server — so nothing raw can reach the editor.
  function appendToDraft(text) {
    if (!text) return;
    var cur = editorContent.value.replace(/\s+$/, '');
    editorContent.value = cur ? cur + '\n\n' + text : text;
    updateWordCount();
    showToast('Added to draft');
  }

  // Attach a small "+ Add to draft" control to a COMPLETED companion message.
  // Never on the streaming-in-progress state, never on user messages. Shown for
  // every tier (Tier 1 keep-a-phrase, Tier 2 build, Tier 3 grab-a-passage).
  function attachAddToDraft(msgEl, text) {
    if (!msgEl || !text) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'add-to-draft-btn';
    btn.textContent = '+ Add to draft';
    btn.addEventListener('click', function () { appendToDraft(text); });
    msgEl.appendChild(btn);
  }

  // Tier 3 primary action: write a full draft FROM the conversation INTO the
  // article pane. Implemented WITHOUT touching any endpoint — it reuses the
  // existing /api/writing/converse stream, sending the current history plus a
  // one-off "write the full draft now" instruction, and streams the reply into
  // #editorContent instead of the chat. The one-off instruction is NOT persisted
  // to conversationHistory, so the visible conversation stays clean.
  async function draftIntoArticle() {
    if (isConverseGenerating) return;
    if (editorContent.value.trim()) {
      showConfirm('Replace the current draft with a full draft written from your conversation?', 'Replace', runDraftIntoArticle);
    } else {
      runDraftIntoArticle();
    }
  }

  async function runDraftIntoArticle() {
    setConverseGenerating(true);
    if (conversationDraftBtn) conversationDraftBtn.disabled = true;
    editorContent.value = '';           // Tier 3 = "write me the whole thing" → replace
    updateWordCount();
    writingAbortController = new AbortController();

    var draftForm   = selectedForm || 'article';
    var instruction = 'Please write the full, complete draft now — the entire ' + draftForm +
      ' — using everything we have discussed. Return the finished prose only, ready to read.';
    var messages    = conversationHistory.concat([{ role: 'user', content: instruction }]);

    try {
      var response = await fetch('/api/writing/converse', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          messages:  messages,
          tier:      selectedTier,
          form:      selectedForm,
          isOpening: false,
        }),
        signal: writingAbortController.signal,
      });

      if (!response.ok) throw new Error('Server error ' + response.status);

      var fullText = await pumpSSE(response, function (full) {
        editorContent.value = full;     // stream progressively into the article
        updateWordCount();
        editorContent.scrollTop = editorContent.scrollHeight;
      });

      if (!editorTitle.value.trim()) {
        editorTitle.value = extractTitleFromContent(fullText, '');
      }
      updateWordCount();
      showToast('Draft written into the article.');
    } catch (err) {
      if (err.name !== 'AbortError') showToast('Error: ' + err.message, true);
    } finally {
      setConverseGenerating(false);
      if (conversationDraftBtn) conversationDraftBtn.disabled = false;
    }
  }

  // Reset the conversation pane to its inert placeholder + hide Tier 3 action.
  // Used when leaving/reopening so a stale conversation or draft button doesn't
  // linger (e.g. opening an existing article, which has no live conversation).
  function resetConversationPane() {
    conversationHistory = [];
    if (conversationMessages) conversationMessages.innerHTML =
      '<p class="conversation-empty">Your conversation will appear here.</p>';
    if (conversationDraftBtn) conversationDraftBtn.style.display = 'none';
  }

  // Opening turn — the companion greets the writer when they land in the editor.
  async function openWritingConversation() {
    conversationHistory = [];
    conversationMessages.innerHTML = '';   // drop the static placeholder
    // Tier 3 gets the "Draft it into the article" primary action; Tiers 1-2 rely
    // on the per-message "+ Add to draft" control instead.
    if (conversationDraftBtn) conversationDraftBtn.style.display = (selectedTier === 3) ? 'block' : 'none';
    setConverseGenerating(true);
    try {
      var greeting = await streamWritingExchange(true);
      if (greeting) conversationHistory.push({ role: 'assistant', content: greeting });
    } catch (err) {
      if (err.name !== 'AbortError') {
        showToast('The companion could not be reached. You can still write on the right.', true);
      }
    } finally {
      setConverseGenerating(false);
    }
  }

  // Send handler — the writer's turn, then the streamed reply.
  async function sendWritingMessage() {
    if (isConverseGenerating) return;
    var text = conversationInput.value.trim();
    if (!text) { conversationInput.focus(); return; }

    addConversationUserMessage(text);
    conversationHistory.push({ role: 'user', content: text });
    conversationInput.value = '';

    setConverseGenerating(true);
    try {
      var reply = await streamWritingExchange(false);
      if (reply) conversationHistory.push({ role: 'assistant', content: reply });
    } catch (err) {
      if (err.name === 'AbortError') {
        conversationHistory.pop();   // drop the unanswered user turn, quietly
      } else {
        showToast('Error: ' + err.message, true);
      }
    } finally {
      setConverseGenerating(false);
    }
  }

  // ── Conversation controls ──────────────────────────────────────────────────
  if (conversationSendBtn) conversationSendBtn.addEventListener('click', sendWritingMessage);

  if (conversationInput) {
    conversationInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendWritingMessage();
      }
    });
  }

  if (conversationStopBtn) {
    conversationStopBtn.addEventListener('click', function () {
      if (writingAbortController) writingAbortController.abort();
    });
  }

  if (conversationDraftBtn) conversationDraftBtn.addEventListener('click', draftIntoArticle);

  // ── Article list (Draft only) ─────────────────────────────────────────────
  async function loadArticleList() {
    try {
      var res  = await fetch('/api/articles');
      var data = await res.json();
      var drafts = (data.articles || []).filter(function (a) { return a.status === 'Draft'; });
      renderArticleList(drafts);
    } catch (err) {
      articleList.innerHTML = '<p class="writing-empty">Could not load articles.</p>';
    }
  }

  function renderArticleList(articles) {
    if (!articles.length) {
      articleList.innerHTML = '<p class="writing-empty">No drafts in progress. Begin your first.</p>';
      return;
    }
    articleList.innerHTML = articles.map(function (a) {
      var formLabel = formDisplayLabel(a.form);
      return '<div class="article-card">' +
        '<div class="article-card-header">' +
          '<span class="article-card-title">' + esc(a.title) + '</span>' +
          '<button class="card-delete-btn article-delete-btn" data-id="' + esc(a.id) + '" title="Delete">&#10005;</button>' +
        '</div>' +
        '<div class="article-card-meta">' +
          '<span class="tier-badge-sm">Tier ' + a.tier + '</span>' +
          '<span class="form-badge form-badge-' + esc(a.form || 'article') + '">' + formLabel + '</span>' +
          '<span class="article-card-date">' + fmtDate(a.updatedAt || a.createdAt) + '</span>' +
        '</div>' +
        '<button class="btn-warm article-open-btn" data-id="' + esc(a.id) + '" style="margin-top:12px; font-size:0.82rem; padding:7px 18px;">Open</button>' +
      '</div>';
    }).join('');

    articleList.querySelectorAll('.article-open-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { openArticleById(btn.dataset.id); });
    });

    articleList.querySelectorAll('.article-delete-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        showConfirm('Delete this article? This cannot be undone.', 'Delete', async function () {
          try {
            var res  = await fetch('/api/articles/' + encodeURIComponent(btn.dataset.id), { method: 'DELETE' });
            var data = await res.json();
            if (data.success) loadArticleList();
            else showToast('Delete failed.', true);
          } catch (err) {
            showToast('Error: ' + err.message, true);
          }
        });
      });
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function setTierBadge(tier, form) {
    var tierLabels = { 1: 'Tier 1 — Scaffold', 2: 'Tier 2 — Draft', 3: 'Tier 3 — Ghostwrite' };
    var formLabel  = formDisplayLabel(form);
    editorTierBadge.textContent = (tierLabels[tier] || 'Tier ' + tier) + (formLabel ? ' · ' + formLabel : '');
  }

  function formDisplayLabel(form) {
    var labels = { article: 'Article', sermon: 'Sermon', letter: 'Letter' };
    return labels[form] || 'Article';
  }

  function updateWordCount() {
    var text  = editorContent.value.trim();
    var words = text ? text.split(/\s+/).length : 0;
    editorWordCount.textContent = words + ' word' + (words !== 1 ? 's' : '');
  }

  editorContent.addEventListener('input', updateWordCount);

  function extractTitleFromContent(content, fallback) {
    var match = String(content).match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : (fallback || '').trim();
  }

  function fmtDate(iso) {
    var d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function showToast(msg, isError) {
    var toast = document.createElement('div');
    toast.className   = 'toast-msg' + (isError ? ' toast-error' : '');
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

  init();
})();
