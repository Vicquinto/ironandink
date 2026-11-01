const express = require('express');
const { requireAuth } = require('./layout');
const geo = require('../lib/geo');

const router = express.Router();
geo.init();

// Strict query parsing: a plain string (not an array/object from a repeated
// parameter), a sane total length, comma-separated items.
function listParam(v, maxLen) {
  if (typeof v !== 'string' || !v || v.length > maxLen) return [];
  return v.split(',').map(s => s.trim()).filter(Boolean);
}

// ─── GET /api/geo/resolve?places=<ids>&roads=<names> ─────────────────────────
// Turns the map references a saved note keeps (Pleiades ids, road names) back
// into the tooltip map payload, only when the reader opens that note's map.
// Ids must be numeric and road names follow the marker character rules; both
// must exist in the loaded gazetteers. Same caps as the tooltip map (12 / 3).
// Covered by the global /api/ rate limiter in server.js.
router.get('/api/geo/resolve', requireAuth, (req, res) => {
  const ids = listParam(req.query.places, 400)
    .filter(id => geo.PLACE_ID_RE.test(id))
    .slice(0, geo.MAX_PLACES * 2);
  const roads = listParam(req.query.roads, 400)
    .filter(n => n.length <= geo.MAX_MARKER && geo.CONTENT_OK_RE.test(n))
    .slice(0, geo.MAX_ROADS * 2);
  const map = geo.resolveGeoRefs({ places: ids, roads });
  if (!map) return res.status(404).json({ success: false, error: 'Map unavailable.' });
  res.json({ success: true, map });
});

module.exports = router;
