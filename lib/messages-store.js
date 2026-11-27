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

module.exports = { messagesStore, unreadCount };
