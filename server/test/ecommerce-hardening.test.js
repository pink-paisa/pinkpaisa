const test = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const axios = require("axios");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-with-enough-length";

const PendingPayment = require("../models/PendingPayment");
const Order = require("../models/Order");
const OrderItem = require("../models/OrderItem");
const AmazonReportRow = require("../models/AmazonReportRow");
const MarketingCampaignPublishEvent = require("../models/MarketingCampaignPublishEvent");
const MarketingCampaignRun = require("../models/MarketingCampaignRun");
const Product = require("../models/Product");
const AgentTask = require("../models/AgentTask");
const MarketingAsset = require("../models/MarketingAsset");
const MarketingPublishAttempt = require("../models/MarketingPublishAttempt");
const marketingAgentOrchestrator = require("../services/marketingAgentOrchestrator");
const marketingAgents = require("../services/marketingAgents");
const {
  validateAffiliateProductForCampaign,
} = marketingAgentOrchestrator;
const marketingPrivate = marketingAgentOrchestrator._private;
const marketingAgentsPrivate = marketingAgents._private;
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
const orderController = require("../controllers/orderController");
const vendorOrderController = require("../controllers/vendorOrderController");
const emailUtils = require("../utils/email");
const logger = require("../utils/logger");
const dailyBatchScheduler = require("../services/dailyBatchScheduler");
const { _private: amazonReportPrivate } = require("../controllers/adminAmazonReportController");
const { checkAffiliateProductLink } = require("../services/affiliateLinkChecker");
const { getCreatorsApiEnvStatus } = require("../utils/affiliateDataSettings");
const creatorsApiService = require("../services/amazonCreatorsApiService");
const affiliateProductController = require("../controllers/affiliateProductController");
const marketingCampaignController = require("../controllers/marketingCampaignController");
const marketingCampaignRoutes = require("../routes/marketingCampaigns");
const campaignLinkRoutes = require("../routes/campaignLinks");
const { buildAffiliateCarouselCaption } = require("../services/affiliateCarouselCaption");
const instagramPublishService = require("../services/instagramPublishService");
const wishlistController = require("../controllers/wishlistController");
const authPrivate = authRoute._private;
const productPrivate = productController._private;
const orderPrivate = orderController._private;
const vendorOrderPrivate = vendorOrderController._private;
const emailPrivate = emailUtils._private;
const creatorsApiPrivate = creatorsApiService._private;
const affiliateProductPrivate = affiliateProductController._private;
const wishlistPrivate = wishlistController._private;
const openaiImageProvider = require("../services/imageProviders/openaiProvider");
const openaiImageProviderPrivate = openaiImageProvider._private;
const googleImageProvider = require("../services/imageProviders/googleProvider");
const googleImageProviderPrivate = googleImageProvider._private;
const openrouterImageProvider = require("../services/imageProviders/openrouterProvider");
const openrouterImageProviderPrivate = openrouterImageProvider._private;
const imageProviderService = require("../services/imageProviders");
const {
  getDefaultModelId,
  getImageProviderRegistry,
  normaliseImageProviderSelection,
} = require("../services/imageProviders/registry");
const campaignAssetStoragePrivate = require("../services/campaignAssetStorage")._private;
const { buildVariantPrompt, _private: instagramCreativePrivate } = require("../services/instagramAiCreativeService");
const {
  normalizeReferenceBuffer,
  resolveProductReferenceImage,
  resolveVendorReferenceImage,
} = require("../services/campaignReferenceImage");
const openAiCaptionPrivate = require("../services/openAiCaptionService")._private;
const { buildAffiliatePriceMigrationUpdate } = require("../scripts/migrateAffiliatePriceState");
const {
  DEFAULT_AFFILIATE_CAMPAIGN_AI_PROMPT_TEMPLATE,
  DEFAULT_CATALOG_CAMPAIGN_AI_PROMPT_TEMPLATE,
  normaliseCampaignSettings,
} = require("../utils/campaignSettings");
const {
  canonicalizeAmazonAffiliateUrl,
  validateAmazonAffiliateUrl,
} = require("../services/amazonAffiliateCompliance");

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

test("order list pagination preserves legacy status-only filters", () => {
  assert.equal(orderPrivate.wantsPaginatedOrderList({ status: "pending" }), false);
  assert.equal(orderPrivate.wantsPaginatedOrderList({ page: "1", status: "pending" }), true);
  assert.equal(orderPrivate.wantsPaginatedOrderList({ limit: "25", status: "pending" }), true);
  assert.equal(orderPrivate.wantsPaginatedOrderList({ search: "PP123" }), true);

  assert.deepEqual(orderPrivate.parseListPagination({ page: "2", limit: "999" }), {
    page: 2,
    limit: 100,
  });

  const filter = orderPrivate.buildOrderListFilter({
    user: { _id: "user-id", role: "user" },
    query: { status: "pending", search: "PP123" },
  });
  assert.equal(filter.user_id, "user-id");
  assert.ok(Array.isArray(filter.$and));
  assert.deepEqual(filter.$and[0], {
    $or: [
      { status: "pending" },
      { delivery_status: "pending" },
      { payment_status: "pending" },
    ],
  });
  assert.ok(filter.$and[1].$or.some((clause) => clause.order_number instanceof RegExp));
});

test("checkout rejects affiliate products and uses the stored product price", () => {
  assert.throws(
    () => orderPrivate.resolveCheckoutUnitPrice({ title: "Partner pick", is_affiliate: true, price: 1 }),
    /must be purchased on the partner site/
  );
  assert.equal(orderPrivate.resolveCheckoutUnitPrice({ title: "Store item", price: 500, sale_price: 425 }), 425);
  assert.throws(
    () => orderPrivate.resolveCheckoutUnitPrice({ title: "Missing price", price: null, sale_price: null }),
    /valid checkout price is not available/
  );
});

test("order and order item schemas include pagination support indexes", () => {
  const orderIndexes = Order.schema.indexes().map(([index]) => JSON.stringify(index));
  assert.ok(orderIndexes.includes(JSON.stringify({ status: 1, createdAt: -1 })));
  assert.ok(orderIndexes.includes(JSON.stringify({ delivery_status: 1, createdAt: -1 })));
  assert.ok(orderIndexes.includes(JSON.stringify({ payment_status: 1, createdAt: -1 })));
  assert.ok(orderIndexes.includes(JSON.stringify({ createdAt: -1 })));

  const itemIndexes = OrderItem.schema.indexes().map(([index]) => JSON.stringify(index));
  assert.ok(itemIndexes.includes(JSON.stringify({ vendor_id: 1, createdAt: -1 })));
  assert.ok(itemIndexes.includes(JSON.stringify({ vendor_id: 1, vendor_status: 1, createdAt: -1 })));
});

test("vendor order list query matches searched order numbers against string order ids", () => {
  const orderId = new Order()._id;
  const query = vendorOrderPrivate.buildVendorOrderListQuery({
    vendorId: "vendor-id",
    status: "pickup_assigned",
    search: "PP123",
    matchingOrderIds: [orderId],
  });

  assert.equal(query.vendor_id, "vendor-id");
  assert.equal(query.vendor_status, "pickup_assigned");
  assert.equal(query.$or[0].product_title instanceof RegExp, true);
  assert.deepEqual(query.$or[1], { order_id: { $in: [String(orderId)] } });
  assert.deepEqual(vendorOrderPrivate.parseListPagination({ page: "-1", limit: "500" }), {
    page: 1,
    limit: 100,
  });
});

test("marketing campaign schema supports affiliate product source events", () => {
  const sourceEventPath = MarketingCampaignRun.schema.path("source_event");

  assert.deepEqual(sourceEventPath.enumValues, [
    "product.approved",
    "admin_product.published",
    "affiliate_product.published",
  ]);
  assert.equal(MarketingCampaignRun.schema.path("carousel_task_id").instance, "ObjectId");
  assert.equal(MarketingCampaignRun.schema.path("carousel_position").instance, "Number");
  assert.equal(MarketingCampaignRun.schema.path("carousel_size").instance, "Number");
});

test("marketing publish event schema records audit fields", () => {
  const actionPath = MarketingCampaignPublishEvent.schema.path("action_type");
  const statusPath = MarketingCampaignPublishEvent.schema.path("status");

  assert.ok(actionPath.enumValues.includes("publish"));
  assert.ok(actionPath.enumValues.includes("schedule"));
  assert.ok(actionPath.enumValues.includes("carousel_publish"));
  assert.ok(actionPath.enumValues.includes("carousel_cancel"));
  assert.ok(actionPath.enumValues.includes("failed_publish"));
  assert.ok(actionPath.enumValues.includes("review"));
  assert.deepEqual(statusPath.enumValues, ["started", "success", "failed", "skipped"]);

  const indexes = MarketingCampaignPublishEvent.schema.indexes().map(([index]) => JSON.stringify(index));
  assert.ok(indexes.includes(JSON.stringify({ campaign_run_id: 1, created_at: -1 })));
});

test("affiliate carousel endpoints are enabled and reject an invalid selection", async () => {
  const previousFlag = process.env.MARKETING_AFFILIATE_CAROUSEL_ENABLED;
  process.env.MARKETING_AFFILIATE_CAROUSEL_ENABLED = "true";
  let statusCode = null;
  let payload = null;
  const response = {
    status(value) {
      statusCode = value;
      return this;
    },
    json(value) {
      payload = value;
      return value;
    },
  };

  try {
    await marketingCampaignController.publishMarketingCarouselController({ body: {}, user: {} }, response);
    assert.equal(statusCode, 400);
    assert.equal(payload.code, "carousel_selection_invalid");
  } finally {
    if (previousFlag === undefined) delete process.env.MARKETING_AFFILIATE_CAROUSEL_ENABLED;
    else process.env.MARKETING_AFFILIATE_CAROUSEL_ENABLED = previousFlag;
  }
});

test("affiliate carousel feature flag blocks new composition", async () => {
  const previousFlag = process.env.MARKETING_AFFILIATE_CAROUSEL_ENABLED;
  process.env.MARKETING_AFFILIATE_CAROUSEL_ENABLED = "false";
  let statusCode = null;
  let payload = null;
  const response = {
    status(value) {
      statusCode = value;
      return this;
    },
    json(value) {
      payload = value;
      return value;
    },
  };

  try {
    await marketingCampaignController.previewMarketingCarouselController({ body: {} }, response);
    assert.equal(statusCode, 400);
    assert.equal(payload.code, "carousel_creation_disabled");
  } finally {
    if (previousFlag === undefined) delete process.env.MARKETING_AFFILIATE_CAROUSEL_ENABLED;
    else process.env.MARKETING_AFFILIATE_CAROUSEL_ENABLED = previousFlag;
  }
});

