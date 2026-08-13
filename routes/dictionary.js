const express   = require('express');
const https     = require('https');
const fs        = require('fs');
const path      = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { requireAuth } = require('./layout');
const { injectWithAttribution, SCRIPTURE_RULE } = require('../lib/asv');
const eastons = require('../lib/eastons');

const router = express.Router();

// ─── Load Webster's dictionary asynchronously (does not block server startup) ──
const DICT_PATH    = path.join(__dirname, '../data/dictionary.json');
const websterIndex = {};
let   dictReady    = false;

fs.promises.readFile(DICT_PATH, 'utf8')
  .then(raw => {
    const entries = JSON.parse(raw);
    for (const entry of entries) {
      if (!entry.word || !entry.definitions || !entry.definitions[0]) continue;
      const key = entry.word.toLowerCase();
      if (!websterIndex[key]) websterIndex[key] = entry.definitions[0];
    }
    dictReady = true;
    console.log(`[Dict] Webster's loaded: ${Object.keys(websterIndex).length} entries`);
  })
  .catch(err => console.error('[Dict] Failed to load Webster\'s dictionary:', err.message));

// ─── Helpers ──────────────────────────────────────────────────────────────────
function isMultiWord(term) {
  return term.trim().split(/\s+/).filter(Boolean).length > 1;
}

function fetchDictionaryApi(word) {
  return new Promise(function (resolve, reject) {
    const url = 'https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(word);
    https.get(url, function (res) {
      let body = '';
      res.on('data', function (chunk) { body += chunk; });
      res.on('end', function () {
        if (res.statusCode !== 200) {
          return reject(new Error('Dictionary API status ' + res.statusCode));
        }
        try {
          const data = JSON.parse(body);
          if (!Array.isArray(data) || !data[0]) return reject(new Error('No entry found'));
          const meanings = data[0].meanings;
          if (!meanings || !meanings[0] || !meanings[0].definitions || !meanings[0].definitions[0]) {
            return reject(new Error('No definition found'));
          }
          resolve(meanings[0].definitions[0].definition);
        } catch (e) {
          reject(e);
        }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

const PROMPT_THEOLOGICAL =
  "You are a friendly Bible study helper. Explain this theological term in plain English first — " +
  "what it means in simple words. Then one sentence on why it matters in Reformed theology. " +
  "Maximum 2-3 sentences. Avoid jargon where possible.\n\n" + SCRIPTURE_RULE;

const PROMPT_COMMON =
  "Define this single English word in one plain sentence. Just the basic meaning. " +
  "No theology. No philosophy. No examples. One sentence only.\n\n" + SCRIPTURE_RULE;

async function fetchAnthropicDefinition(term, system) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const message = await client.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 150,
    system,
    messages:   [{ role: 'user', content: 'Define: ' + term }],
  });
  // Insert verified verse text (NASB primary, ASV fallback) for any {{verse:...}}
  // marker the definition emits, with the Lockman notice when NASB text appears.
  return injectWithAttribution(message.content[0].text.trim());
}

// ─── POST /api/dictionary/define ─────────────────────────────────────────────
router.post('/api/dictionary/define', requireAuth, async (req, res) => {
  const { term } = req.body;
  if (!term || !term.trim()) {
    return res.status(400).json({ error: 'Term is required.' });
  }

  const cleanTerm = term.trim();
  const key       = cleanTerm.toLowerCase();

  // 1. Easton's Bible Dictionary (offline, PRIMARY). Public-domain text, so it is
  //    safe on every path including the offline-only Scripture reader — it never
  //    involves an AI call. Handles single words and exact multi-word headwords
  //    (e.g. "Holy Ghost", "familiar spirit"). A miss returns null and we fall
  //    through to the general dictionary below.
  const eastonsHit = eastons.lookup(cleanTerm);
  if (eastonsHit) {
    // Show provenance; note the headword when plural-normalization redirected us
    // to a different base word (e.g. "Angels" → "Angel") so the reader knows.
    let sourceLabel = "Easton's Bible Dictionary";
    if (eastonsHit.word && eastonsHit.word.toLowerCase() !== key) {
      sourceLabel += ` (s.v. ${eastonsHit.word})`;
    }
    return res.json({
      term:       cleanTerm,
      definition: eastons.toMarkdown(eastonsHit),
      source:     'eastons',
      sourceLabel,
    });
  }

  // Multi-word phrase → Anthropic (Reformed theological context)
  if (isMultiWord(cleanTerm)) {
    try {
      const definition = await fetchAnthropicDefinition(cleanTerm, PROMPT_THEOLOGICAL);
      return res.json({ term: cleanTerm, definition, source: 'theological', sourceLabel: 'Iron & Ink (AI, Reformed context)' });
    } catch (err) {
      console.error('[Dict] Anthropic error:', err.message);
      return res.json({ error: 'Definition unavailable. Try again.' });
    }
  }

  // Single word → Webster's local index first (falls through if still loading)
  if (dictReady && websterIndex[key]) {
    return res.json({ term: cleanTerm, definition: websterIndex[key], source: 'dictionary', sourceLabel: "Webster's Dictionary" });
  }

  // Not in Webster's → free Dictionary API, then Anthropic plain-English fallback
  try {
    const definition = await fetchDictionaryApi(cleanTerm);
    return res.json({ term: cleanTerm, definition, source: 'dictionary', sourceLabel: 'Dictionary' });
  } catch {
    try {
      const definition = await fetchAnthropicDefinition(cleanTerm, PROMPT_COMMON);
      return res.json({ term: cleanTerm, definition, source: 'dictionary', sourceLabel: 'Iron & Ink (AI)' });
    } catch (err) {
      console.error('[Dict] Anthropic error:', err.message);
      return res.json({ error: 'Definition unavailable. Try again.' });
    }
  }
});

module.exports = router;
