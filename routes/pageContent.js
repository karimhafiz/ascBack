const express = require("express");
const router = express.Router();
const pageContentController = require("../controllers/pageContentController");
const authMiddleware = require("../middleware/authMiddleware");
const authorize = require("../middleware/authorize");
const { createUpload } = require("../config/multer");
const upload = createUpload("page-images");

// Public — frontend fetches this to populate pages
router.get("/:page", pageContentController.getPageContent);

// Admin only — update page content directly.
// Moderators submit change requests instead (see routes/pageContentRequests.js).
// Uses upload.fields for multiple possible image uploads (hero + activity cards)
router.put(
  "/:page",
  authMiddleware,
  authorize("admin"),
  upload.any(),
  pageContentController.updatePageContent
);

// Admin only — reset a full page or a specific section back to defaults
router.delete("/:page", authMiddleware, authorize("admin"), pageContentController.resetPageContent);
router.delete(
  "/:page/:section",
  authMiddleware,
  authorize("admin"),
  pageContentController.resetPageContent
);

module.exports = router;
