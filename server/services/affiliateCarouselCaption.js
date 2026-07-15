const {
  AFFILIATE_INSTAGRAM_DISCLOSURE,
  INSTAGRAM_CAPTION_MAX_LENGTH,
  ensureAffiliateInstagramDisclosure,
  isAffiliateDisclosureHashtag,
  stripAffiliateInstagramDisclosure,
} = require("./marketingAgents");
const {
  normalizeHashtagForCompliance,
  validateCaptionPackage,
} = require("./openAiCaptionService");

const DEFAULT_AFFILIATE_CAROUSEL_CAPTION = "A curated edit of Pink Paisa partner picks. Explore each product through its Pink Paisa link below.";
const GENERIC_BLOCKED_CLAIMS = [
  { code: "blocked_claim", label: "cure", pattern: /\bcures?\b/i },
  { code: "blocked_claim", label: "guaranteed", pattern: /\bguaranteed\b/i },
  { code: "blocked_claim", label: "instant results", pattern: /\binstant\s*results?\b/i },
  { code: "blocked_claim", label: "100% safe", pattern: /\b100\s*(?:%|percent)\s*safe\b/i },
  { code: "blocked_claim", label: "risk-free", pattern: /\brisk[-\s]*free\b/i },
  { code: "blocked_claim", label: "miracle", pattern: /\bmiracle\b/i },
  { code: "blocked_claim", label: "clinically proven", pattern: /\bclinically\s*proven\b/i },
];
const URL_PATTERN = /(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/\S*)?/i;
const HASHTAG_PATTERN = /#[a-zA-Z0-9_]+/;
const PRODUCT_TITLE_PERCENTAGE_PATTERN = /\b\d+(?:\.\d+)?\s*%/g;
const PRODUCT_TITLE_DISCOUNT_PATTERN = /\b(?:sale|discount|coupon|deal price)\b|\b\d+(?:\.\d+)?\s*%\s*(?:off|discount)\b|\b(?:save|get)\s+(?:up to\s+)?\d+(?:\.\d+)?\s*%/i;

function carouselError(code, message, details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

function cleanLine(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function stripDisclosure(value) {
  return stripAffiliateInstagramDisclosure(value);
}

function validateGenericClaims(fragments = []) {
  const combined = fragments.filter(Boolean).join("\n");
  const violation = GENERIC_BLOCKED_CLAIMS.find(({ pattern }) => pattern.test(combined));
  if (violation) {
    throw carouselError(violation.code, `Carousel caption contains a prohibited claim: ${violation.label}.`);
  }
}

function normalizeCarouselHashtags(values = []) {
  if (!Array.isArray(values)) throw carouselError("carousel_caption_invalid", "Carousel hashtags must be an array.");
  if (values.length > 8) throw carouselError("carousel_caption_invalid", "Use no more than eight hashtags.");

  let validated;
  try {
    validated = validateCaptionPackage({
      caption: "Affiliate partner picks",
      hashtags: values,
      cta: "View partner picks",
    }, { isAffiliate: true, enforceGeneratedLimits: false });
  } catch (error) {
    if (!error.code) error.code = "carousel_caption_invalid";
    throw error;
  }

  const seen = new Set();
  return validated.hashtags.filter((hashtag) => {
    if (isAffiliateDisclosureHashtag(hashtag)) return false;
    const key = hashtag.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildAffiliateCarouselCaption({ captionBody, items = [], hashtags = [] } = {}) {
  if (!Array.isArray(items) || items.length < 2 || items.length > 10) {
    throw carouselError("carousel_selection_invalid", "Select between 2 and 10 affiliate campaigns.");
  }

  const body = captionBody == null
    ? DEFAULT_AFFILIATE_CAROUSEL_CAPTION
    : stripDisclosure(captionBody);
  if (URL_PATTERN.test(body)) {
    throw carouselError("carousel_caption_invalid", "Do not add links to the caption body. Pink Paisa product links are added automatically.");
  }
  if (HASHTAG_PATTERN.test(body)) {
    throw carouselError("carousel_caption_invalid", "Add hashtags only through the carousel hashtag field.");
  }
  const normalizedItems = items.map((item, index) => {
    const title = cleanLine(item?.product_title || `Partner pick ${index + 1}`);
    const trackedUrl = String(item?.tracked_url || "").trim();
    if (!title || !trackedUrl) {
      throw carouselError("carousel_not_ready", "Every carousel slide requires a product name and Pink Paisa tracking link.");
    }
    if (URL_PATTERN.test(title) || HASHTAG_PATTERN.test(title)) {
      throw carouselError("carousel_not_ready", "Carousel product names cannot contain links or hashtags.");
    }
    return { ...item, product_title: title, tracked_url: trackedUrl };
  });
  const normalizedHashtags = normalizeCarouselHashtags(hashtags);
  const productTitles = normalizedItems.map((item) => item.product_title);

  try {
    validateCaptionPackage({
      caption: body || DEFAULT_AFFILIATE_CAROUSEL_CAPTION,
      hashtags: normalizedHashtags,
      cta: "View partner picks",
    }, { isAffiliate: true, enforceGeneratedLimits: false });
    productTitles.forEach((title) => {
      if (PRODUCT_TITLE_DISCOUNT_PATTERN.test(title)) {
        throw carouselError("affiliate_discount_claim", "Carousel product name contains a discount claim.");
      }
      validateCaptionPackage({
        caption: title.replace(PRODUCT_TITLE_PERCENTAGE_PATTERN, (percentage) => `${percentage.slice(0, -1).trim()} percent concentration`),
        hashtags: [],
        cta: "View partner pick",
      }, { isAffiliate: true, enforceGeneratedLimits: false });
    });
  } catch (error) {
    if (!error.code) error.code = "carousel_caption_invalid";
    throw error;
  }
  validateGenericClaims([
    body,
    ...productTitles,
    ...normalizedHashtags.map(normalizeHashtagForCompliance),
  ]);

  const productLines = normalizedItems.map((item, index) => `${index + 1}. ${item.product_title}\n${item.tracked_url}`);
  const withoutDisclosure = [
    body,
    ...productLines,
    normalizedHashtags.join(" "),
  ].filter(Boolean).join("\n\n").trim();
  const finalCaption = ensureAffiliateInstagramDisclosure(withoutDisclosure, true);

  if (finalCaption.length > INSTAGRAM_CAPTION_MAX_LENGTH) {
    throw carouselError("instagram_caption_too_long", "Final Instagram caption exceeds 2200 characters.");
  }

  return {
    caption_body: body,
    hashtags: normalizedHashtags,
    final_caption: finalCaption,
    caption_character_count: finalCaption.length,
    disclosure: AFFILIATE_INSTAGRAM_DISCLOSURE,
    items: normalizedItems,
  };
}

module.exports = {
  DEFAULT_AFFILIATE_CAROUSEL_CAPTION,
  buildAffiliateCarouselCaption,
  carouselError,
  _private: {
    cleanLine,
    normalizeCarouselHashtags,
    stripDisclosure,
    validateGenericClaims,
    HASHTAG_PATTERN,
    URL_PATTERN,
  },
};
