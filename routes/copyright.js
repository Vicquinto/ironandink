const express = require('express');
const router  = express.Router();
const { soundCredits, manuscriptCredits } = require('../lib/languages');

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// "Sources: Sound Clips": one line per clip in courses/sounds.json (the same
// file the lesson pages credit from). No clips, no section.
function soundClipsSection() {
  const clips = soundCredits();
  if (!clips.length) return '';
  const items = clips.map(s => {
    const name = s.commonsTitle.replace(/\.ogg$/i, '');
    return `          <li>${esc(name)}: <a href="${esc(s.commonsUrl)}" target="_blank" rel="noopener">&ldquo;${esc(s.commonsTitle)}&rdquo;</a>, recorded by ${esc(s.author)}.</li>`;
  }).join('\n');
  return `
      <hr class="copy-rule">

      <div class="copy-section-heading">Sources &mdash; Sound Clips</div>
      <p class="copy-body">
        The short &ldquo;Hear it&rdquo; clips in the Hebrew and Greek courses are recordings from
        <strong>Wikimedia Commons</strong>, used under the Creative Commons Attribution-Share Alike 3.0
        Unported license (<a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noopener">CC BY-SA 3.0</a>)
        and converted from Ogg Vorbis to MP3; the recordings are otherwise unchanged:
      </p>
      <ul class="copy-body copy-clip-list">
${items}
      </ul>
      <p class="copy-body">The clips themselves remain available under CC BY-SA 3.0.</p>
`;
}

// "Sources: Manuscript Images": the same caption as under each image on its
// course page (course.json "manuscript"). No image shown, no section.
function manuscriptSection() {
  const images = manuscriptCredits();
  if (!images.length) return '';
  const lines = images.map(im => `      <p class="copy-body">${im.caption.map(it => it.href
    ? `<a href="${esc(it.href)}" target="_blank" rel="noopener noreferrer">${esc(it.text)}</a>` : esc(it.text)).join('')}</p>`).join('\n');
  return `
      <hr class="copy-rule">

      <div class="copy-section-heading">Sources &mdash; Manuscript Images</div>
${lines}
`;
}

router.get('/copyright', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Copyright &amp; Credits — Iron &amp; Ink</title>
  <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/styles.css?v=130">
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

    .copy-clip-list { margin: 8px 0 12px 1.3em; padding: 0; overflow-wrap: anywhere; }

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

      <div class="copy-section-heading">New American Standard Bible (NASB 1995)</div>
      <p class="copy-body">
        Scripture quotations are taken from the <strong>New American Standard Bible&reg;</strong> (NASB),
        Copyright &copy; 1995 by The Lockman Foundation. All rights reserved. Used by permission.
        <a href="https://www.lockman.org" target="_blank" rel="noopener">lockman.org</a>
      </p>

      <hr class="copy-rule">

      <div class="copy-section-heading">Primary Translation</div>
      <p class="copy-body">
        Iron &amp; Ink uses the <strong>New American Standard Bible (NASB, 1995)</strong> as its primary
        Scripture text for the reader, study content, devotionals, and AI-generated theological material.
        Every verse is verified text inserted by the system &mdash; never produced by the AI model. Where a
        NASB verse is momentarily unavailable, the system silently falls back to the
        <strong>American Standard Version (ASV, 1901, public domain)</strong> so Scripture always displays;
        such verses are labeled ASV at the point of quotation.
      </p>

      <hr class="copy-rule">

      <div class="copy-section-heading">Sources &mdash; Original-Language Data</div>
      <p class="copy-body">
        The Hebrew and Greek shown word by word in the highlight panel&rsquo;s Original tab &mdash; the
        original words, transliterations, glosses, grammar, Strong&rsquo;s numbers and lexicon
        definitions &mdash; come from <strong>STEP Bible</strong>
        (<a href="https://www.STEPBible.org" target="_blank" rel="noopener">STEPBible.org</a>), based on
        work at <strong>Tyndale House, Cambridge</strong>: the Translators Amalgamated Hebrew OT (TAHOT,
        Leningrad codex), the Translators Amalgamated Greek NT (TAGNT), the Translators Brief lexicons of
        Extended Strongs, and the Translators Expansions of Hebrew and Greek Morphology Codes. Licensed under
        <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>;
        source: <a href="https://github.com/STEPBible/STEPBible-Data" target="_blank" rel="noopener">STEPBible-Data</a>.
        Reformatted for this site; the data itself is unchanged.
      </p>
${soundClipsSection()}${manuscriptSection()}

      <hr class="copy-rule">

      <div class="copy-section-heading">Platform</div>
      <p class="copy-body">
        Iron &amp; Ink is a confessionally Reformed Christian study and writing platform.
        All doctrinal content reflects Iron &amp; Ink&rsquo;s Confession (see What We Believe). The platform
        holds the doctrines of grace, and on secondary matters follows the MacArthur Study Bible tradition
        while presenting other Reformed views fairly.
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
