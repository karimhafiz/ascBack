const Event = require("../models/Event");
const path = require("path");
const fs = require("fs");
const cloudinary = require("../config/cloudinary"); // Add this at the top

// Get all events
exports.getAllEvents = async (req, res) => {
  try {
    const events = await Event.find();

    // Map through events and prepend the base URL to the image paths
    // const updatedEvents = events.map((event) => {
    //   const updatedImages = event.images.map(
    //     (image) => `${req.protocol}://${req.get("host")}/${image}`
    //   );
    //   return { ...event.toObject(), images: updatedImages };
    // });

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

    // Prepend the base URL to the image paths
    // const updatedImages = event.images.map(
    //   (image) => `${req.protocol}://${req.get("host")}/${image}`
    // );

    // res.status(200).json({ ...event.toObject(), images: updatedImages });
    res.status(200).json(event);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Failed to fetch event", error: error.message });
  }
};
// Create a new event
exports.createEvent = async (req, res) => {
  console.log("Headers:", req.headers);
  console.log("req.admin:", req.admin);
  try {
    // Check if eventData exists before parsing
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
      featured,
      isReoccurring,
      reoccurringStartDate,
      reoccurringEndDate,
      reoccurringFrequency,
      dayOfWeek,
      typeOfEvent,
    } = eventData;

    // Handle the uploaded image
    let imageUrl = null;
    if (req.file) {
      imageUrl = req.file.path; // This is the Cloudinary URL
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
      featured: featured === true || featured === "true",
      isReoccurring: isReoccurring === true || isReoccurring === "true",
      reoccurringStartDate,
      reoccurringEndDate,
      reoccurringFrequency,
      dayOfWeek,
      images: imageUrl ? [imageUrl] : [],
      createdBy: req.admin.id,
      typeOfEvent,
      isTournament,
    });

    await newEvent.save();
    res
      .status(201)
      .json({ message: "Event created successfully", event: newEvent });
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
      featured,
      isReoccurring,
      reoccurringStartDate,
      reoccurringEndDate,
      reoccurringFrequency,
      dayOfWeek,
      typeOfEvent, // <-- add this
      isTournament,
    } = JSON.parse(req.body.eventData);

    const event = await Event.findById(req.params.id);

    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    // Handle the uploaded image
    let imagePath = null;
    if (req.file) {
      // Delete the old image from Cloudinary if it exists
      if (event.images && event.images.length > 0) {
        // Extract public_id from the Cloudinary URL
        const urlParts = event.images[0].split("/");
        const publicIdWithExtension = urlParts[urlParts.length - 1];
        const publicId = publicIdWithExtension.split(".")[0];
        const folder = "event-images"; // The folder you used in CloudinaryStorage
        const fullPublicId = `${folder}/${publicId}`;
        try {
          await cloudinary.uploader.destroy(fullPublicId);
        } catch (err) {
          console.error("Failed to delete old image from Cloudinary:", err);
        }
      }
      imagePath = req.file.path; // New Cloudinary URL
    }

    // Update the event in the database
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
        featured: featured === true || featured === "true",
        isReoccurring: isReoccurring === true || isReoccurring === "true",
        reoccurringStartDate,
        reoccurringEndDate,
        reoccurringFrequency,
        dayOfWeek,
        typeOfEvent, // <-- add this
        images: imagePath ? [imagePath] : event.images, // Replace images if a new one is provided
        isTournament,
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

    // Delete associated images from Cloudinary
    if (event.images && event.images.length > 0) {
      for (const imageUrl of event.images) {
        // Extract public_id from the Cloudinary URL
        const urlParts = imageUrl.split("/");
        const publicIdWithExtension = urlParts[urlParts.length - 1];
        const publicId = publicIdWithExtension.split(".")[0];
        const folder = "event-images";
        const fullPublicId = `${folder}/${publicId}`;
        try {
          await cloudinary.uploader.destroy(fullPublicId);
        } catch (err) {
          console.error("Failed to delete image from Cloudinary:", err);
        }
      }
    }

    // Delete the event from the database
    await Event.findByIdAndDelete(req.params.id);

    res.json({ message: "Event deleted successfully" });
  } catch (error) {
    console.error("Error deleting event:", error);
    res.status(500).json({ error: error.message });
  }
};
