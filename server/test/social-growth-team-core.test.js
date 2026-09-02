const test = require("node:test");
const assert = require("node:assert/strict");

const {
  validateWeeklyCandidates,
  validateWeeklyPlan,
} = require("../services/social/socialGrowthSchemas");
const {
  approveCommunityReply,
  approveWeeklyPlan,
  getAnalyticsSummary,
  refreshGrowthAnalytics,
  replaceWeeklyPlanSlot,
  requestWeeklyPlan,
  requestWeeklyPostProduction,
  runDueWeeklyPrepublication,
  sendApprovedCommunityReply,
  _private: growthPrivate,
} = require("../services/social/socialGrowthTeamService");
const {
  buildSocialOrchestrationDeliveryFingerprint,
  buildSocialOrchestrationSignature,
  requireSocialOrchestrationSignature,
} = require("../middleware/socialOrchestrationAuth");
const {
  serialisePredictionSnapshot,
  serialiseRecentSocialDraft,
} = require("../services/social/socialInternalSignals");

const POSTING_SLOTS = [
  { weekday: "TUESDAY", hour_ist: 11, minute_ist: 0 },
  { weekday: "THURSDAY", hour_ist: 18, minute_ist: 0 },
  { weekday: "SATURDAY", hour_ist: 11, minute_ist: 0 },
];

function settings(overrides = {}) {
  return {
    feature_enabled: true,
    weekly_planning: {
      candidate_count: 8,
      maximum_feed_posts: 3,
      posting_slots: POSTING_SLOTS,
    },
    brand_profile: {
      positioning: "Wealth | Wellness | Women",
      website_base_url: "https://pinkpaisa.in",
    },
    disclosures: {
      financial_disclaimer: "Educational content only.",
      affiliate_disclosure: "Affiliate disclosure applies where relevant.",
    },
    ...overrides,
  };
}

function candidate(index, overrides = {}) {
  const suffix = String(index + 1).padStart(2, "0");
  const pillars = [
    "Money Education",
    "Money Psychology",
    "Wealth and Wellness",
    "Relatable Money Moments",
    "Interactive",
    "Pink Paisa Resources",
    "Curated Wellness and Affiliate Products",
  ];
  const formats = [
    "SINGLE_IMAGE",
    "CAROUSEL",
    "REEL",
    "INFOGRAPHIC",
    "MEME",
    "QUIZ",
    "PRODUCT_FEATURE",
    "RESOURCE_PROMOTION",
  ];
  return {
    candidateId: `candidate_topic_${suffix}`,
    title: `Distinct weekly idea ${suffix}`,
    objective: "EDUCATION",
    primaryKpi: "SAVES",
    secondaryKpi: "SHARES",
    audienceSegment: "Indian women seeking practical, jargon-free money guidance",
    topic: `Distinct evidence-led money topic ${suffix}`,
    contentPillar: pillars[index % pillars.length],
    format: formats[index % formats.length],
    whyThisWeek: `Topic ${suffix} answers a distinct current audience need without manufactured urgency.`,
    whyThisFormat: `The selected format makes idea ${suffix} easy to understand and retain.`,
    pinkPaisaConnection: `Idea ${suffix} supports Pink Paisa's educational brand promise.`,
    recommendedLandingPage: null,
    verifiedInternalEntityId: null,
    evidenceSourceIndexes: [],
    riskLevel: "LOW",
    promotionalIntensity: "NONE",
    confidence: 0.86,
    duplicateRisk: "NONE",
    conciseRationale: `Candidate ${suffix} is useful, distinct, supported, and safe.`,
    ...overrides,
  };
}

function weeklyPlanOutput(candidates, selectedCount = 3) {
  const schedules = [
    "2026-08-25T05:30:00.000Z",
    "2026-08-27T12:30:00.000Z",
    "2026-08-29T05:30:00.000Z",
    "2026-08-30T05:30:00.000Z",
  ];
  return {
    weekStart: "2026-08-24",
    weekEnd: "2026-08-30",
    timezone: "Asia/Kolkata",
    selectedPosts: candidates.slice(0, selectedCount).map((item, index) => ({
      candidateId: item.candidateId,
      slotNumber: index + 1,
      scheduledFor: schedules[index],
      selectionReason: `Candidate ${index + 1} contributes a distinct role to the weekly mix.`,
      roleInWeeklyMix: ["DISCOVERY", "SAVEABLE_EDUCATION", "ENGAGEMENT", "OTHER"][index],
    })),
    rejectedCandidateIds: candidates.slice(selectedCount).map((item) => item.candidateId),
    formatBalance: "The selected formats balance discovery, depth, and interaction.",
    objectiveBalance: "The plan balances education, engagement, and audience discovery.",
    promotionalBalance: "The plan remains education-led and avoids excessive promotion.",
    evidenceLimitations: [],
    finalRecommendation: "Publish the three distinct posts in the configured IST slots after human approval.",
  };
}

function auditModel() {
  return { create: async (value) => ({ _id: `audit-${value.action}`, ...value }) };
}

function createResponseRecorder() {
  const state = { statusCode: 200, body: null };
  const response = {
    status(code) {
      state.statusCode = code;
      return response;
    },
    json(body) {
      state.body = body;
      return response;
    },
  };
  return { response, state };
}

test("weekly schemas require at least eight materially distinct candidates and an exact configured three-slot plan", () => {
  const candidates = Array.from({ length: 8 }, (_, index) => candidate(index));
  assert.equal(validateWeeklyCandidates({
    candidates,
    generationSummary: "Eight materially different ideas were generated from supplied evidence.",
  }).candidates.length, 8);

  assert.throws(
    () => validateWeeklyCandidates({
      candidates: candidates.slice(0, 7),
      generationSummary: "Only seven ideas were supplied.",
    }),
    (error) => error.code === "structured_output_invalid",
  );

  const duplicatedTopic = candidates.map((item) => ({ ...item }));
  duplicatedTopic[7].topic = duplicatedTopic[0].topic.toUpperCase();
  assert.throws(
    () => validateWeeklyCandidates({
      candidates: duplicatedTopic,
      generationSummary: "One topic was duplicated.",
    }),
    (error) => error.code === "structured_output_invalid" && /materially different/i.test(error.message),
  );

  const planningWindow = {
    maximum: 3,
    slots: weeklyPlanOutput(candidates).selectedPosts.map((item) => ({
      slotNumber: item.slotNumber,
      scheduledFor: item.scheduledFor,
    })),
  };
  const validPlan = weeklyPlanOutput(candidates, 3);
  assert.equal(growthPrivate.validatePlanSelection(validPlan, candidates, planningWindow).selectedPosts.length, 3);

  assert.throws(
    () => validateWeeklyPlan(weeklyPlanOutput(candidates, 4), candidates, 3),
    (error) => error.code === "structured_output_invalid" && /weekly maximum 3/i.test(error.message),
  );
  assert.throws(
    () => growthPrivate.validatePlanSelection(weeklyPlanOutput(candidates, 2), candidates, planningWindow),
    (error) => error.code === "structured_output_invalid" && /exactly 3 posts/i.test(error.message),
  );

  const candidatesWithSelectedStory = candidates.map((item) => ({ ...item }));
  candidatesWithSelectedStory[0].format = "STORY";
  assert.throws(
    () => growthPrivate.validatePlanSelection(weeklyPlanOutput(candidatesWithSelectedStory, 3), candidatesWithSelectedStory, planningWindow),
    (error) => error.code === "structured_output_invalid" && /not a feed publication/i.test(error.message),
  );
});

test("the five-feed cadence cannot be satisfied by replacing required feed-capable ideas with Story candidates", () => {
  const candidates = Array.from({ length: 8 }, (_, index) => candidate(index));
  candidates[6].format = "STORY";
  candidates[7].format = "STORY";
  assert.throws(
    () => growthPrivate.validateCandidateInternalTruth(
      { candidates, generationSummary: "Eight ideas, but only six are feed-capable." },
      { products: [], blogs: [], workshops: [], virtual_products: [], polls: [], pink_pages: [], static_resources: [] },
      { sources: [] },
      {
        brand_profile: { website_base_url: "https://pinkpaisa.in" },
        weekly_planning: { maximum_feed_posts: 5 },
      },
    ),
    (error) => error.code === "structured_output_invalid"
      && error.validation_errors.includes("$.candidates must include at least seven candidates whose format is not STORY"),
  );
});

test("weekly plan requests are idempotently reused without a request-count throttle", async () => {
  let storedPlan = null;
  let createCalls = 0;
  const PlanModel = {
    async findOne(query) {
      return storedPlan?.week_key === query.week_key ? storedPlan : null;
    },
    async create(value) {
      createCalls += 1;
      storedPlan = {
        _id: "weekly-plan-1",
        ...value,
        async save() { return this; },
      };
      return storedPlan;
    },
  };
  const dependencies = {
    SocialWeeklyPlan: PlanModel,
    SocialAuditLog: auditModel(),
    getSocialManagerSettings: async () => settings(),
  };
  const now = new Date("2026-08-24T01:00:00.000Z");

  const results = [];
  for (let index = 0; index < 50; index += 1) {
    results.push(await requestWeeklyPlan({ now, dependencies }));
  }

  assert.equal(createCalls, 1);
  assert.equal(results[0].reused, false);
  assert.ok(results.slice(1).every((result) => result.reused === true));
  assert.ok(results.every((result) => result.plan === storedPlan));
  assert.equal(storedPlan.idempotency_key, "social-weekly-plan:2026-08-24");
  assert.equal(storedPlan.maximum_feed_posts, 3);
});

