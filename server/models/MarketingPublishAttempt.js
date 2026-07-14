const mongoose = require("mongoose");

const MarketingPublishAttemptSchema = new mongoose.Schema({
  campaign_run_id: { type: mongoose.Schema.Types.ObjectId, ref: "MarketingCampaignRun", required: true, unique: true, index: true },
  campaign_id: { type: String, required: true, trim: true, index: true },
  idempotency_key: { type: String, required: true, unique: true, trim: true },
  status: {
    type: String,
    enum: ["queued", "container_created", "publishing", "published", "failed", "uncertain"],
    default: "queued",
    index: true,
  },
  content_type: { type: String, enum: ["single_image", "carousel"], default: "single_image" },
  group_run_ids: [{ type: mongoose.Schema.Types.ObjectId, ref: "MarketingCampaignRun" }],
  asset_urls: [{ type: String }],
  caption_hash: { type: String, default: null, trim: true },
  payload_fingerprint: { type: String, default: null, trim: true, index: true },
  creation_id: { type: String, default: null, trim: true },
  child_creation_ids: [{ type: String, trim: true }],
  media_id: { type: String, default: null, trim: true },
  permalink: { type: String, default: null, trim: true },
  attempt_count: { type: Number, default: 0, min: 0 },
  last_error: { type: String, default: null, trim: true },
  started_at: { type: Date, default: null },
  finished_at: { type: Date, default: null },
}, { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } });

module.exports = mongoose.model("MarketingPublishAttempt", MarketingPublishAttemptSchema);
