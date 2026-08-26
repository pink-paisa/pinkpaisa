const crypto = require("node:crypto");
const os = require("node:os");
const SocialOrchestrationReceipt = require("../../models/SocialOrchestrationReceipt");

const OPERATIONS = new Set(["WEEKLY_PLAN", "PREPUBLICATION", "METRICS"]);
const DEFAULT_LEASE_MS = 15 * 60 * 1000;
const MIN_LEASE_MS = 60 * 1000;
const MAX_LEASE_MS = 60 * 60 * 1000;

function clampLeaseMs(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_LEASE_MS;
  return Math.min(Math.max(Math.floor(parsed), MIN_LEASE_MS), MAX_LEASE_MS);
}

function normalizeOperation(value) {
  const operation = String(value || "").trim().toUpperCase();
  if (!OPERATIONS.has(operation)) {
    const error = new Error("Unsupported Social orchestration operation");
    error.code = "social_orchestration_operation_invalid";
    error.statusCode = 500;
    throw error;
  }
  return operation;
}

function normalizeIdempotencyKey(value) {
  const key = String(value || "").trim();
  if (!key || key.length > 300 || /[\u0000-\u001F\u007F]/.test(key)) {
    const error = new Error("A bounded X-Idempotency-Key is required");
    error.code = "social_orchestration_idempotency_key_invalid";
    error.statusCode = 400;
    throw error;
  }
  return key;
}

function normalizeDeliveryFingerprint(value) {
  const fingerprint = String(value || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) {
    const error = new Error("A verified signed-delivery fingerprint is required");
    error.code = "social_orchestration_delivery_fingerprint_invalid";
    error.statusCode = 400;
    throw error;
  }
  return fingerprint;
}

function requestHash(rawBody) {
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody || "");
  if (!body.length) {
    const error = new Error("Social orchestration raw request body is required");
    error.code = "social_orchestration_body_missing";
    error.statusCode = 400;
    throw error;
  }
  return crypto.createHash("sha256").update(body).digest("hex");
}

function jsonSafe(value) {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

function statusCodeForError(error) {
  const status = Number(error?.statusCode || error?.status || 500);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
}

function errorBody(error) {
  return {
    message: String(error?.message || "Social orchestration failed").slice(0, 4000),
    code: error?.code ? String(error.code).slice(0, 200) : null,
  };
}

function isRetryableFailure(error, statusCode) {
  if (typeof error?.retryable === "boolean") return error.retryable;
  if (typeof error?.is_retriable === "boolean") return error.is_retriable;
  return statusCode >= 500;
}

function isDuplicateKeyError(error) {
  return Number(error?.code) === 11000;
}

function receiptOutcome(receipt, { replayed }) {
  return {
    statusCode: Number(receipt.response_status || (receipt.status === "SUCCEEDED" ? 200 : 500)),
    body: jsonSafe(receipt.response_body),
    replayed,
    receiptStatus: receipt.status,
    attemptCount: Number(receipt.attempt_count || 1),
  };
}

function conflictOutcome() {
  return {
    statusCode: 409,
    body: {
      message: "This idempotency key was already used with a different request body",
      code: "social_orchestration_idempotency_conflict",
    },
    replayed: false,
    receiptStatus: "CONFLICT",
    attemptCount: 0,
  };
}

function deliveryReplayOutcome() {
  return {
    statusCode: 409,
    body: {
      message: "This verified signed delivery was already associated with another orchestration request",
      code: "social_orchestration_delivery_replay",
    },
    replayed: false,
    receiptStatus: "CONFLICT",
    attemptCount: 0,
  };
}

function inProgressOutcome(receipt, now) {
  const leaseExpiresAt = receipt.lease_expires_at ? new Date(receipt.lease_expires_at) : null;
  const retryAfterSeconds = leaseExpiresAt && Number.isFinite(leaseExpiresAt.getTime())
    ? Math.max(Math.ceil((leaseExpiresAt.getTime() - now.getTime()) / 1000), 1)
    : Math.ceil(DEFAULT_LEASE_MS / 1000);
  return {
    statusCode: 409,
    body: {
      message: "This Social orchestration request is already being processed",
      code: "social_orchestration_idempotency_in_progress",
      retry_after_seconds: retryAfterSeconds,
    },
    replayed: false,
    receiptStatus: "PROCESSING",
    attemptCount: Number(receipt.attempt_count || 1),
    retryAfterSeconds,
  };
}

async function findReceiptAfterDuplicate(ReceiptModel, { operation, idempotencyKey, deliveryFingerprint }) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const keyReceipt = await ReceiptModel.findOne({
      operation,
      idempotency_key: idempotencyKey,
    });
    if (keyReceipt) return { receipt: keyReceipt, collision: "IDEMPOTENCY_KEY" };
    const deliveryReceipt = await ReceiptModel.findOne({
      signed_delivery_fingerprints: deliveryFingerprint,
    });
    if (deliveryReceipt) return { receipt: deliveryReceipt, collision: "SIGNED_DELIVERY" };
    await new Promise((resolve) => setImmediate(resolve));
  }
  const error = new Error("The Social orchestration idempotency receipt could not be loaded");
  error.code = "social_orchestration_receipt_unavailable";
  error.statusCode = 503;
  throw error;
}

