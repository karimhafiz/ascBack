const mongoose = require("mongoose");
const Team = require("../models/Team");
const Event = require("../models/Event");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { sendTeamRegistrationEmail, sendTeamUpdateEmail } = require("../utils/emailUtils");
const { generateUniqueCode } = require("../utils/ticketUtils");

// Get a single team by ID
exports.getTeam = async (req, res) => {
  try {
    const { teamId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(teamId)) {
      return res.status(400).json({ error: "Invalid team ID" });
    }

    const team = await Team.findById(teamId);
    if (!team) return res.status(404).json({ error: "Team not found" });
    res.json({ team });
  } catch (error) {
    console.error("Error fetching team:", error);
    res.status(500).json({ error: "Failed to fetch team" });
  }
};

// ─── POST /teams/event/:eventId/register ─────────────────────────────────────
// Single endpoint: validate → upsert team → if free mark paid, else Stripe checkout.
// Replaces the old signupTeam + processTeamPayment two-step flow.
// ─────────────────────────────────────────────────────────────────────────────
exports.registerTeam = async (req, res) => {
  try {
    const { name, manager } = req.body;
    const { eventId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(eventId)) {
      return res.status(400).json({ error: "Invalid event ID" });
    }

    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Team name is required" });
    }
    if (!manager || !manager.name || !manager.name.trim()) {
      return res.status(400).json({ error: "Manager name is required" });
    }
    if (!manager.email || !manager.email.trim()) {
      return res.status(400).json({ error: "Manager email is required" });
    }
    if (!manager.phone || !manager.phone.trim()) {
      return res.status(400).json({ error: "Manager phone number is required" });
    }

    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ error: "Event not found" });
    if (!event.isTournament) {
      return res.status(400).json({ error: "This event does not accept team registrations" });
    }

    // Upsert: find existing unpaid team for this manager + event, or create new
    const teamCode = await generateUniqueCode("TEAM", Team, "teamCode");
    const team = await Team.findOneAndUpdate(
      { event: eventId, "manager.email": manager.email, paid: false },
      {
        $set: {
          name: name.trim(),
          manager,
          paid: false,
        },
        $setOnInsert: { teamCode },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    // Free tournament — mark paid immediately and send email
    const amount = event.ticketPrice || 0;
    if (amount === 0) {
      team.paid = true;
      await team.save();

      sendTeamRegistrationEmail({ team, event }).catch((err) =>
        console.error("Team registration email error:", err)
      );

      return res.json({ message: "Team registered successfully", team });
    }

    // Paid tournament — create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      customer_email: team.manager.email,
      line_items: [
        {
          price_data: {
            currency: "gbp",
            product_data: {
              name: `Team Registration — ${event.title}`,
              description: `Team: ${team.name}`,
            },
            unit_amount: Math.round(amount * 100),
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${process.env.BACK_END_URL}teams/${team._id}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.BACK_END_URL}teams/${team._id}/cancel`,
      metadata: {
        teamId: team._id.toString(),
        eventId: eventId.toString(),
      },
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error("Team registration error:", error);
    res.status(500).json({ error: "Failed to register team" });
  }
};

// ─── GET /teams/:teamId/payment-success ───────────────────────────────────────
// Stripe redirects here after successful payment.
// Verifies the session, marks team as paid, then sends user to confirmation page.
// ─────────────────────────────────────────────────────────────────────────────
exports.handlePaymentSuccess = async (req, res) => {
  const { teamId } = req.params;
  const { session_id } = req.query;

  if (!session_id) {
    return res.redirect(`${process.env.FRONT_END_URL}events`);
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);

    if (session.payment_status !== "paid") {
      return res.redirect(`${process.env.FRONT_END_URL}events`);
    }

    // Atomic: only flip unpaid → paid (idempotent on refresh)
    const team = await Team.findOneAndUpdate(
      { _id: teamId, paid: false },
      { paid: true, paymentId: session.id },
      { new: true }
    );

    if (!team) {
      // Already paid (page refresh) — just redirect, no duplicate email
      return res.redirect(`${process.env.FRONT_END_URL}team-confirmation?teamId=${teamId}`);
    }

    // Send confirmation emails in the background
    const event = await Event.findById(team.event);
    if (event) {
      sendTeamRegistrationEmail({ team, event }).catch((err) =>
        console.error("Team registration email error:", err)
      );
    }

    res.redirect(`${process.env.FRONT_END_URL}team-confirmation?teamId=${teamId}`);
  } catch (error) {
    console.error("Team payment success error:", error);
    res.redirect(`${process.env.FRONT_END_URL}events`);
  }
};

// ─── GET /teams/:teamId/cancel ────────────────────────────────────────────────
// Stripe redirects here when user clicks "Back" on the Stripe page.
// Deletes the unpaid team so it doesn't linger in the DB, then sends the
// user back to the event page to try again if they want.
// ─────────────────────────────────────────────────────────────────────────────
exports.cancelTeamPayment = async (req, res) => {
  const { teamId } = req.params;

  try {
    const team = await Team.findById(teamId);
    if (team && !team.paid) {
      const eventId = team.event;
      await Team.findByIdAndDelete(teamId);
      return res.redirect(`${process.env.FRONT_END_URL}events/${eventId}`);
    }
    // If team is already paid (shouldn't happen), just redirect home
    res.redirect(`${process.env.FRONT_END_URL}events`);
  } catch (error) {
    console.error("Team cancel error:", error);
    res.redirect(`${process.env.FRONT_END_URL}events`);
  }
};

// Get unpaid teams for a specific manager on an event
exports.getUnpaidTeamsForManager = async (req, res) => {
  try {
    const { eventId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(eventId)) {
      return res.status(400).json({ error: "Invalid event ID" });
    }

    const email = req.user.email;

    const teams = await Team.find({
      event: eventId,
      "manager.email": email,
      paid: false,
    });
    res.json({ teams });
  } catch (error) {
    console.error("Error fetching unpaid teams:", error);
    res.status(500).json({ error: "Failed to fetch unpaid teams" });
  }
};

// ─── PUT /teams/:teamId ───────────────────────────────────────────────────────
// Manager can edit their team: update name and manager details.
// ─────────────────────────────────────────────────────────────────────────────
exports.updateTeam = async (req, res) => {
  try {
    const { teamId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(teamId)) {
      return res.status(400).json({ error: "Invalid team ID" });
    }

    const { name, manager } = req.body;
    const email = req.user.email;

    const team = await Team.findById(teamId);
    if (!team) return res.status(404).json({ error: "Team not found" });

    // Only the manager can edit
    if (team.manager.email !== email) {
      return res.status(403).json({ error: "Only the team manager can edit this team" });
    }

    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Team name is required" });
    }

    team.name = name.trim();

    // Update manager name and phone (email stays the same)
    if (manager) {
      if (manager.name) team.manager.name = manager.name.trim();
      if (manager.phone) team.manager.phone = manager.phone.trim();
    }

    await team.save();

    // Send update email in the background
    const event = await Event.findById(team.event);
    if (event) {
      sendTeamUpdateEmail({ team, event }).catch((err) =>
        console.error("Team update email error:", err)
      );
    }

    res.json({ message: "Team updated successfully", team });
  } catch (error) {
    console.error("Update team error:", error);
    res.status(500).json({ error: "Failed to update team" });
  }
};

// List all paid teams for an event
exports.getTeamsForEvent = async (req, res) => {
  try {
    const { eventId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(eventId)) {
      return res.status(400).json({ error: "Invalid event ID" });
    }

    const teams = await Team.find({ event: eventId, paid: true });
    const formattedTeams = teams.map((team) => ({
      _id: team._id,
      name: team.name,
      paid: true,
      manager: { name: team.manager?.name || "N/A", email: team.manager?.email },
    }));

    res.json(formattedTeams);
  } catch (error) {
    console.error("Error fetching teams:", error);
    res.status(500).json({ error: "Failed to fetch teams" });
  }
};