test("concurrent weekly plan requests recover the unique-key race and all reuse one plan", async () => {
  let storedPlan = null;
  let successfulCreates = 0;
  const PlanModel = {
    async findOne(query) {
      return storedPlan?.week_key === query.week_key ? storedPlan : null;
    },
    async create(value) {
      await Promise.resolve();
      if (storedPlan) {
        const conflict = new Error("duplicate week_key");
        conflict.code = 11000;
        throw conflict;
      }
      successfulCreates += 1;
      storedPlan = { _id: "weekly-plan-concurrent", ...value, async save() { return this; } };
      return storedPlan;
    },
  };
  const dependencies = {
    SocialWeeklyPlan: PlanModel,
    SocialAuditLog: auditModel(),
    getSocialManagerSettings: async () => settings(),
  };
  const outcomes = await Promise.all(Array.from({ length: 50 }, () => requestWeeklyPlan({
    now: new Date("2026-08-24T01:00:00.000Z"),
    dependencies,
  })));

  assert.equal(successfulCreates, 1);
  assert.ok(outcomes.every((outcome) => outcome.plan === storedPlan));
  assert.equal(outcomes.filter((outcome) => outcome.reused === false).length, 1);
  assert.equal(outcomes.filter((outcome) => outcome.reused === true).length, 49);
});

test("approved weekly plans require explicit replacement confirmation and scheduled plans stay immutable", async () => {
  const approved = {
    _id: "weekly-approved-replace",
    status: "APPROVED",
    version: 2,
    candidates: [{ candidateId: "old" }],
    selected_posts: [{ candidateId: "old", status: "APPROVED" }],
    async save() { return this; },
  };
  const dependencies = {
    SocialWeeklyPlan: { findOne: async () => approved },
    SocialAuditLog: auditModel(),
    getSocialManagerSettings: async () => settings(),
  };

  await assert.rejects(
    () => requestWeeklyPlan({ force: true, dependencies }),
    (error) => error.code === "social_weekly_plan_replacement_confirmation_required",
  );
  const replaced = await requestWeeklyPlan({ force: true, allowApprovedReplacement: true, dependencies });
  assert.equal(replaced.reused, false);
  assert.equal(approved.status, "QUEUED");
  assert.equal(approved.version, 3);
  assert.deepEqual(approved.selected_posts, []);

  approved.status = "SCHEDULED";
  await assert.rejects(
    () => requestWeeklyPlan({ force: true, allowApprovedReplacement: true, dependencies }),
    (error) => error.code === "social_weekly_plan_replacement_unsafe",
  );
});

test("creative production stays behind human plan approval and carries exact weekly linkage", async () => {
  const selectedCandidate = candidate(0, { format: "CAROUSEL" });
  const selected = {
    candidateId: selectedCandidate.candidateId,
    candidate: selectedCandidate,
    scheduledFor: "2026-08-25T05:30:00.000Z",
    generation_run_id: null,
  };
  const plan = {
    _id: "weekly-plan-approval",
    status: "NEEDS_REVIEW",
    version: 4,
    candidates: [selectedCandidate],
    selected_posts: [selected],
    async save() { return this; },
  };
  const PlanModel = { findById: async () => plan };
  let generationCalls = 0;
  let generationInput = null;
  let createdRun = null;
  const dependencies = {
    SocialWeeklyPlan: PlanModel,
    SocialAuditLog: auditModel(),
    SocialGenerationRun: { findById: async (id) => (String(id) === String(createdRun?._id) ? createdRun : null) },
    getSocialManagerSettings: async () => settings(),
    requestGeneration: async (input) => {
      generationCalls += 1;
      generationInput = input;
      createdRun = {
        _id: "generation-run-1",
        status: "PENDING",
        weekly_plan_id: plan._id,
        weekly_candidate_id: selectedCandidate.candidateId,
      };
      return {
        run: createdRun,
        reused: false,
      };
    },
  };

  await assert.rejects(
    () => requestWeeklyPostProduction(plan._id, selectedCandidate.candidateId, { dependencies }),
    (error) => error.statusCode === 409 && /human approval/i.test(error.message),
  );
  assert.equal(generationCalls, 0);

  const approved = await approveWeeklyPlan(plan._id, { actor: { id: "admin-1" }, dependencies });
  assert.equal(plan.status, "APPROVED");
  assert.equal(approved.production.requested, 1);
  assert.equal(approved.production.queued, 1);
  assert.equal(generationCalls, 1);
  const produced = await requestWeeklyPostProduction(plan._id, selectedCandidate.candidateId, {
    actor: { id: "admin-1" },
    now: new Date("2026-08-24T04:00:00.000Z"),
    dependencies,
  });

  assert.equal(generationCalls, 1);
  assert.deepEqual(generationInput.weeklyContext, {
    planId: plan._id,
    candidateId: selectedCandidate.candidateId,
    visualModeResolution: {
      requested: "AI_VISUAL_WITH_EXACT_OVERLAY",
      effective: "AI_VISUAL_WITH_EXACT_OVERLAY",
      eligible: true,
      reasons: [],
    },
    brandLogoContract: generationInput.weeklyContext.brandLogoContract,
  });
  assert.equal(generationInput.weeklyContext.brandLogoContract.required, true);
  assert.equal(generationInput.weeklyContext.brandLogoContract.method, "AI_REFERENCE_BAKED");
  assert.equal(generationInput.requestKey, `social-weekly-production:${plan._id}:${selectedCandidate.candidateId}:v4`);
  assert.equal(generationInput.generationRequest.request_id, `weekly:${plan._id}:${selectedCandidate.candidateId}`);
  assert.equal(generationInput.generationRequest.requested_format, "CAROUSEL");
  assert.deepEqual(generationInput.generationRequest.weekly_candidate, selectedCandidate);
  assert.equal(generationInput.generationRequest.required_landing_page, null);
  assert.equal(produced.run.weekly_plan_id, plan._id);
  assert.equal(produced.reused, true);
  assert.equal(selected.generation_run_id, "generation-run-1");
  assert.equal(selected.status, "GENERATING_COPY");
});

test("talking-head concepts create a real-footage script and shot-list action without fabricating an endorsement", async () => {
  const selectedCandidate = candidate(2, {
    format: "REEL",
    title: "Founder talking-head: the one money habit to start",
    whyThisFormat: "A real Pink Paisa spokesperson should speak directly to camera.",
  });
  const selected = {
    candidateId: selectedCandidate.candidateId,
    candidate: selectedCandidate,
    scheduledFor: new Date("2026-08-26T05:30:00.000Z"),
    generation_run_id: null,
  };
  const plan = {
    _id: "weekly-plan-talking-head",
    status: "NEEDS_REVIEW",
    version: 4,
    candidates: [selectedCandidate],
    selected_posts: [selected],
    story_plan: [],
    async save() { return this; },
  };
  let manualActionRecord = null;
  const result = await approveWeeklyPlan(plan._id, {
    actor: { _id: "admin-1" },
    dependencies: {
      SocialWeeklyPlan: { findById: async () => plan },
      SocialGenerationRun: { findById: async () => null },
      SocialAuditLog: auditModel(),
      SocialManualAction: {
        findOneAndUpdate: async (_query, update) => {
          manualActionRecord = { _id: "manual-action-talking-head", ...update.$setOnInsert };
          return manualActionRecord;
        },
      },
      getSocialManagerSettings: async () => settings(),
      requestGeneration: async (input) => ({
        run: {
          _id: "run-talking-head",
          status: "PENDING",
          weekly_plan_id: plan._id,
          weekly_candidate_id: input.weeklyContext.candidateId,
        },
        reused: false,
      }),
    },
  });

  assert.equal(manualActionRecord.action_type, "CONTENT_ESCALATION");
  assert.match(manualActionRecord.title, /authentic talking-head footage/i);
  assert.match(manualActionRecord.instructions.join(" "), /script and shot list|HOOK.*TENSION.*VALUE.*IDENTITY.*CTA/i);
  assert.match(manualActionRecord.instructions.join(" "), /Do not replace missing footage with an AI-generated founder/i);
  assert.equal(result.production.generation_runs[0].manual_action_id, "manual-action-talking-head");
});

test("a failed weekly creative run queues a fresh linked retry instead of reusing the failure", async () => {
  const selectedCandidate = candidate(1, { format: "SINGLE_IMAGE" });
  const selected = {
    candidateId: selectedCandidate.candidateId,
    candidate: selectedCandidate,
    status: "FAILED",
    generation_run_id: "generation-run-failed-1",
    draft_id: null,
  };
  const plan = {
    _id: "weekly-plan-retry",
    status: "ACTIVE",
    version: 7,
    candidates: [selectedCandidate],
    selected_posts: [selected],
    async save() { return this; },
  };
  let generationInput = null;
  const dependencies = {
    SocialWeeklyPlan: { findById: async () => plan },
    SocialGenerationRun: {
      findById: async (id) => ({ _id: id, status: "FAILED", selected_draft_id: null }),
    },
    SocialAuditLog: auditModel(),
    requestGeneration: async (input) => {
      generationInput = input;
      return {
        run: {
          _id: "generation-run-retry-2",
          status: "PENDING",
          weekly_plan_id: plan._id,
          weekly_candidate_id: selectedCandidate.candidateId,
        },
        reused: false,
      };
    },
  };

  const result = await requestWeeklyPostProduction(plan._id, selectedCandidate.candidateId, {
    actor: { id: "admin-1" },
    now: new Date("2026-08-24T04:30:00.000Z"),
    dependencies,
  });

  assert.equal(generationInput.triggerType, "RETRY");
  assert.equal(
    generationInput.requestKey,
    `social-weekly-production:${plan._id}:${selectedCandidate.candidateId}:v7:retry:generation-run-failed-1`,
  );
  assert.equal(result.reused, false);
  assert.equal(selected.generation_run_id, "generation-run-retry-2");
  assert.equal(selected.status, "GENERATING_COPY");
});

