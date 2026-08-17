require("dotenv").config();
const express = require("express");
const path = require("path");
const helmet = require("helmet");
const connectDB = require("./config/db"); // Import the database connection function
const mongoose = require("mongoose");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const logger = require("./utils/logger");

const app = express();

// Trust the first proxy (Vercel) so express-rate-limit reads the real
// client IP from X-Forwarded-For / Forwarded headers instead of erroring.
app.set("trust proxy", 1);

const allowedOrigins = [process.env.FRONT_END_URL?.replace(/\/$/, "")];
if (process.env.NODE_ENV !== "production") {
  allowedOrigins.push("http://localhost:5173");
}
app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.filter(Boolean).includes(origin)) return callback(null, true);
      if (origin.endsWith(".vercel.app")) return callback(null, true);
      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

app.use("/courses/webhook", express.raw({ type: "application/json" }));
app.use("/events/subscriptions/webhook", express.raw({ type: "application/json" }));

app.use(express.json());
app.use(cookieParser());

// Serve static files from the "uploads" directory
// app.use("/uploads", express.static(path.join(__dirname, "uploads")));

const eventRoutes = require("./routes/events");
const ticketRoutes = require("./routes/tickets");
const ticketPaymentRoutes = require("./routes/ticketPayment");
const usersRoutes = require("./routes/users");
const teamsRoutes = require("./routes/teams");
const adminRoutes = require("./routes/admin");
const pageContentRoutes = require("./routes/pageContent");
const pageContentRequestRoutes = require("./routes/pageContentRequests");
const courseRoutes = require("./routes/courses");
const venueRoutes = require("./routes/venues");
const statsRoutes = require("./routes/stats");

// Connect to MongoDB per-request (cached after first connection)
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch {
    const errorMessage = "Database connection failed";
    logger.error(errorMessage);
    res.status(503).json({ error: errorMessage });
  }
});

app.use("/payments", ticketPaymentRoutes);
app.use("/events", eventRoutes);
app.use("/tickets", ticketRoutes);
app.use("/users", usersRoutes);
app.use("/admin", adminRoutes);
app.use("/teams", teamsRoutes);
app.use("/pageContent", pageContentRoutes);
app.use("/pageContentRequests", pageContentRequestRoutes);
app.use("/courses", courseRoutes);
app.use("/venues", venueRoutes);
app.use("/stats", statsRoutes);

app.get("/", (req, res) => {
  const dbConnected = mongoose.connection.readyState === 1;
  res.status(dbConnected ? 200 : 503).json({
    status: dbConnected ? "healthy" : "degraded",
    db: dbConnected ? "connected" : "disconnected",
  });
});
app.use((err, req, res, next) => {
  logger.error({ err, path: req.path }, "Request failed");
  const message = process.env.NODE_ENV === "production" ? "Internal server error" : err.message;
  res.status(500).json({ error: message });
});
// Only listen when running locally, not on Vercel serverless
if (!process.env.VERCEL) {
  app.listen(process.env.PORT || 5000, () => {
    console.log(`Server is running on port ${process.env.PORT || 5000}`);
  });
}

// Export the app for Vercel serverless
module.exports = app;
