const express = require("express");
const router = express.Router();
const teamController = require("../controllers/teamController");

// Get a single team by ID
router.get("/:teamId", teamController.getTeam);

// Sign up a team for an event
router.post("/event/:eventId/signup", teamController.signupTeam);

// Process payment for a team
router.post("/:teamId/pay", teamController.processTeamPayment);

// List all paid teams for an event
router.get("/event/:eventId/teams", teamController.getTeamsForEvent);

module.exports = router;
