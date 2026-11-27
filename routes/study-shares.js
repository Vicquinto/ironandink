const express = require('express');
const { randomUUID } = require('crypto');
const rateLimit = require('express-rate-limit');
const { requireAuth, renderLayout } = require('./layout');
const { escapeHtml, inlineJson } = require('../lib/html');
const teacher = require('./teacher');
const notesPage = require('./study-notes');
const shares = require('../lib/study-shares');
const messages = require('./messages');
const { sharesStore, cleanParts, isActive, takeNewShare, shareForRecipient, shareUrl, ownerShares, readUsers, readStudies, PARTS, PER_STUDY } = shares;

// ─── Study Notes shared with a member ─────────────────────────────────────────
// Owner: share their Study Notes for one of THEIR OWN studies with another member,
// choose what is shared, change it, stop sharing (lib/study-shares.js).
// Recipient: read only. The shared page, its teaching (only while ticked), the
// study's text (read only) and the "Shared with me" list. Every recipient route
// looks the share up by id AND the session's userId (shareForRecipient) and then
// reads the OWNER's records with the owner's id from the share record. Nothing
// here writes to the owner's notes, sessions or study, and no other route in the
// app treats a share as access to anything.

const router = express.Router();

const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max:      30,
  message:  { success: false, error: 'Too many requests. Please wait a moment and try again.' },
  standardHeaders: true,
  legacyHeaders:   false,
});
function gate(req, res, next) {
  if (teacher.memberGated(req)) return res.status(402).json({ success: false, error: 'member_feature', upgradeUrl: '/pricing' });
  next();
}
const UNAVAILABLE = 'Sharing is unavailable right now. Nothing was changed. Please try again later.';
function unavailable(res) { return res.status(500).json({ success: false, error: UNAVAILABLE }); }

// The member's own study, or null.
function ownStudy(userId, studyId) {
  let studies;
  try { studies = readStudies(); } catch { return null; }
  const s = studies.find(x => x && x.id === studyId);
  return s && s.userId === userId ? s : null;
}

// The Message a new share sends (fixed wording; the link goes under it).
function shareMessage(topic) {
  return 'I’ve shared my Study Notes on “' + String(topic || 'a study').trim() + '” with you. You can read them here:\n' +
    '(They’re read-only. I can stop sharing at any time.)';
}

// One page for every "no": never says whose, or what, or why.
function notShared(req, res) {
  notesPage.messagePage(req, res, 404, 'These Study Notes are no longer shared with you.');
}
// Looks up the recipient's share; answers the request itself (and returns null)
// when there isn't one or the store can't be read.
function recipientShare(req, res, json) {
  let got;
  try { got = shareForRecipient(req.params.shareId, req.session.userId); }
  catch {
    if (json) { unavailable(res); return null; }
    notesPage.messagePage(req, res, 500, 'Shared Study Notes are unavailable right now. Please try again later.');
    return null;
  }
  if (!got) {
    if (json) res.status(404).json({ success: false, error: 'These Study Notes are no longer shared with you.' });
    else notShared(req, res);
    return null;
  }
  return got;
}

// ═══ Owner ═══════════════════════════════════════════════════════════════════

