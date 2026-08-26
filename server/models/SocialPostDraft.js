const mongoose = require("mongoose");
const { validateSocialPackage } = require("../services/social/socialSchemas");

const DRAFT_STATUSES = [
  "DRAFT",
  "NEEDS_REVIEW",
  "APPROVED",
  "SCHEDULED",
  "PUBLISHING",
  "PUBLISHED",
  "REJECTED",
  "FAILED",
];

const OBJECTIVES = [
  "AWARENESS",
  "EDUCATION",
  "ENGAGEMENT",
  "TRAFFIC",
  "LEADS",
  "PRODUCT_PROMOTION",
  "COMMUNITY_BUILDING",
];

const FORMATS = [
  "SINGLE_IMAGE",
  "CAROUSEL",
  "REEL",
  "VIDEO_FEED",
  "STORY",
  "INFOGRAPHIC",
  "MEME",
  "QUIZ",
  "POLL",
  "PRODUCT_FEATURE",
  "RESOURCE_PROMOTION",
  "EVENT_OR_WORKSHOP_PROMOTION",
];

const VISUAL_MODES = [
  "AI_VISUAL_WITH_EXACT_OVERLAY",
  "AI_ARTWORK_ONLY",
  "FULL_AI_GRAPHIC",
  "MANUAL_TEMPLATE",
];

const VisualModeResolutionSchema = new mongoose.Schema({
  requested: { type: String, required: true, enum: VISUAL_MODES, uppercase: true, trim: true },
  effective: { type: String, required: true, enum: VISUAL_MODES, uppercase: true, trim: true },
  eligible: { type: Boolean, required: true },
  reasons: { type: [String], default: [] },
}, { _id: false });

const FullAiTextBlockSchema = new mongoose.Schema({
  key: { type: String, required: true, trim: true, maxlength: 80 },
  text: { type: String, required: true, trim: true, maxlength: 500 },
}, { _id: false });

const FullAiGraphicManifestSchema = new mongoose.Schema({
  contract_version: { type: Number, required: true, enum: [2] },
  expected_text_blocks: {
    type: [FullAiTextBlockSchema],
    required: true,
    validate: {
      validator(value) {
        return Array.isArray(value)
          && value.length >= 1
          && value.length <= 40
          && new Set(value.map((block) => String(block.key || "").trim())).size === value.length;
      },
      message: "FULL_AI_GRAPHIC v2 visible-text blocks must contain 1 to 40 unique keys",
    },
  },
  checksum_sha256: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    match: /^[a-f0-9]{64}$/,
  },
  approved_copy_checksum_sha256: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    match: /^[a-f0-9]{64}$/,
  },
  generation_tool: { type: String, default: null, trim: true, maxlength: 120 },
  tool_execution_id: { type: String, default: null, trim: true, maxlength: 300 },
  updated_at: { type: Date, required: true },
}, { _id: false });

function validatePackage(value) {
  validateSocialPackage(value);
  return true;
}

const packageField = (options = {}) => ({
  type: mongoose.Schema.Types.Mixed,
  required: true,
  validate: {
    validator: validatePackage,
    message: "Social package does not match the strict social content schema",
  },
  ...options,
});

