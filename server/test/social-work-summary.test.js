const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CONTENT_PRIORITY_ORDER,
  getWorkSummary,
} = require("../services/social/socialWorkSummaryService");
const { _private: { workSummaryQuery } } = require("../controllers/socialGrowthController");

function countModel(values, captured = []) {
  let index = 0;
  return {
    async countDocuments(filter) {
      captured.push(filter);
      const value = values[index];
      index += 1;
      return value;
    },
  };
}

function draftModel({ weekly = null, fallback = null, counts = [0, 0], countFilters = [], findFilters = [] } = {}) {
  let countIndex = 0;
  let findIndex = 0;
  return {
    async countDocuments(filter) {
      countFilters.push(filter);
      const value = counts[countIndex];
      countIndex += 1;
      return value;
    },
    findOne(filter) {
      findFilters.push(filter);
      const value = findIndex === 0 ? weekly : fallback;
      findIndex += 1;
      return {
        sort() { return this; },
        select() { return this; },
        async lean() { return value; },
      };
    },
  };
}

test("work summary returns lightweight actionable counts in the required content priority", async () => {
  const now = new Date("2026-08-24T06:30:00.000Z");
  const manualFilters = [];
  const communityFilters = [];
  const summary = await getWorkSummary({
    now,
    dependencies: {
      SocialWeeklyPlan: countModel([2, 1]),
      SocialPostDraft: draftModel({ weekly: { _id: "507f1f77bcf86cd799439011" }, counts: [3, 4, 0] }),
      SocialGenerationRun: countModel([2, 5]),
      SocialManualAction: countModel([6, 7], manualFilters),
      SocialCommunityItem: countModel([8, 1, 9], communityFilters),
      SocialPublication: countModel([2]),
      SocialConnectionHealth: countModel([1]),
    },
  });

  assert.equal(summary.generated_at, now);
  assert.deepEqual(summary.counts, {
    strategy: 3,
    content: 20,
    community: 25,
    results: 2,
    setup: 1,
  });
  assert.deepEqual(summary.strategy, { actionable_count: 3, needs_review: 2, terminal_failure: 1 });
  assert.deepEqual(summary.content, {
    actionable_count: 20,
    needs_review: 3,
    terminal_failure: 6,
    open_manual_action: 6,
    unresolved_failure_or_blocker: 12,
    queue_complete_eligible: false,
    generating_waiting: 5,
    priority_order: [...CONTENT_PRIORITY_ORDER],
    terminal_failure_items: [],
    terminal_failure_items_truncated: true,
  });
  assert.equal(summary.community.open_manual_action, 7);
  assert.equal(summary.next_review_draft_id, "507f1f77bcf86cd799439011");
  assert.equal(manualFilters[0].community_item_id, null);
  assert.deepEqual(manualFilters[1].community_item_id, { $ne: null });
  assert.ok(communityFilters[1].status.$in.includes("SEND_UNCERTAIN"));
  assert.ok(communityFilters[2].status.$in.includes("SEND_PROCESSING"));
});

test("work summary selects the oldest review draft exposed in its content calendar scope", async () => {
  const summary = await getWorkSummary({
    dependencies: {
      SocialWeeklyPlan: countModel([0, 0]),
      SocialPostDraft: draftModel({ weekly: { _id: "507f1f77bcf86cd799439099" }, counts: [1, 0] }),
      SocialGenerationRun: countModel([0, 0]),
      SocialManualAction: countModel([0, 0]),
      SocialCommunityItem: countModel([0, 0, 0]),
      SocialPublication: countModel([0]),
      SocialConnectionHealth: countModel([0]),
    },
  });
  assert.equal(summary.next_review_draft_id, "507f1f77bcf86cd799439099");
});

