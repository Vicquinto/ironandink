// ─── Terms of Service ────────────────────────────────────────────────────────
// Standalone public page, same pattern as routes/copyright.js. Public (no auth).
// Cross-links: §5 & §10 -> /cancellation-refund ; §6 -> /what-we-believe#ai.
//
// NOTE: bracketed placeholders ([OREG Studios, LLC], [governing-law state],
// [date]) are left verbatim for a later one-pass fill. The mailing address is the
// current temporary one.

const express = require('express');
const router  = express.Router();

router.get('/terms', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Terms of Service — Iron &amp; Ink</title>
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
    .copy-section-heading { font-family: 'Cinzel', serif; font-size: 0.95rem; font-weight: 600; color: var(--accent); letter-spacing: 0.03em; margin-top: 28px; margin-bottom: 10px; }
    .copy-body { font-size: 1.05rem; line-height: 1.75; color: var(--text); margin-bottom: 1.25em; }
    .copy-body:last-child { margin-bottom: 0; }
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
      <h1 class="copy-page-title">Terms of Service</h1>
      <p class="copy-effective">Last updated: [date]</p>

      <div class="copy-section-heading">1. Who we are and what these Terms cover</div>
      <p class="copy-body">
        Iron &amp; Ink is an invite-only platform for Reformed Bible study, operated by [OREG Studios, LLC]
        (&ldquo;we,&rdquo; &ldquo;us,&rdquo; &ldquo;our&rdquo;). These Terms of Service (&ldquo;Terms&rdquo;)
        govern your access to and use of the Iron &amp; Ink website, studies, Live Rooms, and related
        services (together, the &ldquo;Service&rdquo;). By requesting an invitation, creating an account, or
        using the Service, you agree to these Terms. If you do not agree, please do not use the Service.
      </p>

      <div class="copy-section-heading">2. Eligibility and the invitation gate</div>
      <p class="copy-body">
        Iron &amp; Ink is not open to the general public. Access is by invitation, and invitations are
        extended after you complete our request process, which includes questions about your reason for
        joining and your agreement with the doctrinal commitments the Service is built around. We may grant,
        decline, or revoke access at our discretion, including where we believe an account is being used in
        a way inconsistent with the purpose and doctrinal character of the community. You must be at least
        18 years old to create an account. Studies written for children are intended to be selected and used
        by a parent or guardian on a child&rsquo;s behalf; they are not a service offered directly to
        children.
      </p>

      <div class="copy-section-heading">3. Your account</div>
      <p class="copy-body">
        You are responsible for keeping your account credentials secure and for activity that occurs under
        your account. Please notify us promptly if you believe your account has been accessed without your
        permission. You agree to provide accurate information when you request an invitation and when you
        register.
      </p>

      <div class="copy-section-heading">4. Acceptable use</div>
      <p class="copy-body">
        Iron &amp; Ink exists to build up believers in the study of God&rsquo;s Word. You agree not to use
        the Service to harass, threaten, or abuse others; to misrepresent your identity or your reason for
        joining; to share your account or invitation with people it was not issued to; to disrupt Live Rooms
        or other members&rsquo; use of the Service; to scrape, copy, or redistribute studies or other
        content at scale; or to use the Service for any unlawful purpose. We may suspend or remove access
        for conduct that violates this section.
      </p>

      <div class="copy-section-heading">5. Subscriptions, billing, and cancellation</div>
      <p class="copy-body">
        Portions of the Service are offered free of charge, and portions require a paid subscription.
        Subscription prices, billing intervals, and what each tier includes are shown at the point of
        purchase. Paid subscriptions are billed in advance on a recurring basis through our payment
        processor. Cancellation, refunds, and what happens to your access when a subscription ends are
        governed by our <a href="/cancellation-refund">Cancellation &amp; Refund Policy</a>, which is
        incorporated into these Terms by reference. We never want cost to be the reason a Christian cannot
        study God&rsquo;s Word with us; where genuine hardship exists, access may be provided at no charge
        at our discretion.
      </p>

      <div class="copy-section-heading">6. AI-generated study content</div>
      <p class="copy-body">
        Many studies on Iron &amp; Ink are generated with the assistance of artificial intelligence, working
        from Scripture and from doctrinal guardrails we have written. We take great care with how these
        studies are produced, and our approach is described more fully on our
        <a href="/what-we-believe#ai">&ldquo;Where We Stand on AI&rdquo;</a> page. Even so, AI-assisted
        content can contain errors, and it is not a substitute for Scripture itself, for the teaching of
        your local church, or for the oversight of qualified elders. You are responsible for testing
        everything against the Word of God (Acts 17:11). Studies are provided for personal and small-group
        edification, not for resale or republication.
      </p>

      <div class="copy-section-heading">7. Scripture quotations</div>
      <p class="copy-body">
        Scripture quotations within the Service are drawn from licensed translations, including the English
        Standard Version (ESV), used by permission. Those quotations remain subject to the terms of their
        respective publishers, and your right to use them extends only to your personal and small-group
        study through the Service.
      </p>

      <div class="copy-section-heading">8. Our content and your license to use it</div>
      <p class="copy-body">
        The studies, text, design, and other materials we provide are owned by us or our licensors and are
        protected by law. We grant you a personal, limited, non-transferable, revocable license to access
        and use them for your own study and for use within your household or small group. We reserve all
        rights not expressly granted. You retain ownership of the answers, reasons, and other content you
        submit to us; by submitting it, you give us permission to use it as needed to operate the Service
        (for example, to review an invitation request or to display your presence in a Live Room).
      </p>

      <div class="copy-section-heading">9. Live Rooms</div>
      <p class="copy-body">
        Live Rooms allow members to study together in real time. What you say and share in a Live Room may
        be seen by other members present. Please treat one another with the charity and seriousness the
        study of Scripture deserves. We are not responsible for the statements of other members, and we may
        moderate, close, or remove rooms as needed.
      </p>

      <div class="copy-section-heading">10. Suspension and termination</div>
      <p class="copy-body">
        You may stop using the Service and close your account at any time. We may suspend or terminate your
        access if you violate these Terms, if we are required to by law, or if we reasonably believe
        continued access poses a risk to the community or to the Service. If your access ends, the sections
        of these Terms that by their nature should survive &mdash; including ownership, disclaimers,
        limitation of liability, and governing law &mdash; will continue to apply. Provisions of the
        <a href="/cancellation-refund">Cancellation &amp; Refund Policy</a> govern any billing consequences
        of termination.
      </p>

      <div class="copy-section-heading">11. Disclaimers</div>
      <p class="copy-body">
        The Service is provided &ldquo;as is&rdquo; and &ldquo;as available.&rdquo; To the fullest extent
        permitted by law, we disclaim all warranties, whether express or implied, including warranties of
        merchantability, fitness for a particular purpose, and non-infringement. We do not warrant that the
        Service will be uninterrupted, error-free, or free of harmful components, or that studies will be
        free of doctrinal or factual error. Nothing in the Service is offered as legal, financial, medical,
        or professional counseling advice.
      </p>

      <div class="copy-section-heading">12. Limitation of liability</div>
      <p class="copy-body">
        To the fullest extent permitted by law, [OREG Studios, LLC] and the people who work on Iron &amp; Ink
        will not be liable for any indirect, incidental, special, consequential, or punitive damages, or for
        any loss of data, goodwill, or profits, arising out of or relating to your use of the Service. Our
        total liability for any claim relating to the Service will not exceed the greater of the amount you
        paid us for the Service in the twelve months before the claim, or twenty U.S. dollars ($20). Some
        jurisdictions do not allow certain limitations, so some of these may not apply to you.
      </p>

      <div class="copy-section-heading">13. Indemnification</div>
      <p class="copy-body">
        You agree to defend and hold harmless [OREG Studios, LLC] from claims and expenses arising out of
        your misuse of the Service or your violation of these Terms, to the extent permitted by law.
      </p>

      <div class="copy-section-heading">14. Changes to these Terms</div>
      <p class="copy-body">
        We may update these Terms from time to time. When we make material changes, we will update the
        &ldquo;Last updated&rdquo; date and, where appropriate, notify members. Your continued use of the
        Service after a change takes effect means you accept the revised Terms.
      </p>

      <div class="copy-section-heading">15. Governing law</div>
      <p class="copy-body">
        These Terms are governed by the laws of the State of [governing-law state], without regard to its
        conflict-of-laws rules. You agree that the state and federal courts located in [governing-law state]
        will have jurisdiction over any dispute that is not otherwise resolved.
      </p>

      <div class="copy-section-heading">16. Contact</div>
      <p class="copy-body">
        Questions about these Terms can be sent to
        <a href="mailto:contact@ironandinktheology.com">contact@ironandinktheology.com</a>, or by mail to
        1633 Main Street, Ste A, PMB# 196, Billings, MT 59105.
      </p>

      <div class="copy-back">
        <a href="/">&#8592; Back to home</a>
        &nbsp;&nbsp;&middot;&nbsp;&nbsp;
        <a href="/privacy">Privacy Policy</a>
        &nbsp;&nbsp;&middot;&nbsp;&nbsp;
        <a href="/cancellation-refund">Cancellation &amp; Refund</a>
      </div>
    </div>
  </div>
</body>
</html>`);
});

module.exports = router;
