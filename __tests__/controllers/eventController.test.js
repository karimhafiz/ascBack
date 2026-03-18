const request = require("supertest");
const express = require("express");
const eventController = require("../../controllers/eventController");

// Mock dependencies
jest.mock("../../models/Event");
jest.mock("../../config/cloudinary", () => ({}));
jest.mock("../../utils/cloudinaryUtils", () => ({
  deleteCloudinaryImage: jest.fn().mockResolvedValue(true),
}));

const Event = require("../../models/Event");

describe("Event Controller", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();

    app = express();
    app.use(express.json());

    // Attach a fake user for authenticated routes
    app.use((req, res, next) => {
      req.user = { id: "testUserId", role: "admin" };
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
      const mockEvent = { _id: "1", title: "Football" };
      Event.findById.mockResolvedValue(mockEvent);

      const response = await request(app).get("/api/events/1");

      expect(response.status).toBe(200);
      expect(response.body.title).toBe("Football");
    });

    it("should return 404 if event not found", async () => {
      Event.findById.mockResolvedValue(null);

      const response = await request(app).get("/api/events/nonexistent");

      expect(response.status).toBe(404);
      expect(response.body.error).toBe("Event not found");
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
        createdBy: "testUserId",
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
  });

  describe("DELETE /api/events/:id", () => {
    it("should delete an event", async () => {
      const mockEvent = { _id: "1", title: "Football", images: [] };
      Event.findById.mockResolvedValue(mockEvent);
      Event.findByIdAndDelete.mockResolvedValue(mockEvent);

      const response = await request(app).delete("/api/events/1");

      expect(response.status).toBe(200);
      expect(response.body.message).toBe("Event deleted successfully");
      expect(Event.findByIdAndDelete).toHaveBeenCalledWith("1");
    });

    it("should return 404 if event to delete is not found", async () => {
      Event.findById.mockResolvedValue(null);

      const response = await request(app).delete("/api/events/nonexistent");

      expect(response.status).toBe(404);
      expect(response.body.error).toBe("Event not found");
    });
  });
});
