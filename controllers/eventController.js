const mongoose = require("mongoose");
const Event = require("../models/Event");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { deleteCloudinaryImage } = require("../utils/cloudinaryUtils");

async function createStripeSubscription(event) {
  const product = await stripe.products.create({
    name: event.title,
    description: event.shortDescription || "",
  });
  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: Math.round(event.ticketPrice * 100),
    currency: "gbp",
    recurring: { interval: event.subscriptionInterval || "month" },
  });
  await Event.findByIdAndUpdate(event._id, {
    stripeProductId: product.id,
    stripePriceId: price.id,
  });
  return { stripeProductId: product.id, stripePriceId: price.id };
}

const ALLOWED_FIELDS = [
  "title",
  "shortDescription",
  "longDescription",
  "date",
  "openingTime",
  "street",
  "postCode",
  "city",
  "ageRestriction",
  "accessibilityInfo",
  "ticketPrice",
  "ticketsAvailable",
  "featured",
  "isReoccurring",
  "reoccurringFrequency",
  "reoccurringEndDate",
  "reoccurringStartDate",
  "dayOfWeek",
  "typeOfEvent",
  "isTournament",
  "subscriptionInterval",
];

function sanitize(data) {
  const out = {};
  for (const key of ALLOWED_FIELDS) {
    if (data[key] !== undefined) out[key] = data[key];
  }
  return out;
}

// Get all events
exports.getAllEvents = async (req, res) => {
  try {
    const events = await Event.find();
    res.json(events);
  } catch (error) {
    console.error("Error fetching events:", error);
    res.status(500).json({ error: "Failed to fetch events" });
  }
};

// Fetch a single event by ID
exports.getEventById = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: "Invalid event ID" });
    }

    const event = await Event.findById(req.params.id);
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }
    res.json(event);
  } catch (error) {
    console.error("Error fetching event:", error);
    res.status(500).json({ error: "Failed to fetch event" });
  }
};

// Create a new event
exports.createEvent = async (req, res) => {
  try {
    if (!req.body.eventData) {
      return res.status(400).json({ error: "eventData is required" });
    }

    let eventData;
    try {
      eventData = JSON.parse(req.body.eventData);
    } catch {
      return res.status(400).json({ error: "Invalid JSON in eventData" });
    }

    const imageUrl = req.file ? req.file.path || req.file.secure_url : null;

    eventData.featured = eventData.featured === true || eventData.featured === "true";
    eventData.isReoccurring =
      eventData.isReoccurring === true || eventData.isReoccurring === "true";
    eventData.isTournament = eventData.isTournament === true || eventData.isTournament === "true";

    const sanitized = sanitize(eventData);
    const newEvent = new Event({
      ...sanitized,
      images: imageUrl ? [imageUrl] : [],
      createdBy: req.user.id,
    });

    await newEvent.save();

    if (newEvent.isReoccurring && newEvent.ticketPrice > 0) {
      const { stripeProductId, stripePriceId } = await createStripeSubscription(newEvent);
      newEvent.stripeProductId = stripeProductId;
      newEvent.stripePriceId = stripePriceId;
    }

    res.status(201).json({ message: "Event created successfully", event: newEvent });
  } catch (error) {
    console.error("Error creating event:", error);
    res.status(500).json({ error: "Failed to create event" });
  }
};

// Update an event
exports.updateEvent = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: "Invalid event ID" });
    }

    let eventData;
    try {
      eventData = JSON.parse(req.body.eventData);
    } catch {
      return res.status(400).json({ error: "Invalid JSON in eventData" });
    }

    const event = await Event.findById(req.params.id);
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    let imagePath = null;
    if (req.file) {
      if (event.images && event.images.length > 0) {
        await deleteCloudinaryImage(event.images[0], "event-images");
      }
      imagePath = req.file.path || req.file.secure_url;
    }

    eventData.featured = eventData.featured === true || eventData.featured === "true";
    eventData.isReoccurring =
      eventData.isReoccurring === true || eventData.isReoccurring === "true";
    eventData.isTournament = eventData.isTournament === true || eventData.isTournament === "true";

    const sanitized = sanitize(eventData);
    const updatedEvent = await Event.findByIdAndUpdate(
      req.params.id,
      {
        ...sanitized,
        images: imagePath ? [imagePath] : event.images,
      },
      { new: true }
    );

    if (updatedEvent.isReoccurring && updatedEvent.ticketPrice > 0 && !updatedEvent.stripePriceId) {
      const { stripeProductId, stripePriceId } = await createStripeSubscription(updatedEvent);
      updatedEvent.stripeProductId = stripeProductId;
      updatedEvent.stripePriceId = stripePriceId;
    }

    res.json({ message: "Event updated successfully", event: updatedEvent });
  } catch (error) {
    console.error("Error updating event:", error);
    res.status(500).json({ error: "Failed to update event" });
  }
};

// Delete an event
exports.deleteEvent = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: "Invalid event ID" });
    }

    const event = await Event.findById(req.params.id);
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    for (const imageUrl of event.images || []) {
      await deleteCloudinaryImage(imageUrl, "event-images");
    }

    await Event.findByIdAndDelete(req.params.id);
    res.json({ message: "Event deleted successfully" });
  } catch (error) {
    console.error("Error deleting event:", error);
    res.status(500).json({ error: "Failed to delete event" });
  }
};
