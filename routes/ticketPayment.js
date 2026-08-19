const express = require("express");
const rateLimit = require("express-rate-limit");
const router = express.Router();
const ticketPaymentController = require("../controllers/ticketPaymentController");
const authMiddleware = require("../middleware/authMiddleware");
const requireVerified = require("../middleware/requireVerified");

const guestCheckoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { error: "Too many checkout attempts, please try again later." },
});

router.post(
  "/create-checkout-session",
  authMiddleware,
  requireVerified,
  ticketPaymentController.createCheckoutSession
);
router.post(
  "/guest-checkout-session",
  guestCheckoutLimiter,
  ticketPaymentController.createGuestCheckoutSession
);
router.get("/success", guestCheckoutLimiter, ticketPaymentController.handleSuccess);
router.get("/guest-order/:sessionId", guestCheckoutLimiter, ticketPaymentController.getGuestOrder);
router.get("/session/:sessionId", authMiddleware, ticketPaymentController.getSession);

module.exports = router;
