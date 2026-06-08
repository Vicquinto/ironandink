const express   = require('express');
const https     = require('https');
const Anthropic = require('@anthropic-ai/sdk');
const { requireAuth } = require('./layout');

const router = express.Router();

const THEOLOGICAL_TERMS = new Set([
  'justification', 'sanctification', 'glorification', 'regeneration',
  'election', 'predestination', 'atonement', 'propitiation', 'expiation',
  'imputation', 'ordo salutis', 'union with christ', 'hypostatic union',
  'kenosis', 'penal substitution', 'covenant theology', 'federal headship',
  'total depravity', 'unconditional election', 'limited atonement',
  'irresistible grace', 'perseverance', 'antinomianism', 'supralapsarianism',
  'infralapsarianism', 'soteriology', 'ecclesiology', 'eschatology',
  'christology', 'pneumatology', 'theologia', 'volitional', 'hermeneutics',
  'exegesis', 'eisegesis', 'sola scriptura', 'sola fide', 'sola gratia',
  'solus christus', 'soli deo gloria', 'monergism', 'synergism',
  'pelagianism', 'arminianism', 'calvinism', 'reformed', 'confessional',
  'westminster', 'heidelberg', 'dort', 'belgic', 'remonstrant',
  'lapsarianism', 'perichoresis', 'communicatio idiomatum', 'anhypostasia',
  'enhypostasia', 'theosis', 'antinomy', 'compatibilism', 'libertarian',
  'archetypal', 'ectypal', 'aseity', 'impassibility', 'immutability',
  'omniscience', 'omnipotence', 'omnipresence', 'simplicity', 'transcendence',
  'immanence', 'apophatic', 'cataphatic',
]);

function isTheological(term) {
  const lower = term.toLowerCase().trim();
  if (lower.split(/\s+/).filter(Boolean).length > 1) return true;
  return THEOLOGICAL_TERMS.has(lower);
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

async function fetchAnthropicDefinition(term) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const message = await client.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 150,
    system:     "You are a helpful theological dictionary for everyday Christians. When given a word or phrase, explain it in plain, simple English first — as if explaining to a thoughtful person who is not a seminary student. Then in one sentence add how it applies in Reformed theology. Keep the total definition to 2-3 sentences maximum. Be warm and clear, not academic. Do not use jargon to explain jargon.",
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

  if (isTheological(cleanTerm)) {
    try {
      const definition = await fetchAnthropicDefinition(cleanTerm);
      return res.json({ term: cleanTerm, definition, source: 'theological' });
    } catch (err) {
      console.error('[Dictionary/theological]', err.message);
      return res.json({ error: 'Definition unavailable. Try again.' });
    }
  }

  // Single common word — try free Dictionary API first
  try {
    const definition = await fetchDictionaryApi(cleanTerm);
    return res.json({ term: cleanTerm, definition, source: 'dictionary' });
  } catch (dictErr) {
    console.error('[Dictionary/common] falling back to Anthropic:', dictErr.message);
    try {
      const definition = await fetchAnthropicDefinition(cleanTerm);
      return res.json({ term: cleanTerm, definition, source: 'theological' });
    } catch (err) {
      console.error('[Dictionary/fallback]', err.message);
      return res.json({ error: 'Definition unavailable. Try again.' });
    }
  }
});

module.exports = router;