test("work summary scopes content polling and next review navigation to one weekly plan", async () => {
  const weeklyPlanId = "507f1f77bcf86cd799439077";
  const draftCountFilters = [];
  const draftFindFilters = [];
  const runFilters = [];
  const manualFilters = [];
  const summary = await getWorkSummary({
    weeklyPlanId,
    dependencies: {
      SocialWeeklyPlan: countModel([0, 0]),
      SocialPostDraft: draftModel({
        weekly: null,
        fallback: { _id: "draft-from-another-week" },
        counts: [2, 1, 4],
        countFilters: draftCountFilters,
        findFilters: draftFindFilters,
      }),
      SocialGenerationRun: countModel([1, 3], runFilters),
      SocialManualAction: countModel([2, 0], manualFilters),
      SocialCommunityItem: countModel([0, 0, 0]),
      SocialPublication: countModel([0]),
      SocialConnectionHealth: countModel([0]),
    },
  });

  assert.equal(summary.content.needs_review, 2);
  assert.equal(summary.content.generating_waiting, 7);
  assert.equal(summary.content.actionable_count, 13);
  assert.equal(summary.next_review_draft_id, null);
  assert.ok(draftCountFilters.every((filter) => filter.weekly_plan_id === weeklyPlanId));
  assert.deepEqual(draftCountFilters[2], { status: "DRAFT", weekly_plan_id: weeklyPlanId });
  assert.ok(runFilters.every((filter) => filter.weekly_plan_id === weeklyPlanId));
  assert.equal(manualFilters[0].weekly_plan_id, weeklyPlanId);
  assert.equal(manualFilters[1].weekly_plan_id, undefined);
  assert.deepEqual(draftFindFilters, [{ status: "NEEDS_REVIEW", weekly_plan_id: weeklyPlanId }]);
});

function rowsQuery(rows) {
  return {
    sort() { return this; },
    select() { return this; },
    limit() { return this; },
    async lean() { return rows; },
  };
}

test("unscoped work summary mirrors the current-plan and visible one-off destinations and describes failures", async () => {
  const now = new Date("2026-08-24T06:30:00.000Z");
  const planId = "507f1f77bcf86cd799439070";
  const strategyFilters = [];
  const draftCountFilters = [];
  const runCountFilters = [];
  const manualFilters = [];
  const resultFilters = [];
  const draftFailure = {
    _id: "507f1f77bcf86cd799439071",
    weekly_plan_id: planId,
    generation_run_id: "507f1f77bcf86cd799439072",
    status: "FAILED",
    last_error: { code: "image_invalid", message: "Generated artwork did not pass validation.", occurred_at: new Date("2026-08-24T06:00:00.000Z") },
  };
  const runFailure = {
    _id: "507f1f77bcf86cd799439073",
    weekly_plan_id: planId,
    status: "FAILED_COMPLIANCE",
    last_error: { code: "compliance_blocked", message: "Copy revision could not satisfy policy.", occurred_at: new Date("2026-08-24T06:15:00.000Z") },
  };
  const publicationFailure = {
    _id: "507f1f77bcf86cd799439074",
    draft_id: "507f1f77bcf86cd799439071",
    generation_run_id: "507f1f77bcf86cd799439072",
    status: "UNCERTAIN",
    last_error: { code: "meta_timeout", message: "Meta did not confirm the publication outcome.", occurred_at: new Date("2026-08-24T06:20:00.000Z") },
  };
  let draftCountIndex = 0;
  let runCountIndex = 0;
  const summary = await getWorkSummary({
    now,
    dependencies: {
      getCurrentWeeklyPlan: async () => ({ _id: planId, week_start: "2026-08-24", week_end: "2026-08-30" }),
      SocialWeeklyPlan: countModel([1, 0], strategyFilters),
      SocialPostDraft: {
        async countDocuments(filter) {
          draftCountFilters.push(filter);
          return [2, 1, 0][draftCountIndex++];
        },
        findOne() { return rowsQuery([{ _id: "507f1f77bcf86cd799439075" }]); },
        find() { return rowsQuery([draftFailure]); },
      },
      SocialGenerationRun: {
        async countDocuments(filter) {
          runCountFilters.push(filter);
          return [1, 0][runCountIndex++];
        },
        find() { return rowsQuery([runFailure]); },
      },
      SocialManualAction: countModel([1, 0], manualFilters),
      SocialCommunityItem: countModel([0, 0, 0]),
      SocialPublication: {
        async countDocuments(filter) { resultFilters.push(filter); return 1; },
        find() { return rowsQuery([publicationFailure]); },
      },
      SocialConnectionHealth: countModel([0]),
    },
  });

  assert.deepEqual(strategyFilters[0], { status: "NEEDS_REVIEW", _id: planId });
  assert.equal(summary.scope.weekly_plan_id, planId);
  assert.deepEqual(summary.scope.current_plan_window, { week_start: "2026-08-24", week_end: "2026-08-30" });
  assert.ok(draftCountFilters.every((filter) => Array.isArray(filter.$or)));
  assert.deepEqual(draftCountFilters[0].$or, [
    { weekly_plan_id: planId },
    { weekly_plan_id: null, generation_date: { $gte: "2026-04-26", $lte: "2027-02-20" } },
  ]);
  assert.ok(runCountFilters.every((filter) => Array.isArray(filter.$or)));
  assert.deepEqual(manualFilters[0].$or, [{ weekly_plan_id: planId }, { weekly_plan_id: null }]);
  assert.deepEqual(resultFilters[0], { status: { $in: ["FAILED", "UNCERTAIN"] } });
  assert.deepEqual(summary.content.terminal_failure_items.map((item) => item.type), ["GENERATION_RUN", "DRAFT"]);
  assert.equal(summary.content.terminal_failure_items[0].code, "compliance_blocked");
  assert.equal(summary.content.terminal_failure_items_truncated, false);
  assert.deepEqual(summary.results.terminal_failure_items[0], {
    type: "PUBLICATION",
    id: "507f1f77bcf86cd799439074",
    draft_id: "507f1f77bcf86cd799439071",
    generation_run_id: "507f1f77bcf86cd799439072",
    publication_id: "507f1f77bcf86cd799439074",
    weekly_plan_id: null,
    status: "UNCERTAIN",
    code: "meta_timeout",
    message: "Meta did not confirm the publication outcome.",
    occurred_at: new Date("2026-08-24T06:20:00.000Z"),
  });
});

