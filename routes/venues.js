const express = require("express");
const router = express.Router();
const venueController = require("../controllers/venueController");
const authMiddleware = require("../middleware/authMiddleware");
const authorize = require("../middleware/authorize");
const { createUpload } = require("../config/multer");
const upload = createUpload("venue-images");

// ==================== ADMIN ONLY ROUTES ====================
// Place these first to avoid parameter collision issues

/**
 * GET /venues/admin/bookings
 * Get all bookings
 * Admin only
 * Query params: status (optional), venueId (optional)
 */
router.get("/admin/bookings", authMiddleware, authorize("admin"), venueController.getAllBookings);

// ==================== USER AUTHENTICATED ROUTES (booking operations) ====================
// These specific routes must come before generic /:venueId routes

/**
 * POST /venues/booking/checkout
 * Create a checkout session for venue booking
 * User must be authenticated
 */
router.post("/booking/checkout", authMiddleware, venueController.createVenueBookingCheckout);

/**
 * GET /venues/booking/success
 * Confirm venue booking after successful payment
 * User must be authenticated
 * Query params: sessionId, slotId, venueId
 */
router.get("/booking/success", authMiddleware, venueController.confirmVenueBooking);

/**
 * GET /venues/my-bookings
 * Get user's bookings
 * User must be authenticated
 * Query params: status (optional)
 */
router.get("/my-bookings", authMiddleware, venueController.getUserBookings);

/**
 * GET /venues/booking/:bookingId
 * Get booking details
 * User must be authenticated (can view own bookings or admin)
 */
router.get("/booking/:bookingId", authMiddleware, venueController.getBookingDetails);

/**
 * POST /venues/booking/:bookingId/cancel
 * Cancel a booking
 * User must be authenticated (can cancel own bookings or admin)
 * Body: { reason (optional) }
 */
router.post("/booking/:bookingId/cancel", authMiddleware, venueController.cancelBooking);

/**
 * POST /venues/booking/:bookingId/complete
 * Mark a booking as completed
 * Admin only
 */
router.post(
  "/booking/:bookingId/complete",
  authMiddleware,
  authorize("admin"),
  venueController.completeBooking
);

// ==================== ADMIN/MODERATOR ROUTES ====================

/**
 * POST /venues/:venueId/slots
 * Create available booking slots
 * Admin/Moderator only
 * Body: { date, startTime, endTime (optional), slots (optional array) }
 */
router.post(
  "/:venueId/slots",
  authMiddleware,
  authorize("admin", "moderator"),
  venueController.createVenueSlots
);

/**
 * DELETE /venues/:venueId/slot/:slotId
 * Delete a venue slot (if no booking exists)
 * Admin/Moderator only
 */
router.delete(
  "/:venueId/slot/:slotId",
  authMiddleware,
  authorize("admin", "moderator"),
  venueController.deleteVenueSlot
);

/**
 * PUT /venues/:venueId
 * Update venue details
 * Admin/Moderator only
 */
router.put(
  "/:venueId",
  upload.single("image"),
  authMiddleware,
  authorize("admin", "moderator"),
  venueController.updateVenue
);

// ==================== ADMIN/MODERATOR - Venue Creation ====================

/**
 * POST /venues
 * Create a new venue
 * Admin/Moderator only
 */
router.post(
  "/",
  upload.single("image"),
  authMiddleware,
  authorize("admin", "moderator"),
  venueController.createVenue
);

// ==================== PUBLIC ROUTES ====================
// Place these last to avoid parameter collision

/**
 * GET /venues/:venueId/slots
 * Get available booking slots for a venue
 * Public
 * Query params: date (optional, ISO string)
 */
router.get("/:venueId/slots", venueController.getAvailableSlots);

/**
 * GET /venues/:venueId
 * Get venue details
 * Public
 */
router.get("/:venueId", venueController.getVenue);

module.exports = router;
