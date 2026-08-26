const mongoose = require("mongoose");
const SocialAuditLog = require("../../models/SocialAuditLog");
const SocialAudioTrack = require("../../models/SocialAudioTrack");
const SocialCommunityItem = require("../../models/SocialCommunityItem");
const SocialConnectionHealth = require("../../models/SocialConnectionHealth");
const SocialGenerationRun = require("../../models/SocialGenerationRun");
const SocialManualAction = require("../../models/SocialManualAction");
const SocialPostDraft = require("../../models/SocialPostDraft");
const SocialPublication = require("../../models/SocialPublication");
const SocialWeeklyPlan = require("../../models/SocialWeeklyPlan");

const OPEN_STATUSES = new Set(["OPEN", "IN_PROGRESS"]);
const USABLE_AUDIO_LICENSES = new Set(["OWNED", "LICENSED", "PUBLIC_DOMAIN", "ADMIN_APPROVED"]);

function asObject(value) {
  return value?.toObject ? value.toObject({ virtuals: false }) : value;
}

function normalized(value) {
  return String(value || "").trim().toUpperCase();
}

async function resolveQuery(query, { lean = false } = {}) {
  if (lean && typeof query?.lean === "function") return query.lean();
  return query;
}

async function findById(Model, id) {
  if (!id || typeof Model?.findById !== "function") return null;
  return resolveQuery(Model.findById(id), { lean: true });
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

function evidence({ resolver, entityType, entityId, observedStatus, providerReferenceId = null, now }) {
  return {
    resolver,
    entity_type: entityType,
    entity_id: String(entityId),
    observed_status: observedStatus,
    provider_reference_id: providerReferenceId ? String(providerReferenceId).slice(0, 400) : null,
    observed_at: now,
  };
}

async function generationResolution(action, now, models) {
  if (!String(action.action_key || "").startsWith("social-prepublication-failure:")) return null;
  let runId = action.generation_run_id || null;
  if (!runId && action.weekly_plan_id && action.external_reference_id) {
    const plan = asObject(await findById(models.SocialWeeklyPlan, action.weekly_plan_id));
    const selected = (plan?.selected_posts || []).find((item) => (
      String(item.candidateId || item.candidate_id || "") === String(action.external_reference_id)
    ));
    runId = selected?.generation_run_id || null;
  }
  const run = asObject(await findById(models.SocialGenerationRun, runId));
  if (normalized(run?.status) !== "SUCCEEDED" || !(run?.selected_draft_id || run?.failed_draft_id)) return null;
  const draftId = run.selected_draft_id || run.failed_draft_id;
  if (!run.selected_draft_id) return null;
  return {
    note: "The linked weekly creative generation completed successfully and produced a reviewable draft.",
    evidence: evidence({
      resolver: "GENERATION_RUN",
      entityType: "GENERATION_RUN",
      entityId: run._id || runId,
      observedStatus: "SUCCEEDED",
      providerReferenceId: draftId,
      now,
    }),
  };
}

async function connectionResolution(action, now, models) {
  if (normalized(action.action_type) !== "ACCOUNT_RECONNECT" || !action.connection_health_id) return null;
  const connection = asObject(await findById(models.SocialConnectionHealth, action.connection_health_id));
  if (normalized(connection?.status) !== "CONNECTED" || connection?.configured !== true) return null;
  return {
    note: "The linked provider connection is configured and its latest authoritative health state is CONNECTED.",
    evidence: evidence({
      resolver: "CONNECTION_HEALTH",
      entityType: "CONNECTION_HEALTH",
      entityId: connection._id || action.connection_health_id,
      observedStatus: "CONNECTED",
      providerReferenceId: connection.latest_check?.check_key || null,
      now,
    }),
  };
}

async function publicationResolution(action, now, models) {
  if (normalized(action.action_type) !== "PUBLISH_RECONCILIATION") return null;
  let publicationId = action.publication_id || null;
  if (!publicationId && action.draft_id) {
    const draft = asObject(await findById(models.SocialPostDraft, action.draft_id));
    publicationId = draft?.publication_id || null;
  }
  const publication = asObject(await findById(models.SocialPublication, publicationId));
  if (normalized(publication?.status) !== "PUBLISHED" || !String(publication?.external_publication_id || "").trim()) return null;
  if (String(action.action_key || "").startsWith("social-published-media-enrichment:")
    && !String(publication.external_permalink || "").trim()) return null;
  return {
    note: "The linked Instagram publication is confirmed PUBLISHED with a provider media identifier.",
    evidence: evidence({
      resolver: "PUBLICATION",
      entityType: "PUBLICATION",
      entityId: publication._id || publicationId,
      observedStatus: "PUBLISHED",
      providerReferenceId: publication.external_publication_id,
      now,
    }),
  };
}

async function communityResolution(action, now, models) {
  if (normalized(action.action_type) !== "COMMUNITY_REPLY" || !action.community_item_id) return null;
  const item = asObject(await findById(models.SocialCommunityItem, action.community_item_id));
  const replyId = item?.send_result?.external_reply_id;
  if (normalized(item?.status) !== "SENT" || !String(replyId || "").trim()) return null;
  return {
    note: "The linked community reply is confirmed SENT with a Meta reply identifier.",
    evidence: evidence({
      resolver: "COMMUNITY_SEND",
      entityType: "COMMUNITY_ITEM",
      entityId: item._id || action.community_item_id,
      observedStatus: "SENT",
      providerReferenceId: replyId,
      now,
    }),
  };
}

async function audioResolution(action, now, models) {
  if (!/^social-(?:reel|video-feed)-audio-rights:/.test(String(action.action_key || "")) || !action.draft_id) return null;
  const draft = asObject(await findById(models.SocialPostDraft, action.draft_id));
  if (!draft?.audio_track_id) return null;
  const track = asObject(await findById(models.SocialAudioTrack, draft.audio_track_id));
  const usable = track
    && track.is_active !== false
    && !track.deactivated_at
    && track.rights_confirmed === true
    && USABLE_AUDIO_LICENSES.has(normalized(track.license_status));
  if (!usable) return null;
  return {
    note: "The linked draft now uses an active audio track with administrator-confirmed usage rights.",
    evidence: evidence({
      resolver: "AUDIO_RIGHTS",
      entityType: "AUDIO_TRACK",
      entityId: track._id || draft.audio_track_id,
      observedStatus: "RIGHTS_CONFIRMED",
      providerReferenceId: track.checksum_sha256 || null,
      now,
    }),
  };
}

async function determineResolution(action, now, models) {
  for (const resolver of [publicationResolution, communityResolution, audioResolution, connectionResolution, generationResolution]) {
    const resolved = await resolver(action, now, models);
    if (resolved) return resolved;
  }
  return null;
}

async function appendSystemAudit(action, resolution, models, previousStatus, session = null) {
  const AuditModel = models.SocialAuditLog;
  if (!AuditModel?.create || !action?._id) return null;
  const record = {
    idempotency_key: `social-manual-action-system-completed:${action._id}`,
    entity_type: "MANUAL_ACTION",
    entity_id: action._id,
    generation_run_id: action.generation_run_id || null,
    draft_id: action.draft_id || null,
    publication_id: action.publication_id || null,
    action: "MANUAL_ACTION_COMPLETED",
    action_status: "SUCCEEDED",
    actor_type: "SYSTEM",
    actor_admin_id: null,
    actor_label: "Social automation resolver",
    summary: "A deterministic authoritative state proved that the linked manual action was resolved.",
    field_changes: [{ field_path: "status", before: previousStatus, after: "COMPLETED", is_redacted: false }],
    metadata: { action_type: action.action_type, priority: action.priority, completion_source: "SYSTEM", resolution_evidence: resolution.evidence },
  };
  try {
    if (!session) return await AuditModel.create(record);
    const created = await AuditModel.create([record], { session });
    return Array.isArray(created) ? created[0] : created;
  } catch (error) {
    if (error?.code === 11000) return null;
    throw error;
  }
}

async function resolveDeterministicManualActions({ now = new Date(), limit = 100, dependencies = {} } = {}) {
  const models = {
    SocialAuditLog: dependencies.SocialAuditLog || SocialAuditLog,
    SocialAudioTrack: dependencies.SocialAudioTrack || SocialAudioTrack,
    SocialCommunityItem: dependencies.SocialCommunityItem || SocialCommunityItem,
    SocialConnectionHealth: dependencies.SocialConnectionHealth || SocialConnectionHealth,
    SocialGenerationRun: dependencies.SocialGenerationRun || SocialGenerationRun,
    SocialManualAction: dependencies.SocialManualAction || SocialManualAction,
    SocialPostDraft: dependencies.SocialPostDraft || SocialPostDraft,
    SocialPublication: dependencies.SocialPublication || SocialPublication,
    SocialWeeklyPlan: dependencies.SocialWeeklyPlan || SocialWeeklyPlan,
  };
  const safeLimit = Math.min(Math.max(Number(limit || 100), 1), 200);
  let query = models.SocialManualAction.find({ status: { $in: ["OPEN", "IN_PROGRESS"] } });
  if (typeof query?.sort === "function") query = query.sort({ priority: -1, due_at: 1, created_at: 1 });
  if (typeof query?.limit === "function") query = query.limit(safeLimit);
  const actions = await query;
  const completedIds = [];
  const failures = [];
  for (const action of actions || []) {
    if (!OPEN_STATUSES.has(normalized(action.status))) continue;
    try {
      const resolution = await determineResolution(action, now, models);
      if (!resolution) continue;
      const previousStatus = normalized(action.status);
      action.status = "COMPLETED";
      action.started_at = action.started_at || now;
      action.completed_at = now;
      action.completed_by_admin_id = null;
      action.completion_source = "SYSTEM";
      action.resolution_note = resolution.note;
      action.resolution_evidence = resolution.evidence;
      await runInMongoTransaction(dependencies, async (session) => {
        await action.save(session ? { session } : undefined);
        await appendSystemAudit(action, resolution, models, previousStatus, session);
      });
      completedIds.push(String(action._id || action.id));
    } catch (error) {
      failures.push({ action_id: String(action?._id || action?.id || ""), code: error?.code || "social_manual_action_auto_resolution_failed" });
    }
  }
  return {
    scanned: (actions || []).length,
    completed: completedIds.length,
    completed_action_ids: completedIds,
    failures,
  };
}

module.exports = {
  resolveDeterministicManualActions,
  _private: {
    audioResolution,
    communityResolution,
    connectionResolution,
    determineResolution,
    generationResolution,
    publicationResolution,
  },
};
