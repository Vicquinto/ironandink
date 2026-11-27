const path = require('path');
const { createJsonStore } = require('./jsonStore');

// data/messages.json: { threads: [ { id, participants, messages, createdAt, updatedAt } ] }.
// On the safe store (lib/jsonStore.js): a missing file is no threads, but a file
// that exists and can't be read throws, and nothing is written over it. (It used
// to read as no threads, and the next message sent wrote that back.)
const messagesStore = createJsonStore(path.join(__dirname, '../data/messages.json'), 'Messages', {
  empty: () => ({ threads: [] }),
  valid: d => !!d && typeof d === 'object' && !Array.isArray(d) && Array.isArray(d.threads),
});

// Unread messages for the member, across their threads.
function unreadCount(data, userId) {
  return data.threads
    .filter(t => t && Array.isArray(t.participants) && t.participants.includes(userId))
    .reduce((sum, t) => sum + (t.messages || []).filter(m => m && m.senderId !== userId && !(m.readBy || []).includes(userId)).length, 0);
}

// A link the SERVER puts on a message (never taken from /api/messages/send):
// { href, label }. Only links into Study Notes: a share's page, or a member's own
// Study Notes page, optionally at one item (#item=<key>). public/js/messages.js
// and dm-widget.js check the same patterns before drawing one.
const LINK_PATTERNS = [
  /^\/study-notes\/shared\/[0-9a-f-]{36}(#item=[A-Za-z0-9_-]{1,80})?$/,
  /^\/study-notes\/[A-Za-z0-9_-]{1,64}(#item=[A-Za-z0-9_-]{1,80})?$/,
];
function cleanLink(link) {
  if (!link || typeof link.href !== 'string' || typeof link.label !== 'string') return null;
  if (!LINK_PATTERNS.some(re => re.test(link.href))) return null;
  const label = link.label.trim().slice(0, 60);
  return label ? { href: link.href, label } : null;
}

module.exports = { messagesStore, unreadCount, cleanLink, LINK_PATTERNS };
