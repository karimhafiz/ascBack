const express = require("express");
const rateLimit = require("express-rate-limit");
const router = express.Router();
const ticketPaymentController = require("../controllers/ticketPaymentController");
const authenticateToken = require("../middleware/authMiddleware");

const guestCheckoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { error: "Too many checkout attempts, please try again later." },
});

router.post(
  "/create-checkout-session",
  authenticateToken,
  ticketPaymentController.createCheckoutSession
);
router.post(
  "/guest-checkout-session",
  guestCheckoutLimiter,
  ticketPaymentController.createGuestCheckoutSession
);
router.get("/success", ticketPaymentController.handleSuccess);
router.get("/session/:sessionId", authenticateToken, ticketPaymentController.getSession);

module.exports = router;
