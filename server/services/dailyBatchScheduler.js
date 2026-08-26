const crypto = require("crypto");
const os = require("os");
const {
  getCampaignSettings,
  processDueScheduledPublishes,
  runDailyBatch,
} = require("./marketingAgentOrchestrator");
const { sweepVendorPayoutReadiness } = require("./payoutReadiness");
const Product = require("../models/Product");
const { checkAffiliateProductLink, persistAffiliateLinkCheck } = require("./affiliateLinkChecker");
const { runDueCreatorsApiRefresh } = require("./amazonCreatorsApiService");
const logger = require("../utils/logger");
const SchedulerLease = require("../models/SchedulerLease");
const { runDueDailyPredictions } = require("./dailyPredictionService");
const { getSocialManagerSettings } = require("../utils/socialManagerSettings");
const {
  processPendingSocialGenerationRuns,
  runDueSocialGeneration,
} = require("./social/socialManagerService");
const { processDueSocialPublishes } = require("./social/socialPublishingService");
const { collectDueInstagramMetricSnapshots } = require("./social/socialMetricCollectionService");
const { resolveDeterministicManualActions } = require("./social/socialManualActionResolutionService");
const {
  getConnections,
  processCommunityAutomation,
  processPendingWeeklyPlans,
  refreshGrowthAnalytics,
  requestWeeklyPlan,
  runDueWeeklyPrepublication,
} = require("./social/socialGrowthTeamService");

const CHECK_INTERVAL_MS = Math.max(parseInt(process.env.MARKETING_SCHEDULER_POLL_MS || "30000", 10), 10000);
const PAYOUT_READINESS_SWEEP_INTERVAL_MS = Math.max(parseInt(process.env.PAYOUT_READINESS_SWEEP_MS || `${30 * 60 * 1000}`, 10), 5 * 60 * 1000);
const AFFILIATE_LINK_CHECK_DAILY_LIMIT = Math.max(parseInt(process.env.AFFILIATE_LINK_CHECK_DAILY_LIMIT || "50", 10), 1);
const CREATORS_API_REFRESH_INTERVAL_MS = Math.max(
  parseInt(process.env.AMAZON_CREATORS_API_REFRESH_INTERVAL_HOURS || "12", 10),
  1
) * 60 * 60 * 1000;
let schedulerStarted = false;
let lastTriggeredBatchKey = null;
let lastPayoutSweepBucket = null;
let lastAffiliateLinkSweepKey = null;
let lastCreatorsApiRefreshBucket = null;
let lastSocialAnalyticsBucket = null;
let lastSocialConnectionHealthBucket = null;
let lastWeeklySocialPlanningKey = null;
let schedulerTickInFlight = false;
const schedulerOwner = `${os.hostname()}:${process.pid}:${crypto.randomUUID().slice(0, 8)}`;
const SCHEDULER_LEASE_MS = Math.max(
  Number(process.env.MARKETING_SCHEDULER_LEASE_MS || 20 * 60 * 1000),
  CHECK_INTERVAL_MS * 3,
  60000,
);
const SCHEDULER_HEARTBEAT_MS = Math.max(Math.min(Math.floor(SCHEDULER_LEASE_MS / 3), 60000), 10000);

async function acquireSchedulerLease(now = new Date()) {
  try {
    const lease = await SchedulerLease.findOneAndUpdate(
      {
        lease_key: "pinkpaisa-daily-scheduler",
        $or: [
          { lease_owner: schedulerOwner },
          { lease_expires_at: { $lte: now } },
          { lease_expires_at: { $exists: false } },
        ],
      },
      {
        $set: {
          lease_owner: schedulerOwner,
          lease_expires_at: new Date(now.getTime() + SCHEDULER_LEASE_MS),
          heartbeat_at: now,
        },
        $setOnInsert: { lease_key: "pinkpaisa-daily-scheduler" },
      },
      { upsert: true, new: true }
    );
    return lease?.lease_owner === schedulerOwner;
  } catch (error) {
    if (error?.code === 11000) return false;
    throw error;
  }
}

async function heartbeatSchedulerLease(now = new Date()) {
  const result = await SchedulerLease.updateOne(
    { lease_key: "pinkpaisa-daily-scheduler", lease_owner: schedulerOwner },
    {
      $set: {
        lease_expires_at: new Date(now.getTime() + SCHEDULER_LEASE_MS),
        heartbeat_at: now,
      },
    },
  );
  return Number(result?.matchedCount || result?.n || 0) === 1;
}

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

function getIstWeekday(date = new Date()) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", weekday: "long" })
    .format(date)
    .toUpperCase();
}

