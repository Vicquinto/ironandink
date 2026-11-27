(function () {
  'use strict';

  // A study shared with this member alongside its Study Notes, read only
  // (routes/study-shares.js). The stored text is rendered with the shared
  // renderer (which ends in the sanitizer); nothing here can note, highlight,
  // bookmark or change it.
  var BOOT = window.SHARED_STUDY_BOOT || {};
  var body = document.getElementById('sharedStudyBody');
  if (!body) return;
  if (window.renderMarkdown) body.innerHTML = window.renderMarkdown(String(BOOT.content || ''));
  else body.textContent = String(BOOT.content || '');
  // Opposing Views: the fixed Part 1 note and the Part 2 Hide / Show button.
  if (BOOT.studyType === 'opposing' && window.IronInkOpposingViews) {
    window.IronInkOpposingViews.enhance(body, {});
  }
})();