// ─── GET /api/study-shares/members ────────────────────────────────────────────
// Who the owner can share with: active members other than themselves, by name.
router.get('/api/study-shares/members', requireAuth, gate, (req, res) => {
  let users;
  try { users = readUsers(); } catch { return unavailable(res); }
  const members = users
    .filter(u => u && u.id !== req.session.userId && u.fullName && isActive(u))
    .map(u => ({ id: u.id, fullName: u.fullName }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
  res.json({ success: true, members });
});

// ═══ Recipient: "Shared with me" (declared before the /:studyId routes) ══════

// ─── GET /api/study-shares/with-me ────────────────────────────────────────────
router.get('/api/study-shares/with-me', requireAuth, (req, res) => {
  const userId = req.session.userId;
  let list;
  try { list = sharesStore.read().filter(s => s && s.recipientId === userId && s.hiddenByRecipient !== true); }
  catch { return unavailable(res); }
  const out = [];
  list.forEach(s => {
    let got;
    try { got = shareForRecipient(s.id, userId); } catch { got = null; }
    if (!got) return;
    out.push({
      id: s.id,
      topic: got.study.topic || 'Untitled study',
      ownerName: got.owner.fullName || 'A member',
      sharedAt: s.createdAt || null,
      parts: PARTS.filter(k => s.parts && s.parts[k]),
      url: shareUrl(s.id),
      studyUrl: shareUrl(s.id) + '/study',
    });
  });
  out.sort((a, b) => (Date.parse(b.sharedAt) || 0) - (Date.parse(a.sharedAt) || 0));
  res.json({ success: true, shares: out });
});

// ─── PUT /api/study-shares/with-me/:shareId/hide ─────────────────────────────
// "Remove from my list": the share itself stays (it's the owner's to stop).
router.put('/api/study-shares/with-me/:shareId/hide', requireAuth, writeLimiter, async (req, res) => {
  const userId = req.session.userId;
  let r;
  try {
    r = await sharesStore.update(list => {
      const s = list.find(x => x && x.id === req.params.shareId && x.recipientId === userId);
      if (!s) return { changed: false, found: false };
      if (s.hiddenByRecipient === true) return { changed: false, found: true };
      s.hiddenByRecipient = true;
      return { changed: true, found: true };
    });
  } catch (err) {
    console.error('[study-shares] hide:', err.message);
    return unavailable(res);
  }
  if (!r.found) return res.status(404).json({ success: false, error: 'That is no longer in your list.' });
  res.json({ success: true });
});

// ═══ Owner, per study ════════════════════════════════════════════════════════

// ─── GET /api/study-shares/:studyId ───────────────────────────────────────────
// Not gated: an owner can always see and stop their shares.
router.get('/api/study-shares/:studyId', requireAuth, (req, res) => {
  if (!ownStudy(req.session.userId, req.params.studyId)) return res.status(404).json({ success: false, error: 'Study not found.' });
  let list;
  try { list = ownerShares(req.session.userId, req.params.studyId); } catch { return unavailable(res); }
  res.json({ success: true, shares: list });
});

// ─── POST /api/study-shares/:studyId ──────────────────────────────────────────
// Body: { recipientId, parts: { recaps, points, notes, teaching } }. Sharing with
// someone already shared with changes what's shared instead (no second share).
router.post('/api/study-shares/:studyId', requireAuth, gate, writeLimiter, async (req, res) => {
  const ownerId = req.session.userId;
  const studyId = req.params.studyId;
  const b = req.body || {};
  const parts = cleanParts(b.parts);
  if (!parts) return res.status(400).json({ success: false, error: 'Tick at least one part to share.' });
  const study = ownStudy(ownerId, studyId);
  if (!study) return res.status(404).json({ success: false, error: 'Only Study Notes on your own studies can be shared.' });
  if (typeof b.recipientId !== 'string' || !b.recipientId) return res.status(400).json({ success: false, error: 'Choose a member to share with.' });
  if (b.recipientId === ownerId) return res.status(400).json({ success: false, error: 'You can’t share with yourself.' });
  let users;
  try { users = readUsers(); } catch { return unavailable(res); }
  const recipient = users.find(u => u && u.id === b.recipientId);
  if (!isActive(recipient) || !recipient.fullName) return res.status(404).json({ success: false, error: 'That member can’t be found.' });

  let mine;
  try { mine = sharesStore.read().filter(s => s && s.ownerId === ownerId && s.studyId === studyId); }
  catch { return unavailable(res); }
  const existing = mine.find(s => s.recipientId === recipient.id);
  if (!existing && mine.length >= PER_STUDY) return res.status(400).json({ success: false, error: `These Study Notes are already shared with ${PER_STUDY} people, which is the most for one study.` });
  if (!existing) {
    let ok;
    try { ok = await takeNewShare(ownerId); }
    catch (err) { console.error('[study-shares] usage:', err.message); return unavailable(res); }
    if (!ok) return res.status(429).json({ success: false, error: 'No more new shares can be made today. Please try again tomorrow.' });
  }

  const now = new Date().toISOString();
  let r;
  try {
    r = await sharesStore.update(list => {
      const mine = list.filter(s => s && s.ownerId === ownerId && s.studyId === studyId);
      const same = mine.find(s => s.recipientId === recipient.id);
      if (same) {
        same.parts = parts;
        same.updatedAt = now;
        return { changed: true, id: same.id, created: false };
      }
      if (mine.length >= PER_STUDY) return { changed: false, full: true };
      const share = { id: randomUUID(), ownerId, recipientId: recipient.id, studyId, parts, createdAt: now, updatedAt: now, hiddenByRecipient: false };
      list.push(share);
      return { changed: true, id: share.id, created: true };
    });
  } catch (err) {
    console.error('[study-shares] share:', err.message);
    return unavailable(res);
  }
  if (r.full) return res.status(400).json({ success: false, error: `These Study Notes are already shared with ${PER_STUDY} people, which is the most for one study.` });

  // A new share: a Message from the owner, in their 1:1 thread, with the link.
  // The share stands whether or not the message can be sent. Re-sharing (a
  // change of parts) sends nothing.
  let messageSent = null;
  if (r.created) {
    try {
      await messages.sendAs(req.app, { from: ownerId, to: recipient.id, text: shareMessage(study.topic), link: { href: shareUrl(r.id), label: 'Open Study Notes' } });
      messageSent = true;
    } catch (err) {
      console.error('[study-shares] share message:', err.message);
      messageSent = false;
    }
  }
  let list;
  try { list = ownerShares(ownerId, studyId); } catch { list = null; }
  res.json({ success: true, created: r.created, messageSent, share: list ? list.find(s => s.id === r.id) : { id: r.id, url: shareUrl(r.id) }, shares: list });
});

// ─── PUT /api/study-shares/:studyId/:shareId ──────────────────────────────────
// "Change what's shared". Body: { parts }.
router.put('/api/study-shares/:studyId/:shareId', requireAuth, gate, writeLimiter, async (req, res) => {
  const ownerId = req.session.userId;
  const parts = cleanParts(req.body && req.body.parts);
  if (!parts) return res.status(400).json({ success: false, error: 'Tick at least one part to share. To share nothing, use Stop sharing.' });
  let r;
  try {
    r = await sharesStore.update(list => {
      const s = list.find(x => x && x.id === req.params.shareId && x.ownerId === ownerId && x.studyId === req.params.studyId);
      if (!s) return { changed: false, found: false };
      s.parts = parts;
      s.updatedAt = new Date().toISOString();
      return { changed: true, found: true };
    });
  } catch (err) {
    console.error('[study-shares] change:', err.message);
    return unavailable(res);
  }
  if (!r.found) return res.status(404).json({ success: false, error: 'That share is no longer here.' });
  let list;
  try { list = ownerShares(ownerId, req.params.studyId); } catch { list = null; }
  res.json({ success: true, shares: list });
});

// ─── DELETE /api/study-shares/:studyId/:shareId ───────────────────────────────
// "Stop sharing". Not gated. The record is deleted; nothing is left of it.
router.delete('/api/study-shares/:studyId/:shareId', requireAuth, writeLimiter, async (req, res) => {
  const ownerId = req.session.userId;
  let r;
  try {
    r = await sharesStore.update(list => {
      const i = list.findIndex(x => x && x.id === req.params.shareId && x.ownerId === ownerId && x.studyId === req.params.studyId);
      if (i === -1) return { changed: false, found: false };
      list.splice(i, 1);
      return { changed: true, found: true };
    });
  } catch (err) {
    console.error('[study-shares] stop:', err.message);
    return unavailable(res);
  }
  if (!r.found) return res.status(404).json({ success: false, error: 'That share is no longer here.' });
  let list;
  try { list = ownerShares(ownerId, req.params.studyId); } catch { list = null; }
  res.json({ success: true, shares: list });
});

// ─── GET /study-notes/:studyId/preview?parts=recaps,points,notes,teaching ─────
// The owner's own notes exactly as a share with those parts shows them: the
// same read-only boot the recipient gets.
router.get('/study-notes/:studyId/preview', requireAuth, (req, res) => {
  if (teacher.memberGated(req)) return res.redirect('/pricing?from=teacher');
  const userId = req.session.userId;
  const study  = ownStudy(userId, req.params.studyId);
  if (!study) return notesPage.messagePage(req, res, 404, 'Only Study Notes on your own studies can be shared.');
  const want = String(req.query.parts || '').split(',');
  const parts = {};
  PARTS.forEach(k => { parts[k] = want.includes(k); });
  if (!PARTS.some(k => parts[k])) return notesPage.messagePage(req, res, 400, 'Tick at least one part to see a preview.');
  let model, owner;
  try {
    model = notesPage.notesModel(userId, study.id, study);
    owner = readUsers().find(u => u.id === userId);
  } catch {
    return notesPage.messagePage(req, res, 500, 'Study Notes are unavailable right now. Please try again later.');
  }
  const ownerName = (owner && owner.fullName) || 'You';
  const boot = notesPage.sharedBoot(model, parts, {
    study, ownerName, preview: true,
    foldKey: 'preview_' + study.id,
    teachingUrl: '/api/study-notes/' + encodeURIComponent(study.id) + '/teaching',
    openHref: '/library?open=' + encodeURIComponent(study.id),
  });
  notesPage.renderNotesPage(req, res, {
    boot,
    sub: 'Notes by ' + ownerName,
    banner: 'Preview: this is what the member you share with will see. Nothing on this page can be changed.',
    tools: `<a class="sn-link" href="/study-notes/${escapeHtml(encodeURIComponent(study.id))}">Back to your Study Notes</a>`,
  });
});

// ═══ Recipient pages ═════════════════════════════════════════════════════════
// Not gated: viewing a share is read only and makes no AI calls, so a free
// member can read what's shared with them.

// ─── GET /study-notes/shared/:shareId ─────────────────────────────────────────
router.get('/study-notes/shared/:shareId', requireAuth, (req, res) => {
  const got = recipientShare(req, res, false);
  if (!got) return;
  const { share, study, owner } = got;
  let model;
  try { model = notesPage.notesModel(share.ownerId, study.id, study); }
  catch {
    return notesPage.messagePage(req, res, 500, 'Shared Study Notes are unavailable right now. Please try again later.');
  }
  const base = shareUrl(share.id);
  const ownerName = owner.fullName || 'A member';
  const boot = notesPage.sharedBoot(model, share.parts || {}, {
    study, ownerName,
    foldKey: 'shared_' + share.id,
    teachingUrl: '/api' + base + '/teaching',
    openHref: base + '/study',
  });
  notesPage.renderNotesPage(req, res, {
    boot,
    sub: 'Notes by ' + ownerName,
    tools: `<a class="sn-link" href="${escapeHtml(base)}/study">Open the study</a>`,
  });
});

// ─── GET /api/study-notes/shared/:shareId/teaching ────────────────────────────
// The owner's teaching, only while Full teaching is ticked (checked every time).
router.get('/api/study-notes/shared/:shareId/teaching', requireAuth, (req, res) => {
  const got = recipientShare(req, res, true);
  if (!got) return;
  if (!(got.share.parts && got.share.parts.teaching)) return res.status(404).json({ success: false, error: 'These Study Notes are no longer shared with you.' });
  let lessons;
  try { lessons = notesPage.lessonsFor(got.share.ownerId, got.study.id); }
  catch { return res.status(500).json({ success: false, error: 'The teaching is unavailable right now.' }); }
  notesPage.sendTeaching(res, lessons, req.query);
});

// ─── GET /study-notes/shared/:shareId/study ───────────────────────────────────
// The study's text, read only: no notepad, no highlight tools, no Teacher, no
// bookmark, no Mark complete. The stored text already holds its verse text.
router.get('/study-notes/shared/:shareId/study', requireAuth, (req, res) => {
  const got = recipientShare(req, res, false);
  if (!got) return;
  const { share, study, owner } = got;
  const base = shareUrl(share.id);
  res.send(renderLayout({
    req, activeSection: 'library', title: study.topic || 'Study',
    content: `
    <div class="shared-study">
      <div class="page-header">
        <p class="teacher-topbar-label">Shared study</p>
        <h2 class="page-title">${escapeHtml(study.topic || 'Untitled study')}</h2>
        <p class="page-subtitle">Shared by ${escapeHtml(owner.fullName || 'a member')} with their Study Notes. Read only.</p>
        <a class="sn-link" href="${escapeHtml(base)}">Back to the Study Notes</a>
      </div>
      <div id="sharedStudyBody" class="reading-body shared-study-body"></div>
    </div>`,
    scripts: `<script src="/js/render-markdown.js?v=2"></script>
<script src="/js/opposing-views.js?v=2"></script>
<script>window.SHARED_STUDY_BOOT = ${inlineJson({ content: study.content || '', studyType: study.studyType || null })};</script>
<script src="/js/shared-study.js?v=1"></script>`,
  }));
});

module.exports = router;
