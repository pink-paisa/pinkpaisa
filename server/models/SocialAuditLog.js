const crypto = require("crypto");
const mongoose = require("mongoose");

const ACTOR_TYPES = ["SYSTEM", "ADMIN", "WORKER", "PROVIDER"];
const ENTITY_TYPES = [
  "GENERATION_RUN",
  "DRAFT",
  "RESEARCH_SOURCE",
  "ASSET",
  "PUBLICATION",
  "METRIC_SNAPSHOT",
  "WEEKLY_PLAN",
  "CONNECTION_HEALTH",
  "GROWTH_SNAPSHOT",
  "COMMUNITY_ITEM",
  "MANUAL_ACTION",
  "SETTINGS",
  "CONTENT_CLEANUP",
];

const fieldChangeSchema = new mongoose.Schema(
  {
    field_path: { type: String, required: true, trim: true, maxlength: 300 },
    before: { type: mongoose.Schema.Types.Mixed, default: null },
    after: { type: mongoose.Schema.Types.Mixed, default: null },
    is_redacted: { type: Boolean, default: false },
  },
  { _id: false }
);

const SocialAuditLogSchema = new mongoose.Schema(
  {
    event_id: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      default: () => crypto.randomUUID(),
      trim: true,
    },
    idempotency_key: {
      type: String,
      default: undefined,
      immutable: true,
      unique: true,
      sparse: true,
      trim: true,
      maxlength: 400,
      set: (value) => String(value || "").trim() || undefined,
    },
    entity_type: { type: String, required: true, immutable: true, enum: ENTITY_TYPES, index: true, uppercase: true, trim: true },
    entity_id: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true, index: true },
    generation_run_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SocialGenerationRun",
      default: null,
      immutable: true,
      index: true,
    },
    draft_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SocialPostDraft",
      default: null,
      immutable: true,
      index: true,
    },
    publication_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SocialPublication",
      default: null,
      immutable: true,
      index: true,
    },
    action: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      uppercase: true,
      match: /^[A-Z][A-Z0-9_]{1,79}$/,
      index: true,
    },
    action_status: {
      type: String,
      required: true,
      immutable: true,
      enum: ["STARTED", "SUCCEEDED", "FAILED", "SKIPPED"],
      default: "SUCCEEDED",
      index: true,
      uppercase: true,
      trim: true,
    },
    actor_type: { type: String, required: true, immutable: true, enum: ACTOR_TYPES, index: true, uppercase: true, trim: true },
    actor_admin_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      immutable: true,
      index: true,
    },
    actor_label: { type: String, default: null, immutable: true, trim: true, maxlength: 200 },
    summary: { type: String, required: true, immutable: true, trim: true, maxlength: 2000 },
    field_changes: { type: [fieldChangeSchema], default: [], immutable: true },
    request_id: { type: String, default: null, immutable: true, trim: true, index: true },
    source_ip_hash: { type: String, default: null, immutable: true, trim: true },
    prompt_version_ids: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "SocialPromptVersion" }],
      default: [],
      immutable: true,
    },
    source_ids: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "SocialResearchSource" }],
      default: [],
      immutable: true,
    },
    provider_models: {
      type: [
        new mongoose.Schema(
          {
            provider: { type: String, required: true, trim: true },
            model: { type: String, required: true, trim: true },
            stage: { type: String, default: null, trim: true },
          },
          { _id: false }
        ),
      ],
      default: [],
      immutable: true,
    },
    retry_count: { type: Number, default: 0, min: 0, immutable: true },
    error_code: { type: String, default: null, immutable: true, trim: true },
    error_message: { type: String, default: null, immutable: true, trim: true, maxlength: 4000 },
    metadata: { type: mongoose.Schema.Types.Mixed, default: null, immutable: true },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

SocialAuditLogSchema.index({ draft_id: 1, created_at: -1 });
SocialAuditLogSchema.index({ generation_run_id: 1, created_at: -1 });
SocialAuditLogSchema.index({ publication_id: 1, created_at: -1 });
SocialAuditLogSchema.index({ action: 1, action_status: 1, created_at: -1 });
SocialAuditLogSchema.index({ actor_admin_id: 1, created_at: -1 });

function rejectAuditMutation(next) {
  const error = new Error("SocialAuditLog records are append-only");
  error.code = "social_audit_log_immutable";
  next(error);
}

SocialAuditLogSchema.pre("save", function rejectAuditResave(next) {
  if (this.isNew) return next();
  return rejectAuditMutation(next);
});

SocialAuditLogSchema.pre("deleteOne", { document: true, query: false }, rejectAuditMutation);

SocialAuditLogSchema.pre(
  ["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "deleteOne", "deleteMany", "findOneAndDelete"],
  rejectAuditMutation
);

SocialAuditLogSchema.statics.ACTOR_TYPES = ACTOR_TYPES;
SocialAuditLogSchema.statics.ENTITY_TYPES = ENTITY_TYPES;

module.exports = mongoose.model("SocialAuditLog", SocialAuditLogSchema);