test("affiliate carousel routes expose preview, queue, lifecycle, and compact links", () => {
  const routeSignatures = marketingCampaignRoutes.stack
    .filter((layer) => layer.route)
    .map((layer) => `${Object.keys(layer.route.methods).find((method) => layer.route.methods[method]).toUpperCase()} ${layer.route.path}`);
  assert.ok(routeSignatures.includes("POST /admin/carousels/preview"));
  assert.ok(routeSignatures.includes("POST /admin/post-carousel"));
  assert.ok(routeSignatures.includes("GET /admin/carousels/:taskId"));
  assert.ok(routeSignatures.includes("PATCH /admin/carousels/:taskId/schedule"));
  assert.ok(routeSignatures.includes("POST /admin/carousels/:taskId/cancel"));
  assert.ok(routeSignatures.includes("POST /admin/carousels/:taskId/retry"));
  assert.ok(routeSignatures.includes("POST /admin/bulk-review"));
  assert.equal(campaignLinkRoutes.stack.find((layer) => layer.route)?.route.path, "/:campaignId");
});

test("affiliate carousel caption preserves slide order, compact links, and one affiliate notice", () => {
  const result = buildAffiliateCarouselCaption({
    captionBody: "A considered edit of partner picks.",
    items: [
      { run_id: "run-b", product_title: "Second selected product", tracked_url: "https://pinkpaisa.in/api/c/cmp-b" },
      { run_id: "run-a", product_title: "First selected product", tracked_url: "https://pinkpaisa.in/api/c/cmp-a" },
    ],
    hashtags: ["Pink_Paisa", "PartnerPicks", "#Ad"],
  });

  assert.deepEqual(result.items.map((item) => item.run_id), ["run-b", "run-a"]);
  assert.ok(result.final_caption.indexOf("1. Second selected product") < result.final_caption.indexOf("2. First selected product"));
  assert.ok(result.final_caption.indexOf("https://pinkpaisa.in/api/c/cmp-b") < result.final_caption.indexOf("https://pinkpaisa.in/api/c/cmp-a"));
  assert.deepEqual(result.hashtags, ["#Pink_Paisa", "#PartnerPicks"]);
  assert.equal(result.disclosure, marketingAgents.AFFILIATE_INSTAGRAM_DISCLOSURE);
  assert.equal(result.final_caption.endsWith(marketingAgents.AFFILIATE_INSTAGRAM_DISCLOSURE), true);
  assert.equal((result.final_caption.match(/#Ad\b/gi) || []).length, 1);
  assert.ok(result.caption_character_count <= 2200);
});

test("affiliate carousel caption blocks unsafe body, hashtags, and product titles", () => {
  const items = [
    { run_id: "run-1", product_title: "Partner serum", tracked_url: "https://pinkpaisa.in/api/c/cmp-1" },
    { run_id: "run-2", product_title: "Partner cleanser", tracked_url: "https://pinkpaisa.in/api/c/cmp-2" },
  ];
  assert.throws(
    () => buildAffiliateCarouselCaption({ captionBody: "Limited sale available now", items }),
    (error) => error.code === "affiliate_discount_claim" || error.code === "affiliate_availability_claim"
  );
  assert.throws(
    () => buildAffiliateCarouselCaption({ captionBody: "Explore these picks", items, hashtags: ["#ClinicallyProven"] }),
    (error) => error.code === "blocked_claim"
  );
  assert.throws(
    () => buildAffiliateCarouselCaption({
      captionBody: "Explore these picks",
      items: [{ ...items[0], product_title: "Miracle cure serum" }, items[1]],
    }),
    (error) => error.code === "blocked_claim"
  );
  assert.throws(
    () => buildAffiliateCarouselCaption({ captionBody: "Explore at https://amazon.in/example", items }),
    (error) => error.code === "carousel_caption_invalid" && /links.*automatically/i.test(error.message)
  );
  assert.throws(
    () => buildAffiliateCarouselCaption({ captionBody: "Explore these picks #Sale", items }),
    (error) => error.code === "carousel_caption_invalid" && /hashtag field/i.test(error.message)
  );
});

test("affiliate carousel caption allows ingredient concentrations but blocks discount percentages", () => {
  const baseItems = [
    { run_id: "run-1", product_title: "Minimalist 10% Niacinamide Serum", tracked_url: "https://pinkpaisa.in/api/c/cmp-1" },
    { run_id: "run-2", product_title: "Salicylic Acid 2% Face Serum", tracked_url: "https://pinkpaisa.in/api/c/cmp-2" },
  ];
  assert.doesNotThrow(() => buildAffiliateCarouselCaption({
    captionBody: "Explore these partner picks.",
    items: baseItems,
  }));
  assert.throws(
    () => buildAffiliateCarouselCaption({
      captionBody: "Explore these partner picks.",
      items: [{ ...baseItems[0], product_title: "Niacinamide Serum 50% Off" }, baseItems[1]],
    }),
    (error) => error.code === "affiliate_discount_claim",
  );
});

test("affiliate carousel caption rejects admin content that would exceed 2200 characters", () => {
  assert.throws(
    () => buildAffiliateCarouselCaption({
      captionBody: "Curated editorial partner selection ".repeat(90),
      items: [
        { run_id: "run-1", product_title: "Partner serum", tracked_url: "https://pinkpaisa.in/api/c/cmp-1" },
        { run_id: "run-2", product_title: "Partner cleanser", tracked_url: "https://pinkpaisa.in/api/c/cmp-2" },
      ],
    }),
    (error) => error.code === "instagram_caption_too_long"
  );
});

test("affiliate carousel caption enforces normalized hashtag limits", () => {
  const items = [
    { run_id: "run-1", product_title: "Partner serum", tracked_url: "https://pinkpaisa.in/api/c/cmp-1" },
    { run_id: "run-2", product_title: "Partner cleanser", tracked_url: "https://pinkpaisa.in/api/c/cmp-2" },
  ];
  assert.throws(
    () => buildAffiliateCarouselCaption({ captionBody: "Explore these picks", items, hashtags: Array.from({ length: 9 }, (_, index) => `Tag${index}`) }),
    /no more than eight/i
  );
  assert.throws(
    () => buildAffiliateCarouselCaption({ captionBody: "Explore these picks", items, hashtags: [`#${"A".repeat(41)}`] }),
    /40-character hashtag limit/i
  );
});

test("carousel run selection enforces limits, uniqueness, and preserves order", () => {
  const runA = "507f1f77bcf86cd799439011";
  const runB = "507f191e810c19729de860ea";
  assert.deepEqual(marketingPrivate.normalizeOrderedCarouselRunIds([runB, runA]), [runB, runA]);
  assert.equal(marketingPrivate.buildCarouselGroupIdentity([runA, runB]), marketingPrivate.buildCarouselGroupIdentity([runB, runA]));
  assert.throws(() => marketingPrivate.normalizeOrderedCarouselRunIds([runA]), /between 2 and 10/);
  assert.throws(() => marketingPrivate.normalizeOrderedCarouselRunIds([runA, runA]), /only once/);
  assert.throws(() => marketingPrivate.normalizeOrderedCarouselRunIds(Array.from({ length: 11 }, (_, index) => `${index}`.padStart(24, "0"))), /between 2 and 10/);
});

test("carousel scheduling rejects invalid and near-term times", () => {
  assert.throws(
    () => marketingPrivate.parseCarouselScheduleDate("not-a-date"),
    (error) => error.code === "invalid_schedule_time"
  );
  assert.throws(
    () => marketingPrivate.parseCarouselScheduleDate(new Date(Date.now() + 60_000).toISOString()),
    (error) => error.code === "invalid_schedule_time"
  );
  const scheduled = marketingPrivate.parseCarouselScheduleDate(new Date(Date.now() + (10 * 60_000)).toISOString());
  assert.ok(scheduled instanceof Date);
});

test("carousel compact links are server-owned Pink Paisa campaign routes", () => {
  const previousPublicUrl = process.env.PUBLIC_APP_URL;
  process.env.PUBLIC_APP_URL = "https://pinkpaisa.in";
  try {
    assert.equal(
      marketingPrivate.buildCarouselTrackingUrl({ campaign_id: "cmp-carousel-1" }),
      "https://pinkpaisa.in/api/c/cmp-carousel-1"
    );
  } finally {
    if (previousPublicUrl === undefined) delete process.env.PUBLIC_APP_URL;
    else process.env.PUBLIC_APP_URL = previousPublicUrl;
  }
});

test("carousel compact redirect ignores user destinations and stays on the Pink Paisa product page", async () => {
  const originalRunFindOne = MarketingCampaignRun.findOne;
  const originalProductFindOne = Product.findOne;
  const previousPublicUrl = process.env.PUBLIC_APP_URL;
  process.env.PUBLIC_APP_URL = "https://pinkpaisa.in";
  MarketingCampaignRun.findOne = () => ({
    lean: async () => ({ campaign_id: "cmp-carousel-1", public_product_id: "product-1", carousel_position: 2 }),
  });
  Product.findOne = () => ({
    select() { return this; },
    lean: async () => ({ slug: "partner-serum" }),
  });
  let redirectStatus = null;
  let redirectUrl = null;

  try {
    await marketingCampaignController.redirectMarketingCampaignLinkController({
      params: { campaignId: "cmp-carousel-1" },
      query: { destination: "https://amazon.in/unsafe" },
    }, {
      redirect(status, url) {
        redirectStatus = status;
        redirectUrl = url;
      },
    });
    const destination = new URL(redirectUrl);
    assert.equal(redirectStatus, 302);
    assert.equal(destination.origin, "https://pinkpaisa.in");
    assert.equal(destination.pathname, "/product/partner-serum");
    assert.equal(destination.searchParams.get("utm_content"), "carousel_slide_2");
    assert.equal(destination.href.includes("amazon.in"), false);
  } finally {
    MarketingCampaignRun.findOne = originalRunFindOne;
    Product.findOne = originalProductFindOne;
    if (previousPublicUrl === undefined) delete process.env.PUBLIC_APP_URL;
    else process.env.PUBLIC_APP_URL = previousPublicUrl;
  }
});

test("carousel compact redirect falls back to the existing product catalog", async () => {
  const originalRunFindOne = MarketingCampaignRun.findOne;
  const previousPublicUrl = process.env.PUBLIC_APP_URL;
  process.env.PUBLIC_APP_URL = "https://pinkpaisa.in";
  MarketingCampaignRun.findOne = () => ({ lean: async () => null });
  let redirectUrl = null;

  try {
    await marketingCampaignController.redirectMarketingCampaignLinkController({
      params: { campaignId: "missing-campaign" },
    }, {
      redirect(_status, url) {
        redirectUrl = url;
      },
    });
    assert.equal(new URL(redirectUrl).pathname, "/products");
  } finally {
    MarketingCampaignRun.findOne = originalRunFindOne;
    if (previousPublicUrl === undefined) delete process.env.PUBLIC_APP_URL;
    else process.env.PUBLIC_APP_URL = previousPublicUrl;
  }
});

test("Instagram carousel child containers preserve selected asset order", async () => {
  const originalPost = axios.post;
  const originalGet = axios.get;
  const imageUrls = [];
  let parentChildren = null;
  let childNumber = 0;
  axios.post = async (url, body) => {
    if (url.endsWith("/media_publish")) return { data: { id: "media-1" } };
    if (body.get("media_type") === "CAROUSEL") {
      parentChildren = body.get("children");
      return { data: { id: "parent-1" } };
    }
    imageUrls.push(body.get("image_url"));
    childNumber += 1;
    return { data: { id: `child-${childNumber}` } };
  };
  axios.get = async (url, options) => {
    if (options?.params?.fields?.includes("permalink")) return { data: { id: "media-1", permalink: "https://instagram.com/p/example" } };
    return { data: { id: url.split("/").at(-1), status_code: "FINISHED" } };
  };

  try {
    const result = await instagramPublishService.publishCarousel({
      connection: { instagram_user_id: "ig-user", user_access_token: "token" },
      assetUrls: ["https://cdn.example.com/slide-2.jpg", "https://cdn.example.com/slide-1.jpg"],
      caption: "Carousel caption",
    });
    assert.deepEqual(imageUrls, ["https://cdn.example.com/slide-2.jpg", "https://cdn.example.com/slide-1.jpg"]);
    assert.equal(parentChildren, "child-1,child-2");
    assert.deepEqual(result.child_creation_ids, ["child-1", "child-2"]);
  } finally {
    axios.post = originalPost;
    axios.get = originalGet;
  }
});

test("Instagram carousel retry removes the first terminal child checkpoint", async () => {
  const originalPost = axios.post;
  const originalGet = axios.get;
  let postCalls = 0;
  axios.post = async () => {
    postCalls += 1;
    throw new Error("No new container should be created before resumed children are checked");
  };
  axios.get = async (url) => {
    const containerId = url.split("/").at(-1);
    return {
      data: containerId === "child-2"
        ? { id: containerId, status_code: "ERROR", status: "Invalid media" }
        : { id: containerId, status_code: "FINISHED" },
    };
  };

  try {
    let publishError = null;
    try {
      await instagramPublishService.publishCarousel({
        connection: { instagram_user_id: "ig-user", user_access_token: "token" },
        assetUrls: ["https://cdn.example.com/slide-1.jpg", "https://cdn.example.com/slide-2.jpg"],
        caption: "Carousel caption",
        resumeState: { child_creation_ids: ["child-1", "child-2"] },
      });
    } catch (error) {
      publishError = error;
    }

    assert.ok(publishError);
    assert.equal(publishError.code, "instagram_container_failed");
    assert.equal(publishError.details.failed_child_index, 1);
    assert.equal(postCalls, 0);
    const updates = marketingPrivate.buildPublishAttemptFailureUpdates(
      publishError,
      { status: "container_created", child_creation_ids: ["child-1", "child-2"] },
      publishError.message,
    );
    assert.equal(updates.status, "failed");
    assert.equal(updates.creation_id, null);
    assert.deepEqual(updates.child_creation_ids, ["child-1"]);
  } finally {
    axios.post = originalPost;
    axios.get = originalGet;
  }
});

test("Instagram media publish errors are quarantined as uncertain", async () => {
  const originalPost = axios.post;
  const originalGet = axios.get;
  let childNumber = 0;
  axios.post = async (url, body) => {
    if (url.endsWith("/media_publish")) throw new Error("Connection closed before Meta replied");
    if (body.get("media_type") === "CAROUSEL") return { data: { id: "parent-1" } };
    childNumber += 1;
    return { data: { id: `child-${childNumber}` } };
  };
  axios.get = async (url) => ({ data: { id: url.split("/").at(-1), status_code: "FINISHED" } });

  try {
    let publishError = null;
    try {
      await instagramPublishService.publishCarousel({
        connection: { instagram_user_id: "ig-user", user_access_token: "token" },
        assetUrls: ["https://cdn.example.com/slide-1.jpg", "https://cdn.example.com/slide-2.jpg"],
        caption: "Carousel caption",
      });
    } catch (error) {
      publishError = error;
    }

    assert.ok(publishError);
    assert.equal(publishError.code, "instagram_publish_outcome_uncertain");
    assert.equal(publishError.details.instagram_outcome_uncertain, true);
    const updates = marketingPrivate.buildPublishAttemptFailureUpdates(
      publishError,
      { status: "publishing", creation_id: "parent-1", child_creation_ids: ["child-1", "child-2"] },
      publishError.message,
    );
    assert.equal(updates.status, "uncertain");
    const checkpointFailure = Object.assign(new Error("Database checkpoint failed"), {
      details: { instagram_publish_stage: "pre_media_publish", instagram_outcome_uncertain: false },
    });
    assert.equal(marketingPrivate.buildPublishAttemptFailureUpdates(
      checkpointFailure,
      { status: "publishing", creation_id: "parent-1", child_creation_ids: ["child-1", "child-2"] },
      checkpointFailure.message,
    ).status, "failed");
    assert.equal(marketingPrivate.getPublishAttemptLifecycleState({
      status: "uncertain",
      creation_id: "parent-1",
      media_id: null,
    }).outcome_uncertain, true);
  } finally {
    axios.post = originalPost;
    axios.get = originalGet;
  }
});

test("Instagram does not publish when the pre-publish checkpoint fails", async () => {
  const originalPost = axios.post;
  const originalGet = axios.get;
  let childNumber = 0;
  let mediaPublishCalls = 0;
  axios.post = async (url, body) => {
    if (url.endsWith("/media_publish")) {
      mediaPublishCalls += 1;
      return { data: { id: "media-1" } };
    }
    if (body.get("media_type") === "CAROUSEL") return { data: { id: "parent-1" } };
    childNumber += 1;
    return { data: { id: `child-${childNumber}` } };
  };
  axios.get = async (url) => ({ data: { id: url.split("/").at(-1), status_code: "FINISHED" } });

  try {
    await assert.rejects(
      () => instagramPublishService.publishCarousel({
        connection: { instagram_user_id: "ig-user", user_access_token: "token" },
        assetUrls: ["https://cdn.example.com/slide-1.jpg", "https://cdn.example.com/slide-2.jpg"],
        caption: "Carousel caption",
        onProgress: async (progress) => {
          if (progress.status === "publishing") throw new Error("Checkpoint unavailable");
        },
      }),
      (error) => error.code === "instagram_publish_checkpoint_failed"
        && error.details.instagram_outcome_uncertain === false,
    );
    assert.equal(mediaPublishCalls, 0);
  } finally {
    axios.post = originalPost;
    axios.get = originalGet;
  }
});

test("OpenAI image provider strips unsupported parameters for every selectable model", () => {
  const openaiProvider = getImageProviderRegistry().find((provider) => provider.key === "openai");
  assert.ok(openaiProvider, "OpenAI provider should be registered");
  assert.equal(getDefaultModelId("openai"), process.env.OPENAI_IMAGE_MODEL || "gpt-image-2");
  assert.deepEqual(openaiProvider.models.map((model) => model.id), [
    "gpt-image-1-mini",
    "gpt-image-1",
    "gpt-image-1.5",
    "gpt-image-2",
  ]);
  const expectedInputFidelity = new Map([
    ["gpt-image-1-mini", false],
    ["gpt-image-1", true],
    ["gpt-image-1.5", true],
    ["gpt-image-2", false],
  ]);
  for (const model of openaiProvider.models) {
    const expected = expectedInputFidelity.get(model.id);
    assert.equal(model.capabilities.input_fidelity, expected, model.id);
    assert.equal(openaiImageProviderPrivate.supportsInputFidelity(model.id), expected, model.id);
    const request = openaiImageProviderPrivate.buildEditRequestParameters({
      model: model.id,
      prompt: "Product campaign",
      size: "1024x1536",
      quality: "medium",
    });
    assert.equal(Object.hasOwn(request, "input_fidelity"), expected, model.id);
  }
});

test("Google image registry exposes stable models and maps retired selections", () => {
  const googleProvider = getImageProviderRegistry().find((provider) => provider.key === "google");
  assert.ok(googleProvider, "Google provider should be registered");
  assert.deepEqual(googleProvider.models.map((model) => model.id), [
    "gemini-3.1-flash-image",
    "gemini-3.1-flash-lite-image",
    "gemini-3-pro-image",
  ]);

  const originalGeminiModel = process.env.GEMINI_IMAGE_MODEL;
  const originalGoogleModel = process.env.GOOGLE_IMAGE_MODEL;
  delete process.env.GEMINI_IMAGE_MODEL;
  delete process.env.GOOGLE_IMAGE_MODEL;
  try {
    assert.equal(getDefaultModelId("google"), "gemini-3.1-flash-image");
  } finally {
    if (originalGeminiModel == null) delete process.env.GEMINI_IMAGE_MODEL;
    else process.env.GEMINI_IMAGE_MODEL = originalGeminiModel;
    if (originalGoogleModel == null) delete process.env.GOOGLE_IMAGE_MODEL;
    else process.env.GOOGLE_IMAGE_MODEL = originalGoogleModel;
  }

  assert.deepEqual(
    normaliseImageProviderSelection("google", "gemini-3.1-flash-image-preview"),
    { provider: "google", model: "gemini-3.1-flash-image" },
  );
  assert.deepEqual(
    normaliseImageProviderSelection("google", "gemini-3-pro-image-preview"),
    { provider: "google", model: "gemini-3-pro-image" },
  );
  assert.deepEqual(
    normaliseImageProviderSelection("google", "gemini-2.5-flash-image"),
    { provider: "google", model: "gemini-3.1-flash-image" },
  );
});

test("Google stable image models use capability-safe Interactions API requests", async () => {
  const source = await sharp({
    create: { width: 12, height: 15, channels: 3, background: "#d84b7d" },
  }).png().toBuffer();
  const modelSizes = new Map([
    ["gemini-3.1-flash-image", "4K"],
    ["gemini-3.1-flash-lite-image", "1K"],
    ["gemini-3-pro-image", "4K"],
  ]);
  const generated = Buffer.from("generated-google-image");
  const originalFetch = global.fetch;
  const originalApiKey = process.env.GEMINI_API_KEY;
  const calls = [];
  process.env.GEMINI_API_KEY = "test-google-key";
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return {
      ok: true,
      async json() {
        return {
          status: "completed",
          steps: [{
            type: "model_output",
            status: "done",
            content: [{ type: "image", mime_type: "image/jpeg", data: generated.toString("base64") }],
          }],
        };
      },
    };
  };

  try {
    for (const [model, expectedImageSize] of modelSizes) {
      const output = await googleImageProvider.generateImage({
        model,
        prompt: "Preserve this exact product",
        sourceImageBuffer: source,
        size: "1080x1350",
        quality: "high",
      });
      assert.equal(output.equals(generated), true, model);
    }

    assert.equal(calls.length, modelSizes.size);
    for (const call of calls) {
      assert.match(call.url, /\/v1beta\/interactions$/);
      const request = JSON.parse(call.options.body);
      assert.equal(modelSizes.has(request.model), true, request.model);
      assert.deepEqual(request.response_format, {
        type: "image",
        aspect_ratio: "4:5",
        image_size: modelSizes.get(request.model),
      });
      assert.equal(request.input[0].type, "image");
      assert.equal(request.input[0].mime_type, "image/png");
      assert.equal(Buffer.from(request.input[0].data, "base64").equals(source), true);
      assert.deepEqual(request.input[1], { type: "text", text: "Preserve this exact product" });
    }
  } finally {
    global.fetch = originalFetch;
    if (originalApiKey == null) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalApiKey;
  }
});

test("campaign reference images normalize JPEG, PNG, and WebP inputs", async () => {
  assert.equal(resolveProductReferenceImage({
    affiliate_campaign_asset_url: "campaign.jpg",
    featured_image: "featured.jpg",
    images: ["gallery.jpg"],
  }), "campaign.jpg");
  assert.equal(resolveProductReferenceImage({ featured_image: "featured.jpg", images: ["gallery.jpg"] }), "featured.jpg");
  assert.equal(resolveProductReferenceImage({ images: ["gallery.jpg"] }), "gallery.jpg");
  assert.equal(resolveProductReferenceImage({}), null);
  assert.equal(resolveVendorReferenceImage({ featured_image: "vendor.jpg" }, { featured_image: "public.jpg" }), "vendor.jpg");
  assert.equal(resolveVendorReferenceImage(
    { featured_image: "vendor.jpg" },
    { affiliate_campaign_asset_url: "dedicated.jpg", featured_image: "public.jpg" },
  ), "dedicated.jpg");
  assert.equal(resolveVendorReferenceImage({}, { featured_image: "public.jpg" }), "public.jpg");

  const formats = ["jpeg", "png", "webp"];
  for (const format of formats) {
    const pipeline = sharp({
      create: {
        width: 24,
        height: 30,
        channels: 4,
        background: { r: 180, g: 40, b: 90, alpha: 1 },
      },
    });
    const source = await pipeline[format]().toBuffer();
    const normalized = await normalizeReferenceBuffer(source, `test-${format}`);
    const metadata = await sharp(normalized.buffer).metadata();
    assert.equal(normalized.mime_type, "image/png", format);
    assert.equal(metadata.format, "png", format);
    assert.equal(metadata.width, 24, format);
    assert.equal(metadata.height, 30, format);
  }

  await assert.rejects(
    normalizeReferenceBuffer(Buffer.from("not-an-image"), "bad-image"),
    (error) => error.code === "reference_image_unavailable",
  );
});

test("every image provider request includes the required product reference", async () => {
  const source = await sharp({
    create: { width: 12, height: 15, channels: 3, background: "#d84b7d" },
  }).png().toBuffer();

  const openaiForm = openaiImageProviderPrivate.buildEditForm({
    model: "gpt-image-2",
    prompt: "Preserve this exact product",
    sourceImageBuffer: source,
    size: "1024x1536",
    quality: "high",
  });
  const openaiImage = openaiForm.get("image");
  assert.equal(openaiImage.type, "image/png");
  assert.equal(openaiImage.size, source.length);

  const googleBody = googleImageProviderPrivate.buildRequestBody({
    model: "gemini-3.1-flash-image",
    prompt: "Preserve this exact product",
    sourceImageBuffer: source,
    size: "1080x1350",
    quality: "medium",
  });
  assert.equal(googleBody.input[0].type, "image");
  assert.equal(googleBody.input[0].mime_type, "image/png");
  assert.equal(Buffer.from(googleBody.input[0].data, "base64").equals(source), true);

  const openrouterMessages = openrouterImageProviderPrivate.buildMessages({
    prompt: "Preserve this exact product",
    sourceImageBuffer: source,
  });
  assert.match(openrouterMessages[0].content[1].image_url.url, /^data:image\/png;base64,/);
  assert.equal(openrouterMessages[0].content[1].image_url.url.endsWith(source.toString("base64")), true);

  await assert.rejects(
    googleImageProvider.generateImage({ model: "gemini-3.1-flash-image", prompt: "No source" }),
    (error) => error.code === "reference_image_required",
  );
  await assert.rejects(
    openrouterImageProvider.generateImage({ model: "image-model", prompt: "No source" }),
    (error) => error.code === "reference_image_required",
  );
});

test("OpenRouter capability lookup failures use the reference-model error contract", async () => {
  const originalGetModelMetadata = openrouterImageProvider.getModelMetadata;
  openrouterImageProvider.getModelMetadata = async () => {
    throw new Error("OpenRouter unavailable");
  };

  try {
    await assert.rejects(
      imageProviderService.assertReferenceModelSupported("openrouter", "example/image-model"),
      (error) => error.code === "reference_model_unsupported",
    );
  } finally {
    openrouterImageProvider.getModelMetadata = originalGetModelMetadata;
  }
});

test("OpenAI campaign creatives use image edits and never text-only generations", async () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;
  const calls = [];
  process.env.OPENAI_API_KEY = "test-openai-key";
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return {
      ok: true,
      async json() {
        return { data: [{ b64_json: Buffer.from("generated-image").toString("base64") }] };
      },
    };
  };

  try {
    const source = await sharp({
      create: { width: 12, height: 15, channels: 3, background: "#d84b7d" },
    }).png().toBuffer();
    await openaiImageProvider.generateImage({
      model: "gpt-image-2",
      prompt: "Preserve this exact product",
      sourceImageBuffer: source,
      size: "1024x1536",
      quality: "medium",
    });
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/images\/edits$/);
    assert.doesNotMatch(calls[0].url, /\/images\/generations$/);
    assert.equal(calls[0].options.body.get("image").size, source.length);
    assert.ok(calls[0].options.signal instanceof AbortSignal);

    await assert.rejects(
      openaiImageProvider.generateImage({
        model: "gpt-image-2",
        prompt: "No source",
        sourceImageBuffer: null,
      }),
      (error) => error.code === "reference_image_required",
    );
    assert.equal(calls.length, 1);
  } finally {
    global.fetch = originalFetch;
    if (originalApiKey == null) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
  }
});

