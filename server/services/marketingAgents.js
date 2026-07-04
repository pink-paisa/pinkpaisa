const Product = require("../models/Product");
const Vendor = require("../models/Vendor");
const VendorProduct = require("../models/VendorProduct");
const { getCampaignSettings } = require("../utils/campaignSettings");
const {
  chooseCtaText,
  generateInstagramCreative,
  resolvePublicUrl,
} = require("./instagramCreativeRenderer");
const { generateAiInstagramCreative } = require("./instagramAiCreativeService");

const DEFAULT_FRONTEND_URL = "https://www.pinkpaisa.in";
const BLOCKED_CLAIMS = ["cure", "guaranteed", "instant results", "100% safe", "risk-free", "miracle", "clinically proven"];

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

function getAffiliateSourceLabel(brief) {
  return trimText(
    brief?.affiliate?.source_label
    || brief?.brand_context?.partner_label
    || brief?.affiliate_source_platform
    || "Affiliate Partner"
  );
}

function buildAudience(category, tags) {
  const source = `${trimText(category)} ${Array.isArray(tags) ? tags.join(" ") : ""}`.toLowerCase();
  if (source.includes("nutrition") || source.includes("supplement")) return "Women building healthier daily routines with a nutrition focus";
  if (source.includes("beauty") || source.includes("skin") || source.includes("care")) return "Women looking for premium self-care and beauty upgrades";
  if (source.includes("lifestyle") || source.includes("home")) return "Women curating calmer, more intentional lifestyle rituals";
  return "Women exploring wellness products that fit into everyday life";
}

function buildAngle(brief) {
  if (brief.is_affiliate) return "editorial partner pick discovery with affiliate-link transparency";
  const hasOffer = brief.pricing.sale_price != null && Number(brief.pricing.sale_price) < Number(brief.pricing.price);
  if (hasOffer) return "limited-time value with a premium but approachable wellness angle";
  if (Number(brief.constraints.stock_quantity || 0) <= 10) return "low-stock urgency anchored in a trusted editorial recommendation";
  return "editorial product discovery focused on habit-building and real-life use";
}

function buildHooks(brief, strategy) {
  const priceLine = brief.pricing.sale_price != null && Number(brief.pricing.sale_price) < Number(brief.pricing.price)
    ? `Now at ${formatPrice(brief.pricing.sale_price)}`
    : `Explore it at ${formatPrice(brief.pricing.price)}`;
  return [
    `A softer way to upgrade your ${trimText(brief.category || "wellness")} routine.`,
    `${trimText(brief.title)} is built for everyday use, not just special occasions.`,
    brief.is_affiliate ? `${priceLine} through a partner pick.` : `${priceLine} on Pink Paisa.`,
    `Best for: ${strategy.audience}.`,
  ];
}

function buildHashtags(brief) {
  const tags = new Set(["#PinkPaisa", "#WomenWhoWellness", "#ShopPinkPaisa"]);
  if (brief.category) tags.add(`#${trimText(brief.category).replace(/[^a-zA-Z0-9]+/g, "")}`);
  if (brief.subcategory) tags.add(`#${trimText(brief.subcategory).replace(/[^a-zA-Z0-9]+/g, "")}`);
  (brief.tags || []).filter(Boolean).slice(0, 2).forEach((tag) => tags.add(`#${trimText(tag).replace(/[^a-zA-Z0-9]+/g, "")}`));
  return Array.from(tags).filter(Boolean).slice(0, 8);
}

function scanBlockedClaims(textFragments) {
  const combined = textFragments.filter(Boolean).join(" ").toLowerCase();
  return BLOCKED_CLAIMS.filter((term) => combined.includes(term));
}

function createIssue(severity, code, message) {
  return { severity, code, message };
}

function buildShortOfferLine(brief) {
  if (brief.pricing.sale_price != null && Number(brief.pricing.sale_price) < Number(brief.pricing.price)) {
    return brief.is_affiliate
      ? `Partner-listed from ${formatPrice(brief.pricing.sale_price)}.`
      : `Was ${formatPrice(brief.pricing.price)}, now ${formatPrice(brief.pricing.sale_price)}.`;
  }
  return brief.is_affiliate
    ? `Partner-listed at ${formatPrice(brief.pricing.price)}.`
    : `Available now at ${formatPrice(brief.pricing.price)}.`;
}

