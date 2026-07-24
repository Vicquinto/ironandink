const express = require('express');
const router  = express.Router();
const { renderLayout } = require('./layout');

const SCRIPT = `
<script>
(function () {
  var tabs   = document.querySelectorAll('.believe-tab');
  var panels = document.querySelectorAll('.believe-panel');

  function switchTab(target) {
    tabs.forEach(function (t) {
      t.classList.toggle('active', t.getAttribute('data-tab') === target);
    });
    panels.forEach(function (p) {
      p.style.display = (p.id === 'believe-' + target) ? 'block' : 'none';
    });
  }

  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () { switchTab(tab.getAttribute('data-tab')); });
  });

  document.querySelectorAll('.believe-landing-card').forEach(function (card) {
    card.addEventListener('click', function () { switchTab(card.getAttribute('data-target')); });
  });

  var hash = window.location.hash.replace('#', '');
  if (hash === 'confession' || hash === 'covenant' || hash === 'story' || hash === 'contact' || hash === 'ai') switchTab(hash);
})();
</script>`;

function buildContent() {
  return `
  <div class="believe-wrap">

    <div class="believe-tabs">
      <button class="believe-tab active" data-tab="about">About</button>
      <button class="believe-tab" data-tab="confession">Confession</button>
      <button class="believe-tab" data-tab="covenant">Covenant</button>
      <button class="believe-tab" data-tab="story">Our Story</button>
      <button class="believe-tab" data-tab="contact">Contact</button>
      <button class="believe-tab" data-tab="ai">Where We Stand on AI</button>
    </div>

    <!-- ── About ── -->
    <div id="believe-about" class="believe-panel">
      <div class="copy-site-name">Iron &amp; Ink</div>
      <h1 class="copy-page-title">About</h1>
      <p class="copy-body">
        Iron &amp; Ink Theology exists to give Reformed believers a faithful place to
        study Scripture, sharpen one another in sound doctrine, and grow together in
        the knowledge of God. What follows are the convictions that shape everything we
        do here &mdash; our Confession of what we believe, our Covenant for how we
        engage with one another, and Our Story, the heart behind why this platform
        exists.
      </p>
      <div class="believe-landing-cards">
        <button class="believe-landing-card" data-target="confession">
          <span class="believe-card-num">I</span>
          Confession
        </button>
        <button class="believe-landing-card" data-target="covenant">
          <span class="believe-card-num">II</span>
          Covenant
        </button>
        <button class="believe-landing-card" data-target="story">
          <span class="believe-card-num">III</span>
          Our Story
        </button>
      </div>
    </div>

    <!-- ── Confession ── -->
    <div id="believe-confession" class="believe-panel" style="display:none;">
      <div class="copy-site-name">Iron &amp; Ink</div>
      <h1 class="copy-page-title">Our Confession</h1>
      <p class="copy-body" style="margin-bottom:28px;">
        Iron &amp; Ink Theology is built on the historic doctrines of grace and a high
        view of Scripture&rsquo;s authority. What follows is a basic summary of what we
        believe.
      </p>
      <hr class="copy-rule">

      <div class="believe-article">
        <div class="believe-article-heading">
          <span class="believe-article-num">I.</span>Scripture
        </div>
        <p class="copy-body">We believe the Bible, as originally given, is the inspired, inerrant, and
        sufficient Word of God, and the final authority for all matters of faith and life.</p>
      </div>

      <div class="believe-article">
        <div class="believe-article-heading">
          <span class="believe-article-num">II.</span>God
        </div>
        <p class="copy-body">We believe in one God, eternally existing in three persons &mdash; Father,
        Son, and Holy Spirit &mdash; equal in power and glory.</p>
      </div>

      <div class="believe-article">
        <div class="believe-article-heading">
          <span class="believe-article-num">III.</span>Man and Sin
        </div>
        <p class="copy-body">We believe mankind was created in God&rsquo;s image but fell into sin in
        Adam, and that every person is by nature spiritually dead and unable to come to God apart from
        His grace.</p>
      </div>

      <div class="believe-article">
        <div class="believe-article-heading">
          <span class="believe-article-num">IV.</span>Salvation &mdash; The Doctrines of Grace
        </div>
        <p class="copy-body">We believe salvation is by grace alone, through faith alone, in Christ
        alone &mdash; rooted in God&rsquo;s sovereign, unconditional election, accomplished through
        Christ&rsquo;s particular atonement for His elect, applied by the Spirit&rsquo;s irresistible
        call, and secured by the perseverance of the saints to the end.</p>
      </div>

      <div class="believe-article">
        <div class="believe-article-heading">
          <span class="believe-article-num">V.</span>Christ
        </div>
        <p class="copy-body">We believe Jesus Christ is fully God and fully man, who lived a sinless
        life, died as a substitutionary sacrifice for sin, rose bodily from the dead, and now reigns
        and intercedes for His people.</p>
      </div>

      <div class="believe-article">
        <div class="believe-article-heading">
          <span class="believe-article-num">VI.</span>The Church
        </div>
        <p class="copy-body">We believe the Church is the body of Christ, called to worship Him, build
        up one another, and proclaim the gospel to the world.</p>
      </div>

      <div class="believe-article believe-article-last">
        <div class="believe-article-heading">
          <span class="believe-article-num">VII.</span>Last Things
        </div>
        <p class="copy-body">We believe in the personal, visible return of Jesus Christ, the
        resurrection of the dead, and the final judgment, after which the redeemed will dwell with
        God forever.</p>
      </div>
    </div>

    <!-- ── Covenant ── -->
    <div id="believe-covenant" class="believe-panel" style="display:none;">
      <div class="copy-site-name">Iron &amp; Ink</div>
      <h1 class="copy-page-title">Our Covenant</h1>
      <p class="copy-body" style="margin-bottom:28px;">
        Iron &amp; Ink is meant to be a safe, doctrinally settled space for Reformed
        believers to study, write, and discuss together. As members of this community,
        we commit to the following:
      </p>
      <hr class="copy-rule">
      <ul class="believe-covenant-list">
        <li class="believe-covenant-item">
          <span class="believe-covenant-bullet">&#10013;</span>
          <span>Engaging with Scripture honestly, and with one another humbly.</span>
        </li>
        <li class="believe-covenant-item">
          <span class="believe-covenant-bullet">&#10013;</span>
          <span>Studying, writing, and discussing from within a Reformed theological framework,
          rather than using this community as a venue to debate or undermine its core
          convictions.</span>
        </li>
        <li class="believe-covenant-item">
          <span class="believe-covenant-bullet">&#10013;</span>
          <span>Treating one another with the patience and charity Christ has shown us,
          especially in disagreement.</span>
        </li>
        <li class="believe-covenant-item">
          <span class="believe-covenant-bullet">&#10013;</span>
          <span>Building one another up, not tearing down.</span>
        </li>
        <li class="believe-covenant-item">
          <span class="believe-covenant-bullet">&#10013;</span>
          <span>Handling disagreement directly and graciously, rather than through gossip,
          mockery, or contempt.</span>
        </li>
      </ul>
    </div>

    <!-- ── Our Story ── -->
    <div id="believe-story" class="believe-panel" style="display:none;">
      <div class="copy-site-name">Iron &amp; Ink</div>
      <h1 class="copy-page-title">Our Story</h1>
      <p class="copy-body">
        Iron &amp; Ink Theology was founded by Carlo and Jamie Giaquinto out of a desire to
        create a faithful, focused space for Reformed Christians to study Scripture deeply
        and grow together in sound doctrine &mdash; a place shaped by a high view of
        God&rsquo;s Word and a commitment to the historic doctrines of grace.
      </p>
      <div class="believe-placeholder">
        <strong>[ More to come ]</strong> &mdash; Carlo and Jamie will be adding more
        personal background here in a future update: the journey that led to building
        Iron &amp; Ink, what it means to them, and why this kind of community matters.
        Check back soon.
      </div>
    </div>

    <!-- ── Contact ── -->
    <div id="believe-contact" class="believe-panel" style="display:none;">
      <div class="copy-site-name">Iron &amp; Ink</div>
      <h1 class="copy-page-title">Contact</h1>
      <p class="copy-body">
        Iron &amp; Ink is built and maintained by Carlo and Jamie Giaquinto. We read
        everything that comes in, and we reply.
      </p>
      <p class="copy-body">
        If you have a question, run into a problem, notice something that doesn&rsquo;t
        seem right, or have an idea for something that would make the platform more
        useful, please write to us:
      </p>
      <p style="text-align:center; margin:28px 0;">
        <a href="mailto:contact@ironandinktheology.com"
           style="color:var(--accent); text-decoration:none; font-size:1.5rem; letter-spacing:0.01em;">contact@ironandinktheology.com</a>
      </p>
      <p class="copy-body">
        Iron &amp; Ink is in active early access and is being built continually. Your
        questions and suggestions genuinely shape what gets built next &mdash; don&rsquo;t
        hesitate to reach out.
      </p>
    </div>

    <!-- ── Where We Stand on AI ── -->
    <div id="believe-ai" class="believe-panel" style="display:none;">
      <style>
        #believe-ai .copy-body { margin-bottom: 1.25em; }
        #believe-ai .copy-body:has(> strong) { margin-top: 1.9em; }
        #believe-ai .copy-body:last-child { margin-bottom: 0; }
      </style>
      <div class="copy-site-name">Iron &amp; Ink</div>
      <h1 class="copy-page-title">Where We Stand on AI</h1>
      <p class="copy-body">
        Iron &amp; Ink uses artificial intelligence, and we want to be plain about that
        from the start &mdash; not buried in fine print, but stated openly, because we
        think you deserve to know exactly what you&rsquo;re joining and how we&rsquo;ve
        thought about it.
      </p>
      <p class="copy-body">
        We understand that many thoughtful Christians have real reservations about AI,
        and we do not take those concerns lightly. Some worry about discernment. Some
        worry about a machine standing between a believer and the Word. Some simply
        wonder whether a tool like this belongs anywhere near the study of Scripture.
        These are good questions, asked in good faith, and we have wrestled with them
        ourselves in building this platform.
      </p>
      <p class="copy-body">
        Here is how we have answered them.
      </p>
      <p class="copy-body">
        <strong>The AI never writes Scripture.</strong> This is the safeguard we care
        about most. When a study is generated, the AI is not permitted to produce the
        words of the Bible. It can only mark where a verse belongs &mdash; and our own
        system then inserts the verified text from a trusted source. The result is that
        the Scripture you read on Iron &amp; Ink is never written, paraphrased, or
        altered by a machine. It is the Word, unchanged, placed by us &mdash; not by
        the AI.
      </p>
      <p class="copy-body">
        <strong>The AI is a tool, not an authority.</strong> Iron &amp; Ink uses AI the
        way a serious student uses a concordance, a lexicon, or a commentary &mdash; as
        an aid to study, never as a substitute for it. The authority in your study is,
        and remains, the Word of God, read in the light of the historic Reformed
        confessions and by the illumination of the Holy Spirit. No study we generate is
        beyond your examination. We built this platform for Bereans &mdash; people who
        test everything against Scripture &mdash; and we expect you to test what you
        find here.
      </p>
      <p class="copy-body">
        <strong>Everything is confessionally bounded.</strong> The studies, the
        dialogues, and the tools are all shaped to a confessionally Reformed standard.
        This is not a neutral machine answering from nowhere; it is a tool built to
        serve a particular, historic understanding of the faith.
      </p>
      <p class="copy-body">
        <strong>A word from us, personally.</strong> We built Iron &amp; Ink because we
        use it ourselves, and we did not come to it lightly. We have watched closely to
        see whether its studies would hold the line &mdash; whether the doctrine would
        stay true to the Reformed confession or drift, as so much teaching does, toward
        other traditions. It has held. Study after study has come back faithful to the
        doctrines of grace, grounded in the confessions we love. And because our system
        never lets the AI write the words of Scripture itself &mdash; inserting only
        verified text &mdash; the Bible you read here remains the Bible, untouched. We
        do not claim the tool is beyond all error; no tool is. But on the things that
        matter most &mdash; the fidelity of the doctrine and the integrity of the Word
        &mdash; we have found it faithful, and we have built it to stay that way.
      </p>
      <p class="copy-body">
        <strong>Your discernment is essential.</strong> No tool &mdash; human or
        otherwise &mdash; replaces the work God does in a believer through His Word and
        Spirit. Use Iron &amp; Ink as you would any study aid: with your Bible open,
        your mind engaged, and your heart prayerful. Bring what you learn here to the
        Lord, to your church, and to the Scriptures themselves. The tool serves the
        study. The study serves the soul. And the soul answers to God alone.
      </p>
      <p class="copy-body">
        We offer Iron &amp; Ink in that spirit &mdash; as a servant of your study, not
        a shortcut around it. If that is the kind of tool you are looking for, we would
        be glad to have you.
      </p>
      <p class="copy-body"><em>Soli Deo Gloria.</em></p>
    </div>

  </div>`;
}

router.get('/what-we-believe', (req, res) => {
  if (req.session && req.session.userId) {
    return res.send(renderLayout({
      req,
      activeSection: 'believe',
      title: 'What We Believe',
      content: buildContent(),
      scripts: SCRIPT,
    }));
  }

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>About &mdash; Iron &amp; Ink</title>
  <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/styles.css?v=69">
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
      max-width: 700px;
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(92,26,40,0.2);
      border-radius: 6px;
      padding: 40px 48px;
    }
    .pub-back {
      margin-bottom: 20px;
      font-size: 0.88rem;
      color: var(--warm-brown);
    }
    .pub-back a { color: var(--accent); text-decoration: none; }
    .pub-back a:hover { text-decoration: underline; }
    @media (max-width: 600px) {
      .copy-card { padding: 28px 20px; }
    }
  </style>
</head>
<body>
  <div class="copy-wrap">
    <div class="copy-card">
      <p class="pub-back"><a href="/">&larr; Back to Home</a></p>
      ${buildContent()}
    </div>
  </div>
  ${SCRIPT}
</body>
</html>`);
});

module.exports = router;
