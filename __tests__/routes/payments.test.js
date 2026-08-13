const request = require("supertest");
const express = require("express");
const mongoose = require("mongoose");
const dns = require("dns");

// Mock DNS — default: valid domain. Override per-test with mockResolveMx.
const mockResolveMx = jest.spyOn(dns, "resolveMx").mockImplementation((_domain, cb) => {
  cb(null, [{ exchange: "mx.test.com", priority: 10 }]);
});

// Mock models
jest.mock("../../models/Ticket");
jest.mock("../../models/Event");
jest.mock("../../models/EventSubscription");
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
  refunds: {
    create: jest.fn(),
  },
};
jest.mock("stripe", () => jest.fn(() => mockStripe));

// Mock email util
jest.mock("../../utils/emailUtils", () => ({
  sendTicketConfirmationEmail: jest.fn().mockResolvedValue(true),
}));

const Ticket = require("../../models/Ticket");
const Event = require("../../models/Event");
const EventSubscription = require("../../models/EventSubscription");
const User = require("../../models/User");
const paymentRoutes = require("../../routes/payments");

// Reusable valid ObjectIds
const validEventId = new mongoose.Types.ObjectId().toString();

// Mock mongoose session for transactions
const mockMongoSession = {
  withTransaction: jest.fn(async (fn) => fn()),
  endSession: jest.fn(),
};

beforeEach(() => {
  jest.spyOn(mongoose, "startSession").mockResolvedValue(mockMongoSession);
});

