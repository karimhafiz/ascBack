const express = require("express");
const router = express.Router();
const Ticket = require("../models/Ticket");
const Event = require("../models/Event");
const authenticateToken = require("../middleware/authMiddleware");

// Buy a ticket
router.post("/", authenticateToken, async (req, res) => {
  const { eventId, buyerEmail } = req.body;
  const userId = req.user ? req.user.id : null;

  const event = await Event.findById(eventId);
  if (!event || event.ticketsAvailable <= 0) {
    return res.status(400).json({ message: "Tickets sold out or event not found" });
  }

  const ticket = new Ticket({ eventId, buyerEmail, user: userId });
  await ticket.save();

  event.ticketsAvailable -= 1;
  await event.save();

  res.status(201).json(ticket);
});

// Fetch all tickets (aggregated)
router.get("/", async (req, res) => {
  try {
    const tickets = await Ticket.find().populate("eventId");

    const aggregatedData = tickets.reduce((acc, ticket) => {
      const event = ticket.eventId;
      if (!event) return acc;

      if (!acc[event._id]) {
        acc[event._id] = {
          title: event.title,
          ticketsSold: 0,
          ticketsCanceled: 0,
          totalRevenue: 0,
        };
      }

      if (ticket.status === "paid") {
        acc[event._id].ticketsSold += 1;
        acc[event._id].totalRevenue += event.ticketPrice;
      } else if (ticket.status === "failed" || ticket.status === "canceled") {
        acc[event._id].ticketsCanceled += 1;
      }

      return acc;
    }, {});

    const aggregatedArray = Object.values(aggregatedData).map((event) => ({
      ...event,
      totalRevenue: parseFloat(event.totalRevenue.toFixed(2)),
    }));

    res.json(aggregatedArray);
  } catch (error) {
    console.error("Error fetching tickets:", error);
    res.status(500).json({ error: "Failed to fetch tickets" });
  }
});

// GET /tickets/by-payment/:paymentId — fetch all tickets for a payment, auth required
router.get("/by-payment/:paymentId", authenticateToken, async (req, res) => {
  try {
    const tickets = await Ticket.find({ paymentId: req.params.paymentId })
      .populate("eventId", "title date street city postCode images ticketPrice typeOfEvent openingTime")
      .populate("user", "name email");

    if (!tickets.length) return res.status(404).json({ message: "No tickets found" });

    const requestingUser = req.user;
    const first = tickets[0];
    const isOwner = first.buyerEmail === requestingUser.email ||
                    first.user?._id?.toString() === requestingUser.id;
    const isStaff = requestingUser.role === "admin" || requestingUser.role === "moderator";

    if (!isOwner && !isStaff) {
      return res.status(403).json({ message: "Access denied" });
    }

    res.json(tickets);
  } catch (err) {
    console.error("Error fetching tickets by payment:", err);
    res.status(500).json({ message: err.message });
  }
});

// GET /tickets/:id — fetch a single ticket by _id, auth required (owner only)
router.get("/:id", authenticateToken, async (req, res) => {
  try {
    const ticket = await Ticket.findById(req.params.id)
      .populate("eventId", "title date street city postCode images ticketPrice typeOfEvent openingTime")
      .populate("user", "name email");

    if (!ticket) return res.status(404).json({ message: "Ticket not found" });

    const requestingUser = req.user;
    const isOwner = ticket.buyerEmail === requestingUser.email ||
                    ticket.user?._id?.toString() === requestingUser.id;
    const isStaff = requestingUser.role === "admin" || requestingUser.role === "moderator";

    if (!isOwner && !isStaff) {
      return res.status(403).json({ message: "Access denied" });
    }

    res.json(ticket);
  } catch (err) {
    console.error("Error fetching ticket:", err);
    res.status(500).json({ message: err.message });
  }
});

// PUBLIC: GET /tickets/verify/:ticketCode
router.get("/verify/:ticketCode", async (req, res) => {
  try {
    const ticket = await Ticket.findOne({ ticketCode: req.params.ticketCode })
      .populate("eventId", "title date openingTime street city images")
      .populate("user", "name");

    if (!ticket) return res.status(404).json({ message: "Ticket not found" });
    res.json(ticket);
  } catch (err) {
    console.error("Error verifying ticket:", err);
    res.status(500).json({ message: err.message });
  }
});

// PUBLIC: POST /tickets/verify/:ticketCode/checkin
router.post("/verify/:ticketCode/checkin", async (req, res) => {
  try {
    const ticket = await Ticket.findOne({ ticketCode: req.params.ticketCode });
    if (!ticket) return res.status(404).json({ message: "Ticket not found" });

    const wasAlreadyCheckedIn = ticket.checkedIn;
    const originalCheckedInAt = ticket.checkedInAt;

    if (!ticket.checkedIn) {
      ticket.checkedIn = true;
      ticket.checkedInAt = new Date();
    }

    await ticket.save();
    await ticket.populate("eventId", "title date openingTime street city images");
    await ticket.populate("user", "name");

    const response = ticket.toObject();
    response.wasAlreadyCheckedIn = wasAlreadyCheckedIn;
    response.originalCheckedInAt = originalCheckedInAt;

    res.json(response);
  } catch (err) {
    console.error("Error checking in ticket:", err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;