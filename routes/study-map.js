const express = require('express');
const fs      = require('fs');
const path    = require('path');
const { requireAuth, renderLayout } = require('./layout');
const { escapeHtml } = require('../lib/html');
const {
  AREAS, BOOKS, OT_COUNT, getMap, groupStudies, displayPassage, pickRevisit, dismissRevisit,
} = require('../lib/study-map');

// ─── Study Map ────────────────────────────────────────────────────────────────
// A private look-back of the member's own study history: by area of theology,
// by book of the Bible, and month by month. For finding past studies and
// studying them again — NOT a progress score: no points, badges, streaks,
// percentages or comparisons, and nothing about any other member.
//
// Everything is read from the member's own records only (studies.json filtered
// by userId; their own Tutor/Teacher sessions) and rendered server-side with
// every member-supplied string escaped. Tags come from lib/study-map.js (stored
// at generation or by the backfill; worked out on the spot for an untagged study).

const router = express.Router();

const STUDIES_PATH  = path.join(__dirname, '../data/studies.json');
const SESSIONS_PATH = path.join(__dirname, '../data/teacher-sessions.json');
const USERS_PATH    = path.join(__dirname, '../data/users.json');

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { return fallback; }
}
function readUsers() { return JSON.parse(fs.readFileSync(USERS_PATH, 'utf8')); }
function writeUsers(u) { fs.writeFileSync(USERS_PATH, JSON.stringify(u, null, 2)); }

// The member's Tutor/Teacher sessions on their OWN studies: studyId →
// { tutor: updatedAt, teacher: updatedAt }. (Sessions saved before the
// Tutor/Teacher split carry no kind and are tutor sessions.)
function sessionsByStudy(userId) {
  const out = {};
  const list = readJson(SESSIONS_PATH, []);
  (Array.isArray(list) ? list : []).forEach(s => {
    if (!s || s.userId !== userId || typeof s.studyId !== 'string') return;
    const kind = s.kind === 'teacher' ? 'teacher' : 'tutor';
    const hasTurn = (s.messages || []).some(m => m && !m.hidden && m.role === 'user');
    if (!hasTurn) return;
    const e = out[s.studyId] || (out[s.studyId] = {});
    if (!e[kind] || Date.parse(s.updatedAt) > Date.parse(e[kind])) e[kind] = s.updatedAt || null;
  });
  return out;
}

// The member's studies, newest first, each with its map and session markers.
function memberEntries(userId) {
  const sessions = sessionsByStudy(userId);
  const studies = readJson(STUDIES_PATH, []);
  return (Array.isArray(studies) ? studies : [])
    .filter(s => s && s.userId === userId && s.id)
    .sort((a, b) => (Date.parse(b.savedAt || b.createdAt) || 0) - (Date.parse(a.savedAt || a.createdAt) || 0))
    .map(s => ({
      id:       s.id,
      topic:    String(s.topic || 'Untitled study'),
      savedAt:  s.savedAt || s.createdAt || null,
      map:      getMap(s),
      sessions: sessions[s.id] || {},
    }));
}

function revisitPrefs(userId) {
  const u = readJson(USERS_PATH, []).find(x => x && x.id === userId);
  return (u && u.studyMapRevisit) || {};
}

// ── Formatting ────────────────────────────────────────────────────────────────
const TZ = 'America/Denver';
function fmtDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: TZ });
}
function fmtMonth(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return 'Undated';
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: TZ });
}
function monthKey(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '0000-00';
  const parts = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', timeZone: TZ }).formatToParts(d);
  const y = parts.find(p => p.type === 'year').value;
  const m = parts.find(p => p.type === 'month').value;
  return y + '-' + m;
}
// Area names read mid-sentence ("the Holy Spirit"); as a heading or chip, capitalized.
function areaLabel(a) { return a.charAt(0).toUpperCase() + a.slice(1); }
function bookSlug(b) { return 'book-' + b.toLowerCase().replace(/[^a-z0-9]+/g, '-'); }
function areaSlug(a) { return 'area-' + a.toLowerCase().replace(/[^a-z0-9]+/g, '-'); }

