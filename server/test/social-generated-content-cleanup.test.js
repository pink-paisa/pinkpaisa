const assert = require("node:assert/strict");
const test = require("node:test");

const {
  CONFIRMATION_PHRASE,
  deleteGeneratedContent,
  previewGeneratedContentCleanup,
  _private: cleanupPrivate,
} = require("../services/social/socialGeneratedContentCleanupService");
const { _private: managerPrivate } = require("../services/social/socialManagerService");

function valueAt(row, path) {
  return path.split(".").reduce((value, key) => value?.[key], row);
}

function matches(row, filter = {}) {
  return Object.entries(filter).every(([key, expected]) => {
    const actual = valueAt(row, key);
    if (expected && typeof expected === "object" && "$in" in expected) {
      return expected.$in.map(String).includes(String(actual));
    }
    return String(actual ?? "") === String(expected ?? "");
  });
}

function memoryModel(initialRows = []) {
  const state = { rows: initialRows.map((row) => structuredClone(row)), nextId: 1 };
  return {
    state,
    find(filter = {}) {
      return state.rows.filter((row) => matches(row, filter));
    },
    findOne(filter = {}) {
      return state.rows.find((row) => matches(row, filter)) || null;
    },
    countDocuments(filter = {}) {
      return state.rows.filter((row) => matches(row, filter)).length;
    },
    deleteMany(filter = {}) {
      const before = state.rows.length;
      state.rows = state.rows.filter((row) => !matches(row, filter));
      return { deletedCount: before - state.rows.length };
    },
    create(payload) {
      const row = { _id: payload._id || `created-${state.nextId++}`, created_at: new Date(), ...structuredClone(payload) };
      state.rows.push(row);
      return row;
    },
    insertMany(rows) {
      const inserted = rows.map((payload) => ({ _id: payload._id || `inserted-${state.nextId++}`, ...structuredClone(payload) }));
      state.rows.push(...inserted);
      return inserted;
    },
  };
}

function dependencies(overrides = {}) {
  const files = new Set([
    "uploads/generated/campaigns/final.png",
    "uploads/generated/campaigns/original.png",
    "uploads/generated/campaigns/retry.png",
    "uploads/generated/campaigns/marketing.png",
  ]);
  const removed = [];
  const deps = {
    tokenSecret: "cleanup-test-secret",
    SocialPostDraft: memoryModel([{ _id: "draft-1", generation_run_id: "run-1", weekly_plan_id: "plan-1", status: "NEEDS_REVIEW" }]),
    SocialAsset: memoryModel([{
      _id: "asset-1",
      draft_id: "draft-1",
      generation_run_id: "run-1",
      storage_provider: "local",
      storage_key: "uploads/generated/campaigns/final.png",
      file_size_bytes: 100,
      original_visual: {
        storage_key: "uploads/generated/campaigns/original.png",
        file_size_bytes: 200,
      },
    }]),
    SocialGenerationRun: memoryModel([{
      _id: "run-1",
      generation_date: "2026-08-26",
      status: "SUCCEEDED",
      weekly_plan_id: "plan-1",
      selected_draft_id: "draft-1",
      created_at: new Date("2026-08-26T03:00:00.000Z"),
      usage: { estimated_cost: 1.25, total_tokens: 100, cost_currency: "USD" },
      image_generation_attempts: [{ original_storage_key: "uploads/generated/campaigns/retry.png" }],
    }]),
    SocialGenerationUsageLedger: memoryModel([]),
    SocialWeeklyPlan: memoryModel([{
      _id: "plan-1",
      selected_posts: [{ draft_id: "draft-1", generation_run_id: "run-1" }],
      research_source_ids: ["source-1"],
    }]),
    SocialPublication: memoryModel([]),
    SocialResearchSource: memoryModel([{ _id: "source-1", draft_id: "draft-1", generation_run_id: "run-1", weekly_plan_id: null }]),
    SocialManualAction: memoryModel([{ _id: "action-1", draft_id: "draft-1", generation_run_id: "run-1", weekly_plan_id: "plan-1" }]),
    SocialAuditLog: memoryModel([]),
    MarketingAsset: memoryModel([{
      _id: "marketing-1",
      storage_key: "uploads/generated/campaigns/marketing.png",
      storage_provider: "local",
    }]),
    getGeneratedCampaignAssetReference(value) {
      const storageKey = String(value || "").replace(/^https?:\/\/[^/]+\//, "").replace(/^\//, "");
      if (!storageKey.startsWith("uploads/generated/campaigns/")) return null;
      return { storageKey, filePath: `C:/safe/${storageKey.split("/").pop()}` };
    },
    async accessFile(filePath) {
      const storageKey = `uploads/generated/campaigns/${filePath.split("/").pop()}`;
      if (!files.has(storageKey)) {
        const error = new Error("missing");
        error.code = "ENOENT";
        throw error;
      }
    },
    async deleteCampaignAsset(asset) {
      files.delete(asset.storage_key);
      removed.push(asset.storage_key);
      return true;
    },
    _files: files,
    _removed: removed,
  };
  return Object.assign(deps, overrides);
}

test("cleanup preview counts only unpublished Social Manager content and exact unshared files", async () => {
  const deps = dependencies();
  const preview = await previewGeneratedContentCleanup({
    now: new Date("2026-08-26T04:00:00.000Z"),
    dependencies: deps,
  });

  assert.deepEqual(preview.counts, {
    drafts: 1,
    assets: 1,
    generation_runs: 1,
    weekly_plans: 1,
    research_sources: 1,
    manual_actions: 1,
  });
  assert.equal(preview.total_count, 6);
  assert.equal(preview.local_files.count, 3);
  assert.equal(preview.local_files.bytes, 300);
  assert.equal(preview.blockers.length, 0);
  assert.ok(preview.exclusions.some((item) => item.includes("monthly budget")));
  assert.ok(preview.purge_token);
});

test("cleanup requires exact confirmation and refuses active generation", async () => {
  const deps = dependencies();
  const now = new Date("2026-08-26T04:00:00.000Z");
  const preview = await previewGeneratedContentCleanup({ now, dependencies: deps });
  await assert.rejects(
    deleteGeneratedContent({ confirmation: "delete all generated content", purgeToken: preview.purge_token, now, dependencies: deps }),
    (error) => error.code === "social_generated_content_confirmation_invalid",
  );

  deps.SocialGenerationRun.state.rows[0].status = "RUNNING";
  const blockedPreview = await previewGeneratedContentCleanup({ now, dependencies: deps });
  assert.equal(blockedPreview.blockers[0].code, "generation_in_progress");
  await assert.rejects(
    deleteGeneratedContent({ confirmation: CONFIRMATION_PHRASE, purgeToken: blockedPreview.purge_token, now, dependencies: deps }),
    (error) => error.code === "social_generated_content_cleanup_blocked",
  );
  assert.equal(deps.SocialPostDraft.state.rows.length, 1);
});

test("cleanup refuses weekly planning work and any scheduled draft", async () => {
  const now = new Date("2026-08-26T04:00:00.000Z");
  for (const status of ["QUEUED", "RESEARCHING", "PLANNING"]) {
    const statusDeps = dependencies();
    statusDeps.SocialWeeklyPlan.state.rows[0].status = status;
    const statusPreview = await previewGeneratedContentCleanup({ now, dependencies: statusDeps });
    assert.equal(statusPreview.blockers.find((blocker) => blocker.code === "weekly_plan_in_progress")?.count, 1, status);
  }

  const activePlanDeps = dependencies();
  activePlanDeps.SocialWeeklyPlan.state.rows[0].status = "RESEARCHING";
  const activePlanPreview = await previewGeneratedContentCleanup({ now, dependencies: activePlanDeps });
  assert.equal(activePlanPreview.blockers.find((blocker) => blocker.code === "weekly_plan_in_progress")?.count, 1);
  await assert.rejects(
    deleteGeneratedContent({
      confirmation: CONFIRMATION_PHRASE,
      purgeToken: activePlanPreview.purge_token,
      now,
      dependencies: activePlanDeps,
    }),
    (error) => error.code === "social_generated_content_cleanup_blocked",
  );
  assert.equal(activePlanDeps.SocialWeeklyPlan.state.rows.length, 1);

  const scheduledDraftDeps = dependencies();
  scheduledDraftDeps.SocialPostDraft.state.rows[0].status = "SCHEDULED";
  scheduledDraftDeps.SocialPostDraft.state.rows[0].scheduled_for = new Date("2026-08-26T04:00:00.000Z");
  const scheduledDraftPreview = await previewGeneratedContentCleanup({ now, dependencies: scheduledDraftDeps });
  assert.equal(scheduledDraftPreview.blockers.find((blocker) => blocker.code === "draft_scheduled")?.count, 1);
  await assert.rejects(
    deleteGeneratedContent({
      confirmation: CONFIRMATION_PHRASE,
      purgeToken: scheduledDraftPreview.purge_token,
      now,
      dependencies: scheduledDraftDeps,
    }),
    (error) => error.code === "social_generated_content_cleanup_blocked",
  );
  assert.equal(scheduledDraftDeps.SocialPostDraft.state.rows.length, 1);
});

test("cleanup deletes the reviewed unpublished graph, retains cost usage and removes only guarded files", async () => {
  const deps = dependencies();
  const now = new Date("2026-08-26T04:00:00.000Z");
  const preview = await previewGeneratedContentCleanup({ now, dependencies: deps });
  const result = await deleteGeneratedContent({
    confirmation: CONFIRMATION_PHRASE,
    purgeToken: preview.purge_token,
    actor: { _id: "admin-1" },
    requestKey: "cleanup-request-1",
    now,
    dependencies: deps,
  });

  assert.equal(result.total_deleted, 6);
  assert.equal(result.usage_ledgers_created, 1);
  assert.deepEqual(result.file_cleanup, { requested: 3, deleted: 3, missing: 0, failed: 0, failures: [] });
  for (const key of ["SocialPostDraft", "SocialAsset", "SocialGenerationRun", "SocialWeeklyPlan", "SocialResearchSource", "SocialManualAction"]) {
    assert.equal(deps[key].state.rows.length, 0, key);
  }
  assert.equal(deps.SocialGenerationUsageLedger.state.rows.length, 1);
  assert.equal(deps.SocialGenerationUsageLedger.state.rows[0].usage.estimated_cost, 1.25);
  assert.equal(deps.SocialGenerationUsageLedger.state.rows[0].cost_breakdown.method, "CONSERVATIVE_EVIDENCE_V1");
  assert.equal(deps.SocialGenerationUsageLedger.state.rows[0].cost_breakdown.total_estimated_cost, 1.25);
  assert.equal(deps.SocialAuditLog.state.rows.filter((row) => row.action === "GENERATED_CONTENT_DELETED").length, 1);
  assert.equal(deps._files.has("uploads/generated/campaigns/marketing.png"), true);
  assert.equal(deps._removed.includes("uploads/generated/campaigns/marketing.png"), false);
});

test("idempotent replay retries a failed immutable file cleanup from retained targets", async () => {
  const deps = dependencies();
  const originalDeleteCampaignAsset = deps.deleteCampaignAsset;
  let failRetryFileOnce = true;
  deps.deleteCampaignAsset = async (asset) => {
    if (asset.storage_key === "uploads/generated/campaigns/retry.png" && failRetryFileOnce) {
      failRetryFileOnce = false;
      throw new Error("transient file lock");
    }
    return originalDeleteCampaignAsset(asset);
  };
  const now = new Date("2026-08-26T04:00:00.000Z");
  const preview = await previewGeneratedContentCleanup({ now, dependencies: deps });
  const first = await deleteGeneratedContent({
    confirmation: CONFIRMATION_PHRASE,
    purgeToken: preview.purge_token,
    actor: { _id: "admin-1" },
    requestKey: "cleanup-file-retry-request",
    now,
    dependencies: deps,
  });
  assert.equal(first.file_cleanup.failed, 1);
  assert.equal(first.usage_ledgers_created, 1);
  assert.equal(deps.SocialAuditLog.state.rows.filter((row) => row.action === "GENERATED_CONTENT_FILES_CLEANED").length, 1);
  assert.equal(deps.SocialAuditLog.state.rows.find((row) => row.action === "GENERATED_CONTENT_FILES_CLEANED").action_status, "FAILED");

  deps._files.add("uploads/generated/campaigns/created-after-cleanup.png");
  const retried = await deleteGeneratedContent({
    confirmation: CONFIRMATION_PHRASE,
    purgeToken: preview.purge_token,
    actor: { _id: "admin-1" },
    requestKey: "cleanup-file-retry-request",
    now: new Date("2026-08-26T04:01:00.000Z"),
    dependencies: deps,
  });
  assert.equal(retried.reused, true);
  assert.equal(retried.usage_ledgers_created, 1);
  assert.deepEqual(retried.file_cleanup, { requested: 3, deleted: 1, missing: 2, failed: 0, failures: [] });
  assert.equal(deps._files.has("uploads/generated/campaigns/created-after-cleanup.png"), true);
  const fileAudits = deps.SocialAuditLog.state.rows.filter((row) => row.action === "GENERATED_CONTENT_FILES_CLEANED");
  assert.equal(fileAudits.length, 2);
  assert.equal(fileAudits[0].action_status, "FAILED");
  assert.equal(fileAudits[1].action_status, "SUCCEEDED");
  assert.match(fileAudits[1].idempotency_key, /:files:retry:1$/);

  const successfulReplay = await deleteGeneratedContent({
    confirmation: CONFIRMATION_PHRASE,
    purgeToken: preview.purge_token,
    requestKey: "cleanup-file-retry-request",
    now: new Date("2026-08-26T04:02:00.000Z"),
    dependencies: deps,
  });
  assert.equal(successfulReplay.reused, true);
  assert.equal(successfulReplay.usage_ledgers_created, 1);
  assert.equal(deps.SocialAuditLog.state.rows.filter((row) => row.action === "GENERATED_CONTENT_FILES_CLEANED").length, 2);
});

test("a publication preserves its complete weekly graph and media", async () => {
  const deps = dependencies();
  deps.SocialPublication.state.rows.push({
    _id: "publication-1",
    status: "PUBLISHED",
    draft_id: "draft-1",
    generation_run_id: "run-1",
    asset_ids: ["asset-1"],
    asset_urls: ["/uploads/generated/campaigns/final.png"],
  });
  const preview = await previewGeneratedContentCleanup({
    now: new Date("2026-08-26T04:00:00.000Z"),
    dependencies: deps,
  });
  assert.equal(preview.total_count, 0);
  assert.equal(preview.local_files.count, 0);
  assert.equal(preview.preserved.publications, 1);
  assert.equal(preview.preserved.drafts, 1);
  assert.equal(preview.preserved.assets, 1);
  assert.equal(preview.preserved.generation_runs, 1);
  assert.equal(preview.preserved.weekly_plans, 1);
});

test("retained usage conservatively counts failed image attempts and visual regenerations once", () => {
  const run = {
    _id: "run-cost-evidence",
    completed_at: new Date("2026-08-26T03:20:00.000Z"),
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      total_tokens: 150,
      estimated_cost: 1.25,
      cost_currency: "USD",
    },
    stage_executions: [{
      input_tokens: 100,
      output_tokens: 50,
      total_tokens: 150,
      estimated_cost: 1,
    }],
    image_generation_attempts: [
      { asset_index: 0, attempt_number: 1, status: "FAILED", usage: {} },
      { asset_index: 0, attempt_number: 2, status: "VALIDATED", usage: { input_tokens: 8, total_tokens: 8 } },
    ],
  };
  const initialAsset = {
    _id: "initial-original",
    generation_run_id: run._id,
    asset_group_id: "initial-group",
    asset_role: "ORIGINAL_AI_VISUAL",
    provider_response_id: "image-initial",
    checksum_sha256: "a".repeat(64),
    image_retry_number: 1,
    image_usage: { input_tokens: 8, total_tokens: 8 },
    image_estimated_cost: 0.25,
    created_at: new Date("2026-08-26T03:10:00.000Z"),
  };
  const regeneratedAsset = {
    _id: "regenerated-original",
    generation_run_id: run._id,
    asset_group_id: "regenerated-original-group",
    asset_role: "ORIGINAL_AI_VISUAL",
    provider_response_id: "image-regenerated",
    checksum_sha256: "b".repeat(64),
    image_retry_number: 0,
    image_usage: { input_tokens: 6, total_tokens: 6 },
    image_estimated_cost: 0.3,
    created_at: new Date("2026-08-26T04:00:00.000Z"),
  };
  const duplicatedRegenerationEvidence = {
    ...regeneratedAsset,
    _id: "regenerated-original-duplicate",
    asset_group_id: "duplicate-storage-row",
  };
  const regenerationAudit = {
    _id: "audit-regeneration-1",
    generation_run_id: run._id,
    action: "AI_IMAGE_REGENERATED",
    action_status: "SUCCEEDED",
    metadata: { image_cost: 0.3 },
  };

  const retained = cleanupPrivate.conservativeUsageForRun(run, {
    assets: [initialAsset, regeneratedAsset, duplicatedRegenerationEvidence],
    audits: [regenerationAudit, structuredClone(regenerationAudit)],
    dependencies: { imageUnitCostUsd: 0.25 },
  });

  assert.equal(retained.cost_breakdown.image_attempt_count, 2);
  assert.equal(retained.cost_breakdown.failed_image_attempt_count, 1);
  assert.equal(retained.cost_breakdown.image_attempt_estimated_cost, 0.5);
  assert.equal(retained.cost_breakdown.base_generation_cost, 1.5);
  assert.equal(retained.cost_breakdown.visual_regeneration_audit_cost, 0.3);
  assert.equal(retained.cost_breakdown.visual_regeneration_asset_cost, 0.3);
  assert.equal(retained.cost_breakdown.visual_regeneration_cost, 0.3);
  assert.equal(retained.cost_breakdown.visual_regeneration_event_count, 1);
  assert.equal(retained.cost_breakdown.visual_regeneration_asset_group_count, 1);
  assert.equal(retained.usage.estimated_cost, 1.8);
});

test("terminal image failures retain a conservative estimate even when run usage is zero", () => {
  const retained = cleanupPrivate.conservativeUsageForRun({
    _id: "run-terminal-image-failure",
    usage: { estimated_cost: 0, cost_currency: "USD" },
    last_error: {
      details: {
        image_generation: {
          failures: [
            { attempt: 1, code: "social_image_validation_failed" },
            { attempt: 2, code: "social_image_validation_failed" },
          ],
        },
      },
    },
  }, { dependencies: { imageUnitCostUsd: 0.04 } });

  assert.equal(retained.cost_breakdown.image_attempt_count, 2);
  assert.equal(retained.cost_breakdown.failed_image_attempt_count, 2);
  assert.equal(retained.cost_breakdown.image_attempt_estimated_cost, 0.08);
  assert.equal(retained.cost_breakdown.total_estimated_cost, 0.08);
  assert.equal(retained.usage.estimated_cost, 0.08);
});

test("monthly budget enforcement includes the retained append-only usage ledger", async () => {
  await assert.rejects(
    managerPrivate.enforceMonthlyBudget({
      settings: { cost_controls: { monthly_budget_inr: 100 } },
      now: new Date("2026-08-26T04:00:00.000Z"),
      models: {
        SocialGenerationRun: { aggregate: async () => [{ usd: 0.25 }] },
        SocialGenerationUsageLedger: { aggregate: async () => [{ usd: 1 }] },
      },
    }),
    (error) => error.code === "social_monthly_budget_limit",
  );
});
