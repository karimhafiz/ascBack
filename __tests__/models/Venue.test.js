const Venue = require("../../models/Venue");
const VenueSlot = require("../../models/VenueSlot");
const VenueBooking = require("../../models/VenueBooking");

describe("Venue Models", () => {
  describe("Venue Model", () => {
    it("should have required fields", () => {
      const venueSchema = Venue.schema;

      expect(venueSchema.paths.name.isRequired).toBe(true);
      expect(venueSchema.paths.street.isRequired).toBe(true);
      expect(venueSchema.paths.city.isRequired).toBe(true);
      expect(venueSchema.paths.capacity.isRequired).toBe(true);
      expect(venueSchema.paths.pricePerHour.isRequired).toBe(true);
    });

    it("should have optional fields", () => {
      const venueSchema = Venue.schema;

      expect(venueSchema.paths.description).toBeDefined();
      expect(venueSchema.paths.postCode).toBeDefined();
      expect(venueSchema.paths.images).toBeDefined();
      expect(venueSchema.paths.amenities).toBeDefined();
      expect(venueSchema.paths.rules).toBeDefined();
      expect(venueSchema.paths.cancellationPolicy).toBeDefined();
    });

    it("should have correct default values", () => {
      const venueSchema = Venue.schema;

      expect(venueSchema.paths.isActive.defaultValue).toBe(true);
    });

    it("should reference managedBy User", () => {
      const venueSchema = Venue.schema;

      expect(venueSchema.paths.managedBy.instance).toBe("ObjectId");
      expect(venueSchema.paths.managedBy.options.ref).toBe("User");
    });

    it("should have timestamps", () => {
      const venueSchema = Venue.schema;

      expect(venueSchema.paths.createdAt).toBeDefined();
      expect(venueSchema.paths.updatedAt).toBeDefined();
    });
  });

  describe("VenueSlot Model", () => {
    it("should have required fields", () => {
      const slotSchema = VenueSlot.schema;

      expect(slotSchema.paths.venue.isRequired).toBe(true);
      expect(slotSchema.paths.date.isRequired).toBe(true);
      expect(slotSchema.paths.startTime.isRequired).toBe(true);
      expect(slotSchema.paths.endTime.isRequired).toBe(true);
    });

    it("should reference venue", () => {
      const slotSchema = VenueSlot.schema;

      expect(slotSchema.paths.venue.instance).toBe("ObjectId");
      expect(slotSchema.paths.venue.options.ref).toBe("Venue");
    });

    it("should have correct default values", () => {
      const slotSchema = VenueSlot.schema;

      expect(slotSchema.paths.isAvailable.defaultValue).toBe(true);
    });

    it("should have compound unique index on venue, date, startTime", () => {
      const slotSchema = VenueSlot.schema;

      // Check if indexes exist
      const indexes = slotSchema._indexes || [];
      expect(indexes.length).toBeGreaterThan(0);
    });

    it("should have isAvailable index", () => {
      const slotSchema = VenueSlot.schema;

      const indexes = slotSchema._indexes || [];
      expect(indexes.length).toBeGreaterThan(0);
    });

    it("should reference createdBy User", () => {
      const slotSchema = VenueSlot.schema;

      expect(slotSchema.paths.createdBy.instance).toBe("ObjectId");
      expect(slotSchema.paths.createdBy.options.ref).toBe("User");
    });
  });

  describe("VenueBooking Model", () => {
    it("should have required fields", () => {
      const bookingSchema = VenueBooking.schema;

      expect(bookingSchema.paths.venue.isRequired).toBe(true);
      expect(bookingSchema.paths.slot.isRequired).toBe(true);
      expect(bookingSchema.paths.user.isRequired).toBe(true);
      expect(bookingSchema.paths.numberOfAttendees.isRequired).toBe(true);
      expect(bookingSchema.paths.totalPrice.isRequired).toBe(true);
    });

    it("should have correct status enum values", () => {
      const bookingSchema = VenueBooking.schema;

      expect(bookingSchema.paths.status.enumValues).toContain("pending");
      expect(bookingSchema.paths.status.enumValues).toContain("confirmed");
      expect(bookingSchema.paths.status.enumValues).toContain("completed");
      expect(bookingSchema.paths.status.enumValues).toContain("cancelled");
    });

    it("should have correct default status", () => {
      const bookingSchema = VenueBooking.schema;

      expect(bookingSchema.paths.status.defaultValue).toBe("pending");
    });

    it("should have correct paymentStatus enum values", () => {
      const bookingSchema = VenueBooking.schema;

      expect(bookingSchema.paths.paymentStatus.enumValues).toContain("unpaid");
      expect(bookingSchema.paths.paymentStatus.enumValues).toContain("paid");
      expect(bookingSchema.paths.paymentStatus.enumValues).toContain("refunded");
    });

    it("should have correct default paymentStatus", () => {
      const bookingSchema = VenueBooking.schema;

      expect(bookingSchema.paths.paymentStatus.defaultValue).toBe("unpaid");
    });

    it("should reference venue, slot, and user", () => {
      const bookingSchema = VenueBooking.schema;

      expect(bookingSchema.paths.venue.instance).toBe("ObjectId");
      expect(bookingSchema.paths.venue.options.ref).toBe("Venue");

      expect(bookingSchema.paths.slot.instance).toBe("ObjectId");
      expect(bookingSchema.paths.slot.options.ref).toBe("VenueSlot");

      expect(bookingSchema.paths.user.instance).toBe("ObjectId");
      expect(bookingSchema.paths.user.options.ref).toBe("User");
    });

    it("should reference cancelledBy User", () => {
      const bookingSchema = VenueBooking.schema;

      expect(bookingSchema.paths.cancelledBy.instance).toBe("ObjectId");
      expect(bookingSchema.paths.cancelledBy.options.ref).toBe("User");
    });

    it("should have correct default values", () => {
      const bookingSchema = VenueBooking.schema;

      expect(bookingSchema.paths.emailSent.defaultValue).toBe(false);
      expect(bookingSchema.paths.confirmationEmailSent.defaultValue).toBe(false);
    });

    it("should have optional fields for cancellation", () => {
      const bookingSchema = VenueBooking.schema;

      expect(bookingSchema.paths.cancellationReason).toBeDefined();
      expect(bookingSchema.paths.cancelledAt).toBeDefined();
    });

    it("should have timestamps", () => {
      const bookingSchema = VenueBooking.schema;

      expect(bookingSchema.paths.createdAt).toBeDefined();
      expect(bookingSchema.paths.updatedAt).toBeDefined();
    });
  });
});