function openHref(e)  { return '/library?open=' + encodeURIComponent(e.id); }
function checkHref(e) { return '/teacher/' + encodeURIComponent(e.id) + '?mode=check'; }

// Quiet markers for the member's own Tutor/Teacher sessions on a study.
function markersHtml(e) {
  const out = [];
  if (e.sessions.tutor) {
    out.push(`<span class="sm-marker" title="${escapeHtml('Tutor session — last ' + fmtDate(e.sessions.tutor))}">Tutor</span>`);
  }
  if (e.sessions.teacher) {
    out.push(`<span class="sm-marker" title="${escapeHtml('Teacher session — last ' + fmtDate(e.sessions.teacher))}">Teacher</span>`);
  }
  return out.join('');
}

function entryHtml(e, opts) {
  const o = opts || {};
  const passages = o.showPassages && e.map.passages.length
    ? `<span class="sm-entry-passages">${e.map.passages.map(p => escapeHtml(displayPassage(p))).join(' &#183; ')}</span>`
    : '';
  return `
        <li class="sm-entry">
          <div class="sm-entry-main">
            <a class="sm-entry-title" href="${escapeHtml(openHref(e))}">${escapeHtml(e.topic)}</a>
            <span class="sm-entry-date">${escapeHtml(fmtDate(e.savedAt))}</span>
            ${markersHtml(e)}
            ${passages}
          </div>
          <div class="sm-entry-actions">
            <a href="${escapeHtml(openHref(e))}">Open</a>
            <span class="sm-sep" aria-hidden="true">&#183;</span>
            <a href="${escapeHtml(checkHref(e))}">Check my understanding</a>
          </div>
        </li>`;
}

// Studies on the same topic become one topic with several entries: matching
// subjects AND a shared area or overlapping passages (groupStudies in
// lib/study-map.js). Groups keep the newest-first order of their newest study;
// a topic is named by the subject of its most recent study.
function groupsHtml(entries, opts) {
  return groupStudies(entries).map(g => {
    if (g.entries.length === 1) return `<ul class="sm-entries">${entryHtml(g.entries[0], opts)}</ul>`;
    return `
      <div class="sm-group">
        <div class="sm-group-title">${escapeHtml(g.subject)}</div>
        <ul class="sm-entries">${g.entries.map(e => entryHtml(e, opts)).join('')}</ul>
      </div>`;
  }).join('');
}

function planHref(area) { return '/study?plan=' + encodeURIComponent(area); }

// ── The three views ───────────────────────────────────────────────────────────
function areasView(entries) {
  const sections = AREAS.map(area => {
    const inArea = entries.filter(e => e.map.areas.includes(area));
    const body = inArea.length
      ? groupsHtml(inArea)
      : `<p class="sm-empty">Not studied yet. <a href="${escapeHtml(planHref(area))}">Plan a study</a></p>`;
    return `
      <section class="sm-area${inArea.length ? '' : ' sm-area--empty'}" id="${areaSlug(area)}">
        <h3 class="sm-area-title">${escapeHtml(areaLabel(area))}</h3>
        ${body}
      </section>`;
  }).join('');
  const unsorted = entries.filter(e => !e.map.areas.length);
  const unsortedHtml = unsorted.length ? `
      <section class="sm-area" id="area-unsorted">
        <h3 class="sm-area-title">Not yet sorted</h3>
        ${groupsHtml(unsorted)}
      </section>` : '';
  return sections + unsortedHtml;
}

