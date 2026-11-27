const express  = require('express');
const fs       = require('fs');
const path     = require('path');
const { requireAuth, renderLayout } = require('./layout');
const { getOnlineList } = require('./presence');
const { escapeHtml } = require('../lib/html');
const { messagesStore, unreadCount } = require('../lib/messages-store');

const router     = express.Router();
const USERS_PATH = path.join(__dirname, '../data/users.json');

// ─── Helpers ──────────────────────────────────────────────────────────────────

// data/messages.json is on the safe store (lib/messages-store.js): read() throws
// if the file can't be read, and update() then writes nothing. Each route answers
// "unavailable" in that case, never "no messages".
const UNAVAILABLE = 'Messages are unavailable right now. Nothing was changed. Please try again later.';
function unavailable(res) { return res.status(500).json({ error: UNAVAILABLE }); }

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
  let data;
  try { data = messagesStore.read(); }
  catch {
    return res.status(500).send(renderLayout({ req, activeSection: 'messages', title: 'Messages', content: `
      <div class="page-header">
        <h2 class="page-title">Messages</h2>
        <p class="page-subtitle">${escapeHtml(UNAVAILABLE)}</p>
      </div>` }));
  }
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

  // Suspended accounts (isActive === false) aren't offered as recipients.
  const allUsers = users
    .filter(u => u.id !== userId && u.fullName && u.isActive !== false)
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
<script src="/js/messages.js?v=5"></script>`;

  res.send(renderLayout({ req, activeSection: 'messages', title: 'Messages', content, scripts }));
});

// ─── GET /api/messages/widget — compact thread list for the floating widget ───

router.get('/api/messages/widget', requireAuth, (req, res) => {
  const userId = req.session.userId;
  let data;
  try { data = messagesStore.read(); } catch { return unavailable(res); }
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

router.get('/api/messages/threads/:id', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  let r;
  try {
    // Read the thread and mark incoming messages as read, as one queued step.
    r = await messagesStore.update(data => {
      const t = data.threads.find(x => x.id === req.params.id);
      if (!t) return { changed: false, status: 404 };
      if (!t.participants.includes(userId)) return { changed: false, status: 403 };
      let changed = false;
      t.messages.forEach(m => {
        if (m.senderId !== userId && !m.readBy.includes(userId)) {
          m.readBy.push(userId);
          changed = true;
        }
      });
      return { changed, thread: JSON.parse(JSON.stringify(t)) };
    });
  } catch (err) {
    console.error('[messages] open thread:', err.message);
    return unavailable(res);
  }
  if (r.status === 404) return res.status(404).json({ error: 'Thread not found' });
  if (r.status === 403) return res.status(403).json({ error: 'Access denied' });
  const thread = r.thread;

  const users = readUsers();

  const withNames = thread.messages.map(m => ({
    ...m,
    senderName: (users.find(u => u.id === m.senderId) || {}).fullName || 'Unknown',
  }));

  res.json({ thread: { ...thread, messages: withNames } });
});

// ─── POST /api/messages/send ─────────────────────────────────────────────────

router.post('/api/messages/send', requireAuth, async (req, res) => {
  const senderId               = req.session.userId;
  const { recipientId, threadId, text } = req.body;

  if (!text || !text.trim()) return res.status(400).json({ error: 'Message text required' });

  const users = readUsers();
  if (!threadId && recipientId) {
    if (recipientId === senderId)              return res.status(400).json({ error: 'Cannot message yourself' });
    if (!users.find(u => u.id === recipientId)) return res.status(404).json({ error: 'Recipient not found' });
  } else if (!threadId) {
    return res.status(400).json({ error: 'recipientId or threadId required' });
  }

  const msg = {
    id:       genId('m'),
    senderId,
    text:     text.trim(),
    sentAt:   new Date().toISOString(),
    readBy:   [senderId],
  };

  let r;
  try {
    r = await messagesStore.update(data => {
      let thread;
      if (threadId) {
        thread = data.threads.find(t => t.id === threadId);
        if (!thread)                                 return { changed: false, status: 404 };
        if (!thread.participants.includes(senderId)) return { changed: false, status: 403 };
      } else {
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
      }
      thread.messages.push(msg);
      thread.updatedAt = msg.sentAt;
      return { changed: true, thread: { id: thread.id, participants: thread.participants.slice() } };
    });
  } catch (err) {
    console.error('[messages] send:', err.message);
    return unavailable(res);
  }
  if (r.status === 404) return res.status(404).json({ error: 'Thread not found' });
  if (r.status === 403) return res.status(403).json({ error: 'Access denied' });
  const thread = r.thread;

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
  let count;
  try { count = unreadCount(messagesStore.read(), req.session.userId); }
  catch { return unavailable(res); }
  res.json({ count });
});

module.exports = router;
