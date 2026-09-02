const mongoose = require("mongoose");

const ValidationCheckSchema = new mongoose.Schema({
  key: { type: String, required: true, trim: true },
  label: { type: String, required: true, trim: true },
  status: { type: String, enum: ["PASS", "FAIL", "MANUAL_REVIEW"], required: true },
  required: { type: Boolean, default: true },
  details: { type: String, default: null, trim: true },
}, { _id: false });

const OriginalVisualSchema = new mongoose.Schema({
  url: { type: String, required: true, trim: true, maxlength: 4096 },
  storage_provider: { type: String, enum: ["local", "external"], required: true },
  storage_key: { type: String, required: true, trim: true, maxlength: 4096 },
  checksum_sha256: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    match: /^[a-f0-9]{64}$/,
  },
  mime_type: { type: String, enum: ["image/jpeg", "image/png", "image/webp"], required: true },
  file_size_bytes: { type: Number, required: true, min: 1 },
  width: { type: Number, required: true, min: 1, max: 10000 },
  height: { type: Number, required: true, min: 1, max: 10000 },
}, { _id: false });

const ReferenceAssetSchema = new mongoose.Schema({
  reference_type: {
    type: String,
    enum: ["BRAND_LOGO", "BRAND_PALETTE", "WEBSITE", "APPROVED_CREATIVE", "PRODUCT_IMAGE"],
    required: true,
  },
  product_id: { type: mongoose.Schema.Types.ObjectId, ref: "Product", default: null },
  url: { type: String, default: null, trim: true, maxlength: 4096 },
  original_database_url: { type: String, default: null, trim: true, maxlength: 4096 },
  stored_url: { type: String, default: null, trim: true, maxlength: 4096 },
  storage_provider: { type: String, enum: ["local", "external", null], default: null },
  storage_key: { type: String, default: null, trim: true, maxlength: 4096 },
  checksum_sha256: {
    type: String,
    default: null,
    trim: true,
    lowercase: true,
    match: /^[a-f0-9]{64}$/,
  },
  mime_type: { type: String, enum: ["image/jpeg", "image/png", "image/webp", null], default: null },
  detected_file_signature: { type: String, enum: ["jpeg", "png", "webp", null], default: null },
  file_size_bytes: { type: Number, default: null, min: 1 },
  width: { type: Number, default: null, min: 1, max: 16384 },
  height: { type: Number, default: null, min: 1, max: 16384 },
  database_record_verified: { type: Boolean, default: false },
  source_bytes_preserved: { type: Boolean, default: false },
  usage_rights_status: {
    type: String,
    enum: ["owned", "licensed", "admin_confirmed", "api_permitted", "unknown"],
    default: "unknown",
  },
  authenticity_must_be_preserved: { type: Boolean, default: false },
}, { _id: false });

const SocialAssetSchema = new mongoose.Schema({
  draft_id: { type: mongoose.Schema.Types.ObjectId, ref: "SocialPostDraft", default: null, index: true },
  generation_run_id: { type: mongoose.Schema.Types.ObjectId, ref: "SocialGenerationRun", default: null, index: true },
  draft_key: { type: String, required: true, trim: true, index: true },
  asset_group_id: { type: String, required: true, trim: true, index: true },
  version: { type: String, required: true, trim: true },
  asset_role: {
    type: String,
    enum: [
      "ORIGINAL_AI_VISUAL",
      "FINAL_COMPOSED",
      "PRODUCT_REFERENCE",
      "GENERATED_FRAME",
      "FINAL_VIDEO",
      "VOICEOVER_AUDIO",
      "SUBTITLE_TRACK",
      "STORYBOARD",
    ],
    default: "FINAL_COMPOSED",
    required: true,
    index: true,
  },
  perceptual_hash_64: {
    type: String,
    default: null,
    trim: true,
    lowercase: true,
    match: /^[a-f0-9]{16}$/,
    index: true,
  },
  asset_type: {
    type: String,
    enum: [
      "feed_post",
      "square_post",
      "story_frame",
      "story_video",
      "reel_cover",
      "reel_video",
      "video_feed",
      "carousel_slide",
      "voiceover_audio",
      "subtitle_file",
      "storyboard",
    ],
    required: true,
    index: true,
  },
  social_format: {
    type: String,
    enum: [
      "SINGLE_IMAGE",
      "CAROUSEL",
      "REEL",
      "VIDEO_FEED",
      "STORY",
      "INFOGRAPHIC",
      "MEME",
      "QUIZ",
      "POLL",
      "POLL_CONCEPT",
      "PRODUCT_FEATURE",
      "RESOURCE_PROMOTION",
      "EVENT_OR_WORKSHOP_PROMOTION",
      "WORKSHOP_PROMOTION",
    ],
    required: true,
  },
  visual_mode: {
    type: String,
    enum: ["AI_VISUAL_WITH_EXACT_OVERLAY", "AI_BRANDED_ARTWORK", "AI_ARTWORK_ONLY", "FULL_AI_GRAPHIC", "MANUAL_TEMPLATE"],
    default: "AI_VISUAL_WITH_EXACT_OVERLAY",
    required: true,
    index: true,
  },
  brand_logo_evidence: { type: mongoose.Schema.Types.Mixed, default: null },
  canvas_format: {
    type: String,
    enum: ["FEED_4_5", "SQUARE_1_1", "VERTICAL_9_16", null],
    default: null,
    required() { return ["IMAGE", "VIDEO"].includes(this.media_kind); },
  },
  slide_number: { type: Number, default: null, min: 1, max: 20 },
  url: { type: String, required: true, unique: true, trim: true },
  storage_provider: { type: String, enum: ["local", "external"], required: true },
  storage_key: { type: String, required: true, trim: true },
  checksum_sha256: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    match: /^[a-f0-9]{64}$/,
    index: true,
  },
  media_kind: {
    type: String,
    enum: ["IMAGE", "VIDEO", "AUDIO", "SUBTITLE", "STORYBOARD"],
    default: "IMAGE",
    required: true,
    index: true,
  },
  publication_role: {
    type: String,
    enum: ["PRIMARY_MEDIA", "COVER", "COMPANION", "NOT_PUBLISHABLE"],
    default() {
      if (this.asset_type === "reel_cover") return "COVER";
      if (["AUDIO", "SUBTITLE", "STORYBOARD"].includes(this.media_kind)) return "NOT_PUBLISHABLE";
      return "PRIMARY_MEDIA";
    },
    required: true,
    index: true,
  },
  mime_type: {
    type: String,
    enum: [
      "image/jpeg",
      "image/png",
      "image/webp",
      "video/mp4",
      "video/quicktime",
      "video/webm",
      "audio/mpeg",
      "audio/mp4",
      "audio/aac",
      "audio/wav",
      "audio/ogg",
      "text/vtt",
      "application/x-subrip",
      "text/plain",
      "application/json",
    ],
    default() { return this.media_kind === "IMAGE" ? "image/jpeg" : undefined; },
    required: true,
  },
  file_size_bytes: { type: Number, required: true, min: 1 },
  width: {
    type: Number,
    default: null,
    required() { return ["IMAGE", "VIDEO"].includes(this.media_kind); },
    min: 1,
    max: 16384,
  },
  height: {
    type: Number,
    default: null,
    required() { return ["IMAGE", "VIDEO"].includes(this.media_kind); },
    min: 1,
    max: 16384,
  },
  aspect_ratio: {
    type: String,
    default: null,
    required() { return ["IMAGE", "VIDEO"].includes(this.media_kind); },
    enum: ["4:5", "1:1", "9:16", "16:9", null],
  },
  duration_seconds: { type: Number, default: null, min: 0.001, max: 60 * 60 * 24 },
  frame_rate_fps: { type: Number, default: null, min: 0.001, max: 240 },
  video_codec: { type: String, default: null, trim: true, maxlength: 100 },
  audio_codec: { type: String, default: null, trim: true, maxlength: 100 },
  bit_rate_bps: { type: Number, default: null, min: 1 },
  sample_rate_hz: { type: Number, default: null, min: 1, max: 768000 },
  audio_channels: { type: Number, default: null, min: 1, max: 32 },
  subtitle_language: { type: String, default: null, trim: true, maxlength: 40 },
  frame_count: { type: Number, default: null, min: 1 },
  renderer: {
    type: String,
    default() { return this.media_kind === "IMAGE" ? "sharp_svg_overlay" : null; },
    trim: true,
  },
  render_version: {
    type: String,
    required() { return this.asset_role === "FINAL_COMPOSED"; },
    default: null,
    trim: true,
  },
  overlay_json: {
    type: mongoose.Schema.Types.Mixed,
    required() { return this.asset_role === "FINAL_COMPOSED"; },
    default: null,
  },
  approved_copy_checksum_sha256: {
    type: String,
    required() { return this.asset_role === "FINAL_COMPOSED"; },
    default: null,
    trim: true,
    lowercase: true,
    match: /^[a-f0-9]{64}$/,
  },
  image_generation_status: {
    type: String,
    enum: ["NOT_APPLICABLE", "PENDING", "RUNNING", "GENERATED", "VALIDATED", "FAILED"],
    default() { return this.media_kind === "IMAGE" ? "PENDING" : "NOT_APPLICABLE"; },
    required: true,
    index: true,
  },
  image_provider: { type: String, default: null, trim: true, index: true },
  image_model: { type: String, default: null, trim: true },
  image_prompt: { type: String, default: null, trim: true, maxlength: 12000 },
  negative_visual_instructions: { type: [String], default: [] },
  provider_request_id: { type: String, default: null, trim: true },
  provider_response_id: { type: String, default: null, trim: true, index: true },
  image_retry_number: { type: Number, default: 0, min: 0, max: 20 },
  image_generated_at: { type: Date, default: null },
  image_usage: { type: mongoose.Schema.Types.Mixed, default: null },
  image_estimated_cost: { type: Number, default: 0, min: 0 },
  image_cost_currency: { type: String, default: "USD", uppercase: true, trim: true },
  original_visual: { type: OriginalVisualSchema, default: null },
  reference_assets: { type: [ReferenceAssetSchema], default: [] },
  provenance: { type: mongoose.Schema.Types.Mixed, required: true },
  source_provenance: {
    type: String,
    enum: [
      "brand_template",
      "admin_provided",
      "vendor_provided",
      "uploaded",
      "generated",
      "generated_from_approved_source",
      "generated_without_reference",
      "product_reference",
      "licensed",
      "unknown",
    ],
    default: "brand_template",
  },
  usage_rights_status: {
    type: String,
    enum: ["owned", "licensed", "admin_confirmed", "api_permitted", "unknown"],
    default: "unknown",
  },
  validation_checklist: { type: [ValidationCheckSchema], default: [] },
  validation_status: {
    type: String,
    enum: ["valid", "needs_manual_review", "invalid"],
    default: "needs_manual_review",
    index: true,
  },
  manual_review_required: { type: Boolean, default: true, index: true },
  manual_review_flags: [{ type: String, trim: true }],
  manual_review_status: {
    type: String,
    enum: ["pending", "approved", "rejected", "not_required"],
    default: "pending",
    index: true,
  },
  manual_reviewed_at: { type: Date, default: null },
  manual_reviewed_by: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  is_active: { type: Boolean, default: true, index: true },
  deleted_at: { type: Date, default: null, index: true },
}, { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } });

const MIME_TYPES_BY_MEDIA_KIND = Object.freeze({
  IMAGE: new Set(["image/jpeg", "image/png", "image/webp"]),
  VIDEO: new Set(["video/mp4", "video/quicktime", "video/webm"]),
  AUDIO: new Set(["audio/mpeg", "audio/mp4", "audio/aac", "audio/wav", "audio/ogg"]),
  SUBTITLE: new Set(["text/vtt", "application/x-subrip", "text/plain"]),
  STORYBOARD: new Set(["application/json"]),
});

SocialAssetSchema.pre("validate", function validateMediaContract() {
  const allowedMimeTypes = MIME_TYPES_BY_MEDIA_KIND[this.media_kind];
  if (allowedMimeTypes && !allowedMimeTypes.has(this.mime_type)) {
    this.invalidate("mime_type", `${this.mime_type} is not valid for media_kind ${this.media_kind}`);
  }
  if (["VIDEO", "AUDIO"].includes(this.media_kind) && !Number.isFinite(Number(this.duration_seconds))) {
    this.invalidate("duration_seconds", `${this.media_kind} assets require duration_seconds`);
  }
  if (this.media_kind === "VIDEO" && !Number.isFinite(Number(this.frame_rate_fps))) {
    this.invalidate("frame_rate_fps", "VIDEO assets require frame_rate_fps");
  }
  if (this.media_kind === "VIDEO" && !String(this.video_codec || "").trim()) {
    this.invalidate("video_codec", "VIDEO assets require video_codec");
  }
  if (this.media_kind === "AUDIO" && !String(this.audio_codec || "").trim()) {
    this.invalidate("audio_codec", "AUDIO assets require audio_codec");
  }
  if (this.media_kind === "SUBTITLE" && !String(this.subtitle_language || "").trim()) {
    this.invalidate("subtitle_language", "SUBTITLE assets require subtitle_language");
  }
  if (this.publication_role === "PRIMARY_MEDIA" && ["REEL", "VIDEO_FEED"].includes(this.social_format)) {
    if (this.media_kind !== "VIDEO" || !["reel_video", "video_feed"].includes(this.asset_type)) {
      this.invalidate(
        "publication_role",
        `${this.social_format} primary publication media must be a real video asset, not a cover image`
      );
    }
  }
  if (this.asset_type === "reel_cover" && this.publication_role !== "COVER") {
    this.invalidate("publication_role", "A reel cover cannot be used as primary publication media");
  }
});

SocialAssetSchema.index({ draft_key: 1, is_active: 1, created_at: -1 });
SocialAssetSchema.index({ draft_id: 1, asset_group_id: 1, asset_role: 1, slide_number: 1 });
SocialAssetSchema.index({ asset_group_id: 1, asset_role: 1, slide_number: 1 }, { unique: true });
SocialAssetSchema.index({ generation_run_id: 1, image_generation_status: 1, created_at: -1 });
SocialAssetSchema.index({ draft_id: 1, media_kind: 1, publication_role: 1, is_active: 1 });

SocialAssetSchema.statics.MEDIA_KINDS = Object.freeze(Object.keys(MIME_TYPES_BY_MEDIA_KIND));
SocialAssetSchema.statics.MIME_TYPES_BY_MEDIA_KIND = MIME_TYPES_BY_MEDIA_KIND;
SocialAssetSchema.statics.isPublishablePrimaryMedia = function isPublishablePrimaryMedia(asset = {}, format = null) {
  const socialFormat = String(format || asset.social_format || "").toUpperCase();
  if (asset.publication_role !== "PRIMARY_MEDIA" || asset.is_active === false || asset.deleted_at) return false;
  if (["REEL", "VIDEO_FEED"].includes(socialFormat)) {
    return asset.media_kind === "VIDEO" && ["reel_video", "video_feed"].includes(asset.asset_type);
  }
  return asset.media_kind === "IMAGE" || asset.media_kind === "VIDEO";
};

module.exports = mongoose.model("SocialAsset", SocialAssetSchema);
