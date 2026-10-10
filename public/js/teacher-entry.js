(function (global) {
  'use strict';

  // Shared "Study with a Teacher" entry points. Single source of truth for every
  // place a study is read: the study page (study.js), the Library inline view
  // (library.js) and shared Community studies (community.js). Each caller renders
  // the study as usual, then calls IronInkTeacher.attach(container, opts):
  //
  //   • a "Study with a Teacher" button at the top of the study
  //   • a small "Teach me this section" button beside each section heading
  //   • a "Check my understanding" button at the end of the study
  //
  // Every button navigates to /teacher/<studyId>?mode=…&section=N. Sections are
  // the study's "## " headings, numbered from 1 in document order — the same rule
  // routes/teacher.js uses, so the numbers agree.
  //
  // Elements are built with createElement + textContent (never innerHTML). All of
  // them carry .teacher-entry so the notepad's text walker skips them and print
  // CSS hides them. attach() is idempotent: it removes its own earlier buttons
  // first, so re-rendering a study never duplicates them.
  //
  // opts.studyId   — the study's id, when it already has one
  // opts.resolveId — function (cb) for a study that must be saved first (the
  //                  fresh draft on the study page); calls cb(err, id)

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

  function remove(container) {
    if (!container) return;
    container.querySelectorAll('.teacher-entry').forEach(function (el) { el.remove(); });
  }

  function attach(container, opts) {
    if (!container) return;
    opts = opts || {};
    remove(container);

    function go(mode, section, btn) {
      if (opts.studyId) { window.location.href = teacherUrl(opts.studyId, mode, section); return; }
      if (typeof opts.resolveId !== 'function') return;
      if (btn) btn.disabled = true;
      opts.resolveId(function (err, id) {
        if (btn) btn.disabled = false;
        if (err || !id) {
          if (typeof global.showAlert === 'function') global.showAlert('The study needs to be saved to your Library first. Please try again.');
          return;
        }
        window.location.href = teacherUrl(id, mode, section);
      });
    }

    // Top: teach the whole study from the beginning.
    var top = document.createElement('div');
    top.className = 'teacher-entry teacher-entry-top';
    var topBtn = makeButton('teacher-start-btn', 'Study with a Teacher',
      'A patient teacher walks you through this study, one question at a time');
    var topNote = document.createElement('span');
    topNote.className = 'teacher-entry-note';
    topNote.textContent = 'One question at a time — “I don’t know” is a great answer.';
    top.appendChild(topBtn);
    top.appendChild(topNote);
    topBtn.addEventListener('click', function () { go('full', null, topBtn); });
    container.insertBefore(top, container.firstChild);

    // Beside each section heading: start the teacher at that section.
    sectionHeadings(container).forEach(function (h, i) {
      if (!isTeachable(h)) return;
      var n = i + 1;
      var btn = makeButton('teacher-section-btn', 'Teach me this section',
        'Start the teacher at “' + (h.textContent || '').trim() + '”');
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
      'A few short questions, then the teacher helps with anything you missed');
    endBtn.addEventListener('click', function () { go('check', null, endBtn); });
    end.appendChild(endLabel);
    end.appendChild(endBtn);
    container.appendChild(end);
  }

  global.IronInkTeacher = {
    attach:          attach,
    remove:          remove,
    sectionHeadings: sectionHeadings,
  };

}(window));
