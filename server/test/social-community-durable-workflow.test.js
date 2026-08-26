const test = require("node:test");
const assert = require("node:assert/strict");

const SocialCommunityItem = require("../models/SocialCommunityItem");
const {
  acknowledgeCommunityEscalation,
  approveAndQueueCommunityReply,
  initialCommunityWorkflow,
  processCommunityWorkflow,
  publicSendIntent,
  queueApprovedCommunityReply,
  reconcileUncertainCommunitySend,
  resolveCommunityEscalation,
  _private: { sha256 },
} = require("../services/social/socialCommunityWorkflowService");
const {
  ingestCommunityEvents,
  publicCommunityItem,
  recommendCommunityReply,
  rejectCommunityReply,
} = require("../services/social/socialGrowthTeamService");

function getPath(value, path) {
  return String(path).split(".").reduce((current, part) => current?.[part], value);
}

function setPath(value, path, next) {
  const parts = String(path).split(".");
  let current = value;
  for (const part of parts.slice(0, -1)) {
    current[part] = current[part] || {};
    current = current[part];
  }
  current[parts.at(-1)] = next;
}

function matches(row, query) {
  return Object.entries(query).every(([path, expected]) => {
    const actual = getPath(row, path);
    if (expected && typeof expected === "object" && !Array.isArray(expected)) {
      if ("$lte" in expected) return new Date(actual).getTime() <= new Date(expected.$lte).getTime();
      if ("$in" in expected) return expected.$in.includes(actual);
    }
    return String(actual) === String(expected);
  });
}

function applyUpdate(row, update) {
  for (const [path, value] of Object.entries(update.$set || {})) setPath(row, path, value);
  for (const [path, value] of Object.entries(update.$inc || {})) setPath(row, path, Number(getPath(row, path) || 0) + Number(value));
  return row;
}

function inMemoryCommunityModel(rows) {
  return {
    async findById(id) {
      return rows.find((row) => String(row._id) === String(id)) || null;
    },
    async findOneAndUpdate(query, update) {
      const row = rows.find((candidate) => matches(candidate, query));
      return row ? applyUpdate(row, update) : null;
    },
  };
}

function saveable(value) {
  return {
    ...value,
    async save() { return this; },
  };
}

function transactionStub() {
  return {
    runs: 0,
    session: {
      async withTransaction(work) {
        this.runs = (this.runs || 0) + 1;
        await work();
      },
      async endSession() {},
    },
    async startSession() {
      this.runs += 1;
      return this.session;
    },
  };
}

test("incoming workflow queues only supported ordinary events and escalates sensitive or unsupported events", () => {
  const now = new Date("2026-08-24T10:00:00.000Z");
  const ordinary = initialCommunityWorkflow({ sourceType: "COMMENT", message: "Where can I find your free calculator?", now });
  assert.equal(ordinary.status, "RECOMMENDATION_QUEUED");
  assert.equal(ordinary.recommendation_job.status, "QUEUED");

  const sensitive = initialCommunityWorkflow({ sourceType: "DIRECT_MESSAGE", message: "Which fund should I invest in?", now });
  assert.equal(sensitive.status, "ESCALATED");
  assert.equal(sensitive.escalation.required, true);
  assert.equal(sensitive.recommendation_job, null);

  const unsupported = initialCommunityWorkflow({ sourceType: "TAGGED_POST", message: "Love this", now });
  assert.equal(unsupported.status, "ESCALATED");
  assert.match(unsupported.escalation.reason, /does not support/i);
});

test("webhook ingestion durably stores automatic drafting queues without sending", async () => {
  const inserted = [];
  const CommunityModel = {
    async findOneAndUpdate(_query, update) {
      inserted.push(update.$setOnInsert);
      return update.$setOnInsert;
    },
  };
  await ingestCommunityEvents([
    { id: "ordinary-1", source_type: "COMMENT", object_id: "comment-1", text: "Where is the quiz?" },
    { id: "sensitive-1", source_type: "MESSAGE", object_id: "message-1", text: "I need personalised investment advice" },
  ], { dependencies: { SocialCommunityItem: CommunityModel } });
  assert.equal(inserted[0].status, "RECOMMENDATION_QUEUED");
  assert.equal(inserted[0].recommendation_job.status, "QUEUED");
  assert.equal(inserted[1].status, "ESCALATED");
  assert.equal(inserted[1].escalation.required, true);
  assert.equal(inserted.some((row) => row.status === "SEND_QUEUED"), false);
});

