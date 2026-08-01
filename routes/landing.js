const express = require('express');
const router  = express.Router();

// ─── GET / — public landing page ──────────────────────────────────────────────
router.get('/', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Iron &amp; Ink — Reformed Theological Study</title>
  <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/styles.css?v=72">
  <link rel="icon" href="/favicon.ico" type="image/x-icon">
  <style>
    /* Landing page layout — no sidebar */
    body { font-family: 'EB Garamond', Georgia, serif; }

    /* The hero's primary button is a same-page jump to #features, so ease it. */
    html { scroll-behavior: smooth; }

    .landing-wrap {
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }

    /* ── Hero ── */
    .hero {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 80px 24px 60px;
      background: var(--bg);
    }

    .hero-brand {
      display: block;
      width: 100%;
      max-width: 640px;
      height: auto;
      margin: 0 auto 32px;
    }

    /* Display face (Cinzel) and heading colour, matching .feature-title's
       family and the --accent heading convention. */
    .hero-headline {
      font-family: 'Cinzel', serif;
      font-size: 2.1rem;
      font-weight: 600;
      color: var(--accent);
      line-height: 1.3;
      max-width: 640px;
      /* Adds to .hero-brand's 32px for 48px of separation from the logo. The
         headline must sit further from the brand block than from its own
         subhead (24px), or the two read as one crowded group. */
      margin-top: 16px;
      margin-bottom: 24px;
    }

    .hero-description {
      max-width: 560px;
      font-size: 1.15rem;
      color: var(--dark-cream);
      line-height: 1.75;
      margin-bottom: 44px;
    }

    .hero-buttons {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
      justify-content: center;
    }

    .btn-hero-primary {
      background: var(--accent);
      color: #E8D9B8;
      font-family: 'EB Garamond', Georgia, serif;
      font-size: 1.05rem;
      font-weight: 600;
      border: none;
      padding: 14px 36px;
      border-radius: 4px;
      cursor: pointer;
      text-decoration: none;
      letter-spacing: 0.04em;
      transition: background 0.15s;
    }

    .btn-hero-primary:hover { background: #6B4226; }

    .btn-hero-secondary {
      background: transparent;
      color: var(--accent);
      font-family: 'EB Garamond', Georgia, serif;
      font-size: 1.05rem;
      font-weight: 600;
      border: 1px solid var(--accent);
      padding: 14px 36px;
      border-radius: 4px;
      cursor: pointer;
      text-decoration: none;
      letter-spacing: 0.04em;
      transition: background 0.15s, color 0.15s;
    }

    .btn-hero-secondary:hover {
      background: var(--accent);
      color: #E8D9B8;
    }

    /* Understated scroll affordance — a hairline chevron under the buttons so
       the full-height hero visibly signals there is more below. Muted by
       default, and it drifts just far enough to read as an invitation. */
    .hero-scroll-cue {
      display: block;
      margin-top: 40px;
      color: var(--warm-brown);
      opacity: 0.5;
      line-height: 0;
      transition: opacity 0.15s;
      animation: heroCueDrift 2.6s ease-in-out infinite;
    }

    .hero-scroll-cue:hover { opacity: 0.85; }

    @keyframes heroCueDrift {
      0%, 100% { transform: translateY(0); }
      50%      { transform: translateY(5px); }
    }

    /* Respect a reduced-motion preference: no drift, no smooth-scroll easing. */
    @media (prefers-reduced-motion: reduce) {
      html { scroll-behavior: auto; }
      .hero-scroll-cue { animation: none; }
    }

    /* On phones the hero's 140px of vertical padding already pushed it ~14px past
       the viewport, which would have left the cue itself below the fold — where a
       scroll affordance is useless. Reclaim enough for the whole hero, cue
       included, to sit above the fold. */
    @media (max-width: 420px) {
      .hero {
        padding-top: 40px;
        padding-bottom: 28px;
      }

      .hero-scroll-cue { margin-top: 20px; }
    }

    /* ── Features — illuminated manuscript ── */
    .features {
      background: #5A3834 url('/images/landing-leather.svg') center center / cover no-repeat;
      border-top: 1px solid rgba(179,140,51,0.15);
      padding: 76px 24px;
    }

    /* Aged-parchment page panel resting on the leather */
    .features-inner {
      max-width: 620px;
      margin: 0 auto;
      padding: 56px 48px;
      background-color: #E4D5B7;
      background-image: linear-gradient(135deg, rgba(255,250,235,0.45), rgba(120,90,50,0.07));
      border: 1px solid rgba(120,90,50,0.28);
      border-radius: 3px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.35);
    }

    .feature-entry {
      text-align: center;
      padding: 4px 0;
    }

    .feature-title {
      font-family: 'Cinzel', serif;
      font-size: 1.4rem;
      font-weight: 600;
      color: #8A6D28;
      margin-bottom: 14px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
    }

    .feature-desc {
      font-size: 1rem;
      color: var(--dark-cream);
      line-height: 1.8;
      max-width: 480px;
      margin: 0 auto;
    }

    /* Ornamental gold divider — hairline rules flanking a small diamond */
    .feature-divider {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 18px;
      max-width: 320px;
      margin: 36px auto;
    }

    .feature-divider::before,
    .feature-divider::after {
      content: '';
      flex: 1;
      height: 1px;
    }

    .feature-divider::before {
      background: linear-gradient(to right, transparent, rgba(138,109,40,0.7));
    }

    .feature-divider::after {
      background: linear-gradient(to left, transparent, rgba(138,109,40,0.7));
    }

    .feature-divider span {
      color: #8A6D28;
      font-size: 0.7rem;
      line-height: 1;
    }

    /* Section eyebrow — introduces a group without competing with its headings.
       Follows the page's secondary-label convention (small italic warm-brown, as
       the footer uses) rather than the gold Cinzel of .feature-title. */
    .feature-eyebrow {
      font-size: 0.82rem;
      font-style: italic;
      color: var(--warm-brown);
      letter-spacing: 0.08em;
      text-align: center;
      margin-bottom: 30px;
    }

    /* ── Second tier — supporting features, deliberately lighter ── */
    /* Same parchment card, palette and faces as the core three; the lighter read
       comes from a smaller heading (0.95rem vs 1.4rem), smaller/tighter body, a
       2-up grid instead of full-width stacked entries, and no gold dividers. */
    /* .features-inner's 56px vertical padding is calibrated for the tall core
       panel; against this panel's much shorter grid it took up a quarter of the
       panel's height, reading as an empty expanse of parchment under the last
       row. Trim it (symmetrically — it was never lopsided) so the panel hugs the
       compact grid, which also reinforces the lighter treatment. */
    .features-inner.tier-two {
      margin-top: 40px;
      padding-top: 40px;
      padding-bottom: 40px;
    }

    .tier-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 30px 36px;
    }

    .tier-entry {
      text-align: center;
    }

    .tier-title {
      font-family: 'Cinzel', serif;
      font-size: 0.95rem;
      font-weight: 600;
      color: #8A6D28;
      margin-bottom: 8px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }

    .tier-desc {
      font-size: 0.9rem;
      color: var(--dark-cream);
      line-height: 1.65;
    }

    /* Two columns inside a 620px card get too narrow to read once the viewport
       drops below tablet width — stack them instead. */
    @media (max-width: 560px) {
      .tier-grid {
        grid-template-columns: 1fr;
        gap: 26px;
      }
    }

    /* Invite-only note — a second parchment panel resting on the same leather.
       Reuses .features-inner / .feature-entry / .feature-title / .feature-desc
       wholesale, and .hero-buttons + .btn-hero-primary for the repeated CTA (the
       flex row is what lets the button's vertical padding sit correctly, as in
       the hero). Only the two gaps below are new. */
    .features-inner.invite-panel {
      margin-top: 40px;
    }

    .invite-cta {
      margin-top: 32px;
    }

    /* The card's 48px side padding leaves only ~229px of content at 375px (and
       ~174px at 320px) — narrower than this button's natural width, so its label
       wrapped to two lines. Let the button fill the card's width on phones rather
       than trimming the card, so both parchment panels keep an identical text
       inset and the label stays on one line at every narrow size. */
    @media (max-width: 420px) {
      .invite-cta .btn-hero-primary {
        flex: 1;
        padding-left: 16px;
        padding-right: 16px;
      }
    }

    /* Below ~360px even a full-width button can't clear the card's 96px of side
       padding (the 163px label needs 195px with its own padding, against 176px of
       content). Trim this panel's inset the rest of the way; the three feature
       cards are text-only and wrap fine, so they keep their original padding. */
    @media (max-width: 360px) {
      .features-inner.invite-panel {
        padding-left: 32px;
        padding-right: 32px;
      }
    }

    /* ── Footer ── */
    .landing-footer {
      background: var(--bg);
      border-top: 1px solid rgba(179,140,51,0.1);
      text-align: center;
      padding: 20px;
      font-size: 0.78rem;
      color: var(--warm-brown);
      font-style: italic;
    }
  </style>
