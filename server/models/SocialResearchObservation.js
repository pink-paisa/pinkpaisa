const mongoose = require("mongoose");

const OBSERVATION_TYPES = Object.freeze([
  "HASHTAG_SEARCH", "BUSINESS_DISCOVERY", "TAGGED_MEDIA", "ACCOUNT_DISCOVERY",
  "WEB_RESEARCH", "TRUSTED_FEED", "INTERNAL_SIGNALS",
]);
const OBSERVATION_STATUSES = Object.freeze([
  "COMPLETE", "PARTIAL", "NOT_CONFIGURED", "UNAVAILABLE", "ERROR", "REJECTED",
]);
const OBSERVATION_PROVIDERS = Object.freeze([
  "META", "INSTAGRAM", "INSTAGRAM_GRAPH", "OPENAI_WEB_SEARCH", "TRUSTED_RSS", "INTERNAL",
]);
const DATE_RELEVANCE = Object.freeze(["CURRENT", "RECENT", "EVERGREEN", "STALE", "UNKNOWN"]);
const CHECKSUM_PATTERN = /^[a-f0-9]{64}$/;
const FORBIDDEN_KEYS = /^(?:caption|caption_text|copied_caption|creative|creative_copy|raw_text|raw_payload|media_bytes|authorization|access_token|refresh_token|password|private_key|client_secret|app_secret|cookie|email|phone|author_external_id)$/i;

function containsForbiddenKey(value, depth = 0) {
  if (depth > 10 || value == null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => containsForbiddenKey(item, depth + 1));
  return Object.entries(value).some(([key, child]) => FORBIDDEN_KEYS.test(key) || containsForbiddenKey(child, depth + 1));
}
function safeAggregate(value) {
  return value == null || (typeof value === "object" && !containsForbiddenKey(value));
}

const resultSchema = new mongoose.Schema({
  result_key: { type: String, required: true, trim: true, maxlength: 160 },
  result_type: { type: String, required: true, trim: true, uppercase: true, maxlength: 80 },
  topic: { type: String, required: true, trim: true, maxlength: 240 },
  observation_summary: { type: String, required: true, trim: true, maxlength: 300 },
  format: { type: String, default: null, trim: true, uppercase: true, maxlength: 80 },
  published_at: { type: Date, default: null },
  date_relevance: { type: String, required: true, enum: DATE_RELEVANCE, default: "UNKNOWN", uppercase: true, trim: true },
  account_type: { type: String, default: null, trim: true, uppercase: true, maxlength: 100 },
  source_url: { type: String, default: null, trim: true, maxlength: 2048 },
  aggregate_metrics: { type: Map, of: Number, default: () => new Map() },
}, { _id: false, strict: "throw" });

const topicClusterSchema = new mongoose.Schema({
  label: { type: String, required: true, trim: true, maxlength: 200 },
  concise_summary: { type: String, required: true, trim: true, maxlength: 400 },
  occurrence_count: { type: Number, required: true, min: 0 },
  confidence: { type: Number, required: true, min: 0, max: 1 },
  result_keys: { type: [{ type: String, trim: true, maxlength: 160 }], default: [] },
}, { _id: false, strict: "throw" });

const commonFormatSchema = new mongoose.Schema({
  format: { type: String, required: true, trim: true, uppercase: true, maxlength: 80 },
  occurrence_count: { type: Number, required: true, min: 0 },
  share: { type: Number, default: null, min: 0, max: 1 },
  concise_note: { type: String, default: null, trim: true, maxlength: 300 },
}, { _id: false, strict: "throw" });

const captionPatternSchema = new mongoose.Schema({
  pattern_key: { type: String, required: true, trim: true, maxlength: 120 },
  abstract_pattern: { type: String, required: true, trim: true, maxlength: 300 },
  occurrence_count: { type: Number, required: true, min: 0 },
  confidence: { type: Number, required: true, min: 0, max: 1 },
}, { _id: false, strict: "throw" });

const provenanceSchema = new mongoose.Schema({
  adapter: { type: String, required: true, trim: true, maxlength: 160 },
  adapter_version: { type: String, required: true, trim: true, maxlength: 80 },
  connection_fingerprint: { type: String, default: null, trim: true, match: /^[a-f0-9]{20}$/ },
  connection_health_id: { type: mongoose.Schema.Types.ObjectId, ref: "SocialConnectionHealth", default: null },
  source_ids: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "SocialResearchSource" }], default: [] },
  source_urls: { type: [{ type: String, trim: true, maxlength: 2048 }], default: [] },
  retrieved_at: { type: Date, required: true },
  provider_request_id: { type: String, default: null, trim: true, maxlength: 300 },
  evidence_limitations: { type: [{ type: String, trim: true, maxlength: 500 }], default: [] },
}, { _id: false, strict: "throw" });

