const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const UserSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  role: { type: String, enum: ["user", "admin"], default: "user" },
  full_name: { type: String, default: null, trim: true },
  phone: { type: String, default: null, trim: true },
  address: { type: String, default: null, trim: true },
  city: { type: String, default: null, trim: true },
  state: { type: String, default: null, trim: true },
  pincode: { type: String, default: null, trim: true },
  email_verified: { type: Boolean, default: false },
  email_verification_token: { type: String, default: null, select: false },
  email_verification_expires_at: { type: Date, default: null },
  password_reset_token: { type: String, default: null, select: false },
  password_reset_expires_at: { type: Date, default: null },
  failed_login_attempts: { type: Number, default: 0, min: 0 },
  locked_until: { type: Date, default: null },
  last_login_at: { type: Date, default: null },
  last_login_ip: { type: String, default: null, trim: true },
  wallet_balance: { type: Number, default: 0, min: 0 },
  cart_snapshot_json: { type: [mongoose.Schema.Types.Mixed], default: [] },
}, { timestamps: true });

UserSchema.index({ email_verification_token: 1 });
UserSchema.index({ password_reset_token: 1 });

UserSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

UserSchema.methods.matchPassword = function (plain) {
  return bcrypt.compare(plain, this.password);
};

module.exports = mongoose.model("User", UserSchema);
