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
const { createRateLimiter, getClientIp } = require("../middleware/requestGuards");
const { hashToken } = require("../utils/tokens");
const authRoute = require("../routes/auth");
const productController = require("../controllers/productController");
const emailUtils = require("../utils/email");
const dailyBatchScheduler = require("../services/dailyBatchScheduler");
const { _private: amazonReportPrivate } = require("../controllers/adminAmazonReportController");
const { checkAffiliateProductLink } = require("../services/affiliateLinkChecker");
const { getCreatorsApiEnvStatus } = require("../utils/affiliateDataSettings");
const creatorsApiService = require("../services/amazonCreatorsApiService");
const affiliateProductController = require("../controllers/affiliateProductController");
const authPrivate = authRoute._private;
const productPrivate = productController._private;
const emailPrivate = emailUtils._private;
const creatorsApiPrivate = creatorsApiService._private;
const affiliateProductPrivate = affiliateProductController._private;

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

test("product all=true view stays admin-only and public-safe", async () => {
  const publicFilterResult = await productPrivate.buildProductFilter({
    query: { all: "true" },
    user: null,
  });
  const publicFilterText = JSON.stringify(publicFilterResult.filter);
  assert.match(publicFilterText, /"status":"active"/);
  assert.match(publicFilterText, /affiliate_compliance_status/);

  const adminFilterResult = await productPrivate.buildProductFilter({
    query: { all: "true" },
    user: { role: "admin" },
  });
  assert.deepEqual(adminFilterResult.filter, {});
});

test("public product serialization strips affiliate internals and imported Amazon observations", () => {
  const flat = productPrivate.toFlat({
    _id: { toString: () => "product-id" },
    is_affiliate: true,
    affiliate_data_source: "manual",
    affiliate_tag: "pinkpaisa-21",
    affiliate_payload: { raw: true },
    cost_price: 100,
    price: 999,
    sale_price: 799,
    mrp: 1299,
    stock_quantity: 8,
    attributes: {
      imported_price_observed: "Rs. 999",
      imported_sale_price_observed: "Rs. 799",
      imported_rating_observed: "4.5 out of 5",
      affiliate_rating_text: "4.5",
      safe_detail: "Keep me",
    },
  }, { publicView: true });

  assert.equal(flat.cost_price, undefined);
  assert.equal(flat.affiliate_tag, undefined);
  assert.equal(flat.affiliate_payload, undefined);
  assert.equal(flat.price, 0);
  assert.equal(flat.sale_price, null);
  assert.equal(flat.mrp, null);
  assert.equal(flat.stock_quantity, 0);
  assert.deepEqual(flat.attributes, { safe_detail: "Keep me" });
});

test("public affiliate serialization keeps manual image URLs including Amazon media URLs", () => {
  const safeManual = productPrivate.toFlat({
    _id: { toString: () => "manual-product-id" },
    title: "Manual image product",
    is_affiliate: true,
    affiliate_data_source: "manual",
    featured_image: "https://cdn.example.com/product.jpg",
    images: ["https://cdn.example.com/product.jpg"],
    image_items: [{ url: "https://cdn.example.com/product.jpg", alt: "Manual image product", position: 0 }],
    price: 999,
    sale_price: 799,
    mrp: 1299,
    stock_quantity: 8,
  }, { publicView: true });

  assert.equal(safeManual.featured_image, "https://cdn.example.com/product.jpg");
  assert.deepEqual(safeManual.images, ["https://cdn.example.com/product.jpg"]);
  assert.equal(safeManual.price, 0);
  assert.equal(safeManual.sale_price, null);

  const amazonMediaManual = productPrivate.toFlat({
    _id: { toString: () => "amazon-image-product-id" },
    title: "Amazon media image product",
    is_affiliate: true,
    affiliate_data_source: "manual",
    featured_image: "https://m.media-amazon.com/images/I/product.jpg",
    images: ["https://m.media-amazon.com/images/I/product.jpg"],
    image_items: [{ url: "https://m.media-amazon.com/images/I/product.jpg", alt: "Amazon media image product", position: 0 }],
    price: 999,
  }, { publicView: true });

  assert.equal(amazonMediaManual.featured_image, "https://m.media-amazon.com/images/I/product.jpg");
  assert.deepEqual(amazonMediaManual.images, ["https://m.media-amazon.com/images/I/product.jpg"]);
  assert.equal(amazonMediaManual.price, 0);

  const payloadOnlyManual = productPrivate.toFlat({
    _id: { toString: () => "payload-image-product-id" },
    title: "Payload image product",
    is_affiliate: true,
    affiliate_data_source: "manual",
    featured_image: null,
    images: [],
    image_items: [],
    affiliate_payload: { image_url: "https://m.media-amazon.com/images/I/payload-product.jpg" },
    price: 999,
  }, { publicView: true });

  assert.equal(payloadOnlyManual.featured_image, "https://m.media-amazon.com/images/I/payload-product.jpg");
  assert.deepEqual(payloadOnlyManual.images, ["https://m.media-amazon.com/images/I/payload-product.jpg"]);
  assert.equal(payloadOnlyManual.affiliate_payload, undefined);
});

