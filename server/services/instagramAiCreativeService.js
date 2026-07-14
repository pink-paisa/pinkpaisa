const fs = require("fs");
const path = require("path");
const axios = require("axios");
const MarketingAsset = require("../models/MarketingAsset");
const { createCampaignAssetVersion, storeCampaignAsset } = require("./campaignAssetStorage");
const { generateImage } = require("./imageProviders");

const DEFAULT_SERVER_URL = "http://localhost:5000";
const INSTAGRAM_CANVAS_WIDTH = 1080;
const INSTAGRAM_CANVAS_HEIGHT = 1350;

function getSharp() {
  try {
    return require("sharp");
  } catch (_error) {
    throw new Error('AI image generation requires the "sharp" package to process image outputs.');
  }
}

function trimText(value) {
  return String(value || "").trim();
}

function normalizeWhitespace(value) {
  return trimText(value).replace(/\s+/g, " ");
}

function toTitleCase(value) {
  return normalizeWhitespace(value)
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
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

function buildKeyBenefits(brief) {
  const tags = Array.isArray(brief?.tags)
    ? brief.tags.map((tag) => normalizeWhitespace(tag)).filter(Boolean)
    : [];

  if (tags.length) {
    return tags.slice(0, 4).join(", ");
  }

  const summary = normalizeWhitespace(brief?.descriptions?.short || brief?.descriptions?.full || "");
  if (summary) {
    return summary.slice(0, 180);
  }

  return "Premium quality, aesthetic appeal, and everyday use";
}

function buildBrandTone(brief) {
  const tones = Array.isArray(brief?.brand_context?.tone)
    ? brief.brand_context.tone.map((tone) => toTitleCase(tone)).filter(Boolean)
    : [];

  if (tones.length) {
    return tones.slice(0, 4).join(" / ");
  }

  return "Luxury / Premium / Minimal";
}

function buildHeadline(brief) {
  const category = toTitleCase(brief?.category || "");
  if (category) return `Elevate Your ${category} Ritual`;
  return `Discover ${trimText(brief?.title || "Pink Paisa Pick")}`;
}

function buildSubtext(brief, strategy) {
  const angle = normalizeWhitespace(strategy?.angle || "");
  if (angle) {
    return angle.charAt(0).toUpperCase() + angle.slice(1);
  }

  const category = normalizeWhitespace(brief?.category || "");
  if (category) {
    return `Premium ${category.toLowerCase()} designed for everyday delight.`;
  }

  return "Pure. Effective. Luxurious.";
}

function populatePromptTemplate(template, replacements) {
  return Object.entries(replacements).reduce((prompt, [token, value]) => {
    return prompt.split(token).join(value);
  }, template);
}

function wrapText(value, maxLength = 24, maxLines = 4) {
  const words = normalizeWhitespace(value).split(" ").filter(Boolean);
  if (!words.length) return [""];

  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (!current || candidate.length <= maxLength) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  return lines.slice(0, maxLines);
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function truncateText(value, maxLength = 120) {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return "";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(maxLength - 1, 1)).trim()}...`;
}

function buildOverlayBrand(brief) {
  const vendorName = trimText(brief?.vendor?.shop_name || brief?.vendor?.business_name || "");
  if (vendorName && !/^pink paisa$/i.test(vendorName) && !/^vendor$/i.test(vendorName)) {
    return vendorName;
  }

  return trimText(brief?.title || "Pink Paisa");
}

function buildOverlayCategory(brief) {
  const parts = [toTitleCase(brief?.category || ""), toTitleCase(brief?.subcategory || "")]
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index);
  return parts.join(" / ") || "Premium Product";
}

function buildOverlayHeadline(brief, strategy, variant) {
  if (variant === "detail") return "Why it deserves a spot in your routine.";
  if (variant === "closing") return "Make it your next signature pick.";

  const category = normalizeWhitespace(brief?.category || "");
  if (category) {
    return `Elevate your ${category.toLowerCase()} ritual.`;
  }

  const angle = truncateText(strategy?.angle || "", 48);
  if (angle) return angle;

  return "Elevate your everyday ritual.";
}

function buildOverlaySubtext(brief, strategy, variant) {
  if (variant === "closing") {
    return "Luxury presentation, polished pricing, and a clear call to action - ready for Instagram.";
  }

  const description = truncateText(brief?.descriptions?.short || brief?.descriptions?.full || "", 130);
  if (description) return description;

  const audience = truncateText(strategy?.audience || "", 110);
  if (audience) return `Crafted for ${audience.toLowerCase()}.`;

  return "A premium Pink Paisa pick designed to feel modern, polished, and high-conversion.";
}

function buildOverlayBenefits(brief) {
  const candidates = [];
  if (Array.isArray(brief?.tags)) {
    brief.tags.filter(Boolean).slice(0, 3).forEach((tag) => candidates.push(toTitleCase(tag)));
  }

  if (brief?.subcategory && String(brief.subcategory).toLowerCase() !== "uncategorized") {
    candidates.push(`${toTitleCase(brief.subcategory)} Focus`);
  }

  if (brief?.constraints?.returnable) {
    candidates.push(`Easy ${Number(brief.constraints.return_window_days || 7)} Day Returns`);
  }

  if (Number(brief?.constraints?.stock_quantity || 0) > 0 && Number(brief?.constraints?.stock_quantity || 0) <= 10) {
    candidates.push("Limited Stock");
  }

  const unique = candidates
    .map((value) => truncateText(value, 26))
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index);

  return unique.slice(0, 3);
}

function buildOverlayPriceSummary(brief) {
  if (brief?.is_affiliate || brief?.pricing?.available === false) {
    return {
      label: "Partner Pick",
      currentPrice: "Check price",
      previousPrice: null,
      savings: null,
    };
  }
  const price = Number(brief?.pricing?.price || 0);
  const salePrice = brief?.pricing?.sale_price == null ? null : Number(brief.pricing.sale_price);
  const hasDiscount = salePrice != null && salePrice > 0 && salePrice < price;

  if (hasDiscount) {
    return {
      label: "Special Price",
      currentPrice: formatPrice(salePrice),
      previousPrice: formatPrice(price),
      savings: `Save ${formatPrice(price - salePrice)}`,
    };
  }

  return {
    label: "Available Now",
    currentPrice: formatPrice(price),
    previousPrice: null,
    savings: null,
  };
}

function buildOverlayFooter(brief) {
  const slug = trimText(brief?.slug || "");
  if (slug) return `pinkpaisa.in/product/${slug}`;
  return "www.pinkpaisa.in";
}

function buildPromptTemplate({ brief, strategy, settings }) {
  const template = trimText(settings?.campaign_ai_prompt_template || "");
  const hasApprovedSourceImage = Boolean(brief?.campaign_asset?.approved && brief?.campaign_asset?.url);
  const resolvedTemplate = template || [
    hasApprovedSourceImage
      ? "Use the uploaded image of my product as the base."
      : "Create an original category-level editorial visual without copying product packaging or logos.",
    "",
    "Create a high-quality Instagram marketing creative for this product.",
    "",
    "Product details:",
    "- Product name: [Your Product Name]",
    "- Category: [e.g., Skincare / Perfume / Serum]",
    "- Target audience: [e.g., Men 20-35 / Women / Luxury buyers]",
    "- Key benefits: [e.g., Hydration, Glow, Anti-aging]",
    "- Brand tone: [Luxury / Minimal / Bold / Natural / Premium]",
    "",
    "Design requirements:",
    "- Keep the original product intact and realistic",
    "- Enhance lighting to make it premium and eye-catching",
    "- Add a clean, aesthetic background (suggest options if needed)",
    "- Include subtle props that match the product vibe (e.g., flowers, stones, water, fabric)",
    "- Add soft shadows and reflections for depth",
    "- Maintain a modern Instagram ad style",
    "- Keep the product as the hero on the left or center-left",
    "- Leave elegant negative space in the composition for a balanced premium look",
    "",
    "Style references:",
    "- Cinematic lighting",
    "- Soft gradients or neutral tones",
    "- Instagram luxury brand aesthetic",
    "- High contrast but elegant",
    "",
    "Output:",
    "- Portrait-friendly composition suitable for Instagram marketing",
    "- Ultra high resolution",
    "- Clean, minimal, premium look",
    "- No typography, no price stickers, no CTA button rendered directly inside the AI image",
  ].join("\n");

  return populatePromptTemplate(resolvedTemplate, {
    "[Your Product Name]": trimText(brief?.title || "Pink Paisa Product"),
    "[e.g., Skincare / Perfume / Serum]": [toTitleCase(brief?.category || ""), toTitleCase(brief?.subcategory || "")]
      .filter(Boolean)
      .join(" / ") || "Wellness / Premium Lifestyle",
    "[e.g., Men 20-35 / Women / Luxury buyers]": normalizeWhitespace(strategy?.audience || "Women / Premium lifestyle buyers"),
    "[e.g., Hydration, Glow, Anti-aging]": buildKeyBenefits(brief),
    "[Luxury / Minimal / Bold / Natural / Premium]": buildBrandTone(brief),
    '[e.g., "Elevate Your Skin Routine"]': buildHeadline(brief),
    '[e.g., "Pure. Effective. Luxurious."]': buildSubtext(brief, strategy),
    '[e.g., "Shop Now"]': trimText(strategy?.cta || (brief?.is_affiliate ? "Explore Partner Pick" : "Shop Now")),
  });
}

function getServerBaseUrl() {
  return String(
    process.env.PUBLIC_MEDIA_BASE_URL
    || process.env.SERVER_URL
    || DEFAULT_SERVER_URL
  ).replace(/\/+$/, "");
}

function resolvePublicUrl(value) {
  const raw = trimText(value);
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/")) return `${getServerBaseUrl()}${raw}`;
  return `${getServerBaseUrl()}/${raw.replace(/^\/+/, "")}`;
}

function resolveLocalPath(value) {
  const raw = trimText(value);
  if (!raw || /^https?:\/\//i.test(raw)) return null;
  const clean = raw.replace(/^\/+/, "");
  return path.join(__dirname, "..", clean);
}

async function readImageBuffer(source) {
  const localPath = resolveLocalPath(source);
  if (localPath && fs.existsSync(localPath)) {
    return fs.promises.readFile(localPath);
  }

  const publicUrl = resolvePublicUrl(source);
  if (!publicUrl) throw new Error("No image URL available for AI creative generation");

  const response = await axios.get(publicUrl, {
    responseType: "arraybuffer",
    timeout: 25000,
    maxContentLength: 30 * 1024 * 1024,
  });
  return Buffer.from(response.data);
}

function buildSharedPrompt({ brief, strategy, settings }) {
  const hasApprovedSourceImage = Boolean(brief?.campaign_asset?.approved && brief?.campaign_asset?.url);
  return [
    buildPromptTemplate({ brief, strategy, settings }),
    "",
    "Additional technical guardrails:",
    hasApprovedSourceImage
      ? "Use the rights-approved source image as the visual reference and preserve the actual product shape, material, proportions, and recognizable details."
      : "No product reference image is rights-approved. Create only a generic lifestyle scene for the product category; do not render, imitate, or invent branded packaging, labels, or logos.",
    hasApprovedSourceImage
      ? "Preserve the exact bottle silhouette, cap, nozzle, label layout, printed text, and branding from the approved source image."
      : "Keep the composition useful as a Pink Paisa editorial partner-pick background with clear negative space for the product title overlay.",
    hasApprovedSourceImage
      ? "Do not invent a new package design, rename the product, or rewrite the label."
      : "Do not imply that the generated scene is a photograph of the exact affiliate item.",
    "Return a clean premium marketing visual as a final raw image with no extra UI chrome, price stickers, or fake CTA buttons unless the prompt explicitly asks for them.",
    "Use realistic premium ecommerce photography with tasteful props only.",
    "Avoid warped packaging, duplicated products, cropped labels, extra hands, collage layouts, watermarks, or broken anatomy.",
    "Keep the final composition clean and premium enough for Instagram marketing use.",
  ].filter(Boolean).join("\n");
}

function buildVariantPrompt({ variant, brief, strategy, settings }) {
  const shared = buildSharedPrompt({ brief, strategy, settings });
  const priceAvailable = brief?.pricing?.available !== false && Number(brief?.pricing?.price || 0) > 0;
  const offerLine = brief?.is_affiliate || !priceAvailable
    ? "Do not show or mention a numeric price, discount, sale, availability claim, or price sticker."
    : brief?.pricing?.sale_price != null && Number(brief.pricing.sale_price) < Number(brief.pricing.price)
    ? `Highlight that the product feels giftable and premium while supporting a sale offer from ${formatPrice(brief.pricing.price)} down to ${formatPrice(brief.pricing.sale_price)}.`
    : `Present the product as a premium discovery item available at ${formatPrice(brief.pricing.price)}.`;

  if (variant === "hero") {
    return `${shared} Compose a hero shot on a soft blush or neutral luxury surface with editorial natural light, balanced shadows, and a polished women-first wellness aesthetic. ${offerLine}`;
  }

  if (variant === "detail") {
    return `${shared} Create a more intimate editorial detail shot with subtle spa or vanity styling, tactile materials, and a premium self-care mood. Keep the product prominent and highly legible.`;
  }

  return `${shared} Create a closing purchase-intent image with a clean aspirational setup, elegant depth, and open space suited for a final CTA overlay. Make it feel premium, warm, and conversion-ready.`;
}

async function processOutputForInstagram({ buffer }) {
  const sharp = getSharp();
  return sharp(buffer)
    .rotate()
    .resize(INSTAGRAM_CANVAS_WIDTH, INSTAGRAM_CANVAS_HEIGHT, {
      fit: "cover",
      position: "attention",
      withoutEnlargement: false,
    })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
}

async function writeOutput({ run, brief, settings, fileName, buffer }) {
  const stored = await storeCampaignAsset({ fileName, buffer });
  const sourceAsset = brief?.campaign_asset || {};
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
        source_url: sourceAsset.approved ? sourceAsset.url : null,
        source_provenance: sourceAsset.approved
          ? "generated_from_approved_source"
          : "generated_without_reference",
        usage_rights_status: sourceAsset.rights_status || "unknown",
        provider: settings.campaign_ai_provider,
        model: settings.campaign_ai_model,
        deleted_at: null,
      },
    },
    { upsert: true, new: true }
  );
  return { file_path: stored.file_path || null, public_url: stored.url };
}

async function generateVariantBuffer({ variant, brief, strategy, settings, productBuffer }) {
  const prompt = buildVariantPrompt({ variant, brief, strategy, settings });
  const rawBuffer = await generateImage({
    provider: settings.campaign_ai_provider,
    model: settings.campaign_ai_model,
    prompt,
    sourceImageBuffer: productBuffer,
    quality: settings.campaign_ai_image_quality || "medium",
  });

  const processedBuffer = await processOutputForInstagram({
    buffer: rawBuffer,
  });
  return { prompt, processedBuffer };
}

async function generateAiInstagramCreative({ run, brief, strategy, settings }) {
  const contentType = strategy?.recommended_content_type === "carousel" ? "carousel" : "single_image";
  const assetVersion = createCampaignAssetVersion();
  const primaryImage = brief?.campaign_asset?.approved
    ? brief.campaign_asset.url
    : (!brief?.is_affiliate && Array.isArray(brief?.images) ? brief.images.find(Boolean) : null);

  const productBuffer = primaryImage ? await readImageBuffer(primaryImage) : null;
  const variants = contentType === "carousel"
    ? ["hero", "detail", "closing"]
    : ["hero"];

  const generated = [];
  for (const variant of variants) {
    generated.push(await generateVariantBuffer({
      variant,
      brief,
      strategy,
      settings,
      productBuffer,
    }));
  }

  const outputs = [];
  for (let index = 0; index < generated.length; index += 1) {
    const variant = variants[index];
    const fileName = contentType === "carousel"
      ? `${slugify(run.campaign_id)}-${assetVersion}-ai-carousel-${index + 1}.jpg`
      : `${slugify(run.campaign_id)}-${assetVersion}-ai-hero.jpg`;
    outputs.push(await writeOutput({
      run,
      brief,
      settings,
      fileName,
      buffer: generated[index].processedBuffer,
    }));
  }

  return {
    content_type: contentType,
    cta_text: strategy?.cta || (brief?.is_affiliate ? "Explore Partner Pick" : "Shop Now"),
    primary_asset_url: outputs[0].public_url,
    asset_urls: outputs.map((item) => item.public_url),
    creative_json: {
      layout: contentType === "carousel" ? "ai_generated_carousel" : "ai_generated_single_image",
      generation_mode: "ai_generated",
      composition_mode: "raw_ai_output",
      generated_by: settings.campaign_ai_provider,
      provider: settings.campaign_ai_provider,
      model: settings.campaign_ai_model,
      quality: settings.campaign_ai_image_quality || "medium",
      headline: trimText(brief?.title || "Pink Paisa Pick"),
      supporting_line: strategy?.angle || null,
      cta_text: strategy?.cta || (brief?.is_affiliate ? "Explore Partner Pick" : "Shop Now"),
      slides: outputs.map((item, index) => ({
        type: variants[index],
        url: item.public_url,
        prompt: generated[index].prompt,
      })),
      generated_at: new Date().toISOString(),
    },
  };
}

module.exports = {
  buildVariantPrompt,
  generateAiInstagramCreative,
};
