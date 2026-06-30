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
  <link rel="stylesheet" href="/css/styles.css">
  <link rel="icon" href="/favicon.ico" type="image/x-icon">
  <style>
    /* Landing page layout — no sidebar */
    body { font-family: 'EB Garamond', Georgia, serif; }

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

    /* ── Features — illuminated manuscript ── */
    .features {
      background: #5A3834 url('/images/landing-leather.svg') center center / cover no-repeat;
      border-top: 1px solid rgba(179,140,51,0.15);
      padding: 76px 24px;
    }

    /* Aged-parchment page panel resting on the leather, with a subtle deckled
       (torn handmade-paper) edge. clip-path clips box-shadow, so the lift is
       done with filter: drop-shadow, which follows the clipped silhouette. */
    .features-inner {
      max-width: 620px;
      margin: 0 auto;
      padding: 56px 48px;
      background-color: #E4D5B7;
      background-image: linear-gradient(135deg, rgba(255,250,235,0.45), rgba(120,90,50,0.07));
      filter: drop-shadow(0 8px 24px rgba(0,0,0,0.4));
      -webkit-clip-path: polygon(
        0.6% 1.0%, 8% 0.3%, 16% 1.2%, 25% 0.4%, 34% 1.0%, 43% 0.2%, 52% 1.1%, 61% 0.4%, 70% 1.0%, 79% 0.3%, 88% 1.1%, 96% 0.4%, 100% 1.0%,
        99.3% 8%, 100% 18%, 99.2% 28%, 99.8% 38%, 99.1% 48%, 99.7% 58%, 99.2% 68%, 99.8% 78%, 99.2% 88%, 99.7% 96%, 99.4% 99.0%,
        92% 99.3%, 84% 100%, 76% 99.2%, 68% 99.8%, 60% 99.2%, 52% 99.9%, 44% 99.3%, 36% 99.8%, 28% 99.2%, 20% 99.9%, 12% 99.3%, 4% 99.8%, 0.6% 99.0%,
        0.8% 92%, 0% 82%, 0.8% 72%, 0.2% 62%, 0.9% 52%, 0.3% 42%, 0.8% 32%, 0.2% 22%, 0.8% 12%, 0.3% 4%
      );
      clip-path: polygon(
        0.6% 1.0%, 8% 0.3%, 16% 1.2%, 25% 0.4%, 34% 1.0%, 43% 0.2%, 52% 1.1%, 61% 0.4%, 70% 1.0%, 79% 0.3%, 88% 1.1%, 96% 0.4%, 100% 1.0%,
        99.3% 8%, 100% 18%, 99.2% 28%, 99.8% 38%, 99.1% 48%, 99.7% 58%, 99.2% 68%, 99.8% 78%, 99.2% 88%, 99.7% 96%, 99.4% 99.0%,
        92% 99.3%, 84% 100%, 76% 99.2%, 68% 99.8%, 60% 99.2%, 52% 99.9%, 44% 99.3%, 36% 99.8%, 28% 99.2%, 20% 99.9%, 12% 99.3%, 4% 99.8%, 0.6% 99.0%,
        0.8% 92%, 0% 82%, 0.8% 72%, 0.2% 62%, 0.9% 52%, 0.3% 42%, 0.8% 32%, 0.2% 22%, 0.8% 12%, 0.3% 4%
      );
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
      <p class="hero-description">
        A theological study and writing platform for serious Reformed students.
        Study doctrine. Wrestle with objections. Write in your own voice.
      </p>
      <div class="hero-buttons">
        <a href="/invite-request" class="btn-hero-primary">Request an Invitation</a>
        <a href="/login" class="btn-hero-secondary">Sign In</a>
      </div>
    </section>

    <section class="features">
      <div class="features-inner">
        <div class="feature-entry">
          <div class="feature-title">Study</div>
          <p class="feature-desc">
            Generate a structured Reformed study guide on any theological topic.
            Scripture, confession, history, and guiding questions — all in one place.
          </p>
        </div>
        <div class="feature-divider"><span>&#10070;</span></div>
        <div class="feature-entry">
          <div class="feature-title">Dialogue</div>
          <p class="feature-desc">
            Go head-to-head with an adversarial theological trainer.
            Defend the Reformed position against the strongest objections from other traditions.
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
    </section>

    <footer class="landing-footer">
      Iron &amp; Ink &mdash; Soli Deo Gloria
      &nbsp;&middot;&nbsp;
      <a href="/copyright" style="color:inherit; text-decoration:none;">Copyright</a>
      &nbsp;&middot;&nbsp;
      <a href="/dedication" style="color:inherit; text-decoration:none;">Dedication</a>
      &nbsp;&middot;&nbsp;
      <a href="/what-we-believe" style="color:inherit; text-decoration:none;">What We Believe</a>
    </footer>
  </div>
</body>
</html>`);
});

module.exports = router;
