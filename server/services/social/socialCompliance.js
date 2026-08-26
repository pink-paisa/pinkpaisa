const crypto = require("crypto");

const FINANCIAL_PILLARS = new Set(["Money Education", "Money Psychology", "Wealth and Wellness", "Relatable Money Moments"]);
const AFFILIATE_PILLAR = "Curated Wellness and Affiliate Products";
const DEFAULT_FINANCIAL_DISCLAIMER = "Educational content only. This is not personalised investment advice.";
const DEFAULT_AFFILIATE_DISCLOSURE = "#Ad — Pink Paisa may earn a commission from qualifying purchases.";

const GUARANTEE_PATTERNS = [
  /\bguaranteed?\s+(?:returns?|profits?|income|growth|results?)\b/i,
  /\brisk[- ]?free\b/i,
  /\bassured?\s+(?:returns?|profits?|income)\b/i,
  /\bdouble your money\b/i,
  /\bget rich quick\b/i,
];

function hasPromotionalGuarantee(text, pattern) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const matcher = new RegExp(pattern.source, flags);
  for (const match of text.matchAll(matcher)) {
    const prefix = text.slice(0, match.index);
    // An immediate no/not turns the matched phrase into a protective disclosure,
    // for example "no guaranteed returns" or "not risk-free".
    if (/\b(?:no|not)\s*$/i.test(prefix)) continue;
    return true;
  }
  return false;
}

const PERSONALISED_ADVICE_PATTERNS = [
  /\byou should (?:buy|sell|invest|redeem|switch)\b/i,
  /\bthe best (?:stock|mutual fund|security) for you\b/i,
  /\bput all (?:your|of your) money\b/i,
];

const MARKET_PREDICTION_PATTERNS = [
  /\b(?:stock|share|market|index|nifty|sensex)\b.{0,50}\b(?:will|must|is going to)\s+(?:rise|fall|crash|rally|double)\b/i,
  /\b(?:buy|sell)\s+(?:this|these)\s+(?:stock|share|fund)\b/i,
];

const HEALTH_CLAIM_PATTERNS = [
  /\b(?:cure|treat|prevent|reverse|heal)s?\b.{0,60}\b(?:disease|condition|anxiety|depression|diabetes|pcos|pain|insomnia)\b/i,
  /\bclinically proven\b/i,
  /\bmedical(?:ly)? guaranteed\b/i,
  /\bdiagnos(?:e|es|is|ing)\b/i,
];

const AFFILIATE_FACT_PATTERNS = [
  { code: "affiliate_price_claim", pattern: /(?:₹|\brs\.?\s*|\binr\s*)\d|\b(?:price|costs?|only|just)\s*(?:is|at|from)?\s*\d{2,}/i },
  { code: "affiliate_discount_claim", pattern: /\b(?:discount|coupon|sale|deal)\b|\b\d+(?:\.\d+)?\s*(?:%|percent)\s*off\b/i },
  { code: "affiliate_rating_claim", pattern: /\b\d(?:\.\d)?\s*(?:\/\s*5|stars?)\b|\brated\s+\d/i },
  { code: "affiliate_review_claim", pattern: /\b\d[\d,]*\s+(?:reviews?|ratings?)\b/i },
  { code: "affiliate_availability_claim", pattern: /\b(?:in stock|out of stock|limited stock|available now)\b/i },
  { code: "affiliate_delivery_claim", pattern: /\b(?:same[- ]day|next[- ]day|free)\s+(?:delivery|shipping)\b|\bdelivers?\s+(?:today|tomorrow)\b/i },
];

const TIME_SENSITIVE_PATTERNS = [
  /\b(?:yesterday|currently|latest|new rule|new guideline|announced|effective from)\b/i,
  // Calendar language can describe a repeatable habit; it is current only when attached to a factual claim or event.
  /(?:\b(?:this week|this month)\b[^.!?\n]{0,120}\b(?:statistics?|data|survey|report|rates?|prices?|rules?|regulations?|guidelines?|polic(?:y|ies)|laws?|deadlines?|events?|workshops?|webinars?|meetings?|decisions?|launch(?:es|ed)?|releases?|updates?|changes?)\b|\b(?:statistics?|data|survey|report|rates?|prices?|rules?|regulations?|guidelines?|polic(?:y|ies)|laws?|deadlines?|events?|workshops?|webinars?|meetings?|decisions?|launch(?:es|ed)?|releases?|updates?|changes?)\b[^.!?\n]{0,120}\b(?:this week|this month)\b)/i,
  /\b\d+(?:\.\d+)?\s*(?:%|percent)\b/i,
  /(?:₹|\brs\.?\s*|\binr\s*)\d/i,
];

