const mongoose = require("mongoose");
const Event = require("../models/Event");
const EventSubscription = require("../models/EventSubscription");
const User = require("../models/User");
const WebhookEvent = require("../models/WebhookEvent");
const {
  sendEventSubscriptionEmail,
  sendEventSubscriptionCancellationEmail,
} = require("../utils/emailUtils");
const { respondStripeOutage } = require("../utils/stripeErrorUtils");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

// Stripe moved current_period_end from subscription to subscription item
function getSubPeriodEnd(sub) {
  return sub.items?.data?.[0]?.current_period_end ?? sub.current_period_end;
}

function resolveCurrentPeriodEnd(sub, fallbackInterval = "month") {
  const periodTs = getSubPeriodEnd(sub);
  if (periodTs) return new Date(periodTs * 1000);
  console.warn(`Missing current_period_end for sub ${sub.id}, using fallback`);
  const now = new Date();
  if (fallbackInterval === "week") now.setDate(now.getDate() + 7);
  else now.setMonth(now.getMonth() + 1);
  return now;
}

// ─── GET /events/:eventId/subscription-success ────────────────────────────────
// Stripe redirects here after subscription checkout.
// ─────────────────────────────────────────────────────────────────────────────
exports.handleSubscriptionSuccess = async (req, res) => {
  const { eventId } = req.params;
  const { session_id } = req.query;

  if (!session_id) {
    return res.redirect(`${process.env.FRONT_END_URL}events`);
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ["subscription"],
    });

    // Idempotency — don't process duplicate
    const existing = await EventSubscription.findOne({ paymentId: session.id });
    if (existing) {
      return res.redirect(
        `${process.env.FRONT_END_URL}subscription-confirmation?eventId=${eventId}`
      );
    }

    // ── Reactivation flow — atomic update, no subscriber count change ──
    const reactivateId = session.metadata?.reactivateSubscriptionId;
    if (reactivateId) {
      const $set = {
        paymentId: session.id,
        status: "active",
        subscriptionStatus: session.subscription?.status || "active",
      };

      if (session.subscription) {
        const sub = session.subscription;
        $set.subscriptionId = sub.id;
        $set.currentPeriodEnd = resolveCurrentPeriodEnd(sub);
      }

      const subscription = await EventSubscription.findByIdAndUpdate(
        reactivateId,
        { $set, $unset: { pendingSessionId: 1 } },
        { new: true }
      );

      if (subscription) {
        const event = await Event.findById(eventId);
        if (event) {
          sendEventSubscriptionEmail({
            buyerEmail: subscription.buyerEmail,
            event,
            subscription,
          }).catch((err) => console.error("Failed to send reactivation email:", err));
        }

        return res.redirect(
          `${process.env.FRONT_END_URL}subscription-confirmation?eventId=${eventId}&reactivated=true`
        );
      }
    }

    const email = session.metadata?.email;

    // ── Transaction: update/create subscription + increment subscriber count ──
    const mongoSession = await mongoose.startSession();
    let finalSubscription;
    try {
      await mongoSession.withTransaction(async () => {
        const subFields = {};
        if (session.subscription) {
          const sub = session.subscription;
          subFields.subscriptionId = sub.id;
          subFields.subscriptionStatus = sub.status;
          subFields.currentPeriodEnd = resolveCurrentPeriodEnd(sub);
        }

        // Try to atomically update a pending subscription first
        finalSubscription = await EventSubscription.findOneAndUpdate(
          { pendingSessionId: session.id, status: "pending" },
          {
            $set: {
              paymentId: session.id,
              status: "active",
              ...subFields,
            },
            $unset: { pendingSessionId: 1 },
          },
          { new: true, session: mongoSession }
        );

        if (!finalSubscription) {
          // Fallback: create subscription if no pending record found
          const user = await User.findOne({ email }, null, { session: mongoSession });
          const subscriptionData = {
            eventId,
            user: user?._id ?? null,
            buyerEmail: email,
            paymentId: session.id,
            status: "active",
            quantity: parseInt(session.metadata?.quantity || "1", 10),
            ...subFields,
          };

          const newSub = new EventSubscription(subscriptionData);
          await newSub.save({ session: mongoSession });
          finalSubscription = newSub;
        }

        await Event.findByIdAndUpdate(
          eventId,
          { $inc: { currentSubscribers: 1 } },
          { session: mongoSession }
        );
      });
    } finally {
      await mongoSession.endSession();
    }

    // Fire-and-forget: send confirmation email
    const event = await Event.findById(eventId);
    if (event && finalSubscription) {
      sendEventSubscriptionEmail({
        buyerEmail: email,
        event,
        subscription: finalSubscription,
      }).catch((err) => console.error("Failed to send subscription email:", err));
    }

    res.redirect(`${process.env.FRONT_END_URL}subscription-confirmation?eventId=${eventId}`);
  } catch (err) {
    console.error("Subscription success error:", err);
    res.redirect(`${process.env.FRONT_END_URL}events`);
  }
};

