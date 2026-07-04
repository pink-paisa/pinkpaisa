const jwt = require("jsonwebtoken");

const VENDOR_COOKIE_NAME = "vendor_token";
const VENDOR_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function getVendorJwtSecret() {
  const secret = String(process.env.JWT_SECRET || "").trim();
  if (!secret) throw new Error("JWT_SECRET is required for vendor authentication");
  return secret;
}

function signVendorToken(id) {
  return jwt.sign({ id, type: "vendor" }, getVendorJwtSecret(), { expiresIn: "7d" });
}

function parseCookieHeader(header = "") {
  return String(header)
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const [key, ...rest] = part.split("=");
      if (!key) return acc;
      acc[key] = decodeURIComponent(rest.join("=") || "");
      return acc;
    }, {});
}

function extractVendorToken(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.split(" ")[1];
  }
  const cookies = parseCookieHeader(req.headers.cookie || "");
  return cookies[VENDOR_COOKIE_NAME] || null;
}

function vendorCookieOptions() {
  const secure = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    sameSite: "strict",
    secure,
    maxAge: VENDOR_TOKEN_TTL_MS,
    path: "/",
  };
}

function setVendorAuthCookie(res, token) {
  res.cookie(VENDOR_COOKIE_NAME, token, vendorCookieOptions());
}

function clearVendorAuthCookie(res) {
  res.clearCookie(VENDOR_COOKIE_NAME, { ...vendorCookieOptions(), maxAge: undefined });
}

module.exports = {
  VENDOR_COOKIE_NAME,
  clearVendorAuthCookie,
  extractVendorToken,
  getVendorJwtSecret,
  parseCookieHeader,
  setVendorAuthCookie,
  signVendorToken,
};
