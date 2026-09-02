const crypto = require("crypto");
const mongoose = require("mongoose");
const SocialAuditLog = require("../../models/SocialAuditLog");
const SocialGenerationRun = require("../../models/SocialGenerationRun");

const TERMINAL_GENERATION_STATUSES = new Set([
  "FAILED",
  "FAILED_COMPLIANCE",
  "FAILED_IMAGE_GENERATION",
]);

function actorId(actor) {
  return actor?._id || actor?.id || null;
}

function shortText(value, maximum) {
  return String(value || "").trim().slice(0, maximum);
}

function sourceIpHash(value) {
  const normalized = shortText(value, 500);
  if (!normalized) return null;
  const salt = process.env.SOCIAL_AUDIT_IP_SALT || "pink-paisa-social";
  return crypto.createHash("sha256").update(`${salt}:${normalized}`).digest("hex");
}

async function withRequiredTransaction(dependencies, work) {
  if (dependencies.mongoSession) return work(dependencies.mongoSession);
  const configuredStarter = Object.prototype.hasOwnProperty.call(dependencies, "startSession")
    ? dependencies.startSession
    : (mongoose.connection?.readyState === 1 && typeof mongoose.startSession === "function"
      ? () => mongoose.startSession()
      : null);
  if (typeof configuredStarter !== "function") {
    const error = new Error("A Mongo transaction is required to dismiss a generation failure and retain its audit atomically");
    error.code = "social_generation_failure_archive_transaction_required";
    error.statusCode = 503;
    throw error;
  }
  const session = await configuredStarter();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

function withSession(query, session) {
  return session && typeof query?.session === "function" ? query.session(session) : query;
}

async function createAudit(AuditModel, record, session) {
  if (!session) return AuditModel.create(record);
  const created = await AuditModel.create([record], { session });
  return Array.isArray(created) ? created[0] : created;
}

async function archiveGenerationFailure(runId, {
  actor = null,
  requestId = null,
  ip = null,
  reason = null,
  now = new Date(),
  dependencies = {},
} = {}) {
  const RunModel = dependencies.SocialGenerationRun || SocialGenerationRun;
  const AuditModel = dependencies.SocialAuditLog || SocialAuditLog;
  const archiveReason = shortText(reason, 1000)
    || "Dismissed from the actionable recovery queue after administrator review.";

  return withRequiredTransaction(dependencies, async (session) => {
    const run = await withSession(RunModel.findById(runId), session);
    if (!run) {
      const error = new Error("Social generation run not found");
      error.code = "social_generation_run_not_found";
      error.statusCode = 404;
      throw error;
    }
    const status = String(run.status || "").toUpperCase();
    if (!TERMINAL_GENERATION_STATUSES.has(status)) {
      const error = new Error(`A ${status || "non-failed"} generation run cannot be dismissed from recovery`);
      error.code = "social_generation_failure_archive_not_allowed";
      error.statusCode = 409;
      throw error;
    }
    if (run.superseded_by_generation_run_id) {
      const error = new Error("This failure already has a replacement generation run and is no longer independently actionable");
      error.code = "social_generation_failure_superseded";
      error.statusCode = 409;
      throw error;
    }
    if (run.recovery_archived_at) return { run, reused: true };

    const adminId = actorId(actor);
    run.recovery_archived_at = now;
    run.recovery_archived_by_admin_id = adminId;
    run.recovery_archive_reason = archiveReason;
    run.recovery_archive_request_id = shortText(requestId, 200) || null;
    await run.save(session ? { session } : undefined);

    await createAudit(AuditModel, {
      entity_type: "GENERATION_RUN",
      entity_id: run._id,
      generation_run_id: run._id,
      action: "GENERATION_FAILURE_ARCHIVED",
      action_status: "SUCCEEDED",
      actor_type: "ADMIN",
      actor_admin_id: adminId,
      actor_label: "Pink Paisa administrator",
      summary: "An administrator dismissed a terminal generation failure from the actionable recovery queue; the run and its evidence remain retained.",
      field_changes: [{
        field_path: "recovery_archived_at",
        before: null,
        after: now,
        is_redacted: false,
      }],
      request_id: shortText(requestId, 200) || null,
      source_ip_hash: sourceIpHash(ip),
      metadata: {
        archive_reason: archiveReason,
        failure_status: status,
        failure_code: run.last_error?.code || null,
        evidence_preserved: true,
        evidence_retention_policy: "append_only_no_automatic_purge",
      },
    }, session);
    return { run, reused: false };
  });
}

module.exports = {
  TERMINAL_GENERATION_STATUSES,
  archiveGenerationFailure,
};
