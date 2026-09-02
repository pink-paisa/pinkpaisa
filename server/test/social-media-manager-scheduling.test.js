const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const {
  approveDraft,
  approveAndScheduleDraft,
  getTodayRecommendation,
  requestGeneration,
  runDueSocialGeneration,
  scheduleDraft,
  _private: { draftQueueNavigation },
} = require("../services/social/socialManagerService");
const { normalizeSocialManagerSettings } = require("../utils/socialManagerSettings");
const { isInternalSocialOrchestrationSchedulerEnabled } = require("../services/dailyBatchScheduler");
const { buildSocialCaptionContract } = require("../services/social/socialCaptionPolicy");
const { _private: { buildRenderItems, stableStringify } } = require("../services/socialCreativeService");

function enabledSettings() {
  return {
    feature_enabled: true,
    daily_generation: {
      enabled: true,
      hour_ist: 8,
      minute_ist: 0,
    },
    cost_controls: {
      daily_generation_limit: 0,
      manual_generation_limit_per_hour: 0,
      monthly_budget_inr: 5000,
      retry_limit: 2,
    },
  };
}

test("internal Social orchestration scheduling is default-on and can be disabled without a request throttle", () => {
  assert.equal(isInternalSocialOrchestrationSchedulerEnabled({}), true);
  assert.equal(isInternalSocialOrchestrationSchedulerEnabled({ SOCIAL_INTERNAL_ORCHESTRATION_SCHEDULER_ENABLED: "true" }), true);
  for (const value of ["false", "0", "no", "off", " FALSE "]) {
    assert.equal(
      isInternalSocialOrchestrationSchedulerEnabled({ SOCIAL_INTERNAL_ORCHESTRATION_SCHEDULER_ENABLED: value }),
      false,
    );
  }
});

test("Social Manager settings discard every legacy count-based throttle", () => {
  const settings = normalizeSocialManagerSettings({
    cost_controls: {
      daily_generation_limit: 1,
      manual_generation_limit_per_hour: 1,
      daily_image_generation_limit: 1,
      monthly_budget_inr: 5000,
    },
  });
  assert.deepEqual(Object.keys(settings.cost_controls).sort(), [
    "cache_enabled",
    "monthly_budget_inr",
    "request_timeout_ms",
    "retry_limit",
  ]);
});

test("today readiness permits manual generation when only the legacy daily scheduler is disabled", async () => {
  const previousOpenAiKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-openai-key";
  try {
    const result = await getTodayRecommendation({
      now: new Date("2026-09-01T06:00:00.000Z"),
      dependencies: {
        getSocialManagerSettings: async () => ({
          ...enabledSettings(),
          daily_generation: { enabled: false, hour_ist: 8, minute_ist: 0 },
          generation: { full_ai_generation: true },
          research: { enabled: true, provider: "AUTO" },
          publishing: { enabled: false, provider: "DISABLED" },
        }),
        getInstagramConnectionSummary: async () => ({ is_connected: false, status: "not_configured" }),
        SocialGenerationRun: {
          findOne: () => ({ sort: async () => null }),
        },
        SocialPostDraft: {
          findOne: () => ({ sort: async () => null }),
        },
      },
    });

    assert.equal(result.readiness.generation_enabled, false);
    assert.equal(result.readiness.manual_generation_enabled, true);
    assert.equal(result.readiness.ai_configured, true);
    assert.ok(result.readiness.warnings.some((warning) => /Automatic daily generation is disabled/i.test(warning)));
    assert.equal(result.readiness.blockers.length, 0);
  } finally {
    if (previousOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousOpenAiKey;
  }
});

test("requestGeneration idempotently reuses today's draft and linked run without creating anything", async () => {
  const now = new Date("2026-08-22T06:00:00.000Z");
  const draft = {
    _id: "draft-today",
    generation_date: "2026-08-22",
    generation_run_id: "run-today",
    revision: 2,
  };
  const run = {
    _id: "run-today",
    generation_date: "2026-08-22",
    status: "SUCCEEDED",
    selected_draft_id: "draft-today",
  };
  let createCalls = 0;
  let limitQueryCalls = 0;
  const dependencies = {
    getSocialManagerSettings: async () => enabledSettings(),
    SocialPostDraft: {
      findOne(query) {
        assert.deepEqual(query, { generation_date: "2026-08-22" });
        return {
          sort: async (sort) => {
            assert.deepEqual(sort, { revision: -1, created_at: -1 });
            return draft;
          },
        };
      },
    },
    SocialGenerationRun: {
      findById: async (id) => {
        assert.equal(id, draft.generation_run_id);
        return run;
      },
      findOne: async () => {
        throw new Error("run lookup after the linked run must not occur");
      },
      create: async () => {
        createCalls += 1;
        throw new Error("a new generation run must not be created");
      },
      countDocuments: async () => {
        limitQueryCalls += 1;
        return 0;
      },
      aggregate: async () => {
        limitQueryCalls += 1;
        return [];
      },
    },
    SocialAuditLog: {
      create: async () => {
        throw new Error("a reuse must not append a queued audit event");
      },
    },
  };

  const result = await requestGeneration({ now, dependencies });
  assert.deepEqual(result, { run, draft, reused: true });
  assert.equal(createCalls, 0);
  assert.equal(limitQueryCalls, 0);
});

test("requestGeneration reuses today's pending run when no draft exists", async () => {
  const now = new Date("2026-08-22T06:00:00.000Z");
  const pendingRun = {
    _id: "run-pending",
    generation_date: "2026-08-22",
    status: "PENDING",
  };
  let createCalls = 0;
  const dependencies = {
    getSocialManagerSettings: async () => enabledSettings(),
    SocialPostDraft: {
      findOne: () => ({ sort: async () => null }),
    },
    SocialGenerationRun: {
      findOne(query) {
        assert.deepEqual(query, {
          generation_date: "2026-08-22",
          status: { $in: ["PENDING", "RUNNING"] },
        });
        return {
          sort: async (sort) => {
            assert.deepEqual(sort, { created_at: -1 });
            return pendingRun;
          },
        };
      },
      create: async () => {
        createCalls += 1;
        throw new Error("a duplicate run must not be created");
      },
      countDocuments: async () => {
        throw new Error("generation limits must not run for a reused request");
      },
      aggregate: async () => {
        throw new Error("budget aggregation must not run for a reused request");
      },
    },
  };

  const result = await requestGeneration({ triggerType: "SCHEDULED", now, dependencies });
  assert.deepEqual(result, { run: pendingRun, draft: null, reused: true });
  assert.equal(createCalls, 0);
});

test("forced manual generation ignores legacy daily and hourly request caps", async () => {
  const now = new Date("2026-08-22T06:15:00.000Z");
  const createdRun = { _id: "manual-unthrottled", status: "PENDING" };
  let createCalls = 0;
  const dependencies = {
    getSocialManagerSettings: async () => enabledSettings(),
    SocialGenerationRun: {
      findOne: async (query) => {
        assert.equal(typeof query.idempotency_key, "string");
        return null;
      },
      countDocuments: async () => {
        throw new Error("legacy generation-count throttles must not query the database");
      },
      aggregate: async (pipeline) => {
        assert.equal(pipeline[0].$match.created_at.$gte instanceof Date, true);
        return [];
      },
      create: async (record) => {
        createCalls += 1;
        assert.equal(record.trigger_type, "MANUAL");
        assert.equal(record.status, "PENDING");
        return createdRun;
      },
    },
    SocialAuditLog: { create: async (record) => record },
  };

  const result = await requestGeneration({
    triggerType: "MANUAL",
    force: true,
    now,
    actor: { _id: "admin-1", role: "admin" },
    dependencies,
  });

  assert.deepEqual(result, { run: createdRun, draft: null, reused: false });
  assert.equal(createCalls, 1);
});

test("manual generation rejects an ineligible artwork-only format before queueing", async () => {
  let createCalls = 0;
  const dependencies = {
    getSocialManagerSettings: async () => ({
      ...enabledSettings(),
      generation: { default_visual_mode: "AI_VISUAL_WITH_EXACT_OVERLAY" },
    }),
    SocialGenerationRun: {
      findOne: async () => null,
      aggregate: async () => [],
      create: async () => { createCalls += 1; },
    },
  };
  await assert.rejects(
    () => requestGeneration({
      triggerType: "MANUAL",
      force: true,
      generationRequest: {
        requested_format: "REEL",
        requested_post_type: "AWARENESS",
        visual_mode: "AI_ARTWORK_ONLY",
      },
      dependencies,
    }),
    (error) => error.code === "social_visual_mode_ineligible"
      && error.statusCode === 409
      && error.visual_mode_resolution?.effective === "AI_VISUAL_WITH_EXACT_OVERLAY",
  );
  assert.equal(createCalls, 0);
});

test("manual artwork-only generation requires a concrete eligible format and objective before queueing", async () => {
  let createCalls = 0;
  const dependencies = {
    getSocialManagerSettings: async () => ({
      ...enabledSettings(),
      generation: { default_visual_mode: "AI_ARTWORK_ONLY" },
    }),
    SocialGenerationRun: {
      findOne: async () => null,
      aggregate: async () => [],
      create: async () => { createCalls += 1; },
    },
  };

  for (const generationRequest of [
    { requested_format: "AUTO_CHOOSE", requested_post_type: "EDUCATION", visual_mode: "AI_ARTWORK_ONLY" },
    { requested_format: "SINGLE_IMAGE", visual_mode: "AI_ARTWORK_ONLY" },
    { requested_format: "AUTO_CHOOSE", requested_post_type: "AUTO_CHOOSE" },
  ]) {
    await assert.rejects(
      () => requestGeneration({ triggerType: "MANUAL", force: true, generationRequest, dependencies }),
      (error) => error.code === "social_visual_mode_ineligible"
        && error.statusCode === 409
        && error.visual_mode_resolution?.effective === "AI_VISUAL_WITH_EXACT_OVERLAY",
    );
  }
  assert.equal(createCalls, 0);
});

test("manual generation persists the eligible artwork-only resolution on the queued run", async () => {
  let createdRecord = null;
  const dependencies = {
    getSocialManagerSettings: async () => ({
      ...enabledSettings(),
      generation: { default_visual_mode: "AI_VISUAL_WITH_EXACT_OVERLAY" },
    }),
    SocialGenerationRun: {
      findOne: async () => null,
      aggregate: async () => [],
      create: async (record) => {
        createdRecord = record;
        return { _id: "run-artwork-only", ...record };
      },
    },
    SocialAuditLog: { create: async (record) => record },
  };
  const result = await requestGeneration({
    triggerType: "MANUAL",
    force: true,
    generationRequest: {
      requested_format: "SINGLE_IMAGE",
      requested_post_type: "EDUCATION",
      visual_mode: "AI_ARTWORK_ONLY",
    },
    dependencies,
  });
  assert.equal(result.reused, false);
  assert.equal(createdRecord.generation_request.visual_mode, "AI_ARTWORK_ONLY");
  assert.deepEqual(createdRecord.generation_request.visual_mode_resolution, {
    requested: "AI_ARTWORK_ONLY",
    effective: "AI_ARTWORK_ONLY",
    eligible: true,
    reasons: [],
  });
});

test("runDueSocialGeneration returns not_due before 08:00 Asia/Kolkata without touching models", async () => {
  const now = new Date("2026-08-22T02:29:59.000Z"); // 07:59:59 Asia/Kolkata
  let settingsCalls = 0;
  let modelCalls = 0;
  const failIfCalled = () => {
    modelCalls += 1;
    throw new Error("not-due scheduling must not query or mutate the database");
  };
  const dependencies = {
    getSocialManagerSettings: async () => {
      settingsCalls += 1;
      return enabledSettings();
    },
    SocialPostDraft: { findOne: failIfCalled, findById: failIfCalled },
    SocialGenerationRun: {
      findOne: failIfCalled,
      findById: failIfCalled,
      countDocuments: failIfCalled,
      aggregate: failIfCalled,
      create: failIfCalled,
    },
    SocialAuditLog: { create: failIfCalled },
  };

  const result = await runDueSocialGeneration({ now, dependencies });
  assert.deepEqual(result, { queued: false, reason: "not_due" });
  assert.equal(settingsCalls, 1);
  assert.equal(modelCalls, 0);
});

test("runDueSocialGeneration queues the scheduled run at and after 08:00 Asia/Kolkata", async () => {
  const instants = [
    new Date("2026-08-22T02:30:00.000Z"), // 08:00 Asia/Kolkata
    new Date("2026-08-22T12:30:00.000Z"), // 18:00 Asia/Kolkata
  ];

  for (const now of instants) {
    let settingsCalls = 0;
    let createCalls = 0;
    let auditCalls = 0;
    const createdRun = { _id: `scheduled-${now.toISOString()}`, status: "PENDING" };
    const dependencies = {
      getSocialManagerSettings: async () => {
        settingsCalls += 1;
        return enabledSettings();
      },
      SocialPostDraft: {
        findOne(query) {
          assert.deepEqual(query, { generation_date: "2026-08-22" });
          return { sort: async () => null };
        },
      },
      SocialGenerationRun: {
        findOne(query) {
          if (query.idempotency_key) {
            assert.equal(query.idempotency_key, "social-daily:2026-08-22");
            return Promise.resolve(null);
          }
          assert.deepEqual(query, {
            generation_date: "2026-08-22",
            status: { $in: ["PENDING", "RUNNING"] },
          });
          return { sort: async () => null };
        },
        countDocuments: async () => {
          throw new Error("scheduled generation must not enforce a daily request-count cap");
        },
        aggregate: async (pipeline) => {
          assert.equal(pipeline[0].$match.created_at.$gte instanceof Date, true);
          return [];
        },
        create: async (record) => {
          createCalls += 1;
          assert.equal(record.generation_date, "2026-08-22");
          assert.equal(record.timezone, "Asia/Kolkata");
          assert.equal(record.trigger_type, "SCHEDULED");
          assert.equal(record.idempotency_key, "social-daily:2026-08-22");
          assert.equal(record.status, "PENDING");
          assert.equal(record.current_stage, "QUEUED");
          assert.equal(record.queued_at, now);
          assert.equal(record.available_at, now);
          return createdRun;
        },
      },
      SocialAuditLog: {
        create: async (record) => {
          auditCalls += 1;
          assert.equal(record.action, "GENERATION_QUEUED");
          assert.equal(record.actor_type, "SYSTEM");
          assert.equal(record.generation_run_id, createdRun._id);
          return record;
        },
      },
    };

    const result = await runDueSocialGeneration({ now, dependencies });
    assert.deepEqual(result, { queued: true, reused: false, run: createdRun });
    assert.equal(settingsCalls, 2);
    assert.equal(createCalls, 1);
    assert.equal(auditCalls, 1);
  }
});

function reviewRecommendation() {
  return {
    format: "SINGLE_IMAGE",
    objective: "EDUCATION",
    postType: "EDUCATIONAL",
    contentPillar: "Money Education",
    topic: "A calm emergency fund starting point",
    caption: "Choose a realistic emergency-fund starting amount and build it consistently.",
    cta: "Save this and choose your starting amount.",
    hashtags: ["#PinkPaisa", "#MoneyConfidence", "#EmergencyFund", "#WomenAndMoney", "#FinancialWellness"],
    financialDisclaimer: "Educational content only. This is not personalised investment advice.",
    affiliateDisclosure: null,
    onPostCopy: {
      headline: "A calm emergency-fund starting point",
      supportingCopy: "Start with an amount you can sustain.",
      slides: [],
      storyFrames: [],
      reelScenes: [],
    },
    formatContent: {
      format: "SINGLE_IMAGE",
      selectedHeadline: "A calm emergency-fund starting point",
      supportingText: "Start with an amount you can sustain.",
    },
    recommendedLandingPage: "/quiz",
    utmParameters: {
      source: "instagram",
      medium: "organic_social",
      campaign: "20260824-money-education",
      content: "emergency-fund-start",
    },
    sources: [],
  };
}

function approvableAsset() {
  const recommendation = reviewRecommendation();
  const approvedCopy = buildRenderItems(recommendation, recommendation.format)[0].approved_copy;
  const approvedCopyChecksum = crypto.createHash("sha256").update(stableStringify(approvedCopy)).digest("hex");
  const captionContract = buildSocialCaptionContract(recommendation);
  return {
    _id: "asset-final-1",
    asset_role: "FINAL_COMPOSED",
    social_format: "SINGLE_IMAGE",
    visual_mode: "AI_VISUAL_WITH_EXACT_OVERLAY",
    renderer: "sharp_svg_overlay",
    approved_copy_checksum_sha256: approvedCopyChecksum,
    overlay_json: {
      brand_name: "Pink Paisa",
      approved_copy: approvedCopy,
      approved_copy_checksum_sha256: approvedCopyChecksum,
      text_rendering: { method: "sharp_svg_overlay", image_ai_used_for_text: false },
      logo: { source: "frontend-next/src/assets/pink-paisa-logo.png" },
    },
    validation_status: "valid",
    manual_review_required: true,
    manual_review_status: "pending",
    image_generation_status: "VALIDATED",
    image_provider: "openai",
    original_asset_url: "/uploads/generated/campaigns/original.jpg",
    source_provenance: "generated_without_reference",
    provenance: {
      renderer: "sharp_svg_overlay",
      base_image: {
        type: "openai_generated_original_visual",
        provider: "openai",
        generation_status: "VALIDATED",
        original_asset_url: "/uploads/generated/campaigns/original.jpg",
        source_provenance: "generated_without_reference",
      },
      overlay: {
        method: "sharp_svg_overlay",
        copy_source: "formatContent",
        approved_copy_checksum_sha256: approvedCopyChecksum,
        image_ai_used_for_text: false,
      },
      logo: { source: "frontend-next/src/assets/pink-paisa-logo.png" },
      caption_policy: {
        method: "instagram_caption_only",
        component_order: captionContract.component_order,
        affiliate_disclosure_placement: "caption_only",
        cta_placement: "caption_only",
        financial_disclaimer_placement: "caption_only",
        affiliate_disclosure_required: false,
        cta_required: true,
        financial_disclaimer_required: true,
        instagram_caption_used: true,
        caption_checksum_sha256: captionContract.checksum_sha256,
        caption_contract_valid: true,
        caption_contract_violations: [],
      },
    },
  };
}

function approvableDraft() {
  return {
    _id: "draft-review-1",
    generation_run_id: "run-review-1",
    revision: 2,
    status: "NEEDS_REVIEW",
    publication_id: null,
    scheduled_for: null,
    visual_mode: "AI_VISUAL_WITH_EXACT_OVERLAY",
    visual_mode_resolution: {
      requested: "AI_VISUAL_WITH_EXACT_OVERLAY",
      effective: "AI_VISUAL_WITH_EXACT_OVERLAY",
      eligible: true,
      reasons: [],
    },
    current_package: { primaryRecommendation: reviewRecommendation() },
    creative_readiness: { status: "NEEDS_MANUAL_REVIEW" },
    approval_json: { required: true, status: "NEEDS_REVIEW" },
    schedule_json: null,
    async save() { return this; },
  };
}

function approvalSettings() {
  return {
    approval: { require_human_approval: true, require_disclosures: true },
    weekly_planning: { maximum_feed_posts: 3 },
  };
}

function approvableStoryDraftAndAsset({
  draftId = "draft-companion-story-1",
  candidateId = "candidate-companion-story-1",
  bundleId = "weekly:weekly-plan-bundle-1:feed:candidate-parent-feed-1",
  bundleRole = "COMPANION_STORY",
} = {}) {
  const draft = approvableDraft();
  draft._id = draftId;
  draft.generation_run_id = `run-${draftId}`;
  draft.weekly_plan_id = "weekly-plan-bundle-1";
  draft.candidate_id = candidateId;
  draft.weekly_slot_number = bundleRole === "STANDALONE_STORY" ? 6 : 1;
  draft.week_start = "2026-08-24";
  draft.week_end = "2026-08-30";
  draft.bundle_id = bundleId;
  draft.bundle_role = bundleRole;
  draft.parent_draft_id = null;
  const recommendation = draft.current_package.primaryRecommendation;
  recommendation.format = "STORY";
  recommendation.caption = "";
  recommendation.hashtags = [];
  recommendation.onPostCopy = {
    headline: null,
    supportingCopy: null,
    slides: [],
    storyFrames: [{ frameNumber: 1, copy: "Choose one sustainable starting amount.", visualInstruction: "Warm editorial scene" }],
    reelScenes: [],
  };
  recommendation.formatContent = {
    format: "STORY",
    frames: [{ frameNumber: 1, copy: "Choose one sustainable starting amount.", imagePrompt: "Warm editorial scene", overlayInstructions: "Exact approved copy" }],
  };

  const asset = approvableAsset();
  asset._id = `asset-${draftId}`;
  asset.social_format = "STORY";
  const storyApprovedCopy = buildRenderItems(recommendation, "STORY")[0].approved_copy;
  const storyApprovedCopyChecksum = crypto.createHash("sha256").update(stableStringify(storyApprovedCopy)).digest("hex");
  asset.approved_copy_checksum_sha256 = storyApprovedCopyChecksum;
  asset.overlay_json.approved_copy = storyApprovedCopy;
  asset.overlay_json.approved_copy_checksum_sha256 = storyApprovedCopyChecksum;
  asset.provenance.overlay.approved_copy_checksum_sha256 = storyApprovedCopyChecksum;
  const storyContract = buildSocialCaptionContract(recommendation);
  asset.provenance.caption_policy = {
    method: "story_frame_overlay",
    component_order: storyContract.component_order,
    affiliate_disclosure_placement: "first_frame",
    cta_placement: "final_frame",
    financial_disclaimer_placement: "final_frame",
    affiliate_disclosure_required: false,
    cta_required: true,
    financial_disclaimer_required: true,
    instagram_caption_used: false,
    caption_checksum_sha256: null,
    caption_contract_valid: true,
    caption_contract_violations: [],
  };
  return { draft, asset };
}

function weeklyApprovalHarness({
  plannedFor = "2026-08-25T05:30:00.000Z",
} = {}) {
  const draft = approvableDraft();
  draft.weekly_plan_id = "weekly-plan-1";
  draft.candidate_id = "candidate-current";
  draft.weekly_slot_number = 1;
  draft.week_start = "2026-08-24";
  draft.week_end = "2026-08-30";
  const asset = approvableAsset();
  const audits = [];
  let planSaves = 0;
  const linkedDrafts = [
    {
      _id: "draft-stale-visual",
      status: "DRAFT",
      creative_readiness: { status: "STALE" },
    },
    {
      _id: "draft-audio-repair",
      status: "NEEDS_REVIEW",
      creative_readiness: { status: "STALE", reason: "Selected audio rights were revoked" },
    },
    {
      _id: "draft-next-ready",
      status: "NEEDS_REVIEW",
      creative_readiness: { status: "NEEDS_MANUAL_REVIEW" },
    },
  ];
  const plan = {
    _id: draft.weekly_plan_id,
    week_start: draft.week_start,
    week_end: draft.week_end,
    timezone: "Asia/Kolkata",
    selected_posts: [
      {
        candidateId: "candidate-generating",
        slotNumber: 5,
        scheduledFor: new Date("2026-08-29T05:30:00.000Z"),
        status: "GENERATING_VISUAL",
        draft_id: null,
      },
      {
        candidateId: draft.candidate_id,
        slotNumber: 1,
        scheduledFor: new Date(plannedFor),
        status: "NEEDS_REVIEW",
        draft_id: draft._id,
      },
      {
        candidateId: "candidate-stale-visual",
        slotNumber: 2,
        scheduledFor: new Date("2026-08-26T05:30:00.000Z"),
        status: "NEEDS_REVIEW",
        draft_id: "draft-stale-visual",
      },
      {
        candidateId: "candidate-audio-repair",
        slotNumber: 3,
        scheduledFor: new Date("2026-08-27T05:30:00.000Z"),
        status: "NEEDS_REVIEW",
        draft_id: "draft-audio-repair",
      },
      {
        candidateId: "candidate-next-ready",
        slotNumber: 4,
        scheduledFor: new Date("2026-08-28T05:30:00.000Z"),
        status: "NEEDS_REVIEW",
        draft_id: "draft-next-ready",
      },
    ],
    async save() { planSaves += 1; return this; },
  };
  let capacityAt = null;
  const dependencies = {
    SocialPostDraft: {
      findById: async () => draft,
      find: async ({ _id }) => linkedDrafts.filter((item) => _id.$in.map(String).includes(String(item._id))),
    },
    SocialAsset: {
      find: async () => [asset],
      updateMany: async () => { asset.manual_review_status = "approved"; },
    },
    SocialWeeklyPlan: { findById: async () => plan },
    SocialAuditLog: { create: async (record) => { audits.push(record); return record; } },
    getSocialManagerSettings: async () => approvalSettings(),
    assertWeeklyPublicationCapacity: async ({ at }) => { capacityAt = new Date(at); },
    syncWeeklyPlanFromDraft: async (_draft, { status }) => {
      plan.selected_posts.find((item) => item.candidateId === draft.candidate_id).status = status;
      return plan;
    },
    getDraftDetail: async () => ({
      id: draft._id,
      weekly_plan_id: draft.weekly_plan_id,
      status: draft.status,
      approval: draft.approval_json,
      schedule: draft.schedule_json,
    }),
  };
  return {
    draft,
    asset,
    plan,
    audits,
    dependencies,
    getPlanSaves: () => planSaves,
    getCapacityAt: () => capacityAt,
  };
}

test("legacy approval and scheduling reject a missing policy-required financial disclaimer without mutation", async () => {
  const draft = approvableDraft();
  draft.current_package.primaryRecommendation.financialDisclaimer = null;
  let assetReviews = 0;
  let saves = 0;
  let capacityChecks = 0;
  let syncs = 0;
  const audits = [];
  draft.save = async function save() { saves += 1; return this; };
  const dependencies = {
    SocialPostDraft: { findById: async () => draft },
    SocialAsset: {
      find: async () => [approvableAsset()],
      updateMany: async () => { assetReviews += 1; },
    },
    SocialAuditLog: { create: async (record) => { audits.push(record); return record; } },
    getSocialManagerSettings: async () => approvalSettings(),
    assertWeeklyPublicationCapacity: async () => { capacityChecks += 1; },
    syncWeeklyPlanFromDraft: async () => { syncs += 1; },
  };

  await assert.rejects(
    () => approveDraft(draft._id, { actor: { _id: "admin-1" }, dependencies }),
    (error) => error.code === "social_caption_contract_invalid"
      && error.issues.includes("FINANCIAL_DISCLAIMER_REQUIRED"),
  );
  assert.equal(draft.status, "NEEDS_REVIEW");
  assert.equal(draft.approved_at, undefined);
  assert.equal(assetReviews, 0);
  assert.equal(saves, 0);
  assert.equal(syncs, 0);
  assert.equal(audits.length, 0);

  draft.status = "APPROVED";
  draft.approved_revision = draft.revision;
  draft.approved_at = new Date("2026-08-24T04:00:00.000Z");
  draft.approved_by_admin_id = "admin-1";
  draft.approval_json = { required: true, status: "APPROVED", approved_revision: draft.revision };
  await assert.rejects(
    () => scheduleDraft(draft._id, "2026-08-25T05:30:00.000Z", {
      actor: { _id: "admin-1" },
      now: new Date("2026-08-24T04:00:00.000Z"),
      dependencies,
    }),
    (error) => error.code === "social_caption_contract_invalid"
      && error.issues.includes("FINANCIAL_DISCLAIMER_REQUIRED"),
  );
  assert.equal(draft.status, "APPROVED");
  assert.equal(draft.scheduled_for, null);
  assert.equal(draft.schedule_json, null);
  assert.equal(capacityChecks, 0);
  assert.equal(saves, 0);
  assert.equal(syncs, 0);
  assert.equal(audits.length, 0);
});

test("approveAndScheduleDraft leaves the transaction unchanged when a required financial disclaimer is missing", async () => {
  const draft = approvableDraft();
  const asset = approvableAsset();
  draft.current_package.primaryRecommendation.financialDisclaimer = "";
  let assetReviews = 0;
  let saves = 0;
  let capacityChecks = 0;
  let syncs = 0;
  let transactionRuns = 0;
  const audits = [];
  draft.save = async function save() { saves += 1; return this; };
  const session = {
    async withTransaction(work) { transactionRuns += 1; await work(); },
    async endSession() {},
  };
  const dependencies = {
    startSession: async () => session,
    SocialPostDraft: { findById: async () => draft },
    SocialAsset: {
      find: async () => [asset],
      updateMany: async () => { assetReviews += 1; },
    },
    SocialWeeklyPlan: { findById: async () => null },
    SocialAuditLog: { create: async (record) => { audits.push(record); return record; } },
    getSocialManagerSettings: async () => approvalSettings(),
    assertWeeklyPublicationCapacity: async () => { capacityChecks += 1; },
    syncWeeklyPlanFromDraft: async () => { syncs += 1; },
  };

  await assert.rejects(
    () => approveAndScheduleDraft(draft._id, "2026-08-25T05:30:00.000Z", {
      actor: { _id: "admin-1" },
      now: new Date("2026-08-24T04:00:00.000Z"),
      dependencies,
    }),
    (error) => error.code === "social_caption_contract_invalid"
      && error.issues.includes("FINANCIAL_DISCLAIMER_REQUIRED"),
  );
  assert.equal(transactionRuns, 1);
  assert.equal(draft.status, "NEEDS_REVIEW");
  assert.equal(draft.approved_at, undefined);
  assert.equal(draft.scheduled_for, null);
  assert.equal(draft.schedule_json, null);
  assert.equal(asset.manual_review_status, "pending");
  assert.equal(assetReviews, 0);
  assert.equal(saves, 0);
  assert.equal(capacityChecks, 0);
  assert.equal(syncs, 0);
  assert.equal(audits.length, 0);
});

test("captionless Stories approve and schedule only with required final-frame policy provenance", async () => {
  const draft = approvableDraft();
  const recommendation = draft.current_package.primaryRecommendation;
  recommendation.format = "STORY";
  recommendation.caption = "";
  recommendation.hashtags = [];
  recommendation.onPostCopy = {
    headline: null,
    supportingCopy: null,
    slides: [],
    storyFrames: [{ frameNumber: 1, copy: "Choose one sustainable starting amount.", visualInstruction: "Warm editorial scene" }],
    reelScenes: [],
  };
  recommendation.formatContent = {
    format: "STORY",
    frames: [{ frameNumber: 1, copy: "Choose one sustainable starting amount.", imagePrompt: "Warm editorial scene", overlayInstructions: "Exact approved copy" }],
  };
  const asset = approvableAsset();
  asset.social_format = "STORY";
  const storyApprovedCopy = buildRenderItems(recommendation, "STORY")[0].approved_copy;
  const storyApprovedCopyChecksum = crypto.createHash("sha256").update(stableStringify(storyApprovedCopy)).digest("hex");
  asset.approved_copy_checksum_sha256 = storyApprovedCopyChecksum;
  asset.overlay_json.approved_copy = storyApprovedCopy;
  asset.overlay_json.approved_copy_checksum_sha256 = storyApprovedCopyChecksum;
  asset.provenance.overlay.approved_copy_checksum_sha256 = storyApprovedCopyChecksum;
  const audits = [];
  let capacityChecks = 0;
  const dependencies = {
    SocialPostDraft: { findById: async () => draft },
    SocialAsset: {
      find: async () => [asset],
      updateMany: async () => { asset.manual_review_status = "approved"; },
    },
    SocialWeeklyPlan: { findById: async () => null },
    SocialAuditLog: { create: async (record) => { audits.push(record); return record; } },
    getSocialManagerSettings: async () => approvalSettings(),
    assertWeeklyPublicationCapacity: async () => { capacityChecks += 1; },
    syncWeeklyPlanFromDraft: async () => null,
    getDraftDetail: async () => ({ id: draft._id, status: draft.status, approval: draft.approval_json }),
  };

  await assert.rejects(
    () => approveAndScheduleDraft(draft._id, "2026-08-25T05:30:00.000Z", {
      actor: { _id: "admin-1" },
      now: new Date("2026-08-24T04:00:00.000Z"),
      dependencies,
    }),
    (error) => error.code === "social_story_frame_copy_invalid"
      && error.issues.includes("STORY_ON_FRAME_COPY_PROVENANCE_REQUIRED"),
  );
  assert.equal(draft.status, "NEEDS_REVIEW");
  assert.equal(asset.manual_review_status, "pending");
  assert.equal(audits.length, 0);

  const storyContract = buildSocialCaptionContract(recommendation);
  asset.provenance.caption_policy = {
    method: "story_frame_overlay",
    component_order: storyContract.component_order,
    affiliate_disclosure_placement: "first_frame",
    cta_placement: "final_frame",
    financial_disclaimer_placement: "final_frame",
    affiliate_disclosure_required: false,
    cta_required: true,
    financial_disclaimer_required: true,
    instagram_caption_used: false,
    caption_checksum_sha256: null,
    caption_contract_valid: true,
    caption_contract_violations: [],
  };
  const result = await approveAndScheduleDraft(draft._id, "2026-08-25T05:30:00.000Z", {
    actor: { _id: "admin-1" },
    now: new Date("2026-08-24T04:00:00.000Z"),
    dependencies,
  });
  assert.equal(result.draft.status, "SCHEDULED");
  assert.equal(draft.approval_json.caption_policy, "STORY_FRAME_OVERLAY");
  assert.equal(capacityChecks, 0);
  assert.deepEqual(audits.map((entry) => entry.action), ["APPROVED", "SCHEDULED"]);
});

test("approveAndScheduleDraft atomically approves, schedules, records caption checksum, and reuses the same request", async () => {
  const now = new Date("2026-08-24T04:00:00.000Z");
  const scheduledFor = "2026-08-25T05:30:00.000Z";
  const draft = approvableDraft();
  const asset = approvableAsset();
  const audits = [];
  let capacityChecks = 0;
  const dependencies = {
    SocialPostDraft: { findById: async () => draft },
    SocialAsset: {
      find: async () => [asset],
      updateMany: async () => {
        asset.manual_review_status = "approved";
      },
    },
    SocialWeeklyPlan: { findById: async () => null },
    SocialAuditLog: { create: async (record) => { audits.push(record); return record; } },
    getSocialManagerSettings: async () => approvalSettings(),
    assertWeeklyPublicationCapacity: async ({ at }) => {
      capacityChecks += 1;
      assert.equal(at.toISOString(), scheduledFor);
    },
    syncWeeklyPlanFromDraft: async () => null,
    getDraftDetail: async () => ({ id: draft._id, status: draft.status, approval: draft.approval_json, schedule: draft.schedule_json }),
  };

  const first = await approveAndScheduleDraft(draft._id, scheduledFor, {
    actor: { _id: "admin-1" },
    now,
    requestKey: "approve-weekly-creative-1",
    dependencies,
  });
  assert.equal(first.reused, false);
  assert.equal(first.draft.status, "SCHEDULED");
  assert.equal(draft.approved_revision, 2);
  assert.equal(draft.scheduled_for.toISOString(), scheduledFor);
  assert.match(draft.approval_json.caption_checksum_sha256, /^[a-f0-9]{64}$/);
  assert.equal(draft.approval_json.caption_checksum_sha256, draft.schedule_json.caption_checksum_sha256);
  assert.deepEqual(audits.map((entry) => entry.action), ["APPROVED", "SCHEDULED"]);
  assert.ok(audits.every((entry) => entry.idempotency_key));
  assert.equal(capacityChecks, 1);

  const second = await approveAndScheduleDraft(draft._id, scheduledFor, {
    actor: { _id: "admin-1" },
    now,
    requestKey: "approve-weekly-creative-1",
    dependencies,
  });
  assert.equal(second.reused, true);
  assert.equal(audits.length, 2);
  assert.equal(capacityChecks, 1);
});

test("weekly approval uses the frozen slot when scheduled_for is omitted and returns deterministic queue navigation", async () => {
  const harness = weeklyApprovalHarness();
  const result = await approveAndScheduleDraft(harness.draft._id, undefined, {
    actor: { _id: "admin-1" },
    now: new Date("2026-08-24T04:00:00.000Z"),
    dependencies: harness.dependencies,
  });

  assert.equal(harness.draft.scheduled_for.toISOString(), "2026-08-25T05:30:00.000Z");
  assert.equal(harness.getCapacityAt().toISOString(), "2026-08-25T05:30:00.000Z");
  assert.equal(harness.getPlanSaves(), 0);
  assert.deepEqual(harness.audits.map((entry) => entry.action), ["APPROVED", "SCHEDULED"]);
  assert.deepEqual(result.queue_navigation, {
    next_review_draft_id: "draft-audio-repair",
    remaining_review_count: 2,
    waiting_generation_count: 2,
    unresolved_failure_count: 0,
    open_manual_blocker_count: 0,
    first_failure_draft_id: null,
  });
});

test("weekly queue navigation never reports completion while another creative failed or a manual blocker is open", async () => {
  const plan = {
    _id: "weekly-plan-mixed-outcome",
    selected_posts: [{
      candidateId: "scheduled-feed",
      slotNumber: 1,
      status: "SCHEDULED",
      draft_id: "draft-scheduled",
    }, {
      candidateId: "failed-feed",
      slotNumber: 2,
      status: "FAILED",
      draft_id: "draft-failed",
    }],
    story_plan: [],
  };
  const navigation = await draftQueueNavigation({
    _id: "draft-scheduled",
    weekly_plan_id: plan._id,
  }, {
    PlanModel: { findById: async () => plan },
    DraftModel: {
      find: () => ({
        select: () => ({
          lean: async () => [{ _id: "draft-scheduled", status: "SCHEDULED" }, { _id: "draft-failed", status: "FAILED" }],
        }),
      }),
    },
    ManualActionModel: { countDocuments: async () => 1 },
  });

  assert.deepEqual(navigation, {
    next_review_draft_id: null,
    remaining_review_count: 0,
    waiting_generation_count: 0,
    unresolved_failure_count: 1,
    open_manual_blocker_count: 1,
    first_failure_draft_id: "draft-failed",
  });
});

test("parent feed approval atomically schedules its reviewed companion Story and reuses the request", async () => {
  const parent = approvableDraft();
  parent._id = "draft-parent-feed-1";
  parent.weekly_plan_id = "weekly-plan-bundle-1";
  parent.candidate_id = "candidate-parent-feed-1";
  parent.weekly_slot_number = 1;
  parent.week_start = "2026-08-24";
  parent.week_end = "2026-08-30";
  parent.bundle_id = "weekly:weekly-plan-bundle-1:feed:candidate-parent-feed-1";
  parent.bundle_role = "PARENT_FEED";
  const parentAsset = approvableAsset();
  parentAsset._id = "asset-parent-feed-1";
  const { draft: companion, asset: companionAsset } = approvableStoryDraftAndAsset({ bundleId: parent.bundle_id });
  const scheduledFor = new Date("2026-08-25T05:30:00.000Z");
  const plan = {
    _id: parent.weekly_plan_id,
    week_start: parent.week_start,
    week_end: parent.week_end,
    timezone: "Asia/Kolkata",
    selected_posts: [{
      candidateId: parent.candidate_id,
      slotNumber: 1,
      scheduledFor,
      status: "NEEDS_REVIEW",
      draft_id: parent._id,
      bundleId: parent.bundle_id,
      bundleRole: "PARENT_FEED",
    }],
    story_plan: [{
      candidateId: companion.candidate_id,
      parentCandidateId: parent.candidate_id,
      slotNumber: 1,
      scheduledFor,
      status: "NEEDS_REVIEW",
      draft_id: companion._id,
      parent_draft_id: null,
      bundleId: parent.bundle_id,
      bundleRole: "COMPANION_STORY",
    }],
    async save() { return this; },
  };
  const assets = new Map([[String(parent._id), parentAsset], [String(companion._id), companionAsset]]);
  const audits = [];
  let capacityChecks = 0;
  let transactionRuns = 0;
  const session = {
    async withTransaction(work) { transactionRuns += 1; await work(); },
    async endSession() {},
  };
  const dependencies = {
    startSession: async () => session,
    SocialPostDraft: {
      findById: async (id) => String(id) === String(parent._id) ? parent : String(id) === String(companion._id) ? companion : null,
      findOne: async (query) => query.bundle_role === "COMPANION_STORY"
        && String(query.weekly_plan_id) === String(parent.weekly_plan_id)
        && String(query.bundle_id) === String(parent.bundle_id)
        ? companion
        : null,
      find: async () => [],
    },
    SocialAsset: {
      find: async (query) => assets.has(String(query.draft_id)) ? [assets.get(String(query.draft_id))] : [],
      updateMany: async (query) => {
        for (const asset of assets.values()) {
          if (query._id.$in.map(String).includes(String(asset._id))) asset.manual_review_status = "approved";
        }
      },
    },
    SocialWeeklyPlan: { findById: async () => plan },
    SocialAuditLog: {
      async create(records) {
        const record = Array.isArray(records) ? records[0] : records;
        audits.push(record);
        return Array.isArray(records) ? [record] : record;
      },
    },
    getSocialManagerSettings: async () => approvalSettings(),
    assertWeeklyPublicationCapacity: async () => { capacityChecks += 1; },
    syncWeeklyPlanFromDraft: async (changedDraft, { status }) => {
      const collection = changedDraft.bundle_role === "COMPANION_STORY" ? plan.story_plan : plan.selected_posts;
      const item = collection.find((entry) => entry.candidateId === changedDraft.candidate_id);
      item.status = status;
      item.parent_draft_id = changedDraft.parent_draft_id || item.parent_draft_id;
      return plan;
    },
    getDraftDetail: async (id) => {
      const value = String(id) === String(parent._id) ? parent : companion;
      return { id: value._id, status: value.status, bundle_role: value.bundle_role, parent_draft_id: value.parent_draft_id || null };
    },
  };

  const first = await approveAndScheduleDraft(parent._id, undefined, {
    actor: { _id: "admin-1" },
    now: new Date("2026-08-24T04:00:00.000Z"),
    requestKey: "approve-parent-with-companion-1",
    includeCompanionStory: true,
    dependencies,
  });

  assert.equal(transactionRuns, 1);
  assert.equal(capacityChecks, 1);
  assert.equal(parent.status, "SCHEDULED");
  assert.equal(companion.status, "SCHEDULED");
  assert.equal(companion.parent_draft_id, parent._id);
  assert.equal(parent.scheduled_for.toISOString(), scheduledFor.toISOString());
  assert.equal(companion.scheduled_for.toISOString(), scheduledFor.toISOString());
  assert.equal(parentAsset.manual_review_status, "approved");
  assert.equal(companionAsset.manual_review_status, "approved");
  assert.deepEqual(audits.map((entry) => `${entry.entity_id}:${entry.action}`), [
    `${parent._id}:APPROVED`,
    `${parent._id}:SCHEDULED`,
    `${companion._id}:APPROVED`,
    `${companion._id}:SCHEDULED`,
  ]);
  assert.equal(first.companion_story.id, companion._id);
  assert.deepEqual(first.queue_navigation, {
    next_review_draft_id: null,
    remaining_review_count: 0,
    waiting_generation_count: 0,
    unresolved_failure_count: 0,
    open_manual_blocker_count: 0,
    first_failure_draft_id: null,
  });

  const second = await approveAndScheduleDraft(parent._id, undefined, {
    actor: { _id: "admin-1" },
    now: new Date("2026-08-24T04:00:00.000Z"),
    requestKey: "approve-parent-with-companion-1",
    includeCompanionStory: true,
    dependencies,
  });
  assert.equal(second.reused, true);
  assert.equal(transactionRuns, 2);
  assert.equal(capacityChecks, 1);
  assert.equal(audits.length, 4);
});

test("a parent feed cannot mutate when its companion Story is not yet reviewable", async () => {
  const parent = approvableDraft();
  parent.weekly_plan_id = "weekly-plan-bundle-not-ready";
  parent.candidate_id = "candidate-parent-not-ready";
  parent.weekly_slot_number = 1;
  parent.week_start = "2026-08-24";
  parent.week_end = "2026-08-30";
  parent.bundle_id = "weekly:weekly-plan-bundle-not-ready:feed:candidate-parent-not-ready";
  parent.bundle_role = "PARENT_FEED";
  const asset = approvableAsset();
  const plan = {
    _id: parent.weekly_plan_id,
    week_start: parent.week_start,
    week_end: parent.week_end,
    timezone: "Asia/Kolkata",
    selected_posts: [{ candidateId: parent.candidate_id, slotNumber: 1, scheduledFor: new Date("2026-08-25T05:30:00.000Z"), status: "NEEDS_REVIEW", draft_id: parent._id }],
    story_plan: [],
  };
  let assetReviews = 0;
  let saves = 0;
  parent.save = async function save() { saves += 1; return this; };
  const audits = [];
  await assert.rejects(
    () => approveAndScheduleDraft(parent._id, undefined, {
      actor: { _id: "admin-1" },
      now: new Date("2026-08-24T04:00:00.000Z"),
      includeCompanionStory: true,
      dependencies: {
        SocialPostDraft: { findById: async () => parent, findOne: async () => null },
        SocialAsset: { find: async () => [asset], updateMany: async () => { assetReviews += 1; } },
        SocialWeeklyPlan: { findById: async () => plan },
        SocialAuditLog: { create: async (record) => { audits.push(record); return record; } },
        getSocialManagerSettings: async () => approvalSettings(),
      },
    }),
    (error) => error.code === "social_companion_story_not_ready",
  );
  assert.equal(parent.status, "NEEDS_REVIEW");
  assert.equal(parent.scheduled_for, null);
  assert.equal(asset.manual_review_status, "pending");
  assert.equal(assetReviews, 0);
  assert.equal(saves, 0);
  assert.equal(audits.length, 0);
});

test("a supplied weekly time equal to the frozen slot does not require an override reason", async () => {
  const harness = weeklyApprovalHarness();
  const result = await approveAndScheduleDraft(
    harness.draft._id,
    "2026-08-25T05:30:00.000Z",
    {
      actor: { _id: "admin-1" },
      now: new Date("2026-08-24T04:00:00.000Z"),
      dependencies: harness.dependencies,
    },
  );

  assert.equal(result.draft.status, "SCHEDULED");
  assert.equal(harness.getPlanSaves(), 0);
  assert.deepEqual(harness.audits.map((entry) => entry.action), ["APPROVED", "SCHEDULED"]);
});

test("the legacy schedule endpoint cannot bypass weekly override reason or plan synchronization", async () => {
  const harness = weeklyApprovalHarness();
  harness.draft.status = "APPROVED";
  harness.draft.approved_revision = harness.draft.revision;
  harness.draft.approval_json = { required: true, status: "APPROVED", approved_revision: harness.draft.revision };
  const overrideFor = "2026-08-27T06:30:00.000Z";

  await assert.rejects(
    () => scheduleDraft(harness.draft._id, overrideFor, {
      actor: { _id: "admin-1" },
      now: new Date("2026-08-24T04:00:00.000Z"),
      dependencies: harness.dependencies,
    }),
    (error) => error.code === "social_schedule_override_reason_required",
  );
  assert.equal(harness.draft.status, "APPROVED");
  assert.equal(harness.getPlanSaves(), 0);
  assert.equal(harness.audits.length, 0);

  await scheduleDraft(harness.draft._id, overrideFor, {
    actor: { _id: "admin-1" },
    now: new Date("2026-08-24T04:00:00.000Z"),
    scheduleOverrideReason: "Use the audited mid-week slot from the advanced review control.",
    dependencies: harness.dependencies,
  });
  const weeklyItem = harness.plan.selected_posts.find((item) => item.candidateId === harness.draft.candidate_id);
  assert.equal(harness.draft.status, "SCHEDULED");
  assert.equal(weeklyItem.scheduledFor.toISOString(), overrideFor);
  assert.equal(harness.getPlanSaves(), 1);
  assert.deepEqual(harness.audits.map((entry) => entry.action), ["SCHEDULE_OVERRIDDEN", "SCHEDULED"]);
});

test("weekly schedule overrides require a reason and remain inside the plan week before any mutation", async () => {
  for (const [scheduledFor, expectedCode] of [
    ["2026-08-27T06:30:00.000Z", "social_schedule_override_reason_required"],
    ["2026-08-31T05:30:00.000Z", "social_schedule_override_outside_plan_week"],
  ]) {
    const harness = weeklyApprovalHarness();
    await assert.rejects(
      () => approveAndScheduleDraft(harness.draft._id, scheduledFor, {
        actor: { _id: "admin-1" },
        now: new Date("2026-08-24T04:00:00.000Z"),
        scheduleOverrideReason: expectedCode.includes("outside") ? "Move to the requested campaign window." : null,
        dependencies: harness.dependencies,
      }),
      (error) => error.code === expectedCode,
    );
    assert.equal(harness.draft.status, "NEEDS_REVIEW");
    assert.equal(harness.draft.scheduled_for, null);
    assert.equal(harness.asset.manual_review_status, "pending");
    assert.equal(harness.getPlanSaves(), 0);
    assert.equal(harness.getCapacityAt(), null);
    assert.equal(harness.audits.length, 0);
  }
});

test("an audited same-week override updates the weekly item, rechecks capacity, and is idempotent", async () => {
  const harness = weeklyApprovalHarness();
  const overrideFor = "2026-08-27T06:30:00.000Z";
  const reason = "Align this reviewed creative with the approved mid-week education window.";
  const first = await approveAndScheduleDraft(harness.draft._id, overrideFor, {
    actor: { _id: "admin-1" },
    now: new Date("2026-08-24T04:00:00.000Z"),
    requestKey: "weekly-slot-override-1",
    scheduleOverrideReason: reason,
    dependencies: harness.dependencies,
  });

  const weeklyItem = harness.plan.selected_posts.find((item) => item.candidateId === harness.draft.candidate_id);
  assert.equal(harness.draft.scheduled_for.toISOString(), overrideFor);
  assert.equal(weeklyItem.scheduledFor.toISOString(), overrideFor);
  assert.equal(harness.getCapacityAt().toISOString(), overrideFor);
  assert.equal(harness.getPlanSaves(), 1);
  assert.deepEqual(harness.audits.map((entry) => entry.action), ["APPROVED", "SCHEDULE_OVERRIDDEN", "SCHEDULED"]);
  const overrideAudit = harness.audits[1];
  assert.equal(overrideAudit.metadata.old_scheduled_for.toISOString(), "2026-08-25T05:30:00.000Z");
  assert.equal(overrideAudit.metadata.new_scheduled_for.toISOString(), overrideFor);
  assert.equal(overrideAudit.metadata.reason, reason);
  assert.equal(overrideAudit.metadata.admin_id, "admin-1");
  assert.equal(overrideAudit.metadata.slot_number, 1);
  assert.equal(first.reused, false);

  const second = await approveAndScheduleDraft(harness.draft._id, overrideFor, {
    actor: { _id: "admin-1" },
    now: new Date("2026-08-24T04:00:00.000Z"),
    requestKey: "weekly-slot-override-1",
    scheduleOverrideReason: reason,
    dependencies: harness.dependencies,
  });
  assert.equal(second.reused, true);
  assert.equal(harness.audits.length, 3);
  assert.equal(harness.getPlanSaves(), 1);
});

test("a failed override transaction rolls back the draft, asset review, weekly slot, and every audit", async () => {
  const harness = weeklyApprovalHarness();
  const originalDraft = JSON.parse(JSON.stringify(harness.draft));
  const originalAsset = JSON.parse(JSON.stringify(harness.asset));
  const originalSelectedPosts = JSON.parse(JSON.stringify(harness.plan.selected_posts));
  const session = {
    async withTransaction(work) {
      const auditLength = harness.audits.length;
      try {
        await work();
      } catch (error) {
        for (const key of Object.keys(harness.draft)) if (key !== "save") delete harness.draft[key];
        Object.assign(harness.draft, originalDraft);
        for (const key of Object.keys(harness.asset)) delete harness.asset[key];
        Object.assign(harness.asset, originalAsset);
        harness.plan.selected_posts = originalSelectedPosts.map((item) => ({
          ...item,
          scheduledFor: new Date(item.scheduledFor),
        }));
        harness.audits.splice(auditLength);
        throw error;
      }
    },
    async endSession() {},
  };
  harness.dependencies.startSession = async () => session;
  harness.dependencies.SocialAuditLog = {
    async create(records) {
      const record = Array.isArray(records) ? records[0] : records;
      if (record.action === "SCHEDULED") throw new Error("simulated weekly override commit failure");
      harness.audits.push(record);
      return Array.isArray(records) ? [record] : record;
    },
  };

  await assert.rejects(
    () => approveAndScheduleDraft(harness.draft._id, "2026-08-27T06:30:00.000Z", {
      actor: { _id: "admin-1" },
      now: new Date("2026-08-24T04:00:00.000Z"),
      scheduleOverrideReason: "Move within the approved week for a controlled rollback test.",
      dependencies: harness.dependencies,
    }),
    /simulated weekly override commit failure/,
  );

  const weeklyItem = harness.plan.selected_posts.find((item) => item.candidateId === harness.draft.candidate_id);
  assert.equal(harness.draft.status, "NEEDS_REVIEW");
  assert.equal(harness.draft.scheduled_for, null);
  assert.equal(harness.asset.manual_review_status, "pending");
  assert.equal(weeklyItem.scheduledFor.toISOString(), "2026-08-25T05:30:00.000Z");
  assert.equal(weeklyItem.status, "NEEDS_REVIEW");
  assert.equal(harness.audits.length, 0);
});

test("approveAndScheduleDraft rolls back approval, asset review, schedule, and audits when the transaction fails", async () => {
  const draft = approvableDraft();
  const asset = approvableAsset();
  const audits = [];
  const initialDraft = JSON.parse(JSON.stringify(draft));
  const initialAsset = JSON.parse(JSON.stringify(asset));
  const session = {
    async withTransaction(work) {
      const auditLength = audits.length;
      try {
        await work();
      } catch (error) {
        for (const key of Object.keys(draft)) if (key !== "save") delete draft[key];
        Object.assign(draft, initialDraft);
        for (const key of Object.keys(asset)) delete asset[key];
        Object.assign(asset, initialAsset);
        audits.splice(auditLength);
        throw error;
      }
    },
    async endSession() {},
  };
  const dependencies = {
    startSession: async () => session,
    SocialPostDraft: { findById: async () => draft },
    SocialAsset: {
      find: async () => [asset],
      updateMany: async () => { asset.manual_review_status = "approved"; },
    },
    SocialWeeklyPlan: { findById: async () => null },
    SocialAuditLog: {
      async create(records) {
        const record = Array.isArray(records) ? records[0] : records;
        if (record.action === "SCHEDULED") throw new Error("simulated audit persistence failure");
        audits.push(record);
        return Array.isArray(records) ? [record] : record;
      },
    },
    getSocialManagerSettings: async () => approvalSettings(),
    assertWeeklyPublicationCapacity: async () => undefined,
    syncWeeklyPlanFromDraft: async () => null,
  };

  await assert.rejects(
    () => approveAndScheduleDraft(draft._id, "2026-08-25T05:30:00.000Z", {
      actor: { _id: "admin-1" },
      now: new Date("2026-08-24T04:00:00.000Z"),
      dependencies,
    }),
    /simulated audit persistence failure/,
  );
  assert.equal(draft.status, "NEEDS_REVIEW");
  assert.equal(draft.approved_at, undefined);
  assert.equal(draft.schedule_json, null);
  assert.equal(asset.manual_review_status, "pending");
  assert.equal(audits.length, 0);
});

function concurrentCapacityHarness({ initialStatus }) {
  const scheduledFor = new Date("2026-08-25T05:30:00.000Z");
  const existingDrafts = ["existing-1", "existing-2"].map((id, index) => ({
    _id: id,
    status: "SCHEDULED",
    scheduled_for: new Date(scheduledFor.getTime() + index * 60_000),
    current_package: { primaryRecommendation: { format: "SINGLE_IMAGE" } },
  }));
  const candidateDrafts = ["candidate-a", "candidate-b"].map((id) => {
    const draft = approvableDraft();
    draft._id = id;
    draft.generation_run_id = `run-${id}`;
    draft.status = initialStatus;
    if (initialStatus === "APPROVED") {
      draft.approved_at = new Date("2026-08-24T03:30:00.000Z");
      draft.approved_by_admin_id = "admin-1";
      draft.approved_revision = draft.revision;
      draft.approval_json = { required: true, status: "APPROVED", approved_revision: draft.revision };
    }
    draft.save = async function save() { return this; };
    return draft;
  });
  const draftById = new Map([...existingDrafts, ...candidateDrafts].map((draft) => [String(draft._id), draft]));
  const assetsByDraftId = new Map(candidateDrafts.map((draft, index) => {
    const asset = approvableAsset();
    asset._id = `asset-${index + 1}`;
    return [String(draft._id), asset];
  }));
  const audits = [];
  const guard = { fence: 0, maxConcurrentOwners: 0, concurrentOwners: 0 };
  let lockTail = Promise.resolve();

  function createSession() {
    let releaseGuard = null;
    const session = {
      guardHeld: false,
      async acquireGuard() {
        let releaseNext;
        const previous = lockTail;
        lockTail = new Promise((resolve) => { releaseNext = resolve; });
        await previous;
        releaseGuard = releaseNext;
        session.guardHeld = true;
        guard.concurrentOwners += 1;
        guard.maxConcurrentOwners = Math.max(guard.maxConcurrentOwners, guard.concurrentOwners);
      },
      async withTransaction(work) {
        try {
          await work();
        } finally {
          if (releaseGuard) {
            guard.concurrentOwners -= 1;
            session.guardHeld = false;
            releaseGuard();
          }
        }
      },
      async endSession() {},
    };
    return session;
  }

  const SocialPostDraft = {
    findById: async (id) => draftById.get(String(id)) || null,
    countDocuments() {
      return {
        async session(session) {
          assert.equal(session.guardHeld, true, "capacity count must execute while the per-week guard is held");
          return [...draftById.values()].filter((draft) => (
            draft.status === "SCHEDULED"
            && draft.scheduled_for
            && draft.current_package?.primaryRecommendation?.format !== "STORY"
          )).length;
        },
      };
    },
  };
  const dependencies = {
    startSession: async () => createSession(),
    SocialPostDraft,
    SocialWeeklyCapacityGuard: {
      async findOneAndUpdate(_filter, update, options) {
        assert.equal(options.upsert, true);
        assert.ok(options.session);
        await options.session.acquireGuard();
        guard.fence += Number(update.$inc?.fence || 0);
        return guard;
      },
    },
    SocialAsset: {
      find(query) { return Promise.resolve([assetsByDraftId.get(String(query.draft_id))]); },
      async updateMany(filter) {
        const ids = new Set((filter._id?.$in || []).map(String));
        for (const asset of assetsByDraftId.values()) {
          if (ids.has(String(asset._id))) asset.manual_review_status = "approved";
        }
      },
    },
    SocialWeeklyPlan: { findById: async () => null },
    SocialAuditLog: {
      async create(records) {
        const record = Array.isArray(records) ? records[0] : records;
        audits.push(record);
        return Array.isArray(records) ? [record] : record;
      },
    },
    getSocialManagerSettings: async () => approvalSettings(),
    syncWeeklyPlanFromDraft: async () => null,
    getDraftDetail: async (id) => ({ id: String(id), status: draftById.get(String(id)).status }),
  };
  return { scheduledFor, candidateDrafts, assetsByDraftId, audits, guard, dependencies };
}

test("concurrent approve-and-schedule requests serialize the final weekly slot", async () => {
  const harness = concurrentCapacityHarness({ initialStatus: "NEEDS_REVIEW" });
  const results = await Promise.allSettled(harness.candidateDrafts.map((draft, index) => (
    approveAndScheduleDraft(draft._id, harness.scheduledFor.toISOString(), {
      actor: { _id: "admin-1" },
      now: new Date("2026-08-24T04:00:00.000Z"),
      requestKey: `concurrent-capacity-${index + 1}`,
      dependencies: harness.dependencies,
    })
  )));

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected");
  assert.equal(rejected.reason.code, "social_weekly_publication_maximum_reached");
  assert.equal(harness.candidateDrafts.filter((draft) => draft.status === "SCHEDULED").length, 1);
  assert.equal(harness.candidateDrafts.filter((draft) => draft.status === "NEEDS_REVIEW").length, 1);
  assert.equal([...harness.assetsByDraftId.values()].filter((asset) => asset.manual_review_status === "approved").length, 1);
  assert.deepEqual(harness.audits.map((audit) => audit.action), ["APPROVED", "SCHEDULED"]);
  assert.equal(harness.guard.maxConcurrentOwners, 1);
});

test("legacy concurrent schedules use the same per-week capacity guard", async () => {
  const harness = concurrentCapacityHarness({ initialStatus: "APPROVED" });
  const results = await Promise.allSettled(harness.candidateDrafts.map((draft) => (
    scheduleDraft(draft._id, harness.scheduledFor.toISOString(), {
      actor: { _id: "admin-1" },
      now: new Date("2026-08-24T04:00:00.000Z"),
      dependencies: harness.dependencies,
    })
  )));

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected");
  assert.equal(rejected.reason.code, "social_weekly_publication_maximum_reached");
  assert.equal(harness.candidateDrafts.filter((draft) => draft.status === "SCHEDULED").length, 1);
  assert.equal(harness.candidateDrafts.filter((draft) => draft.status === "APPROVED").length, 1);
  assert.deepEqual(harness.audits.map((audit) => audit.action), ["SCHEDULED"]);
  assert.equal(harness.guard.maxConcurrentOwners, 1);
});
