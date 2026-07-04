const logger = require("../utils/logger");
const { getClientIp } = require("./requestGuards");

let warnedUnconfigured = false;

function getCaptchaConfig() {
  const provider = String(process.env.CAPTCHA_PROVIDER || process.env.HCAPTCHA_SITEVERIFY_URL ? "hcaptcha" : "")
    .trim()
    .toLowerCase();

  if (provider === "turnstile") {
    return {
      provider,
      verifyUrl: String(process.env.TURNSTILE_VERIFY_URL || "https://challenges.cloudflare.com/turnstile/v0/siteverify"),
      secret: String(process.env.TURNSTILE_SECRET || "").trim(),
    };
  }

  return {
    provider: provider || "hcaptcha",
    verifyUrl: String(process.env.HCAPTCHA_SITEVERIFY_URL || "https://hcaptcha.com/siteverify"),
    secret: String(process.env.HCAPTCHA_SECRET || "").trim(),
  };
}

async function verifyCaptchaToken(token, remoteIp) {
  const config = getCaptchaConfig();
  if (!config.secret) {
    if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      logger.warn("Captcha middleware is enabled in code but no provider secret is configured; requests will pass through");
    }
    return { ok: true, skipped: true };
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
    return { ok: true };
  } catch (error) {
    logger.error({ err: error }, "Captcha verification request failed");
    return { ok: false, message: "Captcha verification is temporarily unavailable" };
  }
}

function requireCaptcha({ skipWhenAuthenticated = true } = {}) {
  return async (req, res, next) => {
    if (skipWhenAuthenticated && req.user?._id) return next();

    const token =
      req.body?.captcha_token ||
      req.headers["x-captcha-token"] ||
      req.query?.captcha_token ||
      null;

    const result = await verifyCaptchaToken(String(token || "").trim(), getClientIp(req));
    if (!result.ok) {
      return res.status(400).json({ message: result.message });
    }

    return next();
  };
}

module.exports = {
  requireCaptcha,
  verifyCaptchaToken,
};
