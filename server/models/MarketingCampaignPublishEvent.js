const mongoose = require("mongoose");

const MarketingCampaignPublishEventSchema = new mongoose.Schema({
  campaign_run_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "MarketingCampaignRun",
    required: true,
    index: true,
  },
  campaign_id: { type: String, default: null, trim: true, index: true },
  batch_run_id: { type: mongoose.Schema.Types.ObjectId, ref: "DailyBatchRun", default: null, index: true },
  action_type: {
    type: String,
    enum: ["publish", "schedule", "retry", "carousel_publish", "failed_publish", "regenerate", "reset", "archive", "restore", "purge"],
    required: true,
    index: true,
  },
  status: {
    type: String,
    enum: ["started", "success", "failed", "skipped"],
    required: true,
    index: true,
  },
  actor_admin_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
  source_event: { type: String, default: null, trim: true },
  product_title: { type: String, default: null, trim: true },
  content_type: { type: String, default: null, trim: true },
  instagram_creation_id: { type: String, default: null, trim: true },
  instagram_media_id: { type: String, default: null, trim: true },
  instagram_permalink: { type: String, default: null, trim: true },
  error_message: { type: String, default: null, trim: true },
  readiness_snapshot: { type: mongoose.Schema.Types.Mixed, default: null },
  metadata_json: { type: mongoose.Schema.Types.Mixed, default: null },
}, { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } });

MarketingCampaignPublishEventSchema.index({ campaign_run_id: 1, created_at: -1 });
MarketingCampaignPublishEventSchema.index({ action_type: 1, status: 1, created_at: -1 });

module.exports = mongoose.model("MarketingCampaignPublishEvent", MarketingCampaignPublishEventSchema);
