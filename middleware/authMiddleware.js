const jwt = require("jsonwebtoken");

function generateToken(user) {
  return jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "Token is missing" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log("Decoded Token:", decoded); // Log the decoded token
    req.admin = decoded; // Attach the decoded token payload to the request
    next();
  } catch (err) {
    console.error("JWT Verification Error:", err); // Log the error
    return res.status(403).json({ message: "Invalid token" });
  }
}

module.exports = authenticateToken;
