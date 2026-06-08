const express   = require('express');
const https     = require('https');
const fs        = require('fs');
const path      = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { requireAuth } = require('./layout');

const router = express.Router();

// ─── Load Webster's dictionary at module init (once on server startup) ────────
const DICT_PATH   = path.join(__dirname, '../data/dictionary.json');
const websterIndex = {};

try {
  const entries = JSON.parse(fs.readFileSync(DICT_PATH, 'utf8'));
  for (const entry of entries) {
    if (!entry.word || !entry.definitions || !entry.definitions[0]) continue;
    const key = entry.word.toLowerCase();
    if (!websterIndex[key]) {
      websterIndex[key] = entry.definitions[0];
    }
  }
  console.log(`[Dict] Webster's loaded: ${Object.keys(websterIndex).length} entries`);
} catch (err) {
  console.error('[Dict] Failed to load Webster\'s dictionary:', err.message);
}

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
  "Maximum 2-3 sentences. Avoid jargon where possible.";

async function fetchAnthropicDefinition(term) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const message = await client.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 150,
    system:     PROMPT_THEOLOGICAL,
    messages:   [{ role: 'user', content: 'Define: ' + term }],
  });
  return message.content[0].text.trim();
}

// ─── POST /api/dictionary/define ─────────────────────────────────────────────
router.post('/api/dictionary/define', requireAuth, async (req, res) => {
  const { term } = req.body;
  if (!term || !term.trim()) {
    return res.status(400).json({ error: 'Term is required.' });
  }

  const cleanTerm = term.trim();
  const key       = cleanTerm.toLowerCase();

  // Multi-word phrase → Anthropic (Reformed theological context)
  if (isMultiWord(cleanTerm)) {
    try {
      const definition = await fetchAnthropicDefinition(cleanTerm);
      return res.json({ term: cleanTerm, definition, source: 'theological' });
    } catch (err) {
      console.error('[Dict] Anthropic error:', err.message);
      return res.json({ error: 'Definition unavailable. Try again.' });
    }
  }

  // Single word → Webster's local index first
  if (websterIndex[key]) {
    return res.json({ term: cleanTerm, definition: websterIndex[key], source: 'dictionary' });
  }

  // Not in Webster's → free Dictionary API fallback
  try {
    const definition = await fetchDictionaryApi(cleanTerm);
    return res.json({ term: cleanTerm, definition, source: 'dictionary' });
  } catch (dictErr) {
    console.error('[Dict] DictAPI error:', dictErr.message);
    return res.json({ error: 'Definition unavailable. Try again.' });
  }
});

module.exports = router;
