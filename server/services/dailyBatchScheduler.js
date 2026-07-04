const {
  getCampaignSettings,
  processDueScheduledPublishes,
  runDailyBatch,
} = require("./marketingAgentOrchestrator");
const { sweepVendorPayoutReadiness } = require("./payoutReadiness");
const logger = require("../utils/logger");

const CHECK_INTERVAL_MS = Math.max(parseInt(process.env.MARKETING_SCHEDULER_POLL_MS || "30000", 10), 10000);
const PAYOUT_READINESS_SWEEP_INTERVAL_MS = Math.max(parseInt(process.env.PAYOUT_READINESS_SWEEP_MS || `${30 * 60 * 1000}`, 10), 5 * 60 * 1000);
let schedulerStarted = false;
let lastTriggeredBatchKey = null;
let lastPayoutSweepBucket = null;

function getIstParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Calcutta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const values = {};
  parts.forEach((part) => {
    if (part.type !== "literal") values[part.type] = part.value;
  });
  return values;
}

function buildBatchKey(date = new Date()) {
  const parts = getIstParts(date);
  return `instagram-${parts.year}-${parts.month}-${parts.day}`;
}

async function shouldRunDailyBatch(date = new Date()) {
  if (String(process.env.MARKETING_DAILY_BATCH_ENABLED || "true") === "false") return false;
  const settings = await getCampaignSettings();
  if (settings.campaign_mode !== "automatic") return false;
  const parts = getIstParts(date);
  const hour = String(settings.campaign_batch_hour_ist).padStart(2, "0");
  const minute = String(settings.campaign_batch_minute_ist).padStart(2, "0");
  return parts.hour === hour && parts.minute === minute;
}

async function tickScheduler() {
  const now = new Date();
  const batchKey = buildBatchKey(now);
  if (await shouldRunDailyBatch(now) && lastTriggeredBatchKey !== batchKey) {
    lastTriggeredBatchKey = batchKey;
    await runDailyBatch({ triggerType: "scheduled", date: now }).catch((error) => {
      logger.error({ err: error }, "daily marketing batch failed");
    });
  }

  await processDueScheduledPublishes().catch((error) => {
    logger.error({ err: error }, "scheduled Instagram publish failed");
  });

  const payoutSweepBucket = Math.floor(now.getTime() / PAYOUT_READINESS_SWEEP_INTERVAL_MS);
  if (payoutSweepBucket !== lastPayoutSweepBucket) {
    lastPayoutSweepBucket = payoutSweepBucket;
    await sweepVendorPayoutReadiness({ now }).catch((error) => {
      logger.error({ err: error }, "vendor payout readiness sweep failed");
    });
  }
}

function startDailyBatchScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  setInterval(() => {
    void tickScheduler();
  }, CHECK_INTERVAL_MS);
  void tickScheduler();
  logger.info({ pollMs: CHECK_INTERVAL_MS }, "marketing batch scheduler started");
}

module.exports = {
  buildBatchKey,
  getIstParts,
  startDailyBatchScheduler,
};
