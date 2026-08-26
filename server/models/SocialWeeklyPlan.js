const mongoose = require("mongoose");

const PLAN_STATUSES = Object.freeze([
  "QUEUED", "RESEARCHING", "PLANNING", "PLANNED", "GENERATING_CONTENT",
  "NEEDS_REVIEW", "APPROVED", "SCHEDULED", "ACTIVE", "COMPLETED", "REJECTED",
  "FAILED_RESEARCH", "FAILED_GENERATION", "FAILED_COMPLIANCE", "MANUAL_ACTION_REQUIRED",
]);
const SOCIAL_FORMATS = Object.freeze([
  "SINGLE_IMAGE", "CAROUSEL", "REEL", "VIDEO_FEED", "STORY", "INFOGRAPHIC", "MEME",
  "QUIZ", "POLL_CONCEPT", "POLL", "PRODUCT_FEATURE", "RESOURCE_PROMOTION",
  "WORKSHOP_PROMOTION", "EVENT_OR_WORKSHOP_PROMOTION",
]);
const VISUAL_MODES = Object.freeze([
  "AI_VISUAL_WITH_EXACT_OVERLAY", "AI_ARTWORK_ONLY", "FULL_AI_GRAPHIC",
]);
const BUNDLE_ROLES = Object.freeze(["PARENT_FEED", "COMPANION_STORY", "STANDALONE_STORY"]);
const SELECTED_POST_STATUSES = Object.freeze([
  "PLANNED", "GENERATING", "GENERATING_COPY", "GENERATING_VISUAL", "NEEDS_REVIEW",
  "APPROVED", "SCHEDULED", "PUBLISHED", "REJECTED", "FAILED", "MANUAL_ACTION_REQUIRED",
]);
const REVIEWABLE_STATUSES = new Set([
  "NEEDS_REVIEW", "APPROVED", "SCHEDULED", "ACTIVE", "COMPLETED", "REJECTED",
  "FAILED_COMPLIANCE", "MANUAL_ACTION_REQUIRED",
]);
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CHECKSUM_PATTERN = /^[a-f0-9]{64}$/;
const FORBIDDEN_PERSONAL_DATA_KEYS = /^(?:email|email_address|phone|phone_number|ip|ip_address|cookie|authorization|access_token|refresh_token|password|private_key|client_secret|app_secret|full_name|customer_id|user_id|client_id|author_external_id)$/i;

