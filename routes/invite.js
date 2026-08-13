const express  = require('express');
const bcrypt   = require('bcrypt');
const fs       = require('fs');
const path     = require('path');
const { randomUUID } = require('crypto');
const sgMail   = require('@sendgrid/mail');
// Shared invite provisioning — the same create-record + email-link logic the
// admin approve button uses. The submit handler auto-invites through this so the
// two paths can never drift. See lib/invites.js.
const { createAndSendInvite, findActiveInvite } = require('../lib/invites');

const router = express.Router();

sgMail.setApiKey(process.env.SENDGRID_API_KEY || '');

// Where new-invite-request notifications go. Overridable via env; single source
// of truth so the address is changed in exactly one place.
const ADMIN_NOTIFY_EMAIL = process.env.ADMIN_NOTIFY_EMAIL || 'contact@ironandinktheology.com';

const USERS_PATH           = path.join(__dirname, '../data/users.json');
const INVITES_PATH         = path.join(__dirname, '../data/invites.json');
const INVITE_REQUESTS_PATH = path.join(__dirname, '../data/invite_requests.json');

// The six doctrinal statements, mapped from their stored keys to the human
// labels used in the admin notification email. Order here is the order shown.
const DOCTRINE_LABELS = [
  ['scriptureAuthority',    'Authority of Scripture'],
  ['totalDepravity',        'Total Depravity'],
  ['unconditionalElection', 'Unconditional Election'],
  ['particularAtonement',   'Particular Atonement'],
  ['irresistibleGrace',     'Irresistible Grace'],
  ['perseverance',          'Perseverance of the Saints'],
];

