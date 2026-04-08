const request = require("supertest");
const express = require("express");
const mongoose = require("mongoose");
const adminController = require("../../controllers/adminController");

jest.mock("../../models/User");
jest.mock("../../models/Ticket");
jest.mock("../../models/Team");
jest.mock("../../models/Event");
jest.mock("../../models/Course");
jest.mock("../../models/CourseEnrollment");

const User = require("../../models/User");
const Ticket = require("../../models/Ticket");
const Team = require("../../models/Team");
const Event = require("../../models/Event");
const Course = require("../../models/Course");
const CourseEnrollment = require("../../models/CourseEnrollment");

// Reusable valid ObjectIds
const adminId = new mongoose.Types.ObjectId().toString();
const userId = new mongoose.Types.ObjectId().toString();
const modId = new mongoose.Types.ObjectId().toString();

describe("Admin Controller", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();

    app = express();
    app.use(express.json());
  });

  function mountWithUser(user) {
    app.use((req, res, next) => {
      req.user = user;
      next();
    });
    app.get("/api/admin/dashboard", adminController.getDashboard);
    app.get("/api/admin/users", adminController.getAllUsers);
    app.delete("/api/admin/users/:id", adminController.deleteUser);
    app.patch("/api/admin/users/:id/role", adminController.updateUserRole);
  }

  describe("GET /dashboard", () => {
    it("should return dashboard data with users for admin", async () => {
      mountWithUser({ id: adminId, role: "admin" });

      Ticket.find.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          sort: jest.fn().mockResolvedValue([]),
        }),
      });
      Event.find.mockResolvedValue([]);
      Team.find.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          sort: jest.fn().mockResolvedValue([]),
        }),
      });
      CourseEnrollment.find.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          sort: jest.fn().mockResolvedValue([]),
        }),
      });
      Course.find.mockResolvedValue([]);
      User.find.mockReturnValue({
        sort: jest.fn().mockResolvedValue([{ name: "Test", email: "t@t.com" }]),
      });

      const response = await request(app).get("/api/admin/dashboard");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("tickets");
      expect(response.body).toHaveProperty("events");
      expect(response.body).toHaveProperty("teams");
      expect(response.body).toHaveProperty("users");
    });

    it("should not return users for moderator", async () => {
      mountWithUser({ id: modId, role: "moderator" });

      Ticket.find.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          sort: jest.fn().mockResolvedValue([]),
        }),
      });
      Event.find.mockResolvedValue([]);
      Team.find.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          sort: jest.fn().mockResolvedValue([]),
        }),
      });
      CourseEnrollment.find.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          sort: jest.fn().mockResolvedValue([]),
        }),
      });
      Course.find.mockResolvedValue([]);

      const response = await request(app).get("/api/admin/dashboard");

      expect(response.status).toBe(200);
      expect(response.body).not.toHaveProperty("users");
    });
  });

  describe("GET /users", () => {
    it("should return all users", async () => {
      mountWithUser({ id: adminId, role: "admin" });

      User.find.mockReturnValue({
        select: jest.fn().mockReturnValue({
          sort: jest.fn().mockResolvedValue([{ name: "User1" }]),
        }),
      });

      const response = await request(app).get("/api/admin/users");
      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
    });
  });

  describe("DELETE /users/:id", () => {
    it("should delete a user", async () => {
      mountWithUser({ id: adminId, role: "admin" });
      User.findByIdAndDelete.mockResolvedValue({ _id: userId, name: "Test" });

      const response = await request(app).delete(`/api/admin/users/${userId}`);
      expect(response.status).toBe(200);
      expect(response.body.message).toBe("User deleted successfully");
    });

    it("should prevent self-deletion", async () => {
      mountWithUser({ id: adminId, role: "admin" });

      const response = await request(app).delete(`/api/admin/users/${adminId}`);
      expect(response.status).toBe(400);
      expect(response.body.error).toBe("You cannot delete your own account");
    });

    it("should return 404 if user not found", async () => {
      mountWithUser({ id: adminId, role: "admin" });
      const nonexistentId = new mongoose.Types.ObjectId().toString();
      User.findByIdAndDelete.mockResolvedValue(null);

      const response = await request(app).delete(`/api/admin/users/${nonexistentId}`);
      expect(response.status).toBe(404);
    });

    it("should return 400 for invalid ObjectId", async () => {
      mountWithUser({ id: adminId, role: "admin" });

      const response = await request(app).delete("/api/admin/users/not-valid");
      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Invalid user ID");
    });
  });

  describe("PATCH /users/:id/role", () => {
    it("should update user role", async () => {
      mountWithUser({ id: adminId, role: "admin" });
      User.findByIdAndUpdate.mockResolvedValue({
        name: "User1",
        email: "u@u.com",
        role: "moderator",
      });

      const response = await request(app)
        .patch(`/api/admin/users/${userId}/role`)
        .send({ role: "moderator" });

      expect(response.status).toBe(200);
      expect(response.body.message).toBe("Role updated");
    });

    it("should prevent changing own role", async () => {
      mountWithUser({ id: adminId, role: "admin" });

      const response = await request(app)
        .patch(`/api/admin/users/${adminId}/role`)
        .send({ role: "user" });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("You cannot change your own role");
    });

    it("should reject invalid role", async () => {
      mountWithUser({ id: adminId, role: "admin" });

      const response = await request(app)
        .patch(`/api/admin/users/${userId}/role`)
        .send({ role: "superadmin" });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Invalid role");
    });
  });
});