test("weekly approval queues every selected creative once and reuses all queues on retry", async () => {
  const selectedCandidates = [0, 1, 2].map((index) => candidate(index, { format: index === 1 ? "CAROUSEL" : "SINGLE_IMAGE" }));
  const plan = {
    _id: "weekly-plan-queue-all",
    status: "NEEDS_REVIEW",
    version: 3,
    candidates: selectedCandidates,
    selected_posts: selectedCandidates.map((item, index) => ({
      candidateId: item.candidateId,
      candidate: item,
      slotNumber: index + 1,
      scheduledFor: new Date(`2026-08-${25 + index * 2}T05:30:00.000Z`),
      status: "PLANNED",
      generation_run_id: null,
    })),
    async save() { return this; },
  };
  const runs = new Map();
  const audits = [];
  let generationCalls = 0;
  let visualModeResolutions = 0;
  const dependencies = {
    SocialWeeklyPlan: { findById: async () => plan },
    SocialGenerationRun: { findById: async (id) => runs.get(String(id)) || null },
    SocialAuditLog: { create: async (record) => { audits.push(record); return record; } },
    getSocialManagerSettings: async () => settings({ generation: { default_visual_mode: "AI_VISUAL_WITH_EXACT_OVERLAY" } }),
    socialVisualPolicy: {
      resolveSocialVisualMode: ({ requestedVisualMode }) => {
        visualModeResolutions += 1;
        return { requested: requestedVisualMode, effective: "AI_VISUAL_WITH_EXACT_OVERLAY", eligible: true, reasons: [] };
      },
    },
    requestGeneration: async (input) => {
      generationCalls += 1;
      const run = {
        _id: `run-${input.weeklyContext.candidateId}`,
        status: "PENDING",
        weekly_plan_id: plan._id,
        weekly_candidate_id: input.weeklyContext.candidateId,
      };
      runs.set(String(run._id), run);
      return { run, reused: false };
    },
  };

  const first = await approveWeeklyPlan(plan._id, {
    actor: { _id: "admin-1" },
    now: new Date("2026-08-24T04:00:00.000Z"),
    dependencies,
  });
  assert.deepEqual({ requested: first.production.requested, queued: first.production.queued, reused: first.production.reused }, { requested: 3, queued: 3, reused: 0 });
  assert.equal(generationCalls, 3);
  assert.equal(visualModeResolutions, 3);
  assert.ok(plan.selected_posts.every((selected) => selected.status === "GENERATING_COPY" && selected.generation_run_id));
  assert.equal(audits.length, 4);
  const frozenVisualModes = plan.selected_posts.map((selected) => JSON.stringify(selected.visual_mode_resolution));

  const second = await approveWeeklyPlan(plan._id, {
    actor: { _id: "admin-1" },
    now: new Date("2026-08-24T04:01:00.000Z"),
    dependencies,
  });
  assert.deepEqual({ requested: second.production.requested, queued: second.production.queued, reused: second.production.reused }, { requested: 3, queued: 0, reused: 3 });
  assert.equal(generationCalls, 3);
  assert.equal(visualModeResolutions, 3);
  assert.deepEqual(plan.selected_posts.map((selected) => JSON.stringify(selected.visual_mode_resolution)), frozenVisualModes);
  assert.equal(audits.length, 4);
});

test("five-feed approval atomically queues all five feeds and seven human-reviewed Stories", async () => {
  const candidates = Array.from({ length: 8 }, (_, index) => candidate(index));
  const feedSchedules = [
    "2026-08-24T05:30:00.000Z",
    "2026-08-25T12:30:00.000Z",
    "2026-08-26T05:30:00.000Z",
    "2026-08-27T12:30:00.000Z",
    "2026-08-28T05:30:00.000Z",
  ];
  const plan = {
    _id: "weekly-plan-five-feeds-seven-stories",
    status: "NEEDS_REVIEW",
    version: 4,
    maximum_feed_posts: 5,
    week_start: "2026-08-24",
    week_end: "2026-08-30",
    candidates,
    selected_posts: candidates.slice(0, 5).map((item, index) => ({
      candidateId: item.candidateId,
      candidate: item,
      slotNumber: index + 1,
      scheduledFor: new Date(feedSchedules[index]),
      status: "PLANNED",
      generation_run_id: null,
    })),
    story_plan: [],
    async save() { return this; },
  };
  plan.story_plan = growthPrivate.buildWeeklyStoryPlan({
    plan,
    selectedPosts: plan.selected_posts,
    candidates,
  });
  assert.deepEqual(plan.story_plan.map((item) => new Date(item.scheduledFor).toISOString()), [
    ...feedSchedules,
    "2026-08-29T05:30:00.000Z",
    "2026-08-30T05:30:00.000Z",
  ]);
  assert.ok(plan.story_plan.slice(0, 5).every((story, index) => (
    story.bundleRole === "COMPANION_STORY"
    && story.parentCandidateId === plan.selected_posts[index].candidateId
    && story.bundleId === plan.selected_posts[index].bundleId
    && story.visual_mode_resolution.requested === "FULL_AI_GRAPHIC"
    && story.visual_mode_resolution.effective === "FULL_AI_GRAPHIC"
    && story.visual_mode_resolution.eligible === true
  )));
  assert.deepEqual(plan.story_plan.slice(5).map((story) => story.bundleRole), ["STANDALONE_STORY", "STANDALONE_STORY"]);
  const runs = new Map();
  const audits = [];
  const session = {
    async withTransaction(work) { await work(); },
    async endSession() {},
  };
  const dependencies = {
    startSession: async () => session,
    SocialWeeklyPlan: { findById: async () => plan },
    SocialGenerationRun: { findById: async (id) => runs.get(String(id)) || null },
    SocialAuditLog: {
      async create(records) {
        const record = Array.isArray(records) ? records[0] : records;
        audits.push(record);
        return Array.isArray(records) ? [record] : record;
      },
    },
    getSocialManagerSettings: async () => settings({
      generation: { default_visual_mode: "AI_VISUAL_WITH_EXACT_OVERLAY" },
      weekly_planning: {
        candidate_count: 8,
        maximum_feed_posts: 5,
        posting_slots: [
          { weekday: "MONDAY", hour_ist: 11, minute_ist: 0 },
          { weekday: "TUESDAY", hour_ist: 18, minute_ist: 0 },
          { weekday: "WEDNESDAY", hour_ist: 11, minute_ist: 0 },
          { weekday: "THURSDAY", hour_ist: 18, minute_ist: 0 },
          { weekday: "FRIDAY", hour_ist: 11, minute_ist: 0 },
        ],
      },
    }),
    socialVisualPolicy: {
      resolveSocialVisualMode: ({ requestedVisualMode }) => ({
        requested: requestedVisualMode,
        effective: "AI_VISUAL_WITH_EXACT_OVERLAY",
        eligible: true,
        reasons: [],
      }),
    },
    requestGeneration: async (input) => {
      assert.equal(input.dependencies.mongoSession, session);
      const candidateId = input.weeklyContext.candidateId;
      const run = {
        _id: `run-${candidateId}`,
        status: "PENDING",
        weekly_plan_id: plan._id,
        weekly_candidate_id: candidateId,
      };
      runs.set(String(run._id), run);
      return { run, reused: false };
    },
  };

  const result = await approveWeeklyPlan(plan._id, {
    actor: { _id: "admin-1" },
    now: new Date("2026-08-23T12:30:00.000Z"),
    dependencies,
  });

  assert.deepEqual(
    { requested: result.production.requested, queued: result.production.queued, reused: result.production.reused },
    { requested: 12, queued: 12, reused: 0 },
  );
  assert.equal(result.production.generation_runs.filter((item) => item.kind === "FEED").length, 5);
  assert.equal(result.production.generation_runs.filter((item) => item.kind === "STORY").length, 7);
  assert.equal(result.production.generation_runs.filter((item) => item.bundle_role === "COMPANION_STORY").length, 5);
  assert.equal(result.production.generation_runs.filter((item) => item.bundle_role === "STANDALONE_STORY").length, 2);
  assert.equal(new Set(result.production.generation_runs.map((item) => item.generation_run_id)).size, 12);
  assert.ok([...plan.selected_posts, ...plan.story_plan].every((item) => item.status === "GENERATING_COPY" && item.generation_run_id));
  assert.equal(audits.filter((entry) => entry.action === "WEEKLY_POST_PRODUCTION_QUEUED").length, 12);
  assert.equal(audits.filter((entry) => entry.action === "WEEKLY_PLAN_APPROVED").length, 1);
});

