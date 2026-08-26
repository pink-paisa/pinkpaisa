const mongoose = require("mongoose");

const metricFields = {
  reach: { type: Number, default: null, min: 0 },
  non_follower_reach: { type: Number, default: null, min: 0 },
  views: { type: Number, default: null, min: 0 },
  impressions: { type: Number, default: null, min: 0 },
  likes: { type: Number, default: null, min: 0 },
  comments: { type: Number, default: null, min: 0 },
  saves: { type: Number, default: null, min: 0 },
  shares: { type: Number, default: null, min: 0 },
  total_interactions: { type: Number, default: null, min: 0 },
  video_views: { type: Number, default: null, min: 0 },
  video_completions: { type: Number, default: null, min: 0 },
  completion_rate: { type: Number, default: null, min: 0, max: 1 },
  profile_visits: { type: Number, default: null, min: 0 },
  follows: { type: Number, default: null, min: 0 },
  website_clicks: { type: Number, default: null, min: 0 },
  link_clicks: { type: Number, default: null, min: 0 },
  landing_page_sessions: { type: Number, default: null, min: 0 },
  engaged_sessions: { type: Number, default: null, min: 0 },
  returning_visitors: { type: Number, default: null, min: 0 },
  affiliate_cta_clicks: { type: Number, default: null, min: 0 },
  quiz_starts: { type: Number, default: null, min: 0 },
  quiz_completions: { type: Number, default: null, min: 0 },
  calculator_opens: { type: Number, default: null, min: 0 },
  workshop_enquiries: { type: Number, default: null, min: 0 },
  product_page_visits: { type: Number, default: null, min: 0 },
  negative_feedback: { type: Number, default: null, min: 0 },
  save_rate: { type: Number, default: null, min: 0, max: 1 },
  share_rate: { type: Number, default: null, min: 0, max: 1 },
  comment_rate: { type: Number, default: null, min: 0, max: 1 },
  total_interaction_rate: { type: Number, default: null, min: 0, max: 1 },
  landing_page_engagement_rate: { type: Number, default: null, min: 0, max: 1 },
  quiz_start_rate: { type: Number, default: null, min: 0, max: 1 },
  quiz_completion_rate: { type: Number, default: null, min: 0, max: 1 },
  workshop_enquiry_rate: { type: Number, default: null, min: 0, max: 1 },
  product_page_visit_rate: { type: Number, default: null, min: 0, max: 1 },
  affiliate_click_rate: { type: Number, default: null, min: 0, max: 1 },
};

const SocialMetricSnapshotSchema = new mongoose.Schema(
  {
    snapshot_key: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      trim: true,
      maxlength: 400,
    },
    draft_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SocialPostDraft",
      required: true,
      immutable: true,
      index: true,
    },
    publication_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SocialPublication",
      default: null,
      immutable: true,
      index: true,
    },
    external_publication_id: { type: String, default: null, immutable: true, trim: true, index: true },
    source: {
      type: String,
      required: true,
      enum: ["MANUAL", "INSTAGRAM_GRAPH", "WEBSITE_ANALYTICS", "ATTRIBUTION_JOIN"],
      immutable: true,
      index: true,
      uppercase: true,
      trim: true,
    },
    retrieval_status: {
      type: String,
      required: true,
      enum: ["COMPLETE", "PARTIAL"],
      default: "COMPLETE",
      immutable: true,
      uppercase: true,
      trim: true,
    },
    captured_at: { type: Date, required: true, immutable: true, default: Date.now, index: true },
    attribution_window_hours: { type: Number, default: null, min: 0, immutable: true },
    attribution_window_label: {
      type: String,
      default: null,
      enum: ["1H", "24H", "72H", "7D", "28D", "CUSTOM", null],
      uppercase: true,
      trim: true,
      immutable: true,
    },
    published_at: { type: Date, default: null, immutable: true },
    posting_timezone: { type: String, default: "Asia/Kolkata", enum: ["Asia/Kolkata"], immutable: true },
    posting_local_hour: { type: Number, default: null, min: 0, max: 23, immutable: true },
    posting_local_weekday: {
      type: String,
      default: null,
      enum: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY", null],
      immutable: true,
    },
    metrics: {
      type: new mongoose.Schema(metricFields, { _id: false }),
      required: true,
      immutable: true,
      validate: {
        validator: (value) => Object.keys(metricFields).some((key) => value?.[key] != null),
        message: "A metric snapshot must contain at least one available metric",
      },
    },
    utm_parameters: {
      type: new mongoose.Schema(
        {
          source: { type: String, default: null, trim: true },
          medium: { type: String, default: null, trim: true },
          campaign: { type: String, default: null, trim: true },
          content: { type: String, default: null, trim: true },
        },
        { _id: false }
      ),
      default: null,
      immutable: true,
    },
    provenance_note: { type: String, required: true, immutable: true, trim: true, maxlength: 2000 },
    raw_response_hash: {
      type: String,
      default: null,
      immutable: true,
      lowercase: true,
      trim: true,
      match: /^[a-f0-9]{64}$/,
    },
    recorded_by_admin_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      immutable: true,
    },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

SocialMetricSnapshotSchema.pre("validate", function validateAttributionWindow() {
  const expectedHours = { "1H": 1, "24H": 24, "72H": 72, "7D": 168, "28D": 672 };
  if (this.attribution_window_label && this.attribution_window_label !== "CUSTOM"
    && Number(this.attribution_window_hours) !== expectedHours[this.attribution_window_label]) {
    this.invalidate(
      "attribution_window_hours",
      `attribution_window_hours must be ${expectedHours[this.attribution_window_label]} for ${this.attribution_window_label}`
    );
  }
  if (this.attribution_window_label === "CUSTOM" && this.attribution_window_hours == null) {
    this.invalidate("attribution_window_hours", "CUSTOM attribution windows require attribution_window_hours");
  }
});

SocialMetricSnapshotSchema.index({ draft_id: 1, captured_at: -1 });
SocialMetricSnapshotSchema.index({ publication_id: 1, captured_at: -1 });
SocialMetricSnapshotSchema.index({ source: 1, captured_at: -1 });

function rejectSnapshotMutation(next) {
  const error = new Error("SocialMetricSnapshot records are immutable; create a new snapshot instead");
  error.code = "social_metric_snapshot_immutable";
  next(error);
}

SocialMetricSnapshotSchema.pre("save", function rejectSnapshotResave(next) {
  if (this.isNew) return next();
  return rejectSnapshotMutation(next);
});

SocialMetricSnapshotSchema.pre("deleteOne", { document: true, query: false }, rejectSnapshotMutation);

SocialMetricSnapshotSchema.pre(
  ["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "deleteOne", "deleteMany", "findOneAndDelete"],
  rejectSnapshotMutation
);

SocialMetricSnapshotSchema.statics.METRIC_FIELDS = Object.freeze(Object.keys(metricFields));

module.exports = mongoose.model("SocialMetricSnapshot", SocialMetricSnapshotSchema);
