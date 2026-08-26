const {
  approveCommunityReply,
  approveWeeklyPlan,
  getAnalyticsSummary,
  getConnections,
  getCurrentWeeklyPlan,
  getMetaResearchDesk,
  listCommunityItems,
  processPendingWeeklyPlans,
  publicCommunityItem,
  publicWeeklyPlan,
  recommendCommunityReply,
  refreshGrowthAnalytics,
  replaceWeeklyPlanSlot,
  rejectCommunityReply,
  rejectWeeklyPlan,
  requestWeeklyPlan,
  requestWeeklyPostProduction,
} = require("../services/social/socialGrowthTeamService");
const { getWorkSummary } = require("../services/social/socialWorkSummaryService");
const {
  acknowledgeCommunityEscalation,
  approveAndQueueCommunityReply,
  processCommunityWorkflow,
  queueApprovedCommunityReply,
  reconcileUncertainCommunitySend,
  resolveCommunityEscalation,
} = require("../services/social/socialCommunityWorkflowService");

function context(req) {
  return {
    actor: req.user,
    requestId: req.id || null,
    ip: req.ip || req.socket?.remoteAddress || null,
  };
}

function sendError(res, error, fallbackStatus = 500) {
  return res.status(error.statusCode || error.status || fallbackStatus).json({
    message: error.message || "Social Growth Team request failed",
    ...(error.code ? { code: error.code } : {}),
    ...(error.details ? { details: error.details } : {}),
    ...(error.validation_errors ? { validation_errors: error.validation_errors } : {}),
  });
}

async function connections(req, res) {
  try {
    res.json(await getConnections({ refresh: false }));
  } catch (error) {
    sendError(res, error);
  }
}

async function checkConnections(req, res) {
  try {
    res.json({ message: "Connection health checks completed", ...(await getConnections({ refresh: true })) });
  } catch (error) {
    sendError(res, error);
  }
}

async function currentWeeklyPlan(req, res) {
  try {
    const plan = await getCurrentWeeklyPlan();
    res.json({ plan: publicWeeklyPlan(plan) });
  } catch (error) {
    sendError(res, error);
  }
}

async function generateWeeklyPlan(req, res) {
  try {
    const result = await requestWeeklyPlan({
      actor: req.user,
      force: req.body?.force === true,
      allowApprovedReplacement: req.body?.replace_approved === true,
    });
    if (!result.reused || result.plan?.status === "QUEUED") {
      setImmediate(() => {
        void processPendingWeeklyPlans({ limit: 1 }).catch((error) => {
          (req.log || console).error({ err: error }, "weekly social planning worker failed");
        });
      });
    }
    res.status(202).json({
      message: result.reused ? "This week's AI plan already exists" : "The independent AI team is building this week's plan",
      queued: true,
      reused: result.reused,
      plan: publicWeeklyPlan(result.plan),
    });
  } catch (error) {
    sendError(res, error, 409);
  }
}

async function approvePlan(req, res) {
  try {
    const result = await approveWeeklyPlan(req.params.id, context(req));
    if (result.production.queued > 0) {
      setImmediate(() => {
        const { processPendingSocialGenerationRuns } = require("../services/social/socialManagerService");
        void processPendingSocialGenerationRuns({ limit: result.production.queued }).catch((error) => {
          (req.log || console).error({ err: error }, "weekly creative production worker failed");
        });
      });
    }
    res.status(202).json({
      message: result.production.queued
        ? "Weekly strategy approved and all selected creatives were queued"
        : "Weekly strategy and creative queues were already approved",
      plan: publicWeeklyPlan(result.plan),
      production: result.production,
    });
  } catch (error) {
    sendError(res, error, 409);
  }
}

async function rejectPlan(req, res) {
  try {
    res.json({
      message: "Weekly strategy rejected",
      plan: publicWeeklyPlan(await rejectWeeklyPlan(req.params.id, req.body?.reason || req.body?.notes, context(req))),
    });
  } catch (error) {
    sendError(res, error, 409);
  }
}

async function producePlanPost(req, res) {
  try {
    const result = await requestWeeklyPostProduction(req.params.id, req.params.candidateId, context(req));
    res.status(202).json({
      message: result.reused ? "Creative production is already queued" : "AI copy, compliance and original-creative production queued",
      reused: result.reused,
      plan: publicWeeklyPlan(result.plan),
      generation_run_id: result.run?._id || result.run?.id || null,
    });
  } catch (error) {
    sendError(res, error, 409);
  }
}

