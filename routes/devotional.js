const express   = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { requireAuth, renderLayout }  = require('./layout');
const { getDailyDevotional }         = require('./dashboard');

const router = express.Router();

router.get('/devotional', requireAuth, async (req, res) => {
  const devotionalContent = await getDailyDevotional(req);
  const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const content = `
    <div class="page-header">
      <h2 class="page-title">Daily Devotional</h2>
      <p class="page-subtitle">${dateStr}</p>
    </div>

    <div class="devot-full-card">
      ${devotionalContent
        ? `<div id="devotionalContent" class="devot-content"></div>`
        : `<p class="devot-unavailable">Today's devotional is unavailable. Please try refreshing.</p>`}
    </div>

    <div class="devot-interact-card">
      <div class="devot-interact-heading">Reflect &amp; Ask</div>
      <p class="devot-interact-sub">Ask a question about today's Scripture, exposition, or application.</p>
      <div id="devotChatHistory" class="devot-chat-history"></div>
      <div class="devot-input-row">
        <input type="text" id="devotQuestion" class="devot-input"
               placeholder="What does this passage teach about…" />
        <button id="devotAskBtn" class="btn-primary">Ask</button>
      </div>
    </div>`;

  const scripts = `
  <script>
    var devotionalText   = ${JSON.stringify(devotionalContent || '')};
    var devotChatHistory = [];

    // ── Render devotional content ──────────────────────────────────────────
    (function() {
      var el = document.getElementById('devotionalContent');
      if (!el || !devotionalText) return;
      try {
        el.innerHTML = (typeof marked !== 'undefined')
          ? marked.parse(devotionalText)
          : '<pre>' + devotionalText + '</pre>';
      } catch (e) {
        console.error('Devotional render error:', e);
        el.textContent = devotionalText;
      }
    })();

    // ── Ask interaction ────────────────────────────────────────────────────
    function askDevotional() {
      var input    = document.getElementById('devotQuestion');
      var question = input ? input.value.trim() : '';
      if (!question) return;
      input.value = '';

      appendDevotMsg('user', question);

      var apiContent = devotChatHistory.length === 0
        ? "Today's devotional reading:\\n\\n" + devotionalText + "\\n\\nMy question: " + question
        : question;
      devotChatHistory.push({ role: 'user', content: apiContent });

      var btn = document.getElementById('devotAskBtn');
      if (btn) { btn.disabled = true; btn.textContent = 'Asking…'; }

      fetch('/api/devotional/ask', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ history: devotChatHistory }),
      })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (btn) { btn.disabled = false; btn.textContent = 'Ask'; }
        if (data.success) {
          appendDevotMsg('assistant', data.answer);
          devotChatHistory.push({ role: 'assistant', content: data.answer });
        } else {
          appendDevotMsg('error', data.error || 'Failed to get a response.');
        }
      })
      .catch(function() {
        if (btn) { btn.disabled = false; btn.textContent = 'Ask'; }
        appendDevotMsg('error', 'An error occurred. Please try again.');
      });
    }

    function appendDevotMsg(role, text) {
      var container = document.getElementById('devotChatHistory');
      if (!container) return;
      var el = document.createElement('div');
      el.className = 'devot-msg devot-msg--' + role;
      if (role === 'assistant') {
        try {
          el.innerHTML = (typeof marked !== 'undefined') ? marked.parse(text) : text;
        } catch(e) {
          el.textContent = text;
        }
      } else {
        el.textContent = text;
      }
      container.appendChild(el);
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // ── Wire up button and Enter key ───────────────────────────────────────
    var devotAskBtn = document.getElementById('devotAskBtn');
    if (devotAskBtn) devotAskBtn.addEventListener('click', askDevotional);

    var devotInput = document.getElementById('devotQuestion');
    if (devotInput) devotInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); askDevotional(); }
    });
  </script>`;

  res.send(renderLayout({ req, activeSection: 'dashboard', title: 'Daily Devotional', content, scripts }));
});

router.post('/api/devotional/ask', requireAuth, async (req, res) => {
  const { history } = req.body;

  if (!Array.isArray(history) || history.length === 0) {
    return res.status(400).json({ success: false, error: 'No message provided.' });
  }

  const { IRON_INK_CORE_PROMPT } = req.app.locals.prompts;
  const systemPrompt = IRON_INK_CORE_PROMPT +
    '\n\nYou are helping a student reflect on today\'s Reformed daily devotional. ' +
    'Engage thoughtfully with questions about the Scripture passage, exposition, or application. ' +
    'Be precise, pastorally warm, and doctrinally serious. Stay within the confessionally Reformed framework. ' +
    'Keep responses focused — 3–5 sentences for simple questions, more thorough for deep theological ones.';

  try {
    const client  = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const message = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 600,
      system:     systemPrompt,
      messages:   history,
    });
    res.json({ success: true, answer: message.content[0].text });
  } catch (err) {
    console.error('Devotional ask error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to get answer. Please try again.' });
  }
});

module.exports = router;
