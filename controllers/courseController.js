const mongoose = require("mongoose");
const Course = require("../models/Course");
const CourseEnrollment = require("../models/CourseEnrollment");
const User = require("../models/User");
const WebhookEvent = require("../models/WebhookEvent");
const { deleteCloudinaryImage } = require("../utils/cloudinaryUtils");
const {
  sendCourseEnrollmentEmail,
  sendSubscriptionCancellationEmail,
} = require("../utils/emailUtils");
const { generateUniqueCode } = require("../utils/ticketUtils");
const { respondStripeOutage } = require("../utils/stripeErrorUtils");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

// Stripe moved current_period_end from subscription to subscription item
function getSubPeriodEnd(sub) {
  return sub.items?.data?.[0]?.current_period_end ?? sub.current_period_end;
}

function resolveCurrentPeriodEnd(sub, fallbackInterval = "month") {
  const periodTs = getSubPeriodEnd(sub);
  if (periodTs) return new Date(periodTs * 1000);
  console.warn(`Missing current_period_end for sub ${sub.id}, using fallback`);
  const now = new Date();
  if (fallbackInterval === "year") now.setFullYear(now.getFullYear() + 1);
  else now.setMonth(now.getMonth() + 1);
  return now;
}

// Create a Stripe product + recurring price for a subscription course,
// then persist the IDs back to the course document.
async function createStripeProductAndPrice(course) {
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
  await Course.findByIdAndUpdate(course._id, {
    stripeProductId: product.id,
    stripePriceId: price.id,
  });
  return { stripeProductId: product.id, stripePriceId: price.id };
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
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: "Invalid course ID" });
    }

    const course = await Course.findById(req.params.id);
    if (!course) return res.status(404).json({ error: "Course not found" });
    res.json(course);
  } catch (err) {
    console.error("Error fetching course:", err);
    res.status(500).json({ error: "Failed to fetch course" });
  }
};

exports.createCourse = async (req, res) => {
  try {
    if (!req.body.courseData) return res.status(400).json({ error: "courseData is required" });

    let data;
    try {
      data = JSON.parse(req.body.courseData);
    } catch {
      return res.status(400).json({ error: "Invalid JSON in courseData" });
    }

    const imageUrl = req.file ? req.file.secure_url || req.file.path : null;
    data.featured = data.featured === true || data.featured === "true";
    data.enrollmentOpen = data.enrollmentOpen !== false && data.enrollmentOpen !== "false";
    const sanitized = sanitize(data);

    const course = new Course({
      ...sanitized,
      images: imageUrl ? [imageUrl] : [],
      createdBy: req.user.id,
    });

    await course.save();

    // Create Stripe product + price upfront for subscription courses
    if (course.isSubscription && course.price > 0) {
      const { stripeProductId, stripePriceId } = await createStripeProductAndPrice(course);
      course.stripeProductId = stripeProductId;
      course.stripePriceId = stripePriceId;
    }

    res.status(201).json({ message: "Course created successfully", course });
  } catch (err) {
    console.error("Error creating course:", err);
    res.status(500).json({ error: "Failed to create course" });
  }
};

