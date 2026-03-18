const request = require("supertest");
const express = require("express");

// Mock User model
jest.mock("../../models/User");
const User = require("../../models/User");

// Mock token utilities
jest.mock("../../utils/tokenUtils", () => ({
  generateAccessToken: jest.fn(() => "mock-access-token"),
  generateRefreshToken: jest.fn(() => "mock-refresh-token"),
  hashToken: jest.fn((token) => "hashed-" + token),
  setRefreshTokenCookie: jest.fn(),
}));

// Mock google-auth-library
jest.mock("google-auth-library", () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    verifyIdToken: jest.fn(),
  })),
}));

const { OAuth2Client } = require("google-auth-library");

describe("OAuth Controller - googleLogin", () => {
  let app;
  let mockVerifyIdToken;

  beforeEach(() => {
    jest.clearAllMocks();

    // Set up the mock verifyIdToken on the OAuth2Client instance
    mockVerifyIdToken = jest.fn();
    OAuth2Client.mockImplementation(() => ({
      verifyIdToken: mockVerifyIdToken,
    }));

    // Re-require the controller so it picks up the fresh mock
    jest.isolateModules(() => {
      const oauthController = require("../../controllers/oauthController");
      app = express();
      app.use(express.json());
      app.post("/api/auth/google", oauthController.googleLogin);
    });
  });

  it("should return 400 when tokenId is missing", async () => {
    const response = await request(app).post("/api/auth/google").send({});
    expect(response.status).toBe(400);
    expect(response.body.message).toBe("tokenId is required");
  });

  it("should verify a Google token and return an access token for a new user", async () => {
    const fakePayload = {
      email: "googleuser@example.com",
      name: "Google User",
      sub: "google123",
      picture: "http://example.com/avatar.png",
    };

    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => fakePayload,
    });

    // No existing user found
    User.findOne.mockResolvedValue(null);

    // Mock the User constructor and save
    const mockUserInstance = {
      _id: "user123",
      name: fakePayload.name,
      email: fakePayload.email,
      googleId: fakePayload.sub,
      role: "user",
      refreshToken: null,
      save: jest.fn().mockResolvedValue(true),
    };
    User.mockImplementation(() => mockUserInstance);

    const response = await request(app)
      .post("/api/auth/google")
      .send({ tokenId: "fake-google-token" });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("accessToken", "mock-access-token");
    expect(response.body).toHaveProperty("user");
    expect(response.body.user.email).toBe(fakePayload.email);
    expect(User.findOne).toHaveBeenCalledWith({ email: fakePayload.email });
    expect(mockUserInstance.save).toHaveBeenCalled();
  });

  it("should return existing user if already registered", async () => {
    const fakePayload = {
      email: "existing@example.com",
      name: "Existing User",
      sub: "google456",
      picture: "http://example.com/pic.png",
    };

    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => fakePayload,
    });

    const existingUser = {
      _id: "existingUser123",
      name: "Existing User",
      email: "existing@example.com",
      googleId: "google456",
      role: "user",
      refreshToken: null,
      save: jest.fn().mockResolvedValue(true),
    };
    User.findOne.mockResolvedValue(existingUser);

    const response = await request(app)
      .post("/api/auth/google")
      .send({ tokenId: "fake-google-token" });

    expect(response.status).toBe(200);
    expect(response.body.accessToken).toBe("mock-access-token");
    // Should not create a new user
    expect(User).not.toHaveBeenCalled();
  });

  it("should return 500 when Google token verification fails", async () => {
    mockVerifyIdToken.mockRejectedValue(new Error("Invalid token"));

    const response = await request(app).post("/api/auth/google").send({ tokenId: "bad-token" });

    expect(response.status).toBe(500);
    expect(response.body.message).toBe("Failed to verify Google token");
  });
});