test("approve-and-send atomically records exact reply, checksum, audits and an idempotent send intent", async () => {
  const item = saveable({
    _id: "community-safe-1",
    status: "NEEDS_REVIEW",
    source_type: "COMMENT",
    external_object_id: "comment-1",
    recommendation: {
      suggestedReply: "The free calculator is available from Pink Paisa's tools page.",
      sendAllowedAfterApproval: true,
    },
    escalation: { required: false },
  });
  const audits = [];
  let transactionRuns = 0;
  const session = {
    async withTransaction(work) { transactionRuns += 1; await work(); },
    async endSession() {},
  };
  const dependencies = {
    SocialCommunityItem: { findById: async () => item },
    SocialAuditLog: {
      async create(records, options) {
        assert.equal(options.session, session);
        audits.push(...records);
        return records;
      },
    },
    startSession: async () => session,
  };
  const actor = { id: "507f1f77bcf86cd799439011" };
  const first = await approveAndQueueCommunityReply(item._id, {
    actor,
    reply: "  The free calculator is available from Pink Paisa's tools page.  ",
    idempotencyKey: "operator-click-1",
    now: new Date("2026-08-24T10:00:00.000Z"),
    dependencies,
  });
  assert.equal(first.reused, false);
  assert.equal(item.status, "SEND_QUEUED");
  assert.equal(item.approval.approved_reply, "The free calculator is available from Pink Paisa's tools page.");
  assert.equal(item.approval.approved_reply_checksum, sha256(item.approval.approved_reply));
  assert.equal(item.send_intent.approved_reply_checksum, item.approval.approved_reply_checksum);
  assert.equal(item.send_intent.status, "QUEUED");
  assert.deepEqual(audits.map((entry) => entry.action), ["COMMUNITY_REPLY_APPROVED", "COMMUNITY_SEND_QUEUED"]);
  assert.equal(transactionRuns, 1);

  const second = await approveAndQueueCommunityReply(item._id, {
    actor,
    idempotencyKey: "operator-click-1",
    dependencies,
  });
  assert.equal(second.reused, true);
  assert.equal(audits.length, 2);
  assert.equal(transactionRuns, 2);

  await assert.rejects(
    () => approveAndQueueCommunityReply(item._id, {
      actor,
      reply: "A different but otherwise safe reply must not reuse the prior intent.",
      idempotencyKey: "operator-click-1",
      dependencies,
    }),
    (error) => error.code === "social_community_send_intent_conflict",
  );
  assert.equal(item.approval.approved_reply, "The free calculator is available from Pink Paisa's tools page.");
  assert.equal(audits.length, 2);
});

test("legacy send compatibility queues an existing human approval without calling Meta inline", async () => {
  const approvedReply = "The verified Pink Paisa resource is available from our tools page.";
  const item = saveable({
    _id: "community-approved-legacy-send",
    status: "APPROVED",
    source_type: "COMMENT",
    external_object_id: "comment-approved-legacy-send",
    recommendation: { suggestedReply: approvedReply, sendAllowedAfterApproval: true },
    escalation: { required: false },
    approval: {
      status: "APPROVED",
      approved_by_admin_id: "admin-original-reviewer",
      approved_at: new Date("2026-08-24T09:00:00.000Z"),
      approved_reply: approvedReply,
      approved_reply_checksum: sha256(approvedReply),
    },
  });
  const audits = [];
  const dependencies = {
    SocialCommunityItem: { findById: async () => item },
    SocialAuditLog: {
      async create(records) {
        audits.push(...(Array.isArray(records) ? records : [records]));
        return records;
      },
    },
  };
  const first = await queueApprovedCommunityReply(item._id, {
    actor: { id: "admin-queue-operator" },
    idempotencyKey: "legacy-send-click-1",
    dependencies,
  });
  assert.equal(first.reused, false);
  assert.equal(item.status, "SEND_QUEUED");
  assert.equal(item.approval.approved_by_admin_id, "admin-original-reviewer");
  assert.equal(item.send_intent.status, "QUEUED");
  assert.deepEqual(audits.map((entry) => entry.action), ["COMMUNITY_SEND_QUEUED"]);

  const second = await queueApprovedCommunityReply(item._id, {
    actor: { id: "admin-queue-operator" },
    idempotencyKey: "legacy-send-click-1",
    dependencies,
  });
  assert.equal(second.reused, true);
  assert.equal(audits.length, 1);
});

test("approve-and-send rejects escalation, unsupported sources and unsafe edits before mutation", async () => {
  const base = {
    _id: "community-blocked",
    status: "NEEDS_REVIEW",
    source_type: "COMMENT",
    recommendation: { suggestedReply: "A safe answer.", sendAllowedAfterApproval: true },
    escalation: { required: false },
    async save() { throw new Error("must not save"); },
  };
  const dependencies = { SocialCommunityItem: { findById: async () => base } };
  await assert.rejects(
    () => approveAndQueueCommunityReply(base._id, { actor: { id: "admin-1" }, reply: "You should buy this fund", dependencies }),
    (error) => error.code === "social_community_reply_unsafe",
  );
  base.source_type = "TAGGED_POST";
  await assert.rejects(
    () => approveAndQueueCommunityReply(base._id, { actor: { id: "admin-1" }, dependencies }),
    (error) => error.code === "social_manual_action_required",
  );
  base.source_type = "COMMENT";
  base.escalation.required = true;
  await assert.rejects(
    () => approveAndQueueCommunityReply(base._id, { actor: { id: "admin-1" }, dependencies }),
    (error) => error.code === "social_community_reply_blocked",
  );
});

