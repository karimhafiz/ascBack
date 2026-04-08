const request = require("supertest");
const express = require("express");
const mongoose = require("mongoose");
const courseController = require("../../controllers/courseController");

jest.mock("../../models/Course");
jest.mock("../../models/CourseEnrollment");
jest.mock("../../models/User");
jest.mock("../../utils/cloudinaryUtils", () => ({
  deleteCloudinaryImage: jest.fn().mockResolvedValue(true),
}));
jest.mock("stripe", () => {
  return jest.fn(() => ({
    checkout: {
      sessions: {
        create: jest.fn().mockResolvedValue({
          url: "https://checkout.stripe.com/test",
          id: "cs_test_123",
        }),
        retrieve: jest.fn().mockResolvedValue({
          id: "cs_test_123",
          payment_status: "paid",
          metadata: { courseId: "course1", email: "t@t.com", count: "1" },
          amount_total: 2000,
          subscription: null,
        }),
      },
    },
    products: { create: jest.fn().mockResolvedValue({ id: "prod_1" }) },
    prices: { create: jest.fn().mockResolvedValue({ id: "price_1" }) },
    subscriptions: { update: jest.fn().mockResolvedValue({}) },
    webhooks: { constructEvent: jest.fn() },
  }));
});

const Course = require("../../models/Course");
const CourseEnrollment = require("../../models/CourseEnrollment");
const User = require("../../models/User");

// Reusable valid ObjectIds
const validCourseId = new mongoose.Types.ObjectId().toString();
const validEnrollmentId = new mongoose.Types.ObjectId().toString();
const validUserId = new mongoose.Types.ObjectId().toString();

describe("Course Controller", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
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
    app.get("/api/courses/:courseId/enrollments", courseController.getCourseEnrollments);
    app.post("/api/courses/enrollments/:enrollmentId/cancel", courseController.cancelSubscription);
  });

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

  describe("POST /enrollments/:enrollmentId/cancel", () => {
    it("should cancel a subscription", async () => {
      CourseEnrollment.findById.mockResolvedValue({
        _id: validEnrollmentId,
        buyerEmail: "user@test.com",
        subscriptionId: "sub_123",
        subscriptionStatus: "active",
        currentPeriodEnd: new Date(),
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
      // Override user to be a different non-admin user
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
