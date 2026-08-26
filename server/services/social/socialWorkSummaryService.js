const SocialCommunityItem = require("../../models/SocialCommunityItem");
const SocialConnectionHealth = require("../../models/SocialConnectionHealth");
const SocialGenerationRun = require("../../models/SocialGenerationRun");
const SocialManualAction = require("../../models/SocialManualAction");
const SocialPostDraft = require("../../models/SocialPostDraft");
const SocialPublication = require("../../models/SocialPublication");
const SocialWeeklyPlan = require("../../models/SocialWeeklyPlan");

const CONTENT_PRIORITY_ORDER = Object.freeze([
  "NEEDS_REVIEW",
  "TERMINAL_FAILURE",
  "OPEN_MANUAL_ACTION",
  "GENERATING_WAITING",
]);
const FAILURE_ITEM_LIMIT = 5;
const CONTENT_CALENDAR_PAST_DAYS = 120;
const CONTENT_CALENDAR_FUTURE_DAYS = 180;

async function count(Model, filter) {
  if (typeof Model?.countDocuments !== "function") return 0;
  return Number(await Model.countDocuments(filter)) || 0;
}

async function findOneLean(Model, filter, sort) {
  if (typeof Model?.findOne !== "function") return null;
  let query = Model.findOne(filter);
  if (sort && typeof query?.sort === "function") query = query.sort(sort);
  if (typeof query?.select === "function") query = query.select("_id");
  if (typeof query?.lean === "function") query = query.lean();
  return query;
}

async function findManyLean(Model, filter, { sort = null, select = null, limit = FAILURE_ITEM_LIMIT } = {}) {
  if (typeof Model?.find !== "function") return [];
  let query = Model.find(filter);
  if (sort && typeof query?.sort === "function") query = query.sort(sort);
  if (select && typeof query?.select === "function") query = query.select(select);
  if (limit && typeof query?.limit === "function") query = query.limit(limit);
  if (typeof query?.lean === "function") query = query.lean();
  const rows = await query;
  return Array.isArray(rows) ? rows : [];
}

function id(value) {
  return value == null ? null : String(value);
}

function shortText(value, maximum = 500) {
  return String(value || "").trim().slice(0, maximum) || null;
}

function terminalFailureItem(type, value = {}) {
  const lastError = value.last_error || value.generation_error || {};
  const ownId = id(value._id || value.id);
  return {
    type,
    id: ownId,
    draft_id: type === "DRAFT" ? ownId : id(value.draft_id || value.failed_draft_id || value.selected_draft_id),
    generation_run_id: type === "GENERATION_RUN" ? ownId : id(value.generation_run_id),
    publication_id: type === "PUBLICATION" ? ownId : id(value.publication_id),
    weekly_plan_id: id(value.weekly_plan_id),
    status: shortText(value.status, 80),
    code: shortText(lastError.code || value.error_code, 160),
    message: shortText(lastError.message || value.failure_reason, 500),
    occurred_at: lastError.occurred_at
      || value.failed_at
      || value.finished_at
      || value.updated_at
      || null,
  };
}

