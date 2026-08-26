const crypto = require("crypto");
const MarketingLead = require("../models/MarketingLead");
const EmailOutbox = require("../models/EmailOutbox");
const { enqueueWealthnessRoadmap } = require("./emailOutboxService");
const { normalizeMarketingAttribution } = require("../utils/marketingAttribution");
const { verifyMarketingUnsubscribeToken } = require("../utils/marketingUnsubscribeToken");

const CONSENT_VERSION = "wealthness-roadmap-2026-08-26";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FORBIDDEN_RAW_ANSWER_KEYS = ["answers", "raw_answers", "quiz_answers", "financial_answers"];
const STATUS_SET = new Set(["NEW", "CONTACTED", "NURTURING", "CONVERTED", "UNSUBSCRIBED"]);
const RESULT_SET = new Set(["overthinker", "good-earner", "safe-saver", "burnt-out", "ready-builder"]);

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase().slice(0, 254);
}

function normalizePhone(value) {
  const normalized = String(value || "").trim().replace(/[^0-9+()\-\s]/g, "").slice(0, 30);
  return normalized || null;
}

function normalizeLeadInput(body = {}, now = new Date()) {
  for (const key of FORBIDDEN_RAW_ANSWER_KEYS) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      const error = new Error("Quiz answers must not be submitted or stored");
      error.status = 400;
      error.code = "marketing_raw_answers_forbidden";
      throw error;
    }
  }
  const resultType = String(body.result_type || "").trim().toLowerCase();
  const email = normalizeEmail(body.email);
  const firstName = String(body.first_name || "").trim().slice(0, 100) || null;
  const emailGranted = body.email_consent === true || body.email_consent?.granted === true;
  const whatsappGranted = body.whatsapp_consent === true || body.whatsapp_consent?.granted === true;
  const submittedPhone = normalizePhone(body.phone);
  const phone = whatsappGranted ? submittedPhone : null;
  const submittedConsentVersion = String(body.consent_version || CONSENT_VERSION).trim();
  if (submittedConsentVersion !== CONSENT_VERSION) {
    const error = new Error("Consent version is not current. Please refresh and try again.");
    error.status = 409;
    error.code = "marketing_consent_version_stale";
    throw error;
  }
  const consentVersion = CONSENT_VERSION;

  if (!RESULT_SET.has(resultType)) {
    const error = new Error("A valid Wealthness result type is required");
    error.status = 400;
    error.code = "marketing_result_type_invalid";
    throw error;
  }
  if (!EMAIL_RE.test(email)) {
    const error = new Error("A valid email address is required");
    error.status = 400;
    error.code = "marketing_email_invalid";
    throw error;
  }
  if (!emailGranted) {
    const error = new Error("Email consent is required to send the roadmap");
    error.status = 400;
    error.code = "marketing_email_consent_required";
    throw error;
  }
  if (whatsappGranted && !submittedPhone) {
    const error = new Error("A phone number is required for WhatsApp updates");
    error.status = 400;
    error.code = "marketing_whatsapp_phone_required";
    throw error;
  }

  const attribution = normalizeMarketingAttribution(body.attribution);
  return {
    source: "WEALTHNESS_QUIZ",
    result_type: resultType,
    first_name: firstName,
    email,
    phone,
    email_consent: { granted: true, version: consentVersion, captured_at: now },
    whatsapp_consent: { granted: whatsappGranted, version: consentVersion, captured_at: now },
    attribution,
    consented_at: now,
    last_captured_at: now,
  };
}

function fingerprintLeadInput(input) {
  return sha256(JSON.stringify({
    source: input.source,
    result_type: input.result_type,
    first_name: input.first_name,
    email: input.email,
    phone: input.phone,
    email_consent: Boolean(input.email_consent?.granted),
    whatsapp_consent: Boolean(input.whatsapp_consent?.granted),
    consent_version: input.email_consent?.version,
    first_touch: input.attribution?.first_touch,
    last_touch: input.attribution?.last_touch,
  }));
}

function buildDedupeKey(input) {
  return sha256([input.source, input.email, input.result_type, input.email_consent.version].join(":"));
}

async function loadLeadByIdempotency(Model, idempotencyKey) {
  return Model.findOne({
    $or: [
      { idempotency_key: idempotencyKey },
      { "idempotency_receipts.key": idempotencyKey },
    ],
  });
}

function fingerprintForIdempotency(lead, idempotencyKey) {
  if (lead.idempotency_key === idempotencyKey) return lead.request_fingerprint;
  const receipt = Array.from(lead.idempotency_receipts || []).find((entry) => entry.key === idempotencyKey);
  return receipt?.request_fingerprint || null;
}

