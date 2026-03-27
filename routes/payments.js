const express = require("express");
const router = express.Router();
const paymentController = require("../controllers/paymentController");
const authenticateToken = require("../middleware/authMiddleware");

router.post("/create-checkout-session", paymentController.createCheckoutSession);
router.get("/success", paymentController.handleSuccess);
router.get("/session/:sessionId", authenticateToken, paymentController.getSession);

module.exports = router;
