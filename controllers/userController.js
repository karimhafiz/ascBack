const User = require("../models/User");
const Ticket = require("../models/Ticket");
const Team = require("../models/Team");
const CourseEnrollment = require("../models/CourseEnrollment");
const EventSubscription = require("../models/EventSubscription");
const VenueBooking = require("../models/VenueBooking");
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
const { verifyEmailDomain, sendAccountVerificationEmail } = require("../utils/emailUtils");
const {
  issueVerificationToken,
  consumeVerificationToken,
} = require("../utils/verificationTokenUtils");
const logger = require("../utils/logger");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

exports.register = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Name is required" });
    }
    if (!email || typeof email !== "string" || !EMAIL_REGEX.test(email.trim())) {
      return res.status(400).json({ error: "A valid email address is required" });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    const emailDomainValid = await verifyEmailDomain(email.trim().toLowerCase());
    if (!emailDomainValid) {
      return res.status(400).json({
        error:
          "This email domain does not appear to accept emails. Please use a valid email address.",
      });
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

    sendVerificationLink(user.email).catch((err) =>
      logger.error(err, "Failed to send account verification email")
    );

    res.status(201).json({
      message: "User registered successfully. Please check your email to verify your account.",
    });
  } catch (err) {
    logger.error(err, "Registration error");
    res.status(500).json({ error: "Server error" });
  }
};

async function sendVerificationLink(email) {
  const token = await issueVerificationToken({ email, purpose: "account_verification" });
  const frontEndUrl = process.env.FRONT_END_URL || "http://localhost:5173/";
  const link = `${frontEndUrl}verify-email?token=${token}`;
  await sendAccountVerificationEmail({ email, link });
}

// POST /users/verify-email/request — resend the verification link.
// Always returns a generic response, whether or not the email exists/is
// already verified, to avoid leaking account existence.
exports.requestEmailVerification = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== "string" || !EMAIL_REGEX.test(email.trim())) {
      return res.status(400).json({ error: "A valid email address is required" });
    }

    const normalisedEmail = email.trim().toLowerCase();
    const user = await User.findOne({ email: normalisedEmail });
    if (user && !user.isVerified) {
      logger.info({ email: normalisedEmail }, "Sending account verification link");
      sendVerificationLink(normalisedEmail)
        .then(() => logger.info({ email: normalisedEmail }, "Account verification link sent"))
        .catch((err) => logger.error(err, "Failed to send account verification email"));
    } else {
      logger.info(
        { email: normalisedEmail, userFound: Boolean(user), alreadyVerified: user?.isVerified },
        "Verification link request skipped"
      );
    }

    res.json({ message: "If that email needs verifying, we've sent a link to it." });
  } catch (err) {
    logger.error(err, "Error requesting email verification");
    res.status(500).json({ error: "Server error" });
  }
};

// POST /users/verify-email/confirm
exports.confirmEmailVerification = async (req, res) => {
  try {
    const { token } = req.body;
    const email = await consumeVerificationToken({ token, purpose: "account_verification" });
    if (!email) {
      return res.status(400).json({ error: "This link has expired or is invalid." });
    }

    await User.findOneAndUpdate({ email }, { isVerified: true });
    res.json({ message: "Email verified successfully." });
  } catch (err) {
    logger.error(err, "Error confirming email verification");
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
    if (!user) {
      logger.warn({ email }, "login failed - unknown email");
      return res.status(400).json({ error: "Invalid credentials" });
    }

    if (user.authProvider === "google" || !user.password) {
      logger.warn({ email }, "login failed - google-only account");
      return res.status(400).json({
        error:
          "This account uses Google Sign-In. Please log in with Google or register with a password.",
        authMethod: "google",
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      logger.warn({ email }, "login failed - bad password");
      return res.status(400).json({ error: "Invalid credentials" });
    }

    if (user.isBanned) {
      logger.warn({ userId: user._id, email }, "login blocked - account banned");
      return res.status(403).json({ error: "Account suspended." });
    }

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken();

    user.refreshToken = hashToken(refreshToken);
    user.refreshTokenExpiresAt = setRefreshTokenExpiration();
    await user.save();

    setRefreshTokenCookie(res, refreshToken);

    logger.info({ userId: user._id, email: user.email }, "login success");

    res.json({
      accessToken,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isVerified: user.isVerified,
      },
    });
  } catch (err) {
    logger.error(err, "Login error");
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
      return res.status(403).json({ error: "Account Banned." });
    }

    const accessToken = generateAccessToken(user);
    const newRefreshToken = generateRefreshToken();

    user.refreshToken = hashToken(newRefreshToken);
    user.refreshTokenExpiresAt = setRefreshTokenExpiration();
    await user.save();

    setRefreshTokenCookie(res, newRefreshToken);

    res.json({
      accessToken,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isVerified: user.isVerified,
      },
    });
  } catch (err) {
    logger.error(err, "Refresh error");
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
    logger.error(err, "Logout error");
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

    const eventSubscriptions = await EventSubscription.find({ buyerEmail: user.email })
      .populate(
        "eventId",
        "title date images city street postCode ticketPrice isReoccurring subscriptionInterval reoccurringEndDate dayOfWeek openingTime"
      )
      .sort({ createdAt: -1 });

    // Backfill currentPeriodEnd from Stripe for event subscriptions missing it
    const eventSubsToBackfill = eventSubscriptions.filter(
      (s) => s.subscriptionId && !s.currentPeriodEnd
    );
    if (eventSubsToBackfill.length) {
      await Promise.all(
        eventSubsToBackfill.map(async (s) => {
          try {
            const sub = await stripe.subscriptions.retrieve(s.subscriptionId);
            const periodEnd = sub.items?.data?.[0]?.current_period_end ?? sub.current_period_end;
            if (periodEnd) {
              s.currentPeriodEnd = new Date(periodEnd * 1000);
              await EventSubscription.findByIdAndUpdate(s._id, {
                currentPeriodEnd: s.currentPeriodEnd,
              });
            }
          } catch {
            // Subscription may have been deleted from Stripe — skip
          }
        })
      );
    }

    const venueBookings = await VenueBooking.find({ user: req.user.id })
      .populate("venue", "name street city")
      .populate("slot", "date startTime endTime")
      .sort({ createdAt: -1 });

    res.json({
      user: { name: user.name, email: user.email, role: user.role },
      tickets,
      teams,
      enrollments,
      eventSubscriptions,
      venueBookings,
    });
  } catch (err) {
    logger.error(err, "Profile fetch error");
    res.status(500).json({ error: "Failed to load profile" });
  }
};
