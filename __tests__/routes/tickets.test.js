const request = require("supertest");
const express = require("express");

// Mock models before requiring the route
jest.mock("../../models/Ticket");
jest.mock("../../models/Event");

// Mock authMiddleware to inject a fake user
jest.mock("../../middleware/authMiddleware", () => (req, res, next) => {
  // Default authenticated user — tests can override via custom header
  req.user = {
    id: req.headers["x-test-user-id"] || "user123",
    email: req.headers["x-test-user-email"] || "buyer@test.com",
    role: req.headers["x-test-user-role"] || "user",
  };
  next();
});

// Mock authorize to pass through (auth is tested separately)
jest.mock("../../middleware/authorize", () => () => (req, res, next) => next());

const Ticket = require("../../models/Ticket");
const Event = require("../../models/Event");
const ticketRoutes = require("../../routes/tickets");

describe("Ticket Routes — Integration", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();

    app = express();
    app.use(express.json());
    app.use("/api/tickets", ticketRoutes);
  });

  // ─── POST / — Buy a ticket ────────────────────────────────────────────────

  describe("POST /api/tickets", () => {
    it("should buy a ticket and decrement available count", async () => {
      const mockEvent = {
        _id: "event1",
        ticketsAvailable: 10,
        save: jest.fn().mockResolvedValue(true),
      };
      Event.findById.mockResolvedValue(mockEvent);

      const mockTicket = {
        _id: "ticket1",
        eventId: "event1",
        buyerEmail: "buyer@test.com",
        user: "user123",
        status: "pending",
        toJSON: function () {
          return this;
        },
      };
      Ticket.mockImplementation(function (data) {
        Object.assign(this, mockTicket, data);
        this.save = jest.fn().mockResolvedValue(true);
      });

      const res = await request(app)
        .post("/api/tickets")
        .send({ eventId: "event1", buyerEmail: "buyer@test.com" });

      expect(res.status).toBe(201);
      expect(mockEvent.ticketsAvailable).toBe(9);
      expect(mockEvent.save).toHaveBeenCalled();
    });

    it("should return 404 if event not found", async () => {
      Event.findById.mockResolvedValue(null);

      const res = await request(app)
        .post("/api/tickets")
        .send({ eventId: "nope", buyerEmail: "buyer@test.com" });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Event not found");
    });

    it("should return 400 if tickets sold out", async () => {
      Event.findById.mockResolvedValue({ _id: "event1", ticketsAvailable: 0 });

      const res = await request(app)
        .post("/api/tickets")
        .send({ eventId: "event1", buyerEmail: "buyer@test.com" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Tickets sold out");
    });
  });

  // ─── GET / — Aggregated tickets ───────────────────────────────────────────

  describe("GET /api/tickets", () => {
    it("should return aggregated ticket data", async () => {
      const mockTickets = [
        {
          status: "paid",
          eventId: { _id: "e1", title: "Football", ticketPrice: 10 },
        },
        {
          status: "paid",
          eventId: { _id: "e1", title: "Football", ticketPrice: 10 },
        },
        {
          status: "failed",
          eventId: { _id: "e1", title: "Football", ticketPrice: 10 },
        },
      ];
      Ticket.find.mockReturnValue({
        populate: jest.fn().mockResolvedValue(mockTickets),
      });

      const res = await request(app).get("/api/tickets");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].ticketsSold).toBe(2);
      expect(res.body[0].ticketsCanceled).toBe(1);
      expect(res.body[0].totalRevenue).toBe(20);
    });

    it("should skip tickets with no event populated", async () => {
      const mockTickets = [
        { status: "paid", eventId: null },
        {
          status: "paid",
          eventId: { _id: "e1", title: "Football", ticketPrice: 5 },
        },
      ];
      Ticket.find.mockReturnValue({
        populate: jest.fn().mockResolvedValue(mockTickets),
      });

      const res = await request(app).get("/api/tickets");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].ticketsSold).toBe(1);
    });

    it("should return empty array when no tickets", async () => {
      Ticket.find.mockReturnValue({
        populate: jest.fn().mockResolvedValue([]),
      });

      const res = await request(app).get("/api/tickets");

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  // ─── GET /verify/:ticketCode — Public ticket verification ─────────────────

  describe("GET /api/tickets/verify/:ticketCode", () => {
    it("should return ticket details", async () => {
      const mockTicket = {
        _id: "t1",
        ticketCode: "TKT-ABC123",
        buyerEmail: "buyer@test.com",
        checkedIn: false,
      };
      Ticket.findOne.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(mockTicket),
        }),
      });

      const res = await request(app).get("/api/tickets/verify/TKT-ABC123");

      expect(res.status).toBe(200);
      expect(res.body.ticketCode).toBe("TKT-ABC123");
    });

    it("should return 404 if ticket code not found", async () => {
      Ticket.findOne.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(null),
        }),
      });

      const res = await request(app).get("/api/tickets/verify/TKT-NOPE");

      expect(res.status).toBe(404);
      expect(res.body.message).toBe("Ticket not found");
    });
  });

  // ─── POST /verify/:ticketCode/checkin — Check-in flow ─────────────────────

  describe("POST /api/tickets/verify/:ticketCode/checkin", () => {
    it("should check in a ticket for the first time", async () => {
      const mockTicket = {
        _id: "t1",
        ticketCode: "TKT-ABC123",
        checkedIn: false,
        checkedInAt: null,
        save: jest.fn().mockResolvedValue(true),
        populate: jest.fn().mockResolvedValue(true),
        toObject: function () {
          return {
            _id: this._id,
            ticketCode: this.ticketCode,
            checkedIn: this.checkedIn,
            checkedInAt: this.checkedInAt,
          };
        },
      };
      Ticket.findOne.mockResolvedValue(mockTicket);

      const res = await request(app).post("/api/tickets/verify/TKT-ABC123/checkin");

      expect(res.status).toBe(200);
      expect(mockTicket.checkedIn).toBe(true);
      expect(mockTicket.checkedInAt).toBeInstanceOf(Date);
      expect(res.body.wasAlreadyCheckedIn).toBe(false);
      expect(mockTicket.save).toHaveBeenCalled();
    });

    it("should not update checkedInAt on second check-in (idempotent)", async () => {
      const originalTime = new Date("2025-01-01T10:00:00Z");
      const mockTicket = {
        _id: "t1",
        ticketCode: "TKT-ABC123",
        checkedIn: true,
        checkedInAt: originalTime,
        save: jest.fn().mockResolvedValue(true),
        populate: jest.fn().mockResolvedValue(true),
        toObject: function () {
          return {
            _id: this._id,
            ticketCode: this.ticketCode,
            checkedIn: this.checkedIn,
            checkedInAt: this.checkedInAt,
          };
        },
      };
      Ticket.findOne.mockResolvedValue(mockTicket);

      const res = await request(app).post("/api/tickets/verify/TKT-ABC123/checkin");

      expect(res.status).toBe(200);
      expect(res.body.wasAlreadyCheckedIn).toBe(true);
      expect(res.body.originalCheckedInAt).toBe(originalTime.toISOString());
      // checkedInAt should NOT be changed
      expect(mockTicket.checkedInAt).toBe(originalTime);
    });

    it("should return 404 if ticket not found", async () => {
      Ticket.findOne.mockResolvedValue(null);

      const res = await request(app).post("/api/tickets/verify/TKT-NOPE/checkin");

      expect(res.status).toBe(404);
      expect(res.body.message).toBe("Ticket not found");
    });
  });

  // ─── GET /by-payment/:paymentId — Ownership check ─────────────────────────

  describe("GET /api/tickets/by-payment/:paymentId", () => {
    it("should return tickets for owner", async () => {
      const mockTickets = [
        {
          _id: "t1",
          buyerEmail: "buyer@test.com",
          user: { _id: "user123" },
          paymentId: "cs_123",
        },
      ];
      Ticket.find.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(mockTickets),
        }),
      });

      const res = await request(app)
        .get("/api/tickets/by-payment/cs_123")
        .set("x-test-user-email", "buyer@test.com");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });

    it("should allow staff access even if not owner", async () => {
      const mockTickets = [
        {
          _id: "t1",
          buyerEmail: "other@test.com",
          user: { _id: "otherUser" },
          paymentId: "cs_123",
        },
      ];
      Ticket.find.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(mockTickets),
        }),
      });

      const res = await request(app)
        .get("/api/tickets/by-payment/cs_123")
        .set("x-test-user-role", "admin")
        .set("x-test-user-email", "admin@test.com");

      expect(res.status).toBe(200);
    });

    it("should return 403 for non-owner non-staff", async () => {
      const mockTickets = [
        {
          _id: "t1",
          buyerEmail: "other@test.com",
          user: { _id: { toString: () => "otherUser" } },
          paymentId: "cs_123",
        },
      ];
      Ticket.find.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(mockTickets),
        }),
      });

      const res = await request(app)
        .get("/api/tickets/by-payment/cs_123")
        .set("x-test-user-email", "intruder@test.com")
        .set("x-test-user-id", "intruder");

      expect(res.status).toBe(403);
      expect(res.body.message).toBe("Access denied");
    });

    it("should return 404 if no tickets for payment", async () => {
      Ticket.find.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue([]),
        }),
      });

      const res = await request(app).get("/api/tickets/by-payment/cs_nope");

      expect(res.status).toBe(404);
    });
  });

  // ─── GET /:id — Single ticket by ID with ownership check ──────────────────

  describe("GET /api/tickets/:id", () => {
    it("should return ticket for owner", async () => {
      const mockTicket = {
        _id: "t1",
        buyerEmail: "buyer@test.com",
        user: { _id: { toString: () => "user123" } },
      };
      Ticket.findById.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(mockTicket),
        }),
      });

      const res = await request(app).get("/api/tickets/t1");

      expect(res.status).toBe(200);
    });

    it("should return 404 if ticket not found", async () => {
      Ticket.findById.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(null),
        }),
      });

      const res = await request(app).get("/api/tickets/nope");

      expect(res.status).toBe(404);
    });

    it("should return 403 for non-owner", async () => {
      const mockTicket = {
        _id: "t1",
        buyerEmail: "other@test.com",
        user: { _id: { toString: () => "otherUser" } },
      };
      Ticket.findById.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(mockTicket),
        }),
      });

      const res = await request(app)
        .get("/api/tickets/t1")
        .set("x-test-user-email", "intruder@test.com")
        .set("x-test-user-id", "intruder");

      expect(res.status).toBe(403);
    });
  });
});
