const mongoose = require("mongoose");

const venueSlotSchema = new mongoose.Schema(
  {
    venue: { type: mongoose.Schema.Types.ObjectId, ref: "Venue", required: true },
    date: { type: Date, required: true },
    startTime: { type: String, required: true }, // e.g. "09:00"
    endTime: { type: String, required: true }, // e.g. "13:00"
    isAvailable: { type: Boolean, default: true },
    source: { type: String, enum: ["manual", "schedule"], default: "manual" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

venueSlotSchema.index({ venue: 1, date: 1, startTime: 1 }, { unique: true });
venueSlotSchema.index({ venue: 1, date: 1, isAvailable: 1 });

module.exports = mongoose.model("VenueSlot", venueSlotSchema);