// ─── GET /events/:eventId/my-subscription ─────────────────────────────────────
// Returns the current user's active subscription for this event, if any.
// ─────────────────────────────────────────────────────────────────────────────
exports.getMySubscription = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.eventId)) {
      return res.status(400).json({ error: "Invalid event ID" });
    }

    const subscription = await EventSubscription.findOne({
      eventId: req.params.eventId,
      buyerEmail: req.user.email,
      status: { $in: ["active", "past_due"] },
    });
    if (!subscription) return res.json({ subscription: null });

    // If this is a cancelled subscription whose paid period has passed,
    // expire it now. The user paid through currentPeriodEnd — honour that.
    if (
      subscription.subscriptionId &&
      subscription.subscriptionStatus === "cancelled" &&
      subscription.currentPeriodEnd &&
      new Date(subscription.currentPeriodEnd) < new Date()
    ) {
      const mongoSession = await mongoose.startSession();
      try {
        await mongoSession.withTransaction(async () => {
          await EventSubscription.findByIdAndUpdate(
            subscription._id,
            { status: "cancelled" },
            { session: mongoSession }
          );
          await Event.findByIdAndUpdate(
            subscription.eventId,
            { $inc: { currentSubscribers: -1 } },
            { session: mongoSession }
          );
        });
      } finally {
        await mongoSession.endSession();
      }
      return res.json({ subscription: null });
    }

    res.json({ subscription });
  } catch (err) {
    console.error("Error fetching subscription:", err);
    res.status(500).json({ error: "Failed to fetch subscription" });
  }
};

// ─── POST /events/subscriptions/:subscriptionId/cancel ────────────────────────
// User cancels their subscription — cancels at period end in Stripe.
// ─────────────────────────────────────────────────────────────────────────────
exports.cancelSubscription = async (req, res) => {
  try {
    const { subscriptionId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(subscriptionId)) {
      return res.status(400).json({ error: "Invalid subscription ID" });
    }

    const subscription = await EventSubscription.findById(subscriptionId);
    if (!subscription) return res.status(404).json({ error: "Subscription not found" });

    const ownerId = subscription.user?.toString();
    const isOwner = ownerId ? ownerId === req.user.id : subscription.buyerEmail === req.user.email;
    if (!isOwner && req.user.role !== "admin") {
      return res.status(403).json({ error: "Not authorised" });
    }

    if (!subscription.subscriptionId) {
      return res.status(400).json({ error: "This is not a subscription" });
    }

    if (subscription.subscriptionStatus === "cancelled") {
      return res.status(400).json({ error: "Subscription is already cancelled" });
    }

    const updatedSub = await stripe.subscriptions.update(subscription.subscriptionId, {
      cancel_at_period_end: true,
    });

    const periodEnd = resolveCurrentPeriodEnd(updatedSub);

    await EventSubscription.findByIdAndUpdate(subscriptionId, {
      subscriptionStatus: "cancelled",
      currentPeriodEnd: periodEnd,
    });

    const event = await Event.findById(subscription.eventId);
    if (event) {
      sendEventSubscriptionCancellationEmail({
        buyerEmail: subscription.buyerEmail,
        event,
        currentPeriodEnd: periodEnd,
      }).catch((err) => console.error("Failed to send cancellation email:", err));
    }

    res.json({
      message:
        "Subscription cancelled. You will retain access until the end of your current billing period.",
      currentPeriodEnd: periodEnd,
    });
  } catch (err) {
    if (respondStripeOutage(res, err, "eventSubscriptionController.cancelSubscription")) return;
    console.error("Error cancelling subscription:", err);
    res.status(500).json({ error: "Failed to cancel subscription" });
  }
};

