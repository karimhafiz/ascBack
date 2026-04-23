const express = require("express");
const router = express.Router();
const ticketPaymentController = require("../controllers/ticketPaymentController");
const authenticateToken = require("../middleware/authMiddleware");

router.post(
  "/create-checkout-session",
  authenticateToken,
  ticketPaymentController.createCheckoutSession
);
router.get("/success", ticketPaymentController.handleSuccess);
router.get("/session/:sessionId", authenticateToken, ticketPaymentController.getSession);

module.exports = router;
