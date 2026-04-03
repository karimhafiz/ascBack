const mongoose = require("mongoose");

// Each document represents one page ("home" or "about")
// There will only ever be one document per page — use upsert to update

const activityCardSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
  image: { type: String }, // Cloudinary URL
});

const pageContentSchema = new mongoose.Schema(
  {
    page: {
      type: String,
      enum: ["home", "about"],
      required: true,
      unique: true, // only one doc per page
    },

    // ── Home page fields ──────────────────────────────
    heroTitle: { type: String },
    heroDescription: { type: String },
    heroImage: { type: String }, // Cloudinary URL
    heroImageId: { type: String }, // Cloudinary public_id
    heroBadgeText: { type: String },

    // ── About page fields ─────────────────────────────
    aboutHeroTitle: { type: String },
    aboutHeroDescription: { type: String },

    // "What We Do" cards — fixed 4 cards, not dynamic array
    activityCards: [activityCardSchema],

    missionTitle: { type: String },
    missionText: { type: String },

    getInvolvedTitle: { type: String },
    getInvolvedText: { type: String },
  },
  { timestamps: true }
);

module.exports = mongoose.model("PageContent", pageContentSchema);
