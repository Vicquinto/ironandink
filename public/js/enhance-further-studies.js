(function (global) {
  'use strict';

  // Shared "Further Studies" enhancer. Single source of truth for the study page
  // (study.js) and the saved-study Library view (library.js). Consolidated from
  // study.js's private copy — do not fork it again; edit here so every context
  // upgrades Further-Studies lines identically.
  //
  // This does ONLY the context-free part: scan a container's `<p class="guide-p">`
  // paragraphs, match the exact `Study prompt: "…"` anchor, and replace each match
  // with either a clickable `.branch-suggestion` button or — when the prompt has
  // already been branched — an inert "✓ Explored" marker. It deliberately wires NO
  // click behavior; each context (study page = in-place branch; Library = navigate
  // to /study) attaches its own delegated listener.
  //
  // exploredSet (optional): a Set of prompt strings that have already been branched
  // for the study being viewed. A prompt in the set renders as the inert marker,
  // which is deliberately NOT a `.branch-suggestion` element — so every existing
  // delegated handler's `closest('.branch-suggestion')` returns null and ignores it
  // with zero handler edits. Omitting exploredSet (the study-page caller) means "no
  // prompts explored" → every prompt is clickable, exactly as before. The set is
  // computed live by the caller from current children (never cached/persisted), so
  // deleting a branch frees its prompt on the next render with no extra code.
  //
  // Anchor: /^\s*Study prompt:\s*"([^"]+)"\s*$/ — captures the FULL quoted phrase
  // (it may contain colons or a trailing "?"). Elements are built via createElement
  // + textContent (never innerHTML), so the topic is a raw string value and the
  // browser handles attribute-encoding — there is no HTML-injection surface.
  global.enhanceFurtherStudies = function enhanceFurtherStudies(containerEl, exploredSet) {
    if (!containerEl) return;
    var hasExplored = exploredSet && typeof exploredSet.has === 'function';
    var paras = containerEl.querySelectorAll('p.guide-p');
    Array.prototype.forEach.call(paras, function (p) {
      var m = (p.textContent || '').match(/^\s*Study prompt:\s*"([^"]+)"\s*$/);
      if (!m) return; // only exact anchor matches; every other paragraph is left untouched
      var topic = m[1];

      // Already-branched prompt → inert marker. NOT a .branch-suggestion, so the
      // delegated click handlers never match it. Non-focusable, aria-disabled.
      if (hasExplored && exploredSet.has(topic)) {
        var marker = document.createElement('div');
        marker.className = 'branch-explored';
        marker.setAttribute('aria-disabled', 'true');

        var checkEl = document.createElement('span');
        checkEl.className = 'branch-explored-check';
        checkEl.textContent = '✓';

        var mTopicEl = document.createElement('span');
        mTopicEl.className = 'branch-explored-topic';
        mTopicEl.textContent = topic;

        var mCueEl = document.createElement('span');
        mCueEl.className = 'branch-explored-cue';
        mCueEl.textContent = 'Explored';

        marker.appendChild(checkEl);
        marker.appendChild(mTopicEl);
        marker.appendChild(mCueEl);
        p.replaceWith(marker);
        return;
      }

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'branch-suggestion';
      btn.setAttribute('data-branch-topic', topic);

      var topicEl = document.createElement('span');
      topicEl.className = 'branch-suggestion-topic';
      topicEl.textContent = topic;

      var cueEl = document.createElement('span');
      cueEl.className = 'branch-suggestion-cue';
      cueEl.textContent = 'Explore this study →';

      btn.appendChild(topicEl);
      btn.appendChild(cueEl);
      p.replaceWith(btn);
    });
  };

}(window));
