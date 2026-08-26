const crypto = require("crypto");
const mongoose = require("mongoose");
const SocialAuditLog = require("../../models/SocialAuditLog");
const SocialCommunityItem = require("../../models/SocialCommunityItem");
const SocialConnectionHealth = require("../../models/SocialConnectionHealth");
const SocialGenerationRun = require("../../models/SocialGenerationRun");
const SocialGrowthSnapshot = require("../../models/SocialGrowthSnapshot");
const SocialManualAction = require("../../models/SocialManualAction");
const SocialMetricSnapshot = require("../../models/SocialMetricSnapshot");
const SocialPostDraft = require("../../models/SocialPostDraft");
const SocialPublication = require("../../models/SocialPublication");
const SocialResearchSource = require("../../models/SocialResearchSource");
const SocialWeeklyPlan = require("../../models/SocialWeeklyPlan");
const { buildSocialManagerRuntimeSettings, getSocialManagerSettings } = require("../../utils/socialManagerSettings");
const { collectInternalSignals } = require("./socialInternalSignals");
const { collectExternalResearch } = require("./socialResearchService");
const { collectSocialGrowthResearchSignals } = require("./socialGrowthResearchAdapters");
const {
  getMetaResearchDesk,
  refreshMetaResearchWatchlists,
} = require("./socialMetaResearchService");
const { sanitizeUntrustedResearchText, trimText } = require("./socialCompliance");
const {
  persistSocialAutomationFailure,
  _private: { safeErrorCode, safeFailureText },
} = require("./socialAutomationFailureService");
const openAiSocialProvider = require("./openAiSocialProvider");
const {
  AUDIENCE_INTELLIGENCE_SCHEMA,
  COMMUNITY_REPLY_RECOMMENDATION_SCHEMA,
  SUPERVISOR_RECOMMENDATION_SCHEMA,
  WEEKLY_ANALYTICS_REVIEW_SCHEMA,
  WEEKLY_CANDIDATES_SCHEMA,
  WEEKLY_PLAN_SCHEMA,
  WEEKLY_RESEARCH_DIGEST_SCHEMA,
  validateWeeklyCandidates,
  validateWeeklyPlan,
} = require("./socialGrowthSchemas");
const {
  configuredWeeklyMaximum,
  isoForIstSlot,
  weekBoundsForDate,
} = require("./socialWeeklyLimit");
const {
  initialCommunityWorkflow,
  processCommunityWorkflow,
  publicSendIntent,
  queueApprovedCommunityReply,
} = require("./socialCommunityWorkflowService");

const DEFAULT_POSTING_SLOTS = Object.freeze([
  { weekday: "TUESDAY", hour_ist: 11, minute_ist: 0 },
  { weekday: "THURSDAY", hour_ist: 11, minute_ist: 0 },
  { weekday: "SATURDAY", hour_ist: 11, minute_ist: 0 },
]);
const ACTIVE_PLAN_STATUSES = new Set(["QUEUED", "RESEARCHING", "PLANNING"]);
const COMMUNITY_SENDABLE_TYPES = new Set(["COMMENT", "REPLY", "MESSAGE", "DIRECT_MESSAGE", "PRIVATE_REPLY"]);
const COMMUNITY_ADMIN_RECOMMENDABLE_STATUSES = new Set(["NEW", "OPEN", "CLASSIFIED", "REPLY_RECOMMENDED"]);
const COMMUNITY_REJECTABLE_STATUSES = new Set(["NEEDS_REVIEW", "REPLY_RECOMMENDED"]);
const COMMUNITY_ESCALATION_CLASSIFICATIONS = new Set([
  "ABUSE",
  "COMPLAINT",
  "ESCALATION_REQUIRED",
  "FINANCIAL_QUESTION",
  "SENSITIVE",
]);
const COMMUNITY_SENSITIVE_TEXT = /\b(?:complaint|fraud|scam|harass(?:ment)?|threat|self[-\s]?harm|suicid(?:e|al)|doctor|medical|medicine|medication|diagnos(?:e|is)|treatment|symptom|pregnan(?:t|cy)|which\s+(?:stock|share|fund)|what\s+should\s+i\s+(?:buy|sell|invest)|personal(?:ised|ized)(?:\s+\w+){0,3}\s+(?:advice|recommendation))\b/i;
const KPI_METRIC_KEYS = Object.freeze({
  REACH: ["reach", "views"],
  NON_FOLLOWER_REACH: ["non_follower_reach"],
  SAVES: ["saves"],
  SHARES: ["shares"],
  MEANINGFUL_COMMENTS: ["meaningful_comments"],
  PROFILE_VISITS: ["profile_visits"],
  FOLLOWER_GROWTH: ["follows"],
  WEBSITE_SESSIONS: ["website_sessions", "landing_page_sessions"],
  ENGAGED_SESSIONS: ["engaged_sessions"],
  QUIZ_STARTS: ["quiz_starts"],
  QUIZ_COMPLETIONS: ["quiz_completions"],
  CALCULATOR_OPENS: ["calculator_opens"],
  WORKSHOP_ENQUIRIES: ["workshop_enquiries"],
  PRODUCT_PAGE_VISITS: ["product_page_visits"],
  AFFILIATE_CLICKS: ["affiliate_clicks", "affiliate_cta_clicks"],
  RETURNING_VISITORS: ["returning_visitors"],
});

