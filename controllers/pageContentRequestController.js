const mongoose = require("mongoose");
const { deleteCloudinaryImage } = require("../utils/cloudinaryUtils");
const PageContentRequest = require("../models/PageContentRequest");
const PageContent = require("../models/PageContent");

// POST /pageContentRequests/:page — moderator only
// Stages proposed changes + any newly uploaded images; never touches the
// live PageContent doc.
exports.submitPageContentRequest = async (req, res) => {
  try {
    const { page } = req.params;
    if (!["home", "about"].includes(page)) {
      return res.status(400).json({ error: "Invalid page" });
    }

    let proposedContent;
    try {
      proposedContent = req.body.contentData ? JSON.parse(req.body.contentData) : req.body;
    } catch {
      return res.status(400).json({ error: "Invalid JSON in contentData" });
    }

    // upload.any() gives a flat array: [{ fieldname, secure_url, public_id, ... }]
    const uploadedFiles = req.files || [];
    const newImages = [];

    if (page === "home") {
      const heroFile = uploadedFiles.find((f) => f.fieldname === "heroImage");
      if (heroFile) {
        proposedContent.heroImage = heroFile.secure_url;
        proposedContent.heroImageId = heroFile.public_id;
        newImages.push({
          field: "heroImage",
          url: heroFile.secure_url,
          publicId: heroFile.public_id,
        });
      }
    }

    if (page === "about" && Array.isArray(proposedContent.activityCards)) {
      // Same fallback the frontend uses for the field name (card._id || index),
      // resolved here once so approval can key on a stable array position
      // instead of re-deriving it later.
      proposedContent.activityCards = proposedContent.activityCards.map((card, index) => {
        const cardKey = card._id ? String(card._id) : String(index);
        const file = uploadedFiles.find((f) => f.fieldname === `activityImage_${cardKey}`);
        if (!file) return card;
        newImages.push({
          field: file.fieldname,
          index,
          url: file.secure_url,
          publicId: file.public_id,
        });
        return { ...card, image: file.secure_url };
      });
    }

    // Validate the proposed shape against PageContent's schema up front
    // (required subdocument fields, type casting) so a moderator gets an
    // immediate 400 instead of the problem surfacing later, at approval time.
    const validationError = new PageContent({ page, ...proposedContent }).validateSync();
    if (validationError) {
      return res.status(400).json({ error: validationError.message });
    }

    const request = await PageContentRequest.create({
      page,
      requestedBy: req.user.id,
      proposedContent,
      newImages,
      status: "pending",
    });

    res.status(201).json({ message: "Change request submitted for approval", request });
  } catch (error) {
    console.error("Error submitting page content request:", error);
    res.status(500).json({ error: "Failed to submit request" });
  }
};

// GET /pageContentRequests — admin sees all, moderator sees only their own
exports.listPageContentRequests = async (req, res) => {
  try {
    const filter = req.user.role === "admin" ? {} : { requestedBy: req.user.id };
    const requests = await PageContentRequest.find(filter)
      .populate("requestedBy", "name email")
      .populate("reviewedBy", "name email")
      .sort({ createdAt: -1 });

    // Cheap, read-time-only staleness hint: flags a pending request whose
    // page has changed live since it was drafted (e.g. a sibling request
    // was approved first). Not persisted, not enforced.
    const pages = [...new Set(requests.map((r) => r.page))];
    const liveDocs = await PageContent.find({ page: { $in: pages } }, "page updatedAt");
    const liveUpdatedAtByPage = Object.fromEntries(liveDocs.map((d) => [d.page, d.updatedAt]));

    const result = requests.map((r) => {
      const obj = r.toObject();
      const liveUpdatedAt = liveUpdatedAtByPage[r.page];
      obj.stale = r.status === "pending" && liveUpdatedAt && liveUpdatedAt > r.createdAt;
      return obj;
    });

    res.json(result);
  } catch (error) {
    console.error("Error listing page content requests:", error);
    res.status(500).json({ error: "Failed to fetch requests" });
  }
};

// PATCH /pageContentRequests/:id/approve — admin only
// Applies proposedContent onto the live PageContent doc and deletes
// whichever Cloudinary image it replaces.
exports.approvePageContentRequest = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid request id" });
    }

    const request = await PageContentRequest.findById(id);
    if (!request) return res.status(404).json({ error: "Request not found" });
    if (request.status !== "pending") {
      return res.status(400).json({ error: "Request has already been reviewed" });
    }

    const existing = await PageContent.findOne({ page: request.page });

    // Apply the validated update first — only delete the old images it
    // replaces once we know the new content actually saved successfully.
    // Deleting first would risk leaving a live reference to an image that
    // no longer exists if the update below throws (e.g. a shape mismatch).
    const updated = await PageContent.findOneAndUpdate(
      { page: request.page },
      { $set: request.proposedContent },
      { new: true, upsert: true, runValidators: true }
    );

    const deletions = await Promise.allSettled(
      request.newImages.map((img) => {
        if (img.field === "heroImage") {
          return existing?.heroImageId
            ? deleteCloudinaryImage(existing.heroImageId)
            : Promise.resolve();
        }
        if (typeof img.index === "number") {
          const oldCard = existing?.activityCards?.[img.index];
          return oldCard?.image
            ? deleteCloudinaryImage(oldCard.image, "page-images")
            : Promise.resolve();
        }
        return Promise.resolve();
      })
    );
    deletions.forEach((result) => {
      if (result.status === "rejected") {
        console.error("Failed to delete replaced page-content image:", result.reason);
      }
    });

    request.status = "approved";
    request.reviewedBy = req.user.id;
    request.reviewedAt = new Date();
    await request.save();

    res.json({ message: "Request approved", request, pageContent: updated });
  } catch (error) {
    console.error("Error approving page content request:", error);
    res.status(500).json({ error: "Failed to approve request" });
  }
};

// PATCH /pageContentRequests/:id/decline — admin only
// Cleans up staged images that never went live.
exports.declinePageContentRequest = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid request id" });
    }

    const request = await PageContentRequest.findById(id);
    if (!request) return res.status(404).json({ error: "Request not found" });
    if (request.status !== "pending") {
      return res.status(400).json({ error: "Request has already been reviewed" });
    }

    const deletions = await Promise.allSettled(
      request.newImages.map((img) => deleteCloudinaryImage(img.publicId))
    );
    deletions.forEach((result) => {
      if (result.status === "rejected") {
        console.error("Failed to delete staged page-content image:", result.reason);
      }
    });

    request.status = "declined";
    request.reviewedBy = req.user.id;
    request.reviewedAt = new Date();
    if (req.body?.reason) request.declineReason = req.body.reason;
    await request.save();

    res.json({ message: "Request declined", request });
  } catch (error) {
    console.error("Error declining page content request:", error);
    res.status(500).json({ error: "Failed to decline request" });
  }
};
