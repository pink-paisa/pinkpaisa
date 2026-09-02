const MarketingAsset = require("../models/MarketingAsset");
const { storeCampaignAsset } = require("./campaignAssetStorage");
const {
  generateSocialVisuals,
} = require("./social/socialAiImageService");
const {
  assertBrandLogoEvidenceForAssets,
  buildBrandLogoContract,
  serializeBrandLogoContract,
} = require("./social/socialBrandLogoPolicy");
const {
  DEFAULT_AFFILIATE_CAMPAIGN_AI_PROMPT_TEMPLATE,
  DEFAULT_CATALOG_CAMPAIGN_AI_PROMPT_TEMPLATE,
} = require("../utils/campaignSettings");

const INSTAGRAM_CANVAS_WIDTH = 1080;
const INSTAGRAM_CANVAS_HEIGHT = 1350;

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

function normalizeList(value, limit = 10) {
  return (Array.isArray(value) ? value : [])
    .map((item) => normalizeWhitespace(item))
    .filter(Boolean)
    .slice(0, limit);
}

function resolveReferenceUrl(brief = {}) {
  return trimText(
    brief.reference_image_url
    || brief.campaign_asset?.url
    || brief.primary_image
    || (Array.isArray(brief.images) ? brief.images.find(Boolean) : null)
    || ""
  ) || null;
}

function limitWords(value, maximum) {
  const words = normalizeWhitespace(value).split(" ").filter(Boolean);
  return words.slice(0, maximum).join(" ");
}

function firstSentence(value) {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return "";
  return normalizeWhitespace((normalized.match(/^.*?(?:[.!?](?=\s|$)|$)/) || [normalized])[0]);
}

function buildImageCopy(brief = {}) {
  const campaignLabel = normalizeWhitespace(brief.campaign_label);
  const title = normalizeWhitespace(brief.title) || "Product pick";
  const headline = campaignLabel && campaignLabel.split(" ").length <= 7
    ? campaignLabel
    : limitWords(title, 7);
  const verifiedDescription = limitWords(firstSentence(brief.descriptions?.short), 16);
  const isAffiliate = Boolean(brief.is_affiliate);

  return {
    eyebrow: isAffiliate ? "PINK PAISA PARTNER PICK" : "PINK PAISA EDITORIAL PICK",
    headline,
    supporting_line: verifiedDescription || (isAffiliate
      ? "A curated partner pick from Pink Paisa."
      : "Explore this product pick on Pink Paisa."),
    cta: isAffiliate ? "VIEW PARTNER PICK" : "EXPLORE ON PINK PAISA",
  };
}

function promptError(message) {
  const error = new Error(message);
  error.code = "prompt_template_invalid";
  return error;
}

