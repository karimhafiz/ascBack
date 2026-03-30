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
    isSubscription: { type: Boolean, default: false },
    billingInterval: {
      type: String,
      enum: ["month", "year"],
      default: "month",
    },
    // Both fields are set together when a Stripe subscription product is created.
    // Either both are set or neither; one without the other is invalid state.
    stripeProductId: { type: String, default: null },
    stripePriceId: { type: String, default: null },
    featured: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  {
    timestamps: true,
    validate: {
      validator: function () {
        const hasProduct = !!this.stripeProductId;
        const hasPrice = !!this.stripePriceId;
        return hasProduct === hasPrice;
      },
      message: "stripeProductId and stripePriceId must both be set or both be null",
    },
  }
);

// Indexes for common query patterns
courseSchema.index({ featured: 1 });
courseSchema.index({ category: 1 });

module.exports = mongoose.model("Course", courseSchema);
