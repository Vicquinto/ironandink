const express  = require('express');
const fs       = require('fs');
const path     = require('path');
const { requireAuth, renderLayout } = require('./layout');
const { getOnlineList } = require('./presence');

const router     = express.Router();
const DATA_PATH  = path.join(__dirname, '../data/messages.json');
const USERS_PATH = path.join(__dirname, '../data/users.json');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readData() {
  try {
    if (!fs.existsSync(DATA_PATH)) return { threads: [] };
    return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  } catch { return { threads: [] }; }
}

function writeData(data) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
}

function readUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_PATH, 'utf8')); }
  catch { return []; }
}

function safeJson(obj) {
  return JSON.stringify(obj)
    .replace(/<\/script/gi, '<\\/script')
    .replace(/<!--/g, '<\\!--');
}

function genId(prefix) {
  return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

// ─── GET /messages — inbox page ───────────────────────────────────────────────

router.get('/messages', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const data   = readData();
  const users  = readUsers();

  const myThreads = data.threads
    .filter(t => t.participants.includes(userId))
    .map(t => {
      const otherId   = t.participants.find(p => p !== userId);
      const otherUser = users.find(u => u.id === otherId) || {};
      const lastMsg   = t.messages[t.messages.length - 1] || null;
      return {
        id:        t.id,
        otherId,
        otherName: otherUser.fullName || 'Unknown',
        lastText:  lastMsg ? lastMsg.text : '',
        lastAt:    lastMsg ? lastMsg.sentAt : (t.createdAt || ''),
        unread:    t.messages.filter(m => m.senderId !== userId && !m.readBy.includes(userId)).length,
      };
    })
    .sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));

  const allUsers = users
    .filter(u => u.id !== userId && u.fullName)
    .map(u => ({ id: u.id, fullName: u.fullName }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));

  const content = `
  <div class="dm-layout">

    <!-- ── Left: thread list ── -->
    <div class="dm-inbox" id="dmInbox">
      <div class="dm-inbox-header">
        <span class="dm-inbox-title">Messages</span>
        <button class="dm-new-btn" id="dmNewBtn">+ New</button>
      </div>
      <div id="dmOnlinePanel"></div>
      <div class="dm-thread-list" id="dmThreadList"></div>
      <p class="dm-empty-inbox" id="dmEmpty" style="display:none;">
        No conversations yet.<br>Press <strong>+ New</strong> to start one.
      </p>
    </div>

    <!-- ── Right: conversation ── -->
    <div class="dm-view" id="dmView">
      <div class="dm-placeholder" id="dmPlaceholder">
        Select a conversation or start a new one.
      </div>
    </div>

  </div>

  <!-- ── New Message modal ── -->
  <div class="dm-overlay" id="dmOverlay" style="display:none;" role="dialog" aria-modal="true">
    <div class="dm-modal">
      <div class="dm-modal-header">
        <span>New Message</span>
        <button class="dm-modal-close" id="dmModalClose" aria-label="Close">&#10005;</button>
      </div>
      <input type="text" class="dm-search-input" id="dmSearchInput"
             placeholder="Search members&#8230;" autocomplete="off">
      <div class="dm-member-list" id="dmMemberList"></div>
    </div>
  </div>`;

  const userSockets = req.app.locals.userSockets || new Map();
  const onlineList  = getOnlineList(userSockets);

  const scripts = `
<script>
window.__dm       = ${safeJson({ threads: myThreads, users: allUsers, me: userId })};
window.__presence = ${safeJson({ online: onlineList })};
</script>
<script src="/js/messages.js?v=4"></script>`;

  res.send(renderLayout({ req, activeSection: 'messages', title: 'Messages', content, scripts }));
});

// ─── GET /api/messages/widget — compact thread list for the floating widget ───

