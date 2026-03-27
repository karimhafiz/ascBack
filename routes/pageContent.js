const express = require("express");
const router = express.Router();
const pageContentController = require("../controllers/pageContentController");
const authMiddleware = require("../middleware/authMiddleware");
const authorize = require("../middleware/authorize");
const { createUpload } = require("../config/multer");
const upload = createUpload("page-images");

// Public — frontend fetches this to populate pages
router.get("/:page", pageContentController.getPageContent);

// Admin/mod only — update page content
// Uses upload.fields for multiple possible image uploads (hero + activity cards)
router.put(
  "/:page",
  authMiddleware,
  authorize("admin", "moderator"),
  upload.fields([
    { name: "heroImage", maxCount: 1 },
    { name: "activityImage_0", maxCount: 1 },
    { name: "activityImage_1", maxCount: 1 },
    { name: "activityImage_2", maxCount: 1 },
    { name: "activityImage_3", maxCount: 1 },
  ]),
  pageContentController.updatePageContent
);

module.exports = router;
