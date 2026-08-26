const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const {
  processCommunityAutomation,
  _private: { enforceCommunityEscalation },
} = require("../services/social/socialGrowthTeamService");

function queryResult(rows) {
  return {
    sort() { return this; },
    async limit(value) { return rows.slice(0, value); },
  };
}

function auditModel() {
  return { create: async (value) => value };
}

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
      if ("$lte" in expected) return Number.isFinite(new Date(actual).getTime()) && new Date(actual) <= new Date(expected.$lte);
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

test("deterministic community policy escalates complaints and personalised medical or financial requests", () => {
  const base = {
    classification: "OTHER",
    suggestedReply: "Here is a quick answer.",
    confidence: 0.99,
    riskFlags: [],
    escalationRecommended: false,
    escalationReason: null,
    sendAllowedAfterApproval: true,
  };
  const complaint = enforceCommunityEscalation({ text: "I have a complaint about this product" }, base);
  assert.equal(complaint.escalationRecommended, true);
  assert.equal(complaint.sendAllowedAfterApproval, false);

  const advice = enforceCommunityEscalation({ text: "What should I invest in for my situation?" }, base);
  assert.equal(advice.escalationRecommended, true);
  assert.equal(advice.sendAllowedAfterApproval, false);

  const ordinary = enforceCommunityEscalation({ text: "Where can I find the calculator?" }, base);
  assert.equal(ordinary.escalationRecommended, false);
  assert.equal(ordinary.sendAllowedAfterApproval, true);

  const uncertain = enforceCommunityEscalation(
    { text: "Where can I find the calculator?" },
    { ...base, confidence: 0.55 },
  );
  assert.equal(uncertain.escalationRecommended, true);
  assert.equal(uncertain.sendAllowedAfterApproval, false);
});

test("auto-reply sends only a previously human-approved item and attributes the approving admin", async () => {
  const approvedReply = "Thanks for asking. You can find the verified resource on Pink Paisa.";
  const approvedItem = {
    _id: "approved-comment",
    source_type: "COMMENT",
    external_object_id: "comment-1",
    status: "APPROVED",
    approval: {
      status: "APPROVED",
      approved_by_admin_id: "admin-1",
      approved_at: new Date(),
      approved_reply: approvedReply,
      approved_reply_checksum: crypto.createHash("sha256").update(approvedReply).digest("hex"),
    },
    recommendation: {
      suggestedReply: approvedReply,
      sendAllowedAfterApproval: true,
    },
    async save() { return this; },
  };
  let replies = 0;
  const CommunityModel = {
    find(query) {
      if (query.status === "APPROVED") return queryResult([approvedItem]);
      return queryResult([]);
    },
    async findById(id) {
      return id === approvedItem._id ? approvedItem : null;
    },
    async findOneAndUpdate(query, update) {
      return matches(approvedItem, query) ? applyUpdate(approvedItem, update) : null;
    },
  };
  const result = await processCommunityAutomation({
    settings: { community: { enabled: true, auto_reply: true, auto_dm: false, auto_hide_spam: false } },
    dependencies: {
      SocialCommunityItem: CommunityModel,
      SocialAuditLog: auditModel(),
      instagramGrowthService: {
        async replyToComment({ commentId }) {
          replies += 1;
          assert.equal(commentId, "comment-1");
          return { id: "reply-1" };
        },
      },
    },
  });
  assert.equal(result.sent, 1);
  assert.equal(replies, 1);
  assert.equal(approvedItem.status, "SENT");
  assert.equal(approvedItem.send_result.sent_by_admin_id, "admin-1");
});

test("auto-DM remains off and automatic moderation hides only high-confidence non-escalated spam", async () => {
  const approvedDm = {
    _id: "approved-dm",
    source_type: "DIRECT_MESSAGE",
    external_object_id: "dm-1",
    author_external_id: "person-1",
    status: "APPROVED",
    approval: { status: "APPROVED", approved_by_admin_id: "admin-1", approved_at: new Date() },
    recommendation: { suggestedReply: "Thanks for writing.", sendAllowedAfterApproval: true },
    async save() { return this; },
  };
  const spam = {
    _id: "spam-comment",
    source_type: "COMMENT",
    external_object_id: "comment-spam",
    status: "NEEDS_REVIEW",
    classification: "SPAM",
    recommendation: { confidence: 0.96 },
    escalation: { required: false },
    async save() { return this; },
  };
  const CommunityModel = {
    find(query) {
      if (query.status === "APPROVED") return queryResult([approvedDm]);
      return queryResult([spam]);
    },
    async findById(id) {
      return id === approvedDm._id ? approvedDm : null;
    },
  };
  let messages = 0;
  let hidden = 0;
  const result = await processCommunityAutomation({
    settings: { community: { enabled: true, auto_reply: false, auto_dm: false, auto_hide_spam: true } },
    dependencies: {
      SocialCommunityItem: CommunityModel,
      SocialAuditLog: auditModel(),
      instagramGrowthService: {
        async sendMessage() { messages += 1; return { id: "message-1" }; },
        async hideComment({ commentId }) {
          hidden += 1;
          assert.equal(commentId, "comment-spam");
          return { success: true };
        },
      },
    },
  });
  assert.equal(messages, 0);
  assert.equal(hidden, 1);
  assert.equal(result.sent, 0);
  assert.equal(result.hidden, 1);
  assert.equal(spam.status, "HIDDEN");
});
