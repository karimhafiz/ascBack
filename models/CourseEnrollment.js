const mongoose = require("mongoose");

const courseEnrollmentSchema = new mongoose.Schema(
  {
    courseId: { type: mongoose.Schema.Types.ObjectId, ref: "Course", required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    buyerEmail: { type: String, required: true },
    buyerName: { type: String },
    paymentId: { type: String },
    status: { type: String, enum: ["paid", "free", "active", "cancelled", "past_due"], default: "paid" },
    subscriptionId: { type: String },       // Stripe subscription ID
    subscriptionStatus: { type: String },   // active / cancelled / past_due
    currentPeriodEnd: { type: Date },       // when current paid period ends
    participants: [
      {
        name: { type: String, required: true },
        age: { type: Number },
        email: { type: String },
      }
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model("CourseEnrollment", courseEnrollmentSchema);