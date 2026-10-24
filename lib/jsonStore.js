const fs = require('fs');

// A JSON-array file store for member data that must never be silently lost.
// Used by the study notepad (data/notepads.json) and the Scripture chapter notes
// (data/scripture_notes.json).
//
//   - Fail closed. A missing file is an empty store, but a file that exists and
//     can't be read or parsed throws StoreUnreadableError (and is logged). The old
//     read-as-[] fallback meant the next save overwrote the whole damaged file
//     with one record, taking every member's notes with it.
//   - Atomic write: write a temp file, then rename it over the store, so a crash
//     mid-write leaves the previous file intact rather than a truncated one.
//   - One write at a time. update() runs read → change → write as one step in a
//     per-store queue, so two saves can't both read the same old copy and have
//     the later write drop the earlier one. The queue is per process: it covers
//     pm2 fork mode with a single instance (this app), not several processes.

class StoreUnreadableError extends Error {
  constructor(label, cause) {
    super(`${label} store could not be read: ${cause && cause.message}`);
    this.name = 'StoreUnreadableError';
  }
}

function createJsonStore(filePath, label) {
  let queue = Promise.resolve();

  function read() {
    let raw;
    try {
      raw = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw unreadable(err);
    }
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1); // tolerate a BOM
    let data;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      throw unreadable(err);
    }
    if (!Array.isArray(data)) throw unreadable(new Error('expected a JSON array'));
    return data;
  }

  function unreadable(cause) {
    const err = new StoreUnreadableError(label, cause);
    console.error(`[store] ${err.message} (${filePath}) — refusing to write until it is repaired.`);
    return err;
  }

  function writeAtomic(data) {
    // pid in the temp name: during `pm2 reload` the old and new process overlap
    // for a moment, and must not write the same temp file.
    const tmp = `${filePath}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
      fs.renameSync(tmp, filePath);
    } catch (err) {
      try { fs.unlinkSync(tmp); } catch { /* already gone */ }
      throw err;
    }
  }

  // Queue a read → change → write. `change(data)` mutates the array in place
  // and returns a result object; the store is written only when the result has
  // `changed: true`. Resolves with that result. Rejects (writing nothing) if the
  // file is unreadable, `change` throws, or the write fails.
  function update(change) {
    const run = queue.then(() => {
      const data   = read();
      const result = change(data) || {};
      if (result.changed) writeAtomic(data);
      return result;
    });
    queue = run.catch(() => {}); // a failed update must not stall the ones behind it
    return run;
  }

  return { read, update };
}

module.exports = { createJsonStore, StoreUnreadableError };
