const request = require("supertest");
const express = require("express");
const teamController = require("../../controllers/teamController");

jest.mock("../../models/Team");
jest.mock("../../models/Event");
jest.mock("stripe", () => {
  return jest.fn(() => ({
    checkout: {
      sessions: {
        create: jest.fn().mockResolvedValue({
          url: "https://checkout.stripe.com/test",
          id: "cs_test_123",
          payment_status: "paid",
        }),
        retrieve: jest.fn().mockResolvedValue({
          id: "cs_test_123",
          payment_status: "paid",
        }),
      },
    },
  }));
});

const Team = require("../../models/Team");
const Event = require("../../models/Event");

describe("Team Controller", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());
    // Inject authenticated user for all routes
    app.use((req, res, next) => {
      req.user = { id: "user123", email: "m@test.com", role: "user" };
      next();
    });

    app.get("/api/teams/:teamId", teamController.getTeam);
    app.post("/api/teams/event/:eventId/signup", teamController.signupTeam);
    app.post("/api/teams/:teamId/pay", teamController.processTeamPayment);
    app.get("/api/teams/:teamId/payment-success", teamController.handlePaymentSuccess);
    app.get("/api/teams/:teamId/cancel", teamController.cancelTeamPayment);
    app.get("/api/teams/event/:eventId/unpaid", teamController.getUnpaidTeamsForManager);
    app.get("/api/teams/event/:eventId/teams", teamController.getTeamsForEvent);
  });

  describe("GET /:teamId", () => {
    it("should return a team", async () => {
      Team.findById.mockResolvedValue({ _id: "t1", name: "Team A" });

      const res = await request(app).get("/api/teams/t1");
      expect(res.status).toBe(200);
      expect(res.body.team.name).toBe("Team A");
    });

    it("should return 404 if team not found", async () => {
      Team.findById.mockResolvedValue(null);

      const res = await request(app).get("/api/teams/nonexistent");
      expect(res.status).toBe(404);
    });
  });

  describe("POST /event/:eventId/signup", () => {
    it("should create a new team", async () => {
      Event.findById.mockResolvedValue({ _id: "event1", isTournament: true });
      Team.findOne.mockResolvedValue(null);
      Team.mockImplementation(function (data) {
        Object.assign(this, data);
        this.save = jest.fn().mockResolvedValue(true);
      });

      const res = await request(app)
        .post("/api/teams/event/event1/signup")
        .send({
          name: "Team A",
          members: [{ name: "Player 1" }],
          manager: { name: "Manager", email: "m@test.com" },
        });

      expect(Event.findById).toHaveBeenCalledWith("event1");
      expect(res.status).toBe(201);
      expect(res.body.message).toBe("Team signed up successfully");
    });

    it("should update existing unpaid team", async () => {
      Event.findById.mockResolvedValue({ _id: "event1", isTournament: true });
      const existingTeam = {
        _id: "t1",
        name: "Old Name",
        members: [],
        manager: {},
        save: jest.fn().mockResolvedValue(true),
      };
      Team.findOne.mockResolvedValue(existingTeam);

      const res = await request(app)
        .post("/api/teams/event/event1/signup")
        .send({
          name: "New Name",
          members: [{ name: "Player 1" }],
          manager: { name: "Manager", email: "m@test.com" },
        });

      expect(Event.findById).toHaveBeenCalledWith("event1");
      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Existing team updated");
      expect(existingTeam.name).toBe("New Name");
    });

    it("should return 400 if members missing", async () => {
      const res = await request(app)
        .post("/api/teams/event/event1/signup")
        .send({ name: "Team A", members: [] });

      expect(res.status).toBe(400);
    });
  });

  describe("POST /:teamId/pay", () => {
    it("should create a checkout session", async () => {
      Team.findById.mockResolvedValue({
        _id: "t1",
        event: "event1",
        manager: { email: "m@test.com" },
        name: "Team A",
        members: [{ name: "P1" }],
      });
      Event.findById.mockResolvedValue({
        _id: "event1",
        title: "Football",
        ticketPrice: 10,
      });

      const res = await request(app).post("/api/teams/t1/pay");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("url");
    });

    it("should return 404 if team not found", async () => {
      Team.findById.mockResolvedValue(null);

      const res = await request(app).post("/api/teams/nonexistent/pay");
      expect(res.status).toBe(404);
    });
  });

  describe("GET /:teamId/cancel", () => {
    it("should delete unpaid team and redirect", async () => {
      Team.findById.mockResolvedValue({ _id: "t1", paid: false, event: "event1" });
      Team.findByIdAndDelete.mockResolvedValue(true);

      const res = await request(app).get("/api/teams/t1/cancel");
      expect(res.status).toBe(302);
      expect(Team.findByIdAndDelete).toHaveBeenCalledWith("t1");
    });

    it("should not delete paid team", async () => {
      Team.findById.mockResolvedValue({ _id: "t1", paid: true, event: "event1" });

      const res = await request(app).get("/api/teams/t1/cancel");
      expect(res.status).toBe(302);
      expect(Team.findByIdAndDelete).not.toHaveBeenCalled();
    });
  });

  describe("GET /event/:eventId/unpaid", () => {
    it("should return unpaid teams for manager", async () => {
      Team.find.mockResolvedValue([{ _id: "t1", name: "Team A" }]);

      // Email is sourced from req.user (set by auth middleware), not query params
      const res = await request(app).get("/api/teams/event/event1/unpaid");

      expect(res.status).toBe(200);
      expect(res.body.teams).toHaveLength(1);
    });

    it("should return empty array when no unpaid teams found", async () => {
      Team.find.mockResolvedValue([]);

      const res = await request(app).get("/api/teams/event/event1/unpaid");

      expect(res.status).toBe(200);
      expect(res.body.teams).toHaveLength(0);
    });
  });

  describe("GET /event/:eventId/teams", () => {
    it("should return paid teams for event", async () => {
      Team.find.mockResolvedValue([{ _id: "t1", name: "Team A", paid: true }]);

      const res = await request(app).get("/api/teams/event/event1/teams");
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });
  });
});
