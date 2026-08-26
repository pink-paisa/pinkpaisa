const crypto = require("crypto");
const mongoose = require("mongoose");

const COMMUNITY_STATUSES = Object.freeze([
  "NEW", "OPEN", "CLASSIFIED", "RECOMMENDATION_QUEUED", "RECOMMENDATION_PROCESSING",
  "REPLY_RECOMMENDED", "NEEDS_REVIEW", "APPROVED", "SEND_QUEUED", "SEND_PROCESSING",
  "SEND_UNCERTAIN",
  "SENT", "RESPONDED", "REJECTED", "ESCALATED", "HIDDEN", "ARCHIVED", "FAILED",
  "MANUAL_ACTION_REQUIRED",
]);
const SOURCE_TYPES = Object.freeze([
  "COMMENT", "REPLY", "MESSAGE", "PRIVATE_REPLY", "MENTION", "TAGGED_POST",
  "STORY_MENTION", "DIRECT_MESSAGE",
]);
const CLASSIFICATIONS = Object.freeze([
  "QUESTION", "COMPLIMENT", "COMPLAINT", "LEAD", "PRODUCT_QUESTION", "FINANCIAL_QUESTION",
  "WORKSHOP_QUESTION", "AFFILIATE_PRODUCT_QUESTION", "SPAM", "ABUSE", "SENSITIVE",
  "ESCALATION_REQUIRED", "OTHER",
]);
const APPROVAL_STATUSES = Object.freeze(["PENDING", "APPROVED", "REJECTED", "REVISION_REQUIRED"]);
const RECOMMENDATION_JOB_STATUSES = Object.freeze(["QUEUED", "PROCESSING", "COMPLETED", "FAILED"]);
const SEND_INTENT_STATUSES = Object.freeze(["QUEUED", "PROCESSING", "CONFIRMED", "UNCERTAIN", "FAILED"]);
const CHECKSUM_PATTERN = /^[a-f0-9]{64}$/;
const FORBIDDEN_SECRET_KEYS = /^(?:authorization|access_token|refresh_token|password|private_key|client_secret|app_secret|cookie)$/i;

function containsSecretKey(value, depth = 0) {
  if (depth > 10 || value == null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => containsSecretKey(item, depth + 1));
  return Object.entries(value).some(([key, child]) => FORBIDDEN_SECRET_KEYS.test(key) || containsSecretKey(child, depth + 1));
}

const promptRunSchema = new mongoose.Schema({
  agent_role: { type: String, required: true, uppercase: true, trim: true, maxlength: 100 },
  stage: { type: String, required: true, trim: true, maxlength: 100 },
  provider: { type: String, required: true, trim: true, maxlength: 80 },
  model: { type: String, default: null, trim: true, maxlength: 200 },
  prompt_version: { type: String, default: null, trim: true, maxlength: 160 },
  prompt_version_id: { type: mongoose.Schema.Types.ObjectId, ref: "SocialPromptVersion", default: null },
  input_context_checksum: { type: String, default: null, lowercase: true, trim: true, match: CHECKSUM_PATTERN },
  output_checksum: { type: String, default: null, lowercase: true, trim: true, match: CHECKSUM_PATTERN },
  response_id: { type: String, default: null, trim: true, maxlength: 300 },
  usage: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  start_time: { type: Date, default: null },
  completion_time: { type: Date, default: null },
  retry_count: { type: Number, default: 0, min: 0, max: 20 },
  failure_reason: { type: String, default: null, trim: true, maxlength: 4000 },
}, { _id: false, strict: "throw" });

const recommendationSchema = new mongoose.Schema({
  classification: { type: String, required: true, enum: CLASSIFICATIONS, uppercase: true, trim: true },
  suggestedReply: { type: String, default: null, trim: true, maxlength: 1200 },
  confidence: { type: Number, required: true, min: 0, max: 1 },
  sourceInformationUsed: { type: [{ type: String, trim: true, maxlength: 300 }], default: [] },
  riskFlags: { type: [{ type: String, trim: true, maxlength: 300 }], default: [] },
  escalationRecommended: { type: Boolean, required: true },
  escalationReason: { type: String, default: null, trim: true, maxlength: 800 },
  sendAllowedAfterApproval: { type: Boolean, required: true, default: false },
  conciseRationale: { type: String, required: true, trim: true, maxlength: 800 },
  prompt_run: { type: promptRunSchema, required: true },
  generated_at: { type: Date, required: true },
}, { _id: false, strict: "throw" });

