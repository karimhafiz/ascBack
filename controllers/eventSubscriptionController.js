const mongoose = require("mongoose");
const Event = require("../models/Event");
const EventSubscription = require("../models/EventSubscription");
const User = require("../models/User");
const {
  sendEventSubscriptionEmail,
  sendEventSubscriptionCancellationEmail,
} = require("../utils/emailUtils");
const logger = require("../utils/logger");
const {
  resolveCurrentPeriodEnd,
  createCancelSubscriptionHandler,
  createReactivateSubscriptionHandler,
  createWebhookHandler,
} = require("../utils/subscriptionLifecycle");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

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
        {
          $set,
          $unset: { pendingSessionId: 1 },
          $inc: { totalAmountPaid: (session.amount_total ?? 0) / 100 },
        },
        { new: true }
      );

      if (subscription) {
        const event = await Event.findById(eventId);
        if (event) {
          sendEventSubscriptionEmail({
            buyerEmail: subscription.buyerEmail,
            event,
            subscription,
          }).catch((err) => logger.error(err, "Failed to send reactivation email"));
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

        const amountPaid = (session.amount_total ?? 0) / 100;

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
            $inc: { totalAmountPaid: amountPaid },
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
            totalAmountPaid: amountPaid,
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
      }).catch((err) => logger.error(err, "Failed to send subscription email"));
    }

    res.redirect(`${process.env.FRONT_END_URL}subscription-confirmation?eventId=${eventId}`);
  } catch (err) {
    logger.error(err, "Subscription success error");
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
    logger.error(err, "Error fetching subscription");
    res.status(500).json({ error: "Failed to fetch subscription" });
  }
};

// ─── POST /events/subscriptions/:subscriptionId/cancel ────────────────────────
// User cancels their subscription — cancels at period end in Stripe.
// ─────────────────────────────────────────────────────────────────────────────
exports.cancelSubscription = createCancelSubscriptionHandler({
  Model: EventSubscription,
  idParam: "subscriptionId",
  invalidIdError: "Invalid subscription ID",
  notFoundError: "Subscription not found",
  notSubscriptionError: "This is not a subscription",
  getParent: (subscription) => Event.findById(subscription.eventId),
  sendCancellationEmail: (subscription, event, periodEnd) =>
    sendEventSubscriptionCancellationEmail({
      buyerEmail: subscription.buyerEmail,
      event,
      currentPeriodEnd: periodEnd,
    }),
  logContext: "eventSubscriptionController",
});

// ─── POST /events/subscriptions/:subscriptionId/reactivate ────────────────────
// User reactivates a cancelled subscription.
// ─────────────────────────────────────────────────────────────────────────────
exports.reactivateSubscription = createReactivateSubscriptionHandler({
  Model: EventSubscription,
  idParam: "subscriptionId",
  invalidIdError: "Invalid subscription ID",
  notFoundError: "Subscription not found",
  notSubscriptionError: "This is not a subscription",
  getParent: (subscription) => Event.findById(subscription.eventId),
  parentNotFoundError: "Event not found",
  getPriceId: (event) => event.stripePriceId,
  missingPriceError:
    "This event is missing its Stripe price configuration. Please contact an admin.",
  getQuantity: (subscription) => subscription.quantity || 1,
  buildCheckoutParams: (
    subscription,
    event,
    priceId,
    quantity,
    subscriptionData,
    subscriptionId
  ) => ({
    customer_email: subscription.buyerEmail,
    line_items: [{ price: priceId, quantity }],
    mode: "subscription",
    ...(subscriptionData.trial_end && { subscription_data: subscriptionData }),
    success_url: `${process.env.BACK_END_URL}events/${event._id}/subscription-success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.FRONT_END_URL}events/${event._id}`,
    metadata: {
      eventId: event._id.toString(),
      email: subscription.buyerEmail,
      quantity: quantity.toString(),
      reactivateSubscriptionId: subscriptionId,
    },
  }),
  logContext: "eventSubscriptionController",
});

// ─── POST /events/subscriptions/webhook ───────────────────────────────────────
// Stripe sends events here for event subscription lifecycle.
// ─────────────────────────────────────────────────────────────────────────────
exports.handleWebhook = createWebhookHandler({
  Model: EventSubscription,
  webhookSecretEnv: "STRIPE_EVENT_SUBSCRIPTION_WEBHOOK_SECRET",
  getParentIdField: (subscription) => subscription.eventId,
  getDeletedCount: () => 1,
  updateParentCounter: (eventId, count, session) =>
    Event.findByIdAndUpdate(eventId, { $inc: { currentSubscribers: -count } }, { session }),
});
