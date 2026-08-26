const test = require("node:test");
const assert = require("node:assert/strict");

const { collectDueInstagramMetricSnapshots } = require("../services/social/socialMetricCollectionService");
const { processCommunityAutomation } = require("../services/social/socialGrowthTeamService");
const {
  logSocialCommunityAutomationResult,
  logSocialMetricCollectionResult,
} = require("../services/dailyBatchScheduler");

function queryRows(rows) {
  return {
    sort() { return this; },
    limit(value) { return Promise.resolve(rows.slice(0, value)); },
  };
}

function durableFailureModels({ healthUpdates, actions, audits }) {
  return {
    SocialConnectionHealth: {
      async findOneAndUpdate(query, update, options) {
        healthUpdates.push({ query, update, options });
        return { _id: "instagram-health" };
      },
    },
    SocialManualAction: {
      async findOneAndUpdate(query, update, options) {
        const row = { _id: `action-${actions.length + 1}`, ...update.$setOnInsert };
        actions.push({ query, update, options, row });
        return row;
      },
    },
    SocialAuditLog: {
      async create(row) {
        const audit = { _id: `audit-${audits.length + 1}`, ...row };
        audits.push(audit);
        return audit;
      },
    },
  };
}

test("Instagram metric provider failures persist linked health, manual-action, and audit records", async () => {
  const now = new Date("2026-08-23T08:00:00.000Z");
  const publication = {
    _id: "publication-1",
    draft_id: "draft-1",
    status: "PUBLISHED",
    external_publication_id: "instagram-media-1",
    published_at: new Date("2026-08-23T06:00:00.000Z"),
  };
  const healthUpdates = [];
  const actions = [];
  const audits = [];
  const dependencies = {
    ...durableFailureModels({ healthUpdates, actions, audits }),
    SocialPublication: { find: () => queryRows([publication]) },
    SocialMetricSnapshot: { exists: async () => false },
    SocialPostDraft: { findById: () => { throw new Error("failed collection must not load a draft package"); } },
    instagramGrowthService: {
      async getMediaInsights() {
        const error = new Error("Meta rejected request access_token=should-not-be-persisted");
        error.code = "META_PERMISSION_DENIED";
        throw error;
      },
    },
  };

  const result = await collectDueInstagramMetricSnapshots({
    now,
    settings: { analytics: { snapshot_intervals_hours: [1] } },
    dependencies,
  });

  assert.equal(result.collected, 0);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].durability, "PERSISTED");
  assert.equal(result.failures[0].manual_action_id, "action-1");
  assert.equal(result.failures[0].connection_health_id, "instagram-health");
  assert.equal(healthUpdates.length, 1);
  assert.equal(healthUpdates[0].query.provider, "INSTAGRAM");
  assert.equal(healthUpdates[0].update.$set.status, "ERROR");
  assert.equal(healthUpdates[0].update.$inc.consecutive_failures, 1);
  assert.equal(healthUpdates[0].update.$push.checks.$each[0].entity_id, "publication-1");
  assert.equal(healthUpdates[0].update.$push.checks.$slice, -50);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].row.action_type, "PERMISSION_REVIEW");
  assert.equal(actions[0].row.draft_id, "draft-1");
  assert.equal(actions[0].row.publication_id, "publication-1");
  assert.equal(actions[0].row.connection_health_id, "instagram-health");
  assert.equal(audits.length, 1);
  assert.equal(audits[0].entity_type, "PUBLICATION");
  assert.equal(audits[0].publication_id, "publication-1");
  assert.equal(audits[0].metadata.manual_action_id, "action-1");
  assert.equal(audits[0].metadata.connection_health_id, "instagram-health");
  assert.doesNotMatch(JSON.stringify({ result, healthUpdates, actions, audits }), /should-not-be-persisted/);
});

