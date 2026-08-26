const test = require("node:test");
const assert = require("node:assert/strict");
const axios = require("axios");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-with-enough-length";

const Product = require("../models/Product");
const productPrivate = require("../controllers/productController")._private;
const {
  INDETERMINATE_HTTP_STATUSES,
  checkAffiliateProductLink,
  persistAffiliateLinkCheck,
} = require("../services/affiliateLinkChecker");
const {
  hasVerifiedContact,
  isPublicPinkPagesListing,
} = require("../utils/pinkPagesPublicPolicy");
const virtualProductPrivate = require("../controllers/virtualProductController")._private;

test("promoted product filters require Instagram selection and healthy link state", async () => {
  const result = await productPrivate.buildProductFilter({
    query: {
      is_affiliate: "true",
      affiliate_instagram_pick: "true",
      affiliate_link_status: "ok",
    },
    user: null,
  });

  const serialized = JSON.stringify(result.filter);
  assert.match(serialized, /"affiliate_is_instagram_pick":true/);
  assert.match(serialized, /"affiliate_link_check_status":"ok"/);
  assert.match(serialized, /"affiliate_compliance_status":"compliant"/);
});

test("product schema and public response retain the optional editorial title", () => {
  const linkStatusPath = Product.schema.path("affiliate_link_check_status");
  assert.ok(linkStatusPath.enumValues.includes("indeterminate"));

  const flat = productPrivate.toFlat({
    _id: { toString: () => "product-id" },
    title: "Authentic Amazon Catalogue Product Title",
    editorial_title: "Compact Pink Paisa Pick",
    is_affiliate: false,
    price: 500,
  }, { publicView: true });
  assert.equal(flat.title, "Authentic Amazon Catalogue Product Title");
  assert.equal(flat.editorial_title, "Compact Pink Paisa Pick");
});

test("Amazon 503 is indeterminate and cannot increase the permanent failure count", async (t) => {
  const previousTag = process.env.AMAZON_ASSOCIATE_TAG_IN;
  process.env.AMAZON_ASSOCIATE_TAG_IN = "pinkpaisa07-21";
  t.after(() => {
    if (previousTag == null) delete process.env.AMAZON_ASSOCIATE_TAG_IN;
    else process.env.AMAZON_ASSOCIATE_TAG_IN = previousTag;
  });

  t.mock.method(axios, "request", async () => ({ status: 503, data: null, headers: {} }));
  const result = await checkAffiliateProductLink({
    affiliate_url: "https://www.amazon.in/dp/B0ABCDEFGH?tag=pinkpaisa07-21",
    affiliate_marketplace: "amazon_in",
  });

  assert.equal(INDETERMINATE_HTTP_STATUSES.has(429), true);
  assert.equal(result.ok, false);
  assert.equal(result.status, "indeterminate");
  assert.equal(result.retry, true);

  const product = {
    affiliate_link_failure_count: 2,
    status: "active",
    is_visible: true,
    affiliate_compliance_status: "compliant",
    affiliate_compliance_flags: [],
    async save() {},
  };
  await persistAffiliateLinkCheck(product, result);
  assert.equal(product.affiliate_link_check_status, "indeterminate");
  assert.equal(product.affiliate_link_failure_count, 2);
  assert.equal(product.status, "active");
  assert.equal(product.is_visible, true);
});

test("Pink Pages public policy excludes placeholder contact details", () => {
  assert.equal(hasVerifiedContact({ email: "EXAMPLE@GMAIL.COM" }), false);
  assert.equal(isPublicPinkPagesListing({ status: "active", verified: true, email: "EXAMPLE@GMAIL.COM" }), false);
  assert.equal(isPublicPinkPagesListing({ status: "active", verified: true, email: "owner@example.org" }), true);
});

test("digital products stay hidden publicly until fulfilment is explicitly launched", () => {
  const previous = process.env.DIGITAL_PRODUCTS_ENABLED;
  try {
    process.env.DIGITAL_PRODUCTS_ENABLED = "false";
    assert.equal(virtualProductPrivate.canReadDigitalProducts({ user: null }), false);
    assert.equal(virtualProductPrivate.canReadDigitalProducts({ user: { role: "admin" } }), true);
    process.env.DIGITAL_PRODUCTS_ENABLED = "true";
    assert.equal(virtualProductPrivate.canReadDigitalProducts({ user: null }), true);
  } finally {
    if (previous === undefined) delete process.env.DIGITAL_PRODUCTS_ENABLED;
    else process.env.DIGITAL_PRODUCTS_ENABLED = previous;
  }
});