const SocialPostDraftSchema = new mongoose.Schema(
  {
    generation_run_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SocialGenerationRun",
      required: true,
      immutable: true,
      index: true,
    },
    weekly_plan_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SocialWeeklyPlan",
      default: null,
      immutable: true,
      index: true,
    },
    candidate_id: { type: String, default: null, immutable: true, trim: true, maxlength: 100, index: true },
    weekly_slot_number: { type: Number, default: null, immutable: true, min: 1, max: 14 },
    week_start: {
      type: String,
      default: null,
      immutable: true,
      trim: true,
      match: [/^\d{4}-\d{2}-\d{2}$/, "week_start must use YYYY-MM-DD"],
      index: true,
    },
    week_end: {
      type: String,
      default: null,
      immutable: true,
      trim: true,
      match: [/^\d{4}-\d{2}-\d{2}$/, "week_end must use YYYY-MM-DD"],
    },
    primary_kpi: { type: String, default: null, trim: true, uppercase: true, maxlength: 100 },
    secondary_kpi: { type: String, default: null, trim: true, uppercase: true, maxlength: 100 },
    audience_segment: { type: String, default: null, trim: true, maxlength: 300 },
    manual_action_ids: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "SocialManualAction" }], default: [] },
    generation_date: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
      index: true,
    },
    timezone: {
      type: String,
      required: true,
      immutable: true,
      enum: ["Asia/Kolkata"],
      default: "Asia/Kolkata",
    },
    revision: { type: Number, required: true, default: 1, min: 1 },
    generation_mode: {
      type: String,
      enum: ["FULL_AI", "ADMIN_MANUAL", "LEGACY_PARTIAL_AI", "LEGACY_FALLBACK"],
      default: "FULL_AI",
      index: true,
      uppercase: true,
      trim: true,
    },
    visual_mode: {
      type: String,
      enum: VISUAL_MODES,
      default: "AI_VISUAL_WITH_EXACT_OVERLAY",
      index: true,
      uppercase: true,
      trim: true,
    },
    visual_mode_resolution: { type: VisualModeResolutionSchema, default: null },
    caption_checksum_sha256: {
      type: String,
      default: null,
      trim: true,
      lowercase: true,
      match: /^[a-f0-9]{64}$/,
    },
    full_ai_ready: { type: Boolean, default: false, index: true },
    full_ai_graphic_manifest: { type: FullAiGraphicManifestSchema, default: null },
    idempotency_key: {
      type: String,
      required: true,
      immutable: true,
      unique: true,
      trim: true,
      maxlength: 300,
    },
    bundle_id: {
      type: String,
      default: null,
      immutable: true,
      trim: true,
      maxlength: 240,
      index: true,
    },
    bundle_role: {
      type: String,
      default: null,
      enum: ["PARENT_FEED", "COMPANION_STORY", "STANDALONE_STORY", null],
      uppercase: true,
      trim: true,
      index: true,
    },
    parent_draft_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SocialPostDraft",
      default: null,
      index: true,
    },
    result_json: packageField({ immutable: true }),
    current_package: packageField(),
    status: {
      type: String,
      required: true,
      enum: DRAFT_STATUSES,
      default: "DRAFT",
      index: true,
      uppercase: true,
      trim: true,
    },

    // Query-oriented projections of current_package. The complete API contract
    // remains in the two strict camelCase package fields above.
    primary_internal_title: { type: String, default: null, trim: true, maxlength: 180 },
    primary_topic: { type: String, default: null, trim: true, maxlength: 240, index: true },
    primary_objective: { type: String, default: null, enum: [...OBJECTIVES, null], index: true },
    primary_format: { type: String, default: null, enum: [...FORMATS, null], index: true },
    primary_format_reason: { type: String, default: null, trim: true, maxlength: 700 },
    primary_post_type: { type: String, default: null, trim: true, maxlength: 100, index: true },
    primary_content_pillar: { type: String, default: null, trim: true, maxlength: 120, index: true },
    primary_total_score: { type: Number, default: null, min: 0, max: 100, index: true },
    primary_confidence: { type: Number, default: null, min: 0, max: 1 },
    primary_risk_flags: { type: [String], default: [] },
    alternative_topics: { type: [String], default: [] },
    content_fingerprint: { type: String, default: null, trim: true, index: true },

    research_source_ids: [{ type: mongoose.Schema.Types.ObjectId, ref: "SocialResearchSource" }],
    asset_ids: [{ type: mongoose.Schema.Types.ObjectId, ref: "SocialAsset" }],
    original_ai_asset_ids: [{ type: mongoose.Schema.Types.ObjectId, ref: "SocialAsset" }],
    final_composed_asset_ids: [{ type: mongoose.Schema.Types.ObjectId, ref: "SocialAsset" }],
    audio_track_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SocialAudioTrack",
      default: null,
      index: true,
    },
    audio_selection_json: { type: mongoose.Schema.Types.Mixed, default: null },
    prompt_version_ids: [{ type: mongoose.Schema.Types.ObjectId, ref: "SocialPromptVersion" }],
    publication_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SocialPublication",
      default: null,
      index: true,
    },

    duplicate_analysis: { type: mongoose.Schema.Types.Mixed, default: null },
    compliance_summary: { type: mongoose.Schema.Types.Mixed, default: null },
    creative_readiness: { type: mongoose.Schema.Types.Mixed, default: null },
    approval_json: { type: mongoose.Schema.Types.Mixed, default: null },
    schedule_json: { type: mongoose.Schema.Types.Mixed, default: null },
    publication_json: { type: mongoose.Schema.Types.Mixed, default: null },

    submitted_for_review_at: { type: Date, default: null },
    submitted_for_review_by: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    approved_at: { type: Date, default: null },
    approved_by_admin_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    approved_revision: { type: Number, default: null, min: 1 },
    rejected_at: { type: Date, default: null },
    rejected_by_admin_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    rejection_reason: { type: String, default: null, trim: true, maxlength: 2000 },
    scheduled_for: { type: Date, default: null, index: true },
    scheduled_by_admin_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    publishing_started_at: { type: Date, default: null },
    published_at: { type: Date, default: null, index: true },
    failed_at: { type: Date, default: null },
    last_error: {
      code: { type: String, default: null, trim: true },
      message: { type: String, default: null, trim: true },
      stage: { type: String, default: null, trim: true },
      is_retriable: { type: Boolean, default: false },
      occurred_at: { type: Date, default: null },
    },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    optimisticConcurrency: true,
  }
);

