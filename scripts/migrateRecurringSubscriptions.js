/**
 * One-time migration: create Stripe products + prices for existing
 * recurring paid events that are missing stripePriceId.
 *
 * Usage:  node scripts/migrateRecurringSubscriptions.js
 *
 * Requires MONGO_URI and STRIPE_SECRET_KEY in .env (or environment).
 */

require("dotenv").config();
const mongoose = require("mongoose");
const Event = require("../models/Event");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

async function migrate() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB");

  const events = await Event.find({
    isReoccurring: true,
    ticketPrice: { $gt: 0 },
    $or: [{ stripePriceId: null }, { stripePriceId: { $exists: false } }],
  });

  console.log(`Found ${events.length} recurring paid event(s) without stripePriceId`);

  for (const event of events) {
    try {
      const product = await stripe.products.create({
        name: event.title,
        description: event.shortDescription || "",
      });
      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: Math.round(event.ticketPrice * 100),
        currency: "gbp",
        recurring: { interval: event.subscriptionInterval || "month" },
      });

      await Event.findByIdAndUpdate(event._id, {
        stripeProductId: product.id,
        stripePriceId: price.id,
      });

      console.log(`✓ ${event.title} → product=${product.id}, price=${price.id}`);
    } catch (err) {
      console.error(`✗ ${event.title}: ${err.message}`);
    }
  }

  await mongoose.disconnect();
  console.log("Done");
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
