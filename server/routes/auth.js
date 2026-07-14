const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { protect } = require("../middleware/auth");
const { serializeUser } = require("../controllers/accountController");
const { getAdminBootstrapEmail, getAdminBootstrapPassword, getJwtSecret } = require("../utils/authConfig");
const { issueCsrfToken, setCsrfCookie } = require("../middleware/csrf");
const { setCustomerSessionCookie, clearCustomerSessionCookie } = require("../utils/customerSession");
const { createRateLimiter } = require("../middleware/requestGuards");
const { assertPasswordPolicy } = require("../utils/passwordPolicy");
const { createSecureToken, hashToken } = require("../utils/tokens");
const {
  sendAdminPasswordResetEmail,
  sendCustomerPasswordResetEmail,
  sendCustomerVerificationEmail,
  getPublicAppUrl,
} = require("../utils/email");
const {
  buildLockedError,
  clearLoginFailures,
  isAccountLocked,
  recordFailedLogin,
} = require("../utils/loginProtection");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const signToken = (id, role = "user", authVersion = 0) =>
  jwt.sign({ id, type: role === "admin" ? "admin" : "customer", version: Number(authVersion || 0) }, getJwtSecret(), { expiresIn: "7d" });
const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
const GENERIC_RESET_MESSAGE = "If an account exists for that email, a reset link has been sent.";
const GENERIC_VERIFY_MESSAGE = "If an account exists for that email, a verification link has been sent.";

const adminLoginLimiter = createRateLimiter({
  keyPrefix: "admin-login",
  max: 8,
  message: "Too many admin login attempts. Please wait a bit and try again.",
});

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isValidEmail(email) {
  return EMAIL_REGEX.test(normalizeEmail(email));
}

function buildCustomerVerifyRedirect(success) {
  const base = getPublicAppUrl();
  return `${base}/account/auth?verified=${success ? "1" : "0"}`;
}

async function ensureAdminUser() {
  let admin = await User.findOne({ role: "admin" });
  if (!admin) {
    const bootstrapEmail = getAdminBootstrapEmail();
    admin = await User.findOne({ email: bootstrapEmail });
  }
  if (!admin) {
    const bootstrapEmail = getAdminBootstrapEmail();
    const bootstrapPassword = getAdminBootstrapPassword();
    assertPasswordPolicy(bootstrapPassword);
    return User.create({
      email: bootstrapEmail,
      password: bootstrapPassword,
      role: "admin",
      full_name: "Admin",
      email_verified: true,
    });
  }

  let shouldSave = false;
  if (admin.role !== "admin") {
    admin.role = "admin";
    shouldSave = true;
  }
  if (!admin.full_name) {
    admin.full_name = "Admin";
    shouldSave = true;
  }
  if (!admin.email_verified) {
    admin.email_verified = true;
    shouldSave = true;
  }

  if (shouldSave) {
    await admin.save();
  }

  return admin;
}

async function issueCustomerVerification(user) {
  const { raw, hash } = createSecureToken();
  user.email_verification_token = hash;
  user.email_verification_expires_at = new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS);
  await user.save();
  return sendCustomerVerificationEmail({
    email: user.email,
    fullName: user.full_name,
    token: raw,
  });
}

async function issueCustomerPasswordReset(user) {
  const { raw, hash } = createSecureToken();
  user.password_reset_token = hash;
  user.password_reset_expires_at = new Date(Date.now() + PASSWORD_RESET_TTL_MS);
  await user.save();
  return sendCustomerPasswordResetEmail({
    email: user.email,
    fullName: user.full_name,
    token: raw,
  });
}

async function issueAdminPasswordReset(admin) {
  const { raw, hash } = createSecureToken();
  admin.password_reset_token = hash;
  admin.password_reset_expires_at = new Date(Date.now() + PASSWORD_RESET_TTL_MS);
  await admin.save();
  return sendAdminPasswordResetEmail({
    email: admin.email,
    fullName: admin.full_name,
    token: raw,
  });
}

function buildCustomerPasswordResetLookup(email) {
  return { email, role: { $ne: "admin" } };
}

function buildAdminPasswordResetLookup(email) {
  return { email, role: "admin" };
}

function buildPasswordResetTokenLookup(token, role) {
  return {
    password_reset_token: hashToken(token),
    password_reset_expires_at: { $gt: new Date() },
    ...(role === "admin" ? { role: "admin" } : { role: { $ne: "admin" } }),
  };
}

