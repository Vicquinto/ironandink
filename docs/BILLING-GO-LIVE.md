# Iron & Ink — Billing Go-Live Checklist

The subscription system ships **dark**. With `BILLING_ENABLED=false` (the default) the
site behaves byte-for-byte as it did before billing existed: no study caps, no Live
Rooms host gate, no upgrade UI. Everything below is for **later**, once the LLC and a
Stripe account exist.

> **Operational note:** these changes touch `server.js` and env vars. After editing
> `.env` on the server, do a full **`pm2 restart ironandink`** — a `pm2 reload` will
> not re-read the environment.

## Steps

1. **Create the product + prices.** In the Stripe Dashboard, create one **Product**
   ("Iron & Ink Membership") with two recurring **Prices**: **$9.99/month** and
   **$99.99/year**. Copy the two Price IDs into `STRIPE_PRICE_MONTHLY` and
   `STRIPE_PRICE_ANNUAL`.

2. **Copy the API keys.** Put the **Secret** and **Publishable** keys into `.env`
   (`STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`). Use **test** keys first.

3. **Create the webhook endpoint.** Point it at
   `https://<your-domain>/webhooks/stripe`, subscribed to:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`

   Copy the endpoint's **signing secret** into `STRIPE_WEBHOOK_SECRET`.

4. **Enable the Customer Portal.** In Stripe's **Customer Portal** settings, turn on
   subscription cancellation and payment-method updates (the Settings → *Manage
   subscription* button routes here via `/api/billing/portal`).

5. **Flip the flag.** Set `BILLING_ENABLED=true` in `.env`, then
   **`pm2 restart ironandink`** (not reload).

6. **Test end-to-end with a test card** (`4242 4242 4242 4242`, any future expiry, any
   CVC):
   - Subscribe from `/pricing`.
   - Confirm the webhook provisions the member — look for
     `[billing] provisioned member ...` in the logs.
   - Confirm Live Rooms hosting unlocks and the free study cap lifts.
   - Cancel via the portal → confirm access holds until the period end
     (`currentPeriodEnd`), not immediately.

7. **Go live.** When satisfied, swap the test keys for **live** keys (secret,
   publishable, and a live webhook signing secret), `pm2 restart`, and run one real
   transaction to confirm.

## How access is decided (reference)

`lib/entitlements.js` is the single source of truth. For any member it returns one of:

- **`unlimited`** — `BILLING_ENABLED=false` (dark). Everyone, always. This is today's
  behavior.
- **`comp`** — the member's `comped` flag is set (admin toggle, unchanged). Full
  paid-equivalent access, no charge.
- **`paid`** — an active subscription (`active` / `trialing` / `past_due`, and the
  current period has not ended).
- **`free`** — everyone else when billing is on: up to **5 study generations per
  calendar month** (adult + children's both count), may **join** Live Rooms but not
  **host** them.

Entitlement checks always read the **fresh** record from `data/users.json` by
`req.session.userId`, never the cached session snapshot.

Two new optional member fields are created lazily by the billing flow (no migration,
existing rows untouched):

- `subscription`: `{ status, plan, stripeCustomerId, stripeSubscriptionId, stripePriceId, currentPeriodEnd, cancelAtPeriodEnd, updatedAt }`
- `studyMeter`: `{ period: "YYYY-MM", count: N }`
