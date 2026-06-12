const express   = require('express');
const fs        = require('fs');
const path      = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { requireAuth, renderLayout, getIsAdmin } = require('./layout');

const router          = express.Router();
const STUDIES_PATH    = path.join(__dirname, '../data/studies.json');
const DIALOGUES_PATH  = path.join(__dirname, '../data/dialogues.json');
const ARTICLES_PATH   = path.join(__dirname, '../data/articles.json');
const DEVOTIONAL_PATH = path.join(__dirname, '../data/devotional.json');

const VERSES = [
  // Psalms
  { text: "Blessed is the man who does not walk in the counsel of the wicked, nor stand in the path of sinners, nor sit in the seat of scoffers! But his delight is in the law of the LORD, and in His law he meditates day and night.", ref: "Psalm 1:1–2" },
  { text: "The law of the LORD is perfect, restoring the soul; the testimony of the LORD is sure, making wise the simple.", ref: "Psalm 19:7" },
  { text: "The heavens are telling of the glory of God; and their expanse is declaring the work of His hands.", ref: "Psalm 19:1" },
  { text: "The LORD is my shepherd, I shall not want.", ref: "Psalm 23:1" },
  { text: "The LORD is my light and my salvation; whom shall I fear? The LORD is the defense of my life; whom shall I dread?", ref: "Psalm 27:1" },
  { text: "Taste and see that the LORD is good; how blessed is the man who takes refuge in Him!", ref: "Psalm 34:8" },
  { text: "God is our refuge and strength, a very present help in trouble.", ref: "Psalm 46:1" },
  { text: "Create in me a clean heart, O God, and renew a steadfast spirit within me.", ref: "Psalm 51:10" },
  { text: "Lord, You have been our dwelling place in all generations. Before the mountains were born or You gave birth to the earth and the world, even from everlasting to everlasting, You are God.", ref: "Psalm 90:1–2" },
  { text: "Know that the LORD Himself is God; it is He who has made us, and not we ourselves; we are His people and the sheep of His pasture.", ref: "Psalm 100:3" },
  { text: "As far as the east is from the west, so far has He removed our transgressions from us.", ref: "Psalm 103:12" },
  { text: "Your word is a lamp to my feet and a light to my path.", ref: "Psalm 119:105" },
  { text: "Your word I have treasured in my heart, that I may not sin against You.", ref: "Psalm 119:11" },
  { text: "The unfolding of Your words gives light; it gives understanding to the simple.", ref: "Psalm 119:130" },
  { text: "I will give thanks to You, for I am fearfully and wonderfully made; wonderful are Your works, and my soul knows it very well.", ref: "Psalm 139:14" },
  { text: "Great is the LORD, and highly to be praised, and His greatness is unsearchable.", ref: "Psalm 145:3" },
  { text: "Where can I go from Your Spirit? Or where can I flee from Your presence?", ref: "Psalm 139:7" },
  // Proverbs
  { text: "The fear of the LORD is the beginning of wisdom; a good understanding have all those who do His commandments.", ref: "Psalm 111:10" },
  { text: "The fear of the LORD is the beginning of knowledge; fools despise wisdom and instruction.", ref: "Proverbs 1:7" },
  { text: "Trust in the LORD with all your heart and do not lean on your own understanding. In all your ways acknowledge Him, and He will make your paths straight.", ref: "Proverbs 3:5–6" },
  { text: "Watch over your heart with all diligence, for from it flow the springs of life.", ref: "Proverbs 4:23" },
  { text: "The heart of man plans his way, but the LORD directs his steps.", ref: "Proverbs 16:9" },
  { text: "Iron sharpens iron, and one man sharpens another.", ref: "Proverbs 27:17" },
  { text: "Every word of God is tested; He is a shield to those who take refuge in Him.", ref: "Proverbs 30:5" },
  // Old Testament
  { text: "In the beginning God created the heavens and the earth.", ref: "Genesis 1:1" },
  { text: "And I will put enmity between you and the woman, and between your seed and her seed; He shall bruise you on the head, and you shall bruise Him on the heel.", ref: "Genesis 3:15" },
  { text: "Hear, O Israel! The LORD is our God, the LORD is one! You shall love the LORD your God with all your heart and with all your soul and with all your might.", ref: "Deuteronomy 6:4–5" },
  { text: "And the one called to the other and said, 'Holy, Holy, Holy, is the LORD of hosts, the whole earth is full of His glory.'", ref: "Isaiah 6:3" },
  { text: "Do you not know? Have you not heard? The Everlasting God, the LORD, the Creator of the ends of the earth does not become weary or tired.", ref: "Isaiah 40:28" },
  { text: "But He was pierced through for our transgressions, He was crushed for our iniquities; the chastening for our well-being fell upon Him, and by His scourging we are healed.", ref: "Isaiah 53:5" },
  { text: "So will My word be which goes forth from My mouth; it will not return to Me empty, without accomplishing what I desire, and without succeeding in the matter for which I sent it.", ref: "Isaiah 55:11" },
  { text: "Declaring the end from the beginning, and from ancient times things which have not been done, saying, 'My purpose will be established, and I will accomplish all My good pleasure.'", ref: "Isaiah 46:10" },
  { text: "The heart is more deceitful than all else and is desperately sick; who can understand it? I, the LORD, search the heart, I test the mind.", ref: "Jeremiah 17:9–10" },
  { text: "Moreover, I will give you a new heart and put a new spirit within you; and I will remove the heart of stone from your flesh and give you a heart of flesh.", ref: "Ezekiel 36:26" },
  { text: "For I, the LORD, do not change; therefore you, O sons of Jacob, are not consumed.", ref: "Malachi 3:6" },
  // Gospels
  { text: "Blessed are the poor in spirit, for theirs is the kingdom of heaven.", ref: "Matthew 5:3" },
  { text: "Come to Me, all who are weary and heavy-laden, and I will give you rest. Take My yoke upon you and learn from Me, for I am gentle and humble in heart, and you will find rest for your souls.", ref: "Matthew 11:28–29" },
  { text: "All authority has been given to Me in heaven and on earth. Go therefore and make disciples of all the nations, baptizing them in the name of the Father and the Son and the Holy Spirit.", ref: "Matthew 28:18–19" },
  { text: "In the beginning was the Word, and the Word was with God, and the Word was God.", ref: "John 1:1" },
  { text: "And the Word became flesh, and dwelt among us, and we saw His glory, glory as of the only begotten from the Father, full of grace and truth.", ref: "John 1:14" },
  { text: "For God so loved the world, that He gave His only begotten Son, that whoever believes in Him shall not perish, but have eternal life.", ref: "John 3:16" },
  { text: "You search the Scriptures because you think that in them you have eternal life; it is these that testify about Me.", ref: "John 5:39" },
  { text: "All that the Father gives Me will come to Me, and the one who comes to Me I will certainly not cast out.", ref: "John 6:37" },
  { text: "My sheep hear My voice, and I know them, and they follow Me; and I give eternal life to them, and they will never perish; and no one will snatch them out of My hand.", ref: "John 10:27–28" },
  { text: "Jesus said to him, 'I am the way, and the truth, and the life; no one comes to the Father but through Me.'", ref: "John 14:6" },
  { text: "Sanctify them in the truth; Your word is truth.", ref: "John 17:17" },
  // Epistles — Romans
  { text: "For I am not ashamed of the gospel, for it is the power of God for salvation to everyone who believes, to the Jew first and also to the Greek.", ref: "Romans 1:16" },
  { text: "For all have sinned and fall short of the glory of God, being justified as a gift by His grace through the redemption which is in Christ Jesus.", ref: "Romans 3:23–24" },
  { text: "Therefore, having been justified by faith, we have peace with God through our Lord Jesus Christ.", ref: "Romans 5:1" },
  { text: "But God demonstrates His own love toward us, in that while we were yet sinners, Christ died for us.", ref: "Romans 5:8" },
  { text: "Therefore there is now no condemnation for those who are in Christ Jesus.", ref: "Romans 8:1" },
  { text: "And we know that God causes all things to work together for good to those who love God, to those who are called according to His purpose.", ref: "Romans 8:28" },
  { text: "For those whom He foreknew, He also predestined to become conformed to the image of His Son, so that He would be the firstborn among many brothers.", ref: "Romans 8:29" },
  { text: "For I am convinced that neither death, nor life, nor angels, nor principalities, nor things present, nor things to come, nor powers, nor height, nor depth, nor any other created thing, will be able to separate us from the love of God, which is in Christ Jesus our Lord.", ref: "Romans 8:38–39" },
  { text: "So then it does not depend on the man who wills or the man who runs, but on God who has mercy.", ref: "Romans 9:16" },
  { text: "For from Him and through Him and to Him are all things. To Him be the glory forever. Amen.", ref: "Romans 11:36" },
  // Epistles — Corinthians, Galatians
  { text: "But by His doing you are in Christ Jesus, who became to us wisdom from God, and righteousness and sanctification, and redemption, so that, just as it is written, 'Let him who boasts, boast in the Lord.'", ref: "1 Corinthians 1:30–31" },
  { text: "For I determined to know nothing among you except Jesus Christ, and Him crucified.", ref: "1 Corinthians 2:2" },
  { text: "Whether, then, you eat or drink or whatever you do, do all to the glory of God.", ref: "1 Corinthians 10:31" },
  { text: "He made Him who knew no sin to be sin on our behalf, so that we might become the righteousness of God in Him.", ref: "2 Corinthians 5:21" },
  { text: "I have been crucified with Christ; and it is no longer I who live, but Christ lives in me; and the life which I now live in the flesh I live by faith in the Son of God, who loved me and gave Himself up for me.", ref: "Galatians 2:20" },
  { text: "Christ redeemed us from the curse of the Law, having become a curse for us.", ref: "Galatians 3:13" },
  // Epistles — Ephesians, Philippians, Colossians
  { text: "Just as He chose us in Him before the foundation of the world, that we would be holy and blameless before Him. In love He predestined us to adoption as sons through Jesus Christ to Himself, according to the kind intention of His will.", ref: "Ephesians 1:4–5" },
  { text: "For by grace you have been saved through faith; and that not of yourselves, it is the gift of God; not as a result of works, so that no one may boast.", ref: "Ephesians 2:8–9" },
  { text: "For we are His workmanship, created in Christ Jesus for good works, which God prepared beforehand so that we would walk in them.", ref: "Ephesians 2:10" },
  { text: "For I am confident of this very thing, that He who began a good work in you will perfect it until the day of Christ Jesus.", ref: "Philippians 1:6" },
  { text: "For it is God who is at work in you, both to will and to work for His good pleasure.", ref: "Philippians 2:13" },
  { text: "He is the image of the invisible God, the firstborn of all creation. For by Him all things were created, both in the heavens and on earth, visible and invisible.", ref: "Colossians 1:15–16" },
  { text: "In whom are hidden all the treasures of wisdom and knowledge.", ref: "Colossians 2:3" },
  // Epistles — Pastoral, Hebrews, Peter, John, Jude
  { text: "It is a trustworthy statement, deserving full acceptance, that Christ Jesus came into the world to save sinners, among whom I am foremost.", ref: "1 Timothy 1:15" },
  { text: "All Scripture is God-breathed and profitable for teaching, for reproof, for correction, for training in righteousness; so that the man of God may be adequate, equipped for every good work.", ref: "2 Timothy 3:16–17" },
  { text: "God, after He spoke long ago to the fathers in the prophets in many portions and in many ways, in these last days has spoken to us in His Son, whom He appointed heir of all things, through whom also He made the world.", ref: "Hebrews 1:1–2" },
  { text: "For the word of God is living and active and sharper than any two-edged sword, and piercing as far as the division of soul and spirit, of both joints and marrow, and able to judge the thoughts and intentions of the heart.", ref: "Hebrews 4:12" },
  { text: "Now faith is the assurance of things hoped for, the conviction of things not seen.", ref: "Hebrews 11:1" },
  { text: "Fixing our eyes on Jesus, the author and perfecter of faith, who for the joy set before Him endured the cross, despising the shame, and has sat down at the right hand of the throne of God.", ref: "Hebrews 12:2" },
  { text: "For you have been born again not of seed which is perishable but imperishable, that is, through the living and enduring word of God.", ref: "1 Peter 1:23" },
  { text: "But you are a chosen race, a royal priesthood, a holy nation, a people for God's own possession, so that you may proclaim the excellencies of Him who has called you out of darkness into His marvelous light.", ref: "1 Peter 2:9" },
  { text: "For no prophecy was ever made by an act of human will, but men moved by the Holy Spirit spoke from God.", ref: "2 Peter 1:21" },
  { text: "If we confess our sins, He is faithful and righteous to forgive us our sins and to cleanse us from all unrighteousness.", ref: "1 John 1:9" },
  { text: "By this the love of God was manifested in us, that God has sent His only begotten Son into the world so that we might live through Him.", ref: "1 John 4:9" },
  { text: "Contend earnestly for the faith which was once for all handed down to the saints.", ref: "Jude 3" },
];

