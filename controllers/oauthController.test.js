const request = require("supertest");
const express = require("express");
const mongoose = require("mongoose");
const authRoutes = require("../routes/auth");
const User = require("../models/User");

require("dotenv").config();

jest.setTimeout(20000);

// mock google-auth-library
jest.mock("google-auth-library", () => {
  return {
    OAuth2Client: jest.fn().mockImplementation(() => {
      return {
        verifyIdToken: jest.fn(),
      };
    }),
  };
});

const { OAuth2Client } = require("google-auth-library");

describe("Auth Controller", () => {
  beforeAll(async () => {
    await mongoose.connect(process.env.MONGO_URI);
  });

  beforeEach(async () => {
    await User.deleteMany({});
  });

  afterAll(async () => {
    await mongoose.connection.close();
  });

  it("should verify a Google token and return a JWT", async () => {
    const fakePayload = {
      email: "googleuser@example.com",
      name: "Google User",
      sub: "google123",
      picture: "http://example.com/avatar.png",
    };

    // configure the mock to return the payload
    const clientInstance = new OAuth2Client();
    clientInstance.verifyIdToken.mockResolvedValue({
      getPayload: () => fakePayload,
    });

    const app = express();
    app.use(express.json());
    app.use("/api/auth", authRoutes);

    const response = await request(app)
      .post("/api/auth/google")
      .send({ tokenId: "fake-token" });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("token");
    expect(response.body).toHaveProperty("user");
    expect(response.body.user.email).toBe(fakePayload.email);

    // ensure user was persisted in the database
    const userInDb = await User.findOne({ email: fakePayload.email });
    expect(userInDb).not.toBeNull();
    expect(userInDb.googleId).toBe(fakePayload.sub);
  });

  it("should return 400 when tokenId missing", async () => {
    const app = express();
    app.use(express.json());
    app.use("/api/auth", authRoutes);

    const response = await request(app).post("/api/auth/google").send({});
    expect(response.status).toBe(400);
  });
});