exports.updateCourse = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: "Invalid course ID" });
    }

    let data;
    try {
      data = JSON.parse(req.body.courseData);
    } catch {
      return res.status(400).json({ error: "Invalid JSON in courseData" });
    }
    const course = await Course.findById(req.params.id);
    if (!course) return res.status(404).json({ error: "Course not found" });

    let imagePath = null;
    if (req.file) {
      if (course.images && course.images.length > 0) {
        await deleteCloudinaryImage(course.images[0], "course-images");
      }
      imagePath = req.file.secure_url || req.file.path;
    }

    data.featured = data.featured === true || data.featured === "true";
    data.enrollmentOpen = data.enrollmentOpen !== false && data.enrollmentOpen !== "false";
    const sanitized = sanitize(data);

    // If billing interval or price changed on a subscription course, create
    // a new Stripe product + price immediately.
    const intervalChanged =
      sanitized.billingInterval && sanitized.billingInterval !== course.billingInterval;
    const priceChanged = sanitized.price != null && sanitized.price !== course.price;
    const needsNewStripe =
      course.isSubscription && course.price > 0 && (intervalChanged || priceChanged);

    let stripeFields = {};
    if (needsNewStripe) {
      // Apply updated price/interval to a temp object for Stripe creation
      const updatedCourse = { ...course.toObject(), ...sanitized };
      stripeFields = await createStripeProductAndPrice(updatedCourse);
    }

    const updated = await Course.findByIdAndUpdate(
      req.params.id,
      {
        ...sanitized,
        ...stripeFields,
        images: imagePath ? [imagePath] : course.images,
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
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: "Invalid course ID" });
    }

    const course = await Course.findById(req.params.id);
    if (!course) return res.status(404).json({ error: "Course not found" });

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
    if (!mongoose.Types.ObjectId.isValid(req.params.courseId)) {
      return res.status(400).json({ error: "Invalid course ID" });
    }

    const { participants = [], phone } = req.body;
    const email = req.user.email;
    if (!phone || !phone.trim()) {
      return res.status(400).json({ error: "Phone number is required" });
    }
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
        enrollmentCode: await generateUniqueCode("ENR", CourseEnrollment, "enrollmentCode"),
        courseId: course._id,
        user: user?._id ?? null,
        buyerEmail: email,
        buyerPhone: phone.trim(),
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
      if (!course.stripePriceId) {
        return res.status(500).json({
          error: "This course is missing its Stripe price configuration. Please contact an admin.",
        });
      }
      const priceId = course.stripePriceId;

      const session = await stripe.checkout.sessions.create({
        customer_email: email,
        line_items: [{ price: priceId, quantity: count }],
        mode: "subscription",
        success_url: `${process.env.BACK_END_URL}courses/${course._id}/enrollment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.FRONT_END_URL}courses/${course._id}`,
        metadata: {
          courseId: course._id.toString(),
          email,
          phone: phone.trim(),
          count: count.toString(),
          isSubscription: "true",
        },
      });

      const user = await User.findOne({ email });
      const pendingEnrollment = new CourseEnrollment({
        enrollmentCode: await generateUniqueCode("ENR", CourseEnrollment, "enrollmentCode"),
        courseId: course._id,
        user: user?._id ?? null,
        buyerEmail: email,
        buyerPhone: phone.trim(),
        pendingSessionId: session.id,
        status: "pending",
        participants,
      });
      await pendingEnrollment.save();

      return res.json({ url: session.url });
    }

    // ── One-time payment flow ──────────────────────────────────────────────
    const session = await stripe.checkout.sessions.create({
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
      metadata: {
        courseId: course._id.toString(),
        email,
        phone: phone.trim(),
        count: count.toString(),
      },
    });

    const user = await User.findOne({ email });
    const pendingEnrollment = new CourseEnrollment({
      enrollmentCode: await generateUniqueCode("ENR", CourseEnrollment, "enrollmentCode"),
      courseId: course._id,
      user: user?._id ?? null,
      buyerEmail: email,
      buyerPhone: phone.trim(),
      pendingSessionId: session.id,
      status: "pending",
      participants,
    });
    await pendingEnrollment.save();

    res.json({ url: session.url });
  } catch (err) {
    if (respondStripeOutage(res, err, "courseController.enrollInCourse")) return;
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

  if (!session_id) {
    return res.redirect(`${process.env.FRONT_END_URL}courses`);
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ["subscription"],
    });

    // Idempotency — don't create duplicate enrollments
    const existing = await CourseEnrollment.findOne({ paymentId: session.id });
    if (existing)
      return res.redirect(`${process.env.FRONT_END_URL}course-confirmation?courseId=${courseId}`);

    // ── Reactivation flow — atomic update, no enrollment count change ──
    const reactivateId = session.metadata?.reactivateEnrollmentId;
    if (reactivateId) {
      const $set = {
        paymentId: session.id,
        status: "active",
        subscriptionStatus: session.subscription?.status || "active",
      };

      if (session.subscription) {
        const sub = session.subscription;
        $set.subscriptionId = sub.id;
        $set.currentPeriodEnd = resolveCurrentPeriodEnd(sub);
      }

      const enrollment = await CourseEnrollment.findByIdAndUpdate(
        reactivateId,
        { $set, $unset: { pendingSessionId: 1 } },
        { new: true }
      );

      if (enrollment) {
        const course = await Course.findById(courseId);
        if (course) {
          sendCourseEnrollmentEmail({
            buyerEmail: enrollment.buyerEmail,
            course,
            enrollment,
          }).catch((err) => console.error("Failed to send reactivation email:", err));
        }

        return res.redirect(
          `${process.env.FRONT_END_URL}course-confirmation?courseId=${courseId}&reactivated=true`
        );
      }
    }

    const email = session.metadata?.email;
    const isSubscription = session.metadata?.isSubscription === "true";

    // ── Transaction: update/create enrollment + increment course count ──
    const mongoSession = await mongoose.startSession();
    let finalEnrollment;
    try {
      await mongoSession.withTransaction(async () => {
        // Build subscription fields if applicable
        const subFields = {};
        if (isSubscription && session.subscription) {
          const sub = session.subscription;
          subFields.subscriptionId = sub.id;
          subFields.subscriptionStatus = sub.status;
          subFields.currentPeriodEnd = resolveCurrentPeriodEnd(sub);
        }

        // Try to atomically update a pending enrollment first
        finalEnrollment = await CourseEnrollment.findOneAndUpdate(
          { pendingSessionId: session.id, status: "pending" },
          {
            $set: {
              paymentId: session.id,
              status: isSubscription ? "active" : "paid",
              ...subFields,
            },
            $unset: { pendingSessionId: 1 },
          },
          { new: true, session: mongoSession }
        );

        let count;
        if (finalEnrollment) {
          count = finalEnrollment.participants?.length || 1;
        } else {
          // Fallback: create enrollment if no pending record found
          const user = await User.findOne({ email }, null, { session: mongoSession });
          const enrollmentData = {
            enrollmentCode: await generateUniqueCode("ENR", CourseEnrollment, "enrollmentCode"),
            courseId,
            user: user?._id ?? null,
            buyerEmail: email,
            buyerPhone: session.metadata?.phone || "N/A",
            paymentId: session.id,
            status: isSubscription ? "active" : "paid",
            participants: [],
            ...subFields,
          };

          const enrollment = new CourseEnrollment(enrollmentData);
          await enrollment.save({ session: mongoSession });
          finalEnrollment = enrollment;
          count = parseInt(session.metadata?.count || "1", 10);
        }

        await Course.findByIdAndUpdate(
          courseId,
          { $inc: { currentEnrollment: count } },
          { session: mongoSession }
        );
      });
    } finally {
      await mongoSession.endSession();
    }

    // Fire-and-forget: send confirmation email
    const course = await Course.findById(courseId);
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
    if (!mongoose.Types.ObjectId.isValid(req.params.courseId)) {
      return res.status(400).json({ error: "Invalid course ID" });
    }

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
    if (!mongoose.Types.ObjectId.isValid(enrollmentId)) {
      return res.status(400).json({ error: "Invalid enrollment ID" });
    }

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

    const periodEnd = resolveCurrentPeriodEnd(updatedSub);

    await CourseEnrollment.findByIdAndUpdate(enrollmentId, {
      subscriptionStatus: "cancelled",
      currentPeriodEnd: periodEnd,
    });
    // this could use better handling and let the user know theres no course with that courseId (if necessary)
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
    if (respondStripeOutage(res, err, "courseController.cancelSubscription")) return;
    console.error("Error cancelling subscription:", err);
    res.status(500).json({ error: "Failed to cancel subscription" });
  }
};

