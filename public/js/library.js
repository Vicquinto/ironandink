(function () {
  'use strict';

  var allStudies   = [];
  var allDialogues = [];
  var dialoguesLoaded = false;
  var notesLoaded     = false;

  // ── Load studies on page load ──────────────────────────────────────────────
  async function loadStudies() {
    if (!document.getElementById('studyCardsGrid')) return;
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
      grid.innerHTML = '<p class="library-empty">No studies saved yet. Head to Study to generate your first study.</p>';
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

      var sharedBadge = s.shared === true
        ? '<span class="study-card-shared" title="Shared to Community">&#128101; Shared</span>'
        : '';

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
            studyTypeBadge(s.studyType) +
            studyLevelBadge(s.studyLevel) +
            sharedBadge +
          '</div>' +
          tagsHtml +
          starsHtml +
        '</div>';
    }).join('');

    // Wire up each card. The edit UI is now a single floating popup (built once,
    // see buildEditPopup) rather than an inline per-card panel — so an open editor
    // no longer stretches its rowmates in the grid.
    grid.querySelectorAll('.study-card').forEach(function (card) {
      var id    = card.dataset.id;
      var study = allStudies.find(function (s) { return s.id === id; }) || {};

      // Card click → render study inline (skip if clicking the action buttons)
      card.addEventListener('click', function (e) {
        if (e.target.classList.contains('card-edit-btn') ||
            e.target.classList.contains('card-delete-btn')) return;
        if (study) showStudyInline(study);
      });
      card.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') card.click();
      });

      // Edit button — open the floating popup anchored to this card
      card.querySelector('.card-edit-btn').addEventListener('click', function (e) {
        e.stopPropagation();
        openEditPopup(study, card);
      });

      // Delete button
      card.querySelector('.card-delete-btn').addEventListener('click', function (e) {
        e.stopPropagation();
        showConfirm('Delete this study? This cannot be undone.', 'Delete', async function () {
          await deleteStudy(id);
        });
      });
    });
  }

  // ── Floating edit popup (single instance, reused for every card) ────────────
  // Replaces the old inline .card-edit-panel. Fixed-positioned overlay so opening
  // the editor never changes card heights / stretches neighbors in the grid.
  var editPopup        = null;
  var editPopupStudyId = null;
  var editPopupRating  = 0;

  function buildEditPopup() {
    var el = document.createElement('div');
    el.id        = 'cardEditPopup';
    el.className = 'card-edit-popup';
    el.style.display = 'none';
    var starsHtml = [1, 2, 3, 4, 5].map(function (n) {
      return '<span class="edit-star" data-val="' + n + '">&#9733;</span>';
    }).join('');
    el.innerHTML =
      '<div class="card-edit-popup-inner">' +
        '<div class="card-edit-popup-header">' +
          '<span class="card-edit-popup-title">Edit Study</span>' +
          '<button class="card-edit-popup-close" title="Close">&times;</button>' +
        '</div>' +
        '<div class="card-edit-row">' +
          '<label class="card-edit-label">Title</label>' +
          '<input type="text" class="form-input card-edit-title">' +
        '</div>' +
        '<div class="card-edit-row">' +
          '<label class="card-edit-label">Tags <span class="card-edit-hint">(comma-separated)</span></label>' +
          '<input type="text" class="form-input card-edit-tags" placeholder="e.g. soteriology, TULIP">' +
        '</div>' +
        '<div class="card-edit-row">' +
          '<label class="card-edit-label">Rating</label>' +
          '<div class="edit-star-row">' + starsHtml + '</div>' +
        '</div>' +
        '<div class="card-edit-row">' +
          '<label class="share-toggle-row">' +
            '<input type="checkbox" class="card-edit-share">' +
            '<span class="share-toggle-label">Share to Community</span>' +
          '</label>' +
        '</div>' +
        '<div class="card-edit-actions">' +
          '<button class="card-edit-save">Save Changes</button>' +
          '<button class="card-edit-cancel">Cancel</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(el);

    function highlightStars(n) {
      el.querySelectorAll('.edit-star').forEach(function (star) {
        star.classList.toggle('edit-star-active', parseInt(star.dataset.val) <= n);
      });
    }
    el.querySelectorAll('.edit-star').forEach(function (star) {
      star.addEventListener('mouseover', function () { highlightStars(parseInt(star.dataset.val)); });
      star.addEventListener('mouseout',  function () { highlightStars(editPopupRating); });
      star.addEventListener('click', function () {
        editPopupRating = parseInt(star.dataset.val);
        highlightStars(editPopupRating);
      });
    });

    el.querySelector('.card-edit-cancel').addEventListener('click', closeEditPopup);
    el.querySelector('.card-edit-popup-close').addEventListener('click', closeEditPopup);
    // Keep clicks inside the popup from bubbling to the outside-dismiss handler
    el.addEventListener('mousedown', function (e) { e.stopPropagation(); });

    el.querySelector('.card-edit-save').addEventListener('click', async function () {
      var id = editPopupStudyId;
      if (!id) return;
      var newTopic  = el.querySelector('.card-edit-title').value.trim();
      var newTags   = el.querySelector('.card-edit-tags').value;
      var newShared = el.querySelector('.card-edit-share').checked;
      if (!newTopic) { el.querySelector('.card-edit-title').focus(); return; }
      try {
        var res  = await fetch('/api/library/' + encodeURIComponent(id), {
          method:  'PUT',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ topic: newTopic, tags: newTags, rating: editPopupRating, shared: newShared }),
        });
        var data = await res.json();
        if (data.success) {
          var idx = allStudies.findIndex(function (s) { return s.id === id; });
          if (idx !== -1) allStudies[idx] = data.study;
          closeEditPopup();
          applyFilters();
          showToast(newShared ? 'Study updated and shared to Community.' : 'Study updated.');
        } else {
          showToast('Error: ' + (data.error || 'Update failed.'), true);
        }
      } catch (err) {
        showToast('Error: ' + err.message, true);
      }
    });

    return el;
  }

  function openEditPopup(study, anchorEl) {
    if (!editPopup) editPopup = buildEditPopup();
    editPopupStudyId = study.id;
    editPopupRating  = study.rating || 0;
    editPopup.querySelector('.card-edit-title').value   = study.topic || '';
    editPopup.querySelector('.card-edit-tags').value    = (study.tags || []).join(', ');
    editPopup.querySelector('.card-edit-share').checked = study.shared === true;
    editPopup.querySelectorAll('.edit-star').forEach(function (star) {
      star.classList.toggle('edit-star-active', parseInt(star.dataset.val) <= editPopupRating);
    });

    // Position: fixed overlay near the card, clamped to the viewport.
    editPopup.style.visibility = 'hidden';
    editPopup.style.display    = 'block';
    var pw   = editPopup.offsetWidth;
    var ph   = editPopup.offsetHeight;
    var rect = anchorEl.getBoundingClientRect();
    var vw   = window.innerWidth, vh = window.innerHeight;
    var left = Math.min(Math.max(8, rect.left), vw - pw - 8);
    var top  = rect.top;
    if (top + ph > vh - 8) top = Math.max(8, vh - ph - 8);
    editPopup.style.left       = left + 'px';
    editPopup.style.top        = top + 'px';
    editPopup.style.visibility = '';
    setTimeout(function () { editPopup.querySelector('.card-edit-title').focus(); }, 40);
  }

  function closeEditPopup() {
    if (editPopup) editPopup.style.display = 'none';
    editPopupStudyId = null;
  }

  // Dismiss the edit popup on outside click or Esc
  document.addEventListener('mousedown', function (e) {
    if (editPopup && editPopup.style.display !== 'none' &&
        !e.target.closest('#cardEditPopup') &&
        !e.target.classList.contains('card-edit-btn')) {
      closeEditPopup();
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && editPopup && editPopup.style.display !== 'none') {
      closeEditPopup();
    }
  });

  // ── Inline study view (replaces card grid, matches Study page) ──────────────
  var libGuideArea  = document.getElementById('libGuideArea');
  var libGuideTitle = document.getElementById('libGuideTitle');
  var libGuideBadge = document.getElementById('libGuideBadge');
  var libGuideBody  = document.getElementById('libGuideBody');
  var studyCardsGrid = document.getElementById('studyCardsGrid');
  var libFilterBar   = document.querySelector('#tab-studies .library-filter-bar');

  function showStudyInline(study) {
    if (!libGuideArea) return;
    libGuideTitle.textContent = study.topic;
    libGuideBadge.textContent = study.translation || 'LSB';
    libGuideBody.innerHTML    = renderMarkdown(study.content);
    if (studyCardsGrid) studyCardsGrid.style.display = 'none';
    if (libFilterBar)   libFilterBar.style.display   = 'none';
    libGuideArea.style.display = 'block';
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Notepad: bind this study so the panel + tooltip target the right notepad,
    // inject display-only markers onto anchored text (never mutates study.content),
    // and expose a re-render hook the notepad calls after add/delete.
    window.__notepadStudy = { id: study.id, title: study.topic };
    window.__notepadRerenderMarkers = function () {
      if (window.__notepad) window.__notepad.injectMarkers(libGuideBody, study.id);
    };
    if (window.__notepad) {
      window.__notepad.setStudy(study.id, study.topic);
      window.__notepad.injectMarkers(libGuideBody, study.id);
    }
  }

  function backToLibrary() {
    if (libGuideArea) libGuideArea.style.display = 'none';
    if (studyCardsGrid) studyCardsGrid.style.display = '';
    if (libFilterBar)   libFilterBar.style.display   = '';

    window.__notepadStudy = null;
    window.__notepadRerenderMarkers = null;
    if (window.__notepad) window.__notepad.clearStudy();
  }

  var libBackBtn = document.getElementById('libBackBtn');
  if (libBackBtn) libBackBtn.addEventListener('click', backToLibrary);

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
    // Route through closeIcm so a notepad hidden for the chat is restored.
    if (icmEl && icmEl.style.display !== 'none') closeIcm();
  }

  var closeModalBtn = document.getElementById('closeModal');
  var guideModalEl  = document.getElementById('guideModal');
  if (closeModalBtn) closeModalBtn.addEventListener('click', closeModal);
  if (guideModalEl)  guideModalEl.addEventListener('click', function (e) {
    if (e.target === guideModalEl) closeModal();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (icmEl && icmEl.style.display !== 'none') { closeIcm(); return; }
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
  var filterTagEl    = document.getElementById('filterTag');
  var filterRatingEl = document.getElementById('filterRating');
  if (filterTagEl)    filterTagEl.addEventListener('input', applyFilters);
  if (filterRatingEl) filterRatingEl.addEventListener('change', applyFilters);

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
      var bqM = line.match(/^> (.+)/);

      if (bqM) {
        if (inUl) { result.push('</ul>'); inUl = false; }
        if (inOl) { result.push('</ol>'); inOl = false; }
        result.push('<blockquote class="guide-bq">' + bqM[1] + '</blockquote>');
      } else if (ulM) {
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
      if (target === 'notes') {
        loadAllNotes();   // always refresh — notes change often
      }
    });
  });

  // ── Global notes view (all notes across studies, grouped by study) ──────────
  // Short plain-text preview for a collapsed note row: the quote if anchored,
  // otherwise the opening of the note body with markdown syntax stripped.
  function notePreview(n) {
    if (n.quote) return '“' + n.quote + '”';
    var t = String(n.content || '')
      .replace(/[#*_>`~]/g, ' ')
      .replace(/^\s*[-\d.]+\s+/gm, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!t) return 'Empty note';
    return t.length > 90 ? t.slice(0, 90) + '…' : t;
  }

  function loadAllNotes() {
    notesLoaded = true;
    var grid = document.getElementById('notesAllGrid');
    if (!grid) return;
    grid.innerHTML = '<p class="library-loading-msg">Loading&#8230;</p>';

    fetch('/api/notepad/all')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.success) throw new Error(data.error || 'Failed.');
        var groups = data.groups || [];
        if (!groups.length) {
          grid.innerHTML = '<p class="library-empty">No notes yet. Open a study and press Ctrl+Alt+N, or highlight text to save a note.</p>';
          return;
        }

        grid.innerHTML = groups.map(function (g) {
          // Each note is collapsed by default: a clickable summary (marker + a
          // short preview) that expands to the full rendered note on click.
          var notesHtml = g.notes.map(function (n) {
            var marker = (n.marker != null)
              ? '<span class="notes-allnote-marker">' + esc(String(n.marker)) + '</span>'
              : '';
            var preview = notePreview(n);
            var quoteBlock = n.quote
              ? '<div class="notes-allnote-quote">&ldquo;' + esc(n.quote) + '&rdquo;</div>'
              : '';
            return '<div class="notes-allnote notes-allnote--collapsed">' +
                '<div class="notes-allnote-summary" role="button" tabindex="0">' +
                  '<span class="notes-allnote-caret">&#9656;</span>' +
                  marker +
                  '<span class="notes-allnote-preview">' + esc(preview) + '</span>' +
                  '<button class="notes-allnote-del" data-study-id="' + esc(g.studyId) +
                    '" data-note-id="' + esc(n.id) + '" title="Delete note" aria-label="Delete note">&times;</button>' +
                '</div>' +
                '<div class="notes-allnote-full" style="display:none;">' +
                  quoteBlock +
                  '<div class="notes-allnote-body">' + renderMarkdown(n.content || '') + '</div>' +
                '</div>' +
              '</div>';
          }).join('');

          var openBtn = g.studyExists
            ? '<button class="notes-group-open" data-id="' + esc(g.studyId) + '">Open study &rarr;</button>'
            : '<button class="notes-group-open" disabled title="Study no longer exists">Study deleted</button>';

          return '<div class="notes-group">' +
              '<div class="notes-group-head">' +
                '<span class="notes-group-title">' + esc(g.studyTitle) + '</span>' +
                openBtn +
              '</div>' +
              notesHtml +
            '</div>';
        }).join('');

        // Expand / collapse a note on summary click (or Enter/Space).
        grid.querySelectorAll('.notes-allnote-summary').forEach(function (summary) {
          function toggle() {
            var note  = summary.closest('.notes-allnote');
            var full  = note.querySelector('.notes-allnote-full');
            var caret = summary.querySelector('.notes-allnote-caret');
            var collapsed = note.classList.toggle('notes-allnote--collapsed');
            full.style.display = collapsed ? 'none' : 'block';
            if (caret) caret.innerHTML = collapsed ? '&#9656;' : '&#9662;';
          }
          summary.addEventListener('click', toggle);
          summary.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
          });
        });

        // Delete a note directly from the Notes view (styled confirm, like the
        // notepad panel's × ). stopPropagation so the click doesn't also expand.
        grid.querySelectorAll('.notes-allnote-del').forEach(function (delBtn) {
          delBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            var studyId = delBtn.dataset.studyId;
            var noteId  = delBtn.dataset.noteId;
            showConfirm('Delete this note? This cannot be undone.', 'Delete', function () {
              fetch('/api/notepad/' + encodeURIComponent(studyId) + '/note/' + encodeURIComponent(noteId), {
                method: 'DELETE',
              })
                .then(function (r) { return r.json(); })
                .then(function (data) {
                  if (!data.success) { showAlert('Could not delete note.'); return; }
                  loadAllNotes(); // re-render the grouped view
                  // Keep an open notepad + its reader markers in sync.
                  if (window.__notepadStudy && window.__notepadStudy.id === studyId) {
                    if (window.__notepad) window.__notepad.refresh();
                    if (typeof window.__notepadRerenderMarkers === 'function') window.__notepadRerenderMarkers();
                  }
                })
                .catch(function () { showAlert('Could not delete note.'); });
            });
          });
        });

        grid.querySelectorAll('.notes-group-open:not([disabled])').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var id    = btn.dataset.id;
            var study = allStudies.find(function (s) { return s.id === id; });
            // Switch to the Studies tab and open the study inline (markers render there).
            var studiesTab = document.querySelector('.lib-tab[data-tab="studies"]');
            if (studiesTab) studiesTab.click();
            if (study) {
              showStudyInline(study);
            } else {
              // allStudies not yet loaded on this session — fetch, then open.
              loadStudies().then(function () {
                var s = allStudies.find(function (x) { return x.id === id; });
                if (s) showStudyInline(s);
              });
            }
          });
        });
      })
      .catch(function () {
        grid.innerHTML = '<p class="library-empty">Could not load notes. Please refresh.</p>';
      });
  }

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
    var labels = { foundations: 'APPRENTICE', journeyman: 'JOURNEYMAN', scholar: 'SCHOLAR' };
    var label  = labels[l] || 'JOURNEYMAN';
    return '<span class="study-level-badge study-level-badge-' + l + '">' + label + '</span>';
  }

  function studyTypeBadge(type) {
    var t = type || 'doctrinal';
    if (t === 'deepdive') t = 'explore'; // legacy records saved under the old Deep Dive key
    var labels = { doctrinal: 'DOCTRINAL', explore: 'EXPLORE', historical: 'HISTORICAL', scripture: 'SCRIPTURE', open: 'OPEN' };
    var label  = labels[t] || 'DOCTRINAL';
    return '<span class="study-type-badge study-type-badge-' + t + '">' + label + '</span>';
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

  // Inline study view shares the same reading font size
  function applyLibFontSize(size) {
    rfontSize = Math.min(RFONT_MAX, Math.max(RFONT_MIN, size));
    if (libGuideBody) libGuideBody.style.fontSize = rfontSize + 'px';
    localStorage.setItem('ironink_study_font_size', rfontSize);
  }
  if (libGuideBody) libGuideBody.style.fontSize = rfontSize + 'px';

  var libFontDec   = document.getElementById('libFontDecBtn');
  var libFontReset = document.getElementById('libFontResetBtn');
  var libFontInc   = document.getElementById('libFontIncBtn');
  if (libFontDec) {
    libFontDec.addEventListener('click',   function () { applyLibFontSize(rfontSize - RFONT_STEP); });
    libFontReset.addEventListener('click', function () { applyLibFontSize(RFONT_DEFAULT); });
    libFontInc.addEventListener('click',   function () { applyLibFontSize(rfontSize + RFONT_STEP); });
  }

  // ── Print / Download ──────────────────────────────────────────────────────
  var printArea = document.createElement('div');
  printArea.id = 'printArea';
  printArea.setAttribute('aria-hidden', 'true');
  document.body.appendChild(printArea);

  // Shared print/Save-as-PDF flow — fills the print area from a source element
  function printGuide(sourceEl) {
    if (!sourceEl) return;
    printArea.innerHTML = sourceEl.innerHTML;
    document.body.classList.add('is-printing');
    window.print();
  }

  var mPrintBtn = document.getElementById('modalPrint');
  if (mPrintBtn) {
    mPrintBtn.addEventListener('click', function () {
      printGuide(document.getElementById('modalBody'));
    });
  }

  var libPrintBtn = document.getElementById('libPrintBtn');
  if (libPrintBtn) {
    libPrintBtn.addEventListener('click', function () {
      printGuide(libGuideBody);
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

  var upSelectedText    = '';
  var icmHistory        = [];
  var icmContextText    = '';
  var icmTopic          = '';
  var _pendingBroadcast = null;
  var _inScripture      = false;
  var _lookupOnly       = false;
  var _pendingPinData   = null;
  var PINS_KEY          = 'ironink_scripture_pins';

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
      '<button class="up-ai-btn">Explore</button>' +
      '<button class="up-verse-btn">Verse Lookup</button>' +
      '<button class="up-note-btn">Add Note</button>' +
    '</div>' +
    '<div class="up-content" style="display:none;">' +
      '<div class="up-define-pane" style="display:none;">' +
        '<div class="up-definition"></div>' +
      '</div>' +
      '<div class="up-verse-pane" style="display:none;">' +
        '<div class="up-verse-result"></div>' +
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
    '</div>' +
    '<div class="up-share-footer" style="display:none;flex-direction:row;gap:0.5rem;justify-content:flex-end;padding:0.6rem 14px 0.8rem;margin-top:0.4rem;border-top:1px solid #ddd0b0;">' +
      '<button class="up-private-btn" style="background:transparent;color:#8a6c30;border:1px solid #c4a882;border-radius:4px;padding:5px 14px;font-size:0.82rem;cursor:pointer;font-family:\'EB Garamond\',Georgia,serif;letter-spacing:0.02em;">Keep Private</button>' +
      '<button class="up-share-btn" style="background:#5C1A28;color:#fff;border:none;border-radius:4px;padding:5px 14px;font-size:0.82rem;cursor:pointer;font-family:\'EB Garamond\',Georgia,serif;letter-spacing:0.02em;">Share to Chat</button>' +
    '</div>' +
    '<div class="up-pin-footer" style="display:none;flex-direction:row;gap:0.5rem;justify-content:flex-end;padding:0.6rem 14px 0.8rem;margin-top:0.4rem;border-top:1px solid #ddd0b0;">' +
      '<button class="up-pin-dismiss-btn" style="background:transparent;color:#8a6c30;border:1px solid #c4a882;border-radius:4px;padding:5px 14px;font-size:0.82rem;cursor:pointer;font-family:\'EB Garamond\',Georgia,serif;letter-spacing:0.02em;">Dismiss</button>' +
      '<button class="up-pin-btn" style="background:#5C1A28;color:#fff;border:none;border-radius:4px;padding:5px 14px;font-size:0.82rem;cursor:pointer;font-family:\'EB Garamond\',Georgia,serif;letter-spacing:0.02em;">Pin to Sidebar</button>' +
    '</div>' +
    '<div class="up-save-note-footer" style="display:none;flex-direction:row;gap:0.5rem;justify-content:flex-end;padding:0.6rem 14px 0.8rem;margin-top:0.4rem;border-top:1px solid #ddd0b0;">' +
      '<button class="up-save-note-dismiss" style="background:transparent;color:#8a6c30;border:1px solid #c4a882;border-radius:4px;padding:5px 14px;font-size:0.82rem;cursor:pointer;font-family:\'EB Garamond\',Georgia,serif;letter-spacing:0.02em;">Dismiss</button>' +
      '<button class="up-save-note-btn" style="background:#5C1A28;color:#fff;border:none;border-radius:4px;padding:5px 14px;font-size:0.82rem;cursor:pointer;font-family:\'EB Garamond\',Georgia,serif;letter-spacing:0.02em;">Save to Notepad</button>' +
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

  function showShareFooter(payload) {
    _pendingBroadcast = payload;
    var footer = upEl.querySelector('.up-share-footer');
    if (footer) { footer.style.display = 'flex'; clampUp(); }
  }

  function hideShareFooter() {
    _pendingBroadcast = null;
    var footer = upEl.querySelector('.up-share-footer');
    if (footer) footer.style.display = 'none';
  }

  function showPinFooter(data) {
    _pendingPinData = data;
    var footer = upEl.querySelector('.up-pin-footer');
    if (footer) { footer.style.display = 'flex'; clampUp(); }
  }

  function hidePinFooter() {
    _pendingPinData = null;
    var footer = upEl.querySelector('.up-pin-footer');
    if (footer) footer.style.display = 'none';
  }

  // Notepad "Save to Notepad" footer (Library reader only — where a study is
  // open). Mirrors the pin footer, but persists to the per-study notepad.
  var _pendingNoteData = null;
  var upOccurrence     = 0;   // which occurrence of upSelectedText was highlighted

  function notepadCtx() {
    return (window.__notepadStudy && !_lookupOnly) ? window.__notepadStudy : null;
  }

  // The current selection sits in a freshly generated study that hasn't been
  // saved to the Library yet (Study page draft, exposed by study.js). Such a
  // study has no id to attach notes to — notes are offered but require a save.
  function hasUnsavedDraft() {
    return !_lookupOnly && !window.__notepadStudy &&
           !!(window.__ironStudyDraft &&
              typeof window.__ironStudyDraft.hasUnsaved === 'function' &&
              window.__ironStudyDraft.hasUnsaved());
  }

  // Can the user take notes in the current context at all — either a bound study
  // or a saveable unsaved draft? Drives note-button/footer visibility.
  function canTakeNotes() {
    return !!notepadCtx() || hasUnsavedDraft();
  }

  // Resolve a notepad context, saving the draft first when needed. cb(ctx) runs
  // once a real study id is available; if the study must be saved, the app's
  // styled confirm modal gates it. cb is not called if the user cancels or the
  // save fails.
  function ensureNotepadCtx(cb) {
    var ctx = notepadCtx();
    if (ctx) { cb(ctx); return; }
    if (!hasUnsavedDraft()) return;
    // Dismiss the tooltip so it doesn't sit under the confirm modal.
    if (upEl) upEl.style.display = 'none';
    showConfirm(
      'Notes are saved with your study. Save this study to your Library to start taking notes?',
      'Save & Add Note',
      function () {
        window.__ironStudyDraft.save(function (err, savedCtx) {
          if (err || !savedCtx) {
            showToast('Could not save the study. Please try again.', true);
            return;
          }
          cb(savedCtx);
        });
      }
    );
  }

  // 0-based index of the current selection among all occurrences of `quote` in
  // the Library reader body. Lets the marker land on the exact highlight rather
  // than the first match. Falls back to 0 if it can't be determined.
  function computeSelectionOccurrence(quote) {
    try {
      if (!libGuideBody || !quote) return 0;
      var sel = window.getSelection();
      if (!sel || !sel.rangeCount) return 0;
      var selRange = sel.getRangeAt(0);
      if (!libGuideBody.contains(selRange.startContainer)) return 0;
      var pre = document.createRange();
      pre.setStart(libGuideBody, 0);
      pre.setEnd(selRange.startContainer, selRange.startOffset);
      var before = pre.toString();
      var count = 0, i = 0;
      while ((i = before.indexOf(quote, i)) !== -1) { count++; i += quote.length; }
      return count;
    } catch (e) { return 0; }
  }

  function showSaveNoteFooter(data) {
    if (!canTakeNotes()) return;
    _pendingNoteData = data;
    var footer = upEl.querySelector('.up-save-note-footer');
    var btn    = upEl.querySelector('.up-save-note-btn');
    if (btn) { btn.textContent = 'Save to Notepad'; btn.disabled = false; }
    if (footer) { footer.style.display = 'flex'; clampUp(); }
  }

  function hideSaveNoteFooter() {
    _pendingNoteData = null;
    var footer = upEl.querySelector('.up-save-note-footer');
    if (footer) footer.style.display = 'none';
  }

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
    upEl.querySelector('.up-verse-pane').style.display  = 'none';
    upEl.querySelector('.up-verse-result').textContent  = '';
    upEl.querySelector('.up-define-btn').classList.remove('up-btn-active');
    upEl.querySelector('.up-ai-btn').classList.remove('up-btn-active');
    upEl.querySelector('.up-verse-btn').classList.remove('up-btn-active');
    hideShareFooter();
    hidePinFooter();
    hideSaveNoteFooter();

    // "Add Note" shows whenever notes are possible — a study open in the Library
    // reader, or a freshly generated study that can be saved on demand.
    var noteBtn = upEl.querySelector('.up-note-btn');
    if (noteBtn) noteBtn.style.display = canTakeNotes() ? '' : 'none';

    // Measure collapsed height before committing to a position. display:flex (not
    // block) so the panel is a flex column — header/actions/footer fixed, the
    // results area the only scroller.
    upEl.style.top        = '0';
    upEl.style.left       = '0';
    upEl.style.visibility = 'hidden';
    upEl.style.display    = 'flex';
    var ph = upEl.offsetHeight || 80;

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

  // ── Shared study-context resolver ───────────────────────────────────────────
  // Determines the active study container and its display title. Used by the
  // selection popup (pass the selection's anchor node — the container must
  // contain it) and by the keyboard-summoned Ask AI panel (pass null — the
  // first currently-visible container wins). Returns null when none is active.
  function resolveStudyContext(anchorNode) {
    // Container "holds" the context if it contains the selection anchor, or —
    // when there is no selection — if it is currently visible on the page.
    function holds(el, visible) {
      if (!el) return false;
      return anchorNode ? el.contains(anchorNode) : visible;
    }
    function titleText(id, fallback) {
      var t = document.getElementById(id);
      return t ? t.textContent : (fallback || '');
    }

    var modal     = document.getElementById('guideModal');
    var modalBody = document.getElementById('modalBody');
    if (modal && modal.style.display !== 'none' && holds(modalBody, true)) {
      return { topic: titleText('modalTitle'), inScripture: false };
    }

    var roomGuideArea = document.getElementById('roomGuideArea');
    if (roomGuideArea && roomGuideArea.style.display !== 'none' &&
        holds(roomGuideArea, true)) {
      return { topic: titleText('roomGuideTitle'), inScripture: false };
    }

    var scriptureBody = document.getElementById('scriptureBody');
    if (holds(scriptureBody, true)) {
      return { topic: titleText('scriptureHeading', 'Scripture'), inScripture: true };
    }

    var libGuideArea = document.getElementById('libGuideArea');
    if (libGuideArea && libGuideArea.style.display !== 'none' &&
        holds(libGuideArea, true)) {
      return { topic: titleText('libGuideTitle'), inScripture: false };
    }

    // Community reader (shared studies + articles). Lookup-only: there is no room
    // to broadcast into and no personal pin sidebar, so Share/Pin are suppressed.
    var communityReading  = document.getElementById('communityReading');
    var communityReadBody = document.getElementById('communityReadBody');
    if (communityReading && communityReading.style.display !== 'none' &&
        holds(communityReadBody, true)) {
      return { topic: titleText('communityReadTitle'), inScripture: false, lookupOnly: true };
    }

    var guideArea = document.getElementById('guideArea');
    if (guideArea && guideArea.style.display !== 'none' &&
        holds(guideArea, true)) {
      return { topic: titleText('guideTitle'), inScripture: false };
    }

    return null;
  }

  // ── Selection detection ────────────────────────────────────────────────────
  // A modal / form / dialog is open, so any selection is stale/incidental rather
  // than a deliberate highlight of study content. Covers: the Library study modal,
  // the Study-page "Save to Library" form, the Study Chat modal, and any styled
  // confirm/alert modal (modal.js). When any of these is up, the tooltip stays shut.
  function isBlockingOverlayOpen() {
    if (icmEl && icmEl.style.display !== 'none') return true;               // Study Chat
    var gm = document.getElementById('guideModal');
    if (gm && gm.style.display !== 'none') return true;                      // Library study modal
    var sp = document.getElementById('savePanel');
    if (sp && sp.style.display !== 'none') return true;                      // Save to Library form
    if (document.querySelector('.ironink-modal-overlay')) return true;      // confirm / alert modal
    return false;
  }

  // The mouseup landed on (or inside) a UI control rather than study text, so it
  // isn't a fresh highlight — e.g. clicking "Save to Library" while old highlighted
  // text is still selected. Suppress the tooltip in that case.
  function isUiControlTarget(t) {
    return !!(t && t.closest && t.closest(
      'button, input, textarea, select, label, a, ' +
      '.up-actions, .save-panel, .guide-actions, .card-edit-popup, .save-panel-btns'
    ));
  }

  document.addEventListener('mouseup', function (e) {
    if (e.target.closest && (
          e.target.closest('#unifiedPopup') ||
          e.target.closest('#inlineChatModal'))) return;

    // Only fire on a deliberate highlight of study content — never on top of an
    // open dialog/form, and never when the release lands on a UI control. This is
    // the single guard that kills the several "stale selection" tooltip symptoms.
    if (isBlockingOverlayOpen() || isUiControlTarget(e.target)) return;

    var sel = window.getSelection();
    if (!sel) return;

    // Single-click on <em>/<i>: italic foreign-language terms (Greek, Hebrew, Latin
    // transliterations) are naturally clicked rather than drag-selected. A single click
    // produces a collapsed selection that would otherwise exit silently — detect the
    // click target instead and use the element's text content as the lookup term.
    var emTarget = null;
    if (!sel.rangeCount || sel.isCollapsed) {
      var tgt = e.target;
      if (tgt) {
        if (tgt.tagName === 'EM' || tgt.tagName === 'I') {
          emTarget = tgt;
        } else if (tgt.closest) {
          emTarget = tgt.closest('em, i');
        }
      }
      if (!emTarget) return;
    }

    var selText, rect, anchorNode;

    if (emTarget) {
      selText    = emTarget.textContent.trim();
      if (!selText || selText.length < 2) return;
      rect       = emTarget.getBoundingClientRect();
      anchorNode = emTarget;
    } else {
      selText = sel.toString().trim();
      if (!selText || selText.length < 4) return;
      var range  = sel.getRangeAt(0);
      rect       = range.getBoundingClientRect();
      // Normalize text node → parent element: text nodes inside <em>/<i> and other
      // inline elements may not pass Node.contains() uniformly across all browsers
      var cac = range.commonAncestorContainer;
      anchorNode = (cac.nodeType === 3) ? cac.parentElement : cac;
      if (!anchorNode) return;
    }

    // Resolve which study container the selection lives in (and its title)
    var ctx = resolveStudyContext(anchorNode);
    if (!ctx) return;

    _inScripture   = ctx.inScripture;
    _lookupOnly    = (ctx.lookupOnly === true);
    upSelectedText = selText;
    // Capture which occurrence was highlighted now, while the selection is live.
    upOccurrence   = computeSelectionOccurrence(selText);
    icmTopic       = ctx.topic;
    showUp(selText, rect);
    // Suppress any legacy dictionary tooltip that may fire after its 400 ms debounce
    setTimeout(function () {
      var dictTt = document.getElementById('dictTooltip');
      if (dictTt && upEl && upEl.style.display !== 'none') dictTt.style.display = 'none';
    }, 450);
  });

  // Dismiss popup on click outside
  document.addEventListener('mousedown', function (e) {
    if (upEl && upEl.style.display !== 'none' &&
        !e.target.closest('#unifiedPopup') &&
        !e.target.closest('.tooltip-font-ctrl')) {
      upEl.style.display = 'none';
    }
  });
  // Prevent scrollbar/scroll clicks inside popup from bubbling to the dismiss handler
  upEl.addEventListener('mousedown', function (e) { e.stopPropagation(); });

  // ── Draggable header (shared helper — also used by #askAiPanel) ─────────────
  // Drags `el` by its `handle`, clamped to the viewport. Clicks on buttons in
  // the handle (e.g. the close ×) are ignored so they fire normally.
  function makeDraggable(el, handle) {
    var off = null;
    handle.addEventListener('mousedown', function (e) {
      if (e.target.closest('button')) return;
      var r = el.getBoundingClientRect();
      off = { x: e.clientX - r.left, y: e.clientY - r.top };
      document.body.style.userSelect = 'none';
    });
    document.addEventListener('mousemove', function (e) {
      if (!off) return;
      var vw = window.innerWidth, vh = window.innerHeight;
      var pw = el.offsetWidth,  ph = el.offsetHeight;
      el.style.left = Math.min(Math.max(0, e.clientX - off.x), vw - pw) + 'px';
      el.style.top  = Math.min(Math.max(0, e.clientY - off.y), vh - ph) + 'px';
    });
    document.addEventListener('mouseup', function () {
      if (!off) return;
      off = null;
      document.body.style.userSelect = '';
    });
  }
  makeDraggable(upEl, upEl.querySelector('.up-header'));

  // ── Popup interactions ─────────────────────────────────────────────────────
  upEl.querySelector('.up-close').addEventListener('click', function () {
    hideShareFooter();
    upEl.style.display = 'none';
  });

  upEl.querySelector('.up-share-btn').addEventListener('click', function () {
    var btn = this;
    if (_pendingBroadcast && window.roomSocket) {
      window.roomSocket.emit('room-tooltip-broadcast', _pendingBroadcast);
    }
    btn.textContent = 'Shared ✓';
    btn.disabled    = true;
    setTimeout(function () {
      hideShareFooter();
      btn.textContent = 'Share to Chat';
      btn.disabled    = false;
    }, 1500);
  });

  upEl.querySelector('.up-private-btn').addEventListener('click', function () {
    hideShareFooter();
  });

  upEl.querySelector('.up-pin-dismiss-btn').addEventListener('click', function () {
    hidePinFooter();
  });

  upEl.querySelector('.up-pin-btn').addEventListener('click', function () {
    var btn = this;
    if (!_pendingPinData) return;
    var pins = loadPins();
    pins.unshift({
      id:       Date.now(),
      type:     _pendingPinData.type,
      term:     _pendingPinData.term,
      content:  _pendingPinData.content,
      pinnedAt: new Date().toISOString(),
    });
    savePins(pins);
    renderPinSidebar(pins);
    btn.textContent = 'Pinned ✓';
    btn.disabled    = true;
    setTimeout(function () {
      hidePinFooter();
      btn.textContent = 'Pin to Sidebar';
      btn.disabled    = false;
    }, 1500);
  });

  // ── Notepad: "Add Note" (anchored personal note — skips AI) ─────────────────
  upEl.querySelector('.up-note-btn').addEventListener('click', function () {
    if (!window.__notepad) return;
    // Capture the selection now — ensureNotepadCtx may pop a confirm modal first.
    var quote = upSelectedText, occ = upOccurrence;
    ensureNotepadCtx(function (ctx) {
      upEl.style.display = 'none';
      window.__notepad.startAnchoredNote(ctx.id, ctx.title, quote, occ);
    });
  });

  // ── Notepad: "Save to Notepad" (anchored lookup — captures term + result) ───
  // Dismiss closes the whole tooltip (same as the × button), not just the footer.
  upEl.querySelector('.up-save-note-dismiss').addEventListener('click', function () {
    hideSaveNoteFooter();
    upEl.style.display = 'none';
  });

  upEl.querySelector('.up-save-note-btn').addEventListener('click', function () {
    var btn = this;
    if (!_pendingNoteData || !window.__notepad) return;
    // Capture the note data now — ensureNotepadCtx may pop a confirm modal first.
    var data = _pendingNoteData;
    ensureNotepadCtx(function (ctx) {
      btn.disabled    = true;
      btn.textContent = 'Saving…';
      window.__notepad.saveLookupNote(ctx.id, ctx.title, data, function (ok) {
        if (!ok) { btn.textContent = 'Save to Notepad'; btn.disabled = false; return; }
        // Saved: give clear feedback via the app toast, then close the tooltip cleanly.
        hideSaveNoteFooter();
        btn.textContent = 'Save to Notepad';
        btn.disabled    = false;
        upEl.style.display = 'none';
        showToast('Saved to Notepad');
      });
    });
  });

  upEl.querySelector('.up-define-btn').addEventListener('click', function () {
    upEl.querySelector('.up-content').style.display     = 'flex';
    upEl.querySelector('.up-define-pane').style.display = 'flex';
    upEl.querySelector('.up-ai-pane').style.display     = 'none';
    upEl.querySelector('.up-verse-pane').style.display  = 'none';
    upEl.querySelector('.up-define-btn').classList.add('up-btn-active');
    upEl.querySelector('.up-ai-btn').classList.remove('up-btn-active');
    upEl.querySelector('.up-verse-btn').classList.remove('up-btn-active');

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
        defEl.innerHTML = renderMarkdown(data.definition);
        if (!_lookupOnly && window.ROOM_CODE && window.isHost) {
          showShareFooter({ roomCode: window.ROOM_CODE, type: 'Define', term: upSelectedText, response: data.definition });
        }
        if (!_lookupOnly && _inScripture) {
          showPinFooter({ type: 'Define', term: upSelectedText, content: data.definition });
        }
        showSaveNoteFooter({ quote: upSelectedText, question: null, content: data.definition, source: 'define', occurrence: upOccurrence });
      }
      clampUp();
    })
    .catch(function () {
      defEl.innerHTML = '<span style="color:#e08080;font-style:italic;">Definition unavailable.</span>';
      clampUp();
    });
  });

  upEl.querySelector('.up-ai-btn').addEventListener('click', function () {
    upEl.querySelector('.up-content').style.display     = 'flex';
    upEl.querySelector('.up-define-pane').style.display = 'none';
    upEl.querySelector('.up-verse-pane').style.display  = 'none';
    upEl.querySelector('.up-ai-pane').style.display     = 'flex';
    upEl.querySelector('.up-ai-btn').classList.add('up-btn-active');
    upEl.querySelector('.up-define-btn').classList.remove('up-btn-active');
    upEl.querySelector('.up-verse-btn').classList.remove('up-btn-active');
    clampUp();
    setTimeout(function () { upEl.querySelector('.up-ai-input').focus(); }, 40);
  });

  upEl.querySelector('.up-verse-btn').addEventListener('click', function () {
    upEl.querySelector('.up-content').style.display     = 'flex';
    upEl.querySelector('.up-define-pane').style.display = 'none';
    upEl.querySelector('.up-ai-pane').style.display     = 'none';
    upEl.querySelector('.up-verse-pane').style.display  = 'flex';
    upEl.querySelector('.up-verse-btn').classList.add('up-btn-active');
    upEl.querySelector('.up-define-btn').classList.remove('up-btn-active');
    upEl.querySelector('.up-ai-btn').classList.remove('up-btn-active');

    var verseEl = upEl.querySelector('.up-verse-result');
    verseEl.innerHTML = '<span class="up-loading">Looking up verse…</span>';
    clampUp();

    fetch('/api/library/verse', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ reference: upSelectedText }),
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data.error) {
        verseEl.innerHTML = '<span style="color:#e08080;font-style:italic;">' + esc(data.error) + '</span>';
      } else {
        verseEl.innerHTML = renderMarkdown(data.verse);
        if (!_lookupOnly && window.ROOM_CODE && window.isHost) {
          showShareFooter({ roomCode: window.ROOM_CODE, type: 'Verse Lookup', term: upSelectedText, response: data.verse });
        }
        if (!_lookupOnly && _inScripture) {
          showPinFooter({ type: 'Verse Lookup', term: upSelectedText, content: data.verse });
        }
        showSaveNoteFooter({ quote: upSelectedText, question: null, content: data.verse, source: 'verse', occurrence: upOccurrence });
      }
      clampUp();
    })
    .catch(function () {
      verseEl.innerHTML = '<span style="color:#e08080;font-style:italic;">Verse lookup unavailable.</span>';
      clampUp();
    });
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
      if (data.success) {
        resp.innerHTML = renderMarkdown(data.answer);
        if (!_lookupOnly && window.ROOM_CODE && window.isHost) {
          showShareFooter({ roomCode: window.ROOM_CODE, type: 'Explore', term: upSelectedText, response: data.answer });
        }
        if (!_lookupOnly && _inScripture) {
          showPinFooter({ type: 'Explore', term: upSelectedText, content: data.answer });
        }
        showSaveNoteFooter({ quote: upSelectedText, question: question, content: data.answer, source: 'explore', occurrence: upOccurrence });
      } else {
        resp.innerHTML = '<span style="color:#e08080;font-style:italic;">Error: ' + esc(data.error || 'Failed.') + '</span>';
      }
      clampUp();
    } catch (err) {
      resp.innerHTML = '<span style="color:#e08080;font-style:italic;">Error: ' + esc(err.message) + '</span>';
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
  // Track whether the floating notepad was open when the chat launched, so we can
  // restore it on close. Study Chat is a full-screen modal; the notepad is a high
  // z-index floating panel — leaving both up makes them fight for the same space.
  // Hiding the notepad while the chat is open (and restoring it after) keeps both
  // features intact without an overlay/z-index conflict.
  var _notepadWasOpen = false;

  function openIcm(selectedText, topic) {
    icmContextText = selectedText;
    icmTopic       = topic;
    icmHistory     = [];

    icmEl.querySelector('.icm-context-text').textContent = selectedText;
    icmEl.querySelector('.icm-thread').innerHTML         = '';
    icmEl.querySelector('.icm-input').value              = '';

    // Stand the notepad down for the duration of the chat, remembering its state.
    _notepadWasOpen = !!(window.__notepad && window.__notepad.isOpen && window.__notepad.isOpen());
    if (_notepadWasOpen) window.__notepad.close();

    icmEl.style.display = 'flex';
    setTimeout(function () { icmEl.querySelector('.icm-input').focus(); }, 40);
  }

  function closeIcm() {
    icmEl.style.display = 'none';
    // Restore the notepad exactly as the user left it before opening the chat.
    if (_notepadWasOpen && window.__notepad) window.__notepad.open();
    _notepadWasOpen = false;
  }

  icmEl.querySelector('.icm-close').addEventListener('click', closeIcm);
  icmEl.addEventListener('click', function (e) {
    if (e.target === icmEl) closeIcm();
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

  // ── Scripture pin sidebar ──────────────────────────────────────────────────

  function loadPins() {
    try { return JSON.parse(localStorage.getItem(PINS_KEY) || '[]'); }
    catch { return []; }
  }

  function savePins(pins) {
    localStorage.setItem(PINS_KEY, JSON.stringify(pins));
  }

  function renderPinSidebar(pins) {
    var list  = document.getElementById('spsList');
    var empty = document.getElementById('spsEmpty');
    if (!list) return;

    list.innerHTML = '';

    if (!pins || !pins.length) {
      if (empty) empty.style.display = '';
      return;
    }
    if (empty) empty.style.display = 'none';

    var typeShort = { 'Define': 'Define', 'Explore': 'Explore', 'Verse Lookup': 'Verse' };

    pins.forEach(function (pin) {
      var item = document.createElement('div');
      item.className = 'sps-item';

      var label    = typeShort[pin.type] || pin.type;
      var termDisp = pin.term.length > 42 ? pin.term.slice(0, 42) + '…' : pin.term;

      var bodyHtml = '';
      try {
        bodyHtml = (typeof marked !== 'undefined')
          ? marked.parse(pin.content || '')
          : '<pre>' + esc(pin.content || '') + '</pre>';
      } catch (e) {
        bodyHtml = esc(pin.content || '');
      }

      item.innerHTML =
        '<div class="sps-item-header">' +
          '<span class="sps-type-badge">' + esc(label) + '</span>' +
          '<span class="sps-item-term" title="' + esc(pin.term) + '">' + esc(termDisp) + '</span>' +
          '<button class="sps-remove-btn" aria-label="Remove pin" title="Remove">×</button>' +
        '</div>' +
        '<div class="sps-item-body">' + bodyHtml + '</div>';

      item.querySelector('.sps-remove-btn').addEventListener('click', function () {
        var updated = loadPins().filter(function (p) { return p.id !== pin.id; });
        savePins(updated);
        renderPinSidebar(updated);
      });

      list.appendChild(item);
    });
  }

  // Initialize sidebar on scripture page load
  if (document.getElementById('spsList')) {
    renderPinSidebar(loadPins());
  }

  // ── Standalone "Ask AI" floating panel (Ctrl+Alt+T) ─────────────────────────
  // A single-purpose, draggable panel for asking study questions without a
  // selection. Reuses the existing /api/library/ask endpoint with conversation
  // history, the shared makeDraggable helper, resolveStudyContext for context,
  // and renderMarkdown for answers — so its voice/formatting match the tooltip.
  var aapEl      = null;
  var aapTopic   = '';
  var aapHistory = [];

  function buildAskPanel() {
    var el = document.createElement('div');
    el.id        = 'askAiPanel';
    el.className = 'ask-ai-panel';
    el.style.display = 'none';
    el.innerHTML =
      '<div class="aap-header">' +
        '<span class="aap-title">Ask AI</span>' +
        '<kbd class="aap-hint">Ctrl+Alt+T</kbd>' +
        '<button class="aap-close" title="Close" aria-label="Close">×</button>' +
      '</div>' +
      '<div class="aap-thread"></div>' +
      '<div class="aap-input-row">' +
        '<textarea class="aap-input" rows="2" placeholder="Ask a question about this study…"></textarea>' +
        '<button class="aap-ask-btn">Ask</button>' +
      '</div>';
    document.body.appendChild(el);

    el.querySelector('.aap-close').addEventListener('click', closeAskPanel);
    el.querySelector('.aap-ask-btn').addEventListener('click', aapAsk);
    el.querySelector('.aap-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); aapAsk(); }
    });
    // Don't let clicks inside the panel reach the popup's outside-dismiss handler
    el.addEventListener('mousedown', function (e) { e.stopPropagation(); });
    makeDraggable(el, el.querySelector('.aap-header'));
    return el;
  }

  function openAskPanel() {
    if (!aapEl) aapEl = buildAskPanel();

    // Fresh session each summon: reset history, context, thread and input
    aapHistory = [];
    var ctx    = resolveStudyContext(null);
    aapTopic   = ctx ? ctx.topic : '';
    aapEl.querySelector('.aap-thread').innerHTML = '';
    aapEl.querySelector('.aap-input').value      = '';

    // Center on screen (no selection to anchor to), then draggable thereafter
    aapEl.style.visibility = 'hidden';
    aapEl.style.display    = 'flex';
    var pw = aapEl.offsetWidth, ph = aapEl.offsetHeight;
    aapEl.style.left = Math.max(8, (window.innerWidth  - pw) / 2) + 'px';
    aapEl.style.top  = Math.max(8, (window.innerHeight - ph) / 2) + 'px';
    aapEl.style.visibility = '';

    setTimeout(function () { aapEl.querySelector('.aap-input').focus(); }, 40);
  }

  function closeAskPanel() {
    if (aapEl) aapEl.style.display = 'none';
  }

  function toggleAskPanel() {
    if (aapEl && aapEl.style.display !== 'none') closeAskPanel();
    else openAskPanel();
  }

  function aapAppendMsg(role, bodyHtml) {
    var thread = aapEl.querySelector('.aap-thread');
    var msg    = document.createElement('div');
    msg.className = 'aap-msg aap-msg-' + role;
    msg.innerHTML =
      '<div class="aap-msg-label">' + (role === 'user' ? 'You' : 'Iron & Ink') + '</div>' +
      '<div class="aap-msg-body">' + bodyHtml + '</div>';
    thread.appendChild(msg);
    thread.scrollTop = thread.scrollHeight;
    return msg;
  }

  function aapAsk() {
    var input = aapEl.querySelector('.aap-input');
    var btn   = aapEl.querySelector('.aap-ask-btn');
    var q     = input.value.trim();
    if (!q) { input.focus(); return; }

    input.value  = '';
    btn.disabled = true;

    // First turn carries the inherited study context; later turns rely on the
    // accumulated history so the AI remembers the conversation.
    var content = (aapHistory.length === 0 && aapTopic)
      ? 'I am reading a study on "' + aapTopic + '". ' + q
      : q;

    aapAppendMsg('user', esc(q).replace(/\n/g, '<br>'));
    aapHistory.push({ role: 'user', content: content });

    var pending = aapAppendMsg('assistant', '<span class="up-loading">Thinking…</span>');
    var body    = pending.querySelector('.aap-msg-body');

    fetch('/api/library/ask', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ history: aapHistory }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.success) {
          body.innerHTML = renderMarkdown(data.answer);
          aapHistory.push({ role: 'assistant', content: data.answer });
        } else {
          body.innerHTML = '<span style="color:#e08080;font-style:italic;">Error: ' +
            esc(data.error || 'Failed.') + '</span>';
          aapHistory.pop();  // drop the unanswered user turn
        }
      })
      .catch(function (err) {
        body.innerHTML = '<span style="color:#e08080;font-style:italic;">Error: ' +
          esc(err.message) + '</span>';
        aapHistory.pop();
      })
      .then(function () {
        btn.disabled = false;
        input.focus();
        var thread = aapEl.querySelector('.aap-thread');
        thread.scrollTop = thread.scrollHeight;
      });
  }

  // Ctrl+Alt+T summons / toggles the panel — mirrors the dm-badge.js pattern
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey && e.altKey && (e.key === 't' || e.key === 'T')) {
      var tag = document.activeElement ? document.activeElement.tagName : '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      toggleAskPanel();
    }
  });

  loadStudies();
})();
