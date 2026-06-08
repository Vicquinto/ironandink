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
          '<span class="form-badge form-badge-' + esc(a.form || 'article') + '">' + formLabel + '</span>';
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
      btn.addEventListener('click', async function () {
        if (!confirm('Delete this comment?')) return;
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
    var escaped = String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    var paragraphs = escaped.split(/\n\n+/).map(function (para) {
      return para
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/^#+\s+(.+)$/gm, '<strong>$1</strong>')
        .replace(/\n/g, '<br>');
    });
    return '<p>' + paragraphs.join('</p><p>') + '</p>';
  }

  function formDisplayLabel(form) {
    var labels = { article: 'Article', sermon: 'Sermon', letter: 'Letter' };
    return labels[form] || 'Article';
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

  loadFeed();
})();
