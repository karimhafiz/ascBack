const mongoose = require("mongoose");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const Venue = require("../models/Venue");
const VenueSlot = require("../models/VenueSlot");
const VenueBooking = require("../models/VenueBooking");
const User = require("../models/User");
const {
  sendVenueBookingConfirmationEmail,
  sendVenueBookingCancellationEmail,
} = require("../utils/emailUtils");
const { generateUniqueCode } = require("../utils/ticketUtils");
const { respondStripeOutage } = require("../utils/stripeErrorUtils");

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

const ALLOWED_VENUE_FIELDS = [
  "name",
  "description",
  "street",
  "postCode",
  "city",
  "capacity",
  "pricePerHour",
  "amenities",
  "rules",
  "cancellationPolicy",
  "isActive",
  "weeklySchedule",
];

function sanitizeVenue(data) {
  const out = {};
  for (const key of ALLOWED_VENUE_FIELDS) {
    if (data[key] !== undefined) out[key] = data[key];
  }
  return out;
}

function calculateEndTime(startTime) {
  const [hours, minutes] = startTime.split(":").map(Number);
  const endHours = (hours + 4) % 24;
  return `${String(endHours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

// ==================== VENUE CRUD ====================

exports.createVenue = async (req, res) => {
  try {
    const sanitized = sanitizeVenue(req.body);
    sanitized.managedBy = req.user.id;
    const venue = new Venue(sanitized);
    await venue.save();
    res.status(201).json({ message: "Venue created successfully", venue });
  } catch (error) {
    console.error("Error creating venue:", error);
    res.status(500).json({ error: error.message });
  }
};

exports.getVenues = async (req, res) => {
  try {
    const venues = await Venue.find({ isActive: true }).select(
      "name description street city postCode capacity pricePerHour amenities weeklySchedule"
    );
    res.json(venues);
  } catch (error) {
    console.error("Error fetching venues:", error);
    res.status(500).json({ error: error.message });
  }
};

exports.getVenue = async (req, res) => {
  try {
    const venue = await Venue.findById(req.params.venueId).populate("managedBy", "name email");
    if (!venue) return res.status(404).json({ error: "Venue not found" });
    res.json(venue);
  } catch (error) {
    console.error("Error fetching venue:", error);
    res.status(500).json({ error: error.message });
  }
};

exports.updateVenue = async (req, res) => {
  try {
    const venue = await Venue.findById(req.params.venueId);
    if (!venue) return res.status(404).json({ error: "Venue not found" });
    Object.assign(venue, sanitizeVenue(req.body));
    await venue.save();
    res.json({ message: "Venue updated successfully", venue });
  } catch (error) {
    console.error("Error updating venue:", error);
    res.status(500).json({ error: error.message });
  }
};

// ==================== SLOT OPERATIONS ====================

/**
 * Create one or more manual slots for a specific date.
 * Body: { date, startTime } for a single slot
 *    or { slots: [{ date, startTime, endTime? }] } for bulk
 */
exports.createVenueSlots = async (req, res) => {
  try {
    const { venueId } = req.params;
    const { date, startTime, slots } = req.body;

    const venue = await Venue.findById(venueId);
    if (!venue) return res.status(404).json({ error: "Venue not found" });

    let slotsToCreate;

    if (slots && Array.isArray(slots)) {
      slotsToCreate = slots.map((s) => ({
        venue: venueId,
        date: new Date(s.date),
        startTime: s.startTime,
        endTime: s.endTime || calculateEndTime(s.startTime),
        isAvailable: true,
        source: "manual",
        createdBy: req.user.id,
      }));
    } else if (date && startTime) {
      slotsToCreate = [
        {
          venue: venueId,
          date: new Date(date),
          startTime,
          endTime: calculateEndTime(startTime),
          isAvailable: true,
          source: "manual",
          createdBy: req.user.id,
        },
      ];
    } else {
      return res.status(400).json({ error: "date + startTime, or slots array, is required" });
    }

    const createdSlots = await VenueSlot.insertMany(slotsToCreate);
    res
      .status(201)
      .json({ message: `${createdSlots.length} slot(s) created`, slots: createdSlots });
  } catch (error) {
    if (error.code === 11000)
      return res
        .status(400)
        .json({ error: "One or more slots already exist for that date and time" });
    console.error("Error creating slots:", error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Generate slots from a weekly schedule template for a date range.
 * Body: { schedule: [{ dayOfWeek, startTime, endTime? }], fromDate, toDate }
 * dayOfWeek: "monday" | "tuesday" | ... | "sunday"
 */
exports.generateScheduleSlots = async (req, res) => {
  try {
    const { venueId } = req.params;
    const { fromDate, toDate } = req.body;

    if (!fromDate || !toDate) {
      return res.status(400).json({ error: "fromDate and toDate are required" });
    }

    const venue = await Venue.findById(venueId);
    if (!venue) return res.status(404).json({ error: "Venue not found" });

    if (!venue.weeklySchedule || venue.weeklySchedule.length === 0) {
      return res.status(400).json({ error: "Venue has no weekly schedule configured" });
    }

    const start = new Date(fromDate);
    const end = new Date(toDate);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    if (end <= start) {
      return res.status(400).json({ error: "toDate must be after fromDate" });
    }

    // Build a lookup: dayOfWeek -> [{ startTime, endTime }]
    const dayMap = {};
    for (const entry of venue.weeklySchedule) {
      if (!dayMap[entry.dayOfWeek]) dayMap[entry.dayOfWeek] = [];
      dayMap[entry.dayOfWeek].push({ startTime: entry.startTime, endTime: entry.endTime });
    }

    const slotsToCreate = [];
    const cursor = new Date(start);

    while (cursor <= end) {
      const dayName = DAYS[cursor.getDay()];
      const entries = dayMap[dayName];
      if (entries) {
        for (const { startTime, endTime } of entries) {
          slotsToCreate.push({
            venue: venueId,
            date: new Date(cursor),
            startTime,
            endTime,
            isAvailable: true,
            source: "schedule",
            createdBy: req.user.id,
          });
        }
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    if (slotsToCreate.length === 0) {
      return res.status(400).json({ error: "No matching days found in the date range" });
    }

    try {
      const result = await VenueSlot.insertMany(slotsToCreate, { ordered: false });
      res.status(201).json({ message: `${result.length} slot(s) generated`, slots: result });
    } catch (error) {
      if (error.code === 11000 || error.name === "MongoBulkWriteError") {
        const inserted = error.insertedDocs ?? [];
        return res.status(201).json({
          message: `${inserted.length} slot(s) generated (some already existed and were skipped)`,
          slots: inserted,
        });
      }
      throw error;
    }
  } catch (error) {
    console.error("Error generating schedule slots:", error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Get available slots for a venue on a specific date.
 * Public. Requires ?date query param.
 */
exports.getAvailableSlots = async (req, res) => {
  try {
    const { venueId } = req.params;
    const { date, from, to } = req.query;

    // Range mode: return distinct dates with available slots and fully-booked dates
    if (from || to) {
      const dateRange = {};
      if (from) {
        const d = new Date(from);
        d.setHours(0, 0, 0, 0);
        dateRange.$gte = d;
      }
      if (to) {
        const d = new Date(to);
        d.setHours(23, 59, 59, 999);
        dateRange.$lte = d;
      }

      const toLocalDateStr = (d) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return `${y}-${m}-${day}`;
      };

      const allSlots = await VenueSlot.find({ venue: venueId, date: dateRange })
        .select("date isAvailable")
        .lean();

      const availableSet = new Set();
      const allDates = new Set(allSlots.map((s) => toLocalDateStr(s.date)));
      allSlots.forEach((s) => {
        if (s.isAvailable) availableSet.add(toLocalDateStr(s.date));
      });

      const bookedDates = [...allDates].filter((d) => !availableSet.has(d));

      return res.json({
        availableDates: [...availableSet],
        bookedDates,
      });
    }

    if (!date) return res.status(400).json({ error: "date query param is required" });

    const startDate = new Date(date);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(date);
    endDate.setHours(23, 59, 59, 999);

    const slots = await VenueSlot.find({
      venue: venueId,
      date: { $gte: startDate, $lte: endDate },
    }).sort({ startTime: 1 });

    res.json(slots);
  } catch (error) {
    console.error("Error fetching available slots:", error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Get all slots for a venue (admin/moderator), including booked.
 * Query params: date (optional)
 */
exports.getAllSlots = async (req, res) => {
  try {
    const { venueId } = req.params;
    const { date } = req.query;

    const query = { venue: venueId };
    if (date) {
      const startDate = new Date(date);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(date);
      endDate.setHours(23, 59, 59, 999);
      query.date = { $gte: startDate, $lte: endDate };
    } else if (req.query.from || req.query.to) {
      query.date = {};
      if (req.query.from) {
        const from = new Date(req.query.from);
        from.setHours(0, 0, 0, 0);
        query.date.$gte = from;
      }
      if (req.query.to) {
        const to = new Date(req.query.to);
        to.setHours(23, 59, 59, 999);
        query.date.$lte = to;
      }
    }

    const slots = await VenueSlot.find(query).sort({ date: 1, startTime: 1 });
    res.json(slots);
  } catch (error) {
    console.error("Error fetching all slots:", error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Delete a slot (admin/moderator). Rejected if an active booking exists.
 */
exports.deleteVenueSlot = async (req, res) => {
  try {
    const { slotId, venueId } = req.params;
    const slot = await VenueSlot.findById(slotId);

    if (!slot) return res.status(404).json({ error: "Slot not found" });
    if (slot.venue.toString() !== venueId) {
      return res.status(400).json({ error: "Slot does not belong to this venue" });
    }

    const booking = await VenueBooking.findOne({ slot: slotId, status: { $ne: "cancelled" } });
    if (booking) {
      return res
        .status(400)
        .json({ error: "Cannot delete slot with active bookings. Cancel the booking first." });
    }

    await VenueSlot.findByIdAndDelete(slotId);
    res.json({ message: "Slot deleted successfully" });
  } catch (error) {
    console.error("Error deleting slot:", error);
    res.status(500).json({ error: error.message });
  }
};

// ==================== BOOKING OPERATIONS ====================

/**
 * Create a Stripe checkout session for a slot booking.
 * Body: { venueId, slotId, numberOfAttendees, eventName?, eventDescription? }
 */
exports.createVenueBookingCheckout = async (req, res) => {
  try {
    const { venueId, slotId, numberOfAttendees, eventName, eventDescription } = req.body;

    if (!venueId || !slotId || !numberOfAttendees) {
      return res.status(400).json({ error: "venueId, slotId, and numberOfAttendees are required" });
    }

    const [venue, slot] = await Promise.all([Venue.findById(venueId), VenueSlot.findById(slotId)]);

    if (!venue) return res.status(404).json({ error: "Venue not found" });
    if (!slot || !slot.isAvailable)
      return res.status(400).json({ error: "Selected slot is not available" });
    if (slot.venue.toString() !== venueId)
      return res.status(400).json({ error: "Slot does not belong to this venue" });

    if (numberOfAttendees > venue.capacity) {
      return res.status(400).json({
        error: `Number of attendees (${numberOfAttendees}) exceeds venue capacity (${venue.capacity})`,
      });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      customer_email: req.user.email,
      line_items: [
        {
          price_data: {
            currency: "gbp",
            product_data: {
              name: `${venue.name} - Venue Booking`,
              description: `${slot.startTime} - ${slot.endTime} on ${slot.date.toDateString()}`,
            },
            unit_amount: Math.round(venue.pricePerHour * 100),
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${process.env.BACK_END_URL}venues/booking/success?session_id={CHECKOUT_SESSION_ID}&slotId=${slotId}&venueId=${venueId}`,
      cancel_url: `${process.env.FRONT_END_URL}venues/book/${venueId}`,
      metadata: {
        venueId: venueId.toString(),
        slotId: slotId.toString(),
        numberOfAttendees: numberOfAttendees.toString(),
        eventName: eventName || "N/A",
        eventDescription: eventDescription || "",
      },
    });

    res.json({ sessionId: session.id, url: session.url });
  } catch (error) {
    if (respondStripeOutage(res, error, "venueController.createVenueBookingCheckout")) return;
    console.error("Error creating venue booking checkout:", error);
    res.status(500).json({ error: "Failed to create checkout session" });
  }
};

