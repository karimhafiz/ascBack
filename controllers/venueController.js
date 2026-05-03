const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const Venue = require("../models/Venue");
const VenueSlot = require("../models/VenueSlot");
const VenueBooking = require("../models/VenueBooking");
const User = require("../models/User");
const { createTransporter } = require("../config/emailConfig");

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
];

function sanitizeVenue(data) {
  const out = {};
  for (const key of ALLOWED_VENUE_FIELDS) {
    if (data[key] !== undefined) out[key] = data[key];
  }
  return out;
}

// ==================== ADMIN OPERATIONS ====================

/**
 * Create or initialize the community centre venue
 * Admin/Moderator only
 */
exports.createVenue = async (req, res) => {
  try {
    // Check if user is admin or moderator
    if (req.user.role !== "admin" && req.user.role !== "moderator") {
      return res.status(403).json({ error: "Only admins and moderators can create venues" });
    }

    const sanitized = sanitizeVenue(req.body);
    sanitized.managedBy = req.user._id;

    const venue = new Venue(sanitized);
    await venue.save();

    res.status(201).json({
      message: "Venue created successfully",
      venue,
    });
  } catch (error) {
    console.error("Error creating venue:", error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Get venue details
 * Public
 */
exports.getVenue = async (req, res) => {
  try {
    const venue = await Venue.findById(req.params.venueId).populate("managedBy", "name email");

    if (!venue) {
      return res.status(404).json({ error: "Venue not found" });
    }

    res.json(venue);
  } catch (error) {
    console.error("Error fetching venue:", error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Update venue details
 * Admin/Moderator only
 */
exports.updateVenue = async (req, res) => {
  try {
    if (req.user.role !== "admin" && req.user.role !== "moderator") {
      return res.status(403).json({ error: "Only admins and moderators can update venues" });
    }

    const venue = await Venue.findById(req.params.venueId);
    if (!venue) {
      return res.status(404).json({ error: "Venue not found" });
    }

    // Check authorization
    if (venue.managedBy.toString() !== req.user._id.toString() && req.user.role !== "admin") {
      return res.status(403).json({ error: "Not authorized to update this venue" });
    }

    const sanitized = sanitizeVenue(req.body);
    Object.assign(venue, sanitized);
    await venue.save();

    res.json({
      message: "Venue updated successfully",
      venue,
    });
  } catch (error) {
    console.error("Error updating venue:", error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Create available booking slots for the venue
 * Admin/Moderator only
 * Body: { date, startTime, endTime (optional, calculated as startTime + 4 hours) }
 */
exports.createVenueSlots = async (req, res) => {
  try {
    if (req.user.role !== "admin" && req.user.role !== "moderator") {
      return res.status(403).json({ error: "Only admins and moderators can create slots" });
    }

    const { venueId } = req.params;
    const { date, startTime, slots } = req.body;

    if (!venueId || !date) {
      return res.status(400).json({ error: "venueId and date are required" });
    }

    const venue = await Venue.findById(venueId);
    if (!venue) {
      return res.status(404).json({ error: "Venue not found" });
    }

    // Allow creating single slot or multiple slots
    let slotsToCreate = [];

    if (slots && Array.isArray(slots)) {
      // Multiple slots in one request
      slotsToCreate = slots.map((slot) => ({
        venue: venueId,
        date: new Date(slot.date),
        startTime: slot.startTime,
        endTime: slot.endTime || calculateEndTime(slot.startTime),
        isAvailable: true,
        createdBy: req.user._id,
      }));
    } else if (startTime) {
      // Single slot
      const endTime = calculateEndTime(startTime);
      slotsToCreate.push({
        venue: venueId,
        date: new Date(date),
        startTime,
        endTime,
        isAvailable: true,
        createdBy: req.user._id,
      });
    } else {
      return res.status(400).json({ error: "startTime or slots array is required" });
    }

    const createdSlots = await VenueSlot.insertMany(slotsToCreate, { ordered: false }).catch(
      (err) => {
        // Handle duplicate key errors gracefully
        console.error("Duplicate slot error:", err.writeErrors);
        if (err.insertedDocs && err.insertedDocs.length > 0) {
          return err.insertedDocs;
        }
        throw err;
      }
    );

    res.status(201).json({
      message: `${createdSlots.length} slot(s) created successfully`,
      slots: createdSlots,
    });
  } catch (error) {
    console.error("Error creating slots:", error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Get available slots for a venue
 * Public
 */
exports.getAvailableSlots = async (req, res) => {
  try {
    const { venueId } = req.params;
    const { date } = req.query;

    if (!venueId) {
      return res.status(400).json({ error: "venueId is required" });
    }

    const venue = await Venue.findById(venueId);
    if (!venue) {
      return res.status(404).json({ error: "Venue not found" });
    }

    const query = {
      venue: venueId,
      isAvailable: true,
    };

    if (date) {
      const startDate = new Date(date);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(date);
      endDate.setHours(23, 59, 59, 999);
      query.date = { $gte: startDate, $lte: endDate };
    }

    const slots = await VenueSlot.find(query).sort({ date: 1, startTime: 1 });

    res.json(slots);
  } catch (error) {
    console.error("Error fetching available slots:", error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Delete a venue slot (if no booking exists)
 * Admin/Moderator only
 */
exports.deleteVenueSlot = async (req, res) => {
  try {
    if (req.user.role !== "admin" && req.user.role !== "moderator") {
      return res.status(403).json({ error: "Only admins and moderators can delete slots" });
    }

    const { slotId, venueId } = req.params;
    const slot = await VenueSlot.findById(slotId);

    if (!slot) {
      return res.status(404).json({ error: "Slot not found" });
    }

    // Verify slot belongs to the specified venue
    if (slot.venue.toString() !== venueId) {
      return res.status(400).json({ error: "Slot does not belong to this venue" });
    }

    // Check if slot is booked
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

// ==================== USER OPERATIONS ====================

/**
 * Create a checkout session for venue booking
 * User must be authenticated
 */
exports.createVenueBookingCheckout = async (req, res) => {
  try {
    const { venueId, slotId, numberOfAttendees, eventName, eventDescription } = req.body;
    const userEmail = req.user.email;

    if (!venueId || !slotId || !numberOfAttendees) {
      return res.status(400).json({
        error: "venueId, slotId, and numberOfAttendees are required",
      });
    }

    // Validate slot exists and is available
    const slot = await VenueSlot.findById(slotId);
    if (!slot || !slot.isAvailable) {
      return res.status(400).json({ error: "Selected slot is not available" });
    }

    // Get venue details
    const venue = await Venue.findById(venueId);
    if (!venue) {
      return res.status(404).json({ error: "Venue not found" });
    }

    // Check capacity
    if (numberOfAttendees > venue.capacity) {
      return res.status(400).json({
        error: `Number of attendees (${numberOfAttendees}) exceeds venue capacity (${venue.capacity})`,
      });
    }

    const totalPrice = venue.pricePerHour; // 4-hour rate

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      customer_email: userEmail,
      line_items: [
        {
          price_data: {
            currency: "gbp",
            product_data: {
              name: `${venue.name} - Venue Booking`,
              description: `${slot.startTime} - ${slot.endTime} on ${slot.date.toDateString()}`,
            },
            unit_amount: Math.round(totalPrice * 100),
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${process.env.BACK_END_URL}payments/venue-success?session_id={CHECKOUT_SESSION_ID}&slotId=${slotId}&venueId=${venueId}`,
      cancel_url: `${process.env.FRONT_END_URL}venues/book/${venueId}`,
      metadata: {
        venueId: venueId.toString(),
        slotId: slotId.toString(),
        numberOfAttendees: numberOfAttendees.toString(),
        eventName: eventName || "N/A",
        eventDescription: eventDescription || "",
      },
    });

    res.json({
      sessionId: session.id,
      url: session.url,
    });
  } catch (error) {
    console.error("Error creating venue booking checkout:", error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Handle successful venue booking payment
 */
exports.confirmVenueBooking = async (req, res) => {
  try {
    const { sessionId, slotId, venueId } = req.query;
    const userId = req.user._id;

    if (!sessionId || !slotId || !venueId) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    // Retrieve session from Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== "paid") {
      return res.status(400).json({ error: "Payment was not completed" });
    }

    // Check if booking already exists for this session
    const existingBooking = await VenueBooking.findOne({
      stripePaymentId: session.payment_intent,
    });

    if (existingBooking) {
      return res.json({
        message: "Booking already confirmed",
        booking: existingBooking,
      });
    }

    // Verify slot is still available
    const slot = await VenueSlot.findById(slotId);
    if (!slot || !slot.isAvailable) {
      // Attempt refund if slot became unavailable
      await stripe.refunds.create({ payment_intent: session.payment_intent });
      return res.status(400).json({
        error: "Selected slot is no longer available. Payment has been refunded.",
      });
    }

    const venue = await Venue.findById(venueId);
    const user = await User.findById(userId);

    // Create booking
    const booking = new VenueBooking({
      venue: venueId,
      slot: slotId,
      user: userId,
      status: "confirmed",
      numberOfAttendees: session.metadata.numberOfAttendees,
      eventName: session.metadata.eventName,
      eventDescription: session.metadata.eventDescription,
      totalPrice: session.amount_total / 100,
      paymentStatus: "paid",
      stripePaymentId: session.payment_intent,
      stripeChargeId: session.payment_intent,
    });

    // Mark slot as unavailable
    slot.isAvailable = false;
    await Promise.all([booking.save(), slot.save()]);

    // Send confirmation email
    await sendVenueBookingConfirmationEmail({
      buyerEmail: user.email,
      userName: user.name,
      booking,
      venue,
      slot,
    });

    res.json({
      message: "Booking confirmed successfully",
      booking,
    });
  } catch (error) {
    console.error("Error confirming venue booking:", error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Get user's bookings
 */
exports.getUserBookings = async (req, res) => {
  try {
    const userId = req.user._id;
    const { status } = req.query;

    const query = { user: userId };
    if (status) {
      query.status = status;
    }

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

/**
 * Get booking details
 */
exports.getBookingDetails = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const userId = req.user._id;

    const booking = await VenueBooking.findById(bookingId)
      .populate("venue")
      .populate("slot")
      .populate("user", "name email phone");

    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    // Users can only see their own bookings, admins can see all
    if (booking.user._id.toString() !== userId.toString() && req.user.role !== "admin") {
      return res.status(403).json({ error: "Not authorized to view this booking" });
    }

    res.json(booking);
  } catch (error) {
    console.error("Error fetching booking details:", error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Cancel a booking
 */
exports.cancelBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { reason } = req.body;
    const userId = req.user._id;

    const booking = await VenueBooking.findById(bookingId);

    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    // Check authorization
    if (booking.user.toString() !== userId.toString() && req.user.role !== "admin") {
      return res.status(403).json({ error: "Not authorized to cancel this booking" });
    }

    if (booking.status === "cancelled") {
      return res.status(400).json({ error: "Booking is already cancelled" });
    }

    if (booking.status === "completed") {
      return res.status(400).json({ error: "Cannot cancel a completed booking" });
    }

    // Handle refund if payment was made
    if (booking.paymentStatus === "paid" && booking.stripePaymentId) {
      try {
        await stripe.refunds.create({
          payment_intent: booking.stripePaymentId,
        });
        booking.paymentStatus = "refunded";
      } catch (stripeError) {
        console.error("Refund error:", stripeError);
        return res.status(500).json({ error: "Failed to process refund" });
      }
    }

    // Update booking
    booking.status = "cancelled";
    booking.cancellationReason = reason || "No reason provided";
    booking.cancelledAt = new Date();
    booking.cancelledBy = userId;

    // Release the slot
    const slot = await VenueSlot.findById(booking.slot);
    if (slot) {
      slot.isAvailable = true;
      await slot.save();
    }

    await booking.save();

    // Send cancellation email
    const user = await User.findById(userId);
    const venue = await Venue.findById(booking.venue);
    const slotInfo = await VenueSlot.findById(booking.slot);

    await sendBookingCancellationEmail({
      buyerEmail: user.email,
      userName: user.name,
      venue,
      slot: slotInfo,
      refunded: booking.paymentStatus === "refunded",
    });

    res.json({
      message: "Booking cancelled successfully",
      booking,
    });
  } catch (error) {
    console.error("Error cancelling booking:", error);
    res.status(500).json({ error: error.message });
  }
};

// ==================== ADMIN OPERATIONS - BOOKINGS ====================

/**
 * Get all bookings (Admin only)
 */
exports.getAllBookings = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Only admins can view all bookings" });
    }

    const { status, venueId } = req.query;

    const query = {};
    if (status) query.status = status;
    if (venueId) query.venue = venueId;

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

/**
 * Mark booking as completed (Admin only)
 */
exports.completeBooking = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Only admins can complete bookings" });
    }

    const { bookingId } = req.params;
    const booking = await VenueBooking.findById(bookingId);

    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    if (booking.status === "completed") {
      return res.status(400).json({ error: "Booking is already completed" });
    }

    booking.status = "completed";
    await booking.save();

    res.json({
      message: "Booking marked as completed",
      booking,
    });
  } catch (error) {
    console.error("Error completing booking:", error);
    res.status(500).json({ error: error.message });
  }
};

// ==================== HELPER FUNCTIONS ====================

function calculateEndTime(startTime) {
  const [hours, minutes] = startTime.split(":").map(Number);
  const endHours = (hours + 4) % 24;
  return `${String(endHours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

async function sendVenueBookingConfirmationEmail({ buyerEmail, userName, booking, venue, slot }) {
  try {
    const transporter = await createTransporter();

    const slotDate = new Date(slot.date).toLocaleDateString("en-GB", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const venueAddress = [venue.street, venue.city, venue.postCode].filter(Boolean).join(", ");

    const html = `
      <div style="max-width:600px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;color:#0f1510;">
        <div style="background-color:#08b3f7;padding:24px;text-align:center;">
          <h1 style="margin:0;color:#ffffff;font-size:24px;">Venue Booking Confirmed</h1>
        </div>
        <div style="padding:24px;background-color:#ffffff;">
          <p style="margin:0 0 16px;font-size:16px;">Dear ${userName},</p>
          <p style="margin:0 0 24px;font-size:16px;">Your venue booking has been confirmed. Here are your booking details:</p>
          
          <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
            <tr><td style="padding:8px 0;font-weight:bold;width:150px;color:#618e9e;">Venue</td><td style="padding:8px 0;">${venue.name}</td></tr>
            <tr><td style="padding:8px 0;font-weight:bold;color:#618e9e;">Address</td><td style="padding:8px 0;">${venueAddress}</td></tr>
            <tr><td style="padding:8px 0;font-weight:bold;color:#618e9e;">Capacity</td><td style="padding:8px 0;">${venue.capacity} people</td></tr>
            <tr><td style="padding:8px 0;font-weight:bold;color:#618e9e;">Attendees</td><td style="padding:8px 0;">${booking.numberOfAttendees}</td></tr>
            <tr><td style="padding:8px 0;font-weight:bold;color:#618e9e;">Date</td><td style="padding:8px 0;">${slotDate}</td></tr>
            <tr><td style="padding:8px 0;font-weight:bold;color:#618e9e;">Time</td><td style="padding:8px 0;">${slot.startTime} - ${slot.endTime}</td></tr>
            <tr><td style="padding:8px 0;font-weight:bold;color:#618e9e;">Price</td><td style="padding:8px 0;">&pound;${booking.totalPrice.toFixed(2)}</td></tr>
          </table>

          ${booking.eventName ? `<p style="margin:0 0 8px;font-size:14px;"><strong>Event:</strong> ${booking.eventName}</p>` : ""}
          ${booking.eventDescription ? `<p style="margin:0 0 16px;font-size:14px;"><strong>Description:</strong> ${booking.eventDescription}</p>` : ""}

          <div style="background-color:#cef0fd;border:1px solid #08b3f7;border-radius:8px;padding:16px;text-align:center;margin-bottom:24px;">
            <p style="margin:0;font-size:14px;color:#0f1510;"><strong>Your booking reference: ${booking._id.toString().slice(-8).toUpperCase()}</strong></p>
          </div>

          <div style="background-color:#f9f9f9;border-left:4px solid #08b3f7;padding:16px;margin-bottom:24px;">
            <h3 style="margin:0 0 8px;font-size:14px;color:#0f1510;">Important Information</h3>
            <p style="margin:0;font-size:13px;color:#618e9e;">Please arrive 15 minutes before your booking time. Contact the venue directly if you need to reschedule or cancel.</p>
            ${venue.rules ? `<p style="margin:8px 0 0;font-size:13px;color:#618e9e;"><strong>Venue Rules:</strong> ${venue.rules}</p>` : ""}
          </div>

          <p style="margin:0 0 8px;font-size:14px;">If you need to cancel or modify your booking, please visit your bookings page.</p>
        </div>
        <div style="background-color:#e6f7fe;padding:16px;text-align:center;font-size:12px;color:#618e9e;">
          <p style="margin:0;">This email was sent by ASC Events. Do not reply to this email.</p>
        </div>
      </div>
    `;

    await transporter.sendMail({
      from: `"ASC Events" <${process.env.EMAIL_USER}>`,
      to: buyerEmail,
      subject: `Venue Booking Confirmed - ${venue.name}`,
      html,
    });
  } catch (error) {
    console.error("Error sending booking confirmation email:", error);
  }
}

async function sendBookingCancellationEmail({ buyerEmail, userName, venue, slot, refunded }) {
  try {
    const transporter = await createTransporter();

    const slotDate = new Date(slot.date).toLocaleDateString("en-GB", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const html = `
      <div style="max-width:600px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;color:#0f1510;">
        <div style="background-color:#ff6b6b;padding:24px;text-align:center;">
          <h1 style="margin:0;color:#ffffff;font-size:24px;">Booking Cancelled</h1>
        </div>
        <div style="padding:24px;background-color:#ffffff;">
          <p style="margin:0 0 16px;font-size:16px;">Dear ${userName},</p>
          <p style="margin:0 0 24px;font-size:16px;">Your venue booking has been cancelled.</p>
          
          <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
            <tr><td style="padding:8px 0;font-weight:bold;width:150px;color:#618e9e;">Venue</td><td style="padding:8px 0;">${venue.name}</td></tr>
            <tr><td style="padding:8px 0;font-weight:bold;color:#618e9e;">Date</td><td style="padding:8px 0;">${slotDate}</td></tr>
            <tr><td style="padding:8px 0;font-weight:bold;color:#618e9e;">Time</td><td style="padding:8px 0;">${slot.startTime} - ${slot.endTime}</td></tr>
            ${refunded ? `<tr><td style="padding:8px 0;font-weight:bold;color:#618e9e;">Refund Status</td><td style="padding:8px 0;color:#27ae60;">Refunded</td></tr>` : ""}
          </table>

          ${
            refunded
              ? `<div style="background-color:#d5f4e6;border:1px solid #27ae60;border-radius:8px;padding:16px;text-align:center;margin-bottom:24px;">
            <p style="margin:0;font-size:14px;color:#0f1510;"><strong>Your refund has been processed and should appear in your account within 3-5 business days.</strong></p>
          </div>`
              : ""
          }

          <p style="margin:0;font-size:14px;">If you have any questions about your cancellation, please contact us.</p>
        </div>
        <div style="background-color:#e6f7fe;padding:16px;text-align:center;font-size:12px;color:#618e9e;">
          <p style="margin:0;">This email was sent by ASC Events. Do not reply to this email.</p>
        </div>
      </div>
    `;

    await transporter.sendMail({
      from: `"ASC Events" <${process.env.EMAIL_USER}>`,
      to: buyerEmail,
      subject: `Booking Cancelled - ${venue.name}`,
      html,
    });
  } catch (error) {
    console.error("Error sending cancellation email:", error);
  }
}

module.exports = exports;
