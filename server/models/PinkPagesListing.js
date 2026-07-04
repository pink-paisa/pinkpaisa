const mongoose = require("mongoose");

const PinkPagesListingSchema = new mongoose.Schema({
  category_id: { type: String, default: null },
  business_name: { type: String, required: true },
  slug: { type: String, required: true, unique: true },
  short_description: { type: String, default: null },
  full_description: { type: String, default: null },
  contact_person: { type: String, default: null },
  phone: { type: String, required: true },
  email: { type: String, required: true },
  whatsapp: { type: String, default: null },
  website: { type: String, default: null },
  address: { type: String, default: null },
  city: { type: String, default: null },
  state: { type: String, default: null },
  pincode: { type: String, default: null },
  logo: { type: String, default: null },
  featured: { type: Boolean, default: false },
  verified: { type: Boolean, default: false },
  status: { type: String, enum: ["active", "inactive", "pending"], default: "pending" },
  sort_order: { type: Number, default: 0 },
  meta_title: { type: String, default: null },
  meta_description: { type: String, default: null },
}, { timestamps: true });

PinkPagesListingSchema.index({
  business_name: "text",
  short_description: "text",
  city: "text",
  state: "text",
});

module.exports = mongoose.model("PinkPagesListing", PinkPagesListingSchema);
