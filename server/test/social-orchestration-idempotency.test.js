const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const SocialOrchestrationReceipt = require("../models/SocialOrchestrationReceipt");
const {
  SOCIAL_ORCHESTRATION_SIGNATURE_CONTEXT,
  buildSocialOrchestrationCanonicalMessage,
  buildSocialOrchestrationDeliveryFingerprint,
  buildSocialOrchestrationSignature,
} = require("../middleware/socialOrchestrationAuth");
const {
  executeIdempotentSocialOrchestration,
  requestHash,
} = require("../services/social/socialOrchestrationIdempotency");
const {
  _private: { rejectSignedWeeklyForce },
} = require("../controllers/socialOrchestrationController");
const { INDEX_MODELS } = require("../scripts/migrate/social-growth-team");

function duplicateKeyError() {
  const error = new Error("duplicate key");
  error.code = 11000;
  return error;
}

function comparable(value) {
  return value instanceof Date ? value.getTime() : value;
}

function matchesValue(actual, expected) {
  if (expected && typeof expected === "object" && !(expected instanceof Date) && !Array.isArray(expected)) {
    if (Object.hasOwn(expected, "$lte")) return comparable(actual) <= comparable(expected.$lte);
  }
  if (Array.isArray(actual) && !Array.isArray(expected)) return actual.includes(expected);
  return comparable(actual) === comparable(expected);
}

function matches(row, query) {
  return Object.entries(query).every(([field, expected]) => {
    if (field === "$or") return expected.some((branch) => matches(row, branch));
    return matchesValue(row[field], expected);
  });
}

function applyUpdate(row, update) {
  if (update.$set) Object.assign(row, update.$set);
  for (const [field, amount] of Object.entries(update.$inc || {})) {
    row[field] = Number(row[field] || 0) + Number(amount);
  }
}

function createReceiptModel() {
  const rows = [];
  let sequence = 0;
  const model = {
    rows,
    async create(value) {
      const duplicateOperationKey = rows.some((row) => (
        row.operation === value.operation && row.idempotency_key === value.idempotency_key
      ));
      const duplicateDelivery = rows.some((row) => (
        row.signed_delivery_fingerprints.some((fingerprint) => value.signed_delivery_fingerprints.includes(fingerprint))
      ));
      if (duplicateOperationKey || duplicateDelivery) throw duplicateKeyError();
      const row = { _id: `receipt-${++sequence}`, ...value };
      rows.push(row);
      return row;
    },
    async findOne(query) {
      return rows.find((row) => matches(row, query)) || null;
    },
    async findOneAndUpdate(query, update) {
      const row = rows.find((candidate) => matches(candidate, query));
      if (!row) return null;
      for (const [field, value] of Object.entries(update.$addToSet || {})) {
        const duplicateDelivery = rows.some((candidate) => (
          candidate !== row
          && Array.isArray(candidate[field])
          && candidate[field].includes(value)
        ));
        if (duplicateDelivery) throw duplicateKeyError();
        if (!row[field].includes(value)) row[field].push(value);
      }
      applyUpdate(row, update);
      return row;
    },
    async updateOne(query, update) {
      const row = rows.find((candidate) => matches(candidate, query));
      if (!row) return { matchedCount: 0, modifiedCount: 0 };
      applyUpdate(row, update);
      return { matchedCount: 1, modifiedCount: 1 };
    },
  };
  return model;
}

function signedRequest(body, timestamp = "1787443200", signing = {}) {
  const rawBody = Buffer.from(JSON.stringify(body));
  const method = signing.method || "POST";
  const path = signing.path || "/api/social-media-manager/orchestration/weekly-plan";
  const operation = signing.operation || "WEEKLY_PLAN";
  const idempotencyKey = signing.idempotencyKey || "weekly:2026-08-24";
  const signature = buildSocialOrchestrationSignature({
    method,
    path,
    operation,
    idempotencyKey,
    timestamp,
    rawBody,
    secret: "test-orchestration-secret",
  });
  return {
    deliveryFingerprint: buildSocialOrchestrationDeliveryFingerprint({ timestamp, rawBody, signature }),
    rawBody,
    requestTimestamp: Number(timestamp),
  };
}

