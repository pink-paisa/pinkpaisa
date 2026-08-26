const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");

process.env.JWT_SECRET = process.env.JWT_SECRET || "marketing-leads-test-secret-that-is-long-enough";

const MarketingLead = require("../models/MarketingLead");
const EmailOutbox = require("../models/EmailOutbox");
const {
  captureMarketingLead,
  normalizeLeadInput,
  unsubscribeMarketingLead,
} = require("../services/marketingLeadService");
const {
  buildRoadmapEmail,
  processNextEmailOutbox,
} = require("../services/emailOutboxService");
const {
  createMarketingUnsubscribeToken,
  verifyMarketingUnsubscribeToken,
} = require("../utils/marketingUnsubscribeToken");
const marketingLeadController = require("../controllers/marketingLeadController");
const { _private: analyticsPrivate } = require("../controllers/adminAnalyticsController");

function validBody(overrides = {}) {
  return {
    result_type: "ready-builder",
    first_name: "Asha",
    email: "asha@example.com",
    email_consent: true,
    whatsapp_consent: false,
    consent_version: "wealthness-roadmap-2026-08-26",
    attribution: {
      first_touch: { utm_source: "instagram", utm_campaign: "launch", captured_at: "2026-08-26T10:00:00.000Z" },
      last_touch: { utm_source: "email", utm_campaign: "quiz", captured_at: "2026-08-26T10:05:00.000Z" },
    },
    ...overrides,
  };
}

test("marketing lead schema stores result/contact/consent but has no raw-answer field", () => {
  assert.ok(MarketingLead.schema.path("result_type"));
  assert.ok(MarketingLead.schema.path("email_consent"));
  assert.ok(MarketingLead.schema.path("whatsapp_consent"));
  assert.equal(MarketingLead.schema.path("answers"), undefined);
  assert.equal(MarketingLead.schema.options.strict, "throw");
  const outboxIndexes = EmailOutbox.schema.indexes();
  assert.ok(outboxIndexes.some(([keys, options]) => keys.lead_id === 1 && keys.kind === 1 && keys.template_version === 1 && options.unique));
});

test("lead normalization rejects raw quiz answers and keeps channel consent separate", () => {
  assert.throws(
    () => normalizeLeadInput(validBody({ answers: [0, 1, 2] })),
    (error) => error.code === "marketing_raw_answers_forbidden",
  );
  assert.throws(
    () => normalizeLeadInput(validBody({ whatsapp_consent: true, phone: "" })),
    (error) => error.code === "marketing_whatsapp_phone_required",
  );
  const value = normalizeLeadInput(validBody({ phone: "+91 90000 00000" }), new Date("2026-08-26T11:00:00.000Z"));
  assert.equal(value.email_consent.granted, true);
  assert.equal(value.whatsapp_consent.granted, false);
  assert.equal(value.phone, null);
  assert.equal(value.attribution.first_touch.utm_source, "instagram");
  assert.equal(value.attribution.last_touch.utm_source, "email");
  assert.throws(
    () => normalizeLeadInput(validBody({ consent_version: "old-version" })),
    (error) => error.code === "marketing_consent_version_stale",
  );
});

test("idempotent replay repairs a missing roadmap outbox row", async () => {
  const prior = {
    _id: "64f000000000000000000001",
    email: "asha@example.com",
    result_type: "ready-builder",
    request_fingerprint: null,
    idempotency_key: "quiz-capture-1",
    idempotency_receipts: [],
  };
  const normalized = normalizeLeadInput(validBody(), new Date("2026-08-26T11:00:00.000Z"));
  const { fingerprintLeadInput } = require("../services/marketingLeadService");
  prior.request_fingerprint = fingerprintLeadInput(normalized);
  let enqueueCalls = 0;
  const result = await captureMarketingLead({
    body: validBody(),
    idempotencyKey: "quiz-capture-1",
    now: new Date("2026-08-26T11:00:00.000Z"),
    dependencies: {
      MarketingLead: { findOne: async (query) => query.$or ? prior : null },
      EmailOutbox: { findOne: async () => null },
      enqueueWealthnessRoadmap: async (lead) => {
        enqueueCalls += 1;
        return { _id: "outbox-1", lead_id: lead._id, status: "QUEUED" };
      },
    },
  });
  assert.equal(result.reused, true);
  assert.equal(result.outbox.status, "QUEUED");
  assert.equal(enqueueCalls, 1);
});