test("draft worker atomically claims a queued event, drafts for review and never sends it", async () => {
  const item = saveable({
    _id: "queued-recommendation",
    status: "RECOMMENDATION_QUEUED",
    source_type: "COMMENT",
    occurred_at: new Date("2026-08-24T09:00:00.000Z"),
    recommendation_job: { status: "QUEUED", queued_at: new Date(), attempt_count: 0 },
  });
  const rows = [item];
  let sendCalls = 0;
  const result = await processCommunityWorkflow({
    now: new Date("2026-08-24T10:00:00.000Z"),
    dependencies: {
      SocialCommunityItem: inMemoryCommunityModel(rows),
      async recommendCommunityReply() {
        item.status = "NEEDS_REVIEW";
        item.recommendation = { suggestedReply: "Thanks for asking.", sendAllowedAfterApproval: true };
        item.escalation = { required: false };
        return item;
      },
      instagramGrowthService: { async replyToComment() { sendCalls += 1; return { id: "unexpected" }; } },
    },
  });
  assert.equal(result.drafted, 1);
  assert.equal(item.status, "NEEDS_REVIEW");
  assert.equal(item.recommendation_job.status, "COMPLETED");
  assert.equal(sendCalls, 0);
});

test("unsafe AI reply output is escalated with no send action", async () => {
  const item = saveable({
    _id: "queued-unsafe-recommendation",
    status: "RECOMMENDATION_QUEUED",
    source_type: "COMMENT",
    occurred_at: new Date("2026-08-24T09:00:00.000Z"),
    recommendation_job: { status: "QUEUED", queued_at: new Date(), attempt_count: 0 },
  });
  const actions = [];
  const error = new Error("unsafe generated reply");
  error.code = "social_community_reply_unsafe";
  const result = await processCommunityWorkflow({
    dependencies: {
      SocialCommunityItem: inMemoryCommunityModel([item]),
      SocialManualAction: {
        async findOneAndUpdate(_query, update) {
          actions.push(update.$setOnInsert);
          return update.$setOnInsert;
        },
      },
      async recommendCommunityReply() { throw error; },
    },
  });
  assert.equal(result.failed, 1);
  assert.equal(item.status, "ESCALATED");
  assert.equal(item.escalation.required, true);
  assert.equal(item.recommendation_job.status, "FAILED");
  assert.equal(actions.length, 1);
});

test("send worker delivers the exact approved reply once and records only a confirmed provider identifier as SENT", async () => {
  const approvedReply = "Thanks for asking. The verified resource is on Pink Paisa.";
  const checksum = sha256(approvedReply);
  const item = saveable({
    _id: "queued-send",
    status: "SEND_QUEUED",
    source_type: "COMMENT",
    external_object_id: "comment-55",
    occurred_at: new Date("2026-08-24T09:00:00.000Z"),
    recommendation: { suggestedReply: "Old suggestion", sendAllowedAfterApproval: true },
    escalation: { required: false },
    approval: {
      status: "APPROVED",
      approved_by_admin_id: "admin-55",
      approved_at: new Date(),
      approved_reply: approvedReply,
      approved_reply_checksum: checksum,
    },
    send_intent: {
      status: "QUEUED",
      idempotency_key: "community:send:55",
      approved_reply_checksum: checksum,
      provider_idempotency_key: "provider-key-55",
      queued_at: new Date(),
      attempt_count: 0,
    },
  });
  const rows = [item];
  const audits = [];
  let sends = 0;
  const result = await processCommunityWorkflow({
    now: new Date("2026-08-24T10:00:00.000Z"),
    dependencies: {
      SocialCommunityItem: inMemoryCommunityModel(rows),
      SocialAuditLog: { async create(record) { audits.push(...(Array.isArray(record) ? record : [record])); return record; } },
      instagramGrowthService: {
        async replyToComment({ commentId, message, idempotencyKey }) {
          sends += 1;
          assert.equal(commentId, "comment-55");
          assert.equal(message, approvedReply);
          assert.equal(idempotencyKey, "provider-key-55");
          return { id: "meta-reply-55" };
        },
      },
    },
  });
  assert.equal(sends, 1);
  assert.equal(result.sent, 1);
  assert.equal(item.status, "SENT");
  assert.equal(item.send_result.external_reply_id, "meta-reply-55");
  assert.equal(item.send_intent.status, "CONFIRMED");
  assert.ok(audits.some((entry) => entry.action === "COMMUNITY_REPLY_SENT"));

  const repeated = await processCommunityWorkflow({
    dependencies: { SocialCommunityItem: inMemoryCommunityModel(rows), instagramGrowthService: { replyToComment: async () => { sends += 1; } } },
  });
  assert.equal(repeated.sent, 0);
  assert.equal(sends, 1);
});

