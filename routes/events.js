const express = require("express");
const router = express.Router();
const eventController = require("../controllers/eventController");
const authMiddleware = require("../middleware/authMiddleware");
const authorize = require("../middleware/authorize");
const { createUpload } = require("../config/multer");
const upload = createUpload("event-images");

// Event routes
// Fetch all events
router.get("/", eventController.getAllEvents);
// Fetch a single event by ID
router.get("/:id", eventController.getEventById);
// create new event
router.post(
  "/",
  upload.single("image"),
  authMiddleware,
  authorize("admin", "moderator"),
  eventController.createEvent
);
// update
router.put(
  "/:id",
  upload.single("image"),
  authMiddleware,
  authorize("admin", "moderator"),
  eventController.updateEvent
);
router.delete("/:id", authMiddleware, authorize("admin", "moderator"), eventController.deleteEvent);

module.exports = router;
