const logger = require("../utils/logger");
const { getClientIp } = require("./requestGuards");

let warnedUnconfigured = false;

function getCaptchaConfig() {
  const explicitProvider = String(process.env.CAPTCHA_PROVIDER || "").trim().toLowerCase();
  const provider = explicitProvider
    || (process.env.TURNSTILE_SECRET ? "turnstile" : "")
    || (process.env.HCAPTCHA_SITEVERIFY_URL || process.env.HCAPTCHA_SECRET ? "hcaptcha" : "");

  if (provider === "turnstile") {
    const configuredHostnames = String(process.env.TURNSTILE_ALLOWED_HOSTNAMES || "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    if (!configuredHostnames.length) {
      try {
        const publicHostname = new URL(String(process.env.PUBLIC_APP_URL || "")).hostname.toLowerCase();
        if (publicHostname) configuredHostnames.push(publicHostname);
      } catch {
        // A missing/invalid public URL is handled as a production configuration error below.
      }
    }
    return {
      provider,
      verifyUrl: String(process.env.TURNSTILE_VERIFY_URL || "https://challenges.cloudflare.com/turnstile/v0/siteverify"),
      secret: String(process.env.TURNSTILE_SECRET || "").trim(),
      allowedHostnames: configuredHostnames,
    };
  }

  return {
    provider: provider || "hcaptcha",
    verifyUrl: String(process.env.HCAPTCHA_SITEVERIFY_URL || "https://hcaptcha.com/siteverify"),
    secret: String(process.env.HCAPTCHA_SECRET || "").trim(),
    allowedHostnames: [],
  };
}

function unconfiguredCaptchaAllowed() {
  return process.env.NODE_ENV !== "production"
    && String(process.env.CAPTCHA_ALLOW_UNCONFIGURED || "false").trim().toLowerCase() === "true";
}

async function verifyCaptchaToken(token, remoteIp, { expectedAction = null } = {}) {
  const config = getCaptchaConfig();
  if (!config.secret) {
    if (unconfiguredCaptchaAllowed()) {
      if (!warnedUnconfigured) {
        warnedUnconfigured = true;
        logger.warn("Captcha verification is explicitly bypassed for this non-production environment");
      }
      return { ok: true, skipped: true };
    }
    if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      logger.error("Captcha middleware is enabled but no provider secret is configured; public submissions are blocked");
    }
    return { ok: false, message: "Security verification is not configured" };
  }

  if (!token) {
    return { ok: false, message: "Captcha verification is required" };
  }

  const body = new URLSearchParams();
  body.set("secret", config.secret);
  body.set("response", token);
  if (remoteIp) body.set("remoteip", remoteIp);

  try {
    const response = await fetch(config.verifyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || !json.success) {
      return { ok: false, message: "Captcha verification failed", details: json };
    }
    if (config.provider === "turnstile") {
      const action = String(json.action || "").trim();
      if (expectedAction && action !== expectedAction) {
        return { ok: false, message: "Captcha action did not match this form" };
      }
      const hostname = String(json.hostname || "").trim().toLowerCase();
      if (config.allowedHostnames.length && !config.allowedHostnames.includes(hostname)) {
        return { ok: false, message: "Captcha hostname was not accepted" };
      }
      if (process.env.NODE_ENV === "production" && !config.allowedHostnames.length) {
        return { ok: false, message: "Captcha hostname validation is not configured" };
      }
    }
    return { ok: true };
  } catch (error) {
    logger.error({ err: error }, "Captcha verification request failed");
    return { ok: false, message: "Captcha verification is temporarily unavailable" };
  }
}

function requireCaptcha({ skipWhenAuthenticated = true, action = null } = {}) {
  return async (req, res, next) => {
    if (skipWhenAuthenticated && req.user?._id) return next();

    const token =
      req.body?.captcha_token ||
      req.headers["x-captcha-token"] ||
      req.query?.captcha_token ||
      null;

    const result = await verifyCaptchaToken(String(token || "").trim(), getClientIp(req), {
      expectedAction: action,
    });
    if (!result.ok) {
      return res.status(400).json({ message: result.message });
    }

    return next();
  };
}

module.exports = {
  requireCaptcha,
  getCaptchaConfig,
  unconfiguredCaptchaAllowed,
  verifyCaptchaToken,
};