async function createOrLoadReceipt({
  ReceiptModel,
  operation,
  idempotencyKey,
  deliveryFingerprint,
  hash,
  requestTimestamp,
  leaseOwner,
  now,
  leaseMs,
}) {
  try {
    const receipt = await ReceiptModel.create({
      operation,
      idempotency_key: idempotencyKey,
      request_hash: hash,
      signed_delivery_fingerprints: [deliveryFingerprint],
      request_timestamp: requestTimestamp,
      status: "PROCESSING",
      attempt_count: 1,
      retryable: false,
      response_status: null,
      response_body: null,
      lease_owner: leaseOwner,
      lease_expires_at: new Date(now.getTime() + leaseMs),
      heartbeat_at: now,
      started_at: now,
      completed_at: null,
      last_error: null,
    });
    return { receipt, owned: true };
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    const duplicate = await findReceiptAfterDuplicate(ReceiptModel, {
      operation,
      idempotencyKey,
      deliveryFingerprint,
    });
    return { ...duplicate, owned: false };
  }
}

async function attachSignedDeliveryFingerprint({ ReceiptModel, receipt, deliveryFingerprint }) {
  if (Array.isArray(receipt.signed_delivery_fingerprints)
    && receipt.signed_delivery_fingerprints.includes(deliveryFingerprint)) {
    return { receipt, collision: false };
  }
  try {
    const updated = await ReceiptModel.findOneAndUpdate(
      { _id: receipt._id },
      { $addToSet: { signed_delivery_fingerprints: deliveryFingerprint } },
      { new: true, runValidators: true }
    );
    if (!updated) {
      const error = new Error("The Social orchestration idempotency receipt changed before its delivery could be stored");
      error.code = "social_orchestration_receipt_changed";
      error.statusCode = 409;
      throw error;
    }
    return { receipt: updated, collision: false };
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    return { receipt, collision: true };
  }
}

async function claimRetryableOrStaleReceipt({
  ReceiptModel,
  receipt,
  hash,
  leaseOwner,
  now,
  leaseMs,
}) {
  return ReceiptModel.findOneAndUpdate(
    {
      _id: receipt._id,
      request_hash: hash,
      $or: [
        { status: "FAILED", retryable: true },
        { status: "PROCESSING", lease_expires_at: { $lte: now } },
        { status: "PROCESSING", lease_expires_at: null },
      ],
    },
    {
      $set: {
        status: "PROCESSING",
        retryable: false,
        response_status: null,
        response_body: null,
        lease_owner: leaseOwner,
        lease_expires_at: new Date(now.getTime() + leaseMs),
        heartbeat_at: now,
        started_at: now,
        completed_at: null,
        last_error: null,
      },
      $inc: { attempt_count: 1 },
    },
    { new: true, runValidators: true }
  );
}

