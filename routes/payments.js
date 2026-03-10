const express = require("express");
const router = express.Router();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const Ticket = require("../models/Ticket");
const Event = require("../models/Event");

// ─── POST /payments/create-checkout-session ───────────────────────────────────
// Called by the frontend when the user clicks "Buy Ticket"
// Body: { eventId, email, quantity }
//
// What happens here:
//   1. We look up the event to get the title and price
//   2. We create a Stripe Checkout Session — this is a temporary Stripe-hosted
//      payment page. Stripe gives us back a URL to redirect the user to.
//   3. We send that URL back to the frontend, which redirects the user.
//   4. Stripe handles card entry, 3D Secure, Apple Pay etc. on their page.
//   5. On success, Stripe redirects to our success_url with the session ID.
//   6. On cancel, Stripe redirects to our cancel_url.
//
// Stripe automatically sends an email receipt to the customer if you have
// "Successful payments" enabled in Stripe Dashboard → Settings → Emails.
// ─────────────────────────────────────────────────────────────────────────────
router.post("/create-checkout-session", async (req, res) => {
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

    // Create a Stripe Checkout Session.
    // `line_items` describes what the user is buying — Stripe uses this to
    // display the product name, price, and quantity on the checkout page.
    // `price_data` is used instead of a pre-created Stripe Price object,
    // so we can pass the event price dynamically from our database.
    // `unit_amount` is in pence (GBP smallest unit), so we multiply by 100.
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      customer_email: email, // pre-fills email on Stripe's page
      line_items: [
        {
          price_data: {
            currency: "gbp",
            product_data: {
              name: event.title,
              description: event.shortDescription,
            },
            unit_amount: Math.round(event.ticketPrice * 100), // pence
          },
          quantity,
        },
      ],
      mode: "payment",

      // After payment succeeds, Stripe redirects here.
      // {CHECKOUT_SESSION_ID} is a Stripe placeholder — it fills it in automatically.
      // We use it in /success to retrieve the session and confirm payment details.
      success_url: `${process.env.BACK_END_URL}payments/success?session_id={CHECKOUT_SESSION_ID}&eventId=${eventId}`,
      cancel_url: `${process.env.FRONT_END_URL}events/${eventId}`,

      // Store eventId, email, quantity in metadata so we can access them
      // in the success route without relying on URL params alone.
      metadata: {
        eventId: eventId.toString(),
        email,
        quantity: quantity.toString(),
      },
    });

    // Return the Stripe Checkout URL to the frontend
    res.json({ url: session.url });
  } catch (err) {
    console.error("Stripe session creation error:", err);
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

// ─── GET /payments/success ────────────────────────────────────────────────────
// Stripe redirects the user here after a successful payment.
// Query params: session_id (from Stripe), eventId (from our success_url)
//
// What happens here:
//   1. We retrieve the Stripe session using the session_id to verify payment
//      status. This is important — never trust the redirect alone, always
//      verify with Stripe's API.
//   2. If payment_status is "paid", we create a Ticket in our DB and update
//      the event's revenue and available tickets.
//   3. We check for an existing ticket with this session ID first (idempotency)
//      — in case the user refreshes the success page.
//   4. Stripe sends the receipt email automatically — no nodemailer needed.
//   5. We redirect the user to the frontend confirmation page.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/success", async (req, res) => {
  const { session_id, eventId } = req.query;

  if (!session_id) {
    return res.status(400).json({ error: "Missing session_id" });
  }

  try {
    // Retrieve the session from Stripe to verify it's genuinely paid.
    // This is a server-side call — the user cannot fake this.
    const session = await stripe.checkout.sessions.retrieve(session_id);

    if (session.payment_status !== "paid") {
      return res.status(400).json({ error: "Payment not completed" });
    }

    // Idempotency check — if this session was already processed, don't
    // create duplicate tickets. This handles page refreshes gracefully.
    const existingTicket = await Ticket.findOne({ paymentId: session.id });
    if (existingTicket) {
      return res.redirect(`${process.env.FRONT_END_URL}order-confirmation?session_id=${session_id}&ticket_id=${existingTicket._id}`);
    }

    const { email, quantity } = session.metadata;
    const qty = parseInt(quantity, 10);
    const amountPaid = session.amount_total / 100; // convert pence back to pounds

    // Look up the user by email to link the tickets to their account
    const User = require("../models/User");
    const user = await User.findOne({ email });

    // Create N separate ticket records (one per ticket in the bulk purchase)
    // All tickets from the same purchase share the same paymentId
    const ticketIds = [];
    for (let i = 0; i < qty; i++) {
      const ticket = new Ticket({
        eventId,
        buyerEmail: email,
        paymentId: session.id, // Stripe session ID used for grouping
        status: "paid",
        user: user?._id ?? null,
      });
      await ticket.save();
      ticketIds.push(ticket._id);
    }

    // Update the event — decrement available tickets and add to revenue
    const event = await Event.findById(eventId);
    if (event) {
      event.ticketsAvailable = Math.max(0, event.ticketsAvailable - qty);
      event.totalRevenue += amountPaid;
      await event.save();
    }

    // Redirect to frontend confirmation page with the first ticket (they'll all have same paymentId)
    // Stripe has already emailed the receipt to the customer automatically.
    res.redirect(`${process.env.FRONT_END_URL}order-confirmation?session_id=${session_id}&ticket_id=${ticketIds[0]}`);
  } catch (err) {
    console.error("Stripe success handler error:", err);
    res.status(500).json({ error: "Failed to process payment confirmation" });
  }
});

// ─── GET /payments/session/:sessionId ────────────────────────────────────────
// Called by the frontend confirmation page to display order details.
// The frontend can't read Stripe session data directly, so it asks our
// backend to fetch it and return the relevant fields.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/session/:sessionId", async (req, res) => {
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
});

module.exports = router;