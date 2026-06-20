const express = require('express');
const fs      = require('fs');
const path    = require('path');
const { requireAuth } = require('./layout');

const router        = express.Router();
const PRESENCE_PATH = path.join(__dirname, '../data/presence.json');
const USERS_PATH    = path.join(__dirname, '../data/users.json');

const VALID_STATUSES = ['available', 'away', 'dnd'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readPresence() {
  try {
    if (!fs.existsSync(PRESENCE_PATH)) return { statuses: {} };
    return JSON.parse(fs.readFileSync(PRESENCE_PATH, 'utf8'));
  } catch { return { statuses: {} }; }
}

function writePresence(data) {
  fs.writeFileSync(PRESENCE_PATH, JSON.stringify(data, null, 2));
}

function readUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_PATH, 'utf8')); }
  catch { return []; }
}

function savePresenceStatus(userId, status) {
  const data = readPresence();
  if (!data.statuses) data.statuses = {};
  data.statuses[userId] = status;
  writePresence(data);
}

function getOnlineList(userSockets) {
  const presence = readPresence();
  const users    = readUsers();
  const online   = [];
  userSockets.forEach((sockets, userId) => {
    if (sockets.size > 0) {
      const user = users.find(u => u.id === userId);
      if (user) {
        online.push({
          userId,
          fullName: user.fullName || 'Unknown',
          status: (presence.statuses || {})[userId] || 'available',
        });
      }
    }
  });
  online.sort((a, b) => a.fullName.localeCompare(b.fullName));
  return online;
}

function broadcastPresence(io, userSockets) {
  io.emit('presence:update', { online: getOnlineList(userSockets) });
}

// ─── GET /api/presence ────────────────────────────────────────────────────────

router.get('/api/presence', requireAuth, (req, res) => {
  const userSockets = req.app.locals.userSockets || new Map();
  res.json({ online: getOnlineList(userSockets) });
});

// ─── POST /api/presence/status ───────────────────────────────────────────────

router.post('/api/presence/status', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const { status } = req.body;

  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  savePresenceStatus(userId, status);

  const io          = req.app.locals.io;
  const userSockets = req.app.locals.userSockets || new Map();
  if (io) broadcastPresence(io, userSockets);

  res.json({ ok: true });
});

module.exports = { router, broadcastPresence, savePresenceStatus, getOnlineList };
