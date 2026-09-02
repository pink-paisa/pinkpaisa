const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const fs = require("node:fs");
const path = require("node:path");

const { protect, adminOnly } = require("../middleware/auth");
const socialMediaManagerRouter = require("../routes/socialMediaManager");
const { _private: controllerPrivate } = require("../controllers/socialMediaManagerController");
const { verifyInstagramWebhookController } = require("../controllers/instagramController");

const ORCHESTRATION_ROUTES = [
  ["POST", "/orchestration/weekly-plan"],
  ["POST", "/orchestration/prepublication"],
  ["POST", "/orchestration/metrics"],
];

const ADMIN_ROUTES = [
  ["GET", "/admin/today"],
  ["GET", "/admin/work-summary"],
  ["GET", "/admin/connections"],
  ["POST", "/admin/connections/check"],
  ["GET", "/admin/weekly-plans/current"],
  ["POST", "/admin/weekly-plans/generate"],
  ["POST", "/admin/weekly-plans/:id/approve"],
  ["POST", "/admin/weekly-plans/:id/reject"],
  ["POST", "/admin/weekly-plans/:id/slots/:slotNumber/replace"],
  ["POST", "/admin/weekly-plans/:id/produce/:candidateId"],
  ["GET", "/admin/research/weekly"],
  ["GET", "/admin/analytics/summary"],
  ["POST", "/admin/analytics/refresh"],
  ["GET", "/admin/community"],
  ["POST", "/admin/community/:id/recommend"],
  ["POST", "/admin/community/:id/approve"],
  ["POST", "/admin/community/:id/approve-and-send"],
  ["POST", "/admin/community/:id/reject"],
  ["POST", "/admin/community/:id/send"],
  ["POST", "/admin/community/:id/reconcile"],
  ["POST", "/admin/community/:id/acknowledge-escalation"],
  ["POST", "/admin/community/:id/resolve-escalation"],
  ["GET", "/admin/generated-content/cleanup-preview"],
  ["DELETE", "/admin/generated-content"],
  ["POST", "/admin/generate"],
  ["GET", "/admin/drafts"],
  ["GET", "/admin/settings"],
  ["PUT", "/admin/settings"],
  ["GET", "/admin/audio-library"],
  ["POST", "/admin/audio-library"],
  ["GET", "/admin/audio-library/:id/file"],
  ["PATCH", "/admin/audio-library/:id"],
  ["DELETE", "/admin/audio-library/:id"],
  ["GET", "/admin/manual-actions"],
  ["GET", "/admin/manual-actions/:id"],
  ["PATCH", "/admin/manual-actions/:id"],
  ["POST", "/admin/publications/:id/reconcile"],
  ["GET", "/admin/performance"],
  ["GET", "/admin/runs/:id"],
  ["POST", "/admin/runs/:id/retry"],
  ["POST", "/admin/runs/:id/archive-failure"],
  ["GET", "/admin/drafts/:id"],
  ["POST", "/admin/drafts/:id/audio-track"],
  ["PATCH", "/admin/drafts/:id"],
  ["POST", "/admin/drafts/:id/submit-review"],
  ["POST", "/admin/drafts/:id/approve"],
  ["POST", "/admin/drafts/:id/approve-and-schedule"],
  ["POST", "/admin/drafts/:id/reject"],
  ["POST", "/admin/drafts/:id/schedule"],
  ["POST", "/admin/drafts/:id/publish"],
  ["POST", "/admin/drafts/:id/duplicate"],
  ["POST", "/admin/drafts/:id/regenerate"],
  ["POST", "/admin/drafts/:id/assets/render"],
  ["POST", "/admin/drafts/:id/fact-check"],
  ["POST", "/admin/drafts/:id/metrics"],
  ["GET", "/admin/drafts/:id/publishing-readiness"],
];

const EXPECTED_SOCIAL_ROUTES = [...ORCHESTRATION_ROUTES, ...ADMIN_ROUTES];

function routerContracts(router) {
  return router.stack
    .filter((layer) => layer.route)
    .flatMap((layer) => Object.keys(layer.route.methods)
      .filter((method) => layer.route.methods[method])
      .map((method) => [method.toUpperCase(), layer.route.path]));
}

function createResponseRecorder() {
  const state = {
    statusCode: 200,
    contentType: null,
    body: null,
  };
  const response = {
    status(code) {
      state.statusCode = code;
      return response;
    },
    type(value) {
      state.contentType = value;
      return response;
    },
    json(value) {
      state.body = value;
      return response;
    },
    send(value) {
      state.body = value;
      return response;
    },
  };
  return { response, state };
}

test("social media manager route module loads with the complete admin API contract", () => {
  assert.equal(typeof socialMediaManagerRouter, "function");
  assert.ok(Array.isArray(socialMediaManagerRouter.stack));
  assert.deepEqual(routerContracts(socialMediaManagerRouter), EXPECTED_SOCIAL_ROUTES);
});

test("paid creative endpoints require a bounded caller-owned idempotency key", () => {
  assert.throws(
    () => controllerPrivate.requiredPaidRequestKey({ headers: {} }),
    (error) => error.statusCode === 400 && error.code === "social_paid_operation_idempotency_key_required",
  );
  assert.throws(
    () => controllerPrivate.requiredPaidRequestKey({ headers: { "idempotency-key": "contains spaces" } }),
    (error) => error.statusCode === 400 && error.code === "social_paid_operation_idempotency_key_invalid",
  );
  assert.throws(
    () => controllerPrivate.requiredPaidRequestKey({ headers: { "idempotency-key": "x".repeat(301) } }),
    (error) => error.statusCode === 400 && error.code === "social_paid_operation_idempotency_key_invalid",
  );
  assert.equal(
    controllerPrivate.requiredPaidRequestKey({ headers: { "idempotency-key": "social-paid:duplicate:draft-1:request-1" } }),
    "social-paid:duplicate:draft-1:request-1",
  );
});