test("Instagram output fitting preserves the full image without cover cropping", async () => {
  assert.equal(instagramCreativePrivate.generationSizeForProvider("openai", "gpt-image-2"), "1088x1360");
  assert.equal(instagramCreativePrivate.generationSizeForProvider("openai", "gpt-image-1.5"), "1024x1536");
  assert.equal(instagramCreativePrivate.generationSizeForProvider("google", "gemini-3.1-flash-image"), "1080x1350");

  const source = await sharp({
    create: { width: 100, height: 100, channels: 3, background: { r: 220, g: 20, b: 60 } },
  }).png().toBuffer();
  const output = await instagramCreativePrivate.processOutputForInstagram(source);
  const { data, info } = await sharp(output).raw().toBuffer({ resolveWithObject: true });
  const pixel = (x, y, channel) => data[((y * info.width + x) * info.channels) + channel];

  assert.equal(info.width, 1080);
  assert.equal(info.height, 1350);
  assert.ok(pixel(540, 10, 0) > 245 && pixel(540, 10, 1) > 245 && pixel(540, 10, 2) > 245);
  assert.ok(pixel(540, 675, 0) > 190 && pixel(540, 675, 1) < 60 && pixel(540, 675, 2) < 100);
});

test("structured caption parsing enforces schema fields, hashtag limits, and affiliate rules", () => {
  const valid = openAiCaptionPrivate.parseCaptionResponse({
    output_text: JSON.stringify({
      caption: "A considered partner pick for a simple daily routine.",
      hashtags: ["PinkPaisa", "#PartnerPick"],
      cta: "View partner pick",
    }),
  }, { isAffiliate: true });
  assert.deepEqual(valid.hashtags, ["#PinkPaisa", "#PartnerPick"]);

  const percentageAttributes = openAiCaptionPrivate.validateCaptionPackage({
    caption: "A 100% vegan partner pick with 2% Alpha Arbutin positioning.",
    hashtags: ["#VeganBeauty"],
    cta: "View partner pick",
  }, { isAffiliate: true });
  assert.equal(percentageAttributes.caption.includes("100% vegan"), true);

  assert.throws(
    () => openAiCaptionPrivate.validateCaptionPackage({
      caption: "Partner pick",
      hashtags: Array.from({ length: 9 }, (_, index) => `#Tag${index}`),
      cta: "View partner pick",
    }, { isAffiliate: true }),
    /eight-hashtag limit/,
  );
  assert.throws(
    () => openAiCaptionPrivate.validateCaptionPackage({
      caption: "Available now with 20% discount and fast delivery.",
      hashtags: [],
      cta: "Buy from Pink Paisa",
    }, { isAffiliate: true }),
    /affiliate rule/,
  );
  assert.throws(
    () => openAiCaptionPrivate.validateCaptionPackage({
      caption: "Save 20% on this partner pick.",
      hashtags: [],
      cta: "View partner pick",
    }, { isAffiliate: true }),
    /affiliate rule/,
  );
  assert.throws(
    () => openAiCaptionPrivate.validateCaptionPackage({
      caption: "A partner pick for your routine.",
      hashtags: [],
      cta: "Buy now",
    }, { isAffiliate: true }),
    /affiliate rule/,
  );
  assert.throws(
    () => openAiCaptionPrivate.validateCaptionPackage({
      caption: "A partner pick for your routine.",
      hashtags: ["#Sale"],
      cta: "View partner pick",
    }, { isAffiliate: true }),
    /affiliate rule/,
  );
  assert.throws(
    () => openAiCaptionPrivate.validateCaptionPackage({
      caption: "x".repeat(1401),
      hashtags: [],
      cta: "Explore",
    }),
    /allowed length/,
  );
  assert.throws(
    () => openAiCaptionPrivate.parseCaptionResponse({ output_text: "not json" }),
    /not valid JSON/,
  );
});

