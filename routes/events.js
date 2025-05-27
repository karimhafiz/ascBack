const express = require("express");
const router = express.Router();
const eventController = require("../controllers/eventController");
const authMiddleware = require("../middleware/authMiddleware");

const upload = require("../config/multer");

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
  eventController.createEvent
);
// update
router.put(
  "/:id",
  authMiddleware,
  upload.single("image"),
  eventController.updateEvent
);
router.delete("/:id", authMiddleware, eventController.deleteEvent);

module.exports = router;
