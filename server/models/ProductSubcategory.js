const mongoose = require("mongoose");

const ProductSubcategorySchema = new mongoose.Schema({
  category_id: { type: mongoose.Schema.Types.ObjectId, ref: "ProductCategory", required: true, index: true },
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, trim: true },
  description: { type: String, default: null, trim: true },
  icon: { type: String, default: null, trim: true },
  image_url: { type: String, default: null, trim: true },
  seo_meta_title: { type: String, default: null, trim: true },
  seo_meta_description: { type: String, default: null, trim: true },
  is_active: { type: Boolean, default: true, index: true },
  sort_order: { type: Number, default: 0 },
  is_system: { type: Boolean, default: false },
}, { timestamps: true });

ProductSubcategorySchema.index({ category_id: 1, slug: 1 }, { unique: true });

module.exports = mongoose.model("ProductSubcategory", ProductSubcategorySchema);
