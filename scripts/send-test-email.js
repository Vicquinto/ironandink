#!/usr/bin/env node
'use strict';

// Send one test email through the configured mail relay, exactly as the app
// sends its real emails (lib/mailer.js), and report the result.
//
//   node scripts/send-test-email.js you@example.com
//
// Reads MAIL_RELAY_URL / MAIL_RELAY_SECRET / MAIL_FROM / MAIL_FROM_NAME from the
// project's .env. Exit code 0 = the relay accepted the message, 1 = failure
// (the reason is printed).

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { sendMail } = require('../lib/mailer');

const to = (process.argv[2] || '').trim();
if (!to) {
  console.error('Usage: node scripts/send-test-email.js you@example.com');
  process.exit(1);
}

const when = new Date().toISOString();
sendMail({
  tag:     'test',
  to,
  subject: 'Iron & Ink mail relay test',
  text:    'This is a test email from the Iron & Ink server, sent ' + when + ' through the mail relay.\n\n' +
           'If you can read this, outbound email is working.\n\nSoli Deo Gloria,\nIron & Ink',
  html:    '<p>This is a test email from the Iron &amp; Ink server, sent ' + when + ' through the mail relay.</p>' +
           '<p>If you can read this, outbound email is working.</p>' +
           '<p><em>Soli Deo Gloria,</em><br>Iron &amp; Ink</p>',
}).then((result) => {
  if (result.ok) {
    console.log('OK — the relay accepted the message (message id ' + (result.messageId || 'n/a') + ').');
    console.log('Check the inbox (and spam folder) of ' + to + '.');
    process.exit(0);
  }
  console.error('FAILED — ' + result.error);
  process.exit(1);
});