async function captureMarketingLead({ body, idempotencyKey, now = new Date(), dependencies = {} }) {
  const LeadModel = dependencies.MarketingLead || MarketingLead;
  const OutboxModel = dependencies.EmailOutbox || EmailOutbox;
  const enqueue = dependencies.enqueueWealthnessRoadmap || enqueueWealthnessRoadmap;
  const input = normalizeLeadInput(body, now);
  const requestFingerprint = fingerprintLeadInput(input);
  const requestKey = String(idempotencyKey || `marketing-lead:${requestFingerprint}`).trim();
  if (!requestKey || requestKey.length > 200 || /[\u0000-\u001f\u007f]/.test(requestKey)) {
    const error = new Error("Idempotency-Key is invalid");
    error.status = 400;
    error.code = "marketing_idempotency_key_invalid";
    throw error;
  }

  const prior = await loadLeadByIdempotency(LeadModel, requestKey);
  if (prior) {
    if (fingerprintForIdempotency(prior, requestKey) !== requestFingerprint) {
      const error = new Error("This Idempotency-Key was already used with a different lead capture");
      error.status = 409;
      error.code = "marketing_idempotency_conflict";
      throw error;
    }
    let outbox = await OutboxModel.findOne({ lead_id: prior._id, kind: "WEALTHNESS_ROADMAP" });
    if (!outbox) outbox = await enqueue(prior, { EmailOutbox: OutboxModel });
    return { lead: prior, reused: true, outbox };
  }

  const dedupeKey = buildDedupeKey(input);
  let lead = await LeadModel.findOne({ dedupe_key: dedupeKey });
  let reused = Boolean(lead);
  if (lead) {
    lead.first_name = input.first_name || lead.first_name;
    lead.phone = input.phone || lead.phone;
    lead.email_consent = input.email_consent;
    lead.whatsapp_consent = input.whatsapp_consent;
    lead.attribution = {
      first_touch: lead.attribution?.first_touch?.captured_at ? lead.attribution.first_touch : input.attribution.first_touch,
      last_touch: input.attribution.last_touch,
    };
    lead.last_captured_at = now;
    if (lead.status === "UNSUBSCRIBED") {
      lead.status = "NEW";
      lead.unsubscribed_at = null;
    }
    if (!Array.from(lead.idempotency_receipts || []).some((entry) => entry.key === requestKey)) {
      lead.idempotency_receipts.push({ key: requestKey, request_fingerprint: requestFingerprint, captured_at: now });
    }
    await lead.save();
  } else {
    try {
      lead = await LeadModel.create({
        ...input,
        status: "NEW",
        idempotency_key: requestKey,
        request_fingerprint: requestFingerprint,
        idempotency_receipts: [{ key: requestKey, request_fingerprint: requestFingerprint, captured_at: now }],
        dedupe_key: dedupeKey,
      });
    } catch (error) {
      if (error?.code !== 11000) throw error;
      lead = await LeadModel.findOne({
        $or: [
          { idempotency_key: requestKey },
          { "idempotency_receipts.key": requestKey },
          { dedupe_key: dedupeKey },
        ],
      });
      if (!lead) throw error;
      reused = true;
      const storedFingerprint = fingerprintForIdempotency(lead, requestKey);
      if (storedFingerprint && storedFingerprint !== requestFingerprint) {
        const conflict = new Error("This Idempotency-Key was already used with a different lead capture");
        conflict.status = 409;
        conflict.code = "marketing_idempotency_conflict";
        throw conflict;
      }
      if (!storedFingerprint && lead.dedupe_key === dedupeKey) {
        lead.idempotency_receipts.push({ key: requestKey, request_fingerprint: requestFingerprint, captured_at: now });
        await lead.save();
      }
    }
  }

  const outbox = await enqueue(lead, { EmailOutbox: OutboxModel });
  return { lead, reused, outbox };
}

async function unsubscribeMarketingLead(token, dependencies = {}) {
  const LeadModel = dependencies.MarketingLead || MarketingLead;
  const OutboxModel = dependencies.EmailOutbox || EmailOutbox;
  const parsed = verifyMarketingUnsubscribeToken(token);
  if (!parsed) {
    const error = new Error("Unsubscribe link is invalid");
    error.status = 400;
    error.code = "marketing_unsubscribe_token_invalid";
    throw error;
  }
  const lead = await LeadModel.findOne({ _id: parsed.lead_id });
  if (!lead) {
    const error = new Error("Marketing lead was not found");
    error.status = 404;
    error.code = "marketing_lead_not_found";
    throw error;
  }
  const reused = lead.status === "UNSUBSCRIBED";
  if (!reused) {
    lead.status = "UNSUBSCRIBED";
    lead.unsubscribed_at = new Date();
    lead.email_consent = { ...(lead.email_consent.toObject?.() || lead.email_consent), granted: false };
    lead.whatsapp_consent = { ...(lead.whatsapp_consent.toObject?.() || lead.whatsapp_consent), granted: false };
    await lead.save();
    await OutboxModel.updateMany(
      { lead_id: lead._id, status: { $in: ["QUEUED", "RETRY"] } },
      { $set: { status: "CANCELLED", last_error: "Lead unsubscribed", next_attempt_at: null } },
    );
  }
  return { lead, reused };
}

function normalizeLeadStatus(value) {
  const status = String(value || "").trim().toUpperCase();
  return STATUS_SET.has(status) ? status : null;
}

module.exports = {
  CONSENT_VERSION,
  buildDedupeKey,
  captureMarketingLead,
  fingerprintLeadInput,
  normalizeLeadInput,
  normalizeLeadStatus,
  unsubscribeMarketingLead,
};