test("campaign compliance scans hashtags and resolved image copy", async () => {
  const disclosure = marketingAgents.AFFILIATE_INSTAGRAM_DISCLOSURE;
  const compliance = await marketingAgents.runComplianceAgent({
    brief_json: {
      product_url: "https://pinkpaisa.in/product/test-product",
      affiliate_url: "https://www.amazon.in/dp/B0ABCDEFGH?tag=pinkpaisa07-21",
      is_affiliate: true,
      reference_image_url: "https://cdn.example.com/product.jpg",
      campaign_asset: { url: "https://cdn.example.com/product.jpg", rights_status: "admin_confirmed" },
      pricing: { price: null, sale_price: null },
      descriptions: { short: "A curated daily product.", full: "" },
      constraints: { stock_quantity: 1 },
    },
    caption_json: {
      instagram: {
        caption: `A curated partner pick.\n\n${disclosure}`,
        hashtags: ["#Sale", "#ClinicallyProven", "#100PercentSafe"],
        cta: "View partner pick",
      },
    },
    creative_json: {
      source_image_url: "https://cdn.example.com/product.jpg",
      asset_urls: ["https://cdn.example.com/creative.jpg"],
      image_copy: {
        eyebrow: "PINK PAISA PARTNER PICK",
        headline: "Available Now",
        supporting_line: "A curated partner pick.",
        cta: "VIEW PARTNER PICK",
      },
    },
  });

  assert.equal(compliance.status, "needs_review");
  assert.ok(compliance.issues.some((issue) => issue.code === "affiliate_discount_claim"));
  assert.ok(compliance.issues.some((issue) => issue.code === "blocked_claim" && /clinically proven/i.test(issue.message)));
  assert.ok(compliance.issues.some((issue) => issue.code === "blocked_claim" && /100% safe/i.test(issue.message)));
});

