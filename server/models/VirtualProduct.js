const mongoose = require("mongoose");

// Mirrors Supabase `products` table (virtual/digital programs)
const VirtualProductSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true },
    subtitle: { type: String, default: null },
    description: { type: String, default: null },
    icon: { type: String, default: "Sparkles" },
    badge: { type: String, default: null },
    badge_color: { type: String, default: "bg-accent text-accent-foreground" },
    includes: { type: [String], default: [] },
    price: { type: Number, required: true },
    price_max: { type: Number, default: null },
    format: { type: String, default: null },
    is_active: { type: Boolean, default: true },
    sort_order: { type: Number, default: 0 },
    status: { type: String, enum: ["active", "draft"], default: "active" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("VirtualProduct", VirtualProductSchema);