test("an administrator can replace an unlocked review slot with an unused retained candidate", async () => {
  const candidates = Array.from({ length: 8 }, (_, index) => candidate(index));
  candidates[5] = candidate(5, {
    candidateId: "retained_product_candidate",
    format: "SINGLE_IMAGE",
    objective: "PRODUCT_PROMOTION",
    verifiedInternalEntityId: "product-verified-1",
  });
  const originalSchedule = new Date("2026-08-27T05:30:00.000Z");
  const selected = candidates.slice(0, 3).map((item, index) => ({
    candidateId: item.candidateId,
    candidate: item,
    slotNumber: index + 1,
    scheduledFor: index === 1 ? originalSchedule : new Date(`2026-08-${25 + index * 2}T05:30:00.000Z`),
    selectionReason: `Original selection ${index + 1}`,
    roleInWeeklyMix: "SAVEABLE_EDUCATION",
    visual_mode_resolution: {
      requested: "AI_ARTWORK_ONLY",
      effective: "AI_ARTWORK_ONLY",
      eligible: true,
      reasons: [],
    },
    status: "PLANNED",
    generation_run_id: null,
    draft_id: null,
    publication_id: null,
  }));
  const plan = {
    _id: "507f1f77bcf86cd799439021",
    status: "NEEDS_REVIEW",
    version: 4,
    output_checksum: "a".repeat(64),
    candidates,
    selected_posts: selected,
    async save() { return this; },
  };
  const audits = [];
  const result = await replaceWeeklyPlanSlot(plan._id, 2, "retained_product_candidate", {
    actor: { _id: "507f1f77bcf86cd799439014" },
    now: new Date("2026-08-24T06:00:00.000Z"),
    dependencies: {
      SocialWeeklyPlan: { findById: async () => plan },
      SocialGenerationRun: { exists: async () => null },
      SocialPostDraft: { exists: async () => null },
      SocialAuditLog: { create: async (record) => { audits.push(record); return record; } },
      getSocialManagerSettings: async () => settings({ generation: { default_visual_mode: "AI_ARTWORK_ONLY" } }),
    },
  });

  assert.equal(plan.status, "NEEDS_REVIEW");
  assert.equal(plan.version, 5);
  assert.equal(plan.selected_posts[1].scheduledFor, originalSchedule);
  assert.equal(plan.selected_posts[1].slotNumber, 2);
  assert.equal(plan.selected_posts[1].candidateId, "retained_product_candidate");
  assert.equal(plan.selected_posts[1].roleInWeeklyMix, "CONVERSION");
  assert.match(plan.selected_posts[1].selectionReason, /Administrator selected a retained candidate/);
  assert.deepEqual(plan.selected_posts[1].visual_mode_resolution, {
    requested: "AI_ARTWORK_ONLY",
    effective: "AI_VISUAL_WITH_EXACT_OVERLAY",
    eligible: false,
    reasons: [
      "BRAND_LOGO_REQUIRED",
      "OBJECTIVE_REQUIRES_EXACT_OVERLAY",
      "PROMOTIONAL_CONTENT_REQUIRES_EXACT_OVERLAY",
    ],
  });
  assert.notEqual(plan.output_checksum, "a".repeat(64));
  assert.deepEqual(result.replacement, {
    slot_number: 2,
    previous_candidate_id: candidates[1].candidateId,
    candidate_id: "retained_product_candidate",
    plan_version: 5,
    visual_mode_resolution: plan.selected_posts[1].visual_mode_resolution,
  });
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "WEEKLY_PLAN_SLOT_REPLACED");
  assert.equal(audits[0].metadata.scheduled_for, originalSchedule);
});

test("five-feed slot replacement retargets its companion and rebuilds distinct retained weekend Stories", async () => {
  const candidates = Array.from({ length: 8 }, (_, index) => candidate(index, { format: "SINGLE_IMAGE" }));
  const plan = {
    _id: "weekly-plan-replace-bundle",
    status: "NEEDS_REVIEW",
    version: 4,
    maximum_feed_posts: 5,
    week_start: "2026-08-24",
    candidates,
    selected_posts: candidates.slice(0, 5).map((item, index) => ({
      candidateId: item.candidateId,
      candidate: item,
      slotNumber: index + 1,
      scheduledFor: new Date(`2026-08-${24 + index}T05:30:00.000Z`),
      selectionReason: `Selected ${index + 1}`,
      roleInWeeklyMix: "SAVEABLE_EDUCATION",
      status: "PLANNED",
    })),
    story_plan: [],
    async save() { return this; },
  };
  plan.story_plan = growthPrivate.buildWeeklyStoryPlan({ plan, selectedPosts: plan.selected_posts, candidates });
  const originalCompanionId = plan.story_plan[0].candidateId;
  assert.equal(plan.story_plan[5].sourceCandidateId, candidates[5].candidateId);

  await replaceWeeklyPlanSlot(plan._id, 1, candidates[5].candidateId, {
    actor: { id: "admin-1" },
    dependencies: {
      SocialWeeklyPlan: { findById: async () => plan },
      SocialGenerationRun: { exists: async () => null },
      SocialPostDraft: { exists: async () => null },
      SocialAuditLog: auditModel(),
      getSocialManagerSettings: async () => settings({ generation: { default_visual_mode: "AI_VISUAL_WITH_EXACT_OVERLAY" } }),
    },
  });

  const companion = plan.story_plan.find((item) => item.slotNumber === 1);
  const selectedIds = new Set(plan.selected_posts.map((item) => item.candidateId));
  const weekendSources = plan.story_plan.slice(5).map((item) => item.sourceCandidateId);
  assert.equal(companion.parentCandidateId, candidates[5].candidateId);
  assert.equal(companion.sourceCandidateId, candidates[5].candidateId);
  assert.equal(companion.bundleId, plan.selected_posts[0].bundleId);
  assert.notEqual(companion.candidateId, originalCompanionId);
  assert.deepEqual(weekendSources, [candidates[0].candidateId, candidates[6].candidateId]);
  assert.equal(new Set(weekendSources).size, 2);
  assert.ok(weekendSources.every((candidateId) => !selectedIds.has(candidateId)));
});

test("rolling four-week content mix accounts for three approved plan histories plus the current selection", () => {
  const categorySequence = [
    ...Array(8).fill("MONEY"),
    ...Array(4).fill("BODY_FITNESS"),
    ...Array(3).fill("WELLNESS_BEAUTY"),
    ...Array(3).fill("WOMEN_LIFE"),
    ...Array(2).fill("PINK_PAISA"),
  ];
  const selectedFor = (categories) => categories.map((growthCategory, index) => ({
    candidate: { candidateId: `${growthCategory}-${index}`, format: "SINGLE_IMAGE", growthCategory },
  }));
  const historyPlans = [0, 1, 2].map((index) => ({
    week_start: `2026-08-${3 + index * 7}`,
    selected_posts: selectedFor(categorySequence.slice(index * 5, index * 5 + 5)),
  }));
  const snapshot = growthPrivate.buildRollingContentMixSnapshot({
    historyPlans,
    currentSelected: selectedFor(categorySequence.slice(15)),
  });

  assert.equal(snapshot.total_posts, 20);
  assert.equal(snapshot.history_weeks_found, 3);
  assert.deepEqual(snapshot.counts, {
    MONEY: 8,
    BODY_FITNESS: 4,
    WELLNESS_BEAUTY: 3,
    WOMEN_LIFE: 3,
    PINK_PAISA: 2,
  });
  assert.deepEqual(snapshot.actual_percentages, snapshot.target_percentages);
  assert.equal(snapshot.enforcement, "ACCOUNTED_AI_GUIDANCE");
  assert.equal(snapshot.hard_quota_enforced, false);
});

test("growth series keys are assigned from the idea meaning rather than candidate array position", () => {
  const review = {
    objective: "PRODUCT_PROMOTION",
    verifiedInternalEntityId: "product-1",
    topic: "Would I buy this yoga mat? An evidence-led review",
  };
  const find = {
    objective: "PRODUCT_PROMOTION",
    verifiedInternalEntityId: "product-2",
    topic: "Pink Paisa find: a stretching strap for a simple home routine",
  };
  const first = growthPrivate.seriesKeyForCandidate(review, 0);
  const later = growthPrivate.seriesKeyForCandidate(review, 7);
  assert.equal(first, "WOULD_I_BUY_IT");
  assert.equal(later, first);
  assert.equal(growthPrivate.seriesKeyForCandidate(find, 1), "PINK_PAISA_FINDS");
  assert.equal(growthPrivate.seriesKeyForCandidate({ growthCategory: "WOMEN_LIFE", topic: "Money after 40" }, 4), "AFTER_40");
  assert.equal(growthPrivate.seriesKeyForCandidate({ growthCategory: "MONEY", topic: "The budget math behind saving" }, 5), "RICH_GIRL_MATH");
});

test("approval rejects a partial five-feed or daily-Story cadence before any generation is queued", async () => {
  const candidates = Array.from({ length: 8 }, (_, index) => candidate(index, { format: "SINGLE_IMAGE" }));
  const plan = {
    _id: "weekly-plan-corrupt-cadence",
    status: "NEEDS_REVIEW",
    maximum_feed_posts: 5,
    candidates,
    selected_posts: candidates.slice(0, 5).map((item, index) => ({
      candidateId: item.candidateId,
      candidate: item,
      slotNumber: index + 1,
      scheduledFor: new Date(`2026-08-${24 + index}T05:30:00.000Z`),
      status: "PLANNED",
    })),
    story_plan: [],
    async save() { return this; },
  };
  let generationCalls = 0;
  await assert.rejects(
    () => approveWeeklyPlan(plan._id, {
      actor: { id: "admin-1" },
      dependencies: {
        SocialWeeklyPlan: { findById: async () => plan },
        getSocialManagerSettings: async () => settings(),
        requestGeneration: async () => { generationCalls += 1; },
      },
    }),
    (error) => error.code === "social_weekly_cadence_incomplete" && error.statusCode === 409,
  );
  assert.equal(plan.status, "NEEDS_REVIEW");
  assert.equal(generationCalls, 0);
});