test("server mounts Social Media Manager and its Instagram integration without a request-count throttle", () => {
  const serverSource = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.doesNotMatch(serverSource, /socialManagerLimiter|instagramLimiter|keyPrefix:\s*["'](?:social-manager|instagram)["']|Too many (?:Social Media Manager|Instagram) requests/i);
  assert.match(
    serverSource,
    /app\.use\(["']\/api\/social-media-manager["'],\s*require\(["']\.\/routes\/socialMediaManager["']\)\);/,
  );
  assert.match(
    serverSource,
    /app\.use\(["']\/api\/instagram["'],\s*require\(["']\.\/routes\/instagram["']\)\);/,
  );
});

test("signed orchestration routes precede global admin authorization and every admin route follows it", () => {
  const protectIndex = socialMediaManagerRouter.stack.findIndex((layer) => layer.handle === protect);
  const adminOnlyIndex = socialMediaManagerRouter.stack.findIndex((layer) => layer.handle === adminOnly);
  assert.equal(protectIndex, ORCHESTRATION_ROUTES.length);
  assert.equal(adminOnlyIndex, protectIndex + 1);
  for (const layer of socialMediaManagerRouter.stack.slice(0, protectIndex)) {
    assert.ok(layer.route?.path.startsWith("/orchestration/"));
    assert.equal(layer.route.stack[0].name, "requireSocialOrchestrationSignature");
  }
  for (const layer of socialMediaManagerRouter.stack.filter((candidate) => candidate.route?.path.startsWith("/admin/"))) {
    const routeIndex = socialMediaManagerRouter.stack.indexOf(layer);
    assert.ok(routeIndex > adminOnlyIndex, `${layer.route.path} must execute after both authorization middleware`);
  }
});

test("every social manager endpoint rejects an anonymous request before controller execution", async (t) => {
  const app = express();
  app.use(express.json());
  app.use("/api/social-media-manager", socialMediaManagerRouter);
  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    listener.on("error", reject);
  });
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  }));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}/api/social-media-manager`;

  for (const [method, path] of ADMIN_ROUTES) {
    const requestPath = path
      .replace(":id", "507f1f77bcf86cd799439011")
      .replace(":slotNumber", "1")
      .replace(":candidateId", "candidate-1");
    const response = await fetch(`${baseUrl}${requestPath}`, {
      method,
      headers: method === "GET" ? undefined : { "Content-Type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify({}),
    });
    assert.equal(response.status, 401, `${method} ${path} must reject anonymous access`);
    assert.deepEqual(await response.json(), { message: "Not authorized, no token" });
  }
});

test("adminOnly rejects an authenticated non-admin role", () => {
  const { response, state } = createResponseRecorder();
  let nextCalls = 0;
  adminOnly({ user: { id: "customer-1", role: "customer" } }, response, () => { nextCalls += 1; });
  assert.equal(nextCalls, 0);
  assert.equal(state.statusCode, 403);
  assert.deepEqual(state.body, { message: "Admin access required" });
});

test("Instagram webhook verification requires an exact configured token", () => {
  const previousToken = process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN;
  process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN = "pinkpaisa-hook-secret";
  try {
    const accepted = createResponseRecorder();
    verifyInstagramWebhookController({
      query: {
        "hub.mode": "subscribe",
        "hub.verify_token": "pinkpaisa-hook-secret",
        "hub.challenge": "challenge-123",
      },
    }, accepted.response);
    assert.equal(accepted.state.statusCode, 200);
    assert.equal(accepted.state.contentType, "text/plain");
    assert.equal(accepted.state.body, "challenge-123");

    const wrongSameLength = createResponseRecorder();
    verifyInstagramWebhookController({
      query: {
        "hub.mode": "subscribe",
        "hub.verify_token": "pinkpaisa-hook-secrex",
        "hub.challenge": "challenge-123",
      },
    }, wrongSameLength.response);
    assert.equal(wrongSameLength.state.statusCode, 403);
    assert.deepEqual(wrongSameLength.state.body, { message: "Instagram webhook verification failed" });

    const missingChallenge = createResponseRecorder();
    verifyInstagramWebhookController({
      query: {
        "hub.mode": "subscribe",
        "hub.verify_token": "pinkpaisa-hook-secret",
      },
    }, missingChallenge.response);
    assert.equal(missingChallenge.state.statusCode, 403);
  } finally {
    if (previousToken === undefined) delete process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN;
    else process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN = previousToken;
  }
});

test("Instagram webhook verification fails closed when no token is configured", () => {
  const previousToken = process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN;
  delete process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN;
  try {
    const attempt = createResponseRecorder();
    verifyInstagramWebhookController({
      query: {
        "hub.mode": "subscribe",
        "hub.verify_token": "any-token",
        "hub.challenge": "challenge-123",
      },
    }, attempt.response);
    assert.equal(attempt.state.statusCode, 403);
    assert.deepEqual(attempt.state.body, { message: "Instagram webhook verification failed" });
  } finally {
    if (previousToken === undefined) delete process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN;
    else process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN = previousToken;
  }
});
