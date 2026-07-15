const AdminSettings = require("../models/AdminSettings");
const {
  getDefaultModelId,
  getDefaultProviderKey,
  normaliseImageProviderSelection,
} = require("../services/imageProviders");

const CAMPAIGN_SETTINGS_KEY = "campaigns";

const DEFAULT_AFFILIATE_CAMPAIGN_AI_PROMPT_TEMPLATE = `Create a premium 4:5 Instagram editorial advertisement for an affiliate product curated by Pink Paisa.

Use the uploaded product image as the rights-approved primary reference.

PRODUCT INPUTS

Product name: [PRODUCT_NAME]
Brand: [BRAND_NAME]
Product category: [CATEGORY]
Product type: [PRODUCT_TYPE]
Target audience: [TARGET_AUDIENCE]
Brand tone: [BRAND_TONE]
Primary accent colour: [ACCENT_COLOUR]
Approved eyebrow: "[EYEBROW]"
Approved headline: "[HEADLINE]"
Approved supporting line: "[SUPPORTING_LINE]"
Approved CTA: "[IMAGE_CTA]"

OBJECTIVE

Produce a polished, credible, scroll-stopping editorial advertisement that presents the supplied product as an affiliate discovery item selected by Pink Paisa.

The advertisement must feel premium, modern, warm, women-first, and professionally art-directed.

DYNAMIC VISUAL DIRECTION

First analyse the supplied product image and identify:

- Product category
- Product shape and proportions
- Packaging or construction
- Dominant colours
- Materials and textures
- Branding and label placement
- Appropriate usage context
- Suitable editorial environment
- Suitable props, lighting, surface, and accent colour

Dynamically build the scene according to the detected product category.

For skincare, serum, moisturiser, or cosmetic products:
Use clean studio lighting, soft reflections, subtle water, gel, cream, botanical, glass, stone, or ingredient-inspired elements only when visually appropriate. Do not use these elements to communicate unsupported performance claims.

For perfume:
Use elegant reflective surfaces, glass, soft fabric, restrained florals, light refraction, subtle mist, or architectural shadows. Keep the bottle and label completely accurate.

For fashion or apparel:
Present the exact garment naturally on a suitable model, mannequin, hanger, or premium editorial arrangement. Preserve the garment's colour, neckline, sleeves, panels, seams, fit, fabric appearance, prints, and construction. Do not redesign the clothing.

For jewellery:
Preserve the exact jewellery design, stone arrangement, metal colour, proportions, setting style, and visible details. Use refined luxury lighting and tasteful jewellery-display surfaces. Do not add or remove stones.

For bags, footwear, or accessories:
Preserve the exact silhouette, colour, stitching, hardware, straps, closures, materials, and branding. Use a premium fashion-editorial setting.

For electronics:
Use a clean contemporary environment with controlled reflections and subtle geometric elements. Preserve the exact device shape, display, buttons, ports, controls, materials, colours, and branding.

For home and lifestyle products:
Use a premium, realistic interior or tabletop setting appropriate to the product's actual purpose. Keep the product as the visual priority.

Do not add category-inappropriate props.

PRODUCT PRESERVATION

Preserve the supplied product exactly.

Maintain the exact:

- Shape
- Dimensions and proportions
- Colour
- Material
- Surface texture
- Packaging
- Lid, cap, pump, handle, strap, hardware, or closure
- Label layout
- Logo placement
- Typography visible on the product
- Graphic elements
- Recognisable construction details
- Product variant

Do not redesign the product.

Do not rewrite, regenerate, translate, simplify, replace, or reposition the original product label.

Do not invent a different size, colour, fragrance, formula, model, flavour, pattern, or product variant.

Do not add fictional branding, logos, labels, ingredients, features, or accessories.

Keep the product fully visible unless a minor editorial crop is necessary and does not remove important product details.

Make all important labels and branding as accurate and readable as the supplied reference permits.

When the source image includes a person wearing the product, use the image only as a product-reference source unless the person is intentionally required in the final design. Preserve the product accurately without unnecessarily duplicating the reference person.

When no approved product image is supplied, create only a category-level lifestyle visual. Do not invent or imitate an exact branded product, trademark, logo, label, or packaging design.

COMPOSITION

Create a portrait 4:5 Instagram composition.

Position the product on the left, centre-left, or lower-left according to its shape.

Use the right side or the cleanest area of negative space for the marketing copy.

The product must remain the primary visual subject.

Use:

- Realistic ecommerce lighting
- Natural depth
- Soft directional shadows
- Premium surface reflections
- Subtle depth of field
- Tasteful category-relevant props
- Warm neutral background tones
- Restrained blush-pink accents
- Charcoal or deep neutral typography
- One accent colour derived from the product or category

Match the scene's accent colour to the product without changing the product itself.

Do not place text over the product, label, face, jewellery, garment details, controls, or other important elements.

Keep all text within safe Instagram margins.

ON-IMAGE TEXT

Render only the following marketing elements:

Eyebrow:
"[EYEBROW]"

Main headline:
"[HEADLINE]"

Supporting line:
"[SUPPORTING_LINE]"

CTA:
"[IMAGE_CTA]"

Render all supplied text exactly as written.

Do not change the spelling, punctuation, capitalisation, or wording.

The main headline must be the strongest visual element.

Keep the supporting line concise and clearly readable.

Use a small and tasteful CTA treatment near the lower-right or lower-centre area.

TYPOGRAPHY

Use elegant, high-contrast editorial typography.

Use a premium editorial serif typeface for the main headline.

Use a refined modern sans-serif typeface for:

- Eyebrow
- Supporting line
- CTA

Create a clear visual hierarchy:

1. Main headline
2. Product
3. Supporting line
4. Eyebrow
5. CTA

Ensure the text is readable at Instagram mobile-feed size.

Do not use excessive tracking, distorted letters, decorative scripts, or difficult-to-read typography.

AFFILIATE RULES

This is an affiliate discovery item.

Pink Paisa does not manufacture, stock, sell, pack, deliver, or ship the product.

Do not imply that Pink Paisa is the manufacturer, official brand owner, marketplace, retailer, or seller.

The CTA must use affiliate-appropriate wording such as:

- "View Partner Pick"
- "Explore Partner Pick"

Never use:

- "Buy Now"
- "Order Now"
- "Shop Now"
- "Add to Cart"
- "Get Yours"
- Any wording suggesting that Pink Paisa directly sells the product

Do not include an affiliate notice inside the image. The notice will be included separately in the Instagram caption.

STRICT CONTENT RESTRICTIONS

Do not display or invent:

- Prices
- Discounts
- Coupons
- Sale percentages
- Promotional codes
- Availability
- Stock status
- Delivery dates
- Shipping claims
- Marketplace logos
- Amazon logos
- Marketplace badges
- Ratings
- Reviews
- Review counts
- Awards
- Certifications
- URLs
- QR codes
- Social-media handles
- Unsupported ingredients
- Unsupported product features
- Medical claims
- Treatment claims
- Guaranteed results
- Clinically proven claims
- Before-and-after results
- Performance statistics
- Additional slogans
- Extra marketing copy
- Affiliate notice
- Watermarks

Do not show duplicated products unless multiple units are present in the approved source and intentionally required.

QUALITY CONTROL

Avoid:

- Distorted packaging
- Incorrect branding
- Misspelled labels
- Altered logos
- Invented text
- Cropped labels
- Warped products
- Incorrect colours
- Duplicated objects
- Floating products without natural shadows
- Excessive water splashes
- Excessive decorative elements
- Cluttered layouts
- Collages
- Malformed hands
- Incorrect anatomy
- Unnatural garment construction
- Incorrect jewellery stones
- Artificial reflections
- Low-resolution textures
- Blurry product labels
- Marketplace-style price stickers
- Discount badges
- Watermarks

FINAL OUTPUT

- Portrait 4:5 Instagram advertisement
- 1080 x 1350 pixels
- High resolution
- Photorealistic
- Premium editorial quality
- Mobile-feed readable
- Accurate product reproduction
- Clean negative space
- Balanced visual hierarchy
- Modern and credible affiliate-advertising composition
- Include only the approved eyebrow, headline, supporting line, and CTA outside the original product packaging`;