test("weekly slot replacement rejects approved plans, selected candidates, and slots with production history", async () => {
  const candidates = Array.from({ length: 8 }, (_, index) => candidate(index));
  const selected = candidates.slice(0, 3).map((item, index) => ({
    candidateId: item.candidateId,
    candidate: item,
    slotNumber: index + 1,
    scheduledFor: new Date(`2026-08-${25 + index * 2}T05:30:00.000Z`),
    status: "PLANNED",
    generation_run_id: null,
    draft_id: null,
  }));
  const plan = { _id: "weekly-plan-locked", status: "APPROVED", version: 2, candidates, selected_posts: selected, async save() { return this; } };
  const dependencies = {
    SocialWeeklyPlan: { findById: async () => plan },
    SocialGenerationRun: { exists: async () => null },
    SocialPostDraft: { exists: async () => null },
    getSocialManagerSettings: async () => settings(),
  };
  await assert.rejects(
    () => replaceWeeklyPlanSlot(plan._id, 1, candidates[4].candidateId, { actor: { id: "admin-1" }, dependencies }),
    (error) => error.code === "social_weekly_slot_locked" && error.statusCode === 409,
  );

  plan.status = "NEEDS_REVIEW";
  await assert.rejects(
    () => replaceWeeklyPlanSlot(plan._id, 1, candidates[1].candidateId, { actor: { id: "admin-1" }, dependencies }),
    (error) => error.code === "social_weekly_replacement_candidate_in_use" && error.statusCode === 409,
  );

  selected[0].generation_run_id = "generation-run-existing";
  await assert.rejects(
    () => replaceWeeklyPlanSlot(plan._id, 1, candidates[4].candidateId, { actor: { id: "admin-1" }, dependencies }),
    (error) => error.code === "social_weekly_slot_has_production" && error.statusCode === 409,
  );

  selected[0].generation_run_id = null;
  dependencies.SocialGenerationRun.exists = async () => ({ _id: "persisted-run" });
  await assert.rejects(
    () => replaceWeeklyPlanSlot(plan._id, 1, candidates[4].candidateId, { actor: { id: "admin-1" }, dependencies }),
    (error) => error.code === "social_weekly_slot_has_production" && error.statusCode === 409,
  );
});

test("weekly approval transaction rolls back all twelve feed and Story queues when any creative cannot queue", async () => {
  const allCandidates = Array.from({ length: 8 }, (_, index) => candidate(index, { format: "SINGLE_IMAGE" }));
  const selectedCandidates = allCandidates.slice(0, 5);
  const feedSchedules = [
    "2026-08-24T05:30:00.000Z",
    "2026-08-25T12:30:00.000Z",
    "2026-08-26T05:30:00.000Z",
    "2026-08-27T12:30:00.000Z",
    "2026-08-28T05:30:00.000Z",
  ];
  const plan = {
    _id: "weekly-plan-rollback",
    status: "NEEDS_REVIEW",
    version: 5,
    approved_at: null,
    approved_by_admin_id: null,
    week_start: "2026-08-24",
    week_end: "2026-08-30",
    candidates: allCandidates,
    selected_posts: selectedCandidates.map((item, index) => ({
      candidateId: item.candidateId,
      candidate: item,
      slotNumber: index + 1,
      scheduledFor: new Date(feedSchedules[index]),
      status: "PLANNED",
      generation_run_id: null,
    })),
    story_plan: [],
    async save() { return this; },
  };
  plan.story_plan = growthPrivate.buildWeeklyStoryPlan({ plan, selectedPosts: plan.selected_posts, candidates: allCandidates });
  const initialPlan = JSON.parse(JSON.stringify(plan));
  const queuedRuns = [];
  const audits = [];
  const session = {
    async withTransaction(work) {
      try {
        await work();
      } catch (error) {
        plan.status = initialPlan.status;
        plan.approved_at = initialPlan.approved_at;
        plan.approved_by_admin_id = initialPlan.approved_by_admin_id;
        plan.selected_posts = initialPlan.selected_posts;
        plan.story_plan = initialPlan.story_plan;
        queuedRuns.splice(0);
        audits.splice(0);
        throw error;
      }
    },
    async endSession() {},
  };
  let queueAttempt = 0;
  const dependencies = {
    startSession: async () => session,
    SocialWeeklyPlan: { findById: async () => plan },
    SocialGenerationRun: { findById: async () => null },
    SocialAuditLog: {
      async create(records) {
        const record = Array.isArray(records) ? records[0] : records;
        audits.push(record);
        return Array.isArray(records) ? [record] : record;
      },
    },
    getSocialManagerSettings: async () => settings({ generation: { default_visual_mode: "AI_VISUAL_WITH_EXACT_OVERLAY" } }),
    requestGeneration: async (input) => {
      queueAttempt += 1;
      assert.ok(input.dependencies.mongoSession);
      if (queueAttempt === 7) throw new Error("simulated Story queue failure after all five feeds and one Story");
      const run = {
        _id: `run-${input.weeklyContext.candidateId}`,
        status: "PENDING",
        weekly_plan_id: plan._id,
        weekly_candidate_id: input.weeklyContext.candidateId,
      };
      queuedRuns.push(run);
      return { run, reused: false };
    },
  };

  await assert.rejects(
    () => approveWeeklyPlan(plan._id, { actor: { _id: "admin-1" }, dependencies }),
    /simulated Story queue failure/,
  );
  assert.equal(plan.status, "NEEDS_REVIEW");
  assert.equal(plan.approved_at, null);
  assert.equal(plan.approved_by_admin_id, null);
  assert.ok(plan.selected_posts.every((selected) => selected.status === "PLANNED" && !selected.generation_run_id));
  assert.ok(plan.story_plan.every((story) => story.status === "PLANNED" && !story.generation_run_id));
  assert.equal(queuedRuns.length, 0);
  assert.equal(audits.length, 0);
});

test("pre-publication failures stay visible as failed plan items and durable admin actions", async () => {
  const selectedCandidate = candidate(0);
  const selected = {
    candidateId: selectedCandidate.candidateId,
    candidate: selectedCandidate,
    scheduledFor: "2026-08-25T05:30:00.000Z",
    generation_run_id: null,
    status: "PLANNED",
  };
  const plan = {
    _id: "507f1f77bcf86cd799439021",
    status: "APPROVED",
    version: 2,
    candidates: [selectedCandidate],
    selected_posts: [selected],
    async save() { return this; },
  };
  const actions = [];
  const audits = [];
  let generationCalls = 0;
  const dependencies = {
    SocialWeeklyPlan: {
      find: () => ({ limit: async () => [plan] }),
      findById: async () => plan,
    },
    SocialGenerationRun: { findById: async () => null },
    SocialManualAction: {
      findOneAndUpdate: async (_query, update) => {
        const action = { _id: "507f1f77bcf86cd799439022", ...update.$setOnInsert };
        actions.push(action);
        return action;
      },
    },
    SocialAuditLog: { create: async (record) => { audits.push(record); return record; } },
    requestGeneration: async () => {
      generationCalls += 1;
      const error = new Error("OpenAI creative provider is unavailable");
      error.code = "social_ai_not_configured";
      throw error;
    },
  };

  const first = await runDueWeeklyPrepublication({
    now: new Date("2026-08-24T05:30:00.000Z"),
    lookaheadHours: 24,
    dependencies,
  });
  assert.equal(first.queued, 0);
  assert.equal(first.failures.length, 1);
  assert.equal(first.failures[0].manual_action_id, "507f1f77bcf86cd799439022");
  assert.equal(selected.status, "FAILED");
  assert.equal(actions.length, 1);
  assert.equal(actions[0].action_type, "CONTENT_ESCALATION");
  assert.match(actions[0].description, /OpenAI creative provider is unavailable/);
  assert.ok(audits.some((audit) => audit.action === "WEEKLY_POST_PRODUCTION_FAILED" && audit.action_status === "FAILED"));

  const second = await runDueWeeklyPrepublication({
    now: new Date("2026-08-24T05:31:00.000Z"),
    lookaheadHours: 24,
    dependencies,
  });
  assert.equal(second.failures.length, 0);
  assert.equal(generationCalls, 1);
});

test("community replies cannot be sent until an administrator approves the recommendation", async () => {
  const item = {
    _id: "community-item-1",
    source_type: "COMMENT",
    external_object_id: "instagram-comment-1",
    status: "NEEDS_REVIEW",
    recommendation: {
      suggestedReply: "Thanks for asking. This is educational information, not personalised financial advice.",
      sendAllowedAfterApproval: true,
    },
    async save() { return this; },
  };
  let providerCalls = 0;
  const dependencies = {
    SocialCommunityItem: { findById: async () => item },
    SocialAuditLog: auditModel(),
    instagramGrowthService: {
      async replyToComment({ commentId, message }) {
        providerCalls += 1;
        assert.equal(commentId, item.external_object_id);
        assert.equal(message, item.recommendation.suggestedReply);
        return { id: "instagram-reply-1" };
      },
    },
  };

  await assert.rejects(
    () => sendApprovedCommunityReply(item._id, { actor: { id: "admin-1" }, dependencies }),
    (error) => error.statusCode === 409 && /human approval/i.test(error.message),
  );
  assert.equal(providerCalls, 0);

  await approveCommunityReply(item._id, { actor: { id: "admin-1" }, dependencies });
  assert.equal(item.status, "APPROVED");
  assert.equal(item.approval.status, "APPROVED");
  assert.equal(providerCalls, 0);

  await sendApprovedCommunityReply(item._id, { actor: { id: "admin-1" }, dependencies });
  assert.equal(providerCalls, 1);
  assert.equal(item.status, "SENT");
  assert.equal(item.send_result.external_reply_id, "instagram-reply-1");
});