test("Instagram caption assembly preserves tracked URLs and affiliate notice within 2200 characters", () => {
  const trackedUrl = "https://pinkpaisa.in/product/test?utm_source=instagram&utm_campaign=campaign";
  const generated = marketingAgentsPrivate.composeInstagramCaption({
    caption: Array.from({ length: 420 }, () => "editorial").join(" "),
    trackedUrl,
    hashtags: Array.from({ length: 8 }, (_, index) => `#CampaignHashtagNumber${index}`),
    isAffiliate: true,
  });

  assert.equal(generated.caption.length <= marketingAgents.INSTAGRAM_CAPTION_MAX_LENGTH, true);
  assert.equal(generated.character_count, generated.caption.length);
  assert.equal(generated.was_truncated, true);
  assert.ok(generated.caption.includes(trackedUrl));
  assert.equal(generated.caption.endsWith(marketingAgents.AFFILIATE_INSTAGRAM_DISCLOSURE), true);

  assert.throws(
    () => marketingAgentsPrivate.composeInstagramCaption({
      caption: "x".repeat(2300),
      trackedUrl,
      hashtags: [],
      isAffiliate: true,
      overflowMode: "error",
    }),
    (error) => error.code === "instagram_caption_too_long"
      && error.message === "Final Instagram caption exceeds 2200 characters.",
  );
});

