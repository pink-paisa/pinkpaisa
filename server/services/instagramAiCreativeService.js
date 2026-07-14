const crypto = require("crypto");
const MarketingAsset = require("../models/MarketingAsset");
const { createCampaignAssetVersion, storeCampaignAsset } = require("./campaignAssetStorage");
const { readAndNormalizeReferenceImage } = require("./campaignReferenceImage");
const { generateImage } = require("./imageProviders");
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

async function writeOutput({ run, brief, settings, fileName, buffer, sourceUrl }) {
  const stored = await storeCampaignAsset({ fileName, buffer });
  const sourceAsset = brief.campaign_asset || {};
  await MarketingAsset.findOneAndUpdate(
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
        source_provenance: sourceAsset.provenance || "product_reference",
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

async function generateAiInstagramCreative({ run, brief, settings }) {
  const referenceUrl = resolveReferenceUrl(brief);
  const reference = await readAndNormalizeReferenceImage(referenceUrl);
  const { prompt, promptType, imageCopy } = resolveCreativePrompt({ brief, settings });
  const generatedAt = new Date().toISOString();
  const rawBuffer = await generateImage({
    provider: settings.campaign_ai_provider,
    model: settings.campaign_ai_model,
    prompt,
    sourceImageBuffer: reference.buffer,
    size: generationSizeForProvider(settings.campaign_ai_provider, settings.campaign_ai_model),
    quality: settings.campaign_ai_image_quality || "medium",
  });
  const processedBuffer = await processOutputForInstagram(rawBuffer);
  const assetVersion = createCampaignAssetVersion();
  const output = await writeOutput({
    run,
    brief,
    settings,
    fileName: `${slugify(run.campaign_id)}-${assetVersion}-ai-single.jpg`,
    buffer: processedBuffer,
    sourceUrl: reference.source_url,
  });
  const ctaText = brief.is_affiliate ? "View partner pick" : "Explore product";
  const referenceChecksum = crypto.createHash("sha256").update(reference.buffer).digest("hex");

  return {
    content_type: "single_image",
    cta_text: ctaText,
    primary_asset_url: output.public_url,
    asset_urls: [output.public_url],
    source_image_url: reference.source_url,
    source_image_checksum_sha256: referenceChecksum,
    source_image_mime_type: reference.mime_type,
    source_image_dimensions: { width: reference.width, height: reference.height },
    provider: settings.campaign_ai_provider,
    model: settings.campaign_ai_model,
    quality: settings.campaign_ai_image_quality || "medium",
    final_prompt: prompt,
    checksum_sha256: output.checksum_sha256,
    generated_at: generatedAt,
    prompt_type: promptType,
    image_copy: imageCopy,
    output_dimensions: { width: INSTAGRAM_CANVAS_WIDTH, height: INSTAGRAM_CANVAS_HEIGHT },
    creative_json: {
      layout: "required_reference_single_image",
      generation_mode: "ai_generated",
      composition_mode: "reference_image_edit",
      provider: settings.campaign_ai_provider,
      model: settings.campaign_ai_model,
      quality: settings.campaign_ai_image_quality || "medium",
      source_image_url: reference.source_url,
      source_image_checksum_sha256: referenceChecksum,
      final_prompt: prompt,
      prompt_type: promptType,
      image_copy: imageCopy,
      checksum_sha256: output.checksum_sha256,
      generated_at: generatedAt,
      slides: [{ type: "single_image", url: output.public_url, prompt }],
    },
  };
}

module.exports = {
  buildVariantPrompt,
  generateAiInstagramCreative,
  _private: {
    buildCreativePrompt,
    buildImageCopy,
    buildProductFacts,
    generationSizeForProvider,
    processOutputForInstagram,
    replaceLegacyPromptPlaceholders: replacePromptPlaceholders,
    replacePromptPlaceholders,
    resolveCreativePrompt,
    resolveReferenceUrl,
  },
};
