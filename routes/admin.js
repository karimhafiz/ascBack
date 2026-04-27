const express = require("express");
const router = express.Router();
const adminController = require("../controllers/adminController");
const authMiddleware = require("../middleware/authMiddleware");
const authorize = require("../middleware/authorize");

// Admin-only dashboard
router.get("/dashboard", authMiddleware, authorize("admin"), adminController.getDashboard);

// Admin-only user management
router.get("/users", authMiddleware, authorize("admin"), adminController.getAllUsers);

router.delete("/users/:id", authMiddleware, authorize("admin"), adminController.deleteUser);

// Only admin can change roles
router.patch("/users/:id/role", authMiddleware, authorize("admin"), adminController.updateUserRole);

// Only admin can ban/unban
router.patch("/users/:id/ban", authMiddleware, authorize("admin"), adminController.toggleBan);

module.exports = router;