// ─── POST /courses/enrollments/:enrollmentId/reactivate ─────────────────────
// User reactivates a subscription that was cancelled but hasn't expired yet.
// Removes cancel_at_period_end in Stripe so the subscription continues renewing.
// ─────────────────────────────────────────────────────────────────────────────
exports.reactivateSubscription = async (req, res) => {
  try {
    const { enrollmentId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(enrollmentId)) {
      return res.status(400).json({ error: "Invalid enrollment ID" });
    }

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

    if (enrollment.subscriptionStatus !== "cancelled") {
      return res.status(400).json({ error: "Subscription is not cancelled" });
    }

    // Try to reactivate in Stripe by removing cancel_at_period_end
    let canReactivateDirectly = false;
    try {
      const stripeSub = await stripe.subscriptions.retrieve(enrollment.subscriptionId);
      // Subscription still exists and isn't fully terminated
      if (stripeSub.status !== "canceled") {
        canReactivateDirectly = true;
      }
    } catch (stripeErr) {
      if (stripeErr.code !== "resource_missing") throw stripeErr;
      // Subscription gone from Stripe — fall through to checkout flow
    }

    if (canReactivateDirectly) {
      const updatedSub = await stripe.subscriptions.update(enrollment.subscriptionId, {
        cancel_at_period_end: false,
      });

      const periodEnd = resolveCurrentPeriodEnd(updatedSub);

      await CourseEnrollment.findByIdAndUpdate(enrollmentId, {
        subscriptionStatus: "active",
        currentPeriodEnd: periodEnd,
      });

      return res.json({
        message: "Subscription reactivated successfully.",
        currentPeriodEnd: periodEnd,
      });
    }

    // Stripe subscription is gone — create a new checkout session so the user
    // can resubscribe. The existing enrollment will be updated on success.
    const course = await Course.findById(enrollment.courseId);
    if (!course) return res.status(404).json({ error: "Course not found" });

    if (!course.stripePriceId) {
      return res.status(500).json({
        error: "This course is missing its Stripe price configuration. Please contact an admin.",
      });
    }
    const priceId = course.stripePriceId;

    const count = enrollment.participants?.length || 1;

    // If the user still has time left on their current period, defer
    // the first charge to when that period ends so they don't pay twice.
    const subscriptionData = {};
    if (enrollment.currentPeriodEnd && new Date(enrollment.currentPeriodEnd) > new Date()) {
      subscriptionData.trial_end = Math.floor(
        new Date(enrollment.currentPeriodEnd).getTime() / 1000
      );
    }

    const session = await stripe.checkout.sessions.create({
      customer_email: enrollment.buyerEmail,
      line_items: [{ price: priceId, quantity: count }],
      mode: "subscription",
      ...(subscriptionData.trial_end && { subscription_data: subscriptionData }),
      success_url: `${process.env.BACK_END_URL}courses/${course._id}/enrollment-success?session_id={CHECKOUT_SESSION_ID}&reactivate=${enrollmentId}`,
      cancel_url: `${process.env.FRONT_END_URL}courses/${course._id}`,
      metadata: {
        courseId: course._id.toString(),
        email: enrollment.buyerEmail,
        count: count.toString(),
        isSubscription: "true",
        reactivateEnrollmentId: enrollmentId,
      },
    });

    // Mark enrollment as pending reactivation
    await CourseEnrollment.findByIdAndUpdate(enrollmentId, {
      pendingSessionId: session.id,
    });

    return res.json({ url: session.url });
  } catch (err) {
    if (respondStripeOutage(res, err, "courseController.reactivateSubscription")) return;
    console.error("Error reactivating subscription:", err);
    res.status(500).json({ error: "Failed to reactivate subscription" });
  }
};

