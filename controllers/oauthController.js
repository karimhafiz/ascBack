const { OAuth2Client } = require("google-auth-library");
const User = require("../models/User");
const {
  generateAccessToken,
  generateRefreshToken,
  hashToken,
  setRefreshTokenCookie,
  setRefreshTokenExpiration,
} = require("../utils/tokenUtils");

// Initialize a client with the client ID from environment
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// POST /auth/google
// body: { tokenId }
exports.googleLogin = async (req, res) => {
  const { tokenId } = req.body;
  if (!tokenId) {
    return res.status(400).json({ error: "tokenId is required" });
  }

  try {
    const ticket = await client.verifyIdToken({
      idToken: tokenId,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const { email, name, sub: googleId, picture } = payload;

    if (!email) {
      return res.status(400).json({ error: "Google token did not contain an email" });
    }

    // find or create the user
    let user = await User.findOne({ email });
    if (!user) {
      user = new User({ name: name || email, email, googleId, authProvider: "google" });
      await user.save();
    } else if (!user.googleId) {
      // existing user linking Google — store googleId
      user.googleId = googleId;
      user.authProvider = user.password ? "both" : "google";
      await user.save();
    }

    if (user.isBanned) return res.status(403).json({ error: "Account suspended." });

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken();

    user.refreshToken = hashToken(refreshToken);
    user.refreshTokenExpiresAt = setRefreshTokenExpiration();
    await user.save();

    setRefreshTokenCookie(res, refreshToken);

    res.json({
      accessToken,
      user: { id: user._id, name: user.name, email: user.email, role: user.role, picture },
    });
  } catch (err) {
    console.error("Google login error", err);
    res.status(500).json({ error: "Failed to verify Google token" });
  }
};
