const express = require('express');
const { escapeHtml, inlineJson } = require('../lib/html');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');
const { randomUUID } = require('crypto');
const { sendMail } = require('../lib/mailer');
const { requireAuth, renderLayout } = require('./layout');
// Reuse the single ADMIN_NOTIFY_EMAIL source of truth from invite.js — no second
// address constant. (invite.js exports the same env-driven value it uses itself.)
const { ADMIN_NOTIFY_EMAIL } = require('./invite');

const USERS_PATH_H   = path.join(__dirname, '../data/users.json');
const FEEDBACK_PATH  = path.join(__dirname, '../data/feedback.json');

// Best-effort admin notification when a member submits feedback. Goes through
// lib/mailer.js like every other email; sendMail never throws and logs its own
// failures, so a send problem can never break the feedback submission.
async function sendFeedbackNotification({ fullName, text, submittedAt }) {
  const result = await sendMail({
    tag:  'feedbackNotify',
    to:   ADMIN_NOTIFY_EMAIL,
    subject: 'New Iron & Ink feedback',
    text: `A member has submitted feedback.\n\nName: ${fullName}\nSubmitted: ${submittedAt}\n\nFeedback:\n${text}\n\nView it in the Admin panel.\n\nSoli Deo Gloria,\nIron & Ink`,
    html: `<p>A member has submitted feedback.</p>
<p><strong>Name:</strong> ${escapeHtml(fullName)}<br><strong>Submitted:</strong> ${escapeHtml(submittedAt)}</p>
<p><strong>Feedback:</strong></p>
<p style="white-space:pre-wrap;">${escapeHtml(text)}</p>
<p>View it in the Admin panel.</p>
<p><em>Soli Deo Gloria,</em><br>Iron &amp; Ink</p>`,
  });
  if (result.ok) console.log('[feedbackNotify] sent to', ADMIN_NOTIFY_EMAIL);
}

