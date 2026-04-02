const request = require("supertest");
const express = require("express");
const bcrypt = require("bcryptjs");
const userController = require("../../controllers/userController");

jest.mock("../../models/User");
jest.mock("../../models/Ticket");
jest.mock("../../models/Team");
jest.mock("../../models/CourseEnrollment");
jest.mock("stripe", () => {
  return jest.fn(() => ({
    subscriptions: {
      retrieve: jest.fn().mockResolvedValue({
        items: { data: [{ current_period_end: Math.floor(Date.now() / 1000) + 86400 * 30 }] },
      }),
    },
  }));
});
jest.mock("bcryptjs");
jest.mock("../../utils/tokenUtils", () => ({
  generateAccessToken: jest.fn(() => "mock-access-token"),
  generateRefreshToken: jest.fn(() => "mock-refresh-token"),
  hashToken: jest.fn((token) => "hashed-" + token),
  setRefreshTokenCookie: jest.fn(),
  clearRefreshTokenCookie: jest.fn(),
}));

const User = require("../../models/User");
const Ticket = require("../../models/Ticket");
const Team = require("../../models/Team");
const CourseEnrollment = require("../../models/CourseEnrollment");

describe("User Controller", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();

    app = express();
    app.use(express.json());

    // Cookie parser mock
    app.use((req, res, next) => {
      req.cookies = req.headers.cookie
        ? Object.fromEntries(req.headers.cookie.split("; ").map((c) => c.split("=")))
        : {};
      next();
    });

    app.post("/api/users/register", userController.register);
    app.post("/api/users/login", userController.login);
    app.post("/api/users/refresh", userController.refresh);
    app.post("/api/users/logout", userController.logout);

    // Profile needs auth
    app.get(
      "/api/users/profile",
      (req, res, next) => {
        req.user = { id: "user123", email: "test@example.com" };
        next();
      },
      userController.getProfile
    );
  });

  describe("POST /register", () => {
    it("should register a new user", async () => {
      User.findOne.mockResolvedValue(null);
      bcrypt.hash.mockResolvedValue("hashedPassword");
      User.mockImplementation(function (data) {
        Object.assign(this, data);
        this.save = jest.fn().mockResolvedValue(true);
      });

      const response = await request(app)
        .post("/api/users/register")
        .send({ name: "Test", email: "test@example.com", password: "password123" });

      expect(response.status).toBe(201);
      expect(response.body.message).toBe("User registered successfully");
      expect(bcrypt.hash).toHaveBeenCalledWith("password123", 10);
    });

    it("should return 400 if email already exists", async () => {
      User.findOne.mockResolvedValue({
        email: "test@example.com",
        authProvider: "local",
        password: "hash",
      });

      const response = await request(app)
        .post("/api/users/register")
        .send({ name: "Test", email: "test@example.com", password: "password123" });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe("Email already in use.");
    });

    it("should add password to existing Google-only account", async () => {
      const mockGoogleUser = {
        email: "test@example.com",
        authProvider: "google",
        googleId: "g123",
        save: jest.fn().mockResolvedValue(true),
      };
      User.findOne.mockResolvedValue(mockGoogleUser);

      const response = await request(app)
        .post("/api/users/register")
        .send({ name: "Test", email: "test@example.com", password: "password123" });

      expect(response.status).toBe(201);
      expect(mockGoogleUser.authProvider).toBe("both");
      expect(mockGoogleUser.save).toHaveBeenCalled();
    });
  });

  describe("POST /login", () => {
    it("should login with valid credentials", async () => {
      const mockUser = {
        _id: "user123",
        name: "Test",
        email: "test@example.com",
        password: "hashedPassword",
        role: "user",
        authProvider: "local",
        refreshToken: null,
        save: jest.fn().mockResolvedValue(true),
      };
      User.findOne.mockResolvedValue(mockUser);
      bcrypt.compare.mockResolvedValue(true);

      const response = await request(app)
        .post("/api/users/login")
        .send({ email: "test@example.com", password: "password123" });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("accessToken", "mock-access-token");
      expect(response.body.user.email).toBe("test@example.com");
    });

    it("should return 400 for non-existent user", async () => {
      User.findOne.mockResolvedValue(null);

      const response = await request(app)
        .post("/api/users/login")
        .send({ email: "noone@example.com", password: "password123" });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe("Invalid credentials");
    });

    it("should return 400 for wrong password", async () => {
      User.findOne.mockResolvedValue({
        _id: "user123",
        email: "test@example.com",
        password: "hashedPassword",
        authProvider: "local",
      });
      bcrypt.compare.mockResolvedValue(false);

      const response = await request(app)
        .post("/api/users/login")
        .send({ email: "test@example.com", password: "wrong" });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe("Invalid credentials");
    });

    it("should return 400 if user is a Google account", async () => {
      User.findOne.mockResolvedValue({
        _id: "user123",
        email: "test@example.com",
        authProvider: "google",
        googleId: "g123",
        password: null,
      });

      const response = await request(app)
        .post("/api/users/login")
        .send({ email: "test@example.com", password: "password123" });

      expect(response.status).toBe(400);
      expect(response.body.authMethod).toBe("google");
    });
  });

  describe("POST /refresh", () => {
    it("should return new access token with valid refresh token", async () => {
      const mockUser = {
        _id: "user123",
        name: "Test",
        email: "test@example.com",
        role: "user",
      };
      // Controller hashes the token before querying
      User.findOne.mockResolvedValue(mockUser);

      const response = await request(app)
        .post("/api/users/refresh")
        .set("Cookie", "refreshToken=valid-refresh-token");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("accessToken");
      // Verify the controller hashed the token before lookup
      expect(User.findOne).toHaveBeenCalledWith({ refreshToken: "hashed-valid-refresh-token" });
    });

    it("should return 401 if no refresh token", async () => {
      const response = await request(app).post("/api/users/refresh");

      expect(response.status).toBe(401);
      expect(response.body.message).toBe("No refresh token");
    });

    it("should return 403 if refresh token is invalid", async () => {
      User.findOne.mockResolvedValue(null);

      const response = await request(app)
        .post("/api/users/refresh")
        .set("Cookie", "refreshToken=invalid-token");

      expect(response.status).toBe(403);
    });
  });

  describe("POST /logout", () => {
    it("should logout and clear refresh token", async () => {
      User.findOneAndUpdate.mockResolvedValue(true);

      const response = await request(app)
        .post("/api/users/logout")
        .set("Cookie", "refreshToken=some-token");

      expect(response.status).toBe(200);
      expect(response.body.message).toBe("Logged out successfully");
      // Verify hashed token was used for lookup
      expect(User.findOneAndUpdate).toHaveBeenCalledWith(
        { refreshToken: "hashed-some-token" },
        { refreshToken: null }
      );
    });
  });

  describe("GET /profile", () => {
    it("should return user profile with tickets, teams, enrollments", async () => {
      const mockUser = { name: "Test", email: "test@example.com", role: "user" };

      // Chain mock for User.findById().select()
      User.findById.mockReturnValue({
        select: jest.fn().mockResolvedValue(mockUser),
      });

      // Chain mocks for Ticket.find().populate().sort()
      const ticketChain = {
        populate: jest.fn().mockReturnValue({
          sort: jest.fn().mockResolvedValue([]),
        }),
      };
      Ticket.find.mockReturnValue(ticketChain);

      // Chain mocks for Team.find().populate().sort()
      const teamChain = {
        populate: jest.fn().mockReturnValue({
          sort: jest.fn().mockResolvedValue([]),
        }),
      };
      Team.find.mockReturnValue(teamChain);

      // Chain mocks for CourseEnrollment.find().populate().sort()
      const enrollmentChain = {
        populate: jest.fn().mockReturnValue({
          sort: jest.fn().mockResolvedValue([]),
        }),
      };
      CourseEnrollment.find.mockReturnValue(enrollmentChain);

      const response = await request(app).get("/api/users/profile");

      expect(response.status).toBe(200);
      expect(response.body.user.email).toBe("test@example.com");
      expect(response.body).toHaveProperty("tickets");
      expect(response.body).toHaveProperty("teams");
      expect(response.body).toHaveProperty("enrollments");
    });

    it("should return 404 if user not found", async () => {
      User.findById.mockReturnValue({
        select: jest.fn().mockResolvedValue(null),
      });

      const response = await request(app).get("/api/users/profile");

      expect(response.status).toBe(404);
    });
  });
});
