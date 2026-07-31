// lib/entitlements.js
'use strict';

// Parsed once at startup. Unset/blank/anything-but-"true" => false (dark).
const BILLING_ENABLED = process.env.BILLING_ENABLED === 'true';

const FREE_STUDY_LIMIT = 5;

// Display prices for the pricing page (placeholders; real charge is set by the Stripe Price).
const PRICING = {
  monthly: { key: 'monthly', label: 'Monthly', amount: '$9.99', per: 'month', priceEnv: 'STRIPE_PRICE_MONTHLY' },
  annual:  { key: 'annual',  label: 'Annual',  amount: '$99.99', per: 'year',  priceEnv: 'STRIPE_PRICE_ANNUAL'  },
};

// Subscription statuses that count as "entitled" while the paid period is still current.
const ENTITLED_STATUSES = ['active', 'trialing', 'past_due'];

// Calendar-month period key, UTC, e.g. "2026-07". (Free cap resets on the 1st.)
function periodKey(d) {
  d = d || new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// Normalize a member's meter to the current period. Returns {period, count}.
// A stale (previous-month) meter reads as count 0 for the current period.
function meterState(member) {
  const nowKey = periodKey();
  const m = member && member.studyMeter;
  if (m && m.period === nowKey && Number.isFinite(m.count)) {
    return { period: nowKey, count: m.count };
  }
  return { period: nowKey, count: 0 };
}

function subscriptionActive(member) {
  const s = member && member.subscription;
  if (!s || !s.status) return false;
  if (!ENTITLED_STATUSES.includes(s.status)) return false;
  if (!s.currentPeriodEnd) return true; // active with no end recorded yet
  return new Date(s.currentPeriodEnd).getTime() > Date.now();
}

/**
 * The single source of truth. Pass the FRESH member record from users.json.
 * When BILLING_ENABLED is false, everyone is fully entitled (today's behavior).
 */
function getEntitlements(member) {
  if (!BILLING_ENABLED) {
    return {
      billingEnabled: false,
      tier: 'unlimited',
      canHostLiveRooms: true,
      canJoinLiveRooms: true,
      studiesUnlimited: true,
      studyLimit: null,
      studiesUsed: 0,
      studiesRemaining: null,
      isComp: !!(member && member.comped),
      reason: 'billing-disabled',
    };
  }

  const isComp = !!(member && member.comped);
  const isPaid = subscriptionActive(member);

  if (isComp || isPaid) {
    return {
      billingEnabled: true,
      tier: isComp ? 'comp' : 'paid',
      canHostLiveRooms: true,
      canJoinLiveRooms: true,
      studiesUnlimited: true,
      studyLimit: null,
      studiesUsed: 0,
      studiesRemaining: null,
      isComp,
      reason: isComp ? 'comp' : 'subscription',
    };
  }

  // Free tier.
  const meter = meterState(member);
  const remaining = Math.max(0, FREE_STUDY_LIMIT - meter.count);
  return {
    billingEnabled: true,
    tier: 'free',
    canHostLiveRooms: false,
    canJoinLiveRooms: true,
    studiesUnlimited: false,
    studyLimit: FREE_STUDY_LIMIT,
    studiesUsed: meter.count,
    studiesRemaining: remaining,
    isComp: false,
    reason: 'free',
  };
}

/**
 * Mutate a member object's meter in place to record ONE successful study.
 * Caller does the read -> findIndex -> recordStudy -> write on users.json
 * (same idiom as the comp toggle at routes/admin.js:667-683).
 * Safe to call only when the member is being metered (free tier, billing on).
 */
function recordStudy(member) {
  const cur = meterState(member); // normalizes stale period to 0
  member.studyMeter = { period: cur.period, count: cur.count + 1 };
  return member;
}

module.exports = {
  BILLING_ENABLED,
  FREE_STUDY_LIMIT,
  PRICING,
  periodKey,
  meterState,
  subscriptionActive,
  getEntitlements,
  recordStudy,
};