const SocialResearchObservationSchema = new mongoose.Schema({
  idempotency_key: { type: String, required: true, unique: true, immutable: true, trim: true, maxlength: 400 },
  observation_key: { type: String, required: true, immutable: true, trim: true, maxlength: 240, index: true },
  provider: { type: String, required: true, enum: OBSERVATION_PROVIDERS, immutable: true, uppercase: true, trim: true, index: true },
  source: { type: String, required: true, immutable: true, trim: true, maxlength: 300 },
  query_key: { type: String, required: true, immutable: true, trim: true, maxlength: 300, index: true },
  observation_date: { type: String, required: true, immutable: true, match: /^\d{4}-\d{2}-\d{2}$/, index: true },
  observation_type: { type: String, required: true, enum: OBSERVATION_TYPES, immutable: true, uppercase: true, trim: true, index: true },
  status: { type: String, required: true, enum: OBSERVATION_STATUSES, immutable: true, uppercase: true, trim: true, index: true },
  results: { type: [resultSchema], default: [], immutable: true, validate: { validator: (value) => value.length <= 100, message: "results cannot exceed 100 concise observations" } },
  topic_clusters: { type: [topicClusterSchema], default: [], immutable: true },
  common_formats: { type: [commonFormatSchema], default: [], immutable: true },
  caption_patterns: { type: [captionPatternSchema], default: [], immutable: true },
  date_relevance: { type: String, required: true, enum: DATE_RELEVANCE, default: "UNKNOWN", immutable: true, uppercase: true, trim: true },
  relevant_from: { type: Date, default: null, immutable: true },
  relevant_until: { type: Date, default: null, immutable: true },
  account_type: { type: String, default: null, immutable: true, trim: true, uppercase: true, maxlength: 100 },
  aggregate_summary: { type: mongoose.Schema.Types.Mixed, default: null, immutable: true, validate: { validator: safeAggregate, message: "aggregate_summary must not contain copied creative, personal data, or credentials" } },
  provenance: { type: provenanceSchema, required: true, immutable: true },
  raw_response_hash: { type: String, required: true, immutable: true, lowercase: true, trim: true, match: CHECKSUM_PATTERN },
}, {
  timestamps: { createdAt: "created_at", updatedAt: false },
  strict: "throw",
});

SocialResearchObservationSchema.pre("validate", function validateObservation() {
  if (this.relevant_from && this.relevant_until && this.relevant_until < this.relevant_from) this.invalidate("relevant_until", "relevant_until cannot precede relevant_from");
  const resultKeys = (this.results || []).map((row) => row.result_key);
  if (new Set(resultKeys).size !== resultKeys.length) this.invalidate("results", "result_key values must be unique within an observation");
  const knownResultKeys = new Set(resultKeys);
  if ((this.topic_clusters || []).some((cluster) => (cluster.result_keys || []).some((key) => !knownResultKeys.has(key)))) this.invalidate("topic_clusters", "topic cluster result_keys must reference stored concise results");
  if (["COMPLETE", "PARTIAL"].includes(this.status) && (this.results || []).length === 0 && (this.topic_clusters || []).length === 0) this.invalidate("results", `${this.status} observations require at least one result or topic cluster`);
});

SocialResearchObservationSchema.index({ provider: 1, observation_type: 1, observation_date: -1 });
SocialResearchObservationSchema.index({ query_key: 1, observation_date: -1 });
SocialResearchObservationSchema.index({ status: 1, observation_date: -1 });

SocialResearchObservationSchema.statics.OBSERVATION_TYPES = OBSERVATION_TYPES;
SocialResearchObservationSchema.statics.OBSERVATION_STATUSES = OBSERVATION_STATUSES;
SocialResearchObservationSchema.statics.OBSERVATION_PROVIDERS = OBSERVATION_PROVIDERS;
SocialResearchObservationSchema.statics.DATE_RELEVANCE = DATE_RELEVANCE;

module.exports = mongoose.model("SocialResearchObservation", SocialResearchObservationSchema);
