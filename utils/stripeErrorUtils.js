// Stripe Node SDK sets `error.type` to distinguish provider/connection-side
// failures (worth surfacing as "Stripe is down") from legitimate user/request
// errors (bad card, invalid params) that must NOT be treated as an outage.
const STRIPE_OUTAGE_ERROR_TYPES = new Set([
  "StripeConnectionError",
  "StripeAPIError",
  "StripeAuthenticationError",
  "StripeRateLimitError",
]);

function isStripeOutageError(error) {
  return STRIPE_OUTAGE_ERROR_TYPES.has(error?.type);
}

// If `err` is a Stripe-outage-class error, writes the 502 response and
// returns true so the caller's catch block can `return` immediately.
// Returns false (writes nothing) for any other error, so the caller falls
// through to its existing generic error handling unchanged.
function respondStripeOutage(res, err, context) {
  if (!isStripeOutageError(err)) return false;
  console.error(`Stripe outage detected [${context}]:`, err);
  res.status(502).json({
    error: "Payment provider is temporarily unavailable. Please try again shortly.",
  });
  return true;
}

module.exports = { isStripeOutageError, respondStripeOutage };
