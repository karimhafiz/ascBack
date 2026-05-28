const mongoose = require("mongoose");

const webhookEventSchema = new mongoose.Schema({
  stripeEventId: { type: String, unique: true, required: true },
  eventType: { type: String, required: true },
  processedAt: { type: Date, default: Date.now },
  metadata: { type: mongoose.Schema.Types.Mixed },
});

module.exports = mongoose.model("WebhookEvent", webhookEventSchema);
