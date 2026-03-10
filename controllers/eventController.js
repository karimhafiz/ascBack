const Event = require("../models/Event");
const path = require("path");
const fs = require("fs");
const cloudinary = require("../config/cloudinary");

// Get all events
exports.getAllEvents = async (req, res) => {
  try {
    const events = await Event.find();
    res.json(events);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Fetch a single event by ID
exports.getEventById = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }
    res.status(200).json(event);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch event", error: error.message });
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
    } catch (e) {
      return res.status(400).json({ error: "Invalid JSON in eventData" });
    }

    const {
      title,
      shortDescription,
      longDescription,
      date,
      openingTime,
      street,
      postCode,
      city,
      ageRestriction,
      accessibilityInfo,
      ticketPrice,
      ticketsAvailable,
      featured,
      isReoccurring,
      reoccurringStartDate,
      reoccurringEndDate,
      reoccurringFrequency,
      dayOfWeek,
      typeOfEvent,
      isTournament,
    } = eventData;

    let imageUrl = null;
    if (req.file) {
      imageUrl = req.file.path;
    }

    const newEvent = new Event({
      title,
      shortDescription,
      longDescription,
      date,
      openingTime,
      street,
      postCode,
      city,
      ageRestriction,
      accessibilityInfo,
      ticketPrice,
      ...(ticketsAvailable !== undefined && { ticketsAvailable }),
      featured: featured === true || featured === "true",
      isReoccurring: isReoccurring === true || isReoccurring === "true",
      reoccurringStartDate,
      reoccurringEndDate,
      reoccurringFrequency,
      dayOfWeek,
      images: imageUrl ? [imageUrl] : [],
      createdBy: req.user.id,
      typeOfEvent,
      isTournament: isTournament === true || isTournament === "true",
    });

    await newEvent.save();
    res.status(201).json({ message: "Event created successfully", event: newEvent });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Update an event
exports.updateEvent = async (req, res) => {
  try {
    const {
      title,
      shortDescription,
      longDescription,
      date,
      openingTime,
      street,
      postCode,
      city,
      ageRestriction,
      accessibilityInfo,
      ticketPrice,
      ticketsAvailable,
      featured,
      isReoccurring,
      reoccurringStartDate,
      reoccurringEndDate,
      reoccurringFrequency,
      dayOfWeek,
      typeOfEvent,
      isTournament,
    } = JSON.parse(req.body.eventData);

    const event = await Event.findById(req.params.id);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    let imagePath = null;
    if (req.file) {
      if (event.images && event.images.length > 0) {
        const urlParts = event.images[0].split("/");
        const publicIdWithExtension = urlParts[urlParts.length - 1];
        const publicId = publicIdWithExtension.split(".")[0];
        const fullPublicId = `event-images/${publicId}`;
        try {
          await cloudinary.uploader.destroy(fullPublicId);
        } catch (err) {
          console.error("Failed to delete old image from Cloudinary:", err);
        }
      }
      imagePath = req.file.path;
    }

    const updatedEvent = await Event.findByIdAndUpdate(
      req.params.id,
      {
        title,
        shortDescription,
        longDescription,
        date,
        openingTime,
        street,
        postCode,
        city,
        ageRestriction,
        accessibilityInfo,
        ticketPrice,
        ...(ticketsAvailable !== undefined && { ticketsAvailable }),
        featured: featured === true || featured === "true",
        isReoccurring: isReoccurring === true || isReoccurring === "true",
        reoccurringStartDate,
        reoccurringEndDate,
        reoccurringFrequency,
        dayOfWeek,
        typeOfEvent,
        isTournament: isTournament === true || isTournament === "true",
        images: imagePath ? [imagePath] : event.images,
      },
      { new: true }
    );

    res.json({ message: "Event updated successfully", event: updatedEvent });
  } catch (error) {
    console.error("Error updating event:", error);
    res.status(500).json({ error: error.message });
  }
};

// Delete an event
exports.deleteEvent = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    if (event.images && event.images.length > 0) {
      for (const imageUrl of event.images) {
        const urlParts = imageUrl.split("/");
        const publicIdWithExtension = urlParts[urlParts.length - 1];
        const publicId = publicIdWithExtension.split(".")[0];
        const fullPublicId = `event-images/${publicId}`;
        try {
          await cloudinary.uploader.destroy(fullPublicId);
        } catch (err) {
          console.error("Failed to delete image from Cloudinary:", err);
        }
      }
    }

    await Event.findByIdAndDelete(req.params.id);
    res.json({ message: "Event deleted successfully" });
  } catch (error) {
    console.error("Error deleting event:", error);
    res.status(500).json({ error: error.message });
  }
};