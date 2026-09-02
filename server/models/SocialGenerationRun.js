const mongoose = require("mongoose");

const RUN_STATUSES = [
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "FAILED_COMPLIANCE",
  "FAILED_IMAGE_GENERATION",
];

const RUN_STAGES = [
  "QUEUED",
  "COLLECTING_INTERNAL_SIGNALS",
  "RESEARCHING",
  "ANALYZING_MARKET",
  "GENERATING_CANDIDATES",
  "SCORING_CANDIDATES",
  "WRITING_CONTENT",
  "CHECKING_COMPLIANCE",
  "REVISING_CONTENT",
  "BUILDING_VISUAL_BRIEF",
  "GENERATING_IMAGES",
  "VALIDATING_IMAGES",
  "COMPOSING_FINAL_ASSETS",
  "ASSEMBLING_RESULT",
  "CREATING_DRAFT",
  "AWAITING_REVIEW",
  "COMPLETED",
  "FAILED",
];

const SOCIAL_FORMATS = [
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
];

const VISUAL_MODES = [
  "AI_VISUAL_WITH_EXACT_OVERLAY",
  "AI_ARTWORK_ONLY",
  "FULL_AI_GRAPHIC",
  "MANUAL_TEMPLATE",
];

const visualModeResolutionSchema = new mongoose.Schema(
  {
    requested: { type: String, required: true, enum: VISUAL_MODES, uppercase: true, trim: true },
    effective: { type: String, required: true, enum: VISUAL_MODES, uppercase: true, trim: true },
    eligible: { type: Boolean, required: true },
    reasons: { type: [String], default: [] },
  },
  { _id: false },
);

const usageSchema = new mongoose.Schema(
  {
    input_tokens: { type: Number, default: 0, min: 0 },
    output_tokens: { type: Number, default: 0, min: 0 },
    total_tokens: { type: Number, default: 0, min: 0 },
    input_image_tokens: { type: Number, default: 0, min: 0 },
    output_image_tokens: { type: Number, default: 0, min: 0 },
    estimated_cost: { type: Number, default: 0, min: 0 },
    cost_currency: { type: String, default: "USD", trim: true, uppercase: true },
  },
  { _id: false }
);

const stageExecutionSchema = new mongoose.Schema(
  {
    stage: { type: String, required: true, enum: RUN_STAGES, uppercase: true, trim: true },
    status: {
      type: String,
      required: true,
      enum: ["QUEUED", "RUNNING", "COMPLETED", "SKIPPED", "FAILED"],
      default: "QUEUED",
      uppercase: true,
      trim: true,
    },
    provider: { type: String, default: null, trim: true },
    model: { type: String, default: null, trim: true },
    prompt_version_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SocialPromptVersion",
      default: null,
    },
    prompt_semantic_version: { type: String, default: null, trim: true },
    runtime_prompt_version: { type: String, default: null, trim: true },
    system_instructions_version: { type: String, default: null, trim: true },
    input_fingerprint: { type: String, default: null, trim: true },
    output_fingerprint: { type: String, default: null, trim: true },
    provider_request_id: { type: String, default: null, trim: true },
    provider_response_id: { type: String, default: null, trim: true },
    retry_number: { type: Number, default: 0, min: 0 },
    input_tokens: { type: Number, default: 0, min: 0 },
    output_tokens: { type: Number, default: 0, min: 0 },
    total_tokens: { type: Number, default: 0, min: 0 },
    estimated_cost: { type: Number, default: 0, min: 0 },
    cost_currency: { type: String, default: "USD", trim: true, uppercase: true },
    attempt_count: { type: Number, default: 0, min: 0 },
    started_at: { type: Date, default: null },
    finished_at: { type: Date, default: null },
    error_code: { type: String, default: null, trim: true },
    error_message: { type: String, default: null, trim: true },
    output_json: { type: mongoose.Schema.Types.Mixed, default: null },
    request_metadata: { type: mongoose.Schema.Types.Mixed, default: null },
    response_metadata: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: false }
);

const providerCallCheckpointSchema = new mongoose.Schema(
  {
    call_key: { type: String, required: true, trim: true, maxlength: 200 },
    stage: { type: String, required: true, enum: RUN_STAGES, uppercase: true, trim: true },
    status: {
      type: String,
      required: true,
      enum: ["STARTED", "COMPLETED", "UNCERTAIN"],
      default: "STARTED",
      uppercase: true,
      trim: true,
    },
    provider: { type: String, default: "openai", trim: true, maxlength: 100 },
    model: { type: String, default: null, trim: true, maxlength: 200 },
    input_fingerprint: { type: String, required: true, trim: true, maxlength: 128 },
    started_at: { type: Date, required: true },
    completed_at: { type: Date, default: null },
    uncertain_at: { type: Date, default: null },
  },
  { _id: false }
);

