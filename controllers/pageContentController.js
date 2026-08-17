const { deleteCloudinaryImage } = require("../utils/cloudinaryUtils");
const PageContent = require("../models/PageContent");

// GET /content/:page — public, used by frontend to load page content
exports.getPageContent = async (req, res) => {
  try {
    const { page } = req.params;
    const content = await PageContent.findOne({ page });
    if (!content) {
      return res.json({});
    }
    res.json(content);
  } catch (error) {
    console.error("Error fetching page content:", error);
    res.status(500).json({ error: "Failed to fetch page content" });
  }
};

// PUT /content/:page — admin/moderator only
// Creates the document if it doesn't exist yet (upsert)
exports.updatePageContent = async (req, res) => {
  try {
    const { page } = req.params;

    let updates;
    try {
      updates = req.body.contentData ? JSON.parse(req.body.contentData) : req.body;
    } catch {
      return res.status(400).json({ error: "Invalid JSON in contentData" });
    }

    // upload.any() gives a flat array: [{ fieldname, secure_url, public_id, ... }]
    const uploadedFiles = req.files || [];

    // Handle image upload for heroImage (home page)
    const heroFile = uploadedFiles.find((f) => f.fieldname === "heroImage");
    if (heroFile && page === "home") {
      const existing = await PageContent.findOne({ page: "home" });
      if (existing?.heroImageId) {
        await deleteCloudinaryImage(existing.heroImageId);
      }
      updates.heroImage = heroFile.secure_url;
      updates.heroImageId = heroFile.public_id;
    }

    // Handle activity card image uploads (about page)
    // Expects files as activityImage_<cardId> (subdocument _id)
    if (page === "about") {
      const cardImages = {};
      for (const file of uploadedFiles) {
        const match = file.fieldname.match(/^activityImage_(.+)$/);
        if (match) {
          cardImages[match[1]] = file.secure_url;
        }
      }
      if (updates.activityCards && Object.keys(cardImages).length > 0) {
        const existing = await PageContent.findOne({ page: "about" });
        const oldCards = existing?.activityCards || [];

        // Delete old Cloudinary images being replaced
        await Promise.all(
          Object.keys(cardImages).map((cardId) => {
            const oldCard = oldCards.find((c) => c._id?.toString() === cardId);
            return oldCard?.image ? deleteCloudinaryImage(oldCard.image, "page-images") : null;
          })
        );

        updates.activityCards = updates.activityCards.map((card, index) => {
          // Mirrors the frontend's field-naming fallback (card._id || index) so
          // first-ever uploads on a card with no _id yet still get matched.
          const cardKey = card._id ? String(card._id) : String(index);
          const newImage = cardImages[cardKey];
          return { ...card, image: newImage ?? card.image };
        });
      }
    }

    const content = await PageContent.findOneAndUpdate(
      { page },
      { $set: updates },
      { new: true, upsert: true, runValidators: true }
    );

    res.json({ message: "Page content updated", pageContent: content });
  } catch (error) {
    console.error("Error updating page content:", error);
    res.status(500).json({ error: "Failed to update page content" });
  }
};

// DELETE /content/:page            — full page reset (clears all fields + Cloudinary images)
// DELETE /content/:page/:section   — section reset for about page ("hero","cards","mission","getInvolved")
exports.resetPageContent = async (req, res) => {
  try {
    const { page, section } = req.params;
    const existing = await PageContent.findOne({ page });

    if (!existing) {
      return res.json({ message: "Page content already at defaults" });
    }

    if (page === "home") {
      if (existing.heroImageId) {
        await deleteCloudinaryImage(existing.heroImageId);
      }
      await PageContent.deleteOne({ page });
      return res.json({ message: "Page content reset to defaults" });
    }

    if (page === "about") {
      const resettingCards = !section || section === "cards";
      if (resettingCards && existing.activityCards?.length) {
        await Promise.all(
          existing.activityCards
            .filter((card) => card.image)
            .map((card) => deleteCloudinaryImage(card.image, "page-images"))
        );
      }

      if (!section) {
        await PageContent.deleteOne({ page });
        return res.json({ message: "Page content reset to defaults" });
      }

      const unsetMap = {
        hero: { aboutHeroTitle: 1, aboutHeroDescription: 1 },
        cards: { activityCards: 1 },
        mission: { missionTitle: 1, missionText: 1 },
        getInvolved: { getInvolvedTitle: 1, getInvolvedText: 1 },
      };
      if (!unsetMap[section]) {
        return res.status(400).json({ error: "Unknown section" });
      }

      const updated = await PageContent.findOneAndUpdate(
        { page },
        { $unset: unsetMap[section] },
        { new: true }
      );
      return res.json({ message: "Section reset to defaults", pageContent: updated || {} });
    }

    res.status(400).json({ error: "Unknown page" });
  } catch (error) {
    console.error("Error resetting page content:", error);
    res.status(500).json({ error: "Failed to reset page content" });
  }
};
