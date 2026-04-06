const Course = require("../models/Course");
const CourseEnrollment = require("../models/CourseEnrollment");
const User = require("../models/User");
const { deleteCloudinaryImage } = require("../utils/cloudinaryUtils");
const {
  sendCourseEnrollmentEmail,
  sendSubscriptionCancellationEmail,
} = require("../utils/emailUtils");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

// Stripe moved current_period_end from subscription to subscription item
function getSubPeriodEnd(sub) {
  return sub.items?.data?.[0]?.current_period_end ?? sub.current_period_end;
}

const ALLOWED_FIELDS = [
  "title",
  "description",
  "shortDescription",
  "instructor",
  "category",
  "price",
  "schedule",
  "street",
  "city",
  "postCode",
  "maxEnrollment",
  "enrollmentOpen",
  "isSubscription",
  "billingInterval",
  "featured",
];

function sanitize(data) {
  const out = {};
  for (const key of ALLOWED_FIELDS) {
    if (data[key] !== undefined) out[key] = data[key];
  }
  return out;
}

exports.getAllCourses = async (req, res) => {
  try {
    const courses = await Course.find().sort({ createdAt: -1 });
    res.json(courses);
  } catch (err) {
    console.error("Error fetching courses:", err);
    res.status(500).json({ error: "Failed to fetch courses" });
  }
};

exports.getCourseById = async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course) return res.status(404).json({ message: "Course not found" });
    res.json(course);
  } catch (err) {
    console.error("Error fetching course:", err);
    res.status(500).json({ error: "Failed to fetch course" });
  }
};

exports.createCourse = async (req, res) => {
  try {
    if (!req.body.courseData) return res.status(400).json({ error: "courseData is required" });
    const data = JSON.parse(req.body.courseData);

    const imageUrl = req.file ? req.file.secure_url || req.file.path : null;
    const sanitized = sanitize(data);

    const course = new Course({
      ...sanitized,
      images: imageUrl ? [imageUrl] : [],
      createdBy: req.user.id,
      featured: data.featured === true || data.featured === "true",
      enrollmentOpen: data.enrollmentOpen !== false && data.enrollmentOpen !== "false",
    });

    await course.save();
    res.status(201).json({ message: "Course created successfully", course });
  } catch (err) {
    console.error("Error creating course:", err);
    res.status(500).json({ error: "Failed to create course" });
  }
};

exports.updateCourse = async (req, res) => {
  try {
    let data;
    try {
      data = JSON.parse(req.body.courseData);
    } catch {
      return res.status(400).json({ error: "Invalid JSON in courseData" });
    }
    const course = await Course.findById(req.params.id);
    if (!course) return res.status(404).json({ message: "Course not found" });

    let imagePath = null;
    if (req.file) {
      if (course.images && course.images.length > 0) {
        await deleteCloudinaryImage(course.images[0], "course-images");
      }
      imagePath = req.file.secure_url || req.file.path;
    }

    const sanitized = sanitize(data);

    // If billing interval or price changed on a subscription course, invalidate
    // the cached Stripe price so a fresh one is created on next enrollment.
    const intervalChanged =
      sanitized.billingInterval && sanitized.billingInterval !== course.billingInterval;
    const priceChanged = sanitized.price != null && sanitized.price !== course.price;
    const resetStripe =
      course.isSubscription && course.stripePriceId && (intervalChanged || priceChanged);

    const updated = await Course.findByIdAndUpdate(
      req.params.id,
      {
        ...sanitized,
        featured: data.featured === true || data.featured === "true",
        enrollmentOpen: data.enrollmentOpen !== false && data.enrollmentOpen !== "false",
        images: imagePath ? [imagePath] : course.images,
        ...(resetStripe && { stripePriceId: null, stripeProductId: null }),
      },
      { new: true }
    );
    res.json({ message: "Course updated", course: updated });
  } catch (err) {
    console.error("Error updating course:", err);
    res.status(500).json({ error: "Failed to update course" });
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
    console.error("Error deleting course:", err);
    res.status(500).json({ error: "Failed to delete course" });
  }
};

