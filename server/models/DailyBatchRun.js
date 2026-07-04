const mongoose = require("mongoose");

const DailyBatchRunSchema = new mongoose.Schema({
  batch_key: { type: String, required: true, unique: true, index: true, trim: true },
  batch_date_ist: { type: String, required: true, index: true, trim: true },
  trigger_type: { type: String, enum: ["scheduled", "manual"], default: "scheduled" },
  status: { type: String, enum: ["running", "completed", "completed_with_errors", "failed"], default: "running", index: true },
  started_at: { type: Date, default: Date.now },
  finished_at: { type: Date, default: null },
  success_count: { type: Number, default: 0, min: 0 },
  failed_count: { type: Number, default: 0, min: 0 },
  total_runs: { type: Number, default: 0, min: 0 },
  run_ids: [{ type: mongoose.Schema.Types.ObjectId, ref: "MarketingCampaignRun" }],
  error_summary: { type: String, default: null },
  metadata_json: { type: mongoose.Schema.Types.Mixed, default: null },
}, { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } });

module.exports = mongoose.model("DailyBatchRun", DailyBatchRunSchema);
