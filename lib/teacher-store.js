'use strict';

// The Study with a Teacher sessions store: data/teacher-sessions.json, one
// record per (userId, studyId, kind). Fail-closed, atomic, one write at a time
// (lib/jsonStore.js). ONE instance for the whole app: the write queue only
// protects writers that share it, so nothing else may write this file.

const path = require('path');
const { createJsonStore } = require('./jsonStore');

const sessionsStore = createJsonStore(path.join(__dirname, '../data/teacher-sessions.json'), 'Teacher sessions');

module.exports = { sessionsStore };
