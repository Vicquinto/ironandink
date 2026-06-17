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

    .hero-title {
      font-family: 'Cinzel', serif;
      font-size: clamp(3rem, 7vw, 5.5rem);
      font-weight: 700;
      color: var(--accent);
      letter-spacing: 0.06em;
      line-height: 1.1;
      margin-bottom: 18px;
    }

    .hero-verse {
      font-family: 'EB Garamond', Georgia, serif;
      font-size: 1.1rem;
      color: var(--warm-brown);
      font-style: italic;
      margin-bottom: 32px;
      letter-spacing: 0.03em;
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
      color: var(--dark-cream);
      font-family: 'EB Garamond', Georgia, serif;
      font-size: 1.05rem;
      border: 1px solid rgba(235,217,198,0.4);
      padding: 14px 36px;
      border-radius: 4px;
      cursor: pointer;
      text-decoration: none;
      letter-spacing: 0.04em;
      transition: border-color 0.15s, color 0.15s;
    }

    .btn-hero-secondary:hover {
      border-color: var(--dark-cream);
      color: var(--text);
    }

    /* ── Feature cards ── */
    .features {
      background: #5A3834 url('/images/sidebar-leather.svg') center center / cover no-repeat;
      border-top: 1px solid rgba(179,140,51,0.15);
      padding: 64px 24px;
    }

    .features-inner {
      max-width: 960px;
      margin: 0 auto;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 28px;
    }

    .feature-card {
      position: relative;
      background-color: #FAFAF7;
      background-image: repeating-linear-gradient(
        to bottom,
        transparent 0,
        transparent 27px,
        #E8EDF2 27px,
        #E8EDF2 28px
      );
      border: none;
      border-radius: 3px;
      padding: 32px 28px 32px 52px;
      box-shadow: 2px 4px 12px rgba(0,0,0,0.18);
      overflow: hidden;
    }

    .feature-card::before {
      content: '';
      position: absolute;
      top: 0;
      bottom: 0;
      left: 32px;
      width: 2px;
      background: #C9444A;
    }

    .feature-icon {
      font-size: 1.6rem;
      margin-bottom: 14px;
      color: var(--accent);
    }

    .feature-title {
      font-family: 'EB Garamond', Georgia, serif;
      font-size: 1.25rem;
      font-weight: 600;
      color: var(--dark-cream);
      margin-bottom: 12px;
      letter-spacing: 0.03em;
    }

    .feature-desc {
      font-size: 0.95rem;
      color: var(--warm-brown);
      line-height: 1.7;
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
      <h1 class="hero-title">Iron &amp; Ink</h1>
      <p class="hero-verse">Iron sharpens iron &mdash; Proverbs 27:17</p>
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
        <div class="feature-card">
          <div class="feature-icon">&#10016;</div>
          <div class="feature-title">Study</div>
          <p class="feature-desc">
            Generate a structured Reformed study guide on any theological topic.
            Scripture, confession, history, and guiding questions — all in one place.
          </p>
        </div>
        <div class="feature-card">
          <div class="feature-icon">&#9993;</div>
          <div class="feature-title">Dialogue</div>
          <p class="feature-desc">
            Go head-to-head with an adversarial theological trainer.
            Defend the Reformed position against the strongest objections from other traditions.
          </p>
        </div>
        <div class="feature-card">
          <div class="feature-icon">&#9998;</div>
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
    </footer>
  </div>
</body>
</html>`);
});

module.exports = router;
