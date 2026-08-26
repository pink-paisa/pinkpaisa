const crypto = require("crypto");

const CAPTION_COMPONENT_ORDER = Object.freeze([
  "affiliate_disclosure",
  "caption",
  "cta",
  "financial_disclaimer",
  "hashtags",
]);
const MAX_INSTAGRAM_CAPTION_LENGTH = 2200;
const AFFILIATE_PILLAR = "Curated Wellness and Affiliate Products";

function trimText(value) {
  return String(value || "").trim();
}

function contentPackage(recommendation = {}) {
  return recommendation.formatContent
    || recommendation.format_content
    || recommendation.contentPackage
    || recommendation.content_package
    || {};
}

function field(recommendation, camelKey, snakeKey) {
  const content = contentPackage(recommendation);
  const value = recommendation?.[camelKey]
    ?? recommendation?.[snakeKey]
    ?? content?.[camelKey]
    ?? content?.[snakeKey];
  return trimText(value);
}

function normalizeHashtagToken(value) {
  const normalized = trimText(value).replace(/^#+/, "");
  return normalized ? `#${normalized}` : null;
}

function hashtagTokens(recommendation = {}) {
  const content = contentPackage(recommendation);
  const hashtags = recommendation.hashtags ?? content.hashtags;
  const values = Array.isArray(hashtags) ? hashtags : trimText(hashtags).split(/\s+/);
  return values
    .flatMap((value) => trimText(value).split(/\s+/))
    .map(normalizeHashtagToken)
    .filter(Boolean);
}

function hashtagsValue(recommendation = {}) {
  return hashtagTokens(recommendation).join(" ");
}

function hashtagKeysInText(value) {
  return (trimText(value).match(/#[\p{L}\p{N}_]+/gu) || []).map((tag) => tag.toLocaleLowerCase());
}

function isAffiliateRecommendation(recommendation = {}) {
  const content = contentPackage(recommendation);
  const postType = trimText(recommendation.postType || recommendation.post_type || content.postType || content.post_type).toUpperCase();
  const pillar = trimText(recommendation.contentPillar || recommendation.content_pillar || content.contentPillar || content.content_pillar);
  return (postType === "AFFILIATE" || postType.startsWith("AFFILIATE_"))
    || pillar.toLowerCase() === AFFILIATE_PILLAR.toLowerCase()
    || Boolean(field(recommendation, "affiliateDisclosure", "affiliate_disclosure"));
}

function occurrenceCount(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let cursor = 0;
  while (cursor <= haystack.length - needle.length) {
    const index = haystack.indexOf(needle, cursor);
    if (index < 0) break;
    count += 1;
    cursor = index + needle.length;
  }
  return count;
}

function buildSocialCaptionContract(recommendation = {}, {
  requireFinancialDisclaimer = false,
  requireAffiliateDisclosure = isAffiliateRecommendation(recommendation),
} = {}) {
  const format = trimText(recommendation.format || contentPackage(recommendation).format).toUpperCase();
  const story = format === "STORY";
  const components = {
    affiliate_disclosure: field(recommendation, "affiliateDisclosure", "affiliate_disclosure"),
    caption: field(recommendation, "caption", "caption"),
    cta: field(recommendation, "cta", "cta"),
    financial_disclaimer: field(recommendation, "financialDisclaimer", "financial_disclaimer"),
    hashtags: hashtagsValue(recommendation),
  };
  const violations = [];

  if (story) {
    if (!components.cta) violations.push("CTA_REQUIRED");
    if (requireAffiliateDisclosure && !components.affiliate_disclosure) violations.push("AFFILIATE_DISCLOSURE_REQUIRED");
    if (requireFinancialDisclaimer && !components.financial_disclaimer) violations.push("FINANCIAL_DISCLAIMER_REQUIRED");
    return {
      policy: "STORY_FRAME_OVERLAY",
      caption: null,
      checksum_sha256: crypto.createHash("sha256").update("").digest("hex"),
      components,
      component_order: [...CAPTION_COMPONENT_ORDER],
      length: 0,
      violations: [...new Set(violations)],
      valid: violations.length === 0,
    };
  }

  if (!components.caption) violations.push("CAPTION_REQUIRED");
  if (!components.cta) violations.push("CTA_REQUIRED");
  if (!components.hashtags) violations.push("HASHTAGS_REQUIRED");
  if (requireAffiliateDisclosure && !components.affiliate_disclosure) violations.push("AFFILIATE_DISCLOSURE_REQUIRED");
  if (requireFinancialDisclaimer && !components.financial_disclaimer) violations.push("FINANCIAL_DISCLAIMER_REQUIRED");

  const caption = CAPTION_COMPONENT_ORDER.map((key) => components[key]).filter(Boolean).join("\n\n");
  if (caption.length > MAX_INSTAGRAM_CAPTION_LENGTH) violations.push("CAPTION_EXCEEDS_2200_CHARACTERS");

  for (const key of CAPTION_COMPONENT_ORDER) {
    const value = components[key];
    if (!value) continue;
    if (occurrenceCount(caption, value) !== 1) violations.push(`${key.toUpperCase()}_MUST_OCCUR_EXACTLY_ONCE`);
  }
  const declaredHashtagKeys = hashtagTokens(recommendation).map((tag) => tag.toLocaleLowerCase());
  const captionHashtagKeys = hashtagKeysInText(caption);
  if (
    new Set(declaredHashtagKeys).size !== declaredHashtagKeys.length
    || declaredHashtagKeys.some((key) => captionHashtagKeys.filter((value) => value === key).length !== 1)
  ) {
    violations.push("HASHTAGS_MUST_OCCUR_EXACTLY_ONCE");
  }

  return {
    policy: "CAPTION_ONLY",
    caption,
    checksum_sha256: crypto.createHash("sha256").update(caption).digest("hex"),
    components,
    component_order: [...CAPTION_COMPONENT_ORDER],
    length: caption.length,
    violations: [...new Set(violations)],
    valid: violations.length === 0,
  };
}

function storyFrameDisclosureCopy(recommendation = {}, sequence, total) {
  const contract = buildSocialCaptionContract(recommendation);
  const rows = [];
  if (Number(sequence) === 1 && contract.components.affiliate_disclosure) {
    rows.push(contract.components.affiliate_disclosure);
  }
  if (Number(sequence) === Number(total)) {
    if (contract.components.cta) rows.push(contract.components.cta);
    if (contract.components.financial_disclaimer) rows.push(contract.components.financial_disclaimer);
  }
  return rows;
}

module.exports = {
  CAPTION_COMPONENT_ORDER,
  MAX_INSTAGRAM_CAPTION_LENGTH,
  buildSocialCaptionContract,
  isAffiliateRecommendation,
  normalizeHashtagToken,
  storyFrameDisclosureCopy,
};
