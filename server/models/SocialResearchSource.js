const crypto = require("crypto");
const mongoose = require("mongoose");

const SOURCE_TYPES = [
  "INTERNAL_DATABASE",
  "INTERNAL_WEBSITE",
  "GOVERNMENT",
  "REGULATOR",
  "PRIMARY_SOURCE",
  "RESEARCH_PAPER",
  "NEWS",
  "TRUSTED_RSS",
  "WEB_SEARCH",
  "INDUSTRY",
  "SOCIAL_TREND",
  "MANUAL",
  "EVERGREEN",
];

const SOURCE_TYPE_ALIASES = Object.freeze({
  internal_database: "INTERNAL_DATABASE",
  internal_website: "INTERNAL_WEBSITE",
  government: "GOVERNMENT",
  regulator: "REGULATOR",
  primary: "PRIMARY_SOURCE",
  primary_source: "PRIMARY_SOURCE",
  research: "RESEARCH_PAPER",
  research_paper: "RESEARCH_PAPER",
  news: "NEWS",
  trusted_rss: "TRUSTED_RSS",
  web_search: "WEB_SEARCH",
  industry: "INDUSTRY",
  social_trend: "SOCIAL_TREND",
  manual: "MANUAL",
  evergreen: "EVERGREEN",
});

function canonicalUrl(value) {
  try {
    const parsed = new URL(String(value || "").trim());
    parsed.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "gclid", "fbclid"]
      .forEach((key) => parsed.searchParams.delete(key));
    parsed.searchParams.sort();
    parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return parsed.toString();
  } catch {
    return "";
  }
}

function mapSourceType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return SOURCE_TYPE_ALIASES[normalized] || (SOURCE_TYPES.includes(String(value || "")) ? value : "NEWS");
}

function mapValidationStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["valid", "verified", "verified_tool_source", "trusted_rss"].includes(normalized)) return "VALID";
  if (["unconfirmed", "unknown"].includes(normalized)) return "UNCONFIRMED";
  if (["rejected", "invalid", "unsafe"].includes(normalized)) return "REJECTED";
  return "PENDING";
}

function freshnessFromHours(value, sourceType) {
  if (sourceType === "EVERGREEN") return "EVERGREEN";
  if (value === null || value === undefined || value === "") return "UNKNOWN";
  const hours = Number(value);
  if (!Number.isFinite(hours) || hours < 0) return "UNKNOWN";
  if (hours <= 24) return "CURRENT";
  if (hours <= 168) return "RECENT";
  return "STALE";
}

function buildPersistenceRecord(source = {}, context = {}) {
  const generationRunId = context.generation_run_id || source.generation_run_id;
  const weeklyPlanId = context.weekly_plan_id || source.weekly_plan_id;
  const normalizedUrl = canonicalUrl(source.normalized_url || source.url);
  const sourceType = mapSourceType(source.source_type);
  const validationStatus = mapValidationStatus(source.validation_status);
  const sourceKey = String(source.source_key || "").trim() || null;
  const claim = String(source.claim_supported || source.summary || source.excerpt || "").trim();
  const ownerKey = generationRunId ? `generation:${generationRunId}` : `weekly-plan:${weeklyPlanId || "unassigned"}`;
  const hashInput = `${ownerKey}|${sourceKey || normalizedUrl}|${claim}`;
  const idempotencyKey = String(source.idempotency_key || "").trim()
    || `social-source:${crypto.createHash("sha256").update(hashInput).digest("hex")}`;
  const injectionFlags = Array.isArray(source.prompt_injection_flags) ? source.prompt_injection_flags : [];
  const freshnessHours = source.freshness_hours === null
    || source.freshness_hours === undefined
    || source.freshness_hours === ""
    ? null
    : Number.isFinite(Number(source.freshness_hours))
      ? Number(source.freshness_hours)
      : null;

  return {
    ...source,
    generation_run_id: generationRunId || null,
    weekly_plan_id: weeklyPlanId || null,
    draft_id: context.draft_id || source.draft_id || null,
    source_key: sourceKey,
    idempotency_key: idempotencyKey,
    normalized_url: normalizedUrl,
    domain: String(source.domain || "").trim().toLowerCase()
      || (() => {
        try {
          return new URL(normalizedUrl).hostname.toLowerCase().replace(/^www\./, "");
        } catch {
          return "";
        }
      })(),
    summary: String(source.summary || source.excerpt || claim).trim(),
    claim_supported: claim,
    source_type: sourceType,
    validation_status: validationStatus,
    freshness_hours: freshnessHours,
    freshness: source.freshness || freshnessFromHours(freshnessHours, sourceType),
    freshness_days: source.freshness_days ?? (freshnessHours == null ? null : freshnessHours / 24),
    is_safe_to_use: source.is_safe_to_use ?? (validationStatus === "VALID" && injectionFlags.length === 0),
    prompt_injection_suspected: source.prompt_injection_suspected ?? injectionFlags.length > 0,
    used_in_final: source.used_in_final ?? Boolean(source.influenced_decision),
  };
}

