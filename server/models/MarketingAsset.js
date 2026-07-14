const mongoose = require("mongoose");

const MarketingAssetSchema = new mongoose.Schema({
  campaign_run_id: { type: mongoose.Schema.Types.ObjectId, ref: "MarketingCampaignRun", required: true, index: true },
  campaign_id: { type: String, required: true, trim: true, index: true },
  asset_type: { type: String, enum: ["creative", "source"], default: "creative" },
  url: { type: String, required: true, unique: true, trim: true },
  storage_provider: { type: String, enum: ["local", "external"], required: true },
  storage_key: { type: String, default: null, trim: true },
  checksum_sha256: { type: String, required: true, trim: true, index: true },
  source_url: { type: String, default: null, trim: true },
  source_provenance: {
    type: String,
    enum: [
      "admin_provided",
      "vendor_provided",
      "amazon_import",
      "creators_api",
      "generated",
      "product_reference",
      "generated_without_reference",
      "generated_from_approved_source",
      "unknown",
    ],
    default: "unknown",
  },
  usage_rights_status: {
    type: String,
    enum: ["unknown", "admin_confirmed", "owned", "licensed", "api_permitted"],
    default: "unknown",
  },
  provider: { type: String, default: null, trim: true },
  model: { type: String, default: null, trim: true },
  deleted_at: { type: Date, default: null, index: true },
}, { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } });

MarketingAssetSchema.index({ campaign_run_id: 1, deleted_at: 1 });

module.exports = mongoose.model("MarketingAsset", MarketingAssetSchema);
