const request = require("supertest");
const express = require("express");
const mongoose = require("mongoose");

jest.mock("../../models/Course");
jest.mock("../../models/CourseEnrollment");
jest.mock("../../models/User");
jest.mock("../../models/WebhookEvent");
jest.mock("../../utils/cloudinaryUtils", () => ({
  deleteCloudinaryImage: jest.fn().mockResolvedValue(true),
}));
jest.mock("../../utils/emailUtils", () => ({
  sendCourseEnrollmentEmail: jest.fn().mockResolvedValue(true),
  sendSubscriptionCancellationEmail: jest.fn().mockResolvedValue(true),
}));

const mockStripe = {
  checkout: {
    sessions: {
      create: jest.fn().mockResolvedValue({
        url: "https://checkout.stripe.com/test",
        id: "cs_test_123",
      }),
      retrieve: jest.fn(),
    },
  },
  products: { create: jest.fn().mockResolvedValue({ id: "prod_1" }) },
  prices: { create: jest.fn().mockResolvedValue({ id: "price_1" }) },
  subscriptions: {
    update: jest.fn().mockResolvedValue({}),
    retrieve: jest.fn(),
  },
  subscriptionItems: { update: jest.fn().mockResolvedValue({}) },
  webhooks: { constructEvent: jest.fn() },
};
jest.mock("stripe", () => jest.fn(() => mockStripe));

// Require after mockStripe is defined — controller init calls require("stripe")()
const courseController = require("../../controllers/courseController");
const Course = require("../../models/Course");
const CourseEnrollment = require("../../models/CourseEnrollment");
const User = require("../../models/User");
const WebhookEvent = require("../../models/WebhookEvent");

function mockRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    redirect: jest.fn(),
  };
}

// Reusable valid ObjectIds
const validCourseId = new mongoose.Types.ObjectId().toString();
const validEnrollmentId = new mongoose.Types.ObjectId().toString();
const validUserId = new mongoose.Types.ObjectId().toString();
const validParticipantId = new mongoose.Types.ObjectId().toString();

// Mock mongoose session for transactions
const mockMongoSession = {
  withTransaction: jest.fn(async (fn) => fn()),
  endSession: jest.fn(),
};

beforeEach(() => {
  jest.spyOn(mongoose, "startSession").mockResolvedValue(mockMongoSession);
});