function booksView(entries) {
  const byBook = {};
  entries.forEach(e => e.map.books.forEach(b => { (byBook[b] || (byBook[b] = [])).push(e); }));

  const tile = b => byBook[b]
    ? `<a class="sm-book-tile is-studied" href="#${bookSlug(b)}" title="${escapeHtml(b + ' — studied')}">${escapeHtml(b)}</a>`
    : `<span class="sm-book-tile" title="${escapeHtml(b + ' — not studied yet')}">${escapeHtml(b)}</span>`;

  const grid = `
      <div class="sm-books-grid">
        <div class="sm-testament">
          <h3 class="sm-testament-title">Old Testament</h3>
          <div class="sm-book-tiles">${BOOKS.slice(0, OT_COUNT).map(tile).join('')}</div>
        </div>
        <div class="sm-testament">
          <h3 class="sm-testament-title">New Testament</h3>
          <div class="sm-book-tiles">${BOOKS.slice(OT_COUNT).map(tile).join('')}</div>
        </div>
      </div>`;

  const studied = BOOKS.filter(b => byBook[b]);
  const details = studied.length
    ? studied.map(b => {
        const passages = [];
        byBook[b].forEach(e => e.map.passages.forEach(p => {
          if ((p === b || p.startsWith(b + ' ')) && !passages.includes(p)) passages.push(p);
        }));
        const named = passages.filter(p => p !== b);
        return `
      <section class="sm-book" id="${bookSlug(b)}">
        <h3 class="sm-book-title">${escapeHtml(b)}</h3>
        ${named.length ? `<p class="sm-book-passages">${named.map(p => escapeHtml(displayPassage(p))).join(' &#183; ')}</p>` : ''}
        ${groupsHtml(byBook[b], { showPassages: true })}
      </section>`;
      }).join('')
    : '<p class="sm-empty">None of your studies centers on a particular book yet. Studies of a passage or a book appear here.</p>';

  return grid + `<div class="sm-book-details">${details}</div>`;
}

function timelineView(entries) {
  const months = [];
  const byMonth = {};
  entries.forEach(e => {
    const k = monthKey(e.savedAt);
    if (!byMonth[k]) { byMonth[k] = { label: fmtMonth(e.savedAt), entries: [] }; months.push(k); }
    byMonth[k].entries.push(e);
  });
  return months.map(k => `
      <section class="sm-month">
        <h3 class="sm-month-title">${escapeHtml(byMonth[k].label)}</h3>
        <ul class="sm-entries">${byMonth[k].entries.map(e => entryHtml(e)).join('')}</ul>
      </section>`).join('');
}

// One Revisit suggestion (or ''): "Open" and "Check my understanding with the
// Tutor", plus "Not now" (public/js/study-map.js posts the dismissal).
function revisitHtml(entry, compact) {
  if (!entry) return '';
  return `
    <div class="sm-revisit${compact ? ' sm-revisit--compact' : ''}" data-study-id="${escapeHtml(entry.id)}">
      <div class="sm-revisit-label">Worth revisiting</div>
      <div class="sm-revisit-title">${escapeHtml(entry.topic)}</div>
      <div class="sm-revisit-sub">You studied this in ${escapeHtml(fmtMonth(entry.savedAt))}.</div>
      <div class="sm-revisit-actions">
        <a class="sm-revisit-btn" href="${escapeHtml(openHref(entry))}">Open</a>
        <a class="sm-revisit-btn" href="${escapeHtml(checkHref(entry))}">Check my understanding with the Tutor</a>
        <button type="button" class="sm-revisit-dismiss" title="Hide this suggestion">Not now</button>
      </div>
    </div>`;
}

// ─── GET /study-map ───────────────────────────────────────────────────────────
router.get('/study-map', requireAuth, (req, res) => {
  const entries = memberEntries(req.session.userId);
  const revisit = pickRevisit(entries, revisitPrefs(req.session.userId));

  const body = entries.length ? `
    ${revisitHtml(revisit, false)}

    <div class="lib-tabs sm-tabs" role="tablist" aria-label="Study Map views">
      <button type="button" class="lib-tab active" role="tab" data-view="areas" aria-selected="true">By area</button>
      <button type="button" class="lib-tab" role="tab" data-view="books" aria-selected="false">By book</button>
      <button type="button" class="lib-tab" role="tab" data-view="timeline" aria-selected="false">Timeline</button>
    </div>

    <div class="sm-view" id="smViewAreas" data-view="areas">${areasView(entries)}</div>
    <div class="sm-view" id="smViewBooks" data-view="books" hidden>${booksView(entries)}</div>
    <div class="sm-view" id="smViewTimeline" data-view="timeline" hidden>${timelineView(entries)}</div>`
    : `
    <div class="sm-empty-state">
      <p>Your Study Map fills in as you save studies to your Library.</p>
      <p><a class="btn-warm" href="/study">Start a study</a></p>
    </div>`;

  const content = `
    <div class="page-header">
      <h2 class="page-title">Study Map</h2>
      <p class="page-subtitle">Everything you have studied, in one place &#8212; to find a past study and study it again. Only you can see this page.</p>
    </div>
    <div class="study-map">${body}</div>`;

  res.send(renderLayout({
    req,
    activeSection: 'study-map',
    title: 'Study Map',
    content,
    scripts: '<script src="/js/study-map.js?v=1"></script>',
  }));
});