test("work-summary controller maps only the optional weekly plan query scope", () => {
  assert.deepEqual(workSummaryQuery({ query: { weekly_plan_id: "  plan-active  ", ignored: "value" } }), {
    weeklyPlanId: "plan-active",
  });
  assert.deepEqual(workSummaryQuery({ query: {} }), { weeklyPlanId: null });
});

test("work summary hides archived failures and older attempts superseded by a successful weekly retry", async () => {
  const planId = "507f1f77bcf86cd799439080";
  const failedId = "507f1f77bcf86cd799439081";
  const archivedId = "507f1f77bcf86cd799439084";
  const archivedDraftId = "507f1f77bcf86cd799439085";
  const failure = {
    _id: failedId,
    weekly_plan_id: planId,
    weekly_candidate_id: "weekly-candidate-1",
    status: "FAILED_COMPLIANCE",
    selected_draft_id: null,
    failed_draft_id: null,
    recovery_archived_at: null,
    created_at: new Date("2026-09-01T08:00:00.000Z"),
  };
  const success = {
    _id: "507f1f77bcf86cd799439082",
    weekly_plan_id: planId,
    weekly_candidate_id: "weekly-candidate-1",
    status: "SUCCEEDED",
    selected_draft_id: "507f1f77bcf86cd799439083",
    created_at: new Date("2026-09-01T09:00:00.000Z"),
  };
  const archivedFailure = {
    _id: archivedId,
    weekly_plan_id: planId,
    weekly_candidate_id: "weekly-candidate-2",
    status: "FAILED_IMAGE_GENERATION",
    selected_draft_id: null,
    failed_draft_id: archivedDraftId,
    recovery_archived_at: new Date("2026-09-01T09:30:00.000Z"),
    created_at: new Date("2026-09-01T08:30:00.000Z"),
  };
  const runFilters = [];
  const draftFilters = [];
  const RunModel = {
    async countDocuments(filter) {
      runFilters.push(filter);
      if (filter.status?.$in?.includes("FAILED_COMPLIANCE")) {
        return filter._id?.$nin?.includes(failedId) && filter._id.$nin.includes(archivedId) ? 0 : 2;
      }
      return 0;
    },
    find(filter) {
      const rows = filter.status === "SUCCEEDED"
        ? [success]
        : filter._id?.$nin?.includes(failedId) ? [] : [failure, archivedFailure];
      return rowsQuery(rows);
    },
  };
  const summary = await getWorkSummary({
    weeklyPlanId: planId,
    dependencies: {
      SocialWeeklyPlan: countModel([0, 0]),
      SocialPostDraft: {
        async countDocuments(filter) {
          draftFilters.push(filter);
          if (filter.status === "FAILED") return filter._id?.$nin?.includes(archivedDraftId) ? 0 : 1;
          return 0;
        },
        findOne() { return rowsQuery([]); },
        find(filter) { return rowsQuery(filter._id?.$nin?.includes(archivedDraftId) ? [] : [{ _id: archivedDraftId, status: "FAILED" }]); },
      },
      SocialGenerationRun: RunModel,
      SocialManualAction: countModel([0, 0]),
      SocialCommunityItem: countModel([0, 0, 0]),
      SocialPublication: countModel([0]),
      SocialConnectionHealth: countModel([0]),
    },
  });

  assert.equal(summary.content.terminal_failure, 0);
  assert.deepEqual(summary.content.terminal_failure_items, []);
  assert.ok(runFilters[0]._id.$nin.includes(failedId));
  assert.ok(runFilters[0]._id.$nin.includes(archivedId));
  assert.ok(draftFilters.find((filter) => filter.status === "FAILED")._id.$nin.includes(archivedDraftId));
  assert.equal(runFilters[0].recovery_archived_at, null);
  assert.equal(runFilters[0].superseded_by_generation_run_id, null);
});

