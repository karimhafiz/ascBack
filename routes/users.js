const express = require("express");
const rateLimit = require("express-rate-limit");
const router = express.Router();
const userController = require("../controllers/userController");
const authController = require("../controllers/oauthController");
const authMiddleware = require("../middleware/authMiddleware");

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: { message: "Too many requests, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post("/google", authLimiter, authController.googleLogin);
router.post("/login", authLimiter, userController.login);
router.post("/register", authLimiter, userController.register);
router.post("/refresh", authLimiter, userController.refresh);
router.post("/logout", userController.logout);
router.get("/profile", authMiddleware, userController.getProfile);

module.exports = router;
