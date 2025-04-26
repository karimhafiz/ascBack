const Event = require("../models/Event");
const path = require("path");
const fs = require("fs");

// Get all events
exports.getAllEvents = async (req, res) => {
  try {
    const events = await Event.find();

    // Map through events and prepend the base URL to the image paths
    const updatedEvents = events.map((event) => {
      const updatedImages = event.images.map(
        (image) => `${req.protocol}://${req.get("host")}/${image}`
      );
      return { ...event.toObject(), images: updatedImages };
    });

    res.json(updatedEvents);
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
    const updatedImages = event.images.map(
      (image) => `${req.protocol}://${req.get("host")}/${image}`
    );

    res.status(200).json({ ...event.toObject(), images: updatedImages });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Failed to fetch event", error: error.message });
  }
};
// Create a new event
exports.createEvent = async (req, res) => {
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
    } = JSON.parse(req.body.eventData);

    // Handle the uploaded image
    let imagePath = null;
    if (req.file) {
      imagePath = path.join("uploads", req.file.filename);
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
      images: imagePath ? [imagePath] : [], // Save the image path in the database
      createdBy: req.admin.id, // Assuming `authMiddleware` adds `req.admin`
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
    } = JSON.parse(req.body.eventData); // Parse the event data from the request body

    const event = await Event.findById(req.params.id);

    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    // Convert `featured` and `isReoccurring` to booleans
    const updatedFeatured = featured === true || featured === "true";
    const updatedIsReoccurring =
      isReoccurring === true || isReoccurring === "true";

    // Handle the uploaded image
    let imagePath = null;
    if (req.file) {
      // Delete existing images
      if (event.images && event.images.length > 0) {
        event.images.forEach((existingImagePath) => {
          const fullPath = path.join(__dirname, "..", existingImagePath);
          fs.unlink(fullPath, (err) => {
            if (err) {
              console.error(`Failed to delete image: ${fullPath}`, err);
            }
          });
        });
      }

      // Save the new image path
      imagePath = path.join("uploads", req.file.filename);
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
        images: imagePath ? [imagePath] : event.images, // Replace images if a new one is provided
      },
      { new: true } // Return the updated document
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

    // Delete associated images
    if (event.images && event.images.length > 0) {
      event.images.forEach((imagePath) => {
        const fullPath = path.join(__dirname, "..", imagePath);
        fs.unlink(fullPath, (err) => {
          if (err) {
            console.error(`Failed to delete image: ${fullPath}`, err);
          }
        });
      });
    }

    // Delete the event from the database
    await Event.findByIdAndDelete(req.params.id);

    res.json({ message: "Event deleted successfully" });
  } catch (error) {
    console.error("Error deleting event:", error);
    res.status(500).json({ error: error.message });
  }
};
