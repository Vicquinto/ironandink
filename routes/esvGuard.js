// ─── Crossway ESV compliance guard ───────────────────────────────────────────
// HARD RULE: ESV text retrieved from the Crossway ESV API must NEVER be included
// in any prompt or payload sent to the Anthropic API — not in the system prompt,
// not in a user/assistant message, not as context, not anywhere.
//
// This module is a defensive backstop. The primary protection is upstream: the
// app never fetches ESV into a prompt server-side, and the Scripture reader's
// tooltip withholds the Anthropic-backed actions (Define / Explore) for ESV
// selections (see public/js/library.js). This guard catches any ESV text that
// still carries its copyright notice (e.g. a saved verse-lookup result that gets
// forwarded) and throws BEFORE it can reach client.messages.create/stream.
//
// Note: a bare ESV phrase highlighted off the reader carries no copyright marker,
// so it cannot be detected here — that case is prevented on the client. This
// guard is the last line, not the only line.

// Specific markers the app appends to ESV API text. Kept specific (not a bare
// "Crossway") so ordinary theological prose can't trip a false positive.
const ESV_MARKERS = [
  'ESV® Bible',                 // "ESV® Bible"
  'Copyright © 2001 by Crossway', // "Copyright © 2001 by Crossway"
];

function containsEsvText(str) {
  if (typeof str !== 'string') return false;
  return ESV_MARKERS.some((m) => str.includes(m));
}

// Recursively collect prompt strings from anything passed to an Anthropic call:
// plain strings, a messages array, {role, content} objects, or content blocks
// [{type, text}]. Anything else is ignored.
function collectStrings(value, out) {
  if (typeof value === 'string') {
    out.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((v) => collectStrings(v, out));
  } else if (value && typeof value === 'object') {
    if (typeof value.content === 'string') out.push(value.content);
    else if (value.content != null) collectStrings(value.content, out);
    if (typeof value.text === 'string') out.push(value.text);
  }
}

// Throw if any outgoing prompt value contains ESV-licensed text. `label` names
// the call site for logs. Pass the system prompt and messages (and any other
// prompt fragments) as arguments.
function assertNoEsvText(label, ...values) {
  const strings = [];
  values.forEach((v) => collectStrings(v, strings));
  for (const s of strings) {
    if (containsEsvText(s)) {
      const err = new Error(
        'ESV_TEXT_BLOCKED: refused to send ESV-licensed text to the Anthropic API (' + label + ').'
      );
      err.code = 'ESV_TEXT_BLOCKED';
      throw err;
    }
  }
}

module.exports = { assertNoEsvText, containsEsvText };
