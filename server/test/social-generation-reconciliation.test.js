const test = require("node:test");
const assert = require("node:assert/strict");

const {
  processPendingSocialGenerationRuns,
  _private: {
    authoritativeCompletedGenerationDraft,
    authoritativeNativeSwapDraft,
    authoritativePaidMutationDraft,
    commitGenerationRunSuccess,
    duplicateCommitSucceeded,
    failStaleDuplicatePlaceholder,
    failStalePaidGenerationRun,
    generationRunLeaseExpired,
    reconcileCommittedGenerationDraft,
    reconcileSucceededGenerationAudit,
    reconcileSucceededWeeklyRunLink,
    processStalePaidOperations,
    claimPaidOperation,
    withGenerationLeaseHeartbeat,
  },
} = require("../services/social/socialManagerService");

function query(value) {
  return {
    session() { return this; },
    sort() { return this; },
    limit() { return this; },
    lean() { return Promise.resolve(value); },
    then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
  };
}

test("idempotent paid-operation claims keep definitive failures definitive and leave stale running work to the reconciler", async () => {
  const draft = { _id: "draft-paid-claim" };
  for (const scenario of [
    { status: "FAILED", error: { code: "social_paid_operation_failed" }, expectedCode: "social_paid_operation_failed" },
    { status: "RUNNING", error: null, expectedCode: "social_paid_operation_reconciliation_required" },
  ]) {
    let attemptedRow;
    let destructiveUpdates = 0;
    const existing = {
      _id: `operation-${scenario.status.toLowerCase()}`,
      status: scenario.status,
      error: scenario.error,
      started_at: new Date("2026-09-01T00:00:00.000Z"),
      lease_expires_at: new Date("2026-09-01T01:00:00.000Z"),
    };
    const OperationModel = {
      create: async (row) => {
        attemptedRow = row;
        Object.assign(existing, {
          idempotency_key: row.idempotency_key,
          request_fingerprint: row.request_fingerprint,
        });
        const error = new Error("duplicate");
        error.code = 11000;
        throw error;
      },
      findOne: async () => existing,
      updateOne: async () => { destructiveUpdates += 1; },
    };
    await assert.rejects(
      claimPaidOperation({
        operation: "VISUAL_REGENERATION",
        draft,
        requestKey: "same-paid-request",
        requestPayload: { visual_mode: "FULL_AI_GRAPHIC" },
        dependencies: {
          SocialPaidOperation: OperationModel,
          SocialAuditLog: { findOne: () => query(null) },
        },
      }),
      (error) => error.code === scenario.expectedCode && error.statusCode === 409,
    );
    assert.ok(attemptedRow.idempotency_key);
    assert.equal(destructiveUpdates, 0);
    assert.equal(existing.status, scenario.status);
  }
});

test("expired generation run reconciles a committed reviewable draft without replaying providers", async () => {
  const now = new Date("2026-09-02T10:00:00.000Z");
  const run = {
    _id: "run-reconcile-1",
    status: "RUNNING",
    current_stage: "AWAITING_REVIEW",
    lease_expires_at: new Date("2026-09-02T09:59:00.000Z"),
    weekly_plan_id: "plan-1",
    weekly_candidate_id: "candidate-1",
    image_generation_status: "COMPLETED",
    initiated_by_admin_id: null,
    async save() { return this; },
  };
  const draft = {
    _id: "draft-reconcile-1",
    generation_run_id: run._id,
    generation_mode: "FULL_AI",
    status: "NEEDS_REVIEW",
    approval_json: { status: "NEEDS_REVIEW" },
    creative_readiness: { ai_visual_status: "COMPLETED", status: "READY" },
    asset_ids: ["asset-final-1"],
    final_composed_asset_ids: ["asset-final-1"],
    current_package: { primaryRecommendation: { format: "SINGLE_IMAGE" } },
    weekly_plan_id: "plan-1",
    candidate_id: "candidate-1",
    prompt_version_ids: ["prompt-1"],
    research_source_ids: ["source-1"],
  };
  const selected = { candidateId: "candidate-1", status: "GENERATING_IMAGES" };
  const plan = {
    _id: "plan-1",
    selected_posts: [selected],
    story_plan: [],
    async save() { return this; },
  };
  const audits = [];
  const session = {
    async withTransaction(work) { await work(); },
    async endSession() {},
  };
  const result = await reconcileCommittedGenerationDraft(run._id, {
    now,
    dependencies: {
      startSession: async () => session,
      SocialGenerationRun: { findById: () => query(run) },
      SocialPostDraft: { findOne: () => query(draft) },
      SocialAsset: { find: () => query([{ _id: "asset-final-1" }]) },
      SocialWeeklyPlan: { findById: () => query(plan) },
      SocialAuditLog: {
        create: async (records) => {
          const rows = Array.isArray(records) ? records : [records];
          audits.push(...rows);
          return rows;
        },
      },
      validateSocialPackage: (value) => value,
      reviewAssetReadiness: () => ({ passed: true, issues: [] }),
    },
  });

  assert.equal(result.draft, draft);
  assert.equal(run.status, "SUCCEEDED");
  assert.equal(run.current_stage, "COMPLETED");
  assert.equal(run.selected_draft_id, draft._id);
  assert.equal(run.lease_expires_at, null);
  assert.equal(selected.status, "NEEDS_REVIEW");
  assert.equal(selected.draft_id, draft._id);
  assert.equal(selected.generation_run_id, run._id);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "GENERATION_RUN_RECONCILED");
  assert.equal(audits[0].metadata.paid_provider_calls_replayed, false);
  assert.equal(session.transactionRuns, undefined);
});

test("expired duplicate placeholder is failed for reconciliation and never reset to the paid generation queue", async () => {
  const now = new Date("2026-09-02T10:00:00.000Z");
  const duplicate = {
    _id: "run-duplicate-stale",
    status: "RUNNING",
    idempotency_key: "social-duplicate:draft-1:key",
    started_at: new Date("2026-09-02T07:00:00.000Z"),
    lease_expires_at: new Date("2026-09-02T09:00:00.000Z"),
  };
  const paidOperationUpdates = [];
  const placeholder = {
    _id: "draft-duplicate-stale",
    generation_run_id: duplicate._id,
    status: "DRAFT",
    failed_at: null,
    last_error: null,
  };
  let queueClaimCount = 0;
  const RunModel = {
    find: () => query(duplicate.status === "RUNNING" ? [duplicate] : []),
    findById: () => query(duplicate),
    updateMany: async (filter, update) => {
      if (filter?._id?.$in?.includes(duplicate._id) && duplicate.status === "RUNNING") {
        Object.assign(duplicate, update.$set);
      }
      return { modifiedCount: 1 };
    },
    findOneAndUpdate: async (filter, update) => {
      if (filter?._id === duplicate._id && duplicate.status === "RUNNING") {
        Object.assign(duplicate, update.$set);
        return duplicate;
      }
      queueClaimCount += 1;
      return null;
    },
  };
  const result = await processPendingSocialGenerationRuns({
    now,
    dependencies: {
      SocialGenerationRun: RunModel,
      SocialPostDraft: {
        findOne: () => query(null),
        updateMany: async (filter, update) => {
          if (
            filter?.generation_run_id === placeholder.generation_run_id
            && filter?.status?.$in?.includes(placeholder.status)
          ) {
            Object.assign(placeholder, update.$set);
          }
          return { modifiedCount: 1 };
        },
      },
      SocialAsset: { find: () => query([]) },
      SocialWeeklyPlan: { findById: () => query(null) },
      SocialPaidOperation: {
        updateMany: async (filter, update) => { paidOperationUpdates.push({ filter, update }); },
      },
    },
  });

  assert.deepEqual(result, { processed: 0, succeeded: 0, failed: 0 });
  assert.equal(duplicate.status, "FAILED");
  assert.equal(duplicate.last_error.code, "social_duplicate_reconciliation_required");
  assert.equal(duplicate.last_error.is_retriable, false);
  assert.equal(paidOperationUpdates.length, 1);
  assert.equal(paidOperationUpdates[0].update.$set.status, "FAILED");
  assert.equal(placeholder.status, "FAILED");
  assert.equal(placeholder.failed_at, now);
  assert.equal(placeholder.last_error.code, "social_duplicate_reconciliation_required");
  assert.equal(placeholder.last_error.is_retriable, false);
  assert.equal(queueClaimCount, 1);
});

test("stale duplicate CAS never downgrades a success that commits after the stale scan", async () => {
  const now = new Date("2026-09-02T10:00:00.000Z");
  const duplicate = {
    _id: "run-duplicate-race",
    status: "RUNNING",
    idempotency_key: "social-duplicate:draft-race:key",
    started_at: new Date("2026-09-02T07:00:00.000Z"),
    lease_expires_at: new Date("2026-09-02T09:00:00.000Z"),
  };
  const draft = {
    _id: "draft-duplicate-race",
    generation_run_id: duplicate._id,
    status: "DRAFT",
  };
  let draftFailureWrites = 0;
  let operationFailureWrites = 0;
  const RunModel = {
    find: (filter) => query(filter?.status === "RUNNING" && duplicate.status === "RUNNING" ? [duplicate] : []),
    findById: () => query(duplicate),
    findOneAndUpdate: async (filter) => {
      if (filter?._id === duplicate._id) {
        // Model the duplicate success transaction winning immediately before
        // stale reconciliation attempts its conditional transition.
        duplicate.status = "SUCCEEDED";
        duplicate.selected_draft_id = draft._id;
        draft.status = "NEEDS_REVIEW";
        return null;
      }
      return null;
    },
    updateMany: async () => ({ modifiedCount: 0 }),
  };

  await processPendingSocialGenerationRuns({
    now,
    dependencies: {
      SocialGenerationRun: RunModel,
      SocialPostDraft: {
        findOne: () => query(null),
        updateMany: async () => { draftFailureWrites += 1; return { modifiedCount: 0 }; },
      },
      SocialAsset: { find: () => query([]) },
      SocialWeeklyPlan: { findById: () => query(null) },
      SocialPaidOperation: {
        updateMany: async () => { operationFailureWrites += 1; return { modifiedCount: 0 }; },
      },
    },
  });

  assert.equal(duplicate.status, "SUCCEEDED");
  assert.equal(draft.status, "NEEDS_REVIEW");
  assert.equal(draftFailureWrites, 0);
  assert.equal(operationFailureWrites, 0);
});

test("stale duplicate terminalization rolls back run and draft when the receipt update fails", async () => {
  const now = new Date("2026-09-02T10:00:00.000Z");
  const run = {
    _id: "run-duplicate-rollback",
    status: "RUNNING",
    current_stage: "GENERATING_IMAGES",
    idempotency_key: "social-duplicate:draft-rollback:key",
    started_at: new Date("2026-09-02T07:00:00.000Z"),
    lease_expires_at: new Date("2026-09-02T09:00:00.000Z"),
    last_error: null,
  };
  const draft = {
    _id: "draft-duplicate-rollback",
    generation_run_id: run._id,
    status: "DRAFT",
    failed_at: null,
    last_error: null,
  };
  const operation = {
    generation_run_id: run._id,
    status: "RUNNING",
    finished_at: null,
    error: null,
  };
  let snapshots = null;
  let transactionActive = false;
  const session = {
    async startTransaction() {
      snapshots = {
        run: { ...run },
        draft: { ...draft },
        operation: { ...operation },
      };
      transactionActive = true;
    },
    async commitTransaction() { transactionActive = false; },
    inTransaction() { return transactionActive; },
    async abortTransaction() {
      Object.assign(run, snapshots.run);
      Object.assign(draft, snapshots.draft);
      Object.assign(operation, snapshots.operation);
      transactionActive = false;
    },
    async endSession() {},
  };

  await assert.rejects(
    failStaleDuplicatePlaceholder(run._id, {
      now,
      dependencies: {
        startSession: async () => session,
        SocialGenerationRun: {
          findOneAndUpdate: async (filter, update) => {
            if (filter._id !== run._id || run.status !== "RUNNING") return null;
            Object.assign(run, update.$set);
            return run;
          },
        },
        SocialPostDraft: {
          updateMany: async (filter, update) => {
            if (filter.generation_run_id === draft.generation_run_id) Object.assign(draft, update.$set);
            return { modifiedCount: 1 };
          },
        },
        SocialPaidOperation: {
          updateMany: async () => {
            throw new Error("receipt write failed");
          },
        },
      },
    }),
    /receipt write failed/,
  );

  assert.equal(run.status, "RUNNING");
  assert.equal(run.current_stage, "GENERATING_IMAGES");
  assert.equal(run.last_error, null);
  assert.equal(draft.status, "DRAFT");
  assert.equal(draft.failed_at, null);
  assert.equal(draft.last_error, null);
  assert.equal(operation.status, "RUNNING");
});

test("stale paid generation atomically fails its incomplete draft and deactivates partial assets", async () => {
  const now = new Date("2026-09-02T10:00:00.000Z");
  const run = {
    _id: "run-paid-stale",
    status: "RUNNING",
    current_stage: "COMPOSING_FINAL_ASSETS",
    idempotency_key: "social-weekly:paid-stale",
    lease_expires_at: new Date("2026-09-02T09:00:00.000Z"),
    image_generation_attempts: [{ provider_response_id: "img-response-1", original_storage_key: "social/partial-original.png" }],
    initiated_by_admin_id: null,
  };
  const draft = {
    _id: "draft-paid-stale",
    generation_run_id: run._id,
    status: "DRAFT",
    failed_at: null,
    last_error: null,
  };
  const asset = {
    _id: "asset-paid-stale",
    draft_id: draft._id,
    generation_run_id: run._id,
    is_active: true,
    deleted_at: null,
    storage_provider: "local",
    storage_key: "social/partial-final.png",
    provider_original: { storage_provider: "local", storage_key: "social/partial-original.png" },
  };
  const audits = [];
  const RunModel = {
    findOneAndUpdate: async (filter, update) => {
      if (filter._id !== run._id || run.status !== "RUNNING") return null;
      Object.assign(run, update.$set);
      return run;
    },
    updateOne: async (filter, update) => {
      if (filter._id === run._id) Object.assign(run, update.$set);
      return { modifiedCount: 1 };
    },
  };
  const result = await failStalePaidGenerationRun(run._id, {
    now,
    dependencies: {
      startSession: async () => ({
        async withTransaction(work) { await work(); },
        async endSession() {},
      }),
      SocialGenerationRun: RunModel,
      SocialPostDraft: {
        find: () => query([draft]),
        updateMany: async (filter, update) => {
          if (filter._id?.$in?.includes(draft._id)) Object.assign(draft, update.$set);
          return { modifiedCount: 1 };
        },
      },
      SocialAsset: {
        find: () => query([asset]),
        updateMany: async (filter, update) => {
          if (filter._id?.$in?.includes(asset._id)) Object.assign(asset, update.$set);
          return { modifiedCount: 1 };
        },
      },
      SocialWeeklyPlan: { updateOne: async () => ({ modifiedCount: 0 }) },
      SocialAuditLog: {
        create: async (records) => {
          const rows = Array.isArray(records) ? records : [records];
          audits.push(...rows);
          return rows;
        },
      },
    },
  });

  assert.equal(result.run, run);
  assert.equal(run.status, "FAILED");
  assert.equal(run.failed_draft_id, draft._id);
  assert.equal(run.last_error.code, "social_paid_run_reconciliation_required");
  assert.equal(draft.status, "FAILED");
  assert.equal(draft.failed_at, now);
  assert.equal(draft.last_error.code, "social_paid_run_reconciliation_required");
  assert.equal(asset.is_active, false);
  assert.equal(asset.deleted_at, now);
  assert.deepEqual(
    result.stagedFiles.map((file) => file.storage_key).sort(),
    ["social/partial-final.png", "social/partial-original.png"],
  );
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "STALE_PAID_GENERATION_TERMINATED");
  assert.equal(audits[0].metadata.paid_provider_calls_replayed, false);
  assert.deepEqual(audits[0].metadata.failed_draft_ids, [draft._id]);
  assert.deepEqual(audits[0].metadata.deactivated_asset_ids, [asset._id]);
});

test("long provider work refreshes the owned generation lease periodically", async () => {
  const run = {
    _id: "run-long-provider",
    status: "RUNNING",
    lease_owner: "worker-long-provider",
    heartbeat_at: null,
    lease_expires_at: null,
  };
  let heartbeatCount = 0;
  const result = await withGenerationLeaseHeartbeat(run, async () => {
    await new Promise((resolve) => setTimeout(resolve, 45));
    return "provider-result";
  }, {
    dependencies: {
      generationLeaseHeartbeatIntervalMs: 10,
      SocialGenerationRun: {
        updateOne: async (filter) => {
          assert.equal(filter.status, "RUNNING");
          assert.equal(filter.lease_owner, run.lease_owner);
          heartbeatCount += 1;
          return { matchedCount: 1, modifiedCount: 1 };
        },
      },
    },
  });

  assert.equal(result, "provider-result");
  assert.ok(heartbeatCount >= 2);
  assert.ok(run.heartbeat_at instanceof Date);
  assert.ok(run.lease_expires_at instanceof Date);
});

test("a transient lease heartbeat failure is cleared by a later authoritative refresh", async () => {
  const run = {
    _id: "run-transient-heartbeat",
    status: "RUNNING",
    lease_owner: "worker-transient-heartbeat",
  };
  let heartbeatCount = 0;
  const result = await withGenerationLeaseHeartbeat(run, async () => {
    await new Promise((resolve) => setTimeout(resolve, 35));
    return { response_id: "provider-response-retained" };
  }, {
    dependencies: {
      generationLeaseHeartbeatIntervalMs: 10,
      SocialGenerationRun: {
        updateOne: async () => {
          heartbeatCount += 1;
          if (heartbeatCount === 1) throw Object.assign(new Error("temporary database transport failure"), { code: "ETIMEDOUT" });
          return { matchedCount: 1, modifiedCount: 1 };
        },
      },
    },
  });

  assert.deepEqual(result, { response_id: "provider-response-retained" });
  assert.ok(heartbeatCount >= 2);
});

test("final success CAS cannot overwrite a stale-worker terminalization", async () => {
  const run = {
    _id: "run-final-success-race",
    status: "RUNNING",
    lease_owner: "worker-final-success",
    async save() { throw new Error("fallback save must not run"); },
  };
  let observedFilter = null;
  await assert.rejects(
    commitGenerationRunSuccess(run, {
      status: "SUCCEEDED",
      selected_draft_id: "draft-final-success-race",
    }, {
      dependencies: {
        SocialGenerationRun: {
          findOneAndUpdate: async (filter) => {
            observedFilter = filter;
            run.status = "FAILED";
            return null;
          },
        },
      },
    }),
    (error) => error.code === "social_generation_lease_lost" && error.statusCode === 409,
  );

  assert.equal(observedFilter.status, "RUNNING");
  assert.equal(observedFilter.lease_owner, "worker-final-success");
  assert.equal(run.status, "FAILED");
});

test("stale paid-operation sweep retains ledger evidence and cleans only unreferenced provider files", async () => {
  const now = new Date("2026-09-02T10:00:00.000Z");
  const operation = {
    _id: "paid-operation-stale",
    idempotency_key: "social-paid-operation:VISUAL_REGENERATION:draft-source:hash",
    operation: "VISUAL_REGENERATION",
    source_draft_id: "draft-source",
    result_draft_id: null,
    generation_run_id: "run-source",
    status: "RUNNING",
    actor_admin_id: null,
    started_at: new Date("2026-09-02T07:00:00.000Z"),
    lease_expires_at: new Date("2026-09-02T09:00:00.000Z"),
    error: null,
  };
  const ledger = {
    _id: "paid-ledger-stale",
    operation: operation.operation,
    status: "SUCCEEDED",
    provider: "openai",
    model: "gpt-image-2",
    incurred_at: new Date("2026-09-02T08:00:00.000Z"),
    usage: { estimated_cost: 0.1, cost_currency: "USD" },
    evidence: {
      paid_call_id: operation._id,
      completed_visuals: [{
        sequence: 1,
        response_id: "img-paid-stale-1",
        checksum_sha256: "a".repeat(64),
        output_fingerprint: "a".repeat(64),
        storage_provider: "local",
        storage_key: "social/stale-paid-visual.png",
        image_usage: {},
        validation_usage: {},
        status: "VALIDATED",
        staged_files: [{ storage_provider: "local", storage_key: "social/stale-paid-reference.png" }],
        provider_original: { storage_provider: "local", storage_key: "social/stale-paid-provider-original.png" },
        normalization: { output_storage_key: "social/stale-paid-normalized.png" },
      }],
      failures: [],
    },
  };
  const audits = [];
  const deleted = [];
  let failCleanup = true;
  const AuditModel = {
    findOne: (filter) => query(audits.find((audit) => (
      (!filter.idempotency_key || audit.idempotency_key === filter.idempotency_key)
      && (!filter.action || audit.action === filter.action)
      && (!filter.action_status || audit.action_status === filter.action_status)
    )) || null),
    create: async (records) => {
      const rows = Array.isArray(records) ? records : [records];
      audits.push(...rows);
      return rows;
    },
  };
  const result = await processStalePaidOperations({
    now,
    dependencies: {
      startSession: async () => ({
        async withTransaction(work) { await work(); },
        async endSession() {},
      }),
      SocialPaidOperation: {
        find: () => query([operation]),
        findById: () => query(operation),
        findOneAndUpdate: async (filter, update) => {
          if (filter._id !== operation._id || operation.status !== "RUNNING") return null;
          Object.assign(operation, update.$set);
          return operation;
        },
      },
      SocialPaidCallUsageLedger: { find: () => query([ledger]) },
      SocialAuditLog: AuditModel,
      SocialAsset: { exists: async () => false },
      deleteCampaignAsset: async (file) => {
        if (failCleanup) throw new Error("temporary filesystem failure");
        deleted.push(file.storage_key);
        return true;
      },
    },
  });

  assert.deepEqual(result, { processed: 1, cleaned: 0, failed: 1 });
  assert.equal(operation.status, "FAILED");
  assert.equal(operation.error.code, "social_paid_operation_reconciliation_required");
  assert.deepEqual(deleted, []);
  const terminalAudit = audits.find((audit) => audit.action === "STALE_PAID_OPERATION_RECONCILIATION_REQUIRED");
  assert.ok(terminalAudit);
  assert.equal(terminalAudit.metadata.provider_calls_replayed, false);
  assert.equal(terminalAudit.metadata.paid_call_evidence[0].completed_visuals[0].response_id, "img-paid-stale-1");
  assert.equal(terminalAudit.metadata.paid_call_evidence[0].completed_visuals[0].checksum_sha256, "a".repeat(64));
  assert.ok(audits.some((audit) => audit.action === "STALE_PAID_OPERATION_FILES_CLEANED" && audit.action_status === "FAILED"));

  failCleanup = false;
  const retried = await processStalePaidOperations({
    now: new Date(now.getTime() + 60_000),
    dependencies: {
      startSession: async () => ({
        async withTransaction(work) { await work(); },
        async endSession() {},
      }),
      SocialPaidOperation: {
        find: () => query([operation]),
        findById: () => query(operation),
      },
      SocialPaidCallUsageLedger: { find: () => query([ledger]) },
      SocialAuditLog: AuditModel,
      SocialAsset: { exists: async () => false },
      deleteCampaignAsset: async (file) => { deleted.push(file.storage_key); return true; },
    },
  });
  assert.deepEqual(retried, { processed: 1, cleaned: 4, failed: 0 });
  assert.deepEqual(deleted.sort(), [
    "social/stale-paid-normalized.png",
    "social/stale-paid-provider-original.png",
    "social/stale-paid-reference.png",
    "social/stale-paid-visual.png",
  ]);
  assert.ok(audits.some((audit) => audit.action === "STALE_PAID_OPERATION_FILES_CLEANED" && audit.action_status === "SUCCEEDED"));
});

test("successful run restores a missing weekly-plan link without rerunning generation", async () => {
  const now = new Date("2026-09-02T10:00:00.000Z");
  const run = {
    _id: "run-success-link",
    status: "SUCCEEDED",
    selected_draft_id: "draft-success-link",
    weekly_plan_id: "plan-success-link",
    weekly_candidate_id: "candidate-success-link",
    initiated_by_admin_id: null,
  };
  const draft = {
    _id: "draft-success-link",
    status: "NEEDS_REVIEW",
    generation_run_id: run._id,
  };
  const selected = {
    candidateId: run.weekly_candidate_id,
    status: "GENERATING_IMAGES",
    draft_id: null,
    generation_run_id: run._id,
  };
  const plan = {
    _id: run.weekly_plan_id,
    selected_posts: [selected],
    story_plan: [],
    async save() { return this; },
  };
  const audits = [];
  const result = await reconcileSucceededWeeklyRunLink(run._id, {
    now,
    dependencies: {
      SocialGenerationRun: { findById: () => query(run) },
      SocialPostDraft: { findById: () => query(draft) },
      SocialWeeklyPlan: { findById: () => query(plan) },
      SocialAuditLog: {
        create: async (record) => {
          audits.push(record);
          return record;
        },
      },
    },
  });

  assert.equal(result.reused, false);
  assert.equal(selected.status, "NEEDS_REVIEW");
  assert.equal(selected.draft_id, draft._id);
  assert.equal(selected.generation_run_id, run._id);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "GENERATION_WEEKLY_LINK_RECONCILED");
  assert.equal(audits[0].metadata.paid_provider_calls_replayed, false);
});

test("legacy duplicate without a lease becomes stale only after the paid-operation window", () => {
  const now = new Date("2026-09-02T10:00:00.000Z");
  assert.equal(generationRunLeaseExpired({
    idempotency_key: "social-duplicate:draft-1:key",
    started_at: new Date("2026-09-02T07:00:00.000Z"),
    lease_expires_at: null,
  }, now), true);
  assert.equal(generationRunLeaseExpired({
    idempotency_key: "social-duplicate:draft-1:key",
    started_at: new Date("2026-09-02T09:00:01.000Z"),
    lease_expires_at: null,
  }, now), false);
});

test("authoritative duplicate receipt wins over an unknown transaction-commit error", async () => {
  const run = { _id: "run-success", status: "SUCCEEDED", selected_draft_id: "draft-success" };
  const draft = { _id: "draft-success", status: "NEEDS_REVIEW" };
  const operationClaim = { key: "paid-key", row: { _id: "operation-1" } };
  const observedFilters = [];
  const committed = await duplicateCommitSucceeded({
    run,
    draft,
    operationClaim,
    dependencies: {
      SocialAuditLog: { findOne: (filter) => { observedFilters.push(filter); return query({ _id: "audit-1" }); } },
      SocialPaidOperation: { findOne: () => query(null) },
    },
  });

  assert.equal(committed, true);
  assert.equal(observedFilters[0].action, "DUPLICATED_AS_NEW_DRAFT");
  assert.equal(observedFilters[0]["metadata.paid_operation_key"], operationClaim.key);
});

test("committed paid mutation is authoritative after an indeterminate transaction result", async () => {
  const draft = { _id: "draft-paid-commit", revision: 4, status: "NEEDS_REVIEW" };
  const operationClaim = { tracked: true, key: "paid-operation-key", row: { _id: "paid-operation-1" } };
  const committed = await authoritativePaidMutationDraft({
    operationClaim,
    draftId: draft._id,
    action: "AI_IMAGE_REGENERATED",
    minimumRevision: 4,
    allowedStatuses: ["NEEDS_REVIEW"],
    dependencies: {
      SocialPostDraft: { findById: () => query(draft) },
      SocialAuditLog: { findOne: () => query({ _id: "audit-paid-success" }) },
      SocialPaidOperation: { findOne: () => query({ _id: operationClaim.row._id, status: "SUCCEEDED" }) },
    },
  });
  assert.equal(committed.draft, draft);
  assert.equal(committed.audit._id, "audit-paid-success");
});

test("native swap commit requires the success audit, advanced revision, and active final asset", async () => {
  const draft = {
    _id: "draft-native-commit",
    revision: 3,
    status: "NEEDS_REVIEW",
    final_composed_asset_ids: ["asset-native-final"],
  };
  const committed = await authoritativeNativeSwapDraft({
    draftId: draft._id,
    idempotencyKey: "native-idempotency-key",
    minimumRevision: 3,
    finalAssetId: "asset-native-final",
    dependencies: {
      SocialPostDraft: { findById: () => query(draft) },
      SocialAuditLog: { findOne: () => query({ _id: "audit-native-success" }) },
      SocialAsset: { exists: async () => true },
    },
  });
  assert.equal(committed.draft, draft);
});

test("late generation audit failure is repaired without changing the ready draft", async () => {
  const run = { _id: "run-late-audit", status: "SUCCEEDED", selected_draft_id: "draft-late-audit" };
  const draft = { _id: "draft-late-audit", status: "NEEDS_REVIEW" };
  const audits = [];
  const result = await reconcileSucceededGenerationAudit(run._id, {
    dependencies: {
      SocialGenerationRun: { findById: () => query(run) },
      SocialPostDraft: { findById: () => query(draft) },
      SocialAuditLog: {
        findOne: () => query(null),
        create: async (record) => { audits.push(record); return record; },
      },
    },
  });
  assert.equal(result.reused, false);
  assert.equal(draft.status, "NEEDS_REVIEW");
  assert.equal(audits[0].action, "DRAFT_GENERATED_RECONCILED");
  assert.equal(audits[0].metadata.paid_provider_calls_replayed, false);
});

test("ready generation state is authoritative before late finalization recovery", async () => {
  const run = { _id: "run-ready", status: "SUCCEEDED", selected_draft_id: "draft-ready" };
  const draft = { _id: "draft-ready", generation_run_id: run._id, status: "NEEDS_REVIEW" };
  const result = await authoritativeCompletedGenerationDraft(run._id, draft._id, {
    dependencies: {
      SocialGenerationRun: { findById: () => query(run) },
      SocialPostDraft: { findById: () => query(draft) },
      SocialAsset: { find: () => query([{ _id: "asset-ready" }]) },
      reviewAssetReadiness: () => ({ passed: true, issues: [] }),
    },
  });
  assert.equal(result.run, run);
  assert.equal(result.draft, draft);
});
