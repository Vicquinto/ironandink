(function () {
  'use strict';

  // ── State ─────────────────────────────────────────────────────────────────
  var selectedTier         = 0;
  var selectedForm         = '';
  var answers              = [];
  var currentArticleId     = null;
  var currentArticleStatus = 'Draft';

  // Snapshot of the editor as of the last clean point (blank editor, loaded
  // article, or successful save). The "Back" guard compares the live editor to
  // this to detect unsaved work. Kept in sync via syncSavedSnapshot().
  var lastSavedTitle       = '';
  var lastSavedContent     = '';

  // ── Conversation state (Step 3) ───────────────────────────────────────────
  // Mirrors Dialogue's streaming client. conversationHistory is the running
  // [{role, content}] array sent to /api/writing/converse each turn.
  var conversationHistory     = [];
  var writingAbortController  = null;
  var isConverseGenerating    = false;

  // ── Writing Types (restyle) state (Phase B) ────────────────────────────────
  // restyleUndoBuffer holds the pre-Accept { content, title } for a single step
  // of undo. isRestyling gates overlapping streams; restyleAbortController backs
  // the Stop button. restylePreviewText accumulates the streamed rewrite (raw
  // text, verses already resolved server-side) — this is what Accept swaps in.
  var restyleUndoBuffer      = null;
  var isRestyling            = false;
  var restyleAbortController = null;
  var restylePreviewText     = '';

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
  var clearBoardBtn     = document.getElementById('clearBoardBtn');
  var backBtn           = document.getElementById('backBtn');
  var writingLoadingText = document.getElementById('writingLoadingText');

  // Conversation pane refs (wired in the "Writing conversation" section below).
  var conversationMessages = document.getElementById('conversationMessages');
  var conversationInput    = document.getElementById('conversationInput');
  var conversationSendBtn  = document.getElementById('conversationSendBtn');
  var conversationStopBtn  = document.getElementById('conversationStopBtn');
  var conversationDraftBtn = document.getElementById('conversationDraftBtn');

  // Restyle (Writing Types) refs.
  var restyleBtn            = document.getElementById('restyleBtn');
  var restylePicker         = document.getElementById('restylePicker');
  var restyleUndoBtn        = document.getElementById('restyleUndoBtn');
  var restyleOverlay        = document.getElementById('restyleOverlay');
  var restyleOverlayTitle   = document.getElementById('restyleOverlayTitle');
  var restylePreviewContent = document.getElementById('restylePreviewContent');
  var restyleAcceptBtn      = document.getElementById('restyleAcceptBtn');
  var restyleDiscardBtn     = document.getElementById('restyleDiscardBtn');
  var restyleStopBtn        = document.getElementById('restyleStopBtn');

  // Human labels + genre-default suggestions (soft clay — all six stay selectable).
  var RESTYLE_LABELS = {
    warmer: 'Warmer', encouraging: 'Encouraging', conviction: 'With Conviction',
    respond: 'Call to Respond', lyrical: 'More Lyrical', plainer: 'Plainer',
  };
  var RESTYLE_FORM_DEFAULT = { article: 'conviction', sermon: 'respond', letter: 'warmer' };

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
    syncSavedSnapshot();
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
    syncSavedSnapshot();
    setTierBadge(article.tier, article.form || 'article');
    updateWordCount();
    // Reopening a saved article: stop any stream from a prior session, then either
    // restore the saved transcript (Step 4B) or, for old records with none, show
    // the inert conversation shell. Never re-greet — greeting is the doors path only.
    abortWritingConversation();
    // Loading a different article: kill any restyle preview and drop the undo
    // buffer — undo must never revert across articles.
    abortRestyle();
    clearRestyleUndo();
    var savedConvo = Array.isArray(article.conversation) ? article.conversation : [];
    if (savedConvo.length) {
      restoreConversation(savedConvo);
    } else {
      resetConversationPane();
    }
    showState('editor');
  }

  // ── Save / Mark Complete ──────────────────────────────────────────────────
  saveDraftBtn.addEventListener('click',    function () { saveArticle('Draft'); });
  markCompleteBtn.addEventListener('click', function () { saveArticle('Complete'); });

  // Shared network save — the single path to /api/articles used by BOTH the manual
  // save and the silent auto-save. PUTs the existing record when currentArticleId
  // is set, else POSTs a new one; on success updates currentArticleId/Status and
  // the saved snapshot. NO UI side effects (no toast, no list reload) — callers add
  // those. Reads content/tier/form/answers/conversation live; title + status come
  // from the caller. Throws on failure so callers decide how loud to be.
  async function persistArticle(opts) {
    var body = {
      title:   opts.title,
      content: editorContent.value,
      tier:    selectedTier,
      form:    selectedForm,
      answers: { q1: answers[0], q2: answers[1], q3: answers[2], q4: answers[3], q5: answers[4] },
      status:  opts.status,
      conversation: conversationHistory,
    };

    var res;
    if (currentArticleId) {
      res = await fetch('/api/articles/' + encodeURIComponent(currentArticleId), {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });
    } else {
      res = await fetch('/api/articles', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });
    }
    var data = await res.json();
    if (!data.success) throw new Error(data.error || 'Save failed.');
    currentArticleId     = data.article.id;
    currentArticleStatus = data.article.status;
    syncSavedSnapshot();
    return data.article;
  }

  // Manual save (Save Draft / Mark Complete): requires a real title, then the
  // usual toast + list reload on Complete.
  async function saveArticle(status) {
    var title = editorTitle.value.trim();
    if (!title) { editorTitle.focus(); showToast('Please add a title.', true); return; }
    try {
      await persistArticle({ title: title, status: status });
      showToast(status === 'Complete' ? 'Marked complete.' : 'Draft saved.');
      if (status === 'Complete') loadArticleList();
    } catch (err) {
      showToast('Error: ' + err.message, true);
    }
  }

  // Silent background auto-save. Best-effort: no toast, no UI change, failures
  // swallowed (writer can still save manually). Preserves the loaded article's
  // status so it NEVER downgrades a Complete/Pending/Published record to Draft
  // (currentArticleStatus is 'Draft' for a fresh draft). Uses an 'Untitled draft'
  // placeholder in the SAVED record when the title box is empty — without touching
  // the visible #editorTitle field, which the writer still sees blank to fill in.
  // The in-flight flag stops overlapping saves from firing in quick succession.
  var isAutoSaving = false;
  async function autoSaveDraft() {
    if (isAutoSaving) return;
    isAutoSaving = true;
    var title  = editorTitle.value.trim() || 'Untitled draft';
    var status = currentArticleStatus || 'Draft';   // preserve status; never downgrade
    try {
      await persistArticle({ title: title, status: status });
    } catch (err) {
      if (window.console && console.warn) {
        console.warn('Writing auto-save failed (will retry on next change):', err && err.message);
      }
    } finally {
      isAutoSaving = false;
    }
  }

  // ── Clear Board / Back ─────────────────────────────────────────────────────
  // Records the editor's current title/content as the "clean" baseline. Called at
  // every point the editor is set to a known-saved state (blank editor, loaded
  // article, successful save) so editorIsDirty() reflects real unsaved work.
  function syncSavedSnapshot() {
    lastSavedTitle   = editorTitle.value;
    lastSavedContent = editorContent.value;
  }

  // Unsaved-work check: the live editor differs from the last clean snapshot.
  // Catches a brand-new never-saved draft AND edits made after a save.
  function editorIsDirty() {
    return editorTitle.value !== lastSavedTitle ||
           editorContent.value !== lastSavedContent;
  }

  // Leave the two-pane workspace and return to the doors/genre flow. Same cleanup
  // the old "Start Over" did: kill any in-progress conversation stream and reset
  // conversation + editor state so nothing keeps streaming after the writer is gone.
  function leaveWorkspace() {
    abortWritingConversation();
    resetConversationPane();
    abortRestyle();
    clearRestyleUndo();
    currentArticleId     = null;
    currentArticleStatus = 'Draft';
    selectedTier         = 0;
    selectedForm         = '';
    answers              = ['', '', '', '', ''];
    editorTitle.value    = '';
    editorContent.value  = '';
    syncSavedSnapshot();
    updateWordCount();
    loadArticleList();
    showState('main');
    if (window.history.replaceState) window.history.replaceState({}, '', '/writing');
  }

  // Clear Board: empty ONLY the article pane (title, body, word count) after a
  // warning. The conversation pane, history, companion, and tier badge are left
  // untouched — the writer stays in the two-pane view with a blank article.
  clearBoardBtn.addEventListener('click', function () {
    showConfirm(
      "Clear the board? This will erase your current draft. This can't be undone.",
      'Clear Board',
      function () {
        editorTitle.value   = '';
        editorContent.value = '';
        updateWordCount();
        clearRestyleUndo();   // the pre-restyle draft is gone; nothing to undo to
      }
    );
  });

  // Back: leave the workspace, warning first if there's unsaved draft content.
  backBtn.addEventListener('click', function () {
    if (editorIsDirty()) {
      showConfirm('You have an unsaved draft. Leave without saving?', 'Leave', leaveWorkspace);
    } else {
      leaveWorkspace();
    }
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
    // No overlapping streams: block Restyle while a conversation / Tier 3 draft runs.
    if (restyleBtn)          restyleBtn.disabled          = val;
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
    autoSaveDraft();   // preserve the article-pane change silently
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
      autoSaveDraft();   // preserve the drafted-in article content silently
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

  // Restore a saved transcript into the conversation pane (Step 4B). Re-renders
  // each stored turn as a completed (non-streaming) bubble so a reopened article
  // resumes exactly where it left off. Does NOT greet — greeting is only for the
  // fresh doors path (openWritingConversation). `history` must be a non-empty
  // [{role, content}] array; selectedTier/selectedForm are already set by the
  // caller from the loaded article, so the Tier 3 button + next-turn tier posture
  // are correct.
  function restoreConversation(history) {
    conversationHistory = history;
    conversationMessages.innerHTML = '';   // drop the placeholder / any stale bubbles
    // Tier 3 gets the "Draft it into the article" action; hidden for Tiers 1-2.
    if (conversationDraftBtn) conversationDraftBtn.style.display = (selectedTier === 3) ? 'block' : 'none';
    history.forEach(function (m) {
      if (!m || !m.content) return;
      if (m.role === 'user') {
        addConversationUserMessage(m.content);
      } else if (m.role === 'assistant') {
        // Completed companion bubble — mirrors createCompanionMsg but not
        // streaming: content is set directly via renderConvText.
        var div = document.createElement('div');
        div.className = 'chat-msg engine-msg';
        div.innerHTML =
          '<div class="msg-role">Companion</div>' +
          '<div class="msg-content">' + renderConvText(m.content) + '</div>';
        conversationMessages.appendChild(div);
        // Restored companion messages behave like live ones: offer add-to-draft.
        attachAddToDraft(div, m.content);
      }
    });
    conversationMessages.scrollTop = conversationMessages.scrollHeight;
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
      if (reply) {
        conversationHistory.push({ role: 'assistant', content: reply });
        // First completed exchange creates the draft record; later ones update it.
        // (Opening greeting alone never reaches here, so it never creates a draft.)
        autoSaveDraft();
      }
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

  // ══════════════════════════════════════════════════════════════════════════
  // ── Writing Types: restyle picker / preview / accept / undo (Phase B) ─────
  // Client for POST /api/writing/restyle. The overlay PREVIEWS a rewritten draft
  // without touching the live #editorContent — only Accept swaps it in (capturing
  // a one-step undo buffer first). Reuses pumpSSE + renderConvText from above.
  // ══════════════════════════════════════════════════════════════════════════

  function isPickerOpen() {
    return !!restylePicker && restylePicker.style.display !== 'none';
  }

  function openRestylePicker() {
    if (!restylePicker) return;
    // Highlight the genre default; every item stays selectable.
    var suggested = RESTYLE_FORM_DEFAULT[selectedForm] || '';
    restylePicker.querySelectorAll('.restyle-picker-item').forEach(function (b) {
      b.classList.toggle('is-suggested', b.getAttribute('data-style') === suggested);
    });
    restylePicker.style.display = 'block';
  }

  function closeRestylePicker() {
    if (restylePicker) restylePicker.style.display = 'none';
  }

  // Abort any in-progress restyle stream and tear down the picker + overlay.
  // Used when leaving/reopening so nothing keeps streaming after the writer moves on.
  function abortRestyle() {
    if (restyleAbortController) { try { restyleAbortController.abort(); } catch (e) {} }
    isRestyling = false;
    closeRestylePicker();
    closeRestyleOverlay();
  }

  // Clear the one-step undo buffer and hide its button. Called on every point the
  // writer moves on (Back, Clear Board, load another article, accept a new restyle).
  function clearRestyleUndo() {
    restyleUndoBuffer = null;
    if (restyleUndoBtn) restyleUndoBtn.style.display = 'none';
  }

  // Restyle button → toggle the picker. Guards: no draft, or a stream in progress.
  if (restyleBtn) {
    restyleBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (isConverseGenerating) { showToast('Finish the current writing first.', true); return; }
      if (!editorContent.value.trim()) { showToast('Write something first, then restyle it.'); return; }
      if (isPickerOpen()) { closeRestylePicker(); return; }
      openRestylePicker();
    });
  }

  // Click-outside + Escape close the picker.
  document.addEventListener('click', function (e) {
    if (!isPickerOpen()) return;
    if (restylePicker.contains(e.target) || (restyleBtn && restyleBtn.contains(e.target))) return;
    closeRestylePicker();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && isPickerOpen()) closeRestylePicker();
  });

  // Pick a style → close picker, open overlay, stream the rewrite.
  if (restylePicker) {
    restylePicker.querySelectorAll('.restyle-picker-item').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var style = btn.getAttribute('data-style');
        closeRestylePicker();
        startRestyle(style);
      });
    });
  }

  function openRestyleOverlay(styleLabel) {
    restylePreviewText = '';
    if (restylePreviewContent) restylePreviewContent.innerHTML = '';
    if (restyleOverlayTitle)   restyleOverlayTitle.textContent = 'Restyled — ' + styleLabel;
    if (restyleAcceptBtn)      restyleAcceptBtn.disabled = true;   // enabled when stream completes
    if (restyleDiscardBtn)     restyleDiscardBtn.disabled = false;
    if (restyleStopBtn)        restyleStopBtn.style.display = 'inline-block';
    if (restyleOverlay)        restyleOverlay.style.display = 'flex';
  }

  function closeRestyleOverlay() {
    if (restyleOverlay)        restyleOverlay.style.display = 'none';
    if (restylePreviewContent) restylePreviewContent.innerHTML = '';
    if (restyleStopBtn)        restyleStopBtn.style.display = 'none';
    restylePreviewText = '';
  }

  // Stream a restyle into the overlay preview. The live #editorContent is NOT
  // touched here — the draft underneath stays exactly as it was.
  async function startRestyle(style) {
    if (isRestyling) return;
    if (isConverseGenerating) { showToast('Finish the current writing first.', true); return; }
    var draft = editorContent.value;
    if (!draft.trim()) { showToast('Write something first, then restyle it.'); return; }

    var label = RESTYLE_LABELS[style] || RESTYLE_LABELS.warmer;
    openRestyleOverlay(label);
    isRestyling = true;
    restyleAbortController = new AbortController();

    try {
      var response = await fetch('/api/writing/restyle', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ draft: draft, style: style, form: selectedForm }),
        signal:  restyleAbortController.signal,
      });
      if (!response.ok) throw new Error('Server error ' + response.status);

      restylePreviewText = await pumpSSE(response, function (full) {
        restylePreviewText = full;
        if (restylePreviewContent) {
          restylePreviewContent.innerHTML = renderConvText(full);
          restylePreviewContent.scrollTop = restylePreviewContent.scrollHeight;
        }
      });

      isRestyling = false;
      if (restyleStopBtn)   restyleStopBtn.style.display = 'none';
      if (restyleAcceptBtn) restyleAcceptBtn.disabled = false;   // ready to accept
    } catch (err) {
      isRestyling = false;
      closeRestyleOverlay();                 // abort (Stop) or error → draft untouched
      if (err.name !== 'AbortError') showToast('Error: ' + err.message, true);
    } finally {
      restyleAbortController = null;
    }
  }

  // Stop → abort the stream; the catch closes the overlay quietly. Draft untouched.
  if (restyleStopBtn) {
    restyleStopBtn.addEventListener('click', function () {
      if (restyleAbortController) restyleAbortController.abort();
    });
  }

  // Discard → close overlay, draft untouched, nothing saved. Aborts first if mid-stream.
  if (restyleDiscardBtn) {
    restyleDiscardBtn.addEventListener('click', function () {
      if (isRestyling && restyleAbortController) { restyleAbortController.abort(); return; }
      closeRestyleOverlay();
    });
  }

  // Accept → capture the pre-restyle draft for one-step undo, swap in the styled
  // text, save, and reveal Undo. Only after the stream has finished.
  if (restyleAcceptBtn) {
    restyleAcceptBtn.addEventListener('click', function () {
      if (isRestyling) return;
      var styled = restylePreviewText;
      if (!styled || !styled.trim()) { closeRestyleOverlay(); return; }
      restyleUndoBuffer = { content: editorContent.value, title: editorTitle.value };
      editorContent.value = styled;
      updateWordCount();
      closeRestyleOverlay();
      if (restyleUndoBtn) restyleUndoBtn.style.display = 'inline-block';
      autoSaveDraft();                       // styled version now persists
      showToast('Restyled. You can undo this once.');
    });
  }

  // Undo restyle → revert to the captured pre-restyle draft (one step only), then
  // re-save so the server matches. Buffer is single-use.
  if (restyleUndoBtn) {
    restyleUndoBtn.addEventListener('click', function () {
      if (!restyleUndoBuffer) return;
      editorContent.value = restyleUndoBuffer.content;
      if (restyleUndoBuffer.title !== undefined && restyleUndoBuffer.title !== editorTitle.value) {
        editorTitle.value = restyleUndoBuffer.title;
      }
      updateWordCount();
      clearRestyleUndo();
      autoSaveDraft();
      showToast('Restyle undone.');
    });
  }

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
