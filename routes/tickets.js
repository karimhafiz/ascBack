const express = require("express");
const router = express.Router();
const ticketController = require("../controllers/ticketController");
const authenticateToken = require("../middleware/authMiddleware");
const authorize = require("../middleware/authorize");

// Admin/moderator direct purchase (bypasses Stripe)
router.post("/", authenticateToken, authorize("admin", "moderator"), ticketController.buyTicket);

// Aggregated ticket stats
router.get("/", authenticateToken, authorize("admin", "moderator"), ticketController.getAllTickets);

// Tickets for a payment (owner or staff)
router.get("/by-payment/:paymentId", authenticateToken, ticketController.getTicketsByPayment);

// Verify ticket by code (admin/moderator)
router.get(
  "/verify/:ticketCode",
  authenticateToken,
  authorize("admin", "moderator"),
  ticketController.verifyTicket
);

// Check in ticket (admin/moderator)
router.post(
  "/verify/:ticketCode/checkin",
  authenticateToken,
  authorize("admin", "moderator"),
  ticketController.checkInTicket
);

// Single ticket by id (owner or staff)
router.get("/:id", authenticateToken, ticketController.getTicketById);

module.exports = router;
