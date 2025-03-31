const mongoose = require("mongoose");

const ticketSchema = new mongoose.Schema({
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event" },
  buyerEmail: String,
  status: { type: String, default: "pending" },
});

module.exports = mongoose.model("Ticket", ticketSchema);
