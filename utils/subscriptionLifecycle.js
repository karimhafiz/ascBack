const mongoose = require("mongoose");
const WebhookEvent = require("../models/WebhookEvent");
const { respondStripeOutage } = require("./stripeErrorUtils");
const logger = require("./logger");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

// Stripe moved current_period_end from subscription to subscription item.
// fallbackInterval only matters if Stripe's response is missing it entirely
// (logged as a warning, since that shouldn't normally happen).
function getSubPeriodEnd(sub) {
  return sub.items?.data?.[0]?.current_period_end ?? sub.current_period_end;
}

function resolveCurrentPeriodEnd(sub, fallbackInterval = "month") {
  const periodTs = getSubPeriodEnd(sub);
  if (periodTs) return new Date(periodTs * 1000);
  logger.warn(
    { subscriptionId: sub.id },
    "Missing current_period_end for subscription, using fallback"
  );
  const now = new Date();
  if (fallbackInterval === "year") now.setFullYear(now.getFullYear() + 1);
  else if (fallbackInterval === "week") now.setDate(now.getDate() + 7);
  else now.setMonth(now.getMonth() + 1);
  return now;
}

function isOwnerOrAdmin(record, user) {
  const ownerId = record.user?.toString();
  const isOwner = ownerId ? ownerId === user.id : record.buyerEmail === user.email;
  return isOwner || user.role === "admin";
}

// ─── POST .../:id/cancel ──────────────────────────────────────────────────
// Cancels at period end in Stripe so the buyer keeps access until the date
// they've already paid for. Shared by course enrollments and event
// subscriptions — see courseController.js / eventSubscriptionController.js
// for the domain config each one passes in.
function createCancelSubscriptionHandler({
  Model,
  idParam,
  invalidIdError,
  notFoundError,
  notSubscriptionError,
  getParent,
  sendCancellationEmail,
  logContext,
}) {
  return async function cancelSubscription(req, res) {
    try {
      const id = req.params[idParam];
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ error: invalidIdError });
      }

      const record = await Model.findById(id);
      if (!record) return res.status(404).json({ error: notFoundError });

      if (!isOwnerOrAdmin(record, req.user)) {
        return res.status(403).json({ error: "Not authorised" });
      }

      if (!record.subscriptionId) {
        return res.status(400).json({ error: notSubscriptionError });
      }

      if (record.subscriptionStatus === "cancelled") {
        return res.status(400).json({ error: "Subscription is already cancelled" });
      }

      const updatedSub = await stripe.subscriptions.update(record.subscriptionId, {
        cancel_at_period_end: true,
      });
      const periodEnd = resolveCurrentPeriodEnd(updatedSub);

      await Model.findByIdAndUpdate(id, {
        subscriptionStatus: "cancelled",
        currentPeriodEnd: periodEnd,
      });

      const parent = await getParent(record);
      if (parent) {
        sendCancellationEmail(record, parent, periodEnd).catch((err) =>
          logger.error(err, "Failed to send cancellation email")
        );
      }

      res.json({
        message:
          "Subscription cancelled. You will retain access until the end of your current billing period.",
        currentPeriodEnd: periodEnd,
      });
    } catch (err) {
      if (respondStripeOutage(res, err, `${logContext}.cancelSubscription`)) return;
      logger.error(err, "Error cancelling subscription");
      res.status(500).json({ error: "Failed to cancel subscription" });
    }
  };
}

// ─── POST .../:id/reactivate ──────────────────────────────────────────────
// If Stripe still has the subscription (just marked cancel_at_period_end),
// flips that back directly. If Stripe already fully deleted it, builds a
// fresh checkout session with trial_end set to the still-unexpired period
// end, so the buyer doesn't get double-charged.
function createReactivateSubscriptionHandler({
  Model,
  idParam,
  invalidIdError,
  notFoundError,
  notSubscriptionError,
  getParent,
  parentNotFoundError,
  getPriceId,
  missingPriceError,
  getQuantity,
  buildCheckoutParams,
  logContext,
}) {
  return async function reactivateSubscription(req, res) {
    try {
      const id = req.params[idParam];
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ error: invalidIdError });
      }

      const record = await Model.findById(id);
      if (!record) return res.status(404).json({ error: notFoundError });

      if (!isOwnerOrAdmin(record, req.user)) {
        return res.status(403).json({ error: "Not authorised" });
      }

      if (!record.subscriptionId) {
        return res.status(400).json({ error: notSubscriptionError });
      }

      if (record.subscriptionStatus !== "cancelled") {
        return res.status(400).json({ error: "Subscription is not cancelled" });
      }

      let canReactivateDirectly = false;
      try {
        const stripeSub = await stripe.subscriptions.retrieve(record.subscriptionId);
        if (stripeSub.status !== "canceled") canReactivateDirectly = true;
      } catch (stripeErr) {
        if (stripeErr.code !== "resource_missing") throw stripeErr;
        // Subscription gone from Stripe — fall through to checkout flow
      }

      if (canReactivateDirectly) {
        const updatedSub = await stripe.subscriptions.update(record.subscriptionId, {
          cancel_at_period_end: false,
        });
        const periodEnd = resolveCurrentPeriodEnd(updatedSub);

        await Model.findByIdAndUpdate(id, {
          subscriptionStatus: "active",
          currentPeriodEnd: periodEnd,
        });

        return res.json({
          message: "Subscription reactivated successfully.",
          currentPeriodEnd: periodEnd,
        });
      }

      const parent = await getParent(record);
      if (!parent) return res.status(404).json({ error: parentNotFoundError });

      const priceId = getPriceId(parent);
      if (!priceId) return res.status(500).json({ error: missingPriceError });

      const quantity = getQuantity(record);

      // If there's still time left on the current period, defer the first
      // charge to when that period ends so the buyer doesn't pay twice.
      const subscriptionData = {};
      if (record.currentPeriodEnd && new Date(record.currentPeriodEnd) > new Date()) {
        subscriptionData.trial_end = Math.floor(new Date(record.currentPeriodEnd).getTime() / 1000);
      }

      const session = await stripe.checkout.sessions.create(
        buildCheckoutParams(record, parent, priceId, quantity, subscriptionData, id)
      );

      await Model.findByIdAndUpdate(id, { pendingSessionId: session.id });

      return res.json({ url: session.url });
    } catch (err) {
      if (respondStripeOutage(res, err, `${logContext}.reactivateSubscription`)) return;
      logger.error(err, "Error reactivating subscription");
      res.status(500).json({ error: "Failed to reactivate subscription" });
    }
  };
}

