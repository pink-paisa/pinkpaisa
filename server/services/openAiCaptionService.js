const DEFAULT_OPENAI_API_BASE = "https://api.openai.com/v1";
const DEFAULT_CAPTION_MODEL = "gpt-5.6-luna";
const MAX_CAPTION_LENGTH = 1400;
const MAX_HASHTAGS = 8;
const MAX_HASHTAG_LENGTH = 40;

const AFFILIATE_PROHIBITED_PATTERNS = [
  { code: "affiliate_numeric_price", pattern: /(?:\u20b9|\$|\b(?:rs\.?|inr|usd)\s*)\d|\b(?:price(?:d)?|costs?|only|just)\s*(?:is|at|from)?\s*\d{2,}/i },
  { code: "affiliate_discount_claim", pattern: /\b\d+(?:\.\d+)?\s*%|\b(?:discount|coupon|sale|deal price)\b/i },
  { code: "affiliate_availability_claim", pattern: /\b(?:available|availability|in stock|out of stock|limited stock)\b/i },
  { code: "affiliate_delivery_claim", pattern: /\b(?:delivery|delivers?|shipping|ships?)\b/i },
  { code: "affiliate_purchase_cta", pattern: /\b(?:buy now|shop now|order now|purchase now|add to cart)\b/i },
  { code: "affiliate_seller_implication", pattern: /\b(?:buy|order|shop|get)(?:\s+\w+){0,4}\s+(?:from|at|on)\s+pink paisa\b|\bpink paisa\s+(?:sells|stocks|ships|delivers|manufactures|offers)\b|\bwe\s+(?:sell|stock|ship|deliver|manufacture|offer)\b|\bour product\b/i },
];

function trimText(value) {
  return String(value || "").trim();
}

function normalizeStringList(value, limit = 8) {
  const values = Array.isArray(value) ? value : [];
  return values.map((item) => trimText(item)).filter(Boolean).slice(0, limit);
}

function normalizeHashtag(value) {
  const normalized = trimText(value).replace(/^#+/, "").replace(/[^a-zA-Z0-9_]/g, "");
  return normalized ? `#${normalized}` : null;
}

function normalizeHashtagForCompliance(value) {
  return trimText(value)
    .replace(/^#+/, "")
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function buildCaptionContext(brief = {}) {
  return {
    product_name: trimText(brief.title),
    brand: trimText(brief.brand_name || brief.brand_context?.product_brand || brief.vendor?.shop_name),
    category: trimText(brief.category),
    subcategory: trimText(brief.subcategory),
    short_description: trimText(brief.descriptions?.short),
    full_description: trimText(brief.descriptions?.full),
    tags: normalizeStringList(brief.tags, 12),
    pros: normalizeStringList(brief.pros, 8),
    buying_intent: trimText(brief.buying_intent),
    audience: trimText(brief.audience),
    is_affiliate: Boolean(brief.is_affiliate),
    affiliate_source_label: trimText(brief.affiliate?.source_label || brief.affiliate_source_platform),
    price_available: brief.pricing?.available === true,
    destination: "Pink Paisa product page",
  };
}

function buildCaptionRequest({ brief = {}, creative = {}, model = DEFAULT_CAPTION_MODEL }) {
  const context = buildCaptionContext(brief);
  const systemPrompt = [
    "You write one polished Instagram caption package for Pink Paisa.",
    "Use only the supplied product facts. Do not invent claims, certifications, ratings, results, ingredients, audiences, or product variants.",
    "Keep the caption concise, credible, editorial, and suitable for a reviewed organic Instagram post.",
    "Return one caption, one short CTA, and no more than eight relevant hashtags.",
    context.is_affiliate
      ? "This is an affiliate discovery item. Do not state or imply that Pink Paisa manufactures, stocks, sells, ships, or delivers it. Do not mention a price, discount, coupon, availability, or delivery promise. Use partner-pick language."
      : "This is a Pink Paisa catalog product. Avoid unsupported performance or medical claims.",
    "Do not include an affiliate disclosure; the server appends the required disclosure deterministically.",
    "Do not include a URL in the caption or CTA; the server appends the tracked destination.",
  ].join("\n");

  return {
    model: trimText(model) || DEFAULT_CAPTION_MODEL,
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: systemPrompt }],
      },
      {
        role: "user",
        content: [{
          type: "input_text",
          text: JSON.stringify({
            task: "Create the final Instagram caption package for this generated product creative.",
            product: context,
            creative: {
              content_type: "single_image",
              image_prompt: trimText(creative.final_prompt || creative.creative_json?.final_prompt),
            },
          }),
        }],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "pinkpaisa_instagram_caption",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["caption", "hashtags", "cta"],
          properties: {
            caption: { type: "string", minLength: 1, maxLength: MAX_CAPTION_LENGTH },
            hashtags: {
              type: "array",
              maxItems: MAX_HASHTAGS,
              items: { type: "string", minLength: 1, maxLength: MAX_HASHTAG_LENGTH },
            },
            cta: { type: "string", minLength: 1, maxLength: 120 },
          },
        },
      },
    },
  };
}

