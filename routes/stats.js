const express = require("express");
const router = express.Router();
const statsController = require("../controllers/statsController");
const authMiddleware = require("../middleware/authMiddleware");
const authorize = require("../middleware/authorize");

router.get("/public", statsController.getPublicStats);
router.get("/admin", authMiddleware, authorize("admin"), statsController.getAdminStats);

module.exports = router;
