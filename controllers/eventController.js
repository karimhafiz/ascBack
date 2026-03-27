const Event = require("../models/Event");
const { deleteCloudinaryImage } = require("../utils/cloudinaryUtils");

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

    const imageUrl = req.file ? req.file.path : null;
    const sanitized = sanitize(eventData);

    const newEvent = new Event({
      ...sanitized,
      featured: eventData.featured === true || eventData.featured === "true",
      isReoccurring: eventData.isReoccurring === true || eventData.isReoccurring === "true",
      isTournament: eventData.isTournament === true || eventData.isTournament === "true",
      images: imageUrl ? [imageUrl] : [],
      createdBy: req.user.id,
    });

    await newEvent.save();
    res.status(201).json({ message: "Event created successfully", event: newEvent });
  } catch (error) {
    console.error("Error creating event:", error);
    res.status(500).json({ error: "Failed to create event" });
  }
};

// Update an event
exports.updateEvent = async (req, res) => {
  try {
    const eventData = JSON.parse(req.body.eventData);

    const event = await Event.findById(req.params.id);
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    let imagePath = null;
    if (req.file) {
      if (event.images && event.images.length > 0) {
        await deleteCloudinaryImage(event.images[0], "event-images");
      }
      imagePath = req.file.path;
    }

    const sanitized = sanitize(eventData);

    const updatedEvent = await Event.findByIdAndUpdate(
      req.params.id,
      {
        ...sanitized,
        featured: eventData.featured === true || eventData.featured === "true",
        isReoccurring: eventData.isReoccurring === true || eventData.isReoccurring === "true",
        isTournament: eventData.isTournament === true || eventData.isTournament === "true",
        images: imagePath ? [imagePath] : event.images,
      },
      { new: true }
    );

    res.json({ message: "Event updated successfully", event: updatedEvent });
  } catch (error) {
    console.error("Error updating event:", error);
    res.status(500).json({ error: "Failed to update event" });
  }
};

// Delete an event
exports.deleteEvent = async (req, res) => {
  try {
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