async function applyPasswordReset(user, password) {
  user.password = password;
  user.password_reset_token = null;
  user.password_reset_expires_at = null;
  user.failed_login_attempts = 0;
  user.locked_until = null;
  user.auth_version = Number(user.auth_version || 0) + 1;
  await user.save();
  return user;
}

router.post("/register", async (req, res) => {
  try {
    const { email, password, full_name, phone, address, city, state, pincode } = req.body;
    if (!email || !password || !full_name || !phone) {
      return res.status(400).json({ message: "Name, phone, email and password are required" });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ message: "Enter a valid email address" });
    }
    assertPasswordPolicy(password);
    const normalizedEmail = normalizeEmail(email);
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) return res.status(409).json({ message: "Email already registered" });
    const user = await User.create({
      email: normalizedEmail,
      password,
      full_name,
      phone,
      address: address || null,
      city: city || null,
      state: state || null,
      pincode: pincode || null,
      email_verified: false,
    });
    const preview = await issueCustomerVerification(user);
    const token = signToken(user._id, user.role, user.auth_version);
    setCustomerSessionCookie(res, req, token);
    setCsrfCookie(res, req);
    res.status(201).json({
      token,
      user: serializeUser(user.toObject()),
      message: "Account created. Please verify your email to unlock account recovery and protected features.",
      ...(process.env.NODE_ENV !== "production" ? preview : {}),
    });
  } catch (err) {
    res.status(Number(err.status) || 400).json({ message: err.message });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: "Email and password required" });
    const normalizedEmail = normalizeEmail(email);
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) return res.status(401).json({ message: "Invalid credentials" });
    if (isAccountLocked(user)) throw buildLockedError("Account is temporarily locked. Try again in 15 minutes.");
    if (!(await user.matchPassword(password))) {
      const lockedNow = await recordFailedLogin(user);
      if (lockedNow) throw buildLockedError("Account locked for 15 minutes after repeated failed attempts.");
      return res.status(401).json({ message: "Invalid credentials" });
    }
    await clearLoginFailures(user, req.ip);
    const token = signToken(user._id, user.role, user.auth_version);
    setCustomerSessionCookie(res, req, token);
    setCsrfCookie(res, req);
    res.json({
      token,
      user: serializeUser(user.toObject()),
      message: user.email_verified ? undefined : "Login successful. Please verify your email address soon.",
    });
  } catch (err) {
    res.status(Number(err.status) || 400).json({ message: err.message });
  }
});

router.post("/verify/request", async (req, res) => {
  try {
    const normalizedEmail = normalizeEmail(req.body.email);
    let preview = null;
    if (normalizedEmail && isValidEmail(normalizedEmail)) {
      const user = await User.findOne({ email: normalizedEmail });
      if (user && !user.email_verified) {
        preview = await issueCustomerVerification(user);
      }
    }
    res.json({
      message: GENERIC_VERIFY_MESSAGE,
      ...(process.env.NODE_ENV !== "production" && preview ? preview : {}),
    });
  } catch (err) {
    res.status(Number(err.status) || 400).json({ message: err.message });
  }
});

router.get("/verify/confirm", async (req, res) => {
  try {
    const token = String(req.query.token || "").trim();
    if (!token) {
      return res.redirect(buildCustomerVerifyRedirect(false));
    }
    const user = await User.findOne({
      email_verification_token: hashToken(token),
      email_verification_expires_at: { $gt: new Date() },
    });
    if (!user) {
      return res.redirect(buildCustomerVerifyRedirect(false));
    }
    user.email_verified = true;
    user.email_verification_token = null;
    user.email_verification_expires_at = null;
    await user.save();
    return res.redirect(buildCustomerVerifyRedirect(true));
  } catch {
    return res.redirect(buildCustomerVerifyRedirect(false));
  }
});

router.post("/password/forgot", async (req, res) => {
  try {
    const normalizedEmail = normalizeEmail(req.body.email);
    let preview = null;
    if (normalizedEmail && isValidEmail(normalizedEmail)) {
      const user = await User.findOne(buildCustomerPasswordResetLookup(normalizedEmail));
      if (user) {
        preview = await issueCustomerPasswordReset(user);
      }
    }
    res.json({
      message: GENERIC_RESET_MESSAGE,
      ...(process.env.NODE_ENV !== "production" && preview ? preview : {}),
    });
  } catch (err) {
    res.status(Number(err.status) || 400).json({ message: err.message });
  }
});

