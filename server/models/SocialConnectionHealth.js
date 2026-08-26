const mongoose = require("mongoose");

const CONNECTION_PROVIDERS = Object.freeze(["OPENAI", "META", "INSTAGRAM", "GA4", "SEARCH_CONSOLE", "N8N", "RESEARCH"]);
const CONNECTION_STATUSES = Object.freeze([
  "NOT_CONFIGURED", "MISCONFIGURED", "CONFIGURED", "PENDING", "CONNECTED", "DEGRADED",
  "ERROR", "DISCONNECTED", "REAUTHORIZATION_REQUIRED",
]);
const FORBIDDEN_SECRET_KEYS = /^(?:authorization|access_token|refresh_token|token|password|private_key|client_secret|app_secret|cookie|api_key|secret)$/i;
const SECRET_LIKE_VALUE = /(?:bearer\s+[A-Za-z0-9._~-]{8,}|(?:access[_-]?token|refresh[_-]?token|client[_-]?secret|app[_-]?secret|private[_-]?key|password|authorization|api[_-]?key)\s*[:=]\s*\S+)/i;

function containsSecret(value, depth = 0) {
  if (value == null) return false;
  if (typeof value === "string") return SECRET_LIKE_VALUE.test(value);
  if (typeof value !== "object" || depth > 10) return false;
  if (Array.isArray(value)) return value.some((item) => containsSecret(item, depth + 1));
  return Object.entries(value).some(([key, child]) => FORBIDDEN_SECRET_KEYS.test(key) || containsSecret(child, depth + 1));
}
function safeStructuredSummary(value) {
  return value == null || (typeof value === "object" && !containsSecret(value));
}
function safeText(value) {
  return value == null || !containsSecret(String(value));
}

const accountSummarySchema = new mongoose.Schema({
  external_account_id: { type: String, default: null, trim: true, maxlength: 300 },
  account_name: { type: String, default: null, trim: true, maxlength: 300 },
  username: { type: String, default: null, trim: true, maxlength: 200 },
  account_type: { type: String, default: null, trim: true, maxlength: 100 },
  property_id: { type: String, default: null, trim: true, maxlength: 200 },
  site_url: { type: String, default: null, trim: true, maxlength: 2048 },
}, { _id: false, strict: "throw" });

const latestCheckSchema = new mongoose.Schema({
  check_key: { type: String, required: true, trim: true, maxlength: 300 },
  checked_at: { type: Date, required: true },
  status: { type: String, required: true, enum: CONNECTION_STATUSES, uppercase: true, trim: true },
  latency_ms: { type: Number, default: null, min: 0, max: 600000 },
  error_code: { type: String, default: null, trim: true, maxlength: 160 },
  error_summary: { type: String, default: null, trim: true, maxlength: 1000, validate: { validator: safeText, message: "error_summary must not contain credentials" } },
}, { _id: false, strict: "throw" });

const SocialConnectionHealthSchema = new mongoose.Schema({
  connection_key: { type: String, default: null, unique: true, sparse: true, immutable: true, trim: true, maxlength: 160, match: /^[a-z0-9][a-z0-9:_-]{2,159}$/ },
  provider: { type: String, required: true, enum: CONNECTION_PROVIDERS, uppercase: true, trim: true, unique: true, index: true },
  display_name: { type: String, default: "Social connection", trim: true, maxlength: 200 },
  status: { type: String, required: true, enum: CONNECTION_STATUSES, default: "NOT_CONFIGURED", uppercase: true, trim: true, index: true },
  configuration_source: { type: String, enum: ["NONE", "ENVIRONMENT", "OAUTH", "SERVICE_ACCOUNT", "ADMIN_CONFIG", "MIXED"], default: "NONE", uppercase: true, trim: true },
  configured: { type: Boolean, default: false },
  account_summary: { type: accountSummarySchema, default: null },
  capabilities: { type: mongoose.Schema.Types.Mixed, default: () => ({}), validate: { validator: safeStructuredSummary, message: "capabilities must be a safe credential-free summary" } },
  checks: { type: mongoose.Schema.Types.Mixed, default: () => [], validate: { validator: safeStructuredSummary, message: "checks must be a safe credential-free summary" } },
  safe_metadata: { type: mongoose.Schema.Types.Mixed, default: null, validate: { validator: safeStructuredSummary, message: "safe_metadata must not contain credentials" } },
  granted_scopes: { type: [{ type: String, trim: true, maxlength: 240 }], default: [] },
  missing_scopes: { type: [{ type: String, trim: true, maxlength: 240 }], default: [] },
  scopes_verified_at: { type: Date, default: null },
  limitations: { type: [{ type: String, trim: true, maxlength: 600, validate: { validator: safeText, message: "limitations must not contain credentials" } }], default: [] },
  app_mode: { type: String, default: null, enum: ["DEVELOPMENT", "LIVE", "UNKNOWN", null], uppercase: true, trim: true },
  api_version: { type: String, default: null, trim: true, maxlength: 80 },
  token_expires_at: { type: Date, default: null, index: true },
  checked_at: { type: Date, default: null, index: true },
  last_checked_at: { type: Date, default: null, index: true },
  last_success_at: { type: Date, default: null },
  next_check_at: { type: Date, default: null, index: true },
  consecutive_failures: { type: Number, default: 0, min: 0, max: 100000 },
  latest_check: { type: latestCheckSchema, default: null },
  last_error: { type: String, default: null, trim: true, maxlength: 1000, validate: { validator: safeText, message: "last_error must not contain credentials" } },
  setup_requirements: { type: [{ type: String, trim: true, maxlength: 600, validate: { validator: safeText, message: "setup_requirements must not contain credentials" } }], default: [] },
  connection_version: { type: Number, required: true, default: 1, min: 1 },
}, {
  timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  optimisticConcurrency: true,
  strict: "throw",
});

SocialConnectionHealthSchema.pre("validate", function validateSafeConnectionSummary() {
  for (const field of ["granted_scopes", "missing_scopes"]) {
    const values = Array.isArray(this[field]) ? this[field] : [];
    if (new Set(values).size !== values.length) this.invalidate(field, `${field} must not contain duplicate values`);
  }
  if (this.latest_check?.checked_at && this.last_checked_at && this.latest_check.checked_at.getTime() !== this.last_checked_at.getTime()) this.invalidate("latest_check", "latest_check.checked_at must match last_checked_at");
});

SocialConnectionHealthSchema.index({ provider: 1, status: 1, checked_at: -1 });
SocialConnectionHealthSchema.index({ status: 1, next_check_at: 1 });
SocialConnectionHealthSchema.index({ token_expires_at: 1, status: 1 });

SocialConnectionHealthSchema.statics.CONNECTION_PROVIDERS = CONNECTION_PROVIDERS;
SocialConnectionHealthSchema.statics.CONNECTION_STATUSES = CONNECTION_STATUSES;

module.exports = mongoose.model("SocialConnectionHealth", SocialConnectionHealthSchema);