async function runIntakeAgent(run) {
  if (run.vendor_product_id) {
    const vendorProduct = await VendorProduct.findById(run.vendor_product_id).lean();
    if (!vendorProduct) throw new Error("Vendor product not found for intake");

    const publicProduct = await Product.findById(run.public_product_id || vendorProduct.published_product_id).lean();
    if (!publicProduct) throw new Error("Public product not found for intake");

    const vendor = await Vendor.findById(vendorProduct.vendor_id).lean();
    const images = [vendorProduct.featured_image, ...(vendorProduct.additional_images || []), ...(publicProduct.images || [])]
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
      },
      category: vendorProduct.category || publicProduct.category || "Uncategorized",
      subcategory: vendorProduct.subcategory || publicProduct.subcategory || "Uncategorized",
      descriptions: {
        short: normalizeWhitespace(vendorProduct.short_description || publicProduct.short_description || ""),
        full: normalizeWhitespace(vendorProduct.full_description || publicProduct.full_description || ""),
      },
      tags: (vendorProduct.tags || publicProduct.tags || []).filter(Boolean),
      images,
      constraints: {
        returnable: vendorProduct.returnable !== false,
        return_window_days: Number(vendorProduct.return_window_days || 7),
        stock_quantity: Number(vendorProduct.stock_quantity || 0),
        status: vendorProduct.status || publicProduct.status || "active",
      },
      brand_context: {
        brand_name: "Pink Paisa",
        tone: ["warm", "credible", "editorial", "women-first"],
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
  const affiliateSourceLabel = trimText(publicProduct.brand_name || publicProduct.affiliate_source_platform || "Affiliate Partner");
  const productUrl = buildProductUrl(publicProduct.slug);

  return {
    campaign_id: run.campaign_id,
    product_id: String(publicProduct._id),
    public_product_id: String(publicProduct._id),
    title: publicProduct.title,
    slug: publicProduct.slug,
    product_url: productUrl,
    is_affiliate: isAffiliate,
    affiliate_url: publicProduct.affiliate_url || null,
    affiliate_external_id: publicProduct.affiliate_external_id || null,
    affiliate_source_platform: publicProduct.affiliate_source_platform || null,
    affiliate: isAffiliate ? {
      url: publicProduct.affiliate_url || null,
      external_id: publicProduct.affiliate_external_id || null,
      source_platform: publicProduct.affiliate_source_platform || null,
      source_label: affiliateSourceLabel,
    } : null,
    vendor: {
      id: null,
      shop_name: isAffiliate ? affiliateSourceLabel : "Pink Paisa",
      business_name: isAffiliate ? "Affiliate Partner" : "Pink Paisa",
      email: null,
    },
    pricing: {
      price,
      sale_price: salePrice,
      currency: "INR",
      discount_percent: discountPercent,
    },
    category: publicProduct.category || "Uncategorized",
    subcategory: publicProduct.subcategory || "Uncategorized",
    descriptions: {
      short: normalizeWhitespace(publicProduct.short_description || ""),
      full: normalizeWhitespace(publicProduct.full_description || ""),
    },
    tags: (publicProduct.tags || []).filter(Boolean),
    images,
    constraints: {
      returnable: publicProduct.returnable !== false,
      return_window_days: Number(publicProduct.return_window_days || 7),
      stock_quantity: Number(publicProduct.stock_quantity || 0),
      status: publicProduct.status || "active",
      fulfillment: isAffiliate ? "affiliate_partner" : "pinkpaisa",
    },
    brand_context: {
      brand_name: "Pink Paisa",
      partner_label: isAffiliate ? affiliateSourceLabel : null,
      commerce_model: isAffiliate ? "affiliate" : "owned_catalog",
      tone: ["warm", "credible", "editorial", "women-first"],
      primary_channels: ["instagram"],
      blocked_claims: BLOCKED_CLAIMS,
    },
  };
}

async function runStrategyAgent(run) {
  const brief = run.brief_json;
  if (!brief) throw new Error("Product brief missing for strategy agent");

  const hasOffer = brief.pricing.sale_price != null && Number(brief.pricing.sale_price) < Number(brief.pricing.price);
  const lowStock = !brief.is_affiliate && Number(brief.constraints.stock_quantity || 0) <= 10;
  const goal = hasOffer || lowStock ? "sales" : "awareness";
  const audience = buildAudience(brief.category, brief.tags);
  const angle = buildAngle(brief);
  const cta = brief.is_affiliate ? "View partner pick" : chooseCtaText(brief);
  const contentType = Array.isArray(brief.images) && brief.images.length >= 2 && String(process.env.MARKETING_ENABLE_CAROUSEL || "true") !== "false"
    ? "carousel"
    : "single_image";

  return {
    goal,
    primary_channel: "instagram",
    audience,
    angle,
    cta,
    hooks: buildHooks(brief, { audience }),
    offer_summary: hasOffer
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
  const strategy = run.strategy_json;
  if (!brief || !strategy) throw new Error("Brief or strategy missing for creative agent");

  const campaignSettings = await getCampaignSettings();
  const creativeMode = campaignSettings.campaign_creative_mode || "template";
  if (creativeMode !== "template") {
    return generateAiInstagramCreative({
      run,
      brief,
      strategy,
      settings: campaignSettings,
    });
  }

  return generateInstagramCreative(run, brief, strategy);
}

async function runCaptionAgent(run) {
  const brief = run.brief_json;
  const strategy = run.strategy_json;
  const creative = run.creative_json;
  if (!brief || !strategy || !creative) throw new Error("Brief, strategy, or creative missing for caption agent");

  const coreDescription = brief.descriptions.short || brief.descriptions.full || (
    brief.is_affiliate ? `${brief.title} is a partner pick on Pink Paisa` : `${brief.title} on Pink Paisa`
  );
  const priceLine = buildShortOfferLine(brief);
  const captionLead = brief.is_affiliate
    ? `${brief.title} is a partner pick for a more intentional ${String(brief.category || "wellness").toLowerCase()} ritual.`
    : `${brief.title} is here for a more intentional ${String(brief.category || "wellness").toLowerCase()} ritual.`;
  const sourceLine = brief.is_affiliate ? `Partner source: ${getAffiliateSourceLabel(brief)}.` : null;

  return {
    instagram: {
      short_caption: `${captionLead} ${priceLine} ${creative.cta_text || strategy.cta}.`,
      long_caption: [
        brief.title,
        coreDescription,
        `Why we like it: ${strategy.angle}.`,
        priceLine,
        sourceLine,
        `Made for ${strategy.audience.toLowerCase()}.`,
        `${creative.cta_text || strategy.cta}.`,
      ].filter(Boolean).join("\n\n"),
      hashtags: buildHashtags(brief),
      cta: creative.cta_text || strategy.cta,
    },
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
  if (!Array.isArray(brief.images) || brief.images.length === 0) issues.push(createIssue("blocking", "missing_images", "At least one product image is required."));
  if (!Array.isArray(creative.asset_urls) || creative.asset_urls.length === 0) issues.push(createIssue("blocking", "missing_creative_assets", "The Instagram creative did not generate any publishable image assets."));
  if (brief.pricing.sale_price != null && Number(brief.pricing.sale_price) >= Number(brief.pricing.price)) {
    issues.push(createIssue("blocking", "invalid_sale_price", "Sale price must be lower than the base price."));
  }
  if (!trimText(brief.descriptions.short) && !trimText(brief.descriptions.full)) {
    issues.push(createIssue("blocking", "missing_descriptions", "Product copy is too thin for campaign use."));
  }
  if (!brief.is_affiliate && Number(brief.constraints.stock_quantity || 0) <= 0) {
    issues.push(createIssue("warning", "out_of_stock", "Stock is zero or missing, so campaign timing should be checked."));
  }

  const blockedTerms = scanBlockedClaims([
    brief.descriptions.short,
    brief.descriptions.full,
    captions.instagram?.short_caption,
    captions.instagram?.long_caption,
    creative.creative_json?.headline,
    creative.creative_json?.supporting_line,
  ]);

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

async function runTrackingAgent(run) {
  const brief = run.brief_json;
  const strategy = run.strategy_json;
  const captions = run.caption_json;
  const compliance = run.compliance_json;
  const creative = run.creative_json;

  if (!brief || !strategy || !captions || !compliance || !creative) throw new Error("Inputs missing for tracking agent");
  if (!brief.product_url) throw new Error("Cannot build tracking links without a product URL");

  const campaignSlug = slugify(`${brief.slug}-${run.campaign_id}`);
  const instagramFeedLink = appendParams(brief.product_url, {
    utm_source: "instagram",
    utm_medium: "organic_social",
    utm_campaign: campaignSlug,
    utm_content: creative.content_type === "carousel" ? "carousel_post" : "single_image_post",
  });

  return {
    campaign_slug: campaignSlug,
    objective: strategy.goal,
    compliance_status: compliance.status,
    links: {
      instagram_feed: instagramFeedLink,
    },
    publish_payload: {
      channel: "instagram",
      content_type: creative.content_type,
      asset_urls: (creative.asset_urls || []).map((url) => resolvePublicUrl(url)),
      caption: `${captions.instagram?.long_caption || captions.instagram?.short_caption || ""}\n\n${instagramFeedLink}\n\n${(captions.instagram?.hashtags || []).join(" ")}`.trim(),
      tracked_url: instagramFeedLink,
      cta: captions.instagram?.cta || strategy.cta,
    },
  };
}

async function runPublishPreparationAgent(run) {
  const creative = run.creative_json;
  const tracking = run.tracking_json;
  if (!creative || !tracking?.publish_payload) throw new Error("Creative or tracking payload missing for publish preparation");

  return {
    channel: "instagram",
    content_type: creative.content_type,
    asset_urls: tracking.publish_payload.asset_urls || [],
    caption: tracking.publish_payload.caption,
    tracked_url: tracking.publish_payload.tracked_url,
    cta: tracking.publish_payload.cta,
  };
}

module.exports = {
  runIntakeAgent,
  runStrategyAgent,
  runCreativeAgent,
  runCaptionAgent,
  runComplianceAgent,
  runTrackingAgent,
  runPublishPreparationAgent,
};