// ─── GET /courses/:courseId/my-enrollment ─────────────────────────────────────
// Returns the current user's active enrollment for this course, if any.
// ─────────────────────────────────────────────────────────────────────────────
exports.getMyEnrollment = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.courseId)) {
      return res.status(400).json({ error: "Invalid course ID" });
    }

    const enrollment = await CourseEnrollment.findOne({
      courseId: req.params.courseId,
      buyerEmail: req.user.email,
      status: { $in: ["paid", "free", "active", "past_due"] },
    });
    if (!enrollment) return res.json({ enrollment: null });

    // If this is a cancelled subscription whose paid period has passed,
    // expire it now. The user paid through currentPeriodEnd — honour that.
    if (
      enrollment.subscriptionId &&
      enrollment.subscriptionStatus === "cancelled" &&
      enrollment.currentPeriodEnd &&
      new Date(enrollment.currentPeriodEnd) < new Date()
    ) {
      const count = enrollment.participants?.length || 1;
      await CourseEnrollment.findByIdAndUpdate(enrollment._id, {
        status: "cancelled",
      });
      await Course.findByIdAndUpdate(enrollment.courseId, {
        $inc: { currentEnrollment: -count },
      });
      return res.json({ enrollment: null });
    }

    res.json({ enrollment });
  } catch (err) {
    console.error("Error fetching enrollment:", err);
    res.status(500).json({ error: "Failed to fetch enrollment" });
  }
};

