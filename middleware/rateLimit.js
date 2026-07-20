// ─── Rate limiters ───────────────────────────────────────────────────────────
//
// aiLimiter — for Anthropic-backed endpoints, where each request costs real money
// and latency. Tighter than the global apiLimiter in server.js (60/min), which is
// shared with all ordinary /api/ traffic (presence pings, list fetches) and so
// cannot be tightened without throttling normal page use.
//
// Like the limiters in server.js this keys on IP, which express-rate-limit uses by
// default. That means members behind shared NAT share a bucket. Keying on
// req.session.userId would be a better fit for authenticated AI routes — noted
// here rather than changed, since it would alter behaviour for every route the
// limiter is later applied to.

const rateLimit = require('express-rate-limit');

const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max:      20,
  message:  { success: false, error: 'Too many requests. Please wait a moment and try again.' },
  standardHeaders: true,
  legacyHeaders:   false,
});

module.exports = { aiLimiter };