test("concurrent delivery workers atomically claim one send intent and make one provider call", async () => {
  const approvedReply = "Thanks for asking Pink Paisa.";
  const checksum = sha256(approvedReply);
  const item = saveable({
    _id: "concurrent-send",
    status: "SEND_QUEUED",
    source_type: "COMMENT",
    external_object_id: "comment-concurrent",
    occurred_at: new Date(),
    recommendation: { suggestedReply: approvedReply, sendAllowedAfterApproval: true },
    escalation: { required: false },
    approval: { status: "APPROVED", approved_by_admin_id: "admin-1", approved_at: new Date(), approved_reply: approvedReply, approved_reply_checksum: checksum },
    send_intent: { status: "QUEUED", idempotency_key: "community:concurrent", approved_reply_checksum: checksum, provider_idempotency_key: "provider-concurrent", queued_at: new Date(), attempt_count: 0 },
  });
  const model = inMemoryCommunityModel([item]);
  let providerCalls = 0;
  const dependencies = {
    SocialCommunityItem: model,
    SocialAuditLog: { async create(value) { return value; } },
    instagramGrowthService: {
      async replyToComment() {
        providerCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { id: "meta-concurrent" };
      },
    },
  };
  const results = await Promise.all([
    processCommunityWorkflow({ dependencies }),
    processCommunityWorkflow({ dependencies }),
  ]);
  assert.equal(providerCalls, 1);
  assert.equal(results.reduce((sum, result) => sum + result.sent, 0), 1);
  assert.equal(item.status, "SENT");
});

test("an unconfirmed provider outcome becomes SEND_UNCERTAIN with reconciliation work and is never retried blindly", async () => {
  const approvedReply = "Thanks for writing to Pink Paisa.";
  const checksum = sha256(approvedReply);
  const item = saveable({
    _id: "uncertain-send",
    status: "SEND_QUEUED",
    source_type: "COMMENT",
    external_object_id: "comment-uncertain",
    occurred_at: new Date("2026-08-24T09:00:00.000Z"),
    recommendation: { suggestedReply: approvedReply, sendAllowedAfterApproval: true },
    escalation: { required: false },
    approval: { status: "APPROVED", approved_by_admin_id: "admin-1", approved_at: new Date(), approved_reply: approvedReply, approved_reply_checksum: checksum },
    send_intent: { status: "QUEUED", idempotency_key: "community:uncertain", approved_reply_checksum: checksum, provider_idempotency_key: "provider-uncertain", queued_at: new Date(), attempt_count: 0 },
  });
  const rows = [item];
  const actions = [];
  let providerCalls = 0;
  const dependencies = {
    SocialCommunityItem: inMemoryCommunityModel(rows),
    SocialManualAction: {
      async findOneAndUpdate(_query, update) {
        actions.push(update.$setOnInsert);
        return { _id: "action-1", ...update.$setOnInsert };
      },
    },
    SocialAuditLog: { async create(value) { return value; } },
    instagramGrowthService: {
      async replyToComment() {
        providerCalls += 1;
        const error = new Error("connection closed before response");
        error.code = "ETIMEDOUT";
        throw error;
      },
    },
  };
  const first = await processCommunityWorkflow({ now: new Date("2026-08-24T10:00:00.000Z"), dependencies });
  assert.equal(providerCalls, 1);
  assert.equal(first.uncertain, 1);
  assert.equal(item.status, "SEND_UNCERTAIN");
  assert.equal(item.send_intent.status, "UNCERTAIN");
  assert.equal(actions.length, 1);
  assert.match(actions[0].description, /Do not retry blindly/i);

  const second = await processCommunityWorkflow({ now: new Date("2026-08-24T10:10:00.000Z"), dependencies });
  assert.equal(second.sent, 0);
  assert.equal(providerCalls, 1);
});

