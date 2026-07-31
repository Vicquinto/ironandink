const express        = require('express');
const fs             = require('fs');
const path           = require('path');
const Anthropic      = require('@anthropic-ai/sdk');
const { randomUUID } = require('crypto');
const { requireAuth, renderLayout } = require('./layout');
const { assertNoEsvText } = require('./esvGuard');
const { injectVerses, SCRIPTURE_RULE } = require('../lib/asv');
const { getEntitlements } = require('../lib/entitlements');

const router     = express.Router();
const SELAH_PATH = path.join(__dirname, '../data/selah.json');

// ── Member-only gate (dark unless BILLING_ENABLED=true) ──────────────────────
// Selah (private prayer, meditation & journal) is a paid-tier feature. Enforce at
// the authenticated HTTP layer using the FRESH users.json record. Returns true
// only for a real free member with billing on — always false while dark, so
// today's behavior is unchanged.
const ENT_USERS_PATH = path.join(__dirname, '../data/users.json');
function readUsersEnt() { return JSON.parse(fs.readFileSync(ENT_USERS_PATH, 'utf8')); }
function memberGated(req) {
  const ent = getEntitlements(readUsersEnt().find(u => u.id === req.session.userId));
  return ent.billingEnabled && !ent.canUseMemberFeatures;
}

function readEntries() {
  try {
    if (!fs.existsSync(SELAH_PATH)) return [];
    return JSON.parse(fs.readFileSync(SELAH_PATH, 'utf8'));
  } catch { return []; }
}

function writeEntries(entries) {
  fs.writeFileSync(SELAH_PATH, JSON.stringify(entries, null, 2));
}

// ─── GET /selah ──────────────────────────────────────────────────────────────
router.get('/selah', requireAuth, (req, res) => {
  if (memberGated(req)) return res.redirect('/pricing?from=selah');
  const userId  = req.session.userId;
  const entries = readEntries()
    .filter(e => e.userId === userId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const content = `
    <div class="page-header">
      <h2 class="page-title">Selah</h2>
      <p class="page-subtitle">A space for quiet reflection.</p>
    </div>

    <div class="selah-compose">
      <input type="text" id="selahTitle" class="selah-title-input"
             placeholder="Title (optional)" autocomplete="off">
      <textarea id="selahBody" class="selah-textarea"
                placeholder="Write freely. This is between you and God."></textarea>
      <div class="selah-cat-picker" id="selahCatPicker" aria-label="Entry category">
        <button class="selah-cat-pick-btn" data-cat="Prayer">Prayer</button>
        <button class="selah-cat-pick-btn" data-cat="Meditation">Meditation</button>
        <button class="selah-cat-pick-btn selah-cat-pick-btn--active" data-cat="Journal">Journal</button>
      </div>
      <div class="selah-compose-actions">
        <button id="saveSelahBtn" class="btn-primary">Save Entry</button>
        <button id="reflectBtn" class="btn-warm">Reflect with AI</button>
      </div>
    </div>

    <div id="selahReflect" class="selah-reflect" style="display:none;">
      <div class="selah-reflect-label">A word for your reflection</div>
      <div id="selahReflectText" class="selah-reflect-text"></div>
    </div>

    <div class="selah-entries-section">
      <h3 class="selah-entries-heading">Past Entries</h3>
      <div class="selah-filter-tabs" id="selahFilterTabs">
        <button class="selah-filter-tab active" data-filter="All">All</button>
        <button class="selah-filter-tab" data-filter="Prayer">Prayer</button>
        <button class="selah-filter-tab" data-filter="Meditation">Meditation</button>
        <button class="selah-filter-tab" data-filter="Journal">Journal</button>
      </div>
      <div id="selahEntriesList" class="selah-entries-list"></div>
    </div>`;

  const scripts = `
  <script>var SELAH_INIT_ENTRIES = ${JSON.stringify(entries)};</script>
  <script src="/js/selah.js"></script>`;

  res.send(renderLayout({
    req,
    activeSection: 'selah',
    title:         'Selah',
    content,
    scripts,
  }));
});

const VALID_CATEGORIES = ['Prayer', 'Meditation', 'Journal'];

// ─── POST /api/selah/save ────────────────────────────────────────────────────
router.post('/api/selah/save', requireAuth, (req, res) => {
  if (memberGated(req)) return res.status(402).json({ success: false, error: 'member_feature', upgradeUrl: '/pricing' });
  const { title, content, reflectionText, category } = req.body;
  if (!content || !String(content).trim()) {
    return res.status(400).json({ success: false, error: 'Entry content is required.' });
  }

  const entry = {
    id:             randomUUID(),
    userId:         req.session.userId,
    userEmail:      req.session.user.email,
    title:          title ? String(title).trim() : '',
    content:        String(content).trim(),
    reflectionText: reflectionText ? String(reflectionText).trim() : '',
    category:       VALID_CATEGORIES.includes(category) ? category : 'Journal',
    createdAt:      new Date().toISOString(),
  };

  const entries = readEntries();
  entries.push(entry);
  writeEntries(entries);
  res.json({ success: true, entry });
});

// ─── GET /api/selah/entries ──────────────────────────────────────────────────
router.get('/api/selah/entries', requireAuth, (req, res) => {
  const userId  = req.session.userId;
  const entries = readEntries()
    .filter(e => e.userId === userId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ success: true, entries });
});

