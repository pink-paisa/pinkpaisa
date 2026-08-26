const mongoose = require("mongoose");

const SNAPSHOT_PROVIDERS = Object.freeze([
  "INSTAGRAM", "INSTAGRAM_GRAPH", "META", "GA4", "SEARCH_CONSOLE", "ATTRIBUTION_JOIN", "INTERNAL",
]);
const ENTITY_TYPES = Object.freeze([
  "INSTAGRAM_ACCOUNT", "WEBSITE", "ACCOUNT", "SITE", "WEEKLY_PLAN", "DRAFT", "PUBLICATION",
  "CAMPAIGN", "LANDING_PAGE", "SEARCH_QUERY",
]);
const RETRIEVAL_STATUSES = Object.freeze(["COMPLETE", "PARTIAL", "UNAVAILABLE", "ERROR"]);
const CHECKSUM_PATTERN = /^[a-f0-9]{64}$/;
const FORBIDDEN_AGGREGATE_KEYS = /^(?:email|email_address|phone|phone_number|ip|ip_address|cookie|authorization|access_token|refresh_token|password|private_key|client_secret|app_secret|full_name|customer_id|user_id|client_id|author_external_id)$/i;

function containsForbiddenKey(value, depth = 0) {
  if (depth > 12 || value == null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => containsForbiddenKey(item, depth + 1));
  return Object.entries(value).some(([key, child]) => FORBIDDEN_AGGREGATE_KEYS.test(key) || containsForbiddenKey(child, depth + 1));
}
function aggregateObject(value) {
  return value != null && typeof value === "object" && !containsForbiddenKey(value);
}
function nullableAggregateObject(value) {
  return value == null || aggregateObject(value);
}

const baselineComparisonSchema = new mongoose.Schema({
  metric: { type: String, required: true, trim: true, maxlength: 160 },
  baseline: { type: String, required: true, trim: true, maxlength: 160 },
  observed_value: { type: Number, required: true },
  baseline_value: { type: Number, required: true },
  delta: { type: Number, required: true },
  ratio: { type: Number, default: null },
  sample_size: { type: Number, required: true, min: 0 },
}, { _id: false, strict: "throw" });

const SocialGrowthSnapshotSchema = new mongoose.Schema({
  snapshot_key: { type: String, required: true, unique: true, immutable: true, trim: true, maxlength: 400 },
  provider: { type: String, required: true, enum: SNAPSHOT_PROVIDERS, immutable: true, uppercase: true, trim: true, index: true },
  entity_type: { type: String, required: true, enum: ENTITY_TYPES, immutable: true, uppercase: true, trim: true, index: true },
  entity_id: { type: mongoose.Schema.Types.ObjectId, default: null, immutable: true, index: true },
  entity_external_id: { type: String, default: null, immutable: true, trim: true, maxlength: 300, index: true },
  weekly_plan_id: { type: mongoose.Schema.Types.ObjectId, ref: "SocialWeeklyPlan", default: null, immutable: true, index: true },
  draft_id: { type: mongoose.Schema.Types.ObjectId, ref: "SocialPostDraft", default: null, immutable: true, index: true },
  publication_id: { type: mongoose.Schema.Types.ObjectId, ref: "SocialPublication", default: null, immutable: true, index: true },
  period_start: { type: Date, required: true, immutable: true, index: true },
  period_end: { type: Date, required: true, immutable: true, index: true },
  window: { type: String, required: true, immutable: true, trim: true, maxlength: 100, index: true },
  attribution_window: { type: String, default: null, immutable: true, trim: true, maxlength: 100 },
  captured_at: { type: Date, required: true, immutable: true, default: Date.now, index: true },
  retrieval_status: { type: String, required: true, enum: RETRIEVAL_STATUSES, default: "COMPLETE", immutable: true, uppercase: true, trim: true },
  query_definition: { type: mongoose.Schema.Types.Mixed, default: null, immutable: true, validate: { validator: nullableAggregateObject, message: "query_definition must not contain personal data or credentials" } },
  metrics: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true, validate: { validator: aggregateObject, message: "metrics must contain aggregate, non-personal data only" } },
  dimensions: { type: mongoose.Schema.Types.Mixed, default: () => [], immutable: true, validate: { validator: aggregateObject, message: "dimensions must contain aggregate, non-personal data only" } },
  baseline_comparisons: { type: [baselineComparisonSchema], default: [], immutable: true },
  provenance: { type: mongoose.Schema.Types.Mixed, default: null, immutable: true, validate: { validator: nullableAggregateObject, message: "provenance must not contain personal data or credentials" } },
  provenance_note: { type: String, required: true, immutable: true, trim: true, maxlength: 2000 },
  raw_response_hash: { type: String, default: null, immutable: true, lowercase: true, trim: true, match: CHECKSUM_PATTERN },
  normalized_payload_hash: { type: String, default: null, immutable: true, lowercase: true, trim: true, match: CHECKSUM_PATTERN },
}, {
  timestamps: { createdAt: "created_at", updatedAt: false },
  strict: "throw",
});