describe("Course Controller", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(mongoose, "startSession").mockResolvedValue(mockMongoSession);
    mockMongoSession.withTransaction.mockImplementation(async (fn) => fn());

    app = express();
    app.use(express.json());

    app.use((req, res, next) => {
      req.user = { id: validUserId, email: "user@test.com", role: "admin" };
      next();
    });

    app.get("/api/courses", courseController.getAllCourses);
    app.get("/api/courses/:id", courseController.getCourseById);
    app.post("/api/courses", courseController.createCourse);
    app.put("/api/courses/:id", courseController.updateCourse);
    app.delete("/api/courses/:id", courseController.deleteCourse);
    app.post("/api/courses/:courseId/enroll", courseController.enrollInCourse);
    app.get("/api/courses/:courseId/enrollment-success", courseController.handleEnrollmentSuccess);
    app.get("/api/courses/:courseId/enrollments", courseController.getCourseEnrollments);
    app.post("/api/courses/enrollments/:enrollmentId/cancel", courseController.cancelSubscription);
    app.post(
      "/api/courses/enrollments/:enrollmentId/add-participant",
      courseController.addParticipant
    );
    app.post(
      "/api/courses/enrollments/:enrollmentId/remove-participant",
      courseController.removeParticipant
    );
    app.put(
      "/api/courses/enrollments/:enrollmentId/participants/:participantId",
      courseController.editParticipant
    );
  });

  // ─── GET /courses ─────────────────────────────────────────────────────────────

  describe("GET /courses", () => {
    it("should return all courses", async () => {
      Course.find.mockReturnValue({
        sort: jest.fn().mockResolvedValue([{ title: "English" }]),
      });

      const res = await request(app).get("/api/courses");
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });
  });

  // ─── GET /courses/:id ─────────────────────────────────────────────────────────

  describe("GET /courses/:id", () => {
    it("should return a course", async () => {
      Course.findById.mockResolvedValue({ _id: validCourseId, title: "English" });

      const res = await request(app).get(`/api/courses/${validCourseId}`);
      expect(res.status).toBe(200);
      expect(res.body.title).toBe("English");
    });

    it("should return 404 if not found", async () => {
      const nonexistentId = new mongoose.Types.ObjectId().toString();
      Course.findById.mockResolvedValue(null);

      const res = await request(app).get(`/api/courses/${nonexistentId}`);
      expect(res.status).toBe(404);
    });

    it("should return 400 for invalid ObjectId", async () => {
      const res = await request(app).get("/api/courses/not-valid");
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid course ID");
    });
  });

  // ─── POST /courses ────────────────────────────────────────────────────────────

  describe("POST /courses", () => {
    it("should create a course", async () => {
      Course.mockImplementation(function (data) {
        Object.assign(this, data);
        this.save = jest.fn().mockResolvedValue(true);
      });

      const res = await request(app)
        .post("/api/courses")
        .send({ courseData: JSON.stringify({ title: "English", price: 20 }) });

      expect(res.status).toBe(201);
      expect(res.body.message).toBe("Course created successfully");
    });

    it("should return 400 if courseData missing", async () => {
      const res = await request(app).post("/api/courses").send({});
      expect(res.status).toBe(400);
    });

    it("should return 400 if courseData is invalid JSON", async () => {
      const res = await request(app).post("/api/courses").send({ courseData: "not-json" });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid JSON in courseData");
    });
  });

  // ─── DELETE /courses/:id ──────────────────────────────────────────────────────

  describe("DELETE /courses/:id", () => {
    it("should delete a course", async () => {
      Course.findById.mockResolvedValue({ _id: validCourseId, images: [] });
      Course.findByIdAndDelete.mockResolvedValue(true);

      const res = await request(app).delete(`/api/courses/${validCourseId}`);
      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Course deleted");
    });

    it("should return 404 if course not found", async () => {
      const nonexistentId = new mongoose.Types.ObjectId().toString();
      Course.findById.mockResolvedValue(null);

      const res = await request(app).delete(`/api/courses/${nonexistentId}`);
      expect(res.status).toBe(404);
    });
  });

  // ─── POST /courses/:courseId/enroll ────────────────────────────────────────────

  describe("POST /courses/:courseId/enroll", () => {
    it("should enroll in a free course directly", async () => {
      Course.findById.mockResolvedValue({
        _id: validCourseId,
        price: 0,
        enrollmentOpen: true,
        maxEnrollment: 30,
        currentEnrollment: 5,
      });
      CourseEnrollment.findOne.mockResolvedValue(null);
      User.findOne.mockResolvedValue({ _id: validUserId });
      CourseEnrollment.mockImplementation(function (data) {
        Object.assign(this, data);
        this.save = jest.fn().mockResolvedValue(true);
      });
      Course.findByIdAndUpdate.mockResolvedValue(true);

      const res = await request(app)
        .post(`/api/courses/${validCourseId}/enroll`)
        .send({
          email: "t@t.com",
          phone: "07123456789",
          participants: [{ name: "Test", age: 20 }],
        });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Enrolled successfully");
    });

    it("should return 400 if no participants", async () => {
      const res = await request(app)
        .post(`/api/courses/${validCourseId}/enroll`)
        .send({ email: "t@t.com", phone: "07123456789", participants: [] });

      expect(res.status).toBe(400);
    });

    it("should return 400 if enrollment closed", async () => {
      Course.findById.mockResolvedValue({
        _id: validCourseId,
        price: 10,
        enrollmentOpen: false,
      });

      const res = await request(app)
        .post(`/api/courses/${validCourseId}/enroll`)
        .send({ email: "t@t.com", phone: "07123456789", participants: [{ name: "Test" }] });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Enrollment is closed");
    });

    it("should return 400 if already enrolled", async () => {
      Course.findById.mockResolvedValue({
        _id: validCourseId,
        price: 10,
        enrollmentOpen: true,
        maxEnrollment: 30,
        currentEnrollment: 5,
      });
      CourseEnrollment.findOne.mockResolvedValue({ status: "paid" });

      const res = await request(app)
        .post(`/api/courses/${validCourseId}/enroll`)
        .send({ email: "t@t.com", phone: "07123456789", participants: [{ name: "Test" }] });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("You are already enrolled in this course");
    });

    it("should return 400 if not enough spots", async () => {
      Course.findById.mockResolvedValue({
        _id: validCourseId,
        price: 10,
        enrollmentOpen: true,
        maxEnrollment: 5,
        currentEnrollment: 5,
      });
      CourseEnrollment.findOne.mockResolvedValue(null);

      const res = await request(app)
        .post(`/api/courses/${validCourseId}/enroll`)
        .send({ email: "t@t.com", phone: "07123456789", participants: [{ name: "Test" }] });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/spots remaining/);
    });
  });

  // ─── GET /courses/:courseId/enrollment-success ────────────────────────────────

  describe("GET /courses/:courseId/enrollment-success", () => {
    it("should redirect idempotently if payment already processed", async () => {
      mockStripe.checkout.sessions.retrieve.mockResolvedValue({
        id: "cs_test_123",
        payment_status: "paid",
        metadata: { email: "t@t.com", count: "1" },
        subscription: null,
      });
      CourseEnrollment.findOne.mockResolvedValue({ _id: "existing" });

      const res = await request(app)
        .get(`/api/courses/${validCourseId}/enrollment-success`)
        .query({ session_id: "cs_test_123" });

      expect(res.status).toBe(302);
      expect(res.headers.location).toMatch(/course-confirmation/);
      // Transaction should not be started for idempotent redirect
      expect(mongoose.startSession).not.toHaveBeenCalled();
    });

    it("should atomically update pending enrollment and increment course count", async () => {
      mockStripe.checkout.sessions.retrieve.mockResolvedValue({
        id: "cs_test_new",
        payment_status: "paid",
        metadata: { email: "t@t.com", isSubscription: "false" },
        subscription: null,
      });
      // No existing payment
      CourseEnrollment.findOne
        .mockResolvedValueOnce(null) // idempotency check
        .mockResolvedValueOnce(null); // no pending found by findOneAndUpdate

      // findOneAndUpdate for pending enrollment — returns updated enrollment
      CourseEnrollment.findOneAndUpdate.mockResolvedValue({
        _id: validEnrollmentId,
        participants: [{ name: "Test" }],
        buyerEmail: "t@t.com",
      });

      Course.findByIdAndUpdate.mockResolvedValue(true);
      Course.findById.mockResolvedValue({ _id: validCourseId, title: "English" });

      const res = await request(app)
        .get(`/api/courses/${validCourseId}/enrollment-success`)
        .query({ session_id: "cs_test_new" });

      expect(res.status).toBe(302);
      expect(mongoose.startSession).toHaveBeenCalled();
      expect(mockMongoSession.endSession).toHaveBeenCalled();
      expect(CourseEnrollment.findOneAndUpdate).toHaveBeenCalledWith(
        { pendingSessionId: "cs_test_new", status: "pending" },
        expect.objectContaining({
          $set: expect.objectContaining({ paymentId: "cs_test_new", status: "paid" }),
        }),
        expect.objectContaining({ session: mockMongoSession })
      );
    });

    it("should redirect to courses if session_id is missing", async () => {
      const res = await request(app).get(`/api/courses/${validCourseId}/enrollment-success`);

      expect(res.status).toBe(302);
      expect(res.headers.location).toMatch(/courses$/);
    });
  });

  // ─── POST /enrollments/:enrollmentId/cancel ───────────────────────────────────

  describe("POST /enrollments/:enrollmentId/cancel", () => {
    it("should cancel a subscription", async () => {
      CourseEnrollment.findById.mockResolvedValue({
        _id: validEnrollmentId,
        buyerEmail: "user@test.com",
        subscriptionId: "sub_123",
        subscriptionStatus: "active",
        currentPeriodEnd: new Date(),
      });
      mockStripe.subscriptions.update.mockResolvedValue({
        id: "sub_123",
        items: { data: [{ current_period_end: Math.floor(Date.now() / 1000) + 86400 }] },
      });
      CourseEnrollment.findByIdAndUpdate.mockResolvedValue(true);

      const res = await request(app).post(`/api/courses/enrollments/${validEnrollmentId}/cancel`);
      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/cancelled/i);
    });

    it("should return 404 if enrollment not found", async () => {
      const nonexistentId = new mongoose.Types.ObjectId().toString();
      CourseEnrollment.findById.mockResolvedValue(null);

      const res = await request(app).post(`/api/courses/enrollments/${nonexistentId}/cancel`);
      expect(res.status).toBe(404);
    });

    it("should return 400 if not a subscription", async () => {
      CourseEnrollment.findById.mockResolvedValue({
        _id: validEnrollmentId,
        buyerEmail: "user@test.com",
        subscriptionId: null,
      });

      const res = await request(app).post(`/api/courses/enrollments/${validEnrollmentId}/cancel`);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("This enrollment is not a subscription");
    });

    it("should return 400 if already cancelled", async () => {
      CourseEnrollment.findById.mockResolvedValue({
        _id: validEnrollmentId,
        buyerEmail: "user@test.com",
        subscriptionId: "sub_123",
        subscriptionStatus: "cancelled",
      });

      const res = await request(app).post(`/api/courses/enrollments/${validEnrollmentId}/cancel`);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Subscription is already cancelled");
    });

    it("should return 403 if not owner or admin", async () => {
      app = express();
      app.use(express.json());
      app.use((req, res, next) => {
        req.user = { id: "other", email: "other@test.com", role: "user" };
        next();
      });
      app.post(
        "/api/courses/enrollments/:enrollmentId/cancel",
        courseController.cancelSubscription
      );

      CourseEnrollment.findById.mockResolvedValue({
        _id: validEnrollmentId,
        buyerEmail: "owner@test.com",
        subscriptionId: "sub_123",
        subscriptionStatus: "active",
      });

      const res = await request(app).post(`/api/courses/enrollments/${validEnrollmentId}/cancel`);
      expect(res.status).toBe(403);
    });
  });

  // ─── POST /enrollments/:enrollmentId/reactivate ───────────────────────────────

  describe("reactivateSubscription", () => {
    it("should reactivate directly when Stripe sub exists", async () => {
      const req = {
        params: { enrollmentId: validEnrollmentId },
        user: { id: validUserId, email: "user@test.com", role: "user" },
      };
      const res = mockRes();

      CourseEnrollment.findById.mockResolvedValue({
        _id: validEnrollmentId,
        user: validUserId,
        subscriptionId: "sub_123",
        subscriptionStatus: "cancelled",
        buyerEmail: "user@test.com",
        courseId: validCourseId,
      });
      mockStripe.subscriptions.retrieve.mockResolvedValue({ status: "active" });
      mockStripe.subscriptions.update.mockResolvedValue({
        id: "sub_123",
        items: { data: [{ current_period_end: 1700000000 }] },
      });
      CourseEnrollment.findByIdAndUpdate.mockResolvedValue({});

      await courseController.reactivateSubscription(req, res);

      expect(mockStripe.subscriptions.update).toHaveBeenCalledWith("sub_123", {
        cancel_at_period_end: false,
      });
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Subscription reactivated successfully." })
      );
    });

    it("should return checkout URL when Stripe sub is gone", async () => {
      const req = {
        params: { enrollmentId: validEnrollmentId },
        user: { id: validUserId, email: "user@test.com", role: "user" },
      };
      const res = mockRes();

      CourseEnrollment.findById.mockResolvedValue({
        _id: validEnrollmentId,
        user: validUserId,
        subscriptionId: "sub_deleted",
        subscriptionStatus: "cancelled",
        buyerEmail: "user@test.com",
        courseId: validCourseId,
        participants: [{ name: "Test" }],
      });
      mockStripe.subscriptions.retrieve.mockRejectedValue({ code: "resource_missing" });
      Course.findById.mockResolvedValue({
        _id: validCourseId,
        stripePriceId: "price_123",
        title: "English",
      });
      mockStripe.checkout.sessions.create.mockResolvedValue({
        id: "cs_reactivate",
        url: "https://checkout.stripe.com/pay/cs_reactivate",
      });
      CourseEnrollment.findByIdAndUpdate.mockResolvedValue({});

      await courseController.reactivateSubscription(req, res);

      expect(res.json).toHaveBeenCalledWith({
        url: "https://checkout.stripe.com/pay/cs_reactivate",
      });
    });

    it("should return 400 if subscription is not cancelled", async () => {
      const req = {
        params: { enrollmentId: validEnrollmentId },
        user: { id: validUserId, email: "user@test.com", role: "user" },
      };
      const res = mockRes();

      CourseEnrollment.findById.mockResolvedValue({
        _id: validEnrollmentId,
        user: validUserId,
        subscriptionId: "sub_123",
        subscriptionStatus: "active",
        buyerEmail: "user@test.com",
      });

      await courseController.reactivateSubscription(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "Subscription is not cancelled" })
      );
    });
  });

  // ─── POST /courses/webhook ─────────────────────────────────────────────────────

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
        data: { object: { subscription: "sub_123", amount_paid: 5000 } },
      });
      WebhookEvent.findOne.mockResolvedValue(null);
      mockStripe.subscriptions.retrieve.mockResolvedValue({
        id: "sub_123",
        items: { data: [{ current_period_end: 1700000000 }] },
      });
      CourseEnrollment.findOneAndUpdate.mockResolvedValue({});
      WebhookEvent.create.mockResolvedValue({});

      await courseController.handleWebhook(req, res);

      expect(CourseEnrollment.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ subscriptionId: "sub_123" }),
        expect.objectContaining({
          $set: expect.objectContaining({ subscriptionStatus: "active", status: "active" }),
          $inc: { totalAmountPaid: 50 },
        })
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
      CourseEnrollment.findOneAndUpdate.mockResolvedValue({});
      WebhookEvent.create.mockResolvedValue({});

      await courseController.handleWebhook(req, res);

      expect(CourseEnrollment.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ subscriptionId: "sub_123" }),
        expect.objectContaining({ subscriptionStatus: "past_due", status: "past_due" })
      );
      expect(res.json).toHaveBeenCalledWith({ received: true });
    });

    it("should handle customer.subscription.deleted with transaction, decrementing by participant count", async () => {
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
      CourseEnrollment.findOneAndUpdate.mockResolvedValue({
        courseId: validCourseId,
        participants: [{ name: "A" }, { name: "B" }],
      });
      Course.findByIdAndUpdate.mockResolvedValue({});
      WebhookEvent.create.mockResolvedValue({});

      await courseController.handleWebhook(req, res);

      expect(mongoose.startSession).toHaveBeenCalled();
      expect(CourseEnrollment.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ subscriptionId: "sub_123" }),
        expect.objectContaining({ subscriptionStatus: "cancelled", status: "cancelled" }),
        expect.objectContaining({ session: mockMongoSession })
      );
      expect(Course.findByIdAndUpdate).toHaveBeenCalledWith(
        validCourseId,
        { $inc: { currentEnrollment: -2 } },
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

      await courseController.handleWebhook(req, res);

      expect(res.json).toHaveBeenCalledWith({ received: true, duplicate: true });
      expect(CourseEnrollment.findOneAndUpdate).not.toHaveBeenCalled();
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

      await courseController.handleWebhook(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  // ─── POST /enrollments/:enrollmentId/add-participant ──────────────────────────

  describe("POST /enrollments/:enrollmentId/add-participant", () => {
    const baseEnrollment = {
      _id: validEnrollmentId,
      courseId: validCourseId,
      user: { toString: () => validUserId },
      buyerEmail: "user@test.com",
      status: "paid",
      subscriptionId: null,
      subscriptionStatus: null,
      participants: [{ _id: validParticipantId, name: "Existing", email: "e@test.com" }],
    };

    it("should add a participant atomically", async () => {
      CourseEnrollment.findById.mockResolvedValue(baseEnrollment);
      Course.findOneAndUpdate.mockResolvedValue({
        _id: validCourseId,
        currentEnrollment: 6,
      });
      CourseEnrollment.findByIdAndUpdate.mockResolvedValue({
        ...baseEnrollment,
        participants: [
          ...baseEnrollment.participants,
          { name: "New Person", email: "new@test.com" },
        ],
      });

      const res = await request(app)
        .post(`/api/courses/enrollments/${validEnrollmentId}/add-participant`)
        .send({ name: "New Person", email: "new@test.com" });

      expect(res.status).toBe(200);
      expect(res.body.participants).toHaveLength(2);
      expect(mongoose.startSession).toHaveBeenCalled();
    });

    it("should reject duplicate participant (same name + email)", async () => {
      CourseEnrollment.findById.mockResolvedValue(baseEnrollment);

      const res = await request(app)
        .post(`/api/courses/enrollments/${validEnrollmentId}/add-participant`)
        .send({ name: "Existing", email: "e@test.com" });

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/already exists/);
    });

    it("should return 400 if course is full", async () => {
      CourseEnrollment.findById.mockResolvedValue(baseEnrollment);
      // findOneAndUpdate returns null when capacity guard fails
      Course.findOneAndUpdate.mockResolvedValue(null);
      mockMongoSession.withTransaction.mockImplementation(async (fn) => fn());

      const res = await request(app)
        .post(`/api/courses/enrollments/${validEnrollmentId}/add-participant`)
        .send({ name: "Another Person" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Course is full");
    });

    it("should return 400 for missing name", async () => {
      const res = await request(app)
        .post(`/api/courses/enrollments/${validEnrollmentId}/add-participant`)
        .send({ email: "no-name@test.com" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Participant name is required");
    });

    it("should return 400 for cancelled enrollment", async () => {
      CourseEnrollment.findById.mockResolvedValue({
        ...baseEnrollment,
        status: "cancelled",
      });

      const res = await request(app)
        .post(`/api/courses/enrollments/${validEnrollmentId}/add-participant`)
        .send({ name: "New Person" });

      expect(res.status).toBe(400);
    });
  });

  // ─── POST /enrollments/:enrollmentId/remove-participant ───────────────────────

  describe("POST /enrollments/:enrollmentId/remove-participant", () => {
    const participant1Id = new mongoose.Types.ObjectId().toString();
    const participant2Id = new mongoose.Types.ObjectId().toString();

    const enrollmentWithTwoParticipants = {
      _id: validEnrollmentId,
      courseId: validCourseId,
      user: { toString: () => validUserId },
      buyerEmail: "user@test.com",
      status: "paid",
      subscriptionId: null,
      subscriptionStatus: null,
      participants: {
        id: jest.fn((id) => {
          if (id === participant1Id) return { _id: participant1Id, name: "Alice" };
          if (id === participant2Id) return { _id: participant2Id, name: "Bob" };
          return null;
        }),
        length: 2,
      },
    };

    it("should remove a participant by participantId atomically", async () => {
      CourseEnrollment.findById.mockResolvedValue(enrollmentWithTwoParticipants);
      CourseEnrollment.findByIdAndUpdate.mockResolvedValue({
        participants: [{ _id: participant2Id, name: "Bob" }],
      });
      Course.findByIdAndUpdate.mockResolvedValue(true);

      const res = await request(app)
        .post(`/api/courses/enrollments/${validEnrollmentId}/remove-participant`)
        .send({ participantId: participant1Id });

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/Alice.*removed/);
      expect(mongoose.startSession).toHaveBeenCalled();
      expect(CourseEnrollment.findByIdAndUpdate).toHaveBeenCalledWith(
        validEnrollmentId,
        { $pull: { participants: { _id: participant1Id } } },
        expect.objectContaining({ session: mockMongoSession })
      );
    });

    it("should return 400 for missing participantId", async () => {
      const res = await request(app)
        .post(`/api/courses/enrollments/${validEnrollmentId}/remove-participant`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Valid participantId is required");
    });

    it("should return 404 for non-existent participant", async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      CourseEnrollment.findById.mockResolvedValue({
        ...enrollmentWithTwoParticipants,
        participants: {
          ...enrollmentWithTwoParticipants.participants,
          id: jest.fn(() => null),
        },
      });

      const res = await request(app)
        .post(`/api/courses/enrollments/${validEnrollmentId}/remove-participant`)
        .send({ participantId: fakeId });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Participant not found");
    });

    it("should return 400 when trying to remove last participant", async () => {
      CourseEnrollment.findById.mockResolvedValue({
        ...enrollmentWithTwoParticipants,
        participants: {
          id: jest.fn(() => ({ _id: participant1Id, name: "Alice" })),
          length: 1,
        },
      });

      const res = await request(app)
        .post(`/api/courses/enrollments/${validEnrollmentId}/remove-participant`)
        .send({ participantId: participant1Id });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/last participant/);
    });
  });

  // ─── PUT /enrollments/:enrollmentId/participants/:participantId ───────────────

  describe("PUT /enrollments/:enrollmentId/participants/:participantId", () => {
    it("should update participant fields atomically", async () => {
      CourseEnrollment.findById.mockResolvedValue({
        _id: validEnrollmentId,
        user: { toString: () => validUserId },
        buyerEmail: "user@test.com",
        participants: {
          id: jest.fn(() => ({ _id: validParticipantId, name: "Old Name" })),
        },
      });
      CourseEnrollment.findOneAndUpdate.mockResolvedValue({
        participants: [{ _id: validParticipantId, name: "New Name", email: "new@test.com" }],
      });

      const res = await request(app)
        .put(`/api/courses/enrollments/${validEnrollmentId}/participants/${validParticipantId}`)
        .send({ name: "New Name", email: "new@test.com" });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Participant updated successfully.");
      expect(CourseEnrollment.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: validEnrollmentId, "participants._id": validParticipantId },
        {
          $set: {
            "participants.$.name": "New Name",
            "participants.$.email": "new@test.com",
          },
        },
        { new: true }
      );
    });

    it("should return 404 if participant not found", async () => {
      const fakeParticipantId = new mongoose.Types.ObjectId().toString();
      CourseEnrollment.findById.mockResolvedValue({
        _id: validEnrollmentId,
        user: { toString: () => validUserId },
        buyerEmail: "user@test.com",
        participants: { id: jest.fn(() => null) },
      });

      const res = await request(app)
        .put(`/api/courses/enrollments/${validEnrollmentId}/participants/${fakeParticipantId}`)
        .send({ name: "Test" });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Participant not found");
    });

    it("should return 400 if no fields to update", async () => {
      CourseEnrollment.findById.mockResolvedValue({
        _id: validEnrollmentId,
        user: { toString: () => validUserId },
        buyerEmail: "user@test.com",
        participants: {
          id: jest.fn(() => ({ _id: validParticipantId, name: "Name" })),
        },
      });

      const res = await request(app)
        .put(`/api/courses/enrollments/${validEnrollmentId}/participants/${validParticipantId}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("No fields to update");
    });

    it("should return 400 for empty name", async () => {
      CourseEnrollment.findById.mockResolvedValue({
        _id: validEnrollmentId,
        user: { toString: () => validUserId },
        buyerEmail: "user@test.com",
        participants: {
          id: jest.fn(() => ({ _id: validParticipantId, name: "Name" })),
        },
      });

      const res = await request(app)
        .put(`/api/courses/enrollments/${validEnrollmentId}/participants/${validParticipantId}`)
        .send({ name: "  " });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Name cannot be empty");
    });
  });

  // ─── GET /courses/:courseId/enrollments ────────────────────────────────────────

  describe("GET /courses/:courseId/enrollments", () => {
    it("should return enrollments for a course", async () => {
      CourseEnrollment.find.mockReturnValue({
        populate: jest.fn().mockResolvedValue([{ buyerEmail: "t@t.com" }]),
      });

      const res = await request(app).get(`/api/courses/${validCourseId}/enrollments`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });
  });
});
