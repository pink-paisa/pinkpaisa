const VISUAL_MODES = Object.freeze([
  "AI_VISUAL_WITH_EXACT_OVERLAY",
  "AI_ARTWORK_ONLY",
  "FULL_AI_GRAPHIC",
]);

const LEGACY_VISUAL_MODES = Object.freeze(["MANUAL_TEMPLATE"]);
const ARTWORK_ONLY_FORMATS = new Set(["SINGLE_IMAGE", "CAROUSEL"]);
const ARTWORK_ONLY_OBJECTIVES = new Set([
  "AWARENESS",
  "EDUCATION",
  "ENGAGEMENT",
  "COMMUNITY_BUILDING",
]);
const PROMOTIONAL_FORMATS = new Set([
  "PRODUCT_FEATURE",
  "RESOURCE_PROMOTION",
  "EVENT_OR_WORKSHOP_PROMOTION",
  "WORKSHOP_PROMOTION",
]);
const PROMOTIONAL_POST_TYPES = new Set([
  "PRODUCT",
  "PRODUCT_PROMOTION",
  "AFFILIATE",
  "PROMOTION",
  "PROMOTIONAL",
  "RESOURCE",
  "RESOURCE_PROMOTION",
  "CALCULATOR",
  "EVENT",
  "EVENT_PROMOTION",
  "EVENT_OR_WORKSHOP_PROMOTION",
  "WORKSHOP",
  "WORKSHOP_PROMOTION",
]);
const AFFILIATE_PILLAR = "CURATED WELLNESS AND AFFILIATE PRODUCTS";
const RESTRICTED_POST_TYPE_TOKEN = /(?:^|_)(?:PRODUCT|AFFILIATE|PROMOTION|PROMOTIONAL|RESOURCE|CALCULATOR|EVENT|WORKSHOP)(?:_|$)/;

function normalizeEnum(value) {
  return String(value || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
}

function normalizePillar(value) {
  return String(value || "").trim().toUpperCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function contentPackage(recommendation = {}) {
  return recommendation.formatContent
    || recommendation.format_content
    || recommendation.contentPackage
    || recommendation.content_package
    || {};
}

function recommendationFacts(recommendation = {}) {
  const content = contentPackage(recommendation);
  const format = normalizeEnum(recommendation.format || content.format);
  const objective = normalizeEnum(recommendation.objective || content.objective);
  const postType = normalizeEnum(recommendation.postType || recommendation.post_type || content.postType || content.post_type);
  const contentPillar = normalizePillar(
    recommendation.contentPillar
      || recommendation.content_pillar
      || content.contentPillar
      || content.content_pillar,
  );
  const hasVerifiedProduct = Boolean(
    recommendation.verifiedProductId
      || recommendation.verified_product_id
      || recommendation.verifiedProductFacts
      || recommendation.verified_product_facts
      || content.verifiedProductId
      || content.verified_product_id,
  );
  const hasAffiliateDisclosure = Boolean(
    String(recommendation.affiliateDisclosure || recommendation.affiliate_disclosure
      || content.affiliateDisclosure || content.affiliate_disclosure || "").trim(),
  );
  const affiliate = postType === "AFFILIATE" || postType.startsWith("AFFILIATE_")
    || contentPillar === AFFILIATE_PILLAR
    || hasAffiliateDisclosure;
  const promotional = objective === "PRODUCT_PROMOTION"
    || PROMOTIONAL_FORMATS.has(format)
    || PROMOTIONAL_POST_TYPES.has(postType)
    || RESTRICTED_POST_TYPE_TOKEN.test(postType)
    || contentPillar === "PINK PAISA RESOURCES"
    || hasVerifiedProduct
    || affiliate;

  return {
    format,
    objective,
    post_type: postType,
    content_pillar: contentPillar,
    has_verified_product: hasVerifiedProduct,
    affiliate,
    promotional,
  };
}

function visualModeEligibility(visualMode, recommendation = {}, { allowManualTemplate = false } = {}) {
  const mode = normalizeEnum(visualMode);
  const facts = recommendationFacts(recommendation);
  const reasons = [];

  if (!VISUAL_MODES.includes(mode)) {
    if (!(allowManualTemplate && LEGACY_VISUAL_MODES.includes(mode))) {
      reasons.push("UNSUPPORTED_VISUAL_MODE");
    }
  }

  if (mode === "AI_ARTWORK_ONLY") {
    if (!ARTWORK_ONLY_FORMATS.has(facts.format)) reasons.push("FORMAT_REQUIRES_EXACT_OVERLAY");
    if (!ARTWORK_ONLY_OBJECTIVES.has(facts.objective)) reasons.push("OBJECTIVE_REQUIRES_EXACT_OVERLAY");
    if (facts.has_verified_product) reasons.push("AUTHENTIC_PRODUCT_REQUIRES_EXACT_OVERLAY");
    if (facts.affiliate) reasons.push("AFFILIATE_CONTENT_REQUIRES_EXACT_OVERLAY");
    if (facts.promotional) reasons.push("PROMOTIONAL_CONTENT_REQUIRES_EXACT_OVERLAY");
  }

  if (mode === "FULL_AI_GRAPHIC") {
    if (facts.format === "STORY") reasons.push("STORY_DISCLOSURES_REQUIRE_EXACT_OVERLAY");
    if (facts.has_verified_product || facts.affiliate || facts.format === "PRODUCT_FEATURE") {
      reasons.push("AUTHENTIC_PRODUCT_REQUIRES_EXACT_OVERLAY");
    }
  }

  return {
    mode,
    eligible: reasons.length === 0,
    reasons: [...new Set(reasons)],
    facts,
  };
}

function ineligibleModeError(resolution) {
  const error = new Error(
    `${resolution.requested} is not eligible for this social post: ${resolution.reasons.join(", ")}`,
  );
  error.code = resolution.reasons.includes("UNSUPPORTED_VISUAL_MODE")
    ? "social_visual_mode_unsupported"
    : "social_visual_mode_ineligible";
  error.status = 409;
  error.statusCode = 409;
  error.visual_mode_resolution = resolution;
  error.transient = false;
  return error;
}

function resolveSocialVisualMode({
  requestedVisualMode = null,
  fallbackVisualMode = "AI_VISUAL_WITH_EXACT_OVERLAY",
  recommendation = {},
  strict = false,
  allowManualTemplate = false,
} = {}) {
  const requested = normalizeEnum(requestedVisualMode || fallbackVisualMode || "AI_VISUAL_WITH_EXACT_OVERLAY");
  const requestedEligibility = visualModeEligibility(requested, recommendation, { allowManualTemplate });
  const resolution = {
    requested,
    effective: requestedEligibility.eligible ? requested : "AI_VISUAL_WITH_EXACT_OVERLAY",
    eligible: requestedEligibility.eligible,
    reasons: requestedEligibility.reasons,
  };

  if (!requestedEligibility.eligible && strict) throw ineligibleModeError(resolution);
  return resolution;
}

function assertSocialVisualModeEligible({ visualMode, recommendation = {}, allowManualTemplate = false } = {}) {
  return resolveSocialVisualMode({
    requestedVisualMode: visualMode,
    recommendation,
    strict: true,
    allowManualTemplate,
  });
}

module.exports = {
  ARTWORK_ONLY_FORMATS,
  ARTWORK_ONLY_OBJECTIVES,
  LEGACY_VISUAL_MODES,
  VISUAL_MODES,
  assertSocialVisualModeEligible,
  recommendationFacts,
  resolveSocialVisualMode,
  visualModeEligibility,
};
