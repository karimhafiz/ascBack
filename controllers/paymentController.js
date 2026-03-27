const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const Ticket = require("../models/Ticket");
const Event = require("../models/Event");
const User = require("../models/User");

// POST /payments/create-checkout-session
exports.createCheckoutSession = async (req, res) => {
  const { eventId, email, quantity } = req.body;

  if (!eventId || !email || !quantity) {
    return res.status(400).json({ error: "eventId, email, and quantity are required" });
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
      payment_method_types: ["card"],
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

    const existingTicket = await Ticket.findOne({ paymentId: session.id });
    if (existingTicket) {
      return res.redirect(
        `${process.env.FRONT_END_URL}order-confirmation?session_id=${session_id}&ticket_id=${existingTicket._id}`
      );
    }

    const { email, quantity, eventId } = session.metadata;
    const qty = parseInt(quantity, 10);
    const amountPaid = session.amount_total / 100;

    const user = await User.findOne({ email });

    const ticketIds = [];
    for (let i = 0; i < qty; i++) {
      const ticket = new Ticket({
        eventId,
        buyerEmail: email,
        paymentId: session.id,
        status: "paid",
        user: user?._id ?? null,
      });
      await ticket.save();
      ticketIds.push(ticket._id);
    }

    const event = await Event.findById(eventId);
    if (event) {
      event.ticketsAvailable = Math.max(0, event.ticketsAvailable - qty);
      event.totalRevenue += amountPaid;
      await event.save();
    }

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
