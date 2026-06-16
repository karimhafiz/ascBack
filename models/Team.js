const mongoose = require("mongoose");

const teamSchema = new mongoose.Schema(
  {
    teamCode: { type: String, unique: true, sparse: true },
    name: { type: String, required: true },
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
