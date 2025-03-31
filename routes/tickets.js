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

// Get all tickets
router.get("/", async (req, res) => {
  const tickets = await Ticket.find().populate("eventId");
  res.json(tickets);
});

module.exports = router;