</head>
<body>
  <div class="landing-wrap">
    <section class="hero">
      <img src="/images/brand.jpg" alt="Iron & Ink — Iron sharpens iron, Proverbs 27:17" class="hero-brand">
      <h1 class="hero-headline">A training ground for Reformed conviction.</h1>
      <p class="hero-description">
        A confessionally Reformed platform where you study Scripture deeply,
        defend what you believe against the hardest objections, and grow
        alongside others who hold the same confession.
      </p>
      <div class="hero-buttons">
        <a href="#features" class="btn-hero-primary">See how it works</a>
        <a href="/login" class="btn-hero-secondary">Sign In</a>
      </div>
      <a href="#features" class="hero-scroll-cue" aria-label="Scroll down to see more">
        <svg width="22" height="12" viewBox="0 0 22 12" aria-hidden="true" focusable="false">
          <path d="M1 1 L11 10 L21 1" fill="none" stroke="currentColor"
                stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </a>
    </section>

    <section class="features" id="features">
      <div class="features-inner">
        <p class="feature-eyebrow">Three ways to sharpen</p>
        <div class="feature-entry">
          <div class="feature-title">Dialogue</div>
          <p class="feature-desc">
            Go head-to-head with an adversarial theological trainer.
            Defend the Reformed position against the strongest objections from other traditions.
          </p>
        </div>
        <div class="feature-divider"><span>&#10070;</span></div>
        <div class="feature-entry">
          <div class="feature-title">Study</div>
          <p class="feature-desc">
            Generate a structured Reformed study on any theological topic.
            Scripture, confession, history, and guiding questions — all in one place.
          </p>
        </div>
        <div class="feature-divider"><span>&#10070;</span></div>
        <div class="feature-entry">
          <div class="feature-title">Writing</div>
          <p class="feature-desc">
            Write a theological article, sermon, or letter in your own voice.
            Answer five questions and the scaffold builds itself around your theology.
          </p>
        </div>
      </div>

      <div class="features-inner tier-two">
        <p class="feature-eyebrow">And a complete study environment</p>
        <div class="tier-grid">
          <div class="tier-entry">
            <div class="tier-title">Live Rooms</div>
            <p class="tier-desc">
              Study together in real time. A host leads a live session, and members read,
              discuss, and share alongside — with the conversation kept for the room.
            </p>
          </div>
          <div class="tier-entry">
            <div class="tier-title">Scripture</div>
            <p class="tier-desc">
              A clean, distraction-free reader for working directly in the text — and a
              reading tracker to set goals for each book and mark every time you read it
              through.
            </p>
          </div>
          <div class="tier-entry">
            <div class="tier-title">Community</div>
            <p class="tier-desc">
              Share your studies and articles with the fellowship, and read what others
              have written and wrestled through.
            </p>
          </div>
          <div class="tier-entry">
            <div class="tier-title">Study Trees</div>
            <p class="tier-desc">
              Follow a study wherever it leads. Branch from any question into a new study,
              and watch a single topic grow into a connected tree of learning.
            </p>
          </div>
        </div>
      </div>

      <div class="features-inner invite-panel">
        <div class="feature-entry">
          <div class="feature-title">Invite-only, by conviction</div>
          <p class="feature-desc">
            Iron &amp; Ink is invite-only — not for scarcity, but as a doctrinal front
            door. Every prospective member answers a short questionnaire before joining,
            so the community shares a common confession and a common starting point.
            Whether you've held the doctrines of grace for decades or you're working
            through them now, you'll spend your time going deeper, not re-litigating
            the basics.
          </p>
          <div class="hero-buttons invite-cta">
            <a href="/invite-request" class="btn-hero-primary">Request an Invitation</a>
          </div>
        </div>
      </div>
    </section>

    <footer class="landing-footer">
      Iron &amp; Ink &mdash; Soli Deo Gloria
      &nbsp;&middot;&nbsp;
      <a href="/copyright" style="color:inherit; text-decoration:none;">Copyright</a>
      &nbsp;&middot;&nbsp;
      <a href="/dedication" style="color:inherit; text-decoration:none;">Dedication</a>
      &nbsp;&middot;&nbsp;
      <a href="/what-we-believe" style="color:inherit; text-decoration:none;">What We Believe</a>
      &nbsp;&middot;&nbsp;
      <a href="/terms" style="color:inherit; text-decoration:none;">Terms</a>
      &nbsp;&middot;&nbsp;
      <a href="/privacy" style="color:inherit; text-decoration:none;">Privacy</a>
      &nbsp;&middot;&nbsp;
      <a href="/cancellation-refund" style="color:inherit; text-decoration:none;">Cancellation &amp; Refund</a>
    </footer>
  </div>
</body>
</html>`);
});

module.exports = router;
