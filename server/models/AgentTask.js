const mongoose = require("mongoose");

const AgentTaskSchema = new mongoose.Schema({
  campaign_run_id: { type: mongoose.Schema.Types.ObjectId, ref: "MarketingCampaignRun", required: true, index: true },
  campaign_id: { type: String, required: true, index: true, trim: true },
  agent_name: { type: String, enum: ["intake", "strategy", "creative", "carousel", "caption", "compliance", "publish", "ads", "tracking", "analytics"], required: true },
  sequence: { type: Number, required: true, min: 1 },
  status: { type: String, enum: ["queued", "running", "completed", "failed", "cancelled"], default: "queued", index: true },
  queue_lane: { type: String, enum: ["fast", "creative", "publish"], default: "fast", index: true },
  priority: { type: Number, default: 50, index: true },
  available_at: { type: Date, default: Date.now, index: true },
  lease_owner: { type: String, default: null, trim: true, index: true },
  lease_expires_at: { type: Date, default: null, index: true },
  heartbeat_at: { type: Date, default: null },
  idempotency_key: { type: String, default: null, trim: true },
  cancellation_requested: { type: Boolean, default: false },
  input_json: { type: mongoose.Schema.Types.Mixed, default: null },
  output_json: { type: mongoose.Schema.Types.Mixed, default: null },
  error_message: { type: String, default: null },
  attempt_count: { type: Number, default: 0, min: 0 },
  started_at: { type: Date, default: null },
  finished_at: { type: Date, default: null },
}, { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } });

AgentTaskSchema.index({ campaign_run_id: 1, agent_name: 1 }, { unique: true });
AgentTaskSchema.index({ status: 1, created_at: 1 });
AgentTaskSchema.index({ status: 1, queue_lane: 1, available_at: 1, priority: -1, created_at: 1 });
AgentTaskSchema.index({ status: 1, lease_expires_at: 1 });
AgentTaskSchema.index({ idempotency_key: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model("AgentTask", AgentTaskSchema);
