(function () {
  'use strict';

  // ── State ─────────────────────────────────────────────────────────────────
  var selectedTier         = 0;
  var selectedForm         = '';
  var answers              = [];
  var currentArticleId     = null;
  var currentArticleStatus = 'Draft';

  // ── "Build from a study" source (Piece B) ───────────────────────────────────
  // Holds { topic, content } when the writer seeds the session from an existing
  // study or pasted text, else null ("Start fresh"). Rides to the companion's
  // opening turn ONLY; never written into the article pane. Cleared on Back / new
  // session so a wrong pick never carries over.
  var sourceStudy          = null;

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

  // ── Shared content-undo buffer (Revise rebuild Phase 1) ────────────────────
  // ONE single-step undo buffer shared by every content-mutating action:
  // restyle accept, Revise apply, add-to-draft, and draft-into-article. Each
  // push captures { content, title, label } — the WHOLE draft (not just the
  // affected passage), since that's the simplest correct way to reverse any
  // of these regardless of what kind of edit it made. `label` names the
  // action for the button text / toast ("restyle", "revision", "add to
  // draft", "draft-in"). One button (#contentUndoBtn), text set from the
  // most recent push; a second mutating action before the first is undone
  // simply overwrites the buffer, matching every one of these actions'
  // existing "single step only" behavior. See pushContentUndo/clearContentUndo.
  var contentUndoBuffer = null;

  // ── Writing Types (restyle) state (Phase B) ────────────────────────────────
  // isRestyling gates overlapping streams; restyleAbortController backs the
  // Stop button. restylePreviewText accumulates the streamed rewrite (raw
  // text, verses already resolved server-side) — this is what Accept swaps in.
  var isRestyling            = false;
  var restyleAbortController = null;
  var restylePreviewText     = '';

  // ── Highlight-to-revise state (Capability 1) ───────────────────────────────
  // isRewriting gates overlapping requests; rewriteAbortController backs
  // Dismiss-while-streaming. selRewriteStart/End/Text are captured when a
  // selection is detected and read again (not re-measured) at Apply time,
  // since focus has by then moved to the toolbar's own input/buttons and the
  // board's live selection can't be relied on. Start/End are plain-text
  // character offsets (see rangeToPlainTextOffsets/plainTextOffsetToRange) —
  // the same role .selectionStart/.selectionEnd played before the
  // contenteditable conversion, just computed by hand now instead of read
  // directly off the element.
  var isRewriting            = false;
  var rewriteAbortController = null;
  var selRewriteStart        = 0;
  var selRewriteEnd          = 0;
  var selRewriteText         = '';

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
  var wModalStep2           = document.getElementById('wModalStep2');
  var formContinueBtn       = document.getElementById('formContinueBtn');
  var cancelFormModalBtn    = document.getElementById('cancelFormModalBtn');
  var tierContinueBtn       = document.getElementById('tierContinueBtn');
  var doorsBackBtn          = document.getElementById('doorsBackBtn');
  var sourceContinueBtn     = document.getElementById('sourceContinueBtn');
  var sourceBackBtn         = document.getElementById('sourceBackBtn');
  var wSourcePanelMine      = document.getElementById('wSourcePanelMine');
  var wSourcePanelCommunity = document.getElementById('wSourcePanelCommunity');
  var wSourcePanelPaste     = document.getElementById('wSourcePanelPaste');
  var wSourcePasteText      = document.getElementById('wSourcePasteText');
  var closeWritingModalBtn  = document.getElementById('closeWritingModalBtn');

  var editorTitle       = document.getElementById('editorTitle');
  var editorContent     = document.getElementById('editorContent');
  var writingEditorPane = document.getElementById('writingEditorPane');
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
  var restyleOverlay        = document.getElementById('restyleOverlay');
  var restyleOverlayTitle   = document.getElementById('restyleOverlayTitle');
  var restylePreviewContent = document.getElementById('restylePreviewContent');
  var restyleAcceptBtn      = document.getElementById('restyleAcceptBtn');
  var restyleDiscardBtn     = document.getElementById('restyleDiscardBtn');
  var restyleStopBtn        = document.getElementById('restyleStopBtn');

  // Highlight-to-revise (Capability 1) refs.
  var rewriteToolbar        = document.getElementById('rewriteToolbar');
  var rewriteInstruction    = document.getElementById('rewriteInstruction');
  var rewriteApplyBtn       = document.getElementById('rewriteApplyBtn');
  var rewriteDismissBtn     = document.getElementById('rewriteDismissBtn');
  var rewriteStatus         = document.getElementById('rewriteStatus');

  // Shared content-undo button (Revise rebuild Phase 1) — replaces the old
  // separate restyleUndoBtn/rewriteUndoBtn; see contentUndoBuffer above.
  var contentUndoBtn = document.getElementById('contentUndoBtn');

  // Companion panel collapse refs (mirrors the app-wide sidebar's own toggle).
  var writingConversation = document.getElementById('writingConversation');
  var companionToggleBtn  = document.getElementById('companionToggleBtn');

  // ══════════════════════════════════════════════════════════════════════════
  // ── Contenteditable plain-text helpers (Revise rebuild Phase 1) ───────────
  // editorContent is a contenteditable <div>, not a <textarea> — these are the
  // single translation layer between "plain text with \n line breaks" (what
  // every existing feature here — save, restyle, print, word count, Revise's
  // offset splice — already expects) and the DOM the browser actually
  // renders. Writes loading a full document (article load, restyle, undo)
  // go through plainTextToSafeHtml, which represents line breaks as <br>.
  // Writes from user interaction (typing, Enter, paste, Revise's splice) go
  // through execCommand — see insertPlainTextAtCurrentSelection below —
  // which represents them as literal \n characters inside a text node
  // instead. BOTH forms stay deliberately flat (no nested <div>/<p> ever),
  // and the offset<->Range helpers below handle both identically, so mixing
  // them in one document is fine. That flatness (whichever form) is what
  // makes getPlainText() a reliable round-trip of what was written, and it's
  // also what keeps native undo and IME composition behaving sanely (both
  // degrade notably on messier contenteditable DOM). Nothing outside this
  // block should read editorContent.innerText/.textContent directly or write
  // editorContent.innerHTML directly — always through these.
  // ══════════════════════════════════════════════════════════════════════════

  // Read the board's rendered text as a plain string with real \n line
  // breaks. innerText (not textContent) is layout-aware and inserts a break
  // at each visual block boundary — textContent would silently concatenate
  // across them with no separator, losing every line break in the document.
  function getPlainText(el) {
    return el.innerText;
  }

  // HTML-escape + convert \n to <br> — the one path every WRITE uses to turn
  // a plain string back into safe markup. A <textarea>'s .value is inert, so
  // this app never needed to think about escaping before; .innerHTML is a
  // real markup sink, so every write must go through this, including undo
  // restores and content loaded from a saved article.
  function plainTextToSafeHtml(text) {
    return esc(String(text)).replace(/\n/g, '<br>');
  }

  // Sum of the plain-text length a node (and everything under it) contributes
  // — a text node contributes its own length, a <br> contributes 1 (the '\n'
  // it represents), anything else recurses into its children. Shared by both
  // directions of the offset<->Range mapping below.
  function plainTextLength(node) {
    if (!node) return 0;
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue.length;
    if (node.nodeName === 'BR') return 1;
    var len = 0;
    for (var i = 0; i < node.childNodes.length; i++) len += plainTextLength(node.childNodes[i]);
    return len;
  }

  // A Range boundary is a (node, offset) pair — for a text-node container,
  // offset is a character count into it; for an element container (e.g. el
  // itself, at a boundary between two children), offset is a CHILD INDEX,
  // meaning "the boundary sits before the child at this index." This walks
  // the tree in document order accumulating plain-text length until it
  // reaches the exact (node, offset) given, handling both cases, and returns
  // the single plain-text character offset that point corresponds to.
  function plainTextOffsetAt(el, targetNode, targetOffset) {
    var offset = 0;
    var found  = false;
    function walk(node) {
      if (found) return;
      if (node === targetNode) {
        if (node.nodeType === Node.TEXT_NODE) {
          offset += targetOffset;
        } else {
          for (var i = 0; i < targetOffset; i++) offset += plainTextLength(node.childNodes[i]);
        }
        found = true;
        return;
      }
      if (node.nodeType === Node.TEXT_NODE) {
        offset += node.nodeValue.length;
      } else if (node.nodeName === 'BR') {
        offset += 1;
      } else {
        for (var i = 0; i < node.childNodes.length && !found; i++) walk(node.childNodes[i]);
      }
    }
    walk(el);
    return offset;
  }

  // Range -> plain-text offsets. Mirrors plainTextOffsetToRange below — these
  // two functions together are the whole reason Revise's offset-based
  // capture/splice (checkRewriteSelection / applyRewrite) can keep working on
  // a contenteditable surface: there is no built-in browser API for this
  // conversion in either direction, since a Range points into the DOM tree
  // while .selectionStart/.selectionEnd (what a <textarea> gave us before)
  // are plain integers into a flat string.
  function rangeToPlainTextOffsets(el, range) {
    return {
      start: plainTextOffsetAt(el, range.startContainer, range.startOffset),
      end:   plainTextOffsetAt(el, range.endContainer,   range.endOffset),
    };
  }

  // The inverse: find the (node, offset) DOM position a given plain-text
  // character offset corresponds to, walking the same way plainTextOffsetAt
  // does. Falls back to "the very end of el" if the offset is at or past the
  // end of all content (e.g. an empty board, or offset === full length).
  function plainTextPositionAt(el, offset) {
    var remaining = offset;
    var result    = null;
    function walk(node) {
      if (result) return;
      if (node.nodeType === Node.TEXT_NODE) {
        if (remaining <= node.nodeValue.length) { result = { node: node, offset: remaining }; return; }
        remaining -= node.nodeValue.length;
      } else if (node.nodeName === 'BR') {
        if (remaining <= 0) {
          result = { node: node.parentNode, offset: Array.prototype.indexOf.call(node.parentNode.childNodes, node) };
          return;
        }
        remaining -= 1;
      } else {
        for (var i = 0; i < node.childNodes.length && !result; i++) walk(node.childNodes[i]);
      }
    }
    walk(el);
    if (!result) result = { node: el, offset: el.childNodes.length };
    return result;
  }

  // Plain-text offsets -> a Range spanning them. Used by applyRewrite() to
  // build the exact Range to splice a revision into, replacing the string-
  // slice arithmetic a <textarea> made trivial.
  function plainTextOffsetToRange(el, start, end) {
    var startPos = plainTextPositionAt(el, start);
    var endPos   = plainTextPositionAt(el, end);
    var range = document.createRange();
    range.setStart(startPos.node, startPos.offset);
    range.setEnd(endPos.node, endPos.offset);
    return range;
  }

  // Insert `text` at whatever the CURRENT live selection is, one line at a
  // time via the browser's own execCommand rather than manual Range/Node
  // surgery. Confirmed live, the hard way, that a hand-built <br> + Range
  // reconstruction is not reliably honored by subsequent native typing:
  // characters typed right after a freshly-inserted <br> silently merged
  // into the PRECEDING text run instead of continuing after it, no matter
  // how carefully the replacement caret position was computed (tried anchoring
  // it inside a real Text node, normalizing first, recomputing the offset
  // after — Chrome's own insertText still redirected into the text run
  // before the <br>). execCommand('insertLineBreak') does not have this
  // problem — it's what the browser's own Shift+Enter uses internally, and
  // subsequent typing continues correctly after it.
  //
  // Deliberately split into one execCommand('insertText', ...) per line,
  // joined by execCommand('insertLineBreak'), rather than a single
  // insertText call with embedded \n characters — confirmed live that
  // Chrome's insertText represents a multi-line string by wrapping every
  // line after the first in its own <div>, which would break the flat-DOM
  // (text nodes + <br>/\n only) assumption getPlainText()'s offset math
  // depends on. Line-by-line with insertLineBreak between keeps the result
  // to a single text node with literal \n characters (rendered as real line
  // breaks by the white-space: pre-wrap CSS already on the board) — no
  // wrapping elements at all.
  //
  // execCommand fires real native 'input' events (confirmed live), so this
  // needs no manual updateWordCount()/dispatchEvent afterward — it already
  // behaves indistinguishably from the writer having typed it.
  function insertPlainTextAtCurrentSelection(text) {
    var lines = String(text).split('\n');
    for (var i = 0; i < lines.length; i++) {
      if (i > 0) document.execCommand('insertLineBreak');
      if (lines[i]) document.execCommand('insertText', false, lines[i]);
    }
  }

  // Insert `text` at the board's current selection/caret — used by the paste
  // handler. Falls back to the end of the board if nothing is currently
  // selected inside it (e.g. a paste triggered without focus ever landing
  // there first).
  function insertPlainTextAtSelection(el, text) {
    var sel = window.getSelection();
    if (!sel.rangeCount || !el.contains(sel.getRangeAt(0).commonAncestorContainer)) {
      var range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    insertPlainTextAtCurrentSelection(text);
  }

  // Insert `text` at a SPECIFIC Range that isn't necessarily the live
  // selection (Revise's splice operates on stored offsets, not wherever the
  // caret happens to be) — sets it as the live selection first, since
  // execCommand only ever acts on that, then delegates to the same
  // line-by-line insertion every other write path uses.
  function insertPlainTextAtRange(el, range, text) {
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    insertPlainTextAtCurrentSelection(text);
  }

  // Push one snapshot onto the shared one-step undo buffer and reveal the
  // button with a label naming what it would revert. Shared by restyle
  // accept, Revise apply, add-to-draft, and draft-into-article — see
  // contentUndoBuffer's declaration above for why these four share one
  // buffer instead of each keeping their own.
  function pushContentUndo(label) {
    contentUndoBuffer = { content: getPlainText(editorContent), title: editorTitle.value, label: label };
    if (contentUndoBtn) {
      contentUndoBtn.textContent = '↺ Undo ' + label;
      contentUndoBtn.style.display = 'inline-block';
    }
  }

  function clearContentUndo() {
    contentUndoBuffer = null;
    if (contentUndoBtn) contentUndoBtn.style.display = 'none';
  }

  if (contentUndoBtn) {
    contentUndoBtn.addEventListener('click', function () {
      if (!contentUndoBuffer) return;
      var label = contentUndoBuffer.label;
      editorContent.innerHTML = plainTextToSafeHtml(contentUndoBuffer.content);
      if (contentUndoBuffer.title !== undefined && contentUndoBuffer.title !== editorTitle.value) {
        editorTitle.value = contentUndoBuffer.title;
      }
      updateWordCount();
      clearContentUndo();
      autoSaveDraft();
      showToast(label.charAt(0).toUpperCase() + label.slice(1) + ' undone.');
    });
  }

  // Human labels + genre-default suggestions (soft clay — all six stay selectable).
  var RESTYLE_LABELS = {
    warmer: 'Warmer', encouraging: 'Encouraging', conviction: 'With Conviction',
    respond: 'Call to Respond', lyrical: 'More Lyrical', plainer: 'Plainer',
  };
  var RESTYLE_FORM_DEFAULT = { article: 'conviction', sermon: 'respond', letter: 'warmer', teaching: 'respond' };

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
    sourceStudy  = null;   // new session — never inherit a prior study pick
    document.querySelectorAll('input[name="writingForm"]').forEach(function (r) { r.checked = false; });
    document.querySelectorAll('input[name="writingTier"]').forEach(function (r) { r.checked = false; });
    if (formContinueBtn) formContinueBtn.disabled = true;
    tierContinueBtn.disabled = true;
    wModalStep0.style.display = 'block';
    wModalStep1.style.display = 'none';
    if (wModalStep2) wModalStep2.style.display = 'none';
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

  // ── Doors → source picker (Step 2) ──────────────────────────────────────────
  // Choosing a "how to begin" door now advances to the "Start from a study?"
  // source picker rather than landing in the workspace directly. The workspace
  // landing itself lives in proceedToWorkspace(), called once a source is chosen.
  tierContinueBtn.addEventListener('click', function () {
    if (!selectedTier) return;
    resetSourcePicker();
    wModalStep1.style.display = 'none';
    if (wModalStep2) wModalStep2.style.display = 'block';
  });

  // Land in the two-pane workspace and fire the companion's opening greeting.
  // Extracted from the old door-continue handler so the source picker can call it
  // after the writer chooses a source (a study, pasted text, or "start fresh").
  // Behaviour with no source is byte-for-byte what the door-continue did before.
  function proceedToWorkspace() {
    currentArticleId     = null;
    currentArticleStatus = 'Draft';
    answers              = [];
    editorTitle.value    = '';
    editorContent.innerHTML = '';   // article pane stays empty — the study never lands here
    syncSavedSnapshot();
    setTierBadge(selectedTier, selectedForm);
    updateWordCount();
    showState('editor');
    // Left pane: greet the writer. Fire-and-forget async (mirrors Dialogue's
    // getOpeningChallenge call); the right-pane editor stays independently usable
    // while the opening turn streams in. openWritingConversation() reads
    // sourceStudy and passes it to the opening turn when present.
    openWritingConversation();
  }

  // ── Source picker (Step 2: "Build from a study") ────────────────────────────
  // Reset to a clean slate each time we enter the picker: no source, no radio,
  // Continue disabled, panels hidden, paste box emptied.
  function resetSourcePicker() {
    sourceStudy = null;
    document.querySelectorAll('input[name="writingSource"]').forEach(function (r) { r.checked = false; });
    if (sourceContinueBtn) sourceContinueBtn.disabled = true;
    hideSourcePanels();
    if (wSourcePasteText) wSourcePasteText.value = '';
  }

  function hideSourcePanels() {
    if (wSourcePanelMine)      wSourcePanelMine.style.display = 'none';
    if (wSourcePanelCommunity) wSourcePanelCommunity.style.display = 'none';
    if (wSourcePanelPaste)     wSourcePanelPaste.style.display = 'none';
  }

  // Minimal HTML escaper (writing.js had none) — used for both text and attribute
  // contexts in the generated study cards.
  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtSourceDate(d) {
    if (!d) return '';
    var dt = new Date(d);
    if (isNaN(dt.getTime())) return '';
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // ONE generic study-list renderer, modeled on room.js loadLibraryPanel /
  // loadCommunityPanel. Config: { panel, fetchUrl, emptyMsg, errorMsg, mapItem,
  // onPick }. mapItem adapts a raw study to { id, topic, sub }; onPick receives the
  // raw study. Instantiated twice below (my studies / community) so adding another
  // source later is just another config.
  function loadSourcePanel(cfg) {
    var panel = cfg.panel;
    if (!panel) return;
    panel.style.display = 'block';
    panel.innerHTML = '<p style="font-size:0.9rem;color:var(--text-muted);margin:0;">Loading&#8230;</p>';

    fetch(cfg.fetchUrl)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var items = (data && data.success && Array.isArray(data.studies)) ? data.studies : [];
        if (!items.length) {
          panel.innerHTML = '<p style="font-size:0.9rem;color:var(--text-muted);margin:0;">' + cfg.emptyMsg + '</p>';
          return;
        }
        var byId = {};
        items.forEach(function (it) { byId[it.id] = it; });

        panel.innerHTML =
          '<p style="font-size:0.85rem;color:#5C1A28;font-weight:600;margin:0 0 0.75rem;">Select a study to build from</p>' +
          items.map(function (raw) {
            var m = cfg.mapItem(raw);
            return '<div class="w-source-card" data-id="' + escHtml(m.id) + '" style="background:#fff;border:1px solid #c4a882;border-radius:8px;padding:0.75rem 1rem;margin-bottom:0.5rem;cursor:pointer;">' +
              '<span style="font-weight:600;font-size:1rem;color:#3a2a1a;display:block;margin-bottom:0.25rem;">' + escHtml(m.topic || '(untitled)') + '</span>' +
              (m.sub ? '<span style="font-size:0.8rem;color:#6B4226;">' + escHtml(m.sub) + '</span>' : '') +
            '</div>';
          }).join('');

        panel.querySelectorAll('.w-source-card').forEach(function (card) {
          card.addEventListener('mouseenter', function () { card.style.background = '#f5ede0'; });
          card.addEventListener('mouseleave', function () { card.style.background = '#fff'; });
          card.addEventListener('click', function () {
            var raw = byId[card.dataset.id];
            if (!raw) return;
            cfg.onPick(raw);
          });
        });
      })
      .catch(function () {
        panel.innerHTML = '<p style="font-size:0.9rem;color:#c05050;margin:0;">' + cfg.errorMsg + '</p>';
      });
  }

  // Picking a study card commits it and lands in the workspace immediately (the
  // room.js pattern) — no separate Continue for the lists.
  function pickStudyAndGo(raw) {
    sourceStudy = { topic: raw.topic || '', content: raw.content || '' };
    proceedToWorkspace();
  }

  var SOURCE_CONFIGS = {
    mine: {
      panel:    wSourcePanelMine,
      fetchUrl: '/api/library',
      emptyMsg: 'No saved studies yet.',
      errorMsg: 'Failed to load your studies.',
      mapItem:  function (s) { return { id: s.id, topic: s.topic, sub: fmtSourceDate(s.savedAt) }; },
      onPick:   pickStudyAndGo,
    },
    community: {
      panel:    wSourcePanelCommunity,
      fetchUrl: '/api/community/studies',
      emptyMsg: 'No community studies available yet.',
      errorMsg: 'Failed to load community studies.',
      mapItem:  function (s) {
        var by  = 'Shared by ' + (s.authorName || 'Unknown');
        var day = fmtSourceDate(s.sharedAt);
        return { id: s.id, topic: s.topic, sub: by + (day ? ' · ' + day : '') };
      },
      onPick:   pickStudyAndGo,
    },
  };

  // Source-type selection: reveal the matching panel. My-studies / community
  // commit by clicking a card (Continue stays disabled). Paste / fresh commit via
  // the Continue button.
  document.querySelectorAll('input[name="writingSource"]').forEach(function (radio) {
    radio.addEventListener('change', function () {
      var v = radio.value;
      hideSourcePanels();
      sourceStudy = null;   // switching source discards any earlier pick
      if (v === 'mine') {
        if (sourceContinueBtn) sourceContinueBtn.disabled = true;
        loadSourcePanel(SOURCE_CONFIGS.mine);
      } else if (v === 'community') {
        if (sourceContinueBtn) sourceContinueBtn.disabled = true;
        loadSourcePanel(SOURCE_CONFIGS.community);
      } else if (v === 'paste') {
        if (wSourcePanelPaste) wSourcePanelPaste.style.display = 'block';
        if (sourceContinueBtn) sourceContinueBtn.disabled = false;
      } else {   // 'fresh'
        if (sourceContinueBtn) sourceContinueBtn.disabled = false;
      }
    });
  });

  if (sourceContinueBtn) {
    sourceContinueBtn.addEventListener('click', function () {
      var sel = document.querySelector('input[name="writingSource"]:checked');
      if (!sel) return;
      if (sel.value === 'paste') {
        var txt = (wSourcePasteText && wSourcePasteText.value || '').trim();
        // Empty paste → treat exactly like "start fresh" (no empty study seeded).
        sourceStudy = txt ? { topic: '', content: txt } : null;
      } else if (sel.value === 'fresh') {
        sourceStudy = null;
      } else {
        return;   // my-studies / community commit by card click, not Continue
      }
      proceedToWorkspace();
    });
  }

  if (sourceBackBtn) {
    sourceBackBtn.addEventListener('click', function () {
      if (wModalStep2) wModalStep2.style.display = 'none';
      wModalStep1.style.display = 'block';
    });
  }

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
      editorContent.innerHTML = plainTextToSafeHtml(data.content);
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
    sourceStudy          = null;   // reopening a saved article never carries a source pick
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
    editorContent.innerHTML = plainTextToSafeHtml(article.content);
    syncSavedSnapshot();
    setTierBadge(article.tier, article.form || 'article');
    updateWordCount();
    // Reopening a saved article: stop any stream from a prior session, then either
    // restore the saved transcript (Step 4B) or, for old records with none, show
    // the inert conversation shell. Never re-greet — greeting is the doors path only.
    abortWritingConversation();
    // Loading a different article: kill any restyle preview, and any
    // highlight-to-revise in progress — nothing should keep streaming into a
    // draft the writer left. Drop the shared undo buffer too — undo must
    // never revert across articles.
    abortRestyle();
    dismissRewriteToolbar();
    clearContentUndo();
    var savedConvo = Array.isArray(article.conversation) ? article.conversation : [];
    if (savedConvo.length) {
      restoreConversation(savedConvo);
    } else {
      resetConversationPane();
    }
    // Restore any unsent companion-input draft captured by the debounced save, so the
    // writer sees their in-progress message again. Set unconditionally (to '' when the
    // record has none) so a prior article's unsent text never bleeds across.
    if (conversationInput) conversationInput.value = article.pendingMessage || '';
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
      content: getPlainText(editorContent),
      tier:    selectedTier,
      form:    selectedForm,
      answers: { q1: answers[0], q2: answers[1], q3: answers[2], q4: answers[3], q5: answers[4] },
      status:  opts.status,
      conversation: conversationHistory,
      // In-progress, unsent companion input — read live so every save (event-based
      // or debounced) captures whatever is currently typed but not yet sent. After
      // sendWritingMessage clears the input, the next save naturally persists ''.
      pendingMessage: (conversationInput && conversationInput.value) || '',
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
      autoSaveSuppressedUntil = 0;   // a successful manual save lifts any auto-save cooldown
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
  // Failure backoff: after a failed auto-save, suppress further AUTOMATIC saves for a
  // cooldown so one persistent failure (e.g. a 413) can't retry-flood the console on
  // every typing pause. Cleared on the next successful save (auto or manual). Manual
  // Save Draft / Mark Complete is never suppressed — the writer can always save by hand.
  var AUTOSAVE_COOLDOWN_MS = 30000;
  var autoSaveSuppressedUntil = 0;
  async function autoSaveDraft() {
    if (isAutoSaving) return;
    if (Date.now() < autoSaveSuppressedUntil) return;   // in failure cooldown
    isAutoSaving = true;
    var title  = editorTitle.value.trim() || 'Untitled draft';
    var status = currentArticleStatus || 'Draft';   // preserve status; never downgrade
    try {
      await persistArticle({ title: title, status: status });
      autoSaveSuppressedUntil = 0;                   // success — clear any cooldown
    } catch (err) {
      autoSaveSuppressedUntil = Date.now() + AUTOSAVE_COOLDOWN_MS;   // back off, don't flood
      if (window.console && console.warn) {
        console.warn('Writing auto-save failed; pausing auto-save for ' +
          (AUTOSAVE_COOLDOWN_MS / 1000) + 's (manual save still available):', err && err.message);
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
    lastSavedContent = getPlainText(editorContent);
  }

  // Unsaved-work check: the live editor differs from the last clean snapshot.
  // Catches a brand-new never-saved draft AND edits made after a save.
  function editorIsDirty() {
    return editorTitle.value !== lastSavedTitle ||
           getPlainText(editorContent) !== lastSavedContent;
  }

  // Leave the two-pane workspace and return to the doors/genre flow. Same cleanup
  // the old "Start Over" did: kill any in-progress conversation stream and reset
  // conversation + editor state so nothing keeps streaming after the writer is gone.
  function leaveWorkspace() {
    abortWritingConversation();
    resetConversationPane();
    abortRestyle();
    dismissRewriteToolbar();
    clearContentUndo();
    currentArticleId     = null;
    currentArticleStatus = 'Draft';
    selectedTier         = 0;
    selectedForm         = '';
    sourceStudy          = null;   // clear any "build from a study" pick on exit
    answers              = ['', '', '', '', ''];
    editorTitle.value    = '';
    editorContent.innerHTML = '';
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
        editorContent.innerHTML = '';
        updateWordCount();
        dismissRewriteToolbar();
        clearContentUndo();   // the pre-action draft is gone; nothing to undo to
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
    // Same rule for highlight-to-revise: don't let it compete with a conversation stream.
    if (val)                 dismissRewriteToolbar();
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

    var reqBody = {
      messages:  conversationHistory,
      tier:      selectedTier,
      form:      selectedForm,
      isOpening: isOpening,
    };
    // "Build from a study": the source rides on the OPENING turn only. The greeting
    // then carries the acknowledgment forward, so we never re-send the (potentially
    // large) study on subsequent messages, and it is never written to the article pane.
    if (isOpening && sourceStudy) {
      reqBody.sourceContent = sourceStudy.content;
      reqBody.sourceTopic   = sourceStudy.topic;
    }

    try {
      var response = await fetch('/api/writing/converse', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(reqBody),
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
    pushContentUndo('add to draft');
    var cur = getPlainText(editorContent).replace(/\s+$/, '');
    editorContent.innerHTML = plainTextToSafeHtml(cur ? cur + '\n\n' + text : text);
    updateWordCount();
    showToast('Added to draft. You can undo this once.');
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
    if (getPlainText(editorContent).trim()) {
      showConfirm('Replace the current draft with a full draft written from your conversation?', 'Replace', runDraftIntoArticle);
    } else {
      runDraftIntoArticle();
    }
  }

  async function runDraftIntoArticle() {
    setConverseGenerating(true);
    if (conversationDraftBtn) conversationDraftBtn.disabled = true;
    pushContentUndo('draft-in');        // capture whatever was there before the replace
    editorContent.innerHTML = '';       // Tier 3 = "write me the whole thing" → replace
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
          fullDraft: true,   // this is a deliberate full-draft turn → raise the server token cap
        }),
        signal: writingAbortController.signal,
      });

      if (!response.ok) throw new Error('Server error ' + response.status);

      var fullText = await pumpSSE(response, function (full) {
        // Full reassignment on every chunk, same as the old .value write —
        // reassigning innerHTML this often is more expensive on a
        // contenteditable than it was on a <textarea> for a long draft
        // (rebuilds the whole text-node/<br> subtree each time); noted as a
        // follow-up optimization (e.g. throttling to every N chunks), not
        // needed for Phase 1 correctness.
        editorContent.innerHTML = plainTextToSafeHtml(full);   // stream progressively into the article
        updateWordCount();
        editorContent.scrollTop = editorContent.scrollHeight;
      });

      if (!editorTitle.value.trim()) {
        editorTitle.value = extractTitleFromContent(fullText, '');
      }
      updateWordCount();
      showToast('Draft written into the article. You can undo this once.');
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
      if (greeting) {
        // "Build from a study": the opening request seeds the study server-side
        // (via sourceContent, while conversationHistory is still empty — so it is
        // NOT double-sent on the opening wire and the server injects it exactly
        // once). But the study-laden opening user turn was never in the client's
        // history, so message #2+ dropped it and the companion "forgot" the study.
        // Fix: record that opening user turn here so it rides along in every
        // subsequent /converse request (normal conversation-context retention).
        // Pushed only alongside the greeting so history stays validly alternating
        // [user(study), assistant(greeting)]. Never written to the article pane.
        if (sourceStudy) {
          conversationHistory.push({
            role: 'user',
            content: 'Source study to build from (topic: "' + (sourceStudy.topic || 'untitled') + '"):\n\n' + sourceStudy.content,
          });
        }
        conversationHistory.push({ role: 'assistant', content: greeting });
      }
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

  // Restyle button → toggle the picker. Guards: no draft, or a stream in progress.
  if (restyleBtn) {
    restyleBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (isConverseGenerating) { showToast('Finish the current writing first.', true); return; }
      if (isRewriting) { showToast('Finish the current revision first.', true); return; }
      if (!getPlainText(editorContent).trim()) { showToast('Write something first, then restyle it.'); return; }
      dismissRewriteToolbar();   // don't let the picker and the rewrite toolbar both be up
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
    if (isRewriting) { showToast('Finish the current revision first.', true); return; }
    var draft = getPlainText(editorContent);
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

  // Accept → capture the pre-restyle draft on the shared undo buffer, swap in
  // the styled text, save, and reveal Undo. Only after the stream has finished.
  if (restyleAcceptBtn) {
    restyleAcceptBtn.addEventListener('click', function () {
      if (isRestyling) return;
      var styled = restylePreviewText;
      if (!styled || !styled.trim()) { closeRestyleOverlay(); return; }
      pushContentUndo('restyle');
      editorContent.innerHTML = plainTextToSafeHtml(styled);
      updateWordCount();
      closeRestyleOverlay();
      autoSaveDraft();                       // styled version now persists
      showToast('Restyled. You can undo this once.');
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ── Highlight-to-revise: floating popup / apply / undo (Capability 1) ─────
  // Client for POST /api/writing/rewrite. Revise rebuild Phase 2: the toolbar
  // is now a position:fixed popup anchored at the live selection via
  // getBoundingClientRect(), instead of a fixed panel docked in the page
  // layout — Phase 1 (contenteditable conversion) is what made real selection
  // geometry available at all. Selection is captured via
  // window.getSelection()/Range and converted to/from plain-text character
  // offsets (rangeToPlainTextOffsets / plainTextOffsetToRange, see the
  // contenteditable helpers above) — the same role .selectionStart/
  // .selectionEnd played on the old <textarea>. Reuses pumpSSE from above.
  // Undo lives on the shared contentUndoBuffer (see its declaration near the
  // top of the file), not a dedicated buffer.
  //
  // Reparented to a direct child of <body> once at startup: position:fixed is
  // computed relative to the viewport regardless of DOM nesting as long as no
  // ancestor creates its own containing block via transform/filter/
  // will-change (checked — none here do), but moving it out from under
  // .writing-editor-pane removes any doubt and keeps it clear of that pane's
  // own scroll/font-zoom machinery.
  // ══════════════════════════════════════════════════════════════════════════

  if (rewriteToolbar && rewriteToolbar.parentNode !== document.body) {
    document.body.appendChild(rewriteToolbar);
  }

  function isRewriteToolbarOpen() {
    return !!rewriteToolbar && rewriteToolbar.style.display !== 'none';
  }

  // Hide + reset the toolbar's own inputs. Does NOT cancel any in-flight
  // request on its own — callers that need to cancel one call abortRewrite()
  // first (dismissRewriteToolbar and every lifecycle hook do this).
  function hideRewriteToolbar() {
    if (!rewriteToolbar) return;
    rewriteToolbar.style.display = 'none';
    if (rewriteInstruction) rewriteInstruction.value = '';
    if (rewriteStatus) rewriteStatus.textContent = '';
    if (rewriteApplyBtn) rewriteApplyBtn.disabled = false;
  }

  // Anchor the popup at the END of the selection's LAST visual line, not the
  // selection's overall bounding box — for a selection spanning several
  // wrapped lines, the bounding box can be nearly as wide as the whole board,
  // which would put the popup somewhere that doesn't visually relate to
  // where the writer's eye actually is (the end of what they just selected).
  // getClientRects() gives one rect per visual line the selection touches;
  // falls back to the overall box only in the (practically unreachable)
  // case of a non-collapsed Range reporting zero rects.
  function getSelectionAnchorRect(range) {
    var rects = range.getClientRects();
    return rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
  }

  // True if `rect` visibly overlaps BOTH the browser viewport and
  // .writing-editor-pane's own visible (scrolled) area. Text can scroll out
  // of the pane's view while the pane itself is still fully on-screen (the
  // pane scrolls internally), or the whole pane can scroll out of view
  // within .main-content — either way the selection is no longer something
  // the writer can actually see, and the popup should disappear rather than
  // hover disconnected over unrelated content.
  function isRectVisibleWithinPane(rect) {
    if (!writingEditorPane) return true;
    var paneRect = writingEditorPane.getBoundingClientRect();
    var top    = Math.max(paneRect.top, 0);
    var bottom = Math.min(paneRect.bottom, window.innerHeight);
    var left   = Math.max(paneRect.left, 0);
    var right  = Math.min(paneRect.right, window.innerWidth);
    return rect.bottom > top && rect.top < bottom && rect.right > left && rect.left < right;
  }

  // Measures the popup's own size (it must be displayed, even if invisibly,
  // to do this — offsetWidth/Height are 0 while display:none), then places
  // it just below `rect`, flipping above when there isn't room below, and
  // clamping on both axes so it can never render partially off-screen. That
  // clamping is also what fixes the old panel's scroll-jump bug: focus()
  // only scrolls an element into view when it ISN'T already visible, and the
  // old fixed-panel design could render below the visible area on a long
  // article, so focusing its instruction field force-scrolled the whole page
  // down to reveal it. A popup that's always fully within the viewport by
  // construction never triggers that.
  var REWRITE_POPUP_GAP = 8;
  function positionRewriteToolbar(rect) {
    if (!rewriteToolbar) return;
    rewriteToolbar.style.visibility = 'hidden';   // measure without a flash at the wrong spot
    rewriteToolbar.style.display = 'block';
    var tw = rewriteToolbar.offsetWidth;
    var th = rewriteToolbar.offsetHeight;
    var vw = window.innerWidth;
    var vh = window.innerHeight;

    var left = rect.left;
    if (left + tw > vw - REWRITE_POPUP_GAP) left = vw - tw - REWRITE_POPUP_GAP;
    if (left < REWRITE_POPUP_GAP) left = REWRITE_POPUP_GAP;

    var spaceBelow = vh - rect.bottom;
    var spaceAbove = rect.top;
    var top;
    if (spaceBelow >= th + REWRITE_POPUP_GAP || spaceBelow >= spaceAbove) {
      top = rect.bottom + REWRITE_POPUP_GAP;   // preferred: just below the selection
    } else {
      top = rect.top - th - REWRITE_POPUP_GAP; // flip above when there's no room below
    }
    if (top < REWRITE_POPUP_GAP) top = REWRITE_POPUP_GAP;
    if (top + th > vh - REWRITE_POPUP_GAP) top = vh - th - REWRITE_POPUP_GAP;

    rewriteToolbar.style.left = left + 'px';
    rewriteToolbar.style.top  = top + 'px';
    rewriteToolbar.style.visibility = 'visible';
  }

  function showRewriteToolbar(rect, shouldFocus) {
    if (!rewriteToolbar) return;
    positionRewriteToolbar(rect);
    if (shouldFocus && rewriteInstruction) rewriteInstruction.focus();
  }

  // Abort any in-flight rewrite stream. Used by Dismiss and every lifecycle
  // hook (Back, Clear Board, loading a different article, a conversation
  // starting) so nothing keeps streaming into a draft the writer has left.
  function abortRewrite() {
    if (rewriteAbortController) { try { rewriteAbortController.abort(); } catch (e) {} }
    isRewriting = false;
  }

  // Explicit dismiss (X button, or a lifecycle hook clearing the workspace):
  // cancel any in-flight request, then hide.
  function dismissRewriteToolbar() {
    abortRewrite();
    hideRewriteToolbar();
  }

  // Selection detection — mouseup (mouse drag-select) and keyup (shift+arrow
  // / shift+home / etc.) fire directly on the board same as before. A plain
  // 'select' event is a form-control thing and doesn't fire reliably on a
  // contenteditable element; the correct replacement is the document-level
  // 'selectionchange' event (fires for ANY selection change anywhere in the
  // document), filtered below to only react when the selection is actually
  // inside #editorContent — otherwise, e.g., selecting text in the Companion
  // pane or the instruction field would also trigger this. Runs SYNCHRONOUSLY
  // now, with no debounce — the old 300ms delay's stated purpose ("don't
  // thrash the toolbar while still dragging") doesn't actually apply to
  // mouseup/keyup, which only fire once a selection gesture is already
  // complete, and a floating popup anchored at the selection is meant to
  // appear immediately, not after a pause. Never shows while a restyle or
  // conversation stream is running — Capability 1 does not compete with
  // those for the editor — and never interferes with an already-in-flight
  // rewrite of its own.
  function checkRewriteSelection() {
    if (isRewriting) return;               // don't fight the in-flight request's own UI
    if (isRestyling || isConverseGenerating) { hideRewriteToolbar(); return; }
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) { hideRewriteToolbar(); return; }
    var range = sel.getRangeAt(0);
    if (range.collapsed || !editorContent.contains(range.commonAncestorContainer)) {
      hideRewriteToolbar();
      return;
    }
    var offsets = rangeToPlainTextOffsets(editorContent, range);
    if (offsets.start === offsets.end) {
      hideRewriteToolbar();
      return;
    }
    // Only steal focus into the instruction field when the SELECTED TEXT
    // itself actually changed — contenteditable can fire more than one
    // selectionchange for what is, from the writer's perspective, a single
    // selection action, and re-focusing on every redundant firing would yank
    // focus away the instant the writer starts typing an instruction.
    var isNewSelection = !isRewriteToolbarOpen() || offsets.start !== selRewriteStart || offsets.end !== selRewriteEnd;
    selRewriteStart = offsets.start;
    selRewriteEnd   = offsets.end;
    selRewriteText  = getPlainText(editorContent).slice(offsets.start, offsets.end);
    showRewriteToolbar(getSelectionAnchorRect(range), isNewSelection);
  }

  // isDraggingSelection tracks an in-progress mouse drag so selectionchange
  // (below) can ignore it entirely: selectionchange fires continuously as a
  // drag grows the selection, and since the offsets differ on every firing,
  // showRewriteToolbar would call rewriteInstruction.focus() mid-drag on
  // nearly every one of them — moving focus away from the document while a
  // mouse-drag text selection is in progress cuts the drag short in most
  // browsers. Waiting for the drag to actually finish (mouseup) avoids this
  // entirely; mouseup is attached to `document`, not just #editorContent,
  // since a drag can end with the mouse released outside the board (e.g.
  // over the Companion pane) and still needs to be picked up.
  // isKeyDown is the same guard for the keyboard equivalent: holding
  // Shift+Arrow to extend a selection fires 'keydown' repeatedly (OS auto-
  // repeat) but 'keyup' only once, when the key is finally released — so
  // wiring checkRewriteSelection to keyup alone (below) is already safe on
  // its own. selectionchange is the risk: it fires on every auto-repeated
  // extension, and would otherwise call rewriteInstruction.focus() while the
  // key is still physically held, hijacking the rest of that keystroke
  // stream into the instruction field instead of the article.
  var isDraggingSelection = false;
  var isKeyDown            = false;
  editorContent.addEventListener('mousedown', function () { isDraggingSelection = true; });
  editorContent.addEventListener('keydown',   function () { isKeyDown = true; });
  document.addEventListener('mouseup', function (e) {
    isDraggingSelection = false;
    // A click landing INSIDE the popup itself (the instruction field, a
    // quick-action button, Apply, Dismiss) must never re-run selection
    // detection — clicking into the instruction field can itself change
    // (collapse) the page's underlying text selection as a side effect of
    // moving focus there, which would otherwise read as "selection became
    // invalid" and close the very popup being clicked into.
    if (rewriteToolbar && rewriteToolbar.contains(e.target)) return;
    checkRewriteSelection();
  });
  editorContent.addEventListener('keyup', function () {
    isKeyDown = false;
    checkRewriteSelection();
  });
  document.addEventListener('selectionchange', function () {
    if (isDraggingSelection || isKeyDown) return;
    // Same reasoning as the mouseup guard above, for the case where focus is
    // already inside the popup (e.g. mid-keystroke in the instruction field)
    // when some unrelated selection change fires — never let that close the
    // popup the writer is actively using.
    if (rewriteToolbar && rewriteToolbar.contains(document.activeElement)) return;
    var sel = window.getSelection();
    if (sel && sel.rangeCount && editorContent.contains(sel.getRangeAt(0).commonAncestorContainer)) {
      checkRewriteSelection();
    }
  });

  // Keeps the popup glued to the selection while it stays visible, and hides
  // it the moment the selection scrolls out of view — it never "follows" the
  // selection to some other fixed spot on screen, which would misleadingly
  // suggest it's still anchored to text the writer can no longer see.
  // 'scroll' doesn't bubble, so capture:true on document is the standard way
  // to catch it from ANY scrollable ancestor (.writing-editor-pane,
  // .main-content, ...) without naming them individually; window resize gets
  // the same treatment since it can just as easily move the selection
  // relative to the viewport. Rebuilds the Range from the STORED offsets
  // rather than re-reading window.getSelection(), since focus has already
  // moved to the toolbar's own instruction input by the time either of these
  // can fire — the live document selection no longer reflects the article
  // text the popup is anchored to.
  function updateRewriteToolbarOnViewportChange() {
    if (!isRewriteToolbarOpen() || isRewriting) return;
    var range = plainTextOffsetToRange(editorContent, selRewriteStart, selRewriteEnd);
    var overallRect = range.getBoundingClientRect();
    if (!isRectVisibleWithinPane(overallRect)) {
      hideRewriteToolbar();
      return;
    }
    positionRewriteToolbar(getSelectionAnchorRect(range));
  }
  document.addEventListener('scroll', updateRewriteToolbarOnViewportChange, true);
  window.addEventListener('resize', updateRewriteToolbarOnViewportChange);

  if (rewriteDismissBtn) rewriteDismissBtn.addEventListener('click', dismissRewriteToolbar);

  // Escape closes it too, mirroring the restyle picker's Escape-to-close.
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && isRewriteToolbarOpen() && !isRewriting) dismissRewriteToolbar();
  });

  // Quick-action buttons fill the instruction and apply immediately — same
  // shape as the restyle picker's style buttons.
  if (rewriteToolbar) {
    rewriteToolbar.querySelectorAll('.rewrite-quick-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (rewriteInstruction) rewriteInstruction.value = btn.getAttribute('data-instruction') || '';
        applyRewrite();
      });
    });
  }

  // Enter in the instruction field applies (it's a single-line <input>, so
  // Enter unambiguously means "go" — no Shift+Enter distinction needed).
  if (rewriteInstruction) {
    rewriteInstruction.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); applyRewrite(); }
    });
  }

  if (rewriteApplyBtn) rewriteApplyBtn.addEventListener('click', applyRewrite);

  async function applyRewrite() {
    if (isRewriting) return;                                       // guard: no overlapping requests
    if (isRestyling || isConverseGenerating) { showToast('Finish the current writing first.', true); return; }
    var instruction = rewriteInstruction ? rewriteInstruction.value.trim() : '';
    if (!instruction) { if (rewriteInstruction) rewriteInstruction.focus(); return; }
    if (!selRewriteText || selRewriteStart === selRewriteEnd) { hideRewriteToolbar(); return; }

    // Re-validate the stored offsets against the LIVE document before doing any
    // work: if anything edited the text between the selection check and now
    // (however briefly — e.g. an auto-save race, or the writer resuming
    // typing), the live slice won't match the stored passage, and splicing at
    // these offsets would corrupt the draft. Abort gracefully instead. Normal
    // path: the slice still matches the stored text, so this is a no-op.
    // (Guard runs BEFORE isRewriting/the fetch, so there's no in-flight state
    // to unwind.)
    if (getPlainText(editorContent).slice(selRewriteStart, selRewriteEnd) !== selRewriteText) {
      showToast('Selection changed — please re-select and try again.', true);
      hideRewriteToolbar();
      return;
    }

    isRewriting = true;
    if (rewriteApplyBtn) rewriteApplyBtn.disabled = true;
    if (rewriteStatus)   rewriteStatus.textContent = 'Revising…';
    rewriteAbortController = new AbortController();

    // Snapshot the passage + offsets NOW: the board's live selection is
    // already gone (focus has moved to this toolbar's own input/buttons), so
    // everything below reads the STORED values, never re-reads the live
    // selection again.
    var start   = selRewriteStart;
    var end     = selRewriteEnd;
    var passage = selRewriteText;

    try {
      var response = await fetch('/api/writing/rewrite', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ selection: passage, instruction: instruction, form: selectedForm }),
        signal:  rewriteAbortController.signal,
      });
      if (!response.ok) throw new Error('Server error ' + response.status);

      var revised = await pumpSSE(response, function (full) {
        if (rewriteStatus) rewriteStatus.textContent = 'Revising…';
      });

      revised = revised.trim();
      if (!revised) throw new Error('No revision returned.');

      // One-step undo on the shared buffer — captures the WHOLE pre-Apply
      // draft, the simplest correct way to reverse a splice at offsets that
      // may no longer make sense if anything else changed the content.
      pushContentUndo('revision');
      var spliceRange = plainTextOffsetToRange(editorContent, start, end);
      insertPlainTextAtRange(editorContent, spliceRange, revised);

      updateWordCount();
      autoSaveDraft();

      hideRewriteToolbar();
      showToast('Revised. You can undo this once.');
    } catch (err) {
      if (err.name !== 'AbortError') showToast('Error: ' + err.message, true);
    } finally {
      isRewriting = false;
      rewriteAbortController = null;
      if (rewriteApplyBtn) rewriteApplyBtn.disabled = false;
      if (rewriteStatus)   rewriteStatus.textContent = '';
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ── Companion panel collapse (replaces Find — see build notes) ────────────
  // Hides/shows .writing-conversation via a plain class toggle, mirroring the
  // app-wide sidebar's own collapse (#sidebarToggle, public/js/app.js — same
  // "toggle a class, persist to localStorage" shape). Hidden state is
  // display:none on the pane (public/css/styles.css), which drops it from the
  // flex row entirely so .writing-editor-pane's flex:1 1 60% naturally fills
  // the freed width — no JS-side width math needed. The board's own
  // max-width (same stylesheet) keeps it from stretching past a comfortable
  // reading width once that room opens up.
  // ══════════════════════════════════════════════════════════════════════════

  var COMPANION_COLLAPSED_KEY = 'ironink_writing_companion_collapsed';

  function setCompanionCollapsed(collapsed) {
    if (writingConversation) writingConversation.classList.toggle('collapsed', collapsed);
    if (companionToggleBtn) companionToggleBtn.textContent = collapsed ? 'Show Companion' : 'Hide Companion';
    try { localStorage.setItem(COMPANION_COLLAPSED_KEY, collapsed); } catch (e) {}
  }

  (function initCompanionCollapsed() {
    var collapsed = false;
    try { collapsed = localStorage.getItem(COMPANION_COLLAPSED_KEY) === 'true'; } catch (e) {}
    setCompanionCollapsed(collapsed);
  })();

  if (companionToggleBtn) {
    companionToggleBtn.addEventListener('click', function () {
      var isCollapsed = !!(writingConversation && writingConversation.classList.contains('collapsed'));
      setCompanionCollapsed(!isCollapsed);
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ── Whiteboard conveniences: text zoom + download/print (Phase C) ─────────
  // Display + export only. Zoom changes how #editorContent is SHOWN (its inline
  // fontSize), never its .value — saved content is untouched. Download/print
  // build the file client-side from the live title + body; no server round-trip.
  // ══════════════════════════════════════════════════════════════════════════

  // Bounds mirror the My Articles reading view (12–28) for consistency; default
  // ~= the textarea's resting size. Persistence follows the reading view (which
  // uses localStorage and works) but is wrapped in try/catch — localStorage is
  // unavailable/throws in some contexts, so zoom degrades to in-memory silently.
  var EFONT_DEFAULT = 15, EFONT_MIN = 12, EFONT_MAX = 28, EFONT_STEP = 2;
  var EFONT_KEY = 'ironink_editor_font_size';

  var editorFontDec   = document.getElementById('editorFontDec');
  var editorFontReset = document.getElementById('editorFontReset');
  var editorFontInc   = document.getElementById('editorFontInc');
  var editorPrintBtn    = document.getElementById('editorPrintBtn');

  function loadEditorFont() {
    try {
      var v = parseInt(localStorage.getItem(EFONT_KEY), 10);
      if (v) return Math.min(EFONT_MAX, Math.max(EFONT_MIN, v));
    } catch (e) {}
    return EFONT_DEFAULT;
  }
  function saveEditorFont(v) {
    try { localStorage.setItem(EFONT_KEY, v); } catch (e) {}
  }

  var editorFontSize = loadEditorFont();

  // Display-only zoom: sets the textarea's shown font size. Never touches .value.
  function applyEditorFontSize(size) {
    editorFontSize = Math.min(EFONT_MAX, Math.max(EFONT_MIN, size));
    if (editorContent) editorContent.style.fontSize = editorFontSize + 'px';
    saveEditorFont(editorFontSize);
  }

  applyEditorFontSize(editorFontSize);

  if (editorFontDec)   editorFontDec.addEventListener('click',   function () { applyEditorFontSize(editorFontSize - EFONT_STEP); });
  if (editorFontReset) editorFontReset.addEventListener('click', function () { applyEditorFontSize(EFONT_DEFAULT); });
  if (editorFontInc)   editorFontInc.addEventListener('click',   function () { applyEditorFontSize(editorFontSize + EFONT_STEP); });

  // Companion zoom: same bounds/step as the article's zoom above, but sized and
  // persisted independently — sets #conversationMessages' own font-size, and
  // .msg-content/.msg-role/etc (now em-based) scale off of it. Never touches
  // the article textarea or the EFONT_* state.
  var CFONT_DEFAULT = 16, CFONT_MIN = 12, CFONT_MAX = 28, CFONT_STEP = 2;
  var CFONT_KEY = 'ironink_conversation_font_size';

  var conversationFontDec   = document.getElementById('conversationFontDec');
  var conversationFontReset = document.getElementById('conversationFontReset');
  var conversationFontInc   = document.getElementById('conversationFontInc');
  var conversationMessagesEl = document.getElementById('conversationMessages');

  function loadConversationFont() {
    try {
      var v = parseInt(localStorage.getItem(CFONT_KEY), 10);
      if (v) return Math.min(CFONT_MAX, Math.max(CFONT_MIN, v));
    } catch (e) {}
    return CFONT_DEFAULT;
  }
  function saveConversationFont(v) {
    try { localStorage.setItem(CFONT_KEY, v); } catch (e) {}
  }

  var conversationFontSize = loadConversationFont();

  function applyConversationFontSize(size) {
    conversationFontSize = Math.min(CFONT_MAX, Math.max(CFONT_MIN, size));
    if (conversationMessagesEl) conversationMessagesEl.style.fontSize = conversationFontSize + 'px';
    saveConversationFont(conversationFontSize);
  }

  applyConversationFontSize(conversationFontSize);

  if (conversationFontDec)   conversationFontDec.addEventListener('click',   function () { applyConversationFontSize(conversationFontSize - CFONT_STEP); });
  if (conversationFontReset) conversationFontReset.addEventListener('click', function () { applyConversationFontSize(CFONT_DEFAULT); });
  if (conversationFontInc)   conversationFontInc.addEventListener('click',   function () { applyConversationFontSize(conversationFontSize + CFONT_STEP); });

  // Print / Download — one control. Reuses the app's shared print mechanism (the
  // same one the Library uses: a body-level #printArea shown by the global
  // `@media print` styles when body.is-printing is set). window.print() opens the
  // browser dialog, from which the user prints OR chooses "Save as PDF". No popup
  // window, so nothing to be blocked; the markdown/.md download was removed.
  var writingPrintArea = document.getElementById('printArea');
  if (!writingPrintArea) {
    writingPrintArea = document.createElement('div');
    writingPrintArea.id = 'printArea';
    writingPrintArea.setAttribute('aria-hidden', 'true');
    document.body.appendChild(writingPrintArea);
  }

  // Build clean print HTML: title as <h1>, body as escaped paragraphs (blank lines
  // split paragraphs, single newlines become <br>). The global #printArea @media
  // print rules (Georgia 12pt, styled headings/paragraphs) do the visual work.
  function buildPrintHtml(title, body) {
    var html = title ? ('<h1>' + esc(title) + '</h1>') : '';
    var paras = String(body).split(/\n{2,}/);
    for (var i = 0; i < paras.length; i++) {
      var p = paras[i].replace(/\s+$/, '');
      if (!p.trim()) continue;
      html += '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>';
    }
    return html;
  }

  function printArticle() {
    var title = editorTitle.value.trim();
    var body  = getPlainText(editorContent);
    if (!title && !body.trim()) { showToast('Nothing to print yet.'); return; }
    writingPrintArea.innerHTML = buildPrintHtml(title, body);
    document.body.classList.add('is-printing');
    window.print();
  }

  window.addEventListener('afterprint', function () {
    document.body.classList.remove('is-printing');
    if (writingPrintArea) writingPrintArea.innerHTML = '';
  });

  if (editorPrintBtn) editorPrintBtn.addEventListener('click', printArticle);

  // ── Article list (Draft only) ─────────────────────────────────────────────
  async function loadArticleList() {
    try {
      var res  = await fetch('/api/articles');
      var data = await res.json();
      var drafts = (data.articles || []).filter(function (a) { return a.status === 'Draft' && !a.deleted; });
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
        '</div>' +
        '<div class="article-card-meta">' +
          '<span class="tier-badge-sm">Tier ' + a.tier + '</span>' +
          '<span class="form-badge form-badge-' + esc(a.form || 'article') + '">' + formLabel + '</span>' +
          '<span class="article-card-date">' + fmtDate(a.updatedAt || a.createdAt) + '</span>' +
        '</div>' +
        '<div style="display:flex; gap:10px; align-items:center; margin-top:12px;">' +
          '<button class="btn-warm article-open-btn" data-id="' + esc(a.id) + '" style="font-size:0.82rem; padding:7px 18px;">Open</button>' +
          '<button class="btn-delete-article article-delete-btn" data-id="' + esc(a.id) + '" data-status="' + esc(a.status || 'Draft') + '">Delete</button>' +
        '</div>' +
      '</div>';
    }).join('');

    articleList.querySelectorAll('.article-open-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { openArticleById(btn.dataset.id); });
    });

    articleList.querySelectorAll('.article-delete-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var id       = btn.dataset.id;
        var isDraft  = (btn.dataset.status === 'Draft');
        var confirmMsg = isDraft
          ? 'Delete this draft? This cannot be undone.'
          : 'Move this article to trash?';

        showConfirm(confirmMsg, isDraft ? 'Delete' : 'Move to Trash', async function () {
          try {
            var trashRes  = await fetch('/api/articles/' + encodeURIComponent(id) + '/trash', { method: 'PATCH' });
            var trashData = await trashRes.json();
            if (!trashData.success) { showToast(trashData.error || 'Delete failed.', true); return; }

            if (isDraft) {
              var delRes  = await fetch('/api/articles/' + encodeURIComponent(id), { method: 'DELETE' });
              var delData = await delRes.json();
              if (!delData.success) { showToast(delData.error || 'Delete failed.', true); return; }
              showToast('Draft deleted.');
            } else {
              showToast('Moved to trash.');
            }
            loadArticleList();
          } catch (err) {
            showToast('Error: ' + err.message, true);
          }
        });
      });
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function setTierBadge(tier, form) {
    var tierLabels = { 1: 'Tier 1 — I\'ll write it', 2: 'Tier 2 — Let\'s write it together', 3: 'Tier 3 — Write it for me' };
    var formLabel  = formDisplayLabel(form);
    editorTierBadge.textContent = (tierLabels[tier] || 'Tier ' + tier) + (formLabel ? ' · ' + formLabel : '');
  }

  function formDisplayLabel(form) {
    var labels = { article: 'Article', sermon: 'Sermon', letter: 'Letter', teaching: 'Teaching Guide' };
    return labels[form] || 'Article';
  }

  function updateWordCount() {
    var text  = getPlainText(editorContent).trim();
    var words = text ? text.split(/\s+/).length : 0;
    editorWordCount.textContent = words + ' word' + (words !== 1 ? 's' : '');
  }

  editorContent.addEventListener('input', updateWordCount);

  // ── Debounced save-on-typing-pause ─────────────────────────────────────────
  // Closes the gap the event-based autoSaveDraft() leaves open: text typed into the
  // article body or the companion input — but not yet committed by a completed
  // exchange, add-to-draft, or Tier 3 draft-in — was never captured. These fire a
  // silent save 2s after typing stops, reusing the same save path. The isAutoSaving
  // in-flight guard already prevents overlap with the event-based triggers, so no
  // new guard is needed. Completely silent — no toast, no UI change.
  var editorSaveDebounceTimer = null;
  var inputSaveDebounceTimer  = null;
  var SAVE_DEBOUNCE_MS = 2000;

  editorContent.addEventListener('input', function () {
    if (editorSaveDebounceTimer) clearTimeout(editorSaveDebounceTimer);
    editorSaveDebounceTimer = setTimeout(function () {
      if (!getPlainText(editorContent).trim()) return;   // nothing in the body to save
      autoSaveDraft();
    }, SAVE_DEBOUNCE_MS);
  });

  if (conversationInput) {
    conversationInput.addEventListener('input', function () {
      if (inputSaveDebounceTimer) clearTimeout(inputSaveDebounceTimer);
      inputSaveDebounceTimer = setTimeout(function () {
        if (!conversationInput.value.trim()) return;   // no unsent text to capture
        // persistArticle reads conversationInput.value live as pendingMessage.
        autoSaveDraft();
      }, SAVE_DEBOUNCE_MS);
    });
  }

  // ── Board input handling (Revise rebuild Phase 1) ──────────────────────────
  // Two behaviors a plain <textarea> gave for free that a contenteditable
  // must implement by hand:

  // 1. Paste as plain text only — never the source's HTML (fonts, colors,
  // nested tags). Forces text/plain and routes it through the same
  // line-by-line insertion primitive Revise's splice uses, so pasted content
  // becomes ordinary text with literal \n line breaks, never markup —
  // keeping the "always flat, always plain" invariant getPlainText depends
  // on. No manual updateWordCount()/autosave nudge needed afterward —
  // execCommand-driven inserts fire real native 'input' events, same as the
  // writer having typed it.
  editorContent.addEventListener('paste', function (e) {
    e.preventDefault();
    var text = (e.clipboardData || window.clipboardData).getData('text/plain');
    insertPlainTextAtSelection(editorContent, text);
  });

  // 2. Enter inserts a single line break, never a browser-default new
  // <div>/<p> — which browser is used, and even its version, determines
  // what a bare contenteditable does with Enter by default, and any of
  // those choices would break getPlainText()'s flat-DOM assumption.
  // e.isComposing guards against IME composition: many IMEs (CJK phonetic
  // input, but also some diacritic/dead-key sequences relevant to this
  // app's transliterated Hebrew/Greek terms) use Enter to CONFIRM a
  // composition candidate, not to insert a line break — intercepting
  // unconditionally would swallow that confirmation and corrupt text entry
  // for anyone using one.
  editorContent.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    insertPlainTextAtCurrentSelection('\n');
  });

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
