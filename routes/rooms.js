const express        = require('express');
const fs             = require('fs');
const path           = require('path');
const { randomUUID } = require('crypto');
const { requireAuth, renderLayout } = require('./layout');

const router     = express.Router();
const ROOMS_PATH = path.join(__dirname, '../data/rooms.json');
const USERS_PATH = path.join(__dirname, '../data/users.json');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readRooms() {
  try {
    if (!fs.existsSync(ROOMS_PATH)) return [];
    return JSON.parse(fs.readFileSync(ROOMS_PATH, 'utf8'));
  } catch { return []; }
}

function writeRooms(data) {
  fs.writeFileSync(ROOMS_PATH, JSON.stringify(data, null, 2));
}

function readUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_PATH, 'utf8'));
  } catch { return []; }
}

function writeUsers(data) {
  fs.writeFileSync(USERS_PATH, JSON.stringify(data, null, 2));
}

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// ─── GET /rooms ───────────────────────────────────────────────────────────────

router.get('/rooms', requireAuth, (req, res) => {
  const content = `
    <div class="page-header">
      <h2 class="page-title">Live Study Rooms</h2>
      <p class="page-subtitle">Join a shared study session or start one of your own.</p>
    </div>

    <div class="rooms-toolbar">
      <button class="btn-warm" id="startRoomBtn">Start a Shared Study</button>
    </div>

    <div class="rooms-notifications" id="roomsNotifications" style="display:none;">
      <h4 class="rooms-notif-heading">Invitations</h4>
      <ul class="rooms-notif-list" id="roomsNotifList"></ul>
    </div>

    <div class="rooms-list" id="roomsList">
      <p class="rooms-empty" id="roomsEmpty">No open rooms right now.</p>
    </div>

    <div class="rooms-create-modal" id="roomsCreateModal" style="display:none;">
      <div class="rooms-create-card">
        <h4 class="rooms-create-heading">Start a Shared Study</h4>
        <label class="rooms-label">Room Name</label>
        <input type="text" class="rooms-input" id="roomNameInput" placeholder="e.g. Romans Study – Week 3" maxlength="80">
        <label class="rooms-label">Invite by Email <span style="font-weight:400;opacity:0.7;">(optional)</span></label>
        <input type="email" class="rooms-input" id="roomInviteEmail" placeholder="member@example.com">
        <label class="rooms-label">Visibility</label>
        <select class="rooms-input" id="roomVisibility">
          <option value="open">Open — anyone can join</option>
          <option value="private">Private — invite only</option>
        </select>
        <div class="rooms-create-actions">
          <button class="btn-warm" id="roomsCreateConfirm">Create Room</button>
          <button class="rooms-cancel-btn" id="roomsCreateCancel">Cancel</button>
        </div>
        <p class="rooms-create-error" id="roomsCreateError" style="display:none;"></p>
      </div>
    </div>`;

  res.send(renderLayout({
    req,
    activeSection: 'rooms',
    title:         'Live Study Rooms',
    content,
    scripts: `<script src="/js/rooms.js?v=1"></script><script src="/js/library.js?v=8"></script>`,
  }));
});

// ─── GET /room/:code ──────────────────────────────────────────────────────────

