const mongoose = require("mongoose");

const AffiliateEventSchema = new mongoose.Schema({
  event_type: {
    type: String,
    enum: ["product_view", "cta_click", "outbound_click"],
    required: true,
    index: true,
  },
  product_id: { type: mongoose.Schema.Types.ObjectId, ref: "Product", default: null, index: true },
  asin: { type: String, default: null, trim: true, index: true },
  marketplace: { type: String, enum: ["amazon_in", "amazon_us", null], default: null, index: true },
  category: { type: String, default: null, trim: true, index: true },
  campaign_label: { type: String, default: null, trim: true, index: true },
  utm_source: { type: String, default: null, trim: true, index: true },
  utm_medium: { type: String, default: null, trim: true },
  utm_campaign: { type: String, default: null, trim: true, index: true },
  utm_content: { type: String, default: null, trim: true },
  referrer: { type: String, default: null, trim: true },
  device_type: { type: String, enum: ["mobile", "tablet", "desktop", "unknown"], default: "unknown", index: true },
  user_agent_hash: { type: String, default: null, index: true },
  ip_hash: { type: String, default: null, index: true },
  is_bot: { type: Boolean, default: false, index: true },
  dedupe_key: { type: String, required: true, index: true },
  experiment_name: { type: String, default: null, trim: true, index: true },
  experiment_variant: { type: String, default: null, trim: true, index: true },
}, { timestamps: true });

AffiliateEventSchema.index({ dedupe_key: 1, createdAt: -1 });
AffiliateEventSchema.index({ createdAt: -1, event_type: 1 });
AffiliateEventSchema.index({ product_id: 1, createdAt: -1 });

module.exports = mongoose.model("AffiliateEvent", AffiliateEventSchema);
