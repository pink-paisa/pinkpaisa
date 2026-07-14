const mongoose = require("mongoose");

const MarketingCampaignRunSchema = new mongoose.Schema({
  campaign_id: { type: String, required: true, unique: true, index: true, trim: true },
  source_event: { type: String, enum: ["product.approved", "admin_product.published", "affiliate_product.published"], default: "product.approved" },
  source_event_key: { type: String, required: true, unique: true, index: true, trim: true },
  vendor_product_id: { type: mongoose.Schema.Types.ObjectId, ref: "VendorProduct", default: null, index: true },
  public_product_id: { type: mongoose.Schema.Types.ObjectId, ref: "Product", default: null, index: true },
  vendor_id: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor", default: null, index: true },
  product_title: { type: String, default: null, trim: true },
  product_slug: { type: String, default: null, trim: true },
  vendor_shop_name: { type: String, default: null, trim: true },
  status: {
    type: String,
    enum: ["queued", "running", "batch_running", "waiting_review", "approved_for_publish", "scheduled", "publishing", "completed", "published", "failed", "rejected", "archived"],
    default: "queued",
    index: true,
  },
  current_stage: { type: String, default: "queued_for_daily_batch", index: true },
  review_stage: { type: String, default: null },
  review_notes: { type: String, default: null },
  review_status: { type: String, enum: ["pending", "approved", "rejected", "not_required"], default: "pending", index: true },
  content_type: { type: String, enum: ["single_image", "carousel"], default: "single_image" },
  creative_json: { type: mongoose.Schema.Types.Mixed, default: null },
  asset_urls: [{ type: String }],
  cta_text: { type: String, default: null, trim: true },
  batch_key: { type: String, default: null, index: true },
  batch_run_id: { type: mongoose.Schema.Types.ObjectId, ref: "DailyBatchRun", default: null, index: true },
  publish_status: { type: String, enum: ["draft", "ready", "scheduled", "publishing", "published", "failed", "not_ready"], default: "draft", index: true },
  scheduled_for: { type: Date, default: null, index: true },
  publish_attempted_at: { type: Date, default: null },
  published_at: { type: Date, default: null },
  instagram_creation_id: { type: String, default: null, trim: true },
  instagram_child_creation_ids: [{ type: String, trim: true }],
  instagram_media_id: { type: String, default: null, trim: true },
  instagram_permalink: { type: String, default: null, trim: true },
  approved_at: { type: Date, default: null },
  last_error: { type: String, default: null },
  brief_json: { type: mongoose.Schema.Types.Mixed, default: null },
  strategy_json: { type: mongoose.Schema.Types.Mixed, default: null },
  caption_json: { type: mongoose.Schema.Types.Mixed, default: null },
  compliance_json: { type: mongoose.Schema.Types.Mixed, default: null },
  tracking_json: { type: mongoose.Schema.Types.Mixed, default: null },
  published_urls: [{ type: String }],
  archived_at: { type: Date, default: null, index: true },
  archived_by: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  archive_reason: { type: String, default: null, trim: true },
  archived_from_status: { type: String, default: null, trim: true },
}, { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } });

MarketingCampaignRunSchema.index({ vendor_product_id: 1, created_at: -1 });
MarketingCampaignRunSchema.index({ status: 1, scheduled_for: 1 });
MarketingCampaignRunSchema.index({ batch_key: 1, status: 1 });
MarketingCampaignRunSchema.index({ archived_at: 1, updated_at: -1 });

module.exports = mongoose.model("MarketingCampaignRun", MarketingCampaignRunSchema);
