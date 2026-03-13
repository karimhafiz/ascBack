const User   = require("../models/User");
const Ticket = require("../models/Ticket");
const CourseEnrollment = require("../models/CourseEnrollment");
const Course = require("../models/Course");
const Team   = require("../models/Team");
const Event  = require("../models/Event");

// ── GET /admin/dashboard ──────────────────────────────────────────────────────
// Accessible by admin and moderator.
// Returns tickets (with buyer + event details), revenue per event,
// team registrations, and — for admins only — the full user list.
// ─────────────────────────────────────────────────────────────────────────────
exports.getDashboard = async (req, res) => {
  try {
    // All paid tickets, populated with event and user info
    const tickets = await Ticket.find({ status: "paid" })
      .populate("eventId", "title date location ticketPrice")
      .sort({ createdAt: -1 });

    // Revenue grouped by event
    const events = await Event.find({}, "title ticketPrice totalRevenue ticketsAvailable");

    // All team registrations with event info
    const teams = await Team.find()
      .populate("event", "title date")
      .sort({ createdAt: -1 });

    const enrollments = await CourseEnrollment.find()
      .populate("courseId", "title instructor category price")
      .sort({ createdAt: -1 });

    const courses = await Course.find({}, "title instructor category price currentEnrollment maxEnrollment enrollmentOpen");

    const payload = { tickets, events, teams, enrollments, courses };

    // User list — admins only
    if (req.user.role === "admin") {
      const users = await User.find({}, "name email role createdAt isActive isBanned").sort({ createdAt: -1 });
      payload.users = users;
    }

    res.json(payload);
  } catch (err) {
    console.error("Dashboard error:", err);
    res.status(500).json({ message: "Failed to load dashboard" });
  }
};

// ── GET /admin/users ─────────────────────────────────────────────────────────
// Admin only — full user list (already returned in dashboard, but useful
// as a standalone endpoint for future use).
// ─────────────────────────────────────────────────────────────────────────────
exports.getAllUsers = async (req, res) => {
  try {
    const users = await User.find().select("-password").sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── DELETE /admin/users/:id ───────────────────────────────────────────────────
// Admin only — permanently delete a user account.
// ─────────────────────────────────────────────────────────────────────────────
exports.deleteUser = async (req, res) => {
  if (req.params.id === req.user.id) {
    return res.status(400).json({ message: "You cannot delete your own account" });
  }
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json({ message: "User deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── PATCH /admin/users/:id/role ───────────────────────────────────────────────
// Admin only — promote or demote a user's role.
// Body: { role: "user" | "moderator" | "admin" }
// ─────────────────────────────────────────────────────────────────────────────
exports.updateUserRole = async (req, res) => {
  const { role } = req.body;
  const validRoles = ["user", "moderator", "admin"];

  if (!validRoles.includes(role)) {
    return res.status(400).json({ message: "Invalid role" });
  }

  // Prevent admins from demoting themselves
  if (req.params.id === req.user.id) {
    return res.status(400).json({ message: "You cannot change your own role" });
  }

  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { role },
      { new: true, select: "name email role" }
    );
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json({ message: "Role updated", user });
  } catch (err) {
    console.error("Role update error:", err);
    res.status(500).json({ message: "Failed to update role" });
  }
};