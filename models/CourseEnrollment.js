const mongoose = require("mongoose");

const courseEnrollmentSchema = new mongoose.Schema(
  {
    courseId: { type: mongoose.Schema.Types.ObjectId, ref: "Course", required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    buyerEmail: { type: String, required: true },
    buyerName: { type: String },
    paymentId: { type: String },
    status: { type: String, enum: ["paid", "free"], default: "paid" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("CourseEnrollment", courseEnrollmentSchema);