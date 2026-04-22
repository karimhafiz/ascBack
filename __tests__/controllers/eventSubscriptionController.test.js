const mongoose = require("mongoose");

// Mock models
jest.mock("../../models/Event");
jest.mock("../../models/EventSubscription");
jest.mock("../../models/User");
jest.mock("../../models/WebhookEvent");

// Mock email utils
jest.mock("../../utils/emailUtils", () => ({
  sendEventSubscriptionEmail: jest.fn().mockResolvedValue(true),
  sendEventSubscriptionCancellationEmail: jest.fn().mockResolvedValue(true),
}));

// Mock stripe
const mockStripe = {
  checkout: {
    sessions: {
      create: jest.fn(),
      retrieve: jest.fn(),
    },
  },
  subscriptions: {
    retrieve: jest.fn(),
    update: jest.fn(),
  },
  webhooks: {
    constructEvent: jest.fn(),
  },
};
jest.mock("stripe", () => jest.fn(() => mockStripe));

const Event = require("../../models/Event");
const EventSubscription = require("../../models/EventSubscription");
const User = require("../../models/User");
const WebhookEvent = require("../../models/WebhookEvent");
const {
  sendEventSubscriptionEmail,
  sendEventSubscriptionCancellationEmail,
} = require("../../utils/emailUtils");

const controller = require("../../controllers/eventSubscriptionController");

// Helpers
const validEventId = new mongoose.Types.ObjectId().toString();
const validSubId = new mongoose.Types.ObjectId().toString();

const mockMongoSession = {
  withTransaction: jest.fn(async (fn) => fn()),
  endSession: jest.fn(),
};

function mockRes() {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    redirect: jest.fn(),
  };
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(mongoose, "startSession").mockResolvedValue(mockMongoSession);
  mockMongoSession.withTransaction.mockImplementation(async (fn) => fn());
});

// ─── handleSubscriptionSuccess ──────────────────────────────────────────────

describe("handleSubscriptionSuccess", () => {
  it("should activate a pending subscription and increment currentSubscribers", async () => {
    const req = {
      params: { eventId: validEventId },
      query: { session_id: "cs_test_123" },
    };
    const res = mockRes();

    mockStripe.checkout.sessions.retrieve.mockResolvedValue({
      id: "cs_test_123",
      metadata: { email: "user@test.com", quantity: "1" },
      subscription: {
        id: "sub_123",
        status: "active",
        items: { data: [{ current_period_end: 1700000000 }] },
      },
    });

    // No existing (idempotency)
    EventSubscription.findOne.mockResolvedValue(null);
    // Update pending → active
    EventSubscription.findOneAndUpdate.mockResolvedValue({
      _id: validSubId,
      buyerEmail: "user@test.com",
      status: "active",
    });
    Event.findByIdAndUpdate.mockResolvedValue({});
    Event.findById.mockResolvedValue({ _id: validEventId, title: "Weekly Football" });

    await controller.handleSubscriptionSuccess(req, res);

    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining("subscription-confirmation"));
    expect(EventSubscription.findOneAndUpdate).toHaveBeenCalledWith(
      { pendingSessionId: "cs_test_123", status: "pending" },
      expect.objectContaining({
        $set: expect.objectContaining({ status: "active", subscriptionId: "sub_123" }),
      }),
      expect.objectContaining({ new: true })
    );
    expect(Event.findByIdAndUpdate).toHaveBeenCalledWith(
      validEventId,
      { $inc: { currentSubscribers: 1 } },
      expect.any(Object)
    );
  });

  it("should be idempotent — redirect without reprocessing", async () => {
    const req = {
      params: { eventId: validEventId },
      query: { session_id: "cs_test_123" },
    };
    const res = mockRes();

    mockStripe.checkout.sessions.retrieve.mockResolvedValue({ id: "cs_test_123" });
    EventSubscription.findOne.mockResolvedValue({ _id: validSubId, paymentId: "cs_test_123" });

    await controller.handleSubscriptionSuccess(req, res);

    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining("subscription-confirmation"));
    expect(EventSubscription.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("should handle reactivation flow", async () => {
    const req = {
      params: { eventId: validEventId },
      query: { session_id: "cs_reactivate" },
    };
    const res = mockRes();

    mockStripe.checkout.sessions.retrieve.mockResolvedValue({
      id: "cs_reactivate",
      metadata: { email: "user@test.com", reactivateSubscriptionId: validSubId },
      subscription: {
        id: "sub_new",
        status: "active",
        items: { data: [{ current_period_end: 1700000000 }] },
      },
    });

    EventSubscription.findOne.mockResolvedValue(null);
    EventSubscription.findByIdAndUpdate.mockResolvedValue({
      _id: validSubId,
      buyerEmail: "user@test.com",
      status: "active",
    });
    Event.findById.mockResolvedValue({ _id: validEventId, title: "Weekly Football" });

    await controller.handleSubscriptionSuccess(req, res);

    expect(EventSubscription.findByIdAndUpdate).toHaveBeenCalledWith(
      validSubId,
      expect.objectContaining({
        $set: expect.objectContaining({ status: "active", subscriptionId: "sub_new" }),
      }),
      expect.objectContaining({ new: true })
    );
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining("reactivated=true"));
  });

  it("should redirect to /events when session_id is missing", async () => {
    const req = { params: { eventId: validEventId }, query: {} };
    const res = mockRes();

    await controller.handleSubscriptionSuccess(req, res);

    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining("events"));
  });
});

