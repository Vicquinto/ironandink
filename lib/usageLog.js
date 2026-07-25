// ─── Usage event log ─────────────────────────────────────────────────────────
// Silent, always-on capture of member activity for historical reporting. Mirrors
// the feedback-log convention: a flat JSON array in data/, written via the same
// readJSON → push → writeJSON idiom. Each event is:
//   { id, userId, fullName, type, at: ISO, meta }
//
// Phase 2 scope: historical data only. Nothing here surfaces live — the log is
// read solely by the on-demand Excel report (GET /api/admin/usage-report). Token
// capture is deferred to Phase 3; do not add it here.
//
// Guarantee: logEvent NEVER throws into its caller. Every path is wrapped in
// try/catch that logs-and-swallows, because logging must never block or break the
// user action it is attached to. A lost log line is always preferable to a failed
// login, study, or room join.

const fs   = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const EVENTS_PATH = path.join(__dirname, '../data/usage_events.json');

// Missing file is treated as an empty array and created on first write.
function readEvents() {
  try {
    if (!fs.existsSync(EVENTS_PATH)) return [];
    return JSON.parse(fs.readFileSync(EVENTS_PATH, 'utf8'));
  } catch { return []; }
}

function writeEvents(events) {
  fs.writeFileSync(EVENTS_PATH, JSON.stringify(events, null, 2));
}

// Append one usage event. Fire-and-forget from the caller's perspective.
function logEvent(userId, fullName, type, meta = {}) {
  try {
    const events = readEvents();
    events.push({
      id:       randomUUID(),
      userId:   userId || null,
      fullName: fullName || 'Unknown',
      type,
      at:       new Date().toISOString(),
      meta:     meta || {},
    });
    writeEvents(events);
  } catch (err) {
    console.error('[usageLog] failed to log', type, ':', err.message);
  }
}

module.exports = { logEvent, readEvents, writeEvents, EVENTS_PATH };
