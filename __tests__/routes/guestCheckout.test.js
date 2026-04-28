const request = require("supertest");
const express = require("express");
const mongoose = require("mongoose");

jest.mock("../../models/Ticket");
jest.mock("../../models/Event");
jest.mock("../../models/EventSubscription");
jest.mock("../../models/User");

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
const paymentRoutes = require("../../routes/payments");

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
});
