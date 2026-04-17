const mongoose = require("mongoose");

const teamSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    members: [
      {
        name: { type: String, required: true },
        email: { type: String },
      },
    ],
    event: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true },
    manager: {
      name: { type: String, required: true },
      email: { type: String, required: true },
      phone: { type: String, required: true },
    },
    paid: { type: Boolean, default: false },
    paymentId: { type: String },
  },
  { timestamps: true }
);

// Indexes for common lookup patterns
teamSchema.index({ event: 1 });
teamSchema.index({ "manager.email": 1 });

module.exports = mongoose.model("Team", teamSchema);
