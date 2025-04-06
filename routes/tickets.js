const express = require("express");
const router = express.Router();
const Ticket = require("../models/Ticket");
const Event = require("../models/Event");

// Buy a ticket
router.post("/", async (req, res) => {
  const { eventId, buyerEmail } = req.body;

  const event = await Event.findById(eventId);
  if (!event || event.ticketsAvailable <= 0) {
    return res
      .status(400)
      .json({ message: "Tickets sold out or event not found" });
  }

  const ticket = new Ticket({ eventId, buyerEmail });
  await ticket.save();

  event.ticketsAvailable -= 1;
  await event.save();

  res.status(201).json(ticket);
});

// Fetch all tickets with event details
router.get("/", async (req, res) => {
  try {
    // Fetch tickets and populate the eventId field with event details
    const tickets = await Ticket.find().populate("eventId");

    // Aggregate ticket data by event
    const aggregatedData = tickets.reduce((acc, ticket) => {
      const event = ticket.eventId; // Populated event details
      if (!event) return acc; // Skip if event is not found

      if (!acc[event._id]) {
        acc[event._id] = {
          title: event.title,
          ticketsSold: 0,
          ticketsCanceled: 0,
          totalRevenue: 0, // Initialize total revenue
        };
      }

      if (ticket.status === "paid") {
        acc[event._id].ticketsSold += 1;
        acc[event._id].totalRevenue += event.ticketPrice; // Calculate revenue dynamically
      } else if (ticket.status === "failed" || ticket.status === "canceled") {
        acc[event._id].ticketsCanceled += 1;
      }

      return acc;
    }, {});

    // Convert aggregated data to an array and round totalRevenue
    const aggregatedArray = Object.values(aggregatedData).map((event) => ({
      ...event,
      totalRevenue: parseFloat(event.totalRevenue.toFixed(2)), // Round to 2 decimal places
    }));

    res.json(aggregatedArray);
  } catch (error) {
    console.error("Error fetching tickets:", error);
    res.status(500).json({ error: "Failed to fetch tickets" });
  }
});

module.exports = router;