SocialPostDraftSchema.pre("validate", function projectCurrentPackage() {
  const current = this.current_package;
  const original = this.result_json;

  if (current?.generationDate && current.generationDate !== this.generation_date) {
    this.invalidate("current_package", "current_package.generationDate must match generation_date");
  }
  if (original?.generationDate && original.generationDate !== this.generation_date) {
    this.invalidate("result_json", "result_json.generationDate must match generation_date");
  }
  if (current?.timezone && current.timezone !== this.timezone) {
    this.invalidate("current_package", "current_package.timezone must match timezone");
  }
  if (original?.timezone && original.timezone !== this.timezone) {
    this.invalidate("result_json", "result_json.timezone must match timezone");
  }

  const hasWeeklyLink = Boolean(this.weekly_plan_id);
  const hasPartialWeeklyData = Boolean(
    this.candidate_id || this.weekly_slot_number || this.week_start || this.week_end
      || this.primary_kpi || this.secondary_kpi || this.audience_segment
  );
  if (hasPartialWeeklyData && !hasWeeklyLink) {
    this.invalidate("weekly_plan_id", "Weekly draft metadata requires weekly_plan_id");
  }
  if (hasWeeklyLink && (!this.candidate_id || !this.weekly_slot_number || !this.week_start || !this.week_end || !this.primary_kpi)) {
    this.invalidate(
      "weekly_plan_id",
      "Weekly drafts require candidate_id, weekly_slot_number, week_start, week_end, and primary_kpi"
    );
  }
  const hasBundleMetadata = Boolean(this.bundle_id || this.bundle_role);
  if (hasBundleMetadata && (!this.bundle_id || !this.bundle_role || !hasWeeklyLink)) {
    this.invalidate("bundle_id", "Bundled drafts require bundle_id, bundle_role, and weekly_plan_id");
  }
  if (this.week_start && this.week_end) {
    const start = Date.parse(`${this.week_start}T00:00:00.000Z`);
    const end = Date.parse(`${this.week_end}T00:00:00.000Z`);
    if (Number.isFinite(start) && Number.isFinite(end) && end - start !== 6 * 24 * 60 * 60 * 1000) {
      this.invalidate("week_end", "week_end must be the sixth calendar day after week_start");
    }
  }

  const primary = current?.primaryRecommendation;
  if (!primary) return;

  const format = String(primary.format || "").toUpperCase();
  if (["COMPANION_STORY", "STANDALONE_STORY"].includes(this.bundle_role) && format !== "STORY") {
    this.invalidate("bundle_role", `${this.bundle_role} requires STORY content`);
  }
  if (this.bundle_role === "PARENT_FEED" && format === "STORY") {
    this.invalidate("bundle_role", "PARENT_FEED cannot use STORY content");
  }

  this.primary_internal_title = primary.internalTitle || null;
  this.primary_topic = primary.topic || null;
  this.primary_objective = primary.objective || null;
  this.primary_format = primary.format || null;
  this.primary_format_reason = primary.formatReason || primary.formatSelectionReason || null;
  this.primary_post_type = primary.postType || null;
  this.primary_content_pillar = primary.contentPillar || null;
  this.primary_total_score = Number.isFinite(primary.scoreBreakdown?.total)
    ? primary.scoreBreakdown.total
    : null;
  this.primary_confidence = Number.isFinite(primary.confidence) ? primary.confidence : null;
  this.primary_risk_flags = Array.isArray(primary.riskFlags) ? primary.riskFlags : [];
  this.alternative_topics = Array.isArray(current.alternativeRecommendations)
    ? current.alternativeRecommendations.map((item) => item?.topic).filter(Boolean)
    : [];
});

SocialPostDraftSchema.index({ generation_run_id: 1, revision: -1 });
SocialPostDraftSchema.index({ weekly_plan_id: 1, weekly_slot_number: 1 });
SocialPostDraftSchema.index({ weekly_plan_id: 1, candidate_id: 1, revision: -1 });
SocialPostDraftSchema.index({ weekly_plan_id: 1, bundle_id: 1, bundle_role: 1 });
SocialPostDraftSchema.index({ generation_date: -1, status: 1 });
SocialPostDraftSchema.index({ status: 1, scheduled_for: 1 });
SocialPostDraftSchema.index({ published_at: -1, primary_content_pillar: 1 });
SocialPostDraftSchema.index({ primary_topic: 1, generation_date: -1 });
SocialPostDraftSchema.index({ research_source_ids: 1 });
SocialPostDraftSchema.index({ asset_ids: 1 });
SocialPostDraftSchema.index({ original_ai_asset_ids: 1 });
SocialPostDraftSchema.index({ final_composed_asset_ids: 1 });
SocialPostDraftSchema.index({ audio_track_id: 1, status: 1 });

SocialPostDraftSchema.statics.DRAFT_STATUSES = DRAFT_STATUSES;
SocialPostDraftSchema.statics.OBJECTIVES = OBJECTIVES;
SocialPostDraftSchema.statics.FORMATS = FORMATS;
SocialPostDraftSchema.statics.VISUAL_MODES = VISUAL_MODES;

module.exports = mongoose.model("SocialPostDraft", SocialPostDraftSchema);
