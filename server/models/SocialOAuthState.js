const mongoose = require("mongoose");

const SocialOAuthStateSchema = new mongoose.Schema({
  provider: { type: String, required: true, enum: ["INSTAGRAM"], uppercase: true, index: true },
  state_hash: { type: String, required: true, unique: true, immutable: true, match: /^[a-f0-9]{64}$/ },
  nonce: { type: String, required: true, unique: true, immutable: true, trim: true },
  initiated_by_admin_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, immutable: true, index: true },
  expires_at: { type: Date, required: true, immutable: true },
  consumed_at: { type: Date, default: null, index: true },
}, { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } });

SocialOAuthStateSchema.index({ expires_at: 1 }, { expireAfterSeconds: 24 * 60 * 60 });

module.exports = mongoose.model("SocialOAuthState", SocialOAuthStateSchema);
