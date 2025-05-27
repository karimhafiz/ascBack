const mongoose = require("mongoose");

const teamSchema = new mongoose.Schema({
  name: { type: String, required: true },
  members: [
    {
      name: { type: String, required: true },
      email: { type: String },
      // Add more fields as needed (e.g., age, position)
    },
  ],
  event: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true },
  manager: {
    name: { type: String, required: true },
    email: { type: String, required: true },
  }, // who signed up
  paid: { type: Boolean, default: false },
  paymentId: { type: String }, // e.g., PayPal paymentId
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Team", teamSchema);