test("affiliate caption assembly replaces retired notices in stored captions", () => {
  const retiredAssociateNotice = [
    ["As", "an", "Amazon"].join(" "),
    ["Associate", "I", "earn", "from", "qualifying", "purchases."].join(" "),
    `#${["Commissions", "Earned"].join("")}`,
  ].join(" ");
  const retiredCommissionNotice = [
    ["Affiliate", "link:", "Pink", "Paisa"].join(" "),
    ["may", "earn", "a", "commission", "from", "qualifying", "purchases."].join(" "),
    "#Ad",
  ].join(" ");
  const normalized = marketingAgents.ensureAffiliateInstagramDisclosure(
    `A curated partner pick.\n\n${retiredAssociateNotice}\n\n${retiredCommissionNotice}`,
    true,
  );

  assert.equal(normalized.endsWith(marketingAgents.AFFILIATE_INSTAGRAM_DISCLOSURE), true);
  assert.equal(normalized.includes(retiredAssociateNotice), false);
  assert.equal(normalized.includes(retiredCommissionNotice), false);
  assert.equal((normalized.match(/#Ad\b/gi) || []).length, 1);
});

test("new campaign stage sequence skips strategy and stops after tracking", () => {
  assert.equal(marketingPrivate.getNextAutoAgent("intake"), "creative");
  assert.equal(marketingPrivate.getNextAutoAgent("creative"), "caption");
  assert.equal(marketingPrivate.getNextAutoAgent("tracking"), null);
  assert.equal(marketingPrivate.getNextAutoAgent("strategy"), "creative");
});

test("marketing agent tasks support durable lanes, leases, cancellation, and idempotency", () => {
  assert.deepEqual(AgentTask.schema.path("queue_lane").enumValues, ["fast", "creative", "publish"]);
  assert.ok(AgentTask.schema.path("lease_owner"));
  assert.ok(AgentTask.schema.path("lease_expires_at"));
  assert.ok(AgentTask.schema.path("heartbeat_at"));
  assert.ok(AgentTask.schema.path("cancellation_requested"));

  const indexes = AgentTask.schema.indexes();
  assert.ok(indexes.some(([index]) => index.status === 1 && index.queue_lane === 1 && index.available_at === 1));
  assert.ok(indexes.some(([index, options]) => index.idempotency_key === 1 && options.unique && options.sparse));
  assert.equal(marketingPrivate.getQueueLane("tracking"), "fast");
  assert.equal(marketingPrivate.getQueueLane("creative"), "creative");
  assert.equal(marketingPrivate.getQueueLane("publish"), "publish");
  const leaseFilter = marketingPrivate.getActiveLeaseFilter({ _id: "task-id", attempt_count: 2 });
  assert.equal(leaseFilter.status, "running");
  assert.equal(leaseFilter.attempt_count, 2);
  assert.equal(typeof leaseFilter.lease_owner, "string");

  const recoveryFilter = marketingPrivate.buildStaleTaskRecoveryFilter({
    _id: "task-id",
    attempt_count: 2,
    lease_expires_at: new Date("2026-07-14T10:00:00.000Z"),
  }, { now: new Date("2026-07-14T10:01:00.000Z") });
  assert.equal(recoveryFilter.status, "running");
  assert.equal(recoveryFilter.attempt_count, 2);
  assert.deepEqual(recoveryFilter.lease_expires_at, { $lte: new Date("2026-07-14T10:01:00.000Z") });

  const lanes = {
    fast: { queued: 0, running: 0, failed: 0 },
    creative: { queued: 0, running: 0, failed: 0 },
    publish: { queued: 0, running: 0, failed: 0 },
  };
  marketingPrivate.accumulateQueueLaneCounts(lanes, [
    { _id: { lane: "fast", agent_name: "intake", status: "queued" }, count: 2 },
    { _id: { lane: "fast", agent_name: "tracking", status: "queued" }, count: 3 },
    { _id: { lane: "fast", agent_name: "caption", status: "running" }, count: 1 },
  ]);
  assert.equal(lanes.fast.queued, 5);
  assert.equal(lanes.fast.running, 1);
});

test("campaign assets stay on guarded local storage and publish attempts fingerprint payloads", () => {
  assert.deepEqual(MarketingAsset.schema.path("storage_provider").enumValues, ["local", "external"]);
  assert.ok(MarketingPublishAttempt.schema.path("payload_fingerprint"));
  assert.ok(MarketingPublishAttempt.schema.path("group_run_ids"));
  assert.equal(campaignAssetStoragePrivate.safeFileName("campaign-asset.jpg"), "campaign-asset.jpg");
  assert.throws(() => campaignAssetStoragePrivate.safeFileName("../outside.jpg"), /Invalid campaign asset file name/);
  const firstVersion = campaignAssetStoragePrivate.createCampaignAssetVersion();
  const secondVersion = campaignAssetStoragePrivate.createCampaignAssetVersion();
  assert.match(firstVersion, /^[a-z0-9]+-[a-f0-9]{10}$/);
  assert.notEqual(firstVersion, secondVersion);
});

test("durable Instagram attempts are resumed without creating another post", () => {
  const payload = {
    content_type: "carousel",
    asset_urls: ["https://cdn.example.com/a.jpg", "https://cdn.example.com/b.jpg"],
    caption: "Campaign caption",
  };
  const identity = marketingPrivate.buildPublishPayloadIdentity(payload);
  const attempt = {
    content_type: "carousel",
    group_run_ids: ["run-2", "run-1"],
    payload_fingerprint: identity.payloadFingerprint,
    creation_id: "container-1",
    child_creation_ids: ["child-1", "child-2"],
    media_id: "media-1",
    permalink: "https://www.instagram.com/p/example/",
  };

  assert.equal(marketingPrivate.hasDurablePublishedAttempt(attempt), true);
  assert.equal(marketingPrivate.isMatchingDurableCarouselAttempt(attempt, ["run-1", "run-2"], payload), true);
  assert.equal(marketingPrivate.isMatchingDurableCarouselAttempt(attempt, ["run-1", "run-3"], payload), false);
  assert.equal(marketingPrivate.buildPublishResultFromAttempt(attempt, payload).skipped_duplicate_publish, true);
  assert.equal(marketingPrivate.buildPublishResultFromAttempt(attempt, payload).media_id, "media-1");
  const recoveredFromRun = marketingPrivate.mergeAttemptWithRunPublishState({
    ...attempt,
    media_id: null,
  }, {
    instagram_media_id: "media-from-run",
    instagram_permalink: "https://www.instagram.com/p/recovered/",
  });
  assert.equal(recoveredFromRun.media_id, "media-from-run");
  assert.equal(marketingPrivate.isMatchingDurableCarouselAttempt(recoveredFromRun, ["run-1", "run-2"], payload), true);
  assert.equal(marketingPrivate.isUnresolvedPublishAttempt({ status: "publishing", media_id: null }), true);
  assert.equal(marketingPrivate.isUnresolvedPublishAttempt(attempt), false);
  assert.equal(marketingPrivate.getPublishAttemptLifecycleState({
    status: "container_created",
    child_creation_ids: ["child-1"],
    media_id: null,
  }).has_external_work, true);
  assert.equal(marketingPrivate.getPublishAttemptLifecycleState({
    status: "publishing",
    creation_id: "container-1",
    media_id: null,
  }).outcome_uncertain, true);
});

test("stale carousel recovery quarantines an unresolved media publish instead of requeueing", async () => {
  const originalTaskFind = AgentTask.find;
  const originalTaskFindOneAndUpdate = AgentTask.findOneAndUpdate;
  const originalRunFindById = MarketingCampaignRun.findById;
  const originalRunUpdateMany = MarketingCampaignRun.updateMany;
  const originalRunDistinct = MarketingCampaignRun.distinct;
  const originalAttemptFindOne = MarketingPublishAttempt.findOne;
  const originalAttemptUpdateOne = MarketingPublishAttempt.updateOne;
  const taskUpdates = [];
  const attemptUpdates = [];
  const runUpdates = [];
  const task = {
    _id: "task-1",
    campaign_run_id: "run-1",
    campaign_id: "cmp-1",
    agent_name: "carousel",
    status: "running",
    attempt_count: 1,
    started_at: new Date(Date.now() - 60_000),
    input_json: {
      grouped_run_ids: ["run-1", "run-2"],
      carousel: {
        publish_payload: {
          content_type: "carousel",
          asset_urls: ["https://cdn.example.com/1.jpg", "https://cdn.example.com/2.jpg"],
          caption: "Carousel caption",
        },
      },
    },
  };
  const attempt = {
    _id: "attempt-1",
    campaign_run_id: "run-1",
    status: "publishing",
    content_type: "carousel",
    creation_id: "parent-1",
    child_creation_ids: ["child-1", "child-2"],
    media_id: null,
  };

  AgentTask.find = () => ({ sort: async () => [task] });
  AgentTask.findOneAndUpdate = async (_filter, update) => {
    taskUpdates.push(update.$set);
    return { ...task, ...update.$set };
  };
  MarketingCampaignRun.findById = async () => ({ _id: "run-1", campaign_id: "cmp-1", status: "publishing", publish_status: "publishing" });
  MarketingCampaignRun.updateMany = async (filter, update) => {
    runUpdates.push({ filter, update });
    return { modifiedCount: 2 };
  };
  MarketingCampaignRun.distinct = async () => [];
  MarketingPublishAttempt.findOne = async () => attempt;
  MarketingPublishAttempt.updateOne = async (filter, update) => {
    attemptUpdates.push({ filter, update });
    return { modifiedCount: 1 };
  };

  try {
    const result = await marketingAgentOrchestrator.recoverStaleRunningTasks({ force: true });
    assert.equal(result.recovered_count, 1);
    assert.equal(taskUpdates[0].status, "failed");
    assert.equal(attemptUpdates[0].update.$set.status, "uncertain");
    assert.equal(runUpdates[0].update.$set.publish_status, "failed");
    assert.match(taskUpdates[0].error_message, /automatic retry is blocked/i);
  } finally {
    AgentTask.find = originalTaskFind;
    AgentTask.findOneAndUpdate = originalTaskFindOneAndUpdate;
    MarketingCampaignRun.findById = originalRunFindById;
    MarketingCampaignRun.updateMany = originalRunUpdateMany;
    MarketingCampaignRun.distinct = originalRunDistinct;
    MarketingPublishAttempt.findOne = originalAttemptFindOne;
    MarketingPublishAttempt.updateOne = originalAttemptUpdateOne;
  }
});

test("cancelled carousel recovery releases stranded members idempotently", async () => {
  const originalTaskFind = AgentTask.find;
  const originalTaskUpdateOne = AgentTask.updateOne;
  const originalRunFind = MarketingCampaignRun.find;
  const originalRunUpdateMany = MarketingCampaignRun.updateMany;
  const originalAttemptFindOne = MarketingPublishAttempt.findOne;
  const taskUpdates = [];
  const memberUpdates = [];
  const task = {
    _id: "task-2",
    campaign_run_id: "run-1",
    agent_name: "carousel",
    status: "cancelled",
    cancellation_requested: true,
    lease_owner: null,
    input_json: { grouped_run_ids: ["run-1", "run-2"] },
  };

  AgentTask.find = () => ({
    sort() { return this; },
    limit: async () => [task],
  });
  AgentTask.updateOne = async (filter, update) => {
    taskUpdates.push({ filter, update });
    return { modifiedCount: 1 };
  };
  MarketingCampaignRun.find = async () => [{ _id: "run-1" }, { _id: "run-2" }];
  MarketingCampaignRun.updateMany = async (filter, update) => {
    memberUpdates.push({ filter, update });
    return { modifiedCount: 2 };
  };
  MarketingPublishAttempt.findOne = () => ({ lean: async () => null });

  try {
    const result = await marketingAgentOrchestrator.recoverCancelledCarouselMemberships();
    assert.equal(result.recovered_count, 1);
    assert.equal(memberUpdates[0].update.$set.carousel_task_id, null);
    assert.equal(memberUpdates[0].update.$set.publish_status, "ready");
    assert.equal(taskUpdates[0].update.$set.cancellation_requested, false);
  } finally {
    AgentTask.find = originalTaskFind;
    AgentTask.updateOne = originalTaskUpdateOne;
    MarketingCampaignRun.find = originalRunFind;
    MarketingCampaignRun.updateMany = originalRunUpdateMany;
    MarketingPublishAttempt.findOne = originalAttemptFindOne;
  }
});

test("archive membership includes queued grouped carousel tasks", () => {
  const query = marketingPrivate.buildPublishTaskMembershipQuery("run-2");
  assert.deepEqual(query.agent_name.$in, ["publish", "carousel"]);
  assert.deepEqual(query.$or, [
    { campaign_run_id: "run-2" },
    { "input_json.grouped_run_ids": "run-2" },
  ]);
});

test("bulk campaign archive selection is required, deduplicated, and bounded", () => {
  assert.deepEqual(
    marketingPrivate.normalizeBulkCampaignRunIds(["run-2", "run-1", "run-2"]),
    ["run-1", "run-2"]
  );
  assert.throws(
    () => marketingPrivate.normalizeBulkCampaignRunIds([]),
    /Select at least one campaign/
  );
  assert.throws(
    () => marketingPrivate.normalizeBulkCampaignRunIds(Array.from({ length: 101 }, (_, index) => `run-${index}`)),
    /Select no more than 100 campaigns/
  );
});

test("bulk campaign approval is bounded and reports partial success", async () => {
  assert.deepEqual(
    marketingPrivate.normalizeBulkReviewRunIds(["run-2", "run-1", "run-2"]),
    ["run-1", "run-2"]
  );
  assert.throws(
    () => marketingPrivate.normalizeBulkReviewRunIds([]),
    /Select at least one campaign to approve/
  );
  assert.throws(
    () => marketingPrivate.normalizeBulkReviewRunIds(Array.from({ length: 26 }, (_, index) => `run-${index}`)),
    /Select no more than 25 campaigns/
  );

  const calls = [];
  const result = await marketingPrivate.collectBulkCampaignReviewResults(
    ["run-1", "run-2", "run-3"],
    async (runId) => {
      calls.push(runId);
      if (runId === "run-2") throw new Error("Compliance needs review");
      return {
        campaign_id: `campaign-${runId}`,
        product_title: `Product ${runId}`,
        review_status: "approved",
      };
    }
  );

  assert.deepEqual(calls, ["run-1", "run-2", "run-3"]);
  assert.equal(result.requested, 3);
  assert.equal(result.approved, 2);
  assert.equal(result.failed, 1);
  assert.equal(result.results[0].ok, true);
  assert.equal(result.results[1].ok, false);
  assert.equal(result.results[1].message, "Compliance needs review");
  assert.equal(result.results[2].review_status, "approved");
});

test("orphaned publish recovery never republishes and returns unaccepted requests to review", () => {
  const recoveredAt = new Date("2026-07-14T12:00:00.000Z");
  assert.deepEqual(marketingPrivate.buildOrphanPublishRecoveryUpdates({
    review_status: "approved",
    instagram_media_id: null,
  }, null, recoveredAt), {
    status: "approved_for_publish",
    current_stage: "approved_for_publish",
    publish_status: "ready",
    review_stage: null,
    scheduled_for: null,
    last_error: "Recovered an interrupted publish request before Instagram accepted any media.",
  });

  const published = marketingPrivate.buildOrphanPublishRecoveryUpdates({
    review_status: "approved",
    instagram_media_id: "media-from-run",
    instagram_permalink: "https://www.instagram.com/p/recovered/",
  }, null, recoveredAt);
  assert.equal(published.status, "published");
  assert.equal(published.instagram_media_id, "media-from-run");
  assert.equal(published.published_at, recoveredAt);
});

test("campaign asset purge checks every persisted campaign asset reference", () => {
  const query = marketingPrivate.buildCampaignAssetReferenceQuery("https://pinkpaisa.in/uploads/generated/campaigns/a.png", "run-1");
  assert.deepEqual(query._id, { $ne: "run-1" });
  assert.deepEqual(
    query.$or.map((condition) => Object.keys(condition)[0]),
    [
      "asset_urls",
      "published_urls",
      "creative_json.primary_asset_url",
      "creative_json.asset_urls",
      "tracking_json.publish_payload.asset_urls",
    ]
  );
});

test("Amazon URL canonicalization appends only the configured Associate tag", () => {
  const previousTag = process.env.AMAZON_ASSOCIATE_TAG_IN;
  process.env.AMAZON_ASSOCIATE_TAG_IN = "pinkpaisa07-21";
  try {
    const missingTag = canonicalizeAmazonAffiliateUrl("https://www.amazon.in/example-name/dp/B0ABCDEFGH?ref_=abc", {
      marketplace: "amazon_in",
    });
    assert.equal(missingTag.asin, "B0ABCDEFGH");
    assert.equal(missingTag.canonicalUrl, "https://www.amazon.in/dp/B0ABCDEFGH?tag=pinkpaisa07-21");

    const conflicting = canonicalizeAmazonAffiliateUrl("https://www.amazon.in/dp/B0ABCDEFGH?tag=someone-else-21", {
      marketplace: "amazon_in",
    });
    assert.match(conflicting.canonicalUrl, /tag=someone-else-21/);
    assert.ok(validateAmazonAffiliateUrl(conflicting.canonicalUrl, {
      marketplace: "amazon_in",
      requireConfiguredTag: true,
    }).flags.includes("amazon_affiliate_tag_mismatch"));

    const mismatchedMarketplace = canonicalizeAmazonAffiliateUrl("https://www.amazon.com/dp/B0ABCDEFGH", {
      marketplace: "amazon_in",
    });
    assert.equal(mismatchedMarketplace.canonicalUrl, "https://www.amazon.com/dp/B0ABCDEFGH");
    assert.equal(mismatchedMarketplace.marketplace, "amazon_us");
    assert.equal(mismatchedMarketplace.marketplaceMismatch, true);
    assert.ok(validateAmazonAffiliateUrl(mismatchedMarketplace.canonicalUrl, {
      marketplace: "amazon_in",
      requireConfiguredTag: true,
    }).flags.includes("amazon_marketplace_mismatch"));
  } finally {
    process.env.AMAZON_ASSOCIATE_TAG_IN = previousTag;
  }
});

test("affiliate price migration preserves valid values when only one sentinel is zero", () => {
  assert.deepEqual(buildAffiliatePriceMigrationUpdate({
    price: 999,
    sale_price: 0,
    effective_price: 999,
    price_status: "manual_unverified",
  }), {
    price: 999,
    sale_price: null,
    effective_price: 999,
    price_status: "manual_unverified",
    price_verified_at: null,
  });

  assert.deepEqual(buildAffiliatePriceMigrationUpdate({
    price: 0,
    sale_price: 0,
    effective_price: 0,
    attributes: {},
  }), {
    price: null,
    sale_price: null,
    effective_price: null,
    price_status: "unavailable",
    price_verified_at: null,
  });
});

test("affiliate reference-edit prompts preserve exact products and prohibit commercial claims", () => {
  const prompt = buildVariantPrompt({
    variant: "hero",
    brief: {
      title: "Wellness Partner Pick",
      category: "Wellness",
      subcategory: "Self Care",
      is_affiliate: true,
      pricing: { available: false, status: "unavailable", price: null, sale_price: null },
      campaign_asset: { approved: true, url: "https://cdn.example.com/product.png" },
      tags: ["wellness"],
    },
    strategy: { audience: "wellness shoppers", cta: "Explore this affiliate pick" },
    settings: {},
  });
  assert.doesNotMatch(prompt, /(?:\u20b9|Rs\.?)[ ]*0|available at/i);
  assert.match(prompt, /Do not show prices, discounts/i);
  assert.match(prompt, /Preserve the exact product shape, proportions, package structure/i);
  assert.match(prompt, /Modify only the background, lighting, shadows/i);
  assert.doesNotMatch(prompt, /\[[^\]]+\]/);
});

test("campaign prompts separate affiliate and catalog rules and resolve canonical copy", () => {
  const settings = normaliseCampaignSettings({});
  const commonBrief = {
    title: "Premium Botanical Face Serum With Ceramides And Peptides",
    campaign_label: "A Verified Seven Word Product Campaign Label",
    brand_name: "Example Brand",
    category: "Beauty",
    subcategory: "Skin Care",
    descriptions: {
      short: "A lightweight serum for a simple daily skincare routine with a soft finish. Another sentence.",
    },
    brand_context: { tone: ["premium", "editorial"] },
  };
  const affiliate = instagramCreativePrivate.resolveCreativePrompt({
    brief: { ...commonBrief, is_affiliate: true },
    settings,
  });
  const catalog = instagramCreativePrivate.resolveCreativePrompt({
    brief: { ...commonBrief, is_affiliate: false },
    settings,
  });

  assert.equal(affiliate.promptType, "affiliate");
  assert.match(affiliate.prompt, /affiliate discovery item/i);
  assert.equal(affiliate.imageCopy.eyebrow, "PINK PAISA PARTNER PICK");
  assert.equal(affiliate.imageCopy.cta, "VIEW PARTNER PICK");
  assert.equal(affiliate.imageCopy.headline.split(" ").length <= 7, true);
  assert.equal(affiliate.imageCopy.supporting_line.split(" ").length <= 16, true);
  assert.doesNotMatch(affiliate.prompt, /Do not add typography/i);
  assert.doesNotMatch(affiliate.prompt, /\[[A-Z][A-Z0-9_ /-]*\]/i);

  assert.equal(catalog.promptType, "catalog");
  assert.doesNotMatch(catalog.prompt, /affiliate|partner pick|does not manufacture|does not sell|does not ship/i);
  assert.equal(catalog.imageCopy.eyebrow, "PINK PAISA EDITORIAL PICK");
  assert.equal(catalog.imageCopy.cta, "EXPLORE ON PINK PAISA");
  assert.match(catalog.prompt, /Render only the supplied eyebrow/i);
  assert.equal(settings.prompt_defaults.affiliate, DEFAULT_AFFILIATE_CAMPAIGN_AI_PROMPT_TEMPLATE);
  assert.equal(settings.prompt_defaults.catalog, DEFAULT_CATALOG_CAMPAIGN_AI_PROMPT_TEMPLATE);
});

test("campaign prompt validation rejects unknown placeholders before generation", () => {
  assert.throws(
    () => instagramCreativePrivate.resolveCreativePrompt({
      brief: { title: "Product", is_affiliate: false },
      settings: { campaign_ai_catalog_prompt_template: "Create [UNKNOWN_FIELD]" },
    }),
    (error) => error.code === "prompt_template_invalid",
  );
  assert.doesNotThrow(() => instagramCreativePrivate.resolveCreativePrompt({
    brief: { title: "Serum [New Formula]", is_affiliate: false },
    settings: { campaign_ai_catalog_prompt_template: "Feature [PRODUCT_NAME]" },
  }));
});

test("affiliate campaign validation accepts active assigned affiliate products", () => {
  process.env.AMAZON_ASSOCIATE_TAG_IN = "pinkpaisa07-21";
  assert.equal(validateAffiliateProductForCampaign({
    _id: "affiliate-product-id",
    source_type: "admin",
    is_affiliate: true,
    affiliate_url: "https://www.amazon.in/example/dp/B0ABCDEFGH?tag=pinkpaisa07-21",
    affiliate_marketplace: "amazon_in",
    affiliate_tag: "pinkpaisa07-21",
    affiliate_compliance_status: "compliant",
    affiliate_link_check_status: "ok",
    status: "active",
    is_visible: true,
    category: "Beauty",
    subcategory: "Skin Care",
    featured_image: "https://cdn.example.com/product.jpg",
  }), true);
});

test("affiliate campaign validation rejects hidden uncategorized or url-less products", () => {
  process.env.AMAZON_ASSOCIATE_TAG_IN = "pinkpaisa07-21";
  const validProduct = {
    _id: "affiliate-product-id",
    source_type: "admin",
    is_affiliate: true,
    affiliate_url: "https://www.amazon.in/example/dp/B0ABCDEFGH?tag=pinkpaisa07-21",
    affiliate_marketplace: "amazon_in",
    affiliate_tag: "pinkpaisa07-21",
    affiliate_compliance_status: "compliant",
    affiliate_link_check_status: "ok",
    status: "active",
    is_visible: true,
    category: "Beauty",
    subcategory: "Skin Care",
    featured_image: "https://cdn.example.com/product.jpg",
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
  assert.throws(
    () => validateAffiliateProductForCampaign({ ...validProduct, affiliate_tag: "" }),
    /stored Amazon Associate tag/,
  );
  assert.throws(
    () => validateAffiliateProductForCampaign({ ...validProduct, affiliate_link_check_status: "failed", affiliate_link_failure_reason: "Amazon returned an error" }),
    /Amazon returned an error/,
  );
  assert.throws(
    () => validateAffiliateProductForCampaign({ ...validProduct, featured_image: "" }),
    (error) => error.code === "reference_image_required" && /Product image required/.test(error.message),
  );
});

test("campaign catalog product serializer exposes readiness without affiliate prices", () => {
  const serialized = marketingAgentOrchestrator.serialiseCatalogProduct({
    _id: "product-id",
    title: "Affiliate Pick",
    slug: "affiliate-pick",
    source_type: "admin",
    status: "active",
    is_visible: true,
    is_affiliate: true,
    featured_image: "https://cdn.example.com/product.jpg",
    price: 999,
    sale_price: 799,
    category: "Beauty",
    subcategory: "Haircare",
    affiliate_compliance_status: "needs_review",
    affiliate_link_check_status: "unchecked",
    affiliate_tag: "",
    affiliate_url: "",
  });

  assert.equal(serialized.is_affiliate, true);
  assert.equal(serialized.price, null);
  assert.equal(serialized.sale_price, null);
  assert.equal(serialized.readiness_status, "blocked");
  assert.ok(serialized.readiness.blockers.some((blocker) => blocker.code === "affiliate_non_compliant"));
  assert.ok(serialized.readiness.blockers.some((blocker) => blocker.code === "affiliate_tag_missing"));

  const missingImage = marketingAgentOrchestrator.serialiseCatalogProduct({
    _id: "normal-product-id",
    title: "Image-less Product",
    slug: "image-less-product",
    source_type: "admin",
    status: "active",
    is_visible: true,
    is_affiliate: false,
    category: "Beauty",
    subcategory: "Haircare",
  });
  assert.equal(missingImage.readiness.can_queue, false);
  assert.ok(missingImage.readiness.blockers.some((blocker) => blocker.code === "reference_image_required"));
});

test("daily batch helper lets new or empty running batches claim queued runs", () => {
  assert.equal(marketingPrivate.shouldReturnExistingRunningBatch({ status: "running", run_ids: ["run-id"] }, false), true);
  assert.equal(marketingPrivate.shouldReturnExistingRunningBatch({ status: "running", total_runs: 1 }, false), true);
  assert.equal(marketingPrivate.shouldReturnExistingRunningBatch({ status: "running", run_ids: [] }, false), false);
  assert.equal(marketingPrivate.shouldReturnExistingRunningBatch({ status: "running", run_ids: ["run-id"] }, true), false);
  assert.equal(marketingPrivate.shouldReturnExistingRunningBatch({ status: "completed", run_ids: ["run-id"] }, false), false);
});

test("affiliate campaign captions include disclosure and avoid manual Amazon price claims", async () => {
  const affiliateRun = {
    source_event: "affiliate_product.published",
    campaign_id: "cmp-test",
    brief_json: {
      title: "Haircare Pick",
      slug: "haircare-pick",
      is_affiliate: true,
      product_url: "https://pinkpaisa.in/product/haircare-pick",
      affiliate_url: "https://www.amazon.in/example/dp/B0ABCDEFGH?tag=pinkpaisa07-21",
      category: "Beauty",
      subcategory: "Haircare",
      pricing: { price: 0, sale_price: null, currency: "INR" },
      descriptions: { short: "A curated haircare pick.", full: "" },
      constraints: { status: "active", stock_quantity: 0 },
      tags: ["Affiliate"],
      images: ["https://cdn.example.com/product.jpg"],
      affiliate: { source_label: "Amazon.in" },
    },
    strategy_json: {
      angle: "editorial partner pick discovery",
      audience: "Women looking for premium self-care",
      cta: "View partner pick",
    },
    creative_json: {
      cta_text: "View partner pick",
      content_type: "single_image",
      primary_asset_url: "https://cdn.example.com/creative.jpg",
      asset_urls: ["https://cdn.example.com/creative.jpg"],
    },
  };

  const originalFetch = global.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;
  const requests = [];
  process.env.OPENAI_API_KEY = "test-openai-key";
  global.fetch = async (url, options) => {
    requests.push({ url: String(url), body: JSON.parse(options.body) });
    return {
      ok: true,
      async json() {
        return {
          output_text: JSON.stringify({
            caption: "A carefully curated haircare partner pick for your routine.",
            hashtags: ["#PinkPaisa", "#Haircare", "#PartnerPick"],
            cta: "View partner pick",
          }),
        };
      },
    };
  };

  try {
    const caption = await marketingAgents.runCaptionAgent(affiliateRun);
    assert.equal(caption.instagram.caption.endsWith(marketingAgents.AFFILIATE_INSTAGRAM_DISCLOSURE), true);
    assert.doesNotMatch(caption.instagram.caption, /\u20b90|Core price|Partner-listed/i);
    assert.equal(caption.instagram.cta, "View partner pick");

    const tracking = await marketingAgents.runTrackingAgent({
      ...affiliateRun,
      caption_json: caption,
      compliance_json: { status: "approved" },
    });
    assert.equal(tracking.publish_payload.caption.endsWith(marketingAgents.AFFILIATE_INSTAGRAM_DISCLOSURE), true);

    const nonAffiliateCaption = await marketingAgents.runCaptionAgent({
      ...affiliateRun,
      source_event: "admin_product.published",
      brief_json: {
        ...affiliateRun.brief_json,
        is_affiliate: false,
        pricing: { price: 999, sale_price: null, currency: "INR" },
      },
    });
    assert.equal(marketingAgentsPrivate.hasAffiliateInstagramDisclosure(nonAffiliateCaption.instagram.caption), false);
    assert.ok(requests.every((request) => request.url.endsWith("/responses")));
    assert.ok(requests.every((request) => request.body.text.format.schema.properties.hashtags.maxItems === 8));
  } finally {
    global.fetch = originalFetch;
    if (originalApiKey == null) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
  }
});

test("publish readiness blocks unsafe affiliate products and non-HTTPS media", () => {
  process.env.AMAZON_ASSOCIATE_TAG_IN = "pinkpaisa07-21";
  const run = {
    _id: "run-id",
    campaign_id: "cmp-test",
    source_event: "affiliate_product.published",
    public_product_id: "product-id",
    review_status: "approved",
    publish_status: "ready",
    status: "approved_for_publish",
    brief_json: {
      is_affiliate: true,
      reference_image_url: "https://cdn.example.com/product.jpg",
    },
    creative_json: {
      source_image_url: "https://cdn.example.com/product.jpg",
    },
    compliance_json: { status: "approved", issues: [] },
    tracking_json: {
      publish_payload: {
        asset_urls: ["https://cdn.example.com/creative.jpg"],
        caption: marketingAgents.AFFILIATE_INSTAGRAM_DISCLOSURE,
      },
    },
  };
  const product = {
    _id: "product-id",
    title: "Compliant Affiliate",
    source_type: "admin",
    is_affiliate: true,
    status: "active",
    is_visible: true,
    category: "Beauty",
    subcategory: "Haircare",
    affiliate_url: "https://www.amazon.in/example/dp/B0ABCDEFGH?tag=pinkpaisa07-21",
    affiliate_marketplace: "amazon_in",
    affiliate_tag: "pinkpaisa07-21",
    affiliate_compliance_status: "compliant",
    affiliate_link_check_status: "ok",
    featured_image: "https://cdn.example.com/product.jpg",
  };

  assert.equal(marketingPrivate.buildRunPublishReadinessSnapshot(run, product, { productWasFetched: true }).can_publish, true);

  const complianceBlocked = marketingPrivate.buildRunPublishReadinessSnapshot({
    ...run,
    compliance_json: {
      status: "needs_review",
      issues: [{ severity: "blocking", code: "blocked_claim", message: "Unsupported claim" }],
    },
  }, product, { productWasFetched: true });
  assert.equal(complianceBlocked.can_publish, false);
  assert.ok(complianceBlocked.blockers.some((blocker) => blocker.code === "compliance_blocked"));

  const cases = [
    [{ ...product, is_visible: false }, "product_hidden"],
    [{ ...product, status: "inactive" }, "product_inactive"],
    [{ ...product, category: "Uncategorized" }, "product_uncategorized"],
    [{ ...product, affiliate_compliance_status: "needs_review" }, "affiliate_not_compliant"],
    [{ ...product, affiliate_compliance_status: "paused" }, "affiliate_paused"],
    [{ ...product, affiliate_tag: "" }, "affiliate_tag_missing"],
    [{ ...product, affiliate_url: "https://www.amazon.in/example/dp/B0ABCDEFGH" }, "amazon_affiliate_tag_missing"],
    [{ ...product, affiliate_link_check_status: "failed", affiliate_link_failure_reason: "Link failed" }, "affiliate_link_failed"],
  ];

  for (const [unsafeProduct, code] of cases) {
    const readiness = marketingPrivate.buildRunPublishReadinessSnapshot(run, unsafeProduct, { productWasFetched: true });
    assert.equal(readiness.can_publish, false, code);
    assert.ok(readiness.blockers.some((blocker) => blocker.code === code), code);
  }

  const nonHttps = marketingPrivate.buildRunPublishReadinessSnapshot({
    ...run,
    tracking_json: {
      publish_payload: {
        ...run.tracking_json.publish_payload,
        asset_urls: ["http://cdn.example.com/creative.jpg"],
      },
    },
  }, product, { productWasFetched: true });
  assert.equal(nonHttps.can_publish, false);
  assert.ok(nonHttps.blockers.some((blocker) => blocker.code === "non_https_media_url"));
  assert.doesNotThrow(() => marketingPrivate.assertReviewApprovalReadiness(nonHttps));

  const missingDisclosure = marketingPrivate.buildRunPublishReadinessSnapshot({
    ...run,
    tracking_json: {
      publish_payload: {
        ...run.tracking_json.publish_payload,
        caption: "Explore this partner pick.",
      },
    },
  }, product, { productWasFetched: true });
  assert.ok(missingDisclosure.blockers.some((blocker) => blocker.code === "affiliate_disclosure_missing"));
  assert.throws(
    () => marketingPrivate.assertReviewApprovalReadiness(missingDisclosure),
    /Affiliate notice is required/,
  );
  assert.throws(
    () => marketingPrivate.assertReviewApprovalReadiness(complianceBlocked),
    /blocking compliance issues|Resolve all blocking compliance issues/,
  );
});

test("carousel readiness reports unsafe selected affiliate runs before publishing", () => {
  process.env.AMAZON_ASSOCIATE_TAG_IN = "pinkpaisa07-21";
  const makeRun = (id, productId) => ({
    _id: id,
    campaign_id: `cmp-${id}`,
    product_title: `Product ${id}`,
    source_event: "affiliate_product.published",
    public_product_id: productId,
    review_status: "approved",
    publish_status: "ready",
    status: "approved_for_publish",
    brief_json: {
      is_affiliate: true,
      reference_image_url: "https://cdn.example.com/product.jpg",
    },
    creative_json: {
      source_image_url: "https://cdn.example.com/product.jpg",
    },
    compliance_json: { status: "approved", issues: [] },
    tracking_json: {
      publish_payload: {
        asset_urls: ["https://cdn.example.com/creative.jpg"],
        caption: marketingAgents.AFFILIATE_INSTAGRAM_DISCLOSURE,
      },
    },
  });
  const compliantProduct = {
    _id: "product-1",
    source_type: "admin",
    is_affiliate: true,
    status: "active",
    is_visible: true,
    category: "Beauty",
    subcategory: "Haircare",
    affiliate_url: "https://www.amazon.in/example/dp/B0ABCDEFGH?tag=pinkpaisa07-21",
    affiliate_marketplace: "amazon_in",
    affiliate_tag: "pinkpaisa07-21",
    affiliate_compliance_status: "compliant",
    affiliate_link_check_status: "ok",
    featured_image: "https://cdn.example.com/product.jpg",
  };
  const hiddenProduct = { ...compliantProduct, _id: "product-2", is_visible: false };
  const blockers = marketingPrivate.buildCarouselReadinessBlockers(
    [makeRun("1", "product-1"), makeRun("2", "product-2")],
    new Map([
      ["product-1", compliantProduct],
      ["product-2", hiddenProduct],
    ]),
  );

  assert.equal(blockers.length, 1);
  assert.equal(blockers[0].product_title, "Product 2");
  assert.equal(blockers[0].code, "product_hidden");
  assert.equal(
    marketingPrivate.buildBulkCarouselCaption([makeRun("1", "product-1")]).endsWith(marketingAgents.AFFILIATE_INSTAGRAM_DISCLOSURE),
    true,
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
    auth_version: 4,
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
  assert.equal(user.auth_version, 5);
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
  assert.equal(flat.price, null);
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
  assert.equal(safeManual.price, null);
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
  assert.equal(amazonMediaManual.price, null);

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
  assert.equal(missingExpiry.price, null);

  const fresh = productPrivate.toFlat({
    ...baseProduct,
    price_status: "verified",
    affiliate_data_expires_at: new Date(Date.now() + 60 * 60 * 1000),
  }, { publicView: true });
  assert.equal(fresh.featured_image, "https://example.com/api-image.jpg");
  assert.equal(fresh.price, 999);
  assert.equal(fresh.sale_price, 799);

  const expired = productPrivate.toFlat({
    ...baseProduct,
    price_status: "verified",
    affiliate_data_expires_at: new Date(Date.now() - 60 * 1000),
  }, { publicView: true });
  assert.equal(expired.featured_image, null);
  assert.equal(expired.price, null);
  assert.equal(expired.price_status, "stale");
});

test("wishlist serialization hides affiliate prices without fresh API-approved data", () => {
  const manualAffiliate = wishlistPrivate.serializeProduct({
    _id: "affiliate-product-id",
    slug: "affiliate-pick",
    title: "Affiliate Pick",
    featured_image: "https://cdn.example.com/product.jpg",
    price: 999,
    sale_price: 799,
    stock_quantity: 25,
    is_affiliate: true,
    affiliate_url: "https://www.amazon.in/dp/B0ABCDEFGH?tag=pinkpaisa07-21",
    affiliate_data_source: "manual",
    affiliate_compliance_status: "compliant",
  });

  assert.equal(manualAffiliate.is_affiliate, true);
  assert.equal(manualAffiliate.price, null);
  assert.equal(manualAffiliate.sale_price, null);
  assert.equal(manualAffiliate.stock_quantity, 0);

  const freshApiAffiliate = wishlistPrivate.serializeProduct({
    _id: "affiliate-product-id",
    slug: "affiliate-pick",
    title: "Affiliate Pick",
    featured_image: "https://cdn.example.com/product.jpg",
    price: 999,
    sale_price: 799,
    stock_quantity: 25,
    is_affiliate: true,
    affiliate_url: "https://www.amazon.in/dp/B0ABCDEFGH?tag=pinkpaisa07-21",
    affiliate_data_source: "creators_api",
    price_status: "verified",
    affiliate_data_expires_at: new Date(Date.now() + 60_000).toISOString(),
    affiliate_compliance_status: "compliant",
  });

  assert.equal(freshApiAffiliate.price, 999);
  assert.equal(freshApiAffiliate.sale_price, 799);
  assert.equal(freshApiAffiliate.stock_quantity, 0);
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
  assert.equal(manual.price, null);

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

  const aliasImageManual = affiliateProductPrivate.buildAffiliateImageContent(
    { featured_image: "https://cdn.example.com/featured-alias.jpg" },
    null,
    "manual",
    "Manual product"
  );
  assert.equal(aliasImageManual.featured_image, "https://cdn.example.com/featured-alias.jpg");

  const mergedPayload = affiliateProductPrivate.buildAffiliatePayloadSnapshot(
    { image_url: "https://m.media-amazon.com/images/I/new-product.jpg", title: "Manual product" },
    { affiliate_payload: { image_url: "", existing_field: "keep-me" } },
    "https://m.media-amazon.com/images/I/new-product.jpg",
    "manual"
  );
  assert.equal(mergedPayload.image_url, "https://m.media-amazon.com/images/I/new-product.jpg");
  assert.equal(mergedPayload.manual_image_url, "https://m.media-amazon.com/images/I/new-product.jpg");
  assert.equal(mergedPayload.existing_field, "keep-me");
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
  assert.equal(errors.buying_intent, undefined);
  assert.equal(errors.campaign_label, undefined);
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
    assert.equal(notReady.current_mode, "manual_only");
    assert.equal(notReady.manual_available, true);
    assert.equal(notReady.creators_can_enable, false);
    assert.equal(notReady.creators_can_refresh, false);
    assert.match(notReady.disabled_reason, /not implemented/i);

    const response = creatorsApiService.buildAffiliateDataModeResponse({
      affiliate_data_mode: "creators_api",
      affiliate_data_marketplaces: ["amazon_in"],
      affiliate_creators_api_health_status: "ok",
    });
    assert.equal(response.requested_affiliate_data_mode, "creators_api");
    assert.equal(response.affiliate_data_mode, "manual_only");
    assert.equal(response.current_mode, "manual_only");
    assert.equal(response.creators_adapter_implemented, false);
    assert.equal(response.creators_can_enable, false);

    const manual = creatorsApiPrivate.buildCreatorsApiReadiness({
      settings: {
        affiliate_data_mode: "manual_only",
        affiliate_data_marketplaces: ["amazon_in"],
        affiliate_creators_api_health_status: "ok",
      },
      envStatus: getCreatorsApiEnvStatus(),
    });
    assert.equal(manual.ready, false);
    assert.equal(manual.current_mode, "manual_only");
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

test("logger omits enumerable request bodies from nested errors", () => {
  const originalConsoleError = console.error;
  let output = "";
  console.error = (value) => {
    output = String(value || "");
  };

  try {
    const error = new SyntaxError("Malformed JSON");
    error.body = '{"email":"admin@example.com","password":"do-not-log"}';
    logger.error({ err: error }, "request failed");
  } finally {
    console.error = originalConsoleError;
  }

  const payload = JSON.parse(output);
  assert.equal(payload.err.name, "SyntaxError");
  assert.equal(payload.err.message, "Malformed JSON");
  assert.equal(Object.hasOwn(payload.err, "body"), false);
  assert.doesNotMatch(output, /do-not-log|admin@example\.com/);
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
