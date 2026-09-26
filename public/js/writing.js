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

  // ── Shared content-undo buffer ─────────────────────────────────────────────
  // ONE single-step undo buffer shared by every content-mutating action:
  // restyle accept, Revise apply, add-to-draft, and draft-into-article. Each
  // push captures { delta, title, label } — the WHOLE board as a Quill Delta
  // (quill.getContents(), so formatting comes back too), since that's the
  // simplest correct way to reverse any of these regardless of what kind of
  // edit it made. Quill's own history (Ctrl+Z) handles ordinary typing. `label` names the
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
  // Dismiss-while-streaming. selRewriteIndex/Length/Text are the Quill range
  // (quill.getSelection()) captured when a 'user' selection is detected, and
  // read again (not re-measured) at Apply time, since focus has by then moved
  // to the popup's own input/buttons and the board's live selection is gone.
  var isRewriting            = false;
  var rewriteAbortController = null;
  var selRewriteIndex        = 0;
  var selRewriteLength       = 0;
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
  // ── Article board: Quill 2 ────────────────────────────────────────────────
  // #editorContent is a Quill 2 editor (snow theme, same editor CaseDesk
  // uses). Everything that reads or writes the article goes through the
  // helpers in this block:
  //   boardText()         plain text (quill.getText()) — word count, AI calls,
  //                       the saved plain-text copy
  //   boardHtml()         formatted HTML (getSemanticHTML) — saved as
  //                       contentHtml, printed
  //   textToDelta()       plain/markdown-ish text → Delta, for legacy articles
  //                       and AI text (add-to-draft, draft-in, restyle)
  //   inlineTextToDelta() the same for a passage spliced mid-paragraph (Revise)
  // `formats` below is the single allowlist of what the board can hold — Quill
  // drops anything else, including on paste. It mirrors the server sanitizer
  // (lib/articleHtml.js) and the reader sanitizer (public/js/article-html.js).
  // ══════════════════════════════════════════════════════════════════════════

  // Highlight colours: soft parchment tints (gold, oxblood rose, sage, slate).
  var HIGHLIGHT_COLORS = ['#f3dfa2', '#ecc9c3', '#d9e2c4', '#d3dde6'];
  var BOARD_FORMATS    = ['header', 'size', 'bold', 'italic', 'underline', 'list', 'blockquote', 'background'];
  var Delta            = Quill.import('delta');

  var quill = new Quill(editorContent, {
    theme:       'snow',
    placeholder: 'Your article will appear here…',
    formats:     BOARD_FORMATS,
    modules: {
      toolbar: [
        [{ header: [2, 3, false] }, { size: ['small', false, 'large', 'huge'] }],
        ['bold', 'italic', 'underline'],
        [{ list: 'bullet' }, { list: 'ordered' }, 'blockquote'],
        [{ background: [false].concat(HIGHLIGHT_COLORS) }],
        ['clean'],
      ],
      // userOnly:false so programmatic edits (add-to-draft, restyle, Revise)
      // are Ctrl+Z-able too; history is cleared after every full load.
      history: { delay: 1000, maxStack: 200, userOnly: false },
    },
  });

  // Toolbar tooltips (Quill ships none).
  (function labelToolbar() {
    var tb = quill.getModule('toolbar');
    if (!tb || !tb.container) return;
    var titles = {
      'ql-bold': 'Bold (Ctrl+B)', 'ql-italic': 'Italic (Ctrl+I)', 'ql-underline': 'Underline (Ctrl+U)',
      'ql-blockquote': 'Blockquote', 'ql-clean': 'Clear formatting',
    };
    Object.keys(titles).forEach(function (cls) {
      var b = tb.container.querySelector('button.' + cls);
      if (b) b.title = titles[cls];
    });
    tb.container.querySelectorAll('button.ql-list').forEach(function (b) {
      b.title = b.value === 'ordered' ? 'Numbered list' : 'Bulleted list';
    });
    var pickers = { 'ql-header': 'Heading', 'ql-size': 'Text size', 'ql-background': 'Highlight' };
    Object.keys(pickers).forEach(function (cls) {
      var p = tb.container.querySelector('.ql-picker.' + cls);
      if (p) p.title = pickers[cls];
    });
  })();

  // Sticky board head: Quill's toolbar plus the Find bar, so both stay in view
  // while the pane scrolls (see .article-board-head in styles.css). Moving
  // the toolbar node is safe — Quill keeps its own reference to it.
  (function buildBoardHead() {
    var tb = quill.getModule('toolbar');
    if (!tb || !tb.container || !tb.container.parentNode) return;
    var head = document.createElement('div');
    head.className = 'article-board-head';
    tb.container.parentNode.insertBefore(head, tb.container);
    head.appendChild(tb.container);
    var fb = document.getElementById('findBar');
    if (fb) head.appendChild(fb);
  })();

  // ── Paste / load normalizer ────────────────────────────────────────────────
  // Runs on every element Quill's clipboard converts (paste AND loading saved
  // contentHtml). The formats allowlist already drops unsupported formats;
  // this tightens the two supported ones whose VALUES can arrive out of range
  // from pasted content: headings other than H2/H3 are mapped onto them, and
  // highlights in any colour other than the board's palette are removed.
  function hexFromColor(value) {
    var v = String(value || '').trim().toLowerCase();
    var m = v.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/);
    if (m) {
      return '#' + [m[1], m[2], m[3]].map(function (n) {
        var h = Math.min(255, parseInt(n, 10)).toString(16);
        return h.length === 1 ? '0' + h : h;
      }).join('');
    }
    if (/^#[0-9a-f]{3}$/.test(v)) return '#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
    return v;
  }
  function isPaletteColor(value) {
    return HIGHLIGHT_COLORS.indexOf(hexFromColor(value)) !== -1;
  }
  quill.clipboard.addMatcher(Node.ELEMENT_NODE, function (node, delta) {
    delta.ops.forEach(function (op) {
      var a = op.attributes;
      if (!a) return;
      if (a.header != null) a.header = a.header <= 2 ? 2 : 3;
      if (a.background != null) {
        if (isPaletteColor(a.background)) a.background = hexFromColor(a.background);
        else delete a.background;
      }
      if (!Object.keys(a).length) delete op.attributes;
    });
    return delta;
  });

  // ── Text → Delta ───────────────────────────────────────────────────────────
  // AI text and legacy (pre-Quill) articles are plain text carrying the light
  // markdown the rest of the app already renders with marked: verse blocks
  // come back from the server as `> “…” — Ref (NASB 1995)`, inline verses as
  // `*“…”* — Ref`, the Lockman notice as `*…*`, and drafts use `#` headings
  // and `**bold**`. Converting just that subset keeps Scripture looking the
  // way My Articles / Community already show it, instead of leaving raw `>`
  // and `*` on the board. Text is never dropped — only those markers. Blank
  // line(s) = paragraph break; a single newline also starts a new paragraph
  // (Quill has no soft line break).
  var INLINE_MD_RE = /\*\*([^\s*](?:[^*\n]*[^\s*])?)\*\*|\*([^\s*](?:[^*\n]*[^\s*])?)\*/g;

  function appendInlineMarkdown(delta, line) {
    var last = 0;
    var m;
    INLINE_MD_RE.lastIndex = 0;
    while ((m = INLINE_MD_RE.exec(line))) {
      if (m.index > last) delta.insert(line.slice(last, m.index));
      if (m[1] != null) delta.insert(m[1], { bold: true });
      else              delta.insert(m[2], { italic: true });
      last = INLINE_MD_RE.lastIndex;
    }
    if (last < line.length) delta.insert(line.slice(last));
    return delta;
  }

  function textToDelta(text) {
    var delta = new Delta();
    var src = String(text == null ? '' : text).replace(/\r\n?/g, '\n').replace(/^(?:[ \t]*\n)+/, '').replace(/\s+$/, '');
    if (!src) return delta;
    src.split(/\n[ \t]*\n\s*/).forEach(function (para) {
      para.split('\n').forEach(function (line) {
        var attrs = null;
        var m;
        if ((m = line.match(/^(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/))) {
          attrs = { header: m[1].length <= 2 ? 2 : 3 };
          line  = m[2];
        } else if ((m = line.match(/^[ \t]{0,3}>[ \t]?(.*)$/))) {
          attrs = { blockquote: true };
          line  = m[1];
        } else if ((m = line.match(/^[ \t]*[-*+][ \t]+(.*)$/))) {
          attrs = { list: 'bullet' };
          line  = m[1];
        } else if ((m = line.match(/^[ \t]*\d{1,3}[.)][ \t]+(.*)$/))) {
          attrs = { list: 'ordered' };
          line  = m[1];
        }
        appendInlineMarkdown(delta, line);
        if (attrs) delta.insert('\n', attrs);
        else       delta.insert('\n');
      });
    });
    return delta;
  }

  // Revise splices a passage INTO an existing paragraph, so only inline
  // markers are converted; line breaks stay plain (blank lines collapse to
  // one break, since Quill paragraphs already carry their own spacing). A
  // verse the server rendered in block form (`> “…” — Ref`, because the
  // passage starts a line from its point of view) loses just the `> ` marker —
  // the spliced line keeps whatever block format the board line already has.
  function inlineTextToDelta(text) {
    var delta = new Delta();
    String(text).replace(/\r\n?/g, '\n').replace(/\n{2,}/g, '\n').split('\n').forEach(function (line, i) {
      if (i > 0) delta.insert('\n');
      appendInlineMarkdown(delta, line.replace(/^[ \t]{0,3}>[ \t]?(?=\S)/, ''));
    });
    return delta;
  }

  // ── Board read helpers ─────────────────────────────────────────────────────
  function boardIsEmpty() {
    return !quill.getText().trim();
  }

  // Plain text of the whole board (quill.getText()) — what the Companion,
  // Restyle, word count and the saved plain-text copy all use.
  function boardText() {
    return quill.getText();
  }

  // Formatted HTML for saving/printing. getSemanticHTML() (Quill 2.0.3)
  // writes every space as &nbsp;, which would stop readers' text from ever
  // wrapping — turn each run back into a normal space, keeping extra spaces
  // in a run as &nbsp; so deliberate double spaces survive.
  function boardHtml() {
    if (boardIsEmpty()) return '';
    return quill.getSemanticHTML().replace(/(?:&nbsp;)+/g, function (run) {
      var n = run.length / 6;
      return ' ' + new Array(n).join('&nbsp;');
    });
  }

  function boardHasFormatting() {
    return quill.getContents().ops.some(function (op) {
      return op.attributes && Object.keys(op.attributes).length > 0;
    });
  }

  // ── Board write helpers ────────────────────────────────────────────────────
  // Full replacement of the board. `source`:
  //   'silent' — loads (article open, new session, streaming chunks): no
  //              text-change, so no auto-save; Quill history is cleared since
  //              it never saw the change.
  //   'api'    — AI edits / undo: fires text-change (word count, find
  //              refresh) and is Ctrl+Z-able.
  function setBoard(delta, source) {
    quill.setContents(delta || new Delta(), source || 'api');
    if (source === 'silent') {
      quill.history.clear();
      updateWordCount();
      refreshBoardOverlays();
    }
  }

  function clearBoard(source) {
    setBoard(new Delta(), source);
  }

  // Open a saved article: formatted HTML when it has it, else convert its
  // legacy plain text.
  function loadBoardFromArticle(article) {
    var html = article && typeof article.contentHtml === 'string' ? article.contentHtml : '';
    if (html.trim()) {
      var clean = window.IronInkArticleHtml ? window.IronInkArticleHtml.sanitize(html) : html;
      setBoard(quill.clipboard.convert({ html: clean }), 'silent');
    } else {
      setBoard(textToDelta(article ? article.content : ''), 'silent');
    }
  }

  // ── Board overlays (find match / Revise selection) ─────────────────────────
  // Moving focus out of the board (into the find field or the Revise popup)
  // hides the browser's own selection highlight, so these absolutely
  // positioned boxes inside the Quill container mark the passage instead.
  // quill.getBounds() is relative to that container, and the container grows
  // with its content (the pane scrolls, not the board), so they stay aligned
  // while scrolling; they're redrawn on edits, zoom and resize.
  var overlayTargets = { find: null, revise: null };
  var overlayEls     = {};

  function drawOverlay(kind) {
    var target = overlayTargets[kind];
    var el = overlayEls[kind];
    if (!target) { if (el) el.style.display = 'none'; return; }
    if (!el) {
      el = document.createElement('div');
      el.className = 'board-overlay board-overlay-' + kind;
      el.setAttribute('aria-hidden', 'true');
      quill.container.appendChild(el);
      overlayEls[kind] = el;
    }
    var b = target.length > 0 ? quill.getBounds(target.index, target.length) : null;
    if (!b) { el.style.display = 'none'; return; }
    el.style.left    = b.left + 'px';
    el.style.top     = b.top + 'px';
    el.style.width   = Math.max(2, b.width) + 'px';
    el.style.height  = b.height + 'px';
    el.style.display = 'block';
  }

  function setOverlay(kind, index, length) {
    overlayTargets[kind] = (index == null) ? null : { index: index, length: length };
    drawOverlay(kind);
  }

  function refreshBoardOverlays() {
    drawOverlay('find');
    drawOverlay('revise');
  }

  // Push one snapshot onto the shared one-step undo buffer and reveal the
  // button with a label naming what it would revert. Shared by restyle
  // accept, Revise apply, add-to-draft, and draft-into-article — see
  // contentUndoBuffer's declaration above for why these four share one
  // buffer instead of each keeping their own.
  function pushContentUndo(label) {
    contentUndoBuffer = { delta: quill.getContents(), title: editorTitle.value, label: label };
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
      dismissRewriteToolbar();
      setBoard(contentUndoBuffer.delta, 'api');
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
    clearBoard('silent');   // article pane stays empty — the study never lands here
    closeFindBar(false);
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
      setBoard(textToDelta(data.content), 'silent');
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
    // Formatted HTML when the article has it; legacy plain-text articles are
    // converted on load (blank line = paragraph break). Nothing is written
    // back until the writer edits or saves.
    loadBoardFromArticle(article);
    closeFindBar(false);
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
      // Plain-text copy (quill.getText(), trailing newline trimmed) for word
      // counts and AI use; contentHtml is the formatted board, sanitized again
      // server-side before it's stored.
      content:     boardText().replace(/\n+$/, ''),
      contentHtml: boardHtml(),
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
    lastSavedContent = boardHtml();   // HTML, so formatting-only edits count as unsaved
  }

  // Unsaved-work check: the live editor differs from the last clean snapshot.
  // Catches a brand-new never-saved draft AND edits made after a save.
  function editorIsDirty() {
    return editorTitle.value !== lastSavedTitle ||
           boardHtml() !== lastSavedContent;
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
    clearBoard('silent');
    closeFindBar(false);
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
        dismissRewriteToolbar();
        clearBoard('api');
        updateWordCount();
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
    // Give the companion sight of the article board. Read fresh on every turn and
    // sent as its own field — never pushed into conversationHistory, so it is not
    // accumulated. The server ignores it when empty.
    reqBody.articleContent = boardText();
    reqBody.articleTitle   = editorTitle.value;

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

  // Append the message to the end of the board as new paragraphs (after any
  // existing content; the existing board and its formatting are untouched).
  // `text` is the message's accumulated stream text — markdown with verse
  // markers ALREADY resolved to verified text by the server — so nothing raw
  // can reach the editor; textToDelta turns its blank lines into paragraph
  // breaks and its verse blockquote / emphasis markers into formatting.
  function appendToDraft(text) {
    if (!text) return;
    var add = textToDelta(text);
    if (!add.length()) return;
    pushContentUndo('add to draft');
    if (!isRewriting) hideRewriteToolbar();   // never abort an in-flight revision
    // Existing contents always end with Quill's trailing newline, so the
    // appended paragraphs start on a fresh line and nothing above is re-formatted.
    setBoard(boardIsEmpty() ? add : quill.getContents().concat(add), 'api');
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
    if (!boardIsEmpty()) {
      showConfirm('Replace the current draft with a full draft written from your conversation?', 'Replace', runDraftIntoArticle);
    } else {
      runDraftIntoArticle();
    }
  }

  async function runDraftIntoArticle() {
    setConverseGenerating(true);
    if (conversationDraftBtn) conversationDraftBtn.disabled = true;
    // Read the board BEFORE it is cleared below, so the companion drafts with
    // sight of what the writer already has (sent as its own field, not history).
    var articleContent = boardText();
    var articleTitle   = editorTitle.value;
    pushContentUndo('draft-in');        // capture whatever was there before the replace
    dismissRewriteToolbar();
    closeFindBar(false);
    clearBoard('silent');               // Tier 3 = "write me the whole thing" → replace
    // Read-only while the draft streams in: every chunk re-renders the whole
    // board, so typing (or Ctrl+Z) mid-stream would be clobbered or corrupt.
    quill.disable();
    writingAbortController = new AbortController();

    // Chunks are rendered at most every DRAFT_RENDER_MS (the whole draft is
    // re-converted each time), plus once at the end with the final text.
    var DRAFT_RENDER_MS = 120;
    var latestDraft     = '';
    var lastDraftRender = 0;
    function renderDraft(text) {
      setBoard(textToDelta(text), 'silent');
      lastDraftRender = Date.now();
      if (writingEditorPane) writingEditorPane.scrollTop = writingEditorPane.scrollHeight;
    }

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
          articleContent: articleContent,
          articleTitle:   articleTitle,
        }),
        signal: writingAbortController.signal,
      });

      if (!response.ok) throw new Error('Server error ' + response.status);

      var fullText = await pumpSSE(response, function (full) {
        latestDraft = full;   // stream progressively into the article
        if (Date.now() - lastDraftRender >= DRAFT_RENDER_MS) renderDraft(full);
      });
      latestDraft = fullText;
      renderDraft(fullText);

      if (!editorTitle.value.trim()) {
        editorTitle.value = extractTitleFromContent(fullText, '');
      }
      updateWordCount();
      showToast('Draft written into the article. You can undo this once.');
      autoSaveDraft();   // preserve the drafted-in article content silently
    } catch (err) {
      // Stopped or failed mid-stream: keep whatever arrived (as before), fully
      // rendered — the last throttled chunk may be behind.
      if (latestDraft) renderDraft(latestDraft);
      if (err.name !== 'AbortError') showToast('Error: ' + err.message, true);
    } finally {
      quill.enable();
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
      if (boardIsEmpty()) { showToast('Write something first, then restyle it.'); return; }
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
    var draft = boardText();
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
  // The restyle engine works on (and returns) plain text, so accepting drops
  // the board's formatting — confirm first when there is any to lose. (The
  // shared Undo restores it, formatting included.)
  function acceptRestyle() {
    if (isRestyling) return;
    var styled = restylePreviewText;
    if (!styled || !styled.trim()) { closeRestyleOverlay(); return; }
    pushContentUndo('restyle');
    dismissRewriteToolbar();
    setBoard(textToDelta(styled), 'api');
    updateWordCount();
    closeRestyleOverlay();
    autoSaveDraft();                       // styled version now persists
    showToast('Restyled. You can undo this once.');
  }

  if (restyleAcceptBtn) {
    restyleAcceptBtn.addEventListener('click', function () {
      if (isRestyling) return;
      if (boardHasFormatting()) {
        showConfirm('Restyle returns plain text and will remove your formatting. Continue?', 'Continue', acceptRestyle);
      } else {
        acceptRestyle();
      }
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ── Highlight-to-revise: floating popup / apply / undo (Capability 1) ─────
  // Client for POST /api/writing/rewrite. The popup is position:fixed,
  // anchored at the selection via quill.getBounds() (relative to
  // quill.container, converted to viewport coordinates). Selection comes from
  // Quill's 'selection-change' event and ONLY opens the popup for source
  // 'user' — programmatic selections (the Find bar's setSelection(..., 'api'),
  // restores, loads) never do. The Quill range (index/length) is stored and
  // reused at Apply time; the splice is quill.deleteText + quill.insertText.
  // Reuses pumpSSE from above. Undo lives on the shared contentUndoBuffer.
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
    setOverlay('revise', null);
  }

  // Viewport rects for a Quill range. `anchor` is the END of the selection's
  // LAST visual line (top/bottom of the last selected character, left edge of
  // the whole selection) — for a selection spanning several wrapped lines the
  // overall box can be nearly as wide and tall as the board, which would put
  // the popup somewhere unrelated to where the writer's eye actually is.
  // `overall` is the whole selection's box, used for the visibility check.
  function rewriteRangeRects(index, length) {
    var full = quill.getBounds(index, length);
    var last = quill.getBounds(index + length - 1, 1);
    if (!full || !last) return null;
    var c = quill.container.getBoundingClientRect();
    return {
      anchor: {
        left:   c.left + full.left,
        top:    c.top + last.top,
        bottom: c.top + last.bottom,
      },
      overall: {
        left:   c.left + full.left,
        right:  c.left + full.right,
        top:    c.top + full.top,
        bottom: c.top + full.bottom,
      },
    };
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
  // clamping is also what prevents the old scroll-jump bug: focus() only
  // scrolls an element into view when it ISN'T already visible, and a popup
  // that's always fully within the viewport by construction never triggers
  // that (focus is also called with preventScroll as a belt-and-braces).
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
    // Focus leaves the board, which hides the browser's selection highlight —
    // the revise overlay keeps the chosen passage marked while the popup is up.
    setOverlay('revise', selRewriteIndex, selRewriteLength);
    if (shouldFocus && rewriteInstruction) rewriteInstruction.focus({ preventScroll: true });
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

  // React to a USER selection on the board. Never shows while a restyle or
  // conversation stream is running — Capability 1 does not compete with
  // those for the editor — and never interferes with an already-in-flight
  // rewrite of its own. A collapsed selection (a click / caret move inside the
  // board) closes the popup; whitespace-only selections are ignored.
  function handleRewriteSelection(range) {
    if (isRewriting) return;               // don't fight the in-flight request's own UI
    if (isRestyling || isConverseGenerating || !quill.isEnabled()) { hideRewriteToolbar(); return; }
    if (!range || range.length === 0) { hideRewriteToolbar(); return; }
    var text = quill.getText(range.index, range.length);
    if (!text.trim()) { hideRewriteToolbar(); return; }
    var rects = rewriteRangeRects(range.index, range.length);
    if (!rects) { hideRewriteToolbar(); return; }
    // Only move focus into the instruction field when the selection itself
    // changed — a repeat event for the same range must not yank focus away
    // while the writer is already typing an instruction.
    var isNewSelection = !isRewriteToolbarOpen() ||
      range.index !== selRewriteIndex || range.length !== selRewriteLength;
    selRewriteIndex  = range.index;
    selRewriteLength = range.length;
    selRewriteText   = text;
    showRewriteToolbar(rects.anchor, isNewSelection);
  }

  // Quill already holds 'selection-change' back during a mouse drag (it
  // emits once, on mouseup). The keyboard equivalent — Shift+Arrow held down
  // to extend a selection — emits on every auto-repeat, and moving focus into
  // the instruction field mid-keystroke would hijack the rest of the
  // keystrokes, so while a key is down we wait and re-check on keyup.
  // The release is caught on `document` (and window blur) rather than the
  // board, since focus can leave mid-press (e.g. Ctrl+F moves it to the find
  // field) and a missed keyup would otherwise suppress the popup for good.
  var isKeyDown = false;
  quill.root.addEventListener('keydown', function () { isKeyDown = true; });
  document.addEventListener('keyup', function (e) {
    if (!isKeyDown) return;
    isKeyDown = false;
    if (!quill.root.contains(e.target)) return;
    var range = quill.getSelection();      // no focus change
    if (range) handleRewriteSelection(range);
  });
  window.addEventListener('blur', function () { isKeyDown = false; });

  quill.on('selection-change', function (range, oldRange, source) {
    if (source !== 'user') return;         // 'api' / 'silent' (Find, loads) never open the popup
    if (!range) return;                    // blur — focus moved (e.g. into the popup itself)
    if (isKeyDown) return;                 // handled on keyup
    handleRewriteSelection(range);
  });

  // A press anywhere outside the popup and the board (Companion pane, page
  // chrome, …) closes the popup, as it did before. Presses on the board are
  // left to selection-change; presses on the formatting toolbar keep it open.
  document.addEventListener('mousedown', function (e) {
    if (!isRewriteToolbarOpen() || isRewriting) return;
    if (rewriteToolbar.contains(e.target)) return;
    var board = document.getElementById('articleBoard');
    if (board && board.contains(e.target)) return;
    hideRewriteToolbar();
  });

  // Keeps the popup glued to the selection while it stays visible, and hides
  // it the moment the selection scrolls out of view — it never "follows" the
  // selection to some other fixed spot on screen, which would misleadingly
  // suggest it's still anchored to text the writer can no longer see.
  // 'scroll' doesn't bubble, so capture:true on document is the standard way
  // to catch it from ANY scrollable ancestor (.writing-editor-pane,
  // .main-content, ...); window resize gets the same treatment. Rebuilds the
  // position from the STORED Quill range, since focus has already moved to
  // the popup's own instruction input by the time either of these fires.
  function updateRewriteToolbarOnViewportChange() {
    if (!isRewriteToolbarOpen() || isRewriting) return;
    var rects = rewriteRangeRects(selRewriteIndex, selRewriteLength);
    if (!rects || !isRectVisibleWithinPane(rects.overall)) {
      hideRewriteToolbar();
      return;
    }
    positionRewriteToolbar(rects.anchor);
  }
  document.addEventListener('scroll', updateRewriteToolbarOnViewportChange, true);
  window.addEventListener('resize', function () {
    refreshBoardOverlays();
    updateRewriteToolbarOnViewportChange();
  });

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
    if (!instruction) { if (rewriteInstruction) rewriteInstruction.focus({ preventScroll: true }); return; }
    if (!selRewriteText || !selRewriteLength) { hideRewriteToolbar(); return; }

    // Re-validate the stored range against the LIVE board before doing any
    // work: if anything edited the text between the selection and now, the
    // live slice won't match the stored passage, and splicing at this range
    // would corrupt the draft. Abort gracefully instead.
    if (quill.getText(selRewriteIndex, selRewriteLength) !== selRewriteText) {
      showToast('Selection changed — please re-select and try again.', true);
      hideRewriteToolbar();
      return;
    }

    isRewriting = true;
    if (rewriteApplyBtn) rewriteApplyBtn.disabled = true;
    if (rewriteStatus)   rewriteStatus.textContent = 'Revising…';
    rewriteAbortController = new AbortController();

    // Snapshot the passage + range NOW; everything below reads these.
    var index   = selRewriteIndex;
    var length  = selRewriteLength;
    var passage = selRewriteText;

    try {
      var response = await fetch('/api/writing/rewrite', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ selection: passage, instruction: instruction, form: selectedForm }),
        signal:  rewriteAbortController.signal,
      });
      if (!response.ok) throw new Error('Server error ' + response.status);

      var revised = await pumpSSE(response, function () {
        if (rewriteStatus) rewriteStatus.textContent = 'Revising…';
      });

      revised = revised.trim();
      if (!revised) throw new Error('No revision returned.');

      // The request is async — re-check the passage is still exactly where it
      // was before splicing (the board stays editable while it runs).
      if (quill.getText(index, length) !== passage) {
        throw new Error('The passage changed while revising — please re-select and try again.');
      }

      // One-step undo on the shared buffer — the WHOLE pre-Apply board as a
      // Delta, formatting included.
      pushContentUndo('revision');

      // Splice: the revision comes back as plain text (inline **/* emphasis
      // from the model becomes bold/italic). Formatting inside the replaced
      // passage is lost; the rest of the article is untouched.
      quill.deleteText(index, length, 'user');
      var pos = index;
      inlineTextToDelta(revised).ops.forEach(function (op) {
        if (typeof op.insert !== 'string') return;
        quill.insertText(pos, op.insert, op.attributes || {}, 'user');
        pos += op.insert.length;
      });

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
  // ── Find (Ctrl+F / Find button) ───────────────────────────────────────────
  // Case-insensitive search over quill.getText() (whose indices are Quill
  // indices — the board has no embeds). Each match is selected with
  // quill.setSelection(index, length, 'api') — which also scrolls it into
  // view — and because the source is 'api' the Revise popup never opens for
  // it (that listener only reacts to 'user'). setSelection moves focus into
  // the board, so focus is handed straight back to the find field (typing
  // keeps searching) and the find overlay marks the current match. Closing
  // the bar leaves the current match selected in the board.
  // ══════════════════════════════════════════════════════════════════════════

  var findBar      = document.getElementById('findBar');
  var findInput    = document.getElementById('findInput');
  var findCount    = document.getElementById('findCount');
  var findPrevBtn  = document.getElementById('findPrevBtn');
  var findNextBtn  = document.getElementById('findNextBtn');
  var findCloseBtn = document.getElementById('findCloseBtn');
  var editorFindBtn = document.getElementById('editorFindBtn');

  var findMatches = [];   // [{ index, length }]
  var findCurrent = -1;

  function isFindOpen() {
    return !!findBar && findBar.style.display !== 'none';
  }

  function computeFindMatches() {
    var needle = findInput ? findInput.value : '';
    var out = [];
    if (!needle) return out;
    var hay = quill.getText().toLowerCase();
    var n   = needle.toLowerCase();
    var i   = hay.indexOf(n);
    while (i !== -1) {
      out.push({ index: i, length: n.length });
      i = hay.indexOf(n, i + n.length);
    }
    return out;
  }

  function updateFindCount() {
    if (!findCount) return;
    if (!findInput || !findInput.value) { findCount.textContent = ''; return; }
    findCount.textContent = findMatches.length
      ? (findCurrent + 1) + ' of ' + findMatches.length
      : 'No matches';
    findCount.classList.toggle('find-count-none', !findMatches.length);
  }

  function goToFindMatch(i) {
    if (!findMatches.length) { findCurrent = -1; setOverlay('find', null); updateFindCount(); return; }
    var n = findMatches.length;
    findCurrent = ((i % n) + n) % n;       // wrap both directions
    var m = findMatches[findCurrent];
    if (!isRewriting) hideRewriteToolbar();   // never abort an in-flight revision
    quill.setSelection(m.index, m.length, 'api');   // selects + scrolls into view; never opens Revise
    setOverlay('find', m.index, m.length);
    var overlay = overlayEls.find;
    if (overlay && overlay.scrollIntoView) overlay.scrollIntoView({ block: 'nearest' });
    if (findInput) findInput.focus({ preventScroll: true });
    updateFindCount();
  }

  // New search text: jump to the first match at/after the current match (or
  // the top), so refining the query doesn't bounce back to the start.
  function runFind() {
    var from = findCurrent >= 0 && findMatches[findCurrent] ? findMatches[findCurrent].index : 0;
    findMatches = computeFindMatches();
    if (!findMatches.length) { findCurrent = -1; setOverlay('find', null); updateFindCount(); return; }
    var start = 0;
    for (var i = 0; i < findMatches.length; i++) {
      if (findMatches[i].index >= from) { start = i; break; }
    }
    goToFindMatch(start);
  }

  // The board changed while the bar is open (typing, AI edit): recount and
  // re-mark without moving the writer's caret.
  function refreshFindAfterEdit() {
    if (!isFindOpen()) return;
    findMatches = computeFindMatches();
    if (findCurrent >= findMatches.length) findCurrent = findMatches.length - 1;
    if (findCurrent < 0 && findMatches.length) findCurrent = 0;
    var m = findMatches[findCurrent];
    setOverlay('find', m ? m.index : null, m ? m.length : 0);
    updateFindCount();
  }

  function openFindBar() {
    if (!findBar || !findInput) return;
    if (!isRewriting) hideRewriteToolbar();   // never abort an in-flight revision
    // Seed with a short single-line selection, like browser find.
    var sel = quill.getSelection();
    if (sel && sel.length > 0 && sel.length <= 80) {
      var t = quill.getText(sel.index, sel.length);
      if (t.indexOf('\n') === -1) findInput.value = t;
    }
    findBar.style.display = 'flex';
    findInput.focus({ preventScroll: true });
    findInput.select();
    findCurrent = -1;
    if (findInput.value) runFind(); else updateFindCount();
  }

  // restoreSelection: leave the current match selected in the board (normal
  // close). Lifecycle closes (loading/leaving/clearing) pass false.
  function closeFindBar(restoreSelection) {
    if (!findBar) return;
    var wasOpen = isFindOpen();
    findBar.style.display = 'none';
    var m = findMatches[findCurrent];
    setOverlay('find', null);
    findMatches = [];
    findCurrent = -1;
    if (wasOpen && restoreSelection && m) quill.setSelection(m.index, m.length, 'api');
  }

  if (editorFindBtn) editorFindBtn.addEventListener('click', function () {
    if (isFindOpen()) { findInput.focus({ preventScroll: true }); findInput.select(); }
    else openFindBar();
  });
  if (findInput) {
    findInput.addEventListener('input', runFind);
    findInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (!findMatches.length) { runFind(); return; }
        goToFindMatch(findCurrent + (e.shiftKey ? -1 : 1));
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeFindBar(true);
      }
    });
  }
  if (findNextBtn)  findNextBtn.addEventListener('click',  function () { goToFindMatch(findCurrent + 1); });
  if (findPrevBtn)  findPrevBtn.addEventListener('click',  function () { goToFindMatch(findCurrent - 1); });
  if (findCloseBtn) findCloseBtn.addEventListener('click', function () { closeFindBar(true); });

  // Ctrl/Cmd+F opens the bar while the workspace is showing (and no overlay
  // or modal is covering it); elsewhere on the page the browser's own find
  // is left alone.
  document.addEventListener('keydown', function (e) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
    if (String(e.key).toLowerCase() !== 'f') return;
    if (writingEditor.style.display === 'none') return;
    if (restyleOverlay && restyleOverlay.style.display !== 'none') return;
    if (document.querySelector('.ironink-modal-overlay')) return;
    e.preventDefault();
    if (isFindOpen()) { findInput.focus({ preventScroll: true }); findInput.select(); }
    else openFindBar();
  });

  // Board edits: word count, match refresh, overlay positions. Only edits the
  // WRITER made (source 'user') schedule the debounced auto-save —
  // programmatic changes (loads are 'silent'; AI edits save explicitly) must
  // not bump a just-opened article's updatedAt.
  quill.on('text-change', function (delta, oldDelta, source) {
    updateWordCount();
    refreshFindAfterEdit();
    drawOverlay('revise');
    if (source === 'user') scheduleEditorSave();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ── Companion panel collapse ──────────────────────────────────────────────
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
  // Display + export only. Zoom changes how the board is SHOWN (the Quill
  // editor's inline fontSize; headings and text sizes are em-based so they
  // scale with it), never its content — saved content is untouched. Print
  // builds the page client-side from the live title + formatted board.
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

  // Display-only zoom: sets the board's shown font size. Never touches content.
  function applyEditorFontSize(size) {
    editorFontSize = Math.min(EFONT_MAX, Math.max(EFONT_MIN, size));
    quill.root.style.fontSize = editorFontSize + 'px';
    saveEditorFont(editorFontSize);
    refreshBoardOverlays();                  // text reflowed — re-mark find / revise passages
    updateRewriteToolbarOnViewportChange();
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

  // Build print HTML: title as <h1>, then the board's formatted HTML (headings,
  // lists, blockquotes, bold/italic/underline, sizes, highlights), run through
  // the same allowlist sanitizer the readers use. The global #printArea
  // @media print rules (Georgia 12pt, styled headings/paragraphs) do the
  // visual work.
  function buildPrintHtml(title, bodyHtml) {
    var html = title ? ('<h1>' + esc(title) + '</h1>') : '';
    var clean = window.IronInkArticleHtml ? window.IronInkArticleHtml.sanitize(bodyHtml) : bodyHtml;
    return html + clean;
  }

  function printArticle() {
    var title = editorTitle.value.trim();
    if (!title && boardIsEmpty()) { showToast('Nothing to print yet.'); return; }
    writingPrintArea.innerHTML = buildPrintHtml(title, boardHtml());
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
    var text  = boardText().trim();
    var words = text ? text.split(/\s+/).length : 0;
    editorWordCount.textContent = words + ' word' + (words !== 1 ? 's' : '');
  }

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

  // Called from the board's text-change listener (writer edits only — see the
  // Find section).
  function scheduleEditorSave() {
    if (editorSaveDebounceTimer) clearTimeout(editorSaveDebounceTimer);
    editorSaveDebounceTimer = setTimeout(function () {
      if (boardIsEmpty()) return;   // nothing in the body to save
      autoSaveDraft();
    }, SAVE_DEBOUNCE_MS);
  }

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
