const User = require("../models/User");
const Ticket = require("../models/Ticket");
const Team = require("../models/Team");
const CourseEnrollment = require("../models/CourseEnrollment");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const bcrypt = require("bcryptjs");
const {
  generateAccessToken,
  generateRefreshToken,
  hashToken,
  setRefreshTokenCookie,
  clearRefreshTokenCookie,
  setRefreshTokenExpiration,
} = require("../utils/tokenUtils");

exports.register = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Name is required" });
    }
    if (!email || !email.trim()) {
      return res.status(400).json({ error: "Email is required" });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      if (existingUser.password) {
        return res.status(400).json({ error: "Email already in use." });
      }
      // Google-only user registering with password — add password to existing account
      existingUser.password = await bcrypt.hash(password, 10);
      existingUser.authProvider = "both";
      await existingUser.save();
      return res.status(201).json({
        message: "Password added to your account. You can now log in with email or Google.",
      });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      password: hashedPassword,
      authProvider: "local",
      role: "user",
    });
    await user.save();
    res.status(201).json({ message: "User registered successfully" });
  } catch (err) {
    console.error("Registration error:", err);
    res.status(500).json({ error: "Server error" });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !email.trim()) {
      return res.status(400).json({ error: "Email is required" });
    }
    if (!password) {
      return res.status(400).json({ error: "Password is required" });
    }

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: "Invalid credentials" });

    if (!user.password) {
      return res.status(400).json({
        error:
          "This account uses Google Sign-In. Please log in with Google or register with a password.",
        authMethod: "google",
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: "Invalid credentials" });

    if (user.isBanned) return res.status(403).json({ error: "Account suspended." });

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken();

    user.refreshToken = hashToken(refreshToken);
    user.refreshTokenExpiresAt = setRefreshTokenExpiration();
    await user.save();

    setRefreshTokenCookie(res, refreshToken);

    res.json({
      accessToken,
      user: { id: user._id, name: user.name, email: user.email, role: user.role },
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Server error" });
  }
};

exports.refresh = async (req, res) => {
  try {
    const { refreshToken } = req.cookies;
    if (!refreshToken) {
      return res.status(401).json({ error: "No refresh token" });
    }

    const hashedToken = hashToken(refreshToken);
    const user = await User.findOne({ refreshToken: hashedToken });
    if (!user) {
      clearRefreshTokenCookie(res);
      return res.status(403).json({ error: "Invalid refresh token" });
    }

    if (!user.refreshTokenExpiresAt || user.refreshTokenExpiresAt < new Date()) {
      clearRefreshTokenCookie(res);
      await User.findByIdAndUpdate(user._id, { refreshToken: null, refreshTokenExpiresAt: null });
      return res.status(403).json({ error: "Refresh token expired" });
    }

    if (user.isBanned) {
      clearRefreshTokenCookie(res);
      return res.status(403).json({ error: "Account suspended." });
    }

    const accessToken = generateAccessToken(user);
    res.json({
      accessToken,
      user: { id: user._id, name: user.name, email: user.email, role: user.role },
    });
  } catch (err) {
    console.error("Refresh error:", err);
    res.status(500).json({ error: "Server error" });
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
    console.error("Logout error:", err);
    res.status(500).json({ error: "Server error" });
  }
};

exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password -refreshToken");
    if (!user) return res.status(404).json({ error: "User not found" });

    const tickets = await Ticket.find({ buyerEmail: user.email, status: "paid" })
      .populate("eventId", "title date location ticketPrice image images city street postCode")
      .sort({ createdAt: -1 });

    const teams = await Team.find({ "manager.email": user.email })
      .populate("event", "title date location")
      .sort({ createdAt: -1 });

    const enrollments = await CourseEnrollment.find({ buyerEmail: user.email })
      .populate(
        "courseId",
        "title instructor schedule city images price category isSubscription billingInterval"
      )
      .sort({ createdAt: -1 });

    // Backfill currentPeriodEnd from Stripe for enrollments missing it
    // Note: Stripe moved current_period_end to subscription items in newer API versions
    const toBackfill = enrollments.filter((e) => e.subscriptionId && !e.currentPeriodEnd);
    if (toBackfill.length) {
      await Promise.all(
        toBackfill.map(async (e) => {
          try {
            const sub = await stripe.subscriptions.retrieve(e.subscriptionId);
            const periodEnd = sub.items?.data?.[0]?.current_period_end ?? sub.current_period_end;
            if (periodEnd) {
              e.currentPeriodEnd = new Date(periodEnd * 1000);
              await CourseEnrollment.findByIdAndUpdate(e._id, {
                currentPeriodEnd: e.currentPeriodEnd,
              });
            }
          } catch {
            // Subscription may have been deleted from Stripe — skip
          }
        })
      );
    }

    res.json({
      user: { name: user.name, email: user.email, role: user.role },
      tickets,
      teams,
      enrollments,
    });
  } catch (err) {
    console.error("Profile fetch error:", err);
    res.status(500).json({ error: "Failed to load profile" });
  }
};
