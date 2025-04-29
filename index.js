require("dotenv").config();
const express = require("express");
const path = require("path");
const connectDB = require("./config/db"); // Import the database connection function
connectDB();

const cors = require("cors");

const app = express();
app.use(express.json());

// Update this:
app.use(
  cors({
    origin: [
      "https://asc-lac.vercel.app", // your frontend URL
      "http://localhost:5173", // for local development (optional)
    ],
    credentials: true,
  })
);

// Serve static files from the "uploads" directory
// app.use("/uploads", express.static(path.join(__dirname, "uploads")));

const eventRoutes = require("./routes/events");
const ticketRoutes = require("./routes/tickets");
const paymentRoutes = require("./routes/payments");
const adminRoutes = require("./routes/admin");

app.use("/payments", paymentRoutes);
app.use("/events", eventRoutes);
app.use("/tickets", ticketRoutes);
app.use("/admins", adminRoutes);

app.get("/", (req, res) => {
  res.send("Event Ticketing API is running...");
});

app.listen(process.env.PORT || 5000, () => {
  console.log(`Server is running on port ${process.env.PORT || 5000}`);
});

// Export the app for Vercel serverless
module.exports = app;