function replacePromptPlaceholders(value, brief = {}, imageCopy = buildImageCopy(brief)) {
  const benefits = normalizeList([...(brief.pros || []), ...(brief.tags || [])], 6).join(", ");
  const brandTone = normalizeList(brief.brand_context?.tone, 5).join(" / ") || "Premium / Modern / Editorial";
  const category = [brief.category, brief.subcategory].map(trimText).filter(Boolean).join(" / ") || "Product";
  const productType = trimText(brief.subcategory || brief.category) || "Product";
  const brandName = trimText(brief.brand_name || brief.brand_context?.product_brand) || "Auto-detect from product reference";
  const targetAudience = trimText(brief.audience) || "No audience assumption";
  const accentColour = trimText(brief.brand_context?.accent_colour) || "Auto-detect from product reference";
  const replacements = {
    "[PRODUCT_NAME]": trimText(brief.title),
    "[BRAND_NAME]": brandName,
    "[CATEGORY]": category,
    "[PRODUCT_TYPE]": productType,
    "[TARGET_AUDIENCE]": targetAudience,
    "[BRAND_TONE]": brandTone,
    "[ACCENT_COLOUR]": accentColour,
    "[EYEBROW]": imageCopy.eyebrow,
    "[HEADLINE]": imageCopy.headline,
    "[SUPPORTING_LINE]": imageCopy.supporting_line,
    "[IMAGE_CTA]": imageCopy.cta,
    "[Your Product Name]": trimText(brief.title),
    "[e.g., Skincare / Perfume / Serum]": category,
    "[e.g., Men 20-35 / Women / Luxury buyers]": targetAudience,
    "[e.g., Hydration, Glow, Anti-aging]": benefits,
    "[Luxury / Minimal / Bold / Natural / Premium]": brandTone,
    "[PRODUCT NAME OR AUTO-DETECT]": trimText(brief.title),
    "[BRAND NAME OR AUTO-DETECT]": brandName,
    "[SKINCARE / BEAUTY / PERFUME / FASHION / JEWELLERY / ACCESSORY / HOME / ELECTRONICS / AUTO-DETECT]": category,
    "[EXACT PRODUCT TYPE OR AUTO-DETECT]": productType,
    "[TARGET AUDIENCE]": targetAudience,
    "[PREMIUM / MINIMAL / LUXURY / NATURAL / BOLD / MODERN / FEMININE / SPORTY]": brandTone,
    "[COLOUR OR AUTO-DETECT FROM PRODUCT]": accentColour,
    "[HEADLINE - MAXIMUM 7 WORDS]": imageCopy.headline,
    "[SUPPORTING LINE]": imageCopy.supporting_line,
    "[VIEW PARTNER PICK / EXPLORE PARTNER PICK]": imageCopy.cta,
    "[VIEW PARTNER PICK OR EXPLORE PARTNER PICK]": imageCopy.cta,
  };
  let result = trimText(value);
  const templatePlaceholders = result.match(/\[[^\]\n]{1,120}\]/g) || [];
  const unknownPlaceholder = templatePlaceholders.find((placeholder) => !Object.hasOwn(replacements, placeholder));
  if (unknownPlaceholder) {
    throw promptError(`Unknown campaign prompt placeholder: ${unknownPlaceholder}`);
  }
  for (const [token, replacement] of Object.entries(replacements)) {
    result = result.split(token).join(replacement);
  }
  return result.trim();
}

function buildProductFacts(brief = {}) {
  const brand = trimText(brief.brand_name || brief.brand_context?.product_brand);
  const descriptions = [brief.descriptions?.short, brief.descriptions?.full]
    .map(normalizeWhitespace)
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index);
  const facts = [
    `Product name: ${trimText(brief.title) || "Unknown"}`,
    brand ? `Brand: ${brand}` : null,
    brief.category ? `Category: ${trimText(brief.category)}` : null,
    brief.subcategory ? `Subcategory: ${trimText(brief.subcategory)}` : null,
    descriptions.length ? `Description: ${descriptions.join(" ")}` : null,
    normalizeList(brief.tags, 12).length ? `Tags: ${normalizeList(brief.tags, 12).join(", ")}` : null,
    normalizeList(brief.pros, 8).length ? `Supported benefits/pros: ${normalizeList(brief.pros, 8).join(", ")}` : null,
    brief.buying_intent ? `Buying intent: ${normalizeWhitespace(brief.buying_intent)}` : null,
    brief.audience ? `Supported audience: ${normalizeWhitespace(brief.audience)}` : null,
  ];
  return facts.filter(Boolean).join("\n");
}

