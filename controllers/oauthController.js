const { OAuth2Client } = require("google-auth-library");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

// Initialize a client with the client ID from environment
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// POST /auth/google
// body: { tokenId }
exports.googleLogin = async (req, res) => {
    const { tokenId } = req.body;
    if (!tokenId) {
        return res.status(400).json({ message: "tokenId is required" });
    }

    try {
        const ticket = await client.verifyIdToken({
            idToken: tokenId,
            audience: process.env.GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        const { email, name, sub: googleId, picture } = payload;

        if (!email) {
            return res.status(400).json({ message: "Google token did not contain an email" });
        }

        // find or create the user
        let user = await User.findOne({ email });
        if (!user) {
            user = new User({ name: name || email, email, googleId });
            await user.save();
        } else if (!user.googleId) {
            // if existing user did not have googleId, store it
            user.googleId = googleId;
            await user.save();
        }

        const jwtToken = jwt.sign(
            { id: user._id, role: user.role,  email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: "1h" }
        );

        res.json({
            token: jwtToken,
            user: { id: user._id, name: user.name, email: user.email, picture },
        });
    } catch (err) {
        console.error("Google login error", err);
        res.status(500).json({ message: "Failed to verify Google token" });
    }
};
