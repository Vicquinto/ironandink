require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');

const authRoutes      = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const settingsRoutes  = require('./routes/settings');
const { requireAuth, renderLayout } = require('./routes/layout');

const app  = express();
const PORT = process.env.PORT || 4000;

// ─── System Prompt Constants ───────────────────────────────────────────────
// Fill in each prompt after scaffold is confirmed working.
// Used exclusively server-side — never sent to the browser.
const IRON_INK_CORE_PROMPT      = '';
const IRON_INK_STUDY_PROMPT     = '';
const IRON_INK_DIALOGUE_PROMPT  = '';
const IRON_INK_WRITING_PROMPT   = '';
// ──────────────────────────────────────────────────────────────────────────

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret:            process.env.SESSION_SECRET || 'iron-ink-dev-secret',
  resave:            false,
  saveUninitialized: false,
  cookie:            { maxAge: 24 * 60 * 60 * 1000 }
}));

// ─── Routes ───────────────────────────────────────────────────────────────
app.use('/', authRoutes);
app.use('/', dashboardRoutes);
app.use('/', settingsRoutes);

// ─── Placeholder Sections ────────────────────────────────────────────────
const placeholders = [
  { path: '/study',       id: 'study',       label: 'Study',       icon: '&#10016;', blurb: 'Deep, guided Bible and theological study sessions are coming in a future session.' },
  { path: '/dialogue',    id: 'dialogue',    label: 'Dialogue',    icon: '&#9993;',  blurb: 'Conversational theological dialogue with AI assistance is coming in a future session.' },
  { path: '/writing',     id: 'writing',     label: 'Writing',     icon: '&#9998;',  blurb: 'Theological article and essay writing tools are coming in a future session.' },
  { path: '/library',     id: 'library',     label: 'Library',     icon: '&#8801;',  blurb: 'Your saved studies, notes, and resources will live here — coming in a future session.' },
  { path: '/community',   id: 'community',   label: 'Community',   icon: '&#9678;',  blurb: 'Community discussion and iron-sharpening fellowship is coming in a future session.' },
  { path: '/my-articles', id: 'my-articles', label: 'My Articles', icon: '&#9634;',  blurb: 'Your published and draft articles will be accessible here — coming in a future session.' },
];

placeholders.forEach(({ path: p, id, label, icon, blurb }) => {
  app.get(p, requireAuth, (req, res) => {
    const content = `
      <div class="placeholder-panel">
        <div class="placeholder-icon">${icon}</div>
        <h2 class="placeholder-title">${label}</h2>
        <p class="placeholder-text">${blurb}</p>
      </div>`;
    res.send(renderLayout({ req, activeSection: id, title: label, content }));
  });
});

// ─── Start ────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  Iron & Ink  |  http://localhost:${PORT}\n`);
});

module.exports = { IRON_INK_CORE_PROMPT, IRON_INK_STUDY_PROMPT, IRON_INK_DIALOGUE_PROMPT, IRON_INK_WRITING_PROMPT };
