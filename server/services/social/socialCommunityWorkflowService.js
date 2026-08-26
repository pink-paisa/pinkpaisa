const crypto = require("crypto");
const mongoose = require("mongoose");
const os = require("os");
const SocialAuditLog = require("../../models/SocialAuditLog");
const SocialCommunityItem = require("../../models/SocialCommunityItem");
const SocialManualAction = require("../../models/SocialManualAction");

const SENDABLE_SOURCE_TYPES = new Set(["COMMENT", "REPLY", "MESSAGE", "DIRECT_MESSAGE", "PRIVATE_REPLY"]);
const SENSITIVE_INCOMING_TEXT = /\b(?:complaint|fraud|scam|harass(?:ment)?|threat|self[-\s]?harm|suicid(?:e|al)|doctor|medical|medicine|medication|diagnos(?:e|is)|treatment|symptom|pregnan(?:t|cy)|which\s+(?:stock|share|fund)|what\s+should\s+i\s+(?:buy|sell|invest)|personal(?:ised|ized)(?:\s+\w+){0,3}\s+(?:advice|recommendation))\b/i;
const PROHIBITED_REPLY = [
  /guaranteed?\s+(?:return|profit|income)/i,
  /you\s+should\s+(?:buy|sell|invest)/i,
  /diagnos(?:e|is)|prescri(?:be|ption)/i,
  /send\s+(?:me|us)\s+your\s+(?:otp|password|pin|account)/i,
];
const RECOMMENDATION_LEASE_MS = 5 * 60 * 1000;
const SEND_LEASE_MS = 2 * 60 * 1000;
const WORKER_ID = `${os.hostname()}:${process.pid}:community`;

