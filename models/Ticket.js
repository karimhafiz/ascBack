const mongoose = require("mongoose");

const ticketSchema = new mongoose.Schema({
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event" },
  buyerEmail: String,
  status: { type: String, default: "pending" },
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
});

module.exports = mongoose.model("Ticket", ticketSchema);