test("legacy community delivery does not treat a recipient identifier as a confirmed message", async () => {
  const approvedReply = "Thanks for writing. You can find the verified resource on Pink Paisa.";
  const item = {
    _id: "community-recipient-only",
    source_type: "DIRECT_MESSAGE",
    external_object_id: "instagram-message-1",
    author_external_id: "instagram-recipient-1",
    status: "APPROVED",
    recommendation: { suggestedReply: approvedReply, sendAllowedAfterApproval: true },
    escalation: { required: false },
    approval: {
      status: "APPROVED",
      approved_by_admin_id: "admin-1",
      approved_at: new Date(),
      approved_reply: approvedReply,
    },
    async save() { return this; },
  };
  let auditCalls = 0;
  await assert.rejects(
    () => sendApprovedCommunityReply(item._id, {
      actor: { id: "admin-1" },
      dependencies: {
        SocialCommunityItem: { findById: async () => item },
        SocialAuditLog: { create: async () => { auditCalls += 1; } },
        instagramGrowthService: {
          async sendMessage() { return { recipient_id: item.author_external_id }; },
        },
      },
    }),
    (error) => error.code === "instagram_reply_outcome_unconfirmed",
  );
  assert.equal(item.status, "APPROVED");
  assert.equal(item.send_result, undefined);
  assert.equal(auditCalls, 0);
});

test("aggregate analytics snapshots preserve unavailable metrics as missing rather than zero", async () => {
  const persistedSnapshots = [];
  let analysisInput = null;
  const SnapshotModel = {
    async findOneAndUpdate(query, update) {
      assert.equal(query.snapshot_key, update.$setOnInsert.snapshot_key);
      persistedSnapshots.push(update.$setOnInsert);
      return update.$setOnInsert;
    },
  };
  const dependencies = {
    SocialGrowthSnapshot: SnapshotModel,
    SocialWeeklyPlan: { findOne: () => ({ sort: async () => null }) },
    getSocialManagerSettings: async () => settings(),
    buildSocialManagerRuntimeSettings: (value) => value,
    collectGa4Aggregate: async () => ({
      status: "COMPLETE",
      data: { metrics: { sessions: 17 }, dimensions: [] },
    }),
    collectSearchConsoleAggregate: async () => ({
      status: "NOT_CONFIGURED",
      message: "Search Console is not configured",
    }),
    callStructuredResponse: async ({ input }) => {
      analysisInput = input;
      return {
        provider: "openai",
        model: "test-model",
        prompt_version: "growth-analytics-test-v1",
        response_id: "response-1",
        attempt_count: 1,
        input_fingerprint: "a".repeat(64),
        output_fingerprint: "b".repeat(64),
        output: {
          periodStart: "2026-08-01",
          periodEnd: "2026-08-22",
          campaignObjectiveAssessments: [],
          whatWorked: [],
          whatDidNot: [],
          remainsUncertain: ["Engagement metrics were unavailable from this aggregate snapshot."],
          testsNext: ["Collect another comparable aggregate window."],
          doNotRepeat: [],
          nextPlanInfluences: ["Do not infer engagement performance from missing fields."],
          correlationWarning: "Observed associations do not establish causation.",
          conciseRationale: "Only supplied aggregate metrics were interpreted.",
        },
      };
    },
    ensurePromptVersions: async ({ promptRuns }) => promptRuns.map((promptRun) => ({
      promptRun,
      document: { _id: "prompt-version-growth-1" },
    })),
  };

  const result = await refreshGrowthAnalytics({
    now: new Date("2026-08-23T10:00:00.000Z"),
    startDate: "2026-08-01",
    endDate: "2026-08-22",
    dependencies,
  });

  assert.equal(persistedSnapshots.length, 1);
  assert.deepEqual(persistedSnapshots[0].metrics, { sessions: 17 });
  assert.equal(Object.hasOwn(persistedSnapshots[0].metrics, "engagedSessions"), false);
  assert.equal(Object.hasOwn(persistedSnapshots[0].metrics, "conversions"), false);
  assert.deepEqual(analysisInput.aggregateSnapshots[0].metrics, { sessions: 17 });
  assert.equal(result.connections.find((row) => row.provider === "SEARCH_CONSOLE").status, "NOT_CONFIGURED");
});

test("GA4 refresh persists a per-post join only for provider-confirmed tracked-URL delivery", async () => {
  const persisted = [];
  const ga4Calls = [];
  const SnapshotModel = {
    async findOneAndUpdate(_query, update) {
      const value = update.$setOnInsert;
      persisted.push(value);
      return value;
    },
  };
  const draft = {
    _id: "draft-attributed-1",
    publication_id: "publication-attributed-1",
    current_package: {
      primaryRecommendation: {
        utmParameters: { source: "instagram", medium: "organic_social", campaign: "money-basics", content: "primary-buffer" },
      },
    },
  };
  const unverifiedFeedDraft = {
    _id: "draft-unverified-feed",
    publication_id: "publication-unverified-feed",
    current_package: draft.current_package,
  };
  const dependencies = {
    SocialGrowthSnapshot: SnapshotModel,
    SocialPostDraft: {
      find: () => ({ select: () => ({ limit: () => ({ lean: async () => [draft, unverifiedFeedDraft] }) }) }),
    },
    SocialPublication: {
      find: () => ({ select: () => ({ lean: async () => [{
        _id: draft.publication_id,
        draft_id: draft._id,
        status: "PUBLISHED",
        content_type: "STORY",
        tracked_url_delivery: {
          verified: true,
          method: "STORY_LINK_STICKER",
          target_url: "https://pinkpaisa.in/quiz?utm_campaign=money-basics&utm_content=primary-buffer",
          provider_reference_id: "meta-story-link-123",
          verified_at: new Date("2026-08-22T09:00:00.000Z"),
        },
      }, {
        _id: unverifiedFeedDraft.publication_id,
        draft_id: unverifiedFeedDraft._id,
        status: "PUBLISHED",
        content_type: "CAROUSEL",
        tracked_url_delivery: null,
      }] }) }),
    },
    SocialWeeklyPlan: { findOne: () => ({ sort: async () => null }) },
    getSocialManagerSettings: async () => settings(),
    buildSocialManagerRuntimeSettings: (value) => value,
    collectGa4Aggregate: async (input) => {
      ga4Calls.push(input);
      if (input.dimensions.includes("eventName")) {
        return {
          rows: [{
            dimensions: {
              date: "20260822",
              eventName: "quiz_start",
              sessionCampaignName: "money-basics",
              sessionManualAdContent: "primary-buffer",
              landingPagePlusQueryString: "/quiz?utm_source=instagram",
            },
            metrics: { eventCount: 3, keyEvents: 1 },
          }],
          totals: [{ dimensions: {}, metrics: { eventCount: 3, keyEvents: 1 } }],
        };
      }
      return {
        rows: [{
          dimensions: {
            date: "20260822",
            sessionSource: "instagram",
            sessionMedium: "organic_social",
            sessionCampaignName: "money-basics",
            sessionManualAdContent: "primary-buffer",
            landingPagePlusQueryString: "/quiz?utm_source=instagram",
          },
          metrics: { sessions: 12, engagedSessions: 9, activeUsers: 10, returningUsers: 4 },
        }],
        totals: [{ dimensions: {}, metrics: { sessions: 12, engagedSessions: 9, activeUsers: 10, returningUsers: 4 } }],
      };
    },
    collectSearchConsoleAggregate: async () => ({ status: "NOT_CONFIGURED" }),
    callStructuredResponse: async () => ({
      provider: "openai",
      model: "test-model",
      prompt_version: "growth-analytics-test-v1",
      output: {
        periodStart: "2026-08-01", periodEnd: "2026-08-22", campaignObjectiveAssessments: [], whatWorked: [], whatDidNot: [],
        remainsUncertain: [], testsNext: [], doNotRepeat: [], nextPlanInfluences: [],
        correlationWarning: "Correlation is not causation.", conciseRationale: "Aggregate-only test.",
      },
    }),
    ensurePromptVersions: async ({ promptRuns }) => promptRuns.map((promptRun) => ({ promptRun, document: { _id: "prompt-growth" } })),
  };

  const result = await refreshGrowthAnalytics({
    now: new Date("2026-08-23T10:00:00.000Z"),
    startDate: "2026-08-01",
    endDate: "2026-08-22",
    dependencies,
  });

  assert.equal(ga4Calls.length, 2);
  assert.deepEqual(ga4Calls[0].dimensions, [
    "date", "sessionSource", "sessionMedium", "sessionCampaignName", "sessionManualAdContent", "landingPagePlusQueryString",
  ]);
  assert.equal(ga4Calls[0].dimensionFilter.andGroup.expressions[0].filter.stringFilter.value, "instagram");
  assert.equal(ga4Calls[0].dimensionFilter.andGroup.expressions[1].filter.stringFilter.value, "organic_social");
  const ga4 = persisted.find((row) => row.provider === "GA4");
  const joins = persisted.filter((row) => row.provider === "ATTRIBUTION_JOIN");
  const joined = joins[0];
  assert.equal(ga4.metrics.website_sessions, 12);
  assert.equal(ga4.metrics.quiz_starts, 3);
  assert.equal(joined.draft_id, draft._id);
  assert.equal(joins.length, 1);
  assert.equal(persisted.some((row) => row.draft_id === unverifiedFeedDraft._id), false);
  assert.equal(joined.dimensions.tracked_url_delivery.method, "STORY_LINK_STICKER");
  assert.deepEqual(joined.metrics, {
    website_sessions: 12,
    engaged_sessions: 9,
    active_users: 10,
    returning_visitors: 4,
    event_count: 3,
    conversion_events: 1,
    quiz_starts: 3,
  });
  assert.equal(result.connections.find((row) => row.provider === "GA4").status, "CONNECTED");
});

