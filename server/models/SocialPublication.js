const mongoose = require("mongoose");

const PUBLICATION_STATUSES = [
  "QUEUED",
  "VALIDATING",
  "CONTAINER_CREATED",
  "PUBLISHING",
  "PUBLISHED",
  "FAILED",
  "UNCERTAIN",
  "CANCELLED",
];

const publicationErrorSchema = new mongoose.Schema(
  {
    code: { type: String, default: null, trim: true },
    message: { type: String, default: null, trim: true, maxlength: 4000 },
    provider_code: { type: String, default: null, trim: true },
    is_retriable: { type: Boolean, default: false },
    occurred_at: { type: Date, default: null },
  },
  { _id: false }
);

const trackedUrlDeliverySchema = new mongoose.Schema({
  verified: { type: Boolean, required: true, default: false },
  method: {
    type: String,
    required: true,
    enum: ["STORY_LINK_STICKER", "DIRECT_MESSAGE", "PROVIDER_CONFIRMED_OTHER"],
    uppercase: true,
    trim: true,
  },
  target_url: { type: String, required: true, trim: true, maxlength: 2048 },
  provider_reference_id: { type: String, required: true, trim: true, maxlength: 500 },
  verified_at: { type: Date, required: true },
  evidence: { type: mongoose.Schema.Types.Mixed, default: null },
}, { _id: false, strict: "throw" });

const SocialPublicationSchema = new mongoose.Schema(
  {
    draft_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SocialPostDraft",
      required: true,
      unique: true,
      immutable: true,
    },
    generation_run_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SocialGenerationRun",
      required: true,
      immutable: true,
      index: true,
    },
    idempotency_key: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      trim: true,
      maxlength: 400,
    },
    provider: {
      type: String,
      required: true,
      enum: ["DRAFT_ONLY", "INSTAGRAM_GRAPH"],
      default: "DRAFT_ONLY",
      immutable: true,
      index: true,
      uppercase: true,
      trim: true,
    },
    instagram_connection_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "InstagramConnection",
      default: null,
      immutable: true,
    },
    approved_revision: { type: Number, required: true, immutable: true, min: 1 },
    status: {
      type: String,
      required: true,
      enum: PUBLICATION_STATUSES,
      default: "QUEUED",
      index: true,
      uppercase: true,
      trim: true,
    },
    content_type: {
      type: String,
      required: true,
      enum: ["SINGLE_IMAGE", "CAROUSEL", "REEL", "VIDEO_FEED", "STORY"],
      immutable: true,
      uppercase: true,
      trim: true,
    },
    asset_ids: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "SocialAsset" }],
      required: true,
      immutable: true,
      validate: {
        validator: (value) => Array.isArray(value) && value.length > 0 && value.length <= 10,
        message: "A publication requires between one and ten assets",
      },
    },
    asset_urls: {
      type: [String],
      required: true,
      immutable: true,
      validate: {
        validator: (value) => Array.isArray(value) && value.length > 0 && value.length <= 10,
        message: "A publication requires between one and ten public asset URLs",
      },
    },
    caption_hash: {
      type: String,
      required: true,
      immutable: true,
      lowercase: true,
      trim: true,
      match: /^[a-f0-9]{64}$/,
    },
    asset_fingerprint: {
      type: String,
      required: true,
      immutable: true,
      lowercase: true,
      trim: true,
      match: /^[a-f0-9]{64}$/,
    },
    payload_fingerprint: {
      type: String,
      required: true,
      immutable: true,
      lowercase: true,
      trim: true,
      match: /^[a-f0-9]{64}$/,
      index: true,
    },
    readiness_snapshot: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
    creation_id: { type: String, default: null, trim: true, index: true },
    child_creation_ids: { type: [String], default: [] },
    external_publication_id: {
      type: String,
      default: null,
      trim: true,
      set: (value) => String(value || "").trim() || null,
    },
    external_permalink: { type: String, default: null, trim: true },
    provider_checkpoint: { type: mongoose.Schema.Types.Mixed, default: null },
    provider_response_metadata: { type: mongoose.Schema.Types.Mixed, default: null },
    tracked_url_delivery: { type: trackedUrlDeliverySchema, default: null },
    attempt_count: { type: Number, default: 0, min: 0 },
    max_attempts: { type: Number, default: 4, min: 1, max: 11 },
    retry_count: { type: Number, default: 0, min: 0 },
    queued_at: { type: Date, default: Date.now, index: true },
    lease_owner: { type: String, default: null, trim: true, index: true },
    lease_expires_at: { type: Date, default: null, index: true },
    heartbeat_at: { type: Date, default: null },
    scheduled_for: { type: Date, default: null, index: true },
    next_retry_at: { type: Date, default: null, index: true },
    started_at: { type: Date, default: null },
    last_attempted_at: { type: Date, default: null },
    published_at: { type: Date, default: null, index: true },
    draft_reconciled_at: { type: Date, default: null, index: true },
    finished_at: { type: Date, default: null },
    last_error: { type: publicationErrorSchema, default: null },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    optimisticConcurrency: true,
  }
);

SocialPublicationSchema.index({ status: 1, next_retry_at: 1, created_at: 1 });
SocialPublicationSchema.index({ status: 1, lease_expires_at: 1, queued_at: 1 });
SocialPublicationSchema.index({ status: 1, scheduled_for: 1 });
SocialPublicationSchema.index({ generation_run_id: 1, created_at: -1 });
SocialPublicationSchema.index(
  { external_publication_id: 1 },
  { unique: true, partialFilterExpression: { external_publication_id: { $type: "string" } } }
);

SocialPublicationSchema.pre("validate", function validatePublishedIdentity() {
  if (this.status === "PUBLISHED" && !String(this.external_publication_id || "").trim()) {
    this.invalidate("external_publication_id", "PUBLISHED publications require Meta's published media identifier");
  }
});

SocialPublicationSchema.statics.PUBLICATION_STATUSES = PUBLICATION_STATUSES;

module.exports = mongoose.model("SocialPublication", SocialPublicationSchema);