function getDayOfYear() {
  const now   = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const diff  = now - start;
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function getVerseOfTheDay() {
  return VERSES[(getDayOfYear() - 1) % VERSES.length];
}

function getStudiesCount(userId) {
  try {
    if (!fs.existsSync(STUDIES_PATH)) return 0;
    const data = JSON.parse(fs.readFileSync(STUDIES_PATH, 'utf8'));
    return data.filter(s => s.userId === userId).length;
  } catch { return 0; }
}

function getDialoguesCount(userId) {
  try {
    if (!fs.existsSync(DIALOGUES_PATH)) return 0;
    const data = JSON.parse(fs.readFileSync(DIALOGUES_PATH, 'utf8'));
    return data.filter(d => d.userId === userId).length;
  } catch { return 0; }
}

function getArticlesCount(userId) {
  try {
    if (!fs.existsSync(ARTICLES_PATH)) return 0;
    const data = JSON.parse(fs.readFileSync(ARTICLES_PATH, 'utf8'));
    return data.filter(a => a.userId === userId && (a.status === 'Complete' || a.status === 'Published')).length;
  } catch { return 0; }
}

function getPendingCount() {
  try {
    if (!fs.existsSync(ARTICLES_PATH)) return 0;
    const data = JSON.parse(fs.readFileSync(ARTICLES_PATH, 'utf8'));
    return data.filter(a => a.status === 'Pending').length;
  } catch { return 0; }
}

async function getDailyDevotional(req) {
  const today = new Date().toISOString().slice(0, 10);

  try {
    if (fs.existsSync(DEVOTIONAL_PATH)) {
      const cached = JSON.parse(fs.readFileSync(DEVOTIONAL_PATH, 'utf8'));
      if (cached.date === today && cached.content) return cached.content;
    }
  } catch {}

  const { IRON_INK_CORE_PROMPT } = req.app.locals.prompts;
  const systemPrompt = IRON_INK_CORE_PROMPT +
    '\n\nFor this task you are generating the daily devotional feature for the Iron & Ink platform. ' +
    'Write with full doctrinal precision, pastoral warmth, and confessionally Reformed conviction.';

  const dateStr    = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const userPrompt = `Write the Iron & Ink Daily Devotional for ${dateStr}. Use exactly these four section headings:

## Scripture
Choose a passage of 3–5 verses — a psalm, a prophet, a Gospel, or an epistle. Choose for doctrinal richness. Print the complete LSB text of every verse, word for word.

## Exposition
Write 2–3 paragraphs of careful, doctrinally serious exposition. Engage the theology directly — what does this passage teach about God, man, sin, grace, or redemption? Think like a Reformed pastor who takes the student seriously. No shallow encouragement. No moralism.

## Application
One focused paragraph. Specific and searching — aimed at the conscience and the mind. What does this passage demand of the reader today?

## Prayer
A brief closing prayer (3–5 sentences) addressed directly to God. Let it be confessional and specific — flowing from the passage and exposition, not generic.

Tone: warm but serious. Reformed and confessional.`;

  try {
    const client  = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const message = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 1400,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userPrompt }],
    });
    const content = message.content[0].text;
    fs.writeFileSync(DEVOTIONAL_PATH, JSON.stringify({ date: today, content }, null, 2), 'utf8');
    return content;
  } catch (err) {
    console.error('Devotional generation error:', err.message);
    return null;
  }
}