// Informational "new member" email to the admin — the permanent pushed record of
// a member who was auto-invited. Carries the applicant's full application: their
// stated reason and all six doctrinal answers. Best-effort and fully
// self-contained: swallows its own errors so a send failure can never block or
// fail the applicant's invite.
async function sendNewMemberNotification(record) {
  if (!process.env.SENDGRID_API_KEY) {
    console.warn('[newMemberNotify] SENDGRID_API_KEY not set — skipping email');
    return;
  }
  const reason      = record.reason && record.reason.trim() ? record.reason.trim() : '(none given)';
  const doctrines   = record.doctrines || {};
  const answersText = DOCTRINE_LABELS.map(([key, label]) => `- ${label}: ${doctrines[key] || '(no answer)'}`).join('\n');
  const answersHtml = DOCTRINE_LABELS.map(([key, label]) =>
    `<li><strong>${label}:</strong> ${escHtml(doctrines[key] || '(no answer)')}</li>`).join('');
  try {
    await sgMail.send({
      to:   ADMIN_NOTIFY_EMAIL,
      from: { email: process.env.SENDGRID_FROM_EMAIL, name: 'Iron & Ink' },
      subject: `New Iron & Ink member: ${record.name}`,
      text: `${record.name} (${record.email}) just requested an invitation and was automatically invited.\n\n` +
        `Reason for joining:\n${reason}\n\n` +
        `Doctrinal responses:\n${answersText}\n\n` +
        `Submitted: ${record.submittedAt}\n\n` +
        `Soli Deo Gloria,\nIron & Ink`,
      html: `<p><strong>${escHtml(record.name)}</strong> (${escHtml(record.email)}) just requested an invitation and was automatically invited.</p>
<p><strong>Reason for joining:</strong><br>${escHtml(reason).replace(/\n/g, '<br>')}</p>
<p><strong>Doctrinal responses:</strong></p>
<ul>${answersHtml}</ul>
<p><strong>Submitted:</strong> ${escHtml(record.submittedAt)}</p>
<p><em>Soli Deo Gloria,</em><br>Iron &amp; Ink</p>`,
    });
    console.log('[newMemberNotify] sent to', ADMIN_NOTIFY_EMAIL);
  } catch (err) {
    console.error('[newMemberNotify] failed:', err.message);
  }
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

function publicStyles() {
  return `
    <link rel="stylesheet" href="/css/styles.css?v=72">
    <style>
      body { display:flex; align-items:center; justify-content:center; min-height:100vh; }
      .pub-container { width:100%; max-width:480px; padding:24px; }
      .pub-header { text-align:center; margin-bottom:32px; }
      .pub-brand { display:block; width:100%; max-width:340px; height:auto; margin:0 auto 16px; }
      .pub-subtitle { font-size:0.88rem; color:var(--warm-brown); font-style:italic; margin-top:8px; }
      .pub-card {
        background:var(--card-bg); border:1px solid rgba(179,140,51,0.25);
        border-radius:8px; padding:32px;
      }
      .form-group { margin-bottom:18px; }
      .form-label {
        display:block; font-size:0.75rem; color:var(--dark-cream);
        margin-bottom:6px; letter-spacing:0.07em; text-transform:uppercase;
      }
      .form-input, .form-textarea, .form-select {
        width:100%; background:var(--bg);
        border:1px solid rgba(179,140,51,0.3);
        color:var(--text); padding:11px 13px;
        font-size:0.95rem; font-family:'EB Garamond',Georgia,serif;
        border-radius:4px; outline:none; transition:border-color 0.15s;
      }
      .form-input:focus, .form-textarea:focus, .form-select:focus { border-color:var(--accent); }
      .form-input[readonly] { opacity:0.6; cursor:not-allowed; }
      .form-textarea { resize:vertical; min-height:90px; }
      .form-select option { background:#1A0F0A; }
      .btn-pub {
        width:100%; background:var(--accent); color:#E8D9B8;
        border:none; padding:13px; font-size:1rem;
        font-family:'EB Garamond',Georgia,serif; font-weight:600;
        border-radius:4px; cursor:pointer; letter-spacing:0.04em;
        margin-top:4px; transition:background 0.15s;
      }
      .btn-pub:hover { background:#c9a040; color:#1A0F0A; }
      .error-msg {
        background:rgba(180,60,60,0.15); border:1px solid rgba(180,60,60,0.4);
        color:#5a0a0a; padding:10px 14px; border-radius:4px;
        font-size:0.85rem; margin-bottom:16px; display:none;
      }
      .error-msg.visible { display:block; }
      .success-box {
        background:rgba(179,140,51,0.1); border:1px solid rgba(179,140,51,0.35);
        color:var(--text); padding:24px 28px; border-radius:8px;
        font-size:1rem; line-height:1.8; text-align:center;
      }
      .pub-footer { text-align:center; font-size:0.75rem; color:var(--warm-brown); margin-top:20px; }
      .pub-footer a { color:var(--warm-brown); text-decoration:none; }
    </style>`;
}

// ─── GET /invite-request ──────────────────────────────────────────────────────
router.get('/invite-request', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Iron &amp; Ink — Request an Invitation</title>
  ${publicStyles()}
  <link rel="icon" href="/favicon.ico" type="image/x-icon">
  <style>
    .pub-container { max-width: 560px; }
    /* ── Step navigation ── */
    .step-nav { display: flex; justify-content: space-between; align-items: center; margin-top: 26px; }
    .step-nav .btn-pub { width: auto; margin-top: 0; padding: 10px 30px; }
    .btn-back {
      background: transparent; border: 1.5px solid rgba(179,140,51,0.4);
      color: var(--warm-brown); padding: 10px 18px;
      font-family: 'EB Garamond', Georgia, serif; font-size: 0.9rem;
      border-radius: 4px; cursor: pointer;
      transition: border-color 0.15s, color 0.15s;
    }
    .btn-back:hover { border-color: var(--warm-brown); color: var(--text); }
    /* ── Progress indicator ── */
    .step-progress { display: flex; align-items: center; gap: 10px; margin-bottom: 20px; }
    .step-dots { display: flex; gap: 5px; }
    .step-dot { width: 24px; height: 4px; border-radius: 2px; background: rgba(179,140,51,0.18); transition: background 0.2s; }
    .step-dot.done   { background: #5C1A28; }
    .step-dot.active { background: rgba(92,26,40,0.5); }
    .step-label { font-size: 0.72rem; color: var(--warm-brown); text-transform: uppercase; letter-spacing: 0.08em; }
    /* ── Doctrine elements ── */
    .doctrine-intro { font-size: 0.88rem; color: var(--dark-cream); line-height: 1.72; }
    .doctrine-question { font-size: 0.95rem; color: var(--text); line-height: 1.6; margin: 10px 0 16px; font-style: italic; }
    .doctrine-choices { display: flex; gap: 6px; }
    .doctrine-btn {
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--bg); border: 1.5px solid rgba(179,140,51,0.4);
      border-radius: 4px; padding: 6px 20px;
      font-family: 'EB Garamond', Georgia, serif; font-size: 0.88rem;
      color: var(--warm-brown); cursor: pointer; user-select: none;
      transition: background 0.15s, color 0.15s, border-color 0.15s;
    }
    .doctrine-btn.selected { background: #5C1A28; border-color: #5C1A28; color: #f5ede0; font-weight: 600; }
    .doctrine-btn input[type="radio"] { position: absolute; opacity: 0; width: 0; height: 0; pointer-events: none; }
    .doctrine-closing {
      font-size: 0.88rem; color: var(--dark-cream); line-height: 1.72;
      padding: 16px 18px;
      background: rgba(179,140,51,0.07);
      border-left: 3px solid rgba(179,140,51,0.4);
      border-radius: 0 4px 4px 0;
    }
    .step-inline-err { font-size: 0.8rem; color: #5a0a0a; margin-top: 10px; font-style: italic; }
    .decline-msg {
      margin-top: 18px; padding: 18px 20px;
      background: rgba(179,140,51,0.08); border: 1px solid rgba(179,140,51,0.28);
      border-radius: 6px; font-size: 1rem; color: var(--text);
      line-height: 1.7; text-align: center;
    }
    /* ── Welcoming intro + optional "about you" field ── */
    .pub-intro {
      text-align: center; font-size: 0.95rem; color: var(--dark-cream);
      line-height: 1.72; margin-bottom: 26px;
    }
    .pub-intro p { margin-bottom: 12px; }
    .pub-intro p:last-child { margin-bottom: 0; }
    .pub-intro a { color: var(--accent); text-decoration: underline; }
    .pub-intro a:hover { color: #c9a040; }
    .form-label-optional {
      text-transform: none; letter-spacing: 0; font-size: 0.72rem;
      font-style: italic; color: var(--warm-brown); margin-left: 7px;
    }
    .field-help {
      font-size: 0.85rem; color: var(--warm-brown); font-style: italic;
      line-height: 1.62; margin-bottom: 10px;
    }
  </style>
</head>
<body>
  <div class="pub-container">
    <div class="pub-header">
      <img src="/images/brand.jpg" alt="Iron & Ink — Iron sharpens iron, Proverbs 27:17" class="pub-brand">
      <p class="pub-subtitle">Request an Invitation</p>
    </div>
    <div class="pub-card">
      <div class="error-msg" id="errMsg"></div>
      <div id="successBox" style="display:none;" class="success-box">
        Your invitation is on its way &mdash; check your email for the link to create your account.
        It can take a minute, so please check your spam folder if you don&rsquo;t see it.
        The link is valid for 48 hours.
      </div>
      <div id="stepContent"></div>
    </div>
    <p class="pub-footer"><a href="/">&#8592; Back to home</a></p>
  </div>
  <script>
  (function () {
    var currentStep = 0;
    var formData    = { name: '', email: '', reason: '' };
    var docAnswers  = {};

    var DOCS = [
      {
        key: 'scriptureAuthority',
        label: '1. Scripture Authority',
        text: '“I affirm that Scripture alone is the final, sufficient, and inerrant authority for Christian faith and life.”'
      },
      {
        key: 'totalDepravity',
        label: '2. Total Depravity',
        text: '“I affirm that, apart from God’s grace, fallen humanity is spiritually unable to choose or come to Christ on its own.”'
      },
      {
        key: 'unconditionalElection',
        label: '3. Unconditional Election',
        text: '“I affirm that God’s choice to save His people is rooted in His own sovereign will, not in anything foreseen or merited in the person.”'
      },
      {
        key: 'particularAtonement',
        label: '4. Particular (Limited) Atonement',
        text: '“I affirm that Christ’s death on the cross was specifically and effectively for the salvation of His elect, not merely a possibility offered to all.”'
      },
      {
        key: 'irresistibleGrace',
        label: '5. Irresistible Grace',
        text: '“I affirm that when God effectually calls one of His elect, that call accomplishes its purpose and cannot be ultimately refused.”'
      },
      {
        key: 'perseverance',
        label: '6. Perseverance of the Saints',
        text: '“I affirm that those truly regenerated by God will be kept by His power and will not ultimately lose their salvation.”'
      }
    ];

    // Steps: 0=intro, 1-6=statements 0-5, 7=closing, 8=final, 9=identity
    var container = document.getElementById('stepContent');
    var errEl     = document.getElementById('errMsg');

    function showErr(msg) { errEl.textContent = msg; errEl.classList.add('visible'); }
    function clearErr()   { errEl.classList.remove('visible'); }

    function goTo(n) { currentStep = n; clearErr(); render(); }

    function esc(s) {
      return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function choiceBtn(value, selected) {
      return '<label class="doctrine-btn' + (selected === value ? ' selected' : '') + '" data-value="' + value + '">' +
        '<input type="radio" name="doc_choice" value="' + value + '"' + (selected === value ? ' checked' : '') + '> ' + value +
      '</label>';
    }

    function progressDots(activeIdx) {
      var dots = '';
      for (var i = 0; i < 6; i++) {
        dots += '<span class="step-dot ' + (i < activeIdx ? 'done' : i === activeIdx ? 'active' : '') + '"></span>';
      }
      return '<div class="step-progress"><div class="step-dots">' + dots + '</div>' +
        '<span class="step-label">Statement ' + (activeIdx + 1) + ' of 6</span></div>';
    }

    function render() {
      var html = '';

      if (currentStep === 0) {
        // Intro (opener — no Back button)
        html = '<p class="doctrine-intro">' +
          'Iron &amp; Ink Theology is a confessionally Reformed Bible study and community platform, ' +
          'built on the historic doctrines of grace (often summarized as TULIP) and a high view of ' +
          'Scripture’s authority. Before requesting access, please respond honestly to the ' +
          'following six statements. There are no wrong answers if you’re still studying or ' +
          'undecided — “Maybe” is a welcome response. This is simply to make sure ' +
          'you understand what kind of community you’re joining, and that it will be a good ' +
          'fit for you.' +
        '</p>' +
        '<div class="step-nav"><span></span><button class="btn-pub" id="nextBtn" type="button">Begin</button></div>';

      } else if (currentStep >= 1 && currentStep <= 6) {
        // Statement step
        var idx = currentStep - 1;
        var doc = DOCS[idx];
        var sel = docAnswers[doc.key] || '';
        html = progressDots(idx) +
          '<label class="form-label">' + esc(doc.label) + '</label>' +
          '<p class="doctrine-question">' + doc.text + '</p>' +
          '<div class="doctrine-choices" id="docChoices">' +
            choiceBtn('Yes',   sel) +
            choiceBtn('Maybe', sel) +
            choiceBtn('No',    sel) +
          '</div>' +
          '<div class="step-nav">' +
            '<button class="btn-back" id="backBtn" type="button">← Back</button>' +
          '</div>';

      } else if (currentStep === 7) {
        // Closing / framework agreement
        html = '<div class="doctrine-closing">' +
          'Iron &amp; Ink is meant to be a safe, doctrinally settled space for Reformed believers to ' +
          'study, write, and discuss together. We ask that members engage from within this framework ' +
          'rather than using the community as a venue to debate or challenge these core convictions. ' +
          'If after reading these statements this sounds like a community you’d value being ' +
          'part of, we’d love to have you.' +
        '</div>' +
        '<div class="step-nav">' +
          '<button class="btn-back" id="backBtn" type="button">← Back</button>' +
          '<button class="btn-pub"  id="nextBtn" type="button">Continue</button>' +
        '</div>';

      } else if (currentStep === 8) {
        // Final question — "Yes" advances to the identity screen
        html = '<label class="form-label">Final Question</label>' +
          '<p class="doctrine-question">Do you wish to join the Reformed Christian Iron &amp; Ink community?</p>' +
          '<div class="doctrine-choices" id="finalChoices">' +
            '<label class="doctrine-btn" data-value="Yes"><input type="radio" name="wish_choice" value="Yes"> Yes</label>' +
            '<label class="doctrine-btn" data-value="No"><input type="radio" name="wish_choice" value="No"> No</label>' +
          '</div>' +
          '<div id="declineMsg" class="decline-msg" style="display:none;">' +
            'Thank you for taking the time to consider Iron &amp; Ink. We wish you well in your walk.' +
          '</div>' +
          '<div class="step-nav">' +
            '<button class="btn-back" id="backBtn" type="button">← Back</button>' +
            '<button class="btn-pub"  id="nextBtn" type="button" style="display:none;">Continue</button>' +
          '</div>';

      } else if (currentStep === 9) {
        // Identity — Name / Email / optional "about you" (final input step)
        html = '<div class="form-group">' +
          '<label class="form-label">Full Name</label>' +
          '<input class="form-input" type="text" id="infoName" placeholder="Your full name" value="' + esc(formData.name) + '">' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label">Email Address</label>' +
          '<input class="form-input" type="email" id="infoEmail" placeholder="your@email.com" value="' + esc(formData.email) + '">' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label">A little about you<span class="form-label-optional">(optional)</span></label>' +
          '<p class="field-help">Iron &amp; Ink is a community, and we&rsquo;d genuinely love ' +
          'to know the people in it. If you&rsquo;re comfortable, we&rsquo;d be glad to hear ' +
          'a little about you &mdash; there&rsquo;s no wrong answer, and no pressure to share ' +
          'more than you&rsquo;d like.</p>' +
          '<textarea class="form-textarea" id="infoReason" placeholder="Tell us where you are in your faith and what draws you to Iron &amp; Ink…">' + esc(formData.reason) + '</textarea>' +
        '</div>' +
        '<div class="step-nav">' +
          '<button class="btn-back" id="backBtn" type="button">← Back</button>' +
          '<button class="btn-pub"  id="submitBtn" type="button">Submit Request</button>' +
        '</div>';
      }

      container.innerHTML = html;
      wireStep();
    }

    function wireStep() {
      var backBtn = document.getElementById('backBtn');
      var nextBtn = document.getElementById('nextBtn');

      if (backBtn) backBtn.addEventListener('click', function () { saveIdentity(); goTo(currentStep - 1); });
      if (nextBtn) nextBtn.addEventListener('click', handleNext);

      // Statement choice buttons — selecting auto-advances after brief visible state
      var docChoices = document.getElementById('docChoices');
      if (docChoices) {
        docChoices.querySelectorAll('.doctrine-btn').forEach(function (btn) {
          btn.addEventListener('click', function (e) {
            // Clicking a <label> wrapping a radio fires two click events: one on the
            // label, then the browser-synthesized click on the <input> bubbles back up.
            // Ignore that second event so the advance only runs once per user action.
            if (e.target.tagName === 'INPUT') return;
            var val        = btn.getAttribute('data-value');
            var targetStep = currentStep + 1; // capture now — not in the setTimeout closure
            docChoices.querySelectorAll('.doctrine-btn').forEach(function (b) { b.classList.remove('selected'); });
            btn.classList.add('selected');
            var r = btn.querySelector('input');
            if (r) r.checked = true;
            docAnswers[DOCS[currentStep - 1].key] = val;
            setTimeout(function () { goTo(targetStep); }, 200);
          });
        });
      }

      // Final question choice buttons
      var finalChoices = document.getElementById('finalChoices');
      if (finalChoices) {
        finalChoices.querySelectorAll('.doctrine-btn').forEach(function (btn) {
          btn.addEventListener('click', function () {
            finalChoices.querySelectorAll('.doctrine-btn').forEach(function (b) { b.classList.remove('selected'); });
            btn.classList.add('selected');
            var r = btn.querySelector('input');
            if (r) r.checked = true;
            var val        = btn.getAttribute('data-value');
            var declineMsg = document.getElementById('declineMsg');
            var contBtn    = document.getElementById('nextBtn');
            if (val === 'No') {
              declineMsg.style.display = 'block';
              contBtn.style.display    = 'none';
            } else {
              declineMsg.style.display = 'none';
              contBtn.style.display    = 'block';
            }
          });
        });
      }

      // Submit button
      var submitBtn = document.getElementById('submitBtn');
      if (submitBtn) submitBtn.addEventListener('click', handleSubmit);
    }

    function handleNext() {
      clearErr();

      if (currentStep === 0) {
        goTo(1);
      } else if (currentStep === 7) {
        goTo(8);
      } else if (currentStep === 8) {
        goTo(9);
      }
    }

    // Persist the identity fields into formData whenever we leave the identity
    // screen (Back or Submit), so typed values survive Back/forward navigation.
    // No-op on any step where the inputs aren't present.
    function saveIdentity() {
      var n  = document.getElementById('infoName');
      var e  = document.getElementById('infoEmail');
      var rs = document.getElementById('infoReason');
      if (n && e && rs) {
        formData = { name: n.value.trim(), email: e.value.trim(), reason: rs.value.trim() };
      }
    }

    async function handleSubmit() {
      clearErr();
      saveIdentity();
      if (!formData.name) { showErr('Please enter your full name.'); return; }
      var email   = formData.email;
      var atIdx   = email.indexOf('@');
      var lastDot = email.lastIndexOf('.');
      if (!email || atIdx < 1 || lastDot < atIdx + 2 || lastDot >= email.length - 1) {
        showErr('Please enter a valid email address.'); return;
      }
      var btn = document.getElementById('submitBtn');
      btn.disabled    = true;
      btn.textContent = 'Submitting…';
      try {
        var res  = await fetch('/api/invite-request', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            name:       formData.name,
            email:      formData.email,
            reason:     formData.reason,
            doctrines:  docAnswers,
            wishToJoin: 'Yes',
          }),
        });
        var data = await res.json();
        if (data.success) {
          container.style.display                             = 'none';
          document.getElementById('successBox').style.display = 'block';
        } else {
          showErr(data.error || 'Submission failed.');
          btn.disabled    = false;
          btn.textContent = 'Submit Request';
        }
      } catch (err) {
        showErr('Error: ' + err.message);
        btn.disabled    = false;
        btn.textContent = 'Submit Request';
      }
    }

    render();
  })();
  </script>
</body>
</html>`);
});

// ─── POST /api/invite-request ─────────────────────────────────────────────────
// Auto-invite on submission: the applicant is emailed their invite link IMMEDIATELY
// via the shared createAndSendInvite (the same path the admin approve button uses).
// No manual approval. The request record is still persisted for admin visibility,
// flagged auto-invited so it drops out of the pending queue.
router.post('/api/invite-request', async (req, res) => {
  const { name, email, reason, doctrines, wishToJoin } = req.body;
  if (!name || !email) {
    return res.status(400).json({ success: false, error: 'Name and email are required.' });
  }

  const DOC_KEYS    = ['scriptureAuthority', 'totalDepravity', 'unconditionalElection', 'particularAtonement', 'irresistibleGrace', 'perseverance'];
  const VALID_ANS   = ['Yes', 'Maybe', 'No'];
  const cleanDoctrines = {};
  for (const key of DOC_KEYS) {
    const val = doctrines && doctrines[key];
    if (!VALID_ANS.includes(val)) {
      return res.status(400).json({ success: false, error: 'Please answer all six doctrinal statements.' });
    }
    cleanDoctrines[key] = val;
  }
  if (wishToJoin !== 'Yes') {
    return res.status(400).json({ success: false, error: 'Invalid submission.' });
  }

  const normEmail = email.trim().toLowerCase();

  // ── Duplicate / abuse checks BEFORE sending, centralized here ──────────────
  // a. Already a member → do not invite. Gentle nudge, no over-disclosure.
  const users = readJSON(USERS_PATH);
  if (users.find(u => u.email && u.email.toLowerCase() === normEmail)) {
    return res.json({
      success: false,
      error:   'It looks like you already have an account. Please sign in, or reset your password if you’ve forgotten it.',
    });
  }
  // b. A live (un-used, un-expired) invite already exists → don't mint a second.
  if (findActiveInvite(normEmail)) {
    return res.json({
      success: false,
      error:   'Your invitation was already sent — the link is valid for 48 hours, so please check your email (including spam).',
    });
  }

  const record = {
    id:          randomUUID(),
    name:        name.trim(),
    email:       normEmail,
    reason:      (reason || '').trim(),
    doctrines:   cleanDoctrines,
    wishToJoin:  'Yes',
    status:      'pending',
    submittedAt: new Date().toISOString(),
  };
  const requests = readJSON(INVITE_REQUESTS_PATH);
  requests.push(record);
  console.log('[invite-request] writing to', INVITE_REQUESTS_PATH);
  try {
    writeJSON(INVITE_REQUESTS_PATH, requests);
  } catch (err) {
    console.error('[invite-request] writeJSON failed:', err);
    return res.status(500).json({ success: false, error: 'Failed to save request: ' + err.message });
  }

  // ── Auto-invite: create the invite record + email the link to the applicant ─
  const host      = req.get('host') || 'localhost:4000';
  const protocol  = req.secure ? 'https' : 'http';
  let emailSent = false;
  try {
    ({ emailSent } = await createAndSendInvite(record.email, record.name, { host, protocol }));
  } catch (err) {
    console.error('[invite-request] createAndSendInvite failed:', err.message);
    emailSent = false;
  }

  // Flag the saved request with the outcome. status:'auto-invited' drops it out of
  // the admin pending queue (which filters status==='pending'); these surface in
  // the invites/sent view instead.
  record.status    = 'auto-invited';
  record.autoInvited = true;
  record.invitedAt = new Date().toISOString();
  record.emailSent = emailSent;
  try {
    writeJSON(INVITE_REQUESTS_PATH, requests);
  } catch (err) {
    console.error('[invite-request] writeJSON (flag) failed:', err);
  }

  if (!emailSent) {
    // Keep the flagged record; tell the applicant plainly rather than falsely
    // reporting success. Best-effort admin heads-up about the failure.
    sendNewMemberNotification(record)
      .catch(err => console.error('[newMemberNotify] unexpected:', err.message));
    return res.json({
      success: false,
      error:   `Something went wrong sending your invitation. Please contact ${ADMIN_NOTIFY_EMAIL} and we’ll get you set up.`,
    });
  }

  // Best-effort admin notification carrying the applicant's full application.
  // Fire-and-forget with its own catch so a SendGrid outage never delays or fails
  // the applicant's confirmation.
  sendNewMemberNotification(record)
    .catch(err => console.error('[newMemberNotify] unexpected:', err.message));

  res.json({ success: true });
});

// ─── GET /register?token=xxx ──────────────────────────────────────────────────
router.get('/register', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');

  const { token } = req.query;
  const invites   = readJSON(INVITES_PATH);
  const invite    = invites.find(i => i.token === token);

  if (!invite || invite.used || new Date(invite.expiresAt) < new Date()) {
    return res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Iron &amp; Ink — Invalid Invitation</title>
  ${publicStyles()}
  <link rel="icon" href="/favicon.ico" type="image/x-icon">
</head>
<body>
  <div class="pub-container">
    <div class="pub-header">
      <img src="/images/brand.jpg" alt="Iron & Ink — Iron sharpens iron, Proverbs 27:17" class="pub-brand">
    </div>
    <div class="pub-card">
      <p style="color:var(--dark-cream); line-height:1.7; text-align:center;">
        This invitation link is invalid or has expired.<br>
        Please <a href="/invite-request" style="color:var(--accent);">request a new invitation</a>.
      </p>
    </div>
    <p class="pub-footer"><a href="/">&#8592; Back to home</a></p>
  </div>
</body>
</html>`);
  }

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Iron &amp; Ink — Create Your Account</title>
  ${publicStyles()}
  <link rel="icon" href="/favicon.ico" type="image/x-icon">
</head>
<body>
  <div class="pub-container">
    <div class="pub-header">
      <img src="/images/brand.jpg" alt="Iron & Ink — Iron sharpens iron, Proverbs 27:17" class="pub-brand">
      <p class="pub-subtitle">Create your account</p>
    </div>
    <div class="pub-card">
      <div class="error-msg" id="errMsg"></div>
      <form id="registerForm">
        <input type="hidden" id="token" value="${escHtml(token)}">
        <div class="form-group">
          <label class="form-label">Full Name</label>
          <input class="form-input" type="text" id="fullName" required value="${escHtml(invite.name)}">
        </div>
        <div class="form-group">
          <label class="form-label">Email Address</label>
          <input class="form-input" type="email" id="email" readonly value="${escHtml(invite.email)}">
        </div>
        <div class="form-group">
          <label class="form-label">Password <span style="font-size:0.7rem; color:var(--warm-brown);">(min 8 characters)</span></label>
          <div style="position:relative;">
            <input class="form-input" type="password" id="password" required minlength="8" placeholder="Choose a strong password">
            <button type="button" tabindex="-1" onclick="var i=this.previousElementSibling;i.type=i.type==='password'?'text':'password';" style="background:none;border:none;cursor:pointer;position:absolute;right:0.75rem;top:50%;transform:translateY(-50%);font-size:1.1rem;color:#6B4226;line-height:1;">&#128065;</button>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Confirm Password</label>
          <div style="position:relative;">
            <input class="form-input" type="password" id="confirm" required placeholder="Repeat your password">
            <button type="button" tabindex="-1" onclick="var i=this.previousElementSibling;i.type=i.type==='password'?'text':'password';" style="background:none;border:none;cursor:pointer;position:absolute;right:0.75rem;top:50%;transform:translateY(-50%);font-size:1.1rem;color:#6B4226;line-height:1;">&#128065;</button>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Preferred Bible Translation</label>
          <select class="form-select" id="translation" disabled>
            <option value="NASB 1995" selected>New American Standard Bible (NASB, 1995)</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Doctrinal Tradition</label>
          <select class="form-select" id="tradition">
            <option value="Reformed/Calvinist" selected>Reformed / Calvinist</option>
            <option value="Presbyterian">Presbyterian</option>
            <option value="Reformed Baptist">Reformed Baptist</option>
            <option value="Anglican">Anglican</option>
            <option value="Lutheran">Lutheran</option>
            <option value="Other Protestant">Other Protestant</option>
          </select>
        </div>
        <button class="btn-pub" type="submit">Create My Account</button>
      </form>
    </div>
    <p class="pub-footer"><a href="/">&#8592; Back to home</a></p>
  </div>
  <script>
    document.getElementById('registerForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      var errEl = document.getElementById('errMsg');
      errEl.classList.remove('visible');
      var btn = e.target.querySelector('button');
      btn.disabled = true;
      btn.textContent = 'Creating account…';
      try {
        var res  = await fetch('/api/register', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            token:       document.getElementById('token').value,
            fullName:    document.getElementById('fullName').value.trim(),
            password:    document.getElementById('password').value,
            confirm:     document.getElementById('confirm').value,
            translation: document.getElementById('translation').value,
            tradition:   document.getElementById('tradition').value,
          }),
        });
        var data = await res.json();
        if (data.success) {
          window.location.href = data.redirect;
        } else {
          errEl.textContent = data.error || 'Registration failed.';
          errEl.classList.add('visible');
          btn.disabled = false;
          btn.textContent = 'Create My Account';
        }
      } catch (err) {
        errEl.textContent = 'Error: ' + err.message;
        errEl.classList.add('visible');
        btn.disabled = false;
        btn.textContent = 'Create My Account';
      }
    });
  </script>
