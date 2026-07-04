const crypto = require("crypto");
const { getJwtSecret } = require("../utils/authConfig");
const { CUSTOMER_SESSION_COOKIE, parseCookieHeader, shouldUseSecureCookies } = require("../utils/customerSession");
const { VENDOR_COOKIE_NAME } = require("../utils/vendorSession");

const CSRF_COOKIE_NAME = "pinkpaisa_csrf";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const EXEMPT_PATH_PREFIXES = [
  "/api/affiliate-events",
  "/api/phonepe",
];
const EXEMPT_AUTH_PATHS = new Set([
  "/api/auth/admin-login",
  "/api/auth/admin/password/forgot",
  "/api/auth/admin/password/reset",
  "/api/auth/csrf",
  "/api/auth/login",
  "/api/auth/password/forgot",
  "/api/auth/password/reset",
  "/api/auth/register",
  "/api/auth/verify/request",
]);
const EXEMPT_VENDOR_PATHS = new Set([
  "/api/vendors/application-status",
  "/api/vendors/login",
  "/api/vendors/password/forgot",
  "/api/vendors/password/reset",
  "/api/vendors/register",
  "/api/vendors/verify/request",
]);

function signToken(rawToken) {
  return crypto.createHmac("sha256", getJwtSecret()).update(rawToken).digest("base64url");
}

function createCsrfToken() {
  const raw = crypto.randomBytes(32).toString("base64url");
  return `${raw}.${signToken(raw)}`;
}

function isValidCsrfToken(token) {
  const value = String(token || "");
  const separatorIndex = value.indexOf(".");
  if (separatorIndex <= 0) return false;

  const raw = value.slice(0, separatorIndex);
  const signature = value.slice(separatorIndex + 1);
  const expected = signToken(raw);

  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

function getCookie(req, name) {
  return parseCookieHeader(req.headers.cookie || "")[name] || "";
}

function getCsrfCookieOptions(req) {
  return {
    httpOnly: false,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production" ? true : shouldUseSecureCookies(req),
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

function setCsrfCookie(res, req, token = createCsrfToken()) {
  res.cookie(CSRF_COOKIE_NAME, token, getCsrfCookieOptions(req));
  return token;
}

function hasCookieSession(req) {
  const cookies = parseCookieHeader(req.headers.cookie || "");
  return Boolean(cookies[CUSTOMER_SESSION_COOKIE] || cookies[VENDOR_COOKIE_NAME]);
}

function isExemptPath(req) {
  const path = req.path || req.originalUrl || "";
  if (EXEMPT_AUTH_PATHS.has(path) || EXEMPT_VENDOR_PATHS.has(path)) return true;
  return EXEMPT_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function csrfProtection(req, res, next) {
  const method = String(req.method || "GET").toUpperCase();
  if (SAFE_METHODS.has(method) || !UNSAFE_METHODS.has(method)) return next();
  if (isExemptPath(req)) return next();
  if (!hasCookieSession(req)) return next();

  const cookieToken = getCookie(req, CSRF_COOKIE_NAME);
  const headerToken = String(req.headers["x-csrf-token"] || "");
  if (!cookieToken || !headerToken || cookieToken !== headerToken || !isValidCsrfToken(headerToken)) {
    return res.status(403).json({ message: "CSRF token missing or invalid" });
  }

  return next();
}

function issueCsrfToken(req, res) {
  const existing = getCookie(req, CSRF_COOKIE_NAME);
  const token = existing && isValidCsrfToken(existing) ? existing : setCsrfCookie(res, req);
  res.json({ csrfToken: token });
}

module.exports = {
  CSRF_COOKIE_NAME,
  createCsrfToken,
  csrfProtection,
  issueCsrfToken,
  isValidCsrfToken,
  setCsrfCookie,
};