test("community send and moderation failures persist distinct linked admin work", async () => {
  const now = new Date("2026-08-23T08:00:00.000Z");
  const approved = {
    _id: "community-approved",
    provider: "META",
    source_type: "COMMENT",
    external_object_id: "comment-approved",
    status: "APPROVED",
    approval: { status: "APPROVED", approved_by_admin_id: "admin-1", approved_at: now },
    recommendation: { suggestedReply: "Thanks for asking.", sendAllowedAfterApproval: true },
    async save() { return this; },
  };
  const spam = {
    _id: "community-spam",
    provider: "META",
    source_type: "COMMENT",
    external_object_id: "comment-spam",
    status: "NEEDS_REVIEW",
    classification: "SPAM",
    recommendation: { confidence: 0.98 },
    escalation: { required: false },
    async save() { return this; },
  };
  const healthUpdates = [];
  const actions = [];
  const audits = [];
  const CommunityModel = {
    find(query) {
      if (query.status === "APPROVED") return queryRows([approved]);
      if (query.classification === "SPAM") return queryRows([spam]);
      return queryRows([]);
    },
    async findById(id) {
      return id === approved._id ? approved : null;
    },
  };
  const dependencies = {
    ...durableFailureModels({ healthUpdates, actions, audits }),
    SocialCommunityItem: CommunityModel,
    instagramGrowthService: {
      async replyToComment() {
        const error = new Error("Instagram reply request failed");
        error.code = "META_REPLY_FAILED";
        throw error;
      },
      async hideComment() {
        const error = new Error("Instagram moderation request failed");
        error.code = "META_HIDE_FAILED";
        throw error;
      },
    },
  };

  const result = await processCommunityAutomation({
    now,
    settings: { community: { enabled: true, auto_reply: true, auto_dm: false, auto_hide_spam: true } },
    dependencies,
  });

  assert.deepEqual({ sent: result.sent, hidden: result.hidden, failed: result.failed }, { sent: 0, hidden: 0, failed: 2 });
  assert.equal(result.failures.length, 2);
  assert.ok(result.failures.every((failure) => failure.durability === "PERSISTED"));
  assert.deepEqual(result.failures.map((failure) => failure.operation), ["SEND_APPROVED_REPLY", "HIDE_SPAM"]);
  assert.equal(healthUpdates.length, 2);
  assert.deepEqual(actions.map(({ row }) => row.action_type), ["COMMUNITY_REPLY", "META_NATIVE_INTERACTION"]);
  assert.deepEqual(actions.map(({ row }) => row.community_item_id), ["community-approved", "community-spam"]);
  assert.ok(actions.every(({ row }) => row.connection_health_id === "instagram-health"));
  assert.equal(audits.length, 2);
  assert.ok(audits.every((audit) => audit.entity_type === "COMMUNITY_ITEM" && audit.action_status === "FAILED"));
  assert.deepEqual(audits.map((audit) => audit.metadata.manual_action_id), ["action-1", "action-2"]);
});

test("daily scheduler result inspectors log returned durable and persistence failures", () => {
  const calls = [];
  const fakeLogger = {
    error(context, message) { calls.push({ context, message }); },
  };
  logSocialMetricCollectionResult({
    collected: 1,
    skipped: 2,
    failures: [
      { publication_id: "publication-1", durability: "PERSISTED" },
      { publication_id: "publication-2", durability: "PERSISTENCE_FAILED" },
    ],
  }, fakeLogger);
  logSocialCommunityAutomationResult({
    sent: 1,
    hidden: 0,
    failed: 1,
    failures: [{ item_id: "community-1", durability: "PERSISTED" }],
  }, fakeLogger);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].context.failure_count, 2);
  assert.equal(calls[0].context.persistence_failure_count, 1);
  assert.match(calls[0].message, /metric snapshot failures require admin action/);
  assert.equal(calls[1].context.failed, 1);
  assert.equal(calls[1].context.persistence_failure_count, 0);
  assert.match(calls[1].message, /community automation failures require admin action/);
});
