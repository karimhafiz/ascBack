const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  googleId: { type: String, default: null },
  name: { type: String, required: true },
  email: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  role: { 
    type: String, 
    enum: ["user", "moderator", "admin"],
    default: "user"
  },
  isActive: { type: Boolean, default: true },
  isBanned: { type: Boolean, default: false },

}, { timestamps: true });

module.exports = mongoose.model("User", userSchema);