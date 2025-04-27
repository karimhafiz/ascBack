require("dotenv").config();
const express = require("express");
const path = require("path");
const connectDB = require("./config/db");
connectDB();

const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());

// Serve static files from the "uploads" directory
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

const eventRoutes = require("./routes/events");
const ticketRoutes = require("./routes/tickets");
const paymentRoutes = require("./routes/payments");
const adminRoutes = require("./routes/admin");

app.use("/api/payments", paymentRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/tickets", ticketRoutes);
app.use("/api/admins", adminRoutes); //

const PORT = process.env.PORT || 5000;

app.get("/", (req, res) => {
  res.send("Event Ticketing API is running...");
});

app.listen(PORT, "192.168.1.116", () => {
  console.log(`Server running on port ${PORT}`);
});
