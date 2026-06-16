const express = require("express");
const router = express.Router();
const venueController = require("../controllers/venueController");
const authMiddleware = require("../middleware/authMiddleware");
const authorize = require("../middleware/authorize");
const { createUpload } = require("../config/multer");
const upload = createUpload("venue-images");

// ==================== ADMIN ONLY ====================

router.get("/admin/bookings", authMiddleware, authorize("admin"), venueController.getAllBookings);

// ==================== AUTHENTICATED USER (booking operations) ====================
// Specific routes before /:venueId to avoid param collision

router.post("/booking/checkout", authMiddleware, venueController.createVenueBookingCheckout);
router.get("/booking/success", venueController.confirmVenueBooking);
router.get("/my-bookings", authMiddleware, venueController.getUserBookings);
router.get("/booking/:bookingId", authMiddleware, venueController.getBookingDetails);
router.post("/booking/:bookingId/cancel", authMiddleware, venueController.cancelBooking);
router.post(
  "/booking/:bookingId/complete",
  authMiddleware,
  authorize("admin"),
  venueController.completeBooking
);

// ==================== ADMIN/MODERATOR ====================

// All slots (including booked), optionally filtered by ?date
router.get(
  "/:venueId/slots/all",
  authMiddleware,
  authorize("admin", "moderator"),
  venueController.getAllSlots
);

// Create one-off manual slot(s)
// Body: { date, startTime } or { slots: [...] }
router.post(
  "/:venueId/slots",
  authMiddleware,
  authorize("admin", "moderator"),
  venueController.createVenueSlots
);

// Generate slots from the venue's stored weeklySchedule over a date range
// Body: { fromDate, toDate }
router.post(
  "/:venueId/slots/generate",
  authMiddleware,
  authorize("admin", "moderator"),
  venueController.generateScheduleSlots
);

// Delete a slot (only if no active booking)
router.delete(
  "/:venueId/slot/:slotId",
  authMiddleware,
  authorize("admin", "moderator"),
  venueController.deleteVenueSlot
);

// Venue create/update
router.post(
  "/",
  authMiddleware,
  authorize("admin", "moderator"),
  upload.single("image"),
  venueController.createVenue
);
router.put(
  "/:venueId",
  authMiddleware,
  authorize("admin", "moderator"),
  upload.single("image"),
  venueController.updateVenue
);

// ==================== PUBLIC ====================

router.get("/", venueController.getVenues);
router.get("/:venueId/slots", venueController.getAvailableSlots);
router.get("/:venueId", venueController.getVenue);

module.exports = router;
