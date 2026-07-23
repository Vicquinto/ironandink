const express = require('express');
const router  = express.Router();
const { requireAuth, renderLayout } = require('./layout');
const { WHATS_NEW, COMING_SOON } = require('../data/whats-new');

// Escape user-facing text before it goes into HTML. The changelog content lives
// in a JS data file (data/whats-new.js) and is trusted, but we escape anyway so
// characters like & and < in future entries render correctly and safely.
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Turn a plain-text body (blank-line-separated paragraphs) into <p> blocks.
function renderParagraphs(body) {
  return String(body)
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => `<p class="wn-body">${esc(p)}</p>`)
    .join('');
}

// Render a single changelog entry (date heading + title + body paragraphs).
function renderEntry(entry) {
  return `
    <article class="wn-entry">
      <div class="wn-entry-head">
        <span class="wn-date">${esc(entry.date)}</span>
        <h2 class="wn-title">${esc(entry.title)}</h2>
      </div>
      ${renderParagraphs(entry.body)}
    </article>`;
}

// Render a single Coming Soon item — same card as a changelog entry, minus the
// date (these haven't shipped, so there is nothing to date them by).
function renderComingSoon(item) {
  return `
    <article class="wn-entry wn-soon">
      <div class="wn-entry-head">
        <h3 class="wn-title">${esc(item.title)}</h3>
      </div>
      ${renderParagraphs(item.body)}
    </article>`;
}

// Compact panel for the Dashboard: most recent N entries + a link to the full
// page. Exported so dashboard.js can drop it into its own layout natively.
function renderDashboardPanel(limit = 2) {
  const entries = WHATS_NEW.slice(0, limit).map(e => `
    <div class="wn-panel-entry">
      <div class="wn-panel-entry-head">
        <span class="wn-panel-title">${esc(e.title)}</span>
        <span class="wn-panel-date">${esc(e.date)}</span>
      </div>
      ${renderParagraphs(e.body)}
    </div>`).join('');

  return `
    <style>
      .wn-panel {
        background: var(--card-bg);
        border: 1px solid rgba(160,132,92,0.2);
        border-left: 3px solid var(--accent);
        border-radius: 6px;
        padding: 22px 26px;
        margin-bottom: 32px;
      }
      .wn-panel-header {
        font-size: 1rem;
        color: var(--warm-brown);
        text-transform: uppercase;
        letter-spacing: 0.1em;
        margin-bottom: 16px;
      }
      .wn-panel-entry { margin-bottom: 18px; }
      .wn-panel-entry + .wn-panel-entry {
        padding-top: 18px;
        border-top: 1px solid rgba(160,132,92,0.18);
      }
      .wn-panel-entry-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 6px;
      }
      .wn-panel-title {
        font-family: 'Cinzel', serif;
        font-size: 1.05rem;
        font-weight: 600;
        color: var(--accent);
        letter-spacing: 0.02em;
      }
      .wn-panel-date {
        font-size: 0.78rem;
        color: var(--warm-brown);
        text-transform: uppercase;
        letter-spacing: 0.08em;
        white-space: nowrap;
      }
      .wn-panel .wn-body {
        font-family: 'EB Garamond', Georgia, serif;
        font-size: 1rem;
        line-height: 1.7;
        color: var(--text);
        margin-bottom: 8px;
      }
      .wn-panel .wn-body:last-child { margin-bottom: 0; }
      .wn-panel-link {
        display: inline-block;
        margin-top: 14px;
        font-size: 0.9rem;
        color: var(--accent);
        text-decoration: none;
        letter-spacing: 0.02em;
      }
      .wn-panel-link:hover { text-decoration: underline; }
    </style>
    <section class="wn-panel">
      <div class="wn-panel-header">What&#39;s New</div>
      ${entries}
      <a href="/whats-new" class="wn-panel-link">See all updates &#8594;</a>
    </section>`;
}

