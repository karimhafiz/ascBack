const express = require("express");
const router = express.Router();
const eventController = require("../controllers/eventController");
const authMiddleware = require("../middleware/authMiddleware");
const multer = require("multer");
const path = require("path");

// Configure multer for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/"); // Save images to the "uploads" folder
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

const upload = multer({ storage });

// Event routes
// Fetch all events
router.get("/", eventController.getAllEvents);
// Fetch a single event by ID
router.get("/:id", eventController.getEventById);
// create new event
router.post(
  "/",
  authMiddleware,
  upload.single("image"),
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
