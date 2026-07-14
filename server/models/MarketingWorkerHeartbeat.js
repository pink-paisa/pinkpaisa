const mongoose = require("mongoose");

const MarketingWorkerHeartbeatSchema = new mongoose.Schema({
  worker_key: { type: String, required: true, unique: true, trim: true },
  worker_id: { type: String, required: true, trim: true },
  heartbeat_at: { type: Date, required: true, index: true },
  metadata_json: { type: mongoose.Schema.Types.Mixed, default: null },
}, { timestamps: true });

module.exports = mongoose.model("MarketingWorkerHeartbeat", MarketingWorkerHeartbeatSchema);
