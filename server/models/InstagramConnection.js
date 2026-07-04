const mongoose = require("mongoose");

const InstagramConnectionSchema = new mongoose.Schema({
  provider: { type: String, enum: ["facebook_login", "instagram_login"], default: "instagram_login", unique: true, index: true },
  status: { type: String, enum: ["disconnected", "pending", "connected", "error"], default: "disconnected", index: true },
  connection_label: { type: String, default: "Pink Paisa Instagram", trim: true },
  login_type: { type: String, default: "instagram_business_login", trim: true },
  account_type: { type: String, default: null, trim: true },
  facebook_user_id: { type: String, default: null, trim: true },
  facebook_page_id: { type: String, default: null, trim: true },
  facebook_page_name: { type: String, default: null, trim: true },
  instagram_user_id: { type: String, default: null, trim: true },
  instagram_username: { type: String, default: null, trim: true },
  instagram_name: { type: String, default: null, trim: true },
  profile_picture_url: { type: String, default: null, trim: true },
  user_access_token_encrypted: { type: String, default: null },
  page_access_token_encrypted: { type: String, default: null },
  granted_scopes: [{ type: String }],
  token_storage_mode: { type: String, enum: ["plain", "encrypted"], default: "plain" },
  token_expires_at: { type: Date, default: null },
  last_connected_at: { type: Date, default: null },
  last_refreshed_at: { type: Date, default: null },
  last_publish_at: { type: Date, default: null },
  last_error: { type: String, default: null },
  metadata_json: { type: mongoose.Schema.Types.Mixed, default: null },
}, { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } });

module.exports = mongoose.model("InstagramConnection", InstagramConnectionSchema);
