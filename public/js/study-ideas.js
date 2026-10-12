(function () {
  'use strict';

  // Study Ideas — the member's private list of studies to do later, in a
  // collapsible panel beside Plan a Study on /study. Stored on the server
  // (routes/study-ideas.js) so the list follows the member across devices.
  //
  // Each idea can be:
  //   Plan it  — opens Plan a Study with the idea waiting in the box
  //              (study-planner.js's window.__ironStudyPlanner.prefill; never sent)
  //   Build it — fills the study creator (study.js's window.__ironStudyCreator.fill)
  //              with the title and any saved type/level; the member can change
  //              them before clicking Generate Study
  //   Edit / Delete
  //
  // A built idea comes off the list once its study is generated: study.js fires
  // 'ironink:study-generated' with the subject it generated, and if that is
  // still the idea's title (the member didn't retype it) the idea is removed —
  // with an Undo, in case the member dismisses the study without saving it.
  //
  // Everything member-written goes into the page via textContent only.

  var OPEN_KEY = 'ironink_study_ideas_open';

  function init() {
    var toggleBtn  = document.getElementById('ideasToggleBtn');
    var panel      = document.getElementById('ideasPanel');
    var closeBtn   = document.getElementById('ideasCloseBtn');
    var form       = document.getElementById('ideasForm');
    var titleIn    = document.getElementById('ideaTitleInput');
    var notesIn    = document.getElementById('ideaNotesInput');
    var typeSel    = document.getElementById('ideaTypeSelect');
    var levelSel   = document.getElementById('ideaLevelSelect');
    var levelField = document.getElementById('ideaLevelField');
    var saveBtn    = document.getElementById('ideaSaveBtn');
    var cancelBtn  = document.getElementById('ideaCancelEditBtn');
    var formErr    = document.getElementById('ideasFormError');
    var statusEl   = document.getElementById('ideasStatus');
    var listEl     = document.getElementById('ideasList');
    if (!toggleBtn || !panel || !form || !listEl) return;

    var BOOT   = window.STUDY_IDEAS_BOOT || {};
    var TYPES  = Array.isArray(BOOT.types) ? BOOT.types : [];
    var LEVELS = Array.isArray(BOOT.levels) ? BOOT.levels : [];

    var ideas      = [];
    var loaded     = false;
    var loading    = false;
    var editingId  = null;
    var busy       = false;
    var pending    = null;   // { idea, topic } — the idea last built into the creator

    function typeOf(key)  { return TYPES.filter(function (t) { return t.key === key; })[0] || null; }
    function levelOf(key) { return LEVELS.filter(function (l) { return l.key === key; })[0] || null; }

    // ── Form options (from lib/study-types.js, via STUDY_IDEAS_BOOT) ─────────
    function fillSelect(sel, list, anyLabel) {
      sel.innerHTML = '';
      var any = document.createElement('option');
      any.value = '';
      any.textContent = anyLabel;
      sel.appendChild(any);
      list.forEach(function (o) {
        var opt = document.createElement('option');
        opt.value = o.key;
        opt.textContent = o.label;
        sel.appendChild(opt);
      });
    }
    fillSelect(typeSel, TYPES, 'Any type');
    fillSelect(levelSel, LEVELS, 'Any level');

    // A type with no depth dial (Explore) takes no level.
    function syncLevelField() {
      var t = typeOf(typeSel.value);
      var hide = !!(t && t.noLevel);
      levelField.hidden = hide;
      if (hide) levelSel.value = '';
    }
    typeSel.addEventListener('change', syncLevelField);

    // ── Requests ───────────────────────────────────────────────────────────
    function request(method, url, body) {
      var opts = { method: method, headers: {} };
      if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
      return fetch(url, opts).then(function (r) {
        return r.json().catch(function () { return null; }).then(function (data) {
          if (!data || !data.success) throw new Error((data && data.error) || 'Something went wrong. Please try again.');
          return data;
        });
      });
    }

    function load() {
      if (loading) return;
      loading = true;
      if (!loaded) renderMessage('Loading…');
      request('GET', '/api/study-ideas')
        .then(function (data) { ideas = data.ideas || []; loaded = true; render(); })
        .catch(function () { if (!loaded) renderMessage('Your Study Ideas couldn’t be loaded. Please refresh the page.'); })
        .then(function () { loading = false; });
    }

    // ── Status line (Build / removal / Undo) ───────────────────────────────
    function setStatus(text, action) {
      statusEl.innerHTML = '';
      if (!text) { statusEl.hidden = true; return; }
      var span = document.createElement('span');
      span.textContent = text;
      statusEl.appendChild(span);
      if (action) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'ideas-status-btn';
        b.textContent = action.label;
        b.addEventListener('click', action.run);
        statusEl.appendChild(b);
      }
      statusEl.hidden = false;
    }

    function showFormError(text) {
      formErr.textContent = text || '';
      formErr.hidden = !text;
    }

    // ── List ───────────────────────────────────────────────────────────────
    function renderMessage(text) {
      listEl.innerHTML = '';
      var li = document.createElement('li');
      li.className = 'ideas-empty';
      li.textContent = text;
      listEl.appendChild(li);
    }

    function actionBtn(label, cls, title, onClick) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = cls;
      b.textContent = label;
      if (title) b.title = title;
      b.addEventListener('click', onClick);
      return b;
    }

    function render() {
      if (!ideas.length) {
        renderMessage('No ideas yet. Add a study you’d like to do later — a passage, a person, a question — and it will wait here for you.');
        return;
      }
      listEl.innerHTML = '';
      ideas.forEach(function (idea) {
        var li = document.createElement('li');
        li.className = 'ideas-item' + (idea.id === editingId ? ' is-editing' : '');

        var title = document.createElement('div');
        title.className = 'ideas-item-title';
        title.textContent = idea.title;
        li.appendChild(title);

        var t = typeOf(idea.type), l = levelOf(idea.level);
        var meta = [];
        if (t) meta.push(t.label);
        if (l) meta.push(l.label);
        if (idea.source === 'library') meta.push('Saved from your Library');
        if (idea.subject) meta.push('Subject: ' + idea.subject);
        if (meta.length) {
          var m = document.createElement('div');
          m.className = 'ideas-item-meta';
          m.textContent = meta.join(' · ');
          li.appendChild(m);
        }

        if (idea.notes) {
          var n = document.createElement('div');
          n.className = 'ideas-item-notes';
          n.textContent = idea.notes;
          li.appendChild(n);
        }

        var acts = document.createElement('div');
        acts.className = 'ideas-item-actions';
        acts.appendChild(actionBtn('Plan it', 'ideas-act ideas-act--plan', 'Talk this idea through in Plan a Study', function () { planIt(idea); }));
        acts.appendChild(actionBtn('Build it', 'ideas-act ideas-act--build', 'Fill in the study creator with this idea', function () { buildIt(idea); }));
        acts.appendChild(actionBtn('Edit', 'ideas-act', null, function () { startEdit(idea); }));
        acts.appendChild(actionBtn('Delete', 'ideas-act ideas-act--del', null, function () { confirmDelete(idea); }));
        li.appendChild(acts);

        listEl.appendChild(li);
      });
    }

    // ── Add / edit ─────────────────────────────────────────────────────────
    function resetForm() {
      editingId = null;
      form.reset();
      typeSel.value = '';
      levelSel.value = '';
      syncLevelField();
      saveBtn.textContent = 'Add idea';
      cancelBtn.hidden = true;
      showFormError('');
    }

    function startEdit(idea) {
      editingId = idea.id;
      titleIn.value = idea.title;
      notesIn.value = idea.notes || '';
      typeSel.value = typeOf(idea.type) ? idea.type : '';
      syncLevelField();
      levelSel.value = levelOf(idea.level) && !levelField.hidden ? idea.level : '';
      saveBtn.textContent = 'Save changes';
      cancelBtn.hidden = false;
      showFormError('');
      render();
      if (form.scrollIntoView) form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      try { titleIn.focus({ preventScroll: true }); } catch (e) { titleIn.focus(); }
    }

    cancelBtn.addEventListener('click', function () { resetForm(); render(); });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (busy) return;
      var title = titleIn.value.replace(/\s+/g, ' ').trim();
      if (!title) { showFormError('Give your idea a title.'); titleIn.focus(); return; }
      var body = {
        title: title,
        notes: notesIn.value,
        type:  typeSel.value || null,
        level: levelField.hidden ? null : (levelSel.value || null),
      };
      busy = true;
      saveBtn.disabled = true;
      showFormError('');
      var wasEditing = editingId;
      var req = wasEditing
        ? request('PUT', '/api/study-ideas/' + encodeURIComponent(wasEditing), body)
        : request('POST', '/api/study-ideas', body);
      req.then(function (data) {
        if (wasEditing) {
          ideas = ideas.map(function (i) { return i.id === wasEditing ? data.idea : i; });
        } else if (!data.existing) {
          ideas.unshift(data.idea);
        }
        resetForm();
        render();
        notifyPlanner();
        if (data.existing && !wasEditing) setStatus('“' + data.idea.title + '” is already in your Study Ideas.');
        try { titleIn.focus({ preventScroll: true }); } catch (e2) {}
      }).catch(function (err) {
        showFormError(err.message);
      }).then(function () {
        busy = false;
        saveBtn.disabled = false;
      });
    });

    // Plan a Study shows "✓ Saved to Ideas" on planned studies already here;
    // after an add, edit or delete it re-checks (study-planner.js).
    function notifyPlanner() {
      var planner = window.__ironStudyPlanner;
      if (planner && typeof planner.ideasChanged === 'function') planner.ideasChanged();
    }

    // ── Delete ─────────────────────────────────────────────────────────────
    function removeIdea(idea) {
      return request('DELETE', '/api/study-ideas/' + encodeURIComponent(idea.id)).then(function () {
        ideas = ideas.filter(function (i) { return i.id !== idea.id; });
        if (editingId === idea.id) resetForm();
        if (pending && pending.idea.id === idea.id) pending = null;
        render();
        notifyPlanner();
      });
    }

    function confirmDelete(idea) {
      var doDelete = function () {
        removeIdea(idea).catch(function (err) { setStatus(err.message); });
      };
      var msg = 'Delete the idea “' + idea.title + '”? This cannot be undone.';
      if (typeof window.showConfirm === 'function') window.showConfirm(msg, 'Delete', doDelete, function () {});
      else if (window.confirm(msg)) doDelete();
    }

    // ── Plan it ────────────────────────────────────────────────────────────
    function planIt(idea) {
      var planner = window.__ironStudyPlanner;
      var t = typeOf(idea.type), l = levelOf(idea.level);
      var text = 'I’d like to plan a study from one of my Study Ideas: “' + idea.title + '”.';
      if (t || l) {
        text += ' I was thinking of ' + (t ? 'a ' + t.label + ' study' : 'a study') + (l ? ' at the ' + l.label + ' level' : '') + '.';
      }
      if (idea.notes) text += '\n\nMy notes: ' + idea.notes;
      if (!planner || !planner.prefill(text)) {
        setStatus('Plan a Study couldn’t be opened. Please refresh the page and try again.');
        return;
      }
      setStatus('');
    }

    // ── Build it ───────────────────────────────────────────────────────────
    function buildIt(idea) {
      var creator = window.__ironStudyCreator;
      var plan = {
        type:    typeOf(idea.type) ? idea.type : null,
        level:   levelOf(idea.level) ? idea.level : null,
        subject: idea.title,
      };
      if (!creator || !creator.fill(plan)) {
        setStatus('The study creator couldn’t be filled in. Please refresh the page and try again.');
        return;
      }
      var topicInput = document.getElementById('topicInput');
      pending = { idea: idea, topic: topicInput ? topicInput.value.trim() : idea.title };
      setStatus('Filled in the study creator with “' + idea.title + '”. Change the type or level if you like, then click Generate Study. Once the study is generated, this idea comes off your list.');

      var gen = document.getElementById('generateBtn');
      var creatorEl = document.getElementById('studyCreator');
      if (creatorEl && creatorEl.scrollIntoView) creatorEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      if (gen) { try { gen.focus({ preventScroll: true }); } catch (e) { gen.focus(); } }
    }

    // A study was generated (study.js). Only the subject the idea filled in
    // counts — if the member retyped it, it's a different study and the idea stays.
    document.addEventListener('ironink:study-generated', function (e) {
      var topic = e && e.detail && typeof e.detail.topic === 'string' ? e.detail.topic.trim() : '';
      if (!pending || !topic || topic !== pending.topic) return;
      var idea = pending.idea;
      pending = null;
      removeIdea(idea).then(function () {
        setStatus('“' + idea.title + '” was generated, so it’s off your Study Ideas.', {
          label: 'Undo',
          run: function () { restoreIdea(idea); },
        });
      }).catch(function () { /* still listed — the member can delete it */ });
    });

    function restoreIdea(idea) {
      request('POST', '/api/study-ideas', { title: idea.title, notes: idea.notes, type: idea.type, level: idea.level })
        .then(function (data) {
          if (!data.existing) ideas.unshift(data.idea);
          render();
          notifyPlanner();
          setStatus('“' + idea.title + '” is back in your Study Ideas.');
        })
        .catch(function (err) { setStatus(err.message); });
    }

    // ── Open / close ───────────────────────────────────────────────────────
    function setOpen(open, focus) {
      panel.hidden = !open;
      toggleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggleBtn.classList.toggle('is-active', !!open);
      try {
        if (open) localStorage.setItem(OPEN_KEY, '1');
        else localStorage.removeItem(OPEN_KEY);
      } catch (e) {}
      if (open) {
        if (!loaded) load();
        if (focus) {
          if (panel.scrollIntoView) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          try { titleIn.focus({ preventScroll: true }); } catch (e) { titleIn.focus(); }
        }
      }
    }

    // For Plan a Study's "Save to Ideas" / "Start fresh" (study-planner.js):
    // ideas were added elsewhere on the page — reload the list if it's showing,
    // otherwise on the next open.
    window.__ironStudyIdeas = {
      refresh: function () {
        if (!panel.hidden) load();
        else loaded = false;
      },
    };

    toggleBtn.addEventListener('click', function () { setOpen(panel.hidden, true); });
    closeBtn.addEventListener('click', function () { setOpen(false); toggleBtn.focus(); });

    // ── Boot ───────────────────────────────────────────────────────────────
    syncLevelField();
    // ?ideas=1 — the Study Map's "Study Ideas" link. Opens the panel; the
    // parameter is dropped so a refresh doesn't keep re-opening it.
    var fromLink = false;
    try { fromLink = new URLSearchParams(window.location.search).get('ideas') === '1'; } catch (e) {}
    if (fromLink) {
      try {
        var u = new URL(window.location.href);
        u.searchParams.delete('ideas');
        window.history.replaceState(null, '', u.pathname + u.search + u.hash);
      } catch (e) {}
      setOpen(true, true);
    } else {
      var wasOpen = false;
      try { wasOpen = localStorage.getItem(OPEN_KEY) === '1'; } catch (e) {}
      if (wasOpen) setOpen(true, false);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
