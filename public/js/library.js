(function () {
  'use strict';

  var allStudies   = [];
  var allDialogues = [];
  var dialoguesLoaded = false;

  // ── Load studies on page load ──────────────────────────────────────────────
  async function loadStudies() {
    try {
      var res  = await fetch('/api/library');
      var data = await res.json();
      if (!data.success) throw new Error(data.error);
      allStudies = data.studies;
      renderCards(allStudies);
    } catch (err) {
      document.getElementById('studyCardsGrid').innerHTML =
        '<p class="library-empty">Failed to load studies. Please refresh.</p>';
    }
  }

  // ── Render cards ───────────────────────────────────────────────────────────
  function renderCards(studies) {
    var grid = document.getElementById('studyCardsGrid');

    if (!studies.length) {
      grid.innerHTML = '<p class="library-empty">No studies saved yet. Head to Study to generate your first guide.</p>';
      return;
    }

    grid.innerHTML = studies.map(function (s) {
      var starsHtml = s.rating
        ? '<div class="study-card-rating">' +
            '&#9733;'.repeat(s.rating) +
            '<span class="empty-star">&#9733;</span>'.repeat(5 - s.rating) +
          '</div>'
        : '';

      var tagsHtml = s.tags && s.tags.length
        ? '<div class="study-card-tags">' +
            s.tags.map(function (t) {
              return '<span class="tag-badge">' + esc(t) + '</span>';
            }).join('') +
          '</div>'
        : '';

      var tagsValue = s.tags ? s.tags.join(', ') : '';
      var editStarsHtml = [1, 2, 3, 4, 5].map(function (n) {
        var cls = n <= (s.rating || 0) ? ' edit-star-active' : '';
        return '<span class="edit-star' + cls + '" data-val="' + n + '">&#9733;</span>';
      }).join('');

      return '<div class="study-card" data-id="' + esc(s.id) + '" tabindex="0" role="button">' +
          '<div class="study-card-header">' +
            '<h4 class="study-card-title">' + esc(s.topic) + '</h4>' +
            '<div class="card-header-btns">' +
              '<button class="card-edit-btn" data-id="' + esc(s.id) + '" title="Edit">&#9998;</button>' +
              '<button class="card-delete-btn" data-id="' + esc(s.id) + '" title="Delete">&#10005;</button>' +
            '</div>' +
          '</div>' +
          '<div class="study-card-meta">' +
            '<span class="study-card-date">' + formatDate(s.savedAt) + '</span>' +
            '<span class="study-card-translation">' + esc(s.translation || 'LSB') + '</span>' +
            studyLevelBadge(s.studyLevel) +
          '</div>' +
          tagsHtml +
          starsHtml +
          '<div class="card-edit-panel" style="display:none;">' +
            '<div class="card-edit-row">' +
              '<label class="card-edit-label">Title</label>' +
              '<input type="text" class="form-input card-edit-title" value="' + esc(s.topic) + '">' +
            '</div>' +
            '<div class="card-edit-row">' +
              '<label class="card-edit-label">Tags <span class="card-edit-hint">(comma-separated)</span></label>' +
              '<input type="text" class="form-input card-edit-tags" value="' + esc(tagsValue) + '" placeholder="e.g. soteriology, TULIP">' +
            '</div>' +
            '<div class="card-edit-row">' +
              '<label class="card-edit-label">Rating</label>' +
              '<div class="edit-star-row">' + editStarsHtml + '</div>' +
            '</div>' +
            '<div class="card-edit-actions">' +
              '<button class="card-edit-save">Save Changes</button>' +
              '<button class="card-edit-cancel">Cancel</button>' +
            '</div>' +
          '</div>' +
        '</div>';
    }).join('');

    // Wire up each card
    grid.querySelectorAll('.study-card').forEach(function (card) {
      var id        = card.dataset.id;
      var editPanel = card.querySelector('.card-edit-panel');
      var study     = allStudies.find(function (s) { return s.id === id; }) || {};
      var editRating = study.rating || 0;

      // Card click → open modal (skip if clicking inside edit area or action buttons)
      card.addEventListener('click', function (e) {
        if (e.target.closest('.card-edit-panel') ||
            e.target.classList.contains('card-edit-btn') ||
            e.target.classList.contains('card-delete-btn')) return;
        if (study) openModal(study);
      });
      card.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && editPanel.style.display === 'none') card.click();
      });

      // Edit button — toggle panel
      card.querySelector('.card-edit-btn').addEventListener('click', function (e) {
        e.stopPropagation();
        editPanel.style.display = editPanel.style.display === 'none' ? 'block' : 'none';
      });

      // Delete button
      card.querySelector('.card-delete-btn').addEventListener('click', function (e) {
        e.stopPropagation();
        showConfirm('Delete this study? This cannot be undone.', 'Delete', async function () {
          await deleteStudy(id);
        });
      });

      // Edit panel star rating
      function highlightEditStars(n) {
        editPanel.querySelectorAll('.edit-star').forEach(function (star) {
          star.classList.toggle('edit-star-active', parseInt(star.dataset.val) <= n);
        });
      }
      editPanel.querySelectorAll('.edit-star').forEach(function (star) {
        star.addEventListener('mouseover', function () { highlightEditStars(parseInt(star.dataset.val)); });
        star.addEventListener('mouseout',  function () { highlightEditStars(editRating); });
        star.addEventListener('click', function (e) {
          e.stopPropagation();
          editRating = parseInt(star.dataset.val);
          highlightEditStars(editRating);
        });
      });

      // Save Changes
      editPanel.querySelector('.card-edit-save').addEventListener('click', async function (e) {
        e.stopPropagation();
        var newTopic = editPanel.querySelector('.card-edit-title').value.trim();
        var newTags  = editPanel.querySelector('.card-edit-tags').value;
        if (!newTopic) { editPanel.querySelector('.card-edit-title').focus(); return; }
        try {
          var res  = await fetch('/api/library/' + encodeURIComponent(id), {
            method:  'PUT',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ topic: newTopic, tags: newTags, rating: editRating }),
          });
          var data = await res.json();
          if (data.success) {
            var idx = allStudies.findIndex(function (s) { return s.id === id; });
            if (idx !== -1) { allStudies[idx] = data.study; study = data.study; }
            applyFilters();
            showToast('Study updated.');
          } else {
            showToast('Error: ' + (data.error || 'Update failed.'), true);
          }
        } catch (err) {
          showToast('Error: ' + err.message, true);
        }
      });

      // Cancel
      editPanel.querySelector('.card-edit-cancel').addEventListener('click', function (e) {
        e.stopPropagation();
        editPanel.style.display = 'none';
      });
    });
  }

  // ── Modal ──────────────────────────────────────────────────────────────────
  function openModal(study) {
    document.getElementById('modalTitle').textContent = study.topic;
    document.getElementById('modalBadge').textContent = study.translation || 'LSB';
    var body = document.getElementById('modalBody');
    body.className = 'guide-modal-body';
    body.innerHTML = renderMarkdown(study.content);
    var modal = document.getElementById('guideModal');
    modal.style.display          = 'flex';
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    document.getElementById('guideModal').style.display = 'none';
    document.body.style.overflow = '';
    if (upEl)  upEl.style.display  = 'none';
    if (icmEl) icmEl.style.display = 'none';
  }

  document.getElementById('closeModal').addEventListener('click', closeModal);
  document.getElementById('guideModal').addEventListener('click', function (e) {
    if (e.target === document.getElementById('guideModal')) closeModal();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (icmEl && icmEl.style.display !== 'none') { icmEl.style.display = 'none'; return; }
      if (upEl  && upEl.style.display  !== 'none') { upEl.style.display  = 'none'; return; }
      closeModal();
    }
  });

  // ── Delete ─────────────────────────────────────────────────────────────────
  async function deleteStudy(id) {
    try {
      var res  = await fetch('/api/library/' + encodeURIComponent(id), { method: 'DELETE' });
      var data = await res.json();
      if (data.success) {
        allStudies = allStudies.filter(function (s) { return s.id !== id; });
        applyFilters();
      } else {
        showAlert('Could not delete study.');
      }
    } catch (err) {
      showAlert('Error: ' + err.message);
    }
  }

  // ── Filters ────────────────────────────────────────────────────────────────
  document.getElementById('filterTag').addEventListener('input', applyFilters);
  document.getElementById('filterRating').addEventListener('change', applyFilters);

  function applyFilters() {
    var tagVal    = document.getElementById('filterTag').value.toLowerCase().trim();
    var ratingVal = parseInt(document.getElementById('filterRating').value) || 0;

    var filtered = allStudies.filter(function (s) {
      var tagOk    = !tagVal    || (s.tags && s.tags.some(function (t) { return t.toLowerCase().includes(tagVal); }));
      var ratingOk = !ratingVal || (s.rating >= ratingVal);
      return tagOk && ratingOk;
    });

    renderCards(filtered);
  }

  // ── Markdown renderer (shared) ─────────────────────────────────────────────
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

  // ── Tab switching ──────────────────────────────────────────────────────────
  document.querySelectorAll('.lib-tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      var target = tab.dataset.tab;

      document.querySelectorAll('.lib-tab').forEach(function (t) {
        t.classList.remove('active');
      });
      tab.classList.add('active');

      document.querySelectorAll('.lib-tab-content').forEach(function (c) {
        c.style.display = 'none';
      });
      var panel = document.getElementById('tab-' + target);
      if (panel) panel.style.display = 'block';

      if (target === 'dialogues' && !dialoguesLoaded) {
        loadDialogues();
      }
    });
  });

  // ── Load dialogues ─────────────────────────────────────────────────────────
  async function loadDialogues() {
    dialoguesLoaded = true;
    try {
      var res  = await fetch('/api/dialogues');
      var data = await res.json();
      if (!data.success) throw new Error(data.error);
      allDialogues = data.dialogues;
      renderDialogueCards(allDialogues);
    } catch (err) {
      document.getElementById('dialogueCardsGrid').innerHTML =
        '<p class="library-empty">Failed to load dialogues. Please refresh.</p>';
    }
  }

  // ── Render dialogue cards ──────────────────────────────────────────────────
  function renderDialogueCards(dialogues) {
    var grid = document.getElementById('dialogueCardsGrid');

    if (!dialogues.length) {
      grid.innerHTML = '<p class="library-empty">No dialogue sessions saved yet. Head to Dialogue to begin your first session.</p>';
      return;
    }

    grid.innerHTML = dialogues.map(function (d) {
      var exchanges = Math.ceil((d.transcript || []).length / 2);
      var exLabel   = exchanges + ' exchange' + (exchanges !== 1 ? 's' : '');
      return '<div class="study-card dialogue-card" data-id="' + esc(d.id) + '" tabindex="0" role="button">' +
        '<div class="study-card-header">' +
          '<h4 class="study-card-title">' + esc(d.topic) + '</h4>' +
          '<button class="card-delete-btn" data-id="' + esc(d.id) + '" title="Delete">&#10005;</button>' +
        '</div>' +
        '<div class="study-card-meta">' +
          '<span class="study-card-date">' + formatDate(d.savedAt) + '</span>' +
        '</div>' +
        '<div class="dialogue-card-meta">' +
          '<span class="position-badge-sm">' + esc(d.adversarialPosition) + '</span>' +
          '<span class="exchange-count">' + exLabel + '</span>' +
        '</div>' +
      '</div>';
    }).join('');

    grid.querySelectorAll('.dialogue-card').forEach(function (card) {
      card.addEventListener('click', function (e) {
        if (e.target.classList.contains('card-delete-btn')) return;
        var d = allDialogues.find(function (x) { return x.id === card.dataset.id; });
        if (d) openTranscriptModal(d);
      });
      card.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') card.click();
      });
    });

    grid.querySelectorAll('.card-delete-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        showConfirm('Delete this dialogue session? This cannot be undone.', 'Delete', async function () {
          await deleteDialogue(btn.dataset.id);
        });
      });
    });
  }

  // ── Open transcript modal ──────────────────────────────────────────────────
  function openTranscriptModal(dialogue) {
    document.getElementById('modalTitle').textContent = dialogue.topic;
    document.getElementById('modalBadge').textContent = dialogue.adversarialPosition;

    var transcriptHtml = (dialogue.transcript || []).map(function (msg) {
      var isEngine   = msg.role === 'assistant';
      var roleLabel  = isEngine ? 'Adversary' : 'You';
      var cssClass   = isEngine ? 'transcript-engine' : 'transcript-student';
      return '<div class="transcript-msg ' + cssClass + '">' +
        '<div class="transcript-role">' + roleLabel + '</div>' +
        '<div class="transcript-content">' + renderTranscriptText(msg.content) + '</div>' +
      '</div>';
    }).join('');

    var body = document.getElementById('modalBody');
    body.className = 'guide-modal-body transcript-view';
    body.innerHTML = transcriptHtml || '<p class="library-empty">No messages in this session.</p>';

    var modal = document.getElementById('guideModal');
    modal.style.display          = 'flex';
    document.body.style.overflow = 'hidden';
  }

  function renderTranscriptText(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g,     '<em>$1</em>')
      .replace(/\n\n/g, '<br><br>')
      .replace(/\n/g,   '<br>');
  }

  // ── Delete dialogue ────────────────────────────────────────────────────────
  async function deleteDialogue(id) {
    try {
      var res  = await fetch('/api/dialogues/' + encodeURIComponent(id), { method: 'DELETE' });
      var data = await res.json();
      if (data.success) {
        allDialogues = allDialogues.filter(function (d) { return d.id !== id; });
        renderDialogueCards(allDialogues);
      } else {
        showAlert('Could not delete dialogue.');
      }
    } catch (err) {
      showAlert('Error: ' + err.message);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function studyLevelBadge(level) {
    var l = level || 'journeyman';
    var labels = { foundations: 'FOUNDATIONS', journeyman: 'JOURNEYMAN', scholar: 'SCHOLAR' };
    var label  = labels[l] || 'JOURNEYMAN';
    return '<span class="study-level-badge study-level-badge-' + l + '">' + label + '</span>';
  }

  function formatDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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

  // ── Reading font size ─────────────────────────────────────────────────────
  var RFONT_DEFAULT = 16, RFONT_MIN = 12, RFONT_MAX = 28, RFONT_STEP = 2;
  var rfontSize   = parseInt(localStorage.getItem('ironink_study_font_size'), 10) || RFONT_DEFAULT;
  var modalBodyEl = document.getElementById('modalBody');

  function applyModalFontSize(size) {
    rfontSize = Math.min(RFONT_MAX, Math.max(RFONT_MIN, size));
    if (modalBodyEl) modalBodyEl.style.fontSize = rfontSize + 'px';
    localStorage.setItem('ironink_study_font_size', rfontSize);
  }

  applyModalFontSize(rfontSize);

  var mFontDec   = document.getElementById('modalFontDec');
  var mFontReset = document.getElementById('modalFontReset');
  var mFontInc   = document.getElementById('modalFontInc');
  if (mFontDec) {
    mFontDec.addEventListener('click',   function () { applyModalFontSize(rfontSize - RFONT_STEP); });
    mFontReset.addEventListener('click', function () { applyModalFontSize(RFONT_DEFAULT); });
    mFontInc.addEventListener('click',   function () { applyModalFontSize(rfontSize + RFONT_STEP); });
  }

  // ── Print / Download ──────────────────────────────────────────────────────
  var printArea = document.createElement('div');
  printArea.id = 'printArea';
  printArea.setAttribute('aria-hidden', 'true');
  document.body.appendChild(printArea);

  var mPrintBtn = document.getElementById('modalPrint');
  if (mPrintBtn) {
    mPrintBtn.addEventListener('click', function () {
      var body = document.getElementById('modalBody');
      if (!body) return;
      printArea.innerHTML = body.innerHTML;
      document.body.classList.add('is-printing');
      window.print();
    });
  }

  window.addEventListener('afterprint', function () {
    document.body.classList.remove('is-printing');
    printArea.innerHTML = '';
  });

  // ── Unified highlight popup & inline chat ─────────────────────────────────
  // upEl / icmEl declared here so closeModal (defined earlier) can reference them
  // safely — JS var hoisting means they exist as undefined until assigned below.

  var upEl  = null;
  var icmEl = null;

  var upSelectedText = '';
  var icmHistory     = [];
  var icmContextText = '';
  var icmTopic       = '';

  // ── Build unified popup ────────────────────────────────────────────────────
  upEl = document.createElement('div');
  upEl.id = 'unifiedPopup';
  upEl.className = 'unified-popup';
  upEl.style.display = 'none';
  upEl.innerHTML =
    '<div class="up-header">' +
      '<div class="up-preview"></div>' +
      '<button class="up-close" title="Dismiss">×</button>' +
    '</div>' +
    '<div class="up-actions">' +
      '<button class="up-define-btn">Define</button>' +
      '<button class="up-ai-btn">Ask AI</button>' +
    '</div>' +
    '<div class="up-content" style="display:none;">' +
      '<div class="up-define-pane" style="display:none;">' +
        '<div class="up-definition"></div>' +
      '</div>' +
      '<div class="up-ai-pane" style="display:none;">' +
        '<div class="up-ai-input-row">' +
          '<input type="text" class="up-ai-input" placeholder="Ask a question about this…">' +
          '<button class="up-ai-ask-btn">Ask</button>' +
        '</div>' +
        '<div class="up-ai-response" style="display:none;"></div>' +
        '<div class="up-ai-footer">' +
          '<button class="up-chat-btn">Open Full Chat →</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(upEl);

  // ── Build chat modal element ───────────────────────────────────────────────
  icmEl = document.createElement('div');
  icmEl.id = 'inlineChatModal';
  icmEl.className = 'inline-chat-modal';
  icmEl.style.display = 'none';
  icmEl.innerHTML =
    '<div class="icm-inner">' +
      '<div class="icm-header">' +
        '<span class="icm-title">Study Chat</span>' +
        '<button class="icm-close" title="Close">×</button>' +
      '</div>' +
      '<div class="icm-context-box">' +
        '<div class="icm-context-label">Selected Passage</div>' +
        '<div class="icm-context-text"></div>' +
      '</div>' +
      '<div class="icm-thread"></div>' +
      '<div class="icm-input-row">' +
        '<textarea class="icm-input" placeholder="Ask a question…" rows="2"></textarea>' +
        '<button class="icm-send-btn">Send</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(icmEl);

  // ── Show unified popup ─────────────────────────────────────────────────────
  function showUp(text, rect) {
    upEl.querySelector('.up-preview').textContent =
      text.length > 110 ? text.slice(0, 110) + '…' : text;

    // Reset to button-only state
    upEl.querySelector('.up-content').style.display     = 'none';
    upEl.querySelector('.up-define-pane').style.display = 'none';
    upEl.querySelector('.up-ai-pane').style.display     = 'none';
    upEl.querySelector('.up-ai-input').value            = '';
    upEl.querySelector('.up-ai-response').style.display = 'none';
    upEl.querySelector('.up-ai-response').textContent   = '';
    upEl.querySelector('.up-definition').textContent    = '';
    upEl.querySelector('.up-define-btn').classList.remove('up-btn-active');
    upEl.querySelector('.up-ai-btn').classList.remove('up-btn-active');

    // Measure collapsed height before committing to a position
    upEl.style.visibility = 'hidden';
    upEl.style.display    = 'block';
    var ph = upEl.offsetHeight;

    var vw   = window.innerWidth;
    var vh   = window.innerHeight;
    var pw   = 388;
    var cx   = rect.left + rect.width / 2;
    var left = Math.min(Math.max(8, cx - pw / 2), vw - pw - 8);

    // Prefer below selection; flip above if it would clip the bottom
    var top = rect.bottom + 8;
    if (top + ph > vh - 8) top = rect.top - ph - 8;
    // Hard clamp: keep fully within viewport vertically
    top = Math.min(Math.max(8, top), vh - ph - 8);

    upEl.style.left       = left + 'px';
    upEl.style.top        = top  + 'px';
    upEl.style.visibility = '';
  }

  // Nudge popup upward if expansion pushed it below the viewport
  function clampUp() {
    if (!upEl || upEl.style.display === 'none') return;
    var ph  = upEl.offsetHeight;
    var top = parseInt(upEl.style.top, 10) || 0;
    var max = window.innerHeight - ph - 8;
    if (top > max) upEl.style.top = Math.max(8, max) + 'px';
  }

  // ── Selection detection ────────────────────────────────────────────────────
  document.addEventListener('mouseup', function (e) {
    if (e.target.closest && (
          e.target.closest('#unifiedPopup') ||
          e.target.closest('#inlineChatModal'))) return;

    var modal = document.getElementById('guideModal');
    if (!modal || modal.style.display === 'none') return;

    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;

    var selText = sel.toString().trim();
    if (!selText || selText.length < 4) return;

    var modalBody = document.getElementById('modalBody');
    if (!modalBody) return;
    var range = sel.getRangeAt(0);
    if (!modalBody.contains(range.commonAncestorContainer)) return;

    upSelectedText = selText;
    var titleEl = document.getElementById('modalTitle');
    icmTopic = titleEl ? titleEl.textContent : '';
    showUp(selText, range.getBoundingClientRect());
    // Suppress any legacy dictionary tooltip that may fire after its 400 ms debounce
    setTimeout(function () {
      var dictTt = document.getElementById('dictTooltip');
      if (dictTt && upEl && upEl.style.display !== 'none') dictTt.style.display = 'none';
    }, 450);
  });

  // Dismiss popup on click outside
  document.addEventListener('mousedown', function (e) {
    if (upEl && upEl.style.display !== 'none' &&
        !e.target.closest('#unifiedPopup')) {
      upEl.style.display = 'none';
    }
  });
  // Prevent scrollbar/scroll clicks inside popup from bubbling to the dismiss handler
  upEl.addEventListener('mousedown', function (e) { e.stopPropagation(); });

  // ── Draggable header ────────────────────────────────────────────────────────
  var _dragOff = null;
  upEl.querySelector('.up-header').addEventListener('mousedown', function (e) {
    if (e.target.closest('.up-close')) return;
    var r = upEl.getBoundingClientRect();
    _dragOff = { x: e.clientX - r.left, y: e.clientY - r.top };
    document.body.style.userSelect = 'none';
  });
  document.addEventListener('mousemove', function (e) {
    if (!_dragOff) return;
    var vw = window.innerWidth, vh = window.innerHeight;
    var pw = upEl.offsetWidth,  ph = upEl.offsetHeight;
    upEl.style.left = Math.min(Math.max(0, e.clientX - _dragOff.x), vw - pw) + 'px';
    upEl.style.top  = Math.min(Math.max(0, e.clientY - _dragOff.y), vh - ph) + 'px';
  });
  document.addEventListener('mouseup', function () {
    if (!_dragOff) return;
    _dragOff = null;
    document.body.style.userSelect = '';
  });

  // ── Popup interactions ─────────────────────────────────────────────────────
  upEl.querySelector('.up-close').addEventListener('click', function () {
    upEl.style.display = 'none';
  });

  upEl.querySelector('.up-define-btn').addEventListener('click', function () {
    upEl.querySelector('.up-content').style.display     = 'block';
    upEl.querySelector('.up-define-pane').style.display = 'block';
    upEl.querySelector('.up-ai-pane').style.display     = 'none';
    upEl.querySelector('.up-define-btn').classList.add('up-btn-active');
    upEl.querySelector('.up-ai-btn').classList.remove('up-btn-active');

    var defEl = upEl.querySelector('.up-definition');
    defEl.innerHTML = '<span class="up-loading">Looking up definition…</span>';
    clampUp();

    fetch('/api/dictionary/define', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ term: upSelectedText }),
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data.error) {
        defEl.innerHTML = '<span style="color:#e08080;font-style:italic;">' + esc(data.error) + '</span>';
      } else {
        defEl.innerHTML = esc(data.definition)
          .replace(/^#{2,} (.+)$/gm, '<strong>$1</strong>')
          .replace(/^# (.+)$/gm,     '<strong style="display:block;margin-bottom:3px;color:var(--accent)">$1</strong>')
          .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
          .replace(/\*(.+?)\*/g,     '<em>$1</em>')
          .replace(/\n/g,            '<br>');
      }
      clampUp();
    })
    .catch(function () {
      defEl.innerHTML = '<span style="color:#e08080;font-style:italic;">Definition unavailable.</span>';
      clampUp();
    });
  });

  upEl.querySelector('.up-ai-btn').addEventListener('click', function () {
    upEl.querySelector('.up-content').style.display     = 'block';
    upEl.querySelector('.up-define-pane').style.display = 'none';
    upEl.querySelector('.up-ai-pane').style.display     = 'block';
    upEl.querySelector('.up-ai-btn').classList.add('up-btn-active');
    upEl.querySelector('.up-define-btn').classList.remove('up-btn-active');
    clampUp();
    setTimeout(function () { upEl.querySelector('.up-ai-input').focus(); }, 40);
  });

  upEl.querySelector('.up-ai-ask-btn').addEventListener('click', function () {
    var q = upEl.querySelector('.up-ai-input').value.trim();
    if (!q) { upEl.querySelector('.up-ai-input').focus(); return; }
    doInlineAsk(q);
  });

  upEl.querySelector('.up-ai-input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      var q = upEl.querySelector('.up-ai-input').value.trim();
      if (q) doInlineAsk(q);
    }
  });

  async function doInlineAsk(question) {
    var askBtn = upEl.querySelector('.up-ai-ask-btn');
    var resp   = upEl.querySelector('.up-ai-response');
    askBtn.disabled    = true;
    resp.style.display = 'block';
    resp.textContent   = 'Thinking…';

    try {
      var res  = await fetch('/api/library/ask', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          question:        question,
          highlightedText: upSelectedText,
          studyTopic:      icmTopic,
        }),
      });
      var data = await res.json();
      resp.textContent = data.success ? data.answer : ('Error: ' + (data.error || 'Failed.'));
      clampUp();
    } catch (err) {
      resp.textContent = 'Error: ' + err.message;
      clampUp();
    } finally {
      askBtn.disabled = false;
    }
  }

  upEl.querySelector('.up-chat-btn').addEventListener('click', function () {
    upEl.style.display = 'none';
    openIcm(upSelectedText, icmTopic);
  });

  // ── Chat modal ─────────────────────────────────────────────────────────────
  function openIcm(selectedText, topic) {
    icmContextText = selectedText;
    icmTopic       = topic;
    icmHistory     = [];

    icmEl.querySelector('.icm-context-text').textContent = selectedText;
    icmEl.querySelector('.icm-thread').innerHTML         = '';
    icmEl.querySelector('.icm-input').value              = '';

    icmEl.style.display = 'flex';
    setTimeout(function () { icmEl.querySelector('.icm-input').focus(); }, 40);
  }

  icmEl.querySelector('.icm-close').addEventListener('click', function () {
    icmEl.style.display = 'none';
  });
  icmEl.addEventListener('click', function (e) {
    if (e.target === icmEl) icmEl.style.display = 'none';
  });

  icmEl.querySelector('.icm-send-btn').addEventListener('click', doSendChat);
  icmEl.querySelector('.icm-input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSendChat(); }
  });

  function icmAppendMsg(role, text) {
    var thread = icmEl.querySelector('.icm-thread');
    var msg    = document.createElement('div');
    msg.className = 'icm-msg icm-msg-' + role;
    var label    = role === 'user' ? 'You' : 'Iron & Ink';
    var bodyHtml = esc(text)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');
    msg.innerHTML =
      '<div class="icm-msg-label">' + label + '</div>' +
      '<div class="icm-msg-body">' + bodyHtml + '</div>';
    thread.appendChild(msg);
    thread.scrollTop = thread.scrollHeight;
  }

  async function doSendChat() {
    var input = icmEl.querySelector('.icm-input');
    var q     = input.value.trim();
    if (!q) return;

    var sendBtn = icmEl.querySelector('.icm-send-btn');
    sendBtn.disabled = true;
    input.value = '';

    var msgContent;
    if (icmHistory.length === 0 && icmContextText) {
      msgContent = 'I am reading a study on "' + icmTopic + '" and have selected this passage:\n\n"' +
        icmContextText + '"\n\n' + q;
    } else {
      msgContent = q;
    }

    icmAppendMsg('user', q);
    icmHistory.push({ role: 'user', content: msgContent });

    var loadEl = document.createElement('div');
    loadEl.className  = 'icm-loading';
    loadEl.textContent = 'Thinking…';
    var thread = icmEl.querySelector('.icm-thread');
    thread.appendChild(loadEl);
    thread.scrollTop = thread.scrollHeight;

    try {
      var res  = await fetch('/api/library/ask', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ history: icmHistory }),
      });
      var data = await res.json();
      loadEl.remove();
      if (data.success) {
        icmHistory.push({ role: 'assistant', content: data.answer });
        icmAppendMsg('assistant', data.answer);
      } else {
        icmAppendMsg('assistant', 'Error: ' + (data.error || 'Failed to get answer.'));
      }
    } catch (err) {
      loadEl.remove();
      icmAppendMsg('assistant', 'Error: ' + err.message);
    } finally {
      sendBtn.disabled = false;
      input.focus();
    }
  }

  loadStudies();
})();
