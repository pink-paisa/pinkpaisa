const crypto = require("crypto");
const mongoose = require("mongoose");

const PROMPT_STAGES = [
  "MARKET_RESEARCH",
  "DAILY_MARKET_ANALYSIS",
  "CANDIDATE_GENERATION",
  "STRATEGY_SCORING",
  "CONTENT_WRITING",
  "COMPLIANCE_REVIEW",
  "CONTENT_REVISION",
  "FORMAT_REWRITE",
  "VISUAL_DIRECTION",
  "VISUAL_BRIEF",
  "IMAGE_PROMPT_REVISION",
  "IMAGE_GENERATION",
  "FINAL_ASSEMBLY",
  "WEEKLY_SUPERVISION",
  "WEEKLY_RESEARCH_DIGEST",
  "AUDIENCE_INTELLIGENCE",
  "WEEKLY_CANDIDATE_GENERATION",
  "WEEKLY_CONTENT_PLANNING",
  "GROWTH_ANALYSIS",
  "COMMUNITY_CLASSIFICATION",
  "COMMUNITY_REPLY_RECOMMENDATION",
];

function buildPromptHash(value = {}) {
  const payload = JSON.stringify({
    stage: String(value.stage || "").trim(),
    semantic_version: String(value.semantic_version || "").trim(),
    runtime_prompt_version: String(value.runtime_prompt_version || "").trim(),
    system_prompt_template: String(value.system_prompt_template || ""),
    user_prompt_template: String(value.user_prompt_template || ""),
    output_schema_name: String(value.output_schema_name || "").trim(),
    output_schema_version: String(value.output_schema_version || "").trim(),
  });
  return crypto.createHash("sha256").update(payload).digest("hex");
}

const SocialPromptVersionSchema = new mongoose.Schema(
  {
    stage: { type: String, required: true, enum: PROMPT_STAGES, immutable: true, index: true, uppercase: true, trim: true },
    semantic_version: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      match: /^\d+\.\d+\.\d+$/,
    },
    runtime_prompt_version: {
      type: String,
      default: null,
      immutable: true,
      trim: true,
      maxlength: 120,
    },
    version_key: { type: String, required: true, immutable: true, unique: true, trim: true },
    display_name: { type: String, required: true, immutable: true, trim: true, maxlength: 200 },
    description: { type: String, default: null, immutable: true, trim: true, maxlength: 1000 },
    system_prompt_template: { type: String, required: true, immutable: true, maxlength: 30000 },
    user_prompt_template: { type: String, required: true, immutable: true, maxlength: 30000 },
    prompt_hash: {
      type: String,
      required: true,
      immutable: true,
      lowercase: true,
      trim: true,
      match: /^[a-f0-9]{64}$/,
      index: true,
    },
    output_schema_name: { type: String, required: true, immutable: true, trim: true, maxlength: 200 },
    output_schema_version: { type: String, required: true, immutable: true, trim: true, maxlength: 80 },
    output_schema_hash: {
      type: String,
      default: null,
      immutable: true,
      lowercase: true,
      trim: true,
      match: /^[a-f0-9]{64}$/,
    },
    input_contract: { type: mongoose.Schema.Types.Mixed, default: null, immutable: true },
    model_config: { type: mongoose.Schema.Types.Mixed, default: null, immutable: true },
    safety_metadata: { type: mongoose.Schema.Types.Mixed, default: null, immutable: true },
    change_summary: { type: String, default: null, immutable: true, trim: true, maxlength: 2000 },
    is_active: { type: Boolean, required: true, default: false, index: true },
    activated_at: { type: Date, default: null },
    deactivated_at: { type: Date, default: null },
    created_by_admin_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      immutable: true,
    },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

SocialPromptVersionSchema.pre("validate", function populateVersionIdentity() {
  if (this.stage && this.semantic_version && !this.version_key) {
    this.version_key = `${this.stage}:${this.semantic_version}`;
  }
  if (!this.prompt_hash) this.prompt_hash = buildPromptHash(this);
  if (this.is_active && !this.activated_at) this.activated_at = new Date();
});

SocialPromptVersionSchema.index({ stage: 1, semantic_version: 1 }, { unique: true });
SocialPromptVersionSchema.index(
  { stage: 1, runtime_prompt_version: 1 },
  { unique: true, partialFilterExpression: { runtime_prompt_version: { $type: "string" } } }
);
SocialPromptVersionSchema.index({ stage: 1, prompt_hash: 1 }, { unique: true });
SocialPromptVersionSchema.index(
  { stage: 1, is_active: 1 },
  { unique: true, partialFilterExpression: { is_active: true } }
);

SocialPromptVersionSchema.statics.PROMPT_STAGES = PROMPT_STAGES;
SocialPromptVersionSchema.statics.buildPromptHash = buildPromptHash;

module.exports = mongoose.model("SocialPromptVersion", SocialPromptVersionSchema);
