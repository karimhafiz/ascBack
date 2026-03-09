const cloudinary = require("../config/cloudinary");
PageContent = require("../models/PageContent");

// GET /content/:page — public, used by frontend to load page content
exports.getPageContent = async (req, res) => {
    try {
        const { page } = req.params;
        const content = await PageContent.findOne({ page });
        if (!content) {
            // Return empty object — frontend falls back to hardcoded defaults
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
            // Delete old heroImage from Cloudinary if exists
            const existing = await PageContent.findOne({ page: "home" });
            if (existing?.heroImage) {
                try {
                    const parts = existing.heroImage.split("/");
                    const filename = parts[parts.length - 1].split(".")[0];
                    await cloudinary.uploader.destroy(`page-images/${filename}`);
                } catch (err) {
                    console.error("Failed to delete old hero image:", err);
                }
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
        console.log("req.files:", req.files);
        console.log("req.file:", req.file);
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