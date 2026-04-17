const express = require("express");
const router = express.Router();
const teamController = require("../controllers/teamController");
const authenticateToken = require("../middleware/authMiddleware");

// Get a single team by ID
router.get("/:teamId", teamController.getTeam);

// Sign up a team for an event
router.post("/event/:eventId/signup", authenticateToken, teamController.signupTeam);

// Process payment for a team
router.post("/:teamId/pay", authenticateToken, teamController.processTeamPayment);

// Stripe success redirect — marks team as paid
router.get("/:teamId/payment-success", teamController.handlePaymentSuccess);

// Stripe cancel redirect — deletes unpaid team, returns to event page
router.get("/:teamId/cancel", teamController.cancelTeamPayment);

// Update a team (manager only)
router.put("/:teamId", authenticateToken, teamController.updateTeam);

// List my paid teams for an event (authenticated)
router.get("/event/:eventId/my-teams", authenticateToken, teamController.getMyTeamsForEvent);

// List all paid teams for an event
router.get("/event/:eventId/teams", teamController.getTeamsForEvent);

// Get unpaid teams for a manager on a specific event (for resuming registration)
router.get("/event/:eventId/unpaid", authenticateToken, teamController.getUnpaidTeamsForManager);

module.exports = router;
