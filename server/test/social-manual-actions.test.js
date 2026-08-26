const test = require("node:test");
const assert = require("node:assert/strict");
const SocialManualAction = require("../models/SocialManualAction");

const {
  listManualActions,
  publicManualAction,
  updateManualAction,
} = require("../services/social/socialManualActionService");
const { resolveDeterministicManualActions } = require("../services/social/socialManualActionResolutionService");

function actionDocument(overrides = {}) {
  return {
    _id: "507f1f77bcf86cd799439011",
    action_key: "social-reel-native-audio:draft-1:checksum",
    action_type: "META_NATIVE_INTERACTION",
    status: "OPEN",
    priority: "MEDIUM",
    title: "Complete the native Instagram step",
    description: "Use Instagram's first-party app.",
    instructions: ["Verify the approved asset and complete the exact native step."],
    draft_id: "507f1f77bcf86cd799439012",
    generation_run_id: "507f1f77bcf86cd799439013",
    async save() { return this; },
    ...overrides,
  };
}

test("manual actions require an administrator and persist audited lifecycle transitions", async () => {
  const action = actionDocument();
  const audits = [];
  const dependencies = {
    SocialManualAction: { findById: async () => action },
    SocialAuditLog: { create: async (record) => { audits.push(record); return record; } },
  };

  await assert.rejects(
    () => updateManualAction(action._id, { status: "IN_PROGRESS" }, { dependencies }),
    (error) => error.code === "social_manual_action_admin_required" && error.statusCode === 403,
  );

  const startedAt = new Date("2026-08-23T10:00:00.000Z");
  const started = await updateManualAction(action._id, { status: "IN_PROGRESS" }, {
    actor: { id: "507f1f77bcf86cd799439014" },
    now: startedAt,
    requestId: "manual-action-start",
    dependencies,
  });
  assert.equal(started.status, "IN_PROGRESS");
  assert.equal(action.started_at, startedAt);
  assert.equal(String(action.assigned_to_admin_id), "507f1f77bcf86cd799439014");

  const completedAt = new Date("2026-08-23T10:15:00.000Z");
  const completed = await updateManualAction(action._id, {
    status: "COMPLETED",
    resolution_note: "Added the approved native element, checked the destination, and confirmed the result.",
  }, {
    actor: { id: "507f1f77bcf86cd799439014" },
    now: completedAt,
    requestId: "manual-action-complete",
    dependencies,
  });
  assert.equal(completed.status, "COMPLETED");
  assert.equal(completed.completion_source, "ADMIN");
  assert.equal(completed.resolution_evidence, null);
  assert.equal(action.completed_at, completedAt);
  assert.match(action.resolution_note, /confirmed the result/i);
  assert.deepEqual(audits.map((audit) => audit.action), [
    "MANUAL_ACTION_IN_PROGRESS",
    "MANUAL_ACTION_COMPLETED",
  ]);
  assert.ok(audits.every((audit) => audit.entity_type === "MANUAL_ACTION" && audit.actor_type === "ADMIN"));
});

test("legacy manual actions serialize with administrator completion as the compatible default", () => {
  const legacy = publicManualAction(actionDocument());
  assert.equal(legacy.completion_source, "ADMIN");
  assert.equal(legacy.resolution_evidence, null);
});

test("manual-action schema accepts evidence-backed system completion without inventing an administrator", async () => {
  const completedAt = new Date("2026-08-24T07:00:00.000Z");
  const action = new SocialManualAction({
    action_key: "social-account-reconnect:meta:test",
    action_type: "ACCOUNT_RECONNECT",
    status: "COMPLETED",
    priority: "HIGH",
    title: "Reconnect Meta",
    description: "Restore the configured Meta connection.",
    completed_at: completedAt,
    completed_by_admin_id: null,
    completion_source: "SYSTEM",
    resolution_note: "The connection is configured and CONNECTED.",
    resolution_evidence: {
      resolver: "CONNECTION_HEALTH",
      entity_type: "CONNECTION_HEALTH",
      entity_id: "507f1f77bcf86cd799439088",
      observed_status: "CONNECTED",
      provider_reference_id: "health-check-1",
      observed_at: completedAt,
    },
  });
  await action.validate();
  assert.equal(action.completion_source, "SYSTEM");
  assert.equal(action.completed_by_admin_id, null);
});

test("deterministic resolver completes only authoritative generation, connection, publication, community, and audio recoveries", async () => {
  const saved = [];
  const action = (id, overrides) => ({
    ...actionDocument({
      _id: id,
      generation_run_id: null,
      draft_id: null,
      weekly_plan_id: null,
      publication_id: null,
      community_item_id: null,
    }),
    async save() { saved.push(String(this._id)); return this; },
    ...overrides,
  });
  const actions = [
    action("507f1f77bcf86cd799439021", {
      action_key: "social-prepublication-failure:plan-1:candidate-1:v1",
      action_type: "CONTENT_ESCALATION",
      weekly_plan_id: "plan-1",
      external_reference_id: "candidate-1",
    }),
    action("507f1f77bcf86cd799439022", {
      action_key: "social-account-reconnect:instagram",
      action_type: "ACCOUNT_RECONNECT",
      connection_health_id: "connection-1",
    }),
    action("507f1f77bcf86cd799439023", {
      action_key: "social-publish-reconciliation:publication-uncertain",
      action_type: "PUBLISH_RECONCILIATION",
      publication_id: "publication-uncertain",
    }),
    action("507f1f77bcf86cd799439024", {
      action_key: "social-publish-reconciliation:publication-confirmed",
      action_type: "PUBLISH_RECONCILIATION",
      publication_id: "publication-confirmed",
    }),
    action("507f1f77bcf86cd799439025", {
      action_key: "social-community-automation-failure:item-1:SEND",
      action_type: "COMMUNITY_REPLY",
      community_item_id: "community-1",
    }),
    action("507f1f77bcf86cd799439026", {
      action_key: "social-reel-audio-rights:draft-audio:old-track",
      action_type: "OTHER",
      draft_id: "draft-audio",
    }),
    action("507f1f77bcf86cd799439027", {
      action_key: "social-reel-native-audio:draft-native:checksum",
      action_type: "META_NATIVE_INTERACTION",
      generation_run_id: "run-success",
      draft_id: "draft-native",
    }),
    action("507f1f77bcf86cd799439028", {
      action_key: "social-published-media-enrichment:publication-confirmed:meta-media-1",
      action_type: "PUBLISH_RECONCILIATION",
      publication_id: "publication-confirmed",
    }),
  ];
  const audits = [];
  const result = await resolveDeterministicManualActions({
    now: new Date("2026-08-24T07:00:00.000Z"),
    dependencies: {
      SocialManualAction: { find: async () => actions },
      SocialWeeklyPlan: {
        findById: async () => ({ selected_posts: [{ candidateId: "candidate-1", generation_run_id: "run-success" }] }),
      },
      SocialGenerationRun: {
        findById: async () => ({ _id: "run-success", status: "SUCCEEDED", selected_draft_id: "draft-generated" }),
      },
      SocialConnectionHealth: {
        findById: async () => ({ _id: "connection-1", status: "CONNECTED", configured: true, latest_check: { check_key: "health-check-1" } }),
      },
      SocialPublication: {
        findById: async (id) => id === "publication-confirmed"
          ? { _id: id, status: "PUBLISHED", external_publication_id: "meta-media-1" }
          : { _id: id, status: "UNCERTAIN", external_publication_id: null },
      },
      SocialCommunityItem: {
        findById: async () => ({ _id: "community-1", status: "SENT", send_result: { external_reply_id: "meta-reply-1" } }),
      },
      SocialPostDraft: {
        findById: async (id) => id === "draft-audio" ? { _id: id, audio_track_id: "track-valid" } : { _id: id },
      },
      SocialAudioTrack: {
        findById: async () => ({
          _id: "track-valid",
          is_active: true,
          deactivated_at: null,
          rights_confirmed: true,
          license_status: "OWNED",
          checksum_sha256: "b".repeat(64),
        }),
      },
      SocialAuditLog: { create: async (record) => { audits.push(record); return record; } },
    },
  });

  assert.equal(result.scanned, 8);
  assert.equal(result.completed, 5);
  assert.deepEqual(saved, [
    "507f1f77bcf86cd799439021",
    "507f1f77bcf86cd799439022",
    "507f1f77bcf86cd799439024",
    "507f1f77bcf86cd799439025",
    "507f1f77bcf86cd799439026",
  ]);
  assert.equal(actions[2].status, "OPEN", "UNCERTAIN publication outcomes must remain manual");
  assert.equal(actions[6].status, "OPEN", "Instagram-native steps must remain manual");
  assert.equal(actions[7].status, "OPEN", "published-media enrichment stays open until its permalink is actually recovered");
  assert.ok(actions.filter((row) => row.status === "COMPLETED").every((row) => (
    row.completion_source === "SYSTEM" && row.completed_by_admin_id === null && row.resolution_evidence
  )));
  assert.equal(audits.length, 5);
  assert.ok(audits.every((audit) => audit.actor_type === "SYSTEM" && audit.metadata.completion_source === "SYSTEM"));
});

test("manual action completion and cancellation require notes and terminal records are immutable", async () => {
  const action = actionDocument();
  const dependencies = {
    SocialManualAction: { findById: async () => action },
    SocialAuditLog: { create: async () => undefined },
  };
  const options = { actor: { id: "507f1f77bcf86cd799439014" }, dependencies };

  await assert.rejects(
    () => updateManualAction(action._id, { status: "COMPLETED" }, options),
    (error) => error.code === "social_manual_action_resolution_required",
  );
  await assert.rejects(
    () => updateManualAction(action._id, { status: "CANCELLED" }, options),
    (error) => error.code === "social_manual_action_cancellation_required",
  );

  await updateManualAction(action._id, {
    status: "CANCELLED",
    cancellation_reason: "The approved creative no longer requests this native step.",
  }, options);
  assert.equal(action.status, "CANCELLED");
  await assert.rejects(
    () => updateManualAction(action._id, {
      status: "COMPLETED",
      resolution_note: "Attempted late completion.",
    }, options),
    (error) => error.code === "social_manual_action_transition_invalid" && error.statusCode === 409,
  );
});

test("generic manual-action mutation cannot close authoritative-ID reconciliation work", async () => {
  const admin = { id: "507f1f77bcf86cd799439014" };
  for (const action of [
    actionDocument({
      action_key: "social-community-send-reconciliation:community-1:checksum",
      action_type: "COMMUNITY_REPLY",
      community_item_id: "community-1",
    }),
    actionDocument({
      action_key: "social-publish-reconciliation:publication-1:outcome-uncertain",
      action_type: "PUBLISH_RECONCILIATION",
      publication_id: "publication-1",
    }),
  ]) {
    const dependencies = {
      SocialManualAction: { findById: async () => action },
      SocialAuditLog: { create: async () => { throw new Error("audit must not run"); } },
    };
    await assert.rejects(
      () => updateManualAction(action._id, {
        status: "COMPLETED",
        resolution_note: "Claimed completion without recording the provider ID.",
      }, { actor: admin, dependencies }),
      (error) => error.code === "social_manual_action_dedicated_reconciliation_required"
        && error.statusCode === 409
        && /\/reconcile/.test(error.message),
    );
    await assert.rejects(
      () => updateManualAction(action._id, {
        status: "CANCELLED",
        cancellation_reason: "Attempted to close without reconciliation.",
      }, { actor: admin, dependencies }),
      (error) => error.code === "social_manual_action_dedicated_reconciliation_required" && error.statusCode === 409,
    );
    assert.equal(action.status, "OPEN");
  }

  const legacyUncertain = actionDocument({
    action_key: "legacy-publication-follow-up",
    action_type: "PUBLISH_RECONCILIATION",
    publication_id: "publication-legacy-uncertain",
  });
  await assert.rejects(
    () => updateManualAction(legacyUncertain._id, {
      status: "COMPLETED",
      resolution_note: "No Meta media ID recorded.",
    }, {
      actor: admin,
      dependencies: {
        SocialManualAction: { findById: async () => legacyUncertain },
        SocialPublication: { findById: async () => ({ status: "UNCERTAIN" }) },
      },
    }),
    (error) => error.code === "social_manual_action_dedicated_reconciliation_required",
  );

  const ordinaryReadiness = actionDocument({
    action_key: "social-scheduled-readiness:draft-1:r1",
    action_type: "PUBLISH_RECONCILIATION",
    publication_id: null,
  });
  const completed = await updateManualAction(ordinaryReadiness._id, {
    status: "COMPLETED",
    resolution_note: "Readiness blockers were corrected and the draft was safely rescheduled.",
  }, {
    actor: admin,
    dependencies: {
      SocialManualAction: { findById: async () => ordinaryReadiness },
      SocialAuditLog: { create: async (record) => record },
    },
  });
  assert.equal(completed.status, "COMPLETED");
});

test("manual action listing uses bounded allowlisted filters and returns public records", async () => {
  let capturedQuery = null;
  const rows = [
    actionDocument({ _id: "low", priority: "LOW", due_at: new Date("2026-08-24T08:00:00.000Z") }),
    actionDocument({ _id: "critical", priority: "CRITICAL", due_at: new Date("2026-08-24T12:00:00.000Z") }),
    actionDocument({ _id: "medium", priority: "MEDIUM", due_at: new Date("2026-08-24T10:00:00.000Z") }),
    actionDocument({ _id: "high", priority: "HIGH", due_at: new Date("2026-08-24T11:00:00.000Z") }),
  ];
  const queryBuilder = {
    sort() { return this; },
    limit() { return this; },
    async lean() { return rows; },
  };
  const dependencies = {
    SocialManualAction: {
      find(query) { capturedQuery = query; return queryBuilder; },
    },
  };
  const result = await listManualActions({
    status: "open,in_progress,open",
    action_type: "meta_native_interaction",
    priority: "medium",
    draft_id: "507f1f77bcf86cd799439012",
    limit: 9999,
  }, { dependencies });

  assert.deepEqual(capturedQuery.status.$in, ["OPEN", "IN_PROGRESS"]);
  assert.deepEqual(capturedQuery.action_type.$in, ["META_NATIVE_INTERACTION"]);
  assert.deepEqual(capturedQuery.priority.$in, ["MEDIUM"]);
  assert.equal(capturedQuery.draft_id, "507f1f77bcf86cd799439012");
  assert.equal(result.limit, 200);
  assert.deepEqual(result.items.map((item) => item.priority), ["CRITICAL", "HIGH", "MEDIUM", "LOW"]);

  await assert.rejects(
    () => listManualActions({ status: "OPEN,HIDDEN" }, { dependencies }),
    (error) => error.code === "social_manual_action_filter_invalid",
  );
});

test("manual action listing uses semantic priority ranks in the Mongo aggregation path", async () => {
  let pipeline = null;
  const result = await listManualActions({ limit: 3 }, {
    dependencies: {
      SocialManualAction: {
        async aggregate(value) {
          pipeline = value;
          return [actionDocument({ priority: "CRITICAL" })];
        },
      },
    },
  });

  assert.equal(result.items[0].priority, "CRITICAL");
  assert.deepEqual(pipeline.find((stage) => stage.$sort).$sort, {
    __priority_rank: -1,
    status: 1,
    due_at: 1,
    created_at: -1,
  });
  assert.equal(pipeline.find((stage) => stage.$limit).$limit, 3);
});

test("administrator mutation and immutable audit append share one Mongo transaction", async () => {
  const session = { id: "manual-action-session" };
  let ended = false;
  let transactionCalls = 0;
  let findSession = null;
  let saveSession = null;
  let auditSession = null;
  const action = actionDocument({
    async save(options) {
      saveSession = options?.session || null;
      return this;
    },
  });
  const dependencies = {
    startSession: async () => ({
      ...session,
      async withTransaction(work) {
        transactionCalls += 1;
        return work();
      },
      async endSession() { ended = true; },
    }),
    SocialManualAction: {
      findById() {
        return {
          session(value) {
            findSession = value;
            return Promise.resolve(action);
          },
        };
      },
    },
    SocialAuditLog: {
      async create(records, options) {
        assert.equal(Array.isArray(records), true);
        auditSession = options?.session || null;
        return records;
      },
    },
  };

  const result = await updateManualAction(action._id, {
    status: "COMPLETED",
    resolution_note: "Verified directly in the provider application.",
  }, {
    actor: { id: "507f1f77bcf86cd799439014" },
    dependencies,
  });

  assert.equal(result.status, "COMPLETED");
  assert.equal(transactionCalls, 1);
  assert.equal(findSession.id, session.id);
  assert.equal(saveSession.id, session.id);
  assert.equal(auditSession.id, session.id);
  assert.equal(ended, true);
});
