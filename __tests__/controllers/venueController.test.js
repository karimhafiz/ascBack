const request = require("supertest");
const express = require("express");
const mongoose = require("mongoose");
const venueController = require("../../controllers/venueController");

// Mock dependencies
jest.mock("../../models/Venue");
jest.mock("../../models/VenueSlot");
jest.mock("../../models/VenueBooking");
jest.mock("../../models/User");
jest.mock("stripe", () => ({
  checkout: {
    sessions: {
      create: jest.fn(),
      retrieve: jest.fn(),
    },
  },
  refunds: {
    create: jest.fn(),
  },
}));
jest.mock("../../config/emailConfig", () => ({
  createTransporter: jest.fn().mockResolvedValue({
    sendMail: jest.fn().mockResolvedValue(true),
  }),
}));

const Venue = require("../../models/Venue");
const VenueSlot = require("../../models/VenueSlot");
const VenueBooking = require("../../models/VenueBooking");
const User = require("../../models/User");

// Reusable valid ObjectIds
const validVenueId = new mongoose.Types.ObjectId().toString();
const validSlotId = new mongoose.Types.ObjectId().toString();
const validBookingId = new mongoose.Types.ObjectId().toString();
const validUserId = new mongoose.Types.ObjectId().toString();
const adminUserId = new mongoose.Types.ObjectId().toString();

