const express = require("express");
const router = express.Router();
const teamController = require("../controllers/teamController");
const authMiddleware = require("../middleware/authMiddleware");
const requireVerified = require("../middleware/requireVerified");

// Get a single team by ID
router.get("/:teamId", teamController.getTeam);

// Register a team (validate + upsert + free or Stripe checkout)
router.post(
  "/event/:eventId/register",
  authMiddleware,
  requireVerified,
  teamController.registerTeam
);

// Stripe success redirect — marks team as paid
router.get("/:teamId/payment-success", teamController.handlePaymentSuccess);

// Stripe cancel redirect — deletes unpaid team, returns to event page
router.get("/:teamId/cancel", teamController.cancelTeamPayment);

// Update a team (manager only)
router.put("/:teamId", authMiddleware, teamController.updateTeam);

// List all paid teams for an event
router.get("/event/:eventId/teams", teamController.getTeamsForEvent);

// Get unpaid teams for a manager on a specific event (for resuming registration)
router.get("/event/:eventId/unpaid", authMiddleware, teamController.getUnpaidTeamsForManager);

module.exports = router;