const generationRequestSchema = new mongoose.Schema(
  {
    requested_format: {
      type: String,
      enum: ["AUTO_CHOOSE", ...SOCIAL_FORMATS],
      default: "AUTO_CHOOSE",
      uppercase: true,
      trim: true,
    },
    requested_post_type: { type: String, default: null, trim: true, maxlength: 100 },
    generation_scope: {
      type: String,
      enum: ["FULL_POST", "STRATEGY", "COPY", "IMAGE", "FORMAT_CHANGE", "COMPLIANCE"],
      default: "FULL_POST",
      uppercase: true,
      trim: true,
    },
    visual_mode: {
      type: String,
      enum: VISUAL_MODES,
      default: "AI_VISUAL_WITH_EXACT_OVERLAY",
      uppercase: true,
      trim: true,
    },
    visual_mode_resolution: { type: visualModeResolutionSchema, default: null },
    asset_sequence: { type: Number, default: null, min: 1, max: 20 },
    admin_instructions: { type: String, default: null, trim: true, maxlength: 4000 },
    verified_product_id: { type: mongoose.Schema.Types.ObjectId, ref: "Product", default: null },
    weekly_candidate: { type: mongoose.Schema.Types.Mixed, default: null },
    required_landing_page: { type: String, default: null, trim: true, maxlength: 2048 },
    request_id: { type: String, default: null, trim: true, maxlength: 200 },
  },
  { _id: false }
);

const contentRevisionAttemptSchema = new mongoose.Schema(
  {
    attempt_number: { type: Number, required: true, min: 1, max: 10 },
    candidate_id: { type: String, default: null, trim: true },
    compliance_decision: {
      type: String,
      enum: ["REVISE", "REJECT", "PASS", null],
      default: null,
      uppercase: true,
      trim: true,
    },
    issues: { type: [String], default: [] },
    revision_instructions: { type: [String], default: [] },
    provider: { type: String, default: null, trim: true },
    model: { type: String, default: null, trim: true },
    prompt_version_id: { type: mongoose.Schema.Types.ObjectId, ref: "SocialPromptVersion", default: null },
    provider_request_id: { type: String, default: null, trim: true },
    provider_response_id: { type: String, default: null, trim: true },
    input_fingerprint: { type: String, default: null, trim: true },
    output_fingerprint: { type: String, default: null, trim: true },
    revised_output_json: { type: mongoose.Schema.Types.Mixed, default: null },
    usage: { type: usageSchema, default: () => ({}) },
    status: {
      type: String,
      enum: ["PENDING", "RUNNING", "COMPLETED", "FAILED"],
      default: "PENDING",
      uppercase: true,
      trim: true,
    },
    started_at: { type: Date, default: null },
    completed_at: { type: Date, default: null },
    failure_reason: { type: String, default: null, trim: true, maxlength: 4000 },
  },
  { _id: false }
);

const imageGenerationAttemptSchema = new mongoose.Schema(
  {
    attempt_number: { type: Number, required: true, min: 1, max: 20 },
    asset_index: { type: Number, required: true, min: 0, max: 19 },
    slide_number: { type: Number, default: null, min: 1, max: 20 },
    format: { type: String, required: true, enum: SOCIAL_FORMATS, uppercase: true, trim: true },
    visual_mode: {
      type: String,
      required: true,
      enum: VISUAL_MODES,
      default: "AI_VISUAL_WITH_EXACT_OVERLAY",
      uppercase: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ["PENDING", "RUNNING", "GENERATED", "VALIDATED", "FAILED"],
      default: "PENDING",
      uppercase: true,
      trim: true,
    },
    provider: { type: String, required: true, default: "openai", trim: true },
    model: { type: String, required: true, trim: true },
    image_prompt: { type: String, required: true, trim: true, maxlength: 12000 },
    prompt_fingerprint: { type: String, default: null, trim: true, maxlength: 128 },
    output_fingerprint: { type: String, default: null, trim: true, maxlength: 128 },
    negative_visual_instructions: { type: [String], default: [] },
    provider_request_id: { type: String, default: null, trim: true },
    provider_response_id: { type: String, default: null, trim: true },
    revised_prompt_from_attempt: { type: Number, default: null, min: 1, max: 20 },
    original_asset_url: { type: String, default: null, trim: true, maxlength: 4096 },
    original_storage_key: { type: String, default: null, trim: true, maxlength: 4096 },
    original_checksum_sha256: {
      type: String,
      default: null,
      lowercase: true,
      trim: true,
      match: /^[a-f0-9]{64}$/,
    },
    original_mime_type: { type: String, enum: ["image/jpeg", "image/png", "image/webp", null], default: null },
    original_width: { type: Number, default: null, min: 1, max: 10000 },
    original_height: { type: Number, default: null, min: 1, max: 10000 },
    reference_assets: { type: [mongoose.Schema.Types.Mixed], default: [] },
    validation_results: { type: mongoose.Schema.Types.Mixed, default: null },
    image_usage: { type: usageSchema, default: () => ({}) },
    validation_usage: { type: usageSchema, default: () => ({}) },
    prompt_revision: { type: mongoose.Schema.Types.Mixed, default: null },
    usage: { type: usageSchema, default: () => ({}) },
    started_at: { type: Date, default: null },
    completed_at: { type: Date, default: null },
    failure_reason: { type: String, default: null, trim: true, maxlength: 4000 },
  },
  { _id: false }
);