function dateKey(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function calendarWindow(now) {
  return {
    from: dateKey(new Date(now.getTime() - CONTENT_CALENDAR_PAST_DAYS * 24 * 60 * 60 * 1000)),
    to: dateKey(new Date(now.getTime() + CONTENT_CALENDAR_FUTURE_DAYS * 24 * 60 * 60 * 1000)),
  };
}

async function resolveCurrentPlan({ now, models, dependencies }) {
  if (typeof dependencies.getCurrentWeeklyPlan === "function") {
    return dependencies.getCurrentWeeklyPlan({ now, dependencies });
  }
  // Avoid invoking the production settings/window resolver when tests or callers
  // intentionally supply a partial Plan model.
  if (models.SocialWeeklyPlan !== SocialWeeklyPlan) return null;
  const { getCurrentWeeklyPlan } = require("./socialGrowthTeamService");
  return getCurrentWeeklyPlan({ now, dependencies });
}

function contentDestinationScopes({ weeklyPlanId, currentPlanId, window }) {
  if (weeklyPlanId) {
    return {
      draft: { weekly_plan_id: weeklyPlanId },
      run: { weekly_plan_id: weeklyPlanId },
      manualAction: { weekly_plan_id: weeklyPlanId },
    };
  }
  const unlinkedCalendarWork = {
    weekly_plan_id: null,
    generation_date: { $gte: window.from, $lte: window.to },
  };
  return {
    draft: currentPlanId
      ? { $or: [{ weekly_plan_id: currentPlanId }, unlinkedCalendarWork] }
      : unlinkedCalendarWork,
    run: currentPlanId
      ? { $or: [{ weekly_plan_id: currentPlanId }, unlinkedCalendarWork] }
      : unlinkedCalendarWork,
    manualAction: currentPlanId
      ? { $or: [{ weekly_plan_id: currentPlanId }, { weekly_plan_id: null }] }
      : { weekly_plan_id: null },
  };
}

async function getWorkSummary({ now = new Date(), weeklyPlanId = null, dependencies = {} } = {}) {
  const models = {
    SocialCommunityItem: dependencies.SocialCommunityItem || SocialCommunityItem,
    SocialConnectionHealth: dependencies.SocialConnectionHealth || SocialConnectionHealth,
    SocialGenerationRun: dependencies.SocialGenerationRun || SocialGenerationRun,
    SocialManualAction: dependencies.SocialManualAction || SocialManualAction,
    SocialPostDraft: dependencies.SocialPostDraft || SocialPostDraft,
    SocialPublication: dependencies.SocialPublication || SocialPublication,
    SocialWeeklyPlan: dependencies.SocialWeeklyPlan || SocialWeeklyPlan,
  };
  const scopedWeeklyPlanId = String(weeklyPlanId || "").trim() || null;
  const currentPlan = scopedWeeklyPlanId ? null : await resolveCurrentPlan({ now, models, dependencies });
  const currentPlanId = id(currentPlan?._id || currentPlan?.id);
  const visibleCalendarWindow = calendarWindow(now);
  const contentScopes = contentDestinationScopes({
    weeklyPlanId: scopedWeeklyPlanId,
    currentPlanId,
    window: visibleCalendarWindow,
  });
  const strategyScopeId = scopedWeeklyPlanId || currentPlanId;
  const strategyScope = strategyScopeId ? { _id: strategyScopeId } : { _id: null };
  const failedRunFilter = {
    status: { $in: ["FAILED", "FAILED_COMPLIANCE", "FAILED_IMAGE_GENERATION"] },
    failed_draft_id: null,
    selected_draft_id: null,
    ...contentScopes.run,
  };
  const failedDraftFilter = { status: "FAILED", ...contentScopes.draft };
  const failedPublicationFilter = { status: { $in: ["FAILED", "UNCERTAIN"] } };

  const [
    strategyNeedsReview,
    strategyTerminalFailure,
    contentNeedsReview,
    contentFailedDrafts,
    contentFailedRunsWithoutDraft,
    contentOpenManualActions,
    contentDraftsWaitingForGeneration,
    contentGeneratingWaiting,
    communityNeedsReview,
    communityTerminalFailure,
    communityOpenManualActions,
    communityGeneratingWaiting,
    resultsTerminalFailure,
    setupUnhealthyConnections,
    weeklyNextReview,
    failedDraftItems,
    failedRunItems,
    failedPublicationItems,
  ] = await Promise.all([
    count(models.SocialWeeklyPlan, { status: "NEEDS_REVIEW", ...strategyScope }),
    count(models.SocialWeeklyPlan, { status: { $in: ["FAILED_RESEARCH", "FAILED_GENERATION", "FAILED_COMPLIANCE", "MANUAL_ACTION_REQUIRED"] }, ...strategyScope }),
    count(models.SocialPostDraft, { status: "NEEDS_REVIEW", ...contentScopes.draft }),
    count(models.SocialPostDraft, failedDraftFilter),
    count(models.SocialGenerationRun, failedRunFilter),
    count(models.SocialManualAction, { status: { $in: ["OPEN", "IN_PROGRESS"] }, community_item_id: null, ...contentScopes.manualAction }),
    count(models.SocialPostDraft, { status: "DRAFT", ...contentScopes.draft }),
    count(models.SocialGenerationRun, { status: { $in: ["PENDING", "RUNNING"] }, ...contentScopes.run }),
    count(models.SocialCommunityItem, { status: { $in: ["REPLY_RECOMMENDED", "NEEDS_REVIEW"] } }),
    count(models.SocialCommunityItem, { status: { $in: ["FAILED", "SEND_UNCERTAIN", "MANUAL_ACTION_REQUIRED", "ESCALATED"] } }),
    count(models.SocialManualAction, { status: { $in: ["OPEN", "IN_PROGRESS"] }, community_item_id: { $ne: null } }),
    count(models.SocialCommunityItem, { status: { $in: ["NEW", "OPEN", "CLASSIFIED", "RECOMMENDATION_QUEUED", "RECOMMENDATION_PROCESSING", "APPROVED", "SEND_QUEUED", "SEND_PROCESSING"] } }),
    count(models.SocialPublication, failedPublicationFilter),
    count(models.SocialConnectionHealth, {
      configured: true,
      status: { $in: ["MISCONFIGURED", "DEGRADED", "ERROR", "DISCONNECTED", "REAUTHORIZATION_REQUIRED"] },
    }),
    findOneLean(
      models.SocialPostDraft,
      scopedWeeklyPlanId
        ? { status: "NEEDS_REVIEW", weekly_plan_id: scopedWeeklyPlanId }
        : { status: "NEEDS_REVIEW", ...contentScopes.draft },
      { scheduled_for: 1, created_at: 1 },
    ),
    findManyLean(models.SocialPostDraft, failedDraftFilter, {
      sort: { failed_at: -1, updated_at: -1 },
      select: "_id weekly_plan_id generation_run_id publication_id status last_error failed_at updated_at",
    }),
    findManyLean(models.SocialGenerationRun, failedRunFilter, {
      sort: { finished_at: -1, updated_at: -1 },
      select: "_id weekly_plan_id selected_draft_id failed_draft_id status last_error failure_reason finished_at updated_at",
    }),
    findManyLean(models.SocialPublication, failedPublicationFilter, {
      sort: { finished_at: -1, updated_at: -1 },
      select: "_id draft_id generation_run_id status last_error finished_at updated_at",
    }),
  ]);

  const fallbackNextReview = weeklyNextReview;
  const contentTerminalFailure = contentFailedDrafts + contentFailedRunsWithoutDraft;
  const contentGenerationWaiting = contentGeneratingWaiting + contentDraftsWaitingForGeneration;
  const strategyCount = strategyNeedsReview + strategyTerminalFailure;
  const contentCount = contentNeedsReview + contentTerminalFailure + contentOpenManualActions + contentGenerationWaiting;
  const communityCount = communityNeedsReview + communityTerminalFailure + communityOpenManualActions + communityGeneratingWaiting;
  const nextReviewId = fallbackNextReview?._id || fallbackNextReview?.id || null;
  const contentFailureItems = [
    ...failedDraftItems.map((item) => terminalFailureItem("DRAFT", item)),
    ...failedRunItems.map((item) => terminalFailureItem("GENERATION_RUN", item)),
  ]
    .sort((left, right) => new Date(right.occurred_at || 0).getTime() - new Date(left.occurred_at || 0).getTime())
    .slice(0, FAILURE_ITEM_LIMIT);

  return {
    generated_at: now,
    scope: {
      weekly_plan_id: scopedWeeklyPlanId || currentPlanId,
      explicit_weekly_plan: Boolean(scopedWeeklyPlanId),
      current_plan_window: currentPlan ? {
        week_start: currentPlan.week_start || null,
        week_end: currentPlan.week_end || null,
      } : null,
      unlinked_content_calendar: scopedWeeklyPlanId ? null : visibleCalendarWindow,
    },
    counts: {
      strategy: strategyCount,
      content: contentCount,
      community: communityCount,
      results: resultsTerminalFailure,
      setup: setupUnhealthyConnections,
    },
    strategy: {
      actionable_count: strategyCount,
      needs_review: strategyNeedsReview,
      terminal_failure: strategyTerminalFailure,
    },
    content: {
      actionable_count: contentCount,
      needs_review: contentNeedsReview,
      terminal_failure: contentTerminalFailure,
      open_manual_action: contentOpenManualActions,
      generating_waiting: contentGenerationWaiting,
      priority_order: [...CONTENT_PRIORITY_ORDER],
      terminal_failure_items: contentFailureItems,
      terminal_failure_items_truncated: contentTerminalFailure > Math.min(
        contentFailureItems.length,
        FAILURE_ITEM_LIMIT,
      ),
    },
    community: {
      actionable_count: communityCount,
      needs_review: communityNeedsReview,
      terminal_failure: communityTerminalFailure,
      open_manual_action: communityOpenManualActions,
      generating_waiting: communityGeneratingWaiting,
    },
    results: {
      actionable_count: resultsTerminalFailure,
      terminal_failure: resultsTerminalFailure,
      terminal_failure_items: failedPublicationItems.map((item) => terminalFailureItem("PUBLICATION", item)),
      terminal_failure_items_truncated: resultsTerminalFailure > failedPublicationItems.length,
    },
    setup: {
      actionable_count: setupUnhealthyConnections,
      unhealthy_connections: setupUnhealthyConnections,
    },
    next_review_draft_id: nextReviewId ? String(nextReviewId) : null,
  };
}

module.exports = {
  CONTENT_PRIORITY_ORDER,
  FAILURE_ITEM_LIMIT,
  getWorkSummary,
};