const DEFAULT_CATALOG_CAMPAIGN_AI_PROMPT_TEMPLATE = `Create a premium 4:5 Instagram editorial advertisement for a Pink Paisa catalog product.

Use the uploaded product image as the authoritative primary reference.

PRODUCT INPUTS

Product name: [PRODUCT_NAME]
Brand: [BRAND_NAME]
Product category: [CATEGORY]
Product type: [PRODUCT_TYPE]
Target audience: [TARGET_AUDIENCE]
Brand tone: [BRAND_TONE]
Primary accent colour: [ACCENT_COLOUR]
Approved eyebrow: "[EYEBROW]"
Approved headline: "[HEADLINE]"
Approved supporting line: "[SUPPORTING_LINE]"
Approved CTA: "[IMAGE_CTA]"

OBJECTIVE

Create a polished, credible, scroll-stopping product advertisement for the Pink Paisa catalog. Preserve the supplied product exactly and make it the visual hero.

PRODUCT PRESERVATION

Maintain the exact product shape, proportions, colour, material, packaging, closures, label layout, logos, product typography, graphic elements, and variant. Do not redesign the product, rewrite labels, invent features, duplicate the item, or add another variant.

Modify only the background, lighting, shadows, reflections, depth, and restrained category-relevant props. Use a realistic premium ecommerce setting appropriate to [CATEGORY] and [PRODUCT_TYPE].

ON-IMAGE TEXT

Render only these supplied marketing elements exactly as written:

Eyebrow: "[EYEBROW]"
Headline: "[HEADLINE]"
Supporting line: "[SUPPORTING_LINE]"
CTA: "[IMAGE_CTA]"

Do not invent additional typography, prices, discounts, badges, URLs, claims, slogans, ratings, reviews, marketplace logos, certifications, or watermarks.

FINAL OUTPUT

- Portrait 4:5 Instagram advertisement
- 1080 x 1350 pixels
- High-resolution and photorealistic
- Accurate product reproduction
- Clean negative space and mobile-feed readability
- Include only the supplied eyebrow, headline, supporting line, and CTA outside the original product packaging`;

