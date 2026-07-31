// lib/billing.js
'use strict';
const secret = process.env.STRIPE_SECRET_KEY || '';
const stripe = secret ? require('stripe')(secret) : null; // lazy: blank key => null, no crash

function ready() { return !!stripe; }

async function createCheckoutSession({ member, plan, origin }) {
  if (!stripe) throw new Error('Stripe not configured');
  const priceId = plan === 'annual'
    ? process.env.STRIPE_PRICE_ANNUAL
    : process.env.STRIPE_PRICE_MONTHLY;
  return stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    customer_email: member.email,
    client_reference_id: member.id,
    metadata: { userId: member.id, plan },
    success_url: `${origin}/settings?billing=success`,
    cancel_url: `${origin}/pricing?billing=cancelled`,
    allow_promotion_codes: true,
  });
}

async function createPortalSession({ member, origin }) {
  if (!stripe) throw new Error('Stripe not configured');
  return stripe.billingPortal.sessions.create({
    customer: member.subscription && member.subscription.stripeCustomerId,
    return_url: `${origin}/settings`,
  });
}

function constructEvent(rawBody, signature) {
  if (!stripe) throw new Error('Stripe not configured');
  return stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
}

async function retrieveSubscription(id) {
  if (!stripe) throw new Error('Stripe not configured');
  return stripe.subscriptions.retrieve(id);
}

module.exports = { ready, createCheckoutSession, createPortalSession, constructEvent, retrieveSubscription };