function dependencies(ReceiptModel, nowValue = () => new Date("2026-08-23T12:00:00.000Z")) {
  let uuid = 0;
  return {
    SocialOrchestrationReceipt: ReceiptModel,
    disableHeartbeat: true,
    hostname: () => "idempotency-test",
    leaseMs: 60 * 1000,
    now: nowValue,
    randomUUID: () => `execution-${++uuid}`,
  };
}

function executeRequest({
  ReceiptModel,
  operation = "WEEKLY_PLAN",
  idempotencyKey = "weekly:2026-08-24",
  request = signedRequest({ source: "n8n", trigger: "weekly_plan" }),
  execute,
  now,
}) {
  return executeIdempotentSocialOrchestration({
    operation,
    idempotencyKey,
    ...request,
    execute,
    dependencies: dependencies(ReceiptModel, now),
  });
}

test("versioned orchestration signatures bind the method, path, operation, key, timestamp, and exact body", () => {
  const base = {
    method: "POST",
    path: "/api/social-media-manager/orchestration/weekly-plan",
    operation: "WEEKLY_PLAN",
    idempotencyKey: "weekly:2026-08-24",
    timestamp: "1787443200",
    rawBody: Buffer.from('{"source":"n8n","trigger":"weekly_schedule","force":false}'),
    secret: "canonical-signature-test-secret",
  };
  const canonical = buildSocialOrchestrationCanonicalMessage(base);
  assert.equal(canonical.toString("utf8"), [
    SOCIAL_ORCHESTRATION_SIGNATURE_CONTEXT,
    base.method,
    base.path,
    base.operation,
    base.idempotencyKey,
    base.timestamp,
    base.rawBody.toString("utf8"),
  ].join("\n"));
  const expectedDigest = crypto.createHmac("sha256", base.secret).update(canonical).digest("hex");
  const signature = buildSocialOrchestrationSignature(base);
  assert.equal(signature, `v1=sha256=${expectedDigest}`);

  const mutations = [
    { ...base, idempotencyKey: "weekly:2026-08-31" },
    { ...base, timestamp: "1787443201" },
    { ...base, rawBody: Buffer.from('{"source":"n8n","trigger":"weekly_schedule","force":true}') },
    {
      ...base,
      path: "/api/social-media-manager/orchestration/metrics",
      operation: "METRICS",
    },
  ];
  mutations.forEach((request) => assert.notEqual(buildSocialOrchestrationSignature(request), signature));
  assert.throws(
    () => buildSocialOrchestrationSignature({ ...base, method: "GET" }),
    /canonical Social orchestration request/i,
  );
  assert.throws(
    () => buildSocialOrchestrationSignature({ ...base, operation: "METRICS" }),
    /canonical Social orchestration request/i,
  );
});

test("inactive n8n exports implement the same credential-free canonical signature contract", () => {
  const exports = [
    ["pink-paisa-weekly-plan-trigger.json", "/api/social-media-manager/orchestration/weekly-plan", "WEEKLY_PLAN"],
    ["pink-paisa-prepublication-trigger.json", "/api/social-media-manager/orchestration/prepublication", "PREPUBLICATION"],
    ["pink-paisa-metric-refresh-and-failure-alert.json", "/api/social-media-manager/orchestration/metrics", "METRICS"],
  ];
  for (const [filename, canonicalPath, operation] of exports) {
    const workflow = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "..", "deploy", "n8n", filename), "utf8"));
    const signer = workflow.nodes.find((node) => node.name === "Sign Canonical Request v1");
    const request = workflow.nodes.find((node) => node.type === "n8n-nodes-base.httpRequest"
      && String(node.parameters?.url || "").includes(canonicalPath));
    const signatureHeader = request?.parameters?.headerParameters?.parameters
      ?.find((header) => header.name === "X-Pink-Paisa-Signature");
    assert.equal(workflow.active, false);
    assert.equal(
      signer?.parameters?.value,
      `={{ ['${SOCIAL_ORCHESTRATION_SIGNATURE_CONTEXT}', 'POST', '${canonicalPath}', '${operation}', $json.idempotency_key, $json.timestamp, $json.request_body].join('\\n') }}`,
    );
    assert.equal(signatureHeader?.value, "={{ 'v1=sha256=' + $json.signature_hex }}");
    assert.doesNotMatch(JSON.stringify(workflow), /"credentials"\s*:/);
  }
});

