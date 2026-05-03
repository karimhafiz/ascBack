const mongoose = require("mongoose");

const venueBookingSchema = new mongoose.Schema(
  {
    venue: { type: mongoose.Schema.Types.ObjectId, ref: "Venue", required: true },
    slot: { type: mongoose.Schema.Types.ObjectId, ref: "VenueSlot", required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    status: {
      type: String,
      enum: ["pending", "confirmed", "completed", "cancelled"],
      default: "pending",
    },
    numberOfAttendees: { type: Number, required: true },
    eventName: { type: String }, // Name of the event/purpose
    eventDescription: { type: String },
    totalPrice: { type: Number, required: true }, // 4-hour rate
    paymentStatus: {
      type: String,
      enum: ["unpaid", "paid", "refunded"],
      default: "unpaid",
    },
    stripePaymentId: { type: String }, // Stripe payment intent ID
    stripeChargeId: { type: String }, // Stripe charge ID
    cancellationReason: { type: String },
    cancelledAt: { type: Date },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // Admin or user who cancelled
    emailSent: { type: Boolean, default: false },
    confirmationEmailSent: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Index for efficient booking queries
venueBookingSchema.index({ user: 1 });
venueBookingSchema.index({ venue: 1, status: 1 });
venueBookingSchema.index({ slot: 1 });
venueBookingSchema.index({ status: 1 });

module.exports = mongoose.model("VenueBooking", venueBookingSchema);
