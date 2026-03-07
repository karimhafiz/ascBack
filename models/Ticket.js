const mongoose = require("mongoose");

const ticketSchema = new mongoose.Schema({
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event" },
  buyerEmail: String,
  paymentId: { type: String },  // ← add this
  status: { type: String, default: "pending" },
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  quantity: { type: Number, default: 1 },  // ← add this
});

module.exports = mongoose.model("Ticket", ticketSchema);
