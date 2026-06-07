(function () {
  'use strict';

  var allStudies = [];

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

      return '<div class="study-card" data-id="' + esc(s.id) + '" tabindex="0" role="button">' +
          '<div class="study-card-header">' +
            '<h4 class="study-card-title">' + esc(s.topic) + '</h4>' +
            '<button class="card-delete-btn" data-id="' + esc(s.id) + '" title="Delete">&#10005;</button>' +
          '</div>' +
          '<div class="study-card-meta">' +
            '<span class="study-card-date">' + formatDate(s.savedAt) + '</span>' +
            '<span class="study-card-translation">' + esc(s.translation || 'LSB') + '</span>' +
          '</div>' +
          tagsHtml +
          starsHtml +
        '</div>';
    }).join('');

    // Card click → open modal
    grid.querySelectorAll('.study-card').forEach(function (card) {
      card.addEventListener('click', function (e) {
        if (e.target.classList.contains('card-delete-btn')) return;
        var study = allStudies.find(function (s) { return s.id === card.dataset.id; });
        if (study) openModal(study);
      });
      card.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') card.click();
      });
    });

    // Delete buttons
    grid.querySelectorAll('.card-delete-btn').forEach(function (btn) {
      btn.addEventListener('click', async function (e) {
        e.stopPropagation();
        if (!confirm('Delete this study? This cannot be undone.')) return;
        await deleteStudy(btn.dataset.id);
      });
    });
  }

  // ── Modal ──────────────────────────────────────────────────────────────────
  function openModal(study) {
    document.getElementById('modalTitle').textContent = study.topic;
    document.getElementById('modalBadge').textContent = study.translation || 'LSB';
    document.getElementById('modalBody').innerHTML    = renderMarkdown(study.content);
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
        alert('Could not delete study.');
      }
    } catch (err) {
      alert('Error: ' + err.message);
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

  loadStudies();
})();
