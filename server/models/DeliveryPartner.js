const mongoose = require("mongoose");

const DeliveryPartnerSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, default: null, trim: true },
  phone: { type: String, default: null, trim: true },
  company_name: { type: String, default: null, trim: true },
  status: { type: String, enum: ["active", "inactive"], default: "active" },
  notes: { type: String, default: null },
}, { timestamps: true });

module.exports = mongoose.model("DeliveryPartner", DeliveryPartnerSchema);