test("roadmap delivery is durable and marks SENT only on provider confirmation", async () => {
  const row = {
    _id: "64f000000000000000000011",
    lead_id: "64f000000000000000000012",
    recipient_email: "asha@example.com",
    payload: { first_name: "Asha", result_type: "ready-builder", unsubscribe_token: "signed-token" },
    attempt_count: 1,
    max_attempts: 5,
    status: "PROCESSING",
    async save() { return this; },
  };
  const result = await processNextEmailOutbox({
    EmailOutbox: { findOneAndUpdate: async () => row },
    MarketingLead: {
      findById: () => ({ lean: async () => ({ status: "NEW", email_consent: { granted: true } }) }),
    },
    sendEmail: async () => ({ delivered: true, message_id: "smtp-message-1" }),
  });
  assert.equal(result.status, "SENT");
  assert.equal(result.provider_message_id, "smtp-message-1");
  assert.ok(result.delivered_at instanceof Date);
});

test("roadmap copy includes an unsubscribe link without exposing token in admin lead output", () => {
  const lead = { _id: "64f000000000000000000022", email: "asha@example.com" };
  const token = createMarketingUnsubscribeToken(lead);
  assert.deepEqual(verifyMarketingUnsubscribeToken(token), { lead_id: String(lead._id) });
  const encodedPayload = token.split(".")[0];
  const decodedPayload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  assert.equal(Object.hasOwn(decodedPayload, "email"), false);
  assert.equal(JSON.stringify(decodedPayload).includes(lead.email), false);
  const message = buildRoadmapEmail({ payload: { result_type: "ready-builder", first_name: "Asha", unsubscribe_token: token } });
  assert.match(message.text, /Unsubscribe:/);
  assert.match(message.html, /unsubscribe\?token=/);
  const adminValue = marketingLeadController._private.adminLead({
    ...lead,
    source: "WEALTHNESS_QUIZ",
    result_type: "ready-builder",
    status: "NEW",
    email_consent: { granted: true },
    whatsapp_consent: { granted: false },
  });
  assert.equal(Object.prototype.hasOwnProperty.call(adminValue, "unsubscribe_token"), false);
  assert.equal(JSON.stringify(adminValue).includes(token), false);
});

