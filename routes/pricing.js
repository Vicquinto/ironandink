// ─── Pricing / Upgrade page ──────────────────────────────────────────────────
// Standalone public router (same shape as routes/copyright.js): self-contained
// HTML that borrows only the shared CSS variables from styles.css. The page
// ALWAYS renders so it can be previewed during the dark launch, but the Subscribe
// buttons only *function* when BILLING_ENABLED is true AND the visitor is logged
// in. While dark, they render as a disabled "Coming soon" state.
//
// Framing is honest per the locked rules: Free members can always JOIN Live Rooms
// to study alongside others; the paid tier unlocks unlimited studies plus the
// ability to HOST and lead your own room. Never imply free members are shut out.

const express = require('express');
const router  = express.Router();
const { BILLING_ENABLED, PRICING, FREE_STUDY_LIMIT } = require('../lib/entitlements');

router.get('/pricing', (req, res) => {
  const loggedIn = !!(req.session && req.session.userId);

  // Button behavior:
  //  • dark (billing off): disabled "Coming soon"
  //  • billing on + logged out: send to login first
  //  • billing on + logged in: POST /api/billing/checkout, redirect to Checkout url
  function subscribeButton(planKey) {
    if (!BILLING_ENABLED) {
      return `<button class="pricing-btn" type="button" disabled aria-disabled="true">Coming soon</button>`;
    }
    if (!loggedIn) {
      return `<a class="pricing-btn" href="/login">Sign in to subscribe</a>`;
    }
    return `<button class="pricing-btn" type="button" data-plan="${planKey}" onclick="startCheckout('${planKey}')">Subscribe</button>`;
  }

  const m = PRICING.monthly;
  const a = PRICING.annual;

  // Both columns render from the SAME ordered row list so the eye compares
  // row-by-row. Included => maroon check; member-only on the Free column => a
  // muted grey dash (reads as "available above", not a hard "no"); the two study
  // rows show quantities.
  const CHECK = '<span class="feat-check">&#10003;</span>';
  const DASH  = '<span class="feat-dash">&ndash;</span>';
  const ROWS = [
    { label: 'Bible studies',                                          free: `${FREE_STUDY_LIMIT} / month`, member: 'Unlimited' },
    { label: "Children&#39;s studies",                                 free: 'within your 5',               member: 'Unlimited' },
    { label: 'Full Scripture',                                         free: CHECK,                         member: CHECK },
    { label: 'Join any Live Room',                                     free: CHECK,                         member: CHECK },
    { label: 'Dialogue',                                               free: DASH,                          member: CHECK },
    { label: 'Article &amp; writing',                                  free: DASH,                          member: CHECK },
    { label: 'Selah &mdash; private prayer, meditation &amp; journal', free: DASH,                          member: CHECK },
    { label: 'Host &amp; lead your own Live Rooms',                    free: DASH,                          member: CHECK },
  ];
  function rowsFor(col) {
    return ROWS.map(r => {
      const val   = r[col];
      const muted = val === DASH;
      return `<li class="feat-row${muted ? ' feat-row--muted' : ''}"><span class="feat-name">${r.label}</span><span class="feat-val">${val}</span></li>`;
    }).join('');
  }

  const content = `
    <div class="pricing-card">
      <div class="pricing-site-name">Iron &amp; Ink</div>
      <h1 class="pricing-title">Membership</h1>
      <p class="pricing-lede">
        Iron &amp; Ink stays open for study and fellowship. Membership lifts the
        limits and lets you gather others under your own roof.
      </p>

      <div class="pricing-grid">
        <div class="plan">
          <div class="plan-name">Free</div>
          <div class="plan-price"><span class="plan-amount">$0</span></div>
          <div class="plan-alt" aria-hidden="true">&nbsp;</div>
          <ul class="plan-features">
            ${rowsFor('free')}
          </ul>
          <div class="plan-cta plan-cta--muted">Your current home</div>
        </div>

        <div class="plan plan--featured">
          <div class="plan-name">Member</div>
          <div class="plan-price">
            <span class="plan-amount">${m.amount}</span><span class="plan-per">/${m.per}</span>
          </div>
          <div class="plan-alt">or ${a.amount}/${a.per}</div>
          <ul class="plan-features">
            ${rowsFor('member')}
          </ul>
          <div class="plan-cta">
            ${subscribeButton(m.key)}
            ${BILLING_ENABLED && loggedIn ? `<button class="pricing-btn pricing-btn--ghost" type="button" data-plan="${a.key}" onclick="startCheckout('${a.key}')">Subscribe annually &mdash; ${a.amount}/${a.per}</button>` : ''}
          </div>
        </div>
      </div>

      <p class="pricing-hardship">
        If cost is a genuine barrier, write to us at
        <a href="mailto:contact@ironandinktheology.com">contact@ironandinktheology.com</a>
        before you go without &mdash; we'll find a way.
      </p>

      <div class="pricing-back">
        <a href="${loggedIn ? '/dashboard' : '/'}">&#8592; Back</a>
      </div>
    </div>`;

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Membership — Iron &amp; Ink</title>
  <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/styles.css?v=72">
  <link rel="icon" href="/favicon.ico" type="image/x-icon">
  <style>
    body { font-family: 'EB Garamond', Georgia, serif; }
    .pricing-wrap { min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; padding: 60px 24px 80px; background: var(--bg); }
    .pricing-card { width: 100%; max-width: 820px; background: rgba(255,255,255,0.08); border: 1px solid rgba(92,26,40,0.2); border-radius: 6px; padding: 40px 48px; }
    .pricing-site-name { font-family: 'Cinzel', serif; font-size: 1.1rem; font-weight: 600; color: var(--accent); letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 4px; }
    .pricing-title { font-family: 'Cinzel', serif; font-size: 1.8rem; font-weight: 700; color: var(--accent); letter-spacing: 0.04em; margin-bottom: 16px; padding-bottom: 16px; border-bottom: 1px solid rgba(92,26,40,0.25); }
    .pricing-lede { font-size: 1.05rem; line-height: 1.7; color: var(--text); margin-bottom: 32px; }
    .pricing-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
    @media (max-width: 640px) { .pricing-grid { grid-template-columns: 1fr; } }
    .plan { border: 1px solid rgba(92,26,40,0.25); border-radius: 6px; padding: 28px 26px; display: flex; flex-direction: column; }
    .plan--featured { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent) inset; }
    .plan-name { font-family: 'Cinzel', serif; font-size: 0.8rem; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: var(--warm-brown); margin-bottom: 12px; }
    .plan-price { display: flex; align-items: baseline; gap: 4px; margin-bottom: 4px; }
    .plan-amount { font-size: 2.1rem; font-weight: 700; color: var(--accent); }
    .plan-per { font-size: 0.95rem; color: var(--text); }
    .plan-alt { font-size: 0.9rem; color: var(--warm-brown); margin-bottom: 18px; }
    .plan-features { list-style: none; padding: 0; margin: 12px 0 24px; }
    .feat-row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding: 9px 0; border-bottom: 1px solid rgba(92,26,40,0.10); font-size: 0.98rem; line-height: 1.35; }
    .feat-row:last-child { border-bottom: none; }
    .feat-name { color: var(--text); }
    .feat-val { color: var(--text); font-weight: 600; white-space: nowrap; text-align: right; }
    .feat-row--muted .feat-name, .feat-row--muted .feat-val { color: var(--warm-brown); opacity: 0.65; font-weight: 400; }
    .feat-check { color: var(--accent); font-weight: 700; }
    .feat-dash { color: var(--warm-brown); }
    .plan-cta { margin-top: auto; display: flex; flex-direction: column; gap: 10px; }
    .plan-cta--muted { color: var(--warm-brown); font-style: italic; font-size: 0.9rem; }
    .pricing-btn { display: inline-block; text-align: center; background: var(--accent); color: #E8D9B8 !important; border: none; padding: 12px 18px; font-size: 1rem; font-family: 'EB Garamond', Georgia, serif; border-radius: 4px; cursor: pointer; letter-spacing: 0.03em; text-decoration: none; transition: background 0.15s; }
    .pricing-btn:hover:not([disabled]) { background: #6B4226; }
    .pricing-btn[disabled] { opacity: 0.5; cursor: not-allowed; }
    .pricing-btn--ghost { background: transparent; color: var(--accent) !important; border: 1px solid var(--accent); font-size: 0.9rem; }
    .pricing-btn--ghost:hover:not([disabled]) { background: rgba(92,26,40,0.08); }
    .pricing-hardship { margin-top: 32px; font-size: 0.95rem; line-height: 1.6; color: var(--warm-brown); font-style: italic; text-align: center; }
    .pricing-hardship a { color: var(--accent); text-decoration: none; }
    .pricing-back { margin-top: 28px; font-size: 0.9rem; }
    .pricing-back a { color: var(--accent); text-decoration: none; }
    .pricing-back a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="pricing-wrap">
    ${content}
  </div>
  <script>
    async function startCheckout(plan) {
      try {
        const res = await fetch('/api/billing/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan: plan })
        });
        const data = await res.json();
        if (data && data.url) { window.location.href = data.url; return; }
        alert(data && data.error ? 'Could not start checkout: ' + data.error : 'Could not start checkout. Please try again.');
      } catch (e) {
        alert('Could not start checkout. Please try again.');
      }
    }
  </script>
</body>
</html>`);
});

module.exports = router;
