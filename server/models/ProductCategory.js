const mongoose = require("mongoose");

const ProductCategorySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, trim: true, unique: true },
  description: { type: String, default: null, trim: true },
  icon: { type: String, default: null, trim: true },
  image_url: { type: String, default: null, trim: true },
  seo_meta_title: { type: String, default: null, trim: true },
  seo_meta_description: { type: String, default: null, trim: true },
  is_active: { type: Boolean, default: true, index: true },
  sort_order: { type: Number, default: 0 },
  is_system: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model("ProductCategory", ProductCategorySchema);
