(function (global) {
  'use strict';

  // Shared "Further Studies" enhancer. Single source of truth for the study page
  // (study.js) and the saved-study Library view (library.js). Consolidated from
  // study.js's private copy — do not fork it again; edit here so every context
  // upgrades Further-Studies lines identically.
  //
  // This does ONLY the context-free part: scan a container's `<p class="guide-p">`
  // paragraphs, match the exact `Study prompt: "…"` anchor, and replace each match
  // with a `.branch-suggestion` button carrying the topic on `data-branch-topic`.
  // It deliberately wires NO click behavior — each context (study page = in-place
  // branch; Library = navigate to /study) attaches its own delegated listener.
  //
  // Anchor: /^\s*Study prompt:\s*"([^"]+)"\s*$/ — captures the FULL quoted phrase
  // (it may contain colons or a trailing "?"). Buttons are built via createElement
  // + textContent (never innerHTML), so the topic is a raw string value and the
  // browser handles attribute-encoding — there is no HTML-injection surface.
  global.enhanceFurtherStudies = function enhanceFurtherStudies(containerEl) {
    if (!containerEl) return;
    var paras = containerEl.querySelectorAll('p.guide-p');
    Array.prototype.forEach.call(paras, function (p) {
      var m = (p.textContent || '').match(/^\s*Study prompt:\s*"([^"]+)"\s*$/);
      if (!m) return; // only exact anchor matches; every other paragraph is left untouched
      var topic = m[1];

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