SocialGrowthSnapshotSchema.pre("validate", function validateGrowthSnapshot() {
  if (this.period_end && this.period_start && this.period_end <= this.period_start) this.invalidate("period_end", "period_end must be after period_start");
  if (!this.metrics || typeof this.metrics !== "object" || Object.keys(this.metrics).length === 0) this.invalidate("metrics", "A growth snapshot must contain at least one aggregate metric or availability marker");
  if (!["INTERNAL", "ATTRIBUTION_JOIN"].includes(this.provider) && !this.raw_response_hash) this.invalidate("raw_response_hash", "External provider snapshots require raw_response_hash provenance");
  if (this.entity_type === "WEEKLY_PLAN" && !this.weekly_plan_id && !this.entity_id) this.invalidate("weekly_plan_id", "WEEKLY_PLAN snapshots require a weekly plan identifier");
  if (this.entity_type === "DRAFT" && !this.draft_id && !this.entity_id) this.invalidate("draft_id", "DRAFT snapshots require a draft identifier");
  if (this.entity_type === "PUBLICATION" && !this.publication_id && !this.entity_id && !this.entity_external_id) this.invalidate("publication_id", "PUBLICATION snapshots require a publication identifier");
});

SocialGrowthSnapshotSchema.index({ provider: 1, captured_at: -1 });
SocialGrowthSnapshotSchema.index({ entity_type: 1, entity_id: 1, captured_at: -1 });
SocialGrowthSnapshotSchema.index({ weekly_plan_id: 1, captured_at: -1 });
SocialGrowthSnapshotSchema.index({ publication_id: 1, window: 1, captured_at: -1 });
SocialGrowthSnapshotSchema.index({ period_start: -1, period_end: -1 });

function appendOnlyError() {
  const error = new Error("SocialGrowthSnapshot records are append-only; create a new snapshot instead");
  error.code = "social_growth_snapshot_immutable";
  return error;
}
SocialGrowthSnapshotSchema.pre("save", function rejectSnapshotResave(next) {
  if (this.isNew) return next();
  return next(appendOnlyError());
});
SocialGrowthSnapshotSchema.pre("findOneAndUpdate", function allowIdempotentInsert(next) {
  const update = this.getUpdate() || {};
  const onlySetOnInsert = Object.keys(update).every((key) => key === "$setOnInsert");
  if (this.getOptions()?.upsert && onlySetOnInsert) return next();
  return next(appendOnlyError());
});
for (const operation of ["updateOne", "updateMany", "replaceOne", "deleteOne", "deleteMany", "findOneAndDelete"]) {
  SocialGrowthSnapshotSchema.pre(operation, function rejectSnapshotMutation(next) { next(appendOnlyError()); });
}

SocialGrowthSnapshotSchema.statics.SNAPSHOT_PROVIDERS = SNAPSHOT_PROVIDERS;
SocialGrowthSnapshotSchema.statics.ENTITY_TYPES = ENTITY_TYPES;
SocialGrowthSnapshotSchema.statics.RETRIEVAL_STATUSES = RETRIEVAL_STATUSES;

module.exports = mongoose.model("SocialGrowthSnapshot", SocialGrowthSnapshotSchema);
