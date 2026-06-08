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
  }

  document.getElementById('closeModal').addEventListener('click', closeModal);
  document.getElementById('guideModal').addEventListener('click', function (e) {
    if (e.target === document.getElementById('guideModal')) closeModal();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeModal();
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

  loadStudies();
})();