function containsPersonalDataKey(value, depth = 0) {
  if (depth > 12 || value == null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => containsPersonalDataKey(item, depth + 1));
  return Object.entries(value).some(([key, child]) => (
    FORBIDDEN_PERSONAL_DATA_KEYS.test(key) || containsPersonalDataKey(child, depth + 1)
  ));
}
function aggregateOnly(value) {
  return value != null && typeof value === "object" && !containsPersonalDataKey(value);
}
function nullableAggregateOnly(value) {
  return value == null || aggregateOnly(value);
}
function dateKeyInKolkata(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

const usageSchema = new mongoose.Schema({
  input_tokens: { type: Number, default: 0, min: 0 },
  output_tokens: { type: Number, default: 0, min: 0 },
  total_tokens: { type: Number, default: 0, min: 0 },
  estimated_cost: { type: Number, default: null, min: 0 },
  cost_currency: { type: String, default: null, uppercase: true, trim: true, maxlength: 12 },
}, { _id: false, strict: "throw" });

const promptRunSchema = new mongoose.Schema({
  agent_role: { type: String, required: true, uppercase: true, trim: true, maxlength: 100 },
  stage: { type: String, required: true, trim: true, maxlength: 100 },
  status: { type: String, enum: ["QUEUED", "RUNNING", "COMPLETED", "FAILED", "SKIPPED"], default: "COMPLETED", uppercase: true, trim: true },
  provider: { type: String, required: true, trim: true, maxlength: 80 },
  model: { type: String, default: null, trim: true, maxlength: 200 },
  prompt_version: { type: String, default: null, trim: true, maxlength: 160 },
  prompt_version_id: { type: mongoose.Schema.Types.ObjectId, ref: "SocialPromptVersion", default: null },
  input_context_checksum: { type: String, default: null, lowercase: true, trim: true, match: CHECKSUM_PATTERN },
  output_checksum: { type: String, default: null, lowercase: true, trim: true, match: CHECKSUM_PATTERN },
  response_id: { type: String, default: null, trim: true, maxlength: 300 },
  usage: { type: usageSchema, default: () => ({}) },
  start_time: { type: Date, default: null },
  completion_time: { type: Date, default: null },
  retry_count: { type: Number, default: 0, min: 0, max: 20 },
  failure_reason: { type: String, default: null, trim: true, maxlength: 4000 },
}, { _id: true, id: false, strict: "throw" });

const candidateSchema = new mongoose.Schema({
  candidateId: { type: String, required: true, trim: true, maxlength: 100 },
  title: { type: String, required: true, trim: true, maxlength: 180 },
  objective: { type: String, required: true, trim: true, uppercase: true, maxlength: 80 },
  primaryKpi: { type: String, required: true, trim: true, uppercase: true, maxlength: 100 },
  secondaryKpi: { type: String, required: true, trim: true, uppercase: true, maxlength: 100 },
  audienceSegment: { type: String, required: true, trim: true, maxlength: 300 },
  topic: { type: String, required: true, trim: true, maxlength: 240 },
  contentPillar: { type: String, required: true, trim: true, maxlength: 160 },
  format: { type: String, required: true, enum: SOCIAL_FORMATS, uppercase: true, trim: true },
  whyThisWeek: { type: String, required: true, trim: true, maxlength: 700 },
  whyThisFormat: { type: String, required: true, trim: true, maxlength: 700 },
  pinkPaisaConnection: { type: String, required: true, trim: true, maxlength: 700 },
  recommendedLandingPage: { type: String, default: null, trim: true, maxlength: 2048 },
  verifiedInternalEntityId: { type: String, default: null, trim: true, maxlength: 80 },
  evidenceSourceIndexes: { type: [{ type: Number, min: 0, max: 10000 }], default: [] },
  riskLevel: { type: String, required: true, enum: ["LOW", "MEDIUM", "HIGH"], uppercase: true, trim: true },
  promotionalIntensity: { type: String, required: true, enum: ["NONE", "LIGHT", "MODERATE", "HIGH"], uppercase: true, trim: true },
  confidence: { type: Number, required: true, min: 0, max: 1 },
  duplicateRisk: { type: String, required: true, enum: ["NONE", "LOW", "MEDIUM", "HIGH"], uppercase: true, trim: true },
  conciseRationale: { type: String, required: true, trim: true, maxlength: 800 },
  growthCategory: {
    type: String,
    default: null,
    enum: ["MONEY", "BODY_FITNESS", "WELLNESS_BEAUTY", "WOMEN_LIFE", "PINK_PAISA", null],
    uppercase: true,
    trim: true,
  },
  seriesKey: {
    type: String,
    default: null,
    enum: ["PINK_PAISA_RULES", "WOULD_I_BUY_IT", "RICH_GIRL_MATH", "AFTER_40", "PINK_PAISA_FINDS", null],
    uppercase: true,
    trim: true,
  },
  hookFormula: { type: [{ type: String, trim: true, maxlength: 40 }], default: [] },
}, { _id: false, strict: "throw" });

const visualModeResolutionSchema = new mongoose.Schema({
  requested: { type: String, required: true, enum: VISUAL_MODES, uppercase: true, trim: true },
  effective: { type: String, required: true, enum: VISUAL_MODES, uppercase: true, trim: true },
  eligible: { type: Boolean, required: true },
  reasons: { type: [{ type: String, trim: true, maxlength: 500 }], default: [] },
}, { _id: false, strict: "throw" });

const selectedPostSchema = new mongoose.Schema({
  candidateId: { type: String, required: true, trim: true, maxlength: 100 },
  slotNumber: { type: Number, required: true, min: 1, max: 14 },
  scheduledFor: { type: Date, required: true },
  selectionReason: { type: String, required: true, trim: true, maxlength: 800 },
  roleInWeeklyMix: { type: String, required: true, enum: ["DISCOVERY", "SAVEABLE_EDUCATION", "ENGAGEMENT", "CONVERSION", "OTHER"], uppercase: true, trim: true },
  candidate: { type: candidateSchema, required: true },
  visual_mode_resolution: { type: visualModeResolutionSchema, default: null },
  status: { type: String, required: true, enum: SELECTED_POST_STATUSES, default: "PLANNED", uppercase: true, trim: true },
  generation_run_id: { type: mongoose.Schema.Types.ObjectId, ref: "SocialGenerationRun", default: null },
  draft_id: { type: mongoose.Schema.Types.ObjectId, ref: "SocialPostDraft", default: null },
  publication_id: { type: mongoose.Schema.Types.ObjectId, ref: "SocialPublication", default: null },
  bundleId: { type: String, default: null, trim: true, maxlength: 240 },
  bundleRole: { type: String, default: null, enum: ["PARENT_FEED", null], uppercase: true, trim: true },
}, { _id: false, strict: "throw" });

const storyPlanItemSchema = new mongoose.Schema({
  candidateId: { type: String, required: true, trim: true, maxlength: 100 },
  sourceCandidateId: { type: String, default: null, trim: true, maxlength: 100 },
  slotNumber: { type: Number, required: true, min: 1, max: 7 },
  scheduledFor: { type: Date, required: true },
  selectionReason: { type: String, required: true, trim: true, maxlength: 800 },
  candidate: { type: candidateSchema, required: true },
  parentCandidateId: { type: String, default: null, trim: true, maxlength: 100 },
  bundleId: { type: String, required: true, trim: true, maxlength: 240 },
  bundleRole: { type: String, required: true, enum: ["COMPANION_STORY", "STANDALONE_STORY"], uppercase: true, trim: true },
  visual_mode_resolution: { type: visualModeResolutionSchema, required: true },
  status: { type: String, required: true, enum: SELECTED_POST_STATUSES, default: "PLANNED", uppercase: true, trim: true },
  generation_run_id: { type: mongoose.Schema.Types.ObjectId, ref: "SocialGenerationRun", default: null },
  draft_id: { type: mongoose.Schema.Types.ObjectId, ref: "SocialPostDraft", default: null },
  parent_draft_id: { type: mongoose.Schema.Types.ObjectId, ref: "SocialPostDraft", default: null },
  publication_id: { type: mongoose.Schema.Types.ObjectId, ref: "SocialPublication", default: null },
}, { _id: false, strict: "throw" });

const planRationaleSchema = new mongoose.Schema({
  format_balance: { type: String, required: true, trim: true, maxlength: 700 },
  objective_balance: { type: String, required: true, trim: true, maxlength: 700 },
  promotional_balance: { type: String, required: true, trim: true, maxlength: 700 },
  evidence_limitations: { type: [{ type: String, trim: true, maxlength: 500 }], default: [] },
  final_recommendation: { type: String, required: true, trim: true, maxlength: 1200 },
}, { _id: false, strict: "throw" });

const generationErrorSchema = new mongoose.Schema({
  stage: { type: String, default: null, trim: true, maxlength: 100 },
  code: { type: String, default: null, trim: true, maxlength: 160 },
  message: { type: String, required: true, trim: true, maxlength: 4000 },
  is_retriable: { type: Boolean, default: false },
  occurred_at: { type: Date, required: true, default: Date.now },
  validation_errors: { type: [{ type: String, trim: true, maxlength: 1000 }], default: [] },
}, { _id: false, strict: "throw" });

const SocialWeeklyPlanSchema = new mongoose.Schema({
  week_key: { type: String, required: true, immutable: true, trim: true, maxlength: 100, match: /^[A-Za-z0-9][A-Za-z0-9:_-]{2,99}$/ },
  week_start: { type: String, required: true, immutable: true, trim: true, match: DATE_KEY_PATTERN, index: true },
  week_end: { type: String, required: true, immutable: true, trim: true, match: DATE_KEY_PATTERN },
  timezone: { type: String, required: true, immutable: true, enum: ["Asia/Kolkata"], default: "Asia/Kolkata" },
  status: { type: String, required: true, enum: PLAN_STATUSES, default: "QUEUED", uppercase: true, trim: true, index: true },
  maximum_feed_posts: { type: Number, required: true, default: 5, min: 1, max: 7 },
  config_snapshot: { type: mongoose.Schema.Types.Mixed, default: null, validate: { validator: nullableAggregateOnly, message: "config_snapshot must not contain personal data" } },
  candidates: { type: [candidateSchema], default: [] },
  selected_posts: { type: [selectedPostSchema], default: [] },
  story_plan: { type: [storyPlanItemSchema], default: [] },
  research_digest: { type: mongoose.Schema.Types.Mixed, default: null, validate: { validator: nullableAggregateOnly, message: "research_digest must contain aggregate, non-personal data only" } },
  audience_intelligence: { type: mongoose.Schema.Types.Mixed, default: null, validate: { validator: nullableAggregateOnly, message: "audience_intelligence must contain aggregate, non-personal data only" } },
  plan_rationale: { type: planRationaleSchema, default: null },
  supervisor_recommendation: { type: mongoose.Schema.Types.Mixed, default: null, validate: { validator: nullableAggregateOnly, message: "supervisor_recommendation must contain aggregate, non-personal data only" } },
  prompt_runs: { type: [promptRunSchema], default: [] },
  prompt_version_ids: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "SocialPromptVersion" }], default: [] },
  input_context_checksum: { type: String, default: null, lowercase: true, trim: true, match: CHECKSUM_PATTERN },
  output_checksum: { type: String, default: null, lowercase: true, trim: true, match: CHECKSUM_PATTERN },
  idempotency_key: { type: String, required: true, unique: true, immutable: true, trim: true, maxlength: 400 },
  generation_run_id: { type: mongoose.Schema.Types.ObjectId, ref: "SocialGenerationRun", default: null, index: true },
  research_source_ids: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "SocialResearchSource" }], default: [] },
  growth_snapshot_ids: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "SocialGrowthSnapshot" }], default: [] },
  growth_analysis: { type: mongoose.Schema.Types.Mixed, default: null, validate: { validator: nullableAggregateOnly, message: "growth_analysis must contain aggregate, non-personal data only" } },
  learning_summary: { type: mongoose.Schema.Types.Mixed, default: null, validate: { validator: nullableAggregateOnly, message: "learning_summary must contain aggregate, non-personal data only" } },
  generation_started_at: { type: Date, default: null },
  generation_completed_at: { type: Date, default: null },
  generation_error: { type: generationErrorSchema, default: null },
  requested_by_admin_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
  requested_at: { type: Date, default: Date.now, index: true },
  approved_by_admin_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
  approved_at: { type: Date, default: null },
  rejected_by_admin_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  rejected_at: { type: Date, default: null },
  rejection_reason: { type: String, default: null, trim: true, maxlength: 2000 },
  version: { type: Number, required: true, default: 1, min: 1 },
}, {
  timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  optimisticConcurrency: true,
  strict: "throw",
});

