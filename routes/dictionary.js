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

const PROMPT_COMMON =
  "Define this word in plain simple English in 2 sentences maximum. " +
  "First sentence: what the word means in everyday use. " +
  "Second sentence: an example of how it is used. " +
  "No theology. No jargon. Write like you are texting a friend.";

const PROMPT_THEOLOGICAL =
  "You are a friendly Bible study helper. Explain this theological term in plain English first — " +
  "what it means in simple words. Then one sentence on why it matters in Reformed theology. " +
  "Maximum 2-3 sentences. Avoid jargon where possible.";

async function fetchAnthropicDefinition(term, theological) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const message = await client.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 150,
    system:     theological ? PROMPT_THEOLOGICAL : PROMPT_COMMON,
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
      const definition = await fetchAnthropicDefinition(cleanTerm, true);
      return res.json({ term: cleanTerm, definition, source: 'theological' });
    } catch (err) {
      console.error('[Dictionary/theological]', err.message);
      return res.json({ error: 'Definition unavailable. Try again.' });
    }
  }

  // Single common word — Dictionary API only, no Anthropic fallback
  try {
    const definition = await fetchDictionaryApi(cleanTerm);
    return res.json({ term: cleanTerm, definition, source: 'dictionary' });
  } catch (dictErr) {
    console.error('[Dictionary/common]', dictErr.message);
    return res.json({ error: 'Definition unavailable. Try again.' });
  }
});

module.exports = router;