// Compatibility alias for existing imports and persisted settings.
const DEFAULT_CAMPAIGN_AI_PROMPT_TEMPLATE = DEFAULT_AFFILIATE_CAMPAIGN_AI_PROMPT_TEMPLATE;

const DEFAULT_CAMPAIGN_SETTINGS = {
  campaign_mode: "manual",
  campaign_batch_hour_ist: 9,
  campaign_batch_minute_ist: 0,
  campaign_creative_mode: "ai_generated",
  campaign_ai_provider: getDefaultProviderKey(),
  campaign_ai_model: getDefaultModelId(getDefaultProviderKey()),
  campaign_ai_image_quality: "medium",
  campaign_ai_prompt_template: DEFAULT_AFFILIATE_CAMPAIGN_AI_PROMPT_TEMPLATE,
  campaign_ai_affiliate_prompt_template: DEFAULT_AFFILIATE_CAMPAIGN_AI_PROMPT_TEMPLATE,
  campaign_ai_catalog_prompt_template: DEFAULT_CATALOG_CAMPAIGN_AI_PROMPT_TEMPLATE,
};

function normalizePrompt(value) {
  return String(value || "").trim();
}

function isAffiliatePrompt(value) {
  return /affiliate|partner\s+pick|pink paisa does not (?:manufacture|sell|ship)/i.test(normalizePrompt(value));
}

function normaliseCampaignSettings(settings = {}) {
  const selection = normaliseImageProviderSelection(
    settings.campaign_ai_provider || DEFAULT_CAMPAIGN_SETTINGS.campaign_ai_provider,
    settings.campaign_ai_model || DEFAULT_CAMPAIGN_SETTINGS.campaign_ai_model,
  );

  const legacyPrompt = normalizePrompt(settings.campaign_ai_prompt_template);
  const affiliatePrompt = normalizePrompt(settings.campaign_ai_affiliate_prompt_template)
    || (isAffiliatePrompt(legacyPrompt) ? legacyPrompt : "")
    || DEFAULT_AFFILIATE_CAMPAIGN_AI_PROMPT_TEMPLATE;
  const catalogPrompt = normalizePrompt(settings.campaign_ai_catalog_prompt_template)
    || (legacyPrompt && !isAffiliatePrompt(legacyPrompt) ? legacyPrompt : "")
    || DEFAULT_CATALOG_CAMPAIGN_AI_PROMPT_TEMPLATE;

  return {
    campaign_mode: settings.campaign_mode === "automatic" ? "automatic" : DEFAULT_CAMPAIGN_SETTINGS.campaign_mode,
    campaign_batch_hour_ist: Number.isFinite(Number(settings.campaign_batch_hour_ist))
      ? Math.min(Math.max(Number(settings.campaign_batch_hour_ist), 0), 23)
      : DEFAULT_CAMPAIGN_SETTINGS.campaign_batch_hour_ist,
    campaign_batch_minute_ist: Number.isFinite(Number(settings.campaign_batch_minute_ist))
      ? Math.min(Math.max(Number(settings.campaign_batch_minute_ist), 0), 59)
      : DEFAULT_CAMPAIGN_SETTINGS.campaign_batch_minute_ist,
    campaign_creative_mode: "ai_generated",
    campaign_ai_provider: selection.provider,
    campaign_ai_model: selection.model,
    campaign_ai_image_quality: ["low", "medium", "high"].includes(String(settings.campaign_ai_image_quality || "").trim())
      ? String(settings.campaign_ai_image_quality).trim()
      : DEFAULT_CAMPAIGN_SETTINGS.campaign_ai_image_quality,
    campaign_ai_prompt_template: affiliatePrompt,
    campaign_ai_affiliate_prompt_template: affiliatePrompt,
    campaign_ai_catalog_prompt_template: catalogPrompt,
    prompt_defaults: {
      affiliate: DEFAULT_AFFILIATE_CAMPAIGN_AI_PROMPT_TEMPLATE,
      catalog: DEFAULT_CATALOG_CAMPAIGN_AI_PROMPT_TEMPLATE,
    },
  };
}

function campaignSettingsPersistence(settings = {}) {
  const { prompt_defaults, ...persisted } = normaliseCampaignSettings(settings);
  return persisted;
}

async function getCampaignSettings() {
  const settings = await AdminSettings.findOne({ key: CAMPAIGN_SETTINGS_KEY }).lean();
  return normaliseCampaignSettings(settings || {});
}

module.exports = {
  CAMPAIGN_SETTINGS_KEY,
  DEFAULT_AFFILIATE_CAMPAIGN_AI_PROMPT_TEMPLATE,
  DEFAULT_CAMPAIGN_AI_PROMPT_TEMPLATE,
  DEFAULT_CATALOG_CAMPAIGN_AI_PROMPT_TEMPLATE,
  DEFAULT_CAMPAIGN_SETTINGS,
  campaignSettingsPersistence,
  getCampaignSettings,
  normaliseCampaignSettings,
};
