const Ticket = require("../models/Ticket");
const Event = require("../models/Event");
const { isStaff, isTicketOwner } = require("../utils/authUtils");

// POST /tickets — admin/moderator direct purchase (bypasses Stripe)
exports.buyTicket = async (req, res) => {
  try {
    const { eventId, buyerEmail } = req.body;
    const userId = req.user ? req.user.id : null;

    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }
    if (event.ticketsAvailable <= 0) {
      return res.status(400).json({ error: "Tickets sold out" });
    }

    const ticket = new Ticket({ eventId, buyerEmail, user: userId });
    await ticket.save();

    event.ticketsAvailable -= 1;
    await event.save();

    res.status(201).json(ticket);
  } catch (error) {
    console.error("Error buying ticket:", error);
    res.status(500).json({ error: "Failed to create ticket" });
  }
};

// GET /tickets — aggregated ticket stats (admin/moderator)
exports.getAllTickets = async (req, res) => {
  try {
    const results = await Ticket.aggregate([
      {
        $lookup: {
          from: "events",
          localField: "eventId",
          foreignField: "_id",
          as: "event",
        },
      },
      { $unwind: "$event" },
      {
        $group: {
          _id: "$event._id",
          title: { $first: "$event.title" },
          ticketPrice: { $first: "$event.ticketPrice" },
          ticketsSold: {
            $sum: { $cond: [{ $eq: ["$status", "paid"] }, 1, 0] },
          },
          ticketsCanceled: {
            $sum: {
              $cond: [{ $in: ["$status", ["failed", "canceled"]] }, 1, 0],
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          title: 1,
          ticketsSold: 1,
          ticketsCanceled: 1,
          totalRevenue: {
            $round: [{ $multiply: ["$ticketsSold", "$ticketPrice"] }, 2],
          },
        },
      },
      { $sort: { title: 1 } },
    ]);
    res.json(results);
  } catch (error) {
    console.error("Error fetching tickets:", error);
    res.status(500).json({ error: "Failed to fetch tickets" });
  }
};

// GET /tickets/by-payment/:paymentId — owner or staff
exports.getTicketsByPayment = async (req, res) => {
  try {
    const tickets = await Ticket.find({ paymentId: req.params.paymentId })
      .populate(
        "eventId",
        "title date street city postCode images ticketPrice typeOfEvent openingTime"
      )
      .populate("user", "name email");

    if (!tickets.length) return res.status(404).json({ message: "No tickets found" });

    if (!isTicketOwner(req.user, tickets[0]) && !isStaff(req.user)) {
      return res.status(403).json({ message: "Access denied" });
    }

    res.json(tickets);
  } catch (err) {
    console.error("Error fetching tickets by payment:", err);
    res.status(500).json({ message: "Failed to fetch tickets" });
  }
};

// GET /tickets/verify/:ticketCode — admin/moderator
exports.verifyTicket = async (req, res) => {
  try {
    const ticket = await Ticket.findOne({ ticketCode: req.params.ticketCode })
      .populate("eventId", "title date openingTime street city images")
      .populate("user", "name");

    if (!ticket) return res.status(404).json({ message: "Ticket not found" });
    res.json(ticket);
  } catch (err) {
    console.error("Error verifying ticket:", err);
    res.status(500).json({ message: "Failed to verify ticket" });
  }
};

// POST /tickets/verify/:ticketCode/checkin — admin/moderator
exports.checkInTicket = async (req, res) => {
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
    res.status(500).json({ message: "Failed to check in ticket" });
  }
};

// GET /tickets/:id — owner or staff
exports.getTicketById = async (req, res) => {
  try {
    const ticket = await Ticket.findById(req.params.id)
      .populate(
        "eventId",
        "title date street city postCode images ticketPrice typeOfEvent openingTime"
      )
      .populate("user", "name email");

    if (!ticket) return res.status(404).json({ message: "Ticket not found" });

    if (!isTicketOwner(req.user, ticket) && !isStaff(req.user)) {
      return res.status(403).json({ message: "Access denied" });
    }

    res.json(ticket);
  } catch (err) {
    console.error("Error fetching ticket:", err);
    res.status(500).json({ message: "Failed to fetch ticket" });
  }
};