test("growth analyst receives aggregate Instagram post metrics and campaign-objective KPI baselines without PII", async () => {
  let analysisInput = null;
  const publications = [
    { draft_id: "draft-baseline", status: "PUBLISHED", published_at: new Date("2026-08-05T08:00:00.000Z"), content_type: "CAROUSEL" },
    { draft_id: "draft-current", status: "PUBLISHED", published_at: new Date("2026-08-20T08:00:00.000Z"), content_type: "CAROUSEL" },
  ];
  const drafts = publications.map((publication, index) => ({
    _id: publication.draft_id,
    publication_id: `publication-${index + 1}`,
    primary_objective: "EDUCATION",
    primary_kpi: "SAVES",
    secondary_kpi: "SHARES",
    primary_format: "CAROUSEL",
    primary_content_pillar: "Money Education",
    customer_email: "must-not-reach-ai@example.com",
    current_package: {
      primaryRecommendation: {
        format: "CAROUSEL",
        objective: "EDUCATION",
        contentPillar: "Money Education",
        utmParameters: { campaign: `education-${index + 1}`, content: `carousel-${index + 1}` },
      },
    },
  }));
  const metricSnapshots = [
    { draft_id: "draft-current", source: "INSTAGRAM_GRAPH", captured_at: new Date("2026-08-22T08:00:00.000Z"), metrics: { reach: 200, saves: 20, shares: 6 }, author_external_id: "must-not-reach-ai" },
    { draft_id: "draft-baseline", source: "INSTAGRAM_GRAPH", captured_at: new Date("2026-08-06T08:00:00.000Z"), metrics: { reach: 100, saves: 10, shares: 2 } },
  ];
  const draftFind = () => ({
    select: () => ({
      limit: () => ({ lean: async () => drafts }),
      lean: async () => drafts,
    }),
  });
  const result = await refreshGrowthAnalytics({
    now: new Date("2026-08-23T10:00:00.000Z"),
    startDate: "2026-08-01",
    endDate: "2026-08-22",
    dependencies: {
      SocialGrowthSnapshot: { findOneAndUpdate: async (_query, update) => update.$setOnInsert },
      SocialPublication: { find: () => ({ sort: () => ({ limit: () => ({ lean: async () => publications }) }) }) },
      SocialPostDraft: { find: draftFind },
      SocialMetricSnapshot: { find: () => ({ sort: () => ({ lean: async () => metricSnapshots }) }) },
      SocialWeeklyPlan: { findOne: () => ({ sort: async () => null }) },
      getSocialManagerSettings: async () => settings(),
      buildSocialManagerRuntimeSettings: (value) => value,
      collectGa4Aggregate: async () => ({ status: "COMPLETE", data: { metrics: { website_sessions: 14 }, dimensions: [] } }),
      collectSearchConsoleAggregate: async () => ({ status: "NOT_CONFIGURED" }),
      callStructuredResponse: async ({ input }) => {
        analysisInput = input;
        return {
          provider: "openai",
          model: "test-growth-analyst",
          prompt_version: "social-growth-analyst-v2",
          output: {
            periodStart: "2026-08-01",
            periodEnd: "2026-08-22",
            campaignObjectiveAssessments: [{
              postReference: "post_2",
              objective: "EDUCATION",
              primaryKpi: "SAVES",
              assessment: "ABOVE_BASELINE",
              evidence: "20 saves versus a same-format baseline of 10.",
            }],
            whatWorked: ["The second education carousel exceeded its save baseline."],
            whatDidNot: [],
            remainsUncertain: ["The sample is small."],
            testsNext: ["Test another saveable education carousel."],
            doNotRepeat: [],
            nextPlanInfluences: ["Retain one save-oriented education post."],
            correlationWarning: "Observed associations do not establish causation.",
            conciseRationale: "Aggregate campaign KPI evidence only.",
          },
        };
      },
      ensurePromptVersions: async ({ promptRuns }) => promptRuns.map((promptRun) => ({ promptRun, document: { _id: "prompt-growth-v2" } })),
    },
  });

  assert.equal(analysisInput.aggregatePostPerformance.length, 2);
  const current = analysisInput.aggregatePostPerformance[1];
  assert.deepEqual(current.instagram_metrics, { reach: 200, saves: 20, shares: 6 });
  assert.equal(current.objective_assessment.assessment, "ABOVE_BASELINE");
  assert.equal(current.objective_assessment.baseline_value, 10);
  assert.equal(result.growth_analysis.analyzed_aggregate_post_count, 2);
  const serialized = JSON.stringify(analysisInput);
  assert.equal(serialized.includes("must-not-reach-ai"), false);
  assert.equal(serialized.includes("customer_email"), false);
  assert.equal(serialized.includes("author_external_id"), false);
});

test("analytics summary joins GA4 UTMs and compares posts with format, pillar, and account medians", async () => {
  const capturedAt = new Date("2026-08-23T09:00:00.000Z");
  const latestGa4 = {
    provider: "GA4",
    captured_at: capturedAt,
    period_start: new Date("2026-08-01T00:00:00.000Z"),
    period_end: new Date("2026-08-22T23:59:59.999Z"),
    metrics: { website_sessions: 5, engaged_sessions: 4, quiz_starts: 2 },
    dimensions: {
      attribution_rows: [{
        campaign: "campaign-current",
        content: "content-current",
        landing_page: "/quiz?utm_source=instagram",
        metrics: { website_sessions: 5, engaged_sessions: 4 },
      }],
      conversion_event_rows: [{
        campaign: "campaign-current",
        content: "content-current",
        landing_page: "/quiz?utm_source=instagram",
        event_name: "quiz_start",
        metrics: { event_count: 2 },
      }],
    },
  };
  const publications = [
    {
      draft_id: "draft-current",
      status: "PUBLISHED",
      published_at: new Date("2026-08-22T08:00:00.000Z"),
      content_type: "CAROUSEL",
      tracked_url_delivery: {
        verified: true,
        method: "STORY_LINK_STICKER",
        target_url: "https://pinkpaisa.in/quiz?utm_campaign=campaign-current&utm_content=content-current",
        provider_reference_id: "meta-story-verified-1",
        verified_at: new Date("2026-08-22T08:00:00.000Z"),
      },
    },
    { draft_id: "draft-mid", status: "PUBLISHED", published_at: new Date("2026-08-03T08:00:00.000Z"), content_type: "CAROUSEL" },
    { draft_id: "draft-old", status: "PUBLISHED", published_at: new Date("2026-07-04T08:00:00.000Z"), content_type: "CAROUSEL" },
  ];
  const recommendation = (topic, utm = null) => ({
    primaryRecommendation: {
      internalTitle: topic,
      topic,
      format: "CAROUSEL",
      contentPillar: "Money Education",
      ...(utm ? { utmParameters: utm } : {}),
    },
  });
  const drafts = [
    { _id: "draft-current", primary_objective: "EDUCATION", primary_kpi: "SAVES", secondary_kpi: "SHARES", current_package: recommendation("Current", { campaign: "campaign-current", content: "content-current" }) },
    { _id: "draft-mid", primary_objective: "EDUCATION", primary_kpi: "SAVES", secondary_kpi: "SHARES", current_package: recommendation("Mid") },
    { _id: "draft-old", primary_objective: "EDUCATION", primary_kpi: "SAVES", secondary_kpi: "SHARES", current_package: recommendation("Old") },
  ];
  const metricSnapshots = [
    { draft_id: "draft-current", captured_at: capturedAt, metrics: { reach: 200, saves: 20 } },
    { draft_id: "draft-mid", captured_at: capturedAt, metrics: { reach: 100, saves: 10 } },
    { draft_id: "draft-old", captured_at: capturedAt, metrics: { reach: 80, saves: 4 } },
  ];
  const chain = (value) => ({ sort: () => ({ limit: () => ({ lean: async () => value }) }) });
  const summary = await getAnalyticsSummary({
    days: 90,
    now: new Date("2026-08-23T10:00:00.000Z"),
    dependencies: {
      SocialGrowthSnapshot: { find: () => chain([latestGa4]) },
      SocialPublication: { find: () => chain(publications) },
      SocialPostDraft: { find: () => ({ select: () => ({ lean: async () => drafts }) }) },
      SocialMetricSnapshot: { find: () => ({ sort: () => ({ lean: async () => metricSnapshots }) }) },
      SocialWeeklyPlan: { findOne: () => ({ sort: () => ({ lean: async () => null }) }) },
      getPerformanceSummary: async () => ({ totals: {}, rates: {} }),
    },
  });

  const current = summary.posts.find((post) => post.id === "draft-current");
  assert.equal(current.attribution.metrics.website_sessions, 5);
  assert.equal(current.attribution.metrics.quiz_starts, 2);
  assert.equal(summary.metrics.website_sessions, 5);
  assert.equal(summary.rates.landing_page_engagement_rate, 0.8);
  const formatSave = current.baseline_comparisons.find((row) => row.metric === "saves" && row.baseline === "SAME_FORMAT_28D_MEDIAN");
  const pillarSave = current.baseline_comparisons.find((row) => row.metric === "saves" && row.baseline === "SAME_PILLAR_90D_MEDIAN");
  assert.equal(formatSave.baseline_value, 10);
  assert.equal(formatSave.delta, 10);
  assert.equal(pillarSave.baseline_value, 7);
  assert.equal(pillarSave.sample_size, 2);
  assert.equal(current.objective_assessment.assessment, "ABOVE_BASELINE");
  assert.equal(current.objective_assessment.primary_kpi, "SAVES");
  assert.equal(summary.campaign_objective_assessments[0].assessment, "ABOVE_BASELINE");
});

