const AMAZON_IMAGE_HOST_SUFFIXES = [
  "media-amazon.com",
  "ssl-images-amazon.com",
  "images-amazon.com",
];

const AMAZON_RETAIL_HOSTS = new Set([
  "amazon.com",
  "www.amazon.com",
  "amazon.in",
  "www.amazon.in",
  "amzn.to",
  "www.amzn.to",
]);

function normalizeString(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function getHostname(value) {
  const normalized = normalizeString(value);
  if (!normalized || normalized.startsWith("/uploads/")) return null;
  try {
    return new URL(normalized).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isAmazonHostedImageUrl(value) {
  const hostname = getHostname(value);
  if (!hostname) return false;
  if (AMAZON_RETAIL_HOSTS.has(hostname)) return true;
  return AMAZON_IMAGE_HOST_SUFFIXES.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`));
}

function normalizeManualAffiliateImageUrl(value) {
  const normalized = normalizeString(value);
  if (!normalized) return null;
  if (normalized.startsWith("/uploads/")) return normalized;

  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error("Manual image URL must be a valid absolute URL or /uploads/ path");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Manual image URL must use http or https");
  }

  return parsed.toString();
}

function buildImagePayload(imageUrl, title = "Affiliate product") {
  const normalized = normalizeString(imageUrl);
  if (!normalized) {
    return {
      images: [],
      image_items: [],
      featured_image: null,
    };
  }

  return {
    images: [normalized],
    image_items: [{ url: normalized, alt: title, position: 0 }],
    featured_image: normalized,
  };
}

function filterManualAffiliateImages(doc = {}) {
  const imageItems = Array.isArray(doc.image_items) ? doc.image_items : [];
  const legacyImages = Array.isArray(doc.images) ? doc.images : [];
  const candidateItems = imageItems.length
    ? imageItems
    : [
      normalizeString(doc.featured_image) ? { url: normalizeString(doc.featured_image), alt: doc.title || null, position: 0 } : null,
      ...legacyImages.map((url, index) => ({ url, alt: doc.title || null, position: index + 1 })),
    ].filter(Boolean);

  const seen = new Set();
  const safeItems = candidateItems
    .map((item, index) => ({
      url: normalizeString(typeof item === "string" ? item : item?.url),
      alt: normalizeString(typeof item === "string" ? doc.title : item?.alt) || doc.title || null,
      position: Number.isFinite(Number(item?.position)) ? Number(item.position) : index,
    }))
    .filter((item) => item.url)
    .filter((item) => {
      if (seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    })
    .sort((left, right) => left.position - right.position)
    .map((item, index) => ({ ...item, position: index }));

  const featured = safeItems.find((item) => item.url === doc.featured_image)?.url || safeItems[0]?.url || null;
  return {
    images: safeItems.map((item) => item.url),
    image_items: safeItems,
    featured_image: featured,
  };
}

module.exports = {
  buildImagePayload,
  filterManualAffiliateImages,
  isAmazonHostedImageUrl,
  normalizeManualAffiliateImageUrl,
};
