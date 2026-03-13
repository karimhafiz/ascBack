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
        res.status(500).json({ error: error.message });
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

        // Handle image upload for heroImage (home page)
        if (req.file && page === "home") {
            const existing = await PageContent.findOne({ page: "home" });
            if (existing?.heroImage) {
                await deleteCloudinaryImage(existing.heroImage, "page-images");
            }
            updates.heroImage = req.file.secure_url;
        }

        // Handle activity card image uploads (about page)
        // Expects files as activityImage_0, activityImage_1 etc.
        if (page === "about" && req.files) {
            const cardImages = {};
            for (const [fieldname, files] of Object.entries(req.files)) {
                const match = fieldname.match(/^activityImage_(\d+)$/);
                if (match) {
                    cardImages[parseInt(match[1])] = files[0].secure_url;
                }
            }
            if (updates.activityCards && Object.keys(cardImages).length > 0) {
                updates.activityCards = updates.activityCards.map((card, i) => ({
                    ...card,
                    image: cardImages[i] ?? card.image,
                }));
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
        res.status(500).json({ error: error.message });
    }
};