const approvalSchema = new mongoose.Schema({
  status: { type: String, required: true, enum: APPROVAL_STATUSES, default: "PENDING", uppercase: true, trim: true },
  approved_by_admin_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  approved_at: { type: Date, default: null },
  approved_reply: { type: String, default: null, trim: true, maxlength: 1200 },
  approved_reply_checksum: { type: String, default: null, lowercase: true, trim: true, match: CHECKSUM_PATTERN },
  rejected_by_admin_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  rejected_at: { type: Date, default: null },
  reason: { type: String, default: null, trim: true, maxlength: 1000 },
}, { _id: false, strict: "throw" });

const recommendationJobSchema = new mongoose.Schema({
  status: { type: String, required: true, enum: RECOMMENDATION_JOB_STATUSES, uppercase: true, trim: true },
  queued_at: { type: Date, required: true },
  claimed_at: { type: Date, default: null },
  claimed_by: { type: String, default: null, trim: true, maxlength: 300 },
  lease_expires_at: { type: Date, default: null },
  completed_at: { type: Date, default: null },
  attempt_count: { type: Number, default: 0, min: 0, max: 20 },
  last_error_code: { type: String, default: null, trim: true, maxlength: 200 },
  last_error_message: { type: String, default: null, trim: true, maxlength: 2000 },
}, { _id: false, strict: "throw" });

const sendIntentSchema = new mongoose.Schema({
  status: { type: String, required: true, enum: SEND_INTENT_STATUSES, uppercase: true, trim: true },
  idempotency_key: { type: String, required: true, immutable: true, trim: true, maxlength: 400 },
  approved_reply_checksum: { type: String, required: true, immutable: true, lowercase: true, trim: true, match: CHECKSUM_PATTERN },
  provider_idempotency_key: { type: String, required: true, immutable: true, trim: true, maxlength: 300 },
  queued_at: { type: Date, required: true },
  claimed_at: { type: Date, default: null },
  claimed_by: { type: String, default: null, trim: true, maxlength: 300 },
  claim_token: { type: String, default: null, trim: true, maxlength: 100 },
  lease_expires_at: { type: Date, default: null },
  attempt_count: { type: Number, default: 0, min: 0, max: 20 },
  confirmed_at: { type: Date, default: null },
  uncertain_at: { type: Date, default: null },
  reconciled_at: { type: Date, default: null },
  reconciled_by_admin_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  reconciliation_manual_action_id: { type: mongoose.Schema.Types.ObjectId, ref: "SocialManualAction", default: null },
  reconciliation_external_reply_id: { type: String, default: null, trim: true, maxlength: 300 },
  reconciliation_notes: { type: String, default: null, trim: true, maxlength: 2000 },
  last_error_code: { type: String, default: null, trim: true, maxlength: 200 },
  last_error_message: { type: String, default: null, trim: true, maxlength: 2000 },
}, { _id: false, strict: "throw" });

const escalationSchema = new mongoose.Schema({
  required: { type: Boolean, required: true, default: false },
  reason: { type: String, default: null, trim: true, maxlength: 1000 },
  recommended_at: { type: Date, default: null },
  acknowledged_by_admin_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  acknowledged_at: { type: Date, default: null },
  acknowledgement_notes: { type: String, default: null, trim: true, maxlength: 2000 },
  resolved_by_admin_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  resolved_at: { type: Date, default: null },
  resolution_notes: { type: String, default: null, trim: true, maxlength: 2000 },
}, { _id: false, strict: "throw" });

const sendResultSchema = new mongoose.Schema({
  external_reply_id: { type: String, required: true, trim: true, maxlength: 300 },
  sent_at: { type: Date, required: true },
  sent_by_admin_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  confirmation_source: {
    type: String,
    required: true,
    enum: ["PROVIDER_RESPONSE", "ADMIN_RECONCILIATION"],
    default: "PROVIDER_RESPONSE",
    uppercase: true,
    trim: true,
  },
  confirmed_by_admin_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
}, { _id: false, strict: "throw" });

