const crypto = require("crypto");
const EmailOutbox = require("../models/EmailOutbox");
const MarketingLead = require("../models/MarketingLead");
const logger = require("../utils/logger");
const { sendEmail } = require("../utils/email");
const { createMarketingUnsubscribeToken } = require("../utils/marketingUnsubscribeToken");

const TEMPLATE_VERSION = "wealthness-roadmap-v1";
const DEFAULT_POLL_MS = 15_000;
const DEFAULT_LEASE_MS = 120_000;

const RESULT_COPY = {
  overthinker: {
    label: "The Money Overthinker",
    steps: ["Choose one money decision to finish this week.", "Compare no more than three reliable options.", "Set a decision deadline before you research."],
  },
  "good-earner": {
    label: "The Good Earner",
    steps: ["Automate one transfer on salary day.", "Review your last 30 days of spending.", "Give every extra rupee a job before it arrives."],
  },
  "safe-saver": {
    label: "The Safe Saver",
    steps: ["Name the goal behind each savings bucket.", "Learn the difference between safety and stagnation.", "Review one low-complexity growth option at your pace."],
  },
  "burnt-out": {
    label: "The Financially Burnt Out",
    steps: ["Start with a five-minute money check-in.", "List only the next three payments due.", "Ask for help before a deadline becomes a crisis."],
  },
  "ready-builder": {
    label: "The Ready Builder",
    steps: ["Write your next 90-day money goal.", "Automate the habit that supports it.", "Review progress on the same date every month."],
  },
};