test("a provider recipient identifier without a reply or message identifier is never confirmation of SENT", async () => {
  const approvedReply = "Thanks for writing to Pink Paisa.";
  const checksum = sha256(approvedReply);
  const item = saveable({
    _id: "recipient-only-send",
    status: "SEND_QUEUED",
    source_type: "DIRECT_MESSAGE",
    external_object_id: "message-recipient-only",
    author_external_id: "recipient-77",
    occurred_at: new Date("2026-08-24T09:00:00.000Z"),
    recommendation: { suggestedReply: approvedReply, sendAllowedAfterApproval: true },
    escalation: { required: false },
    approval: { status: "APPROVED", approved_by_admin_id: "admin-1", approved_at: new Date(), approved_reply: approvedReply, approved_reply_checksum: checksum },
    send_intent: { status: "QUEUED", idempotency_key: "community:recipient-only", approved_reply_checksum: checksum, provider_idempotency_key: "provider-recipient-only", queued_at: new Date(), attempt_count: 0 },
  });
  const actions = [];
  const result = await processCommunityWorkflow({
    now: new Date("2026-08-24T10:00:00.000Z"),
    dependencies: {
      SocialCommunityItem: inMemoryCommunityModel([item]),
      SocialManualAction: {
        async findOneAndUpdate(_query, update) {
          actions.push(update.$setOnInsert);
          return { _id: "recipient-only-action", ...update.$setOnInsert };
        },
      },
      SocialAuditLog: { async create(value) { return value; } },
      instagramGrowthService: {
        async sendMessage() {
          return { recipient_id: "recipient-77" };
        },
      },
    },
  });
  assert.equal(result.sent, 0);
  assert.equal(result.uncertain, 1);
  assert.equal(result.failures[0].code, "instagram_reply_outcome_unconfirmed");
  assert.equal(item.status, "SEND_UNCERTAIN");
  assert.equal(item.send_intent.status, "UNCERTAIN");
  assert.equal(item.send_result, undefined);
  assert.equal(actions.length, 1);
});

test("an expired in-flight send lease is reconciled instead of being reclaimed for another provider call", async () => {
  const approvedReply = "Thanks for contacting Pink Paisa.";
  const checksum = sha256(approvedReply);
  const item = saveable({
    _id: "expired-send",
    status: "SEND_PROCESSING",
    source_type: "COMMENT",
    external_object_id: "comment-expired",
    occurred_at: new Date("2026-08-24T09:00:00.000Z"),
    recommendation: { suggestedReply: approvedReply, sendAllowedAfterApproval: true },
    escalation: { required: false },
    approval: { status: "APPROVED", approved_by_admin_id: "admin-1", approved_at: new Date(), approved_reply: approvedReply, approved_reply_checksum: checksum },
    send_intent: {
      status: "PROCESSING",
      idempotency_key: "community:expired",
      approved_reply_checksum: checksum,
      provider_idempotency_key: "provider-expired",
      queued_at: new Date("2026-08-24T09:00:00.000Z"),
      claimed_at: new Date("2026-08-24T09:01:00.000Z"),
      claimed_by: "old-worker",
      claim_token: "old-claim-token",
      lease_expires_at: new Date("2026-08-24T09:03:00.000Z"),
      attempt_count: 1,
    },
  });
  let providerCalls = 0;
  let reconciliationActions = 0;
  const result = await processCommunityWorkflow({
    now: new Date("2026-08-24T10:00:00.000Z"),
    dependencies: {
      SocialCommunityItem: inMemoryCommunityModel([item]),
      SocialManualAction: {
        async findOneAndUpdate(_query, update) {
          reconciliationActions += 1;
          return update.$setOnInsert;
        },
      },
      SocialAuditLog: { async create(value) { return value; } },
      instagramGrowthService: { async replyToComment() { providerCalls += 1; } },
    },
  });
  assert.equal(providerCalls, 0);
  assert.equal(result.uncertain, 1);
  assert.equal(item.status, "SEND_UNCERTAIN");
  assert.equal(reconciliationActions, 1);
});

