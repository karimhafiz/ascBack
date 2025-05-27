const mongoose = require("mongoose");

const eventSchema = new mongoose.Schema({
  title: { type: String, required: true },
  shortDescription: { type: String, required: true },
  longDescription: { type: String, required: true },
  date: { type: Date, required: true },
  openingTime: { type: String },
  street: { type: String, required: true },
  postCode: { type: String },
  city: { type: String, required: true },
  ageRestriction: { type: String },
  accessibilityInfo: { type: String },
  ticketPrice: { type: Number, required: true },
  images: { type: [String] },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
  totalRevenue: { type: Number, default: 0 },
  featured: { type: Boolean, default: false },
  isReoccurring: { type: Boolean, default: false },
  reoccurringFrequency: { type: String },
  reoccurringEndDate: { type: Date },
  reoccurringStartDate: { type: Date },
  reoccurringFrequency: { type: String },
  dayOfWeek: {
    type: String,
    enum: [
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday",
    ],
    default: null,
  }, // Add dayOfWeek field
  typeOfEvent: {
    type: String,
    enum: ["Sports", "ASC"],
    default: "ASC",
  }, // Add typeOfEvent field
  isTournament: { type: Boolean, default: false },
});

module.exports = mongoose.model("Event", eventSchema);