test("per-post GA4 attribution requires verified tracked-URL delivery and keeps marketing leads separate from workshop enquiries", () => {
  const rows = [{
    campaign: "campaign-one",
    content: "creative-one",
    landing_page: "/quiz",
    metrics: { website_sessions: 9 },
  }];
  const conversionRows = [{
    campaign: "campaign-one",
    content: "creative-one",
    landing_page: "/quiz",
    event_name: "generate_lead",
    metrics: { event_count: 3 },
  }, {
    campaign: "campaign-one",
    content: "creative-one",
    landing_page: "/workshops",
    event_name: "workshop_enquiry",
    metrics: { event_count: 1 },
  }];
  const utm = { campaign: "campaign-one", content: "creative-one" };
  const unverifiedFeed = growthPrivate.attributionForPublishedDelivery({
    publication: { content_type: "CAROUSEL", tracked_url_delivery: null },
    utm,
    attributionRows: rows,
    conversionRows,
  });
  assert.equal(unverifiedFeed.eligible, false);
  assert.deepEqual(unverifiedFeed.metrics, {});
  assert.match(unverifiedFeed.limitation, /link-in-bio traffic remains aggregate/i);

  const verifiedStoryDelivery = growthPrivate.attributionForPublishedDelivery({
    publication: {
      content_type: "STORY",
      tracked_url_delivery: {
        verified: true,
        method: "STORY_LINK_STICKER",
        target_url: "https://pinkpaisa.in/quiz?utm_campaign=campaign-one&utm_content=creative-one",
        provider_reference_id: "meta-story-123",
        verified_at: new Date("2026-08-23T09:00:00.000Z"),
      },
    },
    utm,
    attributionRows: rows,
    conversionRows,
  });
  assert.equal(verifiedStoryDelivery.eligible, true);
  assert.equal(verifiedStoryDelivery.metrics.website_sessions, 9);
  assert.equal(verifiedStoryDelivery.metrics.marketing_leads, 3);
  assert.equal(verifiedStoryDelivery.metrics.workshop_enquiries, 1);
});

test("internal planning memory includes aggregate Pink Predictions and human rejection reasons without voter identity", () => {
  const prediction = serialisePredictionSnapshot({
    current_batch: {
      status: "live",
      date_key: "2026-08-23",
      generated_at: "2026-08-23T01:00:00.000Z",
      expires_at: "2026-08-24T01:00:00.000Z",
      questions: [{
        id: "prediction-1",
        question: "Will more women automate a savings transfer this month?",
        category: "Money habits",
        yes_count: 14,
        no_count: 6,
        source_type: "ai_daily",
        source_refs: [{ title: "Official aggregate signal", url: "https://www.rbi.org.in/" }],
      }],
      vote_analytics: {
        total_genuine_votes: 20,
        beta_launch_votes: 3,
        organic_votes: 17,
        unique_voting_fingerprints: 19,
      },
    },
  });
  const rejected = serialiseRecentSocialDraft({
    _id: "draft-rejected-1",
    status: "REJECTED",
    rejection_reason: "The hook sounded too alarmist for the Pink Paisa voice.",
    current_package: { primaryRecommendation: { topic: "Emergency funds" } },
  });

  assert.equal(prediction.questions[0].total_votes, 20);
  assert.equal(prediction.aggregate_votes.organic_votes, 17);
  assert.equal(Object.hasOwn(prediction.aggregate_votes, "unique_voting_fingerprints"), false);
  assert.equal(rejected.rejection_reason, "The hook sounded too alarmist for the Pink Paisa voice.");
});

test("signed orchestration rejects expired timestamps and tampered bodies", () => {
  const previousSecret = process.env.N8N_SOCIAL_WEBHOOK_SECRET;
  process.env.N8N_SOCIAL_WEBHOOK_SECRET = "orchestration-test-secret";
  try {
    const currentTimestamp = String(Math.floor(Date.now() / 1000));
    const originalBody = Buffer.from(JSON.stringify({ event: "weekly-plan" }));
    const canonicalPath = "/api/social-media-manager/orchestration/weekly-plan";
    const operation = "WEEKLY_PLAN";
    const idempotencyKey = "orchestration-valid-test";
    const validSignature = buildSocialOrchestrationSignature({
      method: "POST",
      path: canonicalPath,
      operation,
      idempotencyKey,
      timestamp: currentTimestamp,
      rawBody: originalBody,
      secret: process.env.N8N_SOCIAL_WEBHOOK_SECRET,
    });
    assert.match(validSignature, /^v1=sha256=[a-f0-9]{64}$/);

    const tampered = createResponseRecorder();
    let tamperedNextCalls = 0;
    requireSocialOrchestrationSignature({
      method: "POST",
      originalUrl: canonicalPath,
      headers: {
        "x-pink-paisa-timestamp": currentTimestamp,
        "x-pink-paisa-signature": validSignature,
        "x-idempotency-key": idempotencyKey,
      },
      rawBody: Buffer.from(JSON.stringify({ event: "metrics" })),
    }, tampered.response, () => { tamperedNextCalls += 1; });
    assert.equal(tampered.state.statusCode, 401);
    assert.match(tampered.state.body.message, /signature is invalid/i);
    assert.equal(tamperedNextCalls, 0);

    const expiredTimestamp = String(Math.floor(Date.now() / 1000) - 301);
    const expired = createResponseRecorder();
    let expiredNextCalls = 0;
    requireSocialOrchestrationSignature({
      method: "POST",
      originalUrl: canonicalPath,
      headers: {
        "x-pink-paisa-timestamp": expiredTimestamp,
        "x-pink-paisa-signature": buildSocialOrchestrationSignature({
          method: "POST",
          path: canonicalPath,
          operation,
          idempotencyKey: "orchestration-expiry-test",
          timestamp: expiredTimestamp,
          rawBody: originalBody,
          secret: process.env.N8N_SOCIAL_WEBHOOK_SECRET,
        }),
        "x-idempotency-key": "orchestration-expiry-test",
      },
      rawBody: originalBody,
    }, expired.response, () => { expiredNextCalls += 1; });
    assert.equal(expired.state.statusCode, 401);
    assert.match(expired.state.body.message, /timestamp is missing or expired/i);
    assert.equal(expiredNextCalls, 0);

    const accepted = createResponseRecorder();
    const acceptedRequest = {
      method: "POST",
      originalUrl: canonicalPath,
      headers: {
        "x-pink-paisa-timestamp": currentTimestamp,
        "x-pink-paisa-signature": validSignature,
        "x-idempotency-key": idempotencyKey,
      },
      rawBody: originalBody,
    };
    let acceptedNextCalls = 0;
    requireSocialOrchestrationSignature(acceptedRequest, accepted.response, () => { acceptedNextCalls += 1; });
    assert.equal(acceptedNextCalls, 1);
    assert.deepEqual(acceptedRequest.socialOrchestration, {
      deliveryFingerprint: buildSocialOrchestrationDeliveryFingerprint({
        timestamp: currentTimestamp,
        rawBody: originalBody,
        signature: validSignature,
      }),
      idempotencyKey,
      method: "POST",
      operation,
      path: canonicalPath,
      signatureVersion: "v1",
      timestamp: Number(currentTimestamp),
    });

    for (const requestMutation of [
      { idempotencyKey: "orchestration-other-key", method: "POST", originalUrl: canonicalPath },
      { idempotencyKey, method: "POST", originalUrl: "/api/social-media-manager/orchestration/metrics" },
      { idempotencyKey, method: "POST", originalUrl: `${canonicalPath}?unexpected=true` },
      { idempotencyKey, method: "PUT", originalUrl: canonicalPath },
    ]) {
      const rejected = createResponseRecorder();
      let rejectedNextCalls = 0;
      requireSocialOrchestrationSignature({
        method: requestMutation.method,
        originalUrl: requestMutation.originalUrl,
        headers: {
          "x-pink-paisa-timestamp": currentTimestamp,
          "x-pink-paisa-signature": validSignature,
          "x-idempotency-key": requestMutation.idempotencyKey,
        },
        rawBody: originalBody,
      }, rejected.response, () => { rejectedNextCalls += 1; });
      assert.equal(rejected.state.statusCode, 401);
      assert.equal(rejectedNextCalls, 0);
    }

    const legacyEnvelope = createResponseRecorder();
    requireSocialOrchestrationSignature({
      method: "POST",
      originalUrl: canonicalPath,
      headers: {
        "x-pink-paisa-timestamp": currentTimestamp,
        "x-pink-paisa-signature": validSignature.replace(/^v1=/, ""),
        "x-idempotency-key": idempotencyKey,
      },
      rawBody: originalBody,
    }, legacyEnvelope.response, () => assert.fail("legacy signature envelope must not authenticate"));
    assert.equal(legacyEnvelope.state.statusCode, 401);
  } finally {
    if (previousSecret === undefined) delete process.env.N8N_SOCIAL_WEBHOOK_SECRET;
    else process.env.N8N_SOCIAL_WEBHOOK_SECRET = previousSecret;
  }
});
