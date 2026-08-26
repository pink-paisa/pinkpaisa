const mongoose = require("mongoose");

const usageSchema = new mongoose.Schema({
  input_tokens: { type: Number, default: 0, min: 0 },
  output_tokens: { type: Number, default: 0, min: 0 },
  total_tokens: { type: Number, default: 0, min: 0 },
  input_image_tokens: { type: Number, default: 0, min: 0 },
  output_image_tokens: { type: Number, default: 0, min: 0 },
  estimated_cost: { type: Number, default: 0, min: 0 },
  cost_currency: { type: String, default: "USD", uppercase: true, trim: true },
}, { _id: false, strict: "throw" });

const costBreakdownSchema = new mongoose.Schema({
  method: {
    type: String,
    required: true,
    enum: ["CONSERVATIVE_EVIDENCE_V1"],
    immutable: true,
  },
  run_reported_cost: { type: Number, default: 0, min: 0, immutable: true },
  stage_reported_cost: { type: Number, default: 0, min: 0, immutable: true },
  content_revision_reported_cost: { type: Number, default: 0, min: 0, immutable: true },
  image_attempt_reported_cost: { type: Number, default: 0, min: 0, immutable: true },
  image_attempt_estimated_cost: { type: Number, default: 0, min: 0, immutable: true },
  base_generation_cost: { type: Number, default: 0, min: 0, immutable: true },
  visual_regeneration_audit_cost: { type: Number, default: 0, min: 0, immutable: true },
  visual_regeneration_asset_cost: { type: Number, default: 0, min: 0, immutable: true },
  visual_regeneration_cost: { type: Number, default: 0, min: 0, immutable: true },
  total_estimated_cost: { type: Number, default: 0, min: 0, immutable: true },
  inferred_image_unit_cost: { type: Number, default: 0, min: 0, immutable: true },
  image_attempt_count: { type: Number, default: 0, min: 0, immutable: true },
  failed_image_attempt_count: { type: Number, default: 0, min: 0, immutable: true },
  visual_regeneration_event_count: { type: Number, default: 0, min: 0, immutable: true },
  visual_regeneration_asset_group_count: { type: Number, default: 0, min: 0, immutable: true },
}, { _id: false, strict: "throw" });

const SocialGenerationUsageLedgerSchema = new mongoose.Schema({
  generation_run_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "SocialGenerationRun",
    required: true,
    unique: true,
    immutable: true,
    index: true,
  },
  generation_date: {
    type: String,
    required: true,
    immutable: true,
    match: /^\d{4}-\d{2}-\d{2}$/,
    index: true,
  },
  incurred_at: { type: Date, required: true, immutable: true, index: true },
  usage: { type: usageSchema, required: true, immutable: true },
  cost_breakdown: { type: costBreakdownSchema, default: null, immutable: true },
  cleanup_idempotency_key: { type: String, required: true, immutable: true, trim: true, maxlength: 200, index: true },
  recorded_at: { type: Date, required: true, immutable: true, default: Date.now },
}, {
  timestamps: false,
  strict: "throw",
});

function appendOnlyError() {
  const error = new Error("SocialGenerationUsageLedger records are append-only");
  error.code = "social_generation_usage_ledger_immutable";
  return error;
}

SocialGenerationUsageLedgerSchema.pre("save", function rejectLedgerResave(next) {
  if (this.isNew) return next();
  return next(appendOnlyError());
});

for (const operation of ["updateOne", "updateMany", "replaceOne", "deleteOne", "deleteMany", "findOneAndUpdate", "findOneAndDelete"]) {
  SocialGenerationUsageLedgerSchema.pre(operation, function rejectLedgerMutation(next) {
    next(appendOnlyError());
  });
}

module.exports = mongoose.models.SocialGenerationUsageLedger
  || mongoose.model("SocialGenerationUsageLedger", SocialGenerationUsageLedgerSchema);