test("public affiliate serialization requires fresh API expiry before showing Amazon API data", () => {
  const baseProduct = {
    _id: { toString: () => "product-id" },
    title: "API product",
    is_affiliate: true,
    affiliate_data_source: "creators_api",
    featured_image: "https://example.com/api-image.jpg",
    images: ["https://example.com/api-image.jpg"],
    image_items: [{ url: "https://example.com/api-image.jpg", alt: "API product", position: 0 }],
    price: 999,
    sale_price: 799,
    mrp: 1299,
    stock_quantity: 0,
  };

  const missingExpiry = productPrivate.toFlat(baseProduct, { publicView: true });
  assert.equal(missingExpiry.featured_image, null);
  assert.equal(missingExpiry.price, 0);

  const fresh = productPrivate.toFlat({
    ...baseProduct,
    affiliate_data_expires_at: new Date(Date.now() + 60 * 60 * 1000),
  }, { publicView: true });
  assert.equal(fresh.featured_image, "https://example.com/api-image.jpg");
  assert.equal(fresh.price, 999);
  assert.equal(fresh.sale_price, 799);

  const expired = productPrivate.toFlat({
    ...baseProduct,
    affiliate_data_expires_at: new Date(Date.now() - 60 * 1000),
  }, { publicView: true });
  assert.equal(expired.featured_image, null);
  assert.equal(expired.price, 0);
});

test("admin affiliate CRUD cannot promote manual submissions into API-sourced content", () => {
  assert.equal(
    affiliateProductPrivate.normalizeAdminAffiliateDataSource({ affiliate_data_source: "creators_api" }, null),
    "manual"
  );

  const preserved = affiliateProductPrivate.buildPreservedApiContent({
    affiliate_data_source: "creators_api",
    featured_image: "https://example.com/api-image.jpg",
    images: ["https://example.com/api-image.jpg"],
    image_items: [{ url: "https://example.com/api-image.jpg", alt: "Image", position: 0 }],
    price: 999,
    sale_price: 799,
    effective_price: 799,
    affiliate_data_last_refreshed_at: new Date("2026-01-01T00:00:00.000Z"),
    affiliate_data_expires_at: new Date("2026-01-02T00:00:00.000Z"),
  }, "creators_api");

  assert.equal(preserved.featured_image, "https://example.com/api-image.jpg");
  assert.equal(preserved.effective_price, 799);

  const manual = affiliateProductPrivate.buildAffiliateImageContent(
    { image_url: "https://cdn.example.com/manual-product.jpg" },
    null,
    "manual",
    "Manual product"
  );
  assert.equal(manual.featured_image, "https://cdn.example.com/manual-product.jpg");
  assert.equal(manual.price, 0);

  const amazonMediaManual = affiliateProductPrivate.buildAffiliateImageContent(
    { image_url: "https://m.media-amazon.com/images/I/product.jpg" },
    null,
    "manual",
    "Manual product"
  );
  assert.equal(amazonMediaManual.featured_image, "https://m.media-amazon.com/images/I/product.jpg");

  const payloadImageManual = affiliateProductPrivate.buildAffiliateImageContent(
    { affiliate_payload: { image_url: "https://m.media-amazon.com/images/I/payload-product.jpg" } },
    null,
    "manual",
    "Manual product"
  );
  assert.equal(payloadImageManual.featured_image, "https://m.media-amazon.com/images/I/payload-product.jpg");
});

test("admin affiliate required fields include selling metadata", () => {
  const errors = affiliateProductPrivate.buildRequiredAffiliateFieldErrors({
    title: "Manual product",
    affiliate_url: "https://www.amazon.in/dp/B0CTVGPLQX?tag=pinkpaisa07-21",
    affiliate_marketplace: "amazon_in",
    affiliate_asin: "B0CTVGPLQX",
    affiliate_data_source: "manual",
    category_id: "category-id",
    subcategory_id: "subcategory-id",
    category: "Beauty",
    subcategory: "Tools",
    featured_image: null,
    short_description: "",
    buying_intent: "",
    campaign_label: "",
    pros: [],
    cons: [],
    seo_title: "",
    seo_description: "",
  }, { title: "Manual product" });

  assert.equal(errors.image_url, undefined);
  assert.equal(errors.short_description, "Short description is required");
  assert.equal(errors.buying_intent, "Buying intent is required");
  assert.equal(errors.campaign_label, "Campaign label is required");
  assert.equal(errors.pros, "At least one pro is required");
  assert.equal(errors.cons, "At least one con is required");
  assert.equal(errors.seo_title, "SEO title is required");
  assert.equal(errors.seo_description, "SEO description is required");
});