const PROMPT_INJECTION_PATTERNS = [
  /ignore (?:all |any )?(?:previous|prior|system|developer) instructions/i,
  /(?:system|developer) (?:message|prompt|instruction)/i,
  /reveal (?:the )?(?:prompt|secret|api key|access token)/i,
  /publish (?:this|the post) (?:now|immediately|without approval)/i,
  /override (?:brand|safety|approval|database|permission)/i,
  /call (?:this )?(?:tool|function|api)/i,
  /<\/?(?:system|assistant|developer|tool)>/i,
];

function trimText(value) {
  return String(value == null ? "" : value).trim();
}

function normalizeWhitespace(value) {
  return trimText(value).replace(/\s+/g, " ");
}

function slugify(value, maximum = 80) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maximum) || "social-post";
}

function recommendationText(recommendation = {}) {
  const postCopy = recommendation.onPostCopy || {};
  return [
    recommendation.internalTitle,
    recommendation.whyToday,
    recommendation.topic,
    ...(recommendation.hooks || []),
    postCopy.headline,
    postCopy.supportingCopy,
    ...(postCopy.slides || []).flatMap((slide) => [slide.headline, slide.body]),
    ...(postCopy.storyFrames || []).map((frame) => frame.copy),
    ...(postCopy.reelScenes || []).flatMap((scene) => [scene.voiceover, scene.onScreenText]),
    recommendation.caption,
    recommendation.cta,
    ...(recommendation.hashtags || []),
    recommendation.financialDisclaimer,
    recommendation.affiliateDisclosure,
  ].map(normalizeWhitespace).filter(Boolean).join("\n");
}

function isPrivateHostname(hostname) {
  const normalized = trimText(hostname).toLowerCase().replace(/^\[|\]$/g, "");
  if (!normalized) return true;
  if (["localhost", "0.0.0.0", "::", "::1"].includes(normalized) || normalized.endsWith(".local")) return true;
  if (/^127\./.test(normalized) || /^10\./.test(normalized) || /^169\.254\./.test(normalized)) return true;
  const private172 = normalized.match(/^172\.(\d{1,3})\./);
  if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return true;
  if (/^192\.168\./.test(normalized)) return true;
  if (/^fc|^fd|^fe80/i.test(normalized.replace(/:/g, ""))) return true;
  return false;
}

function normalizeDomainList(values = []) {
  return (Array.isArray(values) ? values : [])
    .map((value) => trimText(value).toLowerCase().replace(/^www\./, ""))
    .filter(Boolean);
}

function assertSafeExternalSourceUrl(value, { allowedDomains = [], blockedDomains = [] } = {}) {
  let parsed;
  try {
    parsed = new URL(trimText(value));
  } catch (_error) {
    const error = new Error("Research source URL is invalid");
    error.code = "research_url_invalid";
    throw error;
  }
  if (parsed.protocol !== "https:") throw new Error("Research source URL must use HTTPS");
  if (parsed.username || parsed.password) throw new Error("Research source URL must not contain credentials");
  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (isPrivateHostname(hostname)) throw new Error("Research source URL resolves to a private hostname");
  const blocked = normalizeDomainList(blockedDomains);
  if (blocked.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) {
    throw new Error("Research source domain is blocked");
  }
  const allowed = normalizeDomainList(allowedDomains);
  if (allowed.length && !allowed.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) {
    throw new Error("Research source domain is not allowlisted");
  }
  parsed.hash = "";
  return parsed.toString();
}

function detectPromptInjection(value) {
  const text = normalizeWhitespace(value).slice(0, 12000);
  return PROMPT_INJECTION_PATTERNS
    .map((pattern, index) => (pattern.test(text) ? `prompt_injection_pattern_${index + 1}` : null))
    .filter(Boolean);
}

