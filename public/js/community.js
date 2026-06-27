(function () {
  'use strict';

  var communityFeed    = document.getElementById('communityFeed');
  var communityReading = document.getElementById('communityReading');
  var communityBackBtn = document.getElementById('communityBackBtn');
  var communityReadBadges = document.getElementById('communityReadBadges');
  var communityReadTitle  = document.getElementById('communityReadTitle');
  var communityReadMeta   = document.getElementById('communityReadMeta');
  var communityReadBody   = document.getElementById('communityReadBody');

  var featuredSection = document.getElementById('featuredSection');
  var featuredList    = document.getElementById('featuredList');
  var feedList        = document.getElementById('feedList');
  var communityEmpty  = document.getElementById('communityEmpty');
  var communityLoading = document.getElementById('communityLoading');

  var amenBtn   = document.getElementById('amenBtn');
  var amenCount = document.getElementById('amenCount');

  var commentInput   = document.getElementById('commentInput');
  var postCommentBtn = document.getElementById('postCommentBtn');
  var commentList    = document.getElementById('commentList');

  var IS_ADMIN        = window.IS_ADMIN        || false;
  var CURRENT_USER_ID = window.CURRENT_USER_ID || null;

  var currentArticleId  = null;
  var currentUserAmened = false;

  // ── Back button ───────────────────────────────────────────────────────────
  if (communityBackBtn) {
    communityBackBtn.addEventListener('click', function () {
      communityReading.style.display = 'none';
      communityFeed.style.display    = 'block';
    });
  }

  // ── Load feed ─────────────────────────────────────────────────────────────
  async function loadFeed() {
    if (communityLoading) communityLoading.style.display = 'flex';
    try {
      var res  = await fetch('/api/community/articles');
      var data = await res.json();
      renderFeed(data.articles || []);
    } catch (err) {
      if (feedList) feedList.innerHTML = '<p class="writing-empty">Could not load articles.</p>';
    } finally {
      if (communityLoading) communityLoading.style.display = 'none';
    }
  }

  function renderFeed(articles) {
    var pinned  = articles.filter(function (a) { return a.pinned; });
    var regular = articles.filter(function (a) { return !a.pinned; });

    if (pinned.length) {
      if (featuredSection) featuredSection.style.display = 'block';
      if (featuredList)    featuredList.innerHTML = pinned.map(articleCard).join('');
      attachFeedHandlers(featuredList);
    } else {
      if (featuredSection) featuredSection.style.display = 'none';
    }

    if (!articles.length) {
      if (communityEmpty) communityEmpty.style.display = 'block';
      if (feedList)       feedList.innerHTML = '';
      return;
    }
    if (communityEmpty) communityEmpty.style.display = 'none';
    if (feedList) {
      feedList.innerHTML = regular.map(articleCard).join('');
      attachFeedHandlers(feedList);
    }
  }

  function articleCard(a) {
    var words     = a.content ? a.content.trim().split(/\s+/).length : 0;
    var formLabel = formDisplayLabel(a.form);
    return '<div class="community-card" data-id="' + esc(a.id) + '">' +
      '<h3 class="community-card-title">' + esc(a.title) + '</h3>' +
      '<div class="community-card-meta">' +
        '<span class="tier-badge-sm">Tier ' + a.tier + '</span>' +
        '<span class="form-badge form-badge-' + esc(a.form || 'article') + '">' + formLabel + '</span>' +
        studyLevelBadge(a.studyLevel) +
        '<span class="community-card-author">' + esc(a.authorName || '') + '</span>' +
        '<span class="article-card-date">' + fmtDate(a.publishedAt || a.updatedAt) + '</span>' +
        '<span class="article-word-count">' + words + ' words</span>' +
      '</div>' +
      '<div class="community-card-footer">' +
        '<span class="community-amen-count">&#9825; ' + (a.amenCount || 0) + '</span>' +
        '<span class="community-comment-count">&#128172; ' + (a.commentCount || 0) + '</span>' +
        '<button class="btn-warm community-read-btn" style="font-size:0.82rem; padding:6px 14px;">Read</button>' +
      '</div>' +
    '</div>';
  }

  function attachFeedHandlers(container) {
    if (!container) return;
    container.querySelectorAll('.community-read-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var card = btn.closest('.community-card');
        if (card) openArticle(card.dataset.id);
      });
    });
  }

  // ── Reading view ──────────────────────────────────────────────────────────
  async function openArticle(id) {
    try {
      var res  = await fetch('/api/community/articles/' + encodeURIComponent(id));
      var data = await res.json();
      if (!data.success) { showToast('Could not load article.', true); return; }

      var a = data.article;
      currentArticleId  = a.id;
      currentUserAmened = !!a.userAmened;

      communityReadTitle.textContent = a.title;
      communityReadMeta.textContent  = (a.authorName || '') + ' · ' + fmtDate(a.publishedAt || a.updatedAt);
      communityReadBody.innerHTML    = renderReadingText(a.content || '');

      var formLabel = formDisplayLabel(a.form);
      if (communityReadBadges) {
        communityReadBadges.innerHTML =
          '<span class="tier-badge-sm">Tier ' + a.tier + '</span> ' +
          '<span class="form-badge form-badge-' + esc(a.form || 'article') + '">' + formLabel + '</span>' +
          (a.studyLevel ? ' ' + studyLevelBadge(a.studyLevel) : '');
      }

      updateAmenBtn(a.amenCount || 0, currentUserAmened);

      if (commentInput)   commentInput.value   = '';
      if (commentList)    commentList.innerHTML = '';

      communityFeed.style.display    = 'none';
      communityReading.style.display = 'block';

      loadComments(a.id);
    } catch (err) {
      showToast('Error: ' + err.message, true);
    }
  }

  // ── Amen ──────────────────────────────────────────────────────────────────
  function updateAmenBtn(count, amened) {
    if (!amenBtn || !amenCount) return;
    amenCount.textContent = count;
    amenBtn.classList.toggle('amened', amened);
  }

  if (amenBtn) {
    amenBtn.addEventListener('click', async function () {
      if (!currentArticleId) return;

      // optimistic update
      currentUserAmened = !currentUserAmened;
      var currentCount  = parseInt(amenCount.textContent, 10) || 0;
      updateAmenBtn(currentUserAmened ? currentCount + 1 : currentCount - 1, currentUserAmened);

      try {
        var res  = await fetch('/api/community/amens/' + encodeURIComponent(currentArticleId), { method: 'POST' });
        var data = await res.json();
        if (data.success) {
          updateAmenBtn(data.count, data.userAmened);
          currentUserAmened = data.userAmened;
        } else {
          // revert
          currentUserAmened = !currentUserAmened;
          updateAmenBtn(currentCount, currentUserAmened);
        }
      } catch (err) {
        // revert on error
        currentUserAmened = !currentUserAmened;
        updateAmenBtn(currentCount, currentUserAmened);
      }
    });
  }

  // ── Comments ──────────────────────────────────────────────────────────────
  async function loadComments(articleId) {
    try {
      var res  = await fetch('/api/community/comments/' + encodeURIComponent(articleId));
      var data = await res.json();
      renderComments(data.comments || []);
    } catch (err) {
      if (commentList) commentList.innerHTML = '<p class="writing-empty">Could not load comments.</p>';
    }
  }

  function renderComments(comments) {
    if (!commentList) return;
    if (!comments.length) {
      commentList.innerHTML = '<p class="writing-empty" style="margin-top:12px;">No comments yet. Be the first.</p>';
      return;
    }
    commentList.innerHTML = comments.map(function (c) {
      var canDelete = IS_ADMIN || c.userId === CURRENT_USER_ID;
      return '<div class="comment-item" data-id="' + esc(c.id) + '">' +
        '<div class="comment-header">' +
          '<span class="comment-author">' + esc(c.authorName || '') + '</span>' +
          '<span class="comment-date">' + fmtDate(c.createdAt) + '</span>' +
          (canDelete ? '<button class="comment-delete-btn" data-id="' + esc(c.id) + '" title="Delete">&#10005;</button>' : '') +
        '</div>' +
        '<p class="comment-body">' + esc(c.content) + '</p>' +
      '</div>';
    }).join('');

    commentList.querySelectorAll('.comment-delete-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        showConfirm('Delete this comment?', 'Delete', async function () {
          try {
            var res  = await fetch('/api/community/comments/' + encodeURIComponent(btn.dataset.id), { method: 'DELETE' });
            var data = await res.json();
            if (data.success) loadComments(currentArticleId);
            else showToast('Delete failed: ' + (data.error || ''), true);
          } catch (err) {
            showToast('Error: ' + err.message, true);
          }
        });
      });
    });
  }

  if (postCommentBtn) {
    postCommentBtn.addEventListener('click', async function () {
      if (!currentArticleId) return;
      var content = commentInput ? commentInput.value.trim() : '';
      if (!content) return;

      postCommentBtn.disabled = true;
      try {
        var res  = await fetch('/api/community/comments', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ articleId: currentArticleId, content }),
        });
        var data = await res.json();
        if (data.success) {
          if (commentInput) commentInput.value = '';
          loadComments(currentArticleId);
        } else {
          showToast('Could not post comment: ' + (data.error || ''), true);
        }
      } catch (err) {
        showToast('Error: ' + err.message, true);
      } finally {
        postCommentBtn.disabled = false;
      }
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function renderReadingText(text) {
    if (window.marked) {
      return window.marked.parse ? window.marked.parse(String(text)) : window.marked(String(text));
    }
    var escaped = String(text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return '<p>' + escaped.split(/\n\n+/).map(function (p) {
      return p.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
              .replace(/\*(.+?)\*/g, '<em>$1</em>')
              .replace(/\n/g, '<br>');
    }).join('</p><p>') + '</p>';
  }

  function formDisplayLabel(form) {
    var labels = { article: 'Article', sermon: 'Sermon', letter: 'Letter' };
    return labels[form] || 'Article';
  }

  function studyLevelBadge(level) {
    if (!level) return '';
    var labels = { foundations: 'FOUNDATIONAL', journeyman: 'STANDARD', scholar: 'ADVANCED' };
    var label  = labels[level];
    if (!label) return '';
    return '<span class="study-level-badge study-level-badge-' + esc(level) + '">' + label + '</span>';
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

  // ── Reading font size ─────────────────────────────────────────────────────
  var RFONT_DEFAULT = 16, RFONT_MIN = 12, RFONT_MAX = 28, RFONT_STEP = 2;
  var rfontSize = parseInt(localStorage.getItem('ironink_study_font_size'), 10) || RFONT_DEFAULT;

  function applyCommunityFontSize(size) {
    rfontSize = Math.min(RFONT_MAX, Math.max(RFONT_MIN, size));
    if (communityReadBody) communityReadBody.style.fontSize = rfontSize + 'px';
    localStorage.setItem('ironink_study_font_size', rfontSize);
  }

  applyCommunityFontSize(rfontSize);

  var cFontDec   = document.getElementById('communityFontDec');
  var cFontReset = document.getElementById('communityFontReset');
  var cFontInc   = document.getElementById('communityFontInc');
  if (cFontDec) {
    cFontDec.addEventListener('click',   function () { applyCommunityFontSize(rfontSize - RFONT_STEP); });
    cFontReset.addEventListener('click', function () { applyCommunityFontSize(RFONT_DEFAULT); });
    cFontInc.addEventListener('click',   function () { applyCommunityFontSize(rfontSize + RFONT_STEP); });
  }

  // ══ PRAYER REQUEST BOARD ════════════════════════════════════════════════════
  // Mirrors the article feed + Amen + comments patterns above, scoped to prayers.
  var prayerBoard   = document.getElementById('prayerBoard');
  var prayerInput    = document.getElementById('prayerInput');
  var prayerAnon     = document.getElementById('prayerAnon');
  var prayerAnonNote = document.getElementById('prayerAnonNote');
  var postPrayerBtn  = document.getElementById('postPrayerBtn');

  // Reveal the reinforcing privacy line exactly when "Post anonymously" is checked.
  function syncAnonNote() {
    if (prayerAnonNote) prayerAnonNote.style.display = (prayerAnon && prayerAnon.checked) ? 'block' : 'none';
  }
  if (prayerAnon) prayerAnon.addEventListener('change', syncAnonNote);
  var prayerList    = document.getElementById('prayerList');
  var prayerEmpty   = document.getElementById('prayerEmpty');
  var prayerLoading = document.getElementById('prayerLoading');

  // ── Tab switching (Articles ↔ Prayer Requests) ─────────────────────────────
  var communityTabs = document.querySelectorAll('.community-tab');
  function switchCommunityTab(target) {
    communityTabs.forEach(function (t) {
      t.classList.toggle('active', t.getAttribute('data-ctab') === target);
    });
    if (target === 'prayers') {
      if (communityFeed)    communityFeed.style.display    = 'none';
      if (communityReading) communityReading.style.display = 'none';
      if (prayerBoard)      prayerBoard.style.display      = 'block';
      loadPrayers();
    } else {
      if (prayerBoard)      prayerBoard.style.display      = 'none';
      if (communityReading) communityReading.style.display = 'none';
      if (communityFeed)    communityFeed.style.display    = 'block';
    }
  }
  communityTabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      switchCommunityTab(tab.getAttribute('data-ctab'));
    });
  });

  // ── Refresh the prayer feed when the user returns attention to the page ─────
  // Counts in the feed are a snapshot from the last load; nothing pushes other
  // accounts' new comments / praying toggles to an already-open feed. Re-fetch
  // on focus / tab-visible so the badges come current — but ONLY when the Prayer
  // Requests tab is actually the active view (never disturb the Articles tab).
  function isPrayerTabActive() {
    if (prayerBoard && prayerBoard.style.display === 'block') return true;
    var active = document.querySelector('.community-tab.active');
    return !!(active && active.getAttribute('data-ctab') === 'prayers');
  }
  window.addEventListener('focus', function () {
    try { if (isPrayerTabActive()) loadPrayers(); } catch (e) {}
  });
  document.addEventListener('visibilitychange', function () {
    try { if (document.visibilityState === 'visible' && isPrayerTabActive()) loadPrayers(); } catch (e) {}
  });

  // ── Load feed ──────────────────────────────────────────────────────────────
  async function loadPrayers() {
    if (prayerLoading) prayerLoading.style.display = 'flex';
    try {
      var res  = await fetch('/api/community/prayers?_=' + Date.now(), { cache: 'no-store' });
      var data = await res.json();
      renderPrayers(data.prayers || []);
    } catch (err) {
      if (prayerList) prayerList.innerHTML = '<p class="writing-empty">Could not load prayer requests.</p>';
    } finally {
      if (prayerLoading) prayerLoading.style.display = 'none';
    }
  }

  function renderPrayers(prayers) {
    if (!prayerList) return;
    if (!prayers.length) {
      prayerList.innerHTML = '';
      if (prayerEmpty) prayerEmpty.style.display = 'block';
      return;
    }
    if (prayerEmpty) prayerEmpty.style.display = 'none';
    prayerList.innerHTML = prayers.map(prayerCard).join('');
    attachPrayerHandlers();
  }

  function prayerCard(p) {
    var canManage = p.isOwner || IS_ADMIN;
    // The server already swaps authorName to "A brother or sister in Christ" for
    // other members. When the owner/admin sees the real name, flag that it's
    // hidden from everyone else.
    var anonTag = (p.anonymous && canManage)
      ? ' <span class="prayer-anon-tag">anonymous</span>'
      : '';
    var answeredBadge = p.answered
      ? '<span class="prayer-answered-badge">&#128591; Answered &middot; Praise</span>'
      : '';
    var answerBtn = (!p.answered && canManage)
      ? '<button class="prayer-answered-btn" data-id="' + esc(p.id) + '">Mark Answered</button>'
      : '';
    var deleteBtn = canManage
      ? '<button class="prayer-delete-btn" data-id="' + esc(p.id) + '" title="Delete">&#10005;</button>'
      : '';
    // Answered requests: freeze the praying toggle into a static, non-interactive
    // label that still honors everyone who prayed ("🙏 X prayed"). It deliberately
    // has NO .prayer-praying-btn class, so the toggle click handler never binds,
    // and is a disabled <button> so it cannot be clicked. Comments stay fully open
    // on answered requests (the comments block below is unconditional) so the
    // community can post praise. Unanswered requests keep the live toggle.
    var prayingControl = p.answered
      ? '<button class="btn-amen prayer-praying-static" disabled aria-disabled="true" title="This request has been answered — praying is closed.">' +
          '&#128591; ' + (p.prayingCount || 0) + ' prayed' +
        '</button>'
      : '<button class="btn-amen prayer-praying-btn' + (p.userPraying ? ' amened' : '') + '" data-id="' + esc(p.id) + '">' +
          '&#128591; Praying &nbsp;<span class="prayer-praying-count">' + (p.prayingCount || 0) + '</span>' +
        '</button>';
    return '<div class="community-card prayer-card' + (p.answered ? ' answered' : '') + '" data-id="' + esc(p.id) + '">' +
      '<div class="community-card-meta">' +
        '<span class="community-card-author">' + esc(p.authorName || '') + '</span>' + anonTag +
        '<span class="article-card-date">' + fmtDate(p.createdAt) + '</span>' +
        answeredBadge +
      '</div>' +
      '<p class="prayer-text">' + esc(p.text) + '</p>' +
      '<div class="community-card-footer">' +
        prayingControl +
        '<button class="btn-warm prayer-comments-toggle" data-id="' + esc(p.id) + '" style="font-size:0.82rem; padding:6px 14px;">&#128172; ' + (p.commentCount || 0) + '</button>' +
        answerBtn +
        deleteBtn +
      '</div>' +
      '<div class="prayer-comments" id="prayer-comments-' + esc(p.id) + '" style="display:none;">' +
        '<div class="comment-input-row">' +
          '<textarea class="comment-textarea prayer-comment-input" rows="2" placeholder="Add encouragement or Scripture&#8230;"></textarea>' +
          '<button class="btn-primary prayer-comment-post" data-id="' + esc(p.id) + '" style="margin-top:8px; font-size:0.82rem;">Post Comment</button>' +
        '</div>' +
        '<div class="comment-list prayer-comment-list"></div>' +
      '</div>' +
    '</div>';
  }

  function attachPrayerHandlers() {
    // Praying toggle — mirrors the Amen toggle (optimistic update + revert).
    prayerList.querySelectorAll('.prayer-praying-btn').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var id    = btn.dataset.id;
        var span  = btn.querySelector('.prayer-praying-count');
        var was   = btn.classList.contains('amened');
        var count = parseInt(span.textContent, 10) || 0;
        btn.classList.toggle('amened', !was);
        span.textContent = was ? count - 1 : count + 1;
        try {
          var res  = await fetch('/api/community/prayers/' + encodeURIComponent(id) + '/praying', { method: 'POST' });
          var data = await res.json();
          if (data.success) {
            btn.classList.toggle('amened', data.userPraying);
            span.textContent = data.count;
          } else {
            btn.classList.toggle('amened', was);
            span.textContent = count;
          }
        } catch (err) {
          btn.classList.toggle('amened', was);
          span.textContent = count;
        }
      });
    });

    // Comments expand/collapse.
    prayerList.querySelectorAll('.prayer-comments-toggle').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var box = document.getElementById('prayer-comments-' + btn.dataset.id);
        if (!box) return;
        var open = box.style.display !== 'none';
        box.style.display = open ? 'none' : 'block';
        if (!open) loadPrayerComments(btn.dataset.id, box.querySelector('.prayer-comment-list'));
      });
    });

    // Mark answered (owner/admin; backend re-checks ownership).
    prayerList.querySelectorAll('.prayer-answered-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        showConfirm('Mark this prayer request as answered?', 'Mark Answered', async function () {
          try {
            var res  = await fetch('/api/community/prayers/' + encodeURIComponent(btn.dataset.id) + '/answered', { method: 'POST' });
            var data = await res.json();
            if (data.success) loadPrayers();
            else showToast('Could not update: ' + (data.error || ''), true);
          } catch (err) {
            showToast('Error: ' + err.message, true);
          }
        });
      });
    });

    // Delete request (owner/admin; backend re-checks ownership).
    prayerList.querySelectorAll('.prayer-delete-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        showConfirm('Delete this prayer request?', 'Delete', async function () {
          try {
            var res  = await fetch('/api/community/prayers/' + encodeURIComponent(btn.dataset.id), { method: 'DELETE' });
            var data = await res.json();
            if (data.success) loadPrayers();
            else showToast('Delete failed: ' + (data.error || ''), true);
          } catch (err) {
            showToast('Error: ' + err.message, true);
          }
        });
      });
    });

    // Post a comment — mirrors the article comment post.
    prayerList.querySelectorAll('.prayer-comment-post').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var id      = btn.dataset.id;
        var box     = document.getElementById('prayer-comments-' + id);
        var input   = box ? box.querySelector('.prayer-comment-input') : null;
        var content = input ? input.value.trim() : '';
        if (!content) return;
        btn.disabled = true;
        try {
          var res  = await fetch('/api/community/prayer-comments', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ prayerId: id, content: content }),
          });
          var data = await res.json();
          if (data.success) {
            if (input) input.value = '';
            // Refresh the comment list in place (keeps the section OPEN and shows
            // the new comment), then update just this card's count badge from the
            // refreshed list length — do NOT re-render the whole feed (that
            // collapses the section the user just posted in).
            await loadPrayerComments(id, box.querySelector('.prayer-comment-list'));
            var card  = box.closest('.prayer-card');
            var badge = card ? card.querySelector('.prayer-comments-toggle') : null;
            if (badge) {
              var count = box.querySelectorAll('.prayer-comment-list .comment-item').length;
              badge.textContent = String.fromCodePoint(128172) + ' ' + count;
            }
          } else {
            showToast('Could not post comment: ' + (data.error || ''), true);
          }
        } catch (err) {
          showToast('Error: ' + err.message, true);
        } finally {
          btn.disabled = false;
        }
      });
    });
  }

  async function loadPrayerComments(prayerId, listEl) {
    if (!listEl) return;
    try {
      var res  = await fetch('/api/community/prayer-comments/' + encodeURIComponent(prayerId) + '?_=' + Date.now(), { cache: 'no-store' });
      var data = await res.json();
      var fetched = data.comments || [];
      renderPrayerComments(prayerId, fetched, listEl);
      // Self-correct this card's comment-count badge to the freshly fetched
      // count, so opening a request brings its badge current even if another
      // account commented after this viewer last loaded the feed. (Mirrors the
      // in-place badge update done after posting a comment.)
      var card  = listEl.closest('.prayer-card');
      var badge = card ? card.querySelector('.prayer-comments-toggle') : null;
      if (badge) badge.textContent = String.fromCodePoint(128172) + ' ' + fetched.length;
    } catch (err) {
      listEl.innerHTML = '<p class="writing-empty">Could not load comments.</p>';
    }
  }

  function renderPrayerComments(prayerId, comments, listEl) {
    if (!comments.length) {
      listEl.innerHTML = '<p class="writing-empty" style="margin-top:12px;">No comments yet. Be the first.</p>';
      return;
    }
    listEl.innerHTML = comments.map(function (c) {
      var canDelete = IS_ADMIN || c.userId === CURRENT_USER_ID;
      return '<div class="comment-item" data-id="' + esc(c.id) + '">' +
        '<div class="comment-header">' +
          '<span class="comment-author">' + esc(c.authorName || '') + '</span>' +
          '<span class="comment-date">' + fmtDate(c.createdAt) + '</span>' +
          (canDelete ? '<button class="prayer-comment-delete-btn" data-id="' + esc(c.id) + '" title="Delete">&#10005;</button>' : '') +
        '</div>' +
        '<p class="comment-body">' + esc(c.content) + '</p>' +
      '</div>';
    }).join('');

    listEl.querySelectorAll('.prayer-comment-delete-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        showConfirm('Delete this comment?', 'Delete', async function () {
          try {
            var res  = await fetch('/api/community/prayer-comments/' + encodeURIComponent(btn.dataset.id), { method: 'DELETE' });
            var data = await res.json();
            if (data.success) loadPrayerComments(prayerId, listEl);
            else showToast('Delete failed: ' + (data.error || ''), true);
          } catch (err) {
            showToast('Error: ' + err.message, true);
          }
        });
      });
    });
  }

  // ── Post a new prayer request ──────────────────────────────────────────────
  if (postPrayerBtn) {
    postPrayerBtn.addEventListener('click', async function () {
      var text = prayerInput ? prayerInput.value.trim() : '';
      if (!text) return;
      postPrayerBtn.disabled = true;
      try {
        var res  = await fetch('/api/community/prayers', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ text: text, anonymous: !!(prayerAnon && prayerAnon.checked) }),
        });
        var data = await res.json();
        if (data.success) {
          if (prayerInput) prayerInput.value = '';
          if (prayerAnon)  prayerAnon.checked = false;
          syncAnonNote();
          loadPrayers();
        } else {
          showToast('Could not post request: ' + (data.error || ''), true);
        }
      } catch (err) {
        showToast('Error: ' + err.message, true);
      } finally {
        postPrayerBtn.disabled = false;
      }
    });
  }

  loadFeed();
})();