async function replacePlanSlot(req, res) {
  try {
    const result = await replaceWeeklyPlanSlot(
      req.params.id,
      req.params.slotNumber,
      req.body?.candidate_id,
      context(req),
    );
    res.json({
      message: "Weekly slot replaced with a retained candidate; strategy approval is still required",
      plan: publicWeeklyPlan(result.plan),
      replacement: result.replacement,
    });
  } catch (error) {
    sendError(res, error, 409);
  }
}

function workSummaryQuery(req) {
  return { weeklyPlanId: String(req.query?.weekly_plan_id || "").trim() || null };
}

async function workSummary(req, res) {
  try {
    res.json(await getWorkSummary(workSummaryQuery(req)));
  } catch (error) {
    sendError(res, error);
  }
}

async function weeklyResearch(req, res) {
  try {
    const [plan, metaResearch] = await Promise.all([
      getCurrentWeeklyPlan(),
      getMetaResearchDesk(),
    ]);
    const research = plan?.research_digest || null;
    const audience = plan?.audience_intelligence || null;
    const sourceMap = new Map();
    for (const source of [
      ...((research?.sources || []).map((item) => ({
        title: item.title,
        url: item.location,
        published_at: item.publicationDate,
        accessed_at: item.accessDate,
        claim_supported: item.claimSupported,
        confidence: item.confidence,
      }))),
      ...(metaResearch.sources || []),
    ]) {
      const key = String(source?.url || "").trim();
      if (key && !sourceMap.has(key)) sourceMap.set(key, source);
    }
    const hasDigest = Boolean(research || metaResearch.observations?.length);
    const digest = hasDigest ? {
      id: String(plan?._id || "meta-research-latest"),
      week_start: plan?.week_start || null,
      week_end: plan?.week_end || null,
      status: plan?.status || metaResearch.status || "NOT_GENERATED",
      summary: research?.executiveSummary || metaResearch.summary || "",
      market_signals: research?.currentTopics || [],
      internal_signals: [],
      audience_questions: (audience?.questions || []).map((item) => item.theme),
      audience_themes: [
        ...(audience?.emotionalThemes || []).map((item) => item.theme),
        ...(audience?.objections || []).map((item) => item.theme),
      ],
      hashtag_observations: [...new Set([...(research?.hashtagObservations || []), ...(metaResearch.hashtag_observations || [])])],
      competitor_observations: [...new Set([...(research?.competitorObservations || []), ...(metaResearch.competitor_observations || [])])],
      topics_to_avoid: (research?.topicsToAvoid || []).map((item) => item.topic || item.reason).filter(Boolean),
      sources: [...sourceMap.values()],
      generated_at: plan?.generation_completed_at || plan?.updated_at || metaResearch.generated_at || null,
    } : null;
    res.json({
      digest,
      research_digest: research,
      meta_research: metaResearch,
      audience_intelligence: audience,
      supervisor_recommendation: plan?.supervisor_recommendation || null,
    });
  } catch (error) {
    sendError(res, error);
  }
}

async function analyticsSummary(req, res) {
  try {
    res.json(await getAnalyticsSummary({ days: req.query.days || 90 }));
  } catch (error) {
    sendError(res, error);
  }
}

async function refreshAnalytics(req, res) {
  try {
    const result = await refreshGrowthAnalytics({
      actor: req.user,
      startDate: req.body?.start_date || null,
      endDate: req.body?.end_date || null,
    });
    res.json({ message: "Configured aggregate analytics connections were refreshed", ...result });
  } catch (error) {
    sendError(res, error);
  }
}

async function community(req, res) {
  try {
    res.json(await listCommunityItems({ status: req.query.status || null, page: req.query.page || 1, limit: req.query.limit || 50 }));
  } catch (error) {
    sendError(res, error);
  }
}

async function recommendReply(req, res) {
  try {
    res.json({ message: "AI reply drafted for human review; nothing was sent", item: publicCommunityItem(await recommendCommunityReply(req.params.id, context(req))) });
  } catch (error) {
    sendError(res, error, 409);
  }
}

async function approveReply(req, res) {
  try {
    res.json({ message: "Reply approved but not sent", item: publicCommunityItem(await approveCommunityReply(req.params.id, context(req))) });
  } catch (error) {
    sendError(res, error, 409);
  }
}