function resolveCreativePrompt({ brief = {}, settings = {} }) {
  const promptType = brief.is_affiliate ? "affiliate" : "catalog";
  const imageCopy = buildImageCopy(brief);
  const template = promptType === "affiliate"
    ? (settings.campaign_ai_affiliate_prompt_template || settings.campaign_ai_prompt_template || DEFAULT_AFFILIATE_CAMPAIGN_AI_PROMPT_TEMPLATE)
    : (settings.campaign_ai_catalog_prompt_template || DEFAULT_CATALOG_CAMPAIGN_AI_PROMPT_TEMPLATE);
  const creativeDirection = replacePromptPlaceholders(template, brief, imageCopy);
  const affiliateRules = brief.is_affiliate ? [
    "This is an affiliate discovery item; Pink Paisa is not the manufacturer, seller, stockist, or shipper.",
    "Do not show prices, discounts, sale percentages, coupons, availability, delivery promises, Amazon branding, or marketplace logos.",
  ] : [];

  const prompt = [
    "Edit the attached product reference image into one premium Instagram product creative.",
    "The attached image is mandatory and is the authoritative source for the exact product identity.",
    "",
    "Product facts (context only; do not render this text in the image):",
    buildProductFacts(brief),
    creativeDirection ? `\nAdmin creative direction:\n${creativeDirection}` : null,
    "",
    "Required identity preservation:",
    "- Preserve the exact product shape, proportions, package structure, colours, label layout, logo placement, cap, dispenser, and every recognizable detail from the reference.",
    "- Keep the same single product and same variant. Do not redesign the package, rewrite labels, invent text, add variants, duplicate the product, or replace branding.",
    "- Modify only the background, lighting, shadows, reflections, depth, and restrained category-relevant props.",
    "- Keep the complete product visible, sharp, undistorted, and naturally integrated into the scene.",
    ...affiliateRules,
    `- Render only the supplied eyebrow "${imageCopy.eyebrow}", headline "${imageCopy.headline}", supporting line "${imageCopy.supporting_line}", and CTA "${imageCopy.cta}" outside the original product packaging.`,
    "- Do not invent additional typography, prices, badges, URLs, claims, slogans, ratings, reviews, awards, certifications, or watermarks.",
    "- Avoid hands, people, collages, split layouts, cropped packaging, warped labels, or additional product containers.",
    "",
    "Output exactly one photorealistic portrait 4:5 Instagram composition. Keep the product as the clear visual hero with polished ecommerce lighting and a clean premium background.",
  ].filter((line) => line !== null && line !== undefined).join("\n").trim();

  return { prompt, promptType, imageCopy };
}

function buildCreativePrompt({ brief = {}, settings = {} }) {
  return resolveCreativePrompt({ brief, settings }).prompt;
}

function buildVariantPrompt({ brief, settings }) {
  return buildCreativePrompt({ brief, settings });
}

function buildBrandedBackgroundPrompt({ brief = {}, settings = {} }) {
  const { promptType } = resolveCreativePrompt({ brief, settings });
  const category = [brief.category, brief.subcategory].map(trimText).filter(Boolean).join(" / ") || "product";
  const tone = normalizeList(brief.brand_context?.tone, 5).join(", ") || "premium, editorial, modern";
  return {
    promptType,
    prompt: [
      `Create a polished 4:5 Pink Paisa editorial environment for a ${category} product creative.`,
      `Art direction: ${tone}; women-first, contemporary, credible and Instagram-native.`,
      "Generate only the empty background, lighting, shadows and restrained category-relevant props.",
      "Keep the right-centre area clear for one authentic catalogue product that guarded local code will place afterward.",
      "Do not render, depict, imitate, redraw, retouch or include any product, package, label, bottle, box, container, marketplace branding or merchandise.",
      "Do not render any headline, CTA, price, discount, claim, letters, numbers, currency symbols, watermark or logo except the supplied canonical Pink Paisa profile badge.",
      "Place the supplied badge in the adaptive locked safe corner provided by the shared branded-image gateway and keep it completely unobstructed.",
    ].join("\n"),
  };
}

