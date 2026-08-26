const mongoose = require("mongoose");

const LICENSE_STATUSES = Object.freeze([
  "OWNED",
  "LICENSED",
  "PUBLIC_DOMAIN",
  "ADMIN_APPROVED",
  "REVOKED",
]);

const USABLE_LICENSE_STATUSES = Object.freeze([
  "OWNED",
  "LICENSED",
  "PUBLIC_DOMAIN",
  "ADMIN_APPROVED",
]);

const RightsEventSchema = new mongoose.Schema({
  license_status: { type: String, required: true, enum: LICENSE_STATUSES, uppercase: true, trim: true },
  confirmed: { type: Boolean, required: true },
  confirmation_statement: { type: String, required: true, trim: true, maxlength: 2000 },
  license_reference: { type: String, default: null, trim: true, maxlength: 2000 },
  recorded_by_admin_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  recorded_at: { type: Date, required: true, default: Date.now },
  source_ip_hash: { type: String, default: null, trim: true, maxlength: 64 },
}, { _id: true });

const SocialAudioTrackSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 180, index: true },
  source: { type: String, required: true, trim: true, maxlength: 1000 },
  original_filename: { type: String, required: true, trim: true, maxlength: 255 },
  storage_provider: { type: String, required: true, enum: ["local"], default: "local" },
  storage_key: { type: String, required: true, unique: true, immutable: true, trim: true, maxlength: 4096 },
  checksum_sha256: {
    type: String,
    required: true,
    unique: true,
    immutable: true,
    lowercase: true,
    trim: true,
    match: /^[a-f0-9]{64}$/,
  },
  mime_type: {
    type: String,
    required: true,
    immutable: true,
    enum: ["audio/mpeg", "audio/mp4", "audio/wav", "audio/ogg"],
  },
  extension: { type: String, required: true, immutable: true, enum: [".mp3", ".m4a", ".wav", ".ogg"] },
  file_size_bytes: { type: Number, required: true, immutable: true, min: 1, max: 25 * 1024 * 1024 },
  duration_seconds: { type: Number, required: true, immutable: true, min: 0.001, max: 15 * 60 },
  audio_codec: { type: String, required: true, immutable: true, trim: true, maxlength: 100 },
  sample_rate_hz: { type: Number, default: null, immutable: true, min: 1, max: 768000 },
  audio_channels: { type: Number, default: null, immutable: true, min: 1, max: 32 },
  license_status: { type: String, required: true, enum: LICENSE_STATUSES, uppercase: true, trim: true, index: true },
  license_reference: { type: String, default: null, trim: true, maxlength: 2000 },
  rights_confirmed: { type: Boolean, required: true, default: false, index: true },
  rights_confirmation_statement: { type: String, required: true, trim: true, maxlength: 2000 },
  rights_confirmed_by_admin_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  rights_confirmed_at: { type: Date, required: true },
  rights_events: { type: [RightsEventSchema], required: true, default: [] },
  uploaded_by_admin_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true, index: true },
  is_active: { type: Boolean, required: true, default: true, index: true },
  deactivated_at: { type: Date, default: null, index: true },
  deactivated_by_admin_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
}, { timestamps: { createdAt: "created_at", updatedAt: "updated_at" }, optimisticConcurrency: true });

SocialAudioTrackSchema.pre("validate", function validateRightsContract() {
  const usable = USABLE_LICENSE_STATUSES.includes(this.license_status);
  if (usable && !this.rights_confirmed) {
    this.invalidate("rights_confirmed", "A usable audio track requires an explicit administrator rights confirmation");
  }
  if (usable && !String(this.rights_confirmation_statement || "").trim()) {
    this.invalidate("rights_confirmation_statement", "A usable audio track requires a rights confirmation statement");
  }
  if (["LICENSED", "PUBLIC_DOMAIN"].includes(this.license_status) && !String(this.license_reference || "").trim()) {
    this.invalidate("license_reference", `${this.license_status} audio requires a licence or public-domain reference`);
  }
  if (this.license_status === "REVOKED" && this.is_active) {
    this.invalidate("is_active", "A revoked audio track cannot remain active");
  }
});

SocialAudioTrackSchema.index({ is_active: 1, rights_confirmed: 1, license_status: 1, created_at: -1 });

SocialAudioTrackSchema.statics.LICENSE_STATUSES = LICENSE_STATUSES;
SocialAudioTrackSchema.statics.USABLE_LICENSE_STATUSES = USABLE_LICENSE_STATUSES;
SocialAudioTrackSchema.statics.isUsable = function isUsable(track = {}) {
  return track.is_active !== false
    && !track.deactivated_at
    && track.rights_confirmed === true
    && USABLE_LICENSE_STATUSES.includes(String(track.license_status || "").toUpperCase());
};

module.exports = mongoose.model("SocialAudioTrack", SocialAudioTrackSchema);