SocialWeeklyPlanSchema.pre("validate", function validateWeeklyPlan() {
  const start = DATE_KEY_PATTERN.test(this.week_start || "") ? Date.parse(`${this.week_start}T00:00:00.000Z`) : Number.NaN;
  const end = DATE_KEY_PATTERN.test(this.week_end || "") ? Date.parse(`${this.week_end}T00:00:00.000Z`) : Number.NaN;
  if (Number.isFinite(start) && Number.isFinite(end) && end - start !== 6 * 24 * 60 * 60 * 1000) this.invalidate("week_end", "week_end must be the sixth calendar day after week_start");

  const candidates = Array.isArray(this.candidates) ? this.candidates : [];
  const candidateIds = candidates.map((candidate) => String(candidate.candidateId || "").trim()).filter(Boolean);
  if (candidates.length > 30 || (candidates.length > 0 && candidates.length < 8)) this.invalidate("candidates", "A generated weekly candidate set requires between 8 and 30 candidates");
  if (new Set(candidateIds).size !== candidateIds.length) this.invalidate("candidates", "candidateId values must be unique within a weekly plan");

  const selected = Array.isArray(this.selected_posts) ? this.selected_posts : [];
  if (selected.length > Number(this.maximum_feed_posts || 5)) this.invalidate("selected_posts", "selected_posts cannot exceed maximum_feed_posts");
  const selectedCandidateIds = selected.map((item) => String(item.candidateId || "").trim());
  if (new Set(selectedCandidateIds).size !== selectedCandidateIds.length) this.invalidate("selected_posts", "A candidate can only be selected once per weekly plan");
  const slotNumbers = selected.map((item) => Number(item.slotNumber));
  if (new Set(slotNumbers).size !== slotNumbers.length) this.invalidate("selected_posts", "slotNumber values must be unique within a weekly plan");
  if (selectedCandidateIds.some((candidateId) => !candidateIds.includes(candidateId))) this.invalidate("selected_posts", "Every selected post must reference a candidate in candidates");
  if (this.week_start && this.week_end && selected.some((item) => {
    const localDate = dateKeyInKolkata(item.scheduledFor);
    return !localDate || localDate < this.week_start || localDate > this.week_end;
  })) this.invalidate("selected_posts", "Every selected post must be scheduled inside the plan week in Asia/Kolkata");

  const stories = Array.isArray(this.story_plan) ? this.story_plan : [];
  if (stories.length > 7) this.invalidate("story_plan", "story_plan cannot contain more than seven Stories");
  const storyCandidateIds = stories.map((item) => String(item.candidateId || "").trim());
  if (new Set(storyCandidateIds).size !== storyCandidateIds.length) this.invalidate("story_plan", "Story candidateId values must be unique within a weekly plan");
  const storySlots = stories.map((item) => Number(item.slotNumber));
  if (new Set(storySlots).size !== storySlots.length) this.invalidate("story_plan", "Story slotNumber values must be unique within a weekly plan");
  if (stories.some((item) => String(item.candidate?.format || "").toUpperCase() !== "STORY")) this.invalidate("story_plan", "Every story_plan candidate must use the STORY format");
  if (stories.some((item) => item.bundleRole === "COMPANION_STORY"
    && !selectedCandidateIds.includes(String(item.parentCandidateId || "")))) {
    this.invalidate("story_plan", "Every companion Story must reference a selected feed candidate");
  }
  const standaloneSourceIds = stories
    .filter((item) => item.bundleRole === "STANDALONE_STORY")
    .map((item) => String(item.sourceCandidateId || "").trim())
    .filter(Boolean);
  if (new Set(standaloneSourceIds).size !== standaloneSourceIds.length) {
    this.invalidate("story_plan", "Standalone Stories must use distinct retained source candidates");
  }
  if (standaloneSourceIds.some((candidateId) => selectedCandidateIds.includes(candidateId))) {
    this.invalidate("story_plan", "Standalone Stories cannot reuse a selected feed candidate as their retained source");
  }
  if (this.week_start && this.week_end && stories.some((item) => {
    const localDate = dateKeyInKolkata(item.scheduledFor);
    return !localDate || localDate < this.week_start || localDate > this.week_end;
  })) this.invalidate("story_plan", "Every Story must be scheduled inside the plan week in Asia/Kolkata");

  if (REVIEWABLE_STATUSES.has(this.status)) {
    if (candidates.length < 8) this.invalidate("candidates", "A reviewable weekly plan requires at least 8 candidates");
    if (Number(this.maximum_feed_posts || 5) >= 5
      && candidates.filter((item) => String(item.format || "").toUpperCase() !== "STORY").length < 7) {
      this.invalidate("candidates", "A five-feed weekly plan requires at least seven feed-capable candidates; Story ideas do not satisfy this requirement");
    }
    if (Number(this.maximum_feed_posts || 5) === 5 && selected.length !== 5) {
      this.invalidate("selected_posts", "A reviewable five-feed plan requires exactly five selected feed posts");
    }
    if (Number(this.maximum_feed_posts || 5) === 5 && stories.length !== 7) {
      this.invalidate("story_plan", "A reviewable five-feed plan requires five companion Stories and two standalone Stories");
    }
    if (selected.length < 1) this.invalidate("selected_posts", "A reviewable weekly plan requires at least one selected post");
    if (!this.research_digest) this.invalidate("research_digest", "A reviewable weekly plan requires a research digest");
    if (!this.audience_intelligence) this.invalidate("audience_intelligence", "A reviewable weekly plan requires audience intelligence");
    if (!this.supervisor_recommendation) this.invalidate("supervisor_recommendation", "A reviewable weekly plan requires supervisor review");
    if (!this.plan_rationale) this.invalidate("plan_rationale", "A reviewable weekly plan requires plan rationale");
    if (!this.input_context_checksum) this.invalidate("input_context_checksum", "A reviewable weekly plan requires an input context checksum");
  }
  if ((this.approved_at || this.approved_by_admin_id) && (!this.approved_at || !this.approved_by_admin_id)) this.invalidate("approved_at", "Approval requires both approved_at and approved_by_admin_id");
  if ((this.rejected_at || this.rejected_by_admin_id || this.rejection_reason) && (!this.rejected_at || !this.rejected_by_admin_id || !String(this.rejection_reason || "").trim())) this.invalidate("rejected_at", "Rejection requires actor, time, and reason");
  if ((this.approved_at || this.approved_by_admin_id) && (this.rejected_at || this.rejected_by_admin_id)) this.invalidate("status", "A weekly plan cannot be both approved and rejected");
  if (["APPROVED", "SCHEDULED", "ACTIVE", "COMPLETED"].includes(this.status) && (!this.approved_at || !this.approved_by_admin_id)) this.invalidate("status", `${this.status} requires recorded human approval`);
  if (this.status === "REJECTED" && (!this.rejected_at || !this.rejected_by_admin_id || !this.rejection_reason)) this.invalidate("status", "REJECTED requires recorded human rejection");
  if (this.generation_completed_at && this.generation_started_at && this.generation_completed_at < this.generation_started_at) this.invalidate("generation_completed_at", "generation_completed_at cannot precede generation_started_at");
  if (["FAILED_RESEARCH", "FAILED_GENERATION", "FAILED_COMPLIANCE"].includes(this.status) && !this.generation_error) this.invalidate("generation_error", `${this.status} requires a visible generation_error`);
});

