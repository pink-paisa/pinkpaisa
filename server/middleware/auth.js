const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { getJwtSecret } = require("../utils/authConfig");
const { getCustomerSessionToken } = require("../utils/customerSession");
const { isAccountLocked } = require("../utils/loginProtection");

const protect = async (req, res, next) => {
  const token = getCustomerSessionToken(req);
  if (!token) {
    return res.status(401).json({ message: "Not authorized, no token" });
  }
  try {
    const decoded = jwt.verify(token, getJwtSecret());
    const tokenType = decoded.type || "customer";
    if (!["customer", "admin"].includes(tokenType)) {
      return res.status(401).json({ message: "Not authorized, token invalid" });
    }
    req.user = await User.findById(decoded.id).select("-password").lean();
    if (!req.user) return res.status(401).json({ message: "User not found" });
    if (isAccountLocked(req.user)) {
      return res.status(423).json({ message: "Account is temporarily locked. Try again in 15 minutes." });
    }
    next();
  } catch (error) {
    res.status(error?.status || 401).json({ message: error?.status === 500 ? error.message : "Not authorized, token invalid" });
  }
};

const optionalProtect = async (req, res, next) => {
  const token = getCustomerSessionToken(req);
  if (!token) {
    req.user = null;
    return next();
  }
  try {
    const decoded = jwt.verify(token, getJwtSecret());
    const tokenType = decoded.type || "customer";
    if (!["customer", "admin"].includes(tokenType)) {
      req.user = null;
      return next();
    }
    req.user = await User.findById(decoded.id).select("-password").lean();
    if (req.user && isAccountLocked(req.user)) {
      req.user = null;
    }
  } catch {
    req.user = null;
  }
  return next();
};

const adminOnly = (req, res, next) => {
  if (req.user && req.user.role === "admin") return next();
  res.status(403).json({ message: "Admin access required" });
};

module.exports = { protect, optionalProtect, adminOnly };