// ─── POST /courses/enrollments/:enrollmentId/add-participant ─────────────────
// Adds a participant to an existing enrollment.
// For subscriptions, also increases the Stripe subscription quantity.
// ─────────────────────────────────────────────────────────────────────────────
exports.addParticipant = async (req, res) => {
  try {
    const { enrollmentId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(enrollmentId)) {
      return res.status(400).json({ error: "Invalid enrollment ID" });
    }

    const { name, age, email } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Participant name is required" });
    }

    const enrollment = await CourseEnrollment.findById(enrollmentId);
    if (!enrollment) return res.status(404).json({ error: "Enrollment not found" });

    if (enrollment.status === "cancelled") {
      return res.status(400).json({ error: "Cannot add participants to a cancelled enrollment" });
    }

    if (enrollment.subscriptionId && enrollment.subscriptionStatus === "cancelled") {
      return res.status(400).json({ error: "Cannot add participants to a cancelled subscription" });
    }

    const ownerId = enrollment.user?.toString();
    const isOwner = ownerId ? ownerId === req.user.id : enrollment.buyerEmail === req.user.email;
    if (!isOwner && req.user.role !== "admin") {
      return res.status(403).json({ error: "Not authorised" });
    }

    // Duplicate check — same name + email already on this enrollment
    const trimmedName = name.trim();
    const trimmedEmail = email?.trim().toLowerCase();
    const isDuplicate = enrollment.participants.some(
      (p) => p.name === trimmedName && (trimmedEmail ? p.email === trimmedEmail : !p.email)
    );
    if (isDuplicate) {
      return res
        .status(409)
        .json({ error: "A participant with this name and email already exists" });
    }

    // Update Stripe subscription quantity first (external call, before transaction)
    let previousQuantity;
    if (enrollment.subscriptionId && enrollment.subscriptionStatus !== "cancelled") {
      try {
        const subscription = await stripe.subscriptions.retrieve(enrollment.subscriptionId);
        const subItem = subscription.items.data[0];
        if (subItem) {
          previousQuantity = subItem.quantity;
          await stripe.subscriptionItems.update(subItem.id, {
            quantity: enrollment.participants.length + 1,
          });
        }
      } catch (stripeErr) {
        console.error("Stripe subscription update error:", stripeErr);
        return res.status(502).json({
          error: "Failed to update subscription billing. Please try again.",
        });
      }
    }

    // Atomic: capacity check + push participant + increment course count
    const mongoSession = await mongoose.startSession();
    let updatedEnrollment;
    try {
      await mongoSession.withTransaction(async () => {
        // Atomic capacity guard — allows unlimited if maxEnrollment is null/unset
        const course = await Course.findOneAndUpdate(
          {
            _id: enrollment.courseId,
            $or: [
              { maxEnrollment: null },
              { $expr: { $lt: ["$currentEnrollment", "$maxEnrollment"] } },
            ],
          },
          { $inc: { currentEnrollment: 1 } },
          { session: mongoSession, new: true }
        );
        if (!course) throw new Error("Course is full");

        updatedEnrollment = await CourseEnrollment.findByIdAndUpdate(
          enrollmentId,
          {
            $push: {
              participants: {
                name: trimmedName,
                age: age || undefined,
                email: trimmedEmail || undefined,
              },
            },
          },
          { new: true, session: mongoSession }
        );
      });
    } catch (txErr) {
      // Revert Stripe quantity if the transaction failed
      if (previousQuantity !== undefined) {
        try {
          const sub = await stripe.subscriptions.retrieve(enrollment.subscriptionId);
          const subItem = sub.items.data[0];
          if (subItem) {
            await stripe.subscriptionItems.update(subItem.id, { quantity: previousQuantity });
          }
        } catch (revertErr) {
          console.error("Failed to revert Stripe subscription quantity:", revertErr);
        }
      }

      if (txErr.message === "Course is full") {
        return res.status(400).json({ error: "Course is full" });
      }
      throw txErr;
    } finally {
      await mongoSession.endSession();
    }

    res.json({
      message: `${trimmedName} has been added to this enrollment.`,
      participants: updatedEnrollment.participants,
    });
  } catch (err) {
    if (respondStripeOutage(res, err, "courseController.addParticipant")) return;
    console.error("Error adding participant:", err);
    res.status(500).json({ error: "Failed to add participant" });
  }
};

