const express = require("express");
const router = express.Router();
const adminController = require("../controllers/adminController");
const authMiddleware = require("../middleware/authMiddleware");
const authorize = require("../middleware/authorize");

// Both admin and moderator can view the dashboard
router.get("/dashboard", authMiddleware, authorize("admin"), adminController.getDashboard);

// Admin-only user management
router.get("/users", authMiddleware, authorize("admin"), adminController.getAllUsers);

router.delete("/users/:id", authMiddleware, authorize("admin"), adminController.deleteUser);

// Only admin can change roles
router.patch("/users/:id/role", authMiddleware, authorize("admin"), adminController.updateUserRole);

module.exports = router;