test("creators api readiness is gated by env, mode, health status, and implemented adapter", () => {
  const originalEnabled = process.env.AMAZON_CREATORS_API_ENABLED;
  const originalAccessKey = process.env.AMAZON_CREATORS_API_ACCESS_KEY;
  const originalSecretKey = process.env.AMAZON_CREATORS_API_SECRET_KEY;

  try {
    process.env.AMAZON_CREATORS_API_ENABLED = "true";
    process.env.AMAZON_CREATORS_API_ACCESS_KEY = "access-key";
    process.env.AMAZON_CREATORS_API_SECRET_KEY = "secret-key";

    const notReady = creatorsApiPrivate.buildCreatorsApiReadiness({
      settings: {
        affiliate_data_mode: "creators_api",
        affiliate_data_marketplaces: ["amazon_in"],
        affiliate_creators_api_health_status: "ok",
      },
      envStatus: getCreatorsApiEnvStatus(),
    });
    assert.equal(notReady.ready, false);
    assert.equal(notReady.adapter_implemented, false);

    const manual = creatorsApiPrivate.buildCreatorsApiReadiness({
      settings: {
        affiliate_data_mode: "manual_only",
        affiliate_data_marketplaces: ["amazon_in"],
        affiliate_creators_api_health_status: "ok",
      },
      envStatus: getCreatorsApiEnvStatus(),
    });
    assert.equal(manual.ready, false);
  } finally {
    if (originalEnabled) process.env.AMAZON_CREATORS_API_ENABLED = originalEnabled;
    else delete process.env.AMAZON_CREATORS_API_ENABLED;
    if (originalAccessKey) process.env.AMAZON_CREATORS_API_ACCESS_KEY = originalAccessKey;
    else delete process.env.AMAZON_CREATORS_API_ACCESS_KEY;
    if (originalSecretKey) process.env.AMAZON_CREATORS_API_SECRET_KEY = originalSecretKey;
    else delete process.env.AMAZON_CREATORS_API_SECRET_KEY;
  }
});

test("creators api data application records source, refresh, expiry, image, and price", () => {
  const product = {
    title: "API product",
    affiliate_marketplace: "amazon_in",
    attributes: {},
  };
  const normalized = creatorsApiPrivate.normalizeCreatorsApiProductData({
    image_url: "https://example.com/api-image.jpg",
    price: 999,
    sale_price: 799,
  }, product, new Date("2026-01-01T00:00:00.000Z"));

  creatorsApiService.applyCreatorsApiDataToProduct(product, normalized);
  assert.equal(product.affiliate_data_source, "creators_api");
  assert.equal(product.featured_image, "https://example.com/api-image.jpg");
  assert.equal(product.price, 999);
  assert.equal(product.sale_price, 799);
  assert.equal(product.effective_price, 799);
  assert.ok(product.affiliate_data_last_refreshed_at instanceof Date);
  assert.ok(product.affiliate_data_expires_at instanceof Date);
});

test("client ip helper does not trust raw X-Forwarded-For headers directly", () => {
  assert.equal(
    getClientIp({
      ip: "203.0.113.10",
      headers: { "x-forwarded-for": "198.51.100.99" },
      socket: { remoteAddress: "127.0.0.1" },
    }),
    "203.0.113.10",
  );
});

test("email log metadata redacts reset and verification URLs", () => {
  assert.deepEqual(emailPrivate.redactEmailMeta({
    resetUrl: "https://www.pinkpaisa.in/admin/reset-password?token=secret",
    verificationToken: "secret",
    flow: "admin-reset",
  }), {
    resetUrl: "[redacted]",
    verificationToken: "[redacted]",
    flow: "admin-reset",
  });
});

test("affiliate link sweep scheduler runs only at the configured IST minute", () => {
  const originalEnabled = process.env.AFFILIATE_LINK_CHECK_DAILY_ENABLED;
  const originalHour = process.env.AFFILIATE_LINK_CHECK_HOUR_IST;
  const originalMinute = process.env.AFFILIATE_LINK_CHECK_MINUTE_IST;
  process.env.AFFILIATE_LINK_CHECK_DAILY_ENABLED = "true";
  process.env.AFFILIATE_LINK_CHECK_HOUR_IST = "03";
  process.env.AFFILIATE_LINK_CHECK_MINUTE_IST = "10";

  try {
    assert.equal(dailyBatchScheduler.shouldRunAffiliateLinkSweep(new Date("2026-01-01T21:40:00.000Z")), true);
    assert.equal(dailyBatchScheduler.shouldRunAffiliateLinkSweep(new Date("2026-01-01T21:41:00.000Z")), false);
  } finally {
    if (originalEnabled) process.env.AFFILIATE_LINK_CHECK_DAILY_ENABLED = originalEnabled;
    else delete process.env.AFFILIATE_LINK_CHECK_DAILY_ENABLED;
    if (originalHour) process.env.AFFILIATE_LINK_CHECK_HOUR_IST = originalHour;
    else delete process.env.AFFILIATE_LINK_CHECK_HOUR_IST;
    if (originalMinute) process.env.AFFILIATE_LINK_CHECK_MINUTE_IST = originalMinute;
    else delete process.env.AFFILIATE_LINK_CHECK_MINUTE_IST;
  }
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