test("orchestration receipt schema has endpoint-key and global signed-delivery unique indexes", () => {
  const indexes = SocialOrchestrationReceipt.schema.indexes();
  const operationKey = indexes.find(([fields]) => (
    fields.operation === 1 && fields.idempotency_key === 1
  ));
  const delivery = indexes.find(([fields]) => fields.signed_delivery_fingerprints === 1);
  assert.equal(operationKey?.[1]?.unique, true);
  assert.equal(delivery?.[1]?.unique, true);
  assert.ok(INDEX_MODELS.includes(SocialOrchestrationReceipt));
});

test("completed orchestration responses are durably replayed without executing twice", async () => {
  const ReceiptModel = createReceiptModel();
  const request = signedRequest({ source: "n8n", trigger: "weekly_plan" });
  let executions = 0;
  const execute = async () => {
    executions += 1;
    return { statusCode: 202, body: { accepted: true, plan_id: "plan-1" } };
  };

  const first = await executeRequest({ ReceiptModel, request, execute });
  const replay = await executeRequest({ ReceiptModel, request, execute });
  const newlySignedReplay = await executeRequest({
    ReceiptModel,
    request: signedRequest({ source: "n8n", trigger: "weekly_plan" }, "1787443201"),
    execute,
  });

  assert.equal(first.statusCode, 202);
  assert.equal(first.replayed, false);
  assert.deepEqual(replay.body, first.body);
  assert.equal(replay.statusCode, 202);
  assert.equal(replay.replayed, true);
  assert.equal(newlySignedReplay.replayed, true);
  assert.equal(executions, 1);
  assert.equal(ReceiptModel.rows.length, 1);
  assert.equal(ReceiptModel.rows[0].signed_delivery_fingerprints.length, 2);
});

test("an active endpoint request returns a state conflict while the single owner executes", async () => {
  const ReceiptModel = createReceiptModel();
  const request = signedRequest({ source: "n8n", trigger: "prepublication" });
  let releaseExecution;
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const executionGate = new Promise((resolve) => { releaseExecution = resolve; });
  let executions = 0;
  const execute = async () => {
    executions += 1;
    markStarted();
    await executionGate;
    return { statusCode: 200, body: { accepted: true, produced: 1 } };
  };

  const firstPromise = executeRequest({
    ReceiptModel,
    operation: "PREPUBLICATION",
    idempotencyKey: "prepublication:2026-08-23T17",
    request,
    execute,
  });
  await started;
  const concurrent = await executeRequest({
    ReceiptModel,
    operation: "PREPUBLICATION",
    idempotencyKey: "prepublication:2026-08-23T17",
    request,
    execute,
  });
  releaseExecution();
  const first = await firstPromise;

  assert.equal(first.statusCode, 200);
  assert.equal(concurrent.statusCode, 409);
  assert.equal(concurrent.body.code, "social_orchestration_idempotency_in_progress");
  assert.ok(concurrent.retryAfterSeconds >= 1);
  assert.equal(executions, 1);
});

test("same endpoint key with a different body conflicts and permanently reserves that signed delivery", async () => {
  const ReceiptModel = createReceiptModel();
  const original = signedRequest({ source: "n8n", trigger: "weekly_plan" }, "1787443200");
  const altered = signedRequest({ source: "n8n", trigger: "weekly_plan", unexpected: true }, "1787443201");
  let executions = 0;

  await executeRequest({
    ReceiptModel,
    request: original,
    execute: async () => {
      executions += 1;
      return { statusCode: 202, body: { accepted: true } };
    },
  });
  const conflict = await executeRequest({
    ReceiptModel,
    request: altered,
    execute: async () => {
      executions += 1;
      return { statusCode: 202, body: { accepted: true } };
    },
  });
  const crossRouteReplay = await executeRequest({
    ReceiptModel,
    operation: "METRICS",
    idempotencyKey: "metrics:captured-delivery",
    request: altered,
    execute: async () => {
      executions += 1;
      return { statusCode: 200, body: { accepted: true } };
    },
  });

  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.body.code, "social_orchestration_idempotency_conflict");
  assert.equal(crossRouteReplay.statusCode, 409);
  assert.equal(crossRouteReplay.body.code, "social_orchestration_delivery_replay");
  assert.equal(ReceiptModel.rows[0].signed_delivery_fingerprints.length, 2);
  assert.equal(executions, 1);
});

