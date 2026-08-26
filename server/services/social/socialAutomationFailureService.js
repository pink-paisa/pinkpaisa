const crypto = require("crypto");
const SocialAuditLog = require("../../models/SocialAuditLog");
const SocialConnectionHealth = require("../../models/SocialConnectionHealth");
const SocialManualAction = require("../../models/SocialManualAction");

function safeFailureText(value, maximum = 1000) {
  return String(value || "Social automation failed")
    .replace(/\bBearer\s+\S+/gi, "[credential redacted]")
    .replace(/(?:access[_-]?token|refresh[_-]?token|client[_-]?secret|app[_-]?secret|private[_-]?key|password|authorization|api[_-]?key|secret)\s*[:=]\s*[^\s&]+/gi, "[credential redacted]")
    .replace(/\b(?:sk|sess)-[A-Za-z0-9_-]{12,}\b/g, "[credential redacted]")
    .slice(0, maximum);
}

function safeErrorCode(value, fallback = "SOCIAL_AUTOMATION_FAILED") {
  const normalized = String(value || fallback)
    .trim()
    .replace(/[^A-Za-z0-9_.:-]+/g, "_")
    .slice(0, 160);
  return normalized || fallback;
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

async function findExistingAudit(AuditModel, idempotencyKey) {
  if (typeof AuditModel?.findOne !== "function") return null;
  const query = AuditModel.findOne({ idempotency_key: idempotencyKey });
  return typeof query?.lean === "function" ? query.lean() : query;
}

async function persistSocialAutomationFailure({
  now = new Date(),
  provider = "INSTAGRAM",
  operation,
  actionKey,
  actionType,
  priority = "HIGH",
  title,
  description,
  instructions = [],
  entityType,
  entityId,
  draftId = null,
  publicationId = null,
  communityItemId = null,
  externalReferenceId = null,
  error = null,
  metadata = null,
  dependencies = {},
} = {}) {
  if (!operation || !actionKey || !actionType || !title || !entityType || !entityId) {
    const validationError = new Error("A complete social automation failure context is required");
    validationError.code = "social_automation_failure_context_invalid";
    throw validationError;
  }
  const HealthModel = dependencies.SocialConnectionHealth || SocialConnectionHealth;
  const ActionModel = dependencies.SocialManualAction || SocialManualAction;
  const AuditModel = dependencies.SocialAuditLog || SocialAuditLog;
  const checkedAt = now instanceof Date ? now : new Date(now);
  const errorMessage = safeFailureText(error?.message || error || description);
  const errorCode = safeErrorCode(error?.code);
  const providerName = String(provider || "INSTAGRAM").trim().toUpperCase();
  const operationKey = String(operation).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").slice(0, 100);
  const checkKey = `social-scheduler:${operationKey}:${checkedAt.getTime()}:${sha256(`${errorCode}:${errorMessage}`).slice(0, 12)}`.slice(0, 300);

  const connectionHealth = await HealthModel.findOneAndUpdate(
    { provider: providerName },
    {
      $set: {
        status: "ERROR",
        checked_at: checkedAt,
        last_checked_at: checkedAt,
        last_error: errorMessage,
        latest_check: {
          check_key: checkKey,
          checked_at: checkedAt,
          status: "ERROR",
          error_code: errorCode,
          error_summary: errorMessage,
        },
      },
      $inc: { consecutive_failures: 1 },
      $push: {
        checks: {
          $each: [{
            check_key: checkKey,
            checked_at: checkedAt,
            status: "ERROR",
            error_code: errorCode,
            error_summary: errorMessage,
            operation,
            entity_type: entityType,
            entity_id: String(entityId),
          }],
          $slice: -50,
        },
      },
      $setOnInsert: {
        connection_key: `social-growth:${providerName.toLowerCase()}`,
        provider: providerName,
        display_name: providerName === "INSTAGRAM" ? "Instagram / Meta Graph" : `${providerName} social connection`,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true },
  );
  const connectionHealthId = connectionHealth?._id || connectionHealth?.id || null;

  const actionRecord = {
    action_key: String(actionKey).slice(0, 400),
    action_type: actionType,
    status: "OPEN",
    priority,
    title: String(title).slice(0, 240),
    description: safeFailureText(description || errorMessage, 4000),
    instructions: (Array.isArray(instructions) ? instructions : []).map((value) => safeFailureText(value, 1000)),
    provider: providerName,
    draft_id: draftId,
    publication_id: publicationId,
    community_item_id: communityItemId,
    connection_health_id: connectionHealthId,
    external_reference_id: externalReferenceId == null ? null : String(externalReferenceId).slice(0, 400),
  };
  const manualAction = typeof ActionModel.findOneAndUpdate === "function"
    ? await ActionModel.findOneAndUpdate(
      { action_key: actionRecord.action_key },
      { $setOnInsert: actionRecord },
      { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true },
    )
    : await ActionModel.create(actionRecord);
  const manualActionId = manualAction?._id || manualAction?.id || null;

  const auditIdempotencyKey = `social-scheduler-failure:${sha256(actionRecord.action_key)}`;
  let audit = null;
  try {
    audit = await AuditModel.create({
      idempotency_key: auditIdempotencyKey,
      entity_type: entityType,
      entity_id: entityId,
      draft_id: draftId,
      publication_id: publicationId,
      action: String(operation).trim().toUpperCase().replace(/[^A-Z0-9_]+/g, "_").slice(0, 80),
      action_status: "FAILED",
      actor_type: "WORKER",
      actor_admin_id: null,
      actor_label: "Social automation scheduler",
      summary: `${String(title).slice(0, 1700)}; a linked manual action and connection-health failure were persisted.`,
      error_code: errorCode,
      error_message: errorMessage,
      metadata: {
        ...(metadata && typeof metadata === "object" ? metadata : {}),
        provider: providerName,
        operation,
        manual_action_id: manualActionId,
        connection_health_id: connectionHealthId,
      },
    });
  } catch (auditError) {
    if (auditError?.code !== 11000) throw auditError;
    audit = await findExistingAudit(AuditModel, auditIdempotencyKey);
  }

  return {
    durability: "PERSISTED",
    manual_action_id: manualActionId ? String(manualActionId) : null,
    connection_health_id: connectionHealthId ? String(connectionHealthId) : null,
    audit_event_id: audit?._id || audit?.id || audit?.event_id || null,
  };
}

module.exports = {
  persistSocialAutomationFailure,
  _private: {
    safeErrorCode,
    safeFailureText,
  },
};
