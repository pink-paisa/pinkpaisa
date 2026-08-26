const {
  processPendingWeeklyPlans,
  refreshGrowthAnalytics,
  requestWeeklyPlan,
  runDueWeeklyPrepublication,
} = require("../services/social/socialGrowthTeamService");
const { collectDueInstagramMetricSnapshots } = require("../services/social/socialMetricCollectionService");
const { executeIdempotentSocialOrchestration } = require("../services/social/socialOrchestrationIdempotency");
const { getSocialManagerSettings } = require("../utils/socialManagerSettings");

function sendError(res, error) {
  return res.status(error.statusCode || error.status || 500).json({ message: error.message, code: error.code || null });
}

function rejectSignedWeeklyForce(body) {
  if (!Boolean(body?.force)) return null;
  return {
    statusCode: 400,
    body: {
      message: "Signed automation cannot force-reset a weekly plan; use the authenticated admin action",
      code: "social_orchestration_force_not_allowed",
    },
  };
}

async function runIdempotent(req, res, operation, execute) {
  try {
    if (req.socialOrchestration?.operation !== operation) {
      const error = new Error("The verified Social orchestration target does not match this operation");
      error.code = "social_orchestration_target_mismatch";
      error.statusCode = 401;
      throw error;
    }
    const outcome = await executeIdempotentSocialOrchestration({
      operation,
      deliveryFingerprint: req.socialOrchestration?.deliveryFingerprint,
      idempotencyKey: req.socialOrchestration?.idempotencyKey,
      requestTimestamp: req.socialOrchestration?.timestamp,
      rawBody: req.rawBody,
      execute,
    });
    res.setHeader("X-Idempotency-Key", req.socialOrchestration.idempotencyKey);
    res.setHeader("X-Idempotent-Replay", outcome.replayed ? "true" : "false");
    res.setHeader("X-Idempotency-Attempt", String(outcome.attemptCount || 0));
    if (outcome.retryAfterSeconds) res.setHeader("Retry-After", String(outcome.retryAfterSeconds));
    return res.status(outcome.statusCode).json(outcome.body);
  } catch (error) {
    return sendError(res, error);
  }
}

async function weeklyPlan(req, res) {
  return runIdempotent(req, res, "WEEKLY_PLAN", async () => {
    const forceRejection = rejectSignedWeeklyForce(req.body);
    if (forceRejection) return forceRejection;
    const result = await requestWeeklyPlan({ force: false });
    setImmediate(() => void processPendingWeeklyPlans({ limit: 1 }).catch(() => null));
    return {
      statusCode: 202,
      body: { accepted: true, reused: result.reused, plan_id: result.plan?._id || null, status: result.plan?.status || null },
    };
  });
}

async function prepublication(req, res) {
  return runIdempotent(req, res, "PREPUBLICATION", async () => {
    const settings = await getSocialManagerSettings();
    const result = await runDueWeeklyPrepublication({
      lookaheadHours: req.body?.lookahead_hours || settings.weekly_planning?.prepublication_lead_hours || 24,
    });
    return { statusCode: 200, body: { accepted: true, ...result } };
  });
}

async function metrics(req, res) {
  return runIdempotent(req, res, "METRICS", async () => {
    const settings = await getSocialManagerSettings();
    const [aggregate, instagram] = await Promise.all([
      refreshGrowthAnalytics({ startDate: req.body?.start_date || null, endDate: req.body?.end_date || null }),
      collectDueInstagramMetricSnapshots({ settings, limit: req.body?.limit || 20 }),
    ]);
    return { statusCode: 200, body: { accepted: true, aggregate, instagram } };
  });
}

module.exports = {
  metrics,
  prepublication,
  weeklyPlan,
  _private: { rejectSignedWeeklyForce, runIdempotent, sendError },
};
