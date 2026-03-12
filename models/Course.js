const mongoose = require("mongoose");

const courseSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String, required: true },
    shortDescription: { type: String },
    instructor: { type: String, required: true },
    category: {
      type: String,
      enum: ["Language", "Religious", "Academic", "Arts", "Other"],
      default: "Other",
    },
    price: { type: Number, default: 0 },
    schedule: { type: String }, // e.g. "Every Saturday 10:00 - 12:00"
    street: { type: String },
    city: { type: String },
    postCode: { type: String },
    images: [{ type: String }],
    maxEnrollment: { type: Number },
    currentEnrollment: { type: Number, default: 0 },
    enrollmentOpen: { type: Boolean, default: true },
    featured: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Course", courseSchema);