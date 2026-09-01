const crypto = require("crypto");
const os = require("os");
const mongoose = require("mongoose");
const logger = require("../../utils/logger");
const AdminSettings = require("../../models/AdminSettings");
const SocialAsset = require("../../models/SocialAsset");
const SocialAudioTrack = require("../../models/SocialAudioTrack");
const SocialAuditLog = require("../../models/SocialAuditLog");
const SocialGenerationRun = require("../../models/SocialGenerationRun");
const SocialGenerationUsageLedger = require("../../models/SocialGenerationUsageLedger");
const SocialManualAction = require("../../models/SocialManualAction");
const SocialMetricSnapshot = require("../../models/SocialMetricSnapshot");
const SocialPostDraft = require("../../models/SocialPostDraft");
const SocialPromptVersion = require("../../models/SocialPromptVersion");
const SocialPublication = require("../../models/SocialPublication");
const SocialResearchSource = require("../../models/SocialResearchSource");
const SocialWeeklyPlan = require("../../models/SocialWeeklyPlan");
const { sendSocialDraftReviewNotification } = require("../../utils/email");
const {
  SOCIAL_MANAGER_SETTINGS_KEY,
  buildSocialManagerRuntimeSettings,
  getSocialManagerSettings,
  saveSocialManagerSettings,
} = require("../../utils/socialManagerSettings");
const { getInstagramConnectionSummary } = require("../instagramConnectionService");
const {
  createCampaignAssetVersion,
  getGeneratedCampaignAssetReference,
  storeCampaignAsset,
} = require("../campaignAssetStorage");
const {
  renderSocialDraftAssets,
  validateSocialAsset,
  _private: { buildRenderItems: buildApprovedRenderItems },
} = require("../socialCreativeService");
const {
  cleanupStagedFullAiGraphic,
  generateSocialVisuals,
  stageSuppliedFullAiGraphic,
} = require("./socialAiImageService");
const openAiSocialProvider = require("./openAiSocialProvider");
const {
  buildPublicationFingerprint,
  buildUtmParameters,
  normalizeWhitespace,
  scanRecommendationCompliance,
  trimText,
  validateLandingPage,
} = require("./socialCompliance");
const {
  generateDailyDecision,
  getIstDateKey,
  _private: {
    buildComplianceReviewContext,
    legacyOnPostCopy,
    legacyVisualConcept,
  },
} = require("./socialDecisionEngine");
const { collectInternalSignals } = require("./socialInternalSignals");
const { collectExternalResearch } = require("./socialResearchService");
const { assembleReel, buildManualActions, buildSrt } = require("./socialReelAssemblyService");
const { resolveUsableAudioTrack } = require("./socialAudioLibraryService");
const { publicManualAction } = require("./socialManualActionService");
const { syncWeeklyPlanFromDraft } = require("./socialWeeklyPlanSyncService");
const { assertWeeklyPublicationCapacity, istDateKey } = require("./socialWeeklyLimit");
const { validatePinkPaisaLandingPage } = require("./socialLandingPageValidation");
const {
  validateFormatContent,
  validateRevisionResult,
  validateSocialPackage,
  validateVisualBrief,
} = require("./socialSchemas");
const { validateScopedContentRevision } = require("./socialRevisionGuard");
const {
  getSocialPublishingReadiness,
  publishingFeatureEnabled,
  queueSocialPublication,
} = require("./socialPublishingService");
const { buildSocialCaptionContract, isAffiliateRecommendation } = require("./socialCaptionPolicy");
const { resolveSocialVisualMode } = require("./socialVisualPolicy");

const GENERATION_LEASE_MS = 15 * 60 * 1000;
const GENERATION_WORKER_OWNER = `${os.hostname()}:${process.pid}:social:${crypto.randomUUID().slice(0, 8)}`;
const STAGE_MAP = Object.freeze({
  research: "MARKET_RESEARCH",
  market_analysis: "DAILY_MARKET_ANALYSIS",
  candidates: "CANDIDATE_GENERATION",
  strategy: "STRATEGY_SCORING",
  copy: "CONTENT_WRITING",
  format_copy: "CONTENT_WRITING",
  compliance: "COMPLIANCE_REVIEW",
  single_compliance: "COMPLIANCE_REVIEW",
  revision: "CONTENT_REVISION",
  visual: "VISUAL_DIRECTION",
  visual_brief: "VISUAL_BRIEF",
  imagepromptrevision: "IMAGE_PROMPT_REVISION",
  assembly: "FINAL_ASSEMBLY",
  weekly_research: "WEEKLY_RESEARCH_DIGEST",
  audience_intelligence: "AUDIENCE_INTELLIGENCE",
  weekly_candidates: "WEEKLY_CANDIDATE_GENERATION",
  weekly_plan: "WEEKLY_CONTENT_PLANNING",
  supervisor: "WEEKLY_SUPERVISION",
  growth_analytics: "GROWTH_ANALYSIS",
  community_reply: "COMMUNITY_REPLY_RECOMMENDATION",
});
const RUN_STAGE_MAP = Object.freeze({
  research: "RESEARCHING",
  market_analysis: "ANALYZING_MARKET",
  candidates: "GENERATING_CANDIDATES",
  strategy: "SCORING_CANDIDATES",
  copy: "WRITING_CONTENT",
  format_copy: "WRITING_CONTENT",
  compliance: "CHECKING_COMPLIANCE",
  single_compliance: "CHECKING_COMPLIANCE",
  revision: "REVISING_CONTENT",
  visual: "ASSEMBLING_RESULT",
  visual_brief: "BUILDING_VISUAL_BRIEF",
  imagepromptrevision: "GENERATING_IMAGES",
  assembly: "ASSEMBLING_RESULT",
  weekly_research: "RESEARCHING",
  audience_intelligence: "ANALYZING_MARKET",
  weekly_candidates: "GENERATING_CANDIDATES",
  weekly_plan: "SCORING_CANDIDATES",
  supervisor: "CHECKING_COMPLIANCE",
  growth_analytics: "ANALYZING_MARKET",
  community_reply: "WRITING_CONTENT",
});
const SCHEMA_NAME_MAP = Object.freeze({
  research: "RESEARCH_OUTPUT_SCHEMA",
  market_analysis: "DAILY_MARKET_ANALYSIS_SCHEMA",
  candidates: "CANDIDATES_OUTPUT_SCHEMA",
  strategy: "STRATEGY_OUTPUT_SCHEMA",
  copy: "COPY_OUTPUT_SCHEMA",
  format_copy: "FORMAT_CONTENT_OUTPUT_SCHEMA",
  compliance: "COMPLIANCE_OUTPUT_SCHEMA",
  single_compliance: "SINGLE_COMPLIANCE_REVIEW_SCHEMA",
  revision: "REVISION_OUTPUT_SCHEMA",
  visual: "VISUAL_OUTPUT_SCHEMA",
  visual_brief: "VISUAL_BRIEF_OUTPUT_SCHEMA",
  imagepromptrevision: "IMAGE_PROMPT_REVISION_OUTPUT_SCHEMA",
  assembly: "FINAL_SOCIAL_PACKAGE_SCHEMA",
  weekly_research: "WEEKLY_RESEARCH_DIGEST_SCHEMA",
  audience_intelligence: "AUDIENCE_INTELLIGENCE_SCHEMA",
  weekly_candidates: "WEEKLY_CANDIDATES_SCHEMA",
  weekly_plan: "WEEKLY_PLAN_SCHEMA",
  supervisor: "SUPERVISOR_RECOMMENDATION_SCHEMA",
  growth_analytics: "WEEKLY_ANALYTICS_REVIEW_SCHEMA",
  community_reply: "COMMUNITY_REPLY_RECOMMENDATION_SCHEMA",
});
const SCHEMA_VERSION_MAP = Object.freeze({
  market_analysis: "3.0.0",
  revision: "3.0.0",
  visual: "3.0.0",
  visual_brief: "3.0.0",
  assembly: "4.0.0",
});
const PROMPT_KEY_MAP = Object.freeze({
  market_analysis: "market_analysis",
  format_copy: "format_copy",
  single_compliance: "single_compliance",
  revision: "revision",
  visual_brief: "visual_brief",
  imagepromptrevision: "imagePromptRevision",
});
const SOCIAL_FORMAT_PREFERENCES = new Set([
  "AUTO_CHOOSE",
  "SINGLE_IMAGE",
  "CAROUSEL",
  "REEL",
  "VIDEO_FEED",
  "STORY",
  "INFOGRAPHIC",
  "MEME",
  "POLL",
  "QUIZ",
  "PRODUCT_FEATURE",
  "RESOURCE_PROMOTION",
  "EVENT_OR_WORKSHOP_PROMOTION",
]);
const SOCIAL_GENERATION_TYPES = new Set(["TODAY", "SINGLE_POST", "CAROUSEL", "PRODUCT_POST"]);
const SOCIAL_VISUAL_MODES = new Set(["AI_VISUAL_WITH_EXACT_OVERLAY", "AI_ARTWORK_ONLY", "FULL_AI_GRAPHIC"]);

function applyMongoSession(query, session) {
  return session && query && typeof query.session === "function" ? query.session(session) : query;
}

function bindModelToMongoSession(Model, session) {
  if (!session || !Model) return Model;
  return new Proxy(Model, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      if (["find", "findOne", "findById", "exists", "countDocuments"].includes(property)) {
        return (...args) => {
          const optionsIndex = ["exists", "countDocuments"].includes(property) ? 1 : 2;
          const options = args[optionsIndex] && typeof args[optionsIndex] === "object" ? args[optionsIndex] : {};
          args[optionsIndex] = { ...options, session };
          return applyMongoSession(value.apply(target, args), session);
        };
      }
      if (["findOneAndUpdate", "findByIdAndUpdate", "updateMany", "updateOne", "deleteMany", "deleteOne"].includes(property)) {
        return (...args) => {
          const optionsIndex = 2;
          const options = args[optionsIndex] && typeof args[optionsIndex] === "object" ? args[optionsIndex] : {};
          args[optionsIndex] = { ...options, session };
          return value.apply(target, args);
        };
      }
      if (property === "insertMany") {
        return (documents, options = {}) => value.call(target, documents, { ...options, session });
      }
      if (property === "create") {
        return async (record, options = {}) => {
          if (Array.isArray(record)) return value.call(target, record, { ...options, session });
          const created = await value.call(target, [record], { ...options, session });
          return Array.isArray(created) ? created[0] : created;
        };
      }
      return value.bind(target);
    },
  });
}

async function createWithSession(Model, record, session) {
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
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

function normalizeGenerationRequest(input = {}) {
  const generationType = trimText(input.generation_type || input.generationType || "TODAY").toUpperCase();
  let formatPreference = trimText(
    input.requested_format
    || input.requestedFormat
    || input.format_preference
    || input.formatPreference
    || "AUTO_CHOOSE"
  ).toUpperCase();
  if (formatPreference === "AUTO") formatPreference = "AUTO_CHOOSE";
  if (formatPreference === "POLL_CONCEPT") formatPreference = "POLL";
  if (formatPreference === "WORKSHOP_PROMOTION") formatPreference = "EVENT_OR_WORKSHOP_PROMOTION";
  if (generationType === "SINGLE_POST" && formatPreference === "AUTO_CHOOSE") formatPreference = "SINGLE_IMAGE";
  if (generationType === "CAROUSEL") formatPreference = "CAROUSEL";
  if (generationType === "PRODUCT_POST" && formatPreference === "AUTO_CHOOSE") formatPreference = "PRODUCT_FEATURE";
  const generationScope = trimText(input.generation_scope || input.generationScope || "FULL_POST").toUpperCase();
  const visualMode = trimText(input.visual_mode || input.visualMode || "AI_VISUAL_WITH_EXACT_OVERLAY").toUpperCase();
  if (!SOCIAL_GENERATION_TYPES.has(generationType)) {
    const error = new Error("generation_type must be TODAY, SINGLE_POST, CAROUSEL, or PRODUCT_POST");
    error.code = "social_generation_request_invalid";
    error.statusCode = 400;
    throw error;
  }
  if (!SOCIAL_FORMAT_PREFERENCES.has(formatPreference)) {
    const error = new Error("format_preference is not a supported Social Media Manager format");
    error.code = "social_generation_request_invalid";
    error.statusCode = 400;
    throw error;
  }
  if (!["FULL_POST", "STRATEGY", "COPY", "IMAGE", "FORMAT_CHANGE", "COMPLIANCE"].includes(generationScope)) {
    const error = new Error("generation_scope is not supported");
    error.code = "social_generation_request_invalid";
    error.statusCode = 400;
    throw error;
  }
  if (!SOCIAL_VISUAL_MODES.has(visualMode)) {
    const error = new Error("visual_mode must be AI_VISUAL_WITH_EXACT_OVERLAY, AI_ARTWORK_ONLY, or FULL_AI_GRAPHIC");
    error.code = "social_generation_request_invalid";
    error.statusCode = 400;
    throw error;
  }
  const adminInstructions = trimText(input.admin_instructions || input.adminInstructions).slice(0, 4000) || null;
  const productId = trimText(input.verified_product_id || input.verifiedProductId || input.product_id || input.productId).slice(0, 100) || null;
  const suppliedResolution = input.visual_mode_resolution || input.visualModeResolution || null;
  return {
    requested_format: formatPreference,
    requested_post_type: trimText(input.requested_post_type || input.post_type || input.postType).slice(0, 100)
      || (generationType === "PRODUCT_POST" ? "PRODUCT" : null),
    generation_scope: generationScope,
    visual_mode: visualMode,
    visual_mode_resolution: suppliedResolution && typeof suppliedResolution === "object"
      ? {
        requested: trimText(suppliedResolution.requested || visualMode).toUpperCase(),
        effective: trimText(suppliedResolution.effective || visualMode).toUpperCase(),
        eligible: suppliedResolution.eligible !== false,
        reasons: safeArray(suppliedResolution.reasons).map((reason) => trimText(reason)).filter(Boolean),
      }
      : null,
    admin_instructions: adminInstructions,
    verified_product_id: productId,
    weekly_candidate: input.weekly_candidate && typeof input.weekly_candidate === "object"
      ? clone(input.weekly_candidate)
      : input.weeklyCandidate && typeof input.weeklyCandidate === "object"
        ? clone(input.weeklyCandidate)
        : null,
    required_landing_page: trimText(input.required_landing_page || input.requiredLandingPage).slice(0, 2048) || null,
    request_id: trimText(input.request_id || input.requestId).slice(0, 200) || null,
  };
}

function estimateOpenAiCostUsd(usage = {}) {
  const inputRate = Math.max(Number(process.env.SOCIAL_MANAGER_OPENAI_INPUT_USD_PER_MILLION || 0), 0);
  const outputRate = Math.max(Number(process.env.SOCIAL_MANAGER_OPENAI_OUTPUT_USD_PER_MILLION || 0), 0);
  return Number((
    Number(usage.input_tokens || 0) * inputRate / 1_000_000
    + Number(usage.output_tokens || 0) * outputRate / 1_000_000
  ).toFixed(6));
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  if (!value) return null;
  return typeof value.toObject === "function" ? value.toObject() : value;
}

function actorId(actor) {
  return actor?._id || actor?.id || actor || null;
}

function sourceIpHash(value) {
  return value ? sha256(`${process.env.SOCIAL_AUDIT_IP_SALT || "pink-paisa-social"}:${value}`) : null;
}

function publicAsset(asset) {
  const value = asObject(asset) || {};
  const manualReviewApproved = value.manual_review_status === "approved";
  const validationChecklist = (value.validation_checklist || []).map((check) => {
    if (!manualReviewApproved || check?.key !== "manual_visual_review") return check;
    return {
      ...check,
      status: "PASS",
      details: "Approved by an authorized reviewer",
    };
  });
  const validationStatus = manualReviewApproved && value.validation_status === "needs_manual_review"
    ? "valid"
    : value.validation_status || null;
  return {
    id: String(value._id || value.id || ""),
    asset_group_id: value.asset_group_id || null,
    asset_role: value.asset_role || null,
    asset_type: value.asset_type || null,
    media_kind: value.media_kind || null,
    publication_role: value.publication_role || null,
    social_format: value.social_format || null,
    canvas_format: value.canvas_format || null,
    slide_number: value.slide_number || null,
    url: value.url || null,
    mime_type: value.mime_type || null,
    file_size_bytes: value.file_size_bytes ?? null,
    width: value.width || null,
    height: value.height || null,
    aspect_ratio: value.aspect_ratio || null,
    duration_seconds: value.duration_seconds ?? null,
    frame_rate_fps: value.frame_rate_fps ?? null,
    video_codec: value.video_codec || null,
    audio_codec: value.audio_codec || null,
    subtitle_language: value.subtitle_language || null,
    renderer: value.renderer || null,
    visual_mode: value.visual_mode || null,
    validation_status: validationStatus,
    validation_checklist: validationChecklist,
    manual_review_required: manualReviewApproved ? false : Boolean(value.manual_review_required),
    manual_review_flags: manualReviewApproved ? [] : value.manual_review_flags || [],
    manual_review_status: value.manual_review_status || null,
    provenance: value.provenance || null,
    source_provenance: value.source_provenance || null,
    usage_rights_status: value.usage_rights_status || null,
    reference_assets: value.reference_assets || [],
    original_asset_url: value.original_asset_url || value.original_visual?.url || value.provenance?.base_image?.original_asset_url || value.provenance?.base_image?.source_url || null,
    original_visual: value.original_visual || null,
    image_generation_status: value.image_generation_status || value.provenance?.base_image?.generation_status || null,
    image_provider: value.image_provider || value.provenance?.base_image?.provider || null,
    image_model: value.image_model || value.provenance?.base_image?.model || null,
    image_response_id: value.provider_response_id || value.image_response_id || value.provenance?.base_image?.response_id || null,
    image_prompt: value.image_prompt || value.provenance?.base_image?.prompt || null,
    image_attempt_count: Number(value.image_retry_number ?? value.image_attempt_count ?? value.provenance?.base_image?.attempt_count ?? 0),
    image_usage: value.image_usage || null,
    image_estimated_cost: Number(value.image_estimated_cost || 0),
    is_active: value.is_active !== false,
    created_at: value.created_at || null,
  };
}

function publicSource(source) {
  const value = asObject(source) || {};
  return {
    id: String(value._id || value.id || ""),
    title: value.title || null,
    url: value.url || null,
    publisher: value.publisher || null,
    domain: value.domain || null,
    published_at: value.published_at || null,
    accessed_at: value.accessed_at || null,
    excerpt: value.excerpt || null,
    summary: value.summary || null,
    claim_supported: value.claim_supported || null,
    confidence: value.confidence ?? null,
    freshness: value.freshness || null,
    freshness_days: value.freshness_days ?? null,
    source_type: value.source_type || null,
    validation_status: value.validation_status || null,
    is_safe_to_use: Boolean(value.is_safe_to_use),
    used_in_final: Boolean(value.used_in_final),
    influenced_decision: Boolean(value.used_in_final || value.recommendation_paths?.length),
    recommendation_paths: value.recommendation_paths || [],
    prompt_injection_suspected: Boolean(value.prompt_injection_suspected),
    validation_reasons: value.validation_reasons || [],
  };
}

function publicAudit(log) {
  const value = asObject(log) || {};
  return {
    id: String(value._id || value.id || ""),
    event_id: value.event_id || null,
    action: value.action || null,
    action_status: value.action_status || null,
    actor_type: value.actor_type || null,
    actor_label: value.actor_label || null,
    summary: value.summary || null,
    field_changes: value.field_changes || [],
    retry_count: value.retry_count || 0,
    error_code: value.error_code || null,
    error_message: value.error_message || null,
    metadata: value.metadata || null,
    created_at: value.created_at || null,
  };
}

function publicMetric(snapshot) {
  const value = asObject(snapshot) || {};
  return {
    id: String(value._id || value.id || ""),
    source: value.source,
    retrieval_status: value.retrieval_status,
    captured_at: value.captured_at,
    metrics: value.metrics || {},
    provenance_note: value.provenance_note,
    attribution_window_hours: value.attribution_window_hours ?? null,
  };
}

function publicRun(run) {
  const value = asObject(run);
  if (!value) return null;
  return {
    id: String(value._id || value.id || ""),
    generation_date: value.generation_date,
    timezone: value.timezone,
    trigger_type: value.trigger_type,
    generation_request: value.generation_request || null,
    generation_mode: value.generation_mode || null,
    full_ai_generation: value.full_ai_generation !== false,
    status: value.status,
    current_stage: value.current_stage,
    queued_at: value.queued_at,
    started_at: value.started_at,
    completed_at: value.completed_at,
    finished_at: value.finished_at || null,
    selected_draft_id: value.selected_draft_id ? String(value.selected_draft_id) : null,
    failed_draft_id: value.failed_draft_id ? String(value.failed_draft_id) : null,
    attempt_count: value.attempt_count || 0,
    retry_count: value.retry_count || 0,
    max_attempts: value.max_attempts || 0,
    next_retry_at: value.next_retry_at || null,
    used_fallback: Boolean(value.used_fallback),
    fallback_reason: value.fallback_reason || null,
    research_mode: value.research_mode || null,
    candidate_count: value.candidate_count || 0,
    candidate_summaries: value.candidate_summaries || [],
    market_analysis: value.daily_market_analysis || value.market_analysis || null,
    content_revision_attempts: value.content_revision_attempts || [],
    compliance_history: value.compliance_history || value.content_revision_attempts || [],
    image_generation_status: value.image_generation_status || "NOT_STARTED",
    image_generation_attempts: value.image_generation_attempts || [],
    image_generation: value.image_generation || {
      status: value.image_generation_status || "NOT_STARTED",
      attempts: value.image_generation_attempts || [],
    },
    stage_executions: value.stage_executions || [],
    usage: value.usage || {},
    last_error: value.last_error || null,
  };
}

function publicDraft(draft, { assets = [], sources = [], audits = [], metrics = [], manualActions = [], publication = null, generationRun = null } = {}) {
  const value = asObject(draft);
  if (!value) return null;
  const captionContract = buildSocialCaptionContract(value.current_package?.primaryRecommendation || {});
  return {
    id: String(value._id || value.id || ""),
    generation_run_id: String(value.generation_run_id || ""),
    weekly_plan_id: value.weekly_plan_id ? String(value.weekly_plan_id) : null,
    candidate_id: value.candidate_id || null,
    bundle_id: value.bundle_id || null,
    bundle_role: value.bundle_role || null,
    parent_draft_id: value.parent_draft_id ? String(value.parent_draft_id) : null,
    weekly_slot_number: value.weekly_slot_number ?? null,
    week_start: value.week_start || null,
    week_end: value.week_end || null,
    generation_mode: value.generation_mode || null,
    visual_mode: value.visual_mode || null,
    visual_mode_resolution: value.visual_mode_resolution || null,
    full_ai_ready: Boolean(value.full_ai_ready),
    status: value.status,
    generation_date: value.generation_date,
    timezone: value.timezone,
    revision: value.revision,
    result: value.result_json,
    current_package: value.current_package,
    caption_contract: captionContract,
    assets: assets.map(publicAsset),
    approval: value.approval_json || null,
    schedule: value.schedule_json || null,
    publication: publication ? asObject(publication) : (value.publication_json || null),
    compliance: value.compliance_summary || null,
    duplicate_analysis: value.duplicate_analysis || null,
    creative_readiness: value.creative_readiness || null,
    original_ai_asset_ids: (value.original_ai_asset_ids || []).map(String),
    final_composed_asset_ids: (value.final_composed_asset_ids || value.asset_ids || []).map(String),
    audio_track_id: value.audio_track_id ? String(value.audio_track_id) : null,
    selected_audio_track: value.audio_selection_json || null,
    research_sources: sources.map(publicSource),
    audit_logs: audits.map(publicAudit),
    metric_snapshots: metrics.map(publicMetric),
    manual_actions: manualActions.map(publicManualAction),
    primary_topic: value.primary_topic || value.current_package?.primaryRecommendation?.topic || null,
    primary_score: value.primary_total_score ?? value.current_package?.primaryRecommendation?.scoreBreakdown?.total ?? null,
    primary_confidence: value.primary_confidence ?? value.current_package?.primaryRecommendation?.confidence ?? null,
    scheduled_for: value.scheduled_for || null,
    published_at: value.published_at || null,
    last_error: value.last_error || null,
    created_at: value.created_at,
    updated_at: value.updated_at,
    generation_run: publicRun(generationRun),
    market_analysis: asObject(generationRun)?.daily_market_analysis || null,
    internal_signals: asObject(generationRun)?.internal_signal_summary || null,
    strategy_selection: {
      candidate_count: asObject(generationRun)?.candidate_count || 0,
      candidates: asObject(generationRun)?.candidate_summaries || [],
    },
  };
}

function stableIntegrityJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableIntegrityJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableIntegrityJson(value[key])}`).join(",")}}`;
}

function sha256Object(value) {
  return crypto.createHash("sha256").update(stableIntegrityJson(value)).digest("hex");
}

function isSha256(value) {
  return /^[a-f0-9]{64}$/.test(trimText(value).toLowerCase());
}

function zeroTextLogoValidationPassed(validation = {}) {
  return String(validation.decision || "").toUpperCase() === "PASS"
    && validation.hasVisibleText === false
    && validation.hasLogoOrWatermark === false
    && !trimText(validation.observedText || validation.observed_text)
    && validation.validated_asset === "openai_provider_original"
    && Boolean(trimText(validation.response_id || validation.responseId));
}

function exactHeadlineValidationPassed(validation = {}, expectedHeadline = "") {
  return String(validation.decision || "").toUpperCase() === "PASS"
    && validation.exactHeadlineMatch === true
    && trimText(validation.observedText || validation.observed_text) === trimText(expectedHeadline)
    && Boolean(trimText(validation.response_id || validation.responseId));
}

function normalizeFullAiTextManifest(value) {
  if (!Array.isArray(value) || !value.length || value.length > 40) {
    const error = new Error("FULL_AI_GRAPHIC v2 requires an explicit ordered visible-text manifest of 1 to 40 blocks");
    error.code = "social_full_ai_graphic_text_contract_invalid";
    error.statusCode = 400;
    throw error;
  }
  const blocks = value.map((block, index) => ({
    key: trimText(block?.key || `text_${index + 1}`).slice(0, 80),
    text: trimText(block?.text),
  }));
  if (blocks.some((block) => !block.key || !block.text || block.text.length > 500)
    || new Set(blocks.map((block) => block.key)).size !== blocks.length) {
    const error = new Error("Every FULL_AI_GRAPHIC visible-text manifest block requires a unique key and exact text of at most 500 characters");
    error.code = "social_full_ai_graphic_text_contract_invalid";
    error.statusCode = 400;
    throw error;
  }
  return blocks;
}

function fullAiDraftManifestFromAssets(assets = []) {
  const finalGraphics = safeArray(assets)
    .map((asset) => asObject(asset) || {})
    .filter((asset) => asset.asset_role === "FINAL_COMPOSED"
      && asset.media_kind === "IMAGE"
      && asset.visual_mode === "FULL_AI_GRAPHIC"
      && Number(asset.provenance?.full_ai_graphic_contract_version || 0) === 2)
    .sort((left, right) => Number(left.slide_number || 1) - Number(right.slide_number || 1));
  if (!finalGraphics.length) return null;
  const rows = finalGraphics.map((asset) => ({
    sequence: Number(asset.slide_number || 1),
    blocks: normalizeFullAiTextManifest(asset.provenance?.full_ai_graphic_manifest?.expected_text_blocks),
    approved_copy_checksum_sha256: trimText(asset.approved_copy_checksum_sha256).toLowerCase(),
  }));
  const expectedTextBlocks = rows.length === 1
    ? rows[0].blocks
    : rows.flatMap((row) => row.blocks.map((block) => ({
      key: `asset_${row.sequence}_${block.key}`.slice(0, 80),
      text: block.text,
    })));
  return {
    contract_version: 2,
    expected_text_blocks: normalizeFullAiTextManifest(expectedTextBlocks),
    checksum_sha256: sha256Object(expectedTextBlocks),
    approved_copy_checksum_sha256: rows.length === 1
      ? rows[0].approved_copy_checksum_sha256
      : sha256Object(rows.map((row) => ({
        sequence: row.sequence,
        approved_copy_checksum_sha256: row.approved_copy_checksum_sha256,
      }))),
    generation_tool: "openai_image_api",
    tool_execution_id: null,
    updated_at: new Date(),
  };
}

function applyFullAiDraftManifest(draft, assets = []) {
  const manifest = fullAiDraftManifestFromAssets(assets);
  draft.full_ai_graphic_manifest = manifest;
  return manifest;
}

function fullAiPosterValidationPassed(validation = {}, expectedTextBlocks = []) {
  const expected = safeArray(expectedTextBlocks).map((block) => trimText(block?.text)).filter(Boolean);
  const observed = safeArray(validation.observedTextBlocks || validation.observed_text_blocks).map(trimText);
  return expected.length > 0
    && String(validation.decision || "").toUpperCase() === "PASS"
    && validation.exactTextMatch === true
    && validation.brandIdentityMatch === true
    && validation.mobileLegible === true
    && validation.safeAreaPassed === true
    && validation.unapprovedTextPresent === false
    && validation.unrelatedLogoOrWatermarkPresent === false
    && validation.validated_asset === "openai_normalized_final"
    && JSON.stringify(observed) === JSON.stringify(expected)
    && Boolean(trimText(validation.response_id || validation.responseId));
}

function retainedNativeFullAiProviderOriginalPassed(asset = {}) {
  const base = asset.provenance?.base_image || {};
  const providerOriginal = base.provider_original || {};
  const originalVisual = asset.original_visual || {};
  const normalization = base.normalization || {};
  const providerChecksum = trimText(providerOriginal.checksum_sha256).toLowerCase();
  const normalizedChecksum = trimText(base.checksum_sha256).toLowerCase();
  const providerResponseId = trimText(providerOriginal.response_id);
  const generationTool = trimText(providerOriginal.generation_tool).toLowerCase();
  const toolExecutionId = trimText(providerOriginal.tool_execution_id);
  const stableGenerationIdentityPassed = providerResponseId
    ? providerResponseId === trimText(asset.provider_response_id)
      && providerResponseId === trimText(base.response_id)
    : generationTool === "codex_builtin_imagegen"
      && Boolean(toolExecutionId)
      && !trimText(asset.provider_response_id)
      && !trimText(base.response_id)
      && generationTool === trimText(base.generation_tool).toLowerCase()
      && toolExecutionId === trimText(base.tool_execution_id);
  return String(providerOriginal.provider || "").toLowerCase() === "openai"
    && providerOriginal.byte_preserving === true
    && Boolean(trimText(providerOriginal.model))
    && stableGenerationIdentityPassed
    && Boolean(trimText(providerOriginal.url))
    && ["local", "external"].includes(String(providerOriginal.storage_provider || "").toLowerCase())
    && Boolean(trimText(providerOriginal.storage_key))
    && isSha256(providerChecksum)
    && ["image/jpeg", "image/png", "image/webp"].includes(String(providerOriginal.mime_type || "").toLowerCase())
    && Number(providerOriginal.file_size_bytes || 0) > 0
    && Number(providerOriginal.width || 0) > 0
    && Number(providerOriginal.height || 0) > 0
    && base.original_asset_url === providerOriginal.url
    && originalVisual.url === providerOriginal.url
    && originalVisual.storage_provider === providerOriginal.storage_provider
    && originalVisual.storage_key === providerOriginal.storage_key
    && trimText(originalVisual.checksum_sha256).toLowerCase() === providerChecksum
    && originalVisual.mime_type === providerOriginal.mime_type
    && Number(originalVisual.file_size_bytes || 0) === Number(providerOriginal.file_size_bytes)
    && Number(originalVisual.width || 0) === Number(providerOriginal.width)
    && Number(originalVisual.height || 0) === Number(providerOriginal.height)
    && String(asset.image_provider || "").toLowerCase() === "openai"
    && asset.image_model === providerOriginal.model
    && base.model === providerOriginal.model
    && normalization.renderer === "sharp_resize_encode_only_v1"
    && normalization.resize_fit === "fill"
    && normalization.pixel_overlay_applied === false
    && trimText(normalization.source_checksum_sha256).toLowerCase() === providerChecksum
    && isSha256(normalizedChecksum)
    && trimText(normalization.output_checksum_sha256).toLowerCase() === normalizedChecksum
    && trimText(normalization.output_url) === trimText(base.source_url);
}

function approvedCopyIntegrityPassed(asset = {}, expectedCopy = null) {
  const overlay = asset.overlay_json || {};
  const approvedCopy = overlay.approved_copy;
  const checksum = trimText(asset.approved_copy_checksum_sha256).toLowerCase();
  const overlayChecksum = trimText(overlay.approved_copy_checksum_sha256).toLowerCase();
  const provenanceChecksum = trimText(asset.provenance?.overlay?.approved_copy_checksum_sha256).toLowerCase();
  return approvedCopy && typeof approvedCopy === "object"
    && isSha256(checksum)
    && checksum === overlayChecksum
    && checksum === provenanceChecksum
    && checksum === sha256Object(approvedCopy)
    && (!expectedCopy || stableIntegrityJson(approvedCopy) === stableIntegrityJson(expectedCopy));
}

function retainedProviderOriginalPassed(asset = {}) {
  const base = asset.provenance?.base_image || {};
  const providerOriginal = base.provider_original || {};
  const originalVisual = asset.original_visual || {};
  const normalization = base.normalization || {};
  const providerChecksum = trimText(providerOriginal.checksum_sha256).toLowerCase();
  const normalizedChecksum = trimText(base.checksum_sha256).toLowerCase();
  return String(providerOriginal.provider || "").toLowerCase() === "openai"
    && providerOriginal.byte_preserving === true
    && Boolean(trimText(providerOriginal.model))
    && Boolean(trimText(providerOriginal.response_id))
    && Boolean(trimText(providerOriginal.url))
    && ["local", "external"].includes(String(providerOriginal.storage_provider || "").toLowerCase())
    && Boolean(trimText(providerOriginal.storage_key))
    && isSha256(providerChecksum)
    && ["image/jpeg", "image/png", "image/webp"].includes(String(providerOriginal.mime_type || "").toLowerCase())
    && Number(providerOriginal.file_size_bytes || 0) > 0
    && Number(providerOriginal.width || 0) > 0
    && Number(providerOriginal.height || 0) > 0
    && asset.original_asset_url === providerOriginal.url
    && base.original_asset_url === providerOriginal.url
    && originalVisual.url === providerOriginal.url
    && originalVisual.storage_provider === providerOriginal.storage_provider
    && originalVisual.storage_key === providerOriginal.storage_key
    && trimText(originalVisual.checksum_sha256).toLowerCase() === providerChecksum
    && originalVisual.mime_type === providerOriginal.mime_type
    && Number(originalVisual.file_size_bytes || 0) === Number(providerOriginal.file_size_bytes)
    && Number(originalVisual.width || 0) === Number(providerOriginal.width)
    && Number(originalVisual.height || 0) === Number(providerOriginal.height)
    && String(asset.image_provider || "").toLowerCase() === "openai"
    && asset.image_model === providerOriginal.model
    && asset.provider_response_id === providerOriginal.response_id
    && base.model === providerOriginal.model
    && base.response_id === providerOriginal.response_id
    && normalization.renderer === "sharp_crop_resize_encode_v1"
    && trimText(normalization.source_checksum_sha256).toLowerCase() === providerChecksum
    && isSha256(normalizedChecksum)
    && trimText(normalization.output_checksum_sha256).toLowerCase() === normalizedChecksum;
}

function buildCaptionPolicyProvenance(recommendation = {}) {
  const contract = buildSocialCaptionContract(recommendation);
  const story = trimText(recommendation.format).toUpperCase() === "STORY";
  return {
    method: story ? "story_frame_overlay" : "instagram_caption_only",
    component_order: contract.component_order,
    cta_placement: story ? "final_frame" : "caption_only",
    affiliate_disclosure_placement: story ? "first_frame" : "caption_only",
    financial_disclaimer_placement: story ? "final_frame" : "caption_only",
    affiliate_disclosure_required: Boolean(contract.components.affiliate_disclosure),
    cta_required: true,
    financial_disclaimer_required: Boolean(contract.components.financial_disclaimer),
    instagram_caption_used: !story,
    caption_checksum_sha256: story ? null : contract.checksum_sha256,
    caption_contract_valid: contract.valid,
    caption_contract_violations: contract.violations,
  };
}

function captionPolicyPassed(asset = {}, expectedFormat, recommendation = {}) {
  const policy = asset.provenance?.caption_policy || {};
  const contract = buildSocialCaptionContract(recommendation);
  const expectedOrder = JSON.stringify(contract.component_order);
  const common = JSON.stringify(safeArray(policy.component_order)) === expectedOrder
    && policy.caption_contract_valid === true
    && safeArray(policy.caption_contract_violations).length === 0
    && policy.cta_required === true
    && policy.affiliate_disclosure_required === Boolean(contract.components.affiliate_disclosure)
    && policy.financial_disclaimer_required === Boolean(contract.components.financial_disclaimer);
  if (expectedFormat === "STORY") {
    return common
      && policy.method === "story_frame_overlay"
      && policy.affiliate_disclosure_placement === "first_frame"
      && policy.cta_placement === "final_frame"
      && policy.financial_disclaimer_placement === "final_frame"
      && policy.instagram_caption_used === false
      && (policy.caption_checksum_sha256 === null || policy.caption_checksum_sha256 === undefined);
  }
  return common
    && policy.method === "instagram_caption_only"
    && policy.affiliate_disclosure_placement === "caption_only"
    && policy.cta_placement === "caption_only"
    && policy.financial_disclaimer_placement === "caption_only"
    && policy.instagram_caption_used === true
    && isSha256(policy.caption_checksum_sha256)
    && policy.caption_checksum_sha256 === contract.checksum_sha256;
}

function visualModeProvenancePassed(asset = {}, effectiveVisualMode, expectedCopy = null, draftFullAiManifest = null) {
  const provenance = asset.provenance || {};
  const base = provenance.base_image || {};
  const overlayProvenance = provenance.overlay || {};
  const overlay = asset.overlay_json || {};
  const textRendering = overlay.text_rendering || {};
  const selfCopyIntegrity = approvedCopyIntegrityPassed(asset);

  if (effectiveVisualMode === "AI_ARTWORK_ONLY") {
    const baseValidation = base.artwork_validation || {};
    const overlayValidation = textRendering.artwork_only_visual_validation || {};
    return asset.renderer === "sharp_resize_only"
      && provenance.renderer === "sharp_resize_only"
      && overlayProvenance.method === "none"
      && overlayProvenance.image_ai_used_for_text === false
      && !overlayProvenance.copy_source
      && textRendering.method === "none"
      && textRendering.image_ai_used_for_text === false
      && overlay.brand_name == null
      && !overlay.logo?.source
      && !provenance.logo?.source
      && selfCopyIntegrity
      && retainedProviderOriginalPassed(asset)
      && zeroTextLogoValidationPassed(baseValidation)
      && zeroTextLogoValidationPassed(overlayValidation)
      && trimText(baseValidation.response_id) === trimText(overlayValidation.response_id);
  }

  if (effectiveVisualMode === "AI_VISUAL_WITH_EXACT_OVERLAY") {
    return asset.renderer === "sharp_svg_overlay"
      && provenance.renderer === "sharp_svg_overlay"
      && overlayProvenance.method === "sharp_svg_overlay"
      && overlayProvenance.image_ai_used_for_text === false
      && Boolean(trimText(overlayProvenance.copy_source))
      && textRendering.method === "sharp_svg_overlay"
      && textRendering.image_ai_used_for_text === false
      && overlay.brand_name === "Pink Paisa"
      && Boolean(trimText(overlay.logo?.source))
      && Boolean(trimText(provenance.logo?.source))
      && approvedCopyIntegrityPassed(asset, expectedCopy);
  }

  if (effectiveVisualMode === "FULL_AI_GRAPHIC") {
    if (Number(provenance.full_ai_graphic_contract_version || 0) === 2) {
      let expectedBlocks;
      let storedBlocks;
      try {
        expectedBlocks = normalizeFullAiTextManifest(draftFullAiManifest?.expected_text_blocks);
        storedBlocks = normalizeFullAiTextManifest(provenance.full_ai_graphic_manifest?.expected_text_blocks);
      } catch (_error) {
        return false;
      }
      const sequencePrefix = `asset_${Number(asset.slide_number || 1)}_`;
      let assetExpectedBlocks = expectedBlocks;
      if (stableIntegrityJson(expectedBlocks) !== stableIntegrityJson(storedBlocks)) {
        const selected = expectedBlocks
          .filter((block) => block.key.startsWith(sequencePrefix))
          .map((block) => ({ key: block.key.slice(sequencePrefix.length), text: block.text }));
        if (!selected.length) return false;
        try {
          assetExpectedBlocks = normalizeFullAiTextManifest(selected);
        } catch (_error) {
          return false;
        }
      }
      const posterValidation = textRendering.full_ai_graphic_poster_validation || base.poster_validation || {};
      const baseChecksum = trimText(base.checksum_sha256).toLowerCase();
      const draftManifestChecksum = sha256Object(expectedBlocks);
      const assetManifestChecksum = sha256Object(storedBlocks);
      return asset.renderer === "openai_generated_graphic_passthrough"
        && provenance.renderer === "openai_generated_graphic_passthrough"
        && base.type === "openai_generated_complete_graphic"
        && base.contains_approved_copy_by_design === true
        && overlayProvenance.method === "none"
        && overlayProvenance.pixel_overlay_applied === false
        && overlayProvenance.image_ai_used_for_text === true
        && Boolean(trimText(overlayProvenance.copy_source))
        && textRendering.method === "openai_image_baked_in_exact_copy"
        && textRendering.pixel_overlay_applied === false
        && textRendering.image_ai_used_for_text === true
        && overlay.brand_name === "Pink Paisa"
        && overlay.logo?.method === "openai_image_baked_in"
        && !overlay.logo?.source
        && provenance.logo?.method === "openai_image_baked_in"
        && !provenance.logo?.source
        && selfCopyIntegrity
        && approvedCopyIntegrityPassed(asset, expectedCopy)
        && stableIntegrityJson(storedBlocks) === stableIntegrityJson(assetExpectedBlocks)
        && stableIntegrityJson(textRendering.expected_text_blocks) === stableIntegrityJson(storedBlocks)
        && trimText(draftFullAiManifest?.checksum_sha256).toLowerCase() === draftManifestChecksum
        && trimText(provenance.full_ai_graphic_manifest?.checksum_sha256).toLowerCase() === assetManifestChecksum
        && trimText(provenance.full_ai_graphic_manifest?.approved_copy_checksum_sha256).toLowerCase()
          === trimText(asset.approved_copy_checksum_sha256).toLowerCase()
        && fullAiPosterValidationPassed(posterValidation, storedBlocks)
        && retainedNativeFullAiProviderOriginalPassed(asset)
        && isSha256(baseChecksum)
        && baseChecksum === trimText(asset.checksum_sha256).toLowerCase();
    }
    const expectedHeadline = trimText(
      overlay.approved_copy?.selectedHeadline
      || overlay.approved_copy?.coverHeadline
      || overlay.approved_copy?.headline
      || overlay.approved_copy?.copy
      || overlay.approved_copy?.onScreenText,
    );
    const currentExpectedHeadline = trimText(
      expectedCopy?.selectedHeadline
      || expectedCopy?.coverHeadline
      || expectedCopy?.headline
      || expectedCopy?.copy
      || expectedCopy?.onScreenText,
    );
    const baseValidation = base.text_validation || {};
    const overlayValidation = textRendering.full_ai_graphic_text_validation || {};
    return asset.renderer === "sharp_svg_overlay"
      && provenance.renderer === "sharp_svg_overlay"
      && overlayProvenance.method === "sharp_branded_finish_after_validated_ai_headline"
      && overlayProvenance.image_ai_used_for_text === true
      && Boolean(trimText(overlayProvenance.copy_source))
      && textRendering.method === "openai_image_with_validated_short_headline"
      && textRendering.image_ai_used_for_text === true
      && base.contains_approved_copy_by_design === true
      && overlay.brand_name === "Pink Paisa"
      && Boolean(trimText(overlay.logo?.source))
      && Boolean(trimText(provenance.logo?.source))
      && Boolean(expectedHeadline)
      && selfCopyIntegrity
      && expectedHeadline === currentExpectedHeadline
      && exactHeadlineValidationPassed(baseValidation, expectedHeadline)
      && exactHeadlineValidationPassed(overlayValidation, expectedHeadline)
      && trimText(baseValidation.response_id) === trimText(overlayValidation.response_id);
  }

  return false;
}

function currentVideoAssemblyPassed(asset = {}, recommendation = {}, effectiveVisualMode = null) {
  const scenes = safeArray(reelContent(recommendation).scenes);
  const mappings = safeArray(asset.provenance?.storyboard_frames);
  const expectedSubtitleText = buildSrt(scenes);
  const expectedDuration = reelDurationSeconds(scenes);
  return scenes.length > 0
    && asset.provenance?.assembler === "ffmpeg"
    && asset.provenance?.scene_plan_fingerprint_sha256
      === videoAssemblyFingerprint({ primaryRecommendation: recommendation })
    && asset.provenance?.subtitle_text === expectedSubtitleText
    && asset.provenance?.subtitles_burned_in === (effectiveVisualMode !== "FULL_AI_GRAPHIC")
    && mappings.length === scenes.length
    && mappings.every((mapping, index) => Number(mapping.scene_index) === index)
    && Math.abs(Number(asset.duration_seconds || 0) - expectedDuration) < 0.001;
}

function reviewAssetReadiness(assets = [], { draft = null } = {}) {
  const activeAssets = assets.filter((asset) => {
    const value = asObject(asset) || {};
    return value.is_active !== false && !value.deleted_at;
  });
  const finalAssets = activeAssets.filter((asset) => {
    const value = asObject(asset) || {};
    return !value.asset_role || ["FINAL_COMPOSED", "FINAL_VIDEO"].includes(value.asset_role);
  });
  const composedImageAssets = finalAssets.filter((asset) => !asset.asset_role || asset.asset_role === "FINAL_COMPOSED");
  const issues = [];
  const draftValue = asObject(draft) || null;
  const recommendation = draftValue?.current_package?.primaryRecommendation
    || draftValue?.result_json?.primaryRecommendation
    || {};
  const expectedFormat = draftValue ? trimText(recommendation.format).toUpperCase() : null;
  const draftVisualMode = draftValue ? trimText(draftValue.visual_mode).toUpperCase() : null;
  const effectiveVisualMode = draftValue
    ? trimText(draftValue.visual_mode_resolution?.effective || draftVisualMode).toUpperCase()
    : null;
  let expectedRenderItems = [];
  if (draftValue && expectedFormat) {
    try {
      expectedRenderItems = buildApprovedRenderItems(recommendation, expectedFormat);
    } catch (error) {
      issues.push(`The approved draft copy cannot be resolved into final visual assets: ${trimText(error.message)}`);
    }
  }
  if (draftValue && expectedRenderItems.length) {
    const expectedSequences = expectedRenderItems.map((item) => Number(item.sequence)).sort((left, right) => left - right);
    const actualSequences = composedImageAssets
      .map((asset, index) => Number((asObject(asset) || {}).slide_number || index + 1))
      .sort((left, right) => left - right);
    if (JSON.stringify(actualSequences) !== JSON.stringify(expectedSequences)) {
      issues.push(`The active final media set does not match the complete approved ${expectedFormat} sequence (${expectedSequences.join(", ")}).`);
    }
  }
  if (draftValue && (!SOCIAL_VISUAL_MODES.has(draftVisualMode) || !SOCIAL_VISUAL_MODES.has(effectiveVisualMode))) {
    issues.push("The draft does not retain a supported effective visual mode for approval.");
  }
  if (draftValue && draftVisualMode !== effectiveVisualMode) {
    issues.push("The draft visual mode does not match its frozen effective visual mode.");
  }
  if (!composedImageAssets.length) issues.push("No active final composed creative is available.");
  composedImageAssets.forEach((asset, index) => {
    const value = asObject(asset) || {};
    const label = `Asset ${Number(value.slide_number || index + 1)}`;
    if (value.validation_status === "invalid") issues.push(`${label} failed creative validation.`);
    if (value.manual_review_status === "rejected") issues.push(`${label} was rejected during visual review.`);
    const base = value.provenance?.base_image || {};
    const generationStatus = String(value.image_generation_status || base.generation_status || "").toUpperCase();
    const provider = String(value.image_provider || base.provider || "").toLowerCase();
    const originalUrl = value.original_asset_url
      || value.original_visual?.url
      || base.original_asset_url
      || base.source_url;
    const provenance = String(value.source_provenance || base.source_provenance || "").toLowerCase();
    if (!["GENERATED", "VALIDATED", "SUCCEEDED"].includes(generationStatus)) {
      issues.push(`${label} does not have a successful AI image-generation status.`);
    }
    if (provider !== "openai") issues.push(`${label} is not tied to the configured OpenAI image provider.`);
    if (!originalUrl) issues.push(`${label} does not retain its original AI visual URL.`);
    if (!provenance.startsWith("generated")) issues.push(`${label} has non-AI visual provenance.`);
    const acceptedBaseTypes = new Set([
      "openai_generated_original_visual",
      "openai_generated_complete_graphic",
      "openai_background_with_authentic_product_composite",
    ]);
    if (base.type && !acceptedBaseTypes.has(base.type)) {
      issues.push(`${label} was not composed from a traceable OpenAI visual source.`);
    }
    if (base.type === "openai_background_with_authentic_product_composite") {
      const reference = base.authentic_product_reference || {};
      const composition = base.authentic_product_composition || {};
      const referenceAsset = safeArray(value.reference_assets).find((row) => row?.reference_type === "PRODUCT_IMAGE") || {};
      const referenceChecksum = trimText(reference.checksum_sha256).toLowerCase();
      if (
        reference.database_record_verified !== true
        || !/^[a-f0-9]{64}$/.test(referenceChecksum)
        || reference.original_database_url !== base.reference_image_url
        || referenceAsset.checksum_sha256 !== referenceChecksum
        || referenceAsset.source_bytes_preserved !== true
        || composition.renderer !== "sharp_authentic_product_composite_v1"
        || composition.source_reference_checksum_sha256 !== referenceChecksum
        || composition.product_pixels_generated_by_ai !== false
        || composition.packaging_editing_performed !== false
        || composition.placement?.occurrence_count !== 1
      ) {
        issues.push(`${label} does not retain a verified authentic-product reference and guarded local-composition proof.`);
      }
      if (value.manual_review_required !== true) {
        issues.push(`${label} must retain mandatory human product-authenticity review.`);
      }
    }
    if (draftValue && value.visual_mode !== effectiveVisualMode) {
      issues.push(`${label} visual mode does not match the draft effective visual mode.`);
    }
    if (draftValue && (!expectedFormat || trimText(value.social_format).toUpperCase() !== expectedFormat)) {
      issues.push(`${label} format does not match the approved draft format.`);
    }
    const expectedCopy = expectedRenderItems.find((item) => Number(item.sequence) === Number(value.slide_number || index + 1))?.approved_copy || null;
    if (draftValue && !expectedCopy) {
      issues.push(`${label} does not map to approved on-image copy for its sequence.`);
    }
    if (draftValue && SOCIAL_VISUAL_MODES.has(effectiveVisualMode)
      && !visualModeProvenancePassed(value, effectiveVisualMode, expectedCopy, draftValue.full_ai_graphic_manifest || null)) {
      const modeLabel = effectiveVisualMode === "AI_ARTWORK_ONLY"
        ? "resize-only/no-overlay and independent zero-text/logo"
        : effectiveVisualMode === "FULL_AI_GRAPHIC"
          ? Number(value.provenance?.full_ai_graphic_contract_version || 0) === 2
            ? "validated AI-baked exact copy with zero post-generation overlays"
            : "validated AI headline and Sharp branded-finish"
          : "verified Sharp exact-overlay";
      issues.push(`${label} does not retain consistent ${modeLabel} provenance for ${effectiveVisualMode}.`);
    }
  });
  if (draftValue) {
    finalAssets.forEach((asset, index) => {
      const value = asObject(asset) || {};
      const label = value.asset_role === "FINAL_VIDEO"
        ? "Final video"
        : `Asset ${Number(value.slide_number || index + 1)}`;
      if (value.visual_mode !== effectiveVisualMode) {
        if (value.asset_role === "FINAL_VIDEO") issues.push(`${label} visual mode does not match the draft effective visual mode.`);
      }
      if (!expectedFormat || trimText(value.social_format).toUpperCase() !== expectedFormat) {
        if (value.asset_role === "FINAL_VIDEO") issues.push(`${label} format does not match the approved draft format.`);
      }
      if (!captionPolicyPassed(value, expectedFormat, recommendation)) {
        issues.push(`${label} does not retain the required ${expectedFormat === "STORY" ? "Story frame overlay" : "Instagram caption-only"} policy provenance.`);
      }
    });
  }
  const videoFormat = activeAssets
    .map((asset) => String(asset.social_format || "").toUpperCase())
    .find((format) => ["REEL", "VIDEO_FEED"].includes(format));
  if (videoFormat) {
    const expectedAssetType = videoFormat === "REEL" ? "reel_video" : "video_feed";
    const videoLabel = videoFormat === "REEL" ? "Reel" : "Video Feed";
    const assembledVideos = finalAssets.filter((asset) => (
      asset.asset_role === "FINAL_VIDEO"
      && asset.asset_type === expectedAssetType
      && asset.media_kind === "VIDEO"
      && asset.publication_role === "PRIMARY_MEDIA"
      && asset.mime_type === "video/mp4"
    ));
    if (assembledVideos.length !== 1) {
      issues.push(`A ${videoLabel} requires exactly one active assembled MP4 primary-media asset.`);
    }
    assembledVideos.forEach((asset) => {
      if (asset.validation_status === "invalid") issues.push(`The assembled ${videoLabel} video failed validation.`);
      if (asset.manual_review_status === "rejected") issues.push(`The assembled ${videoLabel} video was rejected during visual review.`);
      if (!Number(asset.duration_seconds) || !Number(asset.frame_rate_fps) || !trimText(asset.video_codec)) {
        issues.push(`The assembled ${videoLabel} video is missing required duration, frame-rate, or codec metadata.`);
      }
      if (draftValue && !currentVideoAssemblyPassed(asObject(asset) || {}, recommendation, effectiveVisualMode)) {
        issues.push(`The assembled ${videoLabel} video does not match the current approved scene voiceover, subtitle, timing, and storyboard sequence.`);
      }
    });
  }
  return { passed: issues.length === 0, issues, finalAssets, effectiveVisualMode, expectedFormat };
}

async function appendAudit({ entityType = "DRAFT", entityId, draft = null, run = null, publication = null, action, status = "SUCCEEDED", summary, actor = null, actorType = "SYSTEM", fieldChanges = [], requestId = null, idempotencyKey = null, ip = null, promptVersionIds = [], sourceIds = [], providerModels = [], retryCount = 0, error = null, metadata = null, dependencies = {} }) {
  const AuditModel = dependencies.SocialAuditLog || SocialAuditLog;
  const adminId = actorId(actor);
  return createWithSession(AuditModel, {
    entity_type: entityType,
    entity_id: entityId,
    generation_run_id: run?._id || draft?.generation_run_id || null,
    draft_id: draft?._id || null,
    publication_id: publication?._id || null,
    action,
    idempotency_key: idempotencyKey || undefined,
    action_status: status,
    actor_type: adminId ? "ADMIN" : actorType,
    actor_admin_id: adminId,
    actor_label: adminId ? "Pink Paisa administrator" : (actorType === "WORKER" ? "Social generation worker" : "Pink Paisa social system"),
    summary,
    field_changes: fieldChanges,
    request_id: requestId,
    source_ip_hash: sourceIpHash(ip),
    prompt_version_ids: promptVersionIds,
    source_ids: sourceIds,
    provider_models: providerModels.filter((row) => row.provider && row.model),
    retry_count: retryCount,
    error_code: error?.code || null,
    error_message: error?.message || null,
    metadata,
  }, dependencies.mongoSession || null);
}

function findFieldChanges(before, after, prefix = "current_package", changes = [], limit = 80) {
  if (changes.length >= limit) return changes;
  if (JSON.stringify(before) === JSON.stringify(after)) return changes;
  const beforeObject = before && typeof before === "object" && !Array.isArray(before);
  const afterObject = after && typeof after === "object" && !Array.isArray(after);
  if (beforeObject && afterObject) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) {
      findFieldChanges(before[key], after[key], `${prefix}.${key}`, changes, limit);
      if (changes.length >= limit) break;
    }
    return changes;
  }
  changes.push({ field_path: prefix, before: before ?? null, after: after ?? null, is_redacted: false });
  return changes;
}

function creativeCopyFingerprint(packageValue = {}) {
  const recommendation = packageValue.primaryRecommendation || {};
  const format = trimText(recommendation.format).toUpperCase();
  const content = recommendation.formatContent
    || recommendation.format_content
    || recommendation.contentPackage
    || recommendation.content_package
    || {};
  const storyFramePolicyCopy = format === "STORY"
    ? {
      affiliateDisclosure: recommendation.affiliateDisclosure
        ?? recommendation.affiliate_disclosure
        ?? content.affiliateDisclosure
        ?? content.affiliate_disclosure
        ?? null,
      cta: recommendation.cta ?? content.cta ?? null,
      financialDisclaimer: recommendation.financialDisclaimer
        ?? recommendation.financial_disclaimer
        ?? content.financialDisclaimer
        ?? content.financial_disclaimer
        ?? null,
    }
    : null;
  return sha256({
    format,
    onPostCopy: recommendation.onPostCopy || recommendation.on_post_copy || null,
    storyFramePolicyCopy,
  });
}

function fullAiRenderedHeadlineFingerprint(packageValue = {}, { contractVersion = 1 } = {}) {
  const recommendation = packageValue.primaryRecommendation || {};
  const format = trimText(recommendation.format).toUpperCase();
  const content = recommendation.formatContent
    || recommendation.format_content
    || recommendation.contentPackage
    || recommendation.content_package
    || {};
  let renderedCopy;
  if (format === "CAROUSEL") {
    renderedCopy = safeArray(content.slides).map((slide) => Number(contractVersion) >= 2
      ? { headline: trimText(slide?.headline), body: trimText(slide?.body) }
      : trimText(slide?.headline));
  } else if (format === "STORY") {
    renderedCopy = safeArray(content.frames).map((frame) => trimText(frame?.copy));
  } else if (["REEL", "VIDEO_FEED"].includes(format)) {
    renderedCopy = [
      trimText(content.coverHeadline || content.cover_headline),
      ...safeArray(content.scenes).map((scene) => trimText(scene?.onScreenText || scene?.on_screen_text)),
    ];
  } else {
    const headline = trimText(
      content.selectedHeadline
      || content.selected_headline
      || recommendation.onPostCopy?.headline
      || recommendation.on_post_copy?.headline,
    );
    renderedCopy = Number(contractVersion) >= 2 ? [{
      headline,
      supportingText: trimText(
        content.supportingText
        || content.supporting_text
        || recommendation.onPostCopy?.supportingCopy
        || recommendation.on_post_copy?.supporting_copy,
      ),
      interactionCopy: trimText(content.interactionCopy || content.interaction_copy),
    }] : [headline];
  }
  return sha256({ format, renderedCopy });
}

function videoAssemblyFingerprint(packageValue = {}) {
  const recommendation = packageValue.primaryRecommendation || {};
  const format = trimText(recommendation.format).toUpperCase();
  if (!["REEL", "VIDEO_FEED"].includes(format)) return sha256({ format, scenes: [] });
  const content = recommendation.formatContent
    || recommendation.format_content
    || recommendation.contentPackage
    || recommendation.content_package
    || {};
  return sha256({
    format,
    subtitleLanguage: content.subtitleLanguage || content.subtitle_language || null,
    scenes: safeArray(content.scenes).map((scene) => ({
      sceneNumber: scene?.sceneNumber ?? scene?.scene_number ?? null,
      durationSeconds: scene?.durationSeconds ?? scene?.duration_seconds ?? null,
      voiceover: scene?.voiceover ?? null,
      onScreenText: scene?.onScreenText ?? scene?.on_screen_text ?? null,
    })),
  });
}

function visualDirectionFingerprint(packageValue = {}) {
  const recommendation = packageValue.primaryRecommendation || {};
  return sha256({
    format: recommendation.format,
    visualConcept: recommendation.visualConcept,
    visualBrief: recommendation.visualBrief,
    imageGenerationPrompt: recommendation.imageGenerationPrompt,
    verifiedProductId: recommendation.verifiedProductId,
    verifiedProductTitle: recommendation.verifiedProductTitle,
  });
}

function sourceType(value) {
  const normalized = String(value || "").toLowerCase();
  const mapping = {
    primary: "PRIMARY_SOURCE",
    primary_source: "PRIMARY_SOURCE",
    government: "GOVERNMENT",
    regulator: "REGULATOR",
    research: "RESEARCH_PAPER",
    research_paper: "RESEARCH_PAPER",
    news: "NEWS",
    trusted_rss: "TRUSTED_RSS",
    web_search: "WEB_SEARCH",
    industry: "PRIMARY_SOURCE",
    social_trend: "WEB_SEARCH",
  };
  return mapping[normalized] || "WEB_SEARCH";
}

function freshnessForHours(hours) {
  const numeric = Number(hours);
  if (!Number.isFinite(numeric)) return "UNKNOWN";
  if (numeric <= 48) return "CURRENT";
  if (numeric <= 24 * 30) return "RECENT";
  return "STALE";
}

function researchMode(value) {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "openai_web") return "WEB_SEARCH";
  if (normalized === "trusted_rss") return "TRUSTED_FEEDS";
  if (normalized === "disabled") return "DISABLED";
  return "EVERGREEN";
}

async function persistResearchSources({ run, research, dependencies = {} }) {
  const SourceModel = dependencies.SocialResearchSource || SocialResearchSource;
  const documents = [];
  for (const [index, source] of (Array.isArray(research.sources) ? research.sources : []).entries()) {
    let parsed;
    try {
      parsed = new URL(source.url);
    } catch (_error) {
      continue;
    }
    const freshnessHours = Number(source.freshness_hours);
    const injectionFlags = Array.isArray(source.prompt_injection_flags) ? source.prompt_injection_flags : [];
    const sourceKey = trimText(source.source_key) || null;
    const idempotencyKey = `social-source:${run._id}:${sha256(`${parsed.toString()}:${source.claim_supported || source.excerpt || index}`)}`;
    const rawRecord = {
      generation_run_id: run._id,
      source_key: sourceKey,
      idempotency_key: idempotencyKey,
      title: trimText(source.title || parsed.hostname).slice(0, 500),
      url: parsed.toString(),
      normalized_url: parsed.toString(),
      domain: parsed.hostname.replace(/^www\./, ""),
      publisher: trimText(source.publisher).slice(0, 300) || null,
      published_at: source.published_at ? new Date(source.published_at) : null,
      accessed_at: source.accessed_at ? new Date(source.accessed_at) : new Date(),
      excerpt: trimText(source.excerpt).slice(0, 1500) || null,
      summary: trimText(source.excerpt || source.claim_supported || source.title).slice(0, 3000),
      claim_supported: trimText(source.claim_supported || source.excerpt || source.title).slice(0, 1500),
      confidence: Math.min(Math.max(Number(source.confidence || 0), 0), 1),
      freshness: freshnessForHours(freshnessHours),
      freshness_hours: Number.isFinite(freshnessHours) ? freshnessHours : null,
      freshness_days: Number.isFinite(freshnessHours) ? freshnessHours / 24 : null,
      source_type: sourceType(source.source_type || research.mode),
      provider: research.provider || null,
      provider_model: research.model || null,
      validation_status: injectionFlags.length ? "REJECTED" : "VALID",
      validation_reasons: [source.validation_status || "server_validated"],
      is_current_claim: Number.isFinite(freshnessHours) && freshnessHours <= 24 * 30,
      is_safe_to_use: injectionFlags.length === 0,
      used_in_final: Boolean(source.influenced_decision) && injectionFlags.length === 0,
      influenced_decision: Boolean(source.influenced_decision) && injectionFlags.length === 0,
      prompt_injection_suspected: injectionFlags.length > 0,
      prompt_injection_flags: injectionFlags,
      content_hash: sha256(`${source.title || ""}\n${source.excerpt || ""}`),
      retrieval_metadata: { mode: research.mode, source_key: sourceKey },
    };
    const buildRecord = typeof SourceModel.buildPersistenceRecord === "function"
      ? SourceModel.buildPersistenceRecord.bind(SourceModel)
      : SocialResearchSource.buildPersistenceRecord.bind(SocialResearchSource);
    const persistenceRecord = buildRecord(rawRecord, { generation_run_id: run._id });
    const document = await SourceModel.findOneAndUpdate(
      { idempotency_key: idempotencyKey },
      {
        $setOnInsert: persistenceRecord,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true },
    );
    documents.push(document);
  }
  return documents;
}

async function ensurePromptVersions({ promptRuns = [], actor = null, dependencies = {} }) {
  const PromptModel = dependencies.SocialPromptVersion || SocialPromptVersion;
  const documents = [];
  for (const promptRun of promptRuns) {
    const stageKey = String(promptRun.stage || "").toLowerCase();
    const stage = STAGE_MAP[stageKey];
    const prompt = openAiSocialProvider.SOCIAL_PROMPTS[PROMPT_KEY_MAP[stageKey] || stageKey];
    if (!stage || !prompt) continue;
    const runtimeMajor = Number(String(prompt.version || "").match(/(?:^|-)v(\d+)(?:$|-)/i)?.[1] || 1);
    const semanticVersion = `${runtimeMajor}.0.0`;
    const versionKey = `${stage}:${semanticVersion}`;
    const hasActivePrompt = typeof PromptModel.exists === "function"
      ? Boolean(await PromptModel.exists({ stage, is_active: true }))
      : true;
    const seed = {
      stage,
      semantic_version: semanticVersion,
      runtime_prompt_version: prompt.version,
      version_key: versionKey,
      display_name: `Pink Paisa social ${stageKey} v${runtimeMajor}`,
      description: `Versioned ${stageKey} prompt used by the Social Media Manager.`,
      system_prompt_template: prompt.instructions,
      user_prompt_template: "{{input_json}}",
      output_schema_name: SCHEMA_NAME_MAP[stageKey],
      output_schema_version: SCHEMA_VERSION_MAP[stageKey] || "2.0.0",
      input_contract: { type: "server_validated_json" },
      model_config: { provider: promptRun.provider, model: promptRun.model, store: false },
      safety_metadata: { chain_of_thought_stored: false, researched_pages_are_untrusted_data: true },
      change_summary: `Social Media Manager runtime prompt ${prompt.version}.`,
      is_active: !hasActivePrompt,
      created_by_admin_id: actorId(actor),
    };
    const hashBuilder = typeof PromptModel.buildPromptHash === "function"
      ? PromptModel.buildPromptHash.bind(PromptModel)
      : SocialPromptVersion.buildPromptHash.bind(SocialPromptVersion);
    seed.prompt_hash = hashBuilder(seed);
    const document = await PromptModel.findOneAndUpdate(
      { version_key: versionKey },
      {
        $setOnInsert: seed,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true },
    );
    if (document.runtime_prompt_version !== prompt.version || document.prompt_hash !== seed.prompt_hash) {
      const error = new Error(`Runtime prompt ${prompt.version} does not match the immutable ${versionKey} prompt record; bump the prompt version before deployment`);
      error.code = "social_prompt_version_mismatch";
      throw error;
    }
    documents.push({ promptRun, document });
  }
  return documents;
}

function stageExecutions(promptVersionRows = []) {
  return promptVersionRows.map(({ promptRun, document }) => ({
    stage: RUN_STAGE_MAP[String(promptRun.stage || "").toLowerCase()] || "ASSEMBLING_RESULT",
    status: "COMPLETED",
    provider: promptRun.provider,
    model: promptRun.model,
    prompt_version_id: document._id,
    prompt_semantic_version: document.semantic_version,
    runtime_prompt_version: document.runtime_prompt_version,
    system_instructions_version: promptRun.system_instructions_version || document.runtime_prompt_version,
    input_fingerprint: promptRun.input_fingerprint || null,
    output_fingerprint: promptRun.output_fingerprint || null,
    provider_response_id: promptRun.provider_response_id || promptRun.response_id || null,
    input_tokens: Number(promptRun.usage?.input_tokens || 0),
    output_tokens: Number(promptRun.usage?.output_tokens || 0),
    total_tokens: Number(promptRun.usage?.total_tokens || 0),
    estimated_cost: estimateOpenAiCostUsd(promptRun.usage),
    attempt_count: Number(promptRun.attempt_count || 1),
    retry_number: Number(promptRun.retry_number || 0),
    output_json: promptRun.output_json || null,
    request_metadata: promptRun.request_metadata || null,
    response_metadata: promptRun.response_metadata || null,
    started_at: promptRun.started_at || new Date(),
    finished_at: promptRun.completed_at || new Date(),
  }));
}

function candidateSummaries(decision) {
  return (decision.scored_candidates || []).map((candidate) => ({
    candidate_id: candidate.id,
    topic: candidate.topic,
    content_pillar: candidate.content_pillar || "Unknown",
    format: candidate.format || null,
    total_score: Number(candidate.score_breakdown?.total || 0),
    disposition: candidate.selection || (candidate.selected ? "ALTERNATIVE" : "REJECTED"),
    rejection_reason: candidate.selected ? null : candidate.server_rejection_reason || candidate.concise_rationale || null,
    risk_flags: candidate.server_risk_flags || candidate.compliance?.risk_flags || [],
  }));
}

function assertWeeklyRecommendationIdentity(recommendation, candidate) {
  const expectedFormat = ({ POLL_CONCEPT: "POLL", WORKSHOP_PROMOTION: "EVENT_OR_WORKSHOP_PROMOTION" })[
    String(candidate?.format || "").toUpperCase()
  ] || String(candidate?.format || "").toUpperCase();
  const comparisons = [
    ["topic", recommendation?.topic, candidate?.topic],
    ["objective", recommendation?.objective, candidate?.objective],
    ["content pillar", recommendation?.contentPillar, candidate?.contentPillar],
    ["audience", recommendation?.targetAudienceSegment, candidate?.audienceSegment],
    ["format", recommendation?.format, expectedFormat],
  ];
  const mismatch = comparisons.find(([, actual, expected]) => trimText(actual) !== trimText(expected));
  const actualDestination = validateLandingPage(recommendation?.recommendedLandingPage);
  const expectedDestination = validateLandingPage(candidate?.recommendedLandingPage);
  const productMismatch = trimText(candidate?.verifiedInternalEntityId)
    && trimText(recommendation?.verifiedProductId) !== trimText(candidate.verifiedInternalEntityId);
  if (mismatch || actualDestination !== expectedDestination || productMismatch) {
    const error = new Error(mismatch
      ? `Generated creative changed the approved weekly ${mismatch[0]}`
      : productMismatch
        ? "Generated creative changed the approved weekly product identity"
        : "Generated creative changed the approved weekly landing-page destination");
    error.code = "social_weekly_recommendation_identity_mismatch";
    error.statusCode = 422;
    throw error;
  }
}

async function enforceMonthlyBudget({ settings, now, models }) {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [runBudgetRows, retainedBudgetRows] = await Promise.all([
    models.SocialGenerationRun.aggregate([
      { $match: { created_at: { $gte: monthStart } } },
      { $group: { _id: null, usd: { $sum: "$usage.estimated_cost" } } },
    ]),
    models.SocialGenerationUsageLedger && typeof models.SocialGenerationUsageLedger.aggregate === "function"
      ? models.SocialGenerationUsageLedger.aggregate([
        { $match: { incurred_at: { $gte: monthStart } } },
        { $group: { _id: null, usd: { $sum: "$usage.estimated_cost" } } },
      ])
      : [],
  ]);
  const inrPerUsd = Math.max(Number(process.env.SOCIAL_MANAGER_INR_PER_USD || 90), 1);
  const estimatedUsd = Number(runBudgetRows[0]?.usd || 0) + Number(retainedBudgetRows[0]?.usd || 0);
  const estimatedInr = estimatedUsd * inrPerUsd;
  if (Number(settings.cost_controls?.monthly_budget_inr || 0) > 0 && estimatedInr >= Number(settings.cost_controls.monthly_budget_inr)) {
    const error = new Error("The configured monthly social AI budget threshold has been reached");
    error.code = "social_monthly_budget_limit";
    // This is a configured cost-policy conflict, not request throttling. Keep it
    // distinct from provider 429 responses so the Social Manager remains free of
    // application-level request-count limits.
    error.statusCode = 409;
    throw error;
  }
}

function originalAssetShape(format) {
  if (["STORY", "REEL", "VIDEO_FEED"].includes(format)) {
    return { asset_type: format === "STORY" ? "story_frame" : "reel_cover", canvas_format: "VERTICAL_9_16", aspect_ratio: "9:16" };
  }
  return { asset_type: format === "CAROUSEL" ? "carousel_slide" : "feed_post", canvas_format: "FEED_4_5", aspect_ratio: "4:5" };
}

function reelContent(recommendation = {}) {
  const content = recommendation.formatContent
    || recommendation.format_content
    || recommendation.contentPackage
    || recommendation.content_package
    || {};
  return ["REEL", "VIDEO_FEED"].includes(String(content.format || "").toUpperCase())
    ? content
    : content.reel || recommendation.reel || {};
}

function requestsInstagramNativeAudio(recommendation = {}) {
  const direction = trimText(reelContent(recommendation).audioDirection || reelContent(recommendation).audio_direction);
  if (!direction || /\b(no audio|silent|silence)\b/i.test(direction)) return false;
  return /\b(instagram(?:-native| native| in-app)?|in-app|native|trending|trend audio|popular audio)\b/i.test(direction);
}

function recommendationOperationalText(recommendation = {}) {
  return [
    recommendation.caption,
    recommendation.cta,
    recommendation.formatReason,
    ...safeArray(recommendation.hooks),
    JSON.stringify(recommendation.formatContent || recommendation.format_content || {}),
  ].map(trimText).filter(Boolean).join(" ").slice(0, 12000);
}

function requestsInstagramCollaborationInvitation(recommendation = {}) {
  const direction = recommendationOperationalText(recommendation);
  return /\b(?:instagram\s+collab(?:oration)?|collaboration\s+invitation|collaborator\s+invite|invite\s+@[a-z0-9._]+\s+as\s+(?:an?\s+)?collaborator|add\s+@[a-z0-9._]+\s+as\s+(?:an?\s+)?collaborator)\b/i.test(direction);
}

function storyInteractionPrompts(recommendation = {}) {
  if (String(recommendation?.format || "").toUpperCase() !== "STORY") return [];
  const content = recommendation.formatContent || recommendation.format_content || {};
  return safeArray(content.frames)
    .map((frame) => trimText(frame?.interactionPrompt || frame?.interaction_prompt))
    .filter(Boolean);
}

function storyFrameCount(recommendation = {}) {
  if (String(recommendation?.format || "").toUpperCase() !== "STORY") return 0;
  const content = recommendation.formatContent || recommendation.format_content || {};
  return safeArray(content.frames).length;
}

function reelStoryboardVisuals(imageResult = {}) {
  const rows = safeArray(imageResult.original_visuals);
  const explicit = rows.filter((visual) => ["REEL_STORYBOARD_FRAME", "VIDEO_FEED_STORYBOARD_FRAME"].includes(visual.asset_purpose));
  return (explicit.length ? explicit : rows.filter((visual) => Number(visual.sequence || 0) > 1))
    .slice()
    .sort((left, right) => Number(left.sequence || 0) - Number(right.sequence || 0));
}

function localReelFramePath(visual, dependencies = {}) {
  if (trimText(visual?.file_path)) return trimText(visual.file_path);
  const resolver = dependencies.getGeneratedCampaignAssetReference || getGeneratedCampaignAssetReference;
  const reference = resolver(visual?.storage_key || visual?.url);
  return reference?.filePath || reference?.file_path || null;
}

function publicCampaignAssetUrl(storageKey) {
  const baseUrl = trimText(
    process.env.PUBLIC_MEDIA_BASE_URL
    || process.env.SERVER_URL
    || "http://localhost:5001",
  ).replace(/\/+$/, "");
  return `${baseUrl}/${String(storageKey || "").replace(/^\/+/, "")}`;
}

function reelDurationSeconds(scenes = []) {
  return Number(safeArray(scenes).reduce(
    (total, scene) => total + Math.min(Math.max(Number(scene.durationSeconds || scene.duration_seconds || 3), 1), 60),
    0,
  ).toFixed(3));
}

async function persistSocialAssetRecord(AssetModel, record) {
  if (typeof AssetModel.findOneAndUpdate === "function") {
    return AssetModel.findOneAndUpdate(
      { url: record.url },
      { $set: record },
      { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true },
    );
  }
  return AssetModel.create(record);
}

function creativeAssetIds(assets = [], { publishableCompositionOnly = false } = {}) {
  return safeArray(assets).filter((asset) => {
    if (!publishableCompositionOnly) return true;
    const role = asObject(asset)?.asset_role;
    return !role || ["FINAL_COMPOSED", "FINAL_VIDEO"].includes(role);
  }).map((asset) => asset?._id || asset?.id).filter(Boolean);
}

async function persistInstagramNativeManualActions({ draft, run, recommendation, videoAsset = null, actor = null, dependencies = {} }) {
  const ActionModel = dependencies.SocialManualAction || SocialManualAction;
  const socialFormat = String(recommendation?.format || "REEL").toUpperCase();
  const contentLabel = socialFormat === "VIDEO_FEED" ? "Video Feed" : socialFormat === "STORY" ? "Story" : socialFormat === "REEL" ? "Reel" : "post";
  const contentSlug = socialFormat.toLowerCase().replace(/_/g, "-");
  const actionSpecs = [];
  if (requestsInstagramNativeAudio(recommendation)) {
    const audioDirection = trimText(reelContent(recommendation).audioDirection || reelContent(recommendation).audio_direction);
    const helper = buildManualActions({ nativeTrendingAudio: true, contentLabel })[0];
    actionSpecs.push({
      suffix: `native-audio:${String(videoAsset?.checksum_sha256 || "pending").slice(0, 20)}`,
      priority: "MEDIUM",
      title: `Add approved Instagram-native audio to the ${contentLabel}`,
      description: `This ${contentLabel} was assembled without scraped or unlicensed audio. The approved creative direction requests Instagram-native audio: ${audioDirection}`,
      instructions: [helper.instructions],
      reference: `instagram-native-${contentSlug}-audio`,
    });
  }
  if (requestsInstagramCollaborationInvitation(recommendation)) {
    const helper = buildManualActions({ collaborationInvitation: true, contentLabel })[0];
    actionSpecs.push({
      suffix: "collaboration-invitation",
      priority: "MEDIUM",
      title: `Send the approved Instagram collaboration invitation for this ${contentLabel}`,
      description: `The approved ${contentLabel} direction explicitly requests an Instagram collaboration invitation. Meta's native collaborator step must be completed and confirmed by an administrator.`,
      instructions: [helper.instructions],
      reference: `instagram-native-${contentSlug}-collaboration`,
    });
  }
  const interactionPrompts = storyInteractionPrompts(recommendation);
  if (interactionPrompts.length) {
    const helper = buildManualActions({ interactiveSticker: true, contentLabel })[0];
    actionSpecs.push({
      suffix: "interactive-sticker",
      priority: "MEDIUM",
      title: "Add the approved Instagram-native Story sticker",
      description: `The AI Story package requests native interaction: ${interactionPrompts.join(" | ")}`,
      instructions: [helper.instructions],
      reference: "instagram-native-story-sticker",
    });
  }
  const frameCount = storyFrameCount(recommendation);
  if (frameCount > 1) {
    actionSpecs.push({
      suffix: `story-sequence:${frameCount}`,
      priority: "MEDIUM",
      title: `Publish the approved ${frameCount}-frame Story sequence manually`,
      description: "The approved Story contains multiple ordered frames. The direct publishing workflow intentionally handles only one Story media object at a time and will not silently publish an incomplete sequence.",
      instructions: ["Open the approved Story assets in sequence order in Instagram's first-party app, verify every crop/link/sticker, publish all frames in order, then record the result in this task."],
      reference: `instagram-native-story-sequence-${frameCount}`,
    });
  }
  const actions = [];
  for (const spec of actionSpecs) {
    const actionKey = `social-${contentSlug}-${spec.suffix}:${draft._id}`.slice(0, 400);
    const record = {
      action_key: actionKey,
      action_type: "META_NATIVE_INTERACTION",
      status: "OPEN",
      priority: spec.priority,
      title: spec.title,
      description: spec.description.slice(0, 4000),
      instructions: spec.instructions,
      provider: "INSTAGRAM",
      weekly_plan_id: draft.weekly_plan_id || null,
      generation_run_id: run?._id || draft.generation_run_id || null,
      draft_id: draft._id,
      external_reference_id: spec.reference,
      assigned_to_admin_id: actorId(actor),
      created_by_admin_id: actorId(actor),
    };
    const action = typeof ActionModel.findOneAndUpdate === "function"
      ? await ActionModel.findOneAndUpdate(
        { action_key: actionKey },
        { $setOnInsert: record },
        { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true },
      )
      : await ActionModel.create(record);
    actions.push(action);
  }
  const actionIds = actions.map((action) => action?._id || action?.id).filter(Boolean);
  if (actionIds.length) {
    draft.manual_action_ids = [
      ...new Map([...(draft.manual_action_ids || []), ...actionIds].map((id) => [String(id), id])).values(),
    ];
  }
  return actions;
}

async function persistReelAudioRightsManualAction({ draft, run, actor = null, error, dependencies = {} }) {
  const ActionModel = dependencies.SocialManualAction || SocialManualAction;
  if (!ActionModel?.findOneAndUpdate) return null;
  const trackId = draft.audio_track_id ? String(draft.audio_track_id) : "missing";
  const socialFormat = String(draft.current_package?.primaryRecommendation?.format || "REEL").toUpperCase();
  const videoLabel = socialFormat === "VIDEO_FEED" ? "Video Feed" : "Reel";
  const videoSlug = socialFormat === "VIDEO_FEED" ? "video-feed" : "reel";
  return ActionModel.findOneAndUpdate(
    { action_key: `social-${videoSlug}-audio-rights:${draft._id}:${trackId}` },
    { $setOnInsert: {
      action_key: `social-${videoSlug}-audio-rights:${draft._id}:${trackId}`,
      action_type: "OTHER",
      status: "OPEN",
      priority: "HIGH",
      title: `Resolve the selected ${videoLabel} audio rights`,
      description: `${videoLabel} assembly was blocked because the selected local audio track is not currently usable: ${trimText(error?.message)}`.slice(0, 4000),
      instructions: [`Select an active rights-confirmed library track or remove the selection, rebuild the ${videoLabel}, replay it, and obtain human approval.`],
      provider: "INTERNAL",
      weekly_plan_id: draft.weekly_plan_id || null,
      generation_run_id: run?._id || draft.generation_run_id || null,
      draft_id: draft._id,
      external_reference_id: trackId,
      assigned_to_admin_id: actorId(actor),
      created_by_admin_id: actorId(actor),
    } },
    { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true },
  );
}

async function persistReviewerNotificationFailure({ draft, run, error, dependencies = {} }) {
  const ActionModel = dependencies.SocialManualAction || SocialManualAction;
  const actionKey = `social-review-notification-failed:${draft._id}`.slice(0, 400);
  const failureMessage = normalizeWhitespace(error?.message || "The configured review email could not be sent").slice(0, 1200);
  let action = null;
  let durableRecordCreated = false;

  try {
    const record = {
      action_key: actionKey,
      action_type: "CONTENT_ESCALATION",
      status: "OPEN",
      priority: "HIGH",
      title: "Review the generated social draft; email notification failed",
      description: `The AI creative was generated and remains in NEEDS_REVIEW, but the reviewer email notification failed: ${failureMessage}`.slice(0, 4000),
      instructions: [
        "Open this linked draft in the Approval Queue and complete the required human review.",
        "Check the configured reviewer email addresses and mail transport before relying on the next notification.",
        "Resolve this task only after the draft has been reviewed and the notification configuration has been checked.",
      ],
      provider: "INTERNAL",
      weekly_plan_id: draft.weekly_plan_id || run?.weekly_plan_id || null,
      generation_run_id: run?._id || draft.generation_run_id || null,
      draft_id: draft._id,
      external_reference_id: "social-draft-review-email",
      assigned_to_admin_id: run?.initiated_by_admin_id || null,
      created_by_admin_id: run?.initiated_by_admin_id || null,
    };
    action = typeof ActionModel.findOneAndUpdate === "function"
      ? await ActionModel.findOneAndUpdate(
        { action_key: actionKey },
        { $setOnInsert: record },
        { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true },
      )
      : await ActionModel.create(record);
    durableRecordCreated = Boolean(action);
    const actionId = action?._id || action?.id;
    if (actionId) {
      draft.manual_action_ids = [
        ...new Map([...(draft.manual_action_ids || []), actionId].map((id) => [String(id), id])).values(),
      ];
      await draft.save();
    }
  } catch (actionError) {
    logger.error("social reviewer notification manual action could not be persisted", {
      draft_id: String(draft?._id || ""),
      generation_run_id: String(run?._id || ""),
      error_code: actionError?.code || null,
      error_message: normalizeWhitespace(actionError?.message).slice(0, 500),
    });
  }

  try {
    await appendAudit({
      entityType: "DRAFT",
      entityId: draft._id,
      draft,
      run,
      action: "REVIEW_NOTIFICATION_FAILED",
      status: "FAILED",
      summary: "The draft remains available for required human review, but its reviewer email notification failed and needs administrator attention.",
      actor: run?.initiated_by_admin_id,
      actorType: "WORKER",
      error,
      metadata: { manual_action_id: action?._id || action?.id || null, notification_channel: "EMAIL" },
      dependencies,
    });
    durableRecordCreated = true;
  } catch (auditError) {
    logger.error("social reviewer notification audit could not be persisted", {
      draft_id: String(draft?._id || ""),
      generation_run_id: String(run?._id || ""),
      error_code: auditError?.code || null,
      error_message: normalizeWhitespace(auditError?.message).slice(0, 500),
    });
  }

  if (!durableRecordCreated) {
    logger.error("social reviewer notification failed without a durable follow-up record", {
      draft_id: String(draft?._id || ""),
      generation_run_id: String(run?._id || ""),
      notification_error: failureMessage,
    });
  }
  return action;
}

async function assembleReelCreative({
  draft,
  run = null,
  recommendation,
  imageResult,
  creativeResult,
  visualMode,
  actor = null,
  dependencies = {},
  AssetModel = SocialAsset,
} = {}) {
  const socialFormat = String(recommendation?.format || "").toUpperCase();
  if (!["REEL", "VIDEO_FEED"].includes(socialFormat)) {
    const manualActions = await persistInstagramNativeManualActions({
      draft,
      run,
      recommendation,
      actor,
      dependencies,
    });
    if (!manualActions.length) return creativeResult;
    return {
      ...creativeResult,
      manual_review_required: true,
      manual_review_flags: Array.from(new Set([
        ...safeArray(creativeResult.manual_review_flags),
        "INSTAGRAM_NATIVE_ACTION",
      ])),
      manual_action: manualActions[0],
      manual_actions: manualActions,
    };
  }
  const videoLabel = socialFormat === "REEL" ? "Reel" : "Video Feed";
  const videoSlug = socialFormat === "REEL" ? "reel" : "video-feed";
  const finalVideoAssetType = socialFormat === "REEL" ? "reel_video" : "video_feed";
  const storyboardVisuals = reelStoryboardVisuals(imageResult);
  if (!storyboardVisuals.length) {
    const error = new Error(`${videoLabel} assembly requires at least one generated storyboard frame in addition to its cover`);
    error.code = "social_reel_frames_missing";
    throw error;
  }
  const allScenes = safeArray(reelContent(recommendation).scenes);
  if (!allScenes.length) {
    const error = new Error(`${videoLabel} assembly requires the complete approved scene plan`);
    error.code = "social_reel_scenes_missing";
    throw error;
  }
  const sceneFrameMappings = allScenes.map((scene, sceneIndex) => {
    const exact = storyboardVisuals.find((visual) => visual.scene_index === sceneIndex);
    const visual = exact || storyboardVisuals[sceneIndex % storyboardVisuals.length];
    return { scene, sceneIndex, visual, reused: !exact };
  });
  const framePaths = sceneFrameMappings.map(({ visual }) => localReelFramePath(visual, dependencies));
  if (framePaths.some((filePath) => !filePath)) {
    const error = new Error(`Generated ${videoLabel} storyboard frames must be available in guarded local media storage for FFmpeg assembly`);
    error.code = "social_reel_frame_storage_unavailable";
    throw error;
  }
  const scenes = sceneFrameMappings.map(({ scene }) => scene);

  const version = createCampaignAssetVersion();
  const safeDraftId = String(draft._id || draft.id || "draft").replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 80);
  const fileName = `pinkpaisa-${videoSlug}-${safeDraftId}-${version}.mp4`;
  const subtitleFileName = `pinkpaisa-${videoSlug}-${safeDraftId}-${version}.srt`;
  const storageKey = `uploads/generated/campaigns/${fileName}`;
  const outputReference = (dependencies.getGeneratedCampaignAssetReference || getGeneratedCampaignAssetReference)(storageKey);
  if (!outputReference?.filePath && !outputReference?.file_path) {
    const error = new Error(`Could not resolve a guarded local output path for the assembled ${videoLabel}`);
    error.code = "social_reel_output_path_invalid";
    throw error;
  }
  const outputPath = outputReference.filePath || outputReference.file_path;
  const burnSubtitles = visualMode !== "FULL_AI_GRAPHIC";
  let selectedAudio = null;
  if (draft.audio_track_id) {
    try {
      selectedAudio = await (dependencies.resolveUsableAudioTrack || resolveUsableAudioTrack)(draft.audio_track_id, { dependencies });
    } catch (error) {
      await persistReelAudioRightsManualAction({ draft, run, actor, error, dependencies });
      throw error;
    }
  }
  const assembled = await (dependencies.assembleReel || assembleReel)({
    framePaths,
    scenes,
    outputPath,
    audioPath: selectedAudio?.filePath || null,
    audioMetadata: selectedAudio?.metadata || null,
    burnSubtitles,
    dependencies: dependencies.reelAssemblyDependencies || {},
  });
  const checksumSha256 = trimText(assembled?.checksum_sha256).toLowerCase();
  const fileSizeBytes = Number(assembled?.size_bytes || assembled?.file_size_bytes || 0);
  if (!/^[a-f0-9]{64}$/.test(checksumSha256) || !Number.isFinite(fileSizeBytes) || fileSizeBytes <= 0) {
    const error = new Error(`FFmpeg ${videoLabel} assembly returned invalid file integrity metadata`);
    error.code = "social_reel_output_invalid";
    throw error;
  }
  const subtitleText = buildSrt(scenes);
  if (!trimText(subtitleText)) {
    const error = new Error(`The approved ${videoLabel} scene plan must contain on-screen text or voiceover for a subtitle track`);
    error.code = "social_reel_subtitles_missing";
    throw error;
  }
  if (assembled.subtitle_text && assembled.subtitle_text !== subtitleText) {
    const error = new Error(`The assembled ${videoLabel} subtitle timing does not cover the complete approved scene plan`);
    error.code = "social_reel_subtitle_mismatch";
    throw error;
  }
  const subtitleBuffer = Buffer.from(subtitleText, "utf8");
  const storedSubtitle = await (dependencies.storeCampaignAsset || storeCampaignAsset)({
    fileName: subtitleFileName,
    buffer: subtitleBuffer,
  });
  const subtitleChecksum = crypto.createHash("sha256").update(subtitleBuffer).digest("hex");
  const storedSubtitleChecksum = trimText(storedSubtitle?.checksum_sha256).toLowerCase();
  const subtitleStorageProvider = trimText(storedSubtitle?.storage_provider).toLowerCase();
  const subtitleStorageKey = trimText(storedSubtitle?.storage_key);
  const subtitleReference = (dependencies.getGeneratedCampaignAssetReference || getGeneratedCampaignAssetReference)(subtitleStorageKey);
  if (
    !trimText(storedSubtitle?.url)
    || subtitleStorageProvider !== "local"
    || !subtitleStorageKey
    || (!subtitleReference?.filePath && !subtitleReference?.file_path)
    || (/^[a-f0-9]{64}$/.test(storedSubtitleChecksum) && storedSubtitleChecksum !== subtitleChecksum)
  ) {
    const error = new Error(`The ${videoLabel} subtitle track was not stored in guarded local campaign storage`);
    error.code = "social_reel_subtitle_storage_invalid";
    throw error;
  }
  const durationSeconds = reelDurationSeconds(scenes);
  const captionPolicy = buildCaptionPolicyProvenance(recommendation);
  const assetGroupId = `${creativeResult.asset_group_id || draft.idempotency_key || safeDraftId}-${videoSlug}-${version}`;
  const record = {
    draft_id: draft._id,
    generation_run_id: run?._id || draft.generation_run_id,
    draft_key: draft.idempotency_key,
    asset_group_id: assetGroupId,
    version: `ffmpeg-${version}`,
    asset_role: "FINAL_VIDEO",
    asset_type: finalVideoAssetType,
    social_format: socialFormat,
    visual_mode: visualMode,
    canvas_format: "VERTICAL_9_16",
    slide_number: 1,
    url: assembled.url || publicCampaignAssetUrl(storageKey),
    storage_provider: assembled.storage_provider || "local",
    storage_key: assembled.storage_key || storageKey,
    checksum_sha256: checksumSha256,
    media_kind: "VIDEO",
    publication_role: "PRIMARY_MEDIA",
    mime_type: assembled.mime_type || "video/mp4",
    file_size_bytes: fileSizeBytes,
    width: 1080,
    height: 1920,
    aspect_ratio: "9:16",
    duration_seconds: durationSeconds,
    frame_rate_fps: 30,
    video_codec: "h264",
    audio_codec: assembled.audio_rights ? "aac" : null,
    frame_count: Math.max(Math.round(durationSeconds * 30), 1),
    renderer: assembled.command_profile || "ffmpeg_h264_aac_1080x1920_v1",
    image_generation_status: "NOT_APPLICABLE",
    provenance: {
      role: socialFormat === "REEL" ? "final_reel_video" : "final_video_feed",
      assembler: "ffmpeg",
      command_profile: assembled.command_profile || "ffmpeg_h264_aac_1080x1920_v1",
      scene_plan_fingerprint_sha256: videoAssemblyFingerprint({ primaryRecommendation: recommendation }),
      storyboard_frames: sceneFrameMappings.map(({ visual, sceneIndex, reused }) => ({
        sequence: Number(visual.sequence || (sceneIndex % storyboardVisuals.length) + 2),
        scene_index: sceneIndex,
        generated_scene_index: Number.isInteger(visual.scene_index) ? visual.scene_index : null,
        reused_for_scene: reused,
        url: visual.url,
        checksum_sha256: visual.checksum_sha256,
        provider: visual.provider || imageResult.provider,
        model: visual.model || imageResult.model,
      })),
      subtitles_burned_in: burnSubtitles,
      subtitle_text: subtitleText,
      audio_included: Boolean(assembled.audio_rights),
      audio_rights: assembled.audio_rights || null,
      instagram_native_audio_requested: requestsInstagramNativeAudio(recommendation),
      caption_policy: captionPolicy,
    },
    source_provenance: "generated",
    usage_rights_status: "api_permitted",
    validation_checklist: [
      { key: "ffmpeg_output", label: "FFmpeg produced a non-empty H.264 MP4", status: "PASS", required: true, details: assembled.command_profile || "ffmpeg_h264_aac_1080x1920_v1" },
      { key: "storyboard_mapping", label: "Every approved scene maps to a generated storyboard frame", status: "PASS", required: true, details: `${scenes.length} scene${scenes.length === 1 ? "" : "s"} assembled from ${storyboardVisuals.length} generated frame${storyboardVisuals.length === 1 ? "" : "s"}` },
      { key: "subtitle_track", label: "Approved scene captions are present in the assembled video", status: "PASS", required: true, details: burnSubtitles ? "Complete SRT captions burned in" : "FULL_AI_GRAPHIC scene text was independently validated before assembly" },
      { key: "manual_visual_review", label: `Human ${videoLabel} playback and rights review`, status: "MANUAL_REVIEW", required: true, details: "Review playback, crop, caption timing, accessibility, and audio rights before approval" },
    ],
    validation_status: "needs_manual_review",
    manual_review_required: true,
    manual_review_flags: [
      socialFormat === "REEL" ? "REEL_PLAYBACK_AND_CROP" : "VIDEO_FEED_PLAYBACK_AND_CROP",
      "CAPTION_TIMING_AND_ACCESSIBILITY",
      "AUDIO_USAGE_RIGHTS",
    ],
    manual_review_status: "pending",
    is_active: true,
    deleted_at: null,
  };
  const subtitleRecord = {
    draft_id: draft._id,
    generation_run_id: run?._id || draft.generation_run_id,
    draft_key: draft.idempotency_key,
    asset_group_id: assetGroupId,
    version: `srt-${version}`,
    asset_role: "SUBTITLE_TRACK",
    asset_type: "subtitle_file",
    social_format: socialFormat,
    visual_mode: visualMode,
    canvas_format: null,
    slide_number: null,
    url: storedSubtitle.url,
    storage_provider: "local",
    storage_key: subtitleStorageKey,
    checksum_sha256: subtitleChecksum,
    media_kind: "SUBTITLE",
    publication_role: "NOT_PUBLISHABLE",
    mime_type: "application/x-subrip",
    file_size_bytes: subtitleBuffer.length,
    subtitle_language: trimText(reelContent(recommendation).subtitleLanguage || reelContent(recommendation).subtitle_language || "en-IN").slice(0, 40),
    renderer: "srt_scene_timing_v1",
    image_generation_status: "NOT_APPLICABLE",
    provenance: {
      role: socialFormat === "REEL" ? "reel_subtitle_track" : "video_feed_subtitle_track",
      format: "SRT",
      scene_count: scenes.length,
      complete_approved_scene_plan: true,
      checksum_sha256: subtitleChecksum,
    },
    source_provenance: "generated",
    usage_rights_status: "owned",
    validation_checklist: [
      { key: "subtitle_checksum", label: "Stored subtitle checksum matches the canonical SRT", status: "PASS", required: true, details: `sha256:${subtitleChecksum}` },
      { key: "subtitle_scene_coverage", label: "Subtitle track covers the complete approved scene plan", status: "PASS", required: true, details: `${scenes.length} approved scene${scenes.length === 1 ? "" : "s"}` },
    ],
    validation_status: "valid",
    manual_review_required: false,
    manual_review_flags: [],
    manual_review_status: "not_required",
    is_active: true,
    deleted_at: null,
  };
  if (typeof AssetModel.updateMany === "function") {
    await AssetModel.updateMany(
      { draft_id: draft._id, asset_type: "reel_cover", social_format: socialFormat, is_active: true },
      { $set: { publication_role: "COVER", media_kind: "IMAGE" } },
    );
    await AssetModel.updateMany(
      { draft_id: draft._id, asset_role: { $in: ["FINAL_VIDEO", "SUBTITLE_TRACK"] }, is_active: true, asset_group_id: { $ne: assetGroupId } },
      { $set: { is_active: false } },
    );
  }
  const videoAsset = await persistSocialAssetRecord(AssetModel, record);
  const subtitleAsset = await persistSocialAssetRecord(AssetModel, subtitleRecord);
  const manualActions = await persistInstagramNativeManualActions({
    draft,
    run,
    recommendation,
    videoAsset: asObject(videoAsset) || record,
    actor,
    dependencies,
  });
  const allAssets = [...safeArray(creativeResult.assets), videoAsset, subtitleAsset];
  return {
    ...creativeResult,
    assets: allAssets,
    asset_urls: [...safeArray(creativeResult.asset_urls), record.url, subtitleRecord.url],
    primary_asset_url: record.url,
    asset_count: allAssets.length,
    manual_review_required: true,
    manual_review_flags: Array.from(new Set([
      ...safeArray(creativeResult.manual_review_flags),
      ...record.manual_review_flags,
    ])),
    validation_status: creativeResult.validation_status === "invalid" ? "invalid" : "needs_manual_review",
    reel_video_asset: videoAsset,
    reel_subtitle_asset: subtitleAsset,
    manual_action: manualActions[0] || null,
    manual_actions: manualActions,
  };
}

function imageAttemptRows(imageResult, recommendation, visualMode) {
  const format = recommendation.format;
  const rows = [];
  imageResult.original_visuals.forEach((visual, assetIndex) => {
    safeArray(visual.failures).forEach((failure) => rows.push({
      attempt_number: Math.max(Number(failure.attempt || 1), 1),
      asset_index: assetIndex,
      slide_number: Number(visual.sequence || assetIndex + 1),
      format,
      visual_mode: visualMode,
      status: "FAILED",
      provider: visual.provider || imageResult.provider,
      model: visual.model || imageResult.model,
      image_prompt: visual.prompt,
      provider_response_id: null,
      original_asset_url: null,
      reference_assets: visual.reference_image_url ? [{
        type: "PRODUCT",
        url: visual.reference_image_url,
        checksum_sha256: visual.reference_image_checksum_sha256 || null,
        database_record_verified: visual.authentic_product_reference?.database_record_verified === true,
      }] : [],
      validation_results: null,
      usage: {},
      started_at: null,
      completed_at: new Date(),
      failure_reason: trimText(failure.message).slice(0, 4000),
    }));
    rows.push({
      attempt_number: Math.max(Number(visual.attempt_count || 1), 1),
      asset_index: assetIndex,
      slide_number: Number(visual.sequence || assetIndex + 1),
      format,
      visual_mode: visualMode,
      status: "VALIDATED",
      provider: visual.provider || imageResult.provider,
      model: visual.model || imageResult.model,
      image_prompt: visual.prompt,
      provider_response_id: visual.response_id || null,
      original_asset_url: visual.url,
      original_storage_key: visual.storage_key,
      original_checksum_sha256: visual.checksum_sha256,
      original_mime_type: visual.mime_type || "image/jpeg",
      original_width: visual.width,
      original_height: visual.height,
      reference_assets: visual.reference_image_url ? [{
        type: "PRODUCT",
        url: visual.reference_image_url,
        checksum_sha256: visual.reference_image_checksum_sha256 || null,
        database_record_verified: visual.authentic_product_reference?.database_record_verified === true,
      }] : [],
      validation_results: { passed: true, normalized_for_instagram: true, aspect_ratio: visual.aspect_ratio },
      usage: visual.usage || {},
      started_at: null,
      completed_at: new Date(),
      failure_reason: null,
    });
  });
  return rows;
}

async function persistOriginalAiVisualAssets({ draft, run, imageResult, recommendation, visualMode, AssetModel, replaceSequences = null }) {
  const shape = originalAssetShape(recommendation.format);
  const timestamp = Date.now();
  const assetGroupId = `ai-original-${run._id}-${timestamp}`;
  const version = `openai-${timestamp}`;
  const costPerImage = imageResult.image_count
    ? Number(imageResult.estimated_cost || 0) / Number(imageResult.image_count)
    : 0;
  const rows = imageResult.original_visuals.map((visual, index) => {
    const videoFormat = ["REEL", "VIDEO_FEED"].includes(recommendation.format);
    const reelStoryboardFrame = videoFormat
      && (["REEL_STORYBOARD_FRAME", "VIDEO_FEED_STORYBOARD_FRAME"].includes(visual.asset_purpose) || Number(visual.sequence || index + 1) > 1);
    const providerOriginal = visual.provider_original || {
      url: visual.url,
      storage_provider: visual.storage_provider || "local",
      storage_key: visual.storage_key,
      checksum_sha256: visual.checksum_sha256,
      mime_type: visual.mime_type || "image/jpeg",
      file_size_bytes: Math.max(Number(visual.file_size_bytes || visual.buffer?.length || 0), 1),
      width: visual.width,
      height: visual.height,
    };
    return ({
    draft_id: draft._id,
    generation_run_id: run._id,
    draft_key: draft.idempotency_key,
    asset_group_id: assetGroupId,
    version,
    asset_role: reelStoryboardFrame ? "GENERATED_FRAME" : "ORIGINAL_AI_VISUAL",
    ...shape,
    asset_type: reelStoryboardFrame ? "story_frame" : shape.asset_type,
    media_kind: "IMAGE",
    publication_role: videoFormat
      ? (reelStoryboardFrame ? "COMPANION" : "COVER")
      : "PRIMARY_MEDIA",
    social_format: recommendation.format,
    visual_mode: visualMode,
    slide_number: Number(visual.sequence || index + 1),
    url: visual.url,
    storage_provider: visual.storage_provider || "local",
    storage_key: visual.storage_key,
    checksum_sha256: visual.checksum_sha256,
    perceptual_hash_64: visual.perceptual_hash_64 || null,
    mime_type: visual.mime_type || "image/jpeg",
    file_size_bytes: Math.max(Number(visual.file_size_bytes || visual.buffer?.length || 0), 1),
    width: visual.width,
    height: visual.height,
    renderer: visual.authentic_product_composition?.renderer || visual.normalization?.renderer || "openai_image_api",
    image_generation_status: "VALIDATED",
    image_provider: visual.provider || imageResult.provider,
    image_model: visual.model || imageResult.model,
    image_prompt: visual.prompt,
    negative_visual_instructions: recommendation.formatContent?.negativeVisualInstructions || [],
    provider_response_id: visual.response_id || null,
    image_retry_number: Math.max(Number(visual.attempt_count || 1) - 1, 0),
    image_generated_at: new Date(),
    image_usage: visual.usage || {},
    image_estimated_cost: costPerImage,
    image_cost_currency: imageResult.cost_currency || "USD",
    original_visual: {
      url: providerOriginal.url,
      storage_provider: providerOriginal.storage_provider,
      storage_key: providerOriginal.storage_key,
      checksum_sha256: providerOriginal.checksum_sha256,
      mime_type: providerOriginal.mime_type,
      file_size_bytes: providerOriginal.file_size_bytes,
      width: providerOriginal.width,
      height: providerOriginal.height,
    },
    reference_assets: visual.reference_image_url ? [{
      reference_type: "PRODUCT_IMAGE",
      product_id: recommendation.verifiedProductId || null,
      url: visual.reference_image_url,
      original_database_url: visual.reference_image_url,
      stored_url: visual.authentic_product_reference?.url || null,
      storage_provider: visual.authentic_product_reference?.storage_provider || null,
      storage_key: visual.authentic_product_reference?.storage_key || null,
      checksum_sha256: visual.reference_image_checksum_sha256 || null,
      mime_type: visual.authentic_product_reference?.mime_type || visual.reference_image_mime_type || null,
      detected_file_signature: visual.authentic_product_reference?.detected_file_signature || null,
      file_size_bytes: visual.authentic_product_reference?.file_size_bytes || null,
      width: visual.authentic_product_reference?.width || null,
      height: visual.authentic_product_reference?.height || null,
      database_record_verified: visual.authentic_product_reference?.database_record_verified === true,
      source_bytes_preserved: visual.authentic_product_composition?.source_reference_checksum_sha256
        === visual.reference_image_checksum_sha256,
      usage_rights_status: visual.authentic_product_reference?.usage_rights_status || "admin_confirmed",
      authenticity_must_be_preserved: true,
    }] : [],
    provenance: {
      provider: visual.provider || imageResult.provider,
      model: visual.model || imageResult.model,
      prompt: visual.prompt,
      provider_response_id: visual.response_id || null,
      generation_fingerprint: imageResult.generation_fingerprint,
      role: reelStoryboardFrame ? "reel_storyboard_frame" : "original_ai_visual",
      asset_purpose: visual.asset_purpose || null,
      scene_index: Number.isInteger(visual.scene_index) ? visual.scene_index : null,
      perceptual_hash_64: visual.perceptual_hash_64 || null,
      ai_background: visual.ai_background || null,
      authentic_product_reference: visual.authentic_product_reference || null,
      authentic_product_composition: visual.authentic_product_composition || null,
      text_validation: visual.text_validation || null,
      poster_validation: visual.poster_validation || null,
      expected_text_blocks: visual.expected_text_blocks || null,
      full_ai_graphic_contract_version: visual.full_ai_graphic_contract_version || null,
      artwork_validation: visual.artwork_validation || null,
      provider_original: visual.provider_original || null,
      normalization: visual.normalization || null,
    },
    source_provenance: visual.source_provenance,
    usage_rights_status: visual.usage_rights_status,
    validation_checklist: [
      { key: "openai_original_validated", label: visual.ai_background ? "OpenAI background validation" : "OpenAI original image validation", status: "PASS", required: true, details: visual.ai_background ? "Text-free, product-free background decoded and validated before guarded local composition" : "Decoded, normalized, and validated before composition" },
      ...(visual.authentic_product_reference ? [{ key: "verified_product_reference", label: "Verified product reference integrity", status: "PASS", required: true, details: `Production database match and stored source-byte sha256:${visual.reference_image_checksum_sha256}` }] : []),
      ...(visual.authentic_product_composition ? [{ key: "authentic_product_composite", label: "Authentic product local composition", status: "PASS", required: true, details: "Product placed exactly once by Sharp without generative editing; human packaging review remains required" }] : []),
    ],
    validation_status: "valid",
    manual_review_required: true,
    manual_review_flags: [
      "human_visual_review_required",
      ...(visual.authentic_product_reference ? ["authentic_product_packaging_label_variant_quantity_review"] : []),
    ],
    manual_review_status: "pending",
    is_active: true,
    deleted_at: null,
    });
  });
  const created = typeof AssetModel.insertMany === "function"
    ? await AssetModel.insertMany(rows)
    : await AssetModel.create(rows);
  if (typeof AssetModel.updateMany === "function") {
    const replacementFilter = Array.isArray(replaceSequences) && replaceSequences.length
      ? { slide_number: { $in: replaceSequences } }
      : {};
    await AssetModel.updateMany(
      { draft_id: draft._id, asset_role: { $in: ["ORIGINAL_AI_VISUAL", "GENERATED_FRAME"] }, is_active: true, asset_group_id: { $ne: assetGroupId }, ...replacementFilter },
      { $set: { is_active: false } },
    );
  }
  return Array.isArray(created) ? created : [created];
}

async function requestGeneration({
  triggerType = "MANUAL",
  actor = null,
  now = new Date(),
  force = false,
  requestKey = null,
  generationRequest = {},
  weeklyContext = null,
  dependencies = {},
} = {}) {
  const models = {
    SocialGenerationRun: dependencies.SocialGenerationRun || SocialGenerationRun,
    SocialGenerationUsageLedger: dependencies.SocialGenerationUsageLedger
      || (dependencies.SocialGenerationRun ? null : SocialGenerationUsageLedger),
    SocialPostDraft: dependencies.SocialPostDraft || SocialPostDraft,
  };
  const session = dependencies.mongoSession || null;
  const settings = await (dependencies.getSocialManagerSettings || getSocialManagerSettings)();
  if (!settings.feature_enabled) {
    const error = new Error("The Social Media Manager is disabled");
    error.code = "social_manager_disabled";
    error.statusCode = 409;
    throw error;
  }
  const generationDate = getIstDateKey(now);
  const explicitVisualMode = trimText(generationRequest.visual_mode || generationRequest.visualMode);
  const requestedVisualMode = explicitVisualMode
    || settings.generation?.default_visual_mode
    || "AI_VISUAL_WITH_EXACT_OVERLAY";
  const normalizedRequest = normalizeGenerationRequest({
    ...generationRequest,
    visual_mode: requestedVisualMode,
  });
  const suppliedResolution = weeklyContext ? normalizedRequest.visual_mode_resolution : null;
  if (suppliedResolution) {
    const expectedResolution = resolveSocialVisualMode({
      requestedVisualMode: suppliedResolution.requested,
      fallbackVisualMode: "AI_VISUAL_WITH_EXACT_OVERLAY",
      recommendation: generationRequest.weekly_candidate || generationRequest.weeklyCandidate || {},
      strict: false,
    });
    if (expectedResolution.effective !== suppliedResolution.effective
      || expectedResolution.eligible !== suppliedResolution.eligible
      || JSON.stringify(expectedResolution.reasons) !== JSON.stringify(suppliedResolution.reasons)) {
      const error = new Error("The weekly visual-mode resolution no longer matches the approved candidate");
      error.code = "social_visual_mode_resolution_mismatch";
      error.statusCode = 409;
      throw error;
    }
    normalizedRequest.visual_mode = expectedResolution.effective;
    normalizedRequest.visual_mode_resolution = expectedResolution;
  } else {
    const recommendation = generationRequest.weekly_candidate || generationRequest.weeklyCandidate || {
      format: normalizedRequest.requested_format,
      objective: normalizedRequest.requested_post_type,
      postType: normalizedRequest.requested_post_type,
      verifiedProductId: normalizedRequest.verified_product_id,
    };
    const resolution = resolveSocialVisualMode({
      requestedVisualMode,
      fallbackVisualMode: settings.generation?.default_visual_mode || "AI_VISUAL_WITH_EXACT_OVERLAY",
      recommendation,
      strict: true,
    });
    normalizedRequest.visual_mode = resolution.effective;
    normalizedRequest.visual_mode_resolution = resolution;
  }
  const requestNeedsFreshGeneration = normalizedRequest.requested_format !== "AUTO_CHOOSE"
    || normalizedRequest.generation_scope !== "FULL_POST"
    || Boolean(normalizedRequest.admin_instructions)
    || Boolean(normalizedRequest.verified_product_id);
  const forceFresh = Boolean(force || requestNeedsFreshGeneration);
  if (!forceFresh) {
    const draft = await applyMongoSession(
      models.SocialPostDraft.findOne({ generation_date: generationDate }),
      session,
    ).sort({ revision: -1, created_at: -1 });
    if (draft) {
      const run = await applyMongoSession(models.SocialGenerationRun.findById(draft.generation_run_id), session);
      return { run, draft, reused: true };
    }
    const currentRun = await applyMongoSession(
      models.SocialGenerationRun.findOne({ generation_date: generationDate, status: { $in: ["PENDING", "RUNNING"] } }),
      session,
    ).sort({ created_at: -1 });
    if (currentRun) return { run: currentRun, draft: null, reused: true };
  }
  const adminId = actorId(actor);
  const defaultKey = triggerType === "SCHEDULED"
    ? `social-daily:${generationDate}`
    : `social-manual:${generationDate}:${adminId || "admin"}:${sha256(normalizedRequest).slice(0, 12)}:${Math.floor(now.getTime() / (forceFresh ? 5 * 60 * 1000 : 60 * 60 * 1000))}`;
  const idempotencyKey = trimText(requestKey || defaultKey).slice(0, 300);
  const existing = await applyMongoSession(models.SocialGenerationRun.findOne({ idempotency_key: idempotencyKey }), session);
  if (existing) {
    const draft = existing.selected_draft_id
      ? await applyMongoSession(models.SocialPostDraft.findById(existing.selected_draft_id), session)
      : null;
    return { run: existing, draft, reused: true };
  }
  await enforceMonthlyBudget({ settings, now, models });
  try {
    const run = await createWithSession(models.SocialGenerationRun, {
      generation_date: generationDate,
      timezone: "Asia/Kolkata",
      trigger_type: triggerType,
      idempotency_key: idempotencyKey,
      weekly_plan_id: weeklyContext?.planId || null,
      weekly_candidate_id: weeklyContext?.candidateId || null,
      request_fingerprint: sha256({ generationDate, triggerType, adminId, force: forceFresh, generationRequest: normalizedRequest }),
      generation_request: normalizedRequest,
      generation_mode: "FULL_AI",
      full_ai_generation: true,
      deterministic_content_fallback_used: false,
      template_only_visual_fallback_used: false,
      image_generation_status: "NOT_STARTED",
      status: "PENDING",
      current_stage: "QUEUED",
      initiated_by_admin_id: adminId,
      queued_at: now,
      available_at: now,
      max_attempts: Math.max(Number(settings.cost_controls.retry_limit || 2) + 1, 1),
    }, session);
    await appendAudit({ entityType: "GENERATION_RUN", entityId: run._id, run, action: "GENERATION_QUEUED", summary: "A daily social recommendation generation run was queued.", actor, actorType: triggerType === "SCHEDULED" ? "SYSTEM" : "ADMIN", dependencies });
    return { run, draft: null, reused: false };
  } catch (error) {
    if (error?.code === 11000) {
      const run = await applyMongoSession(models.SocialGenerationRun.findOne({ idempotency_key: idempotencyKey }), session);
      const draft = run?.selected_draft_id
        ? await applyMongoSession(models.SocialPostDraft.findById(run.selected_draft_id), session)
        : null;
      return { run, draft, reused: true };
    }
    throw error;
  }
}

async function updateRunStage(run, stage) {
  run.current_stage = stage;
  run.heartbeat_at = new Date();
  run.lease_expires_at = new Date(Date.now() + GENERATION_LEASE_MS);
  await run.save();
}

function generationErrorIsRetriable(error) {
  const status = Number(error?.status || error?.response?.status || 0);
  if ([400, 401, 403, 404, 409, 422].includes(status)) return false;
  if ([
    "structured_output_invalid",
    "social_compliance_rejected",
    "social_compliance_exhausted",
    "social_image_generation_failed",
    "social_image_validation_failed",
    "social_creative_validation_failed",
    "social_ai_not_configured",
    "social_manager_settings_invalid",
    "social_no_materially_different_candidates",
    "social_ffmpeg_unavailable",
    "social_reel_assembly_failed",
    "social_reel_frames_missing",
    "social_reel_frame_storage_unavailable",
    "social_reel_scene_mapping_invalid",
    "social_reel_scenes_missing",
    "social_reel_subtitles_missing",
    "social_reel_subtitle_mismatch",
    "social_reel_subtitle_storage_invalid",
    "social_reel_output_missing",
    "social_reel_output_invalid",
    "social_reel_output_path_invalid",
  ].includes(error?.code)) return false;
  return true;
}

async function executeGenerationRun(run, { dependencies = {} } = {}) {
  const models = {
    SocialAsset: dependencies.SocialAsset || SocialAsset,
    SocialGenerationRun: dependencies.SocialGenerationRun || SocialGenerationRun,
    SocialPostDraft: dependencies.SocialPostDraft || SocialPostDraft,
    SocialResearchSource: dependencies.SocialResearchSource || SocialResearchSource,
    SocialWeeklyPlan: dependencies.SocialWeeklyPlan || SocialWeeklyPlan,
  };
  const canonicalSettings = await (dependencies.getSocialManagerSettings || getSocialManagerSettings)();
  const runtimeSettings = (dependencies.buildSocialManagerRuntimeSettings || buildSocialManagerRuntimeSettings)(canonicalSettings);
  let draft = null;
  try {
    await updateRunStage(run, "COLLECTING_INTERNAL_SIGNALS");
    const internalSignals = await (dependencies.collectInternalSignals || collectInternalSignals)({ now: new Date(), settings: runtimeSettings, dependencies });
    run.internal_signal_summary = internalSignals.summary;
    run.internal_signal_counts = {
      products: Number(internalSignals.summary?.active_product_count || 0),
      affiliate_products: Number(internalSignals.summary?.active_affiliate_product_count || 0),
      blogs: Number(internalSignals.summary?.active_blog_count || 0),
      workshops: Number(internalSignals.summary?.active_workshop_count || 0),
      polls: Number(internalSignals.summary?.active_poll_count || 0),
      recent_social_posts: Number(internalSignals.summary?.recent_social_draft_count || 0),
      active_campaigns: Number(internalSignals.summary?.recent_product_campaign_count || 0),
    };
    await updateRunStage(run, "RESEARCHING");
    const research = await (dependencies.collectExternalResearch || collectExternalResearch)({ now: new Date(), internalSignals, settings: runtimeSettings, dependencies });
    run.input_snapshot_hash = sha256({ internalSignals, research: { mode: research.mode, signals: research.signals, sources: research.sources } });
    const sourceDocuments = await persistResearchSources({ run, research, dependencies });
    run.research_mode = researchMode(research.mode);
    run.source_ids = sourceDocuments.map((source) => source._id);
    await updateRunStage(run, "ANALYZING_MARKET");
    const decision = await (dependencies.generateDailyDecision || generateDailyDecision)({
      now: new Date(),
      internalSignals,
      research,
      settings: runtimeSettings,
      generationRequest: run.generation_request || normalizeGenerationRequest(),
      providers: dependencies.providers || {},
      dependencies,
    });
    const researchPromptRun = research.prompt_version ? [{
      stage: "research",
      provider: research.provider,
      model: research.model,
      prompt_version: research.prompt_version,
      usage: research.usage || {},
    }] : [];
    const promptVersionRows = await ensurePromptVersions({ promptRuns: [...researchPromptRun, ...(decision.prompt_runs || [])], actor: run.initiated_by_admin_id, dependencies });
    run.daily_market_analysis = decision.market_analysis || null;
    run.content_revision_attempts = decision.content_revision_attempts || [];
    run.stage_executions = stageExecutions(promptVersionRows);
    await run.save();

    const requestedVisualMode = run.generation_request?.visual_mode_resolution?.requested
      || run.generation_request?.visual_mode
      || "AI_VISUAL_WITH_EXACT_OVERLAY";
    const resolvedVisualMode = resolveSocialVisualMode({
      requestedVisualMode,
      fallbackVisualMode: "AI_VISUAL_WITH_EXACT_OVERLAY",
      recommendation: decision.package.primaryRecommendation,
      strict: !run.weekly_plan_id,
    });
    if (run.weekly_plan_id && run.generation_request?.visual_mode_resolution) {
      const frozen = asObject(run.generation_request.visual_mode_resolution);
      if (frozen.effective !== resolvedVisualMode.effective
        || frozen.eligible !== resolvedVisualMode.eligible
        || JSON.stringify(safeArray(frozen.reasons)) !== JSON.stringify(resolvedVisualMode.reasons)) {
        const error = new Error("Generated weekly content no longer matches the visual mode approved with the weekly plan");
        error.code = "social_visual_mode_resolution_mismatch";
        error.statusCode = 409;
        throw error;
      }
    }
    run.generation_request.visual_mode = resolvedVisualMode.effective;
    run.generation_request.visual_mode_resolution = resolvedVisualMode;
    run.markModified?.("generation_request");
    const generatedVisualBrief = decision.package.primaryRecommendation.visualBrief
      || decision.package.primaryRecommendation.visual_brief;
    if (generatedVisualBrief) generatedVisualBrief.visualMode = resolvedVisualMode.effective;

    await updateRunStage(run, "GENERATING_IMAGES");
    run.image_generation_status = "RUNNING";
    await run.save();
    const visualMode = resolvedVisualMode.effective;
    const imageResult = await (dependencies.generateSocialVisuals || generateSocialVisuals)({
      draftLike: {
        idempotency_key: `social-draft:${run._id}`,
        generation_date: run.generation_date,
        generation_run_id: run._id,
      },
      recommendation: decision.package.primaryRecommendation,
      settings: runtimeSettings,
      visualMode,
      dependencies: {
        ...dependencies,
        reviseImagePrompt: dependencies.reviseImagePrompt
          || dependencies.providers?.reviseImagePrompt
          || (typeof openAiSocialProvider.reviseImagePrompt === "function"
            ? async (input) => {
              const response = await openAiSocialProvider.reviseImagePrompt({
                context: input,
                settings: runtimeSettings,
                dependencies,
              });
              return response.output || response;
            }
            : undefined),
      },
    });
    await updateRunStage(run, "VALIDATING_IMAGES");
    run.image_generation_attempts = imageAttemptRows(imageResult, decision.package.primaryRecommendation, visualMode);
    run.image_generation_status = "COMPLETED";
    await run.save();
    await updateRunStage(run, "COMPOSING_FINAL_ASSETS");

    const priorDraft = await models.SocialPostDraft.findOne({ generation_date: run.generation_date }).sort({ revision: -1, created_at: -1 });
    const revision = Number(priorDraft?.revision || 0) + 1;
    const packageValue = validateSocialPackage(clone(decision.package));
    const recommendation = packageValue.primaryRecommendation;
    const contentFingerprint = buildPublicationFingerprint({ recommendation, assetUrls: [] });
    let weeklyDraftMetadata = {};
    if (run.weekly_plan_id && run.weekly_candidate_id) {
      const weeklyPlan = await models.SocialWeeklyPlan.findById(run.weekly_plan_id);
      const selectedPost = weeklyPlanItemByCandidate(weeklyPlan, run.weekly_candidate_id);
      const weeklyCandidate = selectedPost?.candidate
        || (weeklyPlan?.candidates || []).find(
          (item) => String(item.candidateId || item.candidate_id || "") === String(run.weekly_candidate_id),
        );
      if (!weeklyPlan || !selectedPost || !weeklyCandidate) {
        const error = new Error("The weekly-plan context for this generation run is no longer valid");
        error.code = "social_weekly_context_invalid";
        throw error;
      }
      assertWeeklyRecommendationIdentity(recommendation, weeklyCandidate);
      weeklyDraftMetadata = {
        weekly_plan_id: weeklyPlan._id,
        candidate_id: String(run.weekly_candidate_id),
        weekly_slot_number: Number(selectedPost.slotNumber || selectedPost.slot_number),
        week_start: weeklyPlan.week_start,
        week_end: weeklyPlan.week_end,
        primary_kpi: weeklyCandidate.primaryKpi || weeklyCandidate.primary_kpi,
        secondary_kpi: weeklyCandidate.secondaryKpi || weeklyCandidate.secondary_kpi || null,
        audience_segment: weeklyCandidate.audienceSegment || weeklyCandidate.audience_segment || null,
        scheduled_for: selectedPost.scheduledFor || selectedPost.scheduled_for || null,
        bundle_id: selectedPost.bundleId || selectedPost.bundle_id || null,
        bundle_role: selectedPost.bundleRole || selectedPost.bundle_role || null,
      };
    }
    let linkedBundleParent = null;
    if (weeklyDraftMetadata.bundle_id && weeklyDraftMetadata.bundle_role === "COMPANION_STORY") {
      linkedBundleParent = await models.SocialPostDraft.findOne({
        weekly_plan_id: weeklyDraftMetadata.weekly_plan_id,
        bundle_id: weeklyDraftMetadata.bundle_id,
        bundle_role: "PARENT_FEED",
      }).sort({ revision: -1, created_at: -1 });
    }
    const draftParentId = weeklyDraftMetadata.bundle_role
      ? linkedBundleParent?._id || null
      : priorDraft?._id || null;
    draft = await models.SocialPostDraft.create({
      generation_run_id: run._id,
      ...weeklyDraftMetadata,
      generation_date: run.generation_date,
      timezone: "Asia/Kolkata",
      revision,
      idempotency_key: `social-draft:${run._id}:${revision}`,
      parent_draft_id: draftParentId,
      generation_mode: "FULL_AI",
      visual_mode: visualMode,
      visual_mode_resolution: clone(run.generation_request?.visual_mode_resolution || {
        requested: visualMode,
        effective: visualMode,
        eligible: true,
        reasons: [],
      }),
      full_ai_ready: false,
      result_json: clone(packageValue),
      current_package: clone(packageValue),
      status: "DRAFT",
      research_source_ids: sourceDocuments.map((source) => source._id),
      prompt_version_ids: promptVersionRows.map((row) => row.document._id),
      duplicate_analysis: decision.duplicate_analysis,
      compliance_summary: decision.compliance,
      creative_readiness: { status: "PENDING", checked_at: new Date() },
      approval_json: { required: true, status: "NEEDS_REVIEW", approved_revision: null },
      content_fingerprint: contentFingerprint,
    });
    if (weeklyDraftMetadata.bundle_role === "PARENT_FEED"
      && weeklyDraftMetadata.bundle_id
      && typeof models.SocialPostDraft.updateMany === "function") {
      await models.SocialPostDraft.updateMany(
        {
          weekly_plan_id: weeklyDraftMetadata.weekly_plan_id,
          bundle_id: weeklyDraftMetadata.bundle_id,
          bundle_role: "COMPANION_STORY",
          parent_draft_id: null,
        },
        { $set: { parent_draft_id: draft._id } },
      );
    }
    const originalAssets = await persistOriginalAiVisualAssets({
      draft,
      run,
      imageResult,
      recommendation,
      visualMode,
      AssetModel: models.SocialAsset,
    });
    draft.original_ai_asset_ids = originalAssets.map((asset) => asset._id || asset.id).filter(Boolean);
    const usedUrls = new Set([
      ...packageValue.primaryRecommendation.sources,
      ...packageValue.alternativeRecommendations.flatMap((row) => row.sources),
    ].map((source) => source.url));
    await Promise.all(sourceDocuments.map((source) => {
      const paths = [];
      if (packageValue.primaryRecommendation.sources.some((row) => row.url === source.url)) paths.push("primaryRecommendation");
      packageValue.alternativeRecommendations.forEach((row, index) => {
        if (row.sources.some((item) => item.url === source.url)) paths.push(`alternativeRecommendations.${index}`);
      });
      const influencedDecision = usedUrls.has(source.url) && source.is_safe_to_use !== false;
      return models.SocialResearchSource.updateOne({ _id: source._id }, { $set: { draft_id: draft._id, used_in_final: influencedDecision, influenced_decision: influencedDecision, recommendation_paths: paths } });
    }));

    let creativeResult = await (dependencies.renderSocialDraftAssets || renderSocialDraftAssets)(draft, {
      assetModel: models.SocialAsset,
      baseImages: imageResult.original_visuals.map((visual) => ({
        buffer: visual.buffer,
        url: visual.url,
        source_url: visual.url,
        storage_provider: visual.storage_provider,
        storage_key: visual.storage_key,
        checksum_sha256: visual.checksum_sha256,
        mime_type: visual.mime_type,
        file_size_bytes: visual.file_size_bytes,
        width: visual.width,
        height: visual.height,
        source_provenance: visual.source_provenance,
        usage_rights_status: visual.usage_rights_status,
        provider: visual.provider,
        model: visual.model,
        prompt: visual.prompt,
        response_id: visual.response_id,
        attempt_count: visual.attempt_count,
        status: visual.status,
        reference_image_url: visual.reference_image_url,
        reference_image_checksum_sha256: visual.reference_image_checksum_sha256,
        reference_image_mime_type: visual.reference_image_mime_type,
        ai_background: visual.ai_background,
        authentic_product_reference: visual.authentic_product_reference,
        authentic_product_composition: visual.authentic_product_composition,
        usage: visual.usage,
        text_validation: visual.text_validation,
        poster_validation: visual.poster_validation,
        expected_text_blocks: visual.expected_text_blocks,
        full_ai_graphic_contract_version: visual.full_ai_graphic_contract_version,
        artwork_validation: visual.artwork_validation,
        perceptual_hash_64: visual.perceptual_hash_64,
        provider_original: visual.provider_original,
        normalization: visual.normalization,
      })),
      imageProvider: imageResult.provider,
      imageModel: imageResult.model,
      visualMode,
      sourceProvenance: "generated_without_reference",
      usageRightsStatus: "api_permitted",
      allowTemplateOnly: false,
    });
    if (creativeResult.validation_status === "invalid" || !creativeResult.assets.length) {
      const error = new Error("The final AI-based creative did not pass required asset validation");
      error.code = "social_creative_validation_failed";
      error.creative = creativeResult;
      throw error;
    }
    creativeResult = await assembleReelCreative({
      draft,
      run,
      recommendation,
      imageResult,
      creativeResult,
      visualMode,
      actor: run.initiated_by_admin_id,
      dependencies,
      AssetModel: models.SocialAsset,
    });
    if (visualMode === "FULL_AI_GRAPHIC") applyFullAiDraftManifest(draft, creativeResult.assets);
    draft.asset_ids = creativeAssetIds(creativeResult.assets);
    draft.final_composed_asset_ids = creativeAssetIds(creativeResult.assets, { publishableCompositionOnly: true });
    draft.creative_readiness = {
      status: creativeResult.manual_review_required ? "NEEDS_MANUAL_REVIEW" : "READY",
      validation_status: creativeResult.validation_status,
      manual_review_required: creativeResult.manual_review_required,
      manual_review_flags: creativeResult.manual_review_flags,
      asset_group_id: creativeResult.asset_group_id,
      primary_asset_url: creativeResult.primary_asset_url,
      original_asset_urls: imageResult.original_visuals.map((visual) => visual.url),
      asset_count: creativeResult.assets.length,
      ai_visual_required: true,
      ai_visual_status: "COMPLETED",
      reel_assembly_status: ["REEL", "VIDEO_FEED"].includes(recommendation.format) ? "COMPLETED" : "NOT_APPLICABLE",
      reel_video_asset_id: creativeResult.reel_video_asset?._id || creativeResult.reel_video_asset?.id || null,
      reel_video_url: creativeResult.reel_video_asset?.url || null,
      reel_subtitle_asset_id: creativeResult.reel_subtitle_asset?._id || creativeResult.reel_subtitle_asset?.id || null,
      reel_subtitle_url: creativeResult.reel_subtitle_asset?.url || null,
      reel_subtitle_language: creativeResult.reel_subtitle_asset?.subtitle_language || null,
      checked_at: new Date(),
    };
    draft.full_ai_ready = true;
    draft.status = "NEEDS_REVIEW";
    draft.submitted_for_review_at = new Date();
    await updateRunStage(run, "AWAITING_REVIEW");
    await draft.save();

    run.status = "SUCCEEDED";
    run.current_stage = "COMPLETED";
    run.selected_draft_id = draft._id;
    run.used_fallback = false;
    run.fallback_reason = null;
    run.deterministic_content_fallback_used = false;
    run.template_only_visual_fallback_used = false;
    run.full_ai_generation = true;
    run.stage_executions = stageExecutions(promptVersionRows);
    run.candidate_count = Number(decision.candidate_count || 0);
    run.candidate_summaries = candidateSummaries(decision);
    const combinedUsage = {
      input_tokens: Number(decision.usage?.input_tokens || 0) + Number(research.usage?.input_tokens || 0),
      output_tokens: Number(decision.usage?.output_tokens || 0) + Number(research.usage?.output_tokens || 0),
      total_tokens: Number(decision.usage?.total_tokens || 0) + Number(research.usage?.total_tokens || 0),
    };
    run.usage = {
      ...combinedUsage,
      estimated_cost: Number((estimateOpenAiCostUsd(combinedUsage) + Number(imageResult.estimated_cost || 0)).toFixed(6)),
      cost_currency: "USD",
    };
    run.completed_at = new Date();
    run.finished_at = run.completed_at;
    run.lease_owner = null;
    run.lease_expires_at = null;
    run.last_error = null;
    await run.save();
    if (run.weekly_plan_id && run.weekly_candidate_id) {
      await models.SocialWeeklyPlan.updateOne(
        { _id: run.weekly_plan_id, "selected_posts.candidateId": run.weekly_candidate_id },
        {
          $set: {
            "selected_posts.$.draft_id": draft._id,
            "selected_posts.$.generation_run_id": run._id,
            "selected_posts.$.status": "NEEDS_REVIEW",
          },
        },
      );
      await models.SocialWeeklyPlan.updateOne(
        { _id: run.weekly_plan_id, "story_plan.candidateId": run.weekly_candidate_id },
        {
          $set: {
            "story_plan.$.draft_id": draft._id,
            "story_plan.$.parent_draft_id": draft.parent_draft_id || null,
            "story_plan.$.generation_run_id": run._id,
            "story_plan.$.status": "NEEDS_REVIEW",
          },
        },
      );
    }
    await appendAudit({
      entityType: "DRAFT",
      entityId: draft._id,
      draft,
      run,
      action: "DRAFT_GENERATED",
      summary: visualMode === "FULL_AI_GRAPHIC"
        ? "Generated one primary and two alternatives through the staged AI workflow, then created and independently validated a complete OpenAI-rendered Pink Paisa graphic with no post-generation pixel overlays."
        : "Generated one primary and two alternatives through the staged AI workflow, then created original OpenAI artwork and an exact-copy final composition.",
      actor: run.initiated_by_admin_id,
      actorType: run.initiated_by_admin_id ? "ADMIN" : "WORKER",
      promptVersionIds: draft.prompt_version_ids,
      sourceIds: draft.research_source_ids,
      providerModels: (decision.prompt_runs || []).map((row) => ({ provider: row.provider, model: row.model, stage: row.stage })),
      metadata: {
        mode: decision.mode,
        creative_status: draft.creative_readiness?.status,
        candidate_count: decision.candidate_count,
        image_model: imageResult.model,
        image_count: imageResult.image_count,
        full_ai_graphic_contract_version: visualMode === "FULL_AI_GRAPHIC" ? 2 : null,
        overlay_method: ["FULL_AI_GRAPHIC", "AI_ARTWORK_ONLY"].includes(visualMode) ? "none" : "sharp_svg_overlay",
      },
      dependencies,
    });
    if (canonicalSettings.notifications.notify_on_draft) {
      try {
        await (dependencies.sendSocialDraftReviewNotification || sendSocialDraftReviewNotification)({
          recipients: canonicalSettings.notifications.reviewer_emails,
          draft,
        });
      } catch (notificationError) {
        await persistReviewerNotificationFailure({ draft, run, error: notificationError, dependencies });
      }
    }
    return draft;
  } catch (error) {
    const failedAt = new Date();
    const failedStage = run.current_stage;
    if (safeArray(error.content_revision_attempts).length) {
      run.content_revision_attempts = error.content_revision_attempts;
    }
    if (draft && !["PUBLISHED", "PUBLISHING"].includes(draft.status)) {
      draft.status = "FAILED";
      draft.failed_at = failedAt;
      draft.last_error = {
        code: error.code || "social_generation_failed",
        message: normalizeWhitespace(error.message).slice(0, 4000),
        stage: run.current_stage,
        is_retriable: false,
        occurred_at: failedAt,
      };
      await draft.save().catch(() => null);
    }
    if (run.weekly_plan_id && run.weekly_candidate_id) {
      await models.SocialWeeklyPlan.updateOne(
        { _id: run.weekly_plan_id, "selected_posts.candidateId": run.weekly_candidate_id },
        { $set: { "selected_posts.$.status": "FAILED" } },
      ).catch(() => null);
      await models.SocialWeeklyPlan.updateOne(
        { _id: run.weekly_plan_id, "story_plan.candidateId": run.weekly_candidate_id },
        { $set: { "story_plan.$.status": "FAILED" } },
      ).catch(() => null);
    }
    const retriable = generationErrorIsRetriable(error) && Number(run.attempt_count || 0) < Number(run.max_attempts || 1);
    const complianceFailure = error.code === "social_compliance_rejected" || error.code === "social_compliance_exhausted";
    const imageFailure = String(error.code || "").startsWith("social_image_")
      || ["GENERATING_IMAGES", "VALIDATING_IMAGES"].includes(failedStage);
    run.status = retriable ? "PENDING" : complianceFailure ? "FAILED_COMPLIANCE" : imageFailure ? "FAILED_IMAGE_GENERATION" : "FAILED";
    run.current_stage = retriable ? "QUEUED" : "FAILED";
    if (imageFailure) run.image_generation_status = "FAILED";
    if (draft) run.failed_draft_id = draft._id;
    run.retry_count = Number(run.retry_count || 0) + (retriable ? 1 : 0);
    run.available_at = retriable ? new Date(failedAt.getTime() + Math.min(30000 * (2 ** Number(run.retry_count || 0)), 30 * 60 * 1000)) : run.available_at;
    run.next_retry_at = retriable ? run.available_at : null;
    run.finished_at = retriable ? null : failedAt;
    run.lease_owner = null;
    run.lease_expires_at = null;
    run.last_error = {
      stage: failedStage || null,
      code: error.code || "social_generation_failed",
      message: normalizeWhitespace(error.message).slice(0, 4000),
      is_retriable: retriable,
      details: error.compliance
        ? { compliance: error.compliance, compliance_history: error.compliance_history || [] }
        : error.image_generation
          ? { image_generation: error.image_generation }
          : null,
      occurred_at: failedAt,
    };
    await run.save();
    await appendAudit({ entityType: "GENERATION_RUN", entityId: run._id, run, action: "GENERATION_FAILED", status: "FAILED", summary: retriable ? "Social generation failed temporarily and was queued for retry." : draft ? "Social generation failed; its incomplete draft was marked failed and cannot be approved." : "Social generation failed and no completed draft was created.", actor: run.initiated_by_admin_id, actorType: "WORKER", retryCount: run.retry_count, error, metadata: { next_retry_at: run.next_retry_at, failed_stage: failedStage, failure_status: run.status, failed_draft_id: draft?._id || null }, dependencies });
    if (!retriable) throw error;
    return null;
  }
}

async function processPendingSocialGenerationRuns({ now = new Date(), limit = 1, dependencies = {} } = {}) {
  const RunModel = dependencies.SocialGenerationRun || SocialGenerationRun;
  await RunModel.updateMany(
    { status: "RUNNING", lease_expires_at: { $lte: now } },
    { $set: { status: "PENDING", current_stage: "QUEUED", lease_owner: null, lease_expires_at: null, available_at: now } },
  );
  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  for (let index = 0; index < Math.max(Number(limit || 1), 1); index += 1) {
    const run = await RunModel.findOneAndUpdate(
      {
        status: "PENDING",
        available_at: { $lte: now },
        $or: [{ lease_expires_at: null }, { lease_expires_at: { $lte: now } }],
      },
      {
        $set: {
          status: "RUNNING",
          current_stage: "COLLECTING_INTERNAL_SIGNALS",
          lease_owner: GENERATION_WORKER_OWNER,
          lease_expires_at: new Date(now.getTime() + GENERATION_LEASE_MS),
          heartbeat_at: now,
          started_at: now,
          last_error: null,
        },
        $inc: { attempt_count: 1 },
      },
      { sort: { available_at: 1, created_at: 1 }, new: true },
    );
    if (!run) break;
    processed += 1;
    try {
      const draft = await executeGenerationRun(run, { dependencies });
      if (draft) succeeded += 1;
      else failed += 1;
    } catch (_error) {
      failed += 1;
    }
  }
  return { processed, succeeded, failed };
}

function istTimeParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
}

async function runDueSocialGeneration({ now = new Date(), dependencies = {} } = {}) {
  const settings = await (dependencies.getSocialManagerSettings || getSocialManagerSettings)();
  if (!settings.feature_enabled || !settings.daily_generation.enabled) return { queued: false, reason: "disabled" };
  const parts = istTimeParts(now);
  const currentMinute = parts.hour * 60 + parts.minute;
  const configuredMinute = Number(settings.daily_generation.hour_ist) * 60 + Number(settings.daily_generation.minute_ist);
  if (currentMinute < configuredMinute) return { queued: false, reason: "not_due" };
  const result = await requestGeneration({ triggerType: "SCHEDULED", now, dependencies });
  return { queued: !result.reused, reused: result.reused, run: result.run };
}

async function loadDraftRelations(draft, dependencies = {}) {
  if (!draft) return { assets: [], sources: [], audits: [], metrics: [], manualActions: [], publication: null, generationRun: null };
  const models = {
    SocialAsset: dependencies.SocialAsset || SocialAsset,
    SocialAuditLog: dependencies.SocialAuditLog || SocialAuditLog,
    SocialMetricSnapshot: dependencies.SocialMetricSnapshot || SocialMetricSnapshot,
    SocialPublication: dependencies.SocialPublication || SocialPublication,
    SocialResearchSource: dependencies.SocialResearchSource || SocialResearchSource,
    SocialGenerationRun: dependencies.SocialGenerationRun || SocialGenerationRun,
    SocialManualAction: dependencies.SocialManualAction || SocialManualAction,
  };
  const generationRunQuery = typeof models.SocialGenerationRun.findById === "function"
    ? models.SocialGenerationRun.findById(draft.generation_run_id)
    : null;
  const generationRunPromise = typeof generationRunQuery?.lean === "function"
    ? generationRunQuery.lean()
    : generationRunQuery;
  const canQueryDefaultManualActions = models.SocialManualAction !== SocialManualAction
    || mongoose.isValidObjectId(draft._id);
  const manualActionsPromise = canQueryDefaultManualActions
    ? models.SocialManualAction.find({ draft_id: draft._id }).sort({ status: 1, priority: -1, created_at: -1 }).limit(100).lean()
    : Promise.resolve([]);
  const [assets, sources, audits, metrics, manualActions, publication, generationRun] = await Promise.all([
    models.SocialAsset.find({ draft_id: draft._id, is_active: true, deleted_at: null }).sort({ slide_number: 1 }).lean(),
    models.SocialResearchSource.find({ _id: { $in: draft.research_source_ids || [] } }).sort({ used_in_final: -1, confidence: -1 }).lean(),
    models.SocialAuditLog.find({ draft_id: draft._id }).sort({ created_at: -1 }).limit(100).lean(),
    models.SocialMetricSnapshot.find({ draft_id: draft._id }).sort({ captured_at: -1 }).limit(100).lean(),
    manualActionsPromise,
    draft.publication_id ? models.SocialPublication.findById(draft.publication_id).lean() : null,
    generationRunPromise,
  ]);
  return { assets, sources, audits, metrics, manualActions, publication, generationRun };
}

async function getDraftDetail(draftId, { dependencies = {} } = {}) {
  const DraftModel = dependencies.SocialPostDraft || SocialPostDraft;
  const draft = await DraftModel.findById(draftId);
  if (!draft) {
    const error = new Error("Social draft not found");
    error.statusCode = 404;
    throw error;
  }
  return publicDraft(draft, await loadDraftRelations(draft, dependencies));
}

async function getGenerationRun(runId, { dependencies = {} } = {}) {
  const RunModel = dependencies.SocialGenerationRun || SocialGenerationRun;
  const DraftModel = dependencies.SocialPostDraft || SocialPostDraft;
  const run = await RunModel.findById(runId);
  if (!run) {
    const error = new Error("Social generation run not found");
    error.statusCode = 404;
    throw error;
  }
  const selectedDraft = run.selected_draft_id ? await DraftModel.findById(run.selected_draft_id) : null;
  const failedDraft = run.failed_draft_id ? await DraftModel.findById(run.failed_draft_id) : null;
  return {
    generation_run: publicRun(run),
    draft: selectedDraft ? publicDraft(selectedDraft, await loadDraftRelations(selectedDraft, dependencies)) : null,
    failed_draft: failedDraft ? publicDraft(failedDraft, await loadDraftRelations(failedDraft, dependencies)) : null,
  };
}

async function retryGenerationRun(runId, {
  actor = null,
  requestId = null,
  requestKey = null,
  ip = null,
  additionalInstructions = null,
  dependencies = {},
} = {}) {
  const RunModel = dependencies.SocialGenerationRun || SocialGenerationRun;
  const original = await RunModel.findById(runId);
  if (!original) {
    const error = new Error("Social generation run not found");
    error.statusCode = 404;
    throw error;
  }
  const status = String(original.status || "").toUpperCase();
  if (!["FAILED", "FAILED_COMPLIANCE", "FAILED_IMAGE_GENERATION"].includes(status)) {
    const error = new Error(`A ${status || "non-failed"} generation run cannot be manually retried`);
    error.code = "social_generation_retry_not_allowed";
    error.statusCode = 409;
    throw error;
  }
  const generationRequest = clone(asObject(original.generation_request) || {});
  const direction = trimText(additionalInstructions);
  if (direction) {
    generationRequest.admin_instructions = [
      trimText(generationRequest.admin_instructions),
      `Retry direction from the administrator: ${direction}`,
    ].filter(Boolean).join("\n").slice(0, 4000);
  }
  const result = await requestGeneration({
    triggerType: "RETRY",
    actor,
    force: true,
    requestKey: requestKey || `social-run-retry:${original._id}:${crypto.randomUUID()}`,
    generationRequest,
    dependencies,
  });
  await appendAudit({
    entityType: "GENERATION_RUN",
    entityId: original._id,
    run: original,
    action: "GENERATION_RETRY_REQUESTED",
    summary: `An administrator queued a new generation run to retry ${status.toLowerCase().replace(/_/g, " ")}.`,
    actor,
    requestId,
    ip,
    metadata: { retry_run_id: result.run?._id || null, additional_direction_supplied: Boolean(direction) },
    dependencies,
  });
  return result;
}

async function getTodayRecommendation({ now = new Date(), dependencies = {} } = {}) {
  const DraftModel = dependencies.SocialPostDraft || SocialPostDraft;
  const RunModel = dependencies.SocialGenerationRun || SocialGenerationRun;
  const date = getIstDateKey(now);
  const [run, settings, connection] = await Promise.all([
    RunModel.findOne({ generation_date: date }).sort({ created_at: -1 }),
    (dependencies.getSocialManagerSettings || getSocialManagerSettings)(),
    (dependencies.getInstagramConnectionSummary || getInstagramConnectionSummary)().catch(() => ({ is_connected: false, status: "error" })),
  ]);
  const runStatus = String(run?.status || "").toUpperCase();
  const completedRun = runStatus === "SUCCEEDED" && run?.selected_draft_id;
  const draft = completedRun
    ? await DraftModel.findById(run.selected_draft_id)
    : !run
      ? await DraftModel.findOne({ generation_date: date, status: { $nin: ["FAILED"] } }).sort({ revision: -1, created_at: -1 })
      : null;
  const previousDraft = !draft
    ? await DraftModel.findOne({ generation_date: date, status: { $nin: ["FAILED"] } }).sort({ revision: -1, created_at: -1 })
    : null;
  const failedDraft = run?.failed_draft_id
    ? await DraftModel.findById(run.failed_draft_id)
    : null;
  const relations = draft ? await loadDraftRelations(draft, dependencies) : null;
  const previousRelations = previousDraft ? await loadDraftRelations(previousDraft, dependencies) : null;
  const failedRelations = failedDraft ? await loadDraftRelations(failedDraft, dependencies) : null;
  const blockers = [];
  const warnings = [];
  const aiConfigured = Boolean(process.env.OPENAI_API_KEY);
  const fullAiGenerationEnabled = settings.generation?.full_ai_generation !== false;
  const manualGenerationEnabled = Boolean(
    settings.feature_enabled
    && aiConfigured
    && fullAiGenerationEnabled
  );
  if (!settings.feature_enabled) blockers.push("Social Media Manager is disabled.");
  if (!settings.daily_generation.enabled) warnings.push("Automatic daily generation is disabled; manual generation and existing draft review remain available.");
  if (!aiConfigured) blockers.push("OpenAI is not configured. Fully AI-generated strategy, copy, and original artwork cannot run.");
  if (!fullAiGenerationEnabled) blockers.push("Fully AI-generated social content is disabled in settings.");
  if (!publishingFeatureEnabled(settings)) warnings.push("Direct Instagram publishing is disabled; draft, approval, export, and scheduling remain available.");
  if (!connection.is_connected) warnings.push("Instagram is not connected; the full draft-generation and review workflow remains available.");
  return {
    date,
    timezone: "Asia/Kolkata",
    draft: draft ? publicDraft(draft, relations) : null,
    previous_draft: previousDraft ? publicDraft(previousDraft, previousRelations) : null,
    failed_draft: failedDraft ? publicDraft(failedDraft, failedRelations) : null,
    generation_run: publicRun(run),
    readiness: {
      // Retained for older clients: this describes the legacy automatic daily scheduler.
      generation_enabled: Boolean(settings.feature_enabled && settings.daily_generation.enabled && aiConfigured && fullAiGenerationEnabled),
      // Manual generation is intentionally independent of the legacy daily scheduler.
      manual_generation_enabled: manualGenerationEnabled,
      research_mode: settings.research.enabled ? settings.research.provider : "DISABLED",
      ai_configured: aiConfigured,
      publishing_enabled: publishingFeatureEnabled(settings),
      instagram_connected: Boolean(connection.is_connected),
      blockers,
      warnings,
    },
  };
}

async function listDraftCalendar({ status = null, dateFrom = null, dateTo = null, page = 1, limit = 50, dependencies = {} } = {}) {
  const DraftModel = dependencies.SocialPostDraft || SocialPostDraft;
  const query = {};
  if (status && status !== "ALL") query.status = status;
  if (dateFrom || dateTo) query.generation_date = { ...(dateFrom ? { $gte: dateFrom } : {}), ...(dateTo ? { $lte: dateTo } : {}) };
  const safeLimit = Math.min(Math.max(Number(limit || 50), 1), 100);
  const safePage = Math.max(Number(page || 1), 1);
  const [drafts, total] = await Promise.all([
    DraftModel.find(query).sort({ generation_date: -1, revision: -1 }).skip((safePage - 1) * safeLimit).limit(safeLimit).lean(),
    DraftModel.countDocuments(query),
  ]);
  return {
    items: drafts.map((draft) => publicDraft(draft)),
    page: safePage,
    limit: safeLimit,
    total,
    pages: Math.max(Math.ceil(total / safeLimit), 1),
  };
}

function clearApprovalAndSchedule(draft) {
  const weeklyProposedSchedule = draft.weekly_plan_id && draft.scheduled_for
    ? draft.scheduled_for
    : null;
  draft.approved_at = null;
  draft.approved_by_admin_id = null;
  draft.approved_revision = null;
  draft.scheduled_for = weeklyProposedSchedule;
  draft.scheduled_by_admin_id = null;
  draft.approval_json = { required: true, status: "PENDING", approved_revision: null };
  draft.schedule_json = null;
}

function fullAiNativeSwapFingerprint(draft = {}) {
  const value = asObject(draft) || {};
  return sha256Object({
    revision: Number(value.revision || 0),
    status: value.status || null,
    publication_id: value.publication_id ? String(value.publication_id) : null,
    current_package: value.current_package || null,
    asset_ids: safeArray(value.asset_ids).map(String),
    original_ai_asset_ids: safeArray(value.original_ai_asset_ids).map(String),
    final_composed_asset_ids: safeArray(value.final_composed_asset_ids).map(String),
  });
}

function normalizeNativeOnImageCopy(value = {}, prompt = "") {
  const headline = trimText(value.headline || value.selectedHeadline);
  const supportingText = trimText(value.supportingText || value.supportingCopy) || null;
  const altText = trimText(value.altText);
  const imagePrompt = trimText(value.imagePrompt || prompt);
  if (!headline || headline.length > 80 || (supportingText && supportingText.length > 160)) {
    const error = new Error("Native FULL_AI_GRAPHIC on-image headline/supporting copy must fit the approved 80/160 character limits");
    error.code = "social_full_ai_graphic_on_image_copy_invalid";
    error.statusCode = 400;
    throw error;
  }
  if (!altText || altText.length > 500) {
    const error = new Error("Native FULL_AI_GRAPHIC replacement requires accurate alt text of at most 500 characters");
    error.code = "social_full_ai_graphic_alt_text_invalid";
    error.statusCode = 400;
    throw error;
  }
  if (!imagePrompt || imagePrompt.length > 3000) {
    const error = new Error("The mutable social package requires an imagePrompt of at most 3,000 characters");
    error.code = "social_full_ai_graphic_package_prompt_invalid";
    error.statusCode = 400;
    throw error;
  }
  return { headline, supportingText, altText, imagePrompt };
}

function packageWithFullAiNativeMode(packageValue = {}, { onImageCopy = {}, prompt = "" } = {}) {
  const next = clone(packageValue);
  const recommendation = next.primaryRecommendation || {};
  const copy = normalizeNativeOnImageCopy(onImageCopy, prompt);
  const noOverlayInstruction = "All visible text and Pink Paisa branding are baked into the supplied AI-rendered image; apply no post-generation text, logo, SVG, background, composite, or pixel overlay.";
  recommendation.onPostCopy = {
    ...(recommendation.onPostCopy || {}),
    headline: copy.headline,
    supportingCopy: copy.supportingText,
  };
  recommendation.imageGenerationPrompt = copy.imagePrompt;
  recommendation.altText = copy.altText;
  if (recommendation.formatContent) {
    recommendation.formatContent.selectedHeadline = copy.headline;
    recommendation.formatContent.supportingText = copy.supportingText;
    if (Object.hasOwn(recommendation.formatContent, "interactionCopy")) recommendation.formatContent.interactionCopy = null;
    recommendation.formatContent.imagePrompt = copy.imagePrompt;
    recommendation.formatContent.altText = copy.altText;
    recommendation.formatContent.overlayInstructions = {
      logoPosition: "Baked into the AI-rendered image; no post-generation placement",
      headlinePosition: "Baked into the AI-rendered image; no post-generation placement",
      ctaPosition: null,
      disclosurePosition: "Baked into the AI-rendered image when present",
      safeAreaNotes: noOverlayInstruction,
    };
    if (Object.hasOwn(recommendation.formatContent, "visualMode")) recommendation.formatContent.visualMode = "FULL_AI_GRAPHIC";
  }
  if (recommendation.visualBrief) {
    recommendation.visualBrief.visualMode = "FULL_AI_GRAPHIC";
    recommendation.visualBrief.assets = safeArray(recommendation.visualBrief.assets).map((asset) => ({
      ...asset,
      imagePrompt: copy.imagePrompt,
      overlayInstructions: noOverlayInstruction,
    }));
  }
  if (recommendation.visual_brief) {
    recommendation.visual_brief.visualMode = "FULL_AI_GRAPHIC";
    recommendation.visual_brief.assets = safeArray(recommendation.visual_brief.assets).map((asset) => ({
      ...asset,
      imagePrompt: copy.imagePrompt,
      overlayInstructions: noOverlayInstruction,
    }));
  }
  next.primaryRecommendation = recommendation;
  return next;
}

function fullAiOriginalVisualValue(providerOriginal = {}) {
  return {
    url: providerOriginal.url,
    storage_provider: providerOriginal.storage_provider,
    storage_key: providerOriginal.storage_key,
    checksum_sha256: providerOriginal.checksum_sha256,
    mime_type: providerOriginal.mime_type,
    file_size_bytes: providerOriginal.file_size_bytes,
    width: providerOriginal.width,
    height: providerOriginal.height,
  };
}

async function buildNativeFullAiGraphicAssetRows({ draft, stage, renderItem, expectedTextBlocks, dependencies = {} }) {
  const recommendation = draft.current_package?.primaryRecommendation || {};
  const format = trimText(recommendation.format).toUpperCase();
  const shape = originalAssetShape(format);
  const approvedCopy = clone(renderItem.approved_copy || {});
  const copyChecksum = sha256Object(approvedCopy);
  const normalizedTextBlocks = normalizeFullAiTextManifest(expectedTextBlocks);
  if (stableIntegrityJson(normalizedTextBlocks) !== stableIntegrityJson(stage.expected_text_blocks || [])) {
    const error = new Error("The staged FULL_AI_GRAPHIC text contract no longer matches the approved draft copy");
    error.code = "social_full_ai_graphic_text_contract_stale";
    error.statusCode = 409;
    throw error;
  }
  if (stage.contract_version !== 2
    || stage.normalized?.checksum_sha256 !== stage.final?.checksum_sha256
    || !isSha256(stage.final?.checksum_sha256)) {
    const error = new Error("The staged FULL_AI_GRAPHIC does not satisfy the native passthrough v2 byte-integrity contract");
    error.code = "social_full_ai_graphic_passthrough_mismatch";
    error.statusCode = 422;
    throw error;
  }
  if (stage.normalization?.renderer !== "sharp_resize_encode_only_v1"
    || stage.normalization?.resize_fit !== "fill"
    || stage.normalization?.pixel_overlay_applied !== false) {
    const error = new Error("The supplied FULL_AI_GRAPHIC must be normalized using resize/encoding only without crop or overlay operations");
    error.code = "social_full_ai_graphic_normalization_invalid";
    error.statusCode = 422;
    throw error;
  }
  if (!fullAiPosterValidationPassed(stage.poster_validation, normalizedTextBlocks)) {
    const error = new Error("The supplied FULL_AI_GRAPHIC no longer has a passing independent poster validation");
    error.code = "social_full_ai_graphic_poster_invalid";
    error.statusCode = 422;
    throw error;
  }

  const originalId = new mongoose.Types.ObjectId();
  const finalId = new mongoose.Types.ObjectId();
  const originalGroupId = `${draft._id}-full-ai-native-source-${stage.version}`;
  const finalGroupId = `${draft._id}-full-ai-native-final-${stage.version}`;
  const common = {
    draft_id: draft._id,
    generation_run_id: draft.generation_run_id,
    draft_key: draft.idempotency_key,
    version: stage.version,
    ...shape,
    social_format: format,
    visual_mode: "FULL_AI_GRAPHIC",
    slide_number: Number(renderItem.sequence || 1),
    media_kind: "IMAGE",
    mime_type: stage.final.mime_type,
    width: stage.final.width,
    height: stage.final.height,
    aspect_ratio: stage.final.aspect_ratio,
    image_generation_status: "VALIDATED",
    image_provider: "openai",
    image_model: stage.model,
    image_prompt: stage.prompt,
    provider_request_id: stage.provider_request_id || null,
    provider_response_id: stage.provider_response_id || null,
    image_retry_number: 0,
    image_generated_at: null,
    image_usage: stage.generation_usage || {},
    image_cost_currency: stage.cost_currency || "USD",
    original_visual: fullAiOriginalVisualValue(stage.provider_original),
    reference_assets: [],
    source_provenance: stage.source_provenance,
    usage_rights_status: "api_permitted",
    manual_review_status: "pending",
    is_active: true,
    deleted_at: null,
  };
  const generationProvenance = {
    provider: "openai",
    model: stage.model,
    prompt: stage.prompt,
    provider_request_id: stage.provider_request_id || null,
    provider_response_id: stage.provider_response_id || null,
    generation_tool: stage.generation_tool || null,
    tool_execution_id: stage.tool_execution_id || null,
    reference_lineage: stage.reference_lineage || null,
  };
  const providerOriginal = {
    ...stage.provider_original,
    response_id: stage.provider_response_id || null,
    generation_tool: stage.generation_tool || null,
    tool_execution_id: stage.tool_execution_id || null,
  };
  const originalRow = {
    _id: originalId,
    ...common,
    asset_group_id: originalGroupId,
    asset_role: "ORIGINAL_AI_VISUAL",
    publication_role: "NOT_PUBLISHABLE",
    url: stage.normalized.url,
    storage_provider: stage.normalized.storage_provider,
    storage_key: stage.normalized.storage_key,
    checksum_sha256: stage.normalized.checksum_sha256,
    perceptual_hash_64: stage.normalized.perceptual_hash_64 || null,
    file_size_bytes: stage.normalized.file_size_bytes,
    renderer: "sharp_resize_encode_only_v1",
    image_estimated_cost: stage.estimated_cost,
    provenance: {
      ...generationProvenance,
      renderer: "sharp_resize_encode_only_v1",
      full_ai_graphic_contract_version: 2,
      full_ai_graphic_manifest: {
        contract_version: 2,
        expected_text_blocks: normalizedTextBlocks,
        checksum_sha256: sha256Object(normalizedTextBlocks),
        approved_copy_checksum_sha256: copyChecksum,
      },
      role: "original_ai_visual",
      provider_original: providerOriginal,
      normalization: stage.normalization,
      poster_validation: stage.poster_validation,
      overlay: {
        method: "none",
        pixel_overlay_applied: false,
        image_ai_used_for_text: true,
      },
    },
    validation_checklist: [
      { key: "provider_original_retained", label: "Byte-preserving AI provider original retained", status: "PASS", required: true, details: `sha256:${providerOriginal.checksum_sha256}` },
      { key: "resize_encode_only", label: "Instagram normalization used resize/encoding only", status: "PASS", required: true, details: "Sharp fit:fill; no composite, SVG, background, or overlay operation" },
      { key: "full_ai_poster_validation", label: "Independent exact poster validation", status: "PASS", required: true, details: `response:${stage.poster_validation.response_id}` },
    ],
    validation_status: "valid",
    manual_review_required: true,
    manual_review_flags: ["human_visual_review_required"],
  };

  const baseImageProvenance = {
    type: "openai_generated_complete_graphic",
    source_url: stage.normalized.url,
    checksum_sha256: stage.normalized.checksum_sha256,
    source_provenance: stage.source_provenance,
    provider: "openai",
    model: stage.model,
    prompt: stage.prompt,
    response_id: stage.provider_response_id || null,
    generation_tool: stage.generation_tool || null,
    tool_execution_id: stage.tool_execution_id || null,
    reference_lineage: stage.reference_lineage || null,
    generation_status: "VALIDATED",
    contains_approved_copy_by_design: true,
    original_asset_url: stage.provider_original.url,
    provider_original: providerOriginal,
    normalization: stage.normalization,
    poster_validation: stage.poster_validation,
  };
  const finalRow = {
    _id: finalId,
    ...common,
    asset_group_id: finalGroupId,
    asset_role: "FINAL_COMPOSED",
    publication_role: "PRIMARY_MEDIA",
    url: stage.final.url,
    storage_provider: stage.final.storage_provider,
    storage_key: stage.final.storage_key,
    checksum_sha256: stage.final.checksum_sha256,
    perceptual_hash_64: stage.normalized.perceptual_hash_64 || null,
    file_size_bytes: stage.final.file_size_bytes,
    renderer: "openai_generated_graphic_passthrough",
    render_version: "social-full-ai-graphic-native-v2",
    approved_copy_checksum_sha256: copyChecksum,
    image_estimated_cost: 0,
    overlay_json: {
      schema_version: "2.0.0",
      visual_mode: "FULL_AI_GRAPHIC",
      brand_name: "Pink Paisa",
      approved_copy: approvedCopy,
      approved_copy_checksum_sha256: copyChecksum,
      rendered_text: approvedCopy,
      rendered_text_blocks: normalizedTextBlocks,
      text_rendering: {
        method: "openai_image_baked_in_exact_copy",
        image_ai_used_for_text: true,
        pixel_overlay_applied: false,
        copy_source: renderItem.source_path,
        expected_text_blocks: normalizedTextBlocks,
        full_ai_graphic_poster_validation: stage.poster_validation,
      },
      logo: {
        method: "openai_image_baked_in",
        source: null,
        image_ai_used_for_logo: true,
      },
      layout: { within_safe_area: true, validation_source: "independent_vision" },
    },
    provenance: {
      ...generationProvenance,
      renderer: "openai_generated_graphic_passthrough",
      render_version: "social-full-ai-graphic-native-v2",
      full_ai_graphic_contract_version: 2,
      full_ai_graphic_manifest: {
        contract_version: 2,
        expected_text_blocks: normalizedTextBlocks,
        checksum_sha256: sha256Object(normalizedTextBlocks),
        approved_copy_checksum_sha256: copyChecksum,
      },
      base_image: baseImageProvenance,
      overlay: {
        method: "none",
        pixel_overlay_applied: false,
        image_ai_used_for_text: true,
        copy_source: renderItem.source_path,
        approved_copy_checksum_sha256: copyChecksum,
      },
      logo: { method: "openai_image_baked_in", source: null },
      caption_policy: buildCaptionPolicyProvenance(recommendation),
      final_pixel_contract: {
        method: "normalized_ai_bytes_passthrough",
        normalized_checksum_sha256: stage.normalized.checksum_sha256,
        final_checksum_sha256: stage.final.checksum_sha256,
        pixel_overlay_applied: false,
      },
    },
  };
  const validation = await (dependencies.validateSocialAsset || validateSocialAsset)(finalRow, {
    buffer: stage.final.buffer,
    expectedWidth: stage.final.width,
    expectedHeight: stage.final.height,
    expectedCopy: approvedCopy,
    manualReviewStatus: "pending",
  });
  if (!validation.passed) {
    const failed = safeArray(validation.validation_checklist)
      .filter((item) => item.required !== false && item.status === "FAIL")
      .map((item) => item.key)
      .join(", ");
    const error = new Error(`The native FULL_AI_GRAPHIC asset record failed creative validation${failed ? `: ${failed}` : ""}`);
    error.code = "social_creative_validation_failed";
    error.statusCode = 422;
    error.validation = validation;
    throw error;
  }
  validation.manual_review_flags = [
    ...safeArray(validation.manual_review_flags)
      .filter((flag) => flag !== "BASE_IMAGE_CONTAINS_UNAPPROVED_TEXT"),
    "AI_NATIVE_EXACT_TEXT_AND_BRAND",
  ].filter((flag, index, values) => values.indexOf(flag) === index);
  finalRow.validation_checklist = validation.validation_checklist;
  finalRow.validation_status = validation.validation_status;
  finalRow.manual_review_required = validation.manual_review_required;
  finalRow.manual_review_flags = validation.manual_review_flags;

  await Promise.all([originalRow, finalRow].map((row) => new SocialAsset(row).validate()));
  return {
    rows: [originalRow, finalRow],
    originalRow,
    finalRow,
    validation,
    expectedTextBlocks: normalizedTextBlocks,
    approvedCopy,
    approvedCopyChecksum: copyChecksum,
  };
}

async function maybeLean(query) {
  return query && typeof query.lean === "function" ? query.lean() : query;
}

async function replaceDraftWithSuppliedFullAiGraphic(draftId, {
  sourceBuffer,
  prompt,
  expectedTextBlocks,
  onImageCopy,
  model = null,
  providerResponseId = null,
  providerRequestId = null,
  generationTool = null,
  toolExecutionId = null,
  sourceProvenance = "generated_without_reference",
  referenceLineage = null,
  generationUsage = {},
  estimatedCost = 0,
  costCurrency = "USD",
  actor = null,
  requestId = null,
  ip = null,
  idempotencyKey = null,
  dependencies = {},
} = {}) {
  const DraftModel = dependencies.SocialPostDraft || SocialPostDraft;
  const AssetModel = dependencies.SocialAsset || SocialAsset;
  const AuditModel = dependencies.SocialAuditLog || SocialAuditLog;
  const readDetail = dependencies.getDraftDetail || getDraftDetail;
  const hasTransactionSupport = Boolean(
    dependencies.mongoSession
    || dependencies.startSession
    || (mongoose.connection?.readyState === 1 && typeof mongoose.startSession === "function"),
  );
  if (!hasTransactionSupport) {
    const error = new Error("Native FULL_AI_GRAPHIC replacement requires MongoDB transaction support");
    error.code = "social_transaction_required";
    error.statusCode = 503;
    throw error;
  }
  if (!Buffer.isBuffer(sourceBuffer)) {
    const error = new Error("A supplied AI-rendered source image buffer is required");
    error.code = "social_full_ai_graphic_source_invalid";
    error.statusCode = 400;
    throw error;
  }
  const manifest = normalizeFullAiTextManifest(expectedTextBlocks);
  const sourceChecksum = crypto.createHash("sha256").update(sourceBuffer).digest("hex");
  const mutationIdempotencyKey = trimText(idempotencyKey)
    || `social-full-ai-native-v2:${draftId}:${sourceChecksum}`;
  if (mutationIdempotencyKey.length > 400) {
    const error = new Error("FULL_AI_GRAPHIC replacement idempotency key exceeds 400 characters");
    error.code = "social_idempotency_key_invalid";
    error.statusCode = 400;
    throw error;
  }
  const priorAudit = await maybeLean(AuditModel.findOne({ idempotency_key: mutationIdempotencyKey }));
  if (priorAudit) {
    if (String(priorAudit.draft_id || "") !== String(draftId)
      || priorAudit.action !== "AI_IMAGE_REGENERATED"
      || priorAudit.action_status !== "SUCCEEDED") {
      const error = new Error("The supplied idempotency key is already assigned to a different social mutation");
      error.code = "social_idempotency_conflict";
      error.statusCode = 409;
      throw error;
    }
    return readDetail(draftId, { dependencies });
  }

  const preflightDraft = await DraftModel.findById(draftId);
  if (!preflightDraft) {
    const error = new Error("Social draft not found");
    error.statusCode = 404;
    throw error;
  }
  if (["PUBLISHING", "PUBLISHED"].includes(preflightDraft.status)) {
    const error = new Error("A publishing or published draft cannot replace its creative");
    error.statusCode = 409;
    throw error;
  }
  if (preflightDraft.publication_id) {
    const error = new Error("A draft with a publication attempt is immutable; duplicate it before changing creative");
    error.statusCode = 409;
    throw error;
  }
  const beforePackage = clone(preflightDraft.current_package);
  const nextPackage = packageWithFullAiNativeMode(beforePackage, { onImageCopy, prompt });
  (dependencies.validateSocialPackage || validateSocialPackage)(nextPackage);
  const recommendation = nextPackage.primaryRecommendation;
  const format = trimText(recommendation.format).toUpperCase();
  if (["CAROUSEL", "STORY", "REEL", "VIDEO_FEED", "PRODUCT_FEATURE"].includes(format)) {
    const error = new Error("A single supplied native FULL_AI_GRAPHIC can replace only an eligible one-image, non-product social post");
    error.code = "social_full_ai_graphic_single_asset_required";
    error.statusCode = 409;
    throw error;
  }
  const visualModeResolution = resolveSocialVisualMode({
    requestedVisualMode: "FULL_AI_GRAPHIC",
    fallbackVisualMode: "FULL_AI_GRAPHIC",
    recommendation,
    strict: true,
  });
  const renderItems = buildApprovedRenderItems(recommendation, format);
  if (renderItems.length !== 1) {
    const error = new Error("The approved draft must resolve to exactly one on-image copy record for native poster replacement");
    error.code = "social_full_ai_graphic_single_asset_required";
    error.statusCode = 409;
    throw error;
  }
  const captionBefore = buildSocialCaptionContract(beforePackage.primaryRecommendation);
  const captionAfter = buildSocialCaptionContract(recommendation);
  if (captionBefore.checksum_sha256 !== captionAfter.checksum_sha256
    || stableIntegrityJson(captionBefore.components) !== stableIntegrityJson(captionAfter.components)) {
    const error = new Error("Native poster replacement must not change the approved caption, CTA, hashtags, or disclosures");
    error.code = "social_caption_contract_changed";
    error.statusCode = 409;
    throw error;
  }
  const complianceProbe = clone(recommendation);
  complianceProbe.onPostCopy = {
    ...(complianceProbe.onPostCopy || {}),
    supportingCopy: manifest.map((block) => block.text).join("\n"),
  };
  const compliance = scanRecommendationCompliance(complianceProbe, { requireSourcesForCurrentClaims: true });
  if (!compliance.passed) {
    const error = new Error(`Native poster copy fails compliance: ${compliance.issues.filter((issue) => issue.severity === "error").map((issue) => issue.message).join(" ")}`);
    error.code = "social_compliance_rejected";
    error.statusCode = 422;
    error.compliance = compliance;
    throw error;
  }
  const canonicalSettings = await (dependencies.getSocialManagerSettings || getSocialManagerSettings)();
  const runtimeSettings = (dependencies.buildSocialManagerRuntimeSettings || buildSocialManagerRuntimeSettings)(canonicalSettings);
  const preflightFingerprint = fullAiNativeSwapFingerprint(preflightDraft);

  let stage = null;
  let prepared = null;
  try {
    stage = await (dependencies.stageSuppliedFullAiGraphic || stageSuppliedFullAiGraphic)({
      sourceBuffer,
      format,
      draftIdentity: preflightDraft.idempotency_key || preflightDraft._id,
      model,
      prompt,
      providerResponseId,
      providerRequestId,
      generationTool,
      toolExecutionId,
      sourceProvenance,
      referenceLineage,
      expectedTextBlocks: manifest,
      settings: runtimeSettings,
      generationUsage,
      estimatedCost,
      costCurrency,
      dependencies,
    });
    const preparedDraft = {
      ...asObject(preflightDraft),
      _id: preflightDraft._id,
      generation_run_id: preflightDraft.generation_run_id,
      idempotency_key: preflightDraft.idempotency_key,
      current_package: nextPackage,
    };
    prepared = await buildNativeFullAiGraphicAssetRows({
      draft: preparedDraft,
      stage,
      renderItem: renderItems[0],
      expectedTextBlocks: manifest,
      dependencies,
    });
  } catch (error) {
    if (stage?.staged_files?.length) {
      const cleanup = await (dependencies.cleanupStagedFullAiGraphic || cleanupStagedFullAiGraphic)(stage.staged_files, dependencies);
      if (cleanup.failed) error.staged_file_cleanup = cleanup;
    }
    throw error;
  }

  let mutation;
  try {
    mutation = await runInMongoTransaction(dependencies, async (session) => {
      const TransactionDraftModel = bindModelToMongoSession(DraftModel, session);
      const TransactionAssetModel = bindModelToMongoSession(AssetModel, session);
      const TransactionAuditModel = bindModelToMongoSession(AuditModel, session);
      const transactionDependencies = {
        ...dependencies,
        mongoSession: session,
        SocialPostDraft: TransactionDraftModel,
        SocialAsset: TransactionAssetModel,
        SocialAuditLog: TransactionAuditModel,
        SocialWeeklyPlan: bindModelToMongoSession(dependencies.SocialWeeklyPlan || SocialWeeklyPlan, session),
      };
      const replayAudit = await maybeLean(TransactionAuditModel.findOne({ idempotency_key: mutationIdempotencyKey }));
      if (replayAudit) {
        if (String(replayAudit.draft_id || "") !== String(draftId)
          || replayAudit.action !== "AI_IMAGE_REGENERATED"
          || replayAudit.action_status !== "SUCCEEDED") {
          const error = new Error("The supplied idempotency key is already assigned to a different social mutation");
          error.code = "social_idempotency_conflict";
          error.statusCode = 409;
          throw error;
        }
        return { replayed: true, draftId: preflightDraft._id };
      }
      const draft = await TransactionDraftModel.findById(draftId);
      if (!draft) {
        const error = new Error("Social draft not found");
        error.statusCode = 404;
        throw error;
      }
      if (["PUBLISHING", "PUBLISHED"].includes(draft.status) || draft.publication_id) {
        const error = new Error("The social draft became immutable before native poster replacement could commit");
        error.code = "social_draft_mutation_conflict";
        error.statusCode = 409;
        throw error;
      }
      if (fullAiNativeSwapFingerprint(draft) !== preflightFingerprint) {
        const error = new Error("The social draft changed while the native poster was being staged; retry against the latest revision");
        error.code = "social_draft_mutation_conflict";
        error.statusCode = 409;
        throw error;
      }

      await TransactionAssetModel.insertMany(prepared.rows);
      await TransactionAssetModel.updateMany(
        {
          draft_id: draft._id,
          is_active: true,
          deleted_at: null,
          _id: { $nin: [prepared.originalRow._id, prepared.finalRow._id] },
        },
        { $set: { is_active: false } },
      );
      draft.current_package = nextPackage;
      draft.visual_mode = "FULL_AI_GRAPHIC";
      draft.visual_mode_resolution = visualModeResolution;
      draft.generation_mode = "FULL_AI";
      draft.full_ai_ready = true;
      draft.full_ai_graphic_manifest = {
        contract_version: 2,
        expected_text_blocks: manifest,
        checksum_sha256: sha256Object(manifest),
        approved_copy_checksum_sha256: prepared.approvedCopyChecksum,
        generation_tool: stage.generation_tool || null,
        tool_execution_id: stage.tool_execution_id || null,
        updated_at: new Date(),
      };
      draft.asset_ids = [prepared.finalRow._id];
      draft.final_composed_asset_ids = [prepared.finalRow._id];
      draft.original_ai_asset_ids = [prepared.originalRow._id];
      draft.content_fingerprint = buildPublicationFingerprint({ recommendation, assetUrls: [prepared.finalRow.url] });
      draft.compliance_summary = { ...compliance, checked_at: new Date(), full_ai_graphic_manifest_checked: true };
      draft.revision = Math.max(Number(draft.revision || 0), 0) + 1;
      clearApprovalAndSchedule(draft);
      draft.rejected_at = null;
      draft.rejected_by_admin_id = null;
      draft.rejection_reason = null;
      draft.last_error = null;
      draft.status = "NEEDS_REVIEW";
      draft.submitted_for_review_at = new Date();
      draft.submitted_for_review_by = actorId(actor);
      draft.approval_json = {
        required: true,
        status: "NEEDS_REVIEW",
        approved_revision: null,
        submitted_at: draft.submitted_for_review_at,
      };
      const activeQuery = TransactionAssetModel.find({ draft_id: draft._id, is_active: true, deleted_at: null });
      const sortedActiveQuery = typeof activeQuery?.sort === "function" ? activeQuery.sort({ slide_number: 1 }) : activeQuery;
      const activeAssets = await maybeLean(sortedActiveQuery);
      const readiness = reviewAssetReadiness(activeAssets, { draft });
      if (!readiness.passed) {
        const error = new Error(`Native FULL_AI_GRAPHIC readiness failed: ${readiness.issues.join(" ")}`);
        error.code = "social_creative_readiness_failed";
        error.statusCode = 422;
        error.readiness = readiness;
        throw error;
      }
      draft.creative_readiness = {
        status: prepared.validation.manual_review_required ? "NEEDS_MANUAL_REVIEW" : "READY",
        validation_status: prepared.validation.validation_status,
        manual_review_required: prepared.validation.manual_review_required,
        manual_review_flags: prepared.validation.manual_review_flags,
        asset_group_id: prepared.finalRow.asset_group_id,
        primary_asset_url: prepared.finalRow.url,
        original_asset_urls: [stage.normalized.url],
        provider_original_asset_url: stage.provider_original.url,
        asset_count: 1,
        ai_visual_required: true,
        ai_visual_status: "COMPLETED",
        full_ai_graphic_contract_version: 2,
        pixel_overlay_applied: false,
        checked_at: new Date(),
      };
      await draft.save(session ? { session } : undefined);
      await (dependencies.syncWeeklyPlanFromDraft || syncWeeklyPlanFromDraft)(draft, {
        status: "NEEDS_REVIEW",
        dependencies: transactionDependencies,
      });
      await appendAudit({
        entityType: "DRAFT",
        entityId: draft._id,
        draft,
        action: "AI_IMAGE_REGENERATED",
        summary: "Replaced the draft media with one independently validated, fully AI-rendered poster using resize/encoding-only native passthrough and no post-generation pixel overlay.",
        actor,
        fieldChanges: findFieldChanges(beforePackage, nextPackage),
        requestId,
        idempotencyKey: mutationIdempotencyKey,
        ip,
        providerModels: [{ provider: "openai", model: stage.model, stage: "FULL_AI_GRAPHIC_NATIVE_V2" }],
        metadata: {
          full_ai_graphic_contract_version: 2,
          original_asset_id: String(prepared.originalRow._id),
          final_asset_id: String(prepared.finalRow._id),
          provider_original_url: stage.provider_original.url,
          normalized_original_url: stage.normalized.url,
          final_url: stage.final.url,
          provider_original_checksum_sha256: stage.provider_original.checksum_sha256,
          normalized_and_final_checksum_sha256: stage.final.checksum_sha256,
          approved_copy_checksum_sha256: prepared.approvedCopyChecksum,
          visible_text_manifest_checksum_sha256: sha256Object(manifest),
          generation_tool: stage.generation_tool || null,
          tool_execution_id: stage.tool_execution_id || null,
          source_provenance: stage.source_provenance,
          reference_lineage: stage.reference_lineage || null,
          provider_response_id: stage.provider_response_id || null,
          validation_response_id: stage.poster_validation.response_id,
          normalization_renderer: stage.normalization.renderer,
          resize_fit: stage.normalization.resize_fit,
          overlay_method: "none",
          pixel_overlay_applied: false,
          prior_revision: Number(preflightDraft.revision || 0),
          revision: Number(draft.revision || 0),
        },
        dependencies: transactionDependencies,
      });
      return { replayed: false, draftId: draft._id };
    });
  } catch (error) {
    const cleanup = await (dependencies.cleanupStagedFullAiGraphic || cleanupStagedFullAiGraphic)(stage.staged_files, dependencies);
    if (cleanup.failed) error.staged_file_cleanup = cleanup;
    throw error;
  }

  if (mutation.replayed) {
    const cleanup = await (dependencies.cleanupStagedFullAiGraphic || cleanupStagedFullAiGraphic)(stage.staged_files, dependencies);
    if (cleanup.failed) {
      const error = new Error("Idempotent native poster replay succeeded but newly staged duplicate files could not be fully removed");
      error.code = "social_full_ai_graphic_staged_cleanup_failed";
      error.staged_file_cleanup = cleanup;
      throw error;
    }
  }
  return readDetail(mutation.draftId, { dependencies });
}

function originalAssetDescriptor(asset) {
  return {
    url: asset.url,
    source_url: asset.url,
    storage_provider: asset.storage_provider,
    storage_key: asset.storage_key,
    checksum_sha256: asset.checksum_sha256,
    mime_type: asset.mime_type,
    file_size_bytes: asset.file_size_bytes,
    width: asset.width,
    height: asset.height,
    source_provenance: asset.source_provenance,
    usage_rights_status: asset.usage_rights_status,
    provider: asset.image_provider || asset.provenance?.provider,
    model: asset.image_model || asset.provenance?.model,
    prompt: asset.image_prompt || asset.provenance?.prompt,
    response_id: asset.provider_response_id || asset.provenance?.provider_response_id,
    attempt_count: Number(asset.image_retry_number || 0) + 1,
    status: "VALIDATED",
    sequence: Number(asset.slide_number),
    asset_purpose: asset.provenance?.asset_purpose || null,
    scene_index: Number.isInteger(asset.provenance?.scene_index) ? asset.provenance.scene_index : null,
    reference_image_url: asset.provenance?.base_image?.reference_image_url || asset.reference_assets?.[0]?.url || null,
    reference_image_checksum_sha256: asset.reference_assets?.[0]?.checksum_sha256 || null,
    reference_image_mime_type: asset.reference_assets?.[0]?.mime_type || null,
    ai_background: asset.provenance?.ai_background || null,
    authentic_product_reference: asset.provenance?.authentic_product_reference || null,
    authentic_product_composition: asset.provenance?.authentic_product_composition || null,
    text_validation: asset.text_validation || asset.provenance?.text_validation || null,
    poster_validation: asset.poster_validation || asset.provenance?.poster_validation || null,
    expected_text_blocks: asset.expected_text_blocks || asset.provenance?.expected_text_blocks || null,
    full_ai_graphic_contract_version: asset.full_ai_graphic_contract_version
      || asset.provenance?.full_ai_graphic_contract_version
      || null,
    artwork_validation: asset.artwork_validation || asset.provenance?.artwork_validation || null,
    perceptual_hash_64: asset.perceptual_hash_64 || asset.provenance?.perceptual_hash_64 || null,
    provider_original: asset.provider_original || asset.provenance?.provider_original || null,
    normalization: asset.normalization || asset.provenance?.normalization || null,
  };
}

async function recomposeDraftFromActiveOriginals(draft, {
  actor = null,
  dependencies = {},
  AssetModel = SocialAsset,
  visualMode = "AI_VISUAL_WITH_EXACT_OVERLAY",
} = {}) {
  const originalQuery = AssetModel.find({
    draft_id: draft._id,
    asset_role: { $in: ["ORIGINAL_AI_VISUAL", "GENERATED_FRAME"] },
    is_active: true,
    deleted_at: null,
  });
  const sortedOriginalQuery = typeof originalQuery?.sort === "function" ? originalQuery.sort({ slide_number: 1 }) : originalQuery;
  const originals = await (typeof sortedOriginalQuery?.lean === "function" ? sortedOriginalQuery.lean() : sortedOriginalQuery);
  if (!originals.length) {
    const error = new Error("The active OpenAI originals are missing; retained-original composition cannot continue safely");
    error.code = "social_original_visual_missing";
    error.statusCode = 409;
    throw error;
  }
  const baseImages = originals.map(originalAssetDescriptor).sort((left, right) => left.sequence - right.sequence);
  const recommendation = draft.current_package.primaryRecommendation;
  let creativeResult = await (dependencies.renderSocialDraftAssets || renderSocialDraftAssets)(draft, {
    assetModel: AssetModel,
    mongoSession: dependencies.mongoSession || null,
    baseImages,
    imageProvider: baseImages[0]?.provider,
    imageModel: baseImages[0]?.model,
    visualMode,
    allowTemplateOnly: false,
  });
  if (creativeResult.validation_status === "invalid" || !creativeResult.assets.length) {
    const error = new Error(`${visualMode === "FULL_AI_GRAPHIC" ? "FULL_AI branded-finish/video reassembly" : "Exact-copy recomposition"} from the retained AI originals failed validation`);
    error.code = "social_creative_validation_failed";
    error.statusCode = 409;
    throw error;
  }
  creativeResult = await assembleReelCreative({
    draft,
    run: { _id: draft.generation_run_id },
    recommendation,
    imageResult: {
      provider: baseImages[0]?.provider,
      model: baseImages[0]?.model,
      original_visuals: baseImages,
    },
    creativeResult,
    visualMode,
    actor,
    dependencies,
    AssetModel,
  });
  return { creativeResult, originals, baseImages };
}

async function refreshActiveCreativeMetadata(draft, AssetModel) {
  const recommendation = draft.current_package?.primaryRecommendation || {};
  const policy = buildCaptionPolicyProvenance(recommendation);
  await AssetModel.updateMany(
    {
      draft_id: draft._id,
      asset_role: { $in: ["FINAL_COMPOSED", "FINAL_VIDEO"] },
      is_active: true,
      deleted_at: null,
    },
    { $set: { "provenance.caption_policy": policy } },
  );
  const format = trimText(recommendation.format).toUpperCase();
  const copyUpdates = buildApprovedRenderItems(recommendation, format).map(async (item) => {
    const approvedCopy = clone(item.approved_copy);
    const approvedCopyChecksum = sha256Object(approvedCopy);
    await AssetModel.updateMany(
      {
        draft_id: draft._id,
        asset_role: "FINAL_COMPOSED",
        slide_number: Number(item.sequence),
        is_active: true,
        deleted_at: null,
      },
      {
        $set: {
          approved_copy_checksum_sha256: approvedCopyChecksum,
          "overlay_json.approved_copy": approvedCopy,
          "overlay_json.approved_copy_checksum_sha256": approvedCopyChecksum,
          "overlay_json.copy_source_path": item.source_path,
          "provenance.overlay.approved_copy_checksum_sha256": approvedCopyChecksum,
        },
      },
    );
    return { sequence: Number(item.sequence), approved_copy_checksum_sha256: approvedCopyChecksum };
  });
  return { caption_policy: policy, approved_copy: await Promise.all(copyUpdates) };
}

async function recheckSafeEditReadiness(draft, AssetModel) {
  const assetsQuery = AssetModel.find({
    draft_id: draft._id,
    is_active: true,
    deleted_at: null,
  });
  const sortedQuery = typeof assetsQuery?.sort === "function"
    ? assetsQuery.sort({ slide_number: 1 })
    : assetsQuery;
  const assets = await (typeof sortedQuery?.lean === "function" ? sortedQuery.lean() : sortedQuery);
  const result = reviewAssetReadiness(safeArray(assets), { draft });
  draft.creative_readiness = {
    ...(draft.creative_readiness || {}),
    asset_readiness_recheck: {
      passed: result.passed,
      issues: result.issues,
      final_asset_count: result.finalAssets.length,
      checked_at: new Date(),
    },
  };
  return result;
}

async function updateDraftPackage(draftId, input, { actor = null, requestId = null, ip = null, dependencies = {} } = {}) {
  const DraftModel = dependencies.SocialPostDraft || SocialPostDraft;
  const AssetModel = dependencies.SocialAsset || SocialAsset;
  const mutation = await runInMongoTransaction(dependencies, async (session) => {
    const TransactionAssetModel = bindModelToMongoSession(AssetModel, session);
    const TransactionDraftModel = bindModelToMongoSession(DraftModel, session);
    const transactionDependencies = {
      ...dependencies,
      mongoSession: session,
      SocialAsset: TransactionAssetModel,
      SocialAudioTrack: bindModelToMongoSession(dependencies.SocialAudioTrack || SocialAudioTrack, session),
      SocialAuditLog: bindModelToMongoSession(dependencies.SocialAuditLog || SocialAuditLog, session),
      SocialGenerationRun: bindModelToMongoSession(dependencies.SocialGenerationRun || SocialGenerationRun, session),
      SocialManualAction: bindModelToMongoSession(dependencies.SocialManualAction || SocialManualAction, session),
      SocialMetricSnapshot: bindModelToMongoSession(dependencies.SocialMetricSnapshot || SocialMetricSnapshot, session),
      SocialPostDraft: TransactionDraftModel,
      SocialPublication: bindModelToMongoSession(dependencies.SocialPublication || SocialPublication, session),
      SocialResearchSource: bindModelToMongoSession(dependencies.SocialResearchSource || SocialResearchSource, session),
      SocialWeeklyPlan: bindModelToMongoSession(dependencies.SocialWeeklyPlan || SocialWeeklyPlan, session),
    };
    const draft = await TransactionDraftModel.findById(draftId);
    if (!draft) { const error = new Error("Social draft not found"); error.statusCode = 404; throw error; }
    if (["PUBLISHING", "PUBLISHED"].includes(draft.status)) { const error = new Error("A publishing or published draft cannot be edited"); error.statusCode = 409; throw error; }
    if (draft.publication_id) { const error = new Error("A draft with a publication attempt is immutable; duplicate it before changing content"); error.statusCode = 409; throw error; }
    const before = clone(draft.current_package);
    let next;
    if (input?.current_package) next = clone(input.current_package);
    else if (input?.primary_recommendation) next = { ...clone(before), primaryRecommendation: clone(input.primary_recommendation) };
    else if (input?.primaryRecommendation) next = { ...clone(before), primaryRecommendation: clone(input.primaryRecommendation) };
    else next = clone(input);
    validateSocialPackage(next);
    const compliance = scanRecommendationCompliance(next.primaryRecommendation, { requireSourcesForCurrentClaims: true });
    if (!compliance.passed) {
      const error = new Error(`Draft changes fail compliance: ${compliance.issues.filter((issue) => issue.severity === "error").map((issue) => issue.message).join(" ")}`);
      error.code = "social_compliance_rejected";
      error.statusCode = 422;
      error.compliance = compliance;
      throw error;
    }
    if (next.primaryRecommendation.recommendedLandingPage) validateLandingPage(next.primaryRecommendation.recommendedLandingPage);
    const changes = findFieldChanges(before, next);
    if (!changes.length) return { draftId: draft._id, readDependencies: dependencies.mongoSession ? transactionDependencies : null };
    const onImageCopyChanged = creativeCopyFingerprint(before) !== creativeCopyFingerprint(next);
    const visualDirectionChanged = visualDirectionFingerprint(before) !== visualDirectionFingerprint(next);
    const fullAiHeadlineChanged = draft.visual_mode === "FULL_AI_GRAPHIC"
      && fullAiRenderedHeadlineFingerprint(before, {
        contractVersion: draft.full_ai_graphic_manifest?.contract_version || 1,
      }) !== fullAiRenderedHeadlineFingerprint(next, {
        contractVersion: draft.full_ai_graphic_manifest?.contract_version || 1,
      });
    const imageGenerationRequired = visualDirectionChanged || fullAiHeadlineChanged;
    const fullAiVideoReassemblyRequired = draft.visual_mode === "FULL_AI_GRAPHIC"
      && !imageGenerationRequired
      && videoAssemblyFingerprint(before) !== videoAssemblyFingerprint(next);
    const exactCopyRecomposeRequired = onImageCopyChanged
      && !visualDirectionChanged
      && draft.visual_mode === "AI_VISUAL_WITH_EXACT_OVERLAY";
    draft.current_package = next;
    draft.compliance_summary = { ...compliance, checked_at: new Date() };
    draft.content_fingerprint = buildPublicationFingerprint({ recommendation: next.primaryRecommendation, assetUrls: [] });
    clearApprovalAndSchedule(draft);
    draft.rejected_at = null;
    draft.rejected_by_admin_id = null;
    draft.rejection_reason = null;
    draft.last_error = null;
    if (imageGenerationRequired) {
      await TransactionAssetModel.updateMany({ draft_id: draft._id, is_active: true }, { $set: { is_active: false } });
      draft.asset_ids = [];
      draft.original_ai_asset_ids = [];
      draft.final_composed_asset_ids = [];
      draft.full_ai_ready = false;
      draft.creative_readiness = { status: "STALE", reason: visualDirectionChanged ? "Visual direction changed; fresh AI originals are required" : "The AI-rendered headline changed; fresh validated AI artwork is required", checked_at: new Date() };
    } else if (exactCopyRecomposeRequired || fullAiVideoReassemblyRequired) {
      const recomposed = await recomposeDraftFromActiveOriginals(draft, {
        actor,
        dependencies: transactionDependencies,
        AssetModel: TransactionAssetModel,
        visualMode: fullAiVideoReassemblyRequired ? "FULL_AI_GRAPHIC" : "AI_VISUAL_WITH_EXACT_OVERLAY",
      });
      draft.asset_ids = creativeAssetIds(recomposed.creativeResult.assets);
      draft.final_composed_asset_ids = creativeAssetIds(recomposed.creativeResult.assets, { publishableCompositionOnly: true });
      draft.original_ai_asset_ids = recomposed.originals.map((asset) => asset._id || asset.id).filter(Boolean);
      draft.full_ai_ready = true;
      draft.creative_readiness = {
        status: recomposed.creativeResult.manual_review_required ? "NEEDS_MANUAL_REVIEW" : "READY",
        validation_status: recomposed.creativeResult.validation_status,
        manual_review_required: recomposed.creativeResult.manual_review_required,
        manual_review_flags: recomposed.creativeResult.manual_review_flags,
        asset_group_id: recomposed.creativeResult.asset_group_id,
        primary_asset_url: recomposed.creativeResult.primary_asset_url,
        original_asset_urls: recomposed.baseImages.map((asset) => asset.url).filter(Boolean),
        asset_count: recomposed.creativeResult.assets.length,
        ai_visual_required: true,
        ai_visual_status: "REUSED",
        checked_at: new Date(),
      };
    } else {
      await refreshActiveCreativeMetadata(draft, TransactionAssetModel);
    }
    draft.revision = Math.max(Number(draft.revision || 0), 0) + 1;
    if (imageGenerationRequired) {
      draft.status = "DRAFT";
      draft.submitted_for_review_at = null;
    } else {
      await TransactionAssetModel.updateMany(
        {
          draft_id: draft._id,
          asset_role: { $in: ["FINAL_COMPOSED", "FINAL_VIDEO"] },
          is_active: true,
          deleted_at: null,
        },
        {
          $set: {
            manual_review_status: "pending",
            manual_reviewed_at: null,
            manual_reviewed_by: null,
          },
        },
      );
      await recheckSafeEditReadiness(draft, TransactionAssetModel);
      draft.status = "NEEDS_REVIEW";
      draft.submitted_for_review_at = new Date();
      draft.approval_json = {
        required: true,
        status: "NEEDS_REVIEW",
        approved_revision: null,
        submitted_at: draft.submitted_for_review_at,
      };
    }
    await draft.save(session ? { session } : undefined);
    await (dependencies.syncWeeklyPlanFromDraft || syncWeeklyPlanFromDraft)(draft, {
      status: imageGenerationRequired ? "GENERATING_VISUAL" : "NEEDS_REVIEW",
      dependencies: transactionDependencies,
    });
    await appendAudit({ entityType: "DRAFT", entityId: draft._id, draft, action: "DRAFT_EDITED", summary: `Edited ${changes.length} social content field${changes.length === 1 ? "" : "s"}${imageGenerationRequired ? "; fresh AI artwork is required" : exactCopyRecomposeRequired ? "; exact-copy assets were recomposed from retained AI originals" : fullAiVideoReassemblyRequired ? "; video was reassembled from retained AI frames" : ""}.`, actor, fieldChanges: changes, requestId, ip, metadata: { revision: draft.revision, workflow_status: draft.status, image_generation_required: imageGenerationRequired, exact_copy_recomposed: exactCopyRecomposeRequired, full_ai_video_reassembled: fullAiVideoReassemblyRequired, caption_policy_metadata_refreshed: !imageGenerationRequired && !exactCopyRecomposeRequired && !fullAiVideoReassemblyRequired, approved_copy_metadata_refreshed: !imageGenerationRequired && !exactCopyRecomposeRequired && !fullAiVideoReassemblyRequired, original_ai_assets_reused: !imageGenerationRequired }, dependencies: transactionDependencies });
    return { draftId: draft._id, readDependencies: dependencies.mongoSession ? transactionDependencies : null };
  });
  return getDraftDetail(mutation.draftId, { dependencies: mutation.readDependencies || dependencies });
}

async function regenerateDraftVisual(draftId, {
  actor = null,
  requestId = null,
  ip = null,
  templateMode = false,
  visualMode = null,
  assetSequence = null,
  dependencies = {},
} = {}) {
  const DraftModel = dependencies.SocialPostDraft || SocialPostDraft;
  const RunModel = dependencies.SocialGenerationRun || SocialGenerationRun;
  const AssetModel = dependencies.SocialAsset || SocialAsset;
  const draft = await DraftModel.findById(draftId);
  if (!draft) { const error = new Error("Social draft not found"); error.statusCode = 404; throw error; }
  if (["PUBLISHING", "PUBLISHED"].includes(draft.status)) { const error = new Error("A publishing or published draft cannot regenerate its creative"); error.statusCode = 409; throw error; }
  if (draft.publication_id) { const error = new Error("A draft with a publication attempt is immutable; duplicate it before changing creative"); error.statusCode = 409; throw error; }
  if (templateMode) {
    const error = new Error("Template-only Social Media Manager creatives are disabled; generate an original OpenAI visual or use an approved authentic product asset");
    error.code = "social_template_mode_disabled";
    error.statusCode = 400;
    throw error;
  }
  const canonicalSettings = await (dependencies.getSocialManagerSettings || getSocialManagerSettings)();
  const runtimeSettings = (dependencies.buildSocialManagerRuntimeSettings || buildSocialManagerRuntimeSettings)(canonicalSettings);
  const visualModeResolution = resolveSocialVisualMode({
    requestedVisualMode: visualMode || draft.visual_mode || canonicalSettings.generation?.default_visual_mode,
    fallbackVisualMode: draft.visual_mode || "AI_VISUAL_WITH_EXACT_OVERLAY",
    recommendation: draft.current_package.primaryRecommendation,
    strict: true,
  });
  const effectiveVisualMode = visualModeResolution.effective;
  const regenerationRecommendation = clone(draft.current_package.primaryRecommendation);
  if (regenerationRecommendation.visualBrief) regenerationRecommendation.visualBrief.visualMode = effectiveVisualMode;
  if (regenerationRecommendation.visual_brief) regenerationRecommendation.visual_brief.visualMode = effectiveVisualMode;
  const renderDraft = {
    ...asObject(draft),
    _id: draft._id,
    current_package: {
      ...clone(draft.current_package),
      primaryRecommendation: regenerationRecommendation,
    },
  };
  const requestedAssetSequence = assetSequence == null || assetSequence === "" ? null : Number(assetSequence);
  if (requestedAssetSequence != null
    && (!Number.isInteger(requestedAssetSequence) || draft.current_package.primaryRecommendation.format !== "CAROUSEL")) {
    const error = new Error("asset_sequence is supported only for an existing carousel slide");
    error.code = "social_asset_sequence_invalid";
    error.statusCode = 400;
    throw error;
  }
  let priorOriginalAssets = [];
  if (requestedAssetSequence != null) {
    const priorQuery = AssetModel.find({
      draft_id: draft._id,
      asset_role: "ORIGINAL_AI_VISUAL",
      is_active: true,
      deleted_at: null,
    });
    const sortedPriorQuery = typeof priorQuery?.sort === "function" ? priorQuery.sort({ slide_number: 1 }) : priorQuery;
    priorOriginalAssets = await (typeof sortedPriorQuery?.lean === "function" ? sortedPriorQuery.lean() : sortedPriorQuery);
    if (!priorOriginalAssets.some((asset) => Number(asset.slide_number) === requestedAssetSequence)) {
      const error = new Error("asset_sequence does not identify an active carousel original");
      error.code = "social_asset_sequence_invalid";
      error.statusCode = 400;
      throw error;
    }
  }
  const imageResult = await (dependencies.generateSocialVisuals || generateSocialVisuals)({
    draftLike: draft,
    recommendation: regenerationRecommendation,
    settings: runtimeSettings,
    visualMode: effectiveVisualMode,
    assetSequence: requestedAssetSequence,
    comparisonVisuals: priorOriginalAssets.map((asset) => ({
      sequence: Number(asset.slide_number),
      checksum_sha256: asset.checksum_sha256,
      perceptual_hash_64: asset.perceptual_hash_64 || asset.provenance?.perceptual_hash_64 || null,
    })),
    dependencies: {
      ...dependencies,
      reviseImagePrompt: dependencies.reviseImagePrompt
        || dependencies.providers?.reviseImagePrompt
        || (typeof openAiSocialProvider.reviseImagePrompt === "function"
          ? async (input) => {
            const response = await openAiSocialProvider.reviseImagePrompt({ context: input, settings: runtimeSettings, dependencies });
            return response.output || response;
          }
          : undefined),
    },
  });
  const generatedBaseImages = imageResult.original_visuals.map((visual) => ({
    buffer: visual.buffer,
    url: visual.url,
    source_url: visual.url,
    storage_provider: visual.storage_provider,
    storage_key: visual.storage_key,
    checksum_sha256: visual.checksum_sha256,
    mime_type: visual.mime_type,
    file_size_bytes: visual.file_size_bytes,
    width: visual.width,
    height: visual.height,
    source_provenance: visual.source_provenance,
    usage_rights_status: visual.usage_rights_status,
    provider: visual.provider,
    model: visual.model,
    prompt: visual.prompt,
    response_id: visual.response_id,
    attempt_count: visual.attempt_count,
    status: visual.status,
    reference_image_url: visual.reference_image_url,
    reference_image_checksum_sha256: visual.reference_image_checksum_sha256,
    reference_image_mime_type: visual.reference_image_mime_type,
    ai_background: visual.ai_background,
    authentic_product_reference: visual.authentic_product_reference,
    authentic_product_composition: visual.authentic_product_composition,
    usage: visual.usage,
    text_validation: visual.text_validation,
    poster_validation: visual.poster_validation,
    expected_text_blocks: visual.expected_text_blocks,
    full_ai_graphic_contract_version: visual.full_ai_graphic_contract_version,
    artwork_validation: visual.artwork_validation,
    perceptual_hash_64: visual.perceptual_hash_64,
    provider_original: visual.provider_original,
    normalization: visual.normalization,
    sequence: Number(visual.sequence),
  }));
  const retainedBaseImages = priorOriginalAssets
    .filter((asset) => Number(asset.slide_number) !== requestedAssetSequence)
    .map((asset) => ({
      url: asset.url,
      source_url: asset.url,
      storage_provider: asset.storage_provider,
      storage_key: asset.storage_key,
      checksum_sha256: asset.checksum_sha256,
      mime_type: asset.mime_type,
      file_size_bytes: asset.file_size_bytes,
      width: asset.width,
      height: asset.height,
      source_provenance: asset.source_provenance,
      usage_rights_status: asset.usage_rights_status,
      provider: asset.image_provider || asset.provenance?.provider,
      model: asset.image_model || asset.provenance?.model,
      prompt: asset.image_prompt || asset.provenance?.prompt,
      response_id: asset.provider_response_id || asset.provenance?.provider_response_id,
      attempt_count: Number(asset.image_retry_number || 0) + 1,
      status: "VALIDATED",
      poster_validation: asset.poster_validation || asset.provenance?.poster_validation || null,
      expected_text_blocks: asset.expected_text_blocks || asset.provenance?.expected_text_blocks || null,
      full_ai_graphic_contract_version: asset.full_ai_graphic_contract_version
        || asset.provenance?.full_ai_graphic_contract_version
        || null,
      reference_image_url: asset.provenance?.base_image?.reference_image_url || null,
      reference_image_checksum_sha256: asset.provenance?.authentic_product_reference?.checksum_sha256 || null,
      ai_background: asset.provenance?.ai_background || null,
      authentic_product_reference: asset.provenance?.authentic_product_reference || null,
      authentic_product_composition: asset.provenance?.authentic_product_composition || null,
      artwork_validation: asset.artwork_validation || asset.provenance?.artwork_validation || null,
      perceptual_hash_64: asset.perceptual_hash_64 || asset.provenance?.perceptual_hash_64 || null,
      provider_original: asset.provider_original || asset.provenance?.provider_original || null,
      normalization: asset.normalization || asset.provenance?.normalization || null,
      sequence: Number(asset.slide_number),
    }));
  const combinedBaseImages = requestedAssetSequence == null
    ? generatedBaseImages
    : [...retainedBaseImages, ...generatedBaseImages].sort((left, right) => left.sequence - right.sequence);
  const renderOptions = {
    assetModel: AssetModel,
    baseImages: combinedBaseImages,
    imageProvider: imageResult.provider,
    imageModel: imageResult.model,
    visualMode: effectiveVisualMode,
    allowTemplateOnly: false,
  };
  let originalAssets = [];
  if (typeof AssetModel.insertMany === "function" || typeof AssetModel.create === "function") {
    const persistedRun = await RunModel.findById(draft.generation_run_id);
    const runIdentity = persistedRun || { _id: draft.generation_run_id };
    originalAssets = await persistOriginalAiVisualAssets({
      draft,
      run: runIdentity,
      imageResult,
      recommendation: regenerationRecommendation,
      visualMode: effectiveVisualMode,
      AssetModel,
      replaceSequences: requestedAssetSequence == null ? null : [requestedAssetSequence],
    });
  }
  let result = await (dependencies.renderSocialDraftAssets || renderSocialDraftAssets)(renderDraft, renderOptions);
  if (result.validation_status === "invalid" || !result.assets.length) {
    const error = new Error("The regenerated creative did not pass required asset validation");
    error.code = "social_creative_validation_failed";
    throw error;
  }
  result = await assembleReelCreative({
    draft,
    run: { _id: draft.generation_run_id },
    recommendation: regenerationRecommendation,
    imageResult,
    creativeResult: result,
    visualMode: effectiveVisualMode,
    actor,
    dependencies,
    AssetModel,
  });
  if (effectiveVisualMode === "FULL_AI_GRAPHIC") applyFullAiDraftManifest(draft, result.assets);
  else draft.full_ai_graphic_manifest = null;
  draft.asset_ids = creativeAssetIds(result.assets);
  draft.final_composed_asset_ids = creativeAssetIds(result.assets, { publishableCompositionOnly: true });
  if (originalAssets.length) {
    const retainedIds = requestedAssetSequence == null
      ? []
      : priorOriginalAssets
        .filter((asset) => Number(asset.slide_number) !== requestedAssetSequence)
        .map((asset) => asset._id || asset.id)
        .filter(Boolean);
    draft.original_ai_asset_ids = [...retainedIds, ...originalAssets.map((asset) => asset._id || asset.id).filter(Boolean)];
  }
  draft.visual_mode = effectiveVisualMode;
  draft.visual_mode_resolution = visualModeResolution;
  draft.current_package = renderDraft.current_package;
  draft.generation_mode = "FULL_AI";
  draft.full_ai_ready = true;
  draft.creative_readiness = {
    status: result.validation_status === "invalid" ? "FAILED" : result.manual_review_required ? "NEEDS_MANUAL_REVIEW" : "READY",
    validation_status: result.validation_status,
    manual_review_required: result.manual_review_required,
    manual_review_flags: result.manual_review_flags,
    asset_group_id: result.asset_group_id,
    primary_asset_url: result.primary_asset_url,
    original_asset_urls: combinedBaseImages.map((visual) => visual.url || visual.source_url).filter(Boolean),
    asset_count: result.assets.length,
    ai_visual_required: true,
    ai_visual_status: "COMPLETED",
    reel_assembly_status: ["REEL", "VIDEO_FEED"].includes(draft.current_package.primaryRecommendation.format) ? "COMPLETED" : "NOT_APPLICABLE",
    reel_video_asset_id: result.reel_video_asset?._id || result.reel_video_asset?.id || null,
    reel_video_url: result.reel_video_asset?.url || null,
    reel_subtitle_asset_id: result.reel_subtitle_asset?._id || result.reel_subtitle_asset?.id || null,
    reel_subtitle_url: result.reel_subtitle_asset?.url || null,
    reel_subtitle_language: result.reel_subtitle_asset?.subtitle_language || null,
    checked_at: new Date(),
  };
  if (["APPROVED", "SCHEDULED", "REJECTED", "FAILED"].includes(draft.status)) clearApprovalAndSchedule(draft);
  draft.status = "NEEDS_REVIEW";
  draft.submitted_for_review_at = new Date();
  draft.approval_json = { required: true, status: "NEEDS_REVIEW", approved_revision: null };
  await draft.save();
  await (dependencies.syncWeeklyPlanFromDraft || syncWeeklyPlanFromDraft)(draft, { status: "NEEDS_REVIEW", dependencies });
  await appendAudit({ entityType: "DRAFT", entityId: draft._id, draft, action: "AI_IMAGE_REGENERATED", summary: requestedAssetSequence == null ? `Generated ${imageResult.image_count} new OpenAI original visual${imageResult.image_count === 1 ? "" : "s"} and recomposed the approved package.` : `Regenerated carousel slide ${requestedAssetSequence} and recomposed the carousel while retaining the other approved AI originals.`, actor, requestId, ip, metadata: { asset_group_id: result.asset_group_id, validation_status: result.validation_status, image_ai_used_for_text: effectiveVisualMode === "FULL_AI_GRAPHIC", template_mode: false, image_provider: imageResult?.provider || null, image_model: imageResult?.model || null, image_cost: imageResult?.estimated_cost ?? null, asset_sequence: requestedAssetSequence, partial_generation: requestedAssetSequence != null, visual_mode_resolution: visualModeResolution }, dependencies });
  return getDraftDetail(draft._id, { dependencies });
}

async function factCheckDraft(draftId, { actor = null, requestId = null, ip = null, dependencies = {} } = {}) {
  const DraftModel = dependencies.SocialPostDraft || SocialPostDraft;
  const SourceModel = dependencies.SocialResearchSource || SocialResearchSource;
  const draft = await DraftModel.findById(draftId);
  if (!draft) { const error = new Error("Social draft not found"); error.statusCode = 404; throw error; }
  const sources = await SourceModel.find({ _id: { $in: draft.research_source_ids || [] } }).lean();
  const safeUrls = new Set(sources.filter((source) => source.validation_status === "VALID" && source.is_safe_to_use && !source.prompt_injection_suspected).map((source) => source.url));
  const packageUrls = draft.current_package.primaryRecommendation.sources.map((source) => source.url);
  const unsafeSources = packageUrls.filter((url) => !safeUrls.has(url));
  const compliance = scanRecommendationCompliance(draft.current_package.primaryRecommendation, { requireSourcesForCurrentClaims: true });
  const passed = compliance.passed && !unsafeSources.length;
  draft.compliance_summary = { ...compliance, passed, unsafe_source_urls: unsafeSources, checked_at: new Date() };
  if (!passed && ["APPROVED", "SCHEDULED"].includes(draft.status)) {
    clearApprovalAndSchedule(draft);
    draft.status = "DRAFT";
  }
  await draft.save();
  if (!passed) await (dependencies.syncWeeklyPlanFromDraft || syncWeeklyPlanFromDraft)(draft, { status: "NEEDS_REVIEW", dependencies });
  await appendAudit({ entityType: "DRAFT", entityId: draft._id, draft, action: "FACT_CHECK_RERUN", status: passed ? "SUCCEEDED" : "FAILED", summary: passed ? "Server compliance and source traceability checks passed." : "Fact checking found blocking compliance or source issues.", actor, requestId, ip, metadata: { risk_flags: compliance.risk_flags, unsafe_source_count: unsafeSources.length }, dependencies });
  return getDraftDetail(draft._id, { dependencies });
}

function recommendationAsCandidate(recommendation, id) {
  return {
    id,
    internalTitle: recommendation.internalTitle,
    topic: recommendation.topic,
    whyToday: recommendation.whyToday,
    objective: recommendation.objective,
    format: recommendation.format,
    contentPillar: recommendation.contentPillar,
    targetAudienceSegment: recommendation.targetAudienceSegment,
    businessObjective: `Support ${recommendation.objective.toLowerCase().replace(/_/g, " ")} with useful Pink Paisa content.`,
    evidenceSourceIndexes: [],
    isEvergreen: recommendation.sources.length === 0,
    riskFlags: recommendation.riskFlags || [],
  };
}

function partialProviderOutput(result, label) {
  const output = result?.output ?? result;
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    const error = new Error(`The ${label} provider returned an invalid structured result`);
    error.code = "structured_output_invalid";
    throw error;
  }
  return output;
}

function partialPromptRun(stage, result, metadata = {}) {
  return {
    stage,
    provider: result?.provider || "openai",
    model: result?.model || null,
    prompt_version: result?.prompt_version || null,
    system_instructions_version: result?.system_instructions_version || result?.prompt_version || null,
    response_id: result?.response_id || null,
    provider_response_id: result?.response_id || null,
    usage: result?.usage || {},
    attempt_count: Number(result?.attempt_count || 1),
    retry_number: Math.max(Number(result?.attempt_count || 1) - 1, 0),
    input_fingerprint: result?.input_fingerprint || null,
    output_fingerprint: result?.output_fingerprint || null,
    output_json: clone(result?.output ?? result),
    started_at: result?.started_at || new Date(),
    completed_at: result?.completed_at || new Date(),
    request_metadata: metadata,
  };
}

function candidateForPartialRegeneration(recommendation, format = recommendation.format) {
  const candidate = recommendationAsCandidate(recommendation, recommendation.formatContent?.id || "primary");
  candidate.format = format;
  candidate.recommendedLandingPage = recommendation.recommendedLandingPage || null;
  candidate.evidenceSourceIndexes = safeArray(recommendation.sources).map((_source, index) => index);
  candidate.verifiedProductId = recommendation.verifiedProductId || recommendation.verifiedProductFacts?.id || null;
  candidate.verifiedProductTitle = recommendation.verifiedProductTitle || recommendation.verifiedProductFacts?.title || null;
  candidate.verifiedProductFacts = clone(recommendation.verifiedProductFacts || null);
  return candidate;
}

function preserveFormatVisualFields(existingContent, generatedContent) {
  const existing = clone(existingContent || {});
  const generated = clone(generatedContent || {});
  if (!existing || existing.format !== generated.format) return generated;
  if (generated.format === "CAROUSEL" && existing.slides?.length === generated.slides?.length) {
    generated.cohesiveArtDirection = existing.cohesiveArtDirection;
    generated.slides = generated.slides.map((slide, index) => ({
      ...slide,
      imagePrompt: existing.slides[index].imagePrompt,
      overlayInstructions: existing.slides[index].overlayInstructions,
    }));
    return generated;
  }
  if (generated.format === "STORY" && existing.frames?.length === generated.frames?.length) {
    generated.frames = generated.frames.map((frame, index) => ({
      ...frame,
      imagePrompt: existing.frames[index].imagePrompt,
      overlayInstructions: existing.frames[index].overlayInstructions,
    }));
    return generated;
  }
  if (["REEL", "VIDEO_FEED"].includes(generated.format)) {
    generated.coverImagePrompt = existing.coverImagePrompt;
    generated.overlayInstructions = clone(existing.overlayInstructions);
    if (existing.scenes?.length === generated.scenes?.length) {
      generated.scenes = generated.scenes.map((scene, index) => ({
        ...scene,
        visualInstruction: existing.scenes[index].visualInstruction,
      }));
    }
    return generated;
  }
  for (const key of [
    "imagePrompt",
    "negativeVisualInstructions",
    "overlayInstructions",
    "productPreservationInstructions",
  ]) {
    if (existing[key] !== undefined) generated[key] = clone(existing[key]);
  }
  return generated;
}

function recommendationWithFormatContent(recommendation, content, review = null) {
  const next = clone(recommendation);
  const sources = safeArray(recommendation.sources);
  const sourceIndexes = safeArray(content.sourceIndexes);
  next.whyToday = content.whyToday;
  next.objective = content.objective;
  next.format = content.format;
  next.formatReason = content.formatReason;
  next.postType = content.postType;
  next.contentPillar = content.contentPillar;
  next.targetAudienceSegment = content.targetAudience;
  next.hooks = clone(content.hookOptions);
  next.onPostCopy = legacyOnPostCopy(content);
  next.caption = content.caption;
  next.cta = content.cta;
  next.hashtags = clone(content.hashtags);
  next.formatContent = clone(content);
  next.altText = content.altText;
  next.financialDisclaimer = content.financialDisclaimer;
  next.affiliateDisclosure = content.affiliateDisclosure;
  next.recommendedLandingPage = content.recommendedLandingPage;
  next.sources = sourceIndexes.map((index) => sources[index]).filter(Boolean);
  next.riskFlags = [...new Set([...safeArray(recommendation.riskFlags), ...safeArray(review?.riskFlags)])];
  return next;
}

function partialAiUnavailable(message) {
  const error = new Error(message);
  error.code = "social_ai_not_configured";
  error.statusCode = 409;
  return error;
}

async function reviewAndRevisePartialContent({
  content,
  originalRecommendation,
  candidate,
  runtimeSettings,
  instructions,
  dependencies,
  promptRuns,
  revisionAttempts,
}) {
  const providers = dependencies.providers || {};
  const reviewProvider = providers.reviewSingleCompliance || openAiSocialProvider.reviewSingleCompliance;
  const revisionProvider = providers.reviseFormatContent || openAiSocialProvider.reviseFormatContent;
  if (!openAiSocialProvider.isConfigured() && !providers.reviewSingleCompliance) {
    throw partialAiUnavailable("OpenAI is required to run the independent compliance review.");
  }
  const maximumRevisions = Math.max(Number(
    runtimeSettings.ai_generation?.max_content_revisions
    || runtimeSettings.max_content_revisions
    || process.env.SOCIAL_MAX_CONTENT_REVISIONS
    || 3
  ), 0);
  let current = validateFormatContent(candidate.format, clone(content));
  let revisionsUsed = 0;
  while (true) {
    const reviewResult = await reviewProvider({
      format: candidate.format,
      settings: runtimeSettings,
      dependencies,
      context: buildComplianceReviewContext({
        generationDate: originalRecommendation.generationDate || null,
        candidate,
        formatContent: current,
        verifiedProduct: originalRecommendation.verifiedProductFacts || null,
        validatedSources: safeArray(originalRecommendation.sources),
        allowedDestinations: originalRecommendation.recommendedLandingPage
          ? [{ url: originalRecommendation.recommendedLandingPage, label: "Current verified destination" }]
          : [],
        administratorDirection: instructions || null,
      }),
    });
    promptRuns.push(partialPromptRun("single_compliance", reviewResult, {
      candidate_id: candidate.id,
      review_number: revisionsUsed + 1,
      partial_regeneration: true,
    }));
    const aiReview = partialProviderOutput(reviewResult, "compliance review");
    if (aiReview.id !== candidate.id) {
      const error = new Error("The AI compliance review returned the wrong content id");
      error.code = "structured_output_invalid";
      throw error;
    }
    const assembled = recommendationWithFormatContent(originalRecommendation, current, aiReview);
    const serverReview = scanRecommendationCompliance(assembled, { requireSourcesForCurrentClaims: true });
    const blockingServerIssues = safeArray(serverReview.issues).filter((issue) => issue.severity === "error");
    const effectiveReview = aiReview.decision === "PASS" && blockingServerIssues.length
      ? {
        ...aiReview,
        decision: "REVISE",
        issues: [
          ...safeArray(aiReview.issues),
          ...blockingServerIssues.map((issue) => ({
            code: issue.code,
            severity: "ERROR",
            fieldPath: null,
            message: issue.message,
          })),
        ],
        requiredChanges: [
          ...safeArray(aiReview.requiredChanges),
          ...blockingServerIssues.map((issue) => issue.message),
        ],
        riskFlags: [...new Set([...safeArray(aiReview.riskFlags), ...safeArray(serverReview.risk_flags)])],
      }
      : aiReview;
    if (effectiveReview.decision === "PASS") return { content: current, review: effectiveReview, serverReview };
    if (effectiveReview.decision === "REJECT" || revisionsUsed >= maximumRevisions) {
      const error = new Error(effectiveReview.decision === "REJECT"
        ? "The independent AI compliance reviewer rejected the requested regeneration"
        : "AI compliance revisions were exhausted for the requested regeneration");
      error.code = "social_compliance_exhausted";
      error.statusCode = 422;
      error.compliance = effectiveReview;
      error.content_revision_attempts = revisionAttempts;
      throw error;
    }
    if (!openAiSocialProvider.isConfigured() && !providers.reviseFormatContent) {
      throw partialAiUnavailable("OpenAI is required to revise content after compliance feedback.");
    }
    const revisionNumber = revisionsUsed + 1;
    const revisionStartedAt = new Date();
    const revisionResult = await revisionProvider({
      format: candidate.format,
      settings: runtimeSettings,
      dependencies,
      context: {
        candidate,
        original_content: current,
        compliance_feedback: effectiveReview,
        verified_product: originalRecommendation.verifiedProductFacts || null,
        validated_sources: safeArray(originalRecommendation.sources),
        administrator_direction: instructions || null,
        instruction: "Revise only the cited problems and return the complete corrected format-specific package.",
      },
    });
    promptRuns.push(partialPromptRun("revision", revisionResult, {
      candidate_id: candidate.id,
      revision_number: revisionNumber,
      partial_regeneration: true,
    }));
    const revision = validateScopedContentRevision({
      originalContent: current,
      complianceFeedback: effectiveReview,
      revision: validateRevisionResult(candidate.format, partialProviderOutput(revisionResult, "content revision")),
    });
    if (revision.id !== candidate.id || revision.format !== candidate.format) {
      const error = new Error("The AI revision changed the approved content id or format");
      error.code = "structured_output_invalid";
      throw error;
    }
    current = validateFormatContent(candidate.format, revision.revisedContent);
    revisionsUsed += 1;
    revisionAttempts.push({
      attempt_number: revisionAttempts.length + 1,
      candidate_id: candidate.id,
      compliance_decision: "REVISE",
      issues: safeArray(effectiveReview.issues).map((issue) => `${issue.code}: ${issue.message}`),
      revision_instructions: safeArray(effectiveReview.requiredChanges),
      provider: revisionResult.provider || "openai",
      model: revisionResult.model || null,
      provider_response_id: revisionResult.response_id || null,
      input_fingerprint: revisionResult.input_fingerprint || null,
      output_fingerprint: revisionResult.output_fingerprint || null,
      revised_output_json: clone(current),
      usage: revisionResult.usage || {},
      status: "COMPLETED",
      started_at: revisionStartedAt,
      completed_at: revisionResult.completed_at || new Date(),
      failure_reason: null,
    });
  }
}

async function regenerateDraftPart(draftId, scope, {
  actor = null,
  requestId = null,
  ip = null,
  instructions = null,
  targetFormat = null,
  dependencies = {},
} = {}) {
  const requestedScope = trimText(scope || "").toLowerCase();
  const normalizedScope = ({
    change_format: "format",
    format_change: "format",
    revise: "revision",
    run_compliance: "compliance",
    visual_direction: "visual",
  })[requestedScope] || requestedScope;
  if (normalizedScope === "fact_check") return factCheckDraft(draftId, { actor, requestId, ip, dependencies });
  const DraftModel = dependencies.SocialPostDraft || SocialPostDraft;
  const RunModel = dependencies.SocialGenerationRun || SocialGenerationRun;
  const AssetModel = dependencies.SocialAsset || SocialAsset;
  const draft = await DraftModel.findById(draftId);
  if (!draft) { const error = new Error("Social draft not found"); error.statusCode = 404; throw error; }
  if (["PUBLISHING", "PUBLISHED"].includes(draft.status)) { const error = new Error("A publishing or published draft cannot be regenerated"); error.statusCode = 409; throw error; }
  if (draft.publication_id) { const error = new Error("A draft with a publication attempt is immutable; duplicate it before regenerating content"); error.statusCode = 409; throw error; }
  const canonicalSettings = await (dependencies.getSocialManagerSettings || getSocialManagerSettings)();
  const runtimeSettings = (dependencies.buildSocialManagerRuntimeSettings || buildSocialManagerRuntimeSettings)(canonicalSettings);
  let nextPackage = clone(draft.current_package);
  let promptRuns = [];
  const revisionAttempts = [];
  let assetInvalidation = null;
  let independentComplianceReview = null;
  let collectedResearch = null;

  if (["strategy", "alternatives"].includes(normalizedScope)) {
    const internalSignals = await (dependencies.collectInternalSignals || collectInternalSignals)({ now: new Date(), settings: runtimeSettings, dependencies });
    const research = await (dependencies.collectExternalResearch || collectExternalResearch)({ now: new Date(), internalSignals, settings: runtimeSettings, dependencies });
    collectedResearch = research;
    const decision = await (dependencies.generateDailyDecision || generateDailyDecision)({
      now: new Date(),
      internalSignals,
      research,
      settings: runtimeSettings,
      generationRequest: {
        requested_format: "AUTO_CHOOSE",
        generation_scope: "STRATEGY",
        visual_mode: SOCIAL_VISUAL_MODES.has(draft.visual_mode) ? draft.visual_mode : "AI_VISUAL_WITH_EXACT_OVERLAY",
        admin_instructions: trimText(instructions) || null,
      },
      providers: dependencies.providers || {},
      dependencies,
    });
    if (normalizedScope === "strategy") {
      nextPackage = clone(decision.package);
      assetInvalidation = "ALL";
    } else {
      nextPackage.alternativeRecommendations = clone(decision.package.alternativeRecommendations);
      nextPackage.rejectedIdeas = clone(decision.package.rejectedIdeas);
    }
    promptRuns = decision.prompt_runs || [];
    revisionAttempts.push(...safeArray(decision.content_revision_attempts));
    const run = await RunModel.findById(draft.generation_run_id);
    if (run) {
      const newSources = await persistResearchSources({ run, research, dependencies });
      draft.research_source_ids = [...new Map([...(draft.research_source_ids || []).map((id) => [String(id), id]), ...newSources.map((source) => [String(source._id), source._id])]).values()];
    }
  } else if (["copy", "hooks", "caption", "revision", "compliance", "format"].includes(normalizedScope)) {
    const originalRecommendation = clone(nextPackage.primaryRecommendation);
    const requestedFormat = normalizedScope === "format"
      ? trimText(targetFormat).toUpperCase().replace(/[\s-]+/g, "_")
      : originalRecommendation.format;
    if (normalizedScope === "format" && (!requestedFormat || requestedFormat === "AUTO_CHOOSE" || !SOCIAL_FORMAT_PREFERENCES.has(requestedFormat))) {
      const error = new Error("target_format must be one supported concrete social format");
      error.statusCode = 400;
      throw error;
    }
    if (normalizedScope === "format" && requestedFormat === "PRODUCT_FEATURE" && !originalRecommendation.verifiedProductFacts) {
      const error = new Error("Changing to PRODUCT_FEATURE requires a verified active product record");
      error.code = "social_verified_product_required";
      error.statusCode = 422;
      throw error;
    }
    const candidate = candidateForPartialRegeneration(originalRecommendation, requestedFormat);
    let proposedContent = clone(originalRecommendation.formatContent);
    if (normalizedScope !== "compliance") {
      if (!openAiSocialProvider.isConfigured() && !dependencies.providers?.writeFormatContent) {
        throw partialAiUnavailable(`OpenAI is required to regenerate ${normalizedScope}; existing fields remain editable manually.`);
      }
      const writeProvider = dependencies.providers?.writeFormatContent || openAiSocialProvider.writeFormatContent;
      const writeResult = await writeProvider({
        format: requestedFormat,
        settings: runtimeSettings,
        dependencies,
        context: {
          generationDate: nextPackage.generationDate,
          timezone: nextPackage.timezone,
          brand_profile: runtimeSettings.brand_profile,
          selected_candidate: candidate,
          existing_approved_content: originalRecommendation.formatContent,
          verified_product: originalRecommendation.verifiedProductFacts || null,
          validated_sources: safeArray(originalRecommendation.sources),
          allowed_destinations: originalRecommendation.recommendedLandingPage
            ? [{ url: originalRecommendation.recommendedLandingPage, label: "Current verified destination" }]
            : [],
          administrator_direction: trimText(instructions) || null,
          requested_regeneration_scope: normalizedScope,
          instruction: normalizedScope === "format"
            ? `Rewrite the complete post for ${requestedFormat}; do not move unchanged copy between layouts.`
            : "Preserve the approved strategy, verified facts, destination, sources, and visual direction while rewriting only the requested copy.",
        },
      });
      promptRuns.push(partialPromptRun("format_copy", writeResult, {
        candidate_id: candidate.id,
        format: requestedFormat,
        regeneration_scope: normalizedScope,
      }));
      const generatedContent = validateFormatContent(requestedFormat, partialProviderOutput(writeResult, "format-specific copy"));
      if (generatedContent.id !== candidate.id || generatedContent.format !== requestedFormat) {
        const error = new Error("The AI copy stage changed the approved content id or requested format");
        error.code = "structured_output_invalid";
        throw error;
      }
      if ((generatedContent.recommendedLandingPage || null) !== (originalRecommendation.recommendedLandingPage || null)) {
        const error = new Error("The AI copy stage changed the verified landing destination");
        error.code = "social_destination_not_allowed";
        error.statusCode = 422;
        throw error;
      }
      if (originalRecommendation.verifiedProductFacts) {
        const verified = originalRecommendation.verifiedProductFacts;
        if (generatedContent.verifiedProductId !== undefined && generatedContent.verifiedProductId !== verified.id
          || generatedContent.verifiedProductTitle !== undefined && generatedContent.verifiedProductTitle !== verified.title
          || generatedContent.verifiedProductImageUrl !== undefined && generatedContent.verifiedProductImageUrl !== verified.imageUrl) {
          const error = new Error("The AI copy stage changed a verified product identifier, title, or authentic image URL");
          error.code = "social_verified_product_mismatch";
          error.statusCode = 422;
          throw error;
        }
      }
      if (normalizedScope === "hooks") {
        proposedContent.hookOptions = clone(generatedContent.hookOptions);
      } else if (normalizedScope === "caption") {
        for (const key of ["caption", "cta", "hashtags", "altText", "financialDisclaimer", "affiliateDisclosure"]) {
          proposedContent[key] = clone(generatedContent[key]);
        }
      } else {
        proposedContent = normalizedScope === "format"
          ? generatedContent
          : preserveFormatVisualFields(originalRecommendation.formatContent, generatedContent);
      }
    }
    const reviewResult = await reviewAndRevisePartialContent({
      content: proposedContent,
      originalRecommendation,
      candidate,
      runtimeSettings,
      instructions: trimText(instructions) || null,
      dependencies,
      promptRuns,
      revisionAttempts,
    });
    independentComplianceReview = reviewResult.review;
    nextPackage.primaryRecommendation = recommendationWithFormatContent(
      originalRecommendation,
      reviewResult.content,
      reviewResult.review,
    );
    if (normalizedScope === "format") {
      if (!openAiSocialProvider.isConfigured() && !dependencies.providers?.buildFormatVisualBrief) {
        throw partialAiUnavailable("OpenAI is required to create a new format-specific visual brief.");
      }
      const visualProvider = dependencies.providers?.buildFormatVisualBrief || openAiSocialProvider.buildFormatVisualBrief;
      const visualMode = SOCIAL_VISUAL_MODES.has(draft.visual_mode) ? draft.visual_mode : "AI_VISUAL_WITH_EXACT_OVERLAY";
      const visualResult = await visualProvider({
        format: requestedFormat,
        settings: runtimeSettings,
        dependencies,
        context: {
          generationDate: nextPackage.generationDate,
          candidate,
          approved_format_content: reviewResult.content,
          visual_mode: visualMode,
          brand_profile: runtimeSettings.brand_profile,
          brand_tokens: runtimeSettings.brand_tokens,
          verified_product: originalRecommendation.verifiedProductFacts || null,
          administrator_direction: trimText(instructions) || null,
          references: runtimeSettings.brand_references || [],
        },
      });
      promptRuns.push(partialPromptRun("visual_brief", visualResult, {
        candidate_id: candidate.id,
        format: requestedFormat,
        regeneration_scope: "format",
      }));
      const brief = validateVisualBrief(requestedFormat, partialProviderOutput(visualResult, "format-specific visual brief"));
      if (brief.id !== candidate.id || brief.format !== requestedFormat || brief.visualMode !== visualMode) {
        const error = new Error("The AI visual brief changed the approved content id, format, or visual mode");
        error.code = "structured_output_invalid";
        throw error;
      }
      if (originalRecommendation.verifiedProductFacts) {
        const authentic = brief.authenticProductReference;
        if (requestedFormat === "PRODUCT_FEATURE" && (!authentic
          || authentic.productId !== originalRecommendation.verifiedProductFacts.id
          || authentic.productTitle !== originalRecommendation.verifiedProductFacts.title
          || authentic.imageUrl !== originalRecommendation.verifiedProductFacts.imageUrl)) {
          const error = new Error("The AI format rewrite did not preserve the authentic product reference");
          error.code = "social_product_visual_reference_invalid";
          error.statusCode = 422;
          throw error;
        }
      }
      nextPackage.primaryRecommendation.visualBrief = clone(brief);
      nextPackage.primaryRecommendation.visualConcept = legacyVisualConcept(brief);
      nextPackage.primaryRecommendation.imageGenerationPrompt = brief.assets[0].imagePrompt;
      assetInvalidation = "ALL";
    } else if (creativeCopyFingerprint({ primaryRecommendation: originalRecommendation }) !== creativeCopyFingerprint(nextPackage)) {
      assetInvalidation = "FINAL_ONLY";
    }
  } else if (normalizedScope === "visual") {
    if (!openAiSocialProvider.isConfigured() && !dependencies.providers?.buildFormatVisualBrief) {
      throw partialAiUnavailable("OpenAI is required to regenerate the format-specific visual direction.");
    }
    const recommendation = nextPackage.primaryRecommendation;
    const candidate = candidateForPartialRegeneration(recommendation);
    const visualMode = SOCIAL_VISUAL_MODES.has(draft.visual_mode) ? draft.visual_mode : "AI_VISUAL_WITH_EXACT_OVERLAY";
    const result = await (dependencies.providers?.buildFormatVisualBrief || openAiSocialProvider.buildFormatVisualBrief)({
      format: recommendation.format,
      settings: runtimeSettings,
      dependencies,
      context: {
        generationDate: nextPackage.generationDate,
        candidate,
        approved_format_content: recommendation.formatContent,
        visual_mode: visualMode,
        brand_profile: runtimeSettings.brand_profile,
        brand_tokens: runtimeSettings.brand_tokens,
        verified_product: recommendation.verifiedProductFacts || null,
        administrator_direction: trimText(instructions) || null,
        references: runtimeSettings.brand_references || [],
      },
    });
    promptRuns.push(partialPromptRun("visual_brief", result, {
      candidate_id: candidate.id,
      format: recommendation.format,
      regeneration_scope: "visual",
    }));
    const brief = validateVisualBrief(recommendation.format, partialProviderOutput(result, "format-specific visual brief"));
    if (brief.id !== candidate.id || brief.format !== recommendation.format || brief.visualMode !== visualMode) {
      const error = new Error("The AI visual brief changed the approved content id, format, or visual mode");
      error.code = "structured_output_invalid";
      throw error;
    }
    nextPackage.primaryRecommendation.visualBrief = clone(brief);
    nextPackage.primaryRecommendation.visualConcept = legacyVisualConcept(brief);
    nextPackage.primaryRecommendation.imageGenerationPrompt = brief.assets[0].imagePrompt;
    assetInvalidation = "ALL";
  } else {
    const error = new Error("scope must be strategy, alternatives, copy, hooks, caption, format, revision, compliance, visual, image, or fact_check");
    error.statusCode = 400;
    throw error;
  }

  validateSocialPackage(nextPackage);
  const compliance = scanRecommendationCompliance(nextPackage.primaryRecommendation, { requireSourcesForCurrentClaims: true });
  if (!compliance.passed) {
    const error = new Error(`Regenerated content fails server compliance: ${compliance.risk_flags.join(", ")}`);
    error.code = "social_compliance_rejected";
    error.statusCode = 422;
    throw error;
  }
  const before = clone(draft.current_package);
  const changes = findFieldChanges(before, nextPackage);
  draft.current_package = nextPackage;
  draft.compliance_summary = {
    ...compliance,
    ai_review: independentComplianceReview ? clone(independentComplianceReview) : draft.compliance_summary?.ai_review || null,
    checked_at: new Date(),
  };
  draft.content_fingerprint = buildPublicationFingerprint({ recommendation: nextPackage.primaryRecommendation, assetUrls: [] });
  if (changes.length) {
    clearApprovalAndSchedule(draft);
  }
  const promptVersionRows = await ensurePromptVersions({ promptRuns, actor, dependencies });
  draft.prompt_version_ids = [...new Map([...(draft.prompt_version_ids || []).map((id) => [String(id), id]), ...promptVersionRows.map((row) => [String(row.document._id), row.document._id])]).values()];
  if (
    assetInvalidation === "FINAL_ONLY"
    && draft.visual_mode === "FULL_AI_GRAPHIC"
    && fullAiRenderedHeadlineFingerprint(before, {
      contractVersion: draft.full_ai_graphic_manifest?.contract_version || 1,
    }) !== fullAiRenderedHeadlineFingerprint(nextPackage, {
      contractVersion: draft.full_ai_graphic_manifest?.contract_version || 1,
    })
  ) assetInvalidation = "ALL";
  if (assetInvalidation === "ALL") {
    await AssetModel.updateMany({ draft_id: draft._id, is_active: true }, { $set: { is_active: false } });
    draft.asset_ids = [];
    draft.original_ai_asset_ids = [];
    draft.final_composed_asset_ids = [];
    draft.full_ai_ready = false;
    draft.creative_readiness = { status: "STALE", reason: `${normalizedScope} regeneration changed the creative brief`, checked_at: new Date() };
  } else if (assetInvalidation === "FINAL_ONLY") {
    if (draft.visual_mode === "AI_VISUAL_WITH_EXACT_OVERLAY") {
      const recomposed = await recomposeDraftFromActiveOriginals(draft, { actor, dependencies, AssetModel });
      draft.asset_ids = creativeAssetIds(recomposed.creativeResult.assets);
      draft.final_composed_asset_ids = creativeAssetIds(recomposed.creativeResult.assets, { publishableCompositionOnly: true });
      draft.original_ai_asset_ids = recomposed.originals.map((asset) => asset._id || asset.id).filter(Boolean);
      draft.full_ai_ready = true;
      draft.creative_readiness = {
        status: recomposed.creativeResult.manual_review_required ? "NEEDS_MANUAL_REVIEW" : "READY",
        validation_status: recomposed.creativeResult.validation_status,
        manual_review_required: recomposed.creativeResult.manual_review_required,
        manual_review_flags: recomposed.creativeResult.manual_review_flags,
        asset_group_id: recomposed.creativeResult.asset_group_id,
        primary_asset_url: recomposed.creativeResult.primary_asset_url,
        original_asset_urls: recomposed.baseImages.map((asset) => asset.url).filter(Boolean),
        asset_count: recomposed.creativeResult.assets.length,
        ai_visual_status: "REUSED",
        checked_at: new Date(),
      };
      assetInvalidation = "RECOMPOSED_FROM_ORIGINALS";
    } else if (
      draft.visual_mode === "FULL_AI_GRAPHIC"
      && videoAssemblyFingerprint(before) !== videoAssemblyFingerprint(nextPackage)
    ) {
      const recomposed = await recomposeDraftFromActiveOriginals(draft, {
        actor,
        dependencies,
        AssetModel,
        visualMode: "FULL_AI_GRAPHIC",
      });
      draft.asset_ids = creativeAssetIds(recomposed.creativeResult.assets);
      draft.final_composed_asset_ids = creativeAssetIds(recomposed.creativeResult.assets, { publishableCompositionOnly: true });
      draft.original_ai_asset_ids = recomposed.originals.map((asset) => asset._id || asset.id).filter(Boolean);
      draft.full_ai_ready = true;
      draft.creative_readiness = {
        status: recomposed.creativeResult.manual_review_required ? "NEEDS_MANUAL_REVIEW" : "READY",
        validation_status: recomposed.creativeResult.validation_status,
        manual_review_required: recomposed.creativeResult.manual_review_required,
        manual_review_flags: recomposed.creativeResult.manual_review_flags,
        asset_group_id: recomposed.creativeResult.asset_group_id,
        primary_asset_url: recomposed.creativeResult.primary_asset_url,
        original_asset_urls: recomposed.baseImages.map((asset) => asset.url).filter(Boolean),
        asset_count: recomposed.creativeResult.assets.length,
        ai_visual_status: "REUSED",
        checked_at: new Date(),
      };
      assetInvalidation = "REASSEMBLED_FULL_AI_VIDEO";
    } else if (draft.visual_mode === "AI_ARTWORK_ONLY") {
      assetInvalidation = "NONE_ARTWORK_ONLY";
    } else {
      assetInvalidation = "NONE_FULL_AI_COPY_ONLY";
    }
  }
  if (
    changes.length
    && !["ALL", "RECOMPOSED_FROM_ORIGINALS", "REASSEMBLED_FULL_AI_VIDEO"].includes(assetInvalidation)
  ) {
    await refreshActiveCreativeMetadata(draft, AssetModel);
  }
  if (changes.length) {
    draft.revision = Math.max(Number(draft.revision || 0), 0) + 1;
    if (assetInvalidation === "ALL") {
      draft.status = "DRAFT";
      draft.submitted_for_review_at = null;
    } else {
      await AssetModel.updateMany(
        {
          draft_id: draft._id,
          asset_role: { $in: ["FINAL_COMPOSED", "FINAL_VIDEO"] },
          is_active: true,
          deleted_at: null,
        },
        {
          $set: {
            manual_review_status: "pending",
            manual_reviewed_at: null,
            manual_reviewed_by: null,
          },
        },
      );
      await recheckSafeEditReadiness(draft, AssetModel);
      draft.status = "NEEDS_REVIEW";
      draft.submitted_for_review_at = new Date();
      draft.approval_json = {
        required: true,
        status: "NEEDS_REVIEW",
        approved_revision: null,
        submitted_at: draft.submitted_for_review_at,
      };
    }
  }
  await draft.save();
  if (changes.length) {
    await (dependencies.syncWeeklyPlanFromDraft || syncWeeklyPlanFromDraft)(draft, {
      status: assetInvalidation === "ALL" ? "GENERATING_VISUAL" : "NEEDS_REVIEW",
      dependencies,
    });
  }
  const associatedRun = await RunModel.findById(draft.generation_run_id);
  if (associatedRun) {
    associatedRun.stage_executions = [
      ...safeArray(associatedRun.stage_executions),
      ...stageExecutions(promptVersionRows),
    ];
    associatedRun.content_revision_attempts = [
      ...safeArray(associatedRun.content_revision_attempts),
      ...revisionAttempts,
    ];
    if (collectedResearch) associatedRun.research_mode = collectedResearch.mode || associatedRun.research_mode;
    await associatedRun.save();
  }
  await appendAudit({
    entityType: "DRAFT",
    entityId: draft._id,
    draft,
    action: `REGENERATED_${normalizedScope.toUpperCase()}`,
    summary: `Regenerated the ${normalizedScope.replace(/_/g, " ")} portion of the social package without publishing it.`,
    actor,
    fieldChanges: changes,
    requestId,
    ip,
    promptVersionIds: promptVersionRows.map((row) => row.document._id),
    providerModels: promptRuns.map((row) => ({ provider: row.provider, model: row.model, stage: row.stage })),
    metadata: {
      asset_invalidation: assetInvalidation,
      revision: draft.revision,
      workflow_status: draft.status,
      image_generation_invoked: false,
      original_ai_assets_reused: ["RECOMPOSED_FROM_ORIGINALS", "REASSEMBLED_FULL_AI_VIDEO", "NONE_ARTWORK_ONLY", "NONE_FULL_AI_COPY_ONLY"].includes(assetInvalidation),
      compliance_decision: independentComplianceReview?.decision || null,
      revision_attempt_count: revisionAttempts.length,
    },
    dependencies,
  });
  return getDraftDetail(draft._id, { dependencies });
}

async function submitDraftForReview(draftId, { actor = null, requestId = null, ip = null, dependencies = {} } = {}) {
  const DraftModel = dependencies.SocialPostDraft || SocialPostDraft;
  const AssetModel = dependencies.SocialAsset || SocialAsset;
  const draft = await DraftModel.findById(draftId);
  if (!draft) { const error = new Error("Social draft not found"); error.statusCode = 404; throw error; }
  if (!["DRAFT", "REJECTED"].includes(draft.status)) { const error = new Error(`A ${draft.status} draft cannot be submitted for review`); error.statusCode = 409; throw error; }
  const compliance = scanRecommendationCompliance(draft.current_package.primaryRecommendation, { requireSourcesForCurrentClaims: true });
  const assets = await AssetModel.find({ draft_id: draft._id, is_active: true, deleted_at: null });
  const assetReadiness = reviewAssetReadiness(assets, { draft });
  if (!compliance.passed || !assetReadiness.passed) {
    const error = new Error("The draft must pass compliance and have a traceable original AI-based or approved authentic-product creative before review");
    error.code = "draft_not_review_ready";
    error.statusCode = 409;
    error.issues = [...(compliance.passed ? [] : compliance.risk_flags || []), ...assetReadiness.issues];
    throw error;
  }
  draft.status = "NEEDS_REVIEW";
  draft.submitted_for_review_at = new Date();
  draft.submitted_for_review_by = actorId(actor);
  draft.approval_json = { required: true, status: "NEEDS_REVIEW", submitted_at: draft.submitted_for_review_at };
  await draft.save();
  await (dependencies.syncWeeklyPlanFromDraft || syncWeeklyPlanFromDraft)(draft, { status: "NEEDS_REVIEW", dependencies });
  await appendAudit({ entityType: "DRAFT", entityId: draft._id, draft, action: "SUBMITTED_FOR_REVIEW", summary: "The social draft was submitted for human review.", actor, requestId, ip, dependencies });
  return getDraftDetail(draft._id, { dependencies });
}

function assertCaptionContract(recommendation, settings = {}) {
  const contract = buildSocialCaptionContract(recommendation, {
    requireAffiliateDisclosure: isAffiliateRecommendation(recommendation),
    requireFinancialDisclaimer: settings.approval?.require_disclosures === true,
  });
  if (!contract.valid) {
    const error = new Error("The complete publication caption does not satisfy the caption-only CTA and disclosure contract");
    error.code = "social_caption_contract_invalid";
    error.statusCode = 409;
    error.issues = contract.violations;
    throw error;
  }
  return contract;
}

function assertStoryFrameCaptionPolicy(recommendation, assets = []) {
  if (String(recommendation?.format || "").toUpperCase() !== "STORY") return;
  const publicationAssets = assets.filter((asset) => (
    !asset.asset_role
    || ["FINAL_COMPOSED", "FINAL_VIDEO"].includes(asset.asset_role)
  ));
  if (publicationAssets.some((asset) => asset.provenance?.caption_policy?.method !== "story_frame_overlay")) {
    const error = new Error("Stories publish without captions, so every final Story asset must retain the approved first-frame/final-frame disclosure policy");
    error.code = "social_story_frame_copy_invalid";
    error.statusCode = 409;
    error.issues = ["STORY_FRAME_OVERLAY_REQUIRED"];
    throw error;
  }
}

function assertDraftVisualModeResolution(draft) {
  const stored = draft.visual_mode_resolution || null;
  const resolution = resolveSocialVisualMode({
    requestedVisualMode: stored?.requested || draft.visual_mode,
    fallbackVisualMode: draft.visual_mode || "AI_VISUAL_WITH_EXACT_OVERLAY",
    recommendation: draft.current_package?.primaryRecommendation || {},
    strict: false,
  });
  const mismatch = resolution.effective !== draft.visual_mode
    || (stored && (
      stored.effective !== resolution.effective
      || stored.eligible !== resolution.eligible
      || JSON.stringify(safeArray(stored.reasons)) !== JSON.stringify(resolution.reasons)
    ));
  if (mismatch) {
    const error = new Error("The draft visual mode is no longer eligible for its current content");
    error.code = "social_visual_mode_ineligible";
    error.statusCode = 409;
    error.visual_mode_resolution = resolution;
    throw error;
  }
  return resolution;
}

async function approveDraft(draftId, { actor, requestId = null, ip = null, dependencies = {} } = {}) {
  const DraftModel = dependencies.SocialPostDraft || SocialPostDraft;
  const AssetModel = dependencies.SocialAsset || SocialAsset;
  const draft = await DraftModel.findById(draftId);
  if (!draft) { const error = new Error("Social draft not found"); error.statusCode = 404; throw error; }
  if (draft.status !== "NEEDS_REVIEW") { const error = new Error("Only a draft in review can be approved"); error.statusCode = 409; throw error; }
  const adminId = actorId(actor);
  if (!adminId) { const error = new Error("An administrator identity is required for approval"); error.statusCode = 403; throw error; }
  const assets = await AssetModel.find({ draft_id: draft._id, is_active: true, deleted_at: null });
  const settings = await (dependencies.getSocialManagerSettings || getSocialManagerSettings)();
  const compliance = scanRecommendationCompliance(draft.current_package.primaryRecommendation, { requireSourcesForCurrentClaims: true });
  const captionContract = assertCaptionContract(draft.current_package.primaryRecommendation, settings);
  const visualModeResolution = assertDraftVisualModeResolution(draft);
  const assetReadiness = reviewAssetReadiness(assets, { draft });
  assertStoryFrameCaptionPolicy(draft.current_package.primaryRecommendation, assetReadiness.finalAssets);
  if (!compliance.passed || !assetReadiness.passed) {
    const error = new Error("Compliance, creative validation, and AI visual provenance must pass before approval");
    error.code = "draft_not_approvable";
    error.statusCode = 409;
    error.issues = [...(compliance.passed ? [] : compliance.risk_flags || []), ...assetReadiness.issues];
    throw error;
  }
  const validateLive = process.env.SOCIAL_VALIDATE_LANDING_PAGES_LIVE !== undefined
    ? String(process.env.SOCIAL_VALIDATE_LANDING_PAGES_LIVE).toLowerCase() === "true"
    : process.env.NODE_ENV === "production";
  if (validateLive && draft.current_package.primaryRecommendation.recommendedLandingPage) {
    await (dependencies.validatePinkPaisaLandingPage || validatePinkPaisaLandingPage)(
      draft.current_package.primaryRecommendation.recommendedLandingPage,
      { settings, fetchImpl: dependencies.fetchImpl || fetch },
    );
  }
  const reviewTime = new Date();
  await AssetModel.updateMany(
    { _id: { $in: assetReadiness.finalAssets.filter((asset) => asset.manual_review_required).map((asset) => asset._id) } },
    { $set: { manual_review_status: "approved", manual_reviewed_at: reviewTime, manual_reviewed_by: adminId } },
  );
  draft.status = "APPROVED";
  draft.approved_at = reviewTime;
  draft.approved_by_admin_id = adminId;
  draft.approved_revision = draft.revision;
  draft.approval_json = { required: true, status: "APPROVED", approved_at: reviewTime, approved_revision: draft.revision, approved_by_admin_id: adminId, caption_checksum_sha256: captionContract.checksum_sha256, caption_policy: captionContract.policy };
  draft.visual_mode_resolution = visualModeResolution;
  draft.creative_readiness = { ...(draft.creative_readiness || {}), status: "READY", manual_review_required: false, manual_reviewed_at: reviewTime };
  await draft.save();
  await (dependencies.syncWeeklyPlanFromDraft || syncWeeklyPlanFromDraft)(draft, { status: "APPROVED", dependencies });
  await appendAudit({ entityType: "DRAFT", entityId: draft._id, draft, action: "APPROVED", summary: "An administrator approved the current social draft revision and its active final creative assets.", actor, requestId, ip, metadata: { approved_revision: draft.revision, asset_count: assetReadiness.finalAssets.length, caption_checksum_sha256: captionContract.checksum_sha256, caption_policy: captionContract.policy, visual_mode_resolution: visualModeResolution }, dependencies });
  return getDraftDetail(draft._id, { dependencies });
}

async function rejectDraft(draftId, reason, { actor, requestId = null, ip = null, dependencies = {} } = {}) {
  const DraftModel = dependencies.SocialPostDraft || SocialPostDraft;
  const draft = await DraftModel.findById(draftId);
  if (!draft) { const error = new Error("Social draft not found"); error.statusCode = 404; throw error; }
  if (["PUBLISHING", "PUBLISHED"].includes(draft.status)) { const error = new Error("A publishing or published draft cannot be rejected"); error.statusCode = 409; throw error; }
  const normalizedReason = trimText(reason);
  if (!normalizedReason) { const error = new Error("A rejection reason is required"); error.statusCode = 400; throw error; }
  clearApprovalAndSchedule(draft);
  draft.status = "REJECTED";
  draft.rejected_at = new Date();
  draft.rejected_by_admin_id = actorId(actor);
  draft.rejection_reason = normalizedReason.slice(0, 2000);
  draft.approval_json = { required: true, status: "REJECTED", rejected_at: draft.rejected_at, reason: draft.rejection_reason };
  await draft.save();
  await (dependencies.syncWeeklyPlanFromDraft || syncWeeklyPlanFromDraft)(draft, { status: "REJECTED", dependencies });
  await appendAudit({ entityType: "DRAFT", entityId: draft._id, draft, action: "REJECTED", summary: "An administrator rejected the social draft.", actor, requestId, ip, metadata: { reason: draft.rejection_reason }, dependencies });
  return getDraftDetail(draft._id, { dependencies });
}

async function scheduleDraft(draftId, scheduledFor, {
  actor,
  now = new Date(),
  requestId = null,
  scheduleOverrideReason = null,
  ip = null,
  dependencies = {},
} = {}) {
  const DraftModel = dependencies.SocialPostDraft || SocialPostDraft;
  const AssetModel = dependencies.SocialAsset || SocialAsset;
  const PlanModel = dependencies.SocialWeeklyPlan || SocialWeeklyPlan;
  const settings = await (dependencies.getSocialManagerSettings || getSocialManagerSettings)();
  const result = await runInMongoTransaction(dependencies, async (session) => {
    const transactionDependencies = { ...dependencies, mongoSession: session };
    const draft = await applyMongoSession(DraftModel.findById(draftId), session);
    if (!draft) { const error = new Error("Social draft not found"); error.statusCode = 404; throw error; }
    if (draft.status !== "APPROVED") { const error = new Error("Only an approved draft can be scheduled"); error.statusCode = 409; throw error; }
    if (draft.approved_revision !== draft.revision) { const error = new Error("The current draft revision must be approved before scheduling"); error.statusCode = 409; throw error; }
    const recommendation = draft.current_package?.primaryRecommendation || {};
    const captionContract = assertCaptionContract(recommendation, settings);
    if (draft.approval_json?.caption_checksum_sha256
      && draft.approval_json.caption_checksum_sha256 !== captionContract.checksum_sha256) {
      const error = new Error("The publication caption changed after approval and must be reviewed again");
      error.code = "social_caption_approval_mismatch";
      error.statusCode = 409;
      throw error;
    }
    assertDraftVisualModeResolution(draft);
    if (String(recommendation.format || "").toUpperCase() === "STORY") {
      const assetsQuery = AssetModel.find({ draft_id: draft._id, is_active: true, deleted_at: null });
      const assets = await applyMongoSession(assetsQuery, session);
      assertStoryFrameCaptionPolicy(recommendation, reviewAssetReadiness(assets, { draft }).finalAssets);
    }
    const scheduleResolution = await resolveDraftSchedule(draft, scheduledFor, {
      PlanModel,
      session,
      scheduleOverrideReason,
    });
    const { date, plan, selected, scheduleOverride } = scheduleResolution;
    if (!Number.isFinite(date.getTime()) || date.getTime() <= now.getTime()) { const error = new Error("scheduled_for must be a valid future time"); error.statusCode = 400; throw error; }
    const format = draft.current_package?.primaryRecommendation?.format || draft.result_json?.primaryRecommendation?.format || null;
    if (format !== "STORY") {
      await (dependencies.assertWeeklyPublicationCapacity || assertWeeklyPublicationCapacity)({
        at: date,
        draftId: draft._id,
        settings,
        serialize: true,
        dependencies: { ...transactionDependencies, SocialPostDraft: DraftModel },
      });
    }
    draft.status = "SCHEDULED";
    draft.scheduled_for = date;
    draft.scheduled_by_admin_id = actorId(actor);
    draft.approval_json = { ...(draft.approval_json || {}), caption_checksum_sha256: captionContract.checksum_sha256, caption_policy: captionContract.policy };
    draft.schedule_json = { scheduled_for: date, timezone: "Asia/Kolkata", scheduled_by_admin_id: actorId(actor), status: "SCHEDULED", caption_checksum_sha256: captionContract.checksum_sha256, schedule_override_reason: scheduleOverride?.reason || null };
    if (scheduleOverride) {
      selected.scheduledFor = date;
      if (Object.hasOwn(selected, "scheduled_for")) selected.scheduled_for = date;
      await plan.save(session ? { session } : undefined);
    }
    await draft.save(session ? { session } : undefined);
    await (dependencies.syncWeeklyPlanFromDraft || syncWeeklyPlanFromDraft)(draft, { status: "SCHEDULED", dependencies: transactionDependencies });
    if (scheduleOverride) {
      await appendAudit({
        entityType: "DRAFT",
        entityId: draft._id,
        draft,
        action: "SCHEDULE_OVERRIDDEN",
        summary: `An administrator changed the frozen weekly slot from ${scheduleOverride.old_scheduled_for.toISOString()} to ${date.toISOString()}.`,
        actor,
        requestId,
        ip,
        fieldChanges: [{ field_path: draft.bundle_role?.includes("STORY") ? "weekly_plan.story_plan.scheduledFor" : "weekly_plan.selected_posts.scheduledFor", before: scheduleOverride.old_scheduled_for, after: date, is_redacted: false }],
        metadata: {
          ...scheduleOverride,
          admin_id: actorId(actor),
          weekly_plan_id: String(draft.weekly_plan_id),
          candidate_id: String(draft.candidate_id),
          slot_number: Number(selected.slotNumber || selected.slot_number || draft.weekly_slot_number || 0),
        },
        dependencies: transactionDependencies,
      });
    }
    await appendAudit({ entityType: "DRAFT", entityId: draft._id, draft, action: "SCHEDULED", summary: `The approved social draft was scheduled for ${date.toISOString()}.`, actor, requestId, ip, metadata: { scheduled_for: date, timezone: "Asia/Kolkata", caption_checksum_sha256: captionContract.checksum_sha256, caption_policy: captionContract.policy }, dependencies: transactionDependencies });
    return { draftId: draft._id };
  });
  return (dependencies.getDraftDetail || getDraftDetail)(result.draftId, { dependencies });
}

function weeklyPlanItemByCandidate(plan, candidateId) {
  return [...(plan?.selected_posts || []), ...(plan?.story_plan || [])].find((item) => (
    String(item.candidateId || item.candidate_id || "") === String(candidateId)
  ));
}

function weeklySelectedPost(plan, draft) {
  return weeklyPlanItemByCandidate(plan, draft.candidate_id);
}

async function resolveDraftSchedule(draft, suppliedSchedule, {
  PlanModel,
  session,
  scheduleOverrideReason = null,
} = {}) {
  const supplied = suppliedSchedule !== undefined && suppliedSchedule !== null && suppliedSchedule !== "";
  const explicitDate = supplied ? new Date(suppliedSchedule) : null;
  if (!draft.weekly_plan_id) {
    return {
      date: explicitDate || (draft.scheduled_for ? new Date(draft.scheduled_for) : new Date(Number.NaN)),
      plan: null,
      selected: null,
      plannedDate: null,
      scheduleOverride: null,
    };
  }
  if (!draft.candidate_id) {
    const error = new Error("The weekly-linked draft is missing its candidate identifier");
    error.code = "social_weekly_candidate_link_missing";
    error.statusCode = 409;
    throw error;
  }
  const plan = await applyMongoSession(PlanModel.findById(draft.weekly_plan_id), session);
  if (!plan) {
    const error = new Error("The draft's linked weekly plan no longer exists");
    error.code = "social_weekly_plan_link_missing";
    error.statusCode = 409;
    throw error;
  }
  const selected = weeklySelectedPost(plan, draft);
  if (!selected) {
    const error = new Error("The draft's linked weekly candidate no longer exists");
    error.code = "social_weekly_candidate_link_missing";
    error.statusCode = 409;
    throw error;
  }
  const plannedDate = new Date(selected.scheduledFor || selected.scheduled_for || Number.NaN);
  if (!Number.isFinite(plannedDate.getTime())) {
    const error = new Error("The linked weekly item does not retain a valid frozen posting slot");
    error.code = "social_weekly_slot_invalid";
    error.statusCode = 409;
    throw error;
  }
  const date = explicitDate || plannedDate;
  const isOverride = supplied
    && Number.isFinite(date.getTime())
    && Number.isFinite(plannedDate.getTime())
    && date.getTime() !== plannedDate.getTime();
  if (!isOverride) {
    return { date, plan, selected, plannedDate, scheduleOverride: null };
  }
  const reason = trimText(scheduleOverrideReason).slice(0, 2000);
  if (!reason) {
    const error = new Error("schedule_override_reason is required when changing a frozen weekly slot");
    error.code = "social_schedule_override_reason_required";
    error.statusCode = 400;
    throw error;
  }
  const localDate = istDateKey(date);
  if (!plan.week_start || !plan.week_end || localDate < plan.week_start || localDate > plan.week_end) {
    const error = new Error(`A weekly schedule override must remain inside ${plan.week_start} through ${plan.week_end} in Asia/Kolkata`);
    error.code = "social_schedule_override_outside_plan_week";
    error.statusCode = 409;
    error.details = { week_start: plan.week_start, week_end: plan.week_end, timezone: "Asia/Kolkata" };
    throw error;
  }
  return {
    date,
    plan,
    selected,
    plannedDate,
    scheduleOverride: {
      old_scheduled_for: plannedDate,
      new_scheduled_for: date,
      reason,
      timezone: "Asia/Kolkata",
    },
  };
}

async function draftQueueNavigation(draft, {
  PlanModel,
  DraftModel = SocialPostDraft,
  ManualActionModel = null,
  GenerationRunModel = null,
  session = null,
} = {}) {
  const empty = {
    next_review_draft_id: null,
    remaining_review_count: 0,
    waiting_generation_count: 0,
    unresolved_failure_count: 0,
    open_manual_blocker_count: 0,
    first_failure_draft_id: null,
  };
  if (!draft?.weekly_plan_id) return empty;
  const plan = await applyMongoSession(PlanModel.findById(draft.weekly_plan_id), session);
  if (!plan) return empty;
  const allSelected = [
    ...(plan.selected_posts || []),
    ...(plan.story_plan || []),
  ];
  const selected = allSelected.filter((item) => String(item.bundleRole || item.bundle_role || "") !== "COMPANION_STORY").sort((left, right) => (
    Number(left.slotNumber || left.slot_number || 0) - Number(right.slotNumber || right.slot_number || 0)
      || new Date(left.scheduledFor || left.scheduled_for || 0).getTime()
        - new Date(right.scheduledFor || right.scheduled_for || 0).getTime()
      || String(left.candidateId || left.candidate_id || "")
        .localeCompare(String(right.candidateId || right.candidate_id || ""))
  ));
  const currentDraftId = String(draft._id || draft.id || "");
  const reviewCandidates = selected.filter((item) => (
    String(item.status || "").toUpperCase() === "NEEDS_REVIEW"
    && (!currentDraftId || String(item.draft_id || item.draftId || "") !== currentDraftId)
    && Boolean(item.draft_id || item.draftId)
  ));
  const linkedDraftIds = [...new Set(allSelected
    .map((item) => item.draft_id || item.draftId)
    .filter(Boolean)
    .map(String))];
  let linkedDrafts = [];
  if (linkedDraftIds.length && typeof DraftModel?.find === "function") {
    let linkedDraftQuery = DraftModel.find({ _id: { $in: linkedDraftIds } });
    linkedDraftQuery = applyMongoSession(linkedDraftQuery, session);
    if (typeof linkedDraftQuery?.select === "function") {
      linkedDraftQuery = linkedDraftQuery.select("_id status creative_readiness.status");
    }
    if (typeof linkedDraftQuery?.lean === "function") linkedDraftQuery = linkedDraftQuery.lean();
    linkedDrafts = safeArray(await linkedDraftQuery);
  }
  const linkedDraftById = new Map(linkedDrafts.map((item) => [String(item._id || item.id || ""), item]));
  const reviewable = reviewCandidates.filter((item) => {
    const linkedDraft = linkedDraftById.get(String(item.draft_id || item.draftId || ""));
    return String(linkedDraft?.status || "").toUpperCase() === "NEEDS_REVIEW";
  });
  const draftWaitingCount = reviewCandidates.filter((item) => {
    const linkedDraft = linkedDraftById.get(String(item.draft_id || item.draftId || ""));
    return String(linkedDraft?.status || "").toUpperCase() === "DRAFT";
  }).length;
  const waitingStatuses = new Set(["PLANNED", "GENERATING", "GENERATING_COPY", "GENERATING_VISUAL"]);
  const failureStatuses = new Set(["FAILED", "FAILED_GENERATION", "FAILED_COMPLIANCE", "FAILED_IMAGE_GENERATION"]);
  const failureDraftIds = new Set();
  allSelected.forEach((item) => {
    if (failureStatuses.has(String(item.status || "").toUpperCase()) && (item.draft_id || item.draftId)) {
      failureDraftIds.add(String(item.draft_id || item.draftId));
    }
  });
  linkedDrafts.forEach((linkedDraft) => {
    if (failureStatuses.has(String(linkedDraft.status || "").toUpperCase())) {
      failureDraftIds.add(String(linkedDraft._id || linkedDraft.id));
    }
  });
  const itemFailuresWithoutDraft = allSelected.filter((item) => (
    failureStatuses.has(String(item.status || "").toUpperCase()) && !(item.draft_id || item.draftId)
  )).length;
  let openManualBlockerCount = 0;
  if (typeof ManualActionModel?.countDocuments === "function") {
    openManualBlockerCount = Number(await applyMongoSession(ManualActionModel.countDocuments({
      weekly_plan_id: plan._id,
      status: { $in: ["OPEN", "IN_PROGRESS"] },
    }), session)) || 0;
  }
  let failedRunWithoutDraftCount = 0;
  if (typeof GenerationRunModel?.countDocuments === "function") {
    failedRunWithoutDraftCount = Number(await applyMongoSession(GenerationRunModel.countDocuments({
      weekly_plan_id: plan._id,
      status: { $in: ["FAILED", "FAILED_COMPLIANCE", "FAILED_IMAGE_GENERATION"] },
      failed_draft_id: null,
      selected_draft_id: null,
    }), session)) || 0;
  }
  const next = reviewable.find((item) => item.draft_id || item.draftId) || null;
  return {
    next_review_draft_id: next ? String(next.draft_id || next.draftId) : null,
    remaining_review_count: reviewable.length,
    waiting_generation_count: selected.filter((item) => waitingStatuses.has(String(item.status || "").toUpperCase())).length + draftWaitingCount,
    unresolved_failure_count: failureDraftIds.size + Math.max(itemFailuresWithoutDraft, failedRunWithoutDraftCount),
    open_manual_blocker_count: openManualBlockerCount,
    first_failure_draft_id: [...failureDraftIds][0] || null,
  };
}

async function preflightApprovalAndSchedule(draft, {
  AssetModel,
  settings,
  session,
  dependencies,
} = {}) {
  const assetsQuery = AssetModel.find({ draft_id: draft._id, is_active: true, deleted_at: null });
  const assets = await applyMongoSession(assetsQuery, session);
  const recommendation = draft.current_package?.primaryRecommendation || {};
  const compliance = scanRecommendationCompliance(recommendation, { requireSourcesForCurrentClaims: true });
  const assetReadiness = reviewAssetReadiness(assets, { draft });
  const captionContract = assertCaptionContract(recommendation, settings);
  const visualModeResolution = assertDraftVisualModeResolution(draft);
  assertStoryFrameCaptionPolicy(recommendation, assetReadiness.finalAssets);
  if (!compliance.passed || !assetReadiness.passed) {
    const error = new Error("Compliance, creative validation, and AI visual provenance must pass before approval and scheduling");
    error.code = "draft_not_approvable";
    error.statusCode = 409;
    error.issues = [...(compliance.passed ? [] : compliance.risk_flags || []), ...assetReadiness.issues];
    throw error;
  }
  const validateLive = process.env.SOCIAL_VALIDATE_LANDING_PAGES_LIVE !== undefined
    ? String(process.env.SOCIAL_VALIDATE_LANDING_PAGES_LIVE).toLowerCase() === "true"
    : process.env.NODE_ENV === "production";
  if (validateLive && recommendation.recommendedLandingPage) {
    await (dependencies.validatePinkPaisaLandingPage || validatePinkPaisaLandingPage)(
      recommendation.recommendedLandingPage,
      { settings, fetchImpl: dependencies.fetchImpl || fetch },
    );
  }
  return {
    assets,
    recommendation,
    compliance,
    assetReadiness,
    captionContract,
    visualModeResolution,
  };
}

async function approveAndScheduleDraft(draftId, scheduledFor, {
  actor,
  now = new Date(),
  requestId = null,
  requestKey = null,
  scheduleOverrideReason = null,
  includeCompanionStory = false,
  ip = null,
  dependencies = {},
} = {}) {
  const adminId = actorId(actor);
  if (!adminId) { const error = new Error("An administrator identity is required for approval and scheduling"); error.statusCode = 403; throw error; }
  const DraftModel = dependencies.SocialPostDraft || SocialPostDraft;
  const AssetModel = dependencies.SocialAsset || SocialAsset;
  const PlanModel = dependencies.SocialWeeklyPlan || SocialWeeklyPlan;
  const settings = await (dependencies.getSocialManagerSettings || getSocialManagerSettings)();
  if (settings.approval?.require_human_approval !== true) {
    const error = new Error("The required human-approval policy is not active");
    error.code = "social_approval_policy_invalid";
    error.statusCode = 409;
    throw error;
  }

  const result = await runInMongoTransaction(dependencies, async (session) => {
    const transactionDependencies = { ...dependencies, mongoSession: session };
    const draft = await applyMongoSession(DraftModel.findById(draftId), session);
    if (!draft) { const error = new Error("Social draft not found"); error.statusCode = 404; throw error; }
    const scheduleResolution = await resolveDraftSchedule(draft, scheduledFor, {
      PlanModel,
      session,
      scheduleOverrideReason,
    });
    const { date, plan, selected, scheduleOverride } = scheduleResolution;
    if (!Number.isFinite(date.getTime()) || date.getTime() <= now.getTime()) {
      const error = new Error("scheduled_for must be a valid future time or an available future weekly slot");
      error.statusCode = 400;
      throw error;
    }
    const requestToken = trimText(requestKey).slice(0, 300);
    const repeatedOverrideReason = draft.status === "SCHEDULED"
      && draft.schedule_json?.schedule_override_reason
      ? trimText(scheduleOverrideReason).slice(0, 2000)
      : null;
    const payloadFingerprint = sha256({
      draft_id: String(draft._id),
      revision: draft.revision,
      scheduled_for: date.toISOString(),
      schedule_override_reason: scheduleOverride?.reason || repeatedOverrideReason || null,
      include_companion_story: includeCompanionStory === true,
    });
    const workflowIdempotencyKey = requestToken
      ? `social-approve-schedule:${draft._id}:${sha256(requestToken).slice(0, 32)}`
      : `social-approve-schedule:${draft._id}:r${draft.revision}:${payloadFingerprint.slice(0, 32)}`;

    if (draft.status === "SCHEDULED"
      && draft.schedule_json?.workflow_idempotency_key === workflowIdempotencyKey) {
      if (draft.schedule_json?.request_fingerprint !== payloadFingerprint) {
        const error = new Error("This idempotency key was already used with a different approval schedule");
        error.code = "social_idempotency_payload_conflict";
        error.statusCode = 409;
        throw error;
      }
      const repeatedCompanion = includeCompanionStory === true && draft.bundle_id
        ? await applyMongoSession(DraftModel.findOne({
          weekly_plan_id: draft.weekly_plan_id,
          bundle_id: draft.bundle_id,
          bundle_role: "COMPANION_STORY",
          parent_draft_id: draft._id,
          status: "SCHEDULED",
        }), session)
        : null;
      if (includeCompanionStory === true && !repeatedCompanion) {
        const error = new Error("The bundled companion Story is not scheduled with this repeated request");
        error.code = "social_companion_story_idempotency_mismatch";
        error.statusCode = 409;
        throw error;
      }
      return {
        draftId: draft._id,
        weeklyPlanId: draft.weekly_plan_id || null,
        companionStoryDraftId: repeatedCompanion?._id || null,
        reused: true,
      };
    }
    if (draft.status !== "NEEDS_REVIEW") {
      const error = new Error("Only a draft in review can be approved and scheduled");
      error.statusCode = 409;
      throw error;
    }
    if (draft.publication_id) {
      const error = new Error("A draft with a publication attempt cannot be newly approved and scheduled");
      error.statusCode = 409;
      throw error;
    }

    const parentApproval = await preflightApprovalAndSchedule(draft, {
      AssetModel,
      settings,
      session,
      dependencies: transactionDependencies,
    });
    const {
      recommendation,
      assetReadiness,
      captionContract,
      visualModeResolution,
    } = parentApproval;
    let companionStory = null;
    let companionApproval = null;
    let companionSchedule = null;
    if (includeCompanionStory === true) {
      if (draft.bundle_role !== "PARENT_FEED" || !draft.bundle_id || !draft.weekly_plan_id) {
        const error = new Error("Only a weekly parent feed creative can include a companion Story");
        error.code = "social_companion_story_parent_required";
        error.statusCode = 409;
        throw error;
      }
      companionStory = await applyMongoSession(DraftModel.findOne({
        weekly_plan_id: draft.weekly_plan_id,
        bundle_id: draft.bundle_id,
        bundle_role: "COMPANION_STORY",
      }), session);
      if (!companionStory) {
        const error = new Error("The bundled companion Story has not finished generating");
        error.code = "social_companion_story_not_ready";
        error.statusCode = 409;
        throw error;
      }
      if (companionStory.status !== "NEEDS_REVIEW" || companionStory.publication_id) {
        const error = new Error("The bundled companion Story must be awaiting final review with no publication attempt");
        error.code = "social_companion_story_not_approvable";
        error.statusCode = 409;
        throw error;
      }
      companionSchedule = await resolveDraftSchedule(
        companionStory,
        scheduleOverride ? date.toISOString() : undefined,
        {
        PlanModel,
        session,
        scheduleOverrideReason: scheduleOverride?.reason || null,
        },
      );
      if (!Number.isFinite(companionSchedule.date.getTime()) || companionSchedule.date.getTime() <= now.getTime()) {
        const error = new Error("The companion Story no longer has a valid future weekly slot");
        error.code = "social_companion_story_schedule_invalid";
        error.statusCode = 409;
        throw error;
      }
      companionApproval = await preflightApprovalAndSchedule(companionStory, {
        AssetModel,
        settings,
        session,
        dependencies: transactionDependencies,
      });
    }
    if (recommendation.format !== "STORY") {
      await (dependencies.assertWeeklyPublicationCapacity || assertWeeklyPublicationCapacity)({
        at: date,
        draftId: draft._id,
        settings,
        serialize: true,
        dependencies: { ...transactionDependencies, SocialPostDraft: DraftModel },
      });
    }

    const reviewTime = new Date(now);
    const reviewedAssetIds = assetReadiness.finalAssets
      .filter((asset) => asset.manual_review_required)
      .map((asset) => asset._id);
    if (reviewedAssetIds.length) {
      await AssetModel.updateMany(
        { _id: { $in: reviewedAssetIds } },
        { $set: { manual_review_status: "approved", manual_reviewed_at: reviewTime, manual_reviewed_by: adminId } },
        session ? { session } : undefined,
      );
    }
    draft.status = "SCHEDULED";
    draft.approved_at = reviewTime;
    draft.approved_by_admin_id = adminId;
    draft.approved_revision = draft.revision;
    draft.scheduled_for = date;
    draft.scheduled_by_admin_id = adminId;
    draft.visual_mode_resolution = visualModeResolution;
    draft.approval_json = {
      required: true,
      status: "APPROVED",
      approved_at: reviewTime,
      approved_revision: draft.revision,
      approved_by_admin_id: adminId,
      caption_checksum_sha256: captionContract.checksum_sha256,
      caption_policy: captionContract.policy,
      workflow_idempotency_key: workflowIdempotencyKey,
      request_fingerprint: payloadFingerprint,
      schedule_override_reason: scheduleOverride?.reason || null,
    };
    draft.schedule_json = {
      scheduled_for: date,
      timezone: "Asia/Kolkata",
      scheduled_by_admin_id: adminId,
      status: "SCHEDULED",
      caption_checksum_sha256: captionContract.checksum_sha256,
      workflow_idempotency_key: workflowIdempotencyKey,
      request_fingerprint: payloadFingerprint,
      schedule_override_reason: scheduleOverride?.reason || null,
    };
    draft.creative_readiness = {
      ...(draft.creative_readiness || {}),
      status: "READY",
      manual_review_required: false,
      manual_reviewed_at: reviewTime,
    };
    if (companionStory && companionApproval && companionSchedule) {
      const companionReviewedAssetIds = companionApproval.assetReadiness.finalAssets
        .filter((asset) => asset.manual_review_required)
        .map((asset) => asset._id);
      if (companionReviewedAssetIds.length) {
        await AssetModel.updateMany(
          { _id: { $in: companionReviewedAssetIds } },
          { $set: { manual_review_status: "approved", manual_reviewed_at: reviewTime, manual_reviewed_by: adminId } },
          session ? { session } : undefined,
        );
      }
      companionStory.parent_draft_id = draft._id;
      companionStory.status = "SCHEDULED";
      companionStory.approved_at = reviewTime;
      companionStory.approved_by_admin_id = adminId;
      companionStory.approved_revision = companionStory.revision;
      companionStory.scheduled_for = companionSchedule.date;
      companionStory.scheduled_by_admin_id = adminId;
      companionStory.visual_mode_resolution = companionApproval.visualModeResolution;
      companionStory.approval_json = {
        required: true,
        status: "APPROVED",
        approved_at: reviewTime,
        approved_revision: companionStory.revision,
        approved_by_admin_id: adminId,
        caption_checksum_sha256: companionApproval.captionContract.checksum_sha256,
        caption_policy: companionApproval.captionContract.policy,
        workflow_idempotency_key: workflowIdempotencyKey,
        request_fingerprint: payloadFingerprint,
        bundled_parent_draft_id: String(draft._id),
        schedule_override_reason: companionSchedule.scheduleOverride?.reason || null,
      };
      companionStory.schedule_json = {
        scheduled_for: companionSchedule.date,
        timezone: "Asia/Kolkata",
        scheduled_by_admin_id: adminId,
        status: "SCHEDULED",
        caption_checksum_sha256: companionApproval.captionContract.checksum_sha256,
        workflow_idempotency_key: workflowIdempotencyKey,
        request_fingerprint: payloadFingerprint,
        bundled_parent_draft_id: String(draft._id),
        schedule_override_reason: companionSchedule.scheduleOverride?.reason || null,
      };
      companionStory.creative_readiness = {
        ...(companionStory.creative_readiness || {}),
        status: "READY",
        manual_review_required: false,
        manual_reviewed_at: reviewTime,
      };
    }
    if (scheduleOverride) {
      selected.scheduledFor = date;
      if (Object.hasOwn(selected, "scheduled_for")) selected.scheduled_for = date;
    }
    if (companionSchedule?.scheduleOverride) {
      const companionPlanItem = weeklyPlanItemByCandidate(plan, companionStory.candidate_id);
      if (!companionPlanItem) {
        const error = new Error("The companion Story disappeared from the weekly plan during scheduling");
        error.code = "social_companion_story_plan_link_missing";
        error.statusCode = 409;
        throw error;
      }
      companionPlanItem.scheduledFor = companionSchedule.date;
      if (Object.hasOwn(companionPlanItem, "scheduled_for")) companionPlanItem.scheduled_for = companionSchedule.date;
    }
    if (scheduleOverride || companionSchedule?.scheduleOverride) {
      await plan.save(session ? { session } : undefined);
    }
    await draft.save(session ? { session } : undefined);
    if (companionStory) await companionStory.save(session ? { session } : undefined);
    await (dependencies.syncWeeklyPlanFromDraft || syncWeeklyPlanFromDraft)(draft, {
      status: "SCHEDULED",
      dependencies: transactionDependencies,
    });
    if (companionStory) {
      await (dependencies.syncWeeklyPlanFromDraft || syncWeeklyPlanFromDraft)(companionStory, {
        status: "SCHEDULED",
        dependencies: transactionDependencies,
      });
    }
    const auditMetadata = {
      approved_revision: draft.revision,
      asset_count: assetReadiness.finalAssets.length,
      caption_checksum_sha256: captionContract.checksum_sha256,
      caption_policy: captionContract.policy,
      visual_mode_resolution: visualModeResolution,
      workflow_idempotency_key: workflowIdempotencyKey,
    };
    await appendAudit({
      entityType: "DRAFT",
      entityId: draft._id,
      draft,
      action: "APPROVED",
      summary: "An administrator approved the current social draft revision and its active final creative assets.",
      actor,
      requestId,
      idempotencyKey: `${workflowIdempotencyKey}:approved`,
      ip,
      metadata: auditMetadata,
      dependencies: transactionDependencies,
    });
    if (scheduleOverride) {
      const overrideMetadata = {
        ...scheduleOverride,
        admin_id: adminId,
        weekly_plan_id: String(draft.weekly_plan_id),
        candidate_id: String(draft.candidate_id),
        slot_number: Number(selected.slotNumber || selected.slot_number || draft.weekly_slot_number || 0),
        workflow_idempotency_key: workflowIdempotencyKey,
      };
      await appendAudit({
        entityType: "DRAFT",
        entityId: draft._id,
        draft,
        action: "SCHEDULE_OVERRIDDEN",
        summary: `An administrator changed the frozen weekly slot from ${scheduleOverride.old_scheduled_for.toISOString()} to ${date.toISOString()}.`,
        actor,
        requestId,
        idempotencyKey: `${workflowIdempotencyKey}:schedule-overridden`,
        ip,
        fieldChanges: [{
          field_path: draft.bundle_role?.includes("STORY") ? "weekly_plan.story_plan.scheduledFor" : "weekly_plan.selected_posts.scheduledFor",
          before: scheduleOverride.old_scheduled_for,
          after: date,
          is_redacted: false,
        }],
        metadata: overrideMetadata,
        dependencies: transactionDependencies,
      });
    }
    await appendAudit({
      entityType: "DRAFT",
      entityId: draft._id,
      draft,
      action: "SCHEDULED",
      summary: `The approved social draft was scheduled for ${date.toISOString()}.`,
      actor,
      requestId,
      idempotencyKey: `${workflowIdempotencyKey}:scheduled`,
      ip,
      metadata: { ...auditMetadata, scheduled_for: date, timezone: "Asia/Kolkata" },
      dependencies: transactionDependencies,
    });
    if (companionStory && companionApproval && companionSchedule) {
      const companionAuditMetadata = {
        approved_revision: companionStory.revision,
        asset_count: companionApproval.assetReadiness.finalAssets.length,
        caption_checksum_sha256: companionApproval.captionContract.checksum_sha256,
        caption_policy: companionApproval.captionContract.policy,
        visual_mode_resolution: companionApproval.visualModeResolution,
        workflow_idempotency_key: workflowIdempotencyKey,
        bundled_parent_draft_id: String(draft._id),
        bundle_id: draft.bundle_id,
      };
      await appendAudit({
        entityType: "DRAFT",
        entityId: companionStory._id,
        draft: companionStory,
        action: "APPROVED",
        summary: "An administrator approved the companion Story with its parent feed creative.",
        actor,
        requestId,
        idempotencyKey: `${workflowIdempotencyKey}:companion-approved`,
        ip,
        metadata: companionAuditMetadata,
        dependencies: transactionDependencies,
      });
      if (companionSchedule.scheduleOverride) {
        await appendAudit({
          entityType: "DRAFT",
          entityId: companionStory._id,
          draft: companionStory,
          action: "SCHEDULE_OVERRIDDEN",
          summary: `The companion Story followed its parent feed override to ${companionSchedule.date.toISOString()}.`,
          actor,
          requestId,
          idempotencyKey: `${workflowIdempotencyKey}:companion-schedule-overridden`,
          ip,
          fieldChanges: [{
            field_path: "weekly_plan.story_plan.scheduledFor",
            before: companionSchedule.scheduleOverride.old_scheduled_for,
            after: companionSchedule.date,
            is_redacted: false,
          }],
          metadata: {
            ...companionSchedule.scheduleOverride,
            ...companionAuditMetadata,
            weekly_plan_id: String(companionStory.weekly_plan_id),
            candidate_id: String(companionStory.candidate_id),
          },
          dependencies: transactionDependencies,
        });
      }
      await appendAudit({
        entityType: "DRAFT",
        entityId: companionStory._id,
        draft: companionStory,
        action: "SCHEDULED",
        summary: `The approved companion Story was scheduled for ${companionSchedule.date.toISOString()}.`,
        actor,
        requestId,
        idempotencyKey: `${workflowIdempotencyKey}:companion-scheduled`,
        ip,
        metadata: { ...companionAuditMetadata, scheduled_for: companionSchedule.date, timezone: "Asia/Kolkata" },
        dependencies: transactionDependencies,
      });
    }
    return {
      draftId: draft._id,
      weeklyPlanId: draft.weekly_plan_id || null,
      companionStoryDraftId: companionStory?._id || null,
      reused: false,
    };
  });

  const detail = await (dependencies.getDraftDetail || getDraftDetail)(result.draftId, { dependencies });
  const companionStoryDetail = result.companionStoryDraftId
    ? await (dependencies.getDraftDetail || getDraftDetail)(result.companionStoryDraftId, { dependencies })
    : null;
  let queueNavigation;
  try {
    queueNavigation = await draftQueueNavigation(
      {
        _id: result.draftId,
        weekly_plan_id: result.weeklyPlanId || detail?.weekly_plan_id || null,
      },
      {
        PlanModel,
        DraftModel,
        ManualActionModel: dependencies.SocialManualAction || (PlanModel === SocialWeeklyPlan ? SocialManualAction : null),
        GenerationRunModel: dependencies.SocialGenerationRun || (PlanModel === SocialWeeklyPlan ? SocialGenerationRun : null),
      },
    );
  } catch (error) {
    logger.warn("Unable to calculate Social Manager queue navigation after scheduling", {
      draftId: String(result.draftId),
      error: error.message,
    });
    queueNavigation = {
      next_review_draft_id: null,
      remaining_review_count: 0,
      waiting_generation_count: 0,
      unresolved_failure_count: 0,
      open_manual_blocker_count: 0,
      first_failure_draft_id: null,
    };
  }
  return {
    draft: detail,
    companion_story: companionStoryDetail,
    reused: result.reused,
    queue_navigation: queueNavigation,
  };
}

async function publishDraftNow(draftId, { actor, requestId = null, ip = null, dependencies = {} } = {}) {
  const settings = await (dependencies.getSocialManagerSettings || getSocialManagerSettings)();
  const DraftModel = dependencies.SocialPostDraft || SocialPostDraft;
  const draft = await DraftModel.findById(draftId);
  if (!draft) { const error = new Error("Social draft not found"); error.statusCode = 404; throw error; }
  const format = draft.current_package?.primaryRecommendation?.format || draft.result_json?.primaryRecommendation?.format || null;
  if (format !== "STORY") {
    await (dependencies.assertWeeklyPublicationCapacity || assertWeeklyPublicationCapacity)({
      at: draft.scheduled_for || new Date(),
      draftId: draft._id,
      settings,
      dependencies: { ...dependencies, SocialPostDraft: DraftModel },
    });
  }
  const result = await (dependencies.queueSocialPublication || queueSocialPublication)({ draftId, settings, actorAdminId: actorId(actor), dependencies });
  return { draft: await getDraftDetail(draftId, { dependencies }), publication: asObject(result.publication), queued: true };
}

async function duplicateDraft(draftId, { actor, now = new Date(), requestId = null, ip = null, dependencies = {} } = {}) {
  const DraftModel = dependencies.SocialPostDraft || SocialPostDraft;
  const RunModel = dependencies.SocialGenerationRun || SocialGenerationRun;
  const AssetModel = dependencies.SocialAsset || SocialAsset;
  const original = await DraftModel.findById(draftId);
  if (!original) { const error = new Error("Social draft not found"); error.statusCode = 404; throw error; }
  const canonicalSettings = await (dependencies.getSocialManagerSettings || getSocialManagerSettings)();
  const runtimeSettings = (dependencies.buildSocialManagerRuntimeSettings || buildSocialManagerRuntimeSettings)(canonicalSettings);
  const generationDate = getIstDateKey(now);
  const packageValue = clone(original.current_package);
  packageValue.generationDate = generationDate;
  for (const [index, recommendation] of [packageValue.primaryRecommendation, ...packageValue.alternativeRecommendations].entries()) {
    recommendation.utmParameters = buildUtmParameters({ topic: recommendation.topic, contentPillar: recommendation.contentPillar, generationDate, content: index === 0 ? "primary-copy" : `alternative-${index}` });
  }
  validateSocialPackage(packageValue);
  const visualMode = SOCIAL_VISUAL_MODES.has(original.visual_mode)
    ? original.visual_mode
    : "AI_VISUAL_WITH_EXACT_OVERLAY";
  const visualModeResolution = resolveSocialVisualMode({
    requestedVisualMode: original.visual_mode_resolution?.requested || visualMode,
    fallbackVisualMode: visualMode,
    recommendation: packageValue.primaryRecommendation,
    strict: false,
  });
  const run = await RunModel.create({
    generation_date: generationDate,
    timezone: "Asia/Kolkata",
    trigger_type: "BACKFILL",
    idempotency_key: `social-duplicate:${original._id}:${crypto.randomUUID()}`,
    generation_request: {
      requested_format: packageValue.primaryRecommendation.format,
      generation_scope: "IMAGE",
      visual_mode: visualModeResolution.effective,
      visual_mode_resolution: visualModeResolution,
      admin_instructions: "Create a fresh original visual for the duplicated AI-authored package.",
      request_id: trimText(requestId).slice(0, 200) || null,
    },
    generation_mode: original.generation_mode === "FULL_AI" ? "FULL_AI" : "ADMIN_MANUAL",
    full_ai_generation: original.generation_mode === "FULL_AI",
    status: "RUNNING",
    current_stage: "GENERATING_IMAGES",
    initiated_by_admin_id: actorId(actor),
    used_fallback: false,
    deterministic_content_fallback_used: false,
    template_only_visual_fallback_used: false,
    image_generation_status: "RUNNING",
    candidate_count: 3,
    queued_at: now,
    available_at: now,
    started_at: now,
    attempt_count: 1,
  });
  const draft = await DraftModel.create({
    generation_run_id: run._id,
    generation_date: generationDate,
    timezone: "Asia/Kolkata",
    revision: 1,
    idempotency_key: `social-draft-copy:${original._id}:${run._id}`,
    parent_draft_id: original._id,
    generation_mode: original.generation_mode === "FULL_AI" ? "FULL_AI" : "ADMIN_MANUAL",
    visual_mode: visualModeResolution.effective,
    visual_mode_resolution: visualModeResolution,
    full_ai_ready: false,
    result_json: clone(packageValue),
    current_package: clone(packageValue),
    status: "DRAFT",
    research_source_ids: original.research_source_ids,
    prompt_version_ids: original.prompt_version_ids,
    duplicate_analysis: { copied_from_draft_id: original._id, requires_material_angle_review: true },
    compliance_summary: scanRecommendationCompliance(packageValue.primaryRecommendation),
    creative_readiness: { status: "PENDING", reason: "New draft requires its own asset version" },
    approval_json: { required: true, status: "PENDING" },
    content_fingerprint: buildPublicationFingerprint({ recommendation: packageValue.primaryRecommendation, assetUrls: [] }),
  });
  try {
    const imageResult = await (dependencies.generateSocialVisuals || generateSocialVisuals)({
      draftLike: draft,
      recommendation: packageValue.primaryRecommendation,
      settings: runtimeSettings,
      visualMode: visualModeResolution.effective,
      dependencies: {
        ...dependencies,
        reviseImagePrompt: dependencies.reviseImagePrompt
          || dependencies.providers?.reviseImagePrompt
          || (typeof openAiSocialProvider.reviseImagePrompt === "function"
            ? async (input) => {
              const response = await openAiSocialProvider.reviseImagePrompt({ context: input, settings: runtimeSettings, dependencies });
              return response.output || response;
            }
            : undefined),
      },
    });
    run.current_stage = "VALIDATING_IMAGES";
    run.image_generation_attempts = imageAttemptRows(imageResult, packageValue.primaryRecommendation, visualModeResolution.effective);
    run.image_generation_status = "COMPLETED";
    await run.save();
    const originalAssets = await persistOriginalAiVisualAssets({
      draft,
      run,
      imageResult,
      recommendation: packageValue.primaryRecommendation,
      visualMode: visualModeResolution.effective,
      AssetModel,
    });
    draft.original_ai_asset_ids = originalAssets.map((asset) => asset._id || asset.id).filter(Boolean);
    run.current_stage = "COMPOSING_FINAL_ASSETS";
    await run.save();
    let creativeResult = await (dependencies.renderSocialDraftAssets || renderSocialDraftAssets)(draft, {
      assetModel: AssetModel,
      baseImages: imageResult.original_visuals.map((visual) => ({
        buffer: visual.buffer,
        url: visual.url,
        source_url: visual.url,
        storage_provider: visual.storage_provider,
        storage_key: visual.storage_key,
        checksum_sha256: visual.checksum_sha256,
        mime_type: visual.mime_type,
        file_size_bytes: visual.file_size_bytes,
        width: visual.width,
        height: visual.height,
        source_provenance: visual.source_provenance,
        usage_rights_status: visual.usage_rights_status,
        provider: visual.provider,
        model: visual.model,
        prompt: visual.prompt,
        response_id: visual.response_id,
        attempt_count: visual.attempt_count,
        status: visual.status,
        reference_image_url: visual.reference_image_url,
        reference_image_checksum_sha256: visual.reference_image_checksum_sha256,
        reference_image_mime_type: visual.reference_image_mime_type,
        ai_background: visual.ai_background,
        authentic_product_reference: visual.authentic_product_reference,
        authentic_product_composition: visual.authentic_product_composition,
        usage: visual.usage,
        text_validation: visual.text_validation,
        poster_validation: visual.poster_validation,
        expected_text_blocks: visual.expected_text_blocks,
        full_ai_graphic_contract_version: visual.full_ai_graphic_contract_version,
        artwork_validation: visual.artwork_validation,
        perceptual_hash_64: visual.perceptual_hash_64,
        provider_original: visual.provider_original,
        normalization: visual.normalization,
      })),
      imageProvider: imageResult.provider,
      imageModel: imageResult.model,
      visualMode: visualModeResolution.effective,
      allowTemplateOnly: false,
    });
    if (creativeResult.validation_status === "invalid" || !creativeResult.assets.length) {
      const error = new Error("The duplicated draft's AI-based creative did not pass required validation");
      error.code = "social_creative_validation_failed";
      throw error;
    }
    creativeResult = await assembleReelCreative({
      draft,
      run,
      recommendation: packageValue.primaryRecommendation,
      imageResult,
      creativeResult,
      visualMode: visualModeResolution.effective,
      actor,
      dependencies,
      AssetModel,
    });
    if (visualModeResolution.effective === "FULL_AI_GRAPHIC") applyFullAiDraftManifest(draft, creativeResult.assets);
    draft.asset_ids = creativeAssetIds(creativeResult.assets);
    draft.final_composed_asset_ids = creativeAssetIds(creativeResult.assets, { publishableCompositionOnly: true });
    draft.full_ai_ready = original.generation_mode === "FULL_AI";
    draft.status = "NEEDS_REVIEW";
    draft.submitted_for_review_at = new Date();
    draft.approval_json = { required: true, status: "NEEDS_REVIEW", approved_revision: null };
    draft.creative_readiness = {
      status: creativeResult.manual_review_required ? "NEEDS_MANUAL_REVIEW" : "READY",
      validation_status: creativeResult.validation_status,
      manual_review_required: creativeResult.manual_review_required,
      manual_review_flags: creativeResult.manual_review_flags,
      asset_group_id: creativeResult.asset_group_id,
      primary_asset_url: creativeResult.primary_asset_url,
      original_asset_urls: imageResult.original_visuals.map((visual) => visual.url),
      asset_count: creativeResult.assets.length,
      ai_visual_required: true,
      ai_visual_status: "COMPLETED",
      reel_assembly_status: ["REEL", "VIDEO_FEED"].includes(packageValue.primaryRecommendation.format) ? "COMPLETED" : "NOT_APPLICABLE",
      reel_video_asset_id: creativeResult.reel_video_asset?._id || creativeResult.reel_video_asset?.id || null,
      reel_video_url: creativeResult.reel_video_asset?.url || null,
      reel_subtitle_asset_id: creativeResult.reel_subtitle_asset?._id || creativeResult.reel_subtitle_asset?.id || null,
      reel_subtitle_url: creativeResult.reel_subtitle_asset?.url || null,
      reel_subtitle_language: creativeResult.reel_subtitle_asset?.subtitle_language || null,
      checked_at: new Date(),
    };
    await draft.save();
    run.status = "SUCCEEDED";
    run.current_stage = "COMPLETED";
    run.selected_draft_id = draft._id;
    run.usage = {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      estimated_cost: Number(imageResult.estimated_cost || 0),
      cost_currency: imageResult.cost_currency || "USD",
    };
    run.completed_at = new Date();
    run.finished_at = run.completed_at;
    run.last_error = null;
    await run.save();
    await appendAudit({ entityType: "DRAFT", entityId: draft._id, draft, run, action: "DUPLICATED_AS_NEW_DRAFT", summary: "Duplicated the AI-authored package as a new unapproved draft, generated fresh original OpenAI artwork, and composed new final assets.", actor, requestId, ip, metadata: { parent_draft_id: original._id, image_provider: imageResult.provider, image_model: imageResult.model, image_count: imageResult.image_count }, dependencies });
    return getDraftDetail(draft._id, { dependencies });
  } catch (error) {
    const failedAt = new Date();
    run.status = String(error.code || "").includes("image") ? "FAILED_IMAGE_GENERATION" : "FAILED";
    run.current_stage = "FAILED";
    run.image_generation_status = "FAILED";
    run.failed_draft_id = draft._id;
    run.completed_at = failedAt;
    run.finished_at = failedAt;
    run.last_error = {
      stage: "GENERATING_IMAGES",
      code: error.code || "social_duplicate_generation_failed",
      message: trimText(error.message).slice(0, 2000),
      is_retriable: Boolean(error.code === "social_image_generation_failed"),
      details: error.image_generation || null,
      occurred_at: failedAt,
    };
    draft.status = "FAILED";
    draft.failed_at = failedAt;
    draft.last_error = {
      stage: "GENERATING_IMAGES",
      code: run.last_error.code,
      message: run.last_error.message,
      is_retriable: run.last_error.is_retriable,
      occurred_at: failedAt,
    };
    await Promise.all([run.save(), draft.save()]);
    await appendAudit({ entityType: "DRAFT", entityId: draft._id, draft, run, action: "DUPLICATE_GENERATION_FAILED", status: "FAILED", summary: "The duplicated package could not produce validated original AI artwork; no fallback creative was created.", actor, requestId, ip, metadata: { error_code: run.last_error.code }, dependencies });
    throw error;
  }
}

async function addMetricSnapshot(draftId, input = {}, { actor, requestKey = null, dependencies = {} } = {}) {
  const DraftModel = dependencies.SocialPostDraft || SocialPostDraft;
  const MetricModel = dependencies.SocialMetricSnapshot || SocialMetricSnapshot;
  const draft = await DraftModel.findById(draftId);
  if (!draft) { const error = new Error("Social draft not found"); error.statusCode = 404; throw error; }
  const allowedFields = new Set(SocialMetricSnapshot.METRIC_FIELDS || []);
  const metrics = {};
  for (const [key, value] of Object.entries(input.metrics || {})) {
    if (!allowedFields.has(key)) { const error = new Error(`Unknown social metric: ${key}`); error.statusCode = 400; throw error; }
    if (value == null || value === "") { metrics[key] = null; continue; }
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) { const error = new Error(`${key} must be a non-negative number`); error.statusCode = 400; throw error; }
    metrics[key] = numeric;
  }
  if (!Object.keys(metrics).length) { const error = new Error("At least one metric is required"); error.statusCode = 400; throw error; }
  const capturedAt = input.captured_at ? new Date(input.captured_at) : new Date();
  if (!Number.isFinite(capturedAt.getTime())) { const error = new Error("captured_at is invalid"); error.statusCode = 400; throw error; }
  const publishedAt = draft.published_at ? new Date(draft.published_at) : null;
  const postingParts = publishedAt && Number.isFinite(publishedAt.getTime())
    ? Object.fromEntries(new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      hourCycle: "h23",
      weekday: "long",
    }).formatToParts(publishedAt).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]))
    : null;
  const snapshotKey = trimText(requestKey || `social-metric:${draft._id}:${capturedAt.toISOString()}:${sha256(metrics)}`).slice(0, 400);
  let snapshot;
  try {
    snapshot = await MetricModel.create({
      snapshot_key: snapshotKey,
      draft_id: draft._id,
      publication_id: draft.publication_id || null,
      external_publication_id: draft.publication_json?.external_publication_id || null,
      source: input.source || "MANUAL",
      retrieval_status: input.retrieval_status || "COMPLETE",
      captured_at: capturedAt,
      attribution_window_hours: input.attribution_window_hours ?? null,
      published_at: publishedAt,
      posting_timezone: "Asia/Kolkata",
      posting_local_hour: postingParts ? Number(postingParts.hour) : null,
      posting_local_weekday: postingParts?.weekday ? String(postingParts.weekday).toUpperCase() : null,
      metrics,
      utm_parameters: draft.current_package.primaryRecommendation.utmParameters,
      provenance_note: trimText(input.provenance_note || "Metrics entered manually by a Pink Paisa administrator.").slice(0, 2000),
      recorded_by_admin_id: actorId(actor),
    });
  } catch (error) {
    if (error?.code === 11000) snapshot = await MetricModel.findOne({ snapshot_key: snapshotKey });
    else throw error;
  }
  await appendAudit({ entityType: "METRIC_SNAPSHOT", entityId: snapshot._id, draft, action: "METRIC_SNAPSHOT_RECORDED", summary: "Recorded an immutable social performance snapshot.", actor, metadata: { source: snapshot.source, captured_at: snapshot.captured_at, metric_fields: Object.keys(metrics) }, dependencies });
  return publicMetric(snapshot);
}

async function getPerformanceSummary({ days = 90, dependencies = {} } = {}) {
  const DraftModel = dependencies.SocialPostDraft || SocialPostDraft;
  const MetricModel = dependencies.SocialMetricSnapshot || SocialMetricSnapshot;
  const since = new Date(Date.now() - Math.min(Math.max(Number(days || 90), 1), 365) * 24 * 60 * 60 * 1000);
  const drafts = await DraftModel.find({ published_at: { $gte: since } }).select("primary_content_pillar primary_format primary_topic published_at").lean();
  const draftIds = drafts.map((draft) => draft._id);
  const snapshots = draftIds.length ? await MetricModel.find({ draft_id: { $in: draftIds } }).sort({ captured_at: -1 }).lean() : [];
  const latest = new Map();
  snapshots.forEach((snapshot) => { const key = String(snapshot.draft_id); if (!latest.has(key)) latest.set(key, snapshot); });
  const aggregates = {};
  drafts.forEach((draft) => {
    const snapshot = latest.get(String(draft._id));
    if (!snapshot) return;
    const key = `${draft.primary_content_pillar || "Unknown"}|${draft.primary_format || "Unknown"}`;
    const row = aggregates[key] || { content_pillar: draft.primary_content_pillar || "Unknown", format: draft.primary_format || "Unknown", posts: 0, saves: 0, shares: 0, comments: 0, website_clicks: 0, negative_feedback: 0 };
    row.posts += 1;
    for (const field of ["saves", "shares", "comments", "website_clicks", "negative_feedback"]) row[field] += Number(snapshot.metrics?.[field] || 0);
    aggregates[key] = row;
  });
  return {
    days: Math.min(Math.max(Number(days || 90), 1), 365),
    published_posts: drafts.length,
    posts_with_metrics: latest.size,
    performance_signals: Object.values(aggregates).sort((left, right) => (right.saves + right.shares) - (left.saves + left.shares)),
    interpretation: "Historical performance is a directional input only. These aggregates do not establish causation and the decision engine also enforces pillar and format rotation.",
  };
}

async function getPublishingReadiness(draftId, { dependencies = {} } = {}) {
  const settings = await (dependencies.getSocialManagerSettings || getSocialManagerSettings)();
  return (dependencies.getSocialPublishingReadiness || getSocialPublishingReadiness)({ draftId, settings, publishNow: true, dependencies });
}

async function updateSocialManagerSettings(input, { actor, requestId = null, ip = null, dependencies = {} } = {}) {
  const before = await (dependencies.getSocialManagerSettings || getSocialManagerSettings)({ bypass_cache: true });
  const settings = await (dependencies.saveSocialManagerSettings || saveSocialManagerSettings)(input);
  const settingsDocument = await (dependencies.AdminSettings || AdminSettings).findOne({ key: SOCIAL_MANAGER_SETTINGS_KEY });
  if (settingsDocument) {
    const changes = findFieldChanges(before, settings, "social_manager_settings");
    await appendAudit({ entityType: "SETTINGS", entityId: settingsDocument._id, action: "SETTINGS_UPDATED", summary: `Updated ${changes.length} Social Media Manager setting${changes.length === 1 ? "" : "s"}.`, actor, fieldChanges: changes, requestId, ip, metadata: { publishing_enabled: settings.publishing.enabled, auto_publish: settings.publishing.auto_publish }, dependencies });
  }
  return settings;
}

module.exports = {
  addMetricSnapshot,
  approveAndScheduleDraft,
  approveDraft,
  duplicateDraft,
  executeGenerationRun,
  factCheckDraft,
  getDraftDetail,
  getGenerationRun,
  getPerformanceSummary,
  getPublishingReadiness,
  getTodayRecommendation,
  listDraftCalendar,
  processPendingSocialGenerationRuns,
  publicDraft,
  publicRun,
  regenerateDraftVisual,
  regenerateDraftPart,
  replaceDraftWithSuppliedFullAiGraphic,
  rejectDraft,
  requestGeneration,
  retryGenerationRun,
  runDueSocialGeneration,
  scheduleDraft,
  submitDraftForReview,
  updateDraftPackage,
  updateSocialManagerSettings,
  publishDraftNow,
  _private: {
    assembleReelCreative,
    candidateSummaries,
    draftQueueNavigation,
    currentVideoAssemblyPassed,
    creativeAssetIds,
    creativeCopyFingerprint,
    fullAiRenderedHeadlineFingerprint,
    videoAssemblyFingerprint,
    enforceMonthlyBudget,
    assertWeeklyRecommendationIdentity,
    estimateOpenAiCostUsd,
    ensurePromptVersions,
    findFieldChanges,
    freshnessForHours,
    generationErrorIsRetriable,
    istTimeParts,
    persistResearchSources,
    persistReviewerNotificationFailure,
    publicAsset,
    recomposeDraftFromActiveOriginals,
    reelStoryboardVisuals,
    researchMode,
    requestsInstagramCollaborationInvitation,
    requestsInstagramNativeAudio,
    storyInteractionPrompts,
    persistInstagramNativeManualActions,
    visualModeProvenancePassed,
    buildNativeFullAiGraphicAssetRows,
    fullAiNativeSwapFingerprint,
    normalizeFullAiTextManifest,
    packageWithFullAiNativeMode,
    reviewAssetReadiness,
    sha256,
    sourceType,
  },
};