/**
 * Confirm a venue booking after successful Stripe payment.
 * Query params: session_id, slotId, venueId
 */
exports.confirmVenueBooking = async (req, res) => {
  try {
    const { session_id: sessionId, slotId, venueId } = req.query;

    if (!sessionId || !slotId || !venueId) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== "paid") {
      return res.status(400).json({ error: "Payment was not completed" });
    }

    // Idempotency check
    const existingBooking = await VenueBooking.findOne({ stripePaymentId: session.payment_intent });
    if (existingBooking) {
      return res.redirect(
        `${process.env.FRONT_END_URL}venue-booking-confirmation?bookingId=${existingBooking._id}`
      );
    }

    const [venue, user] = await Promise.all([
      Venue.findById(venueId),
      User.findOne({ email: session.customer_email }),
    ]);

    if (!user) {
      return res.redirect(`${process.env.FRONT_END_URL}venues/booking`);
    }

    let booking;
    let confirmedSlot;
    const dbSession = await mongoose.startSession();
    try {
      await dbSession.withTransaction(async () => {
        const slot = await VenueSlot.findById(slotId).session(dbSession);
        if (!slot || !slot.isAvailable) {
          throw Object.assign(new Error("Slot unavailable"), { status: 400 });
        }

        slot.isAvailable = false;
        await slot.save({ session: dbSession });
        confirmedSlot = slot;

        booking = new VenueBooking({
          bookingCode: await generateUniqueCode("VBK", VenueBooking, "bookingCode"),
          venue: venueId,
          slot: slotId,
          user: user._id,
          status: "confirmed",
          numberOfAttendees: session.metadata.numberOfAttendees,
          eventName: session.metadata.eventName,
          eventDescription: session.metadata.eventDescription,
          totalPrice: session.amount_total / 100,
          paymentStatus: "paid",
          stripePaymentId: session.payment_intent,
          stripeChargeId: session.payment_intent,
        });
        await booking.save({ session: dbSession });
      });
    } catch (txError) {
      if (txError.status === 400) {
        await stripe.refunds.create({ payment_intent: session.payment_intent });
        return res
          .status(400)
          .json({ error: "Selected slot is no longer available. Payment has been refunded." });
      }
      throw txError;
    } finally {
      dbSession.endSession();
    }

    await sendVenueBookingConfirmationEmail({
      buyerEmail: user.email,
      userName: user.name,
      booking,
      venue,
      slot: confirmedSlot,
    });

    res.redirect(`${process.env.FRONT_END_URL}venue-booking-confirmation?bookingId=${booking._id}`);
  } catch (error) {
    console.error("Error confirming venue booking:", error);
    res.redirect(`${process.env.FRONT_END_URL}venues/booking`);
  }
};

