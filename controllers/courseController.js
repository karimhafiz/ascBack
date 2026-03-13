const Course = require("../models/Course");
const CourseEnrollment = require("../models/CourseEnrollment");
const User = require("../models/User");
const { deleteCloudinaryImage } = require("../utils/cloudinaryUtils");
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
    if (req.file) imageUrl = req.file.secure_url || req.file.path;

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
      if (course.images && course.images.length > 0) {
        await deleteCloudinaryImage(course.images[0], "course-images");
      }
      imagePath = req.file.secure_url || req.file.path;
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

    for (const url of course.images || []) {
      await deleteCloudinaryImage(url, "course-images");
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
    const { email, participants = [] } = req.body;
    if (!participants.length) {
      return res.status(400).json({ error: "At least one participant is required" });
    }

    const course = await Course.findById(req.params.courseId);
    if (!course) return res.status(404).json({ error: "Course not found" });
    if (!course.enrollmentOpen) return res.status(400).json({ error: "Enrollment is closed" });
    if (course.maxEnrollment && course.currentEnrollment + participants.length > course.maxEnrollment) {
      return res.status(400).json({ error: `Only ${course.maxEnrollment - course.currentEnrollment} spots remaining` });
    }

    const existing = await CourseEnrollment.findOne({
      courseId: course._id,
      buyerEmail: email,
      status: { $in: ["paid", "free", "active", "past_due"] },
    });
    if (existing) {
      if (existing.status === "past_due") {
        return res.status(400).json({ error: "You have a pending payment for this course. Please resolve it before re-enrolling." });
      }
      return res.status(400).json({ error: "You are already enrolled in this course" });
    }

    const count = participants.length;
    const participantsJson = encodeURIComponent(JSON.stringify(participants));

    // Free course — enroll directly
    if (course.price === 0) {
      const user = await User.findOne({ email });
      const enrollment = new CourseEnrollment({
        courseId: course._id,
        user: user?._id ?? null,
        buyerEmail: email,
        status: "free",
        participants,
      });
      await enrollment.save();
      await Course.findByIdAndUpdate(course._id, { $inc: { currentEnrollment: count } });
      return res.json({ message: "Enrolled successfully", enrollment });
    }

    // ── Subscription flow ──────────────────────────────────────────────────
    if (course.isSubscription) {
      // Ensure a Stripe Price exists for this course
      let priceId = course.stripePriceId;
      if (!priceId) {
        // Create product + recurring price on the fly if not yet set up
        const product = await stripe.products.create({
          name: course.title,
          description: course.shortDescription || course.instructor || "",
        });
        const price = await stripe.prices.create({
          product: product.id,
          unit_amount: Math.round(course.price * 100),
          currency: "gbp",
          recurring: { interval: "month" },
        });
        priceId = price.id;
        await Course.findByIdAndUpdate(course._id, {
          stripeProductId: product.id,
          stripePriceId: priceId,
        });
      }

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        customer_email: email,
        line_items: [{ price: priceId, quantity: count }],
        mode: "subscription",
        success_url: `${process.env.BACK_END_URL}courses/${course._id}/enrollment-success?session_id={CHECKOUT_SESSION_ID}&email=${encodeURIComponent(email)}&participants=${participantsJson}`,
        cancel_url: `${process.env.FRONT_END_URL}courses/${course._id}`,
        metadata: { courseId: course._id.toString(), email, count: count.toString(), isSubscription: "true" },
      });
      return res.json({ url: session.url });
    }

    // ── One-time payment flow ──────────────────────────────────────────────
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      customer_email: email,
      line_items: [{
        price_data: {
          currency: "gbp",
          product_data: {
            name: `Enroll: ${course.title}`,
            description: count > 1
              ? `${count} people — ${participants.map(p => p.name).join(", ")}`
              : participants[0].name,
          },
          unit_amount: Math.round(course.price * 100),
        },
        quantity: count,
      }],
      mode: "payment",
      success_url: `${process.env.BACK_END_URL}courses/${course._id}/enrollment-success?session_id={CHECKOUT_SESSION_ID}&email=${encodeURIComponent(email)}&participants=${participantsJson}`,
      cancel_url: `${process.env.FRONT_END_URL}courses/${course._id}`,
      metadata: { courseId: course._id.toString(), email, count: count.toString() },
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
    const session = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ["subscription"],
    });

    // Idempotency — don't create duplicate enrollments
    const existing = await CourseEnrollment.findOne({ paymentId: session.id });
    if (existing) return res.redirect(`${process.env.FRONT_END_URL}course-confirmation?courseId=${courseId}`);

    const user = await User.findOne({ email });
    let participants = [];
    try {
      if (req.query.participants) participants = JSON.parse(decodeURIComponent(req.query.participants));
    } catch {}
    const count = participants.length || parseInt(session.metadata?.count || "1", 10);
    const isSubscription = session.metadata?.isSubscription === "true";

    const enrollmentData = {
      courseId,
      user: user?._id ?? null,
      buyerEmail: email,
      paymentId: session.id,
      status: isSubscription ? "active" : "paid",
      participants,
    };

    // Store subscription details if applicable
    if (isSubscription && session.subscription) {
      const sub = session.subscription;
      enrollmentData.subscriptionId = sub.id;
      enrollmentData.subscriptionStatus = sub.status;
      // current_period_end is a Unix timestamp — only set if it's a valid number
      if (sub.current_period_end && !isNaN(sub.current_period_end)) {
        enrollmentData.currentPeriodEnd = new Date(sub.current_period_end * 1000);
      }
    }

    const enrollment = new CourseEnrollment(enrollmentData);
    await enrollment.save();
    await Course.findByIdAndUpdate(courseId, { $inc: { currentEnrollment: count } });

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

