const mongoose = require("mongoose");

const ProductImageSchema = new mongoose.Schema({
  url: { type: String, required: true, trim: true },
  alt: { type: String, default: null, trim: true },
  position: { type: Number, default: 0 },
}, { _id: false });

const ProductSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  slug: { type: String, required: true, trim: true, unique: true },
  short_description: { type: String, default: null },
  full_description: { type: String, default: null },
  category_id: { type: mongoose.Schema.Types.ObjectId, ref: "ProductCategory", default: null, index: true },
  subcategory_id: { type: mongoose.Schema.Types.ObjectId, ref: "ProductSubcategory", default: null, index: true },
  category: { type: String, default: "Uncategorized" },
  subcategory: { type: String, default: "Uncategorized" },
  images: [{ type: String }],
  image_items: { type: [ProductImageSchema], default: [] },
  featured_image: { type: String, default: null },
  price: { type: Number, required: true },
  sale_price: { type: Number, default: null },
  effective_price: { type: Number, default: 0, index: true },
  mrp: { type: Number, default: null, min: 0 },
  cost_price: { type: Number, default: 0 },
  gst_rate_percent: { type: Number, default: 0, min: 0, max: 50 },
  hsn_code: { type: String, default: null, trim: true },
  brand_name: { type: String, default: null, trim: true },
  country_of_origin: { type: String, default: "India", trim: true },
  sku: { type: String, default: null },
  stock_quantity: { type: Number, default: 0 },
  tags: [{ type: String }],
  weight: { type: Number, default: null },
  dimensions: { type: String, default: null },
  seo_meta_title: { type: String, default: null, trim: true },
  seo_meta_description: { type: String, default: null, trim: true },
  seo_keywords: [{ type: String, trim: true }],
  attributes: { type: mongoose.Schema.Types.Mixed, default: {} },
  status: { type: String, enum: ["active", "inactive", "draft"], default: "active" },
  is_visible: { type: Boolean, default: true, index: true },
  returnable: { type: Boolean, default: true },
  return_window_days: { type: Number, default: 7, min: 0 },
  return_liability: { type: String, enum: ["vendor", "pinkpaisa"], default: "vendor" },
  featured: { type: Boolean, default: false },
  bestseller: { type: Boolean, default: false },
  sort_order: { type: Number, default: 0 },
  source_type: { type: String, enum: ["admin", "vendor"], default: "admin" },
  vendor_id: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor", default: null, index: true },
  vendor_product_id: { type: mongoose.Schema.Types.ObjectId, ref: "VendorProduct", default: null },
  is_affiliate: { type: Boolean, default: false, index: true },
  affiliate_url: { type: String, default: null },
  affiliate_external_id: { type: String, default: null, index: true },
  affiliate_source_platform: { type: String, default: null },
  affiliate_payload: { type: mongoose.Schema.Types.Mixed, default: null },
  affiliate_asin: { type: String, default: null, trim: true, uppercase: true, index: true },
  affiliate_marketplace: { type: String, enum: ["amazon_in", "amazon_us", null], default: null, index: true },
  affiliate_tag: { type: String, default: null, trim: true },
  affiliate_data_source: {
    type: String,
    enum: ["manual", "excel-upload", "creators_api", "pa_api", "unknown", null],
    default: "manual",
  },
  affiliate_data_last_refreshed_at: { type: Date, default: null },
  affiliate_data_expires_at: { type: Date, default: null, index: true },
  affiliate_api_error: { type: String, default: null, trim: true },
  affiliate_compliance_status: {
    type: String,
    enum: ["needs_review", "compliant", "non_compliant", "paused"],
    default: "needs_review",
    index: true,
  },
  affiliate_compliance_flags: [{ type: String, trim: true }],
  buying_intent: { type: String, default: null, trim: true },
  campaign_label: { type: String, default: null, trim: true, index: true },
  pros: [{ type: String, trim: true }],
  cons: [{ type: String, trim: true }],
  seo_title: { type: String, default: null, trim: true },
  seo_description: { type: String, default: null, trim: true },
  is_featured_affiliate: { type: Boolean, default: false, index: true },
  affiliate_sort_order: { type: Number, default: 0, index: true },
  affiliate_is_instagram_pick: { type: Boolean, default: false, index: true },
  affiliate_link_last_checked_at: { type: Date, default: null },
  affiliate_link_check_status: {
    type: String,
    enum: ["unchecked", "ok", "failed", "paused", null],
    default: "unchecked",
    index: true,
  },
  affiliate_link_failure_count: { type: Number, default: 0, min: 0 },
  affiliate_link_failure_reason: { type: String, default: null, trim: true },
}, { timestamps: true });

ProductSchema.index({ vendor_product_id: 1 }, { unique: true, sparse: true });
ProductSchema.index({ title: "text", tags: "text", sku: "text" });
ProductSchema.index({ is_visible: 1, is_affiliate: 1, sort_order: 1, createdAt: -1 });
ProductSchema.index({ category_id: 1, is_visible: 1, sort_order: 1, createdAt: -1 });
ProductSchema.index({ is_affiliate: 1, affiliate_external_id: 1 }, { sparse: true });
ProductSchema.index(
  { affiliate_marketplace: 1, affiliate_asin: 1 },
  {
    unique: true,
    partialFilterExpression: {
      is_affiliate: true,
      affiliate_marketplace: { $type: "string" },
      affiliate_asin: { $type: "string" },
    },
  }
);
ProductSchema.index({ is_affiliate: 1, affiliate_compliance_status: 1, is_visible: 1, status: 1 });
ProductSchema.index({ affiliate_is_instagram_pick: 1, affiliate_sort_order: 1, createdAt: -1 });

module.exports = mongoose.model("Product", ProductSchema);