test("legacy unsubscribe links remain valid without trusting or returning embedded email PII", async () => {
  const leadId = "64f000000000000000000023";
  const legacyBody = Buffer.from(JSON.stringify({
    v: 1,
    lead_id: leadId,
    email: "legacy@example.com",
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", process.env.JWT_SECRET).update(legacyBody).digest("base64url");
  const legacyToken = `${legacyBody}.${signature}`;
  assert.deepEqual(verifyMarketingUnsubscribeToken(legacyToken), { lead_id: leadId });

  const lead = {
    _id: leadId,
    status: "NEW",
    email_consent: { granted: true },
    whatsapp_consent: { granted: false },
    async save() { return this; },
  };
  let lookup = null;
  const result = await unsubscribeMarketingLead(legacyToken, {
    MarketingLead: {
      async findOne(query) {
        lookup = query;
        return lead;
      },
    },
    EmailOutbox: { updateMany: async () => ({ modifiedCount: 0 }) },
  });
  assert.deepEqual(lookup, { _id: leadId });
  assert.equal(result.lead.status, "UNSUBSCRIBED");
});

test("monetisation funnel reports authoritative stages and leaves unavailable analytics unknown", () => {
  const funnel = analyticsPrivate.buildMonetisationFunnel({
    instagramReach: null,
    marketingLeads: 12,
    affiliateHandoffs: 31,
    amazonRows: 0,
    amazonCommission: 0,
  });
  const byKey = Object.fromEntries(funnel.stages.map((stage) => [stage.key, stage]));
  assert.equal(byKey.instagram_reach.value, null);
  assert.equal(byKey.start_here_visit.status, "unavailable");
  assert.equal(byKey.quiz_completion.value, null);
  assert.equal(byKey.lead.value, 12);
  assert.equal(byKey.affiliate_handoff.value, 31);
  assert.equal(byKey.imported_commission.value, null);
  assert.match(byKey.imported_commission.note, /Unknown until/);

  const imported = analyticsPrivate.buildMonetisationFunnel({
    instagramReach: 2000,
    marketingLeads: 12,
    affiliateHandoffs: 31,
    amazonRows: 4,
    amazonCommission: 725.5,
  });
  const commission = imported.stages.find((stage) => stage.key === "imported_commission");
  assert.equal(commission.status, "available");
  assert.equal(commission.value, 725.5);
});

test("monetisation funnel reads covered GA4 landing and quiz aggregates without inventing missing data", () => {
  const range = analyticsPrivate.parseDateRange("2026-08-01", "2026-08-31");
  const metrics = analyticsPrivate.extractGa4FunnelMetrics({
    period_start: new Date("2026-08-01T00:00:00.000Z"),
    period_end: new Date("2026-08-31T23:59:59.999Z"),
    window: "2026-08-01/2026-08-31",
    metrics: { website_sessions: 30, quiz_completions: 4 },
    dimensions: {
      attribution_rows: [
        { date: "20260810", landing_page: "/start-here?utm_source=instagram", metrics: { website_sessions: 9 } },
        { date: "20260810", landing_page: "/quiz", metrics: { website_sessions: 3 } },
      ],
      conversion_event_rows: [
        { date: "20260810", event_name: "quiz_complete", metrics: { event_count: 4 } },
        { date: "20260810", event_name: "workshop_enquiry", metrics: { event_count: 1 } },
      ],
    },
  }, range);
  assert.deepEqual(metrics, {
    startHereVisits: 9,
    quizCompletions: 4,
    ga4Window: "2026-08-01/2026-08-31",
  });

  const funnel = analyticsPrivate.buildMonetisationFunnel({
    instagramReach: 1000,
    ...metrics,
    marketingLeads: 2,
    affiliateHandoffs: 3,
    amazonRows: 0,
    amazonCommission: 0,
  });
  const byKey = Object.fromEntries(funnel.stages.map((stage) => [stage.key, stage]));
  assert.equal(byKey.start_here_visit.value, 9);
  assert.equal(byKey.start_here_visit.status, "available");
  assert.equal(byKey.quiz_completion.value, 4);
  assert.equal(byKey.quiz_completion.status, "available");

  assert.deepEqual(analyticsPrivate.extractGa4FunnelMetrics({
    period_start: new Date("2026-08-10T00:00:00.000Z"),
    period_end: new Date("2026-08-20T23:59:59.999Z"),
    window: "partial",
    metrics: { quiz_completions: 99 },
    dimensions: { attribution_rows: [], conversion_event_rows: [] },
  }, range), { startHereVisits: null, quizCompletions: null, ga4Window: null });
});

test("order analytics count authoritative paid lifecycle states and subtract partial refunds", () => {
  assert.deepEqual(analyticsPrivate.AUTHORITATIVE_PAID_ORDER_STATES, [
    "paid",
    "hold",
    "released_to_vendor",
    "partially_refunded",
  ]);
  const createdAt = { createdAt: { $gte: new Date("2026-08-01T00:00:00.000Z") } };
  const pipeline = analyticsPrivate.buildOrderAnalyticsPipeline(createdAt);
  assert.deepEqual(pipeline[0], { $match: createdAt });
  const group = pipeline[1].$group;
  assert.deepEqual(group.paid_orders.$sum.$cond[0], {
    $in: ["$payment_status", analyticsPrivate.AUTHORITATIVE_PAID_ORDER_STATES],
  });
  assert.deepEqual(group.order_revenue.$sum.$cond, [
    { $in: ["$payment_status", analyticsPrivate.AUTHORITATIVE_PAID_ORDER_STATES] },
    {
      $max: [
        {
          $subtract: [
            { $ifNull: ["$total", 0] },
            { $ifNull: ["$refunded_amount", 0] },
          ],
        },
        0,
      ],
    },
    0,
  ]);
  assert.equal(analyticsPrivate.AUTHORITATIVE_PAID_ORDER_STATES.includes("pending"), false);
  assert.equal(analyticsPrivate.AUTHORITATIVE_PAID_ORDER_STATES.includes("refunded"), false);
});

test("Instagram funnel cohorts require exact organic-social attribution", () => {
  const leadMatch = analyticsPrivate.buildInstagramOrganicLeadMatch({ campaign: "launch" });
  assert.equal(leadMatch.campaign, "launch");
  for (const touch of ["first_touch", "last_touch"]) {
    const branch = leadMatch.$or.find((entry) => Object.hasOwn(entry, `attribution.${touch}.utm_source`));
    assert.ok(branch);
    assert.equal(branch[`attribution.${touch}.utm_source`].test("instagram"), true);
    assert.equal(branch[`attribution.${touch}.utm_source`].test("Instagram"), true);
    assert.equal(branch[`attribution.${touch}.utm_source`].test("instagram_ads"), false);
    assert.equal(branch[`attribution.${touch}.utm_source`].test("notinstagram"), false);
    assert.equal(branch[`attribution.${touch}.utm_medium`].test("organic_social"), true);
    assert.equal(branch[`attribution.${touch}.utm_medium`].test("paid_social"), false);
  }

  const eventMatch = analyticsPrivate.buildInstagramOrganicEventMatch({}, {
    is_bot: false,
    event_type: "outbound_click",
  });
  assert.equal(eventMatch.utm_source.test("instagram"), true);
  assert.equal(eventMatch.utm_source.test("instagram_ads"), false);
  assert.equal(eventMatch.utm_source.test("notinstagram"), false);
  assert.equal(eventMatch.utm_medium.test("organic_social"), true);
  assert.equal(eventMatch.utm_medium.test("social"), false);
});
