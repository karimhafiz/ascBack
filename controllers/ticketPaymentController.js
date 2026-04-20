const mongoose = require("mongoose");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const Ticket = require("../models/Ticket");
const Event = require("../models/Event");
const User = require("../models/User");
const { sendTicketConfirmationEmail } = require("../utils/emailUtils");

// POST /payments/create-checkout-session
exports.createCheckoutSession = async (req, res) => {
  const { eventId, quantity: rawQuantity } = req.body;
  const email = req.user.email;

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

    const session = await stripe.checkout.sessions.create({
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
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Stripe session creation error:", err);
    res.status(500).json({ error: "Failed to create checkout session" });
  }
};

// GET /payments/success — Stripe redirect after payment
exports.handleSuccess = async (req, res) => {
  const { session_id } = req.query;

  if (!session_id) {
    return res.status(400).json({ error: "Missing session_id" });
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);

    if (session.payment_status !== "paid") {
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
      return res.status(400).json({ error: "Invalid quantity in session metadata" });
    }
    const amountPaid = session.amount_total / 100;

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
      console.error("Ticket transaction failed, issuing refund:", txErr);
      try {
        await stripe.refunds.create({ payment_intent: session.payment_intent });
      } catch (refundErr) {
        console.error("Automatic refund failed:", refundErr);
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
      (err) => console.error("Failed to send ticket confirmation email:", err)
    );

    res.redirect(
      `${process.env.FRONT_END_URL}order-confirmation?session_id=${session_id}&ticket_id=${ticketIds[0]}`
    );
  } catch (err) {
    console.error("Stripe success handler error:", err);
    res.status(500).json({ error: "Failed to process payment confirmation" });
  }
};

// GET /payments/session/:sessionId — frontend fetches order details
exports.getSession = async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.retrieve(req.params.sessionId);

    // Enforce ownership — only the buyer or an admin can view a session
    if (session.customer_email !== req.user.email && req.user.role !== "admin") {
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
    console.error("Error retrieving session:", err);
    res.status(500).json({ error: "Failed to retrieve session" });
  }
};