test("an administrator can reconcile SEND_UNCERTAIN only with an authoritative Meta reply ID and the linked action completes atomically", async () => {
  const approvedReply = "Thanks for contacting Pink Paisa.";
  const checksum = sha256(approvedReply);
  const item = saveable({
    _id: "uncertain-to-reconcile",
    status: "SEND_UNCERTAIN",
    source_type: "COMMENT",
    external_object_id: "incoming-comment-22",
    author_external_id: "recipient-22",
    recommendation: { suggestedReply: approvedReply, sendAllowedAfterApproval: true },
    escalation: { required: false },
    approval: {
      status: "APPROVED",
      approved_by_admin_id: "approver-1",
      approved_at: new Date("2026-08-24T09:00:00.000Z"),
      approved_reply: approvedReply,
      approved_reply_checksum: checksum,
    },
    send_intent: {
      status: "UNCERTAIN",
      idempotency_key: "community:reconcile",
      approved_reply_checksum: checksum,
      provider_idempotency_key: "provider-reconcile",
      queued_at: new Date("2026-08-24T09:00:00.000Z"),
      uncertain_at: new Date("2026-08-24T09:05:00.000Z"),
      last_error_code: "ETIMEDOUT",
      last_error_message: "Connection closed after delivery may have begun",
    },
  });
  const action = {
    _id: "reconciliation-action-1",
    action_key: `social-community-send-reconciliation:${item._id}:${checksum.slice(0, 16)}`,
    status: "OPEN",
  };
  const audits = [];
  const transaction = transactionStub();
  const ActionModel = {
    async findOneAndUpdate(query, update) {
      assert.equal(query.action_key, action.action_key);
      if (update.$setOnInsert) return action;
      if (!query.status.$in.includes(action.status)) return null;
      Object.assign(action, update.$set);
      return action;
    },
  };
  const dependencies = {
    SocialCommunityItem: inMemoryCommunityModel([item]),
    SocialManualAction: ActionModel,
    SocialAuditLog: { async create(value) { audits.push(...(Array.isArray(value) ? value : [value])); return value; } },
    startSession: transaction.startSession.bind(transaction),
  };

  await assert.rejects(
    () => reconcileUncertainCommunitySend(item._id, {
      actor: { _id: "reconciler-1" },
      externalReplyId: item.author_external_id,
      notes: "Checked Meta.",
      dependencies,
    }),
    (error) => error.code === "social_community_external_reply_id_not_authoritative",
  );
  assert.equal(item.status, "SEND_UNCERTAIN");

  const now = new Date("2026-08-24T10:00:00.000Z");
  const result = await reconcileUncertainCommunitySend(item._id, {
    actor: { _id: "reconciler-1" },
    externalReplyId: "meta-reply-9001",
    notes: "Confirmed the exact approved reply in the Instagram conversation and copied its Meta reply ID.",
    now,
    dependencies,
  });
  assert.equal(result.reused, false);
  assert.equal(transaction.runs, 2, "the rejected validation and successful mutation each use a transaction boundary");
  assert.equal(item.status, "SENT");
  assert.equal(item.send_intent.status, "CONFIRMED");
  assert.equal(item.send_intent.reconciliation_external_reply_id, "meta-reply-9001");
  assert.equal(item.send_result.external_reply_id, "meta-reply-9001");
  assert.equal(item.send_result.confirmation_source, "ADMIN_RECONCILIATION");
  assert.equal(action.status, "COMPLETED");
  assert.equal(action.completion_source, "ADMIN");
  assert.equal(action.resolution_evidence.provider_reference_id, "meta-reply-9001");
  assert.ok(audits.some((audit) => audit.action === "COMMUNITY_SEND_RECONCILED"));

  const repeated = await reconcileUncertainCommunitySend(item._id, {
    actor: { _id: "reconciler-1" },
    externalReplyId: "meta-reply-9001",
    notes: "Confirmed the exact approved reply in the Instagram conversation and copied its Meta reply ID.",
    dependencies,
  });
  assert.equal(repeated.reused, true);
  await assert.rejects(
    () => reconcileUncertainCommunitySend(item._id, {
      actor: { _id: "reconciler-1" },
      externalReplyId: "meta-reply-different",
      notes: "Different result.",
      dependencies,
    }),
    (error) => error.code === "social_community_reconciliation_conflict",
  );
});

test("escalations require noted acknowledgement before noted resolution and never gain a send action", async () => {
  const item = saveable({
    _id: "escalation-lifecycle-1",
    status: "ESCALATED",
    source_type: "DIRECT_MESSAGE",
    external_object_id: "sensitive-message-1",
    classification: "SENSITIVE",
    risk: { level: "HIGH", flags: ["sensitive"], rationale: "Specialist handling is required." },
    escalation: { required: true, reason: "Specialist handling is required.", recommended_at: new Date() },
    approval: { status: "PENDING" },
  });
  const audits = [];
  const dependencies = {
    SocialCommunityItem: inMemoryCommunityModel([item]),
    SocialAuditLog: { async create(value) { audits.push(...(Array.isArray(value) ? value : [value])); return value; } },
  };
  await assert.rejects(
    () => acknowledgeCommunityEscalation(item._id, { actor: { _id: "admin-1" }, notes: "", dependencies }),
    (error) => error.code === "social_community_notes_required",
  );
  await assert.rejects(
    () => resolveCommunityEscalation(item._id, { actor: { _id: "admin-1" }, notes: "Handled safely.", dependencies }),
    (error) => error.code === "social_community_escalation_acknowledgement_required",
  );

  const acknowledged = await acknowledgeCommunityEscalation(item._id, {
    actor: { _id: "admin-1" },
    notes: "Assigned to the customer-care specialist; no social reply will be sent.",
    now: new Date("2026-08-24T10:00:00.000Z"),
    dependencies,
  });
  assert.equal(acknowledged.reused, false);
  assert.equal(item.status, "ESCALATED");
  assert.equal(item.escalation.acknowledged_by_admin_id, "admin-1");
  assert.equal(item.send_intent, undefined);
  const acknowledgedAgain = await acknowledgeCommunityEscalation(item._id, {
    actor: { _id: "admin-2" },
    notes: "Assigned to the customer-care specialist; no social reply will be sent.",
    dependencies,
  });
  assert.equal(acknowledgedAgain.reused, true);

  const resolved = await resolveCommunityEscalation(item._id, {
    actor: { _id: "admin-2" },
    notes: "The specialist completed the offline support follow-up; archive without sending.",
    now: new Date("2026-08-24T11:00:00.000Z"),
    dependencies,
  });
  assert.equal(resolved.reused, false);
  assert.equal(item.status, "ARCHIVED");
  assert.equal(item.escalation.resolved_by_admin_id, "admin-2");
  assert.equal(item.send_result, undefined);
  assert.deepEqual(audits.map((audit) => audit.action), [
    "COMMUNITY_ESCALATION_ACKNOWLEDGED",
    "COMMUNITY_ESCALATION_RESOLVED",
  ]);
  const resolvedAgain = await resolveCommunityEscalation(item._id, {
    actor: { _id: "admin-2" },
    notes: "The specialist completed the offline support follow-up; archive without sending.",
    dependencies,
  });
  assert.equal(resolvedAgain.reused, true);
  assert.equal(audits.length, 2);
});