// ─── POST /events/subscriptions/:subscriptionId/reactivate ────────────────────
// User reactivates a cancelled subscription.
// ─────────────────────────────────────────────────────────────────────────────
exports.reactivateSubscription = async (req, res) => {
  try {
    const { subscriptionId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(subscriptionId)) {
      return res.status(400).json({ error: "Invalid subscription ID" });
    }

    const subscription = await EventSubscription.findById(subscriptionId);
    if (!subscription) return res.status(404).json({ error: "Subscription not found" });

    const ownerId = subscription.user?.toString();
    const isOwner = ownerId ? ownerId === req.user.id : subscription.buyerEmail === req.user.email;
    if (!isOwner && req.user.role !== "admin") {
      return res.status(403).json({ error: "Not authorised" });
    }

    if (!subscription.subscriptionId) {
      return res.status(400).json({ error: "This is not a subscription" });
    }

    if (subscription.subscriptionStatus !== "cancelled") {
      return res.status(400).json({ error: "Subscription is not cancelled" });
    }

    // Try to reactivate in Stripe by removing cancel_at_period_end
    let canReactivateDirectly = false;
    try {
      const stripeSub = await stripe.subscriptions.retrieve(subscription.subscriptionId);
      if (stripeSub.status !== "canceled") {
        canReactivateDirectly = true;
      }
    } catch (stripeErr) {
      if (stripeErr.code !== "resource_missing") throw stripeErr;
    }

    if (canReactivateDirectly) {
      const updatedSub = await stripe.subscriptions.update(subscription.subscriptionId, {
        cancel_at_period_end: false,
      });

      const periodEnd = resolveCurrentPeriodEnd(updatedSub);

      await EventSubscription.findByIdAndUpdate(subscriptionId, {
        subscriptionStatus: "active",
        currentPeriodEnd: periodEnd,
      });

      return res.json({
        message: "Subscription reactivated successfully.",
        currentPeriodEnd: periodEnd,
      });
    }

    // Stripe subscription is gone — create a new checkout session
    const event = await Event.findById(subscription.eventId);
    if (!event) return res.status(404).json({ error: "Event not found" });

    if (!event.stripePriceId) {
      return res.status(500).json({
        error: "This event is missing its Stripe price configuration. Please contact an admin.",
      });
    }

    const subscriptionData = {};
    if (subscription.currentPeriodEnd && new Date(subscription.currentPeriodEnd) > new Date()) {
      subscriptionData.trial_end = Math.floor(
        new Date(subscription.currentPeriodEnd).getTime() / 1000
      );
    }

    const session = await stripe.checkout.sessions.create({
      customer_email: subscription.buyerEmail,
      line_items: [{ price: event.stripePriceId, quantity: subscription.quantity || 1 }],
      mode: "subscription",
      ...(subscriptionData.trial_end && { subscription_data: subscriptionData }),
      success_url: `${process.env.BACK_END_URL}events/${event._id}/subscription-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONT_END_URL}events/${event._id}`,
      metadata: {
        eventId: event._id.toString(),
        email: subscription.buyerEmail,
        quantity: (subscription.quantity || 1).toString(),
        reactivateSubscriptionId: subscriptionId,
      },
    });

    await EventSubscription.findByIdAndUpdate(subscriptionId, {
      pendingSessionId: session.id,
    });

    return res.json({ url: session.url });
  } catch (err) {
    if (respondStripeOutage(res, err, "eventSubscriptionController.reactivateSubscription")) return;
    console.error("Error reactivating subscription:", err);
    res.status(500).json({ error: "Failed to reactivate subscription" });
  }
};

// ─── POST /events/subscriptions/webhook ───────────────────────────────────────
// Stripe sends events here for event subscription lifecycle.
// ─────────────────────────────────────────────────────────────────────────────
exports.handleWebhook = async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_EVENT_SUBSCRIPTION_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature error:", err.message);
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
          await EventSubscription.findOneAndUpdate(
            {
              subscriptionId: invoice.subscription,
              $or: [
                { lastStripeEventTimestamp: null },
                { lastStripeEventTimestamp: { $lt: eventTimestamp } },
              ],
            },
            {
              subscriptionStatus: "active",
              currentPeriodEnd: resolveCurrentPeriodEnd(sub),
              status: "active",
              lastStripeEventTimestamp: eventTimestamp,
            }
          );
        }
        break;
      }
      case "invoice.payment_failed": {
        const invoice = event.data.object;
        if (invoice.subscription) {
          await EventSubscription.findOneAndUpdate(
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

        const mongoSession = await mongoose.startSession();
        try {
          await mongoSession.withTransaction(async () => {
            const subscription = await EventSubscription.findOneAndUpdate(
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

            if (subscription) {
              await Event.findByIdAndUpdate(
                subscription.eventId,
                { $inc: { currentSubscribers: -1 } },
                { session: mongoSession }
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
    console.error("Webhook handler error:", err);
    res.status(500).json({ error: "Webhook processing failed" });
  }
};
