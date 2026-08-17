const mongoose = require("mongoose");

// A staged Cloudinary upload attached to one pending request.
// For "about", the card it belongs to is identified by its fixed array
// position (0-3), not by subdocument _id — activityCards is a fixed
// 4-card array (see PageContent.js), and a card may not have an _id yet
// if the page has never been saved. Position is always well-defined.
const newImageSchema = new mongoose.Schema(
  {
    field: { type: String, required: true }, // "heroImage" or "activityImage_<index>"
    index: { type: Number }, // card position for "about"; absent for "home"
    url: { type: String, required: true },
    publicId: { type: String, required: true },
  },
  { _id: false }
);

const pageContentRequestSchema = new mongoose.Schema(
  {
    page: {
      type: String,
      enum: ["home", "about"],
      required: true,
    },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    status: {
      type: String,
      enum: ["pending", "approved", "declined"],
      default: "pending",
    },

    // Same field shape as the $set payload updatePageContent applies to the
    // live PageContent doc. Applied verbatim via $set on approval.
    proposedContent: { type: mongoose.Schema.Types.Mixed, required: true },

    // Cloudinary uploads staged specifically for this request. Needed
    // because approve/decline happen in a later request with no access
    // to the original files — this is the only record of what to clean up.
    newImages: [newImageSchema],

    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    declineReason: { type: String },
  },
  { timestamps: true }
);

pageContentRequestSchema.index({ page: 1, status: 1 });
pageContentRequestSchema.index({ requestedBy: 1 });
pageContentRequestSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("PageContentRequest", pageContentRequestSchema);
