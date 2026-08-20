function requireVerified(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  if (!req.user.isVerified) {
    return res.status(403).json({ error: "Please verify your email before continuing" });
  }
  next();
}

module.exports = requireVerified;