SocialWeeklyPlanSchema.index({ week_key: 1, version: 1 }, { unique: true });
SocialWeeklyPlanSchema.index({ week_start: -1, status: 1, version: -1 });
SocialWeeklyPlanSchema.index({ "selected_posts.scheduledFor": 1, status: 1 });
SocialWeeklyPlanSchema.index({ "selected_posts.generation_run_id": 1 });
SocialWeeklyPlanSchema.index({ "selected_posts.draft_id": 1 });
SocialWeeklyPlanSchema.index({ "selected_posts.publication_id": 1 });
SocialWeeklyPlanSchema.index({ "story_plan.scheduledFor": 1, status: 1 });
SocialWeeklyPlanSchema.index({ "story_plan.generation_run_id": 1 });
SocialWeeklyPlanSchema.index({ "story_plan.draft_id": 1 });
SocialWeeklyPlanSchema.index({ research_source_ids: 1 });

SocialWeeklyPlanSchema.statics.PLAN_STATUSES = PLAN_STATUSES;
SocialWeeklyPlanSchema.statics.SOCIAL_FORMATS = SOCIAL_FORMATS;
SocialWeeklyPlanSchema.statics.SELECTED_POST_STATUSES = SELECTED_POST_STATUSES;
SocialWeeklyPlanSchema.statics.BUNDLE_ROLES = BUNDLE_ROLES;

module.exports = mongoose.model("SocialWeeklyPlan", SocialWeeklyPlanSchema);