function buildLegacyProductRecommendation({ brief = {}, prompt }) {
  const referenceUrl = resolveReferenceUrl(brief);
  const productId = trimText(brief.public_product_id || brief.product_id);
  const title = trimText(brief.title);
  return {
    format: "PRODUCT_FEATURE",
    objective: "PRODUCT_PROMOTION",
    postType: brief.is_affiliate ? "AFFILIATE" : "PRODUCT",
    contentPillar: brief.is_affiliate
      ? "CURATED WELLNESS AND AFFILIATE PRODUCTS"
      : "PINK PAISA PRODUCTS",
    topic: title || "Pink Paisa product creative",
    visualMode: "AI_VISUAL_WITH_EXACT_OVERLAY",
    verifiedProductId: productId,
    verifiedProductTitle: title,
    verifiedProductFacts: {
      id: productId,
      title,
      imageUrl: referenceUrl,
      mediaUrl: referenceUrl,
      category: trimText(brief.category),
      subcategory: trimText(brief.subcategory),
      isAffiliate: Boolean(brief.is_affiliate),
    },
    formatContent: {
      format: "PRODUCT_FEATURE",
      selectedHeadline: buildImageCopy(brief).headline,
      productPreservationInstructions: [
        "Place the verified catalogue product exactly once without altering, regenerating or obscuring its pixels.",
      ],
    },
    visualBrief: {
      format: "PRODUCT_FEATURE",
      visualMode: "AI_VISUAL_WITH_EXACT_OVERLAY",
      authenticProductReference: {
        productId,
        productTitle: title,
        imageUrl: referenceUrl,
      },
      assets: [{
        sequence: 1,
        imagePrompt: prompt,
        requiredObjects: [],
        prohibitedObjects: [
          "product",
          "product packaging",
          "marketplace logo",
          "unrelated branding",
        ],
      }],
    },
  };
}

function socialImageSettings(settings = {}) {
  return {
    ...settings,
    models: {
      ...(settings.models || {}),
      image_provider: trimText(settings.campaign_ai_provider || settings.models?.image_provider || "openai").toLowerCase(),
      image_model: trimText(settings.campaign_ai_model || settings.models?.image_model || "gpt-image-2"),
      image_quality: trimText(settings.campaign_ai_image_quality || settings.models?.image_quality || "medium").toLowerCase(),
      compliance_model: trimText(settings.models?.compliance_model || settings.campaign_ai_compliance_model || "") || undefined,
    },
    generation: {
      ...(settings.generation || {}),
      // Mandatory badge generation always gets the full bounded three-attempt
      // validation loop. There is no unbranded or composited fallback.
      max_image_retries: 3,
    },
  };
}

function generationSizeForProvider(provider, model) {
  if (provider === "openai" && model === "gpt-image-2") return "1088x1360";
  if (provider === "openai") return "1024x1536";
  return `${INSTAGRAM_CANVAS_WIDTH}x${INSTAGRAM_CANVAS_HEIGHT}`;
}

async function processOutputForInstagram(buffer) {
  const sharp = require("sharp");
  return sharp(buffer, { failOn: "error" })
    .rotate()
    .resize(INSTAGRAM_CANVAS_WIDTH, INSTAGRAM_CANVAS_HEIGHT, {
      fit: "contain",
      position: "centre",
      background: { r: 255, g: 255, b: 255, alpha: 1 },
      withoutEnlargement: false,
    })
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();
}

async function writeOutput({ run, brief, settings, fileName, buffer, sourceUrl, storedAsset = null, dependencies = {} }) {
  const stored = storedAsset || await (dependencies.storeCampaignAsset || storeCampaignAsset)({ fileName, buffer });
  const sourceAsset = brief.campaign_asset || {};
  const MarketingAssetModel = dependencies.MarketingAsset || MarketingAsset;
  await MarketingAssetModel.findOneAndUpdate(
    { url: stored.url },
    {
      $set: {
        campaign_run_id: run._id,
        campaign_id: run.campaign_id,
        asset_type: "creative",
        url: stored.url,
        storage_provider: stored.storage_provider,
        storage_key: stored.storage_key,
        checksum_sha256: stored.checksum_sha256,
        source_url: sourceUrl,
        source_provenance: "generated_from_approved_source",
        usage_rights_status: sourceAsset.rights_status || "unknown",
        provider: settings.campaign_ai_provider,
        model: settings.campaign_ai_model,
        deleted_at: null,
      },
    },
    { upsert: true, new: true },
  );
  return {
    file_path: stored.file_path || null,
    public_url: stored.url,
    checksum_sha256: stored.checksum_sha256,
  };
}

