const dns = require("dns");
const mongoose = require("mongoose");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const Ticket = require("../models/Ticket");
const Event = require("../models/Event");
const EventSubscription = require("../models/EventSubscription");
const User = require("../models/User");
const { sendTicketConfirmationEmail } = require("../utils/emailUtils");
const { respondStripeOutage } = require("../utils/stripeErrorUtils");
const logger = require("../utils/logger");

/**
 * Verify an email domain has MX records (i.e. can actually receive mail).
 * Returns true if valid, false if the domain has no MX records.
 */
const verifyEmailDomain = (email) => {
  return new Promise((resolve) => {
    const domain = email.split("@")[1];
    if (!domain) return resolve(false);
    dns.resolveMx(domain, (err, addresses) => {
      if (err || !addresses || addresses.length === 0) return resolve(false);
      resolve(true);
    });
  });
};

// Shared logic for both authenticated and guest checkout
const buildCheckoutSession = async ({ email, eventId, rawQuantity, res }) => {
  if (!eventId) {
    return res.status(400).json({ error: "eventId is required" });
  }
  if (!mongoose.Types.ObjectId.isValid(eventId)) {
    return res.status(400).json({ error: "Invalid event ID" });
  }

  const quantity = Number(rawQuantity);
  if (!Number.isInteger(quantity) || quantity < 1) {
    return res.status(400).json({ error: "quantity must be a positive integer" });
  }

  try {
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    if (event.ticketsAvailable < quantity) {
      return res.status(400).json({ error: "Not enough tickets available" });
    }

    // Idempotency key prevents duplicate checkout sessions from double-clicks.
    // 10-second bucket means rapid retries within 10s return the same session.
    const timeBucket = Math.floor(Date.now() / 10000);
    const idempotencyKey = `ticket-${eventId}-${email}-${quantity}-${timeBucket}`;

    const isSubscription = event.isReoccurring && event.stripePriceId;

    let sessionConfig;
    if (isSubscription) {
      // Block duplicate active subscriptions
      const existingSub = await EventSubscription.findOne({
        eventId: event._id,
        buyerEmail: email,
        status: { $in: ["active", "past_due"] },
      });
      if (existingSub) {
        return res
          .status(400)
          .json({ error: "You already have an active subscription for this event" });
      }

      sessionConfig = {
        customer_email: email,
        line_items: [{ price: event.stripePriceId, quantity }],
        mode: "subscription",
        success_url: `${process.env.BACK_END_URL}events/${eventId}/subscription-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.FRONT_END_URL}events/${eventId}`,
        metadata: {
          eventId: eventId.toString(),
          email,
          quantity: quantity.toString(),
        },
      };
    } else {
      sessionConfig = {
        customer_email: email,
        line_items: [
          {
            price_data: {
              currency: "gbp",
              product_data: {
                name: event.title,
                description: event.shortDescription,
              },
              unit_amount: Math.round(event.ticketPrice * 100),
            },
            quantity,
          },
        ],
        mode: "payment",
        success_url: `${process.env.BACK_END_URL}payments/success?session_id={CHECKOUT_SESSION_ID}&eventId=${eventId}`,
        cancel_url: `${process.env.FRONT_END_URL}events/${eventId}`,
        metadata: {
          eventId: eventId.toString(),
          email,
          quantity: quantity.toString(),
        },
      };
    }

    const session = await stripe.checkout.sessions.create(sessionConfig, { idempotencyKey });

    // Create a pending EventSubscription record for subscription checkouts
    if (isSubscription) {
      const user = await User.findOne({ email });
      const pendingSub = new EventSubscription({
        eventId: event._id,
        user: user?._id ?? null,
        buyerEmail: email,
        pendingSessionId: session.id,
        status: "pending",
        quantity,
      });
      await pendingSub.save();
    }

    res.json({ url: session.url });
  } catch (err) {
    if (respondStripeOutage(res, err, "ticketPaymentController.buildCheckoutSession")) return;
    logger.error(err, "Stripe session creation error");
    res.status(500).json({ error: "Failed to create checkout session" });
  }
};

// POST /payments/create-checkout-session (authenticated)
exports.createCheckoutSession = async (req, res) => {
  const { eventId, quantity: rawQuantity } = req.body;
  const email = req.user.email;
  return buildCheckoutSession({ email, eventId, rawQuantity, res });
};

// POST /payments/guest-checkout-session (no auth required)
exports.createGuestCheckoutSession = async (req, res) => {
  const { eventId, quantity: rawQuantity, email } = req.body;

  if (!email || typeof email !== "string") {
    return res.status(400).json({ error: "Email is required" });
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email.trim())) {
    return res.status(400).json({ error: "Invalid email address" });
  }

  // Verify the email domain can actually receive mail
  const emailDomainValid = await verifyEmailDomain(email.trim().toLowerCase());
  if (!emailDomainValid) {
    return res.status(400).json({
      error:
        "This email domain does not appear to accept emails. Please use a valid email address.",
    });
  }

  // Guests cannot create subscriptions — they require an authenticated account
  if (eventId && mongoose.Types.ObjectId.isValid(eventId)) {
    const event = await Event.findById(eventId);
    if (event?.isReoccurring && event?.stripePriceId) {
      return res
        .status(403)
        .json({ error: "Subscriptions require an account. Please log in or register." });
    }
  }

  return buildCheckoutSession({ email: email.trim().toLowerCase(), eventId, rawQuantity, res });
};

