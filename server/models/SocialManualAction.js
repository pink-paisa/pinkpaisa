const mongoose = require("mongoose");

const ACTION_TYPES = Object.freeze([
  "META_NATIVE_INTERACTION",
  "ACCOUNT_RECONNECT",
  "PERMISSION_REVIEW",
  "CONTENT_ESCALATION",
  "COMMUNITY_REPLY",
  "PUBLISH_RECONCILIATION",
  "PRODUCT_FACT_REVIEW",
  "SOURCE_REVIEW",
  "OTHER",
]);

const ACTION_STATUSES = Object.freeze(["OPEN", "IN_PROGRESS", "COMPLETED", "CANCELLED"]);
const COMPLETION_SOURCES = Object.freeze(["ADMIN", "SYSTEM"]);

const resolutionEvidenceSchema = new mongoose.Schema({
  resolver: {
    type: String,
    required: true,
    enum: ["GENERATION_RUN", "CONNECTION_HEALTH", "PUBLICATION", "COMMUNITY_SEND", "AUDIO_RIGHTS"],
    uppercase: true,
    trim: true,
  },
  entity_type: {
    type: String,
    required: true,
    enum: ["GENERATION_RUN", "CONNECTION_HEALTH", "PUBLICATION", "COMMUNITY_ITEM", "AUDIO_TRACK"],
    uppercase: true,
    trim: true,
  },
  entity_id: { type: String, required: true, trim: true, maxlength: 300 },
  observed_status: { type: String, required: true, uppercase: true, trim: true, maxlength: 120 },
  provider_reference_id: { type: String, default: null, trim: true, maxlength: 400 },
  observed_at: { type: Date, required: true },
}, { _id: false, strict: "throw" });

const SocialManualActionSchema = new mongoose.Schema(
  {
    action_key: { type: String, required: true, unique: true, immutable: true, trim: true, maxlength: 400 },
    action_type: { type: String, required: true, enum: ACTION_TYPES, uppercase: true, trim: true, index: true },
    status: { type: String, required: true, enum: ACTION_STATUSES, default: "OPEN", uppercase: true, trim: true, index: true },
    priority: { type: String, required: true, enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"], default: "MEDIUM", uppercase: true, trim: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 240 },
    description: { type: String, required: true, trim: true, maxlength: 4000 },
    instructions: { type: [{ type: String, trim: true, maxlength: 1000 }], default: [] },
    provider: { type: String, default: null, enum: ["META", "INSTAGRAM", "OPENAI", "GA4", "SEARCH_CONSOLE", "N8N", "INTERNAL", null], uppercase: true, trim: true },
    weekly_plan_id: { type: mongoose.Schema.Types.ObjectId, ref: "SocialWeeklyPlan", default: null, index: true },
    generation_run_id: { type: mongoose.Schema.Types.ObjectId, ref: "SocialGenerationRun", default: null, index: true },
    draft_id: { type: mongoose.Schema.Types.ObjectId, ref: "SocialPostDraft", default: null, index: true },
    publication_id: { type: mongoose.Schema.Types.ObjectId, ref: "SocialPublication", default: null, index: true },
    community_item_id: { type: mongoose.Schema.Types.ObjectId, ref: "SocialCommunityItem", default: null, index: true },
    connection_health_id: { type: mongoose.Schema.Types.ObjectId, ref: "SocialConnectionHealth", default: null, index: true },
    external_reference_id: { type: String, default: null, trim: true, maxlength: 400 },
    assigned_to_admin_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    created_by_admin_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    due_at: { type: Date, default: null, index: true },
    started_at: { type: Date, default: null },
    completed_at: { type: Date, default: null },
    completed_by_admin_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    completion_source: { type: String, required: true, enum: COMPLETION_SOURCES, default: "ADMIN", uppercase: true, trim: true, index: true },
    resolution_note: { type: String, default: null, trim: true, maxlength: 4000 },
    resolution_evidence: { type: resolutionEvidenceSchema, default: null },
    cancelled_at: { type: Date, default: null },
    cancelled_by_admin_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    cancellation_reason: { type: String, default: null, trim: true, maxlength: 2000 },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    optimisticConcurrency: true,
    strict: "throw",
  }
);

SocialManualActionSchema.pre("validate", function validateManualActionLifecycle() {
  if (this.status === "COMPLETED"
    && (!this.completed_at || !String(this.resolution_note || "").trim())) {
    this.invalidate("status", "COMPLETED actions require time and resolution_note");
  }
  if (this.status === "COMPLETED" && this.completion_source === "ADMIN" && !this.completed_by_admin_id) {
    this.invalidate("completed_by_admin_id", "Administrator-completed actions require the completing administrator");
  }
  if (this.status === "COMPLETED" && this.completion_source === "SYSTEM" && !this.resolution_evidence) {
    this.invalidate("resolution_evidence", "System-completed actions require authoritative resolution evidence");
  }
  if (this.status === "COMPLETED" && this.completion_source === "SYSTEM" && this.completed_by_admin_id) {
    this.invalidate("completed_by_admin_id", "System-completed actions cannot be attributed to an administrator");
  }
  if (this.status === "CANCELLED"
    && (!this.cancelled_at || !this.cancelled_by_admin_id || !String(this.cancellation_reason || "").trim())) {
    this.invalidate("status", "CANCELLED actions require actor, time, and cancellation_reason");
  }
  if (this.completed_at && this.cancelled_at) {
    this.invalidate("status", "A manual action cannot be both completed and cancelled");
  }
  if (this.due_at && this.created_at && this.due_at < this.created_at) {
    this.invalidate("due_at", "due_at cannot precede created_at");
  }
});

SocialManualActionSchema.index({ status: 1, priority: 1, due_at: 1 });
SocialManualActionSchema.index({ weekly_plan_id: 1, status: 1, created_at: -1 });
SocialManualActionSchema.index({ community_item_id: 1, status: 1 });

SocialManualActionSchema.statics.ACTION_TYPES = ACTION_TYPES;
SocialManualActionSchema.statics.ACTION_STATUSES = ACTION_STATUSES;
SocialManualActionSchema.statics.COMPLETION_SOURCES = COMPLETION_SOURCES;

module.exports = mongoose.model("SocialManualAction", SocialManualActionSchema);
