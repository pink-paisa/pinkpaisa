const mongoose = require("mongoose");

const ORCHESTRATION_OPERATIONS = ["WEEKLY_PLAN", "PREPUBLICATION", "METRICS"];
const ORCHESTRATION_STATUSES = ["PROCESSING", "SUCCEEDED", "FAILED"];

const orchestrationErrorSchema = new mongoose.Schema(
  {
    code: { type: String, default: null, trim: true, maxlength: 200 },
    message: { type: String, default: null, trim: true, maxlength: 4000 },
    status_code: { type: Number, default: null, min: 400, max: 599 },
    occurred_at: { type: Date, default: null },
  },
  { _id: false }
);

const SocialOrchestrationReceiptSchema = new mongoose.Schema(
  {
    operation: {
      type: String,
      required: true,
      enum: ORCHESTRATION_OPERATIONS,
      immutable: true,
      uppercase: true,
      trim: true,
    },
    idempotency_key: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      maxlength: 300,
    },
    request_hash: {
      type: String,
      required: true,
      immutable: true,
      lowercase: true,
      trim: true,
      match: /^[a-f0-9]{64}$/,
    },
    signed_delivery_fingerprints: {
      type: [{
        type: String,
        lowercase: true,
        trim: true,
        match: /^[a-f0-9]{64}$/,
      }],
      default: undefined,
      required: true,
      validate: {
        validator: (value) => Array.isArray(value) && value.length > 0,
        message: "At least one signed delivery fingerprint is required",
      },
    },
    request_timestamp: { type: Number, required: true, immutable: true, min: 0 },
    status: {
      type: String,
      required: true,
      enum: ORCHESTRATION_STATUSES,
      default: "PROCESSING",
      uppercase: true,
      trim: true,
      index: true,
    },
    attempt_count: { type: Number, default: 1, min: 1 },
    retryable: { type: Boolean, default: false },
    response_status: { type: Number, default: null, min: 100, max: 599 },
    response_body: { type: mongoose.Schema.Types.Mixed, default: null },
    lease_owner: { type: String, default: null, trim: true, maxlength: 200, index: true },
    lease_expires_at: { type: Date, default: null, index: true },
    heartbeat_at: { type: Date, default: null },
    started_at: { type: Date, default: Date.now },
    completed_at: { type: Date, default: null },
    last_error: { type: orchestrationErrorSchema, default: null },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    optimisticConcurrency: true,
  }
);

SocialOrchestrationReceiptSchema.index(
  { operation: 1, idempotency_key: 1 },
  { unique: true, name: "social_orchestration_operation_idempotency_unique" }
);
SocialOrchestrationReceiptSchema.index(
  { signed_delivery_fingerprints: 1 },
  { unique: true, name: "social_orchestration_signed_delivery_unique" }
);
SocialOrchestrationReceiptSchema.index({ status: 1, lease_expires_at: 1, updated_at: 1 });

SocialOrchestrationReceiptSchema.statics.ORCHESTRATION_OPERATIONS = ORCHESTRATION_OPERATIONS;
SocialOrchestrationReceiptSchema.statics.ORCHESTRATION_STATUSES = ORCHESTRATION_STATUSES;

module.exports = mongoose.model("SocialOrchestrationReceipt", SocialOrchestrationReceiptSchema);
