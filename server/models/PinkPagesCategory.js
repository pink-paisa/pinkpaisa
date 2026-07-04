const mongoose = require("mongoose");

const PinkPagesCategorySchema = new mongoose.Schema({
  name: { type: String, required: true },
  slug: { type: String, required: true, unique: true },
  icon: { type: String, default: null },
  sort_order: { type: Number, default: 0 },
  status: { type: String, enum: ["active", "inactive"], default: "active" },
}, { timestamps: true });

module.exports = mongoose.model("PinkPagesCategory", PinkPagesCategorySchema);