// ─── POST /courses/:courseId/enroll ──────────────────────────────────────────
// Creates a Stripe Checkout session for course enrollment.
// ─────────────────────────────────────────────────────────────────────────────
exports.enrollInCourse = async (req, res) => {
  try {
    const { participants = [] } = req.body;
    const email = req.user.email;
    if (!participants.length) {
      return res.status(400).json({ error: "At least one participant is required" });
    }

    const course = await Course.findById(req.params.courseId);
    if (!course) return res.status(404).json({ error: "Course not found" });
    if (!course.enrollmentOpen) return res.status(400).json({ error: "Enrollment is closed" });
    if (
      course.maxEnrollment &&
      course.currentEnrollment + participants.length > course.maxEnrollment
    ) {
      return res
        .status(400)
        .json({ error: `Only ${course.maxEnrollment - course.currentEnrollment} spots remaining` });
    }

    const existing = await CourseEnrollment.findOne({
      courseId: course._id,
      buyerEmail: email,
      status: { $in: ["paid", "free", "active", "past_due"] },
    });
    if (existing) {
      if (existing.status === "past_due") {
        return res.status(400).json({
          error:
            "You have a pending payment for this course. Please resolve it before re-enrolling.",
        });
      }
      return res.status(400).json({ error: "You are already enrolled in this course" });
    }

    const count = participants.length;

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

      sendCourseEnrollmentEmail({ buyerEmail: email, course, enrollment }).catch((err) =>
        console.error("Failed to send course enrollment email:", err)
      );

      return res.json({ message: "Enrolled successfully", enrollment });
    }

    // ── Subscription flow ──────────────────────────────────────────────────
    if (course.isSubscription) {
      let priceId = course.stripePriceId;
      if (!priceId) {
        const product = await stripe.products.create({
          name: course.title,
          description: course.shortDescription || course.instructor || "",
        });
        const price = await stripe.prices.create({
          product: product.id,
          unit_amount: Math.round(course.price * 100),
          currency: "gbp",
          recurring: { interval: course.billingInterval || "month" },
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
        success_url: `${process.env.BACK_END_URL}courses/${course._id}/enrollment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.FRONT_END_URL}courses/${course._id}`,
        metadata: {
          courseId: course._id.toString(),
          email,
          count: count.toString(),
          isSubscription: "true",
        },
      });

      const user = await User.findOne({ email });
      const pendingEnrollment = new CourseEnrollment({
        courseId: course._id,
        user: user?._id ?? null,
        buyerEmail: email,
        pendingSessionId: session.id,
        status: "pending",
        participants,
      });
      await pendingEnrollment.save();

      return res.json({ url: session.url });
    }

    // ── One-time payment flow ──────────────────────────────────────────────
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      customer_email: email,
      line_items: [
        {
          price_data: {
            currency: "gbp",
            product_data: {
              name: `Enroll: ${course.title}`,
              description:
                count > 1
                  ? `${count} people — ${participants.map((p) => p.name).join(", ")}`
                  : participants[0].name,
            },
            unit_amount: Math.round(course.price * 100),
          },
          quantity: count,
        },
      ],
      mode: "payment",
      success_url: `${process.env.BACK_END_URL}courses/${course._id}/enrollment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONT_END_URL}courses/${course._id}`,
      metadata: { courseId: course._id.toString(), email, count: count.toString() },
    });

    const user = await User.findOne({ email });
    const pendingEnrollment = new CourseEnrollment({
      courseId: course._id,
      user: user?._id ?? null,
      buyerEmail: email,
      pendingSessionId: session.id,
      status: "pending",
      participants,
    });
    await pendingEnrollment.save();

    res.json({ url: session.url });
  } catch (err) {
    console.error("Error processing enrollment:", err);
    res.status(500).json({ error: "Failed to process enrollment" });
  }
};

// ─── GET /courses/:courseId/enrollment-success ───────────────────────────────
// Stripe redirects here after payment. Verifies, creates enrollment record.
// ─────────────────────────────────────────────────────────────────────────────
exports.handleEnrollmentSuccess = async (req, res) => {
  const { courseId } = req.params;
  const { session_id } = req.query;
  try {
    const session = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ["subscription"],
    });

    // Idempotency — don't create duplicate enrollments
    const existing = await CourseEnrollment.findOne({ paymentId: session.id });
    if (existing)
      return res.redirect(`${process.env.FRONT_END_URL}course-confirmation?courseId=${courseId}`);

    const pendingEnrollment = await CourseEnrollment.findOne({
      pendingSessionId: session.id,
      status: "pending",
    });

    const email = session.metadata?.email;
    const participants = pendingEnrollment?.participants || [];
    const count = participants.length || parseInt(session.metadata?.count || "1", 10);
    const isSubscription = session.metadata?.isSubscription === "true";

    if (pendingEnrollment) {
      pendingEnrollment.paymentId = session.id;
      pendingEnrollment.status = isSubscription ? "active" : "paid";
      pendingEnrollment.pendingSessionId = undefined;

      if (isSubscription && session.subscription) {
        const sub = session.subscription;
        pendingEnrollment.subscriptionId = sub.id;
        pendingEnrollment.subscriptionStatus = sub.status;
        const periodTs = getSubPeriodEnd(sub);
        if (periodTs) {
          pendingEnrollment.currentPeriodEnd = new Date(periodTs * 1000);
        }
      }

      await pendingEnrollment.save();
    } else {
      // Fallback: create enrollment if no pending record found
      const user = await User.findOne({ email });
      const enrollmentData = {
        courseId,
        user: user?._id ?? null,
        buyerEmail: email,
        paymentId: session.id,
        status: isSubscription ? "active" : "paid",
        participants,
      };

      if (isSubscription && session.subscription) {
        const sub = session.subscription;
        enrollmentData.subscriptionId = sub.id;
        enrollmentData.subscriptionStatus = sub.status;
        const periodTs = getSubPeriodEnd(sub);
        if (periodTs) {
          enrollmentData.currentPeriodEnd = new Date(periodTs * 1000);
        }
      }

      const enrollment = new CourseEnrollment(enrollmentData);
      await enrollment.save();
    }

    await Course.findByIdAndUpdate(courseId, { $inc: { currentEnrollment: count } });

    const course = await Course.findById(courseId);
    const finalEnrollment =
      pendingEnrollment || (await CourseEnrollment.findOne({ paymentId: session.id }));
    if (course && finalEnrollment) {
      sendCourseEnrollmentEmail({ buyerEmail: email, course, enrollment: finalEnrollment }).catch(
        (err) => console.error("Failed to send course enrollment email:", err)
      );
    }

    res.redirect(`${process.env.FRONT_END_URL}course-confirmation?courseId=${courseId}`);
  } catch (err) {
    console.error("Enrollment success error:", err);
    res.redirect(`${process.env.FRONT_END_URL}courses`);
  }
};