exports.getUserBookings = async (req, res) => {
  try {
    const query = { user: req.user.id };
    if (req.query.status) query.status = req.query.status;

    const bookings = await VenueBooking.find(query)
      .populate("venue", "name street city")
      .populate("slot", "date startTime endTime")
      .sort({ createdAt: -1 });

    res.json(bookings);
  } catch (error) {
    console.error("Error fetching user bookings:", error);
    res.status(500).json({ error: error.message });
  }
};

exports.getBookingDetails = async (req, res) => {
  try {
    const booking = await VenueBooking.findById(req.params.bookingId)
      .populate("venue")
      .populate("slot")
      .populate("user", "name email phone");

    if (!booking) return res.status(404).json({ error: "Booking not found" });

    const bookingUserId = booking.user?._id?.toString() ?? booking.user?.toString();
    if (
      bookingUserId !== req.user.id.toString() &&
      req.user.role !== "admin" &&
      req.user.role !== "moderator"
    ) {
      return res.status(403).json({ error: "Not authorized to view this booking" });
    }

    res.json(booking);
  } catch (error) {
    console.error("Error fetching booking details:", error);
    res.status(500).json({ error: error.message });
  }
};

exports.cancelBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { reason } = req.body;

    const booking = await VenueBooking.findById(bookingId);
    if (!booking) return res.status(404).json({ error: "Booking not found" });

    if (booking.user.toString() !== req.user.id.toString() && req.user.role !== "admin") {
      return res.status(403).json({ error: "Not authorized to cancel this booking" });
    }
    if (booking.status === "cancelled")
      return res.status(400).json({ error: "Booking is already cancelled" });
    if (booking.status === "completed")
      return res.status(400).json({ error: "Cannot cancel a completed booking" });

    if (booking.paymentStatus === "paid" && booking.stripePaymentId) {
      try {
        await stripe.refunds.create({ payment_intent: booking.stripePaymentId });
        booking.paymentStatus = "refunded";
      } catch (stripeError) {
        console.error("Refund error:", stripeError);
        return res.status(500).json({ error: "Failed to process refund" });
      }
    }

    const refunded = booking.paymentStatus === "refunded";

    const dbSession = await mongoose.startSession();
    try {
      await dbSession.withTransaction(async () => {
        booking.status = "cancelled";
        booking.cancellationReason = reason || "No reason provided";
        booking.cancelledAt = new Date();
        booking.cancelledBy = req.user.id;
        await booking.save({ session: dbSession });

        await VenueSlot.findByIdAndUpdate(
          booking.slot,
          { isAvailable: true },
          { session: dbSession }
        );
      });
    } finally {
      dbSession.endSession();
    }

    const [venue, slotInfo] = await Promise.all([
      Venue.findById(booking.venue),
      VenueSlot.findById(booking.slot),
    ]);

    await sendVenueBookingCancellationEmail({
      buyerEmail: req.user.email,
      userName: req.user.name,
      venue,
      slot: slotInfo,
      refunded,
    });

    res.json({ message: "Booking cancelled successfully", booking });
  } catch (error) {
    console.error("Error cancelling booking:", error);
    res.status(500).json({ error: error.message });
  }
};

exports.getAllBookings = async (req, res) => {
  try {
    const query = {};
    if (req.query.status) query.status = req.query.status;
    if (req.query.venueId) query.venue = req.query.venueId;

    const bookings = await VenueBooking.find(query)
      .populate("venue", "name")
      .populate("user", "name email phone")
      .populate("slot", "date startTime endTime")
      .sort({ createdAt: -1 });

    res.json(bookings);
  } catch (error) {
    console.error("Error fetching bookings:", error);
    res.status(500).json({ error: error.message });
  }
};

exports.completeBooking = async (req, res) => {
  try {
    const booking = await VenueBooking.findById(req.params.bookingId);
    if (!booking) return res.status(404).json({ error: "Booking not found" });
    if (booking.status === "completed")
      return res.status(400).json({ error: "Booking is already completed" });

    booking.status = "completed";
    await booking.save();

    res.json({ message: "Booking marked as completed", booking });
  } catch (error) {
    console.error("Error completing booking:", error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = exports;
