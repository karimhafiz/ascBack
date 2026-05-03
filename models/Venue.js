const mongoose = require("mongoose");

const venueSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    description: { type: String },
    street: { type: String, required: true },
    postCode: { type: String },
    city: { type: String, required: true },
    capacity: { type: Number, required: true }, // Maximum number of people
    pricePerHour: { type: Number, required: true }, // Price for 4-hour booking
    images: { type: [String] }, // Cloudinary URLs
    amenities: { type: [String] }, // e.g., ["WiFi", "Projector", "Parking"]
    rules: { type: String },
    cancellationPolicy: { type: String },
    isActive: { type: Boolean, default: true },
    managedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // Admin/Moderator
  },
  { timestamps: true }
);

module.exports = mongoose.model("Venue", venueSchema);