// ─── POST .../webhook ──────────────────────────────────────────────────────
// Stripe sends events here for subscription lifecycle. Each domain has its
// own endpoint + signing secret in the Stripe Dashboard, but the event
// handling itself (idempotency ledger, out-of-order guard, the three event
// types) is identical.
function createWebhookHandler({
  Model,
  webhookSecretEnv,
  getParentIdField,
  getDeletedCount,
  updateParentCounter,
}) {
  return async function handleWebhook(req, res) {
    const sig = req.headers["stripe-signature"];
    let event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, process.env[webhookSecretEnv]);
    } catch (err) {
      logger.error(err, "Webhook signature error");
      return res.status(400).json({ error: "Webhook signature verification failed" });
    }

    try {
      // Idempotency — skip if this event was already processed
      const alreadyProcessed = await WebhookEvent.findOne({ stripeEventId: event.id });
      if (alreadyProcessed) {
        return res.json({ received: true, duplicate: true });
      }

      const eventTimestamp = event.created;

      switch (event.type) {
        case "invoice.payment_succeeded": {
          const invoice = event.data.object;
          if (invoice.subscription) {
            const sub = await stripe.subscriptions.retrieve(invoice.subscription);
            // Only apply if this event is newer than the last one we processed
            await Model.findOneAndUpdate(
              {
                subscriptionId: invoice.subscription,
                $or: [
                  { lastStripeEventTimestamp: null },
                  { lastStripeEventTimestamp: { $lt: eventTimestamp } },
                ],
              },
              {
                $set: {
                  subscriptionStatus: "active",
                  currentPeriodEnd: resolveCurrentPeriodEnd(sub),
                  status: "active",
                  lastStripeEventTimestamp: eventTimestamp,
                },
                $inc: { totalAmountPaid: (invoice.amount_paid ?? 0) / 100 },
              }
            );
          }
          break;
        }
        case "invoice.payment_failed": {
          const invoice = event.data.object;
          if (invoice.subscription) {
            await Model.findOneAndUpdate(
              {
                subscriptionId: invoice.subscription,
                $or: [
                  { lastStripeEventTimestamp: null },
                  { lastStripeEventTimestamp: { $lt: eventTimestamp } },
                ],
              },
              {
                subscriptionStatus: "past_due",
                status: "past_due",
                lastStripeEventTimestamp: eventTimestamp,
              }
            );
          }
          break;
        }
        case "customer.subscription.deleted": {
          const sub = event.data.object;

          // Transaction: update record status + decrement parent counter atomically
          const mongoSession = await mongoose.startSession();
          try {
            await mongoSession.withTransaction(async () => {
              const record = await Model.findOneAndUpdate(
                {
                  subscriptionId: sub.id,
                  status: { $ne: "cancelled" },
                  $or: [
                    { lastStripeEventTimestamp: null },
                    { lastStripeEventTimestamp: { $lt: eventTimestamp } },
                  ],
                },
                {
                  subscriptionStatus: "cancelled",
                  status: "cancelled",
                  lastStripeEventTimestamp: eventTimestamp,
                },
                { new: false, session: mongoSession }
              );

              if (record) {
                await updateParentCounter(
                  getParentIdField(record),
                  getDeletedCount(record),
                  mongoSession
                );
              }
            });
          } finally {
            await mongoSession.endSession();
          }
          break;
        }
      }

      // Record this event as processed
      await WebhookEvent.create({
        stripeEventId: event.id,
        eventType: event.type,
      });

      res.json({ received: true });
    } catch (err) {
      logger.error(err, "Webhook handler error");
      res.status(500).json({ error: "Webhook processing failed" });
    }
  };
}

module.exports = {
  resolveCurrentPeriodEnd,
  createCancelSubscriptionHandler,
  createReactivateSubscriptionHandler,
  createWebhookHandler,
};
