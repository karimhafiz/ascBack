const mongoose = require("mongoose");

const eventSubscriptionSchema = new mongoose.Schema(
  {
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    buyerEmail: { type: String, required: true },
    paymentId: { type: String },
    pendingSessionId: { type: String },
    status: {
      type: String,
      enum: ["pending", "active", "cancelled", "past_due"],
      default: "pending",
    },
    subscriptionId: { type: String },
    subscriptionStatus: {
      type: String,
      enum: ["active", "trialing", "cancelled", "past_due", null],
      default: null,
    },
    currentPeriodEnd: { type: Date },
    lastStripeEventTimestamp: { type: Number, default: null },
    quantity: { type: Number, default: 1 },
    // Cumulative — incremented on the initial checkout and every renewal invoice.
    totalAmountPaid: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Prevent duplicate active subscriptions for the same email + event at the DB level.
// The partial filter means the constraint only applies to active/past_due records.
eventSubscriptionSchema.index(
  { eventId: 1, buyerEmail: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ["active", "past_due"] } },
  }
);

module.exports = mongoose.model("EventSubscription", eventSubscriptionSchema);