router.get('/dashboard', requireAuth, async (req, res) => {
  const user           = req.session.user;
  const firstName      = (user.fullName || 'Scholar').split(' ')[0];
  const studyCount     = getStudiesCount(req.session.userId);
  const dialogueCount  = getDialoguesCount(req.session.userId);
  const articlesCount  = getArticlesCount(req.session.userId);
  const isAdmin        = getIsAdmin(req);
  const pendingCount   = isAdmin ? getPendingCount() : 0;
  const verse             = getVerseOfTheDay();
  const devotionalContent = await getDailyDevotional(req);
  const showWelcome       = req.session.firstLogin === true;
  if (showWelcome) req.session.firstLogin = false;

  const content = `
    ${showWelcome ? `<div id="welcomeBanner" style="
      background:rgba(179,140,51,0.12); border:1px solid rgba(179,140,51,0.35);
      border-radius:6px; padding:14px 18px; margin-bottom:20px;
      display:flex; align-items:center; justify-content:space-between; gap:12px;
      cursor:pointer;" onclick="this.style.display='none'">
      <span style="color:var(--accent); font-family:'EB Garamond',Georgia,serif; font-size:1.05rem; font-style:italic;">
        Welcome to Iron &amp; Ink. The iron begins to sharpen.
      </span>
      <span style="color:var(--warm-brown); font-size:0.8rem;">&#10005;</span>
    </div>` : ''}
    <div class="page-header">
      <h2 class="page-title" id="greeting">Good day, ${firstName}.</h2>
      <p class="page-subtitle">May your study be fruitful to the glory of God.</p>
    </div>

    <div class="verse-card">
      <div class="verse-label">Verse of the Day</div>
      <div class="verse-text">"${verse.text}"</div>
      <div class="verse-ref">${verse.ref} — Legacy Standard Bible</div>
    </div>

    ${devotionalContent ? `
    <div class="devot-dashboard-card">
      <div class="devot-dashboard-label">Daily Devotional</div>
      <div id="dashDevotionalBody" class="devot-dashboard-body"></div>
      <div class="devot-dashboard-footer">
        <a href="/devotional" class="btn-reflect">Reflect on Today's Reading &#8594;</a>
      </div>
    </div>` : ''}

    <div class="stat-cards">
      <div class="stat-card">
        <div class="stat-label">Studies Completed</div>
        <div class="stat-value">${studyCount}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Dialogue Sessions</div>
        <div class="stat-value">${dialogueCount}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Articles Written</div>
        <div class="stat-value">${articlesCount}</div>
      </div>
    </div>

    ${isAdmin && pendingCount > 0 ? `
    <a href="/admin" class="admin-pending-alert">
      &#9873; ${pendingCount} article${pendingCount !== 1 ? 's' : ''} awaiting your review &#8594;
    </a>` : ''}

    <a href="/study" class="btn-primary">Begin a Study</a>`;

  const scripts = `
  <script>
    (function() {
      const h = new Date().getHours();
      const greeting = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
      document.getElementById('greeting').textContent = greeting + ', ${firstName}.';
    })();
    (function() {
      var el   = document.getElementById('dashDevotionalBody');
      var text = ${JSON.stringify(devotionalContent || '')};
      if (el && text) {
        el.innerHTML = marked.parse(text);
        el.style.fontSize = '1.1rem';
        el.querySelectorAll('p, blockquote').forEach(function(node) {
          node.style.fontSize = '1.1rem';
        });
      }
    })();
  </script>`;

  res.send(renderLayout({ req, activeSection: 'dashboard', title: 'Dashboard', content, scripts }));
});

module.exports = { router, getDailyDevotional };
