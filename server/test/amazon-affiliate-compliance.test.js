const test = require("node:test");
const assert = require("node:assert/strict");

const {
  detectMarketplace,
  extractAffiliateTag,
  extractAsin,
  validateAmazonAffiliateUrl,
} = require("../services/amazonAffiliateCompliance");
const { _private } = require("../controllers/affiliateEventController");

test("Amazon affiliate validator accepts tagged Amazon.in and Amazon.com product URLs", () => {
  process.env.AMAZON_ASSOCIATE_TAG_IN = "pinkpaisa-21";
  process.env.AMAZON_ASSOCIATE_TAG_US = "pinkpaisa-20";

  const india = validateAmazonAffiliateUrl("https://www.amazon.in/Example/dp/B0CTVGPLQX?tag=pinkpaisa-21");
  assert.equal(india.isValid, true);
  assert.equal(india.marketplace, "amazon_in");
  assert.equal(india.asin, "B0CTVGPLQX");
  assert.equal(india.affiliateTag, "pinkpaisa-21");

  const us = validateAmazonAffiliateUrl("https://www.amazon.com/gp/product/B0D1234567?tag=pinkpaisa-20");
  assert.equal(us.isValid, true);
  assert.equal(us.marketplace, "amazon_us");
  assert.equal(us.asin, "B0D1234567");
  assert.equal(us.affiliateTag, "pinkpaisa-20");
});

test("Amazon affiliate validator rejects missing tags, marketplace mismatches, and short links", () => {
  process.env.AMAZON_ASSOCIATE_TAG_IN = "pinkpaisa-21";

  const missingTag = validateAmazonAffiliateUrl("https://www.amazon.in/dp/B0CTVGPLQX");
  assert.equal(missingTag.isValid, false);
  assert.ok(missingTag.flags.includes("amazon_affiliate_tag_missing"));

  const wrongMarketplace = validateAmazonAffiliateUrl("https://www.amazon.com/dp/B0D1234567?tag=pinkpaisa-20", { marketplace: "amazon_in" });
  assert.equal(wrongMarketplace.isValid, false);
  assert.ok(wrongMarketplace.flags.includes("amazon_marketplace_mismatch"));

  const shortLink = validateAmazonAffiliateUrl("https://amzn.to/example");
  assert.equal(shortLink.isValid, false);
  assert.ok(shortLink.flags.includes("amazon_short_link_rejected"));
});

test("Amazon affiliate helpers extract ASIN, marketplace, and tag", () => {
  const url = "https://www.amazon.com/Some-Product/gp/product/B0D1234567?tag=pinkpaisa-20&th=1";
  assert.equal(extractAsin(url), "B0D1234567");
  assert.equal(detectMarketplace(url), "amazon_us");
  assert.equal(extractAffiliateTag(url), "pinkpaisa-20");
});

test("affiliate click dedupe key is stable inside the rapid-click window", () => {
  const originalNow = Date.now;
  Date.now = () => 1234567890;
  try {
    const first = _private.buildDedupeKey({
      eventType: "outbound_click",
      productId: "product-id",
      ipHash: "ip-hash",
      userAgentHash: "ua-hash",
    });
    const second = _private.buildDedupeKey({
      eventType: "outbound_click",
      productId: "product-id",
      ipHash: "ip-hash",
      userAgentHash: "ua-hash",
    });
    assert.equal(first, second);
  } finally {
    Date.now = originalNow;
  }
});