async function rejectReply(req, res) {
  try {
    res.json({ message: "Reply rejected", item: publicCommunityItem(await rejectCommunityReply(req.params.id, req.body?.reason || req.body?.notes, context(req))) });
  } catch (error) {
    sendError(res, error, 409);
  }
}

async function reconcileReply(req, res) {
  try {
    const result = await reconcileUncertainCommunitySend(req.params.id, {
      actor: req.user,
      externalReplyId: req.body?.external_reply_id,
      notes: req.body?.notes,
    });
    res.json({
      message: result.reused
        ? "This uncertain reply was already reconciled with the same Meta identifier"
        : "The uncertain reply was reconciled without retrying provider delivery",
      reused: result.reused,
      item: publicCommunityItem(result.item),
      reconciliation: {
        external_reply_id: result.item?.send_result?.external_reply_id || null,
        reconciled_at: result.item?.send_intent?.reconciled_at || null,
        manual_action_id: result.manual_action?._id || result.manual_action?.id || null,
      },
    });
  } catch (error) {
    sendError(res, error, 409);
  }
}

async function acknowledgeEscalation(req, res) {
  try {
    const result = await acknowledgeCommunityEscalation(req.params.id, {
      actor: req.user,
      notes: req.body?.notes,
    });
    res.json({
      message: result.reused ? "This escalation was already acknowledged" : "The escalation was acknowledged",
      reused: result.reused,
      item: publicCommunityItem(result.item),
    });
  } catch (error) {
    sendError(res, error, 409);
  }
}

async function resolveEscalation(req, res) {
  try {
    const result = await resolveCommunityEscalation(req.params.id, {
      actor: req.user,
      notes: req.body?.notes,
    });
    res.json({
      message: result.reused ? "This escalation was already resolved" : "The escalation was resolved and archived",
      reused: result.reused,
      item: publicCommunityItem(result.item),
    });
  } catch (error) {
    sendError(res, error, 409);
  }
}

async function sendReply(req, res) {
  try {
    const result = await queueApprovedCommunityReply(req.params.id, {
      actor: req.user,
      idempotencyKey: req.get("Idempotency-Key") || null,
    });
    if (!result.reused && result.send_intent?.status === "QUEUED") {
      setImmediate(() => {
        void processCommunityWorkflow({ limit: 1 }).catch((error) => {
          (req.log || console).error({ err: error }, "durable community send worker failed");
        });
      });
    }
    res.status(202).json({
      message: result.reused
        ? "This approved community reply is already queued or completed"
        : "The previously approved reply was durably queued for delivery",
      reused: result.reused,
      item: publicCommunityItem(result.item),
      send_intent: result.send_intent ? {
        status: result.send_intent.status,
        idempotency_key: result.send_intent.idempotency_key,
        approved_reply_checksum: result.send_intent.approved_reply_checksum,
        queued_at: result.send_intent.queued_at,
      } : null,
    });
  } catch (error) {
    sendError(res, error, 409);
  }
}

async function approveAndSendReply(req, res) {
  try {
    const result = await approveAndQueueCommunityReply(req.params.id, {
      actor: req.user,
      reply: req.body?.reply ?? null,
      idempotencyKey: req.get("Idempotency-Key") || null,
    });
    if (!result.reused && result.send_intent?.status === "QUEUED") {
      setImmediate(() => {
        void processCommunityWorkflow({ limit: 1 }).catch((error) => {
          (req.log || console).error({ err: error }, "durable community send worker failed");
        });
      });
    }
    res.status(202).json({
      message: result.reused
        ? "This exact approved community reply is already queued or completed"
        : "The exact approved reply was durably queued for delivery",
      reused: result.reused,
      item: publicCommunityItem(result.item),
      send_intent: result.send_intent ? {
        status: result.send_intent.status,
        idempotency_key: result.send_intent.idempotency_key,
        approved_reply_checksum: result.send_intent.approved_reply_checksum,
        queued_at: result.send_intent.queued_at,
      } : null,
    });
  } catch (error) {
    sendError(res, error, 409);
  }
}

module.exports = {
  acknowledgeEscalation,
  analyticsSummary,
  approvePlan,
  approveAndSendReply,
  approveReply,
  checkConnections,
  community,
  connections,
  currentWeeklyPlan,
  generateWeeklyPlan,
  producePlanPost,
  replacePlanSlot,
  recommendReply,
  refreshAnalytics,
  reconcileReply,
  rejectPlan,
  rejectReply,
  resolveEscalation,
  sendReply,
  weeklyResearch,
  workSummary,
  _private: { workSummaryQuery },
};
