const mongoose = require("mongoose");

const UserAddressSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    label: { type: String, default: "Default", trim: true },
    full_name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    line1: { type: String, required: true, trim: true },
    line2: { type: String, default: null, trim: true },
    landmark: { type: String, default: null, trim: true },
    city: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
    pincode: { type: String, required: true, trim: true },
    country: { type: String, default: "India", trim: true },
    address_type: { type: String, enum: ["home", "work", "other"], default: "home" },
    is_default_shipping: { type: Boolean, default: false },
    is_default_billing: { type: Boolean, default: false },
  },
  { timestamps: true }
);

UserAddressSchema.index({ user_id: 1, is_default_shipping: 1 });
UserAddressSchema.index({ user_id: 1, createdAt: -1 });

module.exports = mongoose.model("UserAddress", UserAddressSchema);
