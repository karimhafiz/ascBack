const express = require("express");
const router = express.Router();
const courseController = require("../controllers/courseController");
const authMiddleware = require("../middleware/authMiddleware");
const authorize = require("../middleware/authorize");
const upload = require("../config/multer");


// Public — list all
router.get("/", courseController.getAllCourses);

// Stripe redirect — must be before /:id to avoid being swallowed by it
router.get("/:courseId/enrollment-success", courseController.handleEnrollmentSuccess);

// Admin/mod — view enrollments for a course
router.get("/:courseId/enrollments", authMiddleware, authorize("admin", "moderator"), courseController.getCourseEnrollments);

// authMiddlewared — enroll
router.post("/:courseId/enroll", authMiddleware, courseController.enrollInCourse);

// Public — single course (after subroutes so /:id doesn't eat them)
router.get("/:id", courseController.getCourseById);

// Admin/mod — manage courses
// Admin/mod — manage courses
router.post("/", upload.single("image"), authMiddleware, authorize("admin", "moderator"), courseController.createCourse);
router.put("/:id", upload.single("image"), authMiddleware, authorize("admin", "moderator"), courseController.updateCourse);
router.delete("/:id", authMiddleware, authorize("admin", "moderator"), courseController.deleteCourse);

module.exports = router;