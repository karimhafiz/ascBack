const request = require("supertest");
const express = require("express");
const mongoose = require("mongoose");

jest.mock("../../models/Team");
jest.mock("../../models/Event");
jest.mock("../../utils/emailUtils", () => ({
  sendTeamRegistrationEmail: jest.fn().mockResolvedValue(true),
  sendTeamUpdateEmail: jest.fn().mockResolvedValue(true),
  verifyEmailDomain: jest.fn().mockResolvedValue(true),
}));

const mockStripe = {
  checkout: {
    sessions: {
      create: jest.fn().mockResolvedValue({
        url: "https://checkout.stripe.com/test",
        id: "cs_test_123",
      }),
      retrieve: jest.fn().mockResolvedValue({
        id: "cs_test_123",
        payment_status: "paid",
      }),
    },
  },
};
jest.mock("stripe", () => jest.fn(() => mockStripe));

const teamController = require("../../controllers/teamController");
const Team = require("../../models/Team");
const Event = require("../../models/Event");

// Reusable valid ObjectIds
const validTeamId = new mongoose.Types.ObjectId().toString();
const validEventId = new mongoose.Types.ObjectId().toString();
const validUserId = new mongoose.Types.ObjectId().toString();

describe("Team Controller", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.user = { id: validUserId, email: "m@test.com", role: "user" };
      next();
    });

    app.get("/api/teams/:teamId", teamController.getTeam);
    app.post("/api/teams/event/:eventId/register", teamController.registerTeam);
    app.get("/api/teams/:teamId/payment-success", teamController.handlePaymentSuccess);
    app.get("/api/teams/:teamId/cancel", teamController.cancelTeamPayment);
    app.put("/api/teams/:teamId", teamController.updateTeam);
    app.get("/api/teams/event/:eventId/unpaid", teamController.getUnpaidTeamsForManager);
    app.get("/api/teams/event/:eventId/teams", teamController.getTeamsForEvent);
  });

  // ─── GET /:teamId ───────────────────────────────────────────────────────────

  describe("GET /:teamId", () => {
    it("should return a team", async () => {
      Team.findById.mockResolvedValue({ _id: validTeamId, name: "Team A" });

      const res = await request(app).get(`/api/teams/${validTeamId}`);
      expect(res.status).toBe(200);
      expect(res.body.team.name).toBe("Team A");
    });

    it("should return 404 if team not found", async () => {
      const nonexistentId = new mongoose.Types.ObjectId().toString();
      Team.findById.mockResolvedValue(null);

      const res = await request(app).get(`/api/teams/${nonexistentId}`);
      expect(res.status).toBe(404);
    });

    it("should return 400 for invalid ObjectId", async () => {
      const res = await request(app).get("/api/teams/not-valid");
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid team ID");
    });
  });

  // ─── POST /event/:eventId/register ──────────────────────────────────────────

  describe("POST /event/:eventId/register", () => {
    const validBody = {
      name: "Team A",
      manager: { name: "Manager", email: "m@test.com", phone: "07123456789" },
    };

    it("should register a free team immediately", async () => {
      Event.findById.mockResolvedValue({
        _id: validEventId,
        isTournament: true,
        ticketPrice: 0,
        title: "Free Cup",
      });
      Team.findOneAndUpdate.mockResolvedValue({
        _id: validTeamId,
        name: "Team A",
        manager: validBody.manager,
        paid: false,
        save: jest.fn().mockResolvedValue(true),
      });

      const res = await request(app)
        .post(`/api/teams/event/${validEventId}/register`)
        .send(validBody);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Team registered successfully");
    });

    it("should return Stripe checkout URL for paid tournament", async () => {
      Event.findById.mockResolvedValue({
        _id: validEventId,
        isTournament: true,
        ticketPrice: 25,
        title: "Paid Cup",
      });
      Team.findOneAndUpdate.mockResolvedValue({
        _id: validTeamId,
        name: "Team A",
        manager: validBody.manager,
        paid: false,
      });

      const res = await request(app)
        .post(`/api/teams/event/${validEventId}/register`)
        .send(validBody);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("url");
      expect(mockStripe.checkout.sessions.create).toHaveBeenCalled();
    });

    it("should return 400 if team name missing", async () => {
      const res = await request(app)
        .post(`/api/teams/event/${validEventId}/register`)
        .send({ manager: validBody.manager });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Team name is required");
    });

    it("should return 400 if manager email missing", async () => {
      const res = await request(app)
        .post(`/api/teams/event/${validEventId}/register`)
        .send({ name: "Team A", manager: { name: "M", phone: "07123456789" } });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("A valid manager email address is required");
    });

    it("should return 400 if event is not a tournament", async () => {
      Event.findById.mockResolvedValue({ _id: validEventId, isTournament: false });

      const res = await request(app)
        .post(`/api/teams/event/${validEventId}/register`)
        .send(validBody);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("This event does not accept team registrations");
    });
  });

  // ─── GET /:teamId/payment-success ───────────────────────────────────────────

  describe("GET /:teamId/payment-success", () => {
    it("should mark team as paid and redirect", async () => {
      Team.findOneAndUpdate.mockResolvedValue({
        _id: validTeamId,
        paid: true,
        event: validEventId,
      });
      Event.findById.mockResolvedValue({ _id: validEventId, title: "Cup" });

      const res = await request(app)
        .get(`/api/teams/${validTeamId}/payment-success`)
        .query({ session_id: "cs_test_123" });

      expect(res.status).toBe(302);
      expect(res.headers.location).toMatch(/team-confirmation/);
      expect(Team.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: validTeamId, paid: false },
        { paid: true, paymentId: "cs_test_123" },
        { new: true }
      );
    });

    it("should redirect without email if already paid (idempotent)", async () => {
      Team.findOneAndUpdate.mockResolvedValue(null);

      const res = await request(app)
        .get(`/api/teams/${validTeamId}/payment-success`)
        .query({ session_id: "cs_test_123" });

      expect(res.status).toBe(302);
      expect(res.headers.location).toMatch(/team-confirmation/);
      expect(Event.findById).not.toHaveBeenCalled();
    });

    it("should redirect to events if session_id missing", async () => {
      const res = await request(app).get(`/api/teams/${validTeamId}/payment-success`);

      expect(res.status).toBe(302);
      expect(res.headers.location).toMatch(/events$/);
    });
  });

  // ─── GET /:teamId/cancel ────────────────────────────────────────────────────

  describe("GET /:teamId/cancel", () => {
    it("should delete unpaid team and redirect", async () => {
      Team.findById.mockResolvedValue({ _id: validTeamId, paid: false, event: validEventId });
      Team.findByIdAndDelete.mockResolvedValue(true);

      const res = await request(app).get(`/api/teams/${validTeamId}/cancel`);
      expect(res.status).toBe(302);
      expect(Team.findByIdAndDelete).toHaveBeenCalledWith(validTeamId);
    });

    it("should not delete paid team", async () => {
      Team.findById.mockResolvedValue({ _id: validTeamId, paid: true, event: validEventId });

      const res = await request(app).get(`/api/teams/${validTeamId}/cancel`);
      expect(res.status).toBe(302);
      expect(Team.findByIdAndDelete).not.toHaveBeenCalled();
    });
  });

  // ─── PUT /:teamId ──────────────────────────────────────────────────────────

  describe("PUT /:teamId", () => {
    it("should update team name and manager details", async () => {
      Team.findById.mockResolvedValue({
        _id: validTeamId,
        name: "Old Name",
        manager: { email: "m@test.com", name: "Old", phone: "07000000000" },
        paid: true,
        event: validEventId,
        save: jest.fn().mockResolvedValue(true),
      });
      Event.findById.mockResolvedValue({ _id: validEventId, title: "Cup" });

      const res = await request(app)
        .put(`/api/teams/${validTeamId}`)
        .send({ name: "New Name", manager: { name: "New Manager", phone: "07111111111" } });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Team updated successfully");
    });

    it("should return 403 if not the manager", async () => {
      Team.findById.mockResolvedValue({
        _id: validTeamId,
        manager: { email: "other@test.com" },
        paid: true,
      });

      const res = await request(app).put(`/api/teams/${validTeamId}`).send({ name: "New Name" });

      expect(res.status).toBe(403);
    });
  });

  // ─── GET /event/:eventId/unpaid ─────────────────────────────────────────────

  describe("GET /event/:eventId/unpaid", () => {
    it("should return unpaid teams for manager", async () => {
      Team.find.mockResolvedValue([{ _id: validTeamId, name: "Team A" }]);

      const res = await request(app).get(`/api/teams/event/${validEventId}/unpaid`);
      expect(res.status).toBe(200);
      expect(res.body.teams).toHaveLength(1);
    });
  });

  // ─── GET /event/:eventId/teams ──────────────────────────────────────────────

  describe("GET /event/:eventId/teams", () => {
    it("should return paid teams for event", async () => {
      Team.find.mockResolvedValue([
        { _id: validTeamId, name: "Team A", paid: true, manager: { name: "M" } },
      ]);

      const res = await request(app).get(`/api/teams/event/${validEventId}/teams`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });
  });
});
