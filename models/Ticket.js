const mongoose = require("mongoose");

function generateTicketCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous I/O/0/1
  let code = "TKT-";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

const ticketSchema = new mongoose.Schema(
  {
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event" },
    buyerEmail: { type: String },
    status: { type: String, default: "pending" },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    paymentId: { type: String }, // Stripe session ID — used for grouping bulk purchase tickets
    ticketCode: { type: String, unique: true, sparse: true }, // TKT-XXXXXX
    checkedIn: { type: Boolean, default: false },
    checkedInAt: { type: Date },
  },
  { timestamps: true }
);

// Auto-generate ticketCode before saving if not already set
ticketSchema.pre("save", async function (next) {
  if (this.ticketCode) return next();
  const maxAttempts = 10;
  let code, exists;
  let attempts = 0;
  do {
    if (attempts >= maxAttempts) {
      return next(new Error("Failed to generate unique ticket code"));
    }
    code = generateTicketCode();
    exists = await mongoose.model("Ticket").findOne({ ticketCode: code });
    attempts++;
  } while (exists);
  this.ticketCode = code;
  next();
});

module.exports = mongoose.model("Ticket", ticketSchema);