test("work summary hides every older failed draft when its shared run ultimately succeeds", async () => {
  const planId = "507f1f77bcf86cd799439090";
  const runId = "507f1f77bcf86cd799439091";
  const oldDraftIds = ["507f1f77bcf86cd799439092", "507f1f77bcf86cd799439093"];
  const successfulRun = {
    _id: runId,
    weekly_plan_id: planId,
    status: "SUCCEEDED",
    selected_draft_id: "507f1f77bcf86cd799439094",
  };
  const failedDrafts = oldDraftIds.map((_id) => ({ _id, generation_run_id: runId, status: "FAILED" }));
  const failedDraftFilters = [];
  const DraftModel = {
    async countDocuments(filter) {
      if (filter.status === "FAILED") {
        failedDraftFilters.push(filter);
        return filter._id?.$nin?.length === oldDraftIds.length ? 0 : failedDrafts.length;
      }
      return 0;
    },
    findOne() { return rowsQuery([]); },
    find(filter) {
      if (filter.status === "FAILED" && !filter._id?.$nin) return rowsQuery(failedDrafts);
      return rowsQuery([]);
    },
  };
  const RunModel = {
    async countDocuments() { return 0; },
    find(filter) {
      if (filter.status === "SUCCEEDED" || filter._id?.$in?.includes(runId)) return rowsQuery([successfulRun]);
      return rowsQuery([]);
    },
  };

  const summary = await getWorkSummary({
    weeklyPlanId: planId,
    dependencies: {
      SocialWeeklyPlan: countModel([0, 0]),
      SocialPostDraft: DraftModel,
      SocialGenerationRun: RunModel,
      SocialManualAction: countModel([0, 0]),
      SocialCommunityItem: countModel([0, 0, 0]),
      SocialPublication: countModel([0]),
      SocialConnectionHealth: countModel([0]),
    },
  });

  assert.equal(summary.content.terminal_failure, 0);
  assert.deepEqual(summary.content.terminal_failure_items, []);
  assert.deepEqual(failedDraftFilters[0]._id.$nin.sort(), [...oldDraftIds].sort());
});