// ─── DELETE /api/selah/entry/:id ─────────────────────────────────────────────
router.delete('/api/selah/entry/:id', requireAuth, (req, res) => {
  const { id }   = req.params;
  const userId   = req.session.userId;
  const entries  = readEntries();
  const filtered = entries.filter(e => !(e.id === id && e.userId === userId));
  if (filtered.length === entries.length) {
    return res.status(404).json({ success: false, error: 'Entry not found.' });
  }
  writeEntries(filtered);
  res.json({ success: true });
});

// ─── POST /api/selah/reflect ─────────────────────────────────────────────────
router.post('/api/selah/reflect', requireAuth, async (req, res) => {
  if (memberGated(req)) return res.status(402).json({ success: false, error: 'member_feature', upgradeUrl: '/pricing' });
  const { content } = req.body;
  if (!content || !String(content).trim()) {
    return res.status(400).json({ success: false, error: 'Nothing to reflect on.' });
  }

  const systemPrompt =
    'You are a gentle pastoral presence within the Selah journaling space on Iron & Ink, ' +
    'a confessionally Reformed platform. The user has written a private personal reflection, ' +
    'prayer, or journal entry. Your role is not to lecture, generate a study, or teach systematically. ' +
    'Offer a brief, warm, pastorally sensitive response of 2–3 short paragraphs. You may gently point ' +
    'to a word of Scripture, draw on the comfort of Reformed doctrine — the sovereignty of God, the ' +
    'faithfulness of Christ, the work of the Spirit — or simply affirm what is true about God in ' +
    'light of what the user has expressed. Speak directly and personally, as a wise and caring shepherd ' +
    'would to a sheep he knows. Be warm but not saccharine. Be brief. End with a sense of rest.\n\n' +
    SCRIPTURE_RULE;

  try {
    // Crossway ESV compliance: never send ESV-licensed text to Anthropic (defensive —
    // the journal entry is free text a user could paste ESV into).
    assertNoEsvText('selah/reflect', systemPrompt, String(content).trim());
    const client  = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const message = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 500,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: String(content).trim() }],
    });
    // Replace any {{verse:...}} markers with verified ASV before returning.
    res.json({ success: true, reflection: injectVerses(message.content[0].text) });
  } catch (err) {
    if (err && err.code === 'ESV_TEXT_BLOCKED') {
      console.error('ESV guard:', err.message);
      return res.status(422).json({ success: false, error: 'ESV Scripture text cannot be sent to the AI.' });
    }
    console.error('Selah reflect error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to generate reflection. Please try again.' });
  }
});

module.exports = router;
