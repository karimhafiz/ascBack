const User = require("../models/User");
const Ticket = require("../models/Ticket");
const Team = require("../models/Team");
const CourseEnrollment = require("../models/CourseEnrollment");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

exports.register = async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      if (!existingUser.password) {
        return res.status(400).json({
          message: "This email is linked to a Google account. Please log in with Google.",
        });
      }
      return res.status(400).json({ message: "Email already in use." });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ name, email, password: hashedPassword, role: "user" });
    await user.save();
    res.status(201).json({ message: "User registered successfully" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: "Invalid credentials" });

    if (!user.password) {
      return res.status(400).json({
        message: "This account uses Google Sign-In. Please log in with Google.",
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: "Invalid credentials" });

    const token = jwt.sign(
      { id: user._id, role: user.role, name: user.name, email: user.email },
      process.env.JWT_SECRET || "secret",
      { expiresIn: "7d" }
    );

    res.json({
      token,
      user: { id: user._id, name: user.name, email: user.email, role: user.role },
    });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
};

exports.getProfile = async (req, res) => {

  try {
    const user = await User.findById(req.user.id).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });

    const tickets = await Ticket.find({ buyerEmail: user.email, status: "paid" })
      .populate("eventId", "title date location ticketPrice image images city street postCode")
      .sort({ createdAt: -1 });

    const teams = await Team.find({ "manager.email": user.email })
      .populate("event", "title date location")
      .sort({ createdAt: -1 });

    const enrollments = await CourseEnrollment.find({ buyerEmail: user.email })
      .populate("courseId", "title instructor schedule city images price category")
      .sort({ createdAt: -1 });
    res.json({
      user: { name: user.name, email: user.email, role: user.role },
      tickets,
      teams,
      enrollments,
    });
  } catch (err) {
    console.error("Profile fetch error:", err);
    res.status(500).json({ message: "Failed to load profile" });
  }
};