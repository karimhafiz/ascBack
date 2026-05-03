const mongoose = require("mongoose");

const venueSlotSchema = new mongoose.Schema(
  {
    venue: { type: mongoose.Schema.Types.ObjectId, ref: "Venue", required: true },
    date: { type: Date, required: true }, // Date of the slot
    startTime: { type: String, required: true }, // e.g., "09:00"
    endTime: { type: String, required: true }, // Automatically 4 hours after startTime
    isAvailable: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // Admin who created the slot
  },
  { timestamps: true }
);

// Index for efficient slot queries
venueSlotSchema.index({ venue: 1, date: 1, startTime: 1 }, { unique: true });
venueSlotSchema.index({ isAvailable: 1 });

module.exports = mongoose.model("VenueSlot", venueSlotSchema);
