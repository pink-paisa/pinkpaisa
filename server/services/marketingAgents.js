const Product = require("../models/Product");
const Vendor = require("../models/Vendor");
const VendorProduct = require("../models/VendorProduct");
const { getCampaignSettings } = require("../utils/campaignSettings");
const {
  chooseCtaText,
  resolvePublicUrl,
} = require("./instagramCreativeRenderer");
const { generateAiInstagramCreative } = require("./instagramAiCreativeService");
const { resolveVendorReferenceImage } = require("./campaignReferenceImage");
const {
  generateCampaignCaption,
  normalizeHashtagForCompliance,
  validateCaptionPackage,
} = require("./openAiCaptionService");

const DEFAULT_FRONTEND_URL = "https://www.pinkpaisa.in";
const BLOCKED_CLAIMS = ["cure", "guaranteed", "instant results", "100% safe", "risk-free", "miracle", "clinically proven"];
const AFFILIATE_INSTAGRAM_DISCLOSURE = "#Ad";
const AFFILIATE_DISCLOSURE_RE = /(?:^|\s)#ad\b/i;
const AFFILIATE_DISCLOSURE_BLOCK_RE = /(?:^|\s)#ad\b/ig;
const RETIRED_COMMISSION_NOTICE_WORDS = ["pink", "paisa", "may", "earn", "a", "commission", "from", "qualifying", "purchases"];
const RETIRED_COMMISSION_NOTICE_SOURCE = `(?:affiliate\\s+link:\\s*)?${RETIRED_COMMISSION_NOTICE_WORDS.join("\\s+")}\\.?(?:\\s*#ad)?`;
const LEGACY_ASSOCIATE_NOTICE_WORDS = ["as", "an", "amazon", "associate", "i", "earn", "from", "qualifying", "purchases"];
const LEGACY_DISCLOSURE_HASHTAG = ["commissions", "earned"].join("");
const LEGACY_ASSOCIATE_NOTICE_SOURCE = `(?:affiliate\\s+disclosure:\\s*)?${LEGACY_ASSOCIATE_NOTICE_WORDS.join("\\s+")}\\.?(?:\\s*#?${LEGACY_DISCLOSURE_HASHTAG})?`;
const INSTAGRAM_CAPTION_MAX_LENGTH = 2200;
const BLOCKED_CLAIM_PATTERNS = [
  { label: "cure", pattern: /\bcures?\b/i },
  { label: "guaranteed", pattern: /\bguaranteed\b/i },
  { label: "instant results", pattern: /\binstant\s*results?\b/i },
  { label: "100% safe", pattern: /\b100\s*(?:%|percent)\s*safe\b/i },
  { label: "risk-free", pattern: /\brisk[-\s]*free\b/i },
  { label: "miracle", pattern: /\bmiracle\b/i },
  { label: "clinically proven", pattern: /\bclinically\s*proven\b/i },
];

function trimText(value) {
  return String(value || "").trim();
}

function normalizeWhitespace(value) {
  return trimText(value).replace(/\s+/g, " ");
}

function slugify(value) {
  return trimText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "campaign";
}

function formatPrice(value) {
  const numeric = Number(value || 0);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(numeric) ? numeric : 0);
}

function buildProductUrl(slug) {
  const baseUrl = String(process.env.FRONTEND_URL || process.env.PUBLIC_APP_URL || DEFAULT_FRONTEND_URL).replace(/\/+$/, "");
  return `${baseUrl}/product/${encodeURIComponent(slug)}`;
}

function hasAffiliateInstagramDisclosure(value) {
  const text = String(value || "");
  return AFFILIATE_DISCLOSURE_RE.test(text)
    || new RegExp(RETIRED_COMMISSION_NOTICE_SOURCE, "i").test(text)
    || new RegExp(LEGACY_ASSOCIATE_NOTICE_SOURCE, "i").test(text);
}

