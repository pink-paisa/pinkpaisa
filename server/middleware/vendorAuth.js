const Vendor = require("../models/Vendor");
const { extractVendorToken, getVendorJwtSecret } = require("../utils/vendorSession");
const { isAccountLocked } = require("../utils/loginProtection");

async function loadVendorFromToken(req, { requireVerified = true } = {}) {
  const token = extractVendorToken(req);
  if (!token) throw { status: 401, message: "Vendor authorization required" };

  try {
    const decoded = require("jsonwebtoken").verify(token, getVendorJwtSecret());
    if (decoded.type !== "vendor") {
      throw { status: 401, message: "Invalid vendor token" };
    }
    const vendor = await Vendor.findById(decoded.id).select("-password_hash").lean();
    if (!vendor) throw { status: 401, message: "Vendor not found" };
    if (isAccountLocked(vendor)) {
      throw { status: 423, message: "Vendor account is temporarily locked" };
    }
    if (vendor.status === "banned") {
      throw { status: 403, message: "Vendor account is banned" };
    }
    if (requireVerified && vendor.status !== "verified") {
      throw { status: 403, message: "Vendor account is not verified" };
    }
    return vendor;
  } catch (err) {
    if (err?.status) throw err;
    throw { status: 401, message: "Vendor token invalid" };
  }
}

const protectVendor = async (req, res, next) => {
  try {
    req.vendor = await loadVendorFromToken(req, { requireVerified: true });
    next();
  } catch (err) {
    res.status(err.status || 401).json({ message: err.message || "Vendor token invalid" });
  }
};

const protectVendorApplication = async (req, res, next) => {
  try {
    req.vendor = await loadVendorFromToken(req, { requireVerified: false });
    next();
  } catch (err) {
    res.status(err.status || 401).json({ message: err.message || "Vendor token invalid" });
  }
};

module.exports = { protectVendor, protectVendorApplication };
