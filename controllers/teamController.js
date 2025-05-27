const Team = require("../models/Team");
const Event = require("../models/Event");
const paypal = require("paypal-rest-sdk");
require("dotenv").config();

// Configure PayPal
paypal.configure({
  mode: "sandbox", // Change to 'live' for real transactions
  client_id: process.env.PAYPAL_CLIENT_ID,
  client_secret: process.env.PAYPAL_SECRET,
});

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
      return res
        .status(400)
        .json({ error: "Team name and members are required" });
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

// Process payment for a team
exports.processTeamPayment = async (req, res) => {
  try {
    const { teamId } = req.params;

    // Find the team
    const team = await Team.findById(teamId);
    if (!team) {
      return res.status(404).json({ error: "Team not found" });
    }

    // Find the associated event to get the price
    const event = await Event.findById(team.event);
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    // Ensure the event has a tournament fee defined
    const amount = event.tournamentFee || 50; // Default to 50 if not set

    // Set up PayPal payment
    const paymentData = {
      intent: "sale",
      payer: { payment_method: "paypal" },
      redirect_urls: {
        return_url: `${
          process.env.FRONT_END_URL
        }success?teamId=${teamId}&email=${encodeURIComponent(
          team.manager.email
        )}`,
        cancel_url: `${process.env.FRONT_END_URL}cancel`,
      },
      transactions: [
        {
          amount: { total: amount.toFixed(2), currency: "GBP" },
          description: `Team registration fee for ${team.name} at ${event.title}`,
        },
      ],
    };

    paypal.payment.create(paymentData, (error, payment) => {
      if (error) {
        console.error("PayPal Payment Creation Error:", error);
        return res.status(500).json({ error: error.message });
      } else {
        // Find the approval URL and send it back
        const approvalLink = payment.links.find(
          (l) => l.rel === "approval_url"
        );
        res.json({
          link: approvalLink.href,
        });
      }
    });
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