test("a verified delivery cannot be replayed under another key or route", async () => {
  const ReceiptModel = createReceiptModel();
  const request = signedRequest({ source: "n8n", trigger: "metric_refresh" });
  let executions = 0;
  const execute = async () => {
    executions += 1;
    return { statusCode: 200, body: { accepted: true } };
  };

  await executeRequest({
    ReceiptModel,
    operation: "METRICS",
    idempotencyKey: "metrics:bucket-1",
    request,
    execute,
  });
  const otherKey = await executeRequest({
    ReceiptModel,
    operation: "METRICS",
    idempotencyKey: "metrics:bucket-2",
    request,
    execute,
  });
  const otherRoute = await executeRequest({
    ReceiptModel,
    operation: "PREPUBLICATION",
    idempotencyKey: "prepublication:bucket-1",
    request,
    execute,
  });

  assert.equal(otherKey.body.code, "social_orchestration_delivery_replay");
  assert.equal(otherRoute.body.code, "social_orchestration_delivery_replay");
  assert.equal(executions, 1);
});

test("retryable metric failures reclaim the same durable receipt and later replay success", async () => {
  const ReceiptModel = createReceiptModel();
  const request = signedRequest({ source: "n8n", trigger: "metric_refresh" });
  let executions = 0;
  const execute = async () => {
    executions += 1;
    if (executions === 1) {
      const error = new Error("Temporary analytics provider outage");
      error.code = "analytics_temporarily_unavailable";
      error.statusCode = 503;
      throw error;
    }
    return { statusCode: 200, body: { accepted: true, aggregate: { saved: 1 }, instagram: { saved: 2 } } };
  };

  const failed = await executeRequest({
    ReceiptModel,
    operation: "METRICS",
    idempotencyKey: "metrics:bucket-1",
    request,
    execute,
  });
  const retried = await executeRequest({
    ReceiptModel,
    operation: "METRICS",
    idempotencyKey: "metrics:bucket-1",
    request,
    execute,
  });
  const replay = await executeRequest({
    ReceiptModel,
    operation: "METRICS",
    idempotencyKey: "metrics:bucket-1",
    request,
    execute,
  });

  assert.equal(failed.statusCode, 503);
  assert.equal(failed.replayed, false);
  assert.equal(retried.statusCode, 200);
  assert.equal(retried.attemptCount, 2);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.body, retried.body);
  assert.equal(executions, 2);
  assert.equal(ReceiptModel.rows[0].attempt_count, 2);
});

test("non-retryable failures replay exactly and signed weekly force is rejected deterministically", async () => {
  const ReceiptModel = createReceiptModel();
  const request = signedRequest({ source: "n8n", trigger: "weekly_plan", force: true });
  const forceRejection = rejectSignedWeeklyForce({ force: true });
  let executions = 0;
  const execute = async () => {
    executions += 1;
    return forceRejection;
  };

  const first = await executeRequest({ ReceiptModel, request, execute });
  const replay = await executeRequest({ ReceiptModel, request, execute });

  assert.equal(rejectSignedWeeklyForce({ force: false }), null);
  assert.equal(first.statusCode, 400);
  assert.equal(first.body.code, "social_orchestration_force_not_allowed");
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.body, first.body);
  assert.equal(executions, 1);
});

test("an expired execution lease can be reclaimed with an incremented attempt", async () => {
  const ReceiptModel = createReceiptModel();
  const request = signedRequest({ source: "n8n", trigger: "prepublication" });
  ReceiptModel.rows.push({
    _id: "receipt-stale",
    operation: "PREPUBLICATION",
    idempotency_key: "prepublication:stale",
    request_hash: requestHash(request.rawBody),
    signed_delivery_fingerprints: [request.deliveryFingerprint],
    request_timestamp: request.requestTimestamp,
    status: "PROCESSING",
    attempt_count: 1,
    retryable: false,
    response_status: null,
    response_body: null,
    lease_owner: "dead-worker",
    lease_expires_at: new Date("2026-08-23T11:58:00.000Z"),
  });
  let executions = 0;

  const recovered = await executeRequest({
    ReceiptModel,
    operation: "PREPUBLICATION",
    idempotencyKey: "prepublication:stale",
    request,
    execute: async () => {
      executions += 1;
      return { statusCode: 200, body: { accepted: true, produced: 0 } };
    },
  });

  assert.equal(recovered.statusCode, 200);
  assert.equal(recovered.attemptCount, 2);
  assert.equal(executions, 1);
  assert.equal(ReceiptModel.rows[0].status, "SUCCEEDED");
});
