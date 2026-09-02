const mongoose = require("mongoose");

const SocialPaidOperationSchema = new mongoose.Schema({
  idempotency_key: { type: String, required: true, unique: true, immutable: true, trim: true, maxlength: 300 },
  operation: {
    type: String,
    required: true,
    enum: ["VISUAL_REGENERATION", "PARTIAL_REGENERATION", "DUPLICATE"],
    immutable: true,
    index: true,
  },
  source_draft_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "SocialPostDraft",
    required: true,
    immutable: true,
    index: true,
  },
  result_draft_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "SocialPostDraft",
    default: null,
    index: true,
  },
  generation_run_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "SocialGenerationRun",
    default: null,
    index: true,
  },
  request_fingerprint: { type: String, required: true, immutable: true, trim: true, match: /^[a-f0-9]{64}$/ },
  status: {
    type: String,
    required: true,
    enum: ["RUNNING", "SUCCEEDED", "FAILED"],
    default: "RUNNING",
    index: true,
  },
  actor_admin_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, immutable: true },
  request_id: { type: String, default: null, immutable: true, trim: true, maxlength: 200 },
  error: {
    code: { type: String, default: null, trim: true, maxlength: 200 },
    message: { type: String, default: null, trim: true, maxlength: 1000 },
    evidence_fingerprint: { type: String, default: null, trim: true, maxlength: 128 },
  },
  // Fail-safe receipt used only when the append-only usage ledger cannot be
  // written after a provider call has already completed. The value is
  // sanitized before persistence and intentionally excludes image bytes.
  recovery_evidence: { type: mongoose.Schema.Types.Mixed, default: null },
  started_at: { type: Date, required: true, default: Date.now, immutable: true },
  lease_expires_at: { type: Date, required: true, index: true },
  last_heartbeat_at: { type: Date, required: true, default: Date.now },
  finished_at: { type: Date, default: null },
}, {
  timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  strict: "throw",
});

SocialPaidOperationSchema.index({ source_draft_id: 1, operation: 1, created_at: -1 });
SocialPaidOperationSchema.index({ status: 1, lease_expires_at: 1 });

module.exports = mongoose.models.SocialPaidOperation
  || mongoose.model("SocialPaidOperation", SocialPaidOperationSchema);