function isAffiliateDisclosureHashtag(value) {
  const normalized = trimText(value).replace(/^#+/, "").toLowerCase();
  return normalized === "ad" || normalized === LEGACY_DISCLOSURE_HASHTAG;
}

function stripAffiliateInstagramDisclosure(value) {
  return String(value || "")
    .replace(new RegExp(RETIRED_COMMISSION_NOTICE_SOURCE, "ig"), "")
    .replace(new RegExp(LEGACY_ASSOCIATE_NOTICE_SOURCE, "ig"), "")
    .replace(AFFILIATE_DISCLOSURE_BLOCK_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function ensureAffiliateInstagramDisclosure(value, isAffiliate = false) {
  const caption = trimText(value);
  if (!isAffiliate || !caption) return caption;
  const withoutExistingDisclosure = stripAffiliateInstagramDisclosure(caption);
  return [withoutExistingDisclosure, AFFILIATE_INSTAGRAM_DISCLOSURE].filter(Boolean).join("\n\n");
}

function buildAudience(category, tags) {
  const source = `${trimText(category)} ${Array.isArray(tags) ? tags.join(" ") : ""}`.toLowerCase();
  if (source.includes("nutrition") || source.includes("supplement")) return "People exploring nutrition-focused daily routines";
  if (source.includes("beauty") || source.includes("skin") || source.includes("care")) return "People exploring self-care and beauty products";
  if (source.includes("lifestyle") || source.includes("home")) return "People exploring practical lifestyle products";
  return "People exploring products for everyday use";
}

function buildAngle(brief) {
  if (brief.is_affiliate) return "editorial partner pick discovery with affiliate-link transparency";
  const hasOffer = brief.pricing.sale_price != null && Number(brief.pricing.sale_price) < Number(brief.pricing.price);
  if (hasOffer) return "limited-time value with a premium but approachable wellness angle";
  if (Number(brief.constraints.stock_quantity || 0) <= 10) return "low-stock urgency anchored in a trusted editorial recommendation";
  return "editorial product discovery focused on habit-building and real-life use";
}

function buildHooks(brief, strategy) {
  const hasSalePrice = brief.pricing.sale_price != null && Number(brief.pricing.sale_price) < Number(brief.pricing.price);
  const priceLine = brief.is_affiliate
    ? "Check current price on Amazon from the Pink Paisa product page"
    : hasSalePrice
    ? `Now at ${formatPrice(brief.pricing.sale_price)}`
    : `Explore it at ${formatPrice(brief.pricing.price)}`;
  return [
    `A softer way to upgrade your ${trimText(brief.category || "wellness")} routine.`,
    `${trimText(brief.title)} is built for everyday use, not just special occasions.`,
    brief.is_affiliate ? `${priceLine}.` : `${priceLine} on Pink Paisa.`,
    `Best for: ${strategy.audience}.`,
  ];
}

function scanBlockedClaims(textFragments) {
  const combined = textFragments.filter(Boolean).join(" ");
  return BLOCKED_CLAIM_PATTERNS
    .filter(({ pattern }) => pattern.test(combined))
    .map(({ label }) => label);
}

function captionLengthError() {
  const error = new Error("Final Instagram caption exceeds 2200 characters.");
  error.code = "instagram_caption_too_long";
  return error;
}

function truncateAtWord(value, maximum) {
  const text = trimText(value);
  if (text.length <= maximum) return text;
  if (maximum <= 3) return text.slice(0, Math.max(maximum, 0));
  const candidate = text.slice(0, maximum - 3).trimEnd();
  const boundary = candidate.lastIndexOf(" ");
  const shortened = boundary > Math.floor(candidate.length * 0.5) ? candidate.slice(0, boundary) : candidate;
  return `${shortened.trimEnd()}...`;
}

function composeInstagramCaption({ caption, trackedUrl, hashtags = [], isAffiliate = false, overflowMode = "truncate" }) {
  const body = stripAffiliateInstagramDisclosure(caption);
  const url = trimText(trackedUrl);
  const selectedHashtags = (Array.isArray(hashtags) ? hashtags : [])
    .map(trimText)
    .filter((hashtag) => hashtag && !isAffiliateDisclosureHashtag(hashtag))
    .slice(0, 8);
  const disclosure = isAffiliate ? AFFILIATE_INSTAGRAM_DISCLOSURE : "";
  const assemble = (captionText, hashtagValues) => [
    captionText,
    url,
    hashtagValues.join(" "),
    disclosure,
  ].filter(Boolean).join("\n\n");

  let finalCaption = assemble(body, selectedHashtags);
  if (finalCaption.length <= INSTAGRAM_CAPTION_MAX_LENGTH) {
    return {
      caption: finalCaption,
      character_count: finalCaption.length,
      was_truncated: false,
      hashtags: selectedHashtags,
    };
  }
  if (overflowMode === "error") throw captionLengthError();

  let wasTruncated = false;
  while (selectedHashtags.length && finalCaption.length > INSTAGRAM_CAPTION_MAX_LENGTH) {
    selectedHashtags.pop();
    wasTruncated = true;
    finalCaption = assemble(body, selectedHashtags);
  }

  if (finalCaption.length > INSTAGRAM_CAPTION_MAX_LENGTH) {
    const suffix = [url, selectedHashtags.join(" "), disclosure].filter(Boolean).join("\n\n");
    const separatorLength = body && suffix ? 2 : 0;
    const availableBodyLength = INSTAGRAM_CAPTION_MAX_LENGTH - suffix.length - separatorLength;
    if (availableBodyLength < 1) throw captionLengthError();
    finalCaption = assemble(truncateAtWord(body, availableBodyLength), selectedHashtags);
    wasTruncated = true;
  }

  if (finalCaption.length > INSTAGRAM_CAPTION_MAX_LENGTH) throw captionLengthError();
  return {
    caption: finalCaption,
    character_count: finalCaption.length,
    was_truncated: wasTruncated,
    hashtags: selectedHashtags,
  };
}

function createIssue(severity, code, message) {
  return { severity, code, message };
}

async function runIntakeAgent(run) {
  if (run.vendor_product_id) {
    const vendorProduct = await VendorProduct.findById(run.vendor_product_id).lean();
    if (!vendorProduct) throw new Error("Vendor product not found for intake");

    const publicProduct = await Product.findById(run.public_product_id || vendorProduct.published_product_id).lean();
    if (!publicProduct) throw new Error("Public product not found for intake");

    const vendor = await Vendor.findById(vendorProduct.vendor_id).lean();
    const referenceImageUrl = resolveVendorReferenceImage(vendorProduct, publicProduct);
    const images = [referenceImageUrl, vendorProduct.featured_image, publicProduct.featured_image, ...(vendorProduct.additional_images || []), ...(publicProduct.images || [])]
      .filter(Boolean)
      .filter((value, index, list) => list.indexOf(value) === index);
    const price = Number(vendorProduct.price || 0);
    const salePrice = vendorProduct.sale_price == null ? null : Number(vendorProduct.sale_price);
    const discountPercent = salePrice != null && price > 0 && salePrice < price
      ? Math.round(((price - salePrice) / price) * 100)
      : null;

    return {
      campaign_id: run.campaign_id,
      product_id: String(vendorProduct._id),
      public_product_id: String(publicProduct._id),
      title: vendorProduct.title,
      campaign_label: publicProduct.campaign_label || null,
      slug: publicProduct.slug || vendorProduct.slug,
      product_url: buildProductUrl(publicProduct.slug || vendorProduct.slug),
      vendor: {
        id: vendor ? String(vendor._id) : String(vendorProduct.vendor_id),
        shop_name: vendor?.shop_name || vendor?.business_name || "Vendor",
        business_name: vendor?.business_name || null,
        email: vendor?.email || null,
      },
      pricing: {
        price,
        sale_price: salePrice,
        currency: "INR",
        discount_percent: discountPercent,
        available: price > 0,
        status: "verified",
      },
      category: vendorProduct.category || publicProduct.category || "Uncategorized",
      subcategory: vendorProduct.subcategory || publicProduct.subcategory || "Uncategorized",
      descriptions: {
        short: normalizeWhitespace(vendorProduct.short_description || publicProduct.short_description || ""),
        full: normalizeWhitespace(vendorProduct.full_description || publicProduct.full_description || ""),
      },
      tags: (vendorProduct.tags || publicProduct.tags || []).filter(Boolean),
      brand_name: vendorProduct.brand_name || publicProduct.brand_name || null,
      audience: trimText(vendorProduct.attributes?.target_audience || publicProduct.attributes?.target_audience) || null,
      buying_intent: publicProduct.buying_intent || null,
      pros: (publicProduct.pros || []).filter(Boolean),
      cons: (publicProduct.cons || []).filter(Boolean),
      images,
      primary_image: referenceImageUrl,
      reference_image_url: referenceImageUrl,
      campaign_asset: {
        url: referenceImageUrl,
        approved: Boolean(referenceImageUrl),
        rights_status: "owned",
        provenance: "vendor_provided",
        fallback_mode: null,
      },
      constraints: {
        returnable: vendorProduct.returnable !== false,
        return_window_days: Number(vendorProduct.return_window_days || 7),
        stock_quantity: Number(vendorProduct.stock_quantity || 0),
        status: vendorProduct.status || publicProduct.status || "active",
      },
      brand_context: {
        brand_name: "Pink Paisa",
        product_brand: vendorProduct.brand_name || publicProduct.brand_name || null,
        tone: ["credible", "editorial", "product-led"],
        primary_channels: ["instagram"],
        blocked_claims: BLOCKED_CLAIMS,
      },
    };
  }

  const publicProduct = await Product.findById(run.public_product_id).lean();
  if (!publicProduct) throw new Error("Public product not found for intake");

  const images = [publicProduct.featured_image, ...(publicProduct.images || [])]
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index);
  const price = Number(publicProduct.price || 0);
  const salePrice = publicProduct.sale_price == null ? null : Number(publicProduct.sale_price);
  const discountPercent = salePrice != null && price > 0 && salePrice < price
    ? Math.round(((price - salePrice) / price) * 100)
    : null;
  const isAffiliate = Boolean(publicProduct.is_affiliate);
  const approvedAffiliatePriceSource = ["creators_api", "pa_api"].includes(String(publicProduct.affiliate_data_source || ""));
  const affiliatePriceFresh = !publicProduct.affiliate_data_expires_at
    ? false
    : new Date(publicProduct.affiliate_data_expires_at).getTime() > Date.now();
  const storedAffiliatePriceStatus = publicProduct.price_status || "unavailable";
  const affiliatePriceStatus = storedAffiliatePriceStatus === "verified" && (!approvedAffiliatePriceSource || !affiliatePriceFresh)
    ? "stale"
    : storedAffiliatePriceStatus;
  const priceAvailable = isAffiliate
    ? affiliatePriceStatus === "verified" && approvedAffiliatePriceSource && affiliatePriceFresh && Number(publicProduct.price || 0) > 0
    : Number(publicProduct.price || 0) > 0;
  const campaignRights = String(publicProduct.affiliate_campaign_usage_rights || "unknown");
  const campaignAssetUrl = isAffiliate
    ? (publicProduct.affiliate_campaign_asset_url || publicProduct.featured_image || images[0] || null)
    : (publicProduct.featured_image || images[0] || null);
  const affiliateSourceLabel = trimText(publicProduct.brand_name || publicProduct.affiliate_source_platform || "Affiliate Partner");
  const productUrl = buildProductUrl(publicProduct.slug);

  return {
    campaign_id: run.campaign_id,
    product_id: String(publicProduct._id),
    public_product_id: String(publicProduct._id),
    title: publicProduct.title,
    campaign_label: publicProduct.campaign_label || null,
    slug: publicProduct.slug,
    product_url: productUrl,
    is_affiliate: isAffiliate,
    affiliate_url: publicProduct.affiliate_url || null,
    affiliate_external_id: publicProduct.affiliate_external_id || null,
    affiliate_source_platform: publicProduct.affiliate_source_platform || null,
    affiliate_source_mode: publicProduct.affiliate_source_mode || null,
    affiliate: isAffiliate ? {
      url: publicProduct.affiliate_url || null,
      external_id: publicProduct.affiliate_external_id || null,
      source_platform: publicProduct.affiliate_source_platform || null,
      source_mode: publicProduct.affiliate_source_mode || null,
      source_label: affiliateSourceLabel,
    } : null,
    vendor: {
      id: null,
      shop_name: isAffiliate ? affiliateSourceLabel : "Pink Paisa",
      business_name: isAffiliate ? "Affiliate Partner" : "Pink Paisa",
      email: null,
    },
    pricing: {
      price: priceAvailable ? price : null,
      sale_price: priceAvailable ? salePrice : null,
      currency: "INR",
      discount_percent: priceAvailable ? discountPercent : null,
      available: priceAvailable,
      status: isAffiliate ? affiliatePriceStatus : "verified",
    },
    category: publicProduct.category || "Uncategorized",
    subcategory: publicProduct.subcategory || "Uncategorized",
    descriptions: {
      short: normalizeWhitespace(publicProduct.short_description || ""),
      full: normalizeWhitespace(publicProduct.full_description || ""),
    },
    tags: (publicProduct.tags || []).filter(Boolean),
    brand_name: publicProduct.brand_name || null,
    audience: trimText(publicProduct.attributes?.target_audience) || null,
    buying_intent: publicProduct.buying_intent || null,
    pros: (publicProduct.pros || []).filter(Boolean),
    cons: (publicProduct.cons || []).filter(Boolean),
    images,
    primary_image: campaignAssetUrl,
    reference_image_url: campaignAssetUrl,
    campaign_asset: {
      url: campaignAssetUrl,
      approved: Boolean(campaignAssetUrl),
      rights_status: isAffiliate ? campaignRights : "owned",
      provenance: isAffiliate ? (publicProduct.affiliate_image_provenance || "unknown") : "admin_provided",
      fallback_mode: null,
    },
    constraints: {
      returnable: publicProduct.returnable !== false,
      return_window_days: Number(publicProduct.return_window_days || 7),
      stock_quantity: Number(publicProduct.stock_quantity || 0),
      status: publicProduct.status || "active",
      fulfillment: isAffiliate ? "affiliate_partner" : "pinkpaisa",
    },
    brand_context: {
      brand_name: "Pink Paisa",
      product_brand: publicProduct.brand_name || null,
      partner_label: isAffiliate ? affiliateSourceLabel : null,
      commerce_model: isAffiliate ? "affiliate" : "owned_catalog",
      tone: ["credible", "editorial", "product-led"],
      primary_channels: ["instagram"],
      blocked_claims: BLOCKED_CLAIMS,
    },
  };
}

async function runStrategyAgent(run) {
  const brief = run.brief_json;
  if (!brief) throw new Error("Product brief missing for strategy agent");

  const hasOffer = !brief.is_affiliate && brief.pricing.sale_price != null && Number(brief.pricing.sale_price) < Number(brief.pricing.price);
  const lowStock = !brief.is_affiliate && Number(brief.constraints.stock_quantity || 0) <= 10;
  const goal = hasOffer || lowStock ? "sales" : "awareness";
  const audience = buildAudience(brief.category, brief.tags);
  const angle = buildAngle(brief);
  const cta = brief.is_affiliate ? "View partner pick" : chooseCtaText(brief);
  const contentType = "single_image";

  return {
    goal,
    primary_channel: "instagram",
    audience,
    angle,
    cta,
    hooks: buildHooks(brief, { audience }),
    offer_summary: brief.is_affiliate
      ? "Affiliate partner pick. Current Amazon price is checked on Amazon."
      : hasOffer
      ? `${formatPrice(brief.pricing.price)} down to ${formatPrice(brief.pricing.sale_price)}`
      : `Core price ${formatPrice(brief.pricing.price)}`,
    content_pieces: ["instagram_creative", "instagram_caption"],
    recommended_content_type: contentType,
    review_recommended: true,
    manual_followups: [
      "Check the generated Instagram creative for product cutout quality",
      ...(brief.is_affiliate ? ["Confirm the partner affiliate URL is present and opens correctly"] : []),
      "Publish only after compliance and admin review are approved",
    ],
  };
}

async function runCreativeAgent(run) {
  const brief = run.brief_json;
  if (!brief) throw new Error("Brief missing for creative agent");

  const campaignSettings = await getCampaignSettings();
  return generateAiInstagramCreative({
    run,
    brief,
    settings: campaignSettings,
  });
}

async function runCaptionAgent(run) {
  const brief = run.brief_json;
  const creative = run.creative_json;
  if (!brief || !creative) throw new Error("Brief or creative missing for caption agent");
  const generated = await generateCampaignCaption({ brief, creative });
  const caption = ensureAffiliateInstagramDisclosure(generated.caption, brief.is_affiliate);

  return {
    instagram: {
      caption,
      hashtags: generated.hashtags.slice(0, 8),
      cta: brief.is_affiliate ? "View partner pick" : generated.cta,
    },
    provider: generated.provider,
    model: generated.model,
    generated_at: generated.generated_at,
    creative_summary: {
      content_type: creative.content_type,
      primary_asset_url: creative.primary_asset_url,
      asset_urls: creative.asset_urls || [],
    },
  };
}

async function runComplianceAgent(run) {
  const brief = run.brief_json;
  const captions = run.caption_json;
  const creative = run.creative_json;
  if (!brief || !captions || !creative) throw new Error("Brief, captions, or creative missing for compliance agent");

  const issues = [];
  if (!brief.product_url) issues.push(createIssue("blocking", "missing_product_url", "No public product URL is available."));
  if (brief.is_affiliate && !brief.affiliate_url) {
    issues.push(createIssue("blocking", "missing_affiliate_url", "Affiliate campaigns require a partner affiliate URL in campaign metadata."));
  }
  if (brief.is_affiliate && !hasAffiliateInstagramDisclosure([
    captions.instagram?.caption,
    captions.instagram?.short_caption,
    captions.instagram?.long_caption,
  ].filter(Boolean).join("\n\n"))) {
    issues.push(createIssue("blocking", "missing_affiliate_disclosure", "Affiliate Instagram captions must include Pink Paisa's affiliate notice."));
  }
  if (!brief.reference_image_url && !brief.campaign_asset?.url) {
    issues.push(createIssue("blocking", "reference_image_required", "Product image required."));
  }
  if (!creative.source_image_url) {
    issues.push(createIssue("blocking", "reference_image_not_used", "The generated creative is missing its required product reference."));
  }
  if (brief.is_affiliate && !["admin_confirmed", "owned", "licensed", "api_permitted"].includes(String(brief.campaign_asset?.rights_status || "unknown"))) {
    issues.push(createIssue("warning", "reference_rights_unconfirmed", "Product image usage rights are unconfirmed. Review this before publishing."));
  }
  if (!Array.isArray(creative.asset_urls) || creative.asset_urls.length === 0) issues.push(createIssue("blocking", "missing_creative_assets", "The Instagram creative did not generate any publishable image assets."));
  if (Array.isArray(creative.asset_urls) && creative.asset_urls.filter(Boolean).length !== 1) issues.push(createIssue("blocking", "single_image_required", "New campaigns require exactly one generated image."));
  if (!brief.is_affiliate && brief.pricing.sale_price != null && Number(brief.pricing.sale_price) >= Number(brief.pricing.price)) {
    issues.push(createIssue("blocking", "invalid_sale_price", "Sale price must be lower than the base price."));
  }
  if (!trimText(brief.descriptions.short) && !trimText(brief.descriptions.full)) {
    issues.push(createIssue("warning", "missing_descriptions", "Product description is missing; verify the generated copy carefully."));
  }
  if (!brief.is_affiliate && Number(brief.constraints.stock_quantity || 0) <= 0) {
    issues.push(createIssue("warning", "out_of_stock", "Stock is zero or missing, so campaign timing should be checked."));
  }

  const blockedTerms = scanBlockedClaims([
    brief.descriptions.short,
    brief.descriptions.full,
    captions.instagram?.caption,
    captions.instagram?.short_caption,
    captions.instagram?.long_caption,
    captions.instagram?.cta,
    ...(captions.instagram?.hashtags || []).map(normalizeHashtagForCompliance),
    creative.image_copy?.eyebrow,
    creative.image_copy?.headline,
    creative.image_copy?.supporting_line,
    creative.image_copy?.cta,
    creative.creative_json?.image_copy?.eyebrow,
    creative.creative_json?.image_copy?.headline,
    creative.creative_json?.image_copy?.supporting_line,
    creative.creative_json?.image_copy?.cta,
    creative.creative_json?.headline,
    creative.creative_json?.supporting_line,
  ]);

  if (brief.is_affiliate) {
    try {
      validateCaptionPackage({
        caption: [
          captions.instagram?.caption || captions.instagram?.long_caption || captions.instagram?.short_caption || "",
          creative.image_copy?.eyebrow || creative.creative_json?.image_copy?.eyebrow,
          creative.image_copy?.headline || creative.creative_json?.image_copy?.headline,
          creative.image_copy?.supporting_line || creative.creative_json?.image_copy?.supporting_line,
          creative.image_copy?.cta || creative.creative_json?.image_copy?.cta,
        ].filter(Boolean).join("\n"),
        hashtags: captions.instagram?.hashtags || [],
        cta: captions.instagram?.cta || "",
      }, { isAffiliate: true, enforceGeneratedLimits: false });
    } catch (error) {
      issues.push(createIssue("blocking", error.code || "affiliate_caption_violation", error.message));
    }
  }

  for (const term of blockedTerms) {
    issues.push(createIssue("blocking", "blocked_claim", `Blocked claim detected: "${term}".`));
  }

  const blockingCount = issues.filter((issue) => issue.severity === "blocking").length;
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;

  return {
    status: blockingCount > 0 ? "needs_review" : warningCount > 0 ? "approved_with_warnings" : "approved",
    issues,
    blocked_terms: blockedTerms,
    human_review_required: true,
    review_reason: blockingCount > 0
      ? "Blocking compliance issues were detected. Fix or reject the draft before publishing."
      : "Review the creative, caption, CTA, and tracked link before posting to Instagram.",
  };
}

function appendParams(url, params) {
  const parsed = new URL(url);
  Object.entries(params).forEach(([key, value]) => {
    if (value != null && value !== "") parsed.searchParams.set(key, String(value));
  });
  return parsed.toString();
}

async function runTrackingAgent(run, { overflowMode = "truncate" } = {}) {
  const brief = run.brief_json;
  const captions = run.caption_json;
  const compliance = run.compliance_json;
  const creative = run.creative_json;

  if (!brief || !captions || !compliance || !creative) throw new Error("Inputs missing for tracking agent");
  if (!brief.product_url) throw new Error("Cannot build tracking links without a product URL");

  const campaignSlug = slugify(`${brief.slug}-${run.campaign_id}`);
  const instagramFeedLink = appendParams(brief.product_url, {
    utm_source: "instagram",
    utm_medium: "organic_social",
    utm_campaign: campaignSlug,
    utm_content: creative.content_type === "carousel" ? "carousel_post" : "single_image_post",
  });
  const composedCaption = composeInstagramCaption({
    caption: captions.instagram?.caption || captions.instagram?.long_caption || captions.instagram?.short_caption || "",
    trackedUrl: instagramFeedLink,
    hashtags: captions.instagram?.hashtags || [],
    isAffiliate: Boolean(brief.is_affiliate),
    overflowMode,
  });

  return {
    campaign_slug: campaignSlug,
    objective: run.strategy_json?.goal || "awareness",
    compliance_status: compliance.status,
    links: {
      instagram_feed: instagramFeedLink,
    },
    publish_payload: {
      channel: "instagram",
      content_type: creative.content_type || "single_image",
      asset_urls: (creative.asset_urls || []).map((url) => resolvePublicUrl(url)),
      caption: composedCaption.caption,
      caption_character_count: composedCaption.character_count,
      caption_was_truncated: composedCaption.was_truncated,
      hashtags: composedCaption.hashtags,
      tracked_url: instagramFeedLink,
      cta: captions.instagram?.cta || creative.cta_text,
    },
  };
}

async function runPublishPreparationAgent(run) {
  const creative = run.creative_json;
  const tracking = run.tracking_json;
  if (!creative || !tracking?.publish_payload) throw new Error("Creative or tracking payload missing for publish preparation");
  const caption = ensureAffiliateInstagramDisclosure(
    tracking.publish_payload.caption,
    Boolean(run.brief_json?.is_affiliate || run.source_event === "affiliate_product.published"),
  );
  if (caption.length > INSTAGRAM_CAPTION_MAX_LENGTH) throw captionLengthError();

  return {
    channel: "instagram",
    content_type: creative.content_type,
    asset_urls: tracking.publish_payload.asset_urls || [],
    caption,
    tracked_url: tracking.publish_payload.tracked_url,
    cta: tracking.publish_payload.cta,
    caption_character_count: caption.length,
    caption_was_truncated: tracking.publish_payload.caption_was_truncated,
  };
}

module.exports = {
  AFFILIATE_INSTAGRAM_DISCLOSURE,
  INSTAGRAM_CAPTION_MAX_LENGTH,
  ensureAffiliateInstagramDisclosure,
  hasAffiliateInstagramDisclosure,
  isAffiliateDisclosureHashtag,
  stripAffiliateInstagramDisclosure,
  runIntakeAgent,
  runStrategyAgent,
  runCreativeAgent,
  runCaptionAgent,
  runComplianceAgent,
  runTrackingAgent,
  runPublishPreparationAgent,
  _private: {
    composeInstagramCaption,
    ensureAffiliateInstagramDisclosure,
    hasAffiliateInstagramDisclosure,
    isAffiliateDisclosureHashtag,
    stripAffiliateInstagramDisclosure,
  },
};
