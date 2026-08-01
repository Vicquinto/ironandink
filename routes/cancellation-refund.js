// ─── Cancellation & Refund Policy ────────────────────────────────────────────
// Standalone public page, same pattern as routes/copyright.js: one self-contained
// HTML document using the shared .copy-* content classes and styles.css. Public
// (no auth) so it is reachable from the footer, from checkout, and pre-login.
//
// NOTE: bracketed placeholders ([OREG Studios, LLC], [date], [$9.99/month],
// [$99.99/year], [30 days]) are intentionally left verbatim for a later one-pass
// fill. Do not "resolve" them. The mailing address is the current temporary one.

const express = require('express');
const router  = express.Router();

router.get('/cancellation-refund', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cancellation &amp; Refund Policy — Iron &amp; Ink</title>
  <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/styles.css?v=72">
  <link rel="icon" href="/favicon.ico" type="image/x-icon">
  <style>
    body { font-family: 'EB Garamond', Georgia, serif; }
    .copy-wrap { min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; padding: 60px 24px 80px; background: var(--bg); }
    .copy-card { width: 100%; max-width: 680px; background: rgba(255,255,255,0.08); border: 1px solid rgba(92,26,40,0.2); border-radius: 6px; padding: 40px 48px; }
    .copy-site-name { font-family: 'Cinzel', serif; font-size: 1.1rem; font-weight: 600; color: var(--accent); letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 4px; }
    .copy-page-title { font-family: 'Cinzel', serif; font-size: 1.8rem; font-weight: 700; color: var(--accent); letter-spacing: 0.04em; margin-bottom: 8px; padding-bottom: 16px; border-bottom: 1px solid rgba(92,26,40,0.25); }
    .copy-effective { font-size: 0.92rem; font-style: italic; color: var(--warm-brown); margin-bottom: 28px; }
    .copy-body { font-size: 1.05rem; line-height: 1.75; color: var(--text); margin-bottom: 1.25em; }
    .copy-body:last-child { margin-bottom: 0; }
    .copy-body strong { color: var(--accent); }
    .copy-list { margin: 0 0 1.25em; padding-left: 1.4em; }
    .copy-list li { font-size: 1.05rem; line-height: 1.7; color: var(--text); margin-bottom: 0.5em; }
    .copy-list li strong { color: var(--accent); }
    .copy-rule { border: none; border-top: 1px solid rgba(92,26,40,0.2); margin: 28px 0; }
    .copy-back { margin-top: 32px; font-size: 0.9rem; color: var(--warm-brown); }
    .copy-back a { color: var(--accent); text-decoration: none; }
    .copy-back a:hover { text-decoration: underline; }
    .copy-card a { color: var(--accent); }
    @media (max-width: 600px) { .copy-card { padding: 28px 20px; } }
  </style>
</head>
<body>
  <div class="copy-wrap">
    <div class="copy-card">
      <div class="copy-site-name">Iron &amp; Ink</div>
      <h1 class="copy-page-title">Cancellation &amp; Refund Policy</h1>
      <p class="copy-effective">Effective [date] &middot; Operated by [OREG Studios, LLC]</p>

      <p class="copy-body">
        <strong>Subscriptions and billing.</strong> Iron &amp; Ink offers a free tier and a paid
        membership. Paid memberships are billed in advance on a recurring basis &mdash; monthly at
        <strong>[$9.99/month]</strong> or annually at <strong>[$99.99/year]</strong> &mdash; and renew
        automatically at the end of each billing period until cancelled. Payments are processed by
        <strong>Stripe</strong>; Iron &amp; Ink never sees or stores your card details.
      </p>

      <p class="copy-body">
        <strong>Cancelling.</strong> You may cancel your paid membership at any time from your account
        settings, or by emailing <a href="mailto:contact@ironandinktheology.com">contact@ironandinktheology.com</a>.
        When you cancel, your paid access continues through the end of the billing period you&rsquo;ve
        already paid for &mdash; you&rsquo;re never cut off mid-period. After that, your account simply
        returns to the free tier. You are never locked out for cancelling: you keep your account, your
        saved studies, and free access to Scripture and the free features.
      </p>

      <p class="copy-body"><strong>Refunds.</strong></p>
      <ul class="copy-list">
        <li><strong>Monthly memberships</strong> are non-refundable, but you may cancel any time before
        your next renewal to avoid the next charge &mdash; and you keep access through the period
        you&rsquo;ve paid for.</li>
        <li><strong>Annual memberships</strong> may be refunded within <strong>[30 days]</strong> of
        purchase or renewal. After that, you may cancel to stop the following year&rsquo;s renewal, and
        your access continues until the end of the paid year.</li>
        <li><strong>Duplicate or accidental charges</strong> are always refunded &mdash; just contact us.</li>
      </ul>

      <p class="copy-body">
        <strong>A word on hardship.</strong> Iron &amp; Ink exists to serve Christ&rsquo;s people, not to
        place His Word behind a wall anyone can&rsquo;t afford. If cost is a genuine barrier for you,
        please write to us at <a href="mailto:contact@ironandinktheology.com">contact@ironandinktheology.com</a>
        <em>before</em> cancelling &mdash; we would far rather find a way to keep you studying than lose you
        over a fee.
      </p>

      <p class="copy-body">
        <strong>Changes.</strong> We may adjust our pricing or this policy from time to time. If we do,
        we&rsquo;ll give current members reasonable notice before any change affects them, and a price
        change never applies to a period you&rsquo;ve already paid for.
      </p>

      <hr class="copy-rule">

      <p class="copy-body">
        <strong>Questions.</strong> <a href="mailto:contact@ironandinktheology.com">contact@ironandinktheology.com</a>
        &middot; PO Box 625, Roundup, MT 59072
      </p>

      <div class="copy-back">
        <a href="/">&#8592; Back to home</a>
        &nbsp;&nbsp;&middot;&nbsp;&nbsp;
        <a href="/terms">Terms of Service</a>
        &nbsp;&nbsp;&middot;&nbsp;&nbsp;
        <a href="/privacy">Privacy Policy</a>
      </div>
    </div>
  </div>
</body>
</html>`);
});

module.exports = router;
