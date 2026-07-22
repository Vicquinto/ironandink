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

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderMarkdown(text) {
  if (!text) return '';
  let html = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^#### (.+)$/gm, '<h5 class="guide-h5">$1</h5>')
    .replace(/^### (.+)$/gm,  '<h4 class="guide-h4">$1</h4>')
    .replace(/^## (.+)$/gm,   '<h3 class="guide-h3">$1</h3>')
    .replace(/^# (.+)$/gm,    '<h2 class="guide-h2">$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,     '<em>$1</em>')
    .replace(/^---$/gm,        '<hr class="guide-hr">');
  const lines = html.split('\n');
  const result = [];
  let inUl = false, inOl = false;
  for (const line of lines) {
    const ulM = line.match(/^[-*] (.+)/);
    const olM = line.match(/^\d+\. (.+)/);
    const bqM = line.match(/^> (.+)/);
    if (bqM) {
      if (inUl) { result.push('</ul>'); inUl = false; }
      if (inOl) { result.push('</ol>'); inOl = false; }
      result.push('<blockquote class="guide-bq">' + bqM[1] + '</blockquote>');
    } else if (ulM) {
      if (inOl) { result.push('</ol>'); inOl = false; }
      if (!inUl) { result.push('<ul class="guide-list">'); inUl = true; }
      result.push('<li>' + ulM[1] + '</li>');
    } else if (olM) {
      if (inUl) { result.push('</ul>'); inUl = false; }
      if (!inOl) { result.push('<ol class="guide-list guide-ol">'); inOl = true; }
      result.push('<li>' + olM[1] + '</li>');
    } else {
      if (inUl) { result.push('</ul>'); inUl = false; }
      if (inOl) { result.push('</ol>'); inOl = false; }
      const t = line.trim();
      if (!t) {
        result.push('<div class="guide-spacer"></div>');
      } else if (t.startsWith('<h') || t.startsWith('<hr')) {
        result.push(t);
      } else {
        result.push('<p class="guide-p">' + t + '</p>');
      }
    }
  }
  if (inUl) result.push('</ul>');
  if (inOl) result.push('</ol>');
  return result.join('\n');
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
    scripts: `<script>window.USER_STUDY_LEVEL = ${JSON.stringify((req.session.user && req.session.user.settings && req.session.user.settings.studyLevel) || 'journeyman')};</script><script src="/js/study-badges.js?v=2"></script><script src="/js/render-markdown.js?v=1"></script><script src="/js/enhance-further-studies.js?v=2"></script><script src="/js/rooms.js?v=6"></script><script src="/js/library.js?v=56"></script>`,
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

  const isPaused   = (room.status || 'active') === 'paused';
  const isRoomHost = room.host === userId;
  // In-room controls belong to the host alone. Admins manage rooms — pause,
  // resume, delete — from the Admin panel's Live Rooms tab, so an admin sitting
  // in someone else's room sees exactly what any other member sees rather than
  // host controls mixed into member UI. A paused room is no longer stuck for
  // want of a Resume button: the admin list offers Resume for any paused room.
  // Server-side authorisation on the pause/resume/delete endpoints is unchanged
  // and still accepts host || admin.
  const canControl = isRoomHost;

  if (isPaused && !canControl) {
    const levelLabel   = { foundations: 'Apprentice', journeyman: 'Journeyman', scholar: 'Scholar' }[room.studyLevel || 'journeyman'] || 'Journeyman';
    const topicText    = room.study && room.study.topic ? 'Currently studying: ' + escHtml(room.study.topic) : '';
    const studySection = room.study && room.study.content
      ? `<div id="roomGuideArea">
        <div class="guide-header-bar">
          <h3 id="roomGuideTitle">${escHtml(room.study.topic || '')}</h3>
          <span id="roomGuideBadge" class="guide-badge">${escHtml(room.study.translation || 'ASV')}</span>
        </div>
        ${room.study.author ? `<div id="roomGuideAuthor" style="font-size:0.85rem;color:#6B4226;font-style:italic;margin:0.15rem 0 0.35rem;">Shared by ${escHtml(room.study.author)}</div>` : ''}
        <div id="roomGuideBody" class="guide-body">${renderMarkdown(room.study.content)}</div>
      </div>` : '';

    return res.send(renderLayout({
      req,
      activeSection: 'rooms',
      title:         room.name,
      content: `
    <div class="room-page" id="roomPage" style="padding-right:340px;">

      <div class="room-header">
        <h2 class="room-title">${escHtml(room.name)}</h2>
        <div class="room-meta">
          <span>Host: ${escHtml(room.hostName)}</span>
          <span style="background:#A0845C;color:#fff;border-radius:4px;padding:2px 10px;font-size:0.8rem;margin-left:0.5rem;">${levelLabel}</span>
        </div>
        <div style="margin-top:0.5rem;">
          <span style="font-weight:600;color:#5C1A28;font-size:0.9rem;">Room Code: ${room.code}</span>
        </div>
        <div style="font-style:italic;color:#5C1A28;font-size:0.95rem;margin-top:0.25rem;">${topicText}</div>
      </div>

      <div style="background:#f5ede0;border:1px solid #c4a882;border-left:4px solid #A0845C;border-radius:8px;padding:1rem 1.25rem;margin-bottom:1.5rem;">
        <div style="font-weight:700;color:#5C1A28;font-size:0.97rem;margin-bottom:0.2rem;">Room Paused</div>
        <div style="font-size:0.88rem;color:#6b5030;line-height:1.5;">This study session has been paused by the host. You are in read-only mode &mdash; all interactions are disabled until the host resumes.</div>
      </div>

      ${studySection}

    </div>

    <div style="position:fixed;right:0;top:0;width:320px;height:100vh;background:#f5ede0;border-left:1px solid #c4a882;display:flex;flex-direction:column;padding:1rem;box-sizing:border-box;z-index:100;">
      <div style="font-weight:600;font-size:0.9rem;color:#5C1A28;margin-bottom:0.75rem;">Room Chat <span style="font-weight:400;color:#6B4226;font-size:0.8rem;">(paused)</span></div>
      <div id="roomChatMessages" style="flex:1;overflow-y:auto;border:1px solid #c4a882;border-radius:8px;padding:0.75rem;background:#fff;margin-bottom:0.75rem;"></div>
      <div style="text-align:center;padding:0.5rem 0;font-size:0.85rem;color:#6B4226;font-style:italic;">Chat is paused</div>
    </div>`,
      scripts: `
  <script>
    window.ROOM_CODE    = ${JSON.stringify(room.code)};
    window.CURRENT_USER = ${JSON.stringify({ id: userId, name: userName, email: user ? user.email : '' })};
    window.ROOM_CHAT    = ${JSON.stringify(room.chat || [])};
  </script>
  <script>
    (function () {
      var socket = io();
      function joinRoom() {
        socket.emit('join-room', { roomCode: window.ROOM_CODE, name: window.CURRENT_USER ? window.CURRENT_USER.name : '' });
      }
      joinRoom();
      socket.on('connect', function () { joinRoom(); });
      socket.on('room-resumed', function () {
        var toast = document.createElement('div');
        toast.className = 'toast-msg';
        toast.textContent = 'Room resumed — reloading…';
        document.body.appendChild(toast);
        requestAnimationFrame(function () {
          requestAnimationFrame(function () { toast.classList.add('visible'); });
        });
        setTimeout(function () { window.location.reload(); }, 2000);
      });
      socket.on('room-closed', function () {
        var toast = document.createElement('div');
        toast.className = 'toast-msg';
        toast.textContent = 'The host has ended this study. Redirecting…';
        document.body.appendChild(toast);
        requestAnimationFrame(function () {
          requestAnimationFrame(function () { toast.classList.add('visible'); });
        });
        setTimeout(function () { window.location.href = '/rooms'; }, 2000);
      });
      var chat = window.ROOM_CHAT || [];
      var container = document.getElementById('roomChatMessages');
      if (container && chat.length) {
        chat.forEach(function (m) {
          // Paused view is a stripped-down read-only snapshot with no card
          // renderer loaded; skip shared-result records so they don't render as
          // "undefined: undefined". They reappear in full once the room resumes.
          if (m && m.type && m.type !== 'message') return;
          var div = document.createElement('div');
          div.style.cssText = 'padding:0.25rem 0;font-size:0.9rem;border-bottom:1px solid #e8d9b8;';
          var strong = document.createElement('strong');
          strong.textContent = m.senderName;
          div.appendChild(strong);
          div.appendChild(document.createTextNode(': ' + m.message));
          container.appendChild(div);
        });
        container.scrollTop = container.scrollHeight;
      }
    })();
  </script>
  <script src="/js/study-badges.js?v=2"></script>
  <script src="/js/render-markdown.js?v=1"></script>
  <script src="/js/enhance-further-studies.js?v=2"></script>
  <script src="/js/library.js?v=56"></script>`,
    }));
  }

  const safeName = room.name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const content = `
    <div class="room-page" id="roomPage" style="padding-right:340px;">

      <div class="room-header">
        <h2 class="room-title" id="roomTitle">${safeName}</h2>
        <div class="room-meta">
          <span id="roomHostLabel">Host: ${room.hostName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>
          <span style="background:#A0845C;color:#fff;border-radius:4px;padding:2px 10px;font-size:0.8rem;margin-left:0.5rem;">${{ foundations: 'Apprentice', journeyman: 'Journeyman', scholar: 'Scholar' }[room.studyLevel || 'journeyman'] || 'Journeyman'}</span>
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

      <div style="margin-bottom:0.25rem;">
        <div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;">
          ${room.host === userId ? `<button id="roomLoadLibraryBtn" style="background:#5C1A28;color:#fff;border:none;border-radius:6px;padding:0.5rem 0.85rem;font-size:0.88rem;cursor:pointer;font-family:'EB Garamond',Georgia,serif;letter-spacing:0.02em;">Load from Library</button>` : ''}
          ${room.host === userId ? `<button id="roomLoadCommunityBtn" style="background:#5C1A28;color:#fff;border:none;border-radius:6px;padding:0.5rem 0.85rem;font-size:0.88rem;cursor:pointer;font-family:'EB Garamond',Georgia,serif;letter-spacing:0.02em;">Load from Community</button>` : ''}
          ${room.host === userId ? `<button id="roomNewStudyBtn" style="background:transparent;color:#5C1A28;border:1px solid #5C1A28;border-radius:6px;padding:0.5rem 0.85rem;font-size:0.88rem;cursor:pointer;font-family:'EB Garamond',Georgia,serif;letter-spacing:0.02em;">Clear Study</button>` : ''}
        </div>
        ${room.host === userId ? `<div id="roomLibraryPanel" style="display:none;background:#f5ede0;border:1px solid #c4a882;border-radius:8px;padding:1rem;margin-top:0.75rem;max-height:300px;overflow-y:auto;"></div>` : ''}
        ${room.host === userId ? `<div id="roomCommunityPanel" style="display:none;background:#f5ede0;border:1px solid #c4a882;border-radius:8px;padding:1rem;margin-top:0.75rem;max-height:300px;overflow-y:auto;"></div>` : ''}
      </div>

      <hr style="border:none;border-top:1px solid #d4b896;margin:0.9rem 0 0.5rem;" />
      <div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.1em;color:#6B4226;margin-bottom:0.6rem;font-family:'EB Garamond',Georgia,serif;">Room Functions</div>
      <div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;margin-bottom:1.5rem;">
        <button id="roomExitBtn" style="background:transparent;color:#5C1A28;border:1px solid #5C1A28;border-radius:6px;padding:0.5rem 0.85rem;font-size:0.88rem;cursor:pointer;font-family:'EB Garamond',Georgia,serif;letter-spacing:0.02em;">Exit Room</button>
        ${canControl ? `<button id="roomPauseBtn" style="background:#A0845C;color:#fff;border:none;border-radius:6px;padding:0.5rem 0.85rem;font-size:0.88rem;cursor:pointer;font-family:'EB Garamond',Georgia,serif;letter-spacing:0.02em;">${(room.status || 'active') === 'paused' ? 'Resume Room' : 'Pause Room'}</button>` : ''}
        ${canControl ? `<button id="roomDeleteBtn" style="background:#5a0a0a;color:#fff;border:none;border-radius:6px;padding:0.5rem 0.85rem;font-size:0.88rem;cursor:pointer;font-family:'EB Garamond',Georgia,serif;letter-spacing:0.02em;opacity:0.85;">Delete Room</button>` : ''}
      </div>

      <div id="roomGuideArea" style="display:none;">
        <div class="guide-header-bar">
          <h3 id="roomGuideTitle"></h3>
          <span id="roomGuideBadge" class="guide-badge"></span>
        </div>
        <div id="roomGuideAuthor" style="display:none;font-size:0.85rem;color:#6B4226;font-style:italic;margin:0.15rem 0 0.35rem;"></div>
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
  <script>
    window.ROOM_CODE    = ${JSON.stringify(room.code)};
    window.CURRENT_USER = ${JSON.stringify({ id: userId, name: userName, email: user ? user.email : '' })};
    window.ROOM_HOST    = ${JSON.stringify(hostEmail)};
    window.ROOM_STUDY       = ${room.study ? JSON.stringify(room.study) : 'null'};
    window.ROOM_CHAT        = ${JSON.stringify(room.chat || [])};
    window.IS_ADMIN         = ${getIsAdmin(req)};
  </script>
  <script src="/js/study-badges.js?v=2"></script>
  <script src="/js/render-markdown.js?v=1"></script>
  <script src="/js/enhance-further-studies.js?v=2"></script>
  <script src="/js/room.js?v=24"></script>
  <script src="/js/library.js?v=56"></script>`,
  }));
});