// GET /payments/success — Stripe redirect after payment
exports.handleSuccess = async (req, res) => {
  const { session_id, eventId } = req.query;

  if (!session_id) {
    logger.warn({ eventId, ip: req.ip }, "payment success redirect missing session_id");
    return res.status(400).json({ error: "Missing session_id" });
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);

    // Subscription checkouts are handled by eventSubscriptionController
    if (session.mode === "subscription") {
      const eventId = session.metadata?.eventId;
      return res.redirect(
        `${process.env.BACK_END_URL}events/${eventId}/subscription-success?session_id=${session_id}`
      );
    }

    if (session.payment_status !== "paid") {
      logger.warn({ eventId }, "Payment could not be completed");
      return res.status(400).json({ error: "Payment not completed" });
    }

    // Idempotency — if tickets already exist for this session, just redirect
    const existingTicket = await Ticket.findOne({ paymentId: session.id });
    if (existingTicket) {
      return res.redirect(
        `${process.env.FRONT_END_URL}order-confirmation?session_id=${session_id}&ticket_id=${existingTicket._id}`
      );
    }

    const { email, quantity, eventId } = session.metadata;
    const qty = parseInt(quantity, 10);
    if (!Number.isInteger(qty) || qty < 1) {
      logger.warn({ quantity }, "Session metadata stored invalid quantity");
      return res.status(400).json({ error: "Invalid quantity in session metadata" });
    }
    const amountPaid = session.amount_total / 100;

    // Verify the email domain can receive mail — if not, refund immediately
    const emailDomainValid = await verifyEmailDomain(email);
    if (!emailDomainValid) {
      logger.warn(
        { email },
        `Invalid email domain for ${email}, issuing refund for session ${session.id}`
      );
      try {
        await stripe.refunds.create({ payment_intent: session.payment_intent });
      } catch (refundErr) {
        logger.error(refundErr, "Refund failed for invalid email domain");
      }
      return res.redirect(`${process.env.FRONT_END_URL}events/${eventId}?error=invalid_email`);
    }

    const user = await User.findOne({ email });

    // Wrap ticket creation + event update in a transaction so either
    // everything succeeds or nothing is written
    const mongoSession = await mongoose.startSession();
    let ticketIds;
    try {
      await mongoSession.withTransaction(async () => {
        ticketIds = [];
        for (let i = 0; i < qty; i++) {
          const ticket = new Ticket({
            eventId,
            buyerEmail: email,
            paymentId: session.id,
            status: "paid",
            user: user?._id ?? null,
          });
          await ticket.save({ session: mongoSession });
          ticketIds.push(ticket._id);
        }

        // Atomic decrement + revenue update — if not enough tickets, the
        // condition fails and we throw to roll back
        const updated = await Event.findOneAndUpdate(
          { _id: eventId, ticketsAvailable: { $gte: qty } },
          { $inc: { ticketsAvailable: -qty, totalRevenue: amountPaid } },
          { session: mongoSession, new: true }
        );
        if (!updated) throw new Error("Not enough tickets available");
      });
    } catch (txErr) {
      // Transaction rolled back — payment went through but we couldn't
      // fulfil the order. Issue an automatic refund.
      logger.error(txErr, "Ticket transaction failed with this error, will issue refund");
      try {
        await stripe.refunds.create({ payment_intent: session.payment_intent });
      } catch (refundErr) {
        logger.error(refundErr, "Automatic refund failed");
      }
      return res.redirect(
        `${process.env.FRONT_END_URL}events/${eventId}?error=tickets_unavailable`
      );
    } finally {
      await mongoSession.endSession();
    }

    // Fire-and-forget: send confirmation email without blocking the redirect
    const event = await Event.findById(eventId);
    const createdTickets = await Ticket.find({ paymentId: session.id });
    sendTicketConfirmationEmail({ buyerEmail: email, tickets: createdTickets, event }).catch(
      (err) => logger.error(err, "Failed to send ticket confirmation email:")
    );

    res.redirect(
      `${process.env.FRONT_END_URL}order-confirmation?session_id=${session_id}&ticket_id=${ticketIds[0]}`
    );
  } catch (err) {
    logger.error(err, "Payment for ticket failed");
    console.error("Stripe success handler error:", err);
    res.status(500).json({ error: "Failed to process payment confirmation" });
  }
};

// GET /payments/guest-order/:sessionId — public endpoint for guest order confirmation
// Secured by Stripe session ID knowledge (unguessable). Returns tickets for display.
exports.getGuestOrder = async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.retrieve(req.params.sessionId);
    if (!session || session.payment_status !== "paid") {
      return res.status(404).json({ error: "Order not found" });
    }

    const tickets = await Ticket.find({ paymentId: session.id }).populate({
      path: "eventId",
      select: "title date openingTime street city postCode typeOfEvent images ticketPrice",
    });

    if (!tickets.length) {
      return res.status(404).json({ error: "No tickets found for this order" });
    }

    res.json({
      tickets,
      email: session.customer_email,
      amountTotal: session.amount_total / 100,
      quantity: parseInt(session.metadata.quantity, 10),
    });
  } catch (err) {
    logger.error(err, "Error fetching guest order");
    res.status(500).json({ error: "Failed to fetch order details" });
  }
};

// GET /payments/session/:sessionId — frontend fetches order details
exports.getSession = async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.retrieve(req.params.sessionId);

    // Enforce ownership — only the buyer or an admin can view a session
    if (session.customer_email !== req.user.email && req.user.role !== "admin") {
      logger.warn(
        { userId: req.user.id, sessionId: req.params.sessionId },
        "Unauthorised attempt to view payment session"
      );
      return res.status(403).json({ error: "Not authorised to view this session" });
    }

    res.json({
      customerEmail: session.customer_email,
      amountTotal: session.amount_total / 100,
      currency: session.currency,
      paymentStatus: session.payment_status,
      eventId: session.metadata.eventId,
      quantity: session.metadata.quantity,
    });
  } catch (err) {
    logger.error(err, "Error retrieving session");
    res.status(500).json({ error: "Failed to retrieve session" });
  }
};