const PAGE_STYLES = `
  <style>
    .wn-wrap { max-width: 760px; margin: 0 auto; }
    .wn-page-header { margin-bottom: 8px; }
    .wn-page-title {
      font-family: 'Cinzel', serif;
      font-size: 1.9rem;
      font-weight: 700;
      color: var(--accent);
      letter-spacing: 0.04em;
    }
    .wn-page-subtitle {
      font-size: 1.05rem;
      color: var(--warm-brown);
      font-style: italic;
      margin-top: 4px;
      margin-bottom: 30px;
    }
    .wn-entry {
      background: var(--card-bg);
      border: 1px solid rgba(160,132,92,0.2);
      border-left: 3px solid var(--accent);
      border-radius: 6px;
      padding: 22px 28px;
      margin-bottom: 22px;
    }
    .wn-entry-head { margin-bottom: 12px; }
    .wn-date {
      display: block;
      font-size: 0.85rem;
      color: var(--warm-brown);
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin-bottom: 4px;
    }
    .wn-title {
      font-family: 'Cinzel', serif;
      font-size: 1.25rem;
      font-weight: 600;
      color: var(--accent);
      letter-spacing: 0.02em;
    }
    .wn-body {
      font-family: 'EB Garamond', Georgia, serif;
      font-size: 1.08rem;
      line-height: 1.8;
      color: var(--text);
      margin-bottom: 12px;
    }
    .wn-body:last-child { margin-bottom: 0; }
    .wn-divider {
      border: none;
      border-top: 1px solid rgba(92,26,40,0.25);
      margin: 40px 0 32px;
    }
    .wn-soon-heading {
      font-family: 'Cinzel', serif;
      font-size: 1.4rem;
      font-weight: 700;
      color: var(--accent);
      letter-spacing: 0.03em;
      margin-bottom: 18px;
    }
    .wn-soon { background: rgba(255,255,255,0.06); }
    .wn-soon-list { margin-bottom: 40px; }
    .wn-soon-list .wn-entry:last-child { margin-bottom: 0; }
    .wn-contact {
      font-family: 'EB Garamond', Georgia, serif;
      font-size: 1.05rem;
      line-height: 1.8;
      color: var(--text);
      font-style: italic;
      margin-bottom: 32px;
    }
    .wn-contact a { color: var(--accent); text-decoration: none; font-style: normal; }
    .wn-contact a:hover { text-decoration: underline; }
    .wn-back {
      font-size: 0.9rem;
      color: var(--warm-brown);
    }
    .wn-back a { color: var(--accent); text-decoration: none; }
    .wn-back a:hover { text-decoration: underline; }
  </style>`;

router.get('/whats-new', requireAuth, (req, res) => {
  const entriesHTML = WHATS_NEW.map(renderEntry).join('');

  // Coming Soon renders nothing at all when the array is empty — no heading,
  // no divider, no stray whitespace.
  const comingSoonHTML = COMING_SOON.length ? `
      <hr class="wn-divider">

      <section class="wn-soon-list">
        <h2 class="wn-soon-heading">Coming Soon</h2>
        ${COMING_SOON.map(renderComingSoon).join('')}
      </section>` : '';

  const content = `
    ${PAGE_STYLES}
    <div class="wn-wrap">
      <div class="wn-page-header">
        <h1 class="wn-page-title">What&#39;s New</h1>
        <p class="wn-page-subtitle">Updates to the platform, newest first.</p>
      </div>

      ${entriesHTML}
${comingSoonHTML}

      <p class="wn-contact">Iron &amp; Ink is in active early access and is being built continually. If you have questions, run into a problem, or have an idea for something that would make it more useful, write to us at <a href="mailto:contact@ironandinktheology.com">contact@ironandinktheology.com</a>.</p>

      <div class="wn-back">
        <a href="/dashboard">&#8592; Back to Dashboard</a>
      </div>
    </div>`;

  res.send(renderLayout({
    req,
    activeSection: 'dashboard',
    title: "What's New",
    content,
  }));
});

module.exports = router;
module.exports.renderDashboardPanel = renderDashboardPanel;