function startLeaseHeartbeat({ ReceiptModel, receiptId, leaseOwner, leaseMs, nowValue, disabled }) {
  if (disabled || typeof ReceiptModel.updateOne !== "function") return null;
  const intervalMs = Math.max(Math.min(Math.floor(leaseMs / 3), 60 * 1000), 10 * 1000);
  const timer = setInterval(() => {
    const heartbeatAt = nowValue();
    void ReceiptModel.updateOne(
      { _id: receiptId, status: "PROCESSING", lease_owner: leaseOwner },
      {
        $set: {
          heartbeat_at: heartbeatAt,
          lease_expires_at: new Date(heartbeatAt.getTime() + leaseMs),
        },
      }
    ).catch(() => null);
  }, intervalMs);
  timer.unref?.();
  return timer;
}

async function persistOutcome({
  ReceiptModel,
  receipt,
  leaseOwner,
  status,
  statusCode,
  body,
  retryable,
  now,
  error = null,
}) {
  const completed = await ReceiptModel.findOneAndUpdate(
    { _id: receipt._id, status: "PROCESSING", lease_owner: leaseOwner },
    {
      $set: {
        status,
        retryable: Boolean(retryable),
        response_status: statusCode,
        response_body: jsonSafe(body),
        lease_owner: null,
        lease_expires_at: null,
        heartbeat_at: now,
        completed_at: now,
        last_error: error
          ? {
            code: error?.code ? String(error.code).slice(0, 200) : null,
            message: String(error?.message || "Social orchestration failed").slice(0, 4000),
            status_code: statusCode,
            occurred_at: now,
          }
          : null,
      },
    },
    { new: true, runValidators: true }
  );
  if (!completed) {
    const leaseError = new Error("The Social orchestration execution lease was lost before its result could be stored");
    leaseError.code = "social_orchestration_lease_lost";
    leaseError.statusCode = 409;
    throw leaseError;
  }
  return completed;
}

