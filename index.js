require("dotenv").config();
const express = require("express");
const path = require("path");
const helmet = require("helmet");
const connectDB = require("./config/db"); // Import the database connection function

const cors = require("cors");
const cookieParser = require("cookie-parser");

const app = express();

app.use(helmet());

app.use("/courses/webhook", express.raw({ type: "application/json" }));

app.use(express.json());
app.use(cookieParser());

const allowedOrigins = [process.env.FRONT_END_URL?.replace(/\/$/, "")];
if (process.env.NODE_ENV !== "production") {
  allowedOrigins.push("http://localhost:5173");
}
app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (mobile apps, curl, etc.)
      if (!origin) return callback(null, true);
      // Allow listed origins
      if (allowedOrigins.filter(Boolean).includes(origin)) return callback(null, true);
      // Allow any Vercel preview deploy
      if (origin.endsWith(".vercel.app")) return callback(null, true);
      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

// Serve static files from the "uploads" directory
// app.use("/uploads", express.static(path.join(__dirname, "uploads")));

const eventRoutes = require("./routes/events");
const ticketRoutes = require("./routes/tickets");
const paymentRoutes = require("./routes/payments");
const usersRoutes = require("./routes/users");
const teamsRoutes = require("./routes/teams");
const adminRoutes = require("./routes/admin");
const pageContentRoutes = require("./routes/pageContent");
const courseRoutes = require("./routes/courses");

// Connect to MongoDB per-request (cached after first connection)
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (error) {
    res.status(500).json({ error: "Database connection failed" });
  }
});

app.use("/payments", paymentRoutes);
app.use("/events", eventRoutes);
app.use("/tickets", ticketRoutes);
app.use("/users", usersRoutes);
app.use("/admin", adminRoutes);
app.use("/teams", teamsRoutes);
app.use("/pageContent", pageContentRoutes);
app.use("/courses", courseRoutes);

app.get("/", (req, res) => {
  res.send("Event Ticketing API is running...");
});

app.use((err, req, res, next) => {
  console.error("GLOBAL ERROR:", err.message, err.stack);
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
