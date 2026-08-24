const request = require("supertest");
const express = require("express");
const mongoose = require("mongoose");

jest.mock("../../models/Venue");
jest.mock("../../models/VenueSlot");
jest.mock("../../models/VenueBooking");
jest.mock("../../models/User");
const mockStripeInstance = {
  checkout: {
    sessions: {
      create: jest.fn(),
      retrieve: jest.fn(),
    },
  },
  refunds: {
    create: jest.fn(),
  },
};
jest.mock("stripe", () => jest.fn(() => mockStripeInstance));
jest.mock("../../config/emailConfig", () => ({
  createTransporter: jest.fn().mockResolvedValue({
    sendMail: jest.fn().mockResolvedValue(true),
  }),
}));
jest.mock("../../utils/ticketUtils", () => ({
  generateUniqueCode: jest.fn().mockResolvedValue("VBK-ABC123"),
}));
jest.mock("../../utils/cloudinaryUtils", () => ({
  deleteCloudinaryImage: jest.fn().mockResolvedValue(true),
}));

const venueController = require("../../controllers/venueController");
const { deleteCloudinaryImage } = require("../../utils/cloudinaryUtils");
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

    app.use((req, res, next) => {
      req.user = { _id: validUserId, id: validUserId, email: "user@test.com", role: "user" };
      next();
    });

    app.post(
      "/api/venues",
      (req, res, next) => {
        if (req.user.role !== "admin" && req.user.role !== "moderator") {
          return res.status(403).json({ error: "Only admins and moderators can create venues" });
        }
        next();
      },
      venueController.createVenue
    );
    // Static paths before /:venueId to avoid param capture
    app.post("/api/venues/booking/checkout", venueController.createVenueBookingCheckout);
    app.get("/api/venues/my-bookings", venueController.getUserBookings);
    app.post("/api/venues/booking/:bookingId/cancel", venueController.cancelBooking);
    app.get("/api/venues/:venueId", venueController.getVenue);
    app.put("/api/venues/:venueId", venueController.updateVenue);
    app.post("/api/venues/:venueId/slots", venueController.createVenueSlots);
    app.get("/api/venues/:venueId/slots", venueController.getAvailableSlots);
  });

  describe("POST /api/venues - Create Venue", () => {
    it("should create a venue (admin only)", async () => {
      const adminApp = express();
      adminApp.use(express.json());
      adminApp.use((req, res, next) => {
        req.user = { _id: adminUserId, id: adminUserId, role: "admin", email: "admin@test.com" };
        next();
      });
      adminApp.post("/api/venues", venueController.createVenue);

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

      const response = await request(adminApp).post("/api/venues").send(venueData);

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

    it("should persist an uploaded image onto the created venue", async () => {
      const adminApp = express();
      adminApp.use(express.json());
      adminApp.use((req, res, next) => {
        req.user = { _id: adminUserId, id: adminUserId, role: "admin", email: "admin@test.com" };
        req.file = { secure_url: "https://res.cloudinary.com/demo/venue.jpg" };
        next();
      });
      adminApp.post("/api/venues", venueController.createVenue);

      let savedData;
      Venue.mockImplementationOnce(function (data) {
        savedData = data;
        Object.assign(this, data);
        this.save = jest.fn().mockResolvedValue(true);
      });

      const response = await request(adminApp)
        .post("/api/venues")
        .send({ name: "Community Centre", street: "123 Main St", city: "London" });

      expect(response.status).toBe(201);
      expect(savedData.images).toEqual(["https://res.cloudinary.com/demo/venue.jpg"]);
    });
  });

  describe("PUT /api/venues/:venueId - Update Venue", () => {
    it("should reject an overlapping weeklySchedule", async () => {
      const mockVenue = {
        _id: validVenueId,
        name: "Community Centre",
        images: [],
        save: jest.fn().mockResolvedValue(true),
      };
      Venue.findById.mockResolvedValue(mockVenue);

      const response = await request(app)
        .put(`/api/venues/${validVenueId}`)
        .send({
          weeklySchedule: [
            { dayOfWeek: "monday", startTime: "09:00", endTime: "13:00" },
            { dayOfWeek: "monday", startTime: "12:00", endTime: "16:00" },
          ],
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("monday: 09:00-13:00 and 12:00-16:00");
      expect(mockVenue.save).not.toHaveBeenCalled();
    });

    it("should report every overlapping pair, not just the first", async () => {
      const mockVenue = {
        _id: validVenueId,
        name: "Community Centre",
        images: [],
        save: jest.fn().mockResolvedValue(true),
      };
      Venue.findById.mockResolvedValue(mockVenue);

      const response = await request(app)
        .put(`/api/venues/${validVenueId}`)
        .send({
          weeklySchedule: [
            { dayOfWeek: "monday", startTime: "09:00", endTime: "13:00" },
            { dayOfWeek: "monday", startTime: "12:00", endTime: "16:00" },
            { dayOfWeek: "tuesday", startTime: "08:00", endTime: "10:00" },
            { dayOfWeek: "tuesday", startTime: "09:00", endTime: "11:00" },
          ],
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("monday: 09:00-13:00 and 12:00-16:00");
      expect(response.body.error).toContain("tuesday: 08:00-10:00 and 09:00-11:00");
      expect(mockVenue.save).not.toHaveBeenCalled();
    });

    it("should accept a non-overlapping weeklySchedule", async () => {
      const mockVenue = {
        _id: validVenueId,
        name: "Community Centre",
        images: [],
        save: jest.fn().mockResolvedValue(true),
      };
      Venue.findById.mockResolvedValue(mockVenue);

      const response = await request(app)
        .put(`/api/venues/${validVenueId}`)
        .send({
          weeklySchedule: [
            { dayOfWeek: "monday", startTime: "09:00", endTime: "13:00" },
            { dayOfWeek: "monday", startTime: "13:00", endTime: "17:00" },
          ],
        });

      expect(response.status).toBe(200);
      expect(mockVenue.save).toHaveBeenCalled();
    });

    it("should replace the venue image and delete the old one from Cloudinary", async () => {
      const mockVenue = {
        _id: validVenueId,
        name: "Community Centre",
        images: ["https://res.cloudinary.com/demo/old.jpg"],
        save: jest.fn().mockResolvedValue(true),
      };
      Venue.findById.mockResolvedValue(mockVenue);

      const uploadApp = express();
      uploadApp.use(express.json());
      uploadApp.use((req, res, next) => {
        req.user = { _id: adminUserId, id: adminUserId, role: "admin", email: "admin@test.com" };
        req.file = { secure_url: "https://res.cloudinary.com/demo/new.jpg" };
        next();
      });
      uploadApp.put("/api/venues/:venueId", venueController.updateVenue);

      const response = await request(uploadApp)
        .put(`/api/venues/${validVenueId}`)
        .send({ name: "Community Centre" });

      expect(response.status).toBe(200);
      expect(deleteCloudinaryImage).toHaveBeenCalledWith(
        "https://res.cloudinary.com/demo/old.jpg",
        "venue-images"
      );
      expect(mockVenue.images).toEqual(["https://res.cloudinary.com/demo/new.jpg"]);
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
      };

      Venue.findById.mockReturnValue({
        populate: jest.fn().mockResolvedValue(mockVenue),
      });
      VenueSlot.findOne.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue(null),
          }),
        }),
      });

      const response = await request(app).get(`/api/venues/${validVenueId}`);

      expect(response.status).toBe(200);
      expect(response.body.name).toBe("Community Centre");
      expect(response.body.slotHorizon).toBeNull();
    });

    it("should return 404 for non-existent venue", async () => {
      Venue.findById.mockReturnValue({
        populate: jest.fn().mockResolvedValue(null),
      });

      const response = await request(app).get(`/api/venues/${validVenueId}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe("Venue not found");
    });
  });

  describe("POST /api/venues/:venueId/slots - Create Slots", () => {
    it("should create venue slots (admin only)", async () => {
      const adminApp = express();
      adminApp.use(express.json());
      adminApp.use((req, res, next) => {
        req.user = { _id: adminUserId, id: adminUserId, role: "admin", email: "admin@test.com" };
        next();
      });
      adminApp.post("/api/venues/:venueId/slots", venueController.createVenueSlots);

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
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([]),
        }),
      });
      VenueSlot.insertMany.mockResolvedValue(mockSlots);

      const response = await request(adminApp)
        .post(`/api/venues/${validVenueId}/slots`)
        .send({ date: "2026-05-15", startTime: "09:00" });

      expect(response.status).toBe(201);
      expect(response.body.message).toContain("slot(s) created");
    });

    it("should reject a new slot that overlaps an existing one", async () => {
      const adminApp = express();
      adminApp.use(express.json());
      adminApp.use((req, res, next) => {
        req.user = { _id: adminUserId, id: adminUserId, role: "admin", email: "admin@test.com" };
        next();
      });
      adminApp.post("/api/venues/:venueId/slots", venueController.createVenueSlots);

      Venue.findById.mockResolvedValue({ _id: validVenueId, name: "Community Centre" });
      VenueSlot.find.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest
            .fn()
            .mockResolvedValue([
              { date: new Date("2026-05-15"), startTime: "09:00", endTime: "13:00" },
            ]),
        }),
      });

      const response = await request(adminApp)
        .post(`/api/venues/${validVenueId}/slots`)
        .send({ date: "2026-05-15", startTime: "10:00", endTime: "14:00" });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("overlaps an existing slot");
      expect(VenueSlot.insertMany).not.toHaveBeenCalled();
    });

    it("should report every existing slot a single new slot overlaps, not just the first", async () => {
      const adminApp = express();
      adminApp.use(express.json());
      adminApp.use((req, res, next) => {
        req.user = { _id: adminUserId, id: adminUserId, role: "admin", email: "admin@test.com" };
        next();
      });
      adminApp.post("/api/venues/:venueId/slots", venueController.createVenueSlots);

      Venue.findById.mockResolvedValue({ _id: validVenueId, name: "Community Centre" });
      VenueSlot.find.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([
            { date: new Date("2026-05-15"), startTime: "09:00", endTime: "11:00" },
            { date: new Date("2026-05-15"), startTime: "12:00", endTime: "14:00" },
          ]),
        }),
      });

      const response = await request(adminApp)
        .post(`/api/venues/${validVenueId}/slots`)
        .send({ date: "2026-05-15", startTime: "09:00", endTime: "17:00" });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("overlaps an existing slot (09:00-11:00)");
      expect(response.body.error).toContain("overlaps an existing slot (12:00-14:00)");
      expect(VenueSlot.insertMany).not.toHaveBeenCalled();
    });

    it("should reject a body missing date or startTime", async () => {
      const adminApp = express();
      adminApp.use(express.json());
      adminApp.use((req, res, next) => {
        req.user = { _id: adminUserId, id: adminUserId, role: "admin", email: "admin@test.com" };
        next();
      });
      adminApp.post("/api/venues/:venueId/slots", venueController.createVenueSlots);

      const response = await request(adminApp)
        .post(`/api/venues/${validVenueId}/slots`)
        .send({ date: "2026-05-15" });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("date and startTime are required");
      expect(VenueSlot.insertMany).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/venues/:venueId/slots/generate - Generate Schedule Slots", () => {
    // Both 2026-05-04 and 2026-05-11 are Mondays.
    const weeklySchedule = [{ dayOfWeek: "monday", startTime: "09:00", endTime: "13:00" }];

    function makeGenerateApp() {
      const generateApp = express();
      generateApp.use(express.json());
      generateApp.use((req, res, next) => {
        req.user = { _id: adminUserId, id: adminUserId, role: "admin", email: "admin@test.com" };
        next();
      });
      generateApp.post(
        "/api/venues/:venueId/slots/generate",
        venueController.generateScheduleSlots
      );
      return generateApp;
    }

    it("generates a slot for every matching day when nothing conflicts", async () => {
      Venue.findById.mockResolvedValue({ _id: validVenueId, weeklySchedule });
      VenueSlot.find.mockReturnValue({
        select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
      });
      VenueSlot.insertMany.mockResolvedValue([
        { date: new Date("2026-05-04"), startTime: "09:00", endTime: "13:00" },
        { date: new Date("2026-05-11"), startTime: "09:00", endTime: "13:00" },
      ]);

      const response = await request(makeGenerateApp())
        .post(`/api/venues/${validVenueId}/slots/generate`)
        .send({ fromDate: "2026-05-04", toDate: "2026-05-11" });

      expect(response.status).toBe(201);
      expect(response.body.message).toBe("2 slot(s) generated");
      expect(VenueSlot.insertMany).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ startTime: "09:00" })]),
        { ordered: false }
      );
    });

    it("silently skips a candidate that overlaps an existing slot and reports it", async () => {
      Venue.findById.mockResolvedValue({ _id: validVenueId, weeklySchedule });
      // An existing manually-created slot occupies 2026-05-04's 09:00-13:00 window.
      VenueSlot.find.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest
            .fn()
            .mockResolvedValue([
              { date: new Date("2026-05-04"), startTime: "10:00", endTime: "11:00" },
            ]),
        }),
      });
      VenueSlot.insertMany.mockResolvedValue([
        { date: new Date("2026-05-11"), startTime: "09:00", endTime: "13:00" },
      ]);

      const response = await request(makeGenerateApp())
        .post(`/api/venues/${validVenueId}/slots/generate`)
        .send({ fromDate: "2026-05-04", toDate: "2026-05-11" });

      expect(response.status).toBe(201);
      expect(response.body.message).toBe("1 slot(s) generated (1 skipped — already occupied)");
      // Only the non-conflicting 05-11 candidate should have been inserted.
      const inserted = VenueSlot.insertMany.mock.calls[0][0];
      expect(inserted).toHaveLength(1);
      expect(inserted[0].date.toDateString()).toBe(new Date("2026-05-11").toDateString());
    });

    it("returns 400 and generates nothing when every candidate is already occupied", async () => {
      Venue.findById.mockResolvedValue({ _id: validVenueId, weeklySchedule });
      VenueSlot.find.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([
            { date: new Date("2026-05-04"), startTime: "10:00", endTime: "11:00" },
            { date: new Date("2026-05-11"), startTime: "10:00", endTime: "11:00" },
          ]),
        }),
      });

      const response = await request(makeGenerateApp())
        .post(`/api/venues/${validVenueId}/slots/generate`)
        .send({ fromDate: "2026-05-04", toDate: "2026-05-11" });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("already occupied");
      expect(VenueSlot.insertMany).not.toHaveBeenCalled();
    });
  });

  describe("GET /api/venues/:venueId/slots - Get Available Slots", () => {
    it("should fetch available slots", async () => {
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

      const response = await request(app).get(`/api/venues/${validVenueId}/slots?date=2026-05-15`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].startTime).toBe("09:00");
    });
  });

  describe("POST /api/venues/booking/checkout - Create Booking Checkout", () => {
    it("should create a checkout session for booking", async () => {
      const mockVenue = {
        _id: validVenueId,
        name: "Community Centre",
        capacity: 100,
        pricePerHour: 150,
      };

      const mockSlot = {
        _id: validSlotId,
        venue: validVenueId,
        isAvailable: true,
        date: new Date("2026-05-15"),
        startTime: "09:00",
        endTime: "13:00",
      };

      VenueSlot.findById.mockResolvedValue(mockSlot);
      Venue.findById.mockResolvedValue(mockVenue);

      mockStripeInstance.checkout.sessions.create.mockResolvedValue({
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
        venue: validVenueId,
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
        },
      ];

      VenueBooking.find.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockReturnValue({
            sort: jest.fn().mockResolvedValue(mockBookings),
          }),
        }),
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
        venue: validVenueId,
        slot: validSlotId,
        status: "confirmed",
        paymentStatus: "unpaid",
        stripePaymentId: null,
        cancellationReason: null,
        cancelledAt: null,
        cancelledBy: null,
        save: jest.fn().mockResolvedValue(true),
      };

      const mockSlot = { _id: validSlotId, isAvailable: false, save: jest.fn() };
      const mockUser = { _id: validUserId, name: "John Doe", email: "john@test.com" };
      const mockVenue = { _id: validVenueId, name: "Community Centre" };

      VenueBooking.findById.mockResolvedValue(mockBooking);
      VenueSlot.findById.mockResolvedValue(mockSlot);
      VenueSlot.findByIdAndUpdate.mockResolvedValue(mockSlot);
      User.findById.mockResolvedValue(mockUser);
      Venue.findById.mockResolvedValue(mockVenue);

      // mongoose.startSession used in cancelBooking — mock it
      jest.spyOn(mongoose, "startSession").mockResolvedValue({
        withTransaction: jest.fn().mockImplementation(async (fn) => {
          await fn();
        }),
        endSession: jest.fn(),
      });

      const response = await request(app)
        .post(`/api/venues/booking/${validBookingId}/cancel`)
        .send({ reason: "Schedule conflict" });

      expect(response.status).toBe(200);
      expect(response.body.booking.status).toBe("cancelled");
    });

    it("should reject cancellation of already cancelled booking", async () => {
      VenueBooking.findById.mockResolvedValue({
        _id: validBookingId,
        user: validUserId,
        status: "cancelled",
      });

      const response = await request(app)
        .post(`/api/venues/booking/${validBookingId}/cancel`)
        .send({ reason: "No longer needed" });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("already cancelled");
    });

    it("should reject cancellation of completed booking", async () => {
      VenueBooking.findById.mockResolvedValue({
        _id: validBookingId,
        user: validUserId,
        status: "completed",
      });

      const response = await request(app)
        .post(`/api/venues/booking/${validBookingId}/cancel`)
        .send();

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("Cannot cancel a completed booking");
    });
  });
});
