(function (global) {
  'use strict';

  // Shared Study with a Teacher entry points. Single source of truth for every
  // place a study is read: the study page (study.js), the Library inline view
  // (library.js) and shared Community studies (community.js). Each caller renders
  // the study as usual, then calls IronInkTeacher.attach(container, opts):
  //
  //   • "Study with a Teacher" at the top, with a one-line description underneath
  //   • a small "Teach me this section" button beside each section heading
  //   • a "Check my understanding" button at the end of the study
  //
  // Every button navigates to /teacher/<studyId>?mode=…&section=N (modes lesson /
  // section share the lesson session; check has its own). Sections are the
  // study's "## " headings except Further Studies, numbered from 1 in document
  // order — the same rule routes/teacher.js uses, so the numbers agree.
  //
  // Elements are built with createElement + textContent (never innerHTML). All of
  // them carry .teacher-entry so the notepad's text walker skips them and print
  // CSS hides them. attach() is idempotent: it removes its own earlier buttons
  // first, so re-rendering a study never duplicates them.
  //
  // opts.studyId   — the study's id, when it already has one
  // opts.resolveId — function (cb) for a study that must be saved first (the
  //                  fresh draft on the study page); calls cb(err, id)
  // opts.completion — { completedAt, canChange }: adds "Mark complete" (or
  //                  "✓ Completed · <date>" with Undo) at the top and the end.
  //                  canChange only for the member's own study or draft.
  // opts.onCompletionChange — function (completedAt, id) after a change

  // Section headings in a rendered study. renderMarkdown emits "## " as
  // <h3 class="guide-h3"> (its "# " title is h2.guide-h2); marked emits "## " as
  // a plain <h2>. Pick whichever form this container was rendered with.
  function sectionHeadings(container) {
    if (!container) return [];
    var guide = container.querySelectorAll('h3.guide-h3');
    if (guide.length) return Array.prototype.slice.call(guide);
    return Array.prototype.slice.call(container.querySelectorAll('h2:not(.guide-h2)'));
  }

  // "Further Studies" is a jumping-off list, not something to be taught.
  function isTeachable(heading) {
    return !/further\s+stud/i.test(heading.textContent || '');
  }

  // The lesson's sections: teachable headings, numbered 1..N in that order.
  function teachableHeadings(container) {
    return sectionHeadings(container).filter(isTeachable);
  }

  function teacherUrl(id, mode, section) {
    var url = '/teacher/' + encodeURIComponent(id) + '?mode=' + encodeURIComponent(mode);
    if (mode === 'section' && section) url += '&section=' + encodeURIComponent(section);
    return url;
  }

  function makeButton(className, label, title) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'teacher-entry ' + className;
    btn.textContent = label;
    if (title) btn.title = title;
    return btn;
  }

  // ── Completed status ─────────────────────────────────────────────────────
  // A study is Studying until the member marks it complete; Undo takes it back
  // (PUT /api/library/:id/completion — the server allows the study's owner only).
  // Nothing here ever marks a study complete without a click.
  function setCompletion(id, completed) {
    return fetch('/api/library/' + encodeURIComponent(id) + '/completion', {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ completed: !!completed }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || !data.success) throw new Error((data && data.error) || 'Could not update this study.');
        return data.completedAt || null;
      });
  }

  function formatCompletedDate(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }

  // "Mark complete", or "✓ Completed · <date>" with Undo. Fills `el` (emptied
  // first) using textContent only.
  function renderCompletion(el, completedAt, onToggle) {
    el.textContent = '';
    if (completedAt) {
      var done = document.createElement('span');
      done.className = 'study-complete-done';
      done.textContent = '✓ Completed · ' + formatCompletedDate(completedAt);
      var undo = document.createElement('button');
      undo.type = 'button';
      undo.className = 'study-complete-undo';
      undo.textContent = 'Undo';
      undo.title = 'Mark this study as still studying';
      undo.addEventListener('click', function () { onToggle(false, undo); });
      el.appendChild(done);
      el.appendChild(undo);
    } else {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'study-complete-btn';
      btn.textContent = 'Mark complete';
      btn.title = 'Mark this study as completed — you can undo it anytime';
      btn.addEventListener('click', function () { onToggle(true, btn); });
      el.appendChild(btn);
    }
  }

  function remove(container) {
    if (!container) return;
    container.querySelectorAll('.teacher-entry').forEach(function (el) { el.remove(); });
  }

  function attach(container, opts) {
    if (!container) return;
    opts = opts || {};
    remove(container);

    // The study's id — at once, or after saving a fresh draft (opts.resolveId).
    function withId(btn, cb) {
      if (opts.studyId) { cb(opts.studyId); return; }
      if (typeof opts.resolveId !== 'function') return;
      if (btn) btn.disabled = true;
      opts.resolveId(function (err, id) {
        if (btn) btn.disabled = false;
        if (err || !id) {
          if (typeof global.showAlert === 'function') global.showAlert('The study needs to be saved to your Library first. Please try again.');
          return;
        }
        opts.studyId = id;   // saved now — later clicks need no second save
        cb(id);
      });
    }

    function go(mode, section, btn) {
      withId(btn, function (id) { window.location.href = teacherUrl(id, mode, section); });
    }

    // Top: the way in, with a one-line description.
    var top = document.createElement('div');
    top.className = 'teacher-entry teacher-entry-top';
    function topChoice(label, desc, title, mode) {
      var wrap = document.createElement('div');
      wrap.className = 'teacher-entry-choice';
      var btn = makeButton('teacher-start-btn', label, title);
      var note = document.createElement('span');
      note.className = 'teacher-entry-note';
      note.textContent = desc;
      btn.addEventListener('click', function () { go(mode, null, btn); });
      wrap.appendChild(btn);
      wrap.appendChild(note);
      top.appendChild(wrap);
    }
    topChoice('Study with a Teacher', 'Walk through this study with a teacher, section by section.',
      'A teacher takes you through this study in order, and you can ask anything along the way', 'lesson');
    container.insertBefore(top, container.firstChild);

    // Beside each section heading: take the lesson to that section.
    teachableHeadings(container).forEach(function (h, i) {
      var n = i + 1;
      var btn = makeButton('teacher-section-btn', 'Teach me this section',
        'Have the teacher take you through “' + (h.textContent || '').trim() + '”');
      btn.addEventListener('click', function () { go('section', n, btn); });
      h.appendChild(btn);
    });

    // End: a short understanding check, then teach what was missed.
    var end = document.createElement('div');
    end.className = 'teacher-entry teacher-entry-end';
    var endLabel = document.createElement('p');
    endLabel.className = 'teacher-entry-end-label';
    endLabel.textContent = 'Finished reading?';
    var endBtn = makeButton('teacher-check-btn', 'Check my understanding',
      'A few short questions, then your teacher helps with anything you missed');
    endBtn.addEventListener('click', function () { go('check', null, endBtn); });
    end.appendChild(endLabel);
    end.appendChild(endBtn);
    container.appendChild(end);

    // Mark complete — at the top beside Study with a Teacher and at the
    // end beside Check my understanding, kept in step with each other. Shown
    // only when the reader may change it (their own study, or their own fresh
    // draft, which is saved first).
    var comp = opts.completion;
    if (comp && comp.canChange) {
      var state = { completedAt: comp.completedAt || null, busy: false };
      var spots = [];
      var renderAll = function () {
        spots.forEach(function (el) { renderCompletion(el, state.completedAt, toggle); });
      };
      var toggle = function (completed, btn) {
        if (state.busy) return;
        withId(btn, function (id) {
          state.busy = true;
          spots.forEach(function (el) { el.querySelectorAll('button').forEach(function (b) { b.disabled = true; }); });
          setCompletion(id, completed)
            .then(function (at) {
              state.completedAt = at;
              if (typeof opts.onCompletionChange === 'function') opts.onCompletionChange(at, id);
            })
            .catch(function (err) {
              if (typeof global.showAlert === 'function') global.showAlert(err.message || 'Could not update this study. Please try again.');
            })
            .then(function () { state.busy = false; renderAll(); });
        });
      };
      var topSpot = document.createElement('div');
      topSpot.className = 'teacher-entry-choice study-complete';
      top.appendChild(topSpot);
      var endSpot = document.createElement('span');
      endSpot.className = 'study-complete study-complete-end';
      end.appendChild(endSpot);
      spots.push(topSpot, endSpot);
      renderAll();
    }
  }

  global.IronInkTeacher = {
    attach:              attach,
    remove:              remove,
    sectionHeadings:     sectionHeadings,
    teachableHeadings:   teachableHeadings,
    setCompletion:       setCompletion,
    formatCompletedDate: formatCompletedDate,
  };

}(window));