// ─── GET /api/study-map/index ─────────────────────────────────────────────────
// The member's own studies in brief, for the Study page's "you've studied this"
// notice (public/js/study.js). Titles and subjects only — no study text.
router.get('/api/study-map/index', requireAuth, (req, res) => {
  const studies = memberEntries(req.session.userId).map(e => ({
    id:      e.id,
    topic:   e.topic,
    subject: e.map.subject,
    savedAt: e.savedAt,
  }));
  res.json({ success: true, studies });
});

// ─── POST /api/study-map/revisit/dismiss ──────────────────────────────────────
// "Not now" on a Revisit suggestion. Only the member's own study ids are accepted.
router.post('/api/study-map/revisit/dismiss', requireAuth, (req, res) => {
  const studyId = req.body && req.body.studyId;
  if (typeof studyId !== 'string' || !studyId || studyId.length > 100) {
    return res.status(400).json({ success: false, error: 'Missing study.' });
  }
  const owns = readJson(STUDIES_PATH, []).some(s => s && s.id === studyId && s.userId === req.session.userId);
  if (!owns) return res.status(404).json({ success: false, error: 'Study not found.' });
  try {
    const users = readUsers();
    const idx = users.findIndex(u => u.id === req.session.userId);
    if (idx === -1) return res.status(404).json({ success: false, error: 'Account not found.' });
    dismissRevisit(users[idx], studyId);
    writeUsers(users);
    res.json({ success: true });
  } catch (err) {
    console.error('[study-map] dismiss failed:', err.message);
    res.status(500).json({ success: false, error: 'Could not save that. Please try again.' });
  }
});

// ─── Dashboard snapshot ───────────────────────────────────────────────────────
// Replaces the old "Studies Saved" count: the 3 most recent studies, which areas
// have been studied (filled vs. open — no numbers), and one Revisit suggestion.
function renderDashboardSnapshot(userId) {
  let entries = [];
  try { entries = memberEntries(userId); } catch (err) { console.error('[study-map] snapshot:', err.message); }
  const covered = new Set();
  entries.forEach(e => e.map.areas.forEach(a => covered.add(a)));
  const revisit = pickRevisit(entries, revisitPrefs(userId));

  const recent = entries.length
    ? `<ul class="sm-snap-recent">${entries.slice(0, 3).map(e => `
          <li><a href="${escapeHtml(openHref(e))}">${escapeHtml(e.topic)}</a> <span class="sm-snap-date">${escapeHtml(fmtDate(e.savedAt))}</span></li>`).join('')}
        </ul>`
    : '<p class="sm-snap-empty">No studies yet &#8212; <a href="/study">start one</a>.</p>';

  const areas = `
        <ul class="sm-snap-areas" aria-label="Areas of theology you have studied">
          ${AREAS.map(a => covered.has(a)
            ? `<li class="sm-snap-area is-covered"><a href="/study-map#${areaSlug(a)}" title="${escapeHtml(areaLabel(a) + ' — studied')}">${escapeHtml(areaLabel(a))}</a></li>`
            : `<li class="sm-snap-area" title="${escapeHtml(areaLabel(a) + ' — not studied yet')}">${escapeHtml(areaLabel(a))}</li>`).join('')}
        </ul>`;

  return `
      <div class="stat-card sm-snap">
        <div class="sm-snap-head">
          <a class="stat-label sm-snap-heading" href="/study-map">Study Map</a>
          <a class="sm-snap-link" href="/study-map">Open your Study Map &#8594;</a>
        </div>
        <div class="sm-snap-sub">Most recent</div>
        ${recent}
        <div class="sm-snap-sub">Areas you have studied</div>
        ${areas}
        ${revisitHtml(revisit, true)}
      </div>`;
}

module.exports = { router, renderDashboardSnapshot, memberEntries };