function clone(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function asObject(value) {
  if (!value) return null;
  return value.toObject ? value.toObject({ virtuals: false }) : clone(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

function actorId(actor) {
  return actor?._id || actor?.id || actor?.userId || null;
}

function applyMongoSession(query, session) {
  return session && query && typeof query.session === "function" ? query.session(session) : query;
}

async function createWithSession(Model, record, session) {
  if (!session) return Model.create(record);
  const created = await Model.create([record], { session });
  return Array.isArray(created) ? created[0] : created;
}

async function modelExists(Model, filter, session = null) {
  if (typeof Model?.exists !== "function") return false;
  return Boolean(await applyMongoSession(Model.exists(filter), session));
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
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

function publicWeeklyPlan(plan) {
  const value = asObject(plan);
  if (!value) return null;
  return {
    ...value,
    id: String(value._id || value.id || ""),
    max_feed_posts: Number(value.maximum_feed_posts || 3),
    rationale: value.plan_rationale?.final_recommendation || value.supervisor_recommendation?.recommendation || "",
    selected_posts: (value.selected_posts || []).map((selected, index) => ({
      ...(selected.candidate || {}),
      ...selected,
      id: selected.candidateId || selected.candidate_id || `weekly-post-${index + 1}`,
      order: selected.slotNumber || selected.slot_number || index + 1,
      scheduled_for: selected.scheduledFor || selected.scheduled_for || null,
      draft_id: selected.draft_id || null,
      candidate: undefined,
    })),
    _id: undefined,
    __v: undefined,
  };
}

function publicCommunityItem(item) {
  const value = asObject(item);
  if (!value) return null;
  const publicStatus = ({ NEW: "OPEN", NEEDS_REVIEW: "RECOMMENDED", ESCALATED: "ESCALATION_REQUIRED" })[value.status] || value.status;
  const escalationState = !value.escalation?.required
    ? "NONE"
    : value.escalation?.resolved_at
      ? "RESOLVED"
      : value.escalation?.acknowledged_at
        ? "ACKNOWLEDGED"
        : "PENDING";
  return {
    ...value,
    id: String(value._id || value.id || ""),
    status: publicStatus,
    author_label: value.author_label || "Instagram user",
    received_at: value.occurred_at || value.created_at || null,
    escalation_reason: value.escalation?.reason || value.recommendation?.escalationReason || null,
    escalation_state: escalationState,
    escalation_acknowledged_at: value.escalation?.acknowledged_at || null,
    escalation_resolved_at: value.escalation?.resolved_at || null,
    send_intent: publicSendIntent(value.send_intent),
    send_reconciliation: value.send_intent?.reconciled_at ? {
      external_reply_id: value.send_intent.reconciliation_external_reply_id || value.send_result?.external_reply_id || null,
      reconciled_at: value.send_intent.reconciled_at,
      reconciled_by_admin_id: value.send_intent.reconciled_by_admin_id || null,
      manual_action_id: value.send_intent.reconciliation_manual_action_id || null,
      notes: value.send_intent.reconciliation_notes || null,
    } : null,
    available_actions: {
      approve_and_send: value.status === "NEEDS_REVIEW"
        && value.recommendation?.sendAllowedAfterApproval === true
        && value.escalation?.required !== true,
      reconcile_send: value.status === "SEND_UNCERTAIN" && value.send_intent?.status === "UNCERTAIN",
      acknowledge_escalation: value.status === "ESCALATED"
        && value.escalation?.required === true
        && !value.escalation?.acknowledged_at,
      resolve_escalation: value.status === "ESCALATED"
        && value.escalation?.required === true
        && Boolean(value.escalation?.acknowledged_at)
        && !value.escalation?.resolved_at,
    },
    _id: undefined,
    author_external_id: undefined,
    raw_payload: undefined,
    __v: undefined,
  };
}

function promptRun(stage, result) {
  return {
    agent_role: stage.toUpperCase(),
    stage,
    provider: result?.provider || "openai",
    model: result?.model || null,
    prompt_version: result?.prompt_version || null,
    input_context_checksum: result?.input_fingerprint || null,
    output_checksum: result?.output_fingerprint || null,
    response_id: result?.response_id || null,
    usage: clone(result?.usage || {}),
    start_time: result?.started_at || null,
    completion_time: result?.completed_at || null,
    retry_count: Math.max(Number(result?.attempt_count || 1) - 1, 0),
    failure_reason: null,
  };
}

function planPromptRuns(results = []) {
  return results.filter((entry) => entry?.result).map((entry) => promptRun(entry.stage, entry.result));
}

async function persistVersionedPromptRuns(promptRuns, actor, dependencies = {}) {
  const ensurePromptVersions = dependencies.ensurePromptVersions
    || require("./socialManagerService")._private.ensurePromptVersions;
  const rows = await ensurePromptVersions({ promptRuns, actor, dependencies });
  const byRuntimeVersion = new Map(rows.map((row) => [
    `${row.promptRun?.stage || ""}:${row.promptRun?.prompt_version || ""}`,
    row.document,
  ]));
  const hydrated = promptRuns.map((run) => {
    const document = byRuntimeVersion.get(`${run.stage || ""}:${run.prompt_version || ""}`);
    if (!document?._id) {
      const error = new Error(`Prompt-version persistence did not resolve ${run.stage || "unknown stage"}`);
      error.code = "social_prompt_version_missing";
      throw error;
    }
    return { ...run, prompt_version_id: document._id };
  });
  return {
    promptRuns: hydrated,
    promptVersionIds: [...new Set(hydrated.map((run) => String(run.prompt_version_id)))],
  };
}

function configuredPostingSlots(settings = {}) {
  const supplied = settings.weekly_planning?.posting_slots || settings.weekly?.posting_slots;
  const rows = Array.isArray(supplied) && supplied.length ? supplied : DEFAULT_POSTING_SLOTS;
  return rows
    .map((slot) => ({
      weekday: String(slot.weekday || slot.day || "").trim().toUpperCase(),
      hour_ist: Math.min(Math.max(Number(slot.hour_ist ?? slot.hour ?? 11), 0), 23),
      minute_ist: Math.min(Math.max(Number(slot.minute_ist ?? slot.minute ?? 0), 0), 59),
    }))
    .filter((slot) => ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"].includes(slot.weekday))
    .slice(0, 7);
}

function resolvePlanningWindow(now, settings) {
  const maximum = configuredWeeklyMaximum(settings);
  const slotConfiguration = configuredPostingSlots(settings);
  let bounds = weekBoundsForDate(now, { planNextWeekOnSunday: true });
  let slots = slotConfiguration.map((slot, index) => ({
    slotNumber: index + 1,
    ...slot,
    scheduledFor: isoForIstSlot(bounds.week_start, slot.weekday, slot.hour_ist, slot.minute_ist),
  }));
  const viable = slots.filter((slot) => new Date(slot.scheduledFor).getTime() > now.getTime());
  if (viable.length < Math.min(maximum, slotConfiguration.length)) {
    bounds = weekBoundsForDate(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000));
    slots = slotConfiguration.map((slot, index) => ({
      slotNumber: index + 1,
      ...slot,
      scheduledFor: isoForIstSlot(bounds.week_start, slot.weekday, slot.hour_ist, slot.minute_ist),
    }));
  }
  return { ...bounds, maximum, slots };
}

function normalizeExternalSources(externalResearch, now) {
  const rows = Array.isArray(externalResearch?.sources) ? externalResearch.sources : [];
  return rows.map((source) => {
    const location = trimText(source.url || source.normalized_url || source.sourceUrl);
    if (!location) return null;
    return {
      sourceId: trimText(source.source_key || source.id) || null,
      title: sanitizeUntrustedResearchText(source.title || source.sourceTitle || location, 300),
      location,
      publisher: sanitizeUntrustedResearchText(source.publisher || source.domain || "Unknown publisher", 200),
      publicationDate: source.published_at || source.publishedAt || null,
      accessDate: new Date(source.accessed_at || source.accessedAt || now).toISOString(),
      claimSupported: sanitizeUntrustedResearchText(source.claim_supported || source.claimSupported || source.summary || "Research signal", 700),
      confidence: Math.min(Math.max(Number(source.confidence ?? 0.5), 0), 1),
      freshness: ["CURRENT", "RECENT", "EVERGREEN", "STALE", "UNKNOWN"].includes(String(source.freshness || "").toUpperCase())
        ? String(source.freshness).toUpperCase()
        : "UNKNOWN",
      evidenceLevel: source.validation_status === "VALID" || source.is_safe_to_use === true ? "VERIFIED" : "WEAK",
    };
  }).filter(Boolean).slice(0, 29);
}

function buildSourceCatalogue(externalResearch, internalSignals, now) {
  return [
    {
      sourceId: "pink_paisa_production_database",
      title: "Pink Paisa production database",
      location: "pinkpaisa://production-database",
      publisher: "Pink Paisa",
      publicationDate: null,
      accessDate: now.toISOString(),
      claimSupported: `Active internal truth and priorities: ${JSON.stringify(internalSignals.summary || {})}`.slice(0, 700),
      confidence: 1,
      freshness: "CURRENT",
      evidenceLevel: "VERIFIED",
    },
    ...normalizeExternalSources(externalResearch, now),
  ];
}

function mergeExternalResearch(primary = {}, modular = {}) {
  const sourceMap = new Map();
  for (const source of [...(primary.sources || []), ...(modular.sources || [])]) {
    const key = trimText(source?.normalized_url || source?.url || source?.source_key);
    if (key && !sourceMap.has(key)) sourceMap.set(key, source);
  }
  const signalMap = new Map();
  for (const signal of [...(primary.signals || []), ...(modular.signals || [])]) {
    const key = trimText(signal?.id || signal?.source_key || sha256(signal));
    if (key && !signalMap.has(key)) signalMap.set(key, signal);
  }
  return {
    ...primary,
    sources: [...sourceMap.values()],
    signals: [...signalMap.values()],
    research_adapter_overview: modular.overview || null,
    research_adapter_results: modular.adapters || [],
    rejected_adapter_results: modular.rejected || [],
  };
}

function metaDeskAsExternalResearch(metaDesk = {}) {
  const sources = (metaDesk.sources || []).map((source, index) => ({
    source_key: `meta-public-pattern-${sha256(source.url || `${source.title}:${index}`).slice(0, 20)}`,
    title: source.title,
    url: source.url,
    publisher: source.publisher || "Instagram",
    published_at: source.published_at || null,
    accessed_at: source.accessed_at || metaDesk.generated_at || null,
    excerpt: source.claim_supported,
    claim_supported: source.claim_supported,
    confidence: Math.min(Number(source.confidence || 0.45), 0.7),
    freshness: source.freshness || "UNKNOWN",
    source_type: "social_trend",
    validation_status: "unconfirmed",
    is_safe_to_use: false,
    prompt_injection_flags: [],
    influenced_decision: false,
  }));
  const summaries = Array.isArray(metaDesk.planning_signals)
    ? metaDesk.planning_signals.map((entry) => ({
      category: entry.observation_type === "HASHTAG_SEARCH" ? "meta_hashtag_pattern" : "meta_business_pattern",
      summary: entry.summary,
    }))
    : [
      ...(metaDesk.hashtag_observations || []).map((summary) => ({ category: "meta_hashtag_pattern", summary })),
      ...(metaDesk.competitor_observations || []).map((summary) => ({ category: "meta_business_pattern", summary })),
    ];
  return {
    sources,
    signals: summaries.map((entry, index) => ({
      id: `meta-pattern-${index + 1}-${sha256(entry.summary).slice(0, 12)}`,
      headline: entry.summary.slice(0, 240),
      summary: entry.summary,
      claim_supported: "Directional public conversation or professional-account pattern observed through the official Meta API.",
      source_key: sources[index]?.source_key || null,
      confidence: 0.45,
      category: entry.category,
      requires_human_review: true,
      eligible_for_automated_decision: false,
    })),
    adapter: { adapter: "meta_official_research", state: metaDesk.status || "NOT_GENERATED" },
  };
}

async function persistWeeklyResearchSources({ plan, externalResearch, now, dependencies = {} }) {
  const SourceModel = dependencies.SocialResearchSource || SocialResearchSource;
  const documents = [];
  for (const source of (externalResearch.sources || []).slice(0, 30)) {
    const recordBuilder = typeof SourceModel.buildPersistenceRecord === "function"
      ? SourceModel.buildPersistenceRecord.bind(SourceModel)
      : SocialResearchSource.buildPersistenceRecord.bind(SocialResearchSource);
    const record = recordBuilder({
      ...clone(source),
      title: source.title || source.publisher || source.url,
      url: source.url || source.normalized_url,
      accessed_at: source.accessed_at || now,
      summary: source.summary || source.excerpt || source.claim_supported || source.title,
      claim_supported: source.claim_supported || source.summary || source.excerpt || source.title,
      confidence: Math.min(Math.max(Number(source.confidence ?? 0.5), 0), 1),
      source_type: source.source_type || "news",
      validation_status: source.validation_status || (source.is_safe_to_use ? "VALID" : "UNCONFIRMED"),
      influenced_decision: false,
      used_in_final: false,
    }, { weekly_plan_id: plan._id });
    if (!record.normalized_url || !record.domain) continue;
    const document = await SourceModel.findOneAndUpdate(
      { idempotency_key: record.idempotency_key },
      { $setOnInsert: record },
      { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true },
    );
    documents.push(document);
  }
  return documents;
}

async function markWeeklyResearchInfluence({ sourceDocuments, researchDigest, candidates, dependencies = {} }) {
  const SourceModel = dependencies.SocialResearchSource || SocialResearchSource;
  const candidateIdsByLocation = new Map();
  for (const candidate of candidates || []) {
    for (const index of candidate.evidenceSourceIndexes || []) {
      const location = researchDigest.sources?.[index]?.location;
      if (!location) continue;
      const ids = candidateIdsByLocation.get(location) || [];
      ids.push(candidate.candidateId);
      candidateIdsByLocation.set(location, ids);
    }
  }
  await Promise.all((sourceDocuments || []).map((document) => {
    const ids = [...new Set(candidateIdsByLocation.get(document.url) || candidateIdsByLocation.get(document.normalized_url) || [])];
    if (!ids.length) return null;
    return SourceModel.updateOne(
      { _id: document._id },
      { $set: { candidate_ids: ids, influenced_decision: true, used_in_final: true } },
    );
  }));
}

function validateWeeklyResearchAgainstCatalogue(output, catalogue) {
  const allowedLocations = new Set(catalogue.map((source) => source.location));
  for (const source of output.sources || []) {
    if (!allowedLocations.has(source.location)) {
      const error = new Error(`Weekly research invented or changed source location ${source.location}`);
      error.code = "structured_output_invalid";
      error.validation_errors = ["$.sources must contain only supplied source locations"];
      throw error;
    }
  }
  for (const [index, topic] of (output.currentTopics || []).entries()) {
    if ((topic.sourceIndexes || []).some((sourceIndex) => sourceIndex < 0 || sourceIndex >= output.sources.length)) {
      const error = new Error(`Weekly research topic ${index} references an unavailable source`);
      error.code = "structured_output_invalid";
      error.validation_errors = [`$.currentTopics[${index}].sourceIndexes is out of range`];
      throw error;
    }
  }
  return output;
}

function aggregateCommunityForAudience(items = []) {
  const counts = {};
  for (const item of items) {
    const key = String(item.classification || "UNCLASSIFIED").toUpperCase();
    counts[key] = Number(counts[key] || 0) + 1;
  }
  return {
    total_items: items.length,
    classification_counts: counts,
    privacy: "Only aggregate counts are supplied; author identifiers and raw messages are excluded.",
  };
}

function knownInternalDestinations(internalSignals, websiteBaseUrl) {
  const groups = [
    internalSignals.products,
    internalSignals.blogs,
    internalSignals.workshops,
    internalSignals.virtual_products,
    internalSignals.pink_pages,
    internalSignals.static_resources,
  ];
  return new Set([
    null,
    websiteBaseUrl,
    ...groups.flatMap((group) => (Array.isArray(group) ? group : []).map((item) => item.landing_page).filter(Boolean)),
  ]);
}

function validateCandidateInternalTruth(result, internalSignals, researchDigest, settings) {
  const validated = validateWeeklyCandidates(result);
  const destinations = knownInternalDestinations(internalSignals, settings.brand_profile?.website_base_url);
  const internalIds = new Set([
    ...(internalSignals.products || []),
    ...(internalSignals.blogs || []),
    ...(internalSignals.workshops || []),
    ...(internalSignals.virtual_products || []),
    ...(internalSignals.polls || []),
    ...(internalSignals.pink_pages || []),
  ].map((item) => String(item.id || "")).filter(Boolean));
  validated.candidates.forEach((candidate, index) => {
    if (!destinations.has(candidate.recommendedLandingPage)) {
      const error = new Error(`Candidate ${candidate.candidateId} uses an inactive or unknown Pink Paisa destination`);
      error.code = "social_destination_not_allowed";
      error.validation_errors = [`$.candidates[${index}].recommendedLandingPage must match an active internal destination`];
      throw error;
    }
    if (candidate.verifiedInternalEntityId && !internalIds.has(candidate.verifiedInternalEntityId)) {
      const error = new Error(`Candidate ${candidate.candidateId} references an unknown internal entity`);
      error.code = "social_internal_fact_not_verified";
      error.validation_errors = [`$.candidates[${index}].verifiedInternalEntityId must match active production data`];
      throw error;
    }
    if (candidate.evidenceSourceIndexes.some((sourceIndex) => sourceIndex >= (researchDigest.sources || []).length)) {
      const error = new Error(`Candidate ${candidate.candidateId} references an unavailable research source`);
      error.code = "structured_output_invalid";
      error.validation_errors = [`$.candidates[${index}].evidenceSourceIndexes is out of range`];
      throw error;
    }
  });
  return validated;
}

function validatePlanSelection(result, candidates, planningWindow) {
  const validated = validateWeeklyPlan(result, candidates, planningWindow.maximum);
  const desiredCount = Math.min(planningWindow.maximum, planningWindow.slots.length, candidates.length);
  if (validated.selectedPosts.length !== desiredCount) {
    const error = new Error(`Weekly plan must select exactly ${desiredCount} posts from the configured slots`);
    error.code = "structured_output_invalid";
    error.validation_errors = [`$.selectedPosts must contain ${desiredCount} items`];
    throw error;
  }
  const allowedSlots = new Map(planningWindow.slots.map((slot) => [slot.slotNumber, slot.scheduledFor]));
  const candidatesById = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
  validated.selectedPosts.forEach((selected, index) => {
    if (allowedSlots.get(selected.slotNumber) !== selected.scheduledFor) {
      const error = new Error(`Selected post ${selected.candidateId} uses a non-configured schedule`);
      error.code = "structured_output_invalid";
      error.validation_errors = [`$.selectedPosts[${index}] must use a supplied slot exactly`];
      throw error;
    }
    if (String(candidatesById.get(selected.candidateId)?.format || "").toUpperCase() === "STORY") {
      const error = new Error(`Selected post ${selected.candidateId} is a Story companion, not a feed publication`);
      error.code = "structured_output_invalid";
      error.validation_errors = [`$.selectedPosts[${index}] cannot select a STORY candidate into a feed slot`];
      throw error;
    }
  });
  const selectedIds = new Set(validated.selectedPosts.map((item) => item.candidateId));
  const rejectedIds = new Set(validated.rejectedCandidateIds);
  if (candidates.some((candidate) => !selectedIds.has(candidate.candidateId) && !rejectedIds.has(candidate.candidateId))) {
    const error = new Error("Every weekly candidate must be selected or rejected explicitly");
    error.code = "structured_output_invalid";
    error.validation_errors = ["$.rejectedCandidateIds must account for all unselected candidates"];
    throw error;
  }
  if ([...selectedIds].some((id) => rejectedIds.has(id))) {
    const error = new Error("A candidate cannot be both selected and rejected");
    error.code = "structured_output_invalid";
    error.validation_errors = ["$.selectedPosts and $.rejectedCandidateIds must not overlap"];
    throw error;
  }
  return validated;
}

async function appendGrowthAudit({ entityType, entityId, action, summary, actor = null, status = "SUCCEEDED", metadata = null, error = null, dependencies = {} }) {
  const AuditModel = dependencies.SocialAuditLog || SocialAuditLog;
  if (!entityId || !AuditModel?.create) return null;
  return createWithSession(AuditModel, {
    entity_type: entityType,
    entity_id: entityId,
    action,
    action_status: status,
    actor_type: actorId(actor) ? "ADMIN" : "SYSTEM",
    actor_admin_id: actorId(actor),
    actor_label: actorId(actor) ? "Pink Paisa administrator" : "Social Growth Team",
    summary,
    error_code: error?.code || null,
    error_message: error?.message || null,
    metadata,
  }, dependencies.mongoSession || null);
}

async function executeWeeklyPlan(planOrId, { now = new Date(), dependencies = {} } = {}) {
  const PlanModel = dependencies.SocialWeeklyPlan || SocialWeeklyPlan;
  const CommunityModel = dependencies.SocialCommunityItem || SocialCommunityItem;
  const GrowthSnapshotModel = dependencies.SocialGrowthSnapshot || SocialGrowthSnapshot;
  const settings = await (dependencies.getSocialManagerSettings || getSocialManagerSettings)();
  const runtimeSettings = (dependencies.buildSocialManagerRuntimeSettings || buildSocialManagerRuntimeSettings)(settings);
  let plan = typeof planOrId === "object" && planOrId?.save
    ? planOrId
    : await PlanModel.findById(planOrId);
  if (!plan) {
    const error = new Error("Weekly social plan not found");
    error.statusCode = 404;
    throw error;
  }
  const planningWindow = {
    week_key: plan.week_key,
    week_start: plan.week_start,
    week_end: plan.week_end,
    timezone: plan.timezone || "Asia/Kolkata",
    maximum: Number(plan.maximum_feed_posts || configuredWeeklyMaximum(settings)),
    slots: clone(plan.config_snapshot?.posting_slots || resolvePlanningWindow(now, settings).slots),
  };
  const completedCalls = [];
  let stage = "RESEARCHING";
  try {
    plan.status = "RESEARCHING";
    plan.generation_started_at = plan.generation_started_at || now;
    plan.generation_error = null;
    await plan.save();

    const internalSignals = await (dependencies.collectInternalSignals || collectInternalSignals)({ now, settings: runtimeSettings, dependencies });
    const [primaryResearch, modularResearch, metaResearchDesk] = await Promise.all([
      (dependencies.collectExternalResearch || collectExternalResearch)({ now, internalSignals, settings: runtimeSettings, dependencies }),
      (dependencies.collectSocialGrowthResearchSignals || collectSocialGrowthResearchSignals)({
        now,
        settings: runtimeSettings,
        dependencies,
        gdeltQuery: dependencies.gdeltQuery || null,
        manualSignals: dependencies.manualResearchSignals || [],
      }),
      (dependencies.getMetaResearchDesk || getMetaResearchDesk)({ now, dependencies }).catch(() => ({
        status: "ERROR",
        summary: "Official Meta watchlist observations were unavailable for this planning run.",
        hashtag_observations: [],
        competitor_observations: [],
        sources: [],
      })),
    ]);
    const metaResearch = metaDeskAsExternalResearch(metaResearchDesk);
    const externalResearch = mergeExternalResearch(primaryResearch, {
      ...modularResearch,
      sources: [...(modularResearch.sources || []), ...metaResearch.sources],
      signals: [...(modularResearch.signals || []), ...metaResearch.signals],
      adapters: [...(modularResearch.adapters || []), metaResearch.adapter],
    });
    const sourceDocuments = await persistWeeklyResearchSources({ plan, externalResearch, now, dependencies });
    plan.research_source_ids = sourceDocuments.map((source) => source._id).filter(Boolean);
    await plan.save();
    const sourceCatalogue = buildSourceCatalogue(externalResearch, internalSignals, now);
    const latestSnapshots = await GrowthSnapshotModel.find({}).sort({ captured_at: -1 }).limit(20).lean();
    let priorGrowthAnalysis = null;
    if (typeof PlanModel.findOne === "function") {
      const priorQuery = PlanModel.findOne({
        _id: { $ne: plan._id },
        growth_analysis: { $ne: null },
        week_start: { $lt: plan.week_start },
      });
      const sortedPrior = typeof priorQuery?.sort === "function" ? priorQuery.sort({ week_start: -1 }) : priorQuery;
      const priorPlan = typeof sortedPrior?.lean === "function" ? await sortedPrior.lean() : await sortedPrior;
      priorGrowthAnalysis = clone(priorPlan?.growth_analysis || null);
    }
    const recentCommunityItems = await CommunityModel.find({ created_at: { $gte: new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000) } })
      .select("classification source_type status")
      .limit(1000)
      .lean();
    const audienceAggregates = aggregateCommunityForAudience(recentCommunityItems);
    const inputContext = {
      planning_window: planningWindow,
      internal_signals: internalSignals,
      external_research: {
        mode: externalResearch.mode,
        evidence_gap_reason: externalResearch.evidence_gap_reason || null,
        signals: clone(externalResearch.signals || []),
        unconfirmed_topics: clone(externalResearch.unconfirmed_topics || []),
        adapter_results: clone(externalResearch.research_adapter_results || []),
        rejected_adapter_result_count: (externalResearch.rejected_adapter_results || []).length,
      },
      source_catalogue: sourceCatalogue,
      aggregate_growth_snapshots: latestSnapshots,
      prior_growth_analysis: priorGrowthAnalysis,
      aggregate_community: audienceAggregates,
      privacy: "No personal customer data is included.",
    };
    plan.input_context_checksum = sha256(inputContext);

    const weeklyResearchResult = await (dependencies.callStructuredResponse || openAiSocialProvider.callStructuredResponse)({
      stage: "weekly_research",
      input: {
        weekStart: planningWindow.week_start,
        weekEnd: planningWindow.week_end,
        timezone: "Asia/Kolkata",
        internalSignals,
        externalSignals: inputContext.external_research,
        suppliedSources: sourceCatalogue,
      },
      schema: WEEKLY_RESEARCH_DIGEST_SCHEMA,
      settings: runtimeSettings,
      fetchImpl: dependencies.fetchImpl || fetch,
      validateOutput: (output) => validateWeeklyResearchAgainstCatalogue(output, sourceCatalogue),
      maxOutputTokens: 14000,
    });
    completedCalls.push({ stage: "weekly_research", result: weeklyResearchResult });
    const researchDigest = weeklyResearchResult.output;
    plan.research_digest = researchDigest;
    await plan.save();

    const audienceResult = await (dependencies.callStructuredResponse || openAiSocialProvider.callStructuredResponse)({
      stage: "audience_intelligence",
      input: {
        weekStart: planningWindow.week_start,
        aggregateCommunity: audienceAggregates,
        aggregateGrowthSnapshots: latestSnapshots,
        priorGrowthAnalysis,
        internalPerformance: internalSignals.performance_summary || [],
        affiliatePerformance: internalSignals.affiliate_performance_30d || [],
        researchDigest,
        privacy: "Aggregate-only. Do not infer individuals or include personal data.",
      },
      schema: AUDIENCE_INTELLIGENCE_SCHEMA,
      settings: runtimeSettings,
      fetchImpl: dependencies.fetchImpl || fetch,
      maxOutputTokens: 12000,
    });
    completedCalls.push({ stage: "audience_intelligence", result: audienceResult });
    const audienceIntelligence = audienceResult.output;
    plan.audience_intelligence = audienceIntelligence;
    plan.status = "PLANNING";
    await plan.save();
    stage = "PLANNING";

    const candidateResult = await (dependencies.callStructuredResponse || openAiSocialProvider.callStructuredResponse)({
      stage: "weekly_candidates",
      input: {
        requestedCandidateCount: Math.min(Math.max(Number(settings.weekly_planning?.candidate_count || 8), 8), 12),
        researchDigest,
        audienceIntelligence,
        activeInternalTruth: internalSignals,
        priorLearning: {
          aggregateSnapshots: latestSnapshots,
          previousGrowthAnalysis: priorGrowthAnalysis,
          rejectedDrafts: (internalSignals.recent_history || [])
            .filter((item) => item.status === "REJECTED" && item.rejection_reason)
            .map((item) => ({ topic: item.primaryRecommendation?.topic || null, rejection_reason: item.rejection_reason }))
            .slice(0, 30),
        },
        configuredFormats: settings.weekly_planning?.enabled_formats || undefined,
        weeklyMaximum: planningWindow.maximum,
        suppliedSources: researchDigest.sources,
      },
      schema: WEEKLY_CANDIDATES_SCHEMA,
      settings: runtimeSettings,
      fetchImpl: dependencies.fetchImpl || fetch,
      validateOutput: (output) => validateCandidateInternalTruth(output, internalSignals, researchDigest, settings),
      maxOutputTokens: 18000,
    });
    completedCalls.push({ stage: "weekly_candidates", result: candidateResult });
    const candidates = candidateResult.output.candidates;
    plan.candidates = candidates;
    await plan.save();

    const weeklyPlanResult = await (dependencies.callStructuredResponse || openAiSocialProvider.callStructuredResponse)({
      stage: "weekly_plan",
      input: {
        weekStart: planningWindow.week_start,
        weekEnd: planningWindow.week_end,
        timezone: "Asia/Kolkata",
        weeklyMaximum: planningWindow.maximum,
        candidateIdeas: candidates,
        allowedPostingSlots: planningWindow.slots,
        audienceIntelligence,
        priorGrowthAnalysis,
        researchEvidenceLimitations: researchDigest.evidenceGaps,
        selectionRules: {
          selectedItemsMustBeFeedPublications: true,
          storyCandidatesMayBeCompanionsOnly: true,
          companionStoriesEnabled: settings.weekly_planning?.companion_stories_enabled === true,
        },
      },
      schema: WEEKLY_PLAN_SCHEMA,
      settings: runtimeSettings,
      fetchImpl: dependencies.fetchImpl || fetch,
      validateOutput: (output) => validatePlanSelection(output, candidates, planningWindow),
      maxOutputTokens: 12000,
    });
    completedCalls.push({ stage: "weekly_plan", result: weeklyPlanResult });
    const weeklyPlan = weeklyPlanResult.output;

    const supervisorResult = await (dependencies.callStructuredResponse || openAiSocialProvider.callStructuredResponse)({
      stage: "supervisor",
      input: {
        researchDigest,
        audienceIntelligence,
        candidates,
        weeklyPlan,
        priorGrowthAnalysis,
        operationalRules: {
          humanApprovalRequired: true,
          weeklyMaximum: planningWindow.maximum,
          mayPublish: false,
          noDeterministicContentFallback: true,
        },
      },
      schema: SUPERVISOR_RECOMMENDATION_SCHEMA,
      settings: runtimeSettings,
      fetchImpl: dependencies.fetchImpl || fetch,
      maxOutputTokens: 7000,
    });
    completedCalls.push({ stage: "supervisor", result: supervisorResult });
    if (supervisorResult.output.readiness === "BLOCKED") {
      const error = new Error("The Social Growth Supervisor blocked the weekly plan because required evidence or data is missing");
      error.code = "social_weekly_plan_supervisor_blocked";
      error.details = supervisorResult.output;
      throw error;
    }

    const versionedPrompts = await persistVersionedPromptRuns(
      planPromptRuns(completedCalls),
      plan.requested_by_admin_id,
      dependencies,
    );
    plan.selected_posts = weeklyPlan.selectedPosts.map((selected) => {
      const candidate = candidates.find((item) => item.candidateId === selected.candidateId);
      const planned = {
        ...selected,
        candidate: clone(candidate),
        status: "PLANNED",
        generation_run_id: null,
        draft_id: null,
      };
      freezeSelectedVisualMode(planned, candidate, settings, dependencies);
      return planned;
    });
    plan.config_snapshot = {
      ...(plan.config_snapshot || {}),
      default_visual_mode: settings.generation?.default_visual_mode || "AI_VISUAL_WITH_EXACT_OVERLAY",
    };
    plan.plan_rationale = {
      format_balance: weeklyPlan.formatBalance,
      objective_balance: weeklyPlan.objectiveBalance,
      promotional_balance: weeklyPlan.promotionalBalance,
      evidence_limitations: weeklyPlan.evidenceLimitations,
      final_recommendation: weeklyPlan.finalRecommendation,
    };
    plan.supervisor_recommendation = supervisorResult.output;
    plan.prompt_runs = versionedPrompts.promptRuns;
    plan.prompt_version_ids = versionedPrompts.promptVersionIds;
    plan.output_checksum = sha256({
      research_digest: researchDigest,
      audience_intelligence: audienceIntelligence,
      candidates,
      weekly_plan: weeklyPlan,
      supervisor_recommendation: supervisorResult.output,
    });
    plan.status = "NEEDS_REVIEW";
    plan.generation_completed_at = new Date();
    await plan.save();
    await markWeeklyResearchInfluence({ sourceDocuments, researchDigest, candidates, dependencies });
    await appendGrowthAudit({
      entityType: "WEEKLY_PLAN",
      entityId: plan._id,
      action: "WEEKLY_PLAN_GENERATED",
      summary: `The independent AI team generated ${candidates.length} candidates and selected ${plan.selected_posts.length} for human review.`,
      metadata: { week_start: plan.week_start, maximum_feed_posts: plan.maximum_feed_posts, input_context_checksum: plan.input_context_checksum },
      dependencies,
    });
    return plan;
  } catch (error) {
    plan.prompt_runs = planPromptRuns(completedCalls);
    plan.status = stage === "RESEARCHING" ? "FAILED_RESEARCH" : "FAILED_GENERATION";
    plan.generation_error = {
      stage,
      code: error.code || "social_weekly_plan_failed",
      message: trimText(error.message).slice(0, 2000),
      occurred_at: new Date(),
      validation_errors: Array.isArray(error.validation_errors) ? error.validation_errors.slice(0, 20) : [],
    };
    plan.generation_completed_at = new Date();
    await plan.save().catch(() => null);
    await appendGrowthAudit({
      entityType: "WEEKLY_PLAN",
      entityId: plan._id,
      action: "WEEKLY_PLAN_FAILED",
      summary: `Weekly plan generation failed visibly during ${stage}.`,
      status: "FAILED",
      error,
      metadata: { stage },
      dependencies,
    }).catch(() => null);
    throw error;
  }
}

async function requestWeeklyPlan({ actor = null, now = new Date(), force = false, allowApprovedReplacement = false, dependencies = {} } = {}) {
  const PlanModel = dependencies.SocialWeeklyPlan || SocialWeeklyPlan;
  const settings = await (dependencies.getSocialManagerSettings || getSocialManagerSettings)();
  if (!settings.feature_enabled) {
    const error = new Error("The Social Media Manager is disabled");
    error.code = "social_manager_disabled";
    error.statusCode = 409;
    throw error;
  }
  const window = resolvePlanningWindow(now, settings);
  let plan = await PlanModel.findOne({ week_key: window.week_key });
  if (plan && !force) return { plan, reused: true };
  const existingStatus = String(plan?.status || "").toUpperCase();
  if (plan && force && ["SCHEDULED", "ACTIVE", "COMPLETED"].includes(existingStatus)) {
    const error = new Error("A weekly plan with scheduled or published work cannot be replaced; keep its audit history and create the next planning week instead");
    error.statusCode = 409;
    error.code = "social_weekly_plan_replacement_unsafe";
    throw error;
  }
  if (plan && force && existingStatus === "APPROVED" && !allowApprovedReplacement) {
    const error = new Error("Replacing an approved weekly plan requires explicit administrator confirmation");
    error.statusCode = 409;
    error.code = "social_weekly_plan_replacement_confirmation_required";
    throw error;
  }
  if (plan) {
    plan.status = "QUEUED";
    plan.maximum_feed_posts = window.maximum;
    plan.config_snapshot = { posting_slots: window.slots, candidate_count: Math.max(Number(settings.weekly_planning?.candidate_count || 8), 8) };
    plan.candidates = [];
    plan.selected_posts = [];
    plan.research_digest = null;
    plan.audience_intelligence = null;
    plan.plan_rationale = null;
    plan.supervisor_recommendation = null;
    plan.prompt_runs = [];
    plan.prompt_version_ids = [];
    plan.research_source_ids = [];
    plan.input_context_checksum = null;
    plan.output_checksum = null;
    plan.generation_error = null;
    plan.generation_started_at = null;
    plan.generation_completed_at = null;
    plan.approved_by_admin_id = null;
    plan.approved_at = null;
    plan.rejected_by_admin_id = null;
    plan.rejected_at = null;
    plan.rejection_reason = null;
    plan.requested_by_admin_id = actorId(actor);
    plan.requested_at = now;
    plan.version = Number(plan.version || 1) + 1;
    await plan.save();
  } else {
    try {
      plan = await PlanModel.create({
        week_key: window.week_key,
        week_start: window.week_start,
        week_end: window.week_end,
        timezone: "Asia/Kolkata",
        status: "QUEUED",
        maximum_feed_posts: window.maximum,
        idempotency_key: `social-weekly-plan:${window.week_key}`,
        config_snapshot: { posting_slots: window.slots, candidate_count: Math.max(Number(settings.weekly_planning?.candidate_count || 8), 8) },
        candidates: [],
        selected_posts: [],
        requested_by_admin_id: actorId(actor),
        requested_at: now,
        version: 1,
      });
    } catch (error) {
      if (error?.code !== 11000) throw error;
      plan = await PlanModel.findOne({ week_key: window.week_key });
      if (!plan) throw error;
      return { plan, reused: true };
    }
  }
  await appendGrowthAudit({
    entityType: "WEEKLY_PLAN",
    entityId: plan._id,
    action: "WEEKLY_PLAN_QUEUED",
    summary: `Weekly AI planning was queued for ${window.week_start} through ${window.week_end}.`,
    actor,
    metadata: { maximum_feed_posts: window.maximum, force: Boolean(force) },
    dependencies,
  });
  if (dependencies.executeInline === true) await executeWeeklyPlan(plan, { now, dependencies });
  return { plan, reused: false };
}

async function processPendingWeeklyPlans({ limit = 1, now = new Date(), dependencies = {} } = {}) {
  const PlanModel = dependencies.SocialWeeklyPlan || SocialWeeklyPlan;
  const staleBefore = new Date(now.getTime() - 45 * 60 * 1000);
  const processed = [];
  for (let index = 0; index < Math.min(Math.max(Number(limit || 1), 1), 3); index += 1) {
    const plan = await PlanModel.findOneAndUpdate(
      {
        $or: [
          { status: "QUEUED" },
          { status: { $in: ["RESEARCHING", "PLANNING"] }, updated_at: { $lt: staleBefore } },
        ],
      },
      { $set: { status: "RESEARCHING", generation_started_at: now } },
      { new: true, sort: { requested_at: 1, created_at: 1 } },
    );
    if (!plan) break;
    try {
      await executeWeeklyPlan(plan, { now, dependencies });
      processed.push({ id: String(plan._id), status: "NEEDS_REVIEW" });
    } catch (error) {
      processed.push({ id: String(plan._id), status: plan.status, error: error.message });
    }
  }
  return { processed: processed.length, plans: processed };
}

async function getCurrentWeeklyPlan({ now = new Date(), dependencies = {} } = {}) {
  const PlanModel = dependencies.SocialWeeklyPlan || SocialWeeklyPlan;
  const settings = await (dependencies.getSocialManagerSettings || getSocialManagerSettings)();
  const window = resolvePlanningWindow(now, settings);
  const plan = await PlanModel.findOne({ week_key: window.week_key });
  return plan;
}

function freezeSelectedVisualMode(selected, candidate, settings, dependencies = {}) {
  const { resolveSocialVisualMode } = dependencies.socialVisualPolicy || require("./socialVisualPolicy");
  const requested = selected.visual_mode_resolution?.requested
    || settings.generation?.default_visual_mode
    || "AI_VISUAL_WITH_EXACT_OVERLAY";
  const resolution = resolveSocialVisualMode({
    requestedVisualMode: requested,
    fallbackVisualMode: "AI_VISUAL_WITH_EXACT_OVERLAY",
    recommendation: candidate,
    strict: false,
  });
  selected.visual_mode_resolution = clone(resolution);
  return resolution;
}

async function queueWeeklySelectedPost(plan, selected, { actor = null, now = new Date(), dependencies = {} } = {}) {
  const RunModel = dependencies.SocialGenerationRun || SocialGenerationRun;
  const session = dependencies.mongoSession || null;
  const candidateId = selected.candidateId || selected.candidate_id;
  let retryOfRunId = null;
  if (selected.generation_run_id) {
    const existingRun = await applyMongoSession(RunModel.findById(selected.generation_run_id), session);
    const existingStatus = String(existingRun?.status || "").toUpperCase();
    const runIsActive = ["PENDING", "RUNNING"].includes(existingStatus);
    const runProducedDraft = existingStatus === "SUCCEEDED"
      && Boolean(selected.draft_id || existingRun?.selected_draft_id);
    if (existingRun && (runIsActive || runProducedDraft)) return { run: existingRun, reused: true, retryOfRunId: null };
    if (existingRun) retryOfRunId = existingRun._id;
  }
  const candidate = selected.candidate || (plan.candidates || []).find((item) => item.candidateId === candidateId);
  if (!candidate) {
    const error = new Error("The selected weekly candidate payload is missing and cannot be produced safely");
    error.statusCode = 409;
    error.code = "social_weekly_candidate_payload_missing";
    throw error;
  }
  const { requestGeneration } = require("./socialManagerService");
  const baseRequestKey = `social-weekly-production:${plan._id}:${candidateId}:v${plan.version || 1}`;
  const requestResult = await (dependencies.requestGeneration || requestGeneration)({
    triggerType: retryOfRunId ? "RETRY" : "MANUAL",
    actor,
    now,
    force: true,
    requestKey: retryOfRunId ? `${baseRequestKey}:retry:${retryOfRunId}` : baseRequestKey,
    generationRequest: {
      requested_format: generationFormat(candidate.format),
      requested_post_type: candidate.objective,
      generation_scope: "FULL_POST",
      visual_mode: selected.visual_mode_resolution?.effective || "AI_VISUAL_WITH_EXACT_OVERLAY",
      visual_mode_resolution: clone(selected.visual_mode_resolution),
      verified_product_id: candidate.verifiedInternalEntityId || null,
      weekly_candidate: clone(candidate),
      required_landing_page: candidate.recommendedLandingPage || null,
      admin_instructions: [
        "Produce the selected weekly strategy exactly; do not substitute another topic, objective, destination, KPI, or format.",
        JSON.stringify(candidate),
      ].join("\n").slice(0, 4000),
      request_id: `weekly:${plan._id}:${candidateId}`,
    },
    weeklyContext: {
      planId: plan._id,
      candidateId,
      visualModeResolution: clone(selected.visual_mode_resolution),
    },
    dependencies,
  });
  const run = requestResult.run;
  if (run) {
    if (String(run.weekly_plan_id || "") !== String(plan._id)
      || String(run.weekly_candidate_id || "") !== String(candidateId)) {
      const error = new Error("The existing generation run is not linked to this weekly-plan candidate");
      error.statusCode = 409;
      error.code = "social_weekly_run_link_mismatch";
      throw error;
    }
    selected.generation_run_id = run._id;
    selected.status = "GENERATING_COPY";
  }
  return { run, reused: Boolean(requestResult.reused), retryOfRunId };
}

async function approveWeeklyPlan(planId, { actor, now = new Date(), dependencies = {} } = {}) {
  if (!actorId(actor)) { const error = new Error("An administrator identity is required"); error.statusCode = 403; throw error; }
  const PlanModel = dependencies.SocialWeeklyPlan || SocialWeeklyPlan;
  const settings = await (dependencies.getSocialManagerSettings || getSocialManagerSettings)();
  return runInMongoTransaction(dependencies, async (session) => {
    const transactionDependencies = { ...dependencies, mongoSession: session };
    const plan = await applyMongoSession(PlanModel.findById(planId), session);
    if (!plan) { const error = new Error("Weekly social plan not found"); error.statusCode = 404; throw error; }
    if (!["NEEDS_REVIEW", "APPROVED"].includes(plan.status)) {
      const error = new Error("Only a weekly plan awaiting review can be approved");
      error.statusCode = 409;
      throw error;
    }
    const firstApproval = plan.status === "NEEDS_REVIEW";
    if (firstApproval) {
      plan.status = "APPROVED";
      plan.approved_by_admin_id = actorId(actor);
      plan.approved_at = now;
    }
    const production = {
      requested: (plan.selected_posts || []).length,
      queued: 0,
      reused: 0,
      generation_runs: [],
    };
    for (const selected of plan.selected_posts || []) {
      const candidateId = selected.candidateId || selected.candidate_id;
      const candidate = selected.candidate || (plan.candidates || []).find((item) => item.candidateId === candidateId);
      if (firstApproval || !selected.visual_mode_resolution) {
        freezeSelectedVisualMode(selected, candidate, settings, transactionDependencies);
      }
      const queued = await queueWeeklySelectedPost(plan, selected, {
        actor,
        now,
        dependencies: transactionDependencies,
      });
      if (queued.reused) production.reused += 1;
      else production.queued += 1;
      production.generation_runs.push({
        candidate_id: candidateId,
        generation_run_id: queued.run?._id || queued.run?.id || null,
        reused: queued.reused,
        status: queued.run?.status || null,
      });
      if (!queued.reused || firstApproval) {
        await appendGrowthAudit({
          entityType: "WEEKLY_PLAN",
          entityId: plan._id,
          action: queued.retryOfRunId ? "WEEKLY_POST_PRODUCTION_RETRIED" : "WEEKLY_POST_PRODUCTION_QUEUED",
          summary: queued.retryOfRunId
            ? `A fresh AI creative retry was queued for ${candidateId}.`
            : `AI creative production was queued for ${candidateId}.`,
          actor,
          metadata: {
            candidate_id: candidateId,
            generation_run_id: queued.run?._id || null,
            retry_of_generation_run_id: queued.retryOfRunId,
            reused: queued.reused,
            visual_mode_resolution: clone(selected.visual_mode_resolution),
          },
          dependencies: transactionDependencies,
        });
      }
    }
    await plan.save(session ? { session } : undefined);
    if (firstApproval) {
      await appendGrowthAudit({
        entityType: "WEEKLY_PLAN",
        entityId: plan._id,
        action: "WEEKLY_PLAN_APPROVED",
        summary: "An administrator approved the weekly strategy and queued every selected creative for production.",
        actor,
        metadata: { production },
        dependencies: transactionDependencies,
      });
    }
    return { plan, production };
  });
}

function weeklyMixRole(candidate = {}) {
  const objective = String(candidate.objective || "").trim().toUpperCase();
  if (objective === "AWARENESS") return "DISCOVERY";
  if (objective === "EDUCATION") return "SAVEABLE_EDUCATION";
  if (["ENGAGEMENT", "COMMUNITY_BUILDING"].includes(objective)) return "ENGAGEMENT";
  if (["TRAFFIC", "LEADS", "PRODUCT_PROMOTION"].includes(objective)) return "CONVERSION";
  return "OTHER";
}

async function replaceWeeklyPlanSlot(planId, slotNumber, candidateId, {
  actor,
  now = new Date(),
  dependencies = {},
} = {}) {
  const adminId = actorId(actor);
  if (!adminId) {
    const error = new Error("An administrator identity is required");
    error.statusCode = 403;
    error.code = "social_weekly_plan_admin_required";
    throw error;
  }
  const parsedSlot = Number(slotNumber);
  if (!Number.isInteger(parsedSlot) || parsedSlot < 1 || parsedSlot > 14) {
    const error = new Error("slotNumber must identify a valid weekly-plan slot");
    error.statusCode = 400;
    error.code = "social_weekly_slot_invalid";
    throw error;
  }
  const replacementCandidateId = trimText(candidateId);
  if (!replacementCandidateId) {
    const error = new Error("candidate_id is required");
    error.statusCode = 400;
    error.code = "social_weekly_replacement_candidate_required";
    throw error;
  }
  const PlanModel = dependencies.SocialWeeklyPlan || SocialWeeklyPlan;
  const RunModel = dependencies.SocialGenerationRun || SocialGenerationRun;
  const DraftModel = dependencies.SocialPostDraft || SocialPostDraft;
  const settings = await (dependencies.getSocialManagerSettings || getSocialManagerSettings)();
  return runInMongoTransaction(dependencies, async (session) => {
    const transactionDependencies = { ...dependencies, mongoSession: session };
    const plan = await applyMongoSession(PlanModel.findById(planId), session);
    if (!plan) {
      const error = new Error("Weekly social plan not found");
      error.statusCode = 404;
      error.code = "social_weekly_plan_not_found";
      throw error;
    }
    if (String(plan.status || "").toUpperCase() !== "NEEDS_REVIEW") {
      const error = new Error("Only a weekly plan awaiting review can replace a retained candidate");
      error.statusCode = 409;
      error.code = "social_weekly_slot_locked";
      throw error;
    }
    const selected = (plan.selected_posts || []).find((item) => Number(item.slotNumber || item.slot_number) === parsedSlot);
    if (!selected) {
      const error = new Error("Weekly-plan slot not found");
      error.statusCode = 404;
      error.code = "social_weekly_slot_not_found";
      throw error;
    }
    const previousCandidateId = String(selected.candidateId || selected.candidate_id || "");
    const linkedRecordExists = Boolean(selected.generation_run_id || selected.draft_id || selected.publication_id)
      || await modelExists(RunModel, { weekly_plan_id: plan._id, weekly_candidate_id: previousCandidateId }, session)
      || await modelExists(DraftModel, {
        weekly_plan_id: plan._id,
        $or: [{ candidate_id: previousCandidateId }, { weekly_slot_number: parsedSlot }],
      }, session);
    if (linkedRecordExists) {
      const error = new Error("This slot already has creative-production history and cannot be replaced");
      error.statusCode = 409;
      error.code = "social_weekly_slot_has_production";
      throw error;
    }
    const candidate = (plan.candidates || []).find((item) => String(item.candidateId || item.candidate_id || "") === replacementCandidateId);
    if (!candidate) {
      const error = new Error("The replacement must be one of this plan's retained candidates");
      error.statusCode = 404;
      error.code = "social_weekly_replacement_candidate_not_found";
      throw error;
    }
    const usedElsewhere = (plan.selected_posts || []).some((item) => (
      Number(item.slotNumber || item.slot_number) !== parsedSlot
      && String(item.candidateId || item.candidate_id || "") === replacementCandidateId
    ));
    if (usedElsewhere || replacementCandidateId === previousCandidateId) {
      const error = new Error("The replacement candidate is already selected and is not an unused retained candidate");
      error.statusCode = 409;
      error.code = "social_weekly_replacement_candidate_in_use";
      throw error;
    }

    const previousVersion = Number(plan.version || 1);
    const previousOutputChecksum = plan.output_checksum || null;
    selected.candidateId = replacementCandidateId;
    selected.candidate = clone(candidate);
    selected.selectionReason = `Administrator selected a retained candidate for this slot: ${trimText(candidate.conciseRationale || candidate.title || replacementCandidateId)}`.slice(0, 800);
    selected.roleInWeeklyMix = weeklyMixRole(candidate);
    selected.status = "PLANNED";
    selected.generation_run_id = null;
    selected.draft_id = null;
    selected.publication_id = null;
    freezeSelectedVisualMode(selected, candidate, settings, transactionDependencies);
    plan.version = previousVersion + 1;
    plan.output_checksum = sha256({
      prior_output_checksum: previousOutputChecksum,
      plan_version: plan.version,
      selected_posts: (plan.selected_posts || []).map((item) => ({
        candidate_id: item.candidateId || item.candidate_id,
        slot_number: item.slotNumber || item.slot_number,
        scheduled_for: item.scheduledFor || item.scheduled_for,
        visual_mode_resolution: item.visual_mode_resolution || null,
      })),
    });
    await plan.save(session ? { session } : undefined);
    const replacement = {
      slot_number: parsedSlot,
      previous_candidate_id: previousCandidateId,
      candidate_id: replacementCandidateId,
      plan_version: plan.version,
      visual_mode_resolution: clone(selected.visual_mode_resolution),
    };
    await appendGrowthAudit({
      entityType: "WEEKLY_PLAN",
      entityId: plan._id,
      action: "WEEKLY_PLAN_SLOT_REPLACED",
      summary: `An administrator replaced weekly slot ${parsedSlot} with retained candidate ${replacementCandidateId}; the plan still requires approval.`,
      actor,
      metadata: {
        ...replacement,
        previous_plan_version: previousVersion,
        scheduled_for: selected.scheduledFor || selected.scheduled_for,
        previous_output_checksum: previousOutputChecksum,
        output_checksum: plan.output_checksum,
      },
      dependencies: transactionDependencies,
    });
    return { plan, replacement };
  });
}

async function rejectWeeklyPlan(planId, reason, { actor, dependencies = {} } = {}) {
  const PlanModel = dependencies.SocialWeeklyPlan || SocialWeeklyPlan;
  const plan = await PlanModel.findById(planId);
  if (!plan) { const error = new Error("Weekly social plan not found"); error.statusCode = 404; throw error; }
  if (!["NEEDS_REVIEW", "APPROVED"].includes(plan.status)) { const error = new Error("This weekly plan cannot be rejected in its current status"); error.statusCode = 409; throw error; }
  const normalizedReason = trimText(reason);
  if (!normalizedReason) { const error = new Error("A rejection reason is required"); error.statusCode = 400; throw error; }
  plan.status = "REJECTED";
  plan.rejected_by_admin_id = actorId(actor);
  plan.rejected_at = new Date();
  plan.rejection_reason = normalizedReason.slice(0, 2000);
  await plan.save();
  await appendGrowthAudit({ entityType: "WEEKLY_PLAN", entityId: plan._id, action: "WEEKLY_PLAN_REJECTED", summary: "An administrator rejected the weekly strategy.", actor, metadata: { reason: plan.rejection_reason }, dependencies });
  return plan;
}

function generationFormat(format) {
  return ({ POLL_CONCEPT: "POLL", WORKSHOP_PROMOTION: "EVENT_OR_WORKSHOP_PROMOTION" })[format] || format;
}

async function requestWeeklyPostProduction(planId, candidateId, { actor = null, now = new Date(), dependencies = {} } = {}) {
  const PlanModel = dependencies.SocialWeeklyPlan || SocialWeeklyPlan;
  const plan = await PlanModel.findById(planId);
  if (!plan) { const error = new Error("Weekly social plan not found"); error.statusCode = 404; throw error; }
  if (!["APPROVED", "SCHEDULED", "ACTIVE"].includes(plan.status)) { const error = new Error("Human approval of the weekly plan is required before creative production"); error.statusCode = 409; throw error; }
  const selected = (plan.selected_posts || []).find((item) => item.candidateId === candidateId || item.candidate_id === candidateId);
  if (!selected) { const error = new Error("The candidate is not selected in this weekly plan"); error.statusCode = 404; throw error; }
  const queued = await queueWeeklySelectedPost(plan, selected, { actor, now, dependencies });
  if (queued.run) await plan.save();
  await appendGrowthAudit({ entityType: "WEEKLY_PLAN", entityId: plan._id, action: queued.retryOfRunId ? "WEEKLY_POST_PRODUCTION_RETRIED" : "WEEKLY_POST_PRODUCTION_QUEUED", summary: queued.retryOfRunId ? `A fresh AI creative retry was queued for ${candidateId}.` : `AI creative production was queued for ${candidateId}.`, actor, metadata: { candidate_id: candidateId, generation_run_id: queued.run?._id || null, retry_of_generation_run_id: queued.retryOfRunId, reused: queued.reused }, dependencies });
  return { plan, run: queued.run, reused: queued.reused };
}

async function runDueWeeklyPrepublication({ now = new Date(), lookaheadHours = 24, dependencies = {} } = {}) {
  const PlanModel = dependencies.SocialWeeklyPlan || SocialWeeklyPlan;
  const end = new Date(now.getTime() + Math.min(Math.max(Number(lookaheadHours || 24), 1), 72) * 60 * 60 * 1000);
  const plans = await PlanModel.find({
    status: { $in: ["APPROVED", "SCHEDULED", "ACTIVE"] },
    selected_posts: { $elemMatch: { scheduledFor: { $gte: now, $lte: end }, generation_run_id: null } },
  }).limit(10);
  let queued = 0;
  const failures = [];
  for (const plan of plans) {
    for (const selected of plan.selected_posts || []) {
      const scheduled = new Date(selected.scheduledFor || selected.scheduled_for || 0);
      if (selected.generation_run_id || selected.status === "FAILED" || scheduled < now || scheduled > end) continue;
      try {
        await requestWeeklyPostProduction(plan._id, selected.candidateId || selected.candidate_id, { now, dependencies });
        queued += 1;
      } catch (error) {
        const candidateId = selected.candidateId || selected.candidate_id;
        selected.status = "FAILED";
        await plan.save();
        const ActionModel = dependencies.SocialManualAction || SocialManualAction;
        const actionKey = `social-prepublication-failure:${plan._id}:${candidateId}:v${plan.version || 1}`;
        const actionRecord = {
          action_key: actionKey,
          action_type: "CONTENT_ESCALATION",
          status: "OPEN",
          priority: "HIGH",
          title: "Resolve a failed weekly pre-publication run",
          description: `Creative production failed for weekly candidate ${candidateId}: ${trimText(error.message)}`.slice(0, 4000),
          instructions: [
            "Open Weekly Strategy and connection health, resolve the reported provider or data issue, then deliberately retry creative production before the publication slot.",
            "Do not substitute generic content or mark the post ready until a complete AI-generated draft and creative pass review.",
          ],
          provider: "INTERNAL",
          weekly_plan_id: plan._id,
          due_at: Number.isFinite(scheduled.getTime()) ? scheduled : null,
          external_reference_id: String(candidateId),
        };
        const action = typeof ActionModel.findOneAndUpdate === "function"
          ? await ActionModel.findOneAndUpdate(
            { action_key: actionKey },
            { $setOnInsert: actionRecord },
            { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true },
          )
          : await ActionModel.create(actionRecord);
        await appendGrowthAudit({
          entityType: "WEEKLY_PLAN",
          entityId: plan._id,
          action: "WEEKLY_POST_PRODUCTION_FAILED",
          status: "FAILED",
          summary: `Pre-publication creative production failed for ${candidateId}; a visible manual action was created.`,
          metadata: {
            candidate_id: candidateId,
            manual_action_id: action?._id || action?.id || null,
            error_code: error.code || null,
            error_message: trimText(error.message).slice(0, 1000),
          },
          error,
          dependencies,
        });
        failures.push({
          plan_id: String(plan._id),
          candidate_id: candidateId,
          manual_action_id: action?._id ? String(action._id) : null,
          error: error.message,
        });
      }
    }
  }
  return { queued, failures };
}

function redactCommunityText(value) {
  return sanitizeUntrustedResearchText(value, 2000)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email redacted]")
    .replace(/(?:\+?91[-\s]?)?[6-9]\d{9}\b/g, "[phone redacted]")
    .replace(/\b\d{8,18}\b/g, "[number redacted]")
    .replace(/https?:\/\/\S+/gi, "[link redacted]");
}

function assertSafeSuggestedReply(recommendation) {
  const reply = trimText(recommendation?.suggestedReply);
  if (!reply) return;
  const prohibited = [
    /guaranteed?\s+(?:return|profit|income)/i,
    /you\s+should\s+(?:buy|sell|invest)/i,
    /diagnos(?:e|is)|prescri(?:be|ption)/i,
    /send\s+(?:me|us)\s+your\s+(?:otp|password|pin|account)/i,
  ];
  if (prohibited.some((pattern) => pattern.test(reply))) {
    const error = new Error("The AI reply recommendation failed server-side safety review");
    error.code = "social_community_reply_unsafe";
    error.statusCode = 422;
    throw error;
  }
}

function enforceCommunityEscalation(item, recommendation) {
  const output = clone(recommendation || {});
  const classification = String(output.classification || "OTHER").toUpperCase();
  const sensitiveText = COMMUNITY_SENSITIVE_TEXT.test(String(item?.text || item?.message || ""));
  const riskFlags = Array.isArray(output.riskFlags) ? output.riskFlags.map(trimText).filter(Boolean) : [];
  const riskFlagEscalation = riskFlags.some((flag) => /(?:medical|financial[_\s-]?advice|complaint|abuse|sensitive|self[_\s-]?harm|personal)/i.test(flag));
  const mustEscalate = COMMUNITY_ESCALATION_CLASSIFICATIONS.has(classification)
    || sensitiveText
    || riskFlagEscalation
    || output.escalationRecommended === true
    || output.sendAllowedAfterApproval !== true
    || !Number.isFinite(Number(output.confidence))
    || Number(output.confidence) < 0.9;
  if (!mustEscalate) return output;
  output.escalationRecommended = true;
  output.sendAllowedAfterApproval = false;
  output.escalationReason = trimText(output.escalationReason)
    || "Server safety policy requires a human specialist to review this sensitive, complaint, medical, or personalised-finance context.";
  return output;
}

async function recommendCommunityReply(itemId, { actor = null, dependencies = {} } = {}) {
  const CommunityModel = dependencies.SocialCommunityItem || SocialCommunityItem;
  const item = await CommunityModel.findById(itemId);
  if (!item) { const error = new Error("Community item not found"); error.statusCode = 404; throw error; }
  const claimedWorkerRecommendation = !actorId(actor)
    && item.status === "RECOMMENDATION_PROCESSING"
    && item.recommendation_job?.status === "PROCESSING";
  if (!claimedWorkerRecommendation && !COMMUNITY_ADMIN_RECOMMENDABLE_STATUSES.has(item.status)) {
    const error = new Error(`A community item in ${item.status} cannot be redrafted`);
    error.code = "social_community_recommend_state_invalid";
    error.statusCode = 409;
    throw error;
  }
  const settings = await (dependencies.getSocialManagerSettings || getSocialManagerSettings)();
  const runtimeSettings = (dependencies.buildSocialManagerRuntimeSettings || buildSocialManagerRuntimeSettings)(settings);
  const result = await (dependencies.callStructuredResponse || openAiSocialProvider.callStructuredResponse)({
    stage: "community_reply",
    input: {
      sourceType: item.source_type,
      message: redactCommunityText(item.text || item.message || ""),
      existingClassification: item.classification || null,
      verifiedBrandFacts: {
        positioning: settings.brand_profile?.positioning,
        website: settings.brand_profile?.website_base_url,
        financialDisclaimer: settings.disclosures?.financial_disclaimer,
        affiliateDisclosure: settings.disclosures?.affiliate_disclosure,
      },
      policy: { humanApprovalRequired: true, maySend: false, unsolicitedPromotionalDm: false },
    },
    schema: COMMUNITY_REPLY_RECOMMENDATION_SCHEMA,
    settings: runtimeSettings,
    fetchImpl: dependencies.fetchImpl || fetch,
    maxOutputTokens: 5000,
  });
  const safeRecommendation = enforceCommunityEscalation(item, result.output);
  assertSafeSuggestedReply(safeRecommendation);
  const versionedPrompts = await persistVersionedPromptRuns(
    [promptRun("community_reply", result)],
    actorId(actor),
    dependencies,
  );
  const recommendedAt = new Date();
  item.classification = safeRecommendation.classification;
  item.recommendation = { ...safeRecommendation, prompt_run: versionedPrompts.promptRuns[0], generated_at: recommendedAt };
  item.risk_flags = safeRecommendation.riskFlags || [];
  item.risk = {
    level: safeRecommendation.escalationRecommended ? "HIGH" : "LOW",
    flags: safeRecommendation.riskFlags || [],
    rationale: safeRecommendation.escalationRecommended
      ? safeRecommendation.escalationReason
      : "The AI recommendation and deterministic server policy found no mandatory escalation condition.",
  };
  item.status = safeRecommendation.escalationRecommended ? "ESCALATED" : "NEEDS_REVIEW";
  item.escalation = safeRecommendation.escalationRecommended
    ? { required: true, reason: safeRecommendation.escalationReason, recommended_at: recommendedAt }
    : { required: false };
  if (item.recommendation_job) {
    item.recommendation_job.status = "COMPLETED";
    item.recommendation_job.completed_at = recommendedAt;
    item.recommendation_job.lease_expires_at = null;
  }
  await item.save();
  await appendGrowthAudit({ entityType: "COMMUNITY_ITEM", entityId: item._id, action: "COMMUNITY_REPLY_RECOMMENDED", summary: "The AI drafted a community response for human review; nothing was sent.", actor, metadata: { classification: item.classification, escalated: safeRecommendation.escalationRecommended }, dependencies });
  return item;
}

async function approveCommunityReply(itemId, { actor, dependencies = {} } = {}) {
  const CommunityModel = dependencies.SocialCommunityItem || SocialCommunityItem;
  const item = await CommunityModel.findById(itemId);
  if (!item) { const error = new Error("Community item not found"); error.statusCode = 404; throw error; }
  if (item.status !== "NEEDS_REVIEW") { const error = new Error("Only a reply awaiting review can be approved"); error.statusCode = 409; throw error; }
  if (!item.recommendation?.suggestedReply || item.recommendation?.sendAllowedAfterApproval === false) {
    const error = new Error("This community recommendation is not safe to send"); error.statusCode = 409; throw error;
  }
  assertSafeSuggestedReply(item.recommendation);
  item.status = "APPROVED";
  const approvedReply = trimText(item.recommendation.suggestedReply);
  item.approval = {
    status: "APPROVED",
    approved_by_admin_id: actorId(actor),
    approved_at: new Date(),
    approved_reply: approvedReply,
    approved_reply_checksum: sha256(approvedReply),
  };
  await item.save();
  await appendGrowthAudit({ entityType: "COMMUNITY_ITEM", entityId: item._id, action: "COMMUNITY_REPLY_APPROVED", summary: "An administrator approved the suggested reply; it has not been sent yet.", actor, dependencies });
  return item;
}

async function rejectCommunityReply(itemId, reason, { actor, dependencies = {} } = {}) {
  const CommunityModel = dependencies.SocialCommunityItem || SocialCommunityItem;
  const item = await CommunityModel.findById(itemId);
  if (!item) { const error = new Error("Community item not found"); error.statusCode = 404; throw error; }
  if (!COMMUNITY_REJECTABLE_STATUSES.has(item.status)) {
    const error = new Error(`A community item in ${item.status} cannot be rejected`);
    error.code = "social_community_reject_state_invalid";
    error.statusCode = 409;
    throw error;
  }
  const normalizedReason = trimText(reason);
  if (!normalizedReason) { const error = new Error("A rejection reason is required"); error.statusCode = 400; throw error; }
  item.status = "REJECTED";
  item.approval = { status: "REJECTED", rejected_by_admin_id: actorId(actor), rejected_at: new Date(), reason: normalizedReason.slice(0, 1000) };
  await item.save();
  await appendGrowthAudit({ entityType: "COMMUNITY_ITEM", entityId: item._id, action: "COMMUNITY_REPLY_REJECTED", summary: "An administrator rejected the suggested community reply.", actor, metadata: { reason: normalizedReason }, dependencies });
  return item;
}

async function sendApprovedCommunityReply(itemId, { actor, dependencies = {} } = {}) {
  const CommunityModel = dependencies.SocialCommunityItem || SocialCommunityItem;
  const item = await CommunityModel.findById(itemId);
  if (!item) { const error = new Error("Community item not found"); error.statusCode = 404; throw error; }
  if (item.status === "SENT") return item;
  if (item.status !== "APPROVED" || item.approval?.status !== "APPROVED") {
    const error = new Error("Human approval is required before sending a community reply"); error.statusCode = 409; throw error;
  }
  if (!COMMUNITY_SENDABLE_TYPES.has(String(item.source_type || "").toUpperCase())) {
    const error = new Error(`Replies for ${item.source_type || "this source"} require a manual action`);
    error.code = "social_manual_action_required";
    error.statusCode = 409;
    throw error;
  }
  const instagram = dependencies.instagramGrowthService || require("../instagramGrowthService");
  const message = trimText(item.approval?.approved_reply || item.recommendation?.suggestedReply);
  assertSafeSuggestedReply({ suggestedReply: message });
  if (item.approval?.approved_reply_checksum && sha256(message) !== item.approval.approved_reply_checksum) {
    const error = new Error("The approved community reply checksum no longer matches");
    error.code = "social_community_reply_checksum_mismatch";
    error.statusCode = 409;
    throw error;
  }
  let result;
  if (["COMMENT", "REPLY"].includes(item.source_type)) {
    result = await instagram.replyToComment({ commentId: item.external_object_id, message, dependencies });
  } else if (item.source_type === "PRIVATE_REPLY") {
    result = await instagram.sendPrivateReply({
      commentId: item.external_object_id,
      message,
      permissionContext: { commentCreatedAt: item.occurred_at },
      dependencies,
    });
  } else {
    result = await instagram.sendMessage({
      recipientId: item.author_external_id,
      message,
      permissionContext: {
        conversationInitiatedByRecipient: true,
        recipientInitiatedAt: item.occurred_at,
      },
      dependencies,
    });
  }
  const externalReplyId = trimText(
    result?.id
    || result?.reply_id
    || result?.replyId
    || result?.message_id
    || result?.messageId,
  );
  if (!externalReplyId) {
    const error = new Error("Meta did not return a reply identifier; the item was not marked sent");
    error.code = "instagram_reply_outcome_unconfirmed";
    throw error;
  }
  item.status = "SENT";
  item.send_result = { external_reply_id: externalReplyId, sent_at: new Date(), sent_by_admin_id: actorId(actor) };
  await item.save();
  await appendGrowthAudit({ entityType: "COMMUNITY_ITEM", entityId: item._id, action: "COMMUNITY_REPLY_SENT", summary: "The approved community reply was sent through Meta and a provider identifier was recorded.", actor, metadata: { external_reply_id: externalReplyId }, dependencies });
  return item;
}

async function persistCommunityAutomationFailure({ item, operation, now, error, dependencies }) {
  const normalizedOperation = String(operation || "COMMUNITY_AUTOMATION").toUpperCase();
  const isModeration = normalizedOperation === "HIDE_SPAM";
  const failure = {
    item_id: String(item._id),
    operation: normalizedOperation,
    code: safeErrorCode(error?.code, isModeration ? "INSTAGRAM_SPAM_HIDE_FAILED" : "INSTAGRAM_COMMUNITY_REPLY_FAILED"),
    message: safeFailureText(error?.message || error, 500),
  };
  try {
    const persisted = await persistSocialAutomationFailure({
      now,
      provider: "INSTAGRAM",
      operation: isModeration ? "COMMUNITY_SPAM_HIDE_FAILED" : "COMMUNITY_REPLY_SEND_FAILED",
      actionKey: `social-community-automation-failure:${item._id}:${normalizedOperation}`,
      actionType: isModeration ? "META_NATIVE_INTERACTION" : "COMMUNITY_REPLY",
      priority: isModeration ? "MEDIUM" : "HIGH",
      title: isModeration ? "Review failed Instagram spam moderation" : "Resolve failed Instagram community reply",
      description: `${isModeration ? "Automatic spam moderation" : "Sending a human-approved reply"} failed for community item ${item._id}: ${failure.message}`,
      instructions: isModeration
        ? [
          "Open the linked Community Inbox item and Instagram connection health, then verify comment-moderation permissions and the provider result.",
          "Moderate the comment deliberately in Instagram or retry only after the connection is healthy, then record the outcome before completing this action.",
        ]
        : [
          "Open the linked Community Inbox item and Instagram connection health, then verify the approved response, reply permissions, and provider result.",
          "Send or retry the approved response only after confirming no duplicate reply exists, then record the provider outcome before completing this action.",
        ],
      entityType: "COMMUNITY_ITEM",
      entityId: item._id,
      communityItemId: item._id,
      externalReferenceId: item.external_object_id || String(item._id),
      error: { message: failure.message, code: failure.code },
      metadata: {
        source_type: item.source_type || null,
        classification: item.classification || null,
        automation_operation: normalizedOperation,
      },
      dependencies,
    });
    return { ...failure, ...persisted };
  } catch (persistenceError) {
    return {
      ...failure,
      durability: "PERSISTENCE_FAILED",
      persistence_error: safeFailureText(persistenceError?.message || persistenceError, 500),
      persistence_code: safeErrorCode(persistenceError?.code, "SOCIAL_FAILURE_PERSISTENCE_FAILED"),
    };
  }
}

async function processCommunityAutomation({ now = new Date(), limit = 20, settings = null, dependencies = {} } = {}) {
  const CommunityModel = dependencies.SocialCommunityItem || SocialCommunityItem;
  const canonicalSettings = settings || await (dependencies.getSocialManagerSettings || getSocialManagerSettings)();
  const communitySettings = canonicalSettings?.community || {};
  const safeLimit = Math.min(Math.max(Number(limit || 20), 1), 100);
  const result = { drafted: 0, sent: 0, hidden: 0, uncertain: 0, failed: 0, failures: [] };
  if (communitySettings.enabled === false) return { ...result, skipped: "community_disabled" };

  if (typeof CommunityModel.findOneAndUpdate === "function") {
    const durable = await processCommunityWorkflow({ now, limit: safeLimit, settings: canonicalSettings, dependencies });
    result.drafted += Number(durable.drafted || 0);
    result.sent += Number(durable.sent || 0);
    result.uncertain += Number(durable.uncertain || 0);
    result.failed += Number(durable.failed || 0);
    result.failures.push(...(durable.failures || []));
  }

  if (communitySettings.auto_reply === true || communitySettings.auto_dm === true) {
    const approvedItems = await CommunityModel.find({ status: "APPROVED", "approval.status": "APPROVED" })
      .sort({ occurred_at: 1, created_at: 1 })
      .limit(safeLimit);
    let durableSendQueued = false;
    for (const item of approvedItems) {
      const sourceType = String(item.source_type || "").toUpperCase();
      const isDirectMessage = ["MESSAGE", "DIRECT_MESSAGE", "PRIVATE_REPLY"].includes(sourceType);
      const automationEnabled = isDirectMessage
        ? communitySettings.auto_dm === true
        : communitySettings.auto_reply === true;
      if (!automationEnabled || !COMMUNITY_SENDABLE_TYPES.has(sourceType)) continue;
      try {
        const queued = await queueApprovedCommunityReply(item._id, {
          actor: { _id: item.approval?.approved_by_admin_id },
          now,
          dependencies,
        });
        if (queued.send_intent?.status === "QUEUED") durableSendQueued = true;
      } catch (error) {
        result.failed += 1;
        result.failures.push(await persistCommunityAutomationFailure({ item, operation: "SEND_APPROVED_REPLY", now, error, dependencies }));
      }
    }
    if (durableSendQueued) {
      const durable = await processCommunityWorkflow({ now, limit: safeLimit, settings: canonicalSettings, dependencies });
      result.sent += Number(durable.sent || 0);
      result.uncertain += Number(durable.uncertain || 0);
      result.failed += Number(durable.failed || 0);
      result.failures.push(...(durable.failures || []));
    }
  }

  if (communitySettings.auto_hide_spam === true) {
    const spamItems = await CommunityModel.find({
      status: { $in: ["NEW", "NEEDS_REVIEW"] },
      source_type: { $in: ["COMMENT", "REPLY"] },
      classification: "SPAM",
      "recommendation.confidence": { $gte: 0.9 },
      "escalation.required": { $ne: true },
    })
      .sort({ occurred_at: 1, created_at: 1 })
      .limit(safeLimit);
    const instagram = dependencies.instagramGrowthService || require("../instagramGrowthService");
    for (const item of spamItems) {
      try {
        await instagram.hideComment({ commentId: item.external_object_id, dependencies });
        item.status = "HIDDEN";
        await item.save();
        await appendGrowthAudit({
          entityType: "COMMUNITY_ITEM",
          entityId: item._id,
          action: "COMMUNITY_SPAM_HIDDEN",
          summary: "A high-confidence spam comment was hidden because an administrator explicitly enabled automatic spam moderation.",
          metadata: { confidence: item.recommendation?.confidence, automation_enabled: true, occurred_at: now },
          dependencies,
        });
        result.hidden += 1;
      } catch (error) {
        result.failed += 1;
        result.failures.push(await persistCommunityAutomationFailure({ item, operation: "HIDE_SPAM", now, error, dependencies }));
      }
    }
  }
  return result;
}

async function ingestCommunityEvents(events, { dependencies = {} } = {}) {
  const CommunityModel = dependencies.SocialCommunityItem || SocialCommunityItem;
  const accepted = [];
  for (const event of Array.isArray(events) ? events : []) {
    const externalEventId = trimText(event.external_event_id || event.id);
    if (!externalEventId) continue;
    const sourceType = String(event.source_type || "COMMENT").toUpperCase();
    const occurredAt = event.occurred_at ? new Date(event.occurred_at) : new Date();
    const incomingText = sanitizeUntrustedResearchText(event.text || event.message || "", 4000);
    const workflow = initialCommunityWorkflow({ sourceType, message: incomingText, now: occurredAt });
    const row = await CommunityModel.findOneAndUpdate(
      { external_event_id: externalEventId },
      {
        $setOnInsert: {
          external_event_id: externalEventId,
          webhook_delivery_id: trimText(event.webhook_delivery_id) || null,
          event_payload_hash: trimText(event.event_payload_hash) || null,
          webhook_signature_verified: event.webhook_signature_verified === true,
          provider: "META",
          source_type: sourceType,
          external_object_id: trimText(event.external_object_id || event.object_id) || externalEventId,
          author_external_id: trimText(event.author_external_id) || null,
          author_label: trimText(event.author_label) || null,
          text: incomingText,
          permalink: trimText(event.permalink) || null,
          occurred_at: occurredAt,
          ...workflow,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    accepted.push(row);
  }
  return accepted;
}

async function listCommunityItems({ status = null, page = 1, limit = 50, dependencies = {} } = {}) {
  const CommunityModel = dependencies.SocialCommunityItem || SocialCommunityItem;
  const safePage = Math.max(Number(page || 1), 1);
  const safeLimit = Math.min(Math.max(Number(limit || 50), 1), 100);
  const requestedStatus = String(status || "").toUpperCase();
  const storedStatus = ({ OPEN: "NEW", RECOMMENDED: "NEEDS_REVIEW", ESCALATION_REQUIRED: "ESCALATED" })[requestedStatus] || requestedStatus;
  const query = storedStatus && storedStatus !== "ALL" ? { status: storedStatus } : {};
  const [items, total] = await Promise.all([
    CommunityModel.find(query).sort({ occurred_at: -1, created_at: -1 }).skip((safePage - 1) * safeLimit).limit(safeLimit).lean(),
    CommunityModel.countDocuments(query),
  ]);
  return { items: items.map(publicCommunityItem), total, page: safePage, limit: safeLimit };
}

const GA4_TRAFFIC_DIMENSIONS = Object.freeze([
  "date",
  "sessionSource",
  "sessionMedium",
  "sessionCampaignName",
  "sessionManualAdContent",
  "landingPagePlusQueryString",
]);
const GA4_TRAFFIC_METRICS = Object.freeze([
  "sessions",
  "engagedSessions",
  "activeUsers",
  "newUsers",
  "returningUsers",
  "screenPageViews",
  "keyEvents",
]);
const GA4_CONVERSION_DIMENSIONS = Object.freeze([
  "date",
  "eventName",
  "sessionCampaignName",
  "sessionManualAdContent",
  "landingPagePlusQueryString",
]);
const GA4_CONVERSION_METRICS = Object.freeze(["eventCount", "keyEvents"]);
const GA4_EVENT_METRIC_NAMES = Object.freeze({
  quiz_start: "quiz_starts",
  wealthness_quiz_start: "quiz_starts",
  quiz_complete: "quiz_completions",
  quiz_completion: "quiz_completions",
  wealthness_quiz_complete: "quiz_completions",
  calculator_open: "calculator_opens",
  calculator_start: "calculator_opens",
  financial_calculator_open: "calculator_opens",
  workshop_enquiry: "workshop_enquiries",
  workshop_inquiry: "workshop_enquiries",
  workshop_lead: "workshop_enquiries",
  generate_lead: "workshop_enquiries",
  view_item: "product_page_visits",
  product_view: "product_page_visits",
  affiliate_click: "affiliate_clicks",
  affiliate_outbound_click: "affiliate_clicks",
  outbound_click: "affiliate_clicks",
});

function ga4InstagramOrganicFilter() {
  const exact = (fieldName, value) => ({
    filter: {
      fieldName,
      stringFilter: { matchType: "EXACT", value, caseSensitive: false },
    },
  });
  return {
    andGroup: {
      expressions: [
        exact("sessionSource", "instagram"),
        exact("sessionMedium", "organic_social"),
      ],
    },
  };
}

function ga4MetricAggregate(report, metricName) {
  const totals = Array.isArray(report?.totals) && report.totals.length ? report.totals : null;
  const rows = totals || (Array.isArray(report?.rows) ? report.rows : []);
  let observed = false;
  const total = rows.reduce((sum, row) => {
    const value = row?.metrics?.[metricName];
    if (value == null || !Number.isFinite(Number(value))) return sum;
    observed = true;
    return sum + Number(value);
  }, 0);
  return observed ? total : null;
}

function normalizedGa4Metrics(report, { conversion = false } = {}) {
  const mapping = conversion
    ? { eventCount: "event_count", keyEvents: "conversion_events" }
    : {
      sessions: "website_sessions",
      engagedSessions: "engaged_sessions",
      activeUsers: "active_users",
      newUsers: "new_users",
      returningUsers: "returning_visitors",
      screenPageViews: "page_views",
      keyEvents: "conversion_events",
    };
  return Object.fromEntries(Object.entries(mapping).flatMap(([providerName, normalizedName]) => {
    const value = ga4MetricAggregate(report, providerName);
    return value == null ? [] : [[normalizedName, value]];
  }));
}

function normalizedGa4Row(row, { conversion = false } = {}) {
  const dimensions = row?.dimensions || {};
  const metrics = {};
  const mapping = conversion
    ? { eventCount: "event_count", keyEvents: "conversion_events" }
    : {
      sessions: "website_sessions",
      engagedSessions: "engaged_sessions",
      activeUsers: "active_users",
      newUsers: "new_users",
      returningUsers: "returning_visitors",
      screenPageViews: "page_views",
      keyEvents: "conversion_events",
    };
  Object.entries(mapping).forEach(([providerName, normalizedName]) => {
    const value = row?.metrics?.[providerName];
    if (value != null && Number.isFinite(Number(value))) metrics[normalizedName] = Number(value);
  });
  return {
    date: dimensions.date || null,
    source: dimensions.sessionSource || "instagram",
    medium: dimensions.sessionMedium || "organic_social",
    campaign: dimensions.sessionCampaignName || null,
    content: dimensions.sessionManualAdContent || null,
    landing_page: dimensions.landingPagePlusQueryString || null,
    event_name: dimensions.eventName || null,
    metrics,
  };
}

function buildGa4InstagramAttributionResult(trafficReport, conversionReport = null, conversionWarning = null) {
  if (trafficReport?.data?.metrics && !Array.isArray(trafficReport?.rows)) return trafficReport;
  const metrics = normalizedGa4Metrics(trafficReport);
  const attributionRows = (Array.isArray(trafficReport?.rows) ? trafficReport.rows : [])
    .map((row) => normalizedGa4Row(row));
  const conversionRows = (Array.isArray(conversionReport?.rows) ? conversionReport.rows : [])
    .map((row) => normalizedGa4Row(row, { conversion: true }));
  const conversionMetrics = normalizedGa4Metrics(conversionReport, { conversion: true });
  Object.entries(conversionMetrics).forEach(([key, value]) => { metrics[key] = value; });
  conversionRows.forEach((row) => {
    const eventName = String(row.event_name || "").trim().toLowerCase();
    const metricName = GA4_EVENT_METRIC_NAMES[eventName];
    const eventCount = row.metrics.event_count;
    if (metricName && eventCount != null) metrics[metricName] = Number(metrics[metricName] || 0) + Number(eventCount);
  });
  if (!Object.keys(metrics).length) metrics.availability = "NO_MATCHING_INSTAGRAM_ORGANIC_SOCIAL_DATA";
  return {
    status: conversionWarning ? "PARTIAL" : "COMPLETE",
    data: {
      metrics,
      dimensions: {
        attribution_rows: attributionRows,
        conversion_event_rows: conversionRows,
      },
      query_definition: {
        attribution: { utm_source: "instagram", utm_medium: "organic_social" },
        traffic: { dimensions: GA4_TRAFFIC_DIMENSIONS, metrics: GA4_TRAFFIC_METRICS },
        conversions: { dimensions: GA4_CONVERSION_DIMENSIONS, metrics: GA4_CONVERSION_METRICS },
        join_keys: ["sessionCampaignName", "sessionManualAdContent", "landingPagePlusQueryString"],
      },
      warnings: conversionWarning ? [conversionWarning] : [],
    },
    message: conversionWarning || null,
  };
}

async function collectGa4InstagramAttribution({ operation, startDate, endDate, settings, dependencies }) {
  const common = {
    startDate,
    endDate,
    settings,
    dependencies,
    dimensionFilter: ga4InstagramOrganicFilter(),
    limit: 2500,
  };
  const trafficReport = await operation({
    ...common,
    dimensions: [...GA4_TRAFFIC_DIMENSIONS],
    metrics: [...GA4_TRAFFIC_METRICS],
  });
  if (trafficReport?.status === "NOT_CONFIGURED" || trafficReport?.configured === false) return trafficReport;
  if (trafficReport?.data?.metrics && !Array.isArray(trafficReport?.rows)) return trafficReport;
  let conversionReport = null;
  let conversionWarning = null;
  try {
    conversionReport = await operation({
      ...common,
      dimensions: [...GA4_CONVERSION_DIMENSIONS],
      metrics: [...GA4_CONVERSION_METRICS],
    });
  } catch (error) {
    conversionWarning = `GA4 traffic was collected, but the aggregate conversion-event report failed: ${trimText(error?.message).slice(0, 500)}`;
  }
  return buildGa4InstagramAttributionResult(trafficReport, conversionReport, conversionWarning);
}

function snapshotPayload(provider, result, startDate, endDate, now) {
  const body = result?.data || result;
  return {
    snapshot_key: `social-growth:${provider.toLowerCase()}:${startDate}:${endDate}:${sha256(body).slice(0, 20)}`,
    provider,
    entity_type: provider === "INSTAGRAM" ? "INSTAGRAM_ACCOUNT" : "WEBSITE",
    period_start: new Date(`${startDate}T00:00:00.000Z`),
    period_end: new Date(`${endDate}T23:59:59.999Z`),
    window: `${startDate}/${endDate}`,
    captured_at: now,
    retrieval_status: result?.status === "PARTIAL" ? "PARTIAL" : "COMPLETE",
    metrics: clone(body?.metrics || body?.totals || body || {}),
    dimensions: clone(body?.dimensions || body?.rows || []),
    query_definition: clone(body?.query_definition || result?.query_definition || result?.query || null),
    provenance_note: `${provider} aggregate connector; no personally identifiable customer data stored or sent to AI.`,
    raw_response_hash: sha256(body),
  };
}

async function persistGa4AttributionJoins({ ga4Snapshot, startDate, endDate, now, dependencies = {} }) {
  if (!ga4Snapshot) return [];
  if (dependencies.SocialGrowthSnapshot && !dependencies.SocialPostDraft) return [];
  const DraftModel = dependencies.SocialPostDraft || SocialPostDraft;
  const SnapshotModel = dependencies.SocialGrowthSnapshot || SocialGrowthSnapshot;
  const draftQuery = DraftModel.find({ status: "PUBLISHED" });
  const selectedDrafts = typeof draftQuery?.select === "function"
    ? draftQuery.select("_id publication_id current_package published_at")
    : draftQuery;
  const limitedDrafts = typeof selectedDrafts?.limit === "function" ? selectedDrafts.limit(500) : selectedDrafts;
  const drafts = typeof limitedDrafts?.lean === "function" ? await limitedDrafts.lean() : await limitedDrafts;
  if (!Array.isArray(drafts) || !drafts.length) return [];
  const { attributionRows, conversionRows } = attributionRowsFromSnapshot(ga4Snapshot);
  const results = [];
  for (const draft of drafts) {
    const recommendation = draft.current_package?.primaryRecommendation || {};
    const utm = recommendation.utmParameters || null;
    const attribution = attributedMetricsForUtm({ utm, attributionRows, conversionRows });
    if (!Object.keys(attribution.metrics).length) continue;
    const payload = {
      snapshot_key: `social-growth:attribution-join:${String(ga4Snapshot.snapshot_key || ga4Snapshot._id)}:${draft._id}`.slice(0, 400),
      provider: "ATTRIBUTION_JOIN",
      entity_type: "DRAFT",
      entity_id: draft._id,
      draft_id: draft._id,
      publication_id: draft.publication_id || null,
      period_start: new Date(`${startDate}T00:00:00.000Z`),
      period_end: new Date(`${endDate}T23:59:59.999Z`),
      window: `${startDate}/${endDate}`,
      attribution_window: "GA4_UTM_REPORTING_WINDOW",
      captured_at: now,
      retrieval_status: "COMPLETE",
      query_definition: {
        utm_source: "instagram",
        utm_medium: "organic_social",
        utm_campaign: utm?.campaign || null,
        utm_content: utm?.content || null,
      },
      metrics: attribution.metrics,
      dimensions: {
        landing_pages: attribution.landing_pages,
        matched_aggregate_rows: attribution.matched_rows,
      },
      provenance_note: "Aggregate GA4 Instagram organic-social rows joined to a Pink Paisa draft by its exact stored utm_campaign and utm_content; no user-level or personal data is stored.",
      normalized_payload_hash: sha256({ draft_id: draft._id, utm, attribution }),
    };
    const stored = await SnapshotModel.findOneAndUpdate(
      { snapshot_key: payload.snapshot_key },
      { $setOnInsert: payload },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    results.push(stored);
  }
  return results;
}

async function refreshGrowthAnalytics({ now = new Date(), startDate = null, endDate = null, actor = null, dependencies = {} } = {}) {
  const SnapshotModel = dependencies.SocialGrowthSnapshot || SocialGrowthSnapshot;
  const settings = await (dependencies.getSocialManagerSettings || getSocialManagerSettings)();
  const connectors = dependencies.connectors || require("./socialGrowthConnectors");
  const resolvedEnd = endDate || now.toISOString().slice(0, 10);
  const resolvedStart = startDate || new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const operations = [
    ["GA4", dependencies.collectGa4Aggregate || connectors.collectGa4Aggregate],
    ["SEARCH_CONSOLE", dependencies.collectSearchConsoleAggregate || connectors.collectSearchConsoleAggregate],
  ];
  const snapshots = [];
  const connections = [];
  for (const [provider, operation] of operations) {
    try {
      const result = provider === "GA4"
        ? await collectGa4InstagramAttribution({ operation, startDate: resolvedStart, endDate: resolvedEnd, settings, dependencies })
        : await operation({ startDate: resolvedStart, endDate: resolvedEnd, settings, dependencies });
      if (result?.status === "NOT_CONFIGURED" || result?.configured === false) {
        connections.push({ provider, status: "NOT_CONFIGURED", message: result?.message || `${provider} is not configured` });
        continue;
      }
      const payload = snapshotPayload(provider, result, resolvedStart, resolvedEnd, now);
      const snapshot = await SnapshotModel.findOneAndUpdate(
        { snapshot_key: payload.snapshot_key },
        { $setOnInsert: payload },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      );
      snapshots.push(snapshot);
      connections.push({ provider, status: result?.status === "PARTIAL" ? "PARTIAL" : "CONNECTED", message: result?.message || null });
    } catch (error) {
      connections.push({ provider, status: error.code === "NOT_CONFIGURED" || error.code === "not_configured" ? "NOT_CONFIGURED" : "ERROR", message: error.message });
    }
  }
  const ga4Snapshot = snapshots.find((snapshot) => String(snapshot?.provider || "").toUpperCase() === "GA4") || null;
  if (ga4Snapshot) {
    try {
      const attributionJoins = await persistGa4AttributionJoins({
        ga4Snapshot,
        startDate: resolvedStart,
        endDate: resolvedEnd,
        now,
        dependencies,
      });
      snapshots.push(...attributionJoins);
    } catch (error) {
      const ga4Connection = connections.find((entry) => entry.provider === "GA4");
      if (ga4Connection) {
        ga4Connection.status = "PARTIAL";
        ga4Connection.message = `GA4 aggregates were stored, but the UTM-to-draft attribution join failed: ${trimText(error?.message).slice(0, 500)}`;
      }
    }
  }
  let aggregatePostPerformance = [];
  try {
    aggregatePostPerformance = await loadAggregatePostPerformance({
      startDate: resolvedStart,
      endDate: resolvedEnd,
      now,
      growthSnapshots: snapshots,
      dependencies,
    });
  } catch (error) {
    connections.push({
      provider: "INSTAGRAM_PERFORMANCE",
      status: "ERROR",
      message: `Stored aggregate Instagram post performance could not be loaded for analysis: ${trimText(error?.message).slice(0, 500)}`,
    });
  }
  let growthAnalysis = null;
  if ((snapshots.length || aggregatePostPerformance.length) && (dependencies.callStructuredResponse || openAiSocialProvider.isConfigured())) {
    const runtimeSettings = (dependencies.buildSocialManagerRuntimeSettings || buildSocialManagerRuntimeSettings)(settings);
    const analysisResult = await (dependencies.callStructuredResponse || openAiSocialProvider.callStructuredResponse)({
      stage: "growth_analytics",
      input: {
        periodStart: resolvedStart,
        periodEnd: resolvedEnd,
        aggregateSnapshots: snapshots.map(asObject),
        aggregatePostPerformance,
        baselineRules: ["same-format 28-day median", "same-pillar 90-day median", "account baseline", "campaign objective"],
        warning: "Correlation does not establish causation; missing metrics are unavailable, not zero. Post rows contain aggregate performance and campaign fields only, never user-level data.",
      },
      schema: WEEKLY_ANALYTICS_REVIEW_SCHEMA,
      settings: runtimeSettings,
      fetchImpl: dependencies.fetchImpl || fetch,
      maxOutputTokens: 8000,
    });
    const versionedPrompts = await persistVersionedPromptRuns(
      [promptRun("growth_analytics", analysisResult)],
      actorId(actor),
      dependencies,
    );
    growthAnalysis = {
      ...analysisResult.output,
      analyzed_aggregate_post_count: aggregatePostPerformance.length,
      prompt_run: versionedPrompts.promptRuns[0],
      generated_at: new Date(),
    };
    const currentPlan = await (dependencies.SocialWeeklyPlan || SocialWeeklyPlan).findOne({}).sort({ week_start: -1 });
    if (currentPlan) {
      currentPlan.growth_analysis = growthAnalysis;
      await currentPlan.save();
    }
  }
  return {
    period_start: resolvedStart,
    period_end: resolvedEnd,
    connections,
    snapshots: snapshots.map(asObject),
    aggregate_post_performance: aggregatePostPerformance,
    growth_analysis: growthAnalysis,
  };
}

function numericMetrics(value) {
  const record = asObject(value) || value || {};
  return Object.fromEntries(Object.entries(record).flatMap(([key, item]) => (
    item != null && Number.isFinite(Number(item)) ? [[key, Number(item)]] : []
  )));
}

function sumMetricRecords(records = []) {
  const totals = {};
  records.forEach((record) => Object.entries(numericMetrics(record)).forEach(([key, value]) => {
    totals[key] = Number(totals[key] || 0) + value;
  }));
  return totals;
}

function median(values = []) {
  const sorted = values.filter((value) => Number.isFinite(Number(value))).map(Number).sort((left, right) => left - right);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function baselineRowsForPost(post, allPosts, now = new Date()) {
  const publishedAt = new Date(post.published_at || now);
  const targetTime = Number.isFinite(publishedAt.getTime()) ? publishedAt.getTime() : now.getTime();
  const previous = allPosts.filter((peer) => {
    if (peer.id === post.id) return false;
    const peerTime = new Date(peer.published_at || 0).getTime();
    return Number.isFinite(peerTime) && peerTime < targetTime;
  });
  const groups = [
    {
      baseline: "SAME_FORMAT_28D_MEDIAN",
      peers: previous.filter((peer) => peer.format === post.format
        && new Date(peer.published_at).getTime() >= targetTime - 28 * 24 * 60 * 60 * 1000),
    },
    {
      baseline: "SAME_PILLAR_90D_MEDIAN",
      peers: previous.filter((peer) => post.content_pillar && peer.content_pillar === post.content_pillar
        && new Date(peer.published_at).getTime() >= targetTime - 90 * 24 * 60 * 60 * 1000),
    },
    {
      baseline: "ACCOUNT_90D_MEDIAN",
      peers: previous.filter((peer) => new Date(peer.published_at).getTime() >= targetTime - 90 * 24 * 60 * 60 * 1000),
    },
  ];
  const observed = numericMetrics(post.metrics);
  return groups.flatMap(({ baseline, peers }) => Object.entries(observed).flatMap(([metric, observedValue]) => {
    const values = peers.flatMap((peer) => {
      const value = numericMetrics(peer.metrics)[metric];
      return value == null ? [] : [value];
    });
    const baselineValue = median(values);
    if (baselineValue == null) return [];
    return [{
      post_id: post.id,
      metric,
      baseline,
      observed_value: observedValue,
      baseline_value: baselineValue,
      delta: observedValue - baselineValue,
      ratio: baselineValue === 0 ? null : observedValue / baselineValue,
      sample_size: values.length,
    }];
  }));
}

function metricEvidenceForKpi(metrics, kpi) {
  const normalized = trimText(kpi).toUpperCase();
  const numeric = numericMetrics(metrics);
  const metric = (KPI_METRIC_KEYS[normalized] || []).find((key) => Object.hasOwn(numeric, key)) || null;
  return { kpi: normalized || null, metric, value: metric ? numeric[metric] : null };
}

function campaignObjectiveAssessment(post) {
  const primary = metricEvidenceForKpi(post.metrics, post.primary_kpi);
  if (!post.objective || !primary.kpi || !primary.metric) {
    return {
      objective: post.objective || null,
      primary_kpi: primary.kpi,
      metric: primary.metric,
      observed_value: primary.value,
      assessment: "METRIC_UNAVAILABLE",
      evidence: primary.kpi
        ? `${primary.kpi} is unavailable for this aggregate reporting window; it was not treated as zero.`
        : "No campaign primary KPI was stored for this post, so objective performance is unavailable.",
    };
  }
  const baseline = (post.baseline_comparisons || []).find((row) => (
    row.metric === primary.metric && row.baseline === "SAME_FORMAT_28D_MEDIAN"
  )) || (post.baseline_comparisons || []).find((row) => row.metric === primary.metric);
  if (!baseline) {
    return {
      objective: post.objective,
      primary_kpi: primary.kpi,
      metric: primary.metric,
      observed_value: primary.value,
      assessment: "NO_BASELINE",
      evidence: `${primary.kpi} was observed at ${primary.value}, but no eligible historical baseline sample exists.`,
    };
  }
  const assessment = baseline.delta > 0 ? "ABOVE_BASELINE" : baseline.delta < 0 ? "BELOW_BASELINE" : "AT_BASELINE";
  return {
    objective: post.objective,
    primary_kpi: primary.kpi,
    metric: primary.metric,
    observed_value: primary.value,
    assessment,
    baseline: baseline.baseline,
    baseline_value: baseline.baseline_value,
    delta: baseline.delta,
    sample_size: baseline.sample_size,
    evidence: `${primary.kpi} was ${primary.value} versus ${baseline.baseline_value} for ${baseline.baseline} (n=${baseline.sample_size}).`,
  };
}

async function loadAggregatePostPerformance({ startDate, endDate, now = new Date(), growthSnapshots = [], dependencies = {} }) {
  if (
    dependencies.SocialGrowthSnapshot
    && !(dependencies.SocialPublication && dependencies.SocialPostDraft && dependencies.SocialMetricSnapshot)
  ) return [];
  const PublicationModel = dependencies.SocialPublication || SocialPublication;
  const DraftModel = dependencies.SocialPostDraft || SocialPostDraft;
  const MetricModel = dependencies.SocialMetricSnapshot || SocialMetricSnapshot;
  const periodStart = new Date(`${startDate}T00:00:00.000Z`);
  const periodEnd = new Date(`${endDate}T23:59:59.999Z`);
  const baselineStart = new Date(Math.min(periodStart.getTime(), periodEnd.getTime() - 90 * 24 * 60 * 60 * 1000));
  const publicationQuery = PublicationModel.find({
    status: "PUBLISHED",
    published_at: { $gte: baselineStart, $lte: periodEnd },
  });
  const sortedPublications = typeof publicationQuery?.sort === "function" ? publicationQuery.sort({ published_at: 1 }) : publicationQuery;
  const limitedPublications = typeof sortedPublications?.limit === "function" ? sortedPublications.limit(300) : sortedPublications;
  const publications = typeof limitedPublications?.lean === "function" ? await limitedPublications.lean() : await limitedPublications;
  if (!Array.isArray(publications) || !publications.length) return [];
  const draftIds = publications.map((publication) => publication.draft_id).filter(Boolean);
  const draftQuery = DraftModel.find({ _id: { $in: draftIds } });
  const selectedDrafts = typeof draftQuery?.select === "function"
    ? draftQuery.select("current_package primary_objective primary_kpi secondary_kpi primary_format primary_content_pillar published_at")
    : draftQuery;
  const metricQuery = MetricModel.find({ draft_id: { $in: draftIds } });
  const sortedMetrics = typeof metricQuery?.sort === "function" ? metricQuery.sort({ captured_at: -1 }) : metricQuery;
  const [drafts, metricSnapshots] = await Promise.all([
    typeof selectedDrafts?.lean === "function" ? selectedDrafts.lean() : selectedDrafts,
    typeof sortedMetrics?.lean === "function" ? sortedMetrics.lean() : sortedMetrics,
  ]);
  const draftById = new Map((drafts || []).map((draft) => [String(draft._id), draft]));
  const metricsByDraft = new Map();
  (metricSnapshots || []).forEach((snapshot) => {
    const key = String(snapshot.draft_id || "");
    if (!key) return;
    const current = metricsByDraft.get(key) || { instagram: {}, website: {} };
    const source = trimText(snapshot.source).toUpperCase();
    const target = ["WEBSITE_ANALYTICS", "ATTRIBUTION_JOIN"].includes(source) ? current.website : current.instagram;
    Object.entries(numericMetrics(snapshot.metrics)).forEach(([metric, value]) => {
      if (!Object.hasOwn(target, metric)) target[metric] = value;
    });
    metricsByDraft.set(key, current);
  });
  const ga4Snapshot = growthSnapshots.map(asObject).find((snapshot) => trimText(snapshot?.provider).toUpperCase() === "GA4") || null;
  const { attributionRows, conversionRows } = attributionRowsFromSnapshot(ga4Snapshot);
  const allPosts = publications.flatMap((publication) => {
    const key = String(publication.draft_id || "");
    const draft = draftById.get(key);
    if (!draft) return [];
    const recommendation = draft.current_package?.primaryRecommendation || {};
    const stored = metricsByDraft.get(key) || { instagram: {}, website: {} };
    const attribution = attributedMetricsForUtm({ utm: recommendation.utmParameters, attributionRows, conversionRows });
    const website = { ...stored.website, ...attribution.metrics };
    return [{
      id: key,
      published_at: publication.published_at || draft.published_at,
      format: draft.primary_format || recommendation.format || publication.content_type || null,
      content_pillar: draft.primary_content_pillar || recommendation.contentPillar || null,
      objective: draft.primary_objective || recommendation.objective || null,
      primary_kpi: trimText(draft.primary_kpi || recommendation.primaryKpi).toUpperCase() || null,
      secondary_kpi: trimText(draft.secondary_kpi || recommendation.secondaryKpi).toUpperCase() || null,
      instagram_metrics: stored.instagram,
      website_attribution: website,
      metrics: { ...stored.instagram, ...website },
    }];
  });
  allPosts.forEach((post) => { post.baseline_comparisons = baselineRowsForPost(post, allPosts, now); });
  return allPosts
    .filter((post) => {
      const publishedAt = new Date(post.published_at || 0);
      return publishedAt >= periodStart && publishedAt <= periodEnd;
    })
    .slice(0, 100)
    .map((post, index) => {
      const postReference = `post_${index + 1}`;
      const objectiveAssessment = campaignObjectiveAssessment(post);
      return {
        post_reference: postReference,
        published_at: post.published_at,
        format: post.format,
        content_pillar: post.content_pillar,
        objective: post.objective,
        primary_kpi: post.primary_kpi,
        secondary_kpi: post.secondary_kpi,
        instagram_metrics: post.instagram_metrics,
        website_attribution: post.website_attribution,
        baseline_comparisons: post.baseline_comparisons.map(({ post_id: _postId, ...comparison }) => comparison),
        objective_assessment: objectiveAssessment,
      };
    });
}

function attributionRowsFromSnapshot(snapshot) {
  const dimensions = asObject(snapshot?.dimensions) || snapshot?.dimensions || {};
  if (Array.isArray(dimensions)) {
    return {
      attributionRows: dimensions.map((row) => row?.dimensions ? normalizedGa4Row(row) : row),
      conversionRows: [],
    };
  }
  return {
    attributionRows: Array.isArray(dimensions.attribution_rows) ? dimensions.attribution_rows : [],
    conversionRows: Array.isArray(dimensions.conversion_event_rows) ? dimensions.conversion_event_rows : [],
  };
}

function attributedMetricsForUtm({ utm, attributionRows, conversionRows }) {
  const campaign = trimText(utm?.campaign || utm?.utm_campaign);
  const content = trimText(utm?.content || utm?.utm_content);
  if (!campaign && !content) return { metrics: {}, landing_pages: [], matched_rows: 0 };
  const matches = (row) => {
    const campaignMatches = !campaign || trimText(row?.campaign) === campaign;
    const contentMatches = !content || trimText(row?.content) === content;
    return campaignMatches && contentMatches;
  };
  const trafficMatches = attributionRows.filter(matches);
  const conversionMatches = conversionRows.filter(matches);
  const metrics = sumMetricRecords(trafficMatches.map((row) => row.metrics));
  const conversionMetrics = sumMetricRecords(conversionMatches.map((row) => row.metrics));
  Object.entries(conversionMetrics).forEach(([key, value]) => { metrics[key] = Number(metrics[key] || 0) + value; });
  conversionMatches.forEach((row) => {
    const metricName = GA4_EVENT_METRIC_NAMES[String(row.event_name || "").trim().toLowerCase()];
    if (metricName && row.metrics?.event_count != null) {
      metrics[metricName] = Number(metrics[metricName] || 0) + Number(row.metrics.event_count);
    }
  });
  return {
    metrics,
    landing_pages: [...new Set([...trafficMatches, ...conversionMatches].map((row) => trimText(row.landing_page)).filter(Boolean))],
    matched_rows: trafficMatches.length + conversionMatches.length,
  };
}

async function getAnalyticsSummary({ days = 90, now = new Date(), dependencies = {} } = {}) {
  const SnapshotModel = dependencies.SocialGrowthSnapshot || SocialGrowthSnapshot;
  const MetricModel = dependencies.SocialMetricSnapshot || SocialMetricSnapshot;
  const PublicationModel = dependencies.SocialPublication || SocialPublication;
  const DraftModel = dependencies.SocialPostDraft || SocialPostDraft;
  const safeDays = Math.min(Math.max(Number(days || 90), 1), 365);
  const since = new Date(now.getTime() - safeDays * 24 * 60 * 60 * 1000);
  const baselineSince = new Date(now.getTime() - Math.max(safeDays, 90) * 24 * 60 * 60 * 1000);
  const latest = await SnapshotModel.find({}).sort({ captured_at: -1 }).limit(100).lean();
  const { getPerformanceSummary } = require("./socialManagerService");
  const social = await (dependencies.getPerformanceSummary || getPerformanceSummary)({ days: safeDays, dependencies });
  const allPublications = await PublicationModel.find({ status: "PUBLISHED", published_at: { $gte: baselineSince } }).sort({ published_at: -1 }).limit(300).lean();
  const draftIds = allPublications.map((publication) => publication.draft_id).filter(Boolean);
  const [drafts, metricSnapshots] = await Promise.all([
    DraftModel.find({ _id: { $in: draftIds } }).select("current_package published_at primary_objective primary_kpi secondary_kpi primary_format primary_content_pillar").lean(),
    MetricModel.find({ draft_id: { $in: draftIds } }).sort({ captured_at: -1 }).lean(),
  ]);
  const draftById = new Map(drafts.map((draft) => [String(draft._id), draft]));
  const latestMetricByDraft = new Map();
  metricSnapshots.forEach((snapshot) => {
    const key = String(snapshot.draft_id || "");
    if (!key) return;
    const current = latestMetricByDraft.get(key) || { metrics: {}, utm_parameters: null, captured_at: null };
    Object.entries(numericMetrics(snapshot.metrics)).forEach(([metric, value]) => {
      if (!Object.hasOwn(current.metrics, metric)) current.metrics[metric] = value;
    });
    if (!current.utm_parameters && snapshot.utm_parameters) current.utm_parameters = asObject(snapshot.utm_parameters);
    if (!current.captured_at) current.captured_at = snapshot.captured_at;
    latestMetricByDraft.set(key, current);
  });
  const latestGa4 = latest.find((snapshot) => String(snapshot.provider || "").toUpperCase() === "GA4") || null;
  const { attributionRows, conversionRows } = attributionRowsFromSnapshot(latestGa4);
  const allPosts = allPublications.map((publication) => {
    const draft = draftById.get(String(publication.draft_id));
    const recommendation = draft?.current_package?.primaryRecommendation || {};
    const metricSnapshot = latestMetricByDraft.get(String(publication.draft_id));
    const utm = recommendation.utmParameters || metricSnapshot?.utm_parameters || null;
    const attribution = attributedMetricsForUtm({ utm, attributionRows, conversionRows });
    return {
      id: String(publication.draft_id),
      title: recommendation.internalTitle || recommendation.topic || "Published Instagram post",
      format: draft?.primary_format || recommendation.format || publication.content_type,
      content_pillar: draft?.primary_content_pillar || recommendation.contentPillar || null,
      objective: draft?.primary_objective || recommendation.objective || null,
      primary_kpi: trimText(draft?.primary_kpi || recommendation.primaryKpi).toUpperCase() || null,
      secondary_kpi: trimText(draft?.secondary_kpi || recommendation.secondaryKpi).toUpperCase() || null,
      published_at: publication.published_at,
      permalink: publication.external_permalink || null,
      metrics: { ...(metricSnapshot?.metrics || {}), ...attribution.metrics },
      utm_parameters: utm,
      attribution,
      learning_summary: null,
    };
  });
  const posts = allPosts.filter((post) => new Date(post.published_at || 0) >= since);
  const totals = sumMetricRecords(posts.map((post) => post.metrics));
  Object.entries(numericMetrics(latestGa4?.metrics)).forEach(([key, value]) => { totals[key] = value; });
  const reachOrViews = Number(totals.reach || totals.views || totals.video_views || 0);
  const rates = {};
  if (reachOrViews > 0) {
    if (Object.hasOwn(totals, "saves")) rates.save_rate = totals.saves / reachOrViews;
    if (Object.hasOwn(totals, "shares")) rates.share_rate = totals.shares / reachOrViews;
    if (Object.hasOwn(totals, "comments")) rates.comment_rate = totals.comments / reachOrViews;
    const interactions = ["likes", "comments", "saves", "shares"].filter((key) => Object.hasOwn(totals, key));
    if (interactions.length) rates.interaction_rate = interactions.reduce((sum, key) => sum + totals[key], 0) / reachOrViews;
  }
  const websiteSessions = totals.website_sessions;
  if (websiteSessions > 0) {
    if (Object.hasOwn(totals, "engaged_sessions")) rates.landing_page_engagement_rate = totals.engaged_sessions / websiteSessions;
    if (Object.hasOwn(totals, "quiz_starts")) rates.quiz_start_rate = totals.quiz_starts / websiteSessions;
    if (Object.hasOwn(totals, "workshop_enquiries")) rates.workshop_enquiry_rate = totals.workshop_enquiries / websiteSessions;
    if (Object.hasOwn(totals, "product_page_visits")) rates.product_page_visit_rate = totals.product_page_visits / websiteSessions;
    if (Object.hasOwn(totals, "affiliate_clicks")) rates.affiliate_click_rate = totals.affiliate_clicks / websiteSessions;
  }
  if (totals.quiz_starts > 0 && Object.hasOwn(totals, "quiz_completions")) rates.quiz_completion_rate = totals.quiz_completions / totals.quiz_starts;
  const baselines = posts.flatMap((post) => baselineRowsForPost(post, allPosts, now));
  posts.forEach((post) => {
    post.baseline_comparisons = baselines.filter((row) => row.post_id === post.id);
    post.objective_assessment = campaignObjectiveAssessment(post);
  });
  const campaignObjectiveAssessments = posts.map((post) => ({ post_id: post.id, ...post.objective_assessment }));
  const currentPlan = await (dependencies.SocialWeeklyPlan || SocialWeeklyPlan).findOne({}).sort({ week_start: -1 }).lean();
  const growth = currentPlan?.growth_analysis || null;
  return {
    range_label: `Previous ${safeDays} days`,
    refreshed_at: latest[0]?.captured_at || metricSnapshots[0]?.captured_at || null,
    metrics: totals,
    rates,
    baselines,
    campaign_objective_assessments: campaignObjectiveAssessments,
    attribution: {
      provider: "GA4",
      source: "instagram",
      medium: "organic_social",
      metrics: numericMetrics(latestGa4?.metrics),
      attribution_rows: attributionRows.slice(0, 250),
      conversion_event_rows: conversionRows.slice(0, 250),
      captured_at: latestGa4?.captured_at || null,
      period_start: latestGa4?.period_start || null,
      period_end: latestGa4?.period_end || null,
    },
    posts,
    learnings: [
      ...(growth?.whatWorked || []),
      ...(growth?.nextPlanInfluences || []),
    ],
    warnings: [
      "Observed associations do not establish causation. Missing provider metrics are unavailable, not zero.",
      ...(attributionRows.length > 250 || conversionRows.length > 250 ? ["GA4 detail rows are truncated in this view; stored aggregate history remains complete."] : []),
    ],
    historical_snapshots: latest,
    social_performance: social,
    growth_analysis: growth,
    interpretation: "Aggregates are directional and do not establish causation. Missing provider metrics remain unavailable rather than being converted to zero.",
  };
}

async function getConnections({ refresh = false, settings = null, dependencies = {} } = {}) {
  const canonicalSettings = settings || await (dependencies.getSocialManagerSettings || getSocialManagerSettings)();
  const connectors = dependencies.connectors || require("./socialGrowthConnectors");
  const liveVerifiedInstagramCapabilities = new Set();
  let instagramSummary = null;
  let instagramSummaryError = null;
  try {
    const getInstagramSummary = dependencies.getInstagramConnectionSummary
      || require("../instagramConnectionService").getInstagramConnectionSummary;
    instagramSummary = await getInstagramSummary();
  } catch (error) {
    instagramSummary = null;
    instagramSummaryError = {
      code: safeErrorCode(
        safeFailureText(error?.code || "INSTAGRAM_CONNECTION_SUMMARY_FAILED", 160),
        "INSTAGRAM_CONNECTION_SUMMARY_FAILED",
      ),
      message: "Instagram connection state could not be loaded. Inspect the encrypted connection store and server logs; this is an error, not a not-configured state.",
    };
  }
  const connectorSettings = {
    ...canonicalSettings,
    instagram: {
      provider: instagramSummary?.provider || "instagram_login",
      accountId: instagramSummary?.instagram_user_id || "",
      accountType: instagramSummary?.account_type || "",
      pageId: instagramSummary?.facebook_page_id || "",
      scopes: instagramSummary?.granted_scopes || [],
    },
  };
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const effectiveDependencies = {
    ...dependencies,
    ...(instagramSummary?.is_connected ? {
      getInstagramAccessToken: dependencies.getInstagramAccessToken || (async () => {
        const active = await require("../instagramConnectionService").getActiveInstagramConnection({ withTokens: true, refreshIfNeeded: true });
        return active.user_access_token;
      }),
    } : {}),
  };
  if (refresh) {
    const defaultChecks = {
      openai: async () => {
        const token = String(process.env.OPENAI_API_KEY || "").trim();
        if (!token) return false;
        const response = await (dependencies.fetchImpl || fetch)("https://api.openai.com/v1/models", {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10000),
        });
        return { ok: response.ok };
      },
      instagram: async () => {
        if (!instagramSummary?.is_connected || !instagramSummary?.instagram_user_id) return false;
        const instagramService = dependencies.instagramGrowthService || require("../instagramGrowthService");
        const probeInsightsAccess = typeof instagramService.probeInsightsAccess === "function"
          ? instagramService.probeInsightsAccess.bind(instagramService)
          : instagramService.getInsights.bind(instagramService);
        await probeInsightsAccess({
          objectId: instagramSummary.instagram_user_id,
          metrics: ["reach"],
          period: "day",
          dependencies,
        });
        liveVerifiedInstagramCapabilities.add("insights");
        return true;
      },
      ga4: async () => {
        await connectors.collectGa4Aggregate({
          startDate: yesterday,
          endDate: yesterday,
          dimensions: ["date"],
          metrics: ["sessions"],
          limit: 1,
          settings: connectorSettings,
          dependencies: effectiveDependencies,
        });
        return true;
      },
      search_console: async () => {
        await connectors.collectSearchConsoleAggregate({
          startDate: yesterday,
          endDate: yesterday,
          dimensions: ["date"],
          rowLimit: 1,
          settings: connectorSettings,
          dependencies: effectiveDependencies,
        });
        return true;
      },
    };
    effectiveDependencies.connectionChecks = {
      ...defaultChecks,
      ...(dependencies.connectionChecks || {}),
    };
  }
  const operation = refresh
    ? dependencies.checkAllConnections || connectors.checkAllConnections
    : dependencies.getConnectionOverview || connectors.getConnectionOverview;
  const result = await operation({ settings: connectorSettings, dependencies: effectiveDependencies });
  const rawConnections = result?.connectors || result?.connections || {};
  const normalizedConnections = Object.fromEntries(Object.entries(rawConnections).map(([key, connection]) => {
    const state = String(connection?.state || connection?.status || "NOT_CONFIGURED").toUpperCase();
    const capabilitySource = connection?.capabilities || connection?.capabilityMatrix?.capabilities || {};
    return [key, {
      ...clone(connection || {}),
      key,
      label: ({
        openai: "OpenAI",
        instagram: "Instagram / Meta",
        ga4: "Google Analytics 4",
        search_console: "Search Console",
        n8n: "n8n orchestration",
      })[key] || key,
      status: state,
      configured: connection?.configured === true || ["CONFIGURED", "CONNECTED"].includes(state),
      connected: connection?.connected === true || state === "CONNECTED",
      capabilities: capabilitySource,
      error: connection?.error?.message || connection?.message || null,
      error_code: connection?.error?.code || connection?.error_code || null,
      checked_at: connection?.checked ? (result?.checkedAt || new Date().toISOString()) : null,
    }];
  }));
  if (normalizedConnections.instagram?.status === "CONNECTED") {
    for (const capabilityName of liveVerifiedInstagramCapabilities) {
      normalizedConnections.instagram.capabilities[capabilityName] = {
        ...(normalizedConnections.instagram.capabilities[capabilityName] || { supported: true }),
        available: true,
        verification: "LIVE_PROVIDER_PROBE",
      };
    }
  }
  if (instagramSummaryError) {
    normalizedConnections.instagram = {
      ...(normalizedConnections.instagram || {}),
      key: "instagram",
      label: "Instagram / Meta",
      status: "ERROR",
      configured: Boolean(normalizedConnections.instagram?.configured),
      connected: false,
      capabilities: normalizedConnections.instagram?.capabilities || {},
      error: instagramSummaryError.message,
      error_code: instagramSummaryError.code,
      checked_at: new Date().toISOString(),
      warnings: [
        ...(normalizedConnections.instagram?.warnings || []),
        instagramSummaryError.message,
      ],
    };
  }
  normalizedConnections.internal_data = {
    key: "internal_data",
    label: "Pink Paisa data",
    status: "CONNECTED",
    configured: true,
    connected: true,
    checked_at: new Date().toISOString(),
    capabilities: { aggregate_internal_signals: { supported: true, available: true } },
  };
  const webhookConfigured = Boolean(
    String(process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN || "").trim()
      && String(process.env.INSTAGRAM_APP_SECRET || process.env.META_APP_SECRET || "").trim(),
  );
  normalizedConnections.meta_webhooks = {
    key: "meta_webhooks",
    label: "Meta webhooks",
    status: webhookConfigured ? "CONFIGURED" : "NOT_CONFIGURED",
    configured: webhookConfigured,
    connected: false,
    checked_at: null,
    capabilities: { signed_community_ingestion: { supported: true, available: webhookConfigured } },
    warnings: webhookConfigured ? ["Configuration is present; Meta delivery must still be confirmed in the App Dashboard."] : [],
  };
  const metaResearchConfigured = (
    (canonicalSettings.watchlists?.hashtags || []).length > 0
      && normalizedConnections.instagram?.capabilities?.hashtag_search?.available === true
  ) || (
    (canonicalSettings.watchlists?.competitor_accounts || []).length > 0
      && normalizedConnections.instagram?.capabilities?.business_discovery?.available === true
  );
  const allowlistedResearchConfigured = canonicalSettings.research?.enabled !== false
    && (canonicalSettings.research?.trusted_feeds_enabled === true
      || (canonicalSettings.research?.web_search_enabled === true
        && Array.isArray(canonicalSettings.research?.allow_domains)
        && canonicalSettings.research.allow_domains.length > 0));
  const researchConfigured = metaResearchConfigured || allowlistedResearchConfigured;
  normalizedConnections.research_sources = {
    key: "research_sources",
    label: "Research sources",
    status: researchConfigured ? "CONFIGURED" : "NOT_CONFIGURED",
    configured: researchConfigured,
    connected: false,
    checked_at: null,
    capabilities: {
      allowlisted_research: { supported: true, available: allowlistedResearchConfigured },
      meta_official_research: {
        supported: normalizedConnections.instagram?.capabilities?.hashtag_search?.supported === true
          || normalizedConnections.instagram?.capabilities?.business_discovery?.supported === true,
        available: metaResearchConfigured,
      },
    },
  };
  if (refresh && normalizedConnections.instagram) {
    try {
      const metaResearchRefresh = dependencies.refreshMetaResearchWatchlists || refreshMetaResearchWatchlists;
      const metaResearch = await metaResearchRefresh({
        settings: canonicalSettings,
        instagramSummary: instagramSummary || {},
        dependencies: effectiveDependencies,
      });
      normalizedConnections.instagram.research = metaResearch;
      if (!["OK", "NOT_CONFIGURED"].includes(metaResearch.state)) {
        normalizedConnections.instagram.warnings = [
          ...(normalizedConnections.instagram.warnings || []),
          metaResearch.message,
        ].filter(Boolean);
      }
    } catch (error) {
      const providerStatus = Number(error?.status || error?.statusCode || 0) || null;
      normalizedConnections.instagram.research = {
        state: "ERROR",
        checked_at: new Date().toISOString(),
        message: String(error?.message || "Official Meta research refresh failed").slice(0, 400),
        errors: [{
          code: error?.code || "META_RESEARCH_REFRESH_FAILED",
          message: String(error?.message || "Official Meta research refresh failed").slice(0, 400),
          ...(providerStatus ? { status: providerStatus } : {}),
          retryable: [408, 425, 429, 500, 502, 503, 504].includes(providerStatus),
        }],
      };
    }
  } else if (normalizedConnections.instagram) {
    try {
      const desk = await (dependencies.getMetaResearchDesk || getMetaResearchDesk)({
        settings: canonicalSettings,
        dependencies,
      });
      normalizedConnections.instagram.research = {
        state: desk.state || desk.status || "NOT_GENERATED",
        checked_at: desk.generated_at || null,
        message: desk.summary,
        errors: desk.errors || [],
      };
      if (!["READY", "OK", "NOT_GENERATED"].includes(normalizedConnections.instagram.research.state)) {
        normalizedConnections.instagram.warnings = [
          ...(normalizedConnections.instagram.warnings || []),
          desk.summary,
        ].filter(Boolean);
      }
    } catch (error) {
      normalizedConnections.instagram.research = {
        state: "ERROR",
        checked_at: null,
        message: String(error?.message || "Stored Meta research health could not be loaded").slice(0, 400),
        errors: [{ code: error?.code || "META_RESEARCH_HEALTH_UNAVAILABLE", message: String(error?.message || "Stored Meta research health could not be loaded").slice(0, 400) }],
      };
    }
  }
  if (refresh && rawConnections && typeof rawConnections === "object") {
    const HealthModel = dependencies.SocialConnectionHealth || SocialConnectionHealth;
    const providerMap = { openai: "OPENAI", instagram: "INSTAGRAM", ga4: "GA4", search_console: "SEARCH_CONSOLE", n8n: "N8N" };
    await Promise.all(Object.entries(normalizedConnections)
      .filter(([key]) => providerMap[key])
      .map(([key, connection]) => {
        const checkedAt = connection.checked_at ? new Date(connection.checked_at) : null;
        const providerStatus = connection.status === "CONFIGURED" ? "PENDING" : connection.status;
        const capabilities = Object.entries(connection.capabilities || {})
          .filter(([, value]) => value?.supported !== false)
          .map(([name]) => String(name).toUpperCase().replace(/[^A-Z0-9_]/g, "_"));
        const set = {
          provider: providerMap[key],
          display_name: connection.label,
          status: ["NOT_CONFIGURED", "PENDING", "CONNECTED", "DEGRADED", "ERROR", "DISCONNECTED", "REAUTHORIZATION_REQUIRED"].includes(providerStatus)
            ? providerStatus
            : "PENDING",
          configuration_source: connection.configured ? (key === "instagram" ? "MIXED" : key === "ga4" || key === "search_console" ? "SERVICE_ACCOUNT" : "ENVIRONMENT") : "NONE",
          configured: Boolean(connection.configured),
          capabilities,
          consecutive_failures: connection.status === "ERROR" ? 1 : 0,
        };
        if (checkedAt) {
          set.last_checked_at = checkedAt;
          set.latest_check = {
            check_key: `social-growth:${key}:${checkedAt.toISOString()}`,
            checked_at: checkedAt,
            status: set.status,
            error_code: connection.error ? (connection.error_code || "CONNECTION_CHECK_FAILED") : null,
            error_summary: connection.error || null,
          };
          if (set.status === "CONNECTED") set.last_success_at = checkedAt;
        }
        return HealthModel.findOneAndUpdate(
          { provider: providerMap[key] },
          { $set: set, $setOnInsert: { connection_key: `social-growth:${key}` } },
          { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true },
        );
      }));
  }
  return { ...result, connections: normalizedConnections };
}

module.exports = {
  approveCommunityReply,
  approveWeeklyPlan,
  executeWeeklyPlan,
  getAnalyticsSummary,
  getConnections,
  getCurrentWeeklyPlan,
  getMetaResearchDesk,
  ingestCommunityEvents,
  listCommunityItems,
  processPendingWeeklyPlans,
  processCommunityAutomation,
  publicCommunityItem,
  publicWeeklyPlan,
  recommendCommunityReply,
  redactCommunityText,
  refreshGrowthAnalytics,
  replaceWeeklyPlanSlot,
  rejectCommunityReply,
  rejectWeeklyPlan,
  requestWeeklyPlan,
  requestWeeklyPostProduction,
  runDueWeeklyPrepublication,
  sendApprovedCommunityReply,
  _private: {
    aggregateCommunityForAudience,
    buildSourceCatalogue,
    configuredPostingSlots,
    enforceCommunityEscalation,
    knownInternalDestinations,
    persistCommunityAutomationFailure,
    promptRun,
    resolvePlanningWindow,
    weeklyMixRole,
    validateCandidateInternalTruth,
    validatePlanSelection,
    validateWeeklyResearchAgainstCatalogue,
    metaDeskAsExternalResearch,
  },
};
