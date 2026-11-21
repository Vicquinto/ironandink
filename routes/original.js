const express = require('express');
const { requireAuth } = require('./layout');
const original = require('../lib/original');
const { parseReference } = require('../lib/asv');

const router = express.Router();

// ─── GET /api/original/:book/:chapter/:verses ────────────────────────────────
// The highlight panel's Original tab: the Hebrew (OT) or Greek (NT) behind one
// verse or a range ("5" or "5-7", up to 10 verses), word by word, from the
// STEPBible data in orig/ (lib/original.js). Logged-in only. Covered by the
// global /api/ rate limiter in server.js, like the other light lookups.
router.get('/api/original/:book/:chapter/:verses', requireAuth, (req, res) => {
  const r = original.lookup(req.params.book, req.params.chapter, req.params.verses);
  res.status(r.status).json(r.body);
});

// ─── GET /api/original?ref=Romans%205:1 ─────────────────────────────────────
// Same, for a typed reference (the tab's reference box), parsed with the
// Verse Lookup parser so the same spellings and abbreviations work.
router.get('/api/original', requireAuth, (req, res) => {
  const ref = typeof req.query.ref === 'string' ? req.query.ref.slice(0, 80) : '';
  const p = parseReference(ref);
  if (!p) {
    return res.status(400).json({ success: false, error: 'Type a reference, e.g. Romans 5:1.' });
  }
  const verses = p.verseEnd > p.verseStart ? p.verseStart + '-' + p.verseEnd : String(p.verseStart);
  const r = original.lookup(p.book, p.chapter, verses);
  res.status(r.status).json(r.body);
});

module.exports = router;