router.get('/api/messages/widget', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const data   = readData();
  const users  = readUsers();

  const myThreads = data.threads
    .filter(t => t.participants.includes(userId))
    .map(t => {
      const otherId   = t.participants.find(p => p !== userId);
      const otherUser = users.find(u => u.id === otherId) || {};
      const lastMsg   = t.messages[t.messages.length - 1] || null;
      return {
        id:        t.id,
        otherId,
        otherName: otherUser.fullName || 'Unknown',
        lastText:  lastMsg ? lastMsg.text : '',
        lastAt:    lastMsg ? lastMsg.sentAt : (t.createdAt || ''),
        unread:    t.messages.filter(m => m.senderId !== userId && !m.readBy.includes(userId)).length,
      };
    })
    .sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));

  const userSocketsW = req.app.locals.userSockets || new Map();
  const onlineListW  = getOnlineList(userSocketsW);

  res.json({ threads: myThreads, me: userId, online: onlineListW });
});

// ─── GET /api/messages/threads/:id ────────────────────────────────────────────

router.get('/api/messages/threads/:id', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const data   = readData();
  const thread = data.threads.find(t => t.id === req.params.id);

  if (!thread)                               return res.status(404).json({ error: 'Thread not found' });
  if (!thread.participants.includes(userId)) return res.status(403).json({ error: 'Access denied' });

  const users = readUsers();

  // mark incoming messages as read
  let changed = false;
  thread.messages.forEach(m => {
    if (m.senderId !== userId && !m.readBy.includes(userId)) {
      m.readBy.push(userId);
      changed = true;
    }
  });
  if (changed) writeData(data);

  const withNames = thread.messages.map(m => ({
    ...m,
    senderName: (users.find(u => u.id === m.senderId) || {}).fullName || 'Unknown',
  }));

  res.json({ thread: { ...thread, messages: withNames } });
});

// ─── POST /api/messages/send ─────────────────────────────────────────────────

router.post('/api/messages/send', requireAuth, (req, res) => {
  const senderId               = req.session.userId;
  const { recipientId, threadId, text } = req.body;

  if (!text || !text.trim()) return res.status(400).json({ error: 'Message text required' });

  const data  = readData();
  const users = readUsers();
  let thread;

  if (threadId) {
    thread = data.threads.find(t => t.id === threadId);
    if (!thread)                               return res.status(404).json({ error: 'Thread not found' });
    if (!thread.participants.includes(senderId)) return res.status(403).json({ error: 'Access denied' });
  } else if (recipientId) {
    if (recipientId === senderId)              return res.status(400).json({ error: 'Cannot message yourself' });
    if (!users.find(u => u.id === recipientId)) return res.status(404).json({ error: 'Recipient not found' });

    thread = data.threads.find(t =>
      t.participants.includes(senderId) && t.participants.includes(recipientId)
    );

    if (!thread) {
      thread = {
        id:           genId('t'),
        participants: [senderId, recipientId],
        messages:     [],
        createdAt:    new Date().toISOString(),
        updatedAt:    new Date().toISOString(),
      };
      data.threads.push(thread);
    }
  } else {
    return res.status(400).json({ error: 'recipientId or threadId required' });
  }

  const msg = {
    id:       genId('m'),
    senderId,
    text:     text.trim(),
    sentAt:   new Date().toISOString(),
    readBy:   [senderId],
  };

  thread.messages.push(msg);
  thread.updatedAt = msg.sentAt;

  writeData(data);

  // ── Real-time delivery to recipient ──────────────────────────────────────
  const recipientId2 = thread.participants.find(p => p !== senderId);
  const io           = req.app.locals.io;
  const userSockets  = req.app.locals.userSockets;
  if (io && userSockets && recipientId2) {
    const recipSockets = userSockets.get(recipientId2);
    if (recipSockets && recipSockets.size > 0) {
      const senderUser = users.find(u => u.id === senderId) || {};
      const payload = {
        threadId:   thread.id,
        message:    { ...msg, senderName: senderUser.fullName || 'Unknown' },
        senderName: senderUser.fullName || 'Unknown',
      };
      recipSockets.forEach(socketId => {
        io.to(socketId).emit('dm:new-message', payload);
      });
    }
  }

  res.json({ ok: true, threadId: thread.id, messageId: msg.id });
});

// ─── GET /api/messages/unread-count ──────────────────────────────────────────

router.get('/api/messages/unread-count', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const data   = readData();
  const count  = data.threads
    .filter(t => t.participants.includes(userId))
    .reduce((sum, t) => {
      return sum + t.messages.filter(m => m.senderId !== userId && !m.readBy.includes(userId)).length;
    }, 0);
  res.json({ count });
});

module.exports = router;
