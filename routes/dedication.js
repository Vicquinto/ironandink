const express = require('express');
const router  = express.Router();

router.get('/dedication', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dedication — Iron &amp; Ink</title>
  <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/styles.css?v=66">
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
      line-height: 1.8;
      color: var(--text);
      font-style: italic;
    }

    .copy-rule {
      border: none;
      border-top: 1px solid rgba(92,26,40,0.2);
      margin: 28px 0;
    }

    /* Scripture quotations. Mirrors the platform's blockquote treatment
       (.guide-bq / .devot-content blockquote): warm left rule, italic,
       indented. The body copy on this page is already italic, so the rule
       and indent carry the separation rather than the slant. */
    .copy-quote {
      border-left: 3px solid rgba(160,132,92,0.4);
      margin: 22px 0;
      padding: 6px 16px;
      color: var(--dark-cream);
      font-style: italic;
      font-size: 1.02rem;
      line-height: 1.75;
    }

    .copy-quote-ref {
      display: block;
      margin-top: 8px;
      font-style: normal;
      font-size: 0.85rem;
      color: var(--warm-brown);
      letter-spacing: 0.03em;
    }

    .copy-note {
      margin-top: 22px;
      font-size: 0.8rem;
      font-style: normal;
      color: var(--warm-brown);
      letter-spacing: 0.02em;
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
      <h1 class="copy-page-title">Dedication</h1>

      <div class="copy-section-heading">To the Lord</div>
      <p class="copy-body">
        Before any person, this work belongs to the Lord. Iron &amp; Ink exists because He is worthy of deeper
        study, clearer thought, and a people sharpened in His Word. Soli Deo Gloria &mdash; to God alone be the glory.
      </p>

      <hr class="copy-rule">

      <div class="copy-section-heading">To Jamie</div>
      <p class="copy-body">
        To my wife, Jamie &mdash; whose vision shaped this platform as much as any line of code. Your hand is in
        the leather of these pages, your faith steadies mine, and your partnership has carried this work from an
        idea to something real. Thank you for building this with me.
      </p>

      <hr class="copy-rule">

      <div class="copy-section-heading">To Aurora</div>
      <p class="copy-body">
        To our granddaughter, Aurora &mdash; may you grow up knowing the Word of God as your foundation. This was
        built in part with you in mind, that the generations after us would have tools to know Christ more deeply
        than we did at your age.
      </p>

      <hr class="copy-rule">

      <div class="copy-section-heading">To Barbara</div>
      <p class="copy-body">
        To Barbara Starr &mdash; our first member, and a woman whose perseverance through hardship has been a
        testimony in itself. Thank you for trusting this platform in its earliest days, before it was polished
        or proven. You believed first.
      </p>

      <hr class="copy-rule">

      <div class="copy-section-heading">A Word of Dedication</div>
      <p class="copy-body">
        Iron &amp; Ink Theology exists, in no small part, because of the faithful ministry of Pastor John MacArthur.
      </p>
      <p class="copy-body">
        We do not say this to give a man glory that belongs to God alone &mdash; it is the Lord who ordains all
        things, who calls, who teaches, who saves. But it is also the Lord&rsquo;s pattern to use faithful men to
        shape His church, and for decades Pastor John was one of those men to us. His unwavering commitment to
        expository preaching &mdash; to simply opening the text and saying what it says &mdash; taught us to love
        Scripture rightly, to test everything against it, and to trust that God&rsquo;s Word does not need to be
        improved upon, only rightly handled.
      </p>

      <blockquote class="copy-quote">
        &ldquo;And we beseech you, brethren, to know them which labour among you, and are over you in the Lord, and
        admonish you; and to esteem them very highly in love for their work&rsquo;s sake.&rdquo;
        <span class="copy-quote-ref">&mdash; 1 Thessalonians 5:12-13</span>
      </blockquote>

      <p class="copy-body">
        We would not be where we are today without the years he gave to that work. Iron &amp; Ink is, in part, an
        outgrowth of what he sowed in us long before we ever imagined building it.
      </p>
      <p class="copy-body">
        So we dedicate this work with gratitude &mdash; to the Lord first, who ordained it all, and in thankful
        memory of a faithful servant who taught us to handle His Word rightly.
      </p>

      <blockquote class="copy-quote">
        &ldquo;Study to shew thyself approved unto God, a workman that needeth not to be ashamed, rightly dividing
        the word of truth.&rdquo;
        <span class="copy-quote-ref">&mdash; 2 Timothy 2:15</span>
      </blockquote>

      <p class="copy-note">
        Scripture quotations in this dedication are from the King James Version.
      </p>

      <div class="copy-back">
        <a href="/">&#8592; Back to home</a>
        &nbsp;&nbsp;&middot;&nbsp;&nbsp;
        <a href="/copyright">Copyright &amp; Credits</a>
      </div>
    </div>
  </div>
</body>
</html>`);
});

module.exports = router;
