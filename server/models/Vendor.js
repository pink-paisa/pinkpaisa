const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const VendorBankDetailsSchema = new mongoose.Schema({
  account_holder_name: { type: String, default: null, trim: true },
  account_number: { type: String, default: null, trim: true },
  ifsc_code: { type: String, default: null, trim: true },
  bank_name: { type: String, default: null, trim: true },
  branch_name: { type: String, default: null, trim: true },
  upi_id: { type: String, default: null, trim: true },
}, { _id: false });

const VendorSchema = new mongoose.Schema({
  owner_name: { type: String, required: true, trim: true },
  mobile: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password_hash: { type: String, required: true },
  business_name: { type: String, required: true, trim: true },
  shop_name: { type: String, required: true, trim: true },
  business_type: { type: String, required: true, trim: true },
  gstin: { type: String, required: true, unique: true, uppercase: true, trim: true },
  pan: { type: String, required: true, uppercase: true, trim: true },
  address: { type: String, required: true, trim: true },
  city: { type: String, required: true, trim: true },
  state: { type: String, required: true, trim: true },
  pincode: { type: String, required: true, trim: true },
  website: { type: String, default: null, trim: true },
  status: { type: String, enum: ["pending", "verified", "rejected", "banned"], default: "pending" },
  max_products_allowed: { type: Number, default: 25, min: 0 },
  assigned_category_ids: [{ type: mongoose.Schema.Types.ObjectId, ref: "ProductCategory", default: [] }],
  email_verified: { type: Boolean, default: false },
  email_verification_token: { type: String, default: null, select: false },
  email_verification_expires_at: { type: Date, default: null },
  password_reset_token: { type: String, default: null, select: false },
  password_reset_expires_at: { type: Date, default: null },
  failed_login_attempts: { type: Number, default: 0, min: 0 },
  locked_until: { type: Date, default: null },
  last_login_at: { type: Date, default: null },
  last_login_ip: { type: String, default: null, trim: true },
  kyc_verified: { type: Boolean, default: false },
  bank_verified: { type: Boolean, default: false },
  kyc_documents: {
    pan_url: { type: String, default: null },
    gst_certificate_url: { type: String, default: null },
    aadhaar_url: { type: String, default: null },
    cancelled_cheque_url: { type: String, default: null },
    uploaded_at: { type: Date, default: null },
  },
  bank_details: { type: VendorBankDetailsSchema, default: () => ({}) },
  bank_verification_method: { type: String, enum: ["penny_drop", "manual", null], default: null },
  bank_changed_at: { type: Date, default: null },
  commission_percent: { type: Number, default: 20, min: 0, max: 100 },
  order_reject_count: { type: Number, default: 0, min: 0 },
  auto_ban_threshold: { type: Number, default: 5, min: 1 },
  admin_notes: { type: String, default: null },
  verified_at: { type: Date, default: null },
}, {
  timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
});

VendorSchema.index({ email_verification_token: 1 });
VendorSchema.index({ password_reset_token: 1 });

VendorSchema.pre("save", async function (next) {
  if (!this.isModified("password_hash")) return next();
  this.password_hash = await bcrypt.hash(this.password_hash, 10);
  next();
});

VendorSchema.methods.matchPassword = function (plain) {
  return bcrypt.compare(plain, this.password_hash);
};

module.exports = mongoose.model("Vendor", VendorSchema);
