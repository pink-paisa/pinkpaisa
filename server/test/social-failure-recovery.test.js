const test = require("node:test");
const assert = require("node:assert/strict");

const {
  archiveGenerationFailure,
} = require("../services/social/socialFailureRecoveryService");
const {
  listDraftCalendar,
  retryGenerationRun,
  _private: { weeklyRetryContext },
} = require("../services/social/socialManagerService");

function failedRun(overrides = {}) {
  return {
    _id: "507f1f77bcf86cd799439011",
    status: "FAILED_COMPLIANCE",
    last_error: { code: "social_compliance_exhausted" },
    recovery_archived_at: null,
    async save() { this.saved = true; },
    ...overrides,
  };
}

function transactionStarter() {
  return async () => ({
    async withTransaction(work) { await work(); },
    async endSession() {},
  });
}

test("an administrator can dismiss a terminal generation failure without deleting its evidence", async () => {
  const run = failedRun();
  const audits = [];
  const now = new Date("2026-09-01T12:00:00.000Z");
  const result = await archiveGenerationFailure(run._id, {
    actor: { _id: "507f1f77bcf86cd799439012" },
    requestId: "request-archive-1",
    ip: "203.0.113.10",
    reason: "A later approved retry replaced this failed attempt.",
    now,
    dependencies: {
      startSession: transactionStarter(),
      SocialGenerationRun: { findById: async () => run },
      SocialAuditLog: { create: async (record) => {
        const value = Array.isArray(record) ? record[0] : record;
        audits.push(value);
        return Array.isArray(record) ? [value] : value;
      } },
    },
  });

  assert.equal(result.reused, false);
  assert.equal(run.saved, true);
  assert.equal(run.recovery_archived_at, now);
  assert.equal(run.recovery_archive_reason, "A later approved retry replaced this failed attempt.");
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "GENERATION_FAILURE_ARCHIVED");
  assert.equal(audits[0].actor_type, "ADMIN");
  assert.equal(audits[0].metadata.evidence_preserved, true);
  assert.equal(audits[0].metadata.evidence_retention_policy, "append_only_no_automatic_purge");
  assert.match(audits[0].source_ip_hash, /^[a-f0-9]{64}$/);
});

test("failure dismissal is idempotent and does not append a second audit event", async () => {
  const run = failedRun({ recovery_archived_at: new Date("2026-09-01T11:00:00.000Z") });
  let auditWrites = 0;
  const result = await archiveGenerationFailure(run._id, {
    dependencies: {
      startSession: transactionStarter(),
      SocialGenerationRun: { findById: async () => run },
      SocialAuditLog: { create: async () => { auditWrites += 1; } },
    },
  });
  assert.equal(result.reused, true);
  assert.equal(auditWrites, 0);
});

test("non-terminal generation work cannot be dismissed", async () => {
  const run = failedRun({ status: "RUNNING" });
  await assert.rejects(
    archiveGenerationFailure(run._id, {
      dependencies: {
        startSession: transactionStarter(),
        SocialGenerationRun: { findById: async () => run },
        SocialAuditLog: { create: async () => null },
      },
    }),
    (error) => error.code === "social_generation_failure_archive_not_allowed" && error.statusCode === 409,
  );
});

test("a failure with an atomically queued replacement cannot also be dismissed", async () => {
  const run = failedRun({ superseded_by_generation_run_id: "507f1f77bcf86cd799439099" });
  await assert.rejects(
    archiveGenerationFailure(run._id, {
      dependencies: {
        startSession: transactionStarter(),
        SocialGenerationRun: { findById: async () => run },
        SocialAuditLog: { create: async () => null },
      },
    }),
    (error) => error.code === "social_generation_failure_superseded" && error.statusCode === 409,
  );
  assert.equal(run.recovery_archived_at, null);
});

test("failure dismissal refuses a non-transactional write instead of losing its immutable audit", async () => {
  const run = failedRun();
  await assert.rejects(
    archiveGenerationFailure(run._id, {
      dependencies: {
        startSession: null,
        SocialGenerationRun: { findById: async () => run },
        SocialAuditLog: { create: async () => null },
      },
    }),
    (error) => error.code === "social_generation_failure_archive_transaction_required"
      && error.statusCode === 503,
  );
  assert.equal(run.recovery_archived_at, null);
  assert.equal(run.saved, undefined);
});

test("weekly failure retries preserve their plan and candidate lineage", () => {
  const visualModeResolution = {
    requested: "FULL_AI_GRAPHIC",
    effective: "FULL_AI_GRAPHIC",
    eligible: true,
    reasons: [],
  };
  assert.deepEqual(weeklyRetryContext({
    weekly_plan_id: "507f1f77bcf86cd799439020",
    weekly_candidate_id: "weekly-candidate-01",
    generation_request: { visual_mode_resolution: visualModeResolution },
  }), {
    planId: "507f1f77bcf86cd799439020",
    candidateId: "weekly-candidate-01",
    visualModeResolution,
  });
  assert.equal(weeklyRetryContext({ weekly_plan_id: "507f1f77bcf86cd799439020" }), null);
});

function queryValue(value) {
  return {
    session() { return this; },
    then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
  };
}

function retryDependencies(original, { existing = null } = {}) {
  const rows = new Map([[String(original._id), original]]);
  if (existing) rows.set(String(existing._id), existing);
  const audits = [];
  let next = 1;
  const RunModel = {
    findById(id) { return queryValue(rows.get(String(id)) || null); },
    findOne(filter) {
      const match = [...rows.values()].find((row) => row.idempotency_key === filter.idempotency_key) || null;
      return queryValue(match);
    },
    async aggregate() { return []; },
    async create(payload) {
      const isArray = Array.isArray(payload);
      const record = isArray ? payload[0] : payload;
      const row = {
        _id: `507f1f77bcf86cd7994391${String(next++).padStart(2, "0")}`,
        ...record,
        async save() { rows.set(String(this._id), this); return this; },
      };
      rows.set(String(row._id), row);
      return isArray ? [row] : row;
    },
  };
  return {
    dependencies: {
      startSession: transactionStarter(),
      SocialGenerationRun: RunModel,
      SocialPostDraft: { findById: () => queryValue(null) },
      SocialAuditLog: {
        async create(payload) {
          const record = Array.isArray(payload) ? payload[0] : payload;
          audits.push(record);
          return Array.isArray(payload) ? [record] : record;
        },
      },
      getSocialManagerSettings: async () => ({
        feature_enabled: true,
        generation: { default_visual_mode: "AI_VISUAL_WITH_EXACT_OVERLAY" },
        cost_controls: { retry_limit: 0, monthly_budget_inr: 0 },
      }),
    },
    rows,
    audits,
  };
}

test("retry atomically binds one replacement and reuses only its exact idempotency lineage", async () => {
  const original = failedRun({
    generation_request: {
      requested_format: "SINGLE_IMAGE",
      requested_post_type: "EDUCATION",
      visual_mode: "AI_VISUAL_WITH_EXACT_OVERLAY",
    },
  });
  const fixture = retryDependencies(original);
  const requestKey = "retry-exact-lineage-1";
  const first = await retryGenerationRun(original._id, {
    actor: { _id: "507f1f77bcf86cd799439012" },
    requestKey,
    now: new Date("2026-09-01T12:30:00.000Z"),
    dependencies: fixture.dependencies,
  });

  assert.equal(first.reused, false);
  assert.equal(String(first.run.retry_of_generation_run_id), String(original._id));
  assert.equal(String(original.superseded_by_generation_run_id), String(first.run._id));
  assert.equal(fixture.audits.filter((row) => row.action === "GENERATION_RETRY_REQUESTED").length, 1);

  const replay = await retryGenerationRun(original._id, {
    requestKey,
    dependencies: fixture.dependencies,
  });
  assert.equal(replay.reused, true);
  assert.equal(String(replay.run._id), String(first.run._id));
  assert.equal(fixture.audits.filter((row) => row.action === "GENERATION_RETRY_REQUESTED").length, 1);
});

test("retry rejects a caller idempotency key already owned by unrelated generation work", async () => {
  const original = failedRun({
    generation_request: {
      requested_format: "SINGLE_IMAGE",
      requested_post_type: "EDUCATION",
      visual_mode: "AI_VISUAL_WITH_EXACT_OVERLAY",
    },
  });
  const unrelated = {
    _id: "507f1f77bcf86cd799439199",
    idempotency_key: "conflicting-user-key",
    trigger_type: "MANUAL",
    retry_of_generation_run_id: null,
  };
  const fixture = retryDependencies(original, { existing: unrelated });
  await assert.rejects(
    retryGenerationRun(original._id, {
      requestKey: unrelated.idempotency_key,
      dependencies: fixture.dependencies,
    }),
    (error) => error.code === "social_generation_retry_idempotency_conflict" && error.statusCode === 409,
  );
  assert.equal(original.superseded_by_generation_run_id, undefined);
});

test("a concurrent same-key retry resolves the committed winner outside the aborted transaction", async () => {
  const original = failedRun({
    generation_request: {
      requested_format: "SINGLE_IMAGE",
      requested_post_type: "EDUCATION",
      visual_mode: "AI_VISUAL_WITH_EXACT_OVERLAY",
    },
  });
  const requestKey = "retry-concurrent-same-key";
  const winner = {
    _id: "507f1f77bcf86cd799439188",
    idempotency_key: requestKey,
    trigger_type: "RETRY",
    retry_of_generation_run_id: original._id,
    selected_draft_id: null,
  };
  let idempotencyReads = 0;
  const RunModel = {
    findById(id) { return queryValue(String(id) === String(original._id) ? original : null); },
    findOne(filter) {
      idempotencyReads += 1;
      return queryValue(idempotencyReads === 1 ? null : winner);
    },
    async aggregate() { return []; },
    async create() {
      const error = new Error("duplicate key from competing transaction");
      error.code = 11000;
      throw error;
    },
  };
  const result = await retryGenerationRun(original._id, {
    requestKey,
    dependencies: {
      startSession: transactionStarter(),
      SocialGenerationRun: RunModel,
      SocialPostDraft: { findById: () => queryValue(null) },
      getSocialManagerSettings: async () => ({
        feature_enabled: true,
        generation: { default_visual_mode: "AI_VISUAL_WITH_EXACT_OVERLAY" },
        cost_controls: { retry_limit: 0, monthly_budget_inr: 0 },
      }),
    },
  });

  assert.equal(result.reused, true);
  assert.equal(result.run, winner);
  assert.equal(idempotencyReads, 2);
});

test("draft calendar omits failed drafts whose recovery was archived", async () => {
  const runId = "507f1f77bcf86cd799439177";
  const draftId = "507f1f77bcf86cd799439178";
  const archivedRun = {
    _id: runId,
    status: "FAILED_IMAGE_GENERATION",
    failed_draft_id: draftId,
    recovery_archived_at: new Date("2026-09-01T12:00:00.000Z"),
  };
  const failedDraft = { _id: draftId, generation_run_id: runId, status: "FAILED" };
  let finalDraftFilter = null;
  function chain(rows) {
    return {
      sort() { return this; },
      select() { return this; },
      skip() { return this; },
      limit() { return this; },
      async lean() { return rows; },
    };
  }
  const DraftModel = {
    find(filter) {
      if (filter.status === "FAILED" && !filter._id) return chain([failedDraft]);
      finalDraftFilter = filter;
      return chain([]);
    },
    async countDocuments(filter) {
      finalDraftFilter = filter;
      return filter._id?.$nin?.includes(draftId) ? 0 : 1;
    },
  };
  const RunModel = {
    find(filter) {
      if (filter.status?.$in) return chain([archivedRun]);
      if (filter.status === "SUCCEEDED") return chain([]);
      if (filter._id?.$in?.includes(runId)) return chain([archivedRun]);
      return chain([]);
    },
  };

  const calendar = await listDraftCalendar({
    dependencies: {
      SocialPostDraft: DraftModel,
      SocialGenerationRun: RunModel,
      SocialAuditLog: { find: () => chain([]) },
    },
  });

  assert.deepEqual(calendar.items, []);
  assert.equal(calendar.total, 0);
  assert.ok(finalDraftFilter._id.$nin.includes(draftId));
});
