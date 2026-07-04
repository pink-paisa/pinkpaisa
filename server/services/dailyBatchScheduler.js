const {
  getCampaignSettings,
  processDueScheduledPublishes,
  runDailyBatch,
} = require("./marketingAgentOrchestrator");
const { sweepVendorPayoutReadiness } = require("./payoutReadiness");
const Product = require("../models/Product");
const { checkAffiliateProductLink, persistAffiliateLinkCheck } = require("./affiliateLinkChecker");
const logger = require("../utils/logger");

const CHECK_INTERVAL_MS = Math.max(parseInt(process.env.MARKETING_SCHEDULER_POLL_MS || "30000", 10), 10000);
const PAYOUT_READINESS_SWEEP_INTERVAL_MS = Math.max(parseInt(process.env.PAYOUT_READINESS_SWEEP_MS || `${30 * 60 * 1000}`, 10), 5 * 60 * 1000);
const AFFILIATE_LINK_CHECK_DAILY_LIMIT = Math.max(parseInt(process.env.AFFILIATE_LINK_CHECK_DAILY_LIMIT || "50", 10), 1);
let schedulerStarted = false;
let lastTriggeredBatchKey = null;
let lastPayoutSweepBucket = null;
let lastAffiliateLinkSweepKey = null;

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

function buildAffiliateLinkSweepKey(date = new Date()) {
  const parts = getIstParts(date);
  return `affiliate-link-check-${parts.year}-${parts.month}-${parts.day}`;
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

function shouldRunAffiliateLinkSweep(date = new Date()) {
  if (String(process.env.AFFILIATE_LINK_CHECK_DAILY_ENABLED || "true") === "false") return false;
  const parts = getIstParts(date);
  const hour = String(process.env.AFFILIATE_LINK_CHECK_HOUR_IST || "03").padStart(2, "0");
  const minute = String(process.env.AFFILIATE_LINK_CHECK_MINUTE_IST || "10").padStart(2, "0");
  return parts.hour === hour && parts.minute === minute;
}

async function runAffiliateLinkSweep({ now = new Date(), limit = AFFILIATE_LINK_CHECK_DAILY_LIMIT } = {}) {
  const products = await Product.find({
    is_affiliate: true,
    affiliate_url: { $nin: [null, ""] },
    status: "active",
    is_visible: true,
    affiliate_compliance_status: "compliant",
  })
    .sort({ affiliate_link_last_checked_at: 1, affiliate_sort_order: 1, createdAt: -1 })
    .limit(limit);

  let checked = 0;
  let failed = 0;

  for (const product of products) {
    try {
      const result = await checkAffiliateProductLink(product);
      await persistAffiliateLinkCheck(product, result);
      checked += 1;
      if (!result.ok) failed += 1;
    } catch (error) {
      failed += 1;
      logger.error({ err: error, productId: product._id }, "affiliate link check failed");
    }
  }

  logger.info({ checked, failed, limit, at: now.toISOString() }, "affiliate link sweep completed");
  return { checked, failed };
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

  const affiliateLinkSweepKey = buildAffiliateLinkSweepKey(now);
  if (shouldRunAffiliateLinkSweep(now) && lastAffiliateLinkSweepKey !== affiliateLinkSweepKey) {
    lastAffiliateLinkSweepKey = affiliateLinkSweepKey;
    await runAffiliateLinkSweep({ now }).catch((error) => {
      logger.error({ err: error }, "affiliate link sweep failed");
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
  buildAffiliateLinkSweepKey,
  buildBatchKey,
  getIstParts,
  runAffiliateLinkSweep,
  shouldRunAffiliateLinkSweep,
  startDailyBatchScheduler,
};
