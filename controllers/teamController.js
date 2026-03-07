const Team = require("../models/Team");
const Event = require("../models/Event");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
require("dotenv").config();

// Get a single team by ID
exports.getTeam = async (req, res) => {
  try {
    const { teamId } = req.params;
    const team = await Team.findById(teamId);
    if (!team) {
      return res.status(404).json({ error: "Team not found" });
    }
    res.json({ team });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Sign up a team for an event
exports.signupTeam = async (req, res) => {
  try {
    const { name, members, manager, paymentId } = req.body;
    const { eventId } = req.params;

    if (!name || !members || !Array.isArray(members) || members.length === 0) {
      return res.status(400).json({ error: "Team name and members are required" });
    }

    const team = new Team({
      name,
      members,
      event: eventId,
      manager,
      paid: !!paymentId,
      paymentId: paymentId || null,
    });

    await team.save();
    res.status(201).json({ message: "Team signed up successfully", team });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ─── POST /teams/:teamId/pay ──────────────────────────────────────────────────
// Creates a Stripe Checkout session for a team registration fee.
// Same flow as ticket payments — redirects to Stripe's hosted page.
// On success, Stripe redirects to team-confirmation with the session ID.
// ─────────────────────────────────────────────────────────────────────────────
exports.processTeamPayment = async (req, res) => {
  try {
    const { teamId } = req.params;

    const team = await Team.findById(teamId);
    if (!team) {
      return res.status(404).json({ error: "Team not found" });
    }

    const event = await Event.findById(team.event);
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    const amount = event.tournamentFee || 50; // default £50 if not set

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      customer_email: team.manager.email,
      line_items: [
        {
          price_data: {
            currency: "gbp",
            product_data: {
              name: `Team Registration — ${event.title}`,
              description: `Team: ${team.name}`,
            },
            unit_amount: Math.round(amount * 100), // pence
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${process.env.FRONT_END_URL}team-confirmation?session_id={CHECKOUT_SESSION_ID}&teamId=${teamId}`,
      cancel_url: `${process.env.FRONT_END_URL}events/${team.event}`,
      metadata: {
        teamId: teamId.toString(),
        eventId: team.event.toString(),
      },
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error("Team payment error:", error);
    res.status(500).json({ error: error.message });
  }
};

// List all paid teams for an event
exports.getTeamsForEvent = async (req, res) => {
  try {
    const { eventId } = req.params;
    const teams = await Team.find({ event: eventId, paid: true });
    res.json(teams);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};