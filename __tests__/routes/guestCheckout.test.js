const request = require("supertest");
const express = require("express");
const mongoose = require("mongoose");
const dns = require("dns");

// Mock DNS — default: valid domain. Override per-test with mockResolveMx.
const mockResolveMx = jest.spyOn(dns, "resolveMx").mockImplementation((_domain, cb) => {
  cb(null, [{ exchange: "mx.test.com", priority: 10 }]);
});

jest.mock("../../models/Ticket");
jest.mock("../../models/Event");
jest.mock("../../models/EventSubscription");
jest.mock("../../models/User");

// This route module attaches a shared rate limiter at require-time, so its
// hit counter persists across every test in this file regardless of the
// fresh express() app each test builds. Not what's under test here — mock
// it to a pass-through so route-handler behavior isn't at the mercy of how
// many requests earlier tests happened to make.
jest.mock("express-rate-limit", () => () => (req, res, next) => next());

// No auth middleware mock — guest route has no auth
const mockStripe = {
  checkout: {
    sessions: {
      create: jest.fn(),
      retrieve: jest.fn(),
    },
  },
  refunds: { create: jest.fn() },
};
jest.mock("stripe", () => jest.fn(() => mockStripe));

jest.mock("../../utils/emailUtils", () => ({
  sendTicketConfirmationEmail: jest.fn().mockResolvedValue(true),
}));

// Must mock authMiddleware so the router module can load (it's imported by payments.js)
jest.mock("../../middleware/authMiddleware", () => (req, res, next) => {
  req.user = { id: "testUser123", role: "user", email: "auth@test.com" };
  next();
});

const Event = require("../../models/Event");
const Ticket = require("../../models/Ticket");
const User = require("../../models/User");
const paymentRoutes = require("../../routes/ticketPayment");

const validEventId = new mongoose.Types.ObjectId().toString();

describe("Guest Checkout — POST /api/payments/guest-checkout-session", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use("/api/payments", paymentRoutes);
  });

  it("should create a checkout session for a guest with valid email", async () => {
    Event.findById.mockResolvedValue({
      _id: validEventId,
      title: "Football Match",
      shortDescription: "A match",
      ticketPrice: 10,
      ticketsAvailable: 50,
    });

    mockStripe.checkout.sessions.create.mockResolvedValue({
      url: "https://checkout.stripe.com/pay/cs_guest_123",
    });

    const res = await request(app)
      .post("/api/payments/guest-checkout-session")
      .send({ eventId: validEventId, quantity: 2, email: "guest@example.com" });

    expect(res.status).toBe(200);
    expect(res.body.url).toBe("https://checkout.stripe.com/pay/cs_guest_123");

    expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customer_email: "guest@example.com",
        mode: "payment",
        metadata: expect.objectContaining({
          email: "guest@example.com",
          quantity: "2",
        }),
      }),
      expect.objectContaining({ idempotencyKey: expect.any(String) })
    );
  });

  it("should normalise email to lowercase", async () => {
    Event.findById.mockResolvedValue({
      _id: validEventId,
      title: "Football",
      shortDescription: "Match",
      ticketPrice: 5,
      ticketsAvailable: 10,
    });

    mockStripe.checkout.sessions.create.mockResolvedValue({
      url: "https://checkout.stripe.com/pay/cs_123",
    });

    await request(app)
      .post("/api/payments/guest-checkout-session")
      .send({ eventId: validEventId, quantity: 1, email: "  Guest@Example.COM  " });

    expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customer_email: "guest@example.com",
      }),
      expect.any(Object)
    );
  });

  it("should return 400 when email is missing", async () => {
    const res = await request(app)
      .post("/api/payments/guest-checkout-session")
      .send({ eventId: validEventId, quantity: 1 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Email is required");
  });

  it("should return 400 when email is not a string", async () => {
    const res = await request(app)
      .post("/api/payments/guest-checkout-session")
      .send({ eventId: validEventId, quantity: 1, email: 12345 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Email is required");
  });

  it("should return 400 for invalid email format", async () => {
    const res = await request(app)
      .post("/api/payments/guest-checkout-session")
      .send({ eventId: validEventId, quantity: 1, email: "not-an-email" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid email address");
  });

  it("should return 403 when guest tries to subscribe to a recurring event", async () => {
    Event.findById.mockResolvedValue({
      _id: validEventId,
      title: "Weekly Football",
      ticketPrice: 15,
      ticketsAvailable: 50,
      isReoccurring: true,
      stripePriceId: "price_recurring_123",
    });

    const res = await request(app)
      .post("/api/payments/guest-checkout-session")
      .send({ eventId: validEventId, quantity: 1, email: "guest@example.com" });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Subscriptions require an account/);
    expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("should allow guest checkout for recurring events without stripePriceId", async () => {
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
      .post("/api/payments/guest-checkout-session")
      .send({ eventId: validEventId, quantity: 1, email: "guest@example.com" });

    expect(res.status).toBe(200);
    expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "payment" }),
      expect.any(Object)
    );
  });

  it("should pass through shared validation (missing eventId)", async () => {
    const res = await request(app)
      .post("/api/payments/guest-checkout-session")
      .send({ quantity: 1, email: "guest@example.com" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("eventId is required");
  });

  it("should pass through shared validation (invalid quantity)", async () => {
    const res = await request(app)
      .post("/api/payments/guest-checkout-session")
      .send({ eventId: validEventId, quantity: -1, email: "guest@example.com" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("quantity must be a positive integer");
  });

  it("should return 404 for nonexistent event", async () => {
    Event.findById.mockResolvedValue(null);

    const res = await request(app)
      .post("/api/payments/guest-checkout-session")
      .send({ eventId: validEventId, quantity: 1, email: "guest@example.com" });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Event not found");
  });

  it("should return 400 when email domain has no MX records", async () => {
    mockResolveMx.mockImplementationOnce((_domain, cb) => {
      cb(new Error("ENOTFOUND"), null);
    });

    // Use a fresh app without rate limiter to avoid 429
    const freshApp = express();
    freshApp.use(express.json());
    const { createGuestCheckoutSession } = require("../../controllers/ticketPaymentController");
    freshApp.post("/api/payments/guest-checkout-session", createGuestCheckoutSession);

    const res = await request(freshApp)
      .post("/api/payments/guest-checkout-session")
      .send({ eventId: validEventId, quantity: 1, email: "user@nonexistent-domain-xyz.fake" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/does not appear to accept emails/);
    expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("should return 400 when email domain has empty MX records", async () => {
    mockResolveMx.mockImplementationOnce((_domain, cb) => {
      cb(null, []);
    });

    const freshApp = express();
    freshApp.use(express.json());
    const { createGuestCheckoutSession } = require("../../controllers/ticketPaymentController");
    freshApp.post("/api/payments/guest-checkout-session", createGuestCheckoutSession);

    const res = await request(freshApp)
      .post("/api/payments/guest-checkout-session")
      .send({ eventId: validEventId, quantity: 1, email: "user@no-mx.example" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/does not appear to accept emails/);
  });
});

// ─── GET /guest-order/:sessionId ────────────────────────────────────────────

describe("Guest Order — GET /api/payments/guest-order/:sessionId", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveMx.mockImplementation((_domain, cb) => {
      cb(null, [{ exchange: "mx.test.com", priority: 10 }]);
    });
    app = express();
    app.use(express.json());
    app.use("/api/payments", paymentRoutes);
  });

  it("should return tickets for a valid paid session", async () => {
    mockStripe.checkout.sessions.retrieve.mockResolvedValue({
      id: "cs_guest_order",
      payment_status: "paid",
      customer_email: "guest@example.com",
      amount_total: 2000,
      metadata: { quantity: "2" },
    });

    const mockTickets = [
      {
        _id: "t1",
        ticketCode: "TKT-ABC123",
        buyerEmail: "guest@example.com",
        eventId: { _id: validEventId, title: "Football", ticketPrice: 10 },
      },
      {
        _id: "t2",
        ticketCode: "TKT-DEF456",
        buyerEmail: "guest@example.com",
        eventId: { _id: validEventId, title: "Football", ticketPrice: 10 },
      },
    ];
    Ticket.find.mockReturnValue({
      populate: jest.fn().mockResolvedValue(mockTickets),
    });

    const res = await request(app).get("/api/payments/guest-order/cs_guest_order");

    expect(res.status).toBe(200);
    expect(res.body.tickets).toHaveLength(2);
    expect(res.body.email).toBe("guest@example.com");
    expect(res.body.amountTotal).toBe(20);
    expect(res.body.quantity).toBe(2);
  });

  it("should return 404 for unpaid session", async () => {
    mockStripe.checkout.sessions.retrieve.mockResolvedValue({
      id: "cs_unpaid",
      payment_status: "unpaid",
    });

    const res = await request(app).get("/api/payments/guest-order/cs_unpaid");

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Order not found");
  });

  it("should return 404 when no tickets found", async () => {
    mockStripe.checkout.sessions.retrieve.mockResolvedValue({
      id: "cs_no_tickets",
      payment_status: "paid",
      customer_email: "ghost@example.com",
      amount_total: 1000,
      metadata: { quantity: "1" },
    });

    Ticket.find.mockReturnValue({
      populate: jest.fn().mockResolvedValue([]),
    });

    const res = await request(app).get("/api/payments/guest-order/cs_no_tickets");

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("No tickets found for this order");
  });

  it("should return 500 when Stripe retrieval fails", async () => {
    mockStripe.checkout.sessions.retrieve.mockRejectedValue(new Error("Stripe error"));

    const res = await request(app).get("/api/payments/guest-order/cs_bad");

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to fetch order details");
  });
});
