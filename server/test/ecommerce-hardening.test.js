const test = require("node:test");
const assert = require("node:assert/strict");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-with-enough-length";

const PendingPayment = require("../models/PendingPayment");
const Order = require("../models/Order");
const AmazonReportRow = require("../models/AmazonReportRow");
const MarketingCampaignRun = require("../models/MarketingCampaignRun");
const {
  validateAffiliateProductForCampaign,
} = require("../services/marketingAgentOrchestrator");
const {
  parseCookieHeader,
  getCustomerSessionToken,
  CUSTOMER_SESSION_COOKIE,
} = require("../utils/customerSession");
const { csrfProtection, createCsrfToken, CSRF_COOKIE_NAME, isValidCsrfToken } = require("../middleware/csrf");
const { createRateLimiter } = require("../middleware/requestGuards");
const { hashToken } = require("../utils/tokens");
const authRoute = require("../routes/auth");
const { _private: amazonReportPrivate } = require("../controllers/adminAmazonReportController");
const { checkAffiliateProductLink } = require("../services/affiliateLinkChecker");
const authPrivate = authRoute._private;

test("pending payment schema supports processing lifecycle and ttl cleanup", () => {
  const statusPath = PendingPayment.schema.path("status");
  assert.deepEqual(statusPath.enumValues, ["initiated", "pending", "processing", "completed", "failed", "expired"]);

  const expiresIndexes = PendingPayment.schema
    .indexes()
    .find(([index]) => Object.keys(index).length === 1 && index.expires_at === 1);

  assert.ok(expiresIndexes, "expires_at TTL index should exist");
  assert.equal(expiresIndexes[1].expireAfterSeconds, 0);
});

test("order schema keeps phonepe order ids unique for idempotent completion", () => {
  const phonepeIndex = Order.schema
    .indexes()
    .find(([index]) => Object.keys(index).length === 1 && index.phonepe_order_id === 1);

  assert.ok(phonepeIndex, "phonepe_order_id index should exist");
  assert.equal(phonepeIndex[1].unique, true);
  assert.equal(phonepeIndex[1].sparse, true);
});

test("marketing campaign schema supports affiliate product source events", () => {
  const sourceEventPath = MarketingCampaignRun.schema.path("source_event");

  assert.deepEqual(sourceEventPath.enumValues, [
    "product.approved",
    "admin_product.published",
    "affiliate_product.published",
  ]);
});

test("affiliate campaign validation accepts active assigned affiliate products", () => {
  assert.equal(validateAffiliateProductForCampaign({
    _id: "affiliate-product-id",
    source_type: "admin",
    is_affiliate: true,
    affiliate_url: "https://partner.example/product",
    status: "active",
    is_visible: true,
    category: "Beauty",
    subcategory: "Skin Care",
  }), true);
});

test("affiliate campaign validation rejects hidden uncategorized or url-less products", () => {
  const validProduct = {
    _id: "affiliate-product-id",
    source_type: "admin",
    is_affiliate: true,
    affiliate_url: "https://partner.example/product",
    status: "active",
    is_visible: true,
    category: "Beauty",
    subcategory: "Skin Care",
  };

  assert.throws(
    () => validateAffiliateProductForCampaign({ ...validProduct, is_visible: false }),
    /active visible affiliate products/,
  );
  assert.throws(
    () => validateAffiliateProductForCampaign({ ...validProduct, category: "Uncategorized" }),
    /assigned to a category/,
  );
  assert.throws(
    () => validateAffiliateProductForCampaign({ ...validProduct, affiliate_url: "" }),
    /affiliate URL/,
  );
});

test("customer session helpers prefer session cookie and fall back to bearer auth", () => {
  const cookieHeader = `${CUSTOMER_SESSION_COOKIE}=cookie-token; theme=light`;
  assert.deepEqual(parseCookieHeader(cookieHeader), {
    [CUSTOMER_SESSION_COOKIE]: "cookie-token",
    theme: "light",
  });

  assert.equal(
    getCustomerSessionToken({
      headers: {
        cookie: cookieHeader,
        authorization: "Bearer bearer-token",
      },
    }),
    "cookie-token"
  );

  assert.equal(
    getCustomerSessionToken({
      headers: {
        authorization: "Bearer bearer-token",
      },
    }),
    "bearer-token"
  );
});

test("csrf helpers sign tokens and protect mutating cookie-auth requests", () => {
  const token = createCsrfToken();
  assert.equal(isValidCsrfToken(token), true);
  assert.equal(isValidCsrfToken(`${token}tampered`), false);

  let nextCalled = false;
  const validReq = {
    method: "POST",
    path: "/api/account",
    headers: {
      cookie: `${CUSTOMER_SESSION_COOKIE}=session-token; ${CSRF_COOKIE_NAME}=${encodeURIComponent(token)}`,
      "x-csrf-token": token,
    },
  };
  csrfProtection(validReq, {}, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);

  let rejectedStatus = null;
  csrfProtection(
    {
      method: "POST",
      path: "/api/account",
      headers: { cookie: `${CUSTOMER_SESSION_COOKIE}=session-token` },
    },
    {
      status(statusCode) {
        rejectedStatus = statusCode;
        return this;
      },
      json(payload) {
        this.payload = payload;
        return this;
      },
    },
    () => {
      throw new Error("CSRF middleware should not call next for missing token");
    }
  );
  assert.equal(rejectedStatus, 403);
});

