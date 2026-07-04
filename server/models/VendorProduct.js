const mongoose = require("mongoose");

const VendorProductSchema = new mongoose.Schema({
  vendor_id: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor", required: true, index: true },
  title: { type: String, required: true, trim: true },
  slug: { type: String, required: true, trim: true },
  price: { type: Number, required: true, min: 0 },
  sale_price: { type: Number, default: null, min: 0 },
  effective_price: { type: Number, default: 0, min: 0 },
  mrp: { type: Number, default: null, min: 0 },
  gst_rate_percent: { type: Number, default: 0, min: 0, max: 50 },
  hsn_code: { type: String, default: null, trim: true },
  brand_name: { type: String, default: null, trim: true },
  country_of_origin: { type: String, default: "India", trim: true },
  sku: { type: String, default: null, trim: true },
  stock_quantity: { type: Number, default: 0, min: 0 },
  category_id: { type: mongoose.Schema.Types.ObjectId, ref: "ProductCategory", default: null, index: true },
  subcategory_id: { type: mongoose.Schema.Types.ObjectId, ref: "ProductSubcategory", default: null, index: true },
  category: { type: String, default: null, trim: true },
  subcategory: { type: String, default: null, trim: true },
  short_description: { type: String, default: null },
  full_description: { type: String, default: null },
  tags: [{ type: String }],
  weight: { type: String, default: null },
  dimensions: { type: String, default: null },
  seo_meta_title: { type: String, default: null, trim: true },
  seo_meta_description: { type: String, default: null, trim: true },
  seo_keywords: [{ type: String, trim: true }],
  attributes: { type: mongoose.Schema.Types.Mixed, default: {} },
  status: { type: String, enum: ["active", "draft", "inactive"], default: "active" },
  upload_status: { type: String, enum: ["uploaded", "processed", "completed", "partial", "failed", "limit_reached"], default: "uploaded" },
  approval_status: { type: String, enum: ["pending_approval", "approved", "rejected"], default: "pending_approval", index: true },
  is_visible: { type: Boolean, default: false, index: true },
  approved_at: { type: Date, default: null },
  rejection_reason: { type: String, default: null },
  rejection_note: { type: String, default: null },
  resubmission_count: { type: Number, default: 0, min: 0 },
  returnable: { type: Boolean, default: true },
  return_window_days: { type: Number, default: 7, min: 0 },
  return_liability: { type: String, enum: ["vendor"], default: "vendor" },
  featured: { type: Boolean, default: false },
  bestseller: { type: Boolean, default: false },
  sort_order: { type: Number, default: 0 },
  featured_image: { type: String, default: null },
  additional_images: [{ type: String }],
  published_product_id: { type: mongoose.Schema.Types.ObjectId, ref: "Product", default: null },
}, { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } });

VendorProductSchema.index({ vendor_id: 1, slug: 1 }, { unique: true });
VendorProductSchema.index({ vendor_id: 1, sku: 1 }, { unique: true, sparse: true });
VendorProductSchema.index({ category_id: 1, is_visible: 1, sort_order: 1, created_at: -1 });

module.exports = mongoose.model("VendorProduct", VendorProductSchema);
