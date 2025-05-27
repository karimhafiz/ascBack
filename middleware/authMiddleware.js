const jwt = require("jsonwebtoken");

function generateToken(user) {
  return jwt.sign(
    { id: user._id, role: user.role || "admin" },
    process.env.JWT_SECRET,
    {
      expiresIn: "1h",
    }
  );
}

function authenticateToken(req, res, next) {
  console.log("AUTH MIDDLEWARE: headers:", req.headers);
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  console.log("AUTH MIDDLEWARE: token:", token);

  if (!token) {
    return res.status(401).json({ message: "Token is missing" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log("AUTH MIDDLEWARE: decoded:", decoded);
    if (decoded.role === "admin") {
      req.admin = decoded;
    } else {
      req.user = decoded;
    }
    next();
  } catch (err) {
    console.error("JWT Verification Error:", err);
    return res.status(403).json({ message: "Invalid token" });
  }
}

module.exports = authenticateToken;
