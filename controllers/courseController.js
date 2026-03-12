const Course = require("../models/Course");
const CourseEnrollment = require("../models/CourseEnrollment");
const User = require("../models/User");
const cloudinary = require("../config/cloudinary");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

exports.getAllCourses = async (req, res) => {
  try {
    const courses = await Course.find().sort({ createdAt: -1 });
    res.json(courses);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getCourseById = async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course) return res.status(404).json({ message: "Course not found" });
    res.json(course);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createCourse = async (req, res) => {
  try {
    if (!req.body.courseData) return res.status(400).json({ error: "courseData is required" });
    const data = JSON.parse(req.body.courseData);

    let imageUrl = null;
    if (req.file) imageUrl = req.file.path;

    const course = new Course({
      ...data,
      images: imageUrl ? [imageUrl] : [],
      createdBy: req.user.id,
      featured: data.featured === true || data.featured === "true",
      enrollmentOpen: data.enrollmentOpen !== false && data.enrollmentOpen !== "false",
    });

    await course.save();
    res.status(201).json({ message: "Course created successfully", course });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateCourse = async (req, res) => {
  try {
    const data = JSON.parse(req.body.courseData);
    const course = await Course.findById(req.params.id);
    if (!course) return res.status(404).json({ message: "Course not found" });

    let imagePath = null;
    if (req.file) {
      // Delete old image from Cloudinary
      if (course.images && course.images.length > 0) {
        const urlParts = course.images[0].split("/");
        const publicId = urlParts[urlParts.length - 1].split(".")[0];
        try { await cloudinary.uploader.destroy(`course-images/${publicId}`); } catch {}
      }
      imagePath = req.file.path;
    }

    const updated = await Course.findByIdAndUpdate(
      req.params.id,
      {
        ...data,
        featured: data.featured === true || data.featured === "true",
        enrollmentOpen: data.enrollmentOpen !== false && data.enrollmentOpen !== "false",
        images: imagePath ? [imagePath] : course.images,
      },
      { new: true }
    );
    res.json({ message: "Course updated", course: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.deleteCourse = async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course) return res.status(404).json({ message: "Course not found" });

    if (course.images && course.images.length > 0) {
      for (const url of course.images) {
        const publicId = url.split("/").pop().split(".")[0];
        try { await cloudinary.uploader.destroy(`course-images/${publicId}`); } catch {}
      }
    }
    await Course.findByIdAndDelete(req.params.id);
    res.json({ message: "Course deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── POST /courses/:courseId/enroll ──────────────────────────────────────────
// Creates a Stripe Checkout session for course enrollment.
// ─────────────────────────────────────────────────────────────────────────────
exports.enrollInCourse = async (req, res) => {
  try {
    const { email } = req.body;
    const course = await Course.findById(req.params.courseId);
    if (!course) return res.status(404).json({ error: "Course not found" });
    if (!course.enrollmentOpen) return res.status(400).json({ error: "Enrollment is closed" });
    if (course.maxEnrollment && course.currentEnrollment >= course.maxEnrollment) {
      return res.status(400).json({ error: "Course is full" });
    }

    // Check if already enrolled
    const existing = await CourseEnrollment.findOne({ courseId: course._id, buyerEmail: email });
    if (existing) return res.status(400).json({ error: "You are already enrolled in this course" });

    if (course.price === 0) {
      // Free course — enroll directly
      const user = await User.findOne({ email });
      const enrollment = new CourseEnrollment({
        courseId: course._id,
        user: user?._id ?? null,
        buyerEmail: email,
        status: "free",
      });
      await enrollment.save();
      await Course.findByIdAndUpdate(course._id, { $inc: { currentEnrollment: 1 } });
      return res.json({ message: "Enrolled successfully", enrollment });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      customer_email: email,
      line_items: [{
        price_data: {
          currency: "gbp",
          product_data: {
            name: `Enroll: ${course.title}`,
            description: course.shortDescription || course.instructor,
          },
          unit_amount: Math.round(course.price * 100),
        },
        quantity: 1,
      }],
      mode: "payment",
      success_url: `${process.env.BACK_END_URL}courses/${course._id}/enrollment-success?session_id={CHECKOUT_SESSION_ID}&email=${encodeURIComponent(email)}`,
      cancel_url: `${process.env.FRONT_END_URL}courses/${course._id}`,
      metadata: { courseId: course._id.toString(), email },
    });

    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── GET /courses/:courseId/enrollment-success ───────────────────────────────
// Stripe redirects here after payment. Verifies, creates enrollment record.
// ─────────────────────────────────────────────────────────────────────────────
exports.handleEnrollmentSuccess = async (req, res) => {
  const { courseId } = req.params;
  const { session_id, email } = req.query;
  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);
    if (session.payment_status !== "paid") return res.redirect(`${process.env.FRONT_END_URL}courses`);

    const existing = await CourseEnrollment.findOne({ paymentId: session.id });
    if (existing) return res.redirect(`${process.env.FRONT_END_URL}course-confirmation?courseId=${courseId}`);

    const user = await User.findOne({ email });
    const enrollment = new CourseEnrollment({
      courseId,
      user: user?._id ?? null,
      buyerEmail: email,
      paymentId: session.id,
      status: "paid",
    });
    await enrollment.save();
    await Course.findByIdAndUpdate(courseId, { $inc: { currentEnrollment: 1 } });

    res.redirect(`${process.env.FRONT_END_URL}course-confirmation?courseId=${courseId}`);
  } catch (err) {
    console.error("Enrollment success error:", err);
    res.redirect(`${process.env.FRONT_END_URL}courses`);
  }
};

exports.getCourseEnrollments = async (req, res) => {
  try {
    const enrollments = await CourseEnrollment.find({ courseId: req.params.courseId })
      .populate("user", "name email");
    res.json(enrollments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};