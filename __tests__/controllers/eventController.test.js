const request = require("supertest");
const express = require("express");
const mongoose = require("mongoose");

// Mock Stripe before requiring controller
const mockStripe = {
  products: { create: jest.fn() },
  prices: { create: jest.fn() },
};
jest.mock("stripe", () => jest.fn(() => mockStripe));

// Mock dependencies
jest.mock("../../models/Event");
jest.mock("../../config/cloudinary", () => ({}));
jest.mock("../../utils/cloudinaryUtils", () => ({
  deleteCloudinaryImage: jest.fn().mockResolvedValue(true),
}));

const eventController = require("../../controllers/eventController");
const Event = require("../../models/Event");

// Reusable valid ObjectIds
const validEventId = new mongoose.Types.ObjectId().toString();
const validUserId = new mongoose.Types.ObjectId().toString();

describe("Event Controller", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();

    app = express();
    app.use(express.json());

    // Attach a fake user for authenticated routes
    app.use((req, res, next) => {
      req.user = { id: validUserId, role: "admin" };
      next();
    });

    app.get("/api/events", eventController.getAllEvents);
    app.get("/api/events/:id", eventController.getEventById);
    app.post("/api/events", eventController.createEvent);
    app.delete("/api/events/:id", eventController.deleteEvent);
  });

  describe("GET /api/events", () => {
    it("should fetch all events", async () => {
      const mockEvents = [
        { _id: "1", title: "Football", shortDescription: "Practice" },
        { _id: "2", title: "Basketball", shortDescription: "Game" },
      ];
      Event.find.mockResolvedValue(mockEvents);

      const response = await request(app).get("/api/events");

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(2);
      expect(Event.find).toHaveBeenCalled();
    });

    it("should return 500 if database query fails", async () => {
      Event.find.mockRejectedValue(new Error("DB error"));

      const response = await request(app).get("/api/events");

      expect(response.status).toBe(500);
      expect(response.body.error).toBe("Failed to fetch events");
    });
  });

  describe("GET /api/events/:id", () => {
    it("should fetch a single event by ID", async () => {
      const mockEvent = { _id: validEventId, title: "Football" };
      Event.findById.mockResolvedValue(mockEvent);

      const response = await request(app).get(`/api/events/${validEventId}`);

      expect(response.status).toBe(200);
      expect(response.body.title).toBe("Football");
    });

    it("should return 404 if event not found", async () => {
      const nonexistentId = new mongoose.Types.ObjectId().toString();
      Event.findById.mockResolvedValue(null);

      const response = await request(app).get(`/api/events/${nonexistentId}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe("Event not found");
    });

    it("should return 400 for invalid ObjectId", async () => {
      const response = await request(app).get("/api/events/not-valid");

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Invalid event ID");
    });
  });

  describe("POST /api/events", () => {
    it("should create a new event", async () => {
      const eventData = {
        title: "Football",
        shortDescription: "Practice",
        longDescription: "Friendly matches and practice.",
        date: new Date().toISOString(),
        ticketPrice: 10,
        isReoccurring: false,
        city: "London",
        street: "Main Street",
      };

      const savedEvent = {
        _id: "new1",
        ...eventData,
        images: [],
        createdBy: validUserId,
      };
      Event.mockImplementation(function (data) {
        Object.assign(this, data);
        this.save = jest.fn().mockResolvedValue(savedEvent);
        return this;
      });

      const response = await request(app)
        .post("/api/events")
        .send({ eventData: JSON.stringify(eventData) });

      expect(response.status).toBe(201);
      expect(response.body.message).toBe("Event created successfully");
    });

    it("should return 400 if eventData is missing", async () => {
      const response = await request(app).post("/api/events").send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("eventData is required");
    });

    it("should return 400 if eventData is invalid JSON", async () => {
      const response = await request(app).post("/api/events").send({ eventData: "not-json" });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Invalid JSON in eventData");
    });

    it("should create Stripe product/price for recurring paid events", async () => {
      const eventData = {
        title: "Weekly Football",
        shortDescription: "Practice",
        longDescription: "Weekly session",
        date: new Date().toISOString(),
        ticketPrice: 15,
        isReoccurring: true,
        subscriptionInterval: "week",
        city: "London",
        street: "Main Street",
      };

      Event.mockImplementation(function (data) {
        Object.assign(this, data);
        this._id = "evt1";
        this.save = jest.fn().mockResolvedValue(this);
        return this;
      });
      Event.findByIdAndUpdate.mockResolvedValue(true);

      mockStripe.products.create.mockResolvedValue({ id: "prod_123" });
      mockStripe.prices.create.mockResolvedValue({ id: "price_123" });

      const response = await request(app)
        .post("/api/events")
        .send({ eventData: JSON.stringify(eventData) });

      expect(response.status).toBe(201);
      expect(mockStripe.products.create).toHaveBeenCalledWith({
        name: "Weekly Football",
        description: "Practice",
      });
      expect(mockStripe.prices.create).toHaveBeenCalledWith({
        product: "prod_123",
        unit_amount: 1500,
        currency: "gbp",
        recurring: { interval: "week" },
      });
    });

    it("should not create Stripe product for non-recurring events", async () => {
      const eventData = {
        title: "One-off Match",
        shortDescription: "Single game",
        longDescription: "A one-time event",
        date: new Date().toISOString(),
        ticketPrice: 10,
        isReoccurring: false,
        city: "London",
        street: "Main Street",
      };

      Event.mockImplementation(function (data) {
        Object.assign(this, data);
        this._id = "evt2";
        this.save = jest.fn().mockResolvedValue(this);
        return this;
      });

      const response = await request(app)
        .post("/api/events")
        .send({ eventData: JSON.stringify(eventData) });

      expect(response.status).toBe(201);
      expect(mockStripe.products.create).not.toHaveBeenCalled();
    });

    it("should not create Stripe product for free recurring events", async () => {
      const eventData = {
        title: "Free Weekly Class",
        shortDescription: "Free",
        longDescription: "Free weekly class",
        date: new Date().toISOString(),
        ticketPrice: 0,
        isReoccurring: true,
        city: "London",
        street: "Main Street",
      };

      Event.mockImplementation(function (data) {
        Object.assign(this, data);
        this._id = "evt3";
        this.save = jest.fn().mockResolvedValue(this);
        return this;
      });

      const response = await request(app)
        .post("/api/events")
        .send({ eventData: JSON.stringify(eventData) });

      expect(response.status).toBe(201);
      expect(mockStripe.products.create).not.toHaveBeenCalled();
    });
  });

  describe("DELETE /api/events/:id", () => {
    it("should delete an event", async () => {
      const mockEvent = { _id: validEventId, title: "Football", images: [] };
      Event.findById.mockResolvedValue(mockEvent);
      Event.findByIdAndDelete.mockResolvedValue(mockEvent);

      const response = await request(app).delete(`/api/events/${validEventId}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe("Event deleted successfully");
      expect(Event.findByIdAndDelete).toHaveBeenCalledWith(validEventId);
    });

    it("should return 404 if event to delete is not found", async () => {
      const nonexistentId = new mongoose.Types.ObjectId().toString();
      Event.findById.mockResolvedValue(null);

      const response = await request(app).delete(`/api/events/${nonexistentId}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe("Event not found");
    });
  });
});