function readJSON(p) {
  try {
    if (!fs.existsSync(p)) return [];
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch { return []; }
}

function writeJSON(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

router.get('/help', requireAuth, (req, res) => {
  const content = `
    <div class="help-wrap">
      <div class="copy-card">
        <div class="copy-site-name">Iron &amp; Ink</div>
        <h1 class="copy-page-title">Getting Started</h1>

        <div class="copy-section-heading">Welcome</div>
        <p class="copy-body">Welcome to Iron &amp; Ink &mdash; a quick orientation before you begin.</p>

        <hr class="copy-rule">

        <div class="copy-section-heading">The Features</div>
        <ul class="welcome-feature-list" style="margin-top:16px;">
          <li class="welcome-feature-item">
            <span class="welcome-feature-name">Study</span>
            <span class="welcome-feature-desc">Generate a structured, confessionally Reformed study on any theological topic, passage, or question, at your chosen reading level.</span>
          </li>
          <li class="welcome-feature-item">
            <span class="welcome-feature-name">Dialogue</span>
            <span class="welcome-feature-desc">Sharpen your understanding by defending the Reformed position against an AI trained to raise the strongest objections from other traditions.</span>
          </li>
          <li class="welcome-feature-item">
            <span class="welcome-feature-name">Writing</span>
            <span class="welcome-feature-desc">Compose an article, sermon, or letter in your own voice, guided by a few questions. When you&#39;re finished, you can submit it for review, and once approved it&#39;s published to the community.</span>
          </li>
          <li class="welcome-feature-item">
            <span class="welcome-feature-name">Library</span>
            <span class="welcome-feature-desc">Everything you save lives here: your studies, ready to revisit anytime.</span>
          </li>
          <li class="welcome-feature-item">
            <span class="welcome-feature-name">Scripture</span>
            <span class="welcome-feature-desc">Read the Bible directly, track your reading progress, and look up any verse.</span>
          </li>
          <li class="welcome-feature-item">
            <span class="welcome-feature-name">Devotional</span>
            <span class="welcome-feature-desc">A fresh daily devotional &mdash; Scripture, exposition, application, and prayer &mdash; with an archive of past days to browse.</span>
          </li>
          <li class="welcome-feature-item">
            <span class="welcome-feature-name">Prayer Requests</span>
            <span class="welcome-feature-desc">Share requests with the community and pray for one another. You may post anonymously if you wish, and mark a prayer answered when the Lord provides.</span>
          </li>
          <li class="welcome-feature-item">
            <span class="welcome-feature-name">Selah</span>
            <span class="welcome-feature-desc">Your private space for prayer, meditation, and journaling before the Lord.</span>
          </li>
          <li class="welcome-feature-item">
            <span class="welcome-feature-name">Messaging</span>
            <span class="welcome-feature-desc">Quietly encourage and correspond with other members one-on-one.</span>
          </li>
          <li class="welcome-feature-item">
            <span class="welcome-feature-name">Live Rooms</span>
            <span class="welcome-feature-desc">Study together in real time. Host or join a room, and discuss as you go.</span>
          </li>
        </ul>

        <hr class="copy-rule">

        <div class="copy-section-heading">Study Notes</div>
        <p class="copy-body">Study Notes keeps what you learn in Study with a Teacher, one page per study. Open it from the study&#39;s card in your Library, beside Print in an open study, or from the Teacher page.</p>
        <ul class="welcome-feature-list" style="margin-top:16px;">
          <li class="welcome-feature-item">
            <span class="welcome-feature-name">Saving a point</span>
            <span class="welcome-feature-desc">On a computer, select part of one of the teacher&#39;s finished replies and choose <strong>Save this point</strong> beside it. On a phone, select the words and tap <strong>Save this point</strong> in the bar below the conversation. You can add a note of your own. Scripture in a point is kept as its reference, and always shown from the verified text.</span>
          </li>
          <li class="welcome-feature-item">
            <span class="welcome-feature-name">Key points</span>
            <span class="welcome-feature-desc">A short AI summary of the teaching in one section, written when you move on from it or end a session. If a section has teaching but no key points, press <strong>Create recap</strong>. It is a summary, so the full teaching is there to check it against.</span>
          </li>
          <li class="welcome-feature-item">
            <span class="welcome-feature-name">What&#39;s on the page</span>
            <span class="welcome-feature-desc">Section by section, in the study&#39;s order: the key points, your saved points, your notes on the study text, and the full teaching from your lessons. Points and notes that belong to no section come after.</span>
          </li>
          <li class="welcome-feature-item">
            <span class="welcome-feature-name">Sections</span>
            <span class="welcome-feature-desc">Click a section&#39;s title to open or close it, or use <strong>Expand all</strong> and <strong>Collapse all</strong>. <strong>Teach me this section</strong>, beside each title, opens the teacher there.</span>
          </li>
          <li class="welcome-feature-item">
            <span class="welcome-feature-name">Moving a point</span>
            <span class="welcome-feature-desc">Choose <strong>Move to section&#8230;</strong> under a saved point to place it under another section.</span>
          </li>
          <li class="welcome-feature-item">
            <span class="welcome-feature-name">Printing</span>
            <span class="welcome-feature-desc">Choose <strong>Print</strong> at the top of the page. You can include the full teaching.</span>
          </li>
          <li class="welcome-feature-item">
            <span class="welcome-feature-name">Deleting</span>
            <span class="welcome-feature-desc"><strong>Delete these Study Notes</strong>, at the bottom of the page, removes your saved points and key points for that study, and earlier lessons kept from Start over if you tick the box. Your notes on the study text and your current lesson stay. Deleting a lesson removes that conversation but keeps your points and key points. Deleting a study from your Library also deletes your Study Notes, notes and Teacher sessions for it.</span>
          </li>
        </ul>

        <hr class="copy-rule">

        <div class="copy-section-heading">Sharing Study Notes</div>
        <p class="copy-body">You can share your Study Notes for one of your own studies with another Iron &amp; Ink member, such as your husband or wife or a study partner. They can read and print what you share, and read the study itself. They can&#39;t change anything or share it further, and they can&#39;t see anything else of yours.</p>
        <ul class="welcome-feature-list" style="margin-top:16px;">
          <li class="welcome-feature-item">
            <span class="welcome-feature-name">Sharing</span>
            <span class="welcome-feature-desc">On a study&#39;s Study Notes page, choose <strong>Share with a member</strong>, pick the member, and tick what they can read: Key points, Your saved points, Your notes on the study, and Full teaching. Full teaching is not ticked to begin with, because it includes your own questions and answers in the lesson. <strong>See what they&#39;ll see</strong> shows the page exactly as they will. After you share, <strong>Copy link</strong> gives you the link to send them yourself.</span>
          </li>
          <li class="welcome-feature-item">
            <span class="welcome-feature-name">What they see</span>
            <span class="welcome-feature-desc">Your notes as they are now, including anything you add later, under &#8220;Notes by&#8221; your name. They find them in their Library, under <strong>Shared with me</strong>. If a page was already open when you change something, they see the change when they open or reload it.</span>
          </li>
          <li class="welcome-feature-item">
            <span class="welcome-feature-name">Changing or stopping</span>
            <span class="welcome-feature-desc">The names you&#39;ve shared with are listed under the page&#39;s title. Choose a name to change what&#39;s shared, copy the link again, or <strong>Stop sharing</strong>. After you stop, the link only says the notes are no longer shared. Deleting the study from your Library stops every share of it.</span>
          </li>
          <li class="welcome-feature-item">
            <span class="welcome-feature-name">Notes shared with you</span>
            <span class="welcome-feature-desc">Open them from <strong>Shared with me</strong> in your Library. <strong>Remove from my list</strong> takes one off your list; the member who shared it can still stop sharing it.</span>
          </li>
          <li class="welcome-feature-item">
            <span class="welcome-feature-name">Limits</span>
            <span class="welcome-feature-desc">Only Study Notes on your own studies can be shared, with up to 10 members per study and 20 new shares a day.</span>
          </li>
        </ul>

        <hr class="copy-rule">

        <div class="copy-section-heading">A Few Things Worth Knowing</div>
        <div class="welcome-highlight-note" style="margin-top:16px;">
          <strong>The highlight tooltip.</strong> Highlight any word or phrase of text on the page, and a small toolbar appears &mdash; letting you define it, ask a question about it, or look up a related verse, right where you&#39;re reading. You can also pin an answer to keep it handy as you study, or share it into a Live Room&#39;s chat. Press <strong>Ctrl + Alt + T</strong> to bring it up anytime.
        </div>
        <div class="welcome-highlight-note" style="margin-top:12px;">
          <strong>Your inbox, anywhere.</strong> Press <strong>Ctrl + Alt + M</strong> to open a floating mini-inbox from any page, so you can read and reply to messages without leaving what you&#39;re doing.
        </div>
        <div class="welcome-highlight-note" style="margin-top:12px;">
          <strong>Mark My Spot.</strong> While reading Scripture, click a verse number to save your place &mdash; your last marked spot is always waiting when you return.
        </div>

        <hr class="copy-rule">

        <div class="copy-section-heading">Suggestions &amp; Feedback</div>
        <p class="copy-body" style="margin-bottom:16px;">Have an idea, a comment, or something that isn&#39;t working as you&#39;d expect? Send it our way &mdash; we read every note.</p>
        <textarea id="feedbackInput" class="chat-textarea" rows="5"
                  placeholder="Share a suggestion, comment, or piece of feedback&#8230;"></textarea>
        <div style="display:flex; align-items:center; gap:14px; margin-top:14px;">
          <button class="btn-primary" id="feedbackSubmitBtn" style="margin-bottom:0;">Submit</button>
          <span id="feedbackMsg" style="display:none; font-size:0.9rem; color:var(--warm-brown);"></span>
        </div>

        <p class="copy-body" style="margin-top:20px;">You can also reach us directly at
          <a href="mailto:contact@ironandinktheology.com" style="color:var(--accent); text-decoration:none;">contact@ironandinktheology.com</a>
          &mdash; for questions, problems, or anything you&#39;d like to tell us.</p>

        <div class="copy-back">
          <a href="/dashboard">&#8592; Back to Dashboard</a>
        </div>
      </div>
    </div>`;

  res.send(renderLayout({
    req,
    activeSection: 'help',
    title: 'Getting Started',
    content,
    scripts: `<script>
(function () {
  var input = document.getElementById('feedbackInput');
  var btn   = document.getElementById('feedbackSubmitBtn');
  var msg   = document.getElementById('feedbackMsg');
  if (!input || !btn) return;

  function showMsg(text, isError) {
    msg.textContent = text;
    msg.style.color = isError ? '#5a0a0a' : 'var(--warm-brown)';
    msg.style.display = 'inline';
  }

  btn.addEventListener('click', async function () {
    var text = input.value.trim();
    if (!text) { showMsg('Please enter some feedback first.', true); input.focus(); return; }
    btn.disabled = true;
    msg.style.display = 'none';
    try {
      var r    = await fetch('/api/feedback', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ text: text }),
      });
      var data = await r.json();
      if (data.success) {
        input.value = '';
        showMsg('Thank you — your feedback has been sent.', false);
      } else {
        showMsg(data.error || 'Could not send feedback. Please try again.', true);
      }
    } catch (err) {
      showMsg('Error: ' + err.message, true);
    } finally {
      btn.disabled = false;
    }
  });
}());
</script>`,
  }));
});

const VALID_TOUR_PAGES = ['study','scripture','selah','rooms','library','dialogue','writing','teacher','study-map'];

router.post('/api/tour-seen', requireAuth, (req, res) => {
  const { page } = req.body;
  if (!page || !VALID_TOUR_PAGES.includes(page)) return res.json({ success: false });
  try {
    const users = JSON.parse(fs.readFileSync(USERS_PATH_H, 'utf8'));
    const idx   = users.findIndex(u => u.id === req.session.userId);
    if (idx !== -1) {
      if (!users[idx].toursSeen) users[idx].toursSeen = {};
      users[idx].toursSeen[page] = true;
      fs.writeFileSync(USERS_PATH_H, JSON.stringify(users, null, 2));
    }
    res.json({ success: true });
  } catch {
    res.json({ success: false });
  }
});

// ─── POST /api/feedback ───────────────────────────────────────────────────────
// Members submit suggestions/feedback from the Help page. The submitter's id and
// name come from the session — they never type their own name.
router.post('/api/feedback', requireAuth, (req, res) => {
  const text = (req.body && req.body.text ? String(req.body.text) : '').trim();
  if (!text) {
    return res.status(400).json({ success: false, error: 'Feedback cannot be empty.' });
  }

  const user = req.session.user || {};
  const record = {
    id:          randomUUID(),
    userId:      user.id || req.session.userId,
    fullName:    user.fullName || 'Unknown',
    text,
    submittedAt: new Date().toISOString(),
  };
  const feedback = readJSON(FEEDBACK_PATH);
  feedback.push(record);
  writeJSON(FEEDBACK_PATH, feedback);

  // Best-effort admin notification. Fire-and-forget: never awaited into the
  // response path, and its own try/catch swallows failures — so a mail error
  // can never lose the (already-saved) feedback or surface an error to the member.
  sendFeedbackNotification(record).catch(() => {});

  res.json({ success: true });
});

module.exports = router;
// Single source of truth for which pages have guided tours. Other routes
// (e.g. admin's "reset my tours") import this so the list stays in sync.
module.exports.VALID_TOUR_PAGES = VALID_TOUR_PAGES;
