const mongoose = require("mongoose");

function generateTicketCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous I/O/0/1
  let code = "TKT-";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

const ticketSchema = new mongoose.Schema({
  eventId:    { type: mongoose.Schema.Types.ObjectId, ref: "Event" },
  buyerEmail: { type: String },
  status:     { type: String, default: "pending" },
  user:       { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  paymentId:  { type: String }, // Stripe session ID — used for idempotency checks
  quantity:   { type: Number, default: 1 },
  ticketCode: { type: String, unique: true, sparse: true }, // TKT-XXXXXX
}, { timestamps: true });

// Auto-generate ticketCode before saving if not already set
ticketSchema.pre("save", async function (next) {
  if (this.ticketCode) return next();
  let code, exists;
  do {
    code = generateTicketCode();
    exists = await mongoose.model("Ticket").findOne({ ticketCode: code });
  } while (exists);
  this.ticketCode = code;
  next();
});

module.exports = mongoose.model("Ticket", ticketSchema);