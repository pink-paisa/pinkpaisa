const mongoose = require("mongoose");

const EMAIL_OUTBOX_STATUSES = ["QUEUED", "PROCESSING", "RETRY", "SENT", "FAILED", "CANCELLED"];

const EmailOutboxSchema = new mongoose.Schema({
  kind: { type: String, enum: ["WEALTHNESS_ROADMAP"], required: true, index: true },
  lead_id: { type: mongoose.Schema.Types.ObjectId, ref: "MarketingLead", required: true, index: true },
  recipient_email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
  template_version: { type: String, required: true, trim: true, maxlength: 80 },
  payload: { type: mongoose.Schema.Types.Mixed, required: true },
  status: { type: String, enum: EMAIL_OUTBOX_STATUSES, default: "QUEUED", required: true, index: true },
  attempt_count: { type: Number, default: 0, min: 0 },
  max_attempts: { type: Number, default: 5, min: 1, max: 10 },
  next_attempt_at: { type: Date, default: Date.now, index: true },
  processing_started_at: { type: Date, default: null },
  lease_expires_at: { type: Date, default: null, index: true },
  delivered_at: { type: Date, default: null },
  provider_message_id: { type: String, default: null, trim: true, maxlength: 300 },
  last_error: { type: String, default: null, trim: true, maxlength: 1000 },
}, {
  timestamps: true,
  strict: "throw",
});

EmailOutboxSchema.index(
  { lead_id: 1, kind: 1, template_version: 1 },
  { unique: true, name: "email_outbox_lead_kind_template_unique" },
);
EmailOutboxSchema.index({ status: 1, next_attempt_at: 1, createdAt: 1 });

module.exports = mongoose.model("EmailOutbox", EmailOutboxSchema);
module.exports.EMAIL_OUTBOX_STATUSES = EMAIL_OUTBOX_STATUSES;