test("public community records expose explicit reconciliation and escalation UI actions", () => {
  const uncertain = publicCommunityItem({
    _id: "public-uncertain-1",
    status: "SEND_UNCERTAIN",
    escalation: { required: false },
    send_intent: { status: "UNCERTAIN", claim_token: "secret-claim", claimed_by: "worker-1" },
  });
  assert.equal(uncertain.available_actions.reconcile_send, true);
  assert.equal(uncertain.available_actions.acknowledge_escalation, false);
  assert.equal(uncertain.send_intent.claim_token, undefined);

  const escalation = publicCommunityItem({
    _id: "public-escalation-1",
    status: "ESCALATED",
    escalation: { required: true, reason: "Specialist review", acknowledged_at: new Date() },
  });
  assert.equal(escalation.escalation_state, "ACKNOWLEDGED");
  assert.equal(escalation.available_actions.acknowledge_escalation, false);
  assert.equal(escalation.available_actions.resolve_escalation, true);
});

test("legacy recommend and reject calls cannot overwrite terminal or in-flight community states", async () => {
  const blockedStatuses = [
    "RECOMMENDATION_QUEUED", "RECOMMENDATION_PROCESSING", "APPROVED", "SEND_QUEUED",
    "SEND_PROCESSING", "SEND_UNCERTAIN", "SENT", "RESPONDED", "REJECTED", "ESCALATED",
    "HIDDEN", "ARCHIVED", "FAILED", "MANUAL_ACTION_REQUIRED",
  ];
  let aiCalls = 0;
  let saves = 0;
  for (const status of blockedStatuses) {
    const item = saveable({
      _id: `blocked-${status}`,
      status,
      async save() { saves += 1; return this; },
    });
    const dependencies = {
      SocialCommunityItem: { async findById() { return item; } },
      callStructuredResponse: async () => { aiCalls += 1; return {}; },
    };
    await assert.rejects(
      () => recommendCommunityReply(item._id, { actor: { _id: "admin-1" }, dependencies }),
      (error) => error.code === "social_community_recommend_state_invalid" && error.statusCode === 409,
      `recommend should reject ${status}`,
    );
    await assert.rejects(
      () => rejectCommunityReply(item._id, "Do not send", { actor: { _id: "admin-1" }, dependencies }),
      (error) => error.code === "social_community_reject_state_invalid" && error.statusCode === 409,
      `reject should reject ${status}`,
    );
    assert.equal(item.status, status);
  }
  assert.equal(aiCalls, 0);
  assert.equal(saves, 0);
});

test("public send intent exposes durable state but redacts worker claim internals", () => {
  const value = publicSendIntent({
    status: "PROCESSING",
    idempotency_key: "safe-key",
    approved_reply_checksum: "a".repeat(64),
    claimed_by: "private-worker",
    claim_token: "private-token",
  });
  assert.equal(value.status, "PROCESSING");
  assert.equal(value.idempotency_key, "safe-key");
  assert.equal(value.claimed_by, undefined);
  assert.equal(value.claim_token, undefined);
});

test("model validation enforces matching exact-reply checksums for durable send states", async () => {
  const reply = "Thanks for asking.";
  const base = {
    external_event_id: "validation-event-1",
    provider: "META",
    source_type: "COMMENT",
    external_object_id: "validation-comment-1",
    occurred_at: new Date(),
    status: "SEND_QUEUED",
    recommendation: {
      classification: "QUESTION",
      suggestedReply: reply,
      confidence: 0.99,
      sourceInformationUsed: [],
      riskFlags: [],
      escalationRecommended: false,
      sendAllowedAfterApproval: true,
      conciseRationale: "Ordinary product-navigation question.",
      prompt_run: { agent_role: "COMMUNITY_REPLY", stage: "community_reply", provider: "openai" },
      generated_at: new Date(),
    },
    approval: {
      status: "APPROVED",
      approved_by_admin_id: "507f1f77bcf86cd799439011",
      approved_at: new Date(),
      approved_reply: reply,
      approved_reply_checksum: sha256(reply),
    },
    send_intent: {
      status: "QUEUED",
      idempotency_key: "validation-key-1",
      approved_reply_checksum: sha256(reply),
      provider_idempotency_key: "provider-validation-key-1",
      queued_at: new Date(),
    },
    escalation: { required: false },
  };
  await new SocialCommunityItem(base).validate();
  await assert.rejects(
    () => new SocialCommunityItem({
      ...base,
      external_event_id: "validation-event-2",
      external_object_id: "validation-comment-2",
      send_intent: { ...base.send_intent, idempotency_key: "validation-key-2", approved_reply_checksum: "b".repeat(64) },
    }).validate(),
    /matching approval and send-intent checksums/i,
  );
});

test("model validation preserves authoritative admin reconciliation and noted escalation provenance", async () => {
  const adminId = "507f1f77bcf86cd799439011";
  const reconcilerId = "507f191e810c19729de860ea";
  const reply = "Thanks for asking.";
  const checksum = sha256(reply);
  const reconciled = {
    external_event_id: "validation-reconciled-event",
    provider: "META",
    source_type: "COMMENT",
    external_object_id: "validation-incoming-comment",
    occurred_at: new Date(),
    status: "SENT",
    recommendation: {
      classification: "QUESTION",
      suggestedReply: reply,
      confidence: 0.99,
      sourceInformationUsed: [],
      riskFlags: [],
      escalationRecommended: false,
      sendAllowedAfterApproval: true,
      conciseRationale: "Ordinary question.",
      prompt_run: { agent_role: "COMMUNITY_REPLY", stage: "community_reply", provider: "openai" },
      generated_at: new Date(),
    },
    approval: {
      status: "APPROVED",
      approved_by_admin_id: adminId,
      approved_at: new Date(),
      approved_reply: reply,
      approved_reply_checksum: checksum,
    },
    send_intent: {
      status: "CONFIRMED",
      idempotency_key: "validation-reconciled-key",
      approved_reply_checksum: checksum,
      provider_idempotency_key: "validation-reconciled-provider-key",
      queued_at: new Date(),
      confirmed_at: new Date(),
      reconciled_at: new Date(),
      reconciled_by_admin_id: reconcilerId,
      reconciliation_manual_action_id: "507f1f77bcf86cd799439012",
      reconciliation_external_reply_id: "meta-reply-valid-1",
      reconciliation_notes: "Confirmed in Meta.",
    },
    send_result: {
      external_reply_id: "meta-reply-valid-1",
      sent_at: new Date(),
      sent_by_admin_id: adminId,
      confirmation_source: "ADMIN_RECONCILIATION",
      confirmed_by_admin_id: reconcilerId,
    },
    escalation: { required: false },
  };
  await new SocialCommunityItem(reconciled).validate();
  await assert.rejects(
    () => new SocialCommunityItem({
      ...reconciled,
      external_event_id: "validation-reconciled-event-invalid",
      external_object_id: "validation-incoming-comment-invalid",
      send_intent: { ...reconciled.send_intent, idempotency_key: "validation-reconciled-key-invalid" },
      send_result: { ...reconciled.send_result, confirmed_by_admin_id: null },
    }).validate(),
    /requires the reconciling administrator/i,
  );

  const escalated = {
    external_event_id: "validation-resolved-escalation",
    provider: "META",
    source_type: "DIRECT_MESSAGE",
    external_object_id: "validation-sensitive-message",
    occurred_at: new Date(),
    status: "ARCHIVED",
    classification: "SENSITIVE",
    approval: { status: "PENDING" },
    risk: { level: "HIGH", flags: ["sensitive"], rationale: "Specialist review." },
    escalation: {
      required: true,
      reason: "Specialist review.",
      recommended_at: new Date(),
      acknowledged_by_admin_id: adminId,
      acknowledged_at: new Date(),
      acknowledgement_notes: "Accepted by support.",
      resolved_by_admin_id: reconcilerId,
      resolved_at: new Date(),
      resolution_notes: "Support completed the offline follow-up.",
    },
  };
  await new SocialCommunityItem(escalated).validate();
  await assert.rejects(
    () => new SocialCommunityItem({
      ...escalated,
      external_event_id: "validation-resolved-escalation-invalid",
      external_object_id: "validation-sensitive-message-invalid",
      escalation: { ...escalated.escalation, acknowledged_at: null },
    }).validate(),
    /require prior acknowledgement/i,
  );
});
