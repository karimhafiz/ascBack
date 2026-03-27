const mongoose = require("mongoose");

const courseEnrollmentSchema = new mongoose.Schema(
  {
    courseId: { type: mongoose.Schema.Types.ObjectId, ref: "Course", required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    buyerEmail: { type: String, required: true },
    buyerName: { type: String },
    paymentId: { type: String },
    pendingSessionId: { type: String },
    status: {
      type: String,
      enum: ["pending", "paid", "free", "active", "cancelled", "past_due"],
      default: "paid",
    },
    subscriptionId: { type: String },
    subscriptionStatus: {
      type: String,
      enum: ["active", "cancelled", "past_due", null],
      default: null,
    },
    currentPeriodEnd: { type: Date },
    participants: [
      {
        name: { type: String, required: true },
        age: { type: Number },
        email: { type: String },
      },
    ],
  },
  { timestamps: true }
);

// Prevent duplicate active enrollments for the same email + course at the DB level.
// The partial filter means the constraint only applies to non-cancelled/non-pending records.
courseEnrollmentSchema.index(
  { courseId: 1, buyerEmail: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ["paid", "free", "active", "past_due"] } },
  }
);

module.exports = mongoose.model("CourseEnrollment", courseEnrollmentSchema);