async function executeIdempotentSocialOrchestration({
  operation,
  deliveryFingerprint,
  idempotencyKey,
  rawBody,
  requestTimestamp,
  execute,
  dependencies = {},
}) {
  if (typeof execute !== "function") throw new TypeError("An orchestration operation callback is required");
  const ReceiptModel = dependencies.SocialOrchestrationReceipt || SocialOrchestrationReceipt;
  const normalizedOperation = normalizeOperation(operation);
  const normalizedKey = normalizeIdempotencyKey(idempotencyKey);
  const normalizedDeliveryFingerprint = normalizeDeliveryFingerprint(deliveryFingerprint);
  const hash = requestHash(rawBody);
  const timestamp = Number(requestTimestamp);
  if (!Number.isFinite(timestamp) || timestamp < 0) {
    const error = new Error("A valid signed orchestration timestamp is required");
    error.code = "social_orchestration_timestamp_invalid";
    error.statusCode = 400;
    throw error;
  }
  const nowValue = dependencies.now || (() => new Date());
  const now = new Date(nowValue());
  if (!Number.isFinite(now.getTime())) throw new Error("The Social orchestration clock is invalid");
  const leaseMs = clampLeaseMs(dependencies.leaseMs || process.env.SOCIAL_ORCHESTRATION_LEASE_MS);
  const randomUUID = dependencies.randomUUID || crypto.randomUUID;
  const hostname = dependencies.hostname || os.hostname;
  const leaseOwner = `${hostname()}:${process.pid}:${randomUUID()}`.slice(0, 200);

  let { receipt, owned, collision = null } = await createOrLoadReceipt({
    ReceiptModel,
    operation: normalizedOperation,
    idempotencyKey: normalizedKey,
    deliveryFingerprint: normalizedDeliveryFingerprint,
    hash,
    requestTimestamp: timestamp,
    leaseOwner,
    now,
    leaseMs,
  });

  if (collision === "SIGNED_DELIVERY") return deliveryReplayOutcome();

  if (!owned) {
    const delivery = await attachSignedDeliveryFingerprint({
      ReceiptModel,
      receipt,
      deliveryFingerprint: normalizedDeliveryFingerprint,
    });
    if (delivery.collision) return deliveryReplayOutcome();
    receipt = delivery.receipt;
    if (receipt.request_hash !== hash) return conflictOutcome();
    if (receipt.status === "SUCCEEDED" || (receipt.status === "FAILED" && !receipt.retryable)) {
      return receiptOutcome(receipt, { replayed: true });
    }
    const claimed = await claimRetryableOrStaleReceipt({
      ReceiptModel,
      receipt,
      hash,
      leaseOwner,
      now,
      leaseMs,
    });
    if (claimed) {
      receipt = claimed;
      owned = true;
    } else {
      const current = await ReceiptModel.findOne({
        operation: normalizedOperation,
        idempotency_key: normalizedKey,
      });
      if (!current) {
        const error = new Error("The Social orchestration idempotency receipt disappeared during execution");
        error.code = "social_orchestration_receipt_unavailable";
        error.statusCode = 503;
        throw error;
      }
      if (current.request_hash !== hash) return conflictOutcome();
      if (current.status === "SUCCEEDED" || (current.status === "FAILED" && !current.retryable)) {
        return receiptOutcome(current, { replayed: true });
      }
      return inProgressOutcome(current, now);
    }
  }

  const heartbeat = startLeaseHeartbeat({
    ReceiptModel,
    receiptId: receipt._id,
    leaseOwner,
    leaseMs,
    nowValue: () => new Date(nowValue()),
    disabled: dependencies.disableHeartbeat === true,
  });

  try {
    const result = await execute();
    const statusCode = Number(result?.statusCode || 200);
    const normalizedStatusCode = Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599 ? statusCode : 200;
    const body = jsonSafe(result?.body);
    const failed = normalizedStatusCode >= 400;
    const completedAt = new Date(nowValue());
    const completed = await persistOutcome({
      ReceiptModel,
      receipt,
      leaseOwner,
      status: failed ? "FAILED" : "SUCCEEDED",
      statusCode: normalizedStatusCode,
      body,
      retryable: failed && normalizedStatusCode >= 500,
      now: completedAt,
      error: failed ? Object.assign(new Error(body?.message || "Social orchestration failed"), { code: body?.code }) : null,
    });
    return receiptOutcome(completed, { replayed: false });
  } catch (error) {
    const statusCode = statusCodeForError(error);
    const body = errorBody(error);
    const failedAt = new Date(nowValue());
    const failed = await persistOutcome({
      ReceiptModel,
      receipt,
      leaseOwner,
      status: "FAILED",
      statusCode,
      body,
      retryable: isRetryableFailure(error, statusCode),
      now: failedAt,
      error,
    });
    return receiptOutcome(failed, { replayed: false });
  } finally {
    if (heartbeat) clearInterval(heartbeat);
  }
}

module.exports = {
  DEFAULT_LEASE_MS,
  executeIdempotentSocialOrchestration,
  requestHash,
  _private: {
    claimRetryableOrStaleReceipt,
    clampLeaseMs,
    conflictOutcome,
    createOrLoadReceipt,
    attachSignedDeliveryFingerprint,
    deliveryReplayOutcome,
    errorBody,
    inProgressOutcome,
    isRetryableFailure,
    normalizeDeliveryFingerprint,
    normalizeIdempotencyKey,
    normalizeOperation,
    persistOutcome,
    receiptOutcome,
    statusCodeForError,
  },
};
