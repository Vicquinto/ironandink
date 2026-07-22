(function (global) {
  'use strict';

  // Shared study-card badge helpers. Single source of truth for both the saved-study
  // Library view (library.js) and the Community shared-studies view (community.js) —
  // consolidated from two drifting copies (Community's studyTypeBadge label map had
  // gone stale, missing `people`/`pathway`, so a Pathway study showed as DOCTRINAL).
  // Do not fork these again; edit here so every view labels studies identically.
  // Mirrors the render-markdown.js / enhance-further-studies.js consolidation pattern.

  // Type pill. Complete, current label map — `people` displays as SUBJECT (the type
  // was broadened from persons to persons/places/things) and `pathway` as PATHWAY.
  global.studyTypeBadge = function studyTypeBadge(type) {
    var t = type || 'doctrinal';
    if (t === 'deepdive') t = 'explore'; // legacy records saved under the old Deep Dive key
    var labels = { doctrinal: 'DOCTRINAL', explore: 'EXPLORE', historical: 'HISTORICAL', scripture: 'SCRIPTURE', open: 'OPEN', people: 'SUBJECT', pathway: 'PATHWAY', book: 'BOOK' };
    var label  = labels[t] || 'DOCTRINAL';
    return '<span class="study-type-badge study-type-badge-' + t + '">' + label + '</span>';
  };

  // Writing-level pill. Renders nothing for a missing/unknown level — it never
  // fabricates one, so a study saved without a level simply carries no level badge.
  global.studyLevelBadge = function studyLevelBadge(level) {
    var labels = { foundations: 'APPRENTICE', journeyman: 'JOURNEYMAN', scholar: 'SCHOLAR' };
    var label  = labels[level];
    if (!label) return '';
    return '<span class="study-level-badge study-level-badge-' + level + '">' + label + '</span>';
  };

  // Lineage pill derived PURELY from a study's own parentId — no children lookup and
  // no cross-study resolution. A study with a parent is a Branch; anything else gets
  // no badge. (The Library computes a richer Root/Branch-with-count pill from the
  // full local tree; Community cannot, since a viewer has no access to other members'
  // studies, so here we show only what a single record can prove about itself.)
  global.studyLineageBadge = function studyLineageBadge(study) {
    if (study && study.parentId) {
      return '<span class="study-card-lineage lineage-branch">↳ Branch</span>';
    }
    return '';
  };

}(window));
