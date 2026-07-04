const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const { getRedisClient, hasRedisUrl } = require("../utils/redisClient");

function normalizeOrigin(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function expandOriginVariants(origin) {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return [];

  try {
    const parsed = new URL(normalized);
    const variants = new Set([parsed.origin]);
    const host = parsed.hostname.toLowerCase();

    if (host.startsWith("www.")) {
      variants.add(`${parsed.protocol}//${host.slice(4)}${parsed.port ? `:${parsed.port}` : ""}`);
    } else if (!["localhost", "127.0.0.1"].includes(host) && host.includes(".")) {
      variants.add(`${parsed.protocol}//www.${host}${parsed.port ? `:${parsed.port}` : ""}`);
    }

    return Array.from(variants);
  } catch {
    return [normalized];
  }
}

function buildAllowedOrigins() {
  const extraOrigins = String(process.env.CORS_EXTRA_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const explicitOrigins = [
    process.env.FRONTEND_URL,
    process.env.PUBLIC_APP_URL,
    process.env.CLIENT_URL,
    ...extraOrigins,
  ]
    .flatMap((value) => expandOriginVariants(value))
    .filter(Boolean);

  if (process.env.NODE_ENV !== "production") {
    explicitOrigins.push("http://localhost:8081", "http://localhost:3000", "http://127.0.0.1:8081");
  }

  return Array.from(new Set(explicitOrigins));
}

function createCorsOptions() {
  const allowedOrigins = buildAllowedOrigins();
  const allowAll = allowedOrigins.length === 0 && process.env.NODE_ENV !== "production";

  return {
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      const normalized = normalizeOrigin(origin);
      if (allowAll || allowedOrigins.includes(normalized)) {
        return callback(null, true);
      }
      return callback(new Error("Origin not allowed by CORS"));
    },
    credentials: true,
  };
}

function securityHeaders(req, res, next) {
  res.removeHeader("X-Powered-By");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");

  if (req.secure || String(req.headers["x-forwarded-proto"] || "").toLowerCase() === "https") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  next();
}

function getClientIp(req) {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

function createMemoryRateLimiter({ windowMs = DEFAULT_WINDOW_MS, max = 30, keyPrefix = "global", message = "Too many requests, please try again later." } = {}) {
  const bucket = new Map();
  let mutationCount = 0;

  const sweepExpiredEntries = (now) => {
    for (const [entryKey, value] of bucket.entries()) {
      if (value.resetAt <= now) bucket.delete(entryKey);
    }
  };

  return (req, res, next) => {
    const now = Date.now();
    mutationCount += 1;
    if (mutationCount >= 200) {
      sweepExpiredEntries(now);
      mutationCount = 0;
    }
    const key = `${keyPrefix}:${getClientIp(req)}`;
    const current = bucket.get(key);

    if (!current || current.resetAt <= now) {
      bucket.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    current.count += 1;
    if (current.count > max) {
      const retryAfterSeconds = Math.max(Math.ceil((current.resetAt - now) / 1000), 1);
      res.setHeader("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({ message });
    }

    return next();
  };
}

function createRateLimiter({ windowMs = DEFAULT_WINDOW_MS, max = 30, keyPrefix = "global", message = "Too many requests, please try again later." } = {}) {
  const memoryLimiter = createMemoryRateLimiter({ windowMs, max, keyPrefix, message });

  return async (req, res, next) => {
    if (!hasRedisUrl()) {
      if (process.env.NODE_ENV === "production") {
        return res.status(503).json({ message: "Rate limiter is not configured" });
      }
      return memoryLimiter(req, res, next);
    }

    try {
      const redis = await getRedisClient();
      if (!redis) return memoryLimiter(req, res, next);
      const key = `${keyPrefix}:${getClientIp(req)}`;
      const count = await redis.incr(key);
      if (count === 1) await redis.pExpire(key, windowMs);
      if (count > max) {
        const ttl = await redis.pTTL(key);
        res.setHeader("Retry-After", String(Math.max(Math.ceil(ttl / 1000), 1)));
        return res.status(429).json({ message });
      }
      return next();
    } catch (error) {
      if (process.env.NODE_ENV === "production") {
        return res.status(503).json({ message: "Rate limiter is temporarily unavailable" });
      }
      return memoryLimiter(req, res, next);
    }
  };
}

module.exports = {
  createCorsOptions,
  createRateLimiter,
  getClientIp,
  securityHeaders,
};
