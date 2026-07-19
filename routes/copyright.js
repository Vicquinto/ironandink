const express = require('express');
const router  = express.Router();

router.get('/copyright', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Copyright &amp; Credits — Iron &amp; Ink</title>
  <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/styles.css?v=63">
  <link rel="icon" href="/favicon.ico" type="image/x-icon">
  <style>
    body { font-family: 'EB Garamond', Georgia, serif; }

    .copy-wrap {
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
      padding: 60px 24px 80px;
      background: var(--bg);
    }

    .copy-card {
      width: 100%;
      max-width: 680px;
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(92,26,40,0.2);
      border-radius: 6px;
      padding: 40px 48px;
    }

    .copy-site-name {
      font-family: 'Cinzel', serif;
      font-size: 1.1rem;
      font-weight: 600;
      color: var(--accent);
      letter-spacing: 0.12em;
      text-transform: uppercase;
      margin-bottom: 4px;
    }

    .copy-page-title {
      font-family: 'Cinzel', serif;
      font-size: 1.8rem;
      font-weight: 700;
      color: var(--accent);
      letter-spacing: 0.04em;
      margin-bottom: 32px;
      padding-bottom: 16px;
      border-bottom: 1px solid rgba(92,26,40,0.25);
    }

    .copy-section-heading {
      font-family: 'Cinzel', serif;
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--warm-brown);
      letter-spacing: 0.14em;
      text-transform: uppercase;
      margin-bottom: 12px;
      margin-top: 32px;
    }

    .copy-section-heading:first-of-type {
      margin-top: 0;
    }

    .copy-body {
      font-size: 1.05rem;
      line-height: 1.75;
      color: var(--text);
    }

    .copy-rule {
      border: none;
      border-top: 1px solid rgba(92,26,40,0.2);
      margin: 28px 0;
    }

    .copy-back {
      margin-top: 32px;
      font-size: 0.9rem;
      color: var(--warm-brown);
    }

    .copy-back a {
      color: var(--accent);
      text-decoration: none;
    }

    .copy-back a:hover {
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <div class="copy-wrap">
    <div class="copy-card">
      <div class="copy-site-name">Iron &amp; Ink</div>
      <h1 class="copy-page-title">Copyright &amp; Credits</h1>

      <div class="copy-section-heading">English Standard Version (ESV)</div>
      <p class="copy-body">
        Scripture quotations are from the ESV&reg; Bible (The Holy Bible, English Standard Version&reg;),
        copyright &copy; 2001 by Crossway, a publishing ministry of Good News Publishers.
        Used by permission. All rights reserved.
      </p>

      <hr class="copy-rule">

      <div class="copy-section-heading">Primary Translation</div>
      <p class="copy-body">
        Iron &amp; Ink uses the <strong>American Standard Version (ASV, 1901, public domain)</strong> as its
        Scripture text for all study content, devotionals, and AI-generated theological material — the
        verified verse text is inserted by the system, never produced by the AI model.
        The ESV is made available as a secondary reference through the Crossway ESV API.
      </p>

      <hr class="copy-rule">

      <div class="copy-section-heading">Platform</div>
      <p class="copy-body">
        Iron &amp; Ink is a confessionally Reformed Christian study and writing platform.
        All doctrinal content reflects the Westminster Confession of Faith, the Heidelberg Catechism,
        the Belgic Confession, and the Canons of Dort.
      </p>

      <div class="copy-back">
        <a href="/">&#8592; Back to home</a>
        &nbsp;&nbsp;&middot;&nbsp;&nbsp;
        <a href="/dedication">Dedication</a>
      </div>
    </div>
  </div>
</body>
</html>`);
});

module.exports = router;
