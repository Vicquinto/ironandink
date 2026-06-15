const express        = require('express');
const fs             = require('fs');
const path           = require('path');
const { randomUUID } = require('crypto');
const { requireAuth, renderLayout, getIsAdmin } = require('./layout');

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

`;

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

  const userId    = req.session.userId;
  const users     = readUsers();
  const user      = users.find(u => u.id === userId);
  const userName  = user ? user.fullName : 'Unknown';
  const hostUser  = users.find(u => u.id === room.host);
  const hostEmail = hostUser ? hostUser.email : '';

  if (!room.members.includes(userId)) {
    room.members.push(userId);
    const idx = rooms.findIndex(r => r.code === room.code);
    rooms[idx] = room;
    writeRooms(rooms);
  }

  const safeName = room.name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const content = `
    <div class="room-page" id="roomPage" style="padding-right:340px;">

      <div class="room-header">
        <h2 class="room-title" id="roomTitle">${safeName}</h2>
        <div class="room-meta">
          <span id="roomHostLabel">Host: ${room.hostName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>
          <span style="background:#A0845C;color:#fff;border-radius:4px;padding:2px 10px;font-size:0.8rem;margin-left:0.5rem;">${{ foundations: 'Foundations', journeyman: 'Journeyman', scholar: 'Scholar' }[room.studyLevel || 'journeyman'] || 'Journeyman'}</span>
          <span id="roomMembersLabel"></span>
        </div>
        <div style="margin-top:0.5rem;display:flex;align-items:center;gap:0.5rem;">
          <span style="font-weight:600;color:#5C1A28;font-size:0.9rem;">Room Code: ${room.code}</span>
          <button onclick="(function(btn){navigator.clipboard.writeText('${room.code}').then(function(){var orig=btn.textContent;btn.textContent='Copied!';setTimeout(function(){btn.textContent=orig;},1500);});})(this)" style="background:transparent;border:1px solid #5C1A28;color:#5C1A28;border-radius:4px;padding:2px 8px;font-size:0.8rem;cursor:pointer;">Copy</button>
        </div>
        <div id="roomCurrentTopic" style="font-style:italic;color:#5C1A28;font-size:0.95rem;margin-top:0.25rem;">${room.study && room.study.topic ? 'Currently studying: ' + room.study.topic.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : ''}</div>
        <div id="roomMembersList" style="margin-top:0.5rem;">
          <span style="font-size:0.8rem;color:var(--text-muted);">In this room:</span>
          <span id="roomMembersBadges"></span>
        </div>
      </div>

      <div class="study-search-bar" style="display:flex;gap:0.75rem;align-items:center;margin-bottom:1.5rem;">
        <input type="text" id="roomTopicInput" class="study-input" placeholder="Enter a study topic…" autocomplete="off" style="flex:1;padding:0.6rem 0.75rem;border:1px solid #c4a882;border-radius:6px;font-size:1rem;">
        <button id="roomGenerateBtn" class="btn-warm" style="background:#5C1A28;color:#fff;border:none;border-radius:6px;padding:0.6rem 1.5rem;font-size:1rem;cursor:pointer;white-space:nowrap;">Generate Study</button>
      </div>

      ${room.host === userId ? `
      <div style="margin-top:0.75rem;margin-bottom:1.5rem;">
        <button id="roomLoadLibraryBtn" style="background:#5C1A28;color:#fff;border:none;border-radius:6px;padding:0.5rem 1.25rem;font-size:0.9rem;cursor:pointer;">Load from Library</button>
        <div id="roomLibraryPanel" style="display:none;background:#f5ede0;border:1px solid #c4a882;border-radius:8px;padding:1rem;margin-top:0.75rem;max-height:300px;overflow-y:auto;"></div>
      </div>
      ` : ''}

      <div style="margin-bottom:1.5rem;">
        <button id="roomAskAIBtn" style="background:#5C1A28;color:#fff;border:none;border-radius:6px;padding:0.5rem 1.25rem;font-size:0.9rem;cursor:pointer;margin-top:0.5rem;">Ask AI</button>
        <div id="roomAskAIPanel" style="display:none;margin-top:0.75rem;">
          <textarea id="roomAskAIInput" rows="3" placeholder="Ask AI anything about this study or any theological question…" style="width:100%;box-sizing:border-box;border:1px solid #c4a882;border-radius:6px;padding:0.75rem;font-family:inherit;font-size:0.95rem;resize:vertical;"></textarea>
          <button id="roomAskAISubmit" style="background:#5C1A28;color:#fff;border:none;border-radius:6px;padding:0.5rem 1.25rem;font-size:0.9rem;cursor:pointer;margin-top:0.5rem;">Ask AI</button>
        </div>
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
        <div class="guide-font-toolbar">
          <button class="guide-font-btn guide-font-btn-sm" id="roomFontDecBtn">A&#8722;</button>
          <button class="guide-font-btn guide-font-btn-md" id="roomFontResetBtn">A</button>
          <button class="guide-font-btn guide-font-btn-lg" id="roomFontIncBtn">A+</button>
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

    </div>

    <div style="position:fixed;right:0;top:0;width:320px;height:100vh;background:#f5ede0;border-left:1px solid #c4a882;display:flex;flex-direction:column;padding:1rem;box-sizing:border-box;z-index:100;">
      <div style="font-weight:600;font-size:0.9rem;color:#5C1A28;margin-bottom:0.75rem;">Room Chat</div>
      <div id="roomChatMessages" style="flex:1;overflow-y:auto;border:1px solid #c4a882;border-radius:8px;padding:0.75rem;background:#fff;margin-bottom:0.75rem;"></div>
      <div style="display:flex;gap:0.5rem;">
        <input type="text" id="roomChatInput" placeholder="Say something to the room…" autocomplete="off" style="flex:1;padding:0.5rem 0.75rem;border:1px solid #c4a882;border-radius:6px;font-size:0.9rem;">
        <button id="roomChatBtn" style="background:#5C1A28;color:#fff;border:none;border-radius:6px;padding:0.5rem 1rem;cursor:pointer;font-size:0.9rem;">Send</button>
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
    window.CURRENT_USER = ${JSON.stringify({ id: userId, name: userName, email: user ? user.email : '' })};
    window.ROOM_HOST    = ${JSON.stringify(hostEmail)};
    window.ROOM_STUDY       = ${room.study ? JSON.stringify(room.study) : 'null'};
    window.ROOM_STUDY_LEVEL = ${JSON.stringify(room.studyLevel || 'journeyman')};
  </script>
  <script src="/js/room.js?v=6"></script>
  <script src="/js/library.js?v=8"></script>`,
  }));
});

// ─── POST /api/rooms/:code/save-study ────────────────────────────────────────

router.post('/api/rooms/:code/save-study', requireAuth, (req, res) => {
  const code  = req.params.code.toUpperCase();
  const rooms = readRooms();
  const idx   = rooms.findIndex(r => r.code === code);

  if (idx === -1) return res.status(404).json({ success: false, error: 'Room not found.' });

  const { topic, content, translation } = req.body;
  rooms[idx].study = { topic: topic || '', content: content || '', translation: translation || '' };
  writeRooms(rooms);

  res.json({ success: true });
});

// ─── POST /api/rooms/create ───────────────────────────────────────────────────

router.post('/api/rooms/create', requireAuth, (req, res) => {
  const { name, visibility, inviteEmail, studyLevel } = req.body;
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
    visibility:  visibility === 'private' ? 'private' : 'open',
    studyLevel:  ['foundations', 'journeyman', 'scholar'].includes(studyLevel) ? studyLevel : 'journeyman',
    members:     [userId],
    createdAt:   now,
    study:       null,
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

// ─── DELETE /api/rooms/:code ──────────────────────────────────────────────────

router.delete('/api/rooms/:code', requireAuth, (req, res) => {
  const code  = req.params.code.toUpperCase();
  const rooms = readRooms();
  const idx   = rooms.findIndex(r => r.code === code);

  if (idx === -1) return res.status(404).json({ success: false, error: 'Room not found.' });

  const room    = rooms[idx];
  const userId  = req.session.userId;
  const isHost  = room.host === userId;
  const isAdmin = getIsAdmin(req);

  if (!isHost && !isAdmin) {
    return res.status(403).json({ success: false, error: 'Not authorized.' });
  }

  rooms.splice(idx, 1);
  writeRooms(rooms);

  const io = req.app.locals.io;
  if (io) io.to(code).emit('room-closed', { code });

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

// ─── GET /api/rooms/:code/members ────────────────────────────────────────────

router.get('/api/rooms/:code/members', requireAuth, (req, res) => {
  const code  = req.params.code.toUpperCase();
  const rooms = readRooms();
  const room  = rooms.find(r => r.code === code);

  if (!room) return res.status(404).json({ success: false, error: 'Room not found.' });

  const users   = readUsers();
  const members = (room.members || []).map(memberId => {
    const user = users.find(u => u.id === memberId);
    return {
      id:     memberId,
      name:   user ? user.fullName : 'Unknown',
      email:  user ? user.email : '',
      isHost: memberId === room.host,
    };
  });

  res.json({ success: true, members });
});

module.exports = router;
