const MARKETPLACES = {
  amazon_in: {
    label: "Amazon.in",
    hosts: new Set(["amazon.in", "www.amazon.in"]),
    envTagKey: "AMAZON_ASSOCIATE_TAG_IN",
    defaultBaseUrl: "https://www.amazon.in",
    currency: "INR",
  },
  amazon_us: {
    label: "Amazon.com",
    hosts: new Set(["amazon.com", "www.amazon.com"]),
    envTagKey: "AMAZON_ASSOCIATE_TAG_US",
    defaultBaseUrl: "https://www.amazon.com",
    currency: "USD",
  },
};

const SHORTENER_HOSTS = new Set(["amzn.to", "www.amzn.to"]);
const PRODUCT_PATH_RE = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?#]|$)/i;
const ASIN_QUERY_RE = /(?:^|[?&])(?:asin|ASIN)=([A-Z0-9]{10})(?:&|$)/;

function normalizeUrl(value, marketplace = "amazon_in") {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const fallback = MARKETPLACES[marketplace]?.defaultBaseUrl || MARKETPLACES.amazon_in.defaultBaseUrl;
  if (raw.startsWith("//")) return `https:${raw}`;
  if (raw.startsWith("/")) return `${fallback}${raw}`;
  if (!/^https?:\/\//i.test(raw)) return `https://${raw}`;
  return raw;
}

function parseUrl(value) {
  try {
    const normalized = normalizeUrl(value);
    return normalized ? new URL(normalized) : null;
  } catch {
    return null;
  }
}

function detectMarketplace(value) {
  const parsed = parseUrl(value);
  if (!parsed) return null;
  const host = parsed.hostname.toLowerCase();
  for (const [key, config] of Object.entries(MARKETPLACES)) {
    if (config.hosts.has(host)) return key;
  }
  return null;
}

function extractAsin(value) {
  if (!value) return null;
  const normalized = String(value);
  const pathMatch = normalized.match(PRODUCT_PATH_RE);
  if (pathMatch) return pathMatch[1].toUpperCase();
  const queryMatch = normalized.match(ASIN_QUERY_RE);
  return queryMatch ? queryMatch[1].toUpperCase() : null;
}

function getConfiguredTag(marketplace) {
  const envKey = MARKETPLACES[marketplace]?.envTagKey;
  return envKey ? String(process.env[envKey] || "").trim() : "";
}

function extractAffiliateTag(value) {
  const parsed = parseUrl(value);
  if (!parsed) return null;
  return parsed.searchParams.get("tag") || null;
}

function canonicalizeAmazonAffiliateUrl(value, { marketplace: requestedMarketplace = null, appendConfiguredTag = true } = {}) {
  const originalUrl = normalizeUrl(value, requestedMarketplace || "amazon_in");
  const detectedMarketplace = detectMarketplace(originalUrl);
  const marketplace = detectedMarketplace || requestedMarketplace;
  const asin = extractAsin(originalUrl);
  const parsed = parseUrl(originalUrl);
  if (requestedMarketplace && detectedMarketplace && requestedMarketplace !== detectedMarketplace) {
    return {
      originalUrl,
      canonicalUrl: originalUrl,
      marketplace: detectedMarketplace,
      asin,
      affiliateTag: extractAffiliateTag(originalUrl),
      marketplaceMismatch: true,
    };
  }
  if (!parsed || !marketplace || !asin || !MARKETPLACES[marketplace]) {
    return { originalUrl, canonicalUrl: originalUrl, marketplace: marketplace || null, asin, affiliateTag: extractAffiliateTag(originalUrl) };
  }

  const existingTag = extractAffiliateTag(originalUrl);
  const configuredTag = getConfiguredTag(marketplace);
  const affiliateTag = existingTag || (appendConfiguredTag ? configuredTag : "") || null;
  const canonical = new URL(`/dp/${asin}`, MARKETPLACES[marketplace].defaultBaseUrl);
  if (affiliateTag) canonical.searchParams.set("tag", affiliateTag);
  return {
    originalUrl,
    canonicalUrl: canonical.toString(),
    marketplace,
    asin,
    affiliateTag,
  };
}

function validateAmazonAffiliateUrl(value, { marketplace: requestedMarketplace = null, requireConfiguredTag = true } = {}) {
  const flags = [];
  const normalizedUrl = normalizeUrl(value, requestedMarketplace || "amazon_in");
  const parsed = parseUrl(normalizedUrl);

  if (!normalizedUrl || !parsed) {
    return {
      isValid: false,
      normalizedUrl,
      marketplace: requestedMarketplace,
      asin: null,
      affiliateTag: null,
      flags: ["affiliate_url_invalid"],
    };
  }

  const host = parsed.hostname.toLowerCase();
  if (SHORTENER_HOSTS.has(host)) flags.push("amazon_short_link_rejected");

  const detectedMarketplace = detectMarketplace(normalizedUrl);
  if (!detectedMarketplace) flags.push("amazon_marketplace_unsupported");
  if (requestedMarketplace && detectedMarketplace && requestedMarketplace !== detectedMarketplace) {
    flags.push("amazon_marketplace_mismatch");
  }

  const marketplace = requestedMarketplace || detectedMarketplace;
  const asin = extractAsin(normalizedUrl);
  if (!asin) flags.push("amazon_asin_missing");

  const affiliateTag = extractAffiliateTag(normalizedUrl);
  if (!affiliateTag) flags.push("amazon_affiliate_tag_missing");

  if (marketplace && requireConfiguredTag) {
    const configuredTag = getConfiguredTag(marketplace);
    if (!configuredTag) flags.push("amazon_affiliate_tag_not_configured");
    else if (affiliateTag && affiliateTag !== configuredTag) flags.push("amazon_affiliate_tag_mismatch");
  }

  return {
    isValid: flags.length === 0,
    normalizedUrl,
    marketplace: marketplace || null,
    asin,
    affiliateTag,
    flags,
  };
}

function buildComplianceStatus(flags = []) {
  return flags.length ? "needs_review" : "compliant";
}

module.exports = {
  MARKETPLACES,
  buildComplianceStatus,
  canonicalizeAmazonAffiliateUrl,
  detectMarketplace,
  extractAffiliateTag,
  extractAsin,
  getConfiguredTag,
  normalizeUrl,
  validateAmazonAffiliateUrl,
};
