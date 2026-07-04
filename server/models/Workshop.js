const mongoose = require("mongoose");

const WorkshopSchema = new mongoose.Schema({
  title: { type: String, required: true },
  slug: { type: String, required: true, unique: true },
  workshop_type: { type: String, default: "online" },
  short_description: { type: String, default: null },
  full_description: { type: String, default: null },
  duration: { type: String, default: null },
  min_people: { type: Number, default: 1 },
  price: { type: Number, required: true },
  original_price: { type: Number, default: null },
  discount_text: { type: String, default: null },
  image_url: { type: String, default: null },
  icon: { type: String, default: "🎓" },
  popular: { type: Boolean, default: false },
  featured: { type: Boolean, default: false },
  category: { type: String, default: "general" },
  tags: { type: [String], default: [] },
  inclusions: { type: [String], default: [] },
  certificate_included: { type: Boolean, default: false },
  recording_addon_available: { type: Boolean, default: false },
  recording_addon_price: { type: Number, default: 0 },
  certification_addon_available: { type: Boolean, default: false },
  certification_addon_price: { type: Number, default: 0 },
  status: { type: String, enum: ["active", "inactive", "draft"], default: "active" },
  custom_quote_enabled: { type: Boolean, default: false },
  sort_order: { type: Number, default: 0 },
  benefits: { type: [String], default: [] },
}, { timestamps: true });

module.exports = mongoose.model("Workshop", WorkshopSchema);
