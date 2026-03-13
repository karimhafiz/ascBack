const express = require("express");
const router = express.Router();
const userController = require("../controllers/userController");
const authController = require("../controllers/oauthController");
const authMiddleware = require("../middleware/authMiddleware");

router.post("/google", authController.googleLogin);
router.post("/login", userController.login);
router.post("/register", userController.register);
router.post("/refresh", userController.refresh);
router.post("/logout", userController.logout);
router.get("/profile", authMiddleware, userController.getProfile);

module.exports = router;