// ─── POST /courses/enrollments/:enrollmentId/cancel ───────────────────────────
// User cancels their subscription — cancels at period end in Stripe so they
// keep access until the date they've already paid for.
// ─────────────────────────────────────────────────────────────────────────────
exports.cancelSubscription = async (req, res) => {
  try {
    const { enrollmentId } = req.params;
    const enrollment = await CourseEnrollment.findById(enrollmentId);
    if (!enrollment) return res.status(404).json({ error: "Enrollment not found" });

    // Only the buyer or admin can cancel
    if (enrollment.buyerEmail !== req.user.email && req.user.role !== "admin") {
      return res.status(403).json({ error: "Not authorised" });
    }

    if (!enrollment.subscriptionId) {
      return res.status(400).json({ error: "This enrollment is not a subscription" });
    }

    if (enrollment.subscriptionStatus === "cancelled") {
      return res.status(400).json({ error: "Subscription is already cancelled" });
    }

    // Cancel at period end — user keeps access until currentPeriodEnd
    await stripe.subscriptions.update(enrollment.subscriptionId, {
      cancel_at_period_end: true,
    });

    await CourseEnrollment.findByIdAndUpdate(enrollmentId, {
      subscriptionStatus: "cancelled",
    });

    res.json({
      message: "Subscription cancelled. You will retain access until the end of your current billing period.",
      currentPeriodEnd: enrollment.currentPeriodEnd,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── POST /courses/enrollments/:enrollmentId/remove-participant ──────────────
// Removes a single participant from an enrollment.
// For subscriptions, also reduces the Stripe subscription quantity.
// ─────────────────────────────────────────────────────────────────────────────
exports.removeParticipant = async (req, res) => {
  try {
    const { enrollmentId } = req.params;
    const { participantIndex } = req.body;

    const enrollment = await CourseEnrollment.findById(enrollmentId);
    if (!enrollment) return res.status(404).json({ error: "Enrollment not found" });

    // Only the buyer or admin can remove participants
    if (enrollment.buyerEmail !== req.user.email && req.user.role !== "admin") {
      return res.status(403).json({ error: "Not authorised" });
    }

    if (
      participantIndex == null ||
      participantIndex < 0 ||
      participantIndex >= enrollment.participants.length
    ) {
      return res.status(400).json({ error: "Invalid participant index" });
    }

    if (enrollment.participants.length <= 1) {
      return res.status(400).json({
        error: "Cannot remove the last participant. Cancel the enrollment instead.",
      });
    }

    const removed = enrollment.participants[participantIndex];

    // Update Stripe subscription quantity first — only proceed if this succeeds
    if (enrollment.subscriptionId && enrollment.subscriptionStatus !== "cancelled") {
      try {
        const subscription = await stripe.subscriptions.retrieve(enrollment.subscriptionId);
        const subItem = subscription.items.data[0];
        if (subItem) {
          await stripe.subscriptionItems.update(subItem.id, {
            quantity: enrollment.participants.length - 1,
          });
        }
      } catch (stripeErr) {
        return res.status(502).json({
          error: "Failed to update subscription billing. Please try again.",
        });
      }
    }

    // Stripe succeeded (or not applicable) — now remove from DB
    enrollment.participants.splice(participantIndex, 1);
    await enrollment.save();

    // Decrement course enrollment count
    await Course.findByIdAndUpdate(enrollment.courseId, {
      $inc: { currentEnrollment: -1 },
    });

    res.json({
      message: `${removed.name} has been removed from this enrollment.`,
      participants: enrollment.participants,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── POST /courses/webhook ────────────────────────────────────────────────────
// Stripe sends events here for subscription lifecycle.
// Must be registered in Stripe Dashboard → Webhooks.
// Key events: invoice.payment_succeeded, customer.subscription.deleted
// ─────────────────────────────────────────────────────────────────────────────
exports.handleWebhook = async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature error:", err.message);
    return res.status(400).json({ error: "Webhook signature verification failed" });
  }

  try {
    switch (event.type) {
      // Subscription renewed successfully — update period end date
      case "invoice.payment_succeeded": {
        const invoice = event.data.object;
        if (invoice.subscription) {
          const sub = await stripe.subscriptions.retrieve(invoice.subscription);
          await CourseEnrollment.findOneAndUpdate(
            { subscriptionId: invoice.subscription },
            {
              subscriptionStatus: "active",
              currentPeriodEnd: new Date(sub.current_period_end * 1000),
              status: "active",
            }
          );
        }
        break;
      }
      // Payment failed — mark as past_due
      case "invoice.payment_failed": {
        const invoice = event.data.object;
        if (invoice.subscription) {
          await CourseEnrollment.findOneAndUpdate(
            { subscriptionId: invoice.subscription },
            { subscriptionStatus: "past_due", status: "past_due" }
          );
        }
        break;
      }
      // Subscription fully ended (period end reached after cancel_at_period_end)
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const enrollment = await CourseEnrollment.findOneAndUpdate(
          { subscriptionId: sub.id },
          { subscriptionStatus: "cancelled", status: "cancelled" },
          { new: false }
        );
        // Decrement course enrollment count by actual participant count
        if (enrollment) {
          const count = enrollment.participants?.length || 1;
          await Course.findByIdAndUpdate(enrollment.courseId, {
            $inc: { currentEnrollment: -count },
          });
        }
        break;
      }
    }
    res.json({ received: true });
  } catch (err) {
    console.error("Webhook handler error:", err);
    res.status(500).json({ error: err.message });
  }
};