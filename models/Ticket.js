const mongoose = require("mongoose");

const ticketSchema = new mongoose.Schema({
  eventId:    { type: mongoose.Schema.Types.ObjectId, ref: "Event" },
  buyerEmail: { type: String },
  status:     { type: String, default: "pending" },
  user:       { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  paymentId:  { type: String },        // Stripe session ID — used for idempotency checks
  quantity:   { type: Number, default: 1 },
}, { timestamps: true });

module.exports = mongoose.model("Ticket", ticketSchema);