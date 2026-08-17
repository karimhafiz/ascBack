const express = require("express");
const router = express.Router();
const pageContentRequestController = require("../controllers/pageContentRequestController");
const authMiddleware = require("../middleware/authMiddleware");
const authorize = require("../middleware/authorize");
const { createUpload } = require("../config/multer");
const upload = createUpload("page-images");

// Moderator submits a change request (mirrors PUT /pageContent/:page upload shape)
router.post(
  "/:page",
  authMiddleware,
  authorize("moderator"),
  upload.any(),
  pageContentRequestController.submitPageContentRequest
);

// Admin sees all requests; moderator sees only their own (controller branches on role)
router.get(
  "/",
  authMiddleware,
  authorize("admin", "moderator"),
  pageContentRequestController.listPageContentRequests
);

// Admin-only review actions
router.patch(
  "/:id/approve",
  authMiddleware,
  authorize("admin"),
  pageContentRequestController.approvePageContentRequest
);
router.patch(
  "/:id/decline",
  authMiddleware,
  authorize("admin"),
  pageContentRequestController.declinePageContentRequest
);

module.exports = router;