router.get('/room/:code', requireAuth, (req, res) => {
  const rooms = readRooms();
  const room  = rooms.find(r => r.code === req.params.code.toUpperCase());

  if (!room) return res.redirect('/rooms');

  const userId   = req.session.userId;
  const users    = readUsers();
  const user     = users.find(u => u.id === userId);
  const userName = user ? user.fullName : 'Unknown';

  const isMember = room.members.includes(userId);

  if (!isMember) {
    if (room.visibility === 'private') return res.redirect('/rooms');
    room.members.push(userId);
    const idx = rooms.findIndex(r => r.code === room.code);
    rooms[idx] = room;
    writeRooms(rooms);
  }

  const safeName = room.name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const content = `
    <div class="room-page" id="roomPage">

      <div class="room-header">
        <h2 class="room-title" id="roomTitle">${safeName}</h2>
        <div class="room-meta">
          <span id="roomHostLabel">Host: ${room.hostName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>
          <span id="roomMembersLabel"></span>
        </div>
        <div style="margin-top:0.5rem;display:flex;align-items:center;gap:0.5rem;">
          <span style="font-weight:600;color:#5C1A28;font-size:0.9rem;">Room Code: ${room.code}</span>
          <button onclick="(function(btn){navigator.clipboard.writeText('${room.code}').then(function(){var orig=btn.textContent;btn.textContent='Copied!';setTimeout(function(){btn.textContent=orig;},1500);});})(this)" style="background:transparent;border:1px solid #5C1A28;color:#5C1A28;border-radius:4px;padding:2px 8px;font-size:0.8rem;cursor:pointer;">Copy</button>
        </div>
      </div>

      <div class="study-search-bar">
        <input type="text" id="roomTopicInput" class="study-input" placeholder="Enter a study topic…" autocomplete="off">
        <button id="roomGenerateBtn" class="btn-warm">Generate Study</button>
      </div>

      <div id="roomLoading" class="study-loading" style="display:none;">
        <div class="study-spinner"></div>
        <p>Generating study for everyone in the room…</p>
      </div>

      <div id="roomGuideArea" style="display:none;">
        <div class="guide-header-bar">
          <h3 id="roomGuideTitle"></h3>
          <span id="roomGuideBadge" class="guide-badge"></span>
        </div>
        <div id="roomGuideBody" class="guide-body"></div>
        <div class="guide-actions">
          <button id="roomSaveBtn" class="btn-primary">Save to My Library</button>
        </div>
      </div>

      <div id="roomFollowUp" class="room-followup" style="display:none;">
        <input type="text" id="roomFollowUpInput" class="study-input" placeholder="Ask a follow-up question…" autocomplete="off">
        <button id="roomFollowUpBtn" class="btn-warm">Ask</button>
      </div>

      <div id="roomPresence" class="room-presence"></div>

      <div style="margin-top:1.5rem;">
        <div style="font-weight:600;font-size:0.9rem;color:#5C1A28;margin-bottom:0.4rem;">Room Chat</div>
        <div id="roomChatMessages" style="height:200px;overflow-y:auto;border:1px solid #c4a882;border-radius:8px;padding:0.75rem;background:#f5ede0;margin-bottom:0.75rem;"></div>
        <div style="display:flex;gap:0.5rem;">
          <input type="text" id="roomChatInput" placeholder="Say something to the room…" autocomplete="off" style="flex:1;padding:0.5rem 0.75rem;border:1px solid #c4a882;border-radius:6px;font-size:0.95rem;">
          <button id="roomChatBtn" style="background:#5C1A28;color:#fff;border:none;border-radius:6px;padding:0.5rem 1rem;cursor:pointer;">Send</button>
        </div>
      </div>

    </div>`;

  res.send(renderLayout({
    req,
    activeSection: 'rooms',
    title:         room.name,
    content,
    scripts: `
  <script src="/socket.io/socket.io.js"></script>
  <script>
    window.ROOM_CODE    = ${JSON.stringify(room.code)};
    window.CURRENT_USER = ${JSON.stringify({ id: userId, name: userName })};
  </script>
  <script src="/js/room.js?v=1"></script>
  <script src="/js/library.js?v=8"></script>`,
  }));
});

// ─── POST /api/rooms/create ───────────────────────────────────────────────────

router.post('/api/rooms/create', requireAuth, (req, res) => {
  const { name, visibility, inviteEmail } = req.body;
  if (!name || !String(name).trim()) {
    return res.status(400).json({ success: false, error: 'Room name is required.' });
  }

  const userId = req.session.userId;
  const users  = readUsers();
  const host   = users.find(u => u.id === userId);
  const rooms  = readRooms();

  let code;
  do { code = generateCode(); } while (rooms.some(r => r.code === code));

  const now  = new Date().toISOString();
  const room = {
    id:         randomUUID(),
    code,
    name:       String(name).trim(),
    host:       userId,
    hostName:   host ? host.fullName : 'Unknown',
    visibility: visibility === 'private' ? 'private' : 'open',
    members:    [userId],
    createdAt:  now,
    study:      null,
  };

  rooms.push(room);
  writeRooms(rooms);

  if (inviteEmail && String(inviteEmail).trim()) {
    const email   = String(inviteEmail).trim().toLowerCase();
    const invitee = users.find(u => u.email.toLowerCase() === email);
    if (invitee) {
      if (!Array.isArray(invitee.notifications)) invitee.notifications = [];
      invitee.notifications.push({
        id:        randomUUID(),
        type:      'room_invite',
        from:      host ? host.fullName : 'Someone',
        roomCode:  code,
        roomName:  room.name,
        createdAt: now,
        read:      false,
      });
      const idx = users.findIndex(u => u.id === invitee.id);
      users[idx] = invitee;
      writeUsers(users);
    }
  }

  res.json({ success: true, code });
});

// ─── GET /api/rooms/notifications ────────────────────────────────────────────

router.get('/api/rooms/notifications', requireAuth, (req, res) => {
  const users = readUsers();
  const user  = users.find(u => u.id === req.session.userId);
  res.json({ success: true, notifications: (user && user.notifications) || [] });
});

// ─── POST /api/rooms/notifications/read ──────────────────────────────────────

router.post('/api/rooms/notifications/read', requireAuth, (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ success: false, error: 'Notification id required.' });

  const users = readUsers();
  const idx   = users.findIndex(u => u.id === req.session.userId);
  if (idx === -1) return res.status(404).json({ success: false, error: 'User not found.' });

  const notif = (users[idx].notifications || []).find(n => n.id === id);
  if (notif) notif.read = true;
  writeUsers(users);

  res.json({ success: true });
});

// ─── GET /api/rooms/list ──────────────────────────────────────────────────────

router.get('/api/rooms/list', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const rooms  = readRooms();
  const visible = rooms.filter(r =>
    r.visibility === 'open' || r.host === userId || r.members.includes(userId)
  );
  res.json({ success: true, rooms: visible });
});

module.exports = router;