function getPublicAppUrl() {
  return String(process.env.PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, "");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function enqueueWealthnessRoadmap(lead, dependencies = {}) {
  const OutboxModel = dependencies.EmailOutbox || EmailOutbox;
  const unsubscribeToken = createMarketingUnsubscribeToken(lead);
  const payload = {
    first_name: lead.first_name || null,
    result_type: lead.result_type,
    unsubscribe_token: unsubscribeToken,
  };
  return OutboxModel.findOneAndUpdate(
    { lead_id: lead._id, kind: "WEALTHNESS_ROADMAP", template_version: TEMPLATE_VERSION },
    {
      $setOnInsert: {
        lead_id: lead._id,
        kind: "WEALTHNESS_ROADMAP",
        template_version: TEMPLATE_VERSION,
        recipient_email: lead.email,
        payload,
        status: "QUEUED",
        attempt_count: 0,
        max_attempts: 5,
        next_attempt_at: new Date(),
      },
    },
    { new: true, upsert: true },
  );
}

function buildRoadmapEmail(outbox) {
  const copy = RESULT_COPY[outbox.payload?.result_type] || RESULT_COPY.overthinker;
  const firstName = String(outbox.payload?.first_name || "there").trim();
  const unsubscribeUrl = `${getPublicAppUrl()}/unsubscribe?token=${encodeURIComponent(outbox.payload?.unsubscribe_token || "")}`;
  const picksUrl = `${getPublicAppUrl()}/instagram/picks?utm_source=quiz_email&utm_medium=email&utm_campaign=wealthness_roadmap`;
  const stepsText = copy.steps.map((step, index) => `${index + 1}. ${step}`).join("\n");
  return {
    subject: `Your ${copy.label} roadmap from Pink Paisa`,
    text: `Hi ${firstName},\n\nYour Wealthness result is ${copy.label}.\n\n${stepsText}\n\nExplore curated Pink Paisa picks: ${picksUrl}\n\nFinancial education, not financial advice.\n\nUnsubscribe: ${unsubscribeUrl}`,
    html: `<p>Hi ${escapeHtml(firstName)},</p><p>Your Wealthness result is <strong>${escapeHtml(copy.label)}</strong>.</p><ol>${copy.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol><p><a href="${escapeHtml(picksUrl)}">Explore curated Pink Paisa picks</a></p><p><small>Financial education, not financial advice.</small></p><p><small><a href="${escapeHtml(unsubscribeUrl)}">Unsubscribe</a></small></p>`,
  };
}

function retryDelayMs(attemptCount) {
  return Math.min(60 * 60 * 1000, Math.max(30_000, 30_000 * (2 ** Math.max(attemptCount - 1, 0))));
}

async function processNextEmailOutbox(dependencies = {}) {
  const OutboxModel = dependencies.EmailOutbox || EmailOutbox;
  const LeadModel = dependencies.MarketingLead || MarketingLead;
  const deliver = dependencies.sendEmail || sendEmail;
  const now = new Date();
  const leaseMs = Number(process.env.EMAIL_OUTBOX_LEASE_MS || DEFAULT_LEASE_MS);
  const row = await OutboxModel.findOneAndUpdate(
    {
      $or: [
        { status: { $in: ["QUEUED", "RETRY"] }, next_attempt_at: { $lte: now } },
        { status: "PROCESSING", lease_expires_at: { $lte: now } },
      ],
    },
    {
      $set: {
        status: "PROCESSING",
        processing_started_at: now,
        lease_expires_at: new Date(now.getTime() + leaseMs),
      },
      $inc: { attempt_count: 1 },
    },
    { new: true, sort: { next_attempt_at: 1, createdAt: 1 } },
  );
  if (!row) return null;

  const lead = await LeadModel.findById(row.lead_id).lean();
  if (!lead || lead.status === "UNSUBSCRIBED" || !lead.email_consent?.granted) {
    row.status = "CANCELLED";
    row.processing_started_at = null;
    row.lease_expires_at = null;
    row.last_error = lead ? "Email consent is no longer active" : "Marketing lead no longer exists";
    await row.save();
    return row;
  }

  const message = buildRoadmapEmail(row);
  let outcome;
  try {
    outcome = await deliver({
      to: row.recipient_email,
      subject: message.subject,
      text: message.text,
      html: message.html,
      meta: { flow: "wealthness-roadmap", lead_id: String(row.lead_id), outbox_id: String(row._id) },
    });
  } catch (error) {
    outcome = { delivered: false, error: error.message };
  }

  if (outcome?.delivered) {
    row.status = "SENT";
    row.delivered_at = new Date();
    row.provider_message_id = outcome.message_id || null;
    row.last_error = null;
  } else {
    const exhausted = Number(row.attempt_count) >= Number(row.max_attempts || 5);
    row.status = exhausted ? "FAILED" : "RETRY";
    row.next_attempt_at = exhausted ? null : new Date(Date.now() + retryDelayMs(row.attempt_count));
    row.last_error = String(outcome?.error || "Email provider did not confirm delivery").slice(0, 1000);
  }
  row.processing_started_at = null;
  row.lease_expires_at = null;
  await row.save();
  return row;
}

let workerTimer = null;
let workerBusy = false;

function startEmailOutboxWorker() {
  if (workerTimer) return workerTimer;
  const enabled = String(process.env.EMAIL_OUTBOX_WORKER_ENABLED || "true").toLowerCase() === "true";
  if (!enabled) return null;
  const pollMs = Math.max(Number(process.env.EMAIL_OUTBOX_POLL_MS || DEFAULT_POLL_MS), 1000);
  const tick = async () => {
    if (workerBusy) return;
    workerBusy = true;
    try {
      await processNextEmailOutbox();
    } catch (error) {
      logger.error({ err: error }, "email outbox worker tick failed");
    } finally {
      workerBusy = false;
    }
  };
  workerTimer = setInterval(() => void tick(), pollMs);
  workerTimer.unref?.();
  void tick();
  logger.info({ poll_ms: pollMs, worker_id: crypto.randomUUID() }, "email outbox worker started");
  return workerTimer;
}

module.exports = {
  TEMPLATE_VERSION,
  buildRoadmapEmail,
  enqueueWealthnessRoadmap,
  processNextEmailOutbox,
  retryDelayMs,
  startEmailOutboxWorker,
};
