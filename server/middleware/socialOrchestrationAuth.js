const crypto = require("crypto");

const SOCIAL_ORCHESTRATION_SIGNATURE_VERSION = "v1";
const SOCIAL_ORCHESTRATION_SIGNATURE_CONTEXT = "pink-paisa-social-orchestration/v1";
const SOCIAL_ORCHESTRATION_TARGETS = Object.freeze({
  "/api/social-media-manager/orchestration/weekly-plan": "WEEKLY_PLAN",
  "/api/social-media-manager/orchestration/prepublication": "PREPUBLICATION",
  "/api/social-media-manager/orchestration/metrics": "METRICS",
});

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function buildSocialOrchestrationCanonicalMessage({
  method,
  path,
  operation,
  idempotencyKey,
  timestamp,
  rawBody,
}) {
  const normalizedMethod = String(method || "").trim().toUpperCase();
  const normalizedPath = String(path || "");
  const normalizedOperation = String(operation || "").trim().toUpperCase();
  const normalizedKey = String(idempotencyKey || "");
  const normalizedTimestamp = String(timestamp || "");
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody || "");
  if (normalizedMethod !== "POST"
    || SOCIAL_ORCHESTRATION_TARGETS[normalizedPath] !== normalizedOperation
    || !normalizedKey
    || normalizedKey.trim() !== normalizedKey
    || normalizedKey.length > 300
    || /[\u0000-\u001F\u007F]/.test(normalizedKey)
    || !/^\d{1,12}$/.test(normalizedTimestamp)
    || !body.length) {
    throw new TypeError("A valid canonical Social orchestration request is required");
  }
  return Buffer.concat([
    Buffer.from([
      SOCIAL_ORCHESTRATION_SIGNATURE_CONTEXT,
      normalizedMethod,
      normalizedPath,
      normalizedOperation,
      normalizedKey,
      normalizedTimestamp,
      "",
    ].join("\n"), "utf8"),
    body,
  ]);
}

function buildSocialOrchestrationSignature({ secret, ...request }) {
  const canonicalMessage = buildSocialOrchestrationCanonicalMessage(request);
  const digest = crypto.createHmac("sha256", secret).update(canonicalMessage).digest("hex");
  return `${SOCIAL_ORCHESTRATION_SIGNATURE_VERSION}=sha256=${digest}`;
}

function buildSocialOrchestrationDeliveryFingerprint({ timestamp, rawBody, signature }) {
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody || "");
  return crypto
    .createHash("sha256")
    .update(String(timestamp || "").trim())
    .update("\n")
    .update(String(signature || "").trim().toLowerCase())
    .update("\n")
    .update(body)
    .digest("hex");
}

function resolveSocialOrchestrationTarget(req) {
  const requestUrl = String(req.originalUrl || `${req.baseUrl || ""}${req.path || req.url || ""}`);
  const queryIndex = requestUrl.indexOf("?");
  if (queryIndex >= 0) return null;
  const path = requestUrl;
  const method = String(req.method || "").trim().toUpperCase();
  const operation = SOCIAL_ORCHESTRATION_TARGETS[path] || null;
  if (method !== "POST" || !operation) return null;
  return { method, path, operation };
}

function requireSocialOrchestrationSignature(req, res, next) {
  const secret = String(process.env.N8N_SOCIAL_WEBHOOK_SECRET || "").trim();
  if (!secret) return res.status(503).json({ message: "Social orchestration signing is not configured" });
  const idempotencyKey = String(req.headers["x-idempotency-key"] || "");
  if (!idempotencyKey
    || idempotencyKey.trim() !== idempotencyKey
    || idempotencyKey.length > 300
    || /[\u0000-\u001F\u007F]/.test(idempotencyKey)) {
    return res.status(400).json({ message: "A bounded X-Idempotency-Key is required" });
  }
  const timestamp = String(req.headers["x-pink-paisa-timestamp"] || "");
  const supplied = String(req.headers["x-pink-paisa-signature"] || "").trim().toLowerCase();
  const timestampSeconds = Number(timestamp);
  if (!/^\d{1,12}$/.test(timestamp)
    || !Number.isFinite(timestampSeconds)
    || Math.abs(Date.now() - timestampSeconds * 1000) > 5 * 60 * 1000) {
    return res.status(401).json({ message: "Social orchestration timestamp is missing or expired" });
  }
  const rawBody = Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from("");
  if (!rawBody.length) return res.status(401).json({ message: "Social orchestration signed body is missing" });
  const target = resolveSocialOrchestrationTarget(req);
  if (!target) return res.status(401).json({ message: "Social orchestration request target is invalid" });
  const expected = buildSocialOrchestrationSignature({
    ...target,
    idempotencyKey,
    timestamp,
    rawBody,
    secret,
  });
  if (!safeEqual(supplied, expected)) return res.status(401).json({ message: "Social orchestration signature is invalid" });
  req.socialOrchestration = {
    deliveryFingerprint: buildSocialOrchestrationDeliveryFingerprint({
      timestamp,
      rawBody,
      signature: supplied,
    }),
    idempotencyKey,
    method: target.method,
    operation: target.operation,
    path: target.path,
    signatureVersion: SOCIAL_ORCHESTRATION_SIGNATURE_VERSION,
    timestamp: timestampSeconds,
  };
  return next();
}

module.exports = {
  SOCIAL_ORCHESTRATION_SIGNATURE_CONTEXT,
  SOCIAL_ORCHESTRATION_SIGNATURE_VERSION,
  SOCIAL_ORCHESTRATION_TARGETS,
  buildSocialOrchestrationCanonicalMessage,
  buildSocialOrchestrationDeliveryFingerprint,
  buildSocialOrchestrationSignature,
  requireSocialOrchestrationSignature,
  resolveSocialOrchestrationTarget,
  safeEqual,
};
