const request = require("supertest");
const express = require("express");

// Mock models
jest.mock("../../models/Ticket");
jest.mock("../../models/Event");
jest.mock("../../models/User");

// Mock auth middleware — pass through for tests
jest.mock("../../middleware/authMiddleware", () => (req, res, next) => {
  req.user = { id: "testUser123", role: "user", email: "buyer@test.com" };
  next();
});

// Mock stripe — must happen before requiring the route
const mockStripe = {
  checkout: {
    sessions: {
      create: jest.fn(),
      retrieve: jest.fn(),
    },
  },
};
jest.mock("stripe", () => jest.fn(() => mockStripe));

const Ticket = require("../../models/Ticket");
const Event = require("../../models/Event");
const User = require("../../models/User");
const paymentRoutes = require("../../routes/payments");

describe("Payment Routes — Integration", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.BACK_END_URL = "http://localhost:5000/";
    process.env.FRONT_END_URL = "http://localhost:5173/";

    app = express();
    app.use(express.json());
    app.use("/api/payments", paymentRoutes);
  });

  // ─── POST /create-checkout-session ─────────────────────────────────────────

  describe("POST /api/payments/create-checkout-session", () => {
    it("should create a Stripe checkout session", async () => {
      Event.findById.mockResolvedValue({
        _id: "event1",
        title: "Football",
        shortDescription: "Practice",
        ticketPrice: 10,
        ticketsAvailable: 50,
      });

      mockStripe.checkout.sessions.create.mockResolvedValue({
        url: "https://checkout.stripe.com/pay/cs_test_123",
      });

      const res = await request(app)
        .post("/api/payments/create-checkout-session")
        .send({ eventId: "event1", email: "buyer@test.com", quantity: 2 });

      expect(res.status).toBe(200);
      expect(res.body.url).toBe("https://checkout.stripe.com/pay/cs_test_123");

      // Verify Stripe was called with correct amount (10 * 100 = 1000 pence)
      expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payment_method_types: ["card"],
          customer_email: "buyer@test.com",
          mode: "payment",
          line_items: [
            expect.objectContaining({
              price_data: expect.objectContaining({
                unit_amount: 1000,
                currency: "gbp",
              }),
              quantity: 2,
            }),
          ],
          metadata: expect.objectContaining({
            eventId: "event1",
            email: "buyer@test.com",
            quantity: "2",
          }),
        })
      );
    });

    it("should return 400 if required fields are missing", async () => {
      const res = await request(app)
        .post("/api/payments/create-checkout-session")
        .send({ eventId: "event1" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("eventId and quantity are required");
    });

    it("should return 404 if event not found", async () => {
      Event.findById.mockResolvedValue(null);

      const res = await request(app)
        .post("/api/payments/create-checkout-session")
        .send({ eventId: "nope", email: "b@test.com", quantity: 1 });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Event not found");
    });

    it("should return 400 if not enough tickets available", async () => {
      Event.findById.mockResolvedValue({
        _id: "event1",
        title: "Football",
        ticketPrice: 10,
        ticketsAvailable: 1,
      });

      const res = await request(app)
        .post("/api/payments/create-checkout-session")
        .send({ eventId: "event1", email: "b@test.com", quantity: 5 });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Not enough tickets available");
    });

    it("should return 500 if Stripe fails", async () => {
      Event.findById.mockResolvedValue({
        _id: "event1",
        title: "Football",
        ticketPrice: 10,
        ticketsAvailable: 50,
      });
      mockStripe.checkout.sessions.create.mockRejectedValue(new Error("Stripe down"));

      const res = await request(app)
        .post("/api/payments/create-checkout-session")
        .send({ eventId: "event1", email: "b@test.com", quantity: 1 });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Failed to create checkout session");
    });
  });

  // ─── GET /success — Payment confirmation + ticket creation ─────────────────

  describe("GET /api/payments/success", () => {
    it("should create tickets and update event on successful payment", async () => {
      mockStripe.checkout.sessions.retrieve.mockResolvedValue({
        id: "cs_test_123",
        payment_status: "paid",
        metadata: { email: "buyer@test.com", quantity: "2", eventId: "event1" },
        amount_total: 2000, // 20 GBP in pence
      });

      // No existing ticket (first time processing)
      Ticket.findOne.mockResolvedValue(null);

      // User lookup
      User.findOne.mockResolvedValue({ _id: "user1" });

      // Ticket creation — track all created tickets
      const createdTickets = [];
      Ticket.mockImplementation(function (data) {
        const ticketId = `ticket_${createdTickets.length + 1}`;
        Object.assign(this, data);
        this._id = ticketId;
        this.save = jest.fn().mockResolvedValue(true);
        createdTickets.push(this);
      });

      // Event lookup and update
      const mockEvent = {
        _id: "event1",
        ticketsAvailable: 50,
        totalRevenue: 100,
        save: jest.fn().mockResolvedValue(true),
      };
      Event.findById.mockResolvedValue(mockEvent);

      const res = await request(app)
        .get("/api/payments/success")
        .query({ session_id: "cs_test_123", eventId: "event1" });

      // Should redirect to frontend confirmation
      expect(res.status).toBe(302);
      expect(res.headers.location).toMatch(/order-confirmation/);

      // Should create 2 tickets (quantity = 2)
      expect(createdTickets).toHaveLength(2);
      expect(createdTickets[0].buyerEmail).toBe("buyer@test.com");
      expect(createdTickets[0].paymentId).toBe("cs_test_123");
      expect(createdTickets[0].status).toBe("paid");
      expect(createdTickets[0].user).toBe("user1");

      // Should update event revenue and ticket count atomically
      expect(Event.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: "event1" },
        { $inc: { totalRevenue: 20 } }
      );
      expect(Event.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: "event1", ticketsAvailable: { $gte: 2 } },
        { $inc: { ticketsAvailable: -2 } }
      );
    });

    it("should be idempotent — redirect without creating duplicates on refresh", async () => {
      mockStripe.checkout.sessions.retrieve.mockResolvedValue({
        id: "cs_test_123",
        payment_status: "paid",
        metadata: { email: "buyer@test.com", quantity: "1" },
        amount_total: 1000,
      });

      // Existing ticket found — already processed
      Ticket.findOne.mockResolvedValue({ _id: "existing_ticket" });

      const res = await request(app)
        .get("/api/payments/success")
        .query({ session_id: "cs_test_123", eventId: "event1" });

      expect(res.status).toBe(302);
      expect(res.headers.location).toMatch(/ticket_id=existing_ticket/);

      // Ticket constructor should NOT have been called
      expect(Ticket).not.toHaveBeenCalled();
    });

    it("should return 400 if session_id is missing", async () => {
      const res = await request(app).get("/api/payments/success").query({ eventId: "event1" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Missing session_id");
    });

    it("should return 400 if payment not completed", async () => {
      mockStripe.checkout.sessions.retrieve.mockResolvedValue({
        id: "cs_test_123",
        payment_status: "unpaid",
      });

      const res = await request(app)
        .get("/api/payments/success")
        .query({ session_id: "cs_test_123", eventId: "event1" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Payment not completed");
    });

    it("should handle missing user gracefully (anonymous purchase)", async () => {
      mockStripe.checkout.sessions.retrieve.mockResolvedValue({
        id: "cs_test_456",
        payment_status: "paid",
        metadata: { email: "anon@test.com", quantity: "1" },
        amount_total: 1000,
      });

      Ticket.findOne.mockResolvedValue(null);
      User.findOne.mockResolvedValue(null); // No registered user

      Ticket.mockImplementation(function (data) {
        Object.assign(this, data);
        this._id = "ticket_anon";
        this.save = jest.fn().mockResolvedValue(true);
      });

      Event.findById.mockResolvedValue({
        _id: "event1",
        ticketsAvailable: 10,
        totalRevenue: 0,
        save: jest.fn().mockResolvedValue(true),
      });

      const res = await request(app)
        .get("/api/payments/success")
        .query({ session_id: "cs_test_456", eventId: "event1" });

      expect(res.status).toBe(302);
      // User should be null on the ticket
      const createdTicket = Ticket.mock.instances[0];
      expect(createdTicket.user).toBeNull();
    });

    it("should handle event not found gracefully (still creates tickets)", async () => {
      mockStripe.checkout.sessions.retrieve.mockResolvedValue({
        id: "cs_test_789",
        payment_status: "paid",
        metadata: { email: "buyer@test.com", quantity: "1" },
        amount_total: 500,
      });

      Ticket.findOne.mockResolvedValue(null);
      User.findOne.mockResolvedValue({ _id: "user1" });

      Ticket.mockImplementation(function (data) {
        Object.assign(this, data);
        this._id = "ticket_no_event";
        this.save = jest.fn().mockResolvedValue(true);
      });

      Event.findById.mockResolvedValue(null); // Event deleted after payment

      const res = await request(app)
        .get("/api/payments/success")
        .query({ session_id: "cs_test_789", eventId: "event_gone" });

      // Should still redirect (ticket was created)
      expect(res.status).toBe(302);
    });
  });

  // ─── GET /session/:sessionId — Retrieve session details ────────────────────

  describe("GET /api/payments/session/:sessionId", () => {
    it("should return formatted session details", async () => {
      mockStripe.checkout.sessions.retrieve.mockResolvedValue({
        customer_email: "buyer@test.com",
        amount_total: 2000,
        currency: "gbp",
        payment_status: "paid",
        metadata: { eventId: "event1", quantity: "2" },
      });

      const res = await request(app).get("/api/payments/session/cs_test_123");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        customerEmail: "buyer@test.com",
        amountTotal: 20, // 2000 / 100
        currency: "gbp",
        paymentStatus: "paid",
        eventId: "event1",
        quantity: "2",
      });
    });

    it("should return 500 if Stripe retrieval fails", async () => {
      mockStripe.checkout.sessions.retrieve.mockRejectedValue(new Error("Not found"));

      const res = await request(app).get("/api/payments/session/cs_bad");

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Failed to retrieve session");
    });
  });
});
