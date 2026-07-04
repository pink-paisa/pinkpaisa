const mongoose = require("mongoose");

const BlogSchema = new mongoose.Schema({
  title: { type: String, required: true },
  slug: { type: String, required: true, unique: true },
  excerpt: { type: String, default: null },
  content: { type: String, default: null },
  cover_image: { type: String, default: null },
  author: { type: String, default: "Admin" },
  category: { type: String, default: null },
  tags: { type: [String], default: [] },
  seo_title: { type: String, default: null },
  seo_description: { type: String, default: null },
  status: { type: String, enum: ["draft", "published", "archived"], default: "draft" },
  featured: { type: Boolean, default: false },
  sort_order: { type: Number, default: 0 },
  published_at: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model("Blog", BlogSchema);
