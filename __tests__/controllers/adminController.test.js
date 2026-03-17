const request = require("supertest");
const express = require("express");
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
      mountWithUser({ id: "admin1", role: "admin" });

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
      mountWithUser({ id: "mod1", role: "moderator" });

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
      mountWithUser({ id: "admin1", role: "admin" });

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
      mountWithUser({ id: "admin1", role: "admin" });
      User.findByIdAndDelete.mockResolvedValue({ _id: "user1", name: "Test" });

      const response = await request(app).delete("/api/admin/users/user1");
      expect(response.status).toBe(200);
      expect(response.body.message).toBe("User deleted successfully");
    });

    it("should prevent self-deletion", async () => {
      mountWithUser({ id: "admin1", role: "admin" });

      const response = await request(app).delete("/api/admin/users/admin1");
      expect(response.status).toBe(400);
      expect(response.body.message).toBe("You cannot delete your own account");
    });

    it("should return 404 if user not found", async () => {
      mountWithUser({ id: "admin1", role: "admin" });
      User.findByIdAndDelete.mockResolvedValue(null);

      const response = await request(app).delete("/api/admin/users/nonexistent");
      expect(response.status).toBe(404);
    });
  });

  describe("PATCH /users/:id/role", () => {
    it("should update user role", async () => {
      mountWithUser({ id: "admin1", role: "admin" });
      User.findByIdAndUpdate.mockResolvedValue({
        name: "User1",
        email: "u@u.com",
        role: "moderator",
      });

      const response = await request(app)
        .patch("/api/admin/users/user1/role")
        .send({ role: "moderator" });

      expect(response.status).toBe(200);
      expect(response.body.message).toBe("Role updated");
    });

    it("should prevent changing own role", async () => {
      mountWithUser({ id: "admin1", role: "admin" });

      const response = await request(app)
        .patch("/api/admin/users/admin1/role")
        .send({ role: "user" });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe("You cannot change your own role");
    });

    it("should reject invalid role", async () => {
      mountWithUser({ id: "admin1", role: "admin" });

      const response = await request(app)
        .patch("/api/admin/users/user1/role")
        .send({ role: "superadmin" });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe("Invalid role");
    });
  });
});
