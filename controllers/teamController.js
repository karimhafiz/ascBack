const mongoose = require("mongoose");
const Team = require("../models/Team");
const Event = require("../models/Event");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { sendTeamRegistrationEmail, sendTeamUpdateEmail } = require("../utils/emailUtils");

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

// Sign up a team for an event.
// If an unpaid team already exists for this manager + event, reuse it
// instead of creating a duplicate (handles user going back from Stripe).
exports.signupTeam = async (req, res) => {
  try {
    const { name, members, manager } = req.body;
    const { eventId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(eventId)) {
      return res.status(400).json({ error: "Invalid event ID" });
    }

    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Team name is required" });
    }
    if (!members || !Array.isArray(members) || members.length === 0) {
      return res.status(400).json({ error: "At least one team member is required" });
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

    // Check for an existing unpaid team from this manager for this event
    const existing = await Team.findOne({
      event: eventId,
      "manager.email": manager.email,
      paid: false,
    });

    if (existing) {
      // Update it with fresh details in case they changed anything
      existing.name = name.trim();
      existing.members = members;
      existing.manager = manager;
      await existing.save();
      return res.status(200).json({ message: "Existing team updated", team: existing });
    }

    const team = new Team({
      name: name.trim(),
      members,
      event: eventId,
      manager,
      paid: false,
      paymentId: null,
    });

    await team.save();
    res.status(201).json({ message: "Team signed up successfully", team });
  } catch (error) {
    console.error("Error signing up team:", error);
    res.status(500).json({ error: "Failed to sign up team" });
  }
};

// ─── POST /teams/:teamId/pay ──────────────────────────────────────────────────
// Creates a Stripe Checkout session for a team registration fee.
// cancel_url goes through our backend so we can delete the unpaid team cleanly.
// ─────────────────────────────────────────────────────────────────────────────
exports.processTeamPayment = async (req, res) => {
  try {
    const { teamId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(teamId)) {
      return res.status(400).json({ error: "Invalid team ID" });
    }

    const team = await Team.findById(teamId);
    if (!team) return res.status(404).json({ error: "Team not found" });

    const event = await Event.findById(team.event);
    if (!event) return res.status(404).json({ error: "Event not found" });

    const amount = event.ticketPrice || event.tournamentFee || 50;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      customer_email: team.manager.email,
      line_items: [
        {
          price_data: {
            currency: "gbp",
            product_data: {
              name: `Team Registration — ${event.title}`,
              description: `Team: ${team.name} (${team.members.length} players)`,
            },
            unit_amount: Math.round(amount * 100),
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${process.env.BACK_END_URL}teams/${teamId}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.BACK_END_URL}teams/${teamId}/cancel`,
      metadata: {
        teamId: teamId.toString(),
        eventId: team.event.toString(),
      },
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error("Team payment error:", error);
    res.status(500).json({ error: "Failed to process team payment" });
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

    const team = await Team.findByIdAndUpdate(
      teamId,
      { paid: true, paymentId: session.id },
      { new: true }
    );

    // Send confirmation emails to manager + members in the background
    if (team) {
      const event = await Event.findById(team.event);
      if (event) {
        sendTeamRegistrationEmail({ team, event }).catch((err) =>
          console.error("Team registration email error:", err)
        );
      }
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

// List my paid teams for an event (authenticated)
exports.getMyTeamsForEvent = async (req, res) => {
  try {
    const { eventId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(eventId)) {
      return res.status(400).json({ error: "Invalid event ID" });
    }

    const email = req.user.email;
    const teams = await Team.find({ event: eventId, "manager.email": email, paid: true });
    res.json(teams);
  } catch (error) {
    console.error("Error fetching your teams:", error);
    res.status(500).json({ error: "Failed to fetch your teams" });
  }
};

// ─── PUT /teams/:teamId ───────────────────────────────────────────────────────
// Manager can edit their paid team: update name, add/remove/edit members.
// Sends notification emails to new members and the manager about the change.
// ─────────────────────────────────────────────────────────────────────────────
exports.updateTeam = async (req, res) => {
  try {
    const { teamId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(teamId)) {
      return res.status(400).json({ error: "Invalid team ID" });
    }

    const { name, members, manager } = req.body;
    const email = req.user.email;

    const team = await Team.findById(teamId);
    if (!team) return res.status(404).json({ error: "Team not found" });

    // Only the manager can edit
    if (team.manager.email !== email) {
      return res.status(403).json({ error: "Only the team manager can edit this team" });
    }

    if (!team.paid) {
      return res.status(400).json({ error: "Cannot edit an unpaid team" });
    }

    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Team name is required" });
    }
    if (!members || !Array.isArray(members) || members.length === 0) {
      return res.status(400).json({ error: "At least one team member is required" });
    }

    // Track which members are new (for email notifications)
    const oldEmails = new Set(team.members.map((m) => m.email?.toLowerCase()).filter(Boolean));
    const newMembers = members.filter((m) => m.email && !oldEmails.has(m.email.toLowerCase()));

    team.name = name.trim();
    team.members = members;

    // Update manager name and phone (email stays the same)
    if (manager) {
      if (manager.name) team.manager.name = manager.name.trim();
      if (manager.phone) team.manager.phone = manager.phone.trim();
    }

    await team.save();

    // Send update emails in the background
    const event = await Event.findById(team.event);
    if (event) {
      sendTeamUpdateEmail({ team, event, newMembers }).catch((err) =>
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
    const fromatedTeams = teams.map((team) => ({
      // _id: team._id,
      name: team.name,
      managerName: team.manager ? team.manager.name : "N/A",
    }));

    res.json(fromatedTeams);
  } catch (error) {
    console.error("Error fetching teams:", error);
    res.status(500).json({ error: "Failed to fetch teams" });
  }
};
