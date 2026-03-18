const User = require("../models/User");
const Ticket = require("../models/Ticket");
const Team = require("../models/Team");
const CourseEnrollment = require("../models/CourseEnrollment");
const bcrypt = require("bcryptjs");
const {
  generateAccessToken,
  generateRefreshToken,
  hashToken,
  setRefreshTokenCookie,
  clearRefreshTokenCookie,
} = require("../utils/tokenUtils");

exports.register = async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      if (
        existingUser.authProvider === "google" ||
        (!existingUser.password && existingUser.googleId)
      ) {
        return res.status(400).json({
          message: "This email is linked to a Google account. Please log in with Google.",
          authMethod: "google",
        });
      }
      return res.status(400).json({ message: "Email already in use." });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({
      name,
      email,
      password: hashedPassword,
      authProvider: "local",
      role: "user",
    });
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

    if (user.authProvider === "google" || (!user.password && user.googleId)) {
      return res.status(400).json({
        message: "This account uses Google Sign-In. Please log in with Google.",
        authMethod: "google",
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: "Invalid credentials" });

    if (user.isBanned) return res.status(403).json({ message: "Account suspended." });

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken();

    user.refreshToken = hashToken(refreshToken);
    await user.save();

    setRefreshTokenCookie(res, refreshToken);

    res.json({
      accessToken,
      user: { id: user._id, name: user.name, email: user.email, role: user.role },
    });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
};

exports.refresh = async (req, res) => {
  try {
    const { refreshToken } = req.cookies;
    if (!refreshToken) {
      return res.status(401).json({ message: "No refresh token" });
    }

    const hashedToken = hashToken(refreshToken);
    const user = await User.findOne({ refreshToken: hashedToken });
    if (!user) {
      clearRefreshTokenCookie(res);
      return res.status(403).json({ message: "Invalid refresh token" });
    }

    if (user.isBanned) {
      clearRefreshTokenCookie(res);
      return res.status(403).json({ message: "Account suspended." });
    }

    const accessToken = generateAccessToken(user);
    res.json({
      accessToken,
      user: { id: user._id, name: user.name, email: user.email, role: user.role },
    });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
};

exports.logout = async (req, res) => {
  try {
    const { refreshToken } = req.cookies;
    if (refreshToken) {
      await User.findOneAndUpdate(
        { refreshToken: hashToken(refreshToken) },
        { refreshToken: null }
      );
    }
    clearRefreshTokenCookie(res);
    res.json({ message: "Logged out successfully" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
};

exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password -refreshToken");
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
