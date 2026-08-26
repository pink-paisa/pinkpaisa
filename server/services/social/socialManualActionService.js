const mongoose = require("mongoose");
const SocialAuditLog = require("../../models/SocialAuditLog");
const SocialCommunityItem = require("../../models/SocialCommunityItem");
const SocialManualAction = require("../../models/SocialManualAction");
const SocialPublication = require("../../models/SocialPublication");

const ALLOWED_STATUSES = new Set(SocialManualAction.ACTION_STATUSES || ["OPEN", "IN_PROGRESS", "COMPLETED", "CANCELLED"]);
const ALLOWED_TYPES = new Set(SocialManualAction.ACTION_TYPES || []);
const ALLOWED_PRIORITIES = new Set(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
const TERMINAL_STATUSES = new Set(["COMPLETED", "CANCELLED"]);
const PRIORITY_RANK = Object.freeze({ LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 });
const TRANSITIONS = Object.freeze({
  OPEN: new Set(["IN_PROGRESS", "COMPLETED", "CANCELLED"]),
  IN_PROGRESS: new Set(["COMPLETED", "CANCELLED"]),
});

function trimText(value) {
  return String(value || "").trim();
}

function actorId(actor) {
  return actor?._id || actor?.id || null;
}

function asObject(value) {
  return value?.toObject ? value.toObject() : value;
}

function applySession(query, session) {
  return session && query && typeof query.session === "function" ? query.session(session) : query;
}

async function createRecord(Model, record, session) {
  if (!session) return Model.create(record);
  const created = await Model.create([record], { session });
  return Array.isArray(created) ? created[0] : created;
}

async function runInMongoTransaction(dependencies, work) {
  if (dependencies.mongoSession) return work(dependencies.mongoSession);
  const startSession = dependencies.startSession
    || (mongoose.connection?.readyState === 1 && typeof mongoose.startSession === "function"
      ? () => mongoose.startSession()
      : null);
  if (!startSession) return work(null);
  const session = await startSession();
  try {
    let result;
    await session.withTransaction(async () => { result = await work(session); });
    return result;
  } finally {
    await session.endSession();
  }
}

function compareManualActions(left, right) {
  const priorityDifference = (PRIORITY_RANK[String(right.priority || "MEDIUM").toUpperCase()] || 0)
    - (PRIORITY_RANK[String(left.priority || "MEDIUM").toUpperCase()] || 0);
  if (priorityDifference) return priorityDifference;
  const statusDifference = String(left.status || "").localeCompare(String(right.status || ""));
  if (statusDifference) return statusDifference;
  const leftDueAt = left.due_at ? new Date(left.due_at).getTime() : Number.POSITIVE_INFINITY;
  const rightDueAt = right.due_at ? new Date(right.due_at).getTime() : Number.POSITIVE_INFINITY;
  if (leftDueAt !== rightDueAt) return leftDueAt - rightDueAt;
  return new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime();
}

function castAggregateIds(query) {
  const casted = { ...query };
  for (const field of ["draft_id", "weekly_plan_id"]) {
    if (typeof casted[field] === "string" && mongoose.Types.ObjectId.isValid(casted[field])) {
      casted[field] = new mongoose.Types.ObjectId(casted[field]);
    }
  }
  return casted;
}

function publicManualAction(action) {
  const value = asObject(action);
  if (!value) return null;
  return {
    id: String(value._id || value.id || ""),
    action_key: value.action_key,
    action_type: value.action_type,
    status: value.status,
    priority: value.priority,
    title: value.title,
    description: value.description,
    instructions: Array.isArray(value.instructions) ? value.instructions : [],
    provider: value.provider || null,
    weekly_plan_id: value.weekly_plan_id ? String(value.weekly_plan_id) : null,
    generation_run_id: value.generation_run_id ? String(value.generation_run_id) : null,
    draft_id: value.draft_id ? String(value.draft_id) : null,
    publication_id: value.publication_id ? String(value.publication_id) : null,
    community_item_id: value.community_item_id ? String(value.community_item_id) : null,
    connection_health_id: value.connection_health_id ? String(value.connection_health_id) : null,
    external_reference_id: value.external_reference_id || null,
    assigned_to_admin_id: value.assigned_to_admin_id ? String(value.assigned_to_admin_id) : null,
    due_at: value.due_at || null,
    started_at: value.started_at || null,
    completed_at: value.completed_at || null,
    completed_by_admin_id: value.completed_by_admin_id ? String(value.completed_by_admin_id) : null,
    completion_source: value.completion_source || "ADMIN",
    resolution_note: value.resolution_note || null,
    resolution_evidence: value.resolution_evidence || null,
    cancelled_at: value.cancelled_at || null,
    cancellation_reason: value.cancellation_reason || null,
    created_at: value.created_at || null,
    updated_at: value.updated_at || null,
  };
}

function errorWith(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function normalizedFilter(value, allowed, label) {
  const rows = String(value || "")
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
  if (!rows.length) return null;
  const invalid = rows.find((item) => !allowed.has(item));
  if (invalid) throw errorWith(`${label} contains unsupported value ${invalid}`, "social_manual_action_filter_invalid");
  return [...new Set(rows)];
}

async function assertDedicatedReconciliationEndpoint(action, nextStatus, dependencies, session) {
  if (!["COMPLETED", "CANCELLED"].includes(nextStatus)) return;
  const actionKey = String(action.action_key || "");
  const communityKey = actionKey.startsWith("social-community-send-reconciliation:");
  const publicationKey = /^social-publish-reconciliation:.+:outcome-uncertain$/.test(actionKey);
  let uncertainCommunity = false;
  let uncertainPublication = false;
  if (!communityKey && action.community_item_id) {
    const CommunityModel = dependencies.SocialCommunityItem || SocialCommunityItem;
    const item = await applySession(CommunityModel.findById(action.community_item_id), session);
    uncertainCommunity = item?.status === "SEND_UNCERTAIN" || item?.send_intent?.status === "UNCERTAIN";
  }
  if (!publicationKey && action.publication_id && action.action_type === "PUBLISH_RECONCILIATION") {
    const PublicationModel = dependencies.SocialPublication || SocialPublication;
    const publication = await applySession(PublicationModel.findById(action.publication_id), session);
    uncertainPublication = publication?.status === "UNCERTAIN";
  }
  if (communityKey || uncertainCommunity) {
    throw errorWith(
      "This uncertain community-send action can close only through POST /admin/community/:id/reconcile with an authoritative Meta reply identifier",
      "social_manual_action_dedicated_reconciliation_required",
      409,
    );
  }
  if (publicationKey || uncertainPublication) {
    throw errorWith(
      "This uncertain publication action can close only through POST /admin/publications/:id/reconcile with an authoritative Meta media identifier",
      "social_manual_action_dedicated_reconciliation_required",
      409,
    );
  }
}

async function listManualActions(filters = {}, { dependencies = {} } = {}) {
  const ActionModel = dependencies.SocialManualAction || SocialManualAction;
  const query = {};
  const statuses = normalizedFilter(filters.status, ALLOWED_STATUSES, "status");
  const types = normalizedFilter(filters.action_type || filters.actionType, ALLOWED_TYPES, "action_type");
  const priorities = normalizedFilter(filters.priority, ALLOWED_PRIORITIES, "priority");
  if (statuses) query.status = { $in: statuses };
  if (types) query.action_type = { $in: types };
  if (priorities) query.priority = { $in: priorities };
  if (trimText(filters.draft_id || filters.draftId)) query.draft_id = trimText(filters.draft_id || filters.draftId);
  if (trimText(filters.weekly_plan_id || filters.weeklyPlanId)) query.weekly_plan_id = trimText(filters.weekly_plan_id || filters.weeklyPlanId);
  const limit = Math.min(Math.max(Number(filters.limit || 100), 1), 200);
  let rows;
  if (typeof ActionModel.aggregate === "function") {
    rows = await ActionModel.aggregate([
      { $match: castAggregateIds(query) },
      {
        $addFields: {
          __priority_rank: {
            $switch: {
              branches: [
                { case: { $eq: ["$priority", "CRITICAL"] }, then: 4 },
                { case: { $eq: ["$priority", "HIGH"] }, then: 3 },
                { case: { $eq: ["$priority", "MEDIUM"] }, then: 2 },
                { case: { $eq: ["$priority", "LOW"] }, then: 1 },
              ],
              default: 0,
            },
          },
        },
      },
      { $sort: { __priority_rank: -1, status: 1, due_at: 1, created_at: -1 } },
      { $limit: limit },
      { $project: { __priority_rank: 0 } },
    ]);
  } else {
    const found = ActionModel.find(query);
    const lean = typeof found?.lean === "function" ? found.lean() : found;
    rows = [...(await lean || [])].sort(compareManualActions).slice(0, limit);
  }
  return { items: rows.map(publicManualAction), total: rows.length, limit };
}

async function getManualAction(actionId, { dependencies = {} } = {}) {
  const ActionModel = dependencies.SocialManualAction || SocialManualAction;
  const action = await ActionModel.findById(actionId);
  if (!action) throw errorWith("Manual action not found", "social_manual_action_not_found", 404);
  return publicManualAction(action);
}

async function updateManualAction(actionId, input = {}, { actor, now = new Date(), requestId = null, dependencies = {} } = {}) {
  const ActionModel = dependencies.SocialManualAction || SocialManualAction;
  const AuditModel = dependencies.SocialAuditLog || SocialAuditLog;
  const adminId = actorId(actor);
  if (!adminId) throw errorWith("An administrator identity is required", "social_manual_action_admin_required", 403);
  const nextStatus = trimText(input.status).toUpperCase();
  if (!nextStatus || !ALLOWED_STATUSES.has(nextStatus)) {
    throw errorWith("status must be IN_PROGRESS, COMPLETED, or CANCELLED", "social_manual_action_status_invalid");
  }
  const resolution = trimText(input.resolution_note || input.resolutionNote);
  const cancellationReason = trimText(input.cancellation_reason || input.cancellationReason);

  return runInMongoTransaction(dependencies, async (session) => {
    const action = await applySession(ActionModel.findById(actionId), session);
    if (!action) throw errorWith("Manual action not found", "social_manual_action_not_found", 404);
    const previousStatus = String(action.status || "OPEN").toUpperCase();
    if (previousStatus === nextStatus) return publicManualAction(action);
    if (TERMINAL_STATUSES.has(previousStatus) || !TRANSITIONS[previousStatus]?.has(nextStatus)) {
      throw errorWith(`A ${previousStatus} manual action cannot transition to ${nextStatus}`, "social_manual_action_transition_invalid", 409);
    }
    await assertDedicatedReconciliationEndpoint(action, nextStatus, dependencies, session);
    if (nextStatus === "COMPLETED" && !resolution) {
      throw errorWith("resolution_note is required to complete a manual action", "social_manual_action_resolution_required");
    }
    if (nextStatus === "CANCELLED" && !cancellationReason) {
      throw errorWith("cancellation_reason is required to cancel a manual action", "social_manual_action_cancellation_required");
    }

    if (nextStatus === "IN_PROGRESS") {
      action.status = nextStatus;
      action.started_at = action.started_at || now;
      action.assigned_to_admin_id = action.assigned_to_admin_id || adminId;
    } else if (nextStatus === "COMPLETED") {
      action.status = nextStatus;
      action.started_at = action.started_at || now;
      action.completed_at = now;
      action.completed_by_admin_id = adminId;
      action.completion_source = "ADMIN";
      action.resolution_evidence = null;
      action.resolution_note = resolution.slice(0, 4000);
    } else {
      action.status = nextStatus;
      action.cancelled_at = now;
      action.cancelled_by_admin_id = adminId;
      action.cancellation_reason = cancellationReason.slice(0, 2000);
    }
    await action.save(session ? { session } : undefined);
    if (AuditModel?.create) {
      await createRecord(AuditModel, {
        entity_type: "MANUAL_ACTION",
        entity_id: action._id,
        generation_run_id: action.generation_run_id || null,
        draft_id: action.draft_id || null,
        publication_id: action.publication_id || null,
        action: `MANUAL_ACTION_${nextStatus}`,
        action_status: "SUCCEEDED",
        actor_type: "ADMIN",
        actor_admin_id: adminId,
        actor_label: "Pink Paisa administrator",
        summary: `Manual action moved from ${previousStatus} to ${nextStatus}.`,
        field_changes: [{ field_path: "status", before: previousStatus, after: nextStatus, is_redacted: false }],
        request_id: requestId || null,
        metadata: { action_type: action.action_type, priority: action.priority, completion_source: nextStatus === "COMPLETED" ? "ADMIN" : null },
      }, session);
    }
    return publicManualAction(action);
  });
}

module.exports = {
  assertDedicatedReconciliationEndpoint,
  getManualAction,
  listManualActions,
  publicManualAction,
  updateManualAction,
};
