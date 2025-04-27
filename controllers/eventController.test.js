const request = require("supertest");
const express = require("express");
const mongoose = require("mongoose");
const Event = require("../models/Event");
const eventRoutes = require("../routes/events");
require("dotenv").config();

jest.setTimeout(20000); // 20 seconds

const app = express();
app.use(express.json());
app.use("/api/events", eventRoutes); // Fixed the route

jest.mock("../middleware/authMiddleware", () => (req, res, next) => next());
describe("Event Controller", () => {
  beforeEach(async () => {
    await Event.deleteMany({});
  });
  beforeAll(async () => {
    await mongoose.connect(`${process.env.MONGO_URI}`);
  });

  afterAll(async () => {
    // await mongoose.connection.db.dropDatabase(); // Clean up test db
    await mongoose.connection.close();
  });

  it("should fetch all events", async () => {
    const response = await request(app).get("/api/events");
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });

  it("should create a new event", async () => {
    const eventData = {
      title: "Football",
      shortDescription: "Practice",
      longDescription: "Friendly matches and practice.",
      date: new Date(),
      ticketPrice: 10,
      isReoccurring: true,
      reoccurringStartDate: new Date(),
      reoccurringEndDate: new Date(),
      dayOfWeek: "friday",
      city: "London", // Add this
      street: "Main Street", // Add this
    };

    const response = await request(app).post("/api/events").send(eventData);
    console.log("Status:", response.status);
    console.log("Body:", response.body);
    expect(response.status).toBe(201);
    expect(response.body.event.title).toBe("Football");
  });
});