const candidateSummarySchema = new mongoose.Schema(
  {
    candidate_id: { type: String, required: true, trim: true },
    topic: { type: String, required: true, trim: true },
    content_pillar: { type: String, required: true, trim: true },
    format: { type: String, default: null, trim: true },
    total_score: { type: Number, required: true, min: -30, max: 100 },
    disposition: {
      type: String,
      required: true,
      enum: ["PRIMARY", "ALTERNATIVE", "REJECTED"],
    },
    rejection_reason: { type: String, default: null, trim: true },
    risk_flags: { type: [String], default: [] },
  },
  { _id: false }
);

const runErrorSchema = new mongoose.Schema(
  {
    stage: { type: String, default: null, enum: [...RUN_STAGES, null] },
    code: { type: String, default: null, trim: true },
    message: { type: String, default: null, trim: true },
    is_retriable: { type: Boolean, default: false },
    details: { type: mongoose.Schema.Types.Mixed, default: null },
    occurred_at: { type: Date, default: null },
  },
  { _id: false }
);

const SocialGenerationRunSchema = new mongoose.Schema(
  {
    generation_date: {
      type: String,
      required: true,
      trim: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
      index: true,
    },
    timezone: { type: String, required: true, enum: ["Asia/Kolkata"], default: "Asia/Kolkata" },
    trigger_type: {
      type: String,
      required: true,
      enum: ["SCHEDULED", "MANUAL", "RETRY", "BACKFILL"],
      default: "SCHEDULED",
      index: true,
      uppercase: true,
      trim: true,
    },
    idempotency_key: { type: String, required: true, unique: true, trim: true },
    weekly_plan_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SocialWeeklyPlan",
      default: null,
      immutable: true,
      index: true,
    },
    weekly_candidate_id: { type: String, default: null, immutable: true, trim: true, maxlength: 100, index: true },
    request_fingerprint: { type: String, default: null, trim: true, index: true },
    input_snapshot_hash: { type: String, default: null, trim: true, index: true },
    generation_request: { type: generationRequestSchema, default: () => ({}) },
    generation_mode: {
      type: String,
      enum: ["FULL_AI", "ADMIN_MANUAL", "LEGACY_PARTIAL_AI", "LEGACY_FALLBACK"],
      default: "FULL_AI",
      index: true,
      uppercase: true,
      trim: true,
    },
    full_ai_generation: { type: Boolean, default: true, index: true },
    status: { type: String, required: true, enum: RUN_STATUSES, default: "PENDING", index: true, uppercase: true, trim: true },
    current_stage: { type: String, required: true, enum: RUN_STAGES, default: "QUEUED", index: true, uppercase: true, trim: true },
    initiated_by_admin_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    internal_signal_summary: { type: mongoose.Schema.Types.Mixed, default: null },
    daily_market_analysis: { type: mongoose.Schema.Types.Mixed, default: null },
    internal_signal_counts: {
      products: { type: Number, default: 0, min: 0 },
      affiliate_products: { type: Number, default: 0, min: 0 },
      blogs: { type: Number, default: 0, min: 0 },
      workshops: { type: Number, default: 0, min: 0 },
      polls: { type: Number, default: 0, min: 0 },
      recent_social_posts: { type: Number, default: 0, min: 0 },
      active_campaigns: { type: Number, default: 0, min: 0 },
    },
    research_mode: {
      type: String,
      enum: ["WEB_SEARCH", "TRUSTED_FEEDS", "EVERGREEN", "DISABLED", null],
      default: null,
      index: true,
      uppercase: true,
      trim: true,
    },
    used_fallback: { type: Boolean, default: false, index: true },
    fallback_reason: { type: String, default: null, trim: true },
    deterministic_content_fallback_used: { type: Boolean, default: false, index: true },
    template_only_visual_fallback_used: { type: Boolean, default: false, index: true },
    source_ids: [{ type: mongoose.Schema.Types.ObjectId, ref: "SocialResearchSource" }],
    stage_executions: { type: [stageExecutionSchema], default: [] },
    provider_call_checkpoints: { type: [providerCallCheckpointSchema], default: [] },
    content_revision_attempts: { type: [contentRevisionAttemptSchema], default: [] },
    image_generation_attempts: { type: [imageGenerationAttemptSchema], default: [] },
    image_generation_status: {
      type: String,
      enum: ["NOT_STARTED", "RUNNING", "COMPLETED", "FAILED"],
      default: "NOT_STARTED",
      index: true,
      uppercase: true,
      trim: true,
    },
    candidate_summaries: { type: [candidateSummarySchema], default: [] },
    candidate_count: { type: Number, default: 0, min: 0 },
    selected_draft_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SocialPostDraft",
      default: null,
      index: true,
    },
    failed_draft_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SocialPostDraft",
      default: null,
      index: true,
    },
    retry_of_generation_run_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SocialGenerationRun",
      default: null,
      index: true,
    },
    superseded_by_generation_run_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SocialGenerationRun",
      default: null,
      index: true,
    },
    superseded_at: { type: Date, default: null, index: true },
    recovery_archived_at: { type: Date, default: null, index: true },
    recovery_archived_by_admin_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    recovery_archive_reason: { type: String, default: null, trim: true, maxlength: 1000 },
    recovery_archive_request_id: { type: String, default: null, trim: true, maxlength: 200 },
    usage: { type: usageSchema, default: () => ({}) },
    attempt_count: { type: Number, default: 0, min: 0 },
    retry_count: { type: Number, default: 0, min: 0 },
    max_attempts: { type: Number, default: 3, min: 1, max: 10 },
    queued_at: { type: Date, required: true, default: Date.now, index: true },
    available_at: { type: Date, required: true, default: Date.now, index: true },
    lease_owner: { type: String, default: null, trim: true, index: true },
    lease_expires_at: { type: Date, default: null, index: true },
    heartbeat_at: { type: Date, default: null },
    next_retry_at: { type: Date, default: null, index: true },
    started_at: { type: Date, default: null },
    completed_at: { type: Date, default: null },
    finished_at: { type: Date, default: null },
    last_error: { type: runErrorSchema, default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

SocialGenerationRunSchema.pre("validate", function validateWeeklyLink() {
  if (Boolean(this.weekly_plan_id) !== Boolean(this.weekly_candidate_id)) {
    this.invalidate(
      "weekly_plan_id",
      "weekly_plan_id and weekly_candidate_id must either both be present or both be absent"
    );
  }
});

SocialGenerationRunSchema.index({ generation_date: -1, status: 1 });
SocialGenerationRunSchema.index({ weekly_plan_id: 1, weekly_candidate_id: 1, created_at: -1 });
SocialGenerationRunSchema.index({ status: 1, available_at: 1, created_at: 1 });
SocialGenerationRunSchema.index({ status: 1, lease_expires_at: 1 });
SocialGenerationRunSchema.index({ status: 1, next_retry_at: 1, created_at: 1 });
SocialGenerationRunSchema.index({ current_stage: 1, updated_at: 1 });
SocialGenerationRunSchema.index({ generation_date: -1, image_generation_status: 1 });
SocialGenerationRunSchema.index({ recovery_archived_at: 1, superseded_at: 1, finished_at: -1 });

SocialGenerationRunSchema.statics.RUN_STATUSES = RUN_STATUSES;
SocialGenerationRunSchema.statics.RUN_STAGES = RUN_STAGES;
SocialGenerationRunSchema.statics.SOCIAL_FORMATS = SOCIAL_FORMATS;
SocialGenerationRunSchema.statics.VISUAL_MODES = VISUAL_MODES;

module.exports = mongoose.model("SocialGenerationRun", SocialGenerationRunSchema);
