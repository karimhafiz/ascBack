const express = require("express");
const router = express.Router();
const userController = require("../controllers/userController");
const authController = require("../controllers/oauthController");
const authMiddleware = require("../middleware/authMiddleware");

router.post("/google", authController.googleLogin);
router.post("/login", userController.login);
router.post("/register", userController.register);
router.get("/", authMiddleware, userController.getAllUsers);

router.post("/", authMiddleware, userController.createUser);
router.delete("/:id", authMiddleware, userController.deleteUser);
// registration route is already handled above using userController.register
// kept for backward compatibility or custom logic if needed


module.exports = router;
