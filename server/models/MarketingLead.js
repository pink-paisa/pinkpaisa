const mongoose = require("mongoose");

const MARKETING_LEAD_STATUSES = [
  "NEW",
  "CONTACTED",
  "NURTURING",
  "CONVERTED",
  "UNSUBSCRIBED",
];

const WEALTHNESS_RESULT_TYPES = [
  "overthinker",
  "good-earner",
  "safe-saver",
  "burnt-out",
  "ready-builder",
];

const TouchSchema = new mongoose.Schema({
  utm_source: { type: String, default: null, trim: true, maxlength: 120 },
  utm_medium: { type: String, default: null, trim: true, maxlength: 120 },
  utm_campaign: { type: String, default: null, trim: true, maxlength: 160 },
  utm_content: { type: String, default: null, trim: true, maxlength: 160 },
  utm_term: { type: String, default: null, trim: true, maxlength: 160 },
  gclid: { type: String, default: null, trim: true, maxlength: 240 },
  fbclid: { type: String, default: null, trim: true, maxlength: 240 },
  landing_path: { type: String, default: null, trim: true, maxlength: 500 },
  referrer: { type: String, default: null, trim: true, maxlength: 500 },
  captured_at: { type: Date, default: null },
}, { _id: false, strict: true });

const ConsentSchema = new mongoose.Schema({
  granted: { type: Boolean, required: true, default: false },
  version: { type: String, required: true, trim: true, maxlength: 80 },
  captured_at: { type: Date, required: true },
}, { _id: false, strict: true });

const IdempotencyReceiptSchema = new mongoose.Schema({
  key: { type: String, required: true, trim: true, maxlength: 200 },
  request_fingerprint: { type: String, required: true, maxlength: 64 },
  captured_at: { type: Date, required: true },
}, { _id: false, strict: true });

const MarketingLeadSchema = new mongoose.Schema({
  source: {
    type: String,
    enum: ["WEALTHNESS_QUIZ"],
    default: "WEALTHNESS_QUIZ",
    required: true,
    index: true,
  },
  result_type: { type: String, enum: WEALTHNESS_RESULT_TYPES, required: true, index: true },
  first_name: { type: String, default: null, trim: true, maxlength: 100 },
  email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254, index: true },
  phone: { type: String, default: null, trim: true, maxlength: 30 },
  status: { type: String, enum: MARKETING_LEAD_STATUSES, default: "NEW", required: true, index: true },
  email_consent: { type: ConsentSchema, required: true },
  whatsapp_consent: { type: ConsentSchema, required: true },
  attribution: {
    first_touch: { type: TouchSchema, default: () => ({}) },
    last_touch: { type: TouchSchema, default: () => ({}) },
  },
  idempotency_key: { type: String, required: true, unique: true, trim: true, maxlength: 200 },
  request_fingerprint: { type: String, required: true, immutable: true, maxlength: 64 },
  idempotency_receipts: { type: [IdempotencyReceiptSchema], default: [] },
  dedupe_key: { type: String, required: true, unique: true, immutable: true, maxlength: 64 },
  consented_at: { type: Date, required: true },
  last_captured_at: { type: Date, required: true },
  last_contacted_at: { type: Date, default: null },
  unsubscribed_at: { type: Date, default: null },
  internal_notes: { type: String, default: null, trim: true, maxlength: 4000 },
}, {
  timestamps: true,
  strict: "throw",
});

MarketingLeadSchema.index({ status: 1, createdAt: -1 });
MarketingLeadSchema.index({ email: 1, createdAt: -1 });
MarketingLeadSchema.index({ "idempotency_receipts.key": 1 }, { unique: true, sparse: true });

module.exports = mongoose.model("MarketingLead", MarketingLeadSchema);
module.exports.MARKETING_LEAD_STATUSES = MARKETING_LEAD_STATUSES;
module.exports.WEALTHNESS_RESULT_TYPES = WEALTHNESS_RESULT_TYPES;