// ─── POST /api/rooms/:code/save-study ────────────────────────────────────────

router.post('/api/rooms/:code/save-study', requireAuth, (req, res) => {
  const code  = req.params.code.toUpperCase();
  const rooms = readRooms();
  const idx   = rooms.findIndex(r => r.code === code);

  if (idx === -1) return res.status(404).json({ success: false, error: 'Room not found.' });

  const { topic, content, translation, author } = req.body;
  const study = { topic: topic || '', content: content || '', translation: translation || '' };
  // Attribution is additive: only community-loaded studies pass an author, so a
  // library load writes the exact same three-field record as before.
  if (author) study.author = author;
  rooms[idx].study = study;
  writeRooms(rooms);

  res.json({ success: true });
});

// ─── Chat persistence ─────────────────────────────────────────────────────────

const CHAT_HISTORY_LIMIT = 100;

// Stable, unique-enough id for a chat record. Timestamp-based so records sort by
// creation; the random suffix guards against collisions inside the same ms.
// Nothing reads it yet — it exists so a future per-message delete has a handle
// without a second migration.
function makeChatId() {
  return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Single choke point for appending to a room's chat history — used by both the
// typed-message HTTP endpoint below and the tooltip-broadcast socket handler in
// server.js. Keeping the read/push/cap/write here means the 100-entry cap and
// the on-disk shape can never drift between the two writers. Returns false if
// the room does not exist.
function appendChatEntry(code, entry) {
  const rooms = readRooms();
  const idx   = rooms.findIndex(r => r.code === code);
  if (idx === -1) return false;

  if (!Array.isArray(rooms[idx].chat)) rooms[idx].chat = [];
  rooms[idx].chat.push(entry);

  if (rooms[idx].chat.length > CHAT_HISTORY_LIMIT) {
    rooms[idx].chat = rooms[idx].chat.slice(-CHAT_HISTORY_LIMIT);
  }

  writeRooms(rooms);
  return true;
}

// ─── POST /api/rooms/:code/chat ──────────────────────────────────────────────

router.post('/api/rooms/:code/chat', requireAuth, (req, res) => {
  const code = req.params.code.toUpperCase();

  const { senderName, message, id } = req.body;
  if (!message || !String(message).trim()) {
    return res.status(400).json({ success: false, error: 'Message is required.' });
  }

  // Accept a client-supplied id so the sender's optimistic echo, the live relay
  // to other members, and the persisted record all share one id — which is what
  // lets any of them be targeted for deletion. Fall back to a server id if the
  // client omitted it or sent something outside the makeChatId charset.
  const safeId = (typeof id === 'string' && /^[a-z0-9]{1,40}$/i.test(id)) ? id : makeChatId();

  const ok = appendChatEntry(code, {
    type:       'message',
    id:         safeId,
    senderName: String(senderName || 'Anonymous').trim(),
    message:    String(message).trim(),
  });
  if (!ok) return res.status(404).json({ success: false, error: 'Room not found.' });

  res.json({ success: true });
});

// ─── DELETE /api/rooms/:code/chat/:id ────────────────────────────────────────
// Remove a single chat entry (typed message or shared tooltip card) by id.
// Authorized host || admin, matching the existing room-action convention.
// Legacy records written before ids existed cannot be targeted (they have no
// id); they age out of the 100-entry cap instead. No migration is performed.

router.delete('/api/rooms/:code/chat/:id', requireAuth, (req, res) => {
  const code  = req.params.code.toUpperCase();
  const rooms = readRooms();
  const idx   = rooms.findIndex(r => r.code === code);

  if (idx === -1) return res.status(404).json({ success: false, error: 'Room not found.' });

  const isHost  = rooms[idx].host === req.session.userId;
  const isAdmin = getIsAdmin(req);
  if (!isHost && !isAdmin) {
    return res.status(403).json({ success: false, error: 'Not authorized.' });
  }

  const targetId = req.params.id;
  const chat     = Array.isArray(rooms[idx].chat) ? rooms[idx].chat : [];
  const kept     = chat.filter(m => !(m && m.id === targetId));

  if (kept.length === chat.length) {
    return res.status(404).json({ success: false, error: 'Message not found.' });
  }

  rooms[idx].chat = kept;
  writeRooms(rooms);

  // Broadcast so the entry disappears for every member currently in the room,
  // not just the person who deleted it.
  const io = req.app.locals.io;
  if (io) io.to(code).emit('room-chat-deleted', { id: targetId });

  res.json({ success: true });
});

// ─── DELETE /api/rooms/:code/study ───────────────────────────────────────────

router.delete('/api/rooms/:code/study', requireAuth, (req, res) => {
  const code  = req.params.code.toUpperCase();
  const rooms = readRooms();
  const idx   = rooms.findIndex(r => r.code === code);

  if (idx === -1) return res.status(404).json({ success: false, error: 'Room not found.' });
  if (rooms[idx].host !== req.session.userId) {
    return res.status(403).json({ success: false, error: 'Not authorized.' });
  }

  rooms[idx].study = null;
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
    status:      'active',
    study:       null,
    chat:        [],
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

// ─── PATCH /api/rooms/:code/pause ────────────────────────────────────────────

router.patch('/api/rooms/:code/pause', requireAuth, (req, res) => {
  const code  = req.params.code.toUpperCase();
  const rooms = readRooms();
  const idx   = rooms.findIndex(r => r.code === code);

  if (idx === -1) return res.status(404).json({ success: false, error: 'Room not found.' });
  if (rooms[idx].host !== req.session.userId && !getIsAdmin(req)) {
    return res.status(403).json({ success: false, error: 'Not authorized.' });
  }

  rooms[idx].status = 'paused';
  writeRooms(rooms);

  const io = req.app.locals.io;
  if (io) io.to(code).emit('room-paused', { code });

  res.json({ success: true });
});

// ─── PATCH /api/rooms/:code/resume ───────────────────────────────────────────

router.patch('/api/rooms/:code/resume', requireAuth, (req, res) => {
  const code  = req.params.code.toUpperCase();
  const rooms = readRooms();
  const idx   = rooms.findIndex(r => r.code === code);

  if (idx === -1) return res.status(404).json({ success: false, error: 'Room not found.' });
  if (rooms[idx].host !== req.session.userId && !getIsAdmin(req)) {
    return res.status(403).json({ success: false, error: 'Not authorized.' });
  }

  rooms[idx].status = 'active';
  writeRooms(rooms);

  const io = req.app.locals.io;
  if (io) io.to(code).emit('room-resumed', { code });

  res.json({ success: true });
});

// ─── GET /api/rooms/list ──────────────────────────────────────────────────────

router.get('/api/rooms/list', requireAuth, (req, res) => {
  const rooms = readRooms();
  const io    = req.app.locals.io;
  const roomsOut = rooms.map(room => {
    const liveCount = io ? (io.sockets.adapter.rooms.get(room.code)?.size ?? 0) : 0;
    return Object.assign({}, room, { liveCount });
  });
  res.json({ success: true, rooms: roomsOut });
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

// Exposed so server.js's tooltip-broadcast socket handler can persist a shared
// result through the same choke point the typed-chat endpoint uses.
router.appendChatEntry = appendChatEntry;
router.makeChatId      = makeChatId;

module.exports = router;