// ─── getMySubscription ──────────────────────────────────────────────────────

describe("getMySubscription", () => {
  it("should return active subscription", async () => {
    const req = { params: { eventId: validEventId }, user: { email: "user@test.com" } };
    const res = mockRes();

    const sub = {
      _id: validSubId,
      status: "active",
      subscriptionStatus: "active",
      buyerEmail: "user@test.com",
    };
    EventSubscription.findOne.mockResolvedValue(sub);

    await controller.getMySubscription(req, res);

    expect(res.json).toHaveBeenCalledWith({ subscription: sub });
  });

  it("should return null when no subscription exists", async () => {
    const req = { params: { eventId: validEventId }, user: { email: "user@test.com" } };
    const res = mockRes();

    EventSubscription.findOne.mockResolvedValue(null);

    await controller.getMySubscription(req, res);

    expect(res.json).toHaveBeenCalledWith({ subscription: null });
  });

  it("should auto-expire a cancelled subscription past its period end", async () => {
    const req = { params: { eventId: validEventId }, user: { email: "user@test.com" } };
    const res = mockRes();

    const pastDate = new Date(Date.now() - 86400000); // yesterday
    const sub = {
      _id: validSubId,
      eventId: validEventId,
      status: "active",
      subscriptionId: "sub_123",
      subscriptionStatus: "cancelled",
      currentPeriodEnd: pastDate,
    };
    EventSubscription.findOne.mockResolvedValue(sub);
    EventSubscription.findByIdAndUpdate.mockResolvedValue({});
    Event.findByIdAndUpdate.mockResolvedValue({});

    await controller.getMySubscription(req, res);

    expect(EventSubscription.findByIdAndUpdate).toHaveBeenCalledWith(validSubId, {
      status: "cancelled",
    });
    expect(Event.findByIdAndUpdate).toHaveBeenCalledWith(validEventId, {
      $inc: { currentSubscribers: -1 },
    });
    expect(res.json).toHaveBeenCalledWith({ subscription: null });
  });

  it("should return 400 for invalid event ID", async () => {
    const req = { params: { eventId: "invalid" }, user: { email: "user@test.com" } };
    const res = mockRes();

    await controller.getMySubscription(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});

// ─── cancelSubscription ─────────────────────────────────────────────────────

describe("cancelSubscription", () => {
  it("should cancel subscription at period end", async () => {
    const req = {
      params: { subscriptionId: validSubId },
      user: { id: "user1", email: "user@test.com", role: "user" },
    };
    const res = mockRes();

    EventSubscription.findById.mockResolvedValue({
      _id: validSubId,
      user: "user1",
      subscriptionId: "sub_123",
      subscriptionStatus: "active",
      buyerEmail: "user@test.com",
      eventId: validEventId,
    });

    mockStripe.subscriptions.update.mockResolvedValue({
      id: "sub_123",
      items: { data: [{ current_period_end: 1700000000 }] },
    });
    EventSubscription.findByIdAndUpdate.mockResolvedValue({});
    Event.findById.mockResolvedValue({ _id: validEventId, title: "Football" });

    await controller.cancelSubscription(req, res);

    expect(mockStripe.subscriptions.update).toHaveBeenCalledWith("sub_123", {
      cancel_at_period_end: true,
    });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("cancelled") })
    );
  });

  it("should return 403 for non-owner", async () => {
    const req = {
      params: { subscriptionId: validSubId },
      user: { id: "other_user", email: "other@test.com", role: "user" },
    };
    const res = mockRes();

    EventSubscription.findById.mockResolvedValue({
      _id: validSubId,
      user: "user1",
      subscriptionId: "sub_123",
      subscriptionStatus: "active",
      buyerEmail: "user@test.com",
    });

    await controller.cancelSubscription(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("should return 400 if already cancelled", async () => {
    const req = {
      params: { subscriptionId: validSubId },
      user: { id: "user1", email: "user@test.com", role: "user" },
    };
    const res = mockRes();

    EventSubscription.findById.mockResolvedValue({
      _id: validSubId,
      user: "user1",
      subscriptionId: "sub_123",
      subscriptionStatus: "cancelled",
      buyerEmail: "user@test.com",
    });

    await controller.cancelSubscription(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "Subscription is already cancelled" })
    );
  });
});

// ─── reactivateSubscription ─────────────────────────────────────────────────

describe("reactivateSubscription", () => {
  it("should reactivate directly when Stripe sub exists", async () => {
    const req = {
      params: { subscriptionId: validSubId },
      user: { id: "user1", email: "user@test.com", role: "user" },
    };
    const res = mockRes();

    EventSubscription.findById.mockResolvedValue({
      _id: validSubId,
      user: "user1",
      subscriptionId: "sub_123",
      subscriptionStatus: "cancelled",
      buyerEmail: "user@test.com",
      eventId: validEventId,
    });

    mockStripe.subscriptions.retrieve.mockResolvedValue({ status: "active" });
    mockStripe.subscriptions.update.mockResolvedValue({
      id: "sub_123",
      items: { data: [{ current_period_end: 1700000000 }] },
    });
    EventSubscription.findByIdAndUpdate.mockResolvedValue({});

    await controller.reactivateSubscription(req, res);

    expect(mockStripe.subscriptions.update).toHaveBeenCalledWith("sub_123", {
      cancel_at_period_end: false,
    });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Subscription reactivated successfully." })
    );
  });

  it("should return checkout URL when Stripe sub is gone", async () => {
    const req = {
      params: { subscriptionId: validSubId },
      user: { id: "user1", email: "user@test.com", role: "user" },
    };
    const res = mockRes();

    EventSubscription.findById.mockResolvedValue({
      _id: validSubId,
      user: "user1",
      subscriptionId: "sub_deleted",
      subscriptionStatus: "cancelled",
      buyerEmail: "user@test.com",
      eventId: validEventId,
      quantity: 1,
    });

    mockStripe.subscriptions.retrieve.mockRejectedValue({ code: "resource_missing" });
    Event.findById.mockResolvedValue({
      _id: validEventId,
      stripePriceId: "price_123",
      title: "Football",
    });
    mockStripe.checkout.sessions.create.mockResolvedValue({
      id: "cs_reactivate",
      url: "https://checkout.stripe.com/pay/cs_reactivate",
    });
    EventSubscription.findByIdAndUpdate.mockResolvedValue({});

    await controller.reactivateSubscription(req, res);

    expect(res.json).toHaveBeenCalledWith({
      url: "https://checkout.stripe.com/pay/cs_reactivate",
    });
  });

  it("should return 400 if subscription is not cancelled", async () => {
    const req = {
      params: { subscriptionId: validSubId },
      user: { id: "user1", email: "user@test.com", role: "user" },
    };
    const res = mockRes();

    EventSubscription.findById.mockResolvedValue({
      _id: validSubId,
      user: "user1",
      subscriptionId: "sub_123",
      subscriptionStatus: "active",
      buyerEmail: "user@test.com",
    });

    await controller.reactivateSubscription(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "Subscription is not cancelled" })
    );
  });
});