function extractResponseText(payload = {}) {
  if (trimText(payload.output_text)) return trimText(payload.output_text);
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (trimText(part?.text)) return trimText(part.text);
    }
  }
  return "";
}

function validateCaptionPackage(value, { isAffiliate = false, enforceGeneratedLimits = true } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("OpenAI caption response was not a JSON object");
  }

  const caption = trimText(value.caption);
  const cta = trimText(value.cta);
  if (!Array.isArray(value.hashtags)) throw new Error("OpenAI caption response is missing the hashtags array");
  if (value.hashtags.length > MAX_HASHTAGS) throw new Error("OpenAI caption response exceeded the eight-hashtag limit");
  const hashtags = [];
  for (const valueHashtag of value.hashtags) {
    const hashtag = normalizeHashtag(valueHashtag);
    if (!hashtag || hashtags.includes(hashtag)) continue;
    if (hashtag.length > MAX_HASHTAG_LENGTH) {
      throw new Error(`OpenAI caption response exceeded the ${MAX_HASHTAG_LENGTH}-character hashtag limit`);
    }
    hashtags.push(hashtag);
  }

  if (!caption || !cta) throw new Error("OpenAI caption response is missing caption or CTA text");
  if ((enforceGeneratedLimits && caption.length > MAX_CAPTION_LENGTH) || cta.length > 120) {
    throw new Error("OpenAI caption response exceeded the allowed length");
  }

  if (isAffiliate) {
    const combined = [caption, cta, ...hashtags.map(normalizeHashtagForCompliance)].join("\n");
    const violation = AFFILIATE_PROHIBITED_PATTERNS.find(({ pattern }) => pattern.test(combined));
    if (violation) {
      const error = new Error(`OpenAI caption response violated affiliate rule: ${violation.code}`);
      error.code = violation.code;
      throw error;
    }
  }

  return { caption, hashtags, cta };
}

function parseCaptionResponse(payload, options = {}) {
  const responseText = extractResponseText(payload);
  if (!responseText) throw new Error("OpenAI Responses API did not return caption text");

  let parsed;
  try {
    parsed = JSON.parse(responseText);
  } catch (error) {
    throw new Error(`OpenAI caption response was not valid JSON: ${error.message}`);
  }
  return validateCaptionPackage(parsed, options);
}

async function generateCampaignCaption({ brief, creative }) {
  const apiKey = trimText(process.env.OPENAI_API_KEY);
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for AI caption generation");

  const model = trimText(process.env.OPENAI_CAPTION_MODEL) || DEFAULT_CAPTION_MODEL;
  const baseUrl = trimText(process.env.OPENAI_API_BASE_URL || DEFAULT_OPENAI_API_BASE).replace(/\/+$/, "");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const response = await fetch(`${baseUrl}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildCaptionRequest({ brief, creative, model })),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error?.message || payload?.message || "OpenAI caption generation failed");
    }

    return {
      ...parseCaptionResponse(payload, { isAffiliate: Boolean(brief?.is_affiliate) }),
      provider: "openai",
      model,
      generated_at: new Date().toISOString(),
    };
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("OpenAI caption generation timed out");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  generateCampaignCaption,
  normalizeHashtagForCompliance,
  validateCaptionPackage,
  _private: {
    AFFILIATE_PROHIBITED_PATTERNS,
    buildCaptionContext,
    buildCaptionRequest,
    extractResponseText,
    normalizeHashtag,
    normalizeHashtagForCompliance,
    parseCaptionResponse,
    validateCaptionPackage,
  },
};