function text(value, maximum = 4000) {
  return String(value ?? "").trim().slice(0, maximum);
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

function actorId(actor) {
  return actor?._id || actor?.id || actor?.userId || null;
}

function workflowError(message, statusCode, code, details = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  if (details) error.details = details;
  return error;
}

function assertSafeApprovedReply(reply) {
  const normalized = text(reply, 1201);
  if (!normalized) throw workflowError("A reply is required", 400, "social_community_reply_required");
  if (normalized.length > 1200) throw workflowError("Community replies must be 1,200 characters or fewer", 422, "social_community_reply_too_long");
  if (PROHIBITED_REPLY.some((pattern) => pattern.test(normalized))) {
    throw workflowError("The edited reply failed server-side safety review", 422, "social_community_reply_unsafe");
  }
  return normalized;
}

function assertAdminNotes(value, operation) {
  const normalized = text(value, 2001);
  if (!normalized) throw workflowError(`${operation} notes are required`, 400, "social_community_notes_required");
  if (normalized.length > 2000) throw workflowError(`${operation} notes must be 2,000 characters or fewer`, 422, "social_community_notes_too_long");
  return normalized;
}

function assertAuthoritativeExternalReplyId(value, item) {
  const externalReplyId = text(value, 301);
  if (!externalReplyId) {
    throw workflowError(
      "A confirmed Meta reply or message identifier is required",
      400,
      "social_community_external_reply_id_required",
    );
  }
  if (externalReplyId.length > 300 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(externalReplyId)) {
    throw workflowError(
      "The Meta reply or message identifier is invalid",
      422,
      "social_community_external_reply_id_invalid",
    );
  }
  if ([item?.author_external_id, item?.external_object_id]
    .filter(Boolean)
    .some((identifier) => String(identifier) === externalReplyId)) {
    throw workflowError(
      "A recipient or incoming-object identifier is not authoritative confirmation of the sent reply",
      422,
      "social_community_external_reply_id_not_authoritative",
    );
  }
  return externalReplyId;
}

function initialCommunityWorkflow({ sourceType, message, now = new Date() } = {}) {
  const normalizedSourceType = text(sourceType, 80).toUpperCase();
  const normalizedMessage = text(message, 4000);
  let reason = null;
  if (!SENDABLE_SOURCE_TYPES.has(normalizedSourceType)) {
    reason = `${normalizedSourceType || "This event type"} does not support a safe direct API reply.`;
  } else if (!normalizedMessage) {
    reason = "The incoming event contains no usable message, so a safe reply cannot be drafted.";
  } else if (SENSITIVE_INCOMING_TEXT.test(normalizedMessage)) {
    reason = "Deterministic safety screening detected a complaint, sensitive issue, medical context, or personalised financial request.";
  }
  if (reason) {
    return {
      status: "ESCALATED",
      classification: "ESCALATION_REQUIRED",
      risk: { level: "HIGH", flags: ["deterministic_ingestion_escalation"], rationale: reason },
      risk_flags: ["deterministic_ingestion_escalation"],
      escalation: { required: true, reason, recommended_at: now },
      recommendation_job: null,
    };
  }
  return {
    status: "RECOMMENDATION_QUEUED",
    classification: null,
    risk: null,
    risk_flags: [],
    escalation: { required: false },
    recommendation_job: {
      status: "QUEUED",
      queued_at: now,
      attempt_count: 0,
    },
  };
}

function publicSendIntent(sendIntent) {
  if (!sendIntent) return null;
  const value = typeof sendIntent.toObject === "function" ? sendIntent.toObject() : { ...sendIntent };
  delete value.claim_token;
  delete value.claimed_by;
  return value;
}

function applySession(query, session) {
  return session && query && typeof query.session === "function" ? query.session(session) : query;
}

async function createRecords(Model, records, session) {
  if (!session) return Model.create(records.length === 1 ? records[0] : records);
  return Model.create(records, { session });
}

async function runMongoTransaction(dependencies, work) {
  if (dependencies.mongoSession) return work(dependencies.mongoSession);
  const startSession = dependencies.startSession
    || (mongoose.connection?.readyState === 1 && typeof mongoose.startSession === "function"
      ? () => mongoose.startSession()
      : null);
  if (!startSession) return work(null);
  const session = await startSession();
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

async function appendAudits(records, dependencies, session = null) {
  const AuditModel = dependencies.SocialAuditLog || SocialAuditLog;
  if (!AuditModel?.create || !records.length) return [];
  return createRecords(AuditModel, records, session);
}

async function queueCommunityReplyIntent(itemId, {
  actor,
  reply = null,
  idempotencyKey = null,
  now = new Date(),
  dependencies = {},
  requireExistingApproval = false,
} = {}) {
  const CommunityModel = dependencies.SocialCommunityItem || SocialCommunityItem;
  const adminId = actorId(actor);
  if (!adminId) throw workflowError("An authenticated administrator is required", 401, "social_admin_required");

  return runMongoTransaction(dependencies, async (session) => {
    const item = await applySession(CommunityModel.findById(itemId), session);
    if (!item) throw workflowError("Community item not found", 404, "social_community_item_not_found");
    if (item.status === "SENT") return { item, reused: true, send_intent: null };
    const replyForIntent = reply != null
      ? reply
      : item.send_intent || requireExistingApproval
        ? item.approval?.approved_reply
        : item.recommendation?.suggestedReply;
    const approvedReply = assertSafeApprovedReply(replyForIntent);
    const approvedReplyChecksum = sha256(approvedReply);
    const requestToken = text(idempotencyKey, 400) || `derived:${approvedReplyChecksum}`;
    const scopedIdempotencyKey = `community-approve-send:${String(item._id)}:${sha256(requestToken)}`;

    if (item.send_intent) {
      if (item.send_intent.idempotency_key !== scopedIdempotencyKey
        || item.send_intent.approved_reply_checksum !== approvedReplyChecksum) {
        throw workflowError(
          "This community item already has a different durable send intent",
          409,
          "social_community_send_intent_conflict",
        );
      }
      return { item, reused: true, send_intent: publicSendIntent(item.send_intent) };
    }
    if (requireExistingApproval && (item.status !== "APPROVED" || item.approval?.status !== "APPROVED")) {
      throw workflowError("Human approval is required before queuing a community reply", 409, "social_community_not_approved");
    }
    if (!requireExistingApproval && item.status !== "NEEDS_REVIEW") {
      throw workflowError("Only a safe reply awaiting review can be approved and sent", 409, "social_community_not_reviewable");
    }
    if (!item.recommendation || item.recommendation.sendAllowedAfterApproval !== true || item.escalation?.required === true) {
      throw workflowError("This community recommendation is not safe to send", 409, "social_community_reply_blocked");
    }
    if (!SENDABLE_SOURCE_TYPES.has(text(item.source_type, 80).toUpperCase())) {
      throw workflowError(`Replies for ${item.source_type || "this source"} require manual handling`, 409, "social_manual_action_required");
    }
    if (requireExistingApproval && item.approval?.approved_reply_checksum !== approvedReplyChecksum) {
      throw workflowError("The approved community reply checksum no longer matches", 409, "social_community_reply_checksum_mismatch");
    }

    const providerIdempotencyKey = `pinkpaisa-community-${sha256(`${item._id}:${approvedReplyChecksum}`).slice(0, 48)}`;
    if (!requireExistingApproval) {
      item.approval = {
        status: "APPROVED",
        approved_by_admin_id: adminId,
        approved_at: now,
        approved_reply: approvedReply,
        approved_reply_checksum: approvedReplyChecksum,
      };
    }
    item.send_intent = {
      status: "QUEUED",
      idempotency_key: scopedIdempotencyKey,
      approved_reply_checksum: approvedReplyChecksum,
      provider_idempotency_key: providerIdempotencyKey,
      queued_at: now,
      attempt_count: 0,
    };
    item.status = "SEND_QUEUED";
    await item.save(session ? { session } : undefined);

    const auditBase = {
      entity_type: "COMMUNITY_ITEM",
      entity_id: item._id,
      action_status: "SUCCEEDED",
      actor_type: "ADMIN",
      actor_admin_id: adminId,
      actor_label: "Pink Paisa administrator",
    };
    await appendAudits([
      ...(!requireExistingApproval ? [{
        ...auditBase,
        idempotency_key: `${scopedIdempotencyKey}:approved`,
        action: "COMMUNITY_REPLY_APPROVED",
        summary: "An administrator approved the exact community reply; it has not been sent yet.",
        metadata: { approved_reply_checksum: approvedReplyChecksum },
      }] : []),
      {
        ...auditBase,
        idempotency_key: `${scopedIdempotencyKey}:queued`,
        action: "COMMUNITY_SEND_QUEUED",
        summary: "The approved community reply was durably queued for provider delivery.",
        metadata: { approved_reply_checksum: approvedReplyChecksum, provider_idempotency_key: providerIdempotencyKey },
      },
    ], dependencies, session);
    return { item, reused: false, send_intent: publicSendIntent(item.send_intent) };
  });
}

async function approveAndQueueCommunityReply(itemId, options = {}) {
  return queueCommunityReplyIntent(itemId, { ...options, requireExistingApproval: false });
}

async function queueApprovedCommunityReply(itemId, options = {}) {
  return queueCommunityReplyIntent(itemId, { ...options, requireExistingApproval: true });
}

async function createManualAction({ item, kind, error, now, dependencies, session = null }) {
  const ActionModel = dependencies.SocialManualAction || SocialManualAction;
  if (!ActionModel?.findOneAndUpdate) return null;
  const uncertain = kind === "SEND_UNCERTAIN";
  const keySuffix = uncertain
    ? item.send_intent?.approved_reply_checksum?.slice(0, 16) || "unknown"
    : item.recommendation_job?.attempt_count || 1;
  const actionKey = `social-community-${uncertain ? "send-reconciliation" : "recommendation-failure"}:${item._id}:${keySuffix}`;
  return ActionModel.findOneAndUpdate(
    { action_key: actionKey },
    {
      $setOnInsert: {
        action_key: actionKey,
        action_type: "COMMUNITY_REPLY",
        status: "OPEN",
        priority: uncertain ? "CRITICAL" : "HIGH",
        title: uncertain ? "Reconcile an uncertain Instagram reply" : "Resolve failed AI community reply drafting",
        description: uncertain
          ? `Provider delivery may have occurred for community item ${item._id}, but no confirmed reply identifier was recorded. Do not retry blindly.`
          : `AI reply drafting failed for community item ${item._id}: ${text(error?.message || error, 1200)}`,
        instructions: uncertain
          ? [
            "Inspect the Instagram conversation and provider logs for the exact approved reply before taking any send action.",
            "If the exact reply exists, record its authoritative Meta reply or message identifier through the reconciliation action.",
            "If delivery cannot be confirmed, leave this action open and escalate for provider investigation. Do not send or retry the reply blindly.",
          ]
          : [
            "Review the Community Inbox item and OpenAI connection health, then retry drafting only after the cause is resolved.",
            "Do not write or send a response outside the human-review workflow.",
          ],
        provider: uncertain ? "INSTAGRAM" : "OPENAI",
        community_item_id: item._id,
        external_reference_id: item.external_object_id || String(item._id),
        due_at: now,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true, ...(session ? { session } : {}) },
  );
}

function communitySendReconciliationActionKey(item) {
  const suffix = item?.send_intent?.approved_reply_checksum?.slice(0, 16) || "unknown";
  return `social-community-send-reconciliation:${item?._id}:${suffix}`;
}

async function reconcileUncertainCommunitySend(itemId, {
  actor,
  externalReplyId,
  notes,
  now = new Date(),
  dependencies = {},
} = {}) {
  const adminId = actorId(actor);
  if (!adminId) throw workflowError("An authenticated administrator is required", 401, "social_admin_required");
  const rawReconciliationNotes = text(notes, 2001);
  if (rawReconciliationNotes.length > 2000) {
    throw workflowError("Reconciliation notes must be 2,000 characters or fewer", 422, "social_community_notes_too_long");
  }
  const reconciliationNotes = rawReconciliationNotes
    || "Administrator confirmed the exact approved reply in Meta using the recorded external reply identifier.";
  const CommunityModel = dependencies.SocialCommunityItem || SocialCommunityItem;
  const ActionModel = dependencies.SocialManualAction || SocialManualAction;

  return runMongoTransaction(dependencies, async (session) => {
    const item = await applySession(CommunityModel.findById(itemId), session);
    if (!item) throw workflowError("Community item not found", 404, "social_community_item_not_found");
    const authoritativeReplyId = assertAuthoritativeExternalReplyId(externalReplyId, item);
    if (item.status === "SENT") {
      if (item.send_result?.external_reply_id !== authoritativeReplyId) {
        throw workflowError(
          "This community reply was already reconciled with a different provider identifier",
          409,
          "social_community_reconciliation_conflict",
        );
      }
      return {
        item,
        reused: true,
        manual_action: item.send_intent?.reconciliation_manual_action_id
          ? { _id: item.send_intent.reconciliation_manual_action_id }
          : null,
      };
    }
    if (item.status !== "SEND_UNCERTAIN" || item.send_intent?.status !== "UNCERTAIN") {
      throw workflowError(
        "Only an uncertain provider send outcome can be reconciled",
        409,
        "social_community_send_not_uncertain",
      );
    }
    if (item.approval?.status !== "APPROVED"
      || !item.approval?.approved_by_admin_id
      || !item.approval?.approved_reply_checksum
      || item.approval.approved_reply_checksum !== item.send_intent.approved_reply_checksum) {
      throw workflowError(
        "The durable approval record is incomplete or no longer matches the send intent",
        409,
        "social_community_reply_checksum_mismatch",
      );
    }

    const reconciliationError = workflowError(
      item.send_intent?.last_error_message || "The provider send outcome was uncertain",
      409,
      item.send_intent?.last_error_code || "INSTAGRAM_REPLY_OUTCOME_UNCONFIRMED",
    );
    const action = await createManualAction({
      item,
      kind: "SEND_UNCERTAIN",
      error: reconciliationError,
      now,
      dependencies,
      session,
    });
    const actionKey = communitySendReconciliationActionKey(item);
    if (!action || typeof ActionModel.findOneAndUpdate !== "function") {
      throw workflowError(
        "The durable reconciliation action is unavailable",
        503,
        "social_community_reconciliation_action_unavailable",
      );
    }
    const completedAction = await ActionModel.findOneAndUpdate(
      { action_key: actionKey, status: { $in: ["OPEN", "IN_PROGRESS"] } },
      {
        $set: {
          status: "COMPLETED",
          completed_at: now,
          completed_by_admin_id: adminId,
          completion_source: "ADMIN",
          resolution_note: reconciliationNotes,
          resolution_evidence: {
            resolver: "COMMUNITY_SEND",
            entity_type: "COMMUNITY_ITEM",
            entity_id: String(item._id),
            observed_status: "SENT",
            provider_reference_id: authoritativeReplyId,
            observed_at: now,
          },
        },
      },
      { new: true, runValidators: true, ...(session ? { session } : {}) },
    );
    if (!completedAction) {
      throw workflowError(
        "The durable reconciliation action could not be completed",
        409,
        "social_community_reconciliation_action_conflict",
      );
    }

    item.status = "SENT";
    item.send_intent.status = "CONFIRMED";
    item.send_intent.confirmed_at = now;
    item.send_intent.reconciled_at = now;
    item.send_intent.reconciled_by_admin_id = adminId;
    item.send_intent.reconciliation_manual_action_id = completedAction?._id || completedAction?.id;
    item.send_intent.reconciliation_external_reply_id = authoritativeReplyId;
    item.send_intent.reconciliation_notes = reconciliationNotes;
    item.send_intent.lease_expires_at = null;
    item.send_intent.last_error_code = null;
    item.send_intent.last_error_message = null;
    item.send_result = {
      external_reply_id: authoritativeReplyId,
      sent_at: now,
      sent_by_admin_id: item.approval.approved_by_admin_id,
      confirmation_source: "ADMIN_RECONCILIATION",
      confirmed_by_admin_id: adminId,
    };
    await item.save(session ? { session } : undefined);

    await appendAudits([{
      idempotency_key: `community-send-reconciled:${item._id}:${authoritativeReplyId}`.slice(0, 400),
      entity_type: "COMMUNITY_ITEM",
      entity_id: item._id,
      action: "COMMUNITY_SEND_RECONCILED",
      action_status: "SUCCEEDED",
      actor_type: "ADMIN",
      actor_admin_id: adminId,
      actor_label: "Pink Paisa administrator",
      summary: "An administrator confirmed the exact approved reply in Meta using an authoritative reply identifier; no provider send was retried.",
      metadata: {
        external_reply_id: authoritativeReplyId,
        approved_reply_checksum: item.approval.approved_reply_checksum,
        manual_action_id: completedAction?._id || completedAction?.id || null,
        reconciliation_notes: reconciliationNotes,
      },
    }], dependencies, session);
    return { item, reused: false, manual_action: completedAction };
  });
}

async function acknowledgeCommunityEscalation(itemId, {
  actor,
  notes,
  now = new Date(),
  dependencies = {},
} = {}) {
  const adminId = actorId(actor);
  if (!adminId) throw workflowError("An authenticated administrator is required", 401, "social_admin_required");
  const acknowledgementNotes = assertAdminNotes(notes, "Acknowledgement");
  const CommunityModel = dependencies.SocialCommunityItem || SocialCommunityItem;
  return runMongoTransaction(dependencies, async (session) => {
    const item = await applySession(CommunityModel.findById(itemId), session);
    if (!item) throw workflowError("Community item not found", 404, "social_community_item_not_found");
    if (!item.escalation?.required || item.status !== "ESCALATED") {
      throw workflowError("Only an active escalated community item can be acknowledged", 409, "social_community_escalation_not_active");
    }
    if (item.escalation.resolved_at) {
      throw workflowError("This escalation has already been resolved", 409, "social_community_escalation_already_resolved");
    }
    if (item.escalation.acknowledged_at) {
      if (item.escalation.acknowledgement_notes !== acknowledgementNotes) {
        throw workflowError("This escalation was already acknowledged with different notes", 409, "social_community_escalation_acknowledgement_conflict");
      }
      return { item, reused: true };
    }
    item.escalation.acknowledged_by_admin_id = adminId;
    item.escalation.acknowledged_at = now;
    item.escalation.acknowledgement_notes = acknowledgementNotes;
    await item.save(session ? { session } : undefined);
    await appendAudits([{
      idempotency_key: `community-escalation-acknowledged:${item._id}`,
      entity_type: "COMMUNITY_ITEM",
      entity_id: item._id,
      action: "COMMUNITY_ESCALATION_ACKNOWLEDGED",
      action_status: "SUCCEEDED",
      actor_type: "ADMIN",
      actor_admin_id: adminId,
      actor_label: "Pink Paisa administrator",
      summary: "An administrator acknowledged the community escalation; no reply was approved or sent.",
      metadata: { notes: acknowledgementNotes },
    }], dependencies, session);
    return { item, reused: false };
  });
}

async function resolveCommunityEscalation(itemId, {
  actor,
  notes,
  now = new Date(),
  dependencies = {},
} = {}) {
  const adminId = actorId(actor);
  if (!adminId) throw workflowError("An authenticated administrator is required", 401, "social_admin_required");
  const resolutionNotes = assertAdminNotes(notes, "Resolution");
  const CommunityModel = dependencies.SocialCommunityItem || SocialCommunityItem;
  return runMongoTransaction(dependencies, async (session) => {
    const item = await applySession(CommunityModel.findById(itemId), session);
    if (!item) throw workflowError("Community item not found", 404, "social_community_item_not_found");
    if (item.escalation?.resolved_at) {
      if (item.escalation.resolution_notes !== resolutionNotes) {
        throw workflowError("This escalation was already resolved with different notes", 409, "social_community_escalation_resolution_conflict");
      }
      return { item, reused: true };
    }
    if (!item.escalation?.required || item.status !== "ESCALATED") {
      throw workflowError("Only an active escalated community item can be resolved", 409, "social_community_escalation_not_active");
    }
    if (!item.escalation.acknowledged_at || !item.escalation.acknowledged_by_admin_id) {
      throw workflowError("The escalation must be acknowledged before it can be resolved", 409, "social_community_escalation_acknowledgement_required");
    }
    item.escalation.resolved_by_admin_id = adminId;
    item.escalation.resolved_at = now;
    item.escalation.resolution_notes = resolutionNotes;
    item.status = "ARCHIVED";
    await item.save(session ? { session } : undefined);
    await appendAudits([{
      idempotency_key: `community-escalation-resolved:${item._id}`,
      entity_type: "COMMUNITY_ITEM",
      entity_id: item._id,
      action: "COMMUNITY_ESCALATION_RESOLVED",
      action_status: "SUCCEEDED",
      actor_type: "ADMIN",
      actor_admin_id: adminId,
      actor_label: "Pink Paisa administrator",
      summary: "An administrator resolved and archived the escalated community item; no reply was approved or sent.",
      metadata: { notes: resolutionNotes },
    }], dependencies, session);
    return { item, reused: false };
  });
}

async function markRecommendationFailure(item, claimToken, error, now, dependencies) {
  const CommunityModel = dependencies.SocialCommunityItem || SocialCommunityItem;
  const updated = await CommunityModel.findOneAndUpdate(
    { _id: item._id, status: "RECOMMENDATION_PROCESSING", "recommendation_job.claimed_by": claimToken },
    {
      $set: {
        status: "FAILED",
        "recommendation_job.status": "FAILED",
        "recommendation_job.lease_expires_at": null,
        "recommendation_job.last_error_code": text(error?.code || "COMMUNITY_RECOMMENDATION_FAILED", 200),
        "recommendation_job.last_error_message": text(error?.message || error, 2000),
      },
    },
    { new: true, runValidators: true },
  );
  if (updated) await createManualAction({ item: updated, kind: "RECOMMENDATION_FAILED", error, now, dependencies });
  return updated;
}

async function markUnsafeRecommendationEscalated(item, claimToken, error, now, dependencies) {
  const CommunityModel = dependencies.SocialCommunityItem || SocialCommunityItem;
  const reason = "AI reply output failed deterministic safety review and requires specialist handling; no reply was approved or sent.";
  const updated = await CommunityModel.findOneAndUpdate(
    { _id: item._id, status: "RECOMMENDATION_PROCESSING", "recommendation_job.claimed_by": claimToken },
    {
      $set: {
        status: "ESCALATED",
        classification: "ESCALATION_REQUIRED",
        escalation: { required: true, reason, recommended_at: now },
        risk: { level: "HIGH", flags: ["unsafe_ai_reply"], rationale: reason },
        risk_flags: ["unsafe_ai_reply"],
        "recommendation_job.status": "FAILED",
        "recommendation_job.lease_expires_at": null,
        "recommendation_job.last_error_code": text(error?.code || "SOCIAL_COMMUNITY_REPLY_UNSAFE", 200),
        "recommendation_job.last_error_message": text(error?.message || error, 2000),
      },
    },
    { new: true, runValidators: true },
  );
  if (updated) await createManualAction({ item: updated, kind: "RECOMMENDATION_FAILED", error, now, dependencies });
  return updated;
}

async function markSendUncertain(item, claimToken, error, now, dependencies) {
  return runMongoTransaction(dependencies, async (session) => {
    const CommunityModel = dependencies.SocialCommunityItem || SocialCommunityItem;
    const query = CommunityModel.findOneAndUpdate(
      { _id: item._id, status: "SEND_PROCESSING", "send_intent.claim_token": claimToken },
      {
        $set: {
          status: "SEND_UNCERTAIN",
          "send_intent.status": "UNCERTAIN",
          "send_intent.uncertain_at": now,
          "send_intent.lease_expires_at": null,
          "send_intent.last_error_code": text(error?.code || "INSTAGRAM_REPLY_OUTCOME_UNCONFIRMED", 200),
          "send_intent.last_error_message": text(error?.message || error, 2000),
        },
      },
      { new: true, runValidators: true, ...(session ? { session } : {}) },
    );
    const updated = await query;
    if (!updated) return null;
    const action = await createManualAction({ item: updated, kind: "SEND_UNCERTAIN", error, now, dependencies, session });
    await appendAudits([{
      entity_type: "COMMUNITY_ITEM",
      entity_id: updated._id,
      action: "COMMUNITY_SEND_OUTCOME_UNCERTAIN",
      action_status: "FAILED",
      actor_type: "WORKER",
      actor_label: "Community delivery worker",
      summary: "The provider outcome could not be confirmed; automatic retries are blocked and reconciliation is required.",
      error_code: text(error?.code || "INSTAGRAM_REPLY_OUTCOME_UNCONFIRMED", 200),
      error_message: text(error?.message || error, 2000),
      metadata: { manual_action_id: action?._id || action?.id || null, approved_reply_checksum: updated.approval?.approved_reply_checksum },
    }], dependencies, session);
    return updated;
  });
}

async function deliverClaimedReply(item, dependencies) {
  const instagram = dependencies.instagramGrowthService || require("../instagramGrowthService");
  const message = assertSafeApprovedReply(item.approval?.approved_reply);
  if (sha256(message) !== item.approval?.approved_reply_checksum
    || item.approval?.approved_reply_checksum !== item.send_intent?.approved_reply_checksum) {
    throw workflowError("The approved reply checksum no longer matches the durable send intent", 409, "social_community_reply_checksum_mismatch");
  }
  const common = { message, idempotencyKey: item.send_intent.provider_idempotency_key, dependencies };
  if (["COMMENT", "REPLY"].includes(item.source_type)) {
    return instagram.replyToComment({ ...common, commentId: item.external_object_id });
  }
  if (item.source_type === "PRIVATE_REPLY") {
    return instagram.sendPrivateReply({
      ...common,
      commentId: item.external_object_id,
      permissionContext: { commentCreatedAt: item.occurred_at },
    });
  }
  return instagram.sendMessage({
    ...common,
    recipientId: item.author_external_id,
    permissionContext: { conversationInitiatedByRecipient: true, recipientInitiatedAt: item.occurred_at },
  });
}

async function processCommunityWorkflow({ now = new Date(), limit = 20, settings = null, dependencies = {} } = {}) {
  const CommunityModel = dependencies.SocialCommunityItem || SocialCommunityItem;
  const safeLimit = Math.min(Math.max(Number(limit || 20), 1), 100);
  const result = { drafted: 0, sent: 0, uncertain: 0, failed: 0, failures: [] };
  if (settings?.community?.enabled === false) return { ...result, skipped: "community_disabled" };

  for (let index = 0; index < safeLimit; index += 1) {
    const recovered = await CommunityModel.findOneAndUpdate(
      {
        status: "RECOMMENDATION_PROCESSING",
        "recommendation_job.status": "PROCESSING",
        "recommendation_job.lease_expires_at": { $lte: now },
      },
      {
        $set: {
          status: "RECOMMENDATION_QUEUED",
          "recommendation_job.status": "QUEUED",
          "recommendation_job.claimed_at": null,
          "recommendation_job.claimed_by": null,
          "recommendation_job.lease_expires_at": null,
          "recommendation_job.last_error_code": "COMMUNITY_RECOMMENDATION_LEASE_EXPIRED",
          "recommendation_job.last_error_message": "The prior AI drafting worker lease expired before a recommendation was persisted.",
        },
      },
      { new: true, sort: { "recommendation_job.lease_expires_at": 1 }, runValidators: true },
    );
    if (!recovered) break;
  }

  for (let index = 0; index < safeLimit; index += 1) {
    const claimToken = `${WORKER_ID}:recommend:${crypto.randomUUID()}`;
    const claimed = await CommunityModel.findOneAndUpdate(
      { status: "RECOMMENDATION_QUEUED", "recommendation_job.status": "QUEUED" },
      {
        $set: {
          status: "RECOMMENDATION_PROCESSING",
          "recommendation_job.status": "PROCESSING",
          "recommendation_job.claimed_at": now,
          "recommendation_job.claimed_by": claimToken,
          "recommendation_job.lease_expires_at": new Date(now.getTime() + RECOMMENDATION_LEASE_MS),
          "recommendation_job.last_error_code": null,
          "recommendation_job.last_error_message": null,
        },
        $inc: { "recommendation_job.attempt_count": 1 },
      },
      { new: true, sort: { occurred_at: 1, created_at: 1 }, runValidators: true },
    );
    if (!claimed) break;
    try {
      const recommender = dependencies.recommendCommunityReply
        || require("./socialGrowthTeamService").recommendCommunityReply;
      const recommended = await recommender(claimed._id, { actor: null, dependencies });
      if (recommended?.recommendation_job && recommended.recommendation_job.status !== "COMPLETED") {
        recommended.recommendation_job.status = "COMPLETED";
        recommended.recommendation_job.completed_at = now;
        recommended.recommendation_job.lease_expires_at = null;
        await recommended.save();
      }
      result.drafted += 1;
    } catch (error) {
      result.failed += 1;
      const failed = error?.code === "social_community_reply_unsafe"
        ? await markUnsafeRecommendationEscalated(claimed, claimToken, error, now, dependencies)
        : await markRecommendationFailure(claimed, claimToken, error, now, dependencies);
      result.failures.push({
        item_id: String(claimed._id),
        operation: "DRAFT_REPLY",
        code: error?.code || "COMMUNITY_RECOMMENDATION_FAILED",
        message: text(error?.message || error, 500),
        durability: failed ? "PERSISTED" : "PERSISTENCE_FAILED",
      });
    }
  }

  for (let index = 0; index < safeLimit; index += 1) {
    const claimToken = `${WORKER_ID}:send:${crypto.randomUUID()}`;
    const claimed = await CommunityModel.findOneAndUpdate(
      { status: "SEND_QUEUED", "send_intent.status": "QUEUED" },
      {
        $set: {
          status: "SEND_PROCESSING",
          "send_intent.status": "PROCESSING",
          "send_intent.claimed_at": now,
          "send_intent.claimed_by": WORKER_ID,
          "send_intent.claim_token": claimToken,
          "send_intent.lease_expires_at": new Date(now.getTime() + SEND_LEASE_MS),
        },
        $inc: { "send_intent.attempt_count": 1 },
      },
      { new: true, sort: { occurred_at: 1, created_at: 1 }, runValidators: true },
    );
    if (!claimed) break;
    let providerCalled = false;
    try {
      providerCalled = true;
      const providerResult = await deliverClaimedReply(claimed, dependencies);
      const externalReplyId = text(
        providerResult?.id
        || providerResult?.reply_id
        || providerResult?.replyId
        || providerResult?.message_id
        || providerResult?.messageId,
        300,
      );
      if (!externalReplyId) throw workflowError("Meta did not return a reply identifier", 502, "instagram_reply_outcome_unconfirmed");
      const confirmed = await CommunityModel.findOneAndUpdate(
        { _id: claimed._id, status: "SEND_PROCESSING", "send_intent.claim_token": claimToken },
        {
          $set: {
            status: "SENT",
            send_result: { external_reply_id: externalReplyId, sent_at: now, sent_by_admin_id: claimed.approval.approved_by_admin_id },
            "send_intent.status": "CONFIRMED",
            "send_intent.confirmed_at": now,
            "send_intent.lease_expires_at": null,
            "send_intent.last_error_code": null,
            "send_intent.last_error_message": null,
          },
        },
        { new: true, runValidators: true },
      );
      if (!confirmed) throw workflowError("The community send claim was lost before confirmation", 409, "social_community_send_claim_lost");
      await appendAudits([{
        entity_type: "COMMUNITY_ITEM",
        entity_id: confirmed._id,
        action: "COMMUNITY_REPLY_SENT",
        action_status: "SUCCEEDED",
        actor_type: "WORKER",
        actor_label: "Community delivery worker",
        summary: "Meta confirmed the approved community reply and returned a provider identifier.",
        metadata: { external_reply_id: externalReplyId, approved_reply_checksum: confirmed.approval?.approved_reply_checksum },
      }], dependencies);
      result.sent += 1;
    } catch (error) {
      const uncertain = await markSendUncertain(claimed, claimToken, error, now, dependencies);
      result.uncertain += uncertain ? 1 : 0;
      result.failed += 1;
      result.failures.push({
        item_id: String(claimed._id),
        operation: "SEND_APPROVED_REPLY",
        code: error?.code || "INSTAGRAM_REPLY_OUTCOME_UNCONFIRMED",
        message: text(error?.message || error, 500),
        durability: uncertain ? "PERSISTED" : "PERSISTENCE_FAILED",
        provider_called: providerCalled,
        retry_blocked: true,
      });
    }
  }

  for (let index = 0; index < safeLimit; index += 1) {
    const expired = await CommunityModel.findOneAndUpdate(
      { status: "SEND_PROCESSING", "send_intent.status": "PROCESSING", "send_intent.lease_expires_at": { $lte: now } },
      { $set: { "send_intent.last_error_code": "COMMUNITY_SEND_LEASE_EXPIRED" } },
      { new: true, sort: { "send_intent.lease_expires_at": 1 } },
    );
    if (!expired) break;
    const reconciled = await markSendUncertain(
      expired,
      expired.send_intent?.claim_token,
      workflowError("The worker lease expired after provider delivery may have started", 502, "community_send_lease_expired"),
      now,
      dependencies,
    );
    if (reconciled) result.uncertain += 1;
  }
  return result;
}

module.exports = {
  acknowledgeCommunityEscalation,
  approveAndQueueCommunityReply,
  initialCommunityWorkflow,
  processCommunityWorkflow,
  publicSendIntent,
  queueApprovedCommunityReply,
  reconcileUncertainCommunitySend,
  resolveCommunityEscalation,
  _private: {
    assertAuthoritativeExternalReplyId,
    assertSafeApprovedReply,
    communitySendReconciliationActionKey,
    deliverClaimedReply,
    markUnsafeRecommendationEscalated,
    markSendUncertain,
    sha256,
  },
};
