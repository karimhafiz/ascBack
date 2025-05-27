const mongoose = require("mongoose");

const adminSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  role: { type: String, default: "admin" }, // Default role is admin
});

module.exports = mongoose.model("Admin", adminSchema);