exports.getCourseEnrollments = async (req, res) => {
  try {
    const enrollments = await CourseEnrollment.find({ courseId: req.params.courseId }).populate(
      "user",
      "name email"
    );
    res.json(enrollments);
  } catch (err) {
    console.error("Error fetching enrollments:", err);
    res.status(500).json({ error: "Failed to fetch enrollments" });
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

    const ownerId = enrollment.user?.toString();
    const isOwner = ownerId ? ownerId === req.user.id : enrollment.buyerEmail === req.user.email;
    if (!isOwner && req.user.role !== "admin") {
      return res.status(403).json({ error: "Not authorised" });
    }

    if (!enrollment.subscriptionId) {
      return res.status(400).json({ error: "This enrollment is not a subscription" });
    }

    if (enrollment.subscriptionStatus === "cancelled") {
      return res.status(400).json({ error: "Subscription is already cancelled" });
    }

    const updatedSub = await stripe.subscriptions.update(enrollment.subscriptionId, {
      cancel_at_period_end: true,
    });

    const periodTs = getSubPeriodEnd(updatedSub);
    const periodEnd = periodTs ? new Date(periodTs * 1000) : null;

    await CourseEnrollment.findByIdAndUpdate(enrollmentId, {
      subscriptionStatus: "cancelled",
      ...(periodEnd && { currentPeriodEnd: periodEnd }),
    });

    const course = await Course.findById(enrollment.courseId);
    if (course) {
      sendSubscriptionCancellationEmail({
        buyerEmail: enrollment.buyerEmail,
        course,
        currentPeriodEnd: periodEnd,
      }).catch((err) => console.error("Failed to send cancellation email:", err));
    }

    res.json({
      message:
        "Subscription cancelled. You will retain access until the end of your current billing period.",
      currentPeriodEnd: periodEnd,
    });
  } catch (err) {
    console.error("Error cancelling subscription:", err);
    res.status(500).json({ error: "Failed to cancel subscription" });
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

    const participantOwnerId = enrollment.user?.toString();
    const isParticipantOwner = participantOwnerId
      ? participantOwnerId === req.user.id
      : enrollment.buyerEmail === req.user.email;
    if (!isParticipantOwner && req.user.role !== "admin") {
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
        console.error("Stripe subscription update error:", stripeErr);
        return res.status(502).json({
          error: "Failed to update subscription billing. Please try again.",
        });
      }
    }

    enrollment.participants.splice(participantIndex, 1);
    await enrollment.save();

    await Course.findByIdAndUpdate(enrollment.courseId, {
      $inc: { currentEnrollment: -1 },
    });

    res.json({
      message: `${removed.name} has been removed from this enrollment.`,
      participants: enrollment.participants,
    });
  } catch (err) {
    console.error("Error removing participant:", err);
    res.status(500).json({ error: "Failed to remove participant" });
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
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature error:", err.message);
    return res.status(400).json({ error: "Webhook signature verification failed" });
  }

  try {
    switch (event.type) {
      case "invoice.payment_succeeded": {
        const invoice = event.data.object;
        if (invoice.subscription) {
          const sub = await stripe.subscriptions.retrieve(invoice.subscription);
          await CourseEnrollment.findOneAndUpdate(
            { subscriptionId: invoice.subscription },
            {
              subscriptionStatus: "active",
              currentPeriodEnd: new Date(getSubPeriodEnd(sub) * 1000),
              status: "active",
            }
          );
        }
        break;
      }
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
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const enrollment = await CourseEnrollment.findOneAndUpdate(
          { subscriptionId: sub.id },
          { subscriptionStatus: "cancelled", status: "cancelled" },
          { new: false }
        );
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
    res.status(500).json({ error: "Webhook processing failed" });
  }
};