test("csrf middleware exempts unauthenticated admin password reset endpoints", () => {
  for (const path of ["/api/auth/admin/password/forgot", "/api/auth/admin/password/reset"]) {
    let nextCalled = false;
    csrfProtection(
      {
        method: "POST",
        path,
        headers: { cookie: `${CUSTOMER_SESSION_COOKIE}=session-token` },
      },
      {},
      () => {
        nextCalled = true;
      }
    );
    assert.equal(nextCalled, true, `${path} should be exempt`);
  }
});

test("admin and customer password reset lookups stay role-scoped", () => {
  assert.deepEqual(authPrivate.buildCustomerPasswordResetLookup("buyer@example.com"), {
    email: "buyer@example.com",
    role: { $ne: "admin" },
  });
  assert.deepEqual(authPrivate.buildAdminPasswordResetLookup("admin@example.com"), {
    email: "admin@example.com",
    role: "admin",
  });

  const customerTokenLookup = authPrivate.buildPasswordResetTokenLookup("customer-token", "customer");
  assert.equal(customerTokenLookup.password_reset_token, hashToken("customer-token"));
  assert.deepEqual(customerTokenLookup.role, { $ne: "admin" });
  assert.ok(customerTokenLookup.password_reset_expires_at.$gt instanceof Date);

  const adminTokenLookup = authPrivate.buildPasswordResetTokenLookup("admin-token", "admin");
  assert.equal(adminTokenLookup.password_reset_token, hashToken("admin-token"));
  assert.equal(adminTokenLookup.role, "admin");
  assert.ok(adminTokenLookup.password_reset_expires_at.$gt instanceof Date);
});

test("admin password reset issuer stores only hashed reset tokens", async () => {
  const originalEmailProvider = process.env.EMAIL_PROVIDER;
  process.env.EMAIL_PROVIDER = "log";
  let saveCount = 0;
  const admin = {
    email: "admin@example.com",
    full_name: "Admin",
    async save() {
      saveCount += 1;
    },
  };

  const preview = await authPrivate.issueAdminPasswordReset(admin);
  const resetUrl = new URL(preview.reset_url);
  const rawToken = resetUrl.searchParams.get("token");

  assert.equal(saveCount, 1);
  assert.ok(rawToken);
  assert.equal(admin.password_reset_token, hashToken(rawToken));
  assert.notEqual(admin.password_reset_token, rawToken);
  assert.ok(admin.password_reset_expires_at instanceof Date);
  assert.ok(admin.password_reset_expires_at.getTime() > Date.now());

  if (originalEmailProvider) process.env.EMAIL_PROVIDER = originalEmailProvider;
  else delete process.env.EMAIL_PROVIDER;
});

test("password reset application clears reset tokens and login lock state", async () => {
  let saved = false;
  const user = {
    password: "old-password",
    password_reset_token: "hashed-token",
    password_reset_expires_at: new Date(Date.now() + 1000),
    failed_login_attempts: 5,
    locked_until: new Date(Date.now() + 1000),
    async save() {
      saved = true;
    },
  };

  await authPrivate.applyPasswordReset(user, "NewPassword123");

  assert.equal(saved, true);
  assert.equal(user.password, "NewPassword123");
  assert.equal(user.password_reset_token, null);
  assert.equal(user.password_reset_expires_at, null);
  assert.equal(user.failed_login_attempts, 0);
  assert.equal(user.locked_until, null);
});

test("production rate limiter fails closed when Redis is not configured", async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalRedisUrl = process.env.REDIS_URL;
  process.env.NODE_ENV = "production";
  delete process.env.REDIS_URL;

  const limiter = createRateLimiter({ keyPrefix: "test-production-redis", max: 1 });
  let statusCode = null;
  await limiter(
    { ip: "127.0.0.1", headers: {}, socket: {} },
    {
      status(code) {
        statusCode = code;
        return this;
      },
      json(payload) {
        this.payload = payload;
        return this;
      },
    },
    () => {
      throw new Error("Limiter should not pass without Redis in production");
    }
  );

  assert.equal(statusCode, 503);
  if (originalNodeEnv) process.env.NODE_ENV = originalNodeEnv;
  else delete process.env.NODE_ENV;
  if (originalRedisUrl) process.env.REDIS_URL = originalRedisUrl;
  else delete process.env.REDIS_URL;
});

test("amazon report CSV parser handles quoted rows", () => {
  const csv = Buffer.from('Date,ASIN,Title,Commission\n2026-01-01,B0TEST,"A, quoted title",12.50\n');
  const rows = amazonReportPrivate.parseCsvBuffer(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].asin, "B0TEST");
  assert.equal(rows[0].title, "A, quoted title");
  assert.equal(rows[0].commission, "12.50");
});

test("amazon report imports have stable duplicate-protection fingerprints", () => {
  const left = [{ asin: "B0TEST", commission: "12.50", title: "A title" }];
  const right = [{ title: "A title", commission: "12.50", asin: "B0TEST" }];
  assert.equal(amazonReportPrivate.hashReportRows(left), amazonReportPrivate.hashReportRows(right));

  const duplicateIndex = AmazonReportRow.schema
    .indexes()
    .find(([index]) => index.source_file_hash === 1 && index.source_row_number === 1);

  assert.ok(duplicateIndex, "source file hash + row number index should exist");
  assert.equal(duplicateIndex[1].unique, true);
});

test("affiliate link checker rejects invalid Amazon links without network request", async () => {
  const result = await checkAffiliateProductLink({
    affiliate_url: "https://amzn.to/example",
    affiliate_marketplace: "amazon_us",
  });
  assert.equal(result.ok, false);
  assert.match(result.failure_reason, /Compliance validation failed/);
});
