// ─── Privacy Policy ──────────────────────────────────────────────────────────
// Standalone public page, same pattern as routes/copyright.js. Public (no auth).
// Section 3 cross-links to the "Where We Stand on AI" tab (/what-we-believe#ai).
//
// NOTE: bracketed placeholders ([OREG Studios, LLC], [date]) are left verbatim
// for a later one-pass fill. The mailing address is the current temporary one.

const express = require('express');
const router  = express.Router();

router.get('/privacy', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Privacy Policy — Iron &amp; Ink</title>
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
      <h1 class="copy-page-title">Privacy Policy</h1>
      <p class="copy-effective">Effective [date] &middot; Operated by [OREG Studios, LLC]</p>

      <p class="copy-body">
        Your trust matters to us, and so does your privacy. This policy explains what we collect, how we
        use it, and who we share it with.
      </p>

      <p class="copy-body"><strong>1. Information we collect.</strong></p>
      <ul class="copy-list">
        <li><strong>Account information</strong> &mdash; your name, email address, and password (stored
        only in encrypted, hashed form; we never see your actual password).</li>
        <li><strong>Your invitation responses</strong> &mdash; the reason you shared for joining and your
        answers to the doctrinal questionnaire.</li>
        <li><strong>Content you create</strong> &mdash; the studies, dialogues, writing, notes, community
        posts, and live-room activity you generate on the platform.</li>
        <li><strong>Usage information</strong> &mdash; how you use Iron &amp; Ink (features used,
        timestamps, last sign-in), which helps us understand activity and improve the service.</li>
        <li><strong>Payment information</strong> &mdash; handled entirely by our processor, Stripe. We
        receive limited billing details such as your subscription status and whether a payment succeeded;
        we never see or store your full card number.</li>
        <li><strong>Messages you send us</strong> &mdash; such as feedback or support requests.</li>
      </ul>

      <p class="copy-body">
        <strong>2. How we use your information.</strong> To operate and provide the service; sign you in
        securely; generate your studies and other content; send you necessary emails (invitations, account
        and billing notices); understand and improve how the platform is used; process payments; and
        protect the community and enforce our terms.
      </p>

      <p class="copy-body">
        <strong>3. How AI is involved.</strong> To generate your studies, dialogues, and other content,
        the topics and inputs you provide are sent to our AI provider (Anthropic) to produce your results.
        We don&rsquo;t sell your information, and we use it to serve <em>you</em>. For a fuller,
        plain-language account of how we use AI and the safeguards around Scripture, see
        <a href="/what-we-believe#ai">&ldquo;Where We Stand on AI&rdquo;</a> on our About page.
      </p>

      <p class="copy-body">
        <strong>4. Service providers we share with.</strong> We share only what&rsquo;s necessary with
        trusted providers who help us run Iron &amp; Ink: <strong>Stripe</strong> (payments),
        <strong>SendGrid</strong> (email delivery), and <strong>Anthropic</strong> (AI content
        generation). We do <strong>not</strong> sell your personal information to anyone.
      </p>

      <p class="copy-body">
        <strong>5. Keeping and deleting your information.</strong> We keep your information while your
        account is active and as needed to provide the service. You may request that we delete your
        account and personal data by contacting us.
      </p>

      <p class="copy-body">
        <strong>6. Security.</strong> We protect your information with reasonable safeguards, including
        hashing passwords so they&rsquo;re never stored in readable form. No system is perfectly secure,
        but we take your data seriously.
      </p>

      <p class="copy-body">
        <strong>7. Your choices.</strong> You can view and update your account information in your
        settings, unsubscribe from non-essential emails, and request access to or deletion of your data at
        any time by writing to us.
      </p>

      <p class="copy-body">
        <strong>8. Children&rsquo;s privacy.</strong> Iron &amp; Ink accounts are for adults. While the
        platform can generate children&rsquo;s Bible studies, those are created by adult members for use
        with their own families &mdash; children do not create accounts, and we do not knowingly collect
        personal information from children.
      </p>

      <p class="copy-body">
        <strong>9. Cookies.</strong> We use only essential cookies &mdash; mainly to keep you signed in.
        We don&rsquo;t use cookies for advertising or sell cookie data.
      </p>

      <p class="copy-body">
        <strong>10. Changes to this policy.</strong> If we update this policy, we&rsquo;ll post the new
        version here and update the effective date.
      </p>

      <hr class="copy-rule">

      <p class="copy-body">
        <strong>11. Contact us.</strong> <a href="mailto:contact@ironandinktheology.com">contact@ironandinktheology.com</a>
        &middot; PO Box 625, Roundup, MT 59072
      </p>

      <div class="copy-back">
        <a href="/">&#8592; Back to home</a>
        &nbsp;&nbsp;&middot;&nbsp;&nbsp;
        <a href="/terms">Terms of Service</a>
        &nbsp;&nbsp;&middot;&nbsp;&nbsp;
        <a href="/cancellation-refund">Cancellation &amp; Refund</a>
      </div>
    </div>
  </div>
</body>
</html>`);
});

module.exports = router;