const WEEKDAY_INDEX = Object.freeze({
  SUNDAY: 0,
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
});
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function weeklySocialPlanningSchedule(date = new Date(), settings = {}) {
  if (settings.weekly_planning?.enabled === false) {
    return { enabled: false, due: false, occurrence_key: null, scheduled_at: null };
  }
  const parts = getIstParts(date);
  const configuredWeekday = String(settings.weekly_planning?.planning_weekday || "SUNDAY").toUpperCase();
  const weekday = Object.hasOwn(WEEKDAY_INDEX, configuredWeekday) ? configuredWeekday : "SUNDAY";
  const configuredHour = Number(settings.weekly_planning?.planning_hour_ist ?? 18);
  const configuredMinute = Number(settings.weekly_planning?.planning_minute_ist ?? 0);
  const hour = Math.min(Math.max(Number.isInteger(configuredHour) ? configuredHour : 18, 0), 23);
  const minute = Math.min(Math.max(Number.isInteger(configuredMinute) ? configuredMinute : 0, 0), 59);
  const currentWeekday = getIstWeekday(date);
  const daysSinceConfiguredWeekday = (
    WEEKDAY_INDEX[currentWeekday] - WEEKDAY_INDEX[weekday] + 7
  ) % 7;
  const currentLocalDateUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
  let occurrenceLocalDateUtc = currentLocalDateUtc - daysSinceConfiguredWeekday * 24 * 60 * 60 * 1000;
  let scheduledAt = new Date(occurrenceLocalDateUtc + hour * 60 * 60 * 1000 + minute * 60 * 1000 - IST_OFFSET_MS);
  if (scheduledAt.getTime() > date.getTime()) {
    if (daysSinceConfiguredWeekday === 0) {
      const occurrenceDate = new Date(occurrenceLocalDateUtc).toISOString().slice(0, 10);
      return {
        enabled: true,
        due: false,
        occurrence_key: `social-weekly-planning:${occurrenceDate}:${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
        scheduled_at: scheduledAt,
      };
    }
    occurrenceLocalDateUtc -= WEEK_MS;
    scheduledAt = new Date(scheduledAt.getTime() - WEEK_MS);
  }
  const occurrenceDate = new Date(occurrenceLocalDateUtc).toISOString().slice(0, 10);
  return {
    enabled: true,
    due: date.getTime() >= scheduledAt.getTime() && date.getTime() - scheduledAt.getTime() < WEEK_MS,
    occurrence_key: `social-weekly-planning:${occurrenceDate}:${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    scheduled_at: scheduledAt,
  };
}

function shouldRunWeeklySocialPlanning(date, settings = {}) {
  return weeklySocialPlanningSchedule(date, settings).due;
}

function isInternalSocialOrchestrationSchedulerEnabled(environment = process.env) {
  const configured = String(environment.SOCIAL_INTERNAL_ORCHESTRATION_SCHEDULER_ENABLED ?? "true")
    .trim()
    .toLowerCase();
  return !["false", "0", "no", "off"].includes(configured);
}

function logSocialMetricCollectionResult(result = {}, schedulerLogger = logger) {
  const failures = Array.isArray(result?.failures) ? result.failures : [];
  if (failures.length) {
    schedulerLogger.error({
      collected: Number(result.collected || 0),
      skipped: Number(result.skipped || 0),
      failure_count: failures.length,
      persistence_failure_count: failures.filter((failure) => failure?.durability !== "PERSISTED").length,
      failures,
    }, "scheduled Instagram metric snapshot failures require admin action");
  }
  return result;
}

function logSocialCommunityAutomationResult(result = {}, schedulerLogger = logger) {
  const failures = Array.isArray(result?.failures) ? result.failures : [];
  if (failures.length || Number(result?.failed || 0) > 0) {
    schedulerLogger.error({
      drafted: Number(result.drafted || 0),
      sent: Number(result.sent || 0),
      hidden: Number(result.hidden || 0),
      uncertain: Number(result.uncertain || 0),
      failed: Number(result.failed || failures.length || 0),
      persistence_failure_count: failures.filter((failure) => failure?.durability !== "PERSISTED").length,
      failures,
    }, "social community automation failures require admin action");
  }
  return result;
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
  if (schedulerTickInFlight) return { skipped: "tick_in_flight" };
  schedulerTickInFlight = true;
  let leaseHeartbeat = null;
  try {
  const now = new Date();
  if (!await acquireSchedulerLease(now)) return { skipped: "lease_not_acquired" };
  leaseHeartbeat = setInterval(() => {
    void heartbeatSchedulerLease().catch((error) => logger.error({ err: error }, "marketing scheduler lease heartbeat failed"));
  }, SCHEDULER_HEARTBEAT_MS);
  leaseHeartbeat.unref?.();
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

  await runDueDailyPredictions({ now }).catch((error) => {
    logger.error({ err: error }, "scheduled daily prediction generation failed");
  });

  await runDueSocialGeneration({ now }).catch((error) => {
    logger.error({ err: error }, "scheduled social recommendation enqueue failed");
  });

  await processPendingSocialGenerationRuns({ now, limit: 1 }).catch((error) => {
    logger.error({ err: error }, "social recommendation worker failed");
  });

  const socialSettings = await getSocialManagerSettings().catch((error) => {
    logger.error({ err: error }, "social manager settings unavailable for weekly planning");
    return null;
  });
  const internalSocialOrchestrationEnabled = isInternalSocialOrchestrationSchedulerEnabled();
  const weeklyPlanningSchedule = socialSettings
    ? weeklySocialPlanningSchedule(now, socialSettings)
    : null;
  if (internalSocialOrchestrationEnabled
    && weeklyPlanningSchedule?.due
    && weeklyPlanningSchedule.occurrence_key !== lastWeeklySocialPlanningKey) {
    try {
      await requestWeeklyPlan({ now });
      // This in-memory guard prevents repeat work every poll. The plan's unique
      // week key remains the durable/idempotent guard across process restarts.
      lastWeeklySocialPlanningKey = weeklyPlanningSchedule.occurrence_key;
    } catch (error) {
      logger.error({ err: error }, "scheduled weekly social plan enqueue failed");
    }
  }
  await processPendingWeeklyPlans({ now, limit: 1 }).catch((error) => {
    logger.error({ err: error }, "weekly social planning worker failed");
  });
  if (internalSocialOrchestrationEnabled) {
    await runDueWeeklyPrepublication({ now, lookaheadHours: socialSettings?.weekly_planning?.prepublication_lead_hours || 24 })
      .then((result) => {
        if (result.failures?.length) {
          logger.error({ failures: result.failures }, "weekly social pre-publication items failed and require admin action");
        }
      })
      .catch((error) => {
        logger.error({ err: error }, "weekly social pre-publication enqueue failed");
      });
  }

  await getSocialManagerSettings()
    .then((settings) => processDueSocialPublishes({ now, settings, limit: 3 }))
    .then((result) => {
      if (result.failures?.length) {
        logger.error({ failures: result.failures }, "scheduled social publications failed and require admin action");
      }
    })
    .catch((error) => {
      logger.error({ err: error }, "scheduled social publishing failed");
    });
  if (socialSettings) {
    if (internalSocialOrchestrationEnabled) {
      await collectDueInstagramMetricSnapshots({ now, settings: socialSettings, limit: 20 })
        .then((result) => logSocialMetricCollectionResult(result))
        .catch((error) => {
          logger.error({ err: error }, "scheduled Instagram metric snapshot collection failed");
        });
    }
    await processCommunityAutomation({ now, settings: socialSettings, limit: 20 })
      .then((result) => logSocialCommunityAutomationResult(result))
      .catch((error) => {
        logger.error({ err: error }, "social community automation failed");
      });
  }
  await resolveDeterministicManualActions({ now, limit: 100 })
    .then((result) => {
      if (result.failures?.length) logger.error({ failures: result.failures }, "some social manual actions could not be auto-resolved");
    })
    .catch((error) => {
      logger.error({ err: error }, "social manual-action resolution sweep failed");
    });

  const analyticsIntervalMs = Math.max(Number(process.env.SOCIAL_ANALYTICS_REFRESH_INTERVAL_HOURS || 6), 1) * 60 * 60 * 1000;
  const analyticsBucket = Math.floor(now.getTime() / analyticsIntervalMs);
  if (internalSocialOrchestrationEnabled && analyticsBucket !== lastSocialAnalyticsBucket) {
    lastSocialAnalyticsBucket = analyticsBucket;
    await refreshGrowthAnalytics({ now }).catch((error) => {
      logger.error({ err: error }, "aggregate social growth analytics refresh failed");
    });
  }
  const connectionHealthBucket = Math.floor(now.getTime() / (24 * 60 * 60 * 1000));
  if (connectionHealthBucket !== lastSocialConnectionHealthBucket) {
    lastSocialConnectionHealthBucket = connectionHealthBucket;
    await getConnections({ refresh: true, settings: socialSettings || undefined }).catch((error) => {
      logger.error({ err: error }, "social growth connection health check failed");
    });
  }

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

  const creatorsApiRefreshBucket = Math.floor(now.getTime() / CREATORS_API_REFRESH_INTERVAL_MS);
  if (creatorsApiRefreshBucket !== lastCreatorsApiRefreshBucket) {
    lastCreatorsApiRefreshBucket = creatorsApiRefreshBucket;
    await runDueCreatorsApiRefresh().catch((error) => {
      logger.error({ err: error }, "creators api affiliate refresh failed");
    });
  }
  return { completed: true };
  } finally {
    if (leaseHeartbeat) clearInterval(leaseHeartbeat);
    schedulerTickInFlight = false;
  }
}

function startDailyBatchScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  setInterval(() => {
    void tickScheduler().catch((error) => logger.error({ err: error }, "marketing scheduler tick failed"));
  }, CHECK_INTERVAL_MS);
  void tickScheduler().catch((error) => logger.error({ err: error }, "initial marketing scheduler tick failed"));
  logger.info({ pollMs: CHECK_INTERVAL_MS }, "marketing batch scheduler started");
}

module.exports = {
  buildAffiliateLinkSweepKey,
  buildBatchKey,
  getIstParts,
  getIstWeekday,
  heartbeatSchedulerLease,
  isInternalSocialOrchestrationSchedulerEnabled,
  logSocialCommunityAutomationResult,
  logSocialMetricCollectionResult,
  runAffiliateLinkSweep,
  acquireSchedulerLease,
  shouldRunAffiliateLinkSweep,
  shouldRunWeeklySocialPlanning,
  startDailyBatchScheduler,
  tickScheduler,
  weeklySocialPlanningSchedule,
};
