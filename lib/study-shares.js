const fs   = require('fs');
const path = require('path');
const { createJsonStore } = require('./jsonStore');

// ─── Study Notes shared with a member ─────────────────────────────────────────
// A member shares their Study Notes for one of their own studies with another
// member, read-only. One record per share (data/study_note_shares.json):
//   { id, ownerId, recipientId, studyId,
//     parts: { recaps, points, notes, teaching },   // what is shared
//     createdAt, updatedAt, hiddenByRecipient }
// One share per (ownerId, studyId, recipientId). Stop sharing deletes the record.
//
// A share is not a study-access rule: findReadableStudy, the Community feed and
// the Library are unchanged. Only the share routes (routes/study-shares.js) read
// it, and they read the OWNER's records with ownerId from this record, never
// from the request.

const sharesStore = createJsonStore(path.join(__dirname, '../data/study_note_shares.json'), 'Study Note shares');
// One record per owner: { userId, day, count }, new shares made that day (America/Denver).
const usageStore  = createJsonStore(path.join(__dirname, '../data/study_share_usage.json'), 'Study share usage');

const PARTS       = ['recaps', 'points', 'notes', 'teaching'];
const DAILY_MAX   = 20;   // new shares per owner per day
const PER_STUDY   = 10;   // people one study's notes can be shared with

const USERS_PATH   = path.join(__dirname, '../data/users.json');
const STUDIES_PATH = path.join(__dirname, '../data/studies.json');
function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function readUsers() { return readJson(USERS_PATH); }
function readStudies() { return fs.existsSync(STUDIES_PATH) ? readJson(STUDIES_PATH) : []; }

// { recaps, points, notes, teaching } as true/false from a request body, or null
// when the body isn't that shape or nothing is ticked.
function cleanParts(v) {
  if (!v || typeof v !== 'object') return null;
  const out = {};
  for (const k of PARTS) {
    if (typeof v[k] !== 'boolean') return null;
    out[k] = v[k];
  }
  return PARTS.some(k => out[k]) ? out : null;
}

function isActive(u) { return !!u && u.isActive !== false; }

function todayStr() { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' }); }
// Takes one of today's new shares, or says there are none left.
async function takeNewShare(userId) {
  const r = await usageStore.update(list => {
    const day = todayStr();
    let rec = list.find(x => x && x.userId === userId);
    if (!rec) { rec = { userId, day, count: 0 }; list.push(rec); }
    if (rec.day !== day) { rec.day = day; rec.count = 0; }
    if (rec.count >= DAILY_MAX) return { changed: false, ok: false };
    rec.count++;
    return { changed: true, ok: true };
  });
  return r.ok;
}

// The share a recipient may open: { share, study, owner }, or null for every
// "no" (unknown id, someone else's, stopped, owner suspended, study gone or no
// longer the owner's). Throws if the shares store can't be read.
function shareForRecipient(shareId, userId) {
  if (typeof shareId !== 'string' || !shareId) return null;
  const share = sharesStore.read().find(s => s && s.id === shareId);
  if (!share || share.recipientId !== userId) return null;
  let users, studies;
  try { users = readUsers(); studies = readStudies(); } catch { return null; }
  const owner = users.find(u => u.id === share.ownerId);
  if (!isActive(owner)) return null;
  const study = studies.find(s => s && s.id === share.studyId);
  if (!study || study.userId !== share.ownerId) return null;
  return { share, study, owner };
}

// Removes every share of a study (the owner deleted it). Resolves with how many.
function deleteSharesForStudy(ownerId, studyId) {
  return sharesStore.update(list => {
    let n = 0;
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i];
      if (s && s.ownerId === ownerId && s.studyId === studyId) { list.splice(i, 1); n++; }
    }
    return { changed: n > 0, removed: n };
  }).then(r => r.removed);
}

function shareUrl(id) { return '/study-notes/shared/' + encodeURIComponent(id); }

// The owner's shares of one study, for the owner's page: who, what, and the link.
// Throws if the shares store can't be read.
function ownerShares(ownerId, studyId) {
  const list = sharesStore.read().filter(s => s && s.ownerId === ownerId && s.studyId === studyId);
  let users = [];
  try { users = readUsers(); } catch { /* names fall back below */ }
  return list
    .sort((a, b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0))
    .map(s => {
      const u = users.find(x => x.id === s.recipientId);
      return {
        id: s.id, recipientId: s.recipientId,
        name: (u && u.fullName) || 'A member',
        active: isActive(u),
        parts: Object.assign({}, s.parts),
        url: shareUrl(s.id),
        createdAt: s.createdAt || null, updatedAt: s.updatedAt || null,
      };
    });
}

module.exports = {
  sharesStore, PARTS, DAILY_MAX, PER_STUDY,
  cleanParts, isActive, takeNewShare, shareForRecipient, deleteSharesForStudy, shareUrl, ownerShares, readUsers, readStudies,
};