const riskSchema = new mongoose.Schema({
  level: { type: String, required: true, enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"], uppercase: true, trim: true },
  flags: { type: [{ type: String, trim: true, maxlength: 300 }], default: [] },
  rationale: { type: String, default: null, trim: true, maxlength: 1000 },
}, { _id: false, strict: "throw" });

const SocialCommunityItemSchema = new mongoose.Schema({
  external_event_id: { type: String, required: true, unique: true, immutable: true, trim: true, maxlength: 300 },
  webhook_delivery_id: { type: String, default: null, immutable: true, trim: true, maxlength: 300 },
  event_payload_hash: { type: String, default: null, immutable: true, lowercase: true, trim: true, match: CHECKSUM_PATTERN },
  webhook_signature_verified: { type: Boolean, default: null, immutable: true },
  provider: { type: String, required: true, enum: ["META", "INSTAGRAM"], default: "META", uppercase: true, trim: true, index: true },
  source_type: { type: String, required: true, enum: SOURCE_TYPES, uppercase: true, trim: true, index: true },
  external_object_id: { type: String, required: true, immutable: true, trim: true, maxlength: 300, index: true },
  author_external_id: { type: String, default: null, immutable: true, trim: true, maxlength: 300 },
  author_label: { type: String, default: null, trim: true, maxlength: 200 },
  text: { type: String, default: "", trim: true, maxlength: 4000 },
  permalink: { type: String, default: null, trim: true, maxlength: 2048 },
  occurred_at: { type: Date, required: true, immutable: true, default: Date.now, index: true },
  status: { type: String, required: true, enum: COMMUNITY_STATUSES, default: "NEW", uppercase: true, trim: true, index: true },
  classification: { type: String, default: null, enum: [...CLASSIFICATIONS, null], uppercase: true, trim: true },
  recommendation: { type: recommendationSchema, default: null },
  recommendation_job: { type: recommendationJobSchema, default: null },
  approval: { type: approvalSchema, default: () => ({ status: "PENDING" }) },
  send_intent: { type: sendIntentSchema, default: null },
  send_result: { type: sendResultSchema, default: null },
  escalation: { type: escalationSchema, default: () => ({ required: false }) },
  risk: { type: riskSchema, default: null },
  risk_flags: { type: [{ type: String, trim: true, maxlength: 300 }], default: [] },
}, {
  timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  optimisticConcurrency: true,
  strict: "throw",
});

SocialCommunityItemSchema.pre("validate", function validateCommunitySafety() {
  if (containsSecretKey(this.recommendation?.toObject?.() || this.recommendation)) this.invalidate("recommendation", "recommendation must not contain credential material");
  if (["NEEDS_REVIEW", "APPROVED", "SEND_QUEUED", "SEND_PROCESSING", "SEND_UNCERTAIN", "SENT"].includes(this.status) && !this.recommendation) this.invalidate("recommendation", `${this.status} requires an AI recommendation`);
  if (this.status === "RECOMMENDATION_QUEUED" && this.recommendation_job?.status !== "QUEUED") this.invalidate("recommendation_job", "RECOMMENDATION_QUEUED requires a queued recommendation job");
  if (this.status === "RECOMMENDATION_PROCESSING" && this.recommendation_job?.status !== "PROCESSING") this.invalidate("recommendation_job", "RECOMMENDATION_PROCESSING requires a claimed recommendation job");
  if (this.status === "APPROVED" && (this.approval?.status !== "APPROVED" || !this.approval?.approved_by_admin_id || !this.approval?.approved_at)) this.invalidate("approval", "APPROVED requires a recorded human approver and time");
  if (this.status === "REJECTED" && (this.approval?.status !== "REJECTED" || !this.approval?.rejected_by_admin_id || !this.approval?.rejected_at || !String(this.approval?.reason || "").trim())) this.invalidate("approval", "REJECTED requires a recorded human reviewer, time, and reason");
  if (this.status === "SENT") {
    if (this.approval?.status !== "APPROVED" || !this.approval?.approved_by_admin_id || !this.approval?.approved_at) this.invalidate("approval", "SENT requires prior human approval");
    if (!this.send_result?.external_reply_id || !this.send_result?.sent_at || !this.send_result?.sent_by_admin_id) this.invalidate("send_result", "SENT requires a confirmed provider reply identifier and sending actor");
    if (this.recommendation?.sendAllowedAfterApproval !== true) this.invalidate("recommendation.sendAllowedAfterApproval", "The AI recommendation must explicitly allow sending after approval");
    if (this.send_intent
      && (this.send_intent.status !== "CONFIRMED"
        || this.send_intent.approved_reply_checksum !== this.approval?.approved_reply_checksum)) {
      this.invalidate("send_intent", "SENT requires a confirmed send intent matching the exact approved reply");
    }
    if (this.send_result?.confirmation_source === "ADMIN_RECONCILIATION") {
      if (!this.send_result?.confirmed_by_admin_id) this.invalidate("send_result.confirmed_by_admin_id", "Administrator reconciliation requires the reconciling administrator");
      if (this.send_intent?.status !== "CONFIRMED"
        || !this.send_intent?.reconciled_at
        || !this.send_intent?.reconciled_by_admin_id
        || !this.send_intent?.reconciliation_manual_action_id
        || this.send_intent?.reconciliation_external_reply_id !== this.send_result?.external_reply_id) {
        this.invalidate("send_intent", "Administrator reconciliation requires a matching confirmed send intent and external reply identifier");
      }
      if ([this.author_external_id, this.external_object_id]
        .filter(Boolean)
        .some((identifier) => String(identifier) === String(this.send_result?.external_reply_id))) {
        this.invalidate("send_result.external_reply_id", "A recipient or incoming-object identifier cannot confirm an administrator-reconciled reply");
      }
    }
  }
  if (["SEND_QUEUED", "SEND_PROCESSING", "SEND_UNCERTAIN"].includes(this.status)) {
    if (this.approval?.status !== "APPROVED" || !this.approval?.approved_by_admin_id || !this.approval?.approved_at) this.invalidate("approval", `${this.status} requires prior human approval`);
    if (!String(this.approval?.approved_reply || "").trim() || !CHECKSUM_PATTERN.test(String(this.approval?.approved_reply_checksum || ""))) this.invalidate("approval.approved_reply_checksum", `${this.status} requires the exact approved reply and checksum`);
    const approvedReplyChecksum = crypto.createHash("sha256").update(String(this.approval?.approved_reply || "").trim(), "utf8").digest("hex");
    if (approvedReplyChecksum !== this.approval?.approved_reply_checksum || approvedReplyChecksum !== this.send_intent?.approved_reply_checksum) this.invalidate("approval.approved_reply_checksum", `${this.status} requires matching approval and send-intent checksums`);
    const expectedSendStatus = ({ SEND_QUEUED: "QUEUED", SEND_PROCESSING: "PROCESSING", SEND_UNCERTAIN: "UNCERTAIN" })[this.status];
    if (this.send_intent?.status !== expectedSendStatus) this.invalidate("send_intent", `${this.status} requires a matching durable send intent`);
    if (this.recommendation?.sendAllowedAfterApproval !== true || this.escalation?.required === true) this.invalidate("recommendation.sendAllowedAfterApproval", `${this.status} is blocked for unsafe or escalated recommendations`);
  }
  const sensitive = ["SENSITIVE", "ESCALATION_REQUIRED"].includes(this.classification) || ["HIGH", "CRITICAL"].includes(this.risk?.level);
  if (sensitive && !this.escalation?.required) this.invalidate("escalation", "Sensitive or high-risk items require escalation");
  if (this.escalation?.required && !String(this.escalation?.reason || "").trim()) this.invalidate("escalation.reason", "Escalation requires a reason");
  if (this.escalation?.acknowledged_at
    && (!this.escalation?.acknowledged_by_admin_id || !String(this.escalation?.acknowledgement_notes || "").trim())) {
    this.invalidate("escalation.acknowledgement_notes", "Acknowledged escalations require an administrator, time, and notes");
  }
  if (this.escalation?.resolved_at
    && (!this.escalation?.resolved_by_admin_id
      || !String(this.escalation?.resolution_notes || "").trim()
      || !this.escalation?.acknowledged_at)) {
    this.invalidate("escalation.resolution_notes", "Resolved escalations require prior acknowledgement, a resolving administrator, time, and notes");
  }
  if (this.escalation?.resolved_at && this.status !== "ARCHIVED") {
    this.invalidate("status", "Resolved escalations must be archived without a send action");
  }
});

SocialCommunityItemSchema.index({ provider: 1, source_type: 1, external_event_id: 1 }, { unique: true });
SocialCommunityItemSchema.index({ status: 1, occurred_at: -1 });
SocialCommunityItemSchema.index({ "approval.status": 1, status: 1, occurred_at: -1 });
SocialCommunityItemSchema.index({ "escalation.required": 1, "risk.level": 1, occurred_at: -1 });
SocialCommunityItemSchema.index({ "send_result.external_reply_id": 1 }, { unique: true, sparse: true });
SocialCommunityItemSchema.index({ "send_intent.idempotency_key": 1 }, { unique: true, sparse: true });
SocialCommunityItemSchema.index({ status: 1, "recommendation_job.lease_expires_at": 1, occurred_at: 1 });
SocialCommunityItemSchema.index({ status: 1, "send_intent.lease_expires_at": 1, occurred_at: 1 });

SocialCommunityItemSchema.statics.COMMUNITY_STATUSES = COMMUNITY_STATUSES;
SocialCommunityItemSchema.statics.SOURCE_TYPES = SOURCE_TYPES;
SocialCommunityItemSchema.statics.CLASSIFICATIONS = CLASSIFICATIONS;
SocialCommunityItemSchema.statics.APPROVAL_STATUSES = APPROVAL_STATUSES;
SocialCommunityItemSchema.statics.RECOMMENDATION_JOB_STATUSES = RECOMMENDATION_JOB_STATUSES;
SocialCommunityItemSchema.statics.SEND_INTENT_STATUSES = SEND_INTENT_STATUSES;

module.exports = mongoose.model("SocialCommunityItem", SocialCommunityItemSchema);
