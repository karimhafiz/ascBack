const mongoose = require("mongoose");

const verificationTokenSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    tokenHash: { type: String, required: true, index: true },
    purpose: {
      type: String,
      enum: ["account_verification", "ticket_resend"],
      required: true,
    },
    used: { type: Boolean, default: false },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { timestamps: true }
);

verificationTokenSchema.index({ email: 1, purpose: 1 });

module.exports = mongoose.model("VerificationToken", verificationTokenSchema);
