const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const router = express.Router();
const userController = require("../controllers/userController");
const authMiddleware = require("../middleware/authorize");

router.post("/login", userController.login);
router.post("/register", userController.register);
router.get("/", authMiddleware, userController.getAllUsers);

router.post("/", authMiddleware, userController.createUser);
router.delete("/:id", authMiddleware, userController.deleteUser);
// registration route is already handled above using userController.register
// kept for backward compatibility or custom logic if needed


module.exports = router;
