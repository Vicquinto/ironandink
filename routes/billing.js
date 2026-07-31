// routes/billing.js
'use strict';
const express = require('express');
const fs   = require('fs');
const path = require('path');
const router = express.Router();
const billing = require('../lib/billing');
const { BILLING_ENABLED } = require('../lib/entitlements');
const { requireAuth } = require('./layout');

// The repo has no shared users module — each route file defines its own whole-file
// read/modify/write over data/users.json (see settings.js, rooms.js, auth.js). We
// replicate that exact local idiom here rather than inventing a shared module, so
// persistence stays identical to everywhere else. The webhook provisioning below
// mirrors the comp-toggle write at routes/admin.js:667-683.
const USERS_PATH = path.join(__dirname, '../data/users.json');
function readUsers() { return JSON.parse(fs.readFileSync(USERS_PATH, 'utf8')); }
function writeUsers(u) { fs.writeFileSync(USERS_PATH, JSON.stringify(u, null, 2)); }

function requireBillingOn(req, res, next) {
  if (!BILLING_ENABLED) return res.status(404).send('Not found');
  next();
}

// Read the subscription's current-period-end as an ISO string, defensively.
// Stripe has moved this field between the subscription object and its line items
// across API versions; check both so provisioning records a real date either way.
function periodEndISO(sub) {
  if (!sub) return null;
  const secs = sub.current_period_end
    || (sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].current_period_end);
  return secs ? new Date(secs * 1000).toISOString() : null;
}

function firstPriceId(sub) {
  return sub && sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].price
    ? sub.items.data[0].price.id
    : null;
}

// POST /api/billing/checkout  { plan: 'monthly' | 'annual' }
router.post('/checkout', requireBillingOn, requireAuth, async (req, res) => {
  try {
    const member = readUsers().find(u => u.id === req.session.userId);
    if (!member) return res.status(401).json({ error: 'not_authenticated' });
    const plan = req.body.plan === 'annual' ? 'annual' : 'monthly';
    const origin = `${req.protocol}://${req.get('host')}`;
    const session = await billing.createCheckoutSession({ member, plan, origin });
    return res.json({ url: session.url });
  } catch (e) {
    console.error('[billing] checkout error', e.message);
    return res.status(500).json({ error: 'checkout_failed' });
  }
});

// GET /api/billing/portal
router.get('/portal', requireBillingOn, requireAuth, async (req, res) => {
  try {
    const member = readUsers().find(u => u.id === req.session.userId);
    if (!member || !member.subscription || !member.subscription.stripeCustomerId) {
      return res.redirect('/settings');
    }
    const origin = `${req.protocol}://${req.get('host')}`;
    const session = await billing.createPortalSession({ member, origin });
    return res.redirect(session.url);
  } catch (e) {
    console.error('[billing] portal error', e.message);
    return res.redirect('/settings');
  }
});

// The webhook handler (mounted separately in server.js with express.raw — see 4d).
async function stripeWebhookHandler(req, res) {
  if (!BILLING_ENABLED) return res.status(200).send('ok'); // dormant
  let event;
  try {
    event = billing.constructEvent(req.body, req.headers['stripe-signature']);
  } catch (e) {
    console.error('[billing] webhook signature failed', e.message);
    return res.status(400).send(`Webhook Error: ${e.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object;
        const memberId = s.client_reference_id || (s.metadata && s.metadata.userId);
        const sub = s.subscription ? await billing.retrieveSubscription(s.subscription) : null;
        applyToMember(memberId, {
          stripeCustomerId: s.customer,
          stripeSubscriptionId: s.subscription,
          status: sub ? sub.status : 'active',
          currentPeriodEnd: periodEndISO(sub),
          stripePriceId: firstPriceId(sub),
          plan: planFromPriceId(firstPriceId(sub)),
          cancelAtPeriodEnd: sub ? !!sub.cancel_at_period_end : false,
        });
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.created': {
        const sub = event.data.object;
        applyToMemberByCustomer(sub.customer, {
          stripeSubscriptionId: sub.id,
          status: sub.status,
          currentPeriodEnd: periodEndISO(sub),
          stripePriceId: firstPriceId(sub),
          plan: planFromPriceId(firstPriceId(sub)),
          cancelAtPeriodEnd: !!sub.cancel_at_period_end,
        });
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        applyToMemberByCustomer(sub.customer, { status: 'canceled', cancelAtPeriodEnd: false });
        break;
      }
      case 'invoice.payment_failed': {
        const inv = event.data.object;
        applyToMemberByCustomer(inv.customer, { status: 'past_due' });
        break;
      }
      default:
        break; // ignore other events, still 200
    }
  } catch (e) {
    console.error('[billing] webhook handling error', event.type, e.message);
    // still return 200 so Stripe doesn't hammer retries for a store hiccup; log it.
  }
  return res.status(200).json({ received: true });
}

function planFromPriceId(priceId) {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_PRICE_ANNUAL) return 'annual';
  if (priceId === process.env.STRIPE_PRICE_MONTHLY) return 'monthly';
  return null;
}

// read -> findIndex -> mutate subscription -> write  (mirrors admin.js:667-683 comp toggle)
function applyToMember(memberId, fields) {
  if (!memberId) return;
  const users = readUsers();
  const i = users.findIndex(u => u.id === memberId);
  if (i === -1) return;
  users[i].subscription = Object.assign({}, users[i].subscription, fields, { updatedAt: new Date().toISOString() });
  writeUsers(users);
  console.log('[billing] provisioned member', memberId, fields.status);
}

function applyToMemberByCustomer(customerId, fields) {
  if (!customerId) return;
  const users = readUsers();
  const i = users.findIndex(u => u.subscription && u.subscription.stripeCustomerId === customerId);
  if (i === -1) return;
  users[i].subscription = Object.assign({}, users[i].subscription, fields, { updatedAt: new Date().toISOString() });
  writeUsers(users);
  console.log('[billing] updated member by customer', customerId, fields.status);
}

module.exports = { router, stripeWebhookHandler };