async function generateAiInstagramCreative({ run, brief, settings, dependencies = {} }) {
  const referenceUrl = resolveReferenceUrl(brief);
  if (!referenceUrl) {
    const error = new Error("A verified authentic product image is required for legacy Instagram creative generation");
    error.code = "reference_image_required";
    throw error;
  }
  const imageCopy = buildImageCopy(brief);
  const { prompt: backgroundPrompt, promptType } = buildBrandedBackgroundPrompt({ brief, settings });
  const recommendation = buildLegacyProductRecommendation({ brief, prompt: backgroundPrompt });
  const draftLike = {
    _id: run?._id || null,
    idempotency_key: trimText(run?.campaign_id) || null,
    format: "PRODUCT_FEATURE",
  };

  // Establish the exact runtime contract before entering the paid gateway.
  // The canonical badge buffer is the sole generative image reference; the
  // authentic product is resolved separately and composited only after the AI
  // background has been returned.
  const contractBuilder = dependencies.buildBrandLogoContract || buildBrandLogoContract;
  const runtimeBrandLogoContract = await contractBuilder({
    draftLike,
    recommendation,
    visualMode: "AI_VISUAL_WITH_EXACT_OVERLAY",
    preferredCorner: "TOP_LEFT",
    logoPath: settings.visual_brand?.logo_path || settings.brand_logo_path || null,
    dependencies,
  });
  const serializedBrandLogoContract = serializeBrandLogoContract(runtimeBrandLogoContract);
  draftLike.brand_logo_contract = serializedBrandLogoContract;

  const generateThroughGateway = dependencies.generateSocialVisuals || generateSocialVisuals;
  const imageResult = await generateThroughGateway({
    draftLike,
    recommendation,
    settings: socialImageSettings(settings),
    visualMode: "AI_VISUAL_WITH_EXACT_OVERLAY",
    dependencies: {
      ...dependencies,
      // Freeze and reuse the already-verified bytes and safe corner. This also
      // prevents a different logo file from being selected between preflight
      // and the OpenAI images.edit request.
      buildBrandLogoContract: async () => runtimeBrandLogoContract,
    },
  });
  const visual = Array.isArray(imageResult?.original_visuals)
    ? imageResult.original_visuals[0]
    : null;
  if (!visual || !Buffer.isBuffer(visual.buffer) || !visual.url) {
    const error = new Error("The branded-image gateway did not return one validated legacy campaign creative");
    error.code = "social_image_generation_failed";
    error.image_generation = imageResult?.image_generation || null;
    throw error;
  }
  assertBrandLogoEvidenceForAssets([visual], { contract: runtimeBrandLogoContract });

  const generatedAt = new Date().toISOString();
  const output = await writeOutput({
    run,
    brief,
    settings,
    fileName: `${slugify(run.campaign_id)}-ai-branded-product.jpg`,
    buffer: visual.buffer,
    sourceUrl: referenceUrl,
    storedAsset: {
      file_path: visual.file_path || null,
      url: visual.url,
      storage_provider: visual.storage_provider,
      storage_key: visual.storage_key,
      checksum_sha256: visual.checksum_sha256,
    },
    dependencies,
  });
  const ctaText = brief.is_affiliate ? "View partner pick" : "Explore product";
  const referenceChecksum = visual.reference_image_checksum_sha256;
  const finalPrompt = visual.prompt || backgroundPrompt;
  const brandLogoEvidence = visual.brand_logo_evidence || visual.brand_logo_validation;
  const provenance = {
    generation_gateway: "social_reference_backed_branded_image_v1",
    visual_mode: "AI_VISUAL_WITH_EXACT_OVERLAY",
    background_generation_method: "openai_images_edit_reference",
    authentic_product_compositor: visual.authentic_product_composition?.renderer || null,
    product_pixels_generated_by_ai: visual.authentic_product_composition?.product_pixels_generated_by_ai,
    product_packaging_editing_performed: visual.authentic_product_composition?.packaging_editing_performed,
    post_generation_logo_overlay_applied: false,
    logo_fallback_applied: false,
  };

  return {
    content_type: "single_image",
    cta_text: ctaText,
    primary_asset_url: output.public_url,
    asset_urls: [output.public_url],
    source_image_url: referenceUrl,
    source_image_checksum_sha256: referenceChecksum,
    source_image_mime_type: visual.reference_image_mime_type,
    source_image_dimensions: {
      width: visual.authentic_product_reference?.width || null,
      height: visual.authentic_product_reference?.height || null,
    },
    provider: imageResult.provider || visual.provider || "openai",
    model: imageResult.model || visual.model || settings.campaign_ai_model,
    quality: settings.campaign_ai_image_quality || "medium",
    final_prompt: finalPrompt,
    checksum_sha256: output.checksum_sha256,
    generated_at: generatedAt,
    prompt_type: promptType,
    image_copy: imageCopy,
    output_dimensions: { width: INSTAGRAM_CANVAS_WIDTH, height: INSTAGRAM_CANVAS_HEIGHT },
    brand_logo_contract: serializedBrandLogoContract,
    brand_logo_evidence: brandLogoEvidence,
    brand_logo_reference: visual.brand_logo_reference || null,
    provenance,
    provider_response_id: visual.response_id || null,
    paid_image_call_count: Number(imageResult.paid_image_call_count || visual.paid_image_call_count || 0),
    image_usage: imageResult.image_usage || visual.image_usage || null,
    validation_usage: imageResult.validation_usage || visual.validation_usage || null,
    usage: imageResult.usage || visual.usage || null,
    estimated_cost: Number(imageResult.estimated_cost || visual.estimated_cost || 0),
    cost_currency: imageResult.cost_currency || "USD",
    creative_json: {
      layout: "mandatory_ai_baked_logo_authentic_product_single_image",
      generation_mode: "ai_generated",
      composition_mode: "ai_branded_background_plus_authentic_product_composite",
      provider: imageResult.provider || visual.provider || "openai",
      model: imageResult.model || visual.model || settings.campaign_ai_model,
      quality: settings.campaign_ai_image_quality || "medium",
      source_image_url: referenceUrl,
      source_image_checksum_sha256: referenceChecksum,
      final_prompt: finalPrompt,
      prompt_type: promptType,
      image_copy: imageCopy,
      checksum_sha256: output.checksum_sha256,
      generated_at: generatedAt,
      brand_logo_contract: serializedBrandLogoContract,
      brand_logo_evidence: brandLogoEvidence,
      brand_logo_reference: visual.brand_logo_reference || null,
      provenance,
      provider_response_id: visual.response_id || null,
      paid_image_call_count: Number(imageResult.paid_image_call_count || visual.paid_image_call_count || 0),
      image_usage: imageResult.image_usage || visual.image_usage || null,
      validation_usage: imageResult.validation_usage || visual.validation_usage || null,
      usage: imageResult.usage || visual.usage || null,
      estimated_cost: Number(imageResult.estimated_cost || visual.estimated_cost || 0),
      cost_currency: imageResult.cost_currency || "USD",
      authentic_product_reference: visual.authentic_product_reference || null,
      authentic_product_composition: visual.authentic_product_composition || null,
      ai_background: visual.ai_background || null,
      slides: [{
        type: "single_image",
        url: output.public_url,
        prompt: finalPrompt,
        brand_logo_evidence: brandLogoEvidence,
        post_generation_logo_overlay_applied: false,
      }],
    },
  };
}

module.exports = {
  buildVariantPrompt,
  generateAiInstagramCreative,
  _private: {
    buildCreativePrompt,
    buildBrandedBackgroundPrompt,
    buildImageCopy,
    buildLegacyProductRecommendation,
    buildProductFacts,
    generationSizeForProvider,
    processOutputForInstagram,
    replaceLegacyPromptPlaceholders: replacePromptPlaceholders,
    replacePromptPlaceholders,
    resolveCreativePrompt,
    resolveReferenceUrl,
    socialImageSettings,
  },
};