// ─── POST /courses/enrollments/:enrollmentId/remove-participant ──────────────
// Removes a single participant from an enrollment.
// For subscriptions, also reduces the Stripe subscription quantity.
// ─────────────────────────────────────────────────────────────────────────────
exports.removeParticipant = async (req, res) => {
  try {
    const { enrollmentId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(enrollmentId)) {
      return res.status(400).json({ error: "Invalid enrollment ID" });
    }

    const { participantId } = req.body;
    if (!participantId || !mongoose.Types.ObjectId.isValid(participantId)) {
      return res.status(400).json({ error: "Valid participantId is required" });
    }

    const enrollment = await CourseEnrollment.findById(enrollmentId);
    if (!enrollment) return res.status(404).json({ error: "Enrollment not found" });

    const ownerId = enrollment.user?.toString();
    const isOwner = ownerId ? ownerId === req.user.id : enrollment.buyerEmail === req.user.email;
    if (!isOwner && req.user.role !== "admin") {
      return res.status(403).json({ error: "Not authorised" });
    }

    const participant = enrollment.participants.id(participantId);
    if (!participant) {
      return res.status(404).json({ error: "Participant not found" });
    }

    if (enrollment.participants.length <= 1) {
      return res.status(400).json({
        error: "Cannot remove the last participant. Cancel the enrollment instead.",
      });
    }

    if (enrollment.subscriptionId && enrollment.subscriptionStatus === "cancelled") {
      return res.status(400).json({
        error:
          "Cannot remove participants from a cancelled subscription. All participants retain access until the end of the billing period.",
      });
    }

    const removedName = participant.name;

    // Update Stripe subscription quantity first (external call, before transaction)
    let previousQuantity;
    if (enrollment.subscriptionId && enrollment.subscriptionStatus !== "cancelled") {
      try {
        const subscription = await stripe.subscriptions.retrieve(enrollment.subscriptionId);
        const subItem = subscription.items.data[0];
        if (subItem) {
          previousQuantity = subItem.quantity;
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

    // Atomic: $pull participant + decrement course count in a transaction
    const mongoSession = await mongoose.startSession();
    let updatedEnrollment;
    try {
      await mongoSession.withTransaction(async () => {
        updatedEnrollment = await CourseEnrollment.findByIdAndUpdate(
          enrollmentId,
          { $pull: { participants: { _id: participantId } } },
          { new: true, session: mongoSession }
        );

        await Course.findByIdAndUpdate(
          enrollment.courseId,
          { $inc: { currentEnrollment: -1 } },
          { session: mongoSession }
        );
      });
    } catch (txErr) {
      // Revert Stripe quantity if the transaction failed
      if (previousQuantity !== undefined) {
        try {
          const sub = await stripe.subscriptions.retrieve(enrollment.subscriptionId);
          const subItem = sub.items.data[0];
          if (subItem) {
            await stripe.subscriptionItems.update(subItem.id, { quantity: previousQuantity });
          }
        } catch (revertErr) {
          console.error("Failed to revert Stripe subscription quantity:", revertErr);
        }
      }
      throw txErr;
    } finally {
      await mongoSession.endSession();
    }

    res.json({
      message: `${removedName} has been removed from this enrollment.`,
      participants: updatedEnrollment.participants,
    });
  } catch (err) {
    if (respondStripeOutage(res, err, "courseController.removeParticipant")) return;
    console.error("Error removing participant:", err);
    res.status(500).json({ error: "Failed to remove participant" });
  }
};

// ─── PUT /courses/enrollments/:enrollmentId/participants/:participantId ──────
// Edits a single participant's details on an enrollment.
// ─────────────────────────────────────────────────────────────────────────────
exports.editParticipant = async (req, res) => {
  try {
    const { enrollmentId, participantId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(enrollmentId)) {
      return res.status(400).json({ error: "Invalid enrollment ID" });
    }
    if (!mongoose.Types.ObjectId.isValid(participantId)) {
      return res.status(400).json({ error: "Invalid participant ID" });
    }

    const { name, age, email } = req.body;

    const enrollment = await CourseEnrollment.findById(enrollmentId);
    if (!enrollment) return res.status(404).json({ error: "Enrollment not found" });

    const ownerId = enrollment.user?.toString();
    const isOwner = ownerId ? ownerId === req.user.id : enrollment.buyerEmail === req.user.email;
    if (!isOwner && req.user.role !== "admin") {
      return res.status(403).json({ error: "Not authorised" });
    }

    const participant = enrollment.participants.id(participantId);
    if (!participant) {
      return res.status(404).json({ error: "Participant not found" });
    }

    // Build $set for only provided fields
    const $set = {};
    if (name !== undefined) {
      if (!name.trim()) return res.status(400).json({ error: "Name cannot be empty" });
      $set["participants.$.name"] = name.trim();
    }
    if (age !== undefined) $set["participants.$.age"] = age || null;
    if (email !== undefined) $set["participants.$.email"] = email?.trim().toLowerCase() || null;

    if (Object.keys($set).length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    const updated = await CourseEnrollment.findOneAndUpdate(
      { _id: enrollmentId, "participants._id": participantId },
      { $set },
      { new: true }
    );

    res.json({
      message: "Participant updated successfully.",
      participants: updated.participants,
    });
  } catch (err) {
    console.error("Error editing participant:", err);
    res.status(500).json({ error: "Failed to edit participant" });
  }
};

// ─── PUT /courses/enrollments/:enrollmentId ───────────────────────────────────
// Updates editable fields on an existing enrollment (e.g. buyerPhone).
// ─────────────────────────────────────────────────────────────────────────────
exports.updateEnrollment = async (req, res) => {
  try {
    const { enrollmentId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(enrollmentId)) {
      return res.status(400).json({ error: "Invalid enrollment ID" });
    }

    const enrollment = await CourseEnrollment.findById(enrollmentId);
    if (!enrollment) return res.status(404).json({ error: "Enrollment not found" });

    const ownerId = enrollment.user?.toString();
    const isOwner = ownerId ? ownerId === req.user.id : enrollment.buyerEmail === req.user.email;
    if (!isOwner && req.user.role !== "admin") {
      return res.status(403).json({ error: "Not authorised" });
    }

    const { buyerPhone } = req.body;
    const $set = {};

    if (buyerPhone !== undefined) {
      if (!buyerPhone || !buyerPhone.trim()) {
        return res.status(400).json({ error: "Phone number is required" });
      }
      $set.buyerPhone = buyerPhone.trim();
    }

    if (Object.keys($set).length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    const mongoSession = await mongoose.startSession();
    let updated;
    try {
      await mongoSession.withTransaction(async () => {
        updated = await CourseEnrollment.findByIdAndUpdate(
          enrollmentId,
          { $set },
          { new: true, session: mongoSession }
        );
      });
    } finally {
      await mongoSession.endSession();
    }

    res.json({ message: "Enrollment updated successfully.", enrollment: updated });
  } catch (err) {
    console.error("Error updating enrollment:", err);
    res.status(500).json({ error: "Failed to update enrollment" });
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
    // Idempotency — skip if this event was already processed
    const alreadyProcessed = await WebhookEvent.findOne({ stripeEventId: event.id });
    if (alreadyProcessed) {
      return res.json({ received: true, duplicate: true });
    }

    const eventTimestamp = event.created;

    switch (event.type) {
      case "invoice.payment_succeeded": {
        const invoice = event.data.object;
        if (invoice.subscription) {
          const sub = await stripe.subscriptions.retrieve(invoice.subscription);
          // Only apply if this event is newer than the last one we processed
          await CourseEnrollment.findOneAndUpdate(
            {
              subscriptionId: invoice.subscription,
              $or: [
                { lastStripeEventTimestamp: null },
                { lastStripeEventTimestamp: { $lt: eventTimestamp } },
              ],
            },
            {
              subscriptionStatus: "active",
              currentPeriodEnd: resolveCurrentPeriodEnd(sub),
              status: "active",
              lastStripeEventTimestamp: eventTimestamp,
            }
          );
        }
        break;
      }
      case "invoice.payment_failed": {
        const invoice = event.data.object;
        if (invoice.subscription) {
          await CourseEnrollment.findOneAndUpdate(
            {
              subscriptionId: invoice.subscription,
              $or: [
                { lastStripeEventTimestamp: null },
                { lastStripeEventTimestamp: { $lt: eventTimestamp } },
              ],
            },
            {
              subscriptionStatus: "past_due",
              status: "past_due",
              lastStripeEventTimestamp: eventTimestamp,
            }
          );
        }
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object;

        // Transaction: update enrollment status + decrement course count atomically
        const mongoSession = await mongoose.startSession();
        try {
          await mongoSession.withTransaction(async () => {
            const enrollment = await CourseEnrollment.findOneAndUpdate(
              {
                subscriptionId: sub.id,
                status: { $ne: "cancelled" },
                $or: [
                  { lastStripeEventTimestamp: null },
                  { lastStripeEventTimestamp: { $lt: eventTimestamp } },
                ],
              },
              {
                subscriptionStatus: "cancelled",
                status: "cancelled",
                lastStripeEventTimestamp: eventTimestamp,
              },
              { new: false, session: mongoSession }
            );

            if (enrollment) {
              const count = enrollment.participants?.length || 1;
              await Course.findByIdAndUpdate(
                enrollment.courseId,
                { $inc: { currentEnrollment: -count } },
                { session: mongoSession }
              );
            }
          });
        } finally {
          await mongoSession.endSession();
        }
        break;
      }
    }

    // Record this event as processed
    await WebhookEvent.create({
      stripeEventId: event.id,
      eventType: event.type,
    });

    res.json({ received: true });
  } catch (err) {
    console.error("Webhook handler error:", err);
    res.status(500).json({ error: "Webhook processing failed" });
  }
};
