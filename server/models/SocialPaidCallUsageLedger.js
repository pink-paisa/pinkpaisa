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

const SocialPaidCallUsageLedgerSchema = new mongoose.Schema({
  idempotency_key: { type: String, required: true, unique: true, immutable: true, trim: true, maxlength: 300 },
  generation_run_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "SocialGenerationRun",
    required: true,
    immutable: true,
    index: true,
  },
  draft_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "SocialPostDraft",
    required: true,
    immutable: true,
    index: true,
  },
  operation: {
    type: String,
    required: true,
    enum: ["VISUAL_REGENERATION", "PARTIAL_REGENERATION", "DUPLICATE"],
    immutable: true,
    index: true,
  },
  status: {
    type: String,
    required: true,
    enum: ["SUCCEEDED", "FAILED"],
    immutable: true,
    index: true,
  },
  provider: { type: String, required: true, immutable: true, trim: true, lowercase: true },
  model: { type: String, default: null, immutable: true, trim: true },
  incurred_at: { type: Date, required: true, immutable: true, index: true },
  usage: { type: usageSchema, required: true, immutable: true },
  evidence: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
  request_id: { type: String, default: null, immutable: true, trim: true, maxlength: 200 },
  recorded_at: { type: Date, required: true, immutable: true, default: Date.now },
}, {
  timestamps: false,
  strict: "throw",
});

function appendOnlyError() {
  const error = new Error("SocialPaidCallUsageLedger records are append-only");
  error.code = "social_paid_call_usage_ledger_immutable";
  return error;
}

SocialPaidCallUsageLedgerSchema.pre("save", function rejectLedgerResave(next) {
  if (this.isNew) return next();
  return next(appendOnlyError());
});

for (const operation of ["updateOne", "updateMany", "replaceOne", "deleteOne", "deleteMany", "findOneAndUpdate", "findOneAndDelete"]) {
  SocialPaidCallUsageLedgerSchema.pre(operation, function rejectLedgerMutation(next) {
    next(appendOnlyError());
  });
}

module.exports = mongoose.models.SocialPaidCallUsageLedger
  || mongoose.model("SocialPaidCallUsageLedger", SocialPaidCallUsageLedgerSchema);