router.post("/password/reset", async (req, res) => {
  try {
    const token = String(req.body.token || "").trim();
    const password = String(req.body.password || "");
    if (!token) return res.status(400).json({ message: "Reset token is required" });
    assertPasswordPolicy(password);
    const user = await User.findOne(buildPasswordResetTokenLookup(token, "customer"));
    if (!user) return res.status(400).json({ message: "This reset link is invalid or expired" });
    await applyPasswordReset(user, password);
    const sessionToken = signToken(user._id, user.role, user.auth_version);
    setCustomerSessionCookie(res, req, sessionToken);
    setCsrfCookie(res, req);
    res.json({
      token: sessionToken,
      user: serializeUser(user.toObject()),
      message: "Password reset successful",
    });
  } catch (err) {
    res.status(Number(err.status) || 400).json({ message: err.message });
  }
});

router.post("/admin/password/forgot", adminLoginLimiter, async (req, res) => {
  try {
    const normalizedEmail = normalizeEmail(req.body.email);
    let preview = null;
    await ensureAdminUser();
    if (normalizedEmail && isValidEmail(normalizedEmail)) {
      const admin = await User.findOne(buildAdminPasswordResetLookup(normalizedEmail));
      if (admin) {
        preview = await issueAdminPasswordReset(admin);
      }
    }
    res.json({
      message: GENERIC_RESET_MESSAGE,
      ...(process.env.NODE_ENV !== "production" && preview ? preview : {}),
    });
  } catch (err) {
    res.status(Number(err.status) || 400).json({ message: err.message });
  }
});

router.post("/admin/password/reset", async (req, res) => {
  try {
    const token = String(req.body.token || "").trim();
    const password = String(req.body.password || "");
    if (!token) return res.status(400).json({ message: "Reset token is required" });
    assertPasswordPolicy(password);
    const admin = await User.findOne(buildPasswordResetTokenLookup(token, "admin"));
    if (!admin) return res.status(400).json({ message: "This reset link is invalid or expired" });
    await applyPasswordReset(admin, password);
    const sessionToken = signToken(admin._id, admin.role, admin.auth_version);
    setCustomerSessionCookie(res, req, sessionToken);
    setCsrfCookie(res, req);
    res.json({
      token: sessionToken,
      user: serializeUser(admin.toObject()),
      message: "Password reset successful",
    });
  } catch (err) {
    res.status(Number(err.status) || 400).json({ message: err.message });
  }
});

router.get("/me", protect, (req, res) => {
  res.json(serializeUser(req.user));
});

router.get("/admin-session", protect, (req, res) => {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ message: "Admin access required" });
  }
  res.json(serializeUser(req.user));
});

router.get("/csrf", issueCsrfToken);

router.post("/logout", (req, res) => {
  clearCustomerSessionCookie(res, req);
  res.json({ success: true });
});

router.post("/admin-login", adminLoginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail || !isValidEmail(normalizedEmail) || !password) {
      return res.status(400).json({ message: "Admin email and password are required" });
    }

    await ensureAdminUser();
    const admin = await User.findOne({ email: normalizedEmail, role: "admin" });
    if (!admin) return res.status(401).json({ message: "Invalid credentials" });
    if (isAccountLocked(admin)) throw buildLockedError("Admin account temporarily locked. Try again in 15 minutes.");
    if (!password || !(await admin.matchPassword(password))) {
      const lockedNow = await recordFailedLogin(admin);
      if (lockedNow) throw buildLockedError("Admin account locked for 15 minutes after repeated failed attempts.");
      return res.status(401).json({ message: "Invalid credentials" });
    }
    await clearLoginFailures(admin, req.ip);
    const token = signToken(admin._id, admin.role, admin.auth_version);
    setCustomerSessionCookie(res, req, token);
    setCsrfCookie(res, req);
    res.json({ token, user: serializeUser(admin.toObject()) });
  } catch (err) {
    res.status(Number(err.status) || 500).json({ message: err.message });
  }
});

router._private = {
  applyPasswordReset,
  buildAdminPasswordResetLookup,
  buildCustomerPasswordResetLookup,
  buildPasswordResetTokenLookup,
  issueAdminPasswordReset,
  issueCustomerPasswordReset,
  normalizeEmail,
};

module.exports = router;