const SocialResearchSourceSchema = new mongoose.Schema(
  {
    generation_run_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SocialGenerationRun",
      default: null,
      index: true,
      immutable: true,
    },
    weekly_plan_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SocialWeeklyPlan",
      default: null,
      index: true,
      immutable: true,
    },
    draft_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SocialPostDraft",
      default: null,
      index: true,
    },
    source_key: { type: String, default: null, trim: true, index: true },
    idempotency_key: { type: String, required: true, unique: true, trim: true },
    candidate_ids: { type: [String], default: [] },
    recommendation_paths: { type: [String], default: [] },
    title: { type: String, required: true, trim: true, maxlength: 500 },
    url: { type: String, required: true, trim: true, maxlength: 4096 },
    normalized_url: { type: String, required: true, trim: true, maxlength: 4096 },
    domain: { type: String, required: true, lowercase: true, trim: true, maxlength: 255, index: true },
    publisher: { type: String, default: null, trim: true, maxlength: 300 },
    published_at: { type: Date, default: null, index: true },
    accessed_at: { type: Date, required: true, default: Date.now, index: true },
    excerpt: { type: String, default: null, trim: true, maxlength: 1500 },
    summary: { type: String, required: true, trim: true, maxlength: 3000 },
    claim_supported: { type: String, required: true, trim: true, maxlength: 1500 },
    relevance_to_pink_paisa: { type: String, default: null, trim: true, maxlength: 1500 },
    confidence: { type: Number, required: true, min: 0, max: 1 },
    evidence_class: {
      type: String,
      enum: ["VERIFIED_TIMELY", "INTERNAL_PERFORMANCE", "EVERGREEN_OPPORTUNITY", "WEAK_UNCONFIRMED", null],
      default: null,
      index: true,
    },
    freshness: {
      type: String,
      required: true,
      enum: ["CURRENT", "RECENT", "STALE", "EVERGREEN", "UNKNOWN"],
      default: "UNKNOWN",
      index: true,
    },
    freshness_days: { type: Number, default: null, min: 0 },
    freshness_hours: { type: Number, default: null, min: 0 },
    source_type: { type: String, required: true, enum: SOURCE_TYPES, index: true },
    provider: { type: String, default: null, trim: true },
    provider_model: { type: String, default: null, trim: true },
    validation_status: {
      type: String,
      required: true,
      enum: ["PENDING", "VALID", "UNCONFIRMED", "REJECTED"],
      default: "PENDING",
      index: true,
    },
    validation_reasons: { type: [String], default: [] },
    is_current_claim: { type: Boolean, default: false, index: true },
    is_safe_to_use: { type: Boolean, default: false, index: true },
    used_in_final: { type: Boolean, default: false, index: true },
    influenced_decision: { type: Boolean, default: false },
    prompt_injection_suspected: { type: Boolean, default: false, index: true },
    prompt_injection_flags: { type: [String], default: [] },
    content_hash: { type: String, default: null, trim: true, index: true },
    retrieval_metadata: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

SocialResearchSourceSchema.pre("validate", function normalizeProviderSource() {
  const source = this.toObject({ depopulate: true });
  if (!this.isModified("freshness")) delete source.freshness;
  if (!this.isModified("is_safe_to_use")) delete source.is_safe_to_use;
  if (!this.isModified("prompt_injection_suspected")) delete source.prompt_injection_suspected;
  if (!this.isModified("used_in_final")) delete source.used_in_final;
  const normalized = buildPersistenceRecord(source, {
    generation_run_id: this.generation_run_id,
    weekly_plan_id: this.weekly_plan_id,
    draft_id: this.draft_id,
  });
  if (Boolean(this.generation_run_id) === Boolean(this.weekly_plan_id)) {
    this.invalidate(
      "generation_run_id",
      "Exactly one research owner is required: generation_run_id or weekly_plan_id"
    );
  }
  for (const key of [
    "source_key",
    "idempotency_key",
    "normalized_url",
    "domain",
    "summary",
    "claim_supported",
    "source_type",
    "validation_status",
    "freshness_hours",
    "freshness",
    "freshness_days",
    "is_safe_to_use",
    "prompt_injection_suspected",
    "used_in_final",
  ]) {
    this[key] = normalized[key];
  }
  this.influenced_decision = normalized.used_in_final;
});

SocialResearchSourceSchema.index({ generation_run_id: 1, accessed_at: -1 });
SocialResearchSourceSchema.index({ weekly_plan_id: 1, accessed_at: -1 });
SocialResearchSourceSchema.index({ weekly_plan_id: 1, validation_status: 1, is_safe_to_use: 1 });
SocialResearchSourceSchema.index({ draft_id: 1, used_in_final: 1 });
SocialResearchSourceSchema.index({ validation_status: 1, is_safe_to_use: 1, freshness: 1 });
SocialResearchSourceSchema.index({ domain: 1, published_at: -1 });

SocialResearchSourceSchema.statics.SOURCE_TYPES = SOURCE_TYPES;
SocialResearchSourceSchema.statics.buildPersistenceRecord = buildPersistenceRecord;

module.exports = mongoose.model("SocialResearchSource", SocialResearchSourceSchema);
