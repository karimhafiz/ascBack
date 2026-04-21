const express = require("express");
const router = express.Router();
const teamController = require("../controllers/teamController");
const authenticateToken = require("../middleware/authMiddleware");

// Get a single team by ID
router.get("/:teamId", teamController.getTeam);

// Register a team (validate + upsert + free or Stripe checkout)
router.post("/event/:eventId/register", authenticateToken, teamController.registerTeam);

// Stripe success redirect — marks team as paid
router.get("/:teamId/payment-success", teamController.handlePaymentSuccess);

// Stripe cancel redirect — deletes unpaid team, returns to event page
router.get("/:teamId/cancel", teamController.cancelTeamPayment);

// Update a team (manager only)
router.put("/:teamId", authenticateToken, teamController.updateTeam);

// List all paid teams for an event
router.get("/event/:eventId/teams", teamController.getTeamsForEvent);

// Get unpaid teams for a manager on a specific event (for resuming registration)
router.get("/event/:eventId/unpaid", authenticateToken, teamController.getUnpaidTeamsForManager);

module.exports = router;