function sanitizeUntrustedResearchText(value, maximum = 1200) {
  const normalized = normalizeWhitespace(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/<\/?(?:system|assistant|developer|tool)[^>]*>/gi, "[removed]");
  return normalized.slice(0, Math.max(Number(maximum || 1200), 0));
}

function getPublicAppUrl() {
  return trimText(process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || "https://pinkpaisa.in").replace(/\/+$/, "");
}

function validateLandingPage(value, { publicAppUrl = getPublicAppUrl() } = {}) {
  const raw = trimText(value);
  if (!raw) return null;
  let base;
  let parsed;
  try {
    base = new URL(publicAppUrl);
    parsed = new URL(raw, `${base.origin}/`);
  } catch (_error) {
    throw new Error("Recommended landing page is invalid");
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error("Recommended landing page must use HTTP or HTTPS");
  if (parsed.username || parsed.password) throw new Error("Recommended landing page must not contain credentials");
  if (parsed.origin !== base.origin) throw new Error("Recommended landing page must be a Pink Paisa first-party URL");
  if (/^\/(?:admin|api\/auth|api\/instagram\/admin)(?:\/|$)/i.test(parsed.pathname)) {
    throw new Error("Recommended landing page is not a public destination");
  }
  parsed.hash = "";
  return `${parsed.pathname}${parsed.search}` || "/";
}

function buildUtmParameters({ topic, contentPillar, generationDate, content = "primary" } = {}) {
  const datePart = trimText(generationDate).replace(/[^0-9]/g, "").slice(0, 8) || "daily";
  return {
    source: "instagram",
    medium: "organic_social",
    campaign: `${datePart}-${slugify(contentPillar || topic, 64)}`.slice(0, 120),
    content: `${slugify(content, 36)}-${slugify(topic, 72)}`.slice(0, 120),
  };
}

function appendUtmParameters(landingPage, utm = {}) {
  const normalized = validateLandingPage(landingPage);
  if (!normalized) return null;
  const base = new URL(getPublicAppUrl());
  const parsed = new URL(normalized, `${base.origin}/`);
  parsed.searchParams.set("utm_source", trimText(utm.source || "instagram"));
  parsed.searchParams.set("utm_medium", trimText(utm.medium || "organic_social"));
  parsed.searchParams.set("utm_campaign", trimText(utm.campaign));
  parsed.searchParams.set("utm_content", trimText(utm.content));
  return `${parsed.pathname}${parsed.search}`;
}

function scanRecommendationCompliance(recommendation = {}, { requireSourcesForCurrentClaims = true } = {}) {
  const text = recommendationText(recommendation);
  const issues = [];
  const warnings = [];
  const addIssue = (code, message) => issues.push({ severity: "error", code, message });
  const addWarning = (code, message) => warnings.push({ severity: "warning", code, message });
  const completeCaption = [
    recommendation.affiliateDisclosure,
    recommendation.caption,
    recommendation.cta,
    recommendation.financialDisclaimer,
    Array.isArray(recommendation.hashtags) ? recommendation.hashtags.join(" ") : null,
  ]
    .map(normalizeWhitespace)
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index)
    .join("\n\n");
  if (!completeCaption || completeCaption.length > 2200) {
    addIssue("instagram_caption_length_invalid", "The complete caption, CTA, disclosures, and hashtags must fit within Instagram's 2,200-character limit.");
  }

  GUARANTEE_PATTERNS.forEach((pattern) => {
    if (hasPromotionalGuarantee(text, pattern)) addIssue("guaranteed_financial_outcome", "Guaranteed or risk-free financial outcomes are not allowed.");
  });
  PERSONALISED_ADVICE_PATTERNS.forEach((pattern) => {
    if (pattern.test(text)) addIssue("personalised_financial_advice", "The post appears to give personalised investment advice.");
  });
  MARKET_PREDICTION_PATTERNS.forEach((pattern) => {
    if (pattern.test(text)) addIssue("unsupported_market_prediction", "Unapproved securities or market predictions are not allowed.");
  });
  HEALTH_CLAIM_PATTERNS.forEach((pattern) => {
    if (pattern.test(text)) addIssue("unsupported_health_claim", "The post contains an unsupported medical or treatment claim.");
  });

  const isFinancial = FINANCIAL_PILLARS.has(recommendation.contentPillar)
    || /\b(?:sip|invest|saving|budget|emergency fund|compound|salary|money|wealth|financial)\b/i.test(text);
  if (isFinancial && !normalizeWhitespace(recommendation.financialDisclaimer)) {
    addIssue("financial_disclaimer_missing", "Finance education requires the configured educational disclaimer.");
  }

  const isAffiliate = recommendation.contentPillar === AFFILIATE_PILLAR || Boolean(recommendation.affiliateDisclosure);
  if (isAffiliate) {
    if (!normalizeWhitespace(recommendation.verifiedProductId) || !normalizeWhitespace(recommendation.verifiedProductTitle)) {
      addIssue("affiliate_product_unverified", "Affiliate content must retain the exact verified Pink Paisa product identifier and title.");
    }
    if (!normalizeWhitespace(recommendation.affiliateDisclosure)) {
      addIssue("affiliate_disclosure_missing", "Affiliate content requires a clear early disclosure.");
    }
    for (const { code, pattern } of AFFILIATE_FACT_PATTERNS) {
      if (pattern.test(text)) addIssue(code, "Affiliate price, rating, review, discount, stock, or delivery claims require an approved fresh source and are blocked in manual mode.");
    }
  }

  const sources = Array.isArray(recommendation.sources) ? recommendation.sources : [];
  const hasTimeSensitiveClaim = TIME_SENSITIVE_PATTERNS.some((pattern) => pattern.test(text));
  if (requireSourcesForCurrentClaims && hasTimeSensitiveClaim && !sources.length) {
    addIssue("current_claim_source_missing", "A current statistic, rule, price, event, or timely claim has no validated source.");
  }
  if (!sources.length && !hasTimeSensitiveClaim) addWarning("evergreen_no_external_source", "This evergreen recommendation does not rely on a current external claim.");

  try {
    if (recommendation.recommendedLandingPage) validateLandingPage(recommendation.recommendedLandingPage);
  } catch (error) {
    addIssue("landing_page_invalid", error.message);
  }
  if (recommendation.utmParameters?.source !== "instagram" || recommendation.utmParameters?.medium !== "organic_social") {
    addIssue("utm_invalid", "Instagram organic posts must use the configured source and medium.");
  }

  const promptFlags = detectPromptInjection(text);
  promptFlags.forEach((code) => addIssue(code, "The content contains instruction-like text that is unsafe to publish."));
  const all = [...issues, ...warnings];
  return {
    passed: issues.length === 0,
    issues: all,
    risk_flags: [...new Set(all.map((issue) => issue.code))],
    compliance_penalty: Math.max(-30, -(issues.length * 10 + warnings.length * 2)),
    defaults: {
      financial_disclaimer: isFinancial ? DEFAULT_FINANCIAL_DISCLAIMER : null,
      affiliate_disclosure: isAffiliate ? DEFAULT_AFFILIATE_DISCLOSURE : null,
    },
  };
}

function buildPublicationFingerprint({ recommendation = {}, assetUrls = [] } = {}) {
  const payload = JSON.stringify({
    topic: normalizeWhitespace(recommendation.topic).toLowerCase(),
    caption: normalizeWhitespace(recommendation.caption),
    cta: normalizeWhitespace(recommendation.cta),
    assets: (Array.isArray(assetUrls) ? assetUrls : []).map(trimText).filter(Boolean),
  });
  return crypto.createHash("sha256").update(payload).digest("hex");
}

module.exports = {
  AFFILIATE_PILLAR,
  DEFAULT_AFFILIATE_DISCLOSURE,
  DEFAULT_FINANCIAL_DISCLAIMER,
  FINANCIAL_PILLARS,
  appendUtmParameters,
  assertSafeExternalSourceUrl,
  buildPublicationFingerprint,
  buildUtmParameters,
  detectPromptInjection,
  isPrivateHostname,
  normalizeWhitespace,
  recommendationText,
  sanitizeUntrustedResearchText,
  scanRecommendationCompliance,
  slugify,
  trimText,
  validateLandingPage,
};