describe("Payment Routes — Integration", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    // Re-mock startSession after clearAllMocks
    jest.spyOn(mongoose, "startSession").mockResolvedValue(mockMongoSession);
    mockMongoSession.withTransaction.mockImplementation(async (fn) => fn());
    // Re-mock DNS after clearAllMocks
    mockResolveMx.mockImplementation((_domain, cb) => {
      cb(null, [{ exchange: "mx.test.com", priority: 10 }]);
    });

    app = express();
    app.use(express.json());
    app.use("/api/payments", paymentRoutes);
  });

  // ─── POST /create-checkout-session ──────────────────────────────────────────

  describe("POST /api/payments/create-checkout-session", () => {
    it("should create a Stripe checkout session", async () => {
      Event.findById.mockResolvedValue({
        _id: validEventId,
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
        .send({ eventId: validEventId, quantity: 2 });

      expect(res.status).toBe(200);
      expect(res.body.url).toBe("https://checkout.stripe.com/pay/cs_test_123");

      // Verify Stripe was called with correct amount (10 * 100 = 1000 pence)
      expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
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
            eventId: validEventId,
            email: "buyer@test.com",
            quantity: "2",
          }),
        }),
        expect.objectContaining({ idempotencyKey: expect.any(String) })
      );
    });

    it("should return 400 for missing eventId", async () => {
      const res = await request(app)
        .post("/api/payments/create-checkout-session")
        .send({ quantity: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("eventId is required");
    });

    it("should return 400 for invalid eventId", async () => {
      const res = await request(app)
        .post("/api/payments/create-checkout-session")
        .send({ eventId: "not-valid", quantity: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid event ID");
    });

    it("should return 400 for invalid quantity", async () => {
      const res = await request(app)
        .post("/api/payments/create-checkout-session")
        .send({ eventId: validEventId, quantity: 0 });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("quantity must be a positive integer");
    });

    it("should return 404 for nonexistent event", async () => {
      Event.findById.mockResolvedValue(null);

      const res = await request(app)
        .post("/api/payments/create-checkout-session")
        .send({ eventId: validEventId, quantity: 1 });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Event not found");
    });

    it("should return 400 when not enough tickets available", async () => {
      Event.findById.mockResolvedValue({
        _id: validEventId,
        ticketsAvailable: 1,
        ticketPrice: 10,
      });

      const res = await request(app)
        .post("/api/payments/create-checkout-session")
        .send({ eventId: validEventId, quantity: 5 });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Not enough tickets available");
    });

    it("should create a subscription checkout for recurring events", async () => {
      Event.findById.mockResolvedValue({
        _id: validEventId,
        title: "Weekly Football",
        shortDescription: "Practice",
        ticketPrice: 15,
        ticketsAvailable: 50,
        isReoccurring: true,
        stripePriceId: "price_recurring_123",
      });

      // No existing active subscription
      EventSubscription.findOne.mockResolvedValue(null);

      mockStripe.checkout.sessions.create.mockResolvedValue({
        id: "cs_sub_123",
        url: "https://checkout.stripe.com/pay/cs_sub_123",
      });

      // Mock EventSubscription constructor for pending record creation
      EventSubscription.mockImplementation(function (data) {
        Object.assign(this, data);
        this.save = jest.fn().mockResolvedValue(true);
      });

      User.findOne.mockResolvedValue({ _id: "user1" });

      const res = await request(app)
        .post("/api/payments/create-checkout-session")
        .send({ eventId: validEventId, quantity: 1 });

      expect(res.status).toBe(200);
      expect(res.body.url).toBe("https://checkout.stripe.com/pay/cs_sub_123");

      expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "subscription",
          line_items: [{ price: "price_recurring_123", quantity: 1 }],
          success_url: expect.stringContaining("subscription-success"),
        }),
        expect.objectContaining({ idempotencyKey: expect.any(String) })
      );

      // Verify pending EventSubscription was created
      const created = EventSubscription.mock.instances[0];
      expect(created.pendingSessionId).toBe("cs_sub_123");
      expect(created.status).toBe("pending");
      expect(created.eventId.toString()).toBe(validEventId);
    });

    it("should return 400 if user already has active subscription", async () => {
      Event.findById.mockResolvedValue({
        _id: validEventId,
        title: "Weekly Football",
        ticketPrice: 15,
        ticketsAvailable: 50,
        isReoccurring: true,
        stripePriceId: "price_recurring_123",
      });

      EventSubscription.findOne.mockResolvedValue({
        _id: "existing_sub",
        status: "active",
      });

      const res = await request(app)
        .post("/api/payments/create-checkout-session")
        .send({ eventId: validEventId, quantity: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/already have an active subscription/);
    });

    it("should use one-time payment for recurring events without stripePriceId", async () => {
      Event.findById.mockResolvedValue({
        _id: validEventId,
        title: "Weekly Football",
        shortDescription: "Practice",
        ticketPrice: 15,
        ticketsAvailable: 50,
        isReoccurring: true,
        stripePriceId: null,
      });

      mockStripe.checkout.sessions.create.mockResolvedValue({
        url: "https://checkout.stripe.com/pay/cs_onetime",
      });

      const res = await request(app)
        .post("/api/payments/create-checkout-session")
        .send({ eventId: validEventId, quantity: 1 });

      expect(res.status).toBe(200);
      expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({ mode: "payment" }),
        expect.objectContaining({ idempotencyKey: expect.any(String) })
      );
    });
  });

  // ─── GET /success — Payment confirmation + ticket creation ─────────────────

  describe("GET /api/payments/success", () => {
    it("should create tickets and update event atomically on successful payment", async () => {
      mockStripe.checkout.sessions.retrieve.mockResolvedValue({
        id: "cs_test_123",
        payment_status: "paid",
        metadata: { email: "buyer@test.com", quantity: "2", eventId: validEventId },
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

      // Event findOneAndUpdate inside transaction — returns updated event
      Event.findOneAndUpdate.mockResolvedValue({
        _id: validEventId,
        ticketsAvailable: 48,
        totalRevenue: 120,
      });

      // Event.findById for email (after transaction)
      Event.findById.mockResolvedValue({ _id: validEventId, title: "Football" });
      // Ticket.find for email
      Ticket.find.mockReturnValue({ paymentId: "cs_test_123" });

      const res = await request(app)
        .get("/api/payments/success")
        .query({ session_id: "cs_test_123", eventId: validEventId });

      // Should redirect to frontend confirmation
      expect(res.status).toBe(302);
      expect(res.headers.location).toMatch(/order-confirmation/);

      // Should create 2 tickets (quantity = 2)
      expect(createdTickets).toHaveLength(2);
      expect(createdTickets[0].buyerEmail).toBe("buyer@test.com");
      expect(createdTickets[0].paymentId).toBe("cs_test_123");
      expect(createdTickets[0].status).toBe("paid");
      expect(createdTickets[0].user).toBe("user1");

      // Should update event in a single atomic operation
      expect(Event.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: validEventId, ticketsAvailable: { $gte: 2 } },
        { $inc: { ticketsAvailable: -2, totalRevenue: 20 } },
        { session: mockMongoSession, new: true }
      );

      // Transaction should have been used
      expect(mongoose.startSession).toHaveBeenCalled();
      expect(mockMongoSession.endSession).toHaveBeenCalled();
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
        .query({ session_id: "cs_test_123", eventId: validEventId });

      expect(res.status).toBe(302);
      expect(res.headers.location).toMatch(/ticket_id=existing_ticket/);

      // Ticket constructor should NOT have been called
      expect(Ticket).not.toHaveBeenCalled();
    });

    it("should return 400 if session_id is missing", async () => {
      const res = await request(app).get("/api/payments/success").query({ eventId: validEventId });

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
        .query({ session_id: "cs_test_123", eventId: validEventId });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Payment not completed");
    });

    it("should handle missing user gracefully (anonymous purchase)", async () => {
      mockStripe.checkout.sessions.retrieve.mockResolvedValue({
        id: "cs_test_456",
        payment_status: "paid",
        metadata: { email: "anon@test.com", quantity: "1", eventId: validEventId },
        amount_total: 1000,
      });

      Ticket.findOne.mockResolvedValue(null);
      User.findOne.mockResolvedValue(null); // No registered user

      Ticket.mockImplementation(function (data) {
        Object.assign(this, data);
        this._id = "ticket_anon";
        this.save = jest.fn().mockResolvedValue(true);
      });

      Event.findOneAndUpdate.mockResolvedValue({ _id: validEventId, ticketsAvailable: 9 });
      Event.findById.mockResolvedValue({ _id: validEventId, title: "Football" });
      Ticket.find.mockReturnValue([]);

      const res = await request(app)
        .get("/api/payments/success")
        .query({ session_id: "cs_test_456", eventId: validEventId });

      expect(res.status).toBe(302);
      // User should be null on the ticket
      const createdTicket = Ticket.mock.instances[0];
      expect(createdTicket.user).toBeNull();
    });

    it("should refund and redirect when tickets unavailable", async () => {
      mockStripe.checkout.sessions.retrieve.mockResolvedValue({
        id: "cs_test_sold_out",
        payment_status: "paid",
        payment_intent: "pi_test_123",
        metadata: { email: "buyer@test.com", quantity: "2", eventId: validEventId },
        amount_total: 2000,
      });

      Ticket.findOne.mockResolvedValue(null);
      User.findOne.mockResolvedValue({ _id: "user1" });

      // Transaction fails — not enough tickets
      mockMongoSession.withTransaction.mockImplementation(async (fn) => {
        // Simulate the transaction throwing
        Event.findOneAndUpdate.mockResolvedValue(null);
        await fn();
      });

      Ticket.mockImplementation(function (data) {
        Object.assign(this, data);
        this._id = "ticket_fail";
        this.save = jest.fn().mockResolvedValue(true);
      });

      mockStripe.refunds.create.mockResolvedValue({ id: "re_test" });

      const res = await request(app)
        .get("/api/payments/success")
        .query({ session_id: "cs_test_sold_out", eventId: validEventId });

      expect(res.status).toBe(302);
      expect(res.headers.location).toMatch(/error=tickets_unavailable/);
      expect(mockStripe.refunds.create).toHaveBeenCalledWith({
        payment_intent: "pi_test_123",
      });
    });

    it("should refund and redirect when email domain has no MX records", async () => {
      mockResolveMx.mockImplementationOnce((_domain, cb) => {
        cb(new Error("ENOTFOUND"), null);
      });

      mockStripe.checkout.sessions.retrieve.mockResolvedValue({
        id: "cs_bad_email",
        payment_status: "paid",
        payment_intent: "pi_bad_email",
        metadata: { email: "user@fake-domain.xyz", quantity: "1", eventId: validEventId },
        amount_total: 1000,
      });

      Ticket.findOne.mockResolvedValue(null);
      mockStripe.refunds.create.mockResolvedValue({ id: "re_email" });

      const res = await request(app)
        .get("/api/payments/success")
        .query({ session_id: "cs_bad_email", eventId: validEventId });

      expect(res.status).toBe(302);
      expect(res.headers.location).toMatch(/error=invalid_email/);
      expect(mockStripe.refunds.create).toHaveBeenCalledWith({
        payment_intent: "pi_bad_email",
      });

      // Should NOT create any tickets
      expect(Ticket).not.toHaveBeenCalled();
      expect(mongoose.startSession).not.toHaveBeenCalled();
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
        metadata: { eventId: validEventId, quantity: "2" },
      });

      const res = await request(app).get("/api/payments/session/cs_test_123");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        customerEmail: "buyer@test.com",
        amountTotal: 20, // 2000 / 100
        currency: "gbp",
        paymentStatus: "paid",
        eventId: validEventId,
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

  // ─── GET /guest-order/:sessionId — Guest order lookup ──────────────────────

  describe("GET /api/payments/guest-order/:sessionId", () => {
    it("returns tickets and order details for a paid session", async () => {
      mockStripe.checkout.sessions.retrieve.mockResolvedValue({
        id: "cs_test_123",
        payment_status: "paid",
        customer_email: "guest@test.com",
        amount_total: 2000,
        metadata: { quantity: "2" },
      });

      Ticket.find.mockReturnValue({
        populate: jest.fn().mockResolvedValue([{ _id: "t1" }, { _id: "t2" }]),
      });

      const res = await request(app).get("/api/payments/guest-order/cs_test_123");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        tickets: [{ _id: "t1" }, { _id: "t2" }],
        email: "guest@test.com",
        amountTotal: 20,
        quantity: 2,
      });
    });

    it("returns 404 when the session was not paid", async () => {
      mockStripe.checkout.sessions.retrieve.mockResolvedValue({
        id: "cs_unpaid",
        payment_status: "unpaid",
      });

      const res = await request(app).get("/api/payments/guest-order/cs_unpaid");

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Order not found");
    });

    it("returns 404 when no tickets exist for the session", async () => {
      mockStripe.checkout.sessions.retrieve.mockResolvedValue({
        id: "cs_test_456",
        payment_status: "paid",
      });
      Ticket.find.mockReturnValue({ populate: jest.fn().mockResolvedValue([]) });

      const res = await request(app).get("/api/payments/guest-order/cs_test_456");

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("No tickets found for this order");
    });

    it("returns 500 if Stripe retrieval fails", async () => {
      mockStripe.checkout.sessions.retrieve.mockRejectedValue(new Error("boom"));

      const res = await request(app).get("/api/payments/guest-order/cs_bad");

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Failed to fetch order details");
    });
  });
});