// ─── handleWebhook ──────────────────────────────────────────────────────────

describe("handleWebhook", () => {
  it("should handle invoice.payment_succeeded", async () => {
    const req = {
      body: Buffer.from("{}"),
      headers: { "stripe-signature": "sig_test" },
    };
    const res = mockRes();

    mockStripe.webhooks.constructEvent.mockReturnValue({
      id: "evt_1",
      type: "invoice.payment_succeeded",
      created: 1000,
      data: { object: { subscription: "sub_123" } },
    });
    WebhookEvent.findOne.mockResolvedValue(null);
    mockStripe.subscriptions.retrieve.mockResolvedValue({
      id: "sub_123",
      items: { data: [{ current_period_end: 1700000000 }] },
    });
    EventSubscription.findOneAndUpdate.mockResolvedValue({});
    WebhookEvent.create.mockResolvedValue({});

    await controller.handleWebhook(req, res);

    expect(EventSubscription.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionId: "sub_123" }),
      expect.objectContaining({ subscriptionStatus: "active", status: "active" })
    );
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  it("should handle invoice.payment_failed", async () => {
    const req = {
      body: Buffer.from("{}"),
      headers: { "stripe-signature": "sig_test" },
    };
    const res = mockRes();

    mockStripe.webhooks.constructEvent.mockReturnValue({
      id: "evt_2",
      type: "invoice.payment_failed",
      created: 1001,
      data: { object: { subscription: "sub_123" } },
    });
    WebhookEvent.findOne.mockResolvedValue(null);
    EventSubscription.findOneAndUpdate.mockResolvedValue({});
    WebhookEvent.create.mockResolvedValue({});

    await controller.handleWebhook(req, res);

    expect(EventSubscription.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionId: "sub_123" }),
      expect.objectContaining({ subscriptionStatus: "past_due", status: "past_due" })
    );
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  it("should handle customer.subscription.deleted with transaction", async () => {
    const req = {
      body: Buffer.from("{}"),
      headers: { "stripe-signature": "sig_test" },
    };
    const res = mockRes();

    mockStripe.webhooks.constructEvent.mockReturnValue({
      id: "evt_3",
      type: "customer.subscription.deleted",
      created: 1002,
      data: { object: { id: "sub_123" } },
    });
    WebhookEvent.findOne.mockResolvedValue(null);
    EventSubscription.findOneAndUpdate.mockResolvedValue({
      eventId: validEventId,
    });
    Event.findByIdAndUpdate.mockResolvedValue({});
    WebhookEvent.create.mockResolvedValue({});

    await controller.handleWebhook(req, res);

    expect(mongoose.startSession).toHaveBeenCalled();
    expect(EventSubscription.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionId: "sub_123" }),
      expect.objectContaining({ subscriptionStatus: "cancelled", status: "cancelled" }),
      expect.objectContaining({ session: mockMongoSession })
    );
    expect(Event.findByIdAndUpdate).toHaveBeenCalledWith(
      validEventId,
      { $inc: { currentSubscribers: -1 } },
      expect.objectContaining({ session: mockMongoSession })
    );
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  it("should skip duplicate events (idempotency)", async () => {
    const req = {
      body: Buffer.from("{}"),
      headers: { "stripe-signature": "sig_test" },
    };
    const res = mockRes();

    mockStripe.webhooks.constructEvent.mockReturnValue({
      id: "evt_dup",
      type: "invoice.payment_succeeded",
      created: 1000,
      data: { object: { subscription: "sub_123" } },
    });
    WebhookEvent.findOne.mockResolvedValue({ stripeEventId: "evt_dup" });

    await controller.handleWebhook(req, res);

    expect(res.json).toHaveBeenCalledWith({ received: true, duplicate: true });
    expect(EventSubscription.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("should return 400 for invalid webhook signature", async () => {
    const req = {
      body: Buffer.from("{}"),
      headers: { "stripe-signature": "bad_sig" },
    };
    const res = mockRes();

    mockStripe.webhooks.constructEvent.mockImplementation(() => {
      throw new Error("Invalid signature");
    });

    await controller.handleWebhook(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});
