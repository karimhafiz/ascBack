const mongoose = require("mongoose");
const { generateUniqueTicketCode } = require("../utils/ticketUtils");

const ticketSchema = new mongoose.Schema(
  {
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event" },
    buyerEmail: { type: String },
    // No default — a ticket must never come into existence except by a call
    // site explicitly asserting payment succeeded (checkout success handler
    // or staff manual issuance). Omitting it is a bug and should fail loudly.
    status: { type: String, enum: ["paid"], required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    paymentId: { type: String }, // Stripe session ID — used for grouping bulk purchase tickets
    totalAmountPaid: { type: Number, default: 0 }, // this ticket's share of the purchase
    ticketCode: { type: String, unique: true, sparse: true }, // TKT-XXXXXX
    checkedIn: { type: Boolean, default: false },
    checkedInAt: { type: Date },
  },
  { timestamps: true }
);

// Indexes for lookup patterns used in routes
ticketSchema.index({ paymentId: 1 });
ticketSchema.index({ eventId: 1 });
ticketSchema.index({ buyerEmail: 1 });

// Assign a unique ticket code before saving if one hasn't been set yet.
// Delegates to ticketUtils so the generation logic is testable in isolation.
ticketSchema.pre("save", async function (next) {
  if (this.ticketCode) return next();
  try {
    this.ticketCode = await generateUniqueTicketCode(mongoose.model("Ticket"));
    next();
  } catch (err) {
    next(err);
  }
});

module.exports = mongoose.model("Ticket", ticketSchema);