</body>
</html>`);
});

// ─── POST /api/register ───────────────────────────────────────────────────────
router.post('/api/register', async (req, res) => {
  try {
    const { token, fullName, password, confirm, translation, tradition } = req.body;

    console.log('[register] handler reached, token:', token);

    if (!token || !fullName || !password || !confirm) {
      return res.status(400).json({ success: false, error: 'All fields are required.' });
    }
    if (password.length < 8) {
      return res.json({ success: false, error: 'Password must be at least 8 characters.' });
    }
    if (password !== confirm) {
      return res.json({ success: false, error: 'Passwords do not match.' });
    }

    const invites = readJSON(INVITES_PATH);
    const idx     = invites.findIndex(i => i.token === token);
    const invite  = invites[idx];

    if (!invite || invite.used || new Date(invite.expiresAt) < new Date()) {
      return res.json({ success: false, error: 'This invitation link is invalid or has expired.' });
    }

    console.log('[register] valid invite for:', invite.email);

    const users    = readJSON(USERS_PATH);
    const existing = users.find(u => u.email.toLowerCase() === invite.email.toLowerCase());
    if (existing) {
      return res.json({ success: false, error: 'An account with this email already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const now          = new Date().toISOString();
    const user = {
      id:           randomUUID(),
      email:        invite.email.toLowerCase(),
      fullName:     fullName.trim(),
      passwordHash,
      isAdmin:      false,
      role:         'user',
      needsSetup:   false,
      settings: {
        translation: translation || 'NASB 1995',
        tradition:   tradition   || 'Reformed/Calvinist',
      },
      // Explicit false flags for every guided-tour page so first-time tours
      // actually fire. Mirrors VALID_TOUR_PAGES in routes/help.js and the
      // init in the setup-password flow (routes/auth.js) — keep in sync.
      toursSeen: { study: false, scripture: false, selah: false, rooms: false, library: false, dialogue: false, writing: false },
      stats:     {},
      createdAt: now,
      updatedAt: now,
    };

    console.log('[register] writing user to', USERS_PATH);
    try {
      users.push(user);
      writeJSON(USERS_PATH, users);
    } catch (err) {
      console.error('[register] writeJSON(users) failed:', err);
      return res.status(500).json({ success: false, error: 'Failed to save user: ' + err.message });
    }

    console.log('[register] marking invite used in', INVITES_PATH);
    try {
      invites[idx].used   = true;
      invites[idx].usedAt = now;
      writeJSON(INVITES_PATH, invites);
    } catch (err) {
      console.error('[register] writeJSON(invites) failed:', err);
      return res.status(500).json({ success: false, error: 'Account created but failed to mark invite used: ' + err.message });
    }

    req.session.userId     = user.id;
    req.session.firstLogin = true;
    req.session.user = {
      id:       user.id,
      email:    user.email,
      fullName: user.fullName,
      settings: user.settings,
      stats:    user.stats,
      isAdmin:  false,
    };

    console.log('[register] account created successfully for:', user.email);
    res.json({ success: true, redirect: '/dashboard' });
  } catch (err) {
    console.error('[register] unexpected error:', err);
    res.status(500).json({ success: false, error: 'An unexpected error occurred: ' + err.message });
  }
});

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = router;
// Single source of truth for the admin-notification recipient. Exported so other
// notification senders (e.g. feedback in routes/help.js) reuse the exact same
// env-driven address without redeclaring a second constant.
module.exports.ADMIN_NOTIFY_EMAIL = ADMIN_NOTIFY_EMAIL;
