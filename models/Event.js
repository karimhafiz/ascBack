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
  images: { type: [String] }, // Array of image paths
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
});

module.exports = mongoose.model("Event", eventSchema);
