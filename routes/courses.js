const express = require("express");
const router = express.Router();
const courseController = require("../controllers/courseController");
const authMiddleware = require("../middleware/authMiddleware");
const authorize = require("../middleware/authorize");
const { createUpload } = require("../config/multer");
const upload = createUpload("course-images");

// Public — list all
router.get("/", courseController.getAllCourses);

// Stripe webhook — must use raw body, registered before express.json() in index.js
router.post("/webhook", express.raw({ type: "application/json" }), courseController.handleWebhook);

// Stripe redirect — must be before /:id
router.get("/:courseId/enrollment-success", courseController.handleEnrollmentSuccess);

// Admin/mod — view enrollments for a course
router.get(
  "/:courseId/enrollments",
  authMiddleware,
  authorize("admin", "moderator"),
  courseController.getCourseEnrollments
);

// authenticated — enroll
router.post("/:courseId/enroll", authMiddleware, courseController.enrollInCourse);

// authenticated — get my enrollment for a course
router.get("/:courseId/my-enrollment", authMiddleware, courseController.getMyEnrollment);

// authenticated — cancel subscription
router.post(
  "/enrollments/:enrollmentId/cancel",
  authMiddleware,
  courseController.cancelSubscription
);

// authenticated — add a participant to enrollment
router.post(
  "/enrollments/:enrollmentId/add-participant",
  authMiddleware,
  courseController.addParticipant
);

// authenticated — remove a participant from enrollment
router.post(
  "/enrollments/:enrollmentId/remove-participant",
  authMiddleware,
  courseController.removeParticipant
);

// Public — single course
router.get("/:id", courseController.getCourseById);

// Admin/mod — manage courses
router.post(
  "/",
  upload.single("image"),
  authMiddleware,
  authorize("admin", "moderator"),
  courseController.createCourse
);
router.put(
  "/:id",
  upload.single("image"),
  authMiddleware,
  authorize("admin", "moderator"),
  courseController.updateCourse
);
router.delete(
  "/:id",
  authMiddleware,
  authorize("admin", "moderator"),
  courseController.deleteCourse
);

module.exports = router;