describe("Venue Controller", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();

    app = express();
    app.use(express.json());

    // Attach a fake user for authenticated routes
    app.use((req, res, next) => {
      req.user = { _id: validUserId, id: validUserId, email: "user@test.com", role: "user" };
      next();
    });

    // Routes
    app.post("/api/venues", venueController.createVenue);
    app.get("/api/venues/:venueId", venueController.getVenue);
    app.put("/api/venues/:venueId", venueController.updateVenue);
    app.post("/api/venues/:venueId/slots", venueController.createVenueSlots);
    app.get("/api/venues/:venueId/slots", venueController.getAvailableSlots);
    app.post("/api/venues/booking/checkout", venueController.createVenueBookingCheckout);
    app.get("/api/venues/my-bookings", venueController.getUserBookings);
    app.post("/api/venues/booking/:bookingId/cancel", venueController.cancelBooking);
  });

  describe("POST /api/venues - Create Venue", () => {
    it("should create a venue (admin only)", async () => {
      app.use((req, res, next) => {
        req.user = { _id: adminUserId, role: "admin", email: "admin@test.com" };
        next();
      });

      const venueData = {
        name: "Community Centre",
        description: "Main venue",
        street: "123 Main St",
        city: "London",
        capacity: 100,
        pricePerHour: 150,
      };

      const mockVenue = { _id: validVenueId, ...venueData, save: jest.fn() };
      Venue.mockImplementationOnce(() => mockVenue);

      const response = await request(app).post("/api/venues").send(venueData);

      expect(response.status).toBe(201);
      expect(response.body.message).toBe("Venue created successfully");
    });

    it("should reject venue creation for non-admin users", async () => {
      const venueData = {
        name: "Community Centre",
        street: "123 Main St",
        city: "London",
        capacity: 100,
        pricePerHour: 150,
      };

      const response = await request(app).post("/api/venues").send(venueData);

      expect(response.status).toBe(403);
      expect(response.body.error).toContain("Only admins and moderators");
    });
  });

  describe("GET /api/venues/:venueId - Get Venue", () => {
    it("should fetch venue details", async () => {
      const mockVenue = {
        _id: validVenueId,
        name: "Community Centre",
        street: "123 Main St",
        city: "London",
        capacity: 100,
        pricePerHour: 150,
        populate: jest.fn().mockReturnThis(),
      };

      Venue.findById.mockResolvedValue(mockVenue);

      const response = await request(app).get(`/api/venues/${validVenueId}`);

      expect(response.status).toBe(200);
      expect(response.body.name).toBe("Community Centre");
    });

    it("should return 404 for non-existent venue", async () => {
      Venue.findById.mockResolvedValue(null);

      const response = await request(app).get(`/api/venues/${validVenueId}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe("Venue not found");
    });
  });

  describe("POST /api/venues/:venueId/slots - Create Slots", () => {
    it("should create venue slots (admin only)", async () => {
      app.use((req, res, next) => {
        req.user = { _id: adminUserId, role: "admin", email: "admin@test.com" };
        next();
      });

      const mockVenue = { _id: validVenueId, name: "Community Centre" };
      Venue.findById.mockResolvedValue(mockVenue);

      const slotData = {
        date: "2026-05-15",
        startTime: "09:00",
      };

      const mockSlots = [
        {
          _id: validSlotId,
          venue: validVenueId,
          date: new Date(slotData.date),
          startTime: "09:00",
          endTime: "13:00",
          isAvailable: true,
        },
      ];

      VenueSlot.insertMany.mockResolvedValue(mockSlots);

      const response = await request(app).post(`/api/venues/${validVenueId}/slots`).send(slotData);

      expect(response.status).toBe(201);
      expect(response.body.message).toContain("created successfully");
    });
  });

  describe("GET /api/venues/:venueId/slots - Get Available Slots", () => {
    it("should fetch available slots", async () => {
      const mockVenue = { _id: validVenueId, name: "Community Centre" };
      Venue.findById.mockResolvedValue(mockVenue);

      const mockSlots = [
        {
          _id: validSlotId,
          venue: validVenueId,
          date: new Date("2026-05-15"),
          startTime: "09:00",
          endTime: "13:00",
          isAvailable: true,
        },
      ];

      VenueSlot.find.mockReturnValue({
        sort: jest.fn().mockResolvedValue(mockSlots),
      });

      const response = await request(app).get(`/api/venues/${validVenueId}/slots`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].startTime).toBe("09:00");
    });
  });

  describe("POST /api/venues/booking/checkout - Create Booking Checkout", () => {
    it("should create a checkout session for booking", async () => {
      const stripe = require("stripe");

      const mockVenue = {
        _id: validVenueId,
        name: "Community Centre",
        capacity: 100,
        pricePerHour: 150,
      };

      const mockSlot = {
        _id: validSlotId,
        isAvailable: true,
        date: new Date("2026-05-15"),
        startTime: "09:00",
        endTime: "13:00",
      };

      VenueSlot.findById.mockResolvedValue(mockSlot);
      Venue.findById.mockResolvedValue(mockVenue);

      stripe.checkout.sessions.create.mockResolvedValue({
        id: "cs_test_123",
        url: "https://checkout.stripe.com/test",
      });

      const response = await request(app).post("/api/venues/booking/checkout").send({
        venueId: validVenueId,
        slotId: validSlotId,
        numberOfAttendees: 50,
        eventName: "Team Meeting",
      });

      expect(response.status).toBe(200);
      expect(response.body.sessionId).toBe("cs_test_123");
    });

    it("should reject booking for unavailable slot", async () => {
      const mockSlot = { _id: validSlotId, isAvailable: false };

      VenueSlot.findById.mockResolvedValue(mockSlot);

      const response = await request(app).post("/api/venues/booking/checkout").send({
        venueId: validVenueId,
        slotId: validSlotId,
        numberOfAttendees: 50,
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("not available");
    });

    it("should reject booking for exceeding capacity", async () => {
      const mockVenue = {
        _id: validVenueId,
        name: "Community Centre",
        capacity: 30,
        pricePerHour: 150,
      };

      const mockSlot = {
        _id: validSlotId,
        isAvailable: true,
        date: new Date("2026-05-15"),
        startTime: "09:00",
        endTime: "13:00",
      };

      VenueSlot.findById.mockResolvedValue(mockSlot);
      Venue.findById.mockResolvedValue(mockVenue);

      const response = await request(app).post("/api/venues/booking/checkout").send({
        venueId: validVenueId,
        slotId: validSlotId,
        numberOfAttendees: 50,
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("exceeds venue capacity");
    });
  });

  describe("GET /api/venues/my-bookings - Get User Bookings", () => {
    it("should fetch user's bookings", async () => {
      const mockBookings = [
        {
          _id: validBookingId,
          user: validUserId,
          venue: validVenueId,
          slot: validSlotId,
          status: "confirmed",
          numberOfAttendees: 50,
          totalPrice: 150,
          populate: jest.fn().mockReturnThis(),
        },
      ];

      VenueBooking.find.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        sort: jest.fn().mockResolvedValue(mockBookings),
      });

      const response = await request(app).get("/api/venues/my-bookings");

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].status).toBe("confirmed");
    });
  });

  describe("POST /api/venues/booking/:bookingId/cancel - Cancel Booking", () => {
    it("should cancel a user's booking", async () => {
      const mockBooking = {
        _id: validBookingId,
        user: validUserId,
        slot: validSlotId,
        status: "confirmed",
        paymentStatus: "unpaid",
        stripePaymentId: "pi_123",
        save: jest.fn(),
      };

      const mockSlot = {
        _id: validSlotId,
        isAvailable: false,
        save: jest.fn(),
      };

      const mockUser = {
        _id: validUserId,
        name: "John Doe",
        email: "john@test.com",
      };

      const mockVenue = {
        _id: validVenueId,
        name: "Community Centre",
      };

      VenueBooking.findById.mockResolvedValue(mockBooking);
      VenueSlot.findById.mockResolvedValue(mockSlot);
      User.findById.mockResolvedValue(mockUser);
      Venue.findById.mockResolvedValue(mockVenue);

      const response = await request(app)
        .post(`/api/venues/booking/${validBookingId}/cancel`)
        .send({ reason: "Schedule conflict" });

      expect(response.status).toBe(200);
      expect(response.body.booking.status).toBe("cancelled");
    });

    it("should reject cancellation of already cancelled booking", async () => {
      const mockBooking = {
        _id: validBookingId,
        user: validUserId,
        status: "cancelled",
      };

      VenueBooking.findById.mockResolvedValue(mockBooking);

      const response = await request(app)
        .post(`/api/venues/booking/${validBookingId}/cancel`)
        .send({ reason: "No longer needed" });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("already cancelled");
    });

    it("should reject cancellation of completed booking", async () => {
      const mockBooking = {
        _id: validBookingId,
        user: validUserId,
        status: "completed",
      };

      VenueBooking.findById.mockResolvedValue(mockBooking);

      const response = await request(app)
        .post(`/api/venues/booking/${validBookingId}/cancel`)
        .send();

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("Cannot cancel a completed booking");
    });
  });
});
