const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const ACCESS_TOKEN_EXPIRY = "15m";

function generateAccessToken(user) {
  return jwt.sign(
    {
      id: user._id,
      role: user.role,
      name: user.name,
      email: user.email,
      isVerified: user.isVerified,
    },
    process.env.JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRY }
  );
}

function generateRefreshToken() {
  return crypto.randomBytes(40).toString("hex");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function setRefreshTokenExpiration() {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7); // 7 days from now
  return expiresAt;
}

// NODE_ENV isn't reliably "production" for a raw @vercel/node function the
// way it is for detected frameworks — VERCEL is the signal Vercel actually
// guarantees at runtime (index.js's listen-vs-serverless check already
// relies on it). Frontend and backend sit on different *.vercel.app
// subdomains, a genuine cross-site boundary, so a deployed cookie always
// needs secure + SameSite=None regardless of preview vs production.
function isDeployed() {
  return Boolean(process.env.VERCEL);
}

function setRefreshTokenCookie(res, refreshToken) {
  const deployed = isDeployed();
  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: deployed,
    sameSite: deployed ? "none" : "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: "/",
  });
}

function clearRefreshTokenCookie(res) {
  const deployed = isDeployed();
  res.clearCookie("refreshToken", {
    httpOnly: true,
    secure: deployed,
    sameSite: deployed ? "none" : "lax",
    path: "/",
  });
}

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  hashToken,
  setRefreshTokenCookie,
  clearRefreshTokenCookie,
  setRefreshTokenExpiration,
};
