const crypto = require("crypto");
const OpenAI = require("openai");
const sharp = require("sharp");
const {
  createCampaignAssetVersion,
  deleteCampaignAsset,
  storeCampaignAsset,
} = require("../campaignAssetStorage");
const {
  compositeAuthenticProduct,
  readAuthenticProductReference,
  resolveVerifiedProductRecord,
} = require("./socialProductCreativeService");
const {
  resolvePinkPaisaArtDirection,
  serializePinkPaisaArtDirection,
} = require("./socialArtDirection");
const { assertSocialVisualModeEligible } = require("./socialVisualPolicy");

const DEFAULT_IMAGE_MODEL = "gpt-image-2";
const DEFAULT_TIMEOUT_MS = 180000;
const MAX_SUPPLIED_IMAGE_BYTES = 25 * 1024 * 1024;
const TRANSIENT_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const FEED_FORMATS = new Set([
  "SINGLE_IMAGE",
  "CAROUSEL",
  "INFOGRAPHIC",
  "MEME",
  "POLL",
  "QUIZ",
  "PRODUCT_FEATURE",
  "RESOURCE_PROMOTION",
  "EVENT_OR_WORKSHOP_PROMOTION",
]);

function trimText(value) {
  return String(value || "").trim();
}

function safeIssueText(value) {
  const issues = Array.isArray(value) ? value.map(trimText).filter(Boolean) : [];
  return issues.join("; ").slice(0, 800) || "the approved headline was missing, misspelled, distorted, or accompanied by unapproved text";
}

function stringList(value) {
  return Array.isArray(value) ? value.map(trimText).filter(Boolean) : [];
}

function slugify(value) {
  return trimText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) || "social-visual";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getImageModel(settings = {}) {
  return trimText(
    settings.models?.image_model
    || settings.image_model
    || process.env.OPENAI_SOCIAL_IMAGE_MODEL
    || process.env.SOCIAL_MANAGER_IMAGE_MODEL
  ) || DEFAULT_IMAGE_MODEL;
}

function imageSizeFor(format, model) {
  const normalizedFormat = trimText(format).toUpperCase();
  const normalizedModel = trimText(model).toLowerCase();
  if (normalizedModel === "gpt-image-2") {
    return ["STORY", "REEL", "VIDEO_FEED"].includes(normalizedFormat) ? "1088x1920" : "1088x1360";
  }
  if (["STORY", "REEL", "VIDEO_FEED"].includes(normalizedFormat)) return "1024x1536";
  return FEED_FORMATS.has(normalizedFormat) ? "1024x1536" : "1024x1024";
}

function expectedOutputDimensions(format) {
  return ["STORY", "REEL", "VIDEO_FEED"].includes(trimText(format).toUpperCase())
    ? { width: 1080, height: 1920, aspect_ratio: "9:16" }
    : { width: 1080, height: 1350, aspect_ratio: "4:5" };
}

function getContentPackage(recommendation = {}) {
  return recommendation.formatContent
    || recommendation.format_content
    || recommendation.contentPackage
    || recommendation.content_package
    || null;
}

function visualRows(recommendation = {}) {
  const brief = recommendation.visualBrief || recommendation.visual_brief || recommendation.aiVisualBrief || {};
  const rows = brief.visuals || brief.assets || brief.frames || brief.slides;
  return Array.isArray(rows) ? rows : [];
}

function approvedHeadlineForSequence(recommendation = {}, sequence = 1) {
  const content = getContentPackage(recommendation) || {};
  const format = trimText(recommendation.format).toUpperCase();
  if (format === "CAROUSEL") return trimText(content.slides?.[sequence - 1]?.headline);
  if (format === "STORY") return trimText(content.frames?.[sequence - 1]?.copy);
  if (["REEL", "VIDEO_FEED"].includes(format)) return sequence === 1
    ? trimText(content.coverHeadline)
    : trimText(content.scenes?.[sequence - 2]?.onScreenText);
  return trimText(content.selectedHeadline || recommendation.onPostCopy?.headline);
}

function approvedSupportingTextForSequence(recommendation = {}, sequence = 1) {
  const content = getContentPackage(recommendation) || {};
  const format = trimText(recommendation.format).toUpperCase();
  if (format === "CAROUSEL") return trimText(content.slides?.[sequence - 1]?.body);
  if (["REEL", "VIDEO_FEED", "STORY"].includes(format)) return "";
  const supportingText = trimText(content.supportingText || content.supporting_text
    || content.supportingCopy || content.supporting_copy
    || recommendation.onPostCopy?.supportingCopy
    || recommendation.on_post_copy?.supporting_copy);
  const interactionCopy = trimText(content.interactionCopy || content.interaction_copy
    || recommendation.onPostCopy?.interactionCopy
    || recommendation.on_post_copy?.interaction_copy);
  return [supportingText, interactionCopy].filter(Boolean).join("\n");
}

function fullAiGraphicTextBlocksForSequence(recommendation = {}, sequence = 1, total = 1) {
  const format = trimText(recommendation.format).toUpperCase();
  const headline = approvedHeadlineForSequence(recommendation, sequence);
  const supportingText = approvedSupportingTextForSequence(recommendation, sequence);
  if (!headline || headline.length > 80 || headline.split(/\s+/).length > 12) {
    const error = new Error("FULL_AI_GRAPHIC requires one approved headline of at most 80 characters and 12 words for every generated graphic");
    error.code = "social_full_ai_graphic_copy_too_long";
    throw error;
  }
  if (supportingText.length > 160) {
    const error = new Error("FULL_AI_GRAPHIC supporting text must not exceed 160 characters");
    error.code = "social_full_ai_graphic_copy_too_long";
    throw error;
  }
  return normalizeExpectedTextBlocks([
    { key: "brand_name", text: "Pink Paisa" },
    { key: "headline", text: headline },
    ...(supportingText ? [{ key: "supporting_text", text: supportingText }] : []),
    ...(format === "CAROUSEL" && Number(total) > 1
      ? [{ key: "sequence_label", text: `${sequence}/${total}` }]
      : []),
  ]);
}

function promptFromRow(row = {}) {
  return trimText(row.imagePrompt || row.image_prompt || row.prompt || row.generationPrompt || row.generation_prompt);
}

function reelStoryboardFrameLimit() {
  const configured = Number(process.env.SOCIAL_REEL_GENERATED_FRAME_LIMIT || 6);
  return Math.min(Math.max(Number.isFinite(configured) ? Math.floor(configured) : 6, 1), 19);
}

function visualRequestsForRecommendation(recommendation = {}) {
  const format = trimText(recommendation.format).toUpperCase();
  const briefRows = visualRows(recommendation);
  const content = getContentPackage(recommendation) || {};
  const directContent = trimText(content.format) ? content : null;
  const reel = directContent || content.reel || recommendation.reel;

  // The structured visual brief intentionally supplies the Reel cover direction,
  // while the approved Reel package owns the shot-by-shot scene plan. Expand the
  // latter into distinct generated storyboard frames instead of treating a Reel
  // as a one-image post (or rejecting cover + scenes as a count mismatch).
  if (["REEL", "VIDEO_FEED"].includes(format) && Array.isArray(reel?.scenes) && reel.scenes.length) {
    const coverBrief = briefRows[0] || {};
    const maximumStoryboardFrames = reelStoryboardFrameLimit();
    const basePrompt = promptFromRow(coverBrief)
      || trimText(reel.coverImagePrompt || reel.cover_image_prompt || recommendation.imageGenerationPrompt);
    return [
      {
        sequence: 1,
        prompt: basePrompt,
        overlay_instructions: coverBrief.overlayInstructions
          || coverBrief.overlay_instructions
          || reel.overlayInstructions
          || reel.overlay_instructions
          || null,
        required_objects: stringList(coverBrief.requiredObjects || coverBrief.required_objects),
        prohibited_objects: stringList(coverBrief.prohibitedObjects || coverBrief.prohibited_objects),
        asset_purpose: format === "REEL" ? "REEL_COVER" : "VIDEO_FEED_COVER",
        scene_index: null,
      },
      ...reel.scenes.slice(0, maximumStoryboardFrames).map((scene, index) => ({
        sequence: index + 2,
        prompt: [
          basePrompt,
          `Storyboard scene ${index + 1}: ${trimText(scene.visualInstruction || scene.visual_instruction)}`,
        ].filter(Boolean).join("\n"),
        overlay_instructions: trimText(scene.onScreenText || scene.on_screen_text) || null,
        required_objects: [],
        prohibited_objects: stringList(coverBrief.prohibitedObjects || coverBrief.prohibited_objects),
        asset_purpose: format === "REEL" ? "REEL_STORYBOARD_FRAME" : "VIDEO_FEED_STORYBOARD_FRAME",
        scene_index: index,
      })),
    ];
  }
  if (briefRows.length) {
    return briefRows.map((row, index) => ({
      sequence: Number(row.sequence || row.slideNumber || row.slide_number || row.frameNumber || row.frame_number || index + 1),
      prompt: promptFromRow(row),
      overlay_instructions: row.overlayInstructions || row.overlay_instructions || null,
      required_objects: stringList(row.requiredObjects || row.required_objects),
      prohibited_objects: stringList(row.prohibitedObjects || row.prohibited_objects),
      asset_purpose: trimText(row.role || row.assetPurpose || row.asset_purpose).toUpperCase() || null,
    }));
  }

  const carousel = (Array.isArray(content.slides) ? content : null) || content.carousel || recommendation.carousel;
  if (format === "CAROUSEL" && Array.isArray(carousel?.slides)) {
    return carousel.slides.map((slide, index) => ({
      sequence: Number(slide.slideNumber || slide.slide_number || index + 1),
      prompt: promptFromRow(slide) || trimText(recommendation.imageGenerationPrompt),
      overlay_instructions: slide.overlayInstructions || slide.overlay_instructions || null,
      required_objects: [],
      prohibited_objects: [],
    }));
  }
  const story = (Array.isArray(content.frames) ? content : null) || content.story || recommendation.story;
  if (format === "STORY" && Array.isArray(story?.frames)) {
    return story.frames.map((frame, index) => ({
      sequence: Number(frame.frameNumber || frame.frame_number || index + 1),
      prompt: promptFromRow(frame) || trimText(recommendation.imageGenerationPrompt),
      overlay_instructions: frame.overlayInstructions || frame.overlay_instructions || null,
      required_objects: [],
      prohibited_objects: [],
    }));
  }

  const single = directContent || content.singleImage || content.single_image || recommendation.singleImage || recommendation.single_image;
  const staticVisual = directContent || content.staticVisual || content.static_visual || recommendation.staticVisual || recommendation.static_visual;
  const product = directContent || content.productPost || content.product_post || recommendation.productPost || recommendation.product_post;
  return [{
    sequence: 1,
    prompt: promptFromRow(single || staticVisual || product || reel || {}) || trimText(recommendation.imageGenerationPrompt),
    overlay_instructions: (single || staticVisual || product || reel || {}).overlayInstructions
      || (single || staticVisual || product || reel || {}).overlay_instructions
      || null,
    required_objects: [],
    prohibited_objects: [],
  }];
}

function buildProductionImagePrompt({ recommendation = {}, request = {}, sequence = 1, total = 1, visualMode = "AI_VISUAL_WITH_EXACT_OVERLAY" }) {
  const creativePrompt = trimText(request.prompt);
  if (!creativePrompt) {
    const error = new Error(`AI visual brief is missing an image prompt for visual ${sequence}`);
    error.code = "social_image_prompt_missing";
    throw error;
  }
  const format = trimText(recommendation.format).toUpperCase();
  const productFacts = recommendation.verifiedProductFacts || recommendation.verified_product_facts || null;
  const formatContent = getContentPackage(recommendation) || {};
  const prohibitedObjects = [...new Set([
    ...stringList(request.prohibited_objects),
    ...stringList(formatContent.negativeVisualInstructions || formatContent.negative_visual_instructions),
  ])].filter((value) => visualMode !== "FULL_AI_GRAPHIC"
    || !/\b(?:no\s+)?visible\s+text\b|\bno\s+(?:text|letters|numbers|currency\s+symbols)\b/i.test(value));
  const exactOverlayMode = visualMode === "AI_VISUAL_WITH_EXACT_OVERLAY";
  const artworkOnlyMode = visualMode === "AI_ARTWORK_ONLY";
  const artDirection = resolvePinkPaisaArtDirection(recommendation, request.art_direction || request.artDirection);
  const fullAiTextBlocks = visualMode === "FULL_AI_GRAPHIC"
    ? fullAiGraphicTextBlocksForSequence(recommendation, sequence, total)
    : [];
  const requiredObjects = productFacts
    ? stringList(request.required_objects).filter((value) => !/\b(product|package|packaging|bottle|box|journal|container)\b/i.test(value))
    : stringList(request.required_objects);
  const technicalDirection = [
    `Instagram format: ${format || "SINGLE_IMAGE"}; visual ${sequence} of ${total}.`,
    `Approved art direction: ${artDirection.id} — ${artDirection.label}.`,
    artDirection.prompt,
    "Create original Pink Paisa artwork that is premium, women-first, sophisticated, modern, confident, culturally relevant and Instagram-native.",
    "Do not use a stock-like office or desk vignette built around a laptop, coffee cup, notebook and plant. Avoid generic bank advertisements, corporate stock photography and empty decorative finance banners.",
    "Specify a coherent subject, setting, composition, camera angle, lighting, background, mood, culturally appropriate styling, required objects and an uncluttered mobile-first focal hierarchy.",
    exactOverlayMode
      ? (format === "STORY"
        ? "Integrate intentional high-contrast text-safe space inside safe margins for exact Story copy, required first-frame affiliate disclosure, final-frame CTA/general disclaimer, and the Pink Paisa logo. The safe space must belong to the selected editorial composition rather than appearing as a blank or floating card. Render no text, letters, numbers, currency symbols or logos in the generated artwork."
        : "Integrate intentional high-contrast text-safe space for an exact headline/supporting-copy overlay and Pink Paisa logo. The safe space must be part of the selected editorial grid or collage composition rather than a blank area or floating card. CTA and disclosures will be assembled once in the Instagram caption. Render no text, letters, numbers, currency symbols or logos in the generated artwork.")
      : artworkOnlyMode
        ? "Create full-bleed artwork with a natural mobile-first focal hierarchy. Do not reserve a text-safe area. Render absolutely no visible text, letters, numbers, currency symbols, logo, wordmark, watermark, badge, label, brand name, or other branding."
        : [
          "Create the complete finished Pink Paisa poster inside the generated image. There will be no post-generation text, logo, SVG, background, brand treatment, or other pixel overlay.",
          `Render every approved visible-text block exactly once, with exact spelling and punctuation, and render no other visible text: ${JSON.stringify(fullAiTextBlocks)}.`,
          "Treat Pink Paisa as intentional baked-in brand identity. Make every text block comfortably legible on mobile and keep it inside safe margins. CTA, affiliate disclosure, financial disclaimer and hashtags belong only in the Instagram caption and must not appear in the image unless explicitly listed above.",
        ].join(" "),
    "No watermark, unrelated visible logo, competitor branding, fake app interface, fake financial statement, unsupported claim, price, rating, review count, discount, stock message or guaranteed outcome.",
    requiredObjects.length
      ? `Required background objects: ${requiredObjects.join("; ")}.`
      : null,
    prohibitedObjects.length
      ? `Additional prohibited elements: ${prohibitedObjects.join("; ")}.`
      : null,
    format === "CAROUSEL"
      ? `This slide must use a materially different subject, setting, or action and composition from every other slide while retaining the approved cohesive art direction. Slide identity: ${sequence} of ${total}.`
      : null,
    productFacts
      ? "BACKGROUND ONLY: do not render, depict, imitate, redraw, retouch or include any product, product-like object, package, label, bottle, box, book, container or branded merchandise. Generate only the empty surrounding setting, lighting and supporting environment, with clear placement space on the right. The verified database product will be placed exactly once later by guarded local code; OpenAI must never receive or transform its pixels."
      : null,
    productFacts && stringList(formatContent.productPreservationInstructions || formatContent.product_preservation_instructions).length
      ? "Local composition will preserve the verified product's packaging, label, colour, proportions, variant and quantity; do not attempt any part of that work in the generated background."
      : null,
  ].filter(Boolean).join("\n");
  const promptHeading = productFacts
    ? `Use this AI-authored brief only as environmental art direction; ignore any phrase asking you to show the supplied product: ${creativePrompt}`
    : creativePrompt;
  return `${promptHeading}\n\nProduction constraints (hard requirements):\n${technicalDirection}`.slice(0, 12000);
}

function parseStructuredText(response = {}, errorCode = "social_full_ai_graphic_validation_invalid") {
  const text = trimText(response.output_text)
    || trimText(response.output?.flatMap?.((item) => item.content || []).find?.((item) => item.type === "output_text")?.text);
  try {
    return JSON.parse(text);
  } catch (cause) {
    const error = new Error("OpenAI visual text validation returned invalid structured output");
    error.code = errorCode;
    error.cause = cause;
    throw error;
  }
}

async function validateFullAiGraphicText({ buffer, approvedHeadline, settings = {}, dependencies = {} }) {
  const validator = dependencies.validateFullAiGraphicText;
  if (typeof validator === "function") return validator({ buffer, approvedHeadline, settings, dependencies });
  const client = createOpenAiClient(dependencies);
  if (!client.responses?.create) {
    const error = new Error("The configured OpenAI client cannot validate FULL_AI_GRAPHIC text");
    error.code = "social_full_ai_graphic_validator_unavailable";
    throw error;
  }
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["decision", "exactHeadlineMatch", "observedText", "issues"],
    properties: {
      decision: { type: "string", enum: ["PASS", "REGENERATE"] },
      exactHeadlineMatch: { type: "boolean" },
      observedText: { type: ["string", "null"] },
      issues: { type: "array", items: { type: "string" }, maxItems: 10 },
    },
  };
  const response = await client.responses.create({
    model: trimText(settings.models?.compliance_model || settings.models?.text_model || settings.compliance_model || settings.text_model) || "gpt-5.6-luna",
    store: false,
    input: [{
      role: "user",
      content: [
        {
          type: "input_text",
          text: `Inspect this generated social graphic. The only approved visible text is ${JSON.stringify(approvedHeadline)}. Return PASS only when that headline is rendered exactly, legibly, without misspelling or distortion, and no other unapproved words, numbers, logos, or watermarks are visible.`,
        },
        { type: "input_image", image_url: `data:image/jpeg;base64,${buffer.toString("base64")}` },
      ],
    }],
    text: {
      format: {
        type: "json_schema",
        name: "pinkpaisa_full_ai_graphic_text_validation_v2",
        strict: true,
        schema,
      },
    },
  });
  return { ...parseStructuredText(response), response_id: responseId(response), usage: responseUsage(response) };
}

async function validateArtworkOnlyVisual({ buffer, settings = {}, dependencies = {} }) {
  const validator = dependencies.validateArtworkOnlyVisual;
  if (typeof validator === "function") return validator({ buffer, settings, dependencies });
  const client = createOpenAiClient(dependencies);
  if (!client.responses?.create) {
    const error = new Error("The configured OpenAI client cannot validate AI_ARTWORK_ONLY visuals");
    error.code = "social_artwork_only_validator_unavailable";
    throw error;
  }
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["decision", "hasVisibleText", "hasLogoOrWatermark", "observedText", "issues"],
    properties: {
      decision: { type: "string", enum: ["PASS", "REGENERATE"] },
      hasVisibleText: { type: "boolean" },
      hasLogoOrWatermark: { type: "boolean" },
      observedText: { type: ["string", "null"] },
      issues: { type: "array", items: { type: "string" }, maxItems: 10 },
    },
  };
  const response = await client.responses.create({
    model: trimText(settings.models?.compliance_model || settings.models?.text_model || settings.compliance_model || settings.text_model) || "gpt-5.6-luna",
    store: false,
    input: [{
      role: "user",
      content: [
        {
          type: "input_text",
          text: "Inspect this artwork independently. Return PASS only when there is zero visible or implied text, letters, numbers, currency symbols, logos, wordmarks, watermarks, badges, labels, or brand marks anywhere in the image. Treat tiny, distorted, background, packaging, and decorative text as visible text.",
        },
        { type: "input_image", image_url: `data:image/jpeg;base64,${buffer.toString("base64")}` },
      ],
    }],
    text: {
      format: {
        type: "json_schema",
        name: "pinkpaisa_artwork_only_visual_validation_v1",
        strict: true,
        schema,
      },
    },
  });
  return {
    ...parseStructuredText(response, "social_artwork_only_validation_invalid"),
    response_id: responseId(response),
    usage: responseUsage(response),
  };
}

function normalizeExpectedTextBlocks(value) {
  if (!Array.isArray(value) || !value.length) {
    const error = new Error("A FULL_AI_GRAPHIC poster requires at least one exact visible-text block");
    error.code = "social_full_ai_graphic_text_contract_invalid";
    throw error;
  }
  const blocks = value.map((block, index) => ({
    key: trimText(block?.key || `text_${index + 1}`).slice(0, 80),
    text: trimText(block?.text),
  }));
  if (blocks.some((block) => !block.key || !block.text || block.text.length > 500)) {
    const error = new Error("Every FULL_AI_GRAPHIC visible-text block requires a key and exact text of at most 500 characters");
    error.code = "social_full_ai_graphic_text_contract_invalid";
    throw error;
  }
  if (new Set(blocks.map((block) => block.key)).size !== blocks.length) {
    const error = new Error("FULL_AI_GRAPHIC visible-text block keys must be unique");
    error.code = "social_full_ai_graphic_text_contract_invalid";
    throw error;
  }
  return blocks;
}

function fullAiGraphicPosterValidationPassed(validation = {}, expectedTextBlocks = []) {
  let blocks;
  try {
    blocks = normalizeExpectedTextBlocks(expectedTextBlocks);
  } catch (_error) {
    return false;
  }
  const observed = Array.isArray(validation.observedTextBlocks)
    ? validation.observedTextBlocks
    : Array.isArray(validation.observed_text_blocks) ? validation.observed_text_blocks : [];
  return String(validation.decision || "").toUpperCase() === "PASS"
    && validation.exactTextMatch === true
    && validation.brandIdentityMatch === true
    && validation.mobileLegible === true
    && validation.safeAreaPassed === true
    && validation.unapprovedTextPresent === false
    && validation.unrelatedLogoOrWatermarkPresent === false
    && JSON.stringify(observed.map(trimText)) === JSON.stringify(blocks.map((block) => block.text))
    && Boolean(trimText(validation.response_id || validation.responseId));
}

async function validateFullAiGraphicPoster({ buffer, expectedTextBlocks, settings = {}, dependencies = {} }) {
  const blocks = normalizeExpectedTextBlocks(expectedTextBlocks);
  const validator = dependencies.validateFullAiGraphicPoster;
  if (typeof validator === "function") {
    return validator({ buffer, expectedTextBlocks: blocks, settings, dependencies });
  }
  const client = createOpenAiClient(dependencies);
  if (!client.responses?.create) {
    const error = new Error("The configured OpenAI client cannot validate a fully AI-rendered poster");
    error.code = "social_full_ai_graphic_validator_unavailable";
    throw error;
  }
  const schema = {
    type: "object",
    additionalProperties: false,
    required: [
      "decision",
      "exactTextMatch",
      "brandIdentityMatch",
      "mobileLegible",
      "safeAreaPassed",
      "unapprovedTextPresent",
      "unrelatedLogoOrWatermarkPresent",
      "observedTextBlocks",
      "issues",
    ],
    properties: {
      decision: { type: "string", enum: ["PASS", "REGENERATE"] },
      exactTextMatch: { type: "boolean" },
      brandIdentityMatch: { type: "boolean" },
      mobileLegible: { type: "boolean" },
      safeAreaPassed: { type: "boolean" },
      unapprovedTextPresent: { type: "boolean" },
      unrelatedLogoOrWatermarkPresent: { type: "boolean" },
      observedTextBlocks: {
        type: "array",
        items: { type: "string" },
        minItems: blocks.length,
        maxItems: blocks.length,
      },
      issues: { type: "array", items: { type: "string" }, maxItems: 10 },
    },
  };
  let inputMimeType = "image/jpeg";
  try {
    const metadata = await sharp(buffer, { failOn: "error", limitInputPixels: 40_000_000 }).metadata();
    if (metadata.format === "png") inputMimeType = "image/png";
    if (metadata.format === "webp") inputMimeType = "image/webp";
  } catch (cause) {
    const error = new Error(`The normalized FULL_AI_GRAPHIC could not be inspected before validation: ${cause.message}`);
    error.code = "social_full_ai_graphic_validator_input_invalid";
    error.cause = cause;
    throw error;
  }
  const response = await client.responses.create({
    model: trimText(settings.models?.compliance_model || settings.models?.text_model || settings.compliance_model || settings.text_model) || "gpt-5.6-luna",
    store: false,
    input: [{
      role: "user",
      content: [
        {
          type: "input_text",
          text: [
            "Inspect this fully AI-rendered Pink Paisa social poster after Instagram normalization.",
            `The complete ordered list of approved visible text blocks is: ${JSON.stringify(blocks)}.`,
            "Return PASS only when every block appears exactly once with exact spelling and punctuation, in the supplied order; the Pink Paisa brand text is clear and intentional; all text is comfortably legible on mobile and inside safe margins; no additional words, letters, numbers, competitor logos, unrelated logos, or watermarks are visible.",
            "Do not treat decorative non-letter shapes as text. Record the visible blocks in observedTextBlocks using the exact order above.",
          ].join("\n"),
        },
        { type: "input_image", image_url: `data:${inputMimeType};base64,${buffer.toString("base64")}` },
      ],
    }],
    text: {
      format: {
        type: "json_schema",
        name: "pinkpaisa_full_ai_graphic_poster_validation_v1",
        strict: true,
        schema,
      },
    },
  });
  return { ...parseStructuredText(response), response_id: responseId(response), usage: responseUsage(response) };
}

function responseId(response = {}) {
  return trimText(response.id || response._request_id || response.request_id) || null;
}

function responseUsage(response = {}) {
  const usage = response.usage || {};
  return {
    input_tokens: Number(usage.input_tokens || usage.inputTokens || 0),
    output_tokens: Number(usage.output_tokens || usage.outputTokens || 0),
    total_tokens: Number(usage.total_tokens || usage.totalTokens || 0),
  };
}

function decodeImageResponse(response = {}) {
  const first = Array.isArray(response.data) ? response.data[0] : null;
  const base64 = trimText(first?.b64_json || first?.b64Json);
  if (!base64) {
    const error = new Error("OpenAI Image API did not return base64 image data");
    error.code = "social_image_response_invalid";
    throw error;
  }
  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length) {
    const error = new Error("OpenAI Image API returned an empty image");
    error.code = "social_image_response_invalid";
    throw error;
  }
  return buffer;
}

function createOpenAiClient(dependencies = {}) {
  if (dependencies.openaiClient) return dependencies.openaiClient;
  const apiKey = trimText(process.env.OPENAI_API_KEY);
  if (!apiKey) {
    const error = new Error("OPENAI_API_KEY is required for fully AI-generated social visuals");
    error.code = "social_ai_not_configured";
    throw error;
  }
  return new OpenAI({
    apiKey,
    baseURL: trimText(process.env.OPENAI_API_BASE_URL) || undefined,
    timeout: Math.max(Number(process.env.SOCIAL_MANAGER_IMAGE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS), 30000),
    maxRetries: 0,
  });
}

async function callOpenAiImage({ model, prompt, size, quality, dependencies = {} }) {
  const client = createOpenAiClient(dependencies);
  const parameters = {
    model,
    prompt,
    size,
    quality: trimText(quality || "medium").toLowerCase(),
    output_format: "jpeg",
    output_compression: 92,
    n: 1,
  };
  // Authentic product pixels are deliberately never sent to a generative image
  // endpoint. Product creatives request an empty AI background here and place
  // the verified database image later with a guarded Sharp composite.
  const response = await client.images.generate(parameters);
  return {
    buffer: decodeImageResponse(response),
    response_id: responseId(response),
    usage: responseUsage(response),
  };
}

function isRetriableImageError(error) {
  const status = Number(error?.status || error?.response?.status || 0);
  if (TRANSIENT_STATUS_CODES.has(status)) return true;
  if ([400, 401, 403, 404, 422].includes(status)) return false;
  if (["moderation_blocked", "content_policy_violation", "invalid_api_key"].includes(error?.code)) return false;
  return true;
}

async function validateAndNormalizeOriginal(buffer, format, { resizeFit = "cover", autoRotate = true } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 1024) {
    const error = new Error("Generated social visual is empty or too small");
    error.code = "social_image_validation_failed";
    throw error;
  }
  const expected = expectedOutputDimensions(format);
  try {
    const providerMetadata = await sharp(buffer, { failOn: "error", limitInputPixels: 40_000_000 }).metadata();
    const providerFormat = trimText(providerMetadata.format).toLowerCase();
    if (!providerMetadata.width || !providerMetadata.height || !["jpeg", "png", "webp"].includes(providerFormat)) {
      throw new Error("provider output must be a supported JPEG, PNG, or WebP image");
    }
    if (!["cover", "fill"].includes(resizeFit)) throw new Error("unsupported normalization resize fit");
    let normalizationPipeline = sharp(buffer, { failOn: "error", limitInputPixels: 40_000_000 });
    if (autoRotate) normalizationPipeline = normalizationPipeline.rotate();
    const normalized = await normalizationPipeline
      .resize(expected.width, expected.height, resizeFit === "fill"
        ? { fit: "fill" }
        : { fit: "cover", position: "attention" })
      .jpeg({ quality: 94, chromaSubsampling: "4:4:4", mozjpeg: true })
      .toBuffer();
    const metadata = await sharp(normalized).metadata();
    if (metadata.width !== expected.width || metadata.height !== expected.height) {
      throw new Error("normalized dimensions do not match the Instagram canvas");
    }
    return {
      buffer: normalized,
      ...expected,
      provider_original: {
        width: Number(providerMetadata.width),
        height: Number(providerMetadata.height),
        format: providerFormat,
        mime_type: providerFormat === "jpeg" ? "image/jpeg" : `image/${providerFormat}`,
        file_size_bytes: buffer.length,
      },
    };
  } catch (cause) {
    const error = new Error(`Generated social visual could not be validated: ${cause.message}`);
    error.code = "social_image_validation_failed";
    error.cause = cause;
    throw error;
  }
}

async function computePerceptualHash64(buffer) {
  const { data, info } = await sharp(buffer, { failOn: "error", limitInputPixels: 40_000_000 })
    .rotate()
    .greyscale()
    .resize(9, 8, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width !== 9 || info.height !== 8 || data.length < 72) {
    const error = new Error("Could not compute the 64-bit perceptual hash for the generated visual");
    error.code = "social_image_validation_failed";
    throw error;
  }
  let hash = 0n;
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      hash <<= 1n;
      if (data[(y * 9) + x] > data[(y * 9) + x + 1]) hash |= 1n;
    }
  }
  return hash.toString(16).padStart(16, "0");
}

function perceptualHashHammingDistance(left, right) {
  if (!/^[a-f0-9]{16}$/i.test(String(left || "")) || !/^[a-f0-9]{16}$/i.test(String(right || ""))) return null;
  let value = BigInt(`0x${left}`) ^ BigInt(`0x${right}`);
  let distance = 0;
  while (value) {
    distance += Number(value & 1n);
    value >>= 1n;
  }
  return distance;
}

function verifiedProductReference(recommendation = {}) {
  const facts = recommendation.verifiedProductFacts || recommendation.verified_product_facts || {};
  const content = getContentPackage(recommendation) || {};
  const brief = recommendation.visualBrief || recommendation.visual_brief || {};
  const authenticReference = brief.authenticProductReference || brief.authentic_product_reference || {};
  const urls = [
    facts.mediaUrl,
    facts.media_url,
    facts.imageUrl,
    facts.image_url,
    content.verifiedProductImageUrl,
    content.verified_product_image_url,
    authenticReference.imageUrl,
    authenticReference.image_url,
  ].map(trimText).filter(Boolean);
  const ids = [
    recommendation.verifiedProductId,
    recommendation.verified_product_id,
    facts.id,
    facts._id,
    content.verifiedProductId,
    content.verified_product_id,
    authenticReference.productId,
    authenticReference.product_id,
  ].map(trimText).filter(Boolean);
  const titles = [
    recommendation.verifiedProductTitle,
    recommendation.verified_product_title,
    facts.title,
    content.verifiedProductTitle,
    content.verified_product_title,
    authenticReference.productTitle,
    authenticReference.product_title,
  ].map(trimText).filter(Boolean);
  if (new Set(urls).size > 1 || new Set(ids).size > 1 || new Set(titles).size > 1) {
    const error = new Error("Verified product identifiers, title, and authentic image reference must remain unchanged across strategy, copy, and visual brief");
    error.code = "social_product_reference_mismatch";
    throw error;
  }
  return {
    id: ids[0] || null,
    title: titles[0] || null,
    url: urls[0] || null,
  };
}

function verifiedProductReferenceUrl(recommendation = {}) {
  return verifiedProductReference(recommendation).url;
}

function requiresPromptRevision(error) {
  const status = Number(error?.status || error?.response?.status || 0);
  const code = trimText(error?.code).toLowerCase();
  const type = trimText(error?.type || error?.error?.type).toLowerCase();
  return [400, 422].includes(status)
    || type === "image_generation_user_error"
    || [
      "moderation_blocked",
      "content_policy_violation",
      "social_image_response_invalid",
      "social_image_validation_failed",
      "social_full_ai_graphic_text_invalid",
      "social_full_ai_graphic_poster_invalid",
      "social_artwork_only_visual_invalid",
      "social_carousel_original_duplicate",
      "social_carousel_original_near_duplicate",
    ].includes(code);
}

function sumUsage(rows = []) {
  return rows.reduce((total, row) => ({
    input_tokens: total.input_tokens + Number(row.usage?.input_tokens || 0),
    output_tokens: total.output_tokens + Number(row.usage?.output_tokens || 0),
    total_tokens: total.total_tokens + Number(row.usage?.total_tokens || 0),
  }), { input_tokens: 0, output_tokens: 0, total_tokens: 0 });
}

function estimatedImageCost(count) {
  const perImage = Math.max(Number(process.env.SOCIAL_MANAGER_OPENAI_IMAGE_USD_PER_IMAGE || 0), 0);
  return Number((count * perImage).toFixed(6));
}

async function storeValidatedBuffer({ fileName, buffer, dependencies = {}, errorCode = "social_original_asset_storage_invalid" }) {
  const stored = await (dependencies.storeCampaignAsset || storeCampaignAsset)({ fileName, buffer });
  if (!trimText(stored?.url) || !trimText(stored?.storage_key)) {
    const error = new Error("Guarded social asset storage did not return a URL and storage key");
    error.code = errorCode;
    throw error;
  }
  const storageProvider = trimText(stored.storage_provider || "local").toLowerCase();
  if (!["local", "external"].includes(storageProvider)) {
    const error = new Error("Guarded social asset storage returned an unsupported provider");
    error.code = errorCode;
    throw error;
  }
  const checksum = crypto.createHash("sha256").update(buffer).digest("hex");
  const storedChecksum = trimText(stored.checksum_sha256).toLowerCase();
  if (/^[a-f0-9]{64}$/.test(storedChecksum) && storedChecksum !== checksum) {
    const error = new Error("Guarded social asset storage checksum does not match the supplied bytes");
    error.code = errorCode;
    throw error;
  }
  return {
    ...stored,
    storage_provider: storageProvider,
    checksum_sha256: checksum,
  };
}

async function cleanupStagedFullAiGraphic(stagedFiles = [], dependencies = {}) {
  const remove = dependencies.deleteCampaignAsset || deleteCampaignAsset;
  const unique = [];
  const seen = new Set();
  for (const file of [...stagedFiles].reverse()) {
    const storageKey = trimText(file?.storage_key || file?.storageKey);
    if (!storageKey || seen.has(storageKey)) continue;
    seen.add(storageKey);
    unique.push({
      storage_provider: trimText(file?.storage_provider || file?.storageProvider || "local").toLowerCase(),
      storage_key: storageKey,
    });
  }
  const failures = [];
  for (const file of unique) {
    try {
      await remove(file);
    } catch (error) {
      failures.push({ storage_key: file.storage_key, code: error?.code || null, message: trimText(error?.message).slice(0, 500) });
    }
  }
  return { attempted: unique.length, failed: failures.length, failures };
}

async function stageSuppliedFullAiGraphic({
  sourceBuffer,
  format,
  draftIdentity,
  model,
  prompt,
  providerResponseId,
  providerRequestId = null,
  generationTool = null,
  toolExecutionId = null,
  sourceProvenance = "generated_without_reference",
  referenceLineage = null,
  expectedTextBlocks,
  settings = {},
  generationUsage = {},
  estimatedCost = 0,
  costCurrency = "USD",
  dependencies = {},
} = {}) {
  if (!Buffer.isBuffer(sourceBuffer) || sourceBuffer.length < 1024) {
    const error = new Error("A non-empty AI-rendered source image buffer is required");
    error.code = "social_full_ai_graphic_source_invalid";
    error.statusCode = 400;
    throw error;
  }
  if (sourceBuffer.length > MAX_SUPPLIED_IMAGE_BYTES) {
    const error = new Error("The supplied AI-rendered source image exceeds 25 MB");
    error.code = "social_full_ai_graphic_source_too_large";
    error.statusCode = 413;
    throw error;
  }
  const normalizedGenerationTool = trimText(generationTool).toLowerCase();
  const normalizedToolExecutionId = trimText(toolExecutionId);
  const normalizedSourceProvenance = trimText(sourceProvenance).toLowerCase();
  if (!["generated_without_reference", "generated_from_approved_source"].includes(normalizedSourceProvenance)) {
    const error = new Error("Supplied FULL_AI_GRAPHIC source provenance must be generated_without_reference or generated_from_approved_source");
    error.code = "social_original_ai_provenance_invalid";
    error.statusCode = 400;
    throw error;
  }
  let normalizedReferenceLineage = null;
  if (referenceLineage != null) {
    try {
      const serialized = JSON.stringify(referenceLineage);
      if (Buffer.byteLength(serialized, "utf8") > 20_000) throw new Error("reference lineage exceeds 20 KB");
      normalizedReferenceLineage = JSON.parse(serialized);
    } catch (cause) {
      const error = new Error(`Supplied FULL_AI_GRAPHIC reference lineage is invalid: ${cause.message}`);
      error.code = "social_original_ai_provenance_invalid";
      error.statusCode = 400;
      throw error;
    }
  }
  const normalizedModel = trimText(model) || (normalizedGenerationTool === "codex_builtin_imagegen"
    ? "openai-imagegen-builtin-unspecified"
    : "");
  const normalizedPrompt = trimText(prompt);
  const responseIdentifier = trimText(providerResponseId);
  const builtInExecution = normalizedGenerationTool === "codex_builtin_imagegen" && normalizedToolExecutionId;
  if (!normalizedModel || !normalizedPrompt || (!responseIdentifier && !builtInExecution)) {
    const error = new Error("The supplied AI-rendered source requires its prompt and either an OpenAI provider response identifier or a Codex built-in ImageGen execution identifier");
    error.code = "social_original_ai_provenance_invalid";
    error.statusCode = 400;
    throw error;
  }
  if (normalizedPrompt.length > 12000) {
    const error = new Error("The supplied FULL_AI_GRAPHIC prompt exceeds 12,000 characters");
    error.code = "social_full_ai_graphic_prompt_too_long";
    error.statusCode = 400;
    throw error;
  }
  const blocks = normalizeExpectedTextBlocks(expectedTextBlocks);
  const normalized = await validateAndNormalizeOriginal(sourceBuffer, format, { resizeFit: "fill", autoRotate: false });
  const validation = {
    ...await validateFullAiGraphicPoster({
      buffer: normalized.buffer,
      expectedTextBlocks: blocks,
      settings,
      dependencies,
    }),
    validated_asset: "openai_normalized_final",
  };
  if (!fullAiGraphicPosterValidationPassed(validation, blocks)) {
    const error = new Error(`FULL_AI_GRAPHIC poster validation failed: ${safeIssueText(validation?.issues)}`);
    error.code = "social_full_ai_graphic_poster_invalid";
    error.statusCode = 422;
    error.poster_validation = validation;
    throw error;
  }

  const version = createCampaignAssetVersion();
  const identity = slugify(draftIdentity || "social-draft");
  const suffix = "01";
  const providerOriginalExtension = normalized.provider_original.format === "jpeg"
    ? "jpg"
    : normalized.provider_original.format;
  const stagedFiles = [];
  try {
    const providerOriginalStored = await storeValidatedBuffer({
      fileName: `${identity}-${version}-openai-provider-original-${suffix}.${providerOriginalExtension}`,
      buffer: sourceBuffer,
      dependencies,
    });
    stagedFiles.push(providerOriginalStored);
    const normalizedStored = await storeValidatedBuffer({
      fileName: `${identity}-${version}-full-ai-normalized-${suffix}.jpg`,
      buffer: normalized.buffer,
      dependencies,
    });
    stagedFiles.push(normalizedStored);
    const finalStored = await storeValidatedBuffer({
      fileName: `${identity}-${version}-full-ai-final-${suffix}.jpg`,
      buffer: normalized.buffer,
      dependencies,
      errorCode: "social_final_asset_storage_invalid",
    });
    stagedFiles.push(finalStored);
    if (normalizedStored.checksum_sha256 !== finalStored.checksum_sha256) {
      const error = new Error("The overlay-free final bytes do not match the normalized OpenAI graphic bytes");
      error.code = "social_full_ai_graphic_passthrough_mismatch";
      throw error;
    }
    const providerOriginal = {
      url: providerOriginalStored.url,
      storage_provider: providerOriginalStored.storage_provider,
      storage_key: providerOriginalStored.storage_key,
      checksum_sha256: providerOriginalStored.checksum_sha256,
      mime_type: normalized.provider_original.mime_type,
      file_size_bytes: normalized.provider_original.file_size_bytes,
      width: normalized.provider_original.width,
      height: normalized.provider_original.height,
      provider: "openai",
      model: normalizedModel,
      response_id: responseIdentifier || null,
      generation_tool: normalizedGenerationTool || null,
      tool_execution_id: normalizedToolExecutionId || null,
      byte_preserving: true,
    };
    const perceptualHash = await computePerceptualHash64(normalized.buffer);
    return {
      contract_version: 2,
      version,
      provider: "openai",
      model: normalizedModel,
      prompt: normalizedPrompt,
      generation_tool: normalizedGenerationTool || null,
      tool_execution_id: normalizedToolExecutionId || null,
      source_provenance: normalizedSourceProvenance,
      reference_lineage: normalizedReferenceLineage,
      provider_request_id: trimText(providerRequestId) || null,
      provider_response_id: responseIdentifier || null,
      generation_usage: generationUsage && typeof generationUsage === "object" ? generationUsage : {},
      estimated_cost: Math.max(Number(estimatedCost || 0), 0),
      cost_currency: trimText(costCurrency || "USD").toUpperCase() || "USD",
      expected_text_blocks: blocks,
      poster_validation: validation,
      provider_original: providerOriginal,
      normalized: {
        buffer: normalized.buffer,
        url: normalizedStored.url,
        file_path: normalizedStored.file_path || null,
        storage_provider: normalizedStored.storage_provider,
        storage_key: normalizedStored.storage_key,
        checksum_sha256: normalizedStored.checksum_sha256,
        mime_type: "image/jpeg",
        file_size_bytes: normalized.buffer.length,
        width: normalized.width,
        height: normalized.height,
        aspect_ratio: normalized.aspect_ratio,
        perceptual_hash_64: perceptualHash,
      },
      final: {
        buffer: normalized.buffer,
        url: finalStored.url,
        file_path: finalStored.file_path || null,
        storage_provider: finalStored.storage_provider,
        storage_key: finalStored.storage_key,
        checksum_sha256: finalStored.checksum_sha256,
        mime_type: "image/jpeg",
        file_size_bytes: normalized.buffer.length,
        width: normalized.width,
        height: normalized.height,
        aspect_ratio: normalized.aspect_ratio,
      },
      normalization: {
        renderer: "sharp_resize_encode_only_v1",
        resize_fit: "fill",
        pixel_overlay_applied: false,
        source_checksum_sha256: providerOriginal.checksum_sha256,
        output_url: normalizedStored.url,
        output_storage_provider: normalizedStored.storage_provider,
        output_storage_key: normalizedStored.storage_key,
        output_checksum_sha256: normalizedStored.checksum_sha256,
        output_width: normalized.width,
        output_height: normalized.height,
        output_mime_type: "image/jpeg",
      },
      staged_files: stagedFiles,
    };
  } catch (error) {
    const cleanup = await cleanupStagedFullAiGraphic(stagedFiles, dependencies);
    if (cleanup.failed) error.staged_file_cleanup = cleanup;
    throw error;
  }
}

async function generateSocialVisuals({
  draftLike = {},
  recommendation = {},
  settings = {},
  visualMode = "AI_VISUAL_WITH_EXACT_OVERLAY",
  assetSequence = null,
  comparisonVisuals = [],
  dependencies = {},
} = {}) {
  const provider = trimText(settings.models?.image_provider || settings.image_provider || "openai").toLowerCase();
  if (provider !== "openai") {
    const error = new Error(`Fully AI-generated social visuals require the configured OpenAI image provider; received ${provider || "none"}`);
    error.code = "social_image_provider_unsupported";
    throw error;
  }
  const model = getImageModel(settings);
  const format = trimText(recommendation.format).toUpperCase();
  const normalizedVisualMode = assertSocialVisualModeEligible({
    visualMode,
    recommendation,
  }).effective;
  const visualBrief = recommendation.visualBrief || recommendation.visual_brief || {};
  const briefFormat = trimText(visualBrief.format).toUpperCase();
  const briefVisualMode = trimText(visualBrief.visualMode || visualBrief.visual_mode).toUpperCase();
  if (briefFormat && briefFormat !== format) {
    const error = new Error("The AI visual brief format must match the approved recommendation format");
    error.code = "social_visual_brief_format_mismatch";
    throw error;
  }
  if (briefVisualMode && briefVisualMode !== normalizedVisualMode) {
    const error = new Error("The AI visual brief mode must match the requested generation mode");
    error.code = "social_visual_mode_mismatch";
    throw error;
  }
  const requests = visualRequestsForRecommendation(recommendation)
    .slice()
    .sort((left, right) => Number(left.sequence) - Number(right.sequence));
  if (!requests.length || requests.some((request) => !trimText(request.prompt))) {
    const error = new Error("The AI visual brief does not contain every required format-specific image prompt");
    error.code = "social_image_prompt_missing";
    throw error;
  }
  if (format === "CAROUSEL" && (requests.length < 3 || requests.length > 7)) {
    const error = new Error("AI-selected carousels must contain three to seven original visuals");
    error.code = "social_carousel_visual_count_invalid";
    throw error;
  }
  const formatContent = getContentPackage(recommendation) || {};
  const contentFormat = trimText(formatContent.format).toUpperCase();
  if (contentFormat && contentFormat !== format) {
    const error = new Error("The approved format-specific content must match the recommendation format");
    error.code = "social_format_content_mismatch";
    throw error;
  }
  const matchingFormatContent = contentFormat === format;
  let approvedVisualCount = requests.length;
  if (matchingFormatContent) {
    if (format === "CAROUSEL" && Array.isArray(formatContent.slides)) {
      approvedVisualCount = formatContent.slides.length;
    } else if (format === "STORY" && Array.isArray(formatContent.frames)) {
      approvedVisualCount = formatContent.frames.length;
    } else if (["REEL", "VIDEO_FEED"].includes(format) && Array.isArray(formatContent.scenes)) {
      approvedVisualCount = 1 + Math.min(formatContent.scenes.length, reelStoryboardFrameLimit());
    } else {
      approvedVisualCount = 1;
    }
  }
  if (matchingFormatContent && requests.length !== approvedVisualCount) {
    const error = new Error(`The approved ${format || "social"} content requires ${approvedVisualCount} distinct original visual${approvedVisualCount === 1 ? "" : "s"}, but the AI visual brief supplied ${requests.length}`);
    error.code = "social_original_visual_count_invalid";
    throw error;
  }
  if (requests.some((request, index) => !Number.isInteger(request.sequence) || request.sequence !== index + 1)) {
    const error = new Error("AI visual-brief assets must use unique consecutive sequence numbers beginning at 1");
    error.code = "social_visual_sequence_invalid";
    throw error;
  }
  const requestedAssetSequence = assetSequence == null || assetSequence === ""
    ? null
    : Number(assetSequence);
  if (requestedAssetSequence != null && (!Number.isInteger(requestedAssetSequence) || !requests.some((request) => request.sequence === requestedAssetSequence))) {
    const error = new Error("asset_sequence must identify an existing visual in the approved package");
    error.code = "social_asset_sequence_invalid";
    error.statusCode = 400;
    throw error;
  }
  const generationRequests = requestedAssetSequence == null
    ? requests
    : requests.filter((request) => request.sequence === requestedAssetSequence);
  const productReference = verifiedProductReference(recommendation);
  const productVisual = format === "PRODUCT_FEATURE" || Boolean(productReference.id);
  if (productVisual && normalizedVisualMode !== "AI_VISUAL_WITH_EXACT_OVERLAY") {
    const error = new Error("Product creatives require an AI-only text-free background, guarded authentic-product composition, and exact programmatic overlays");
    error.code = "social_visual_mode_ineligible";
    error.statusCode = 409;
    throw error;
  }
  const verifiedDatabaseProduct = productVisual
    ? await (dependencies.resolveVerifiedProductRecord || resolveVerifiedProductRecord)(productReference, dependencies)
    : null;
  const referenceUrl = verifiedDatabaseProduct?.url || null;
  const reference = productVisual
    ? await (dependencies.readAuthenticProductReference || readAuthenticProductReference)(verifiedDatabaseProduct, dependencies)
    : null;
  if (productVisual && (!reference || !Buffer.isBuffer(reference.buffer))) {
    const error = new Error("A safely validated authentic product image from the production product database is required for this product visual");
    error.code = "reference_image_required";
    throw error;
  }
  if (
    reference
    && (
      trimText(reference.source_url || reference.url) !== referenceUrl
      || trimText(reference.product_id) !== productReference.id
      || trimText(reference.product_title) !== productReference.title
      || reference.database_record_verified !== true
    )
  ) {
    const error = new Error("The guarded product reference does not match the verified production database product");
    error.code = "social_product_reference_mismatch";
    throw error;
  }
  const referenceChecksum = reference?.checksum_sha256 || null;

  const maxAttempts = Math.min(3, Math.max(Number(
    settings.generation?.max_image_retries
    || settings.ai_generation?.max_image_retries
    || settings.max_image_retries
    || process.env.SOCIAL_MAX_IMAGE_RETRIES
    || 3
  ), 1));
  const version = createCampaignAssetVersion();
  const identity = slugify(
    draftLike.idempotency_key
    || draftLike.idempotencyKey
    || draftLike._id
    || draftLike.id
    || `${draftLike.generation_date || draftLike.generationDate || "today"}-${recommendation.topic || "social"}`
  );
  const generated = [];
  const comparisonRows = Array.isArray(comparisonVisuals) ? comparisonVisuals : [];
  const comparisonHashes = [];
  for (const row of comparisonRows) {
    if (Number(row?.sequence) === requestedAssetSequence) continue;
    const perceptualHash = trimText(row?.perceptual_hash_64 || row?.perceptualHash64)
      || (Buffer.isBuffer(row?.buffer) ? await computePerceptualHash64(row.buffer) : null);
    comparisonHashes.push({
      sequence: Number(row?.sequence || 0) || null,
      checksum_sha256: trimText(row?.checksum_sha256).toLowerCase() || null,
      perceptual_hash_64: perceptualHash,
    });
  }
  let storedAuthenticReference = null;

  for (let index = 0; index < generationRequests.length; index += 1) {
    const request = generationRequests[index];
    let prompt = buildProductionImagePrompt({
      recommendation,
      request,
      sequence: request.sequence,
      total: requests.length,
      visualMode: normalizedVisualMode,
    });
    const failures = [];
    let result = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const call = dependencies.generateOpenAiImage || callOpenAiImage;
        const response = await call({
          model,
          prompt,
          size: imageSizeFor(format, model),
          quality: settings.models?.image_quality || settings.ai_generation?.image_quality || settings.image_quality || "medium",
          dependencies,
        });
        const providerResponseId = trimText(response.response_id || response.responseId);
        if (!providerResponseId) {
          const error = new Error("OpenAI Image API did not return a provider response identifier");
          error.code = "social_image_response_invalid";
          throw error;
        }
        const normalized = await validateAndNormalizeOriginal(
          response.buffer,
          format,
          normalizedVisualMode === "FULL_AI_GRAPHIC"
            ? { resizeFit: "fill", autoRotate: false }
            : undefined,
        );
        let textValidation = null;
        let posterValidation = null;
        let expectedTextBlocks = null;
        let artworkValidation = null;
        if (normalizedVisualMode === "FULL_AI_GRAPHIC") {
          expectedTextBlocks = fullAiGraphicTextBlocksForSequence(
            recommendation,
            request.sequence,
            requests.length,
          );
          posterValidation = {
            ...await validateFullAiGraphicPoster({
              buffer: normalized.buffer,
              expectedTextBlocks,
              settings,
              dependencies,
            }),
            validated_asset: "openai_normalized_final",
          };
          if (!fullAiGraphicPosterValidationPassed(posterValidation, expectedTextBlocks)) {
            const error = new Error(`FULL_AI_GRAPHIC poster validation failed: ${safeIssueText(posterValidation?.issues)}`);
            error.code = "social_full_ai_graphic_poster_invalid";
            error.poster_validation = posterValidation;
            throw error;
          }
          // Keep the legacy headline-only result readable for historical API
          // clients, but the v2 contract and approval path rely exclusively on
          // the complete-poster validation above.
          textValidation = {
            decision: "PASS",
            exactHeadlineMatch: true,
            observedText: approvedHeadlineForSequence(recommendation, request.sequence),
            issues: [],
            response_id: posterValidation.response_id,
            legacy_compatibility_projection: true,
          };
          /* istanbul ignore next -- retained only for old injected validators */
          if (dependencies.useLegacyFullAiHeadlineValidation === true) textValidation = await validateFullAiGraphicText({
            buffer: normalized.buffer,
            approvedHeadline: approvedHeadlineForSequence(recommendation, request.sequence),
            settings,
            dependencies,
          });
        }
        if (normalizedVisualMode === "AI_ARTWORK_ONLY") {
          artworkValidation = {
            ...await validateArtworkOnlyVisual({
              // Validate the complete byte-preserving provider image, not only
              // the later crop, so edge text or watermarks cannot be hidden by
              // normalization.
              buffer: response.buffer,
              settings,
              dependencies,
            }),
            validated_asset: "openai_provider_original",
          };
          const observedText = trimText(artworkValidation?.observedText || artworkValidation?.observed_text);
          if (
            artworkValidation?.decision !== "PASS"
            || artworkValidation?.hasVisibleText !== false
            || artworkValidation?.hasLogoOrWatermark !== false
            || observedText
          ) {
            const error = new Error(`AI_ARTWORK_ONLY validation failed: ${safeIssueText(artworkValidation?.issues)}`);
            error.code = "social_artwork_only_visual_invalid";
            error.visual_validation = artworkValidation;
            throw error;
          }
        }
        const perceptualHash = await computePerceptualHash64(normalized.buffer);
        if (format === "CAROUSEL") {
          const priorRows = [
            ...comparisonHashes,
            ...generated.map((row) => ({
              sequence: row.sequence,
              checksum_sha256: row.checksum_sha256,
              perceptual_hash_64: row.perceptual_hash_64,
            })),
          ];
          const candidateChecksum = crypto.createHash("sha256").update(normalized.buffer).digest("hex");
          const exactDuplicate = priorRows.find((row) => row.checksum_sha256 && row.checksum_sha256 === candidateChecksum);
          if (exactDuplicate) {
            const error = new Error(`Carousel visual ${request.sequence} duplicates visual ${exactDuplicate.sequence || "another slide"}`);
            error.code = "social_carousel_original_duplicate";
            error.duplicate_validation = { compared_sequence: exactDuplicate.sequence, checksum_sha256: candidateChecksum };
            throw error;
          }
          const nearDuplicate = priorRows
            .map((row) => ({ ...row, distance: perceptualHashHammingDistance(perceptualHash, row.perceptual_hash_64) }))
            .find((row) => row.distance != null && row.distance < 10);
          if (nearDuplicate) {
            const error = new Error(`Carousel visual ${request.sequence} is perceptually too similar to visual ${nearDuplicate.sequence || "another slide"}`);
            error.code = "social_carousel_original_near_duplicate";
            error.duplicate_validation = {
              compared_sequence: nearDuplicate.sequence,
              perceptual_hash_64: perceptualHash,
              compared_perceptual_hash_64: nearDuplicate.perceptual_hash_64,
              hamming_distance: nearDuplicate.distance,
              minimum_hamming_distance: 10,
            };
            throw error;
          }
        }
        const suffix = String(request.sequence).padStart(2, "0");
        const providerOriginalExtension = normalized.provider_original.format === "jpeg"
          ? "jpg"
          : normalized.provider_original.format;
        const storedProviderOriginal = await storeValidatedBuffer({
          fileName: `${identity}-${version}-openai-provider-original-${suffix}.${providerOriginalExtension}`,
          buffer: response.buffer,
          dependencies,
        });
        const providerOriginal = {
          url: storedProviderOriginal.url,
          storage_provider: storedProviderOriginal.storage_provider,
          storage_key: storedProviderOriginal.storage_key,
          checksum_sha256: storedProviderOriginal.checksum_sha256,
          mime_type: normalized.provider_original.mime_type,
          file_size_bytes: normalized.provider_original.file_size_bytes,
          width: normalized.provider_original.width,
          height: normalized.provider_original.height,
          provider: "openai",
          model,
          response_id: providerResponseId,
          byte_preserving: true,
        };
        let sourceBuffer = normalized.buffer;
        let stored;
        let backgroundAsset = null;
        let authenticProductComposition = null;
        if (productVisual) {
          backgroundAsset = await storeValidatedBuffer({
            fileName: `${identity}-${version}-ai-background-${suffix}.jpg`,
            buffer: normalized.buffer,
            dependencies,
          });
          if (!storedAuthenticReference) {
            const extension = reference.mime_type === "image/png" ? "png" : reference.mime_type === "image/webp" ? "webp" : "jpg";
            storedAuthenticReference = await storeValidatedBuffer({
              fileName: `${identity}-${version}-authentic-product-reference.${extension}`,
              buffer: reference.buffer,
              dependencies,
              errorCode: "social_product_reference_storage_invalid",
            });
            if (storedAuthenticReference.checksum_sha256 !== referenceChecksum) {
              const error = new Error("The stored authentic product reference bytes do not match the guarded downloaded reference");
              error.code = "social_product_reference_mismatch";
              throw error;
            }
          }
          const composite = await (dependencies.compositeAuthenticProduct || compositeAuthenticProduct)({
            backgroundBuffer: normalized.buffer,
            reference,
            format,
          });
          if (!composite?.buffer || !Buffer.isBuffer(composite.buffer)) {
            const error = new Error("Guarded local product composition did not return an image");
            error.code = "social_product_composite_failed";
            throw error;
          }
          sourceBuffer = composite.buffer;
          authenticProductComposition = {
            renderer: composite.renderer,
            placement: composite.placement,
            source_reference_checksum_sha256: composite.source_reference_checksum_sha256,
            source_reference_file_size_bytes: composite.source_reference_file_size_bytes,
            product_pixels_generated_by_ai: composite.product_pixels_generated_by_ai,
            packaging_editing_performed: composite.packaging_editing_performed,
          };
          if (
            authenticProductComposition.renderer !== "sharp_authentic_product_composite_v1"
            || authenticProductComposition.source_reference_checksum_sha256 !== referenceChecksum
            || authenticProductComposition.product_pixels_generated_by_ai !== false
            || authenticProductComposition.packaging_editing_performed !== false
            || authenticProductComposition.placement?.occurrence_count !== 1
          ) {
            const error = new Error("Guarded local product composition did not preserve the verified product-reference contract");
            error.code = "social_product_composite_failed";
            throw error;
          }
          stored = await storeValidatedBuffer({
            fileName: `${identity}-${version}-authentic-product-composite-${suffix}.jpg`,
            buffer: sourceBuffer,
            dependencies,
          });
        } else {
          stored = await storeValidatedBuffer({
            fileName: `${identity}-${version}-ai-normalized-${suffix}.jpg`,
            buffer: sourceBuffer,
            dependencies,
          });
        }
        const actualChecksum = stored.checksum_sha256;
        result = {
          sequence: request.sequence,
          asset_purpose: request.asset_purpose || null,
          scene_index: Number.isInteger(request.scene_index) ? request.scene_index : null,
          buffer: sourceBuffer,
          file_path: stored.file_path || null,
          url: stored.url,
          storage_provider: stored.storage_provider,
          storage_key: stored.storage_key,
          checksum_sha256: actualChecksum,
          mime_type: "image/jpeg",
          file_size_bytes: sourceBuffer.length,
          width: normalized.width,
          height: normalized.height,
          aspect_ratio: normalized.aspect_ratio,
          provider: "openai",
          model,
          prompt,
          art_direction: serializePinkPaisaArtDirection(resolvePinkPaisaArtDirection(
            recommendation,
            request.art_direction || request.artDirection,
          )),
          response_id: providerResponseId,
          usage: response.usage || {},
          attempt_count: attempt,
          status: "VALIDATED",
          source_provenance: productVisual ? "generated_from_approved_source" : "generated_without_reference",
          usage_rights_status: productVisual ? reference.usage_rights_status : "api_permitted",
          reference_image_url: reference?.source_url || null,
          reference_image_checksum_sha256: referenceChecksum,
          reference_image_mime_type: reference?.mime_type || null,
          ai_background: backgroundAsset ? {
            url: backgroundAsset.url,
            storage_provider: backgroundAsset.storage_provider,
            storage_key: backgroundAsset.storage_key,
            checksum_sha256: backgroundAsset.checksum_sha256,
            mime_type: "image/jpeg",
            file_size_bytes: normalized.buffer.length,
            width: normalized.width,
            height: normalized.height,
            provider: "openai",
            model,
            prompt,
            response_id: providerResponseId,
            text_free_product_free_required: true,
            provider_original: providerOriginal,
          } : null,
          authentic_product_reference: storedAuthenticReference ? {
            url: storedAuthenticReference.url,
            original_database_url: reference.source_url,
            storage_provider: storedAuthenticReference.storage_provider,
            storage_key: storedAuthenticReference.storage_key,
            checksum_sha256: referenceChecksum,
            mime_type: reference.mime_type,
            detected_file_signature: reference.detected_file_signature,
            file_size_bytes: reference.file_size_bytes,
            width: reference.width,
            height: reference.height,
            product_id: reference.product_id,
            product_title: reference.product_title,
            database_model: reference.database_model,
            database_record_verified: reference.database_record_verified,
            source_kind: reference.source_kind,
            usage_rights_status: reference.usage_rights_status,
            image_provenance: reference.image_provenance,
          } : null,
          authentic_product_composition: authenticProductComposition,
          verified_product_id: productReference.id,
          verified_product_title: productReference.title,
          text_validation: textValidation,
          poster_validation: posterValidation,
          expected_text_blocks: expectedTextBlocks,
          full_ai_graphic_contract_version: normalizedVisualMode === "FULL_AI_GRAPHIC" ? 2 : null,
          artwork_validation: artworkValidation,
          perceptual_hash_64: perceptualHash,
          provider_original: providerOriginal,
          normalization: {
            renderer: normalizedVisualMode === "FULL_AI_GRAPHIC"
              ? "sharp_resize_encode_only_v1"
              : "sharp_crop_resize_encode_v1",
            resize_fit: normalizedVisualMode === "FULL_AI_GRAPHIC" ? "fill" : "cover",
            auto_rotate: normalizedVisualMode !== "FULL_AI_GRAPHIC",
            pixel_overlay_applied: false,
            source_checksum_sha256: providerOriginal.checksum_sha256,
            output_url: backgroundAsset?.url || stored.url,
            output_storage_provider: backgroundAsset?.storage_provider || stored.storage_provider,
            output_storage_key: backgroundAsset?.storage_key || stored.storage_key,
            output_checksum_sha256: backgroundAsset?.checksum_sha256 || actualChecksum,
            output_width: normalized.width,
            output_height: normalized.height,
            output_mime_type: "image/jpeg",
          },
          failures,
        };
        break;
      } catch (error) {
        const retriable = isRetriableImageError(error);
        failures.push({
          attempt,
          code: error.code || null,
          message: trimText(error.message).slice(0, 1000),
          retriable,
          prompt,
          details: error.poster_validation || error.text_validation || error.visual_validation || error.duplicate_validation || null,
        });
        if (attempt >= maxAttempts) break;
        const revise = dependencies.reviseImagePrompt;
        const revisionRequired = requiresPromptRevision(error);
        if (!retriable && !revisionRequired) break;
        // Every image retry is an AI revision stage. Repeating the same prompt is
        // neither useful nor compliant with the full-AI workflow contract.
        if (typeof revise !== "function") break;
        {
          try {
            const revision = await revise({
              originalPrompt: prompt,
              failedAttemptFeedback: failures.at(-1),
              failure: failures.at(-1),
              approvedVisualBrief: recommendation.visualBrief || recommendation.visual_brief || null,
              brandConstraints: settings.brand_profile || settings.brand_tokens || null,
              productAuthenticityConstraints: recommendation.verifiedProductFacts || recommendation.verified_product_facts || null,
              recommendation,
              sequence: request.sequence,
              settings,
              dependencies,
            });
            const revisedCreativePrompt = trimText(revision?.prompt || revision?.revisedPrompt || revision?.revised_prompt);
            const revisedPrompt = revisedCreativePrompt
              ? buildProductionImagePrompt({
                recommendation,
                request: { ...request, prompt: revisedCreativePrompt },
                sequence: request.sequence,
                total: requests.length,
                visualMode: normalizedVisualMode,
              })
              : null;
            if (!revisedPrompt || revisedPrompt === prompt) {
              failures.at(-1).prompt_revision = {
                status: "FAILED",
                message: "AI prompt revision did not return a materially changed prompt",
              };
              break;
            }
            failures.at(-1).prompt_revision = {
              status: "COMPLETED",
              revised_prompt: revisedPrompt,
              provider_response_id: revision?.response_id || revision?.provider_response_id || null,
              usage: revision?.usage || {},
            };
            prompt = revisedPrompt;
          } catch (revisionError) {
            failures.at(-1).prompt_revision = {
              status: "FAILED",
              code: revisionError?.code || null,
              message: trimText(revisionError?.message || "AI prompt revision failed").slice(0, 1000),
            };
            break;
          }
        }
        await (dependencies.sleep || sleep)(Math.min(1000 * (2 ** (attempt - 1)), 5000));
      }
    }
    if (!result) {
      const error = new Error(`OpenAI image generation failed for visual ${request.sequence} after ${failures.length} attempt${failures.length === 1 ? "" : "s"}`);
      error.code = "social_image_generation_failed";
      error.image_generation = { sequence: request.sequence, model, prompt, failures };
      throw error;
    }
    generated.push(result);
  }

  return {
    status: "SUCCEEDED",
    provider: "openai",
    model,
    visual_mode: normalizedVisualMode,
    original_visuals: generated,
    image_count: generated.length,
    partial_generation: requestedAssetSequence != null,
    requested_asset_sequence: requestedAssetSequence,
    usage: sumUsage(generated),
    estimated_cost: estimatedImageCost(generated.length),
    cost_currency: "USD",
    generation_fingerprint: crypto.createHash("sha256").update(JSON.stringify(generated.map((row) => ({ prompt: row.prompt, checksum: row.checksum_sha256 })))).digest("hex"),
  };
}

module.exports = {
  buildProductionImagePrompt,
  callOpenAiImage,
  generateSocialVisuals,
  getImageModel,
  imageSizeFor,
  stageSuppliedFullAiGraphic,
  cleanupStagedFullAiGraphic,
  validateFullAiGraphicPoster,
  validateFullAiGraphicText,
  validateArtworkOnlyVisual,
  visualRequestsForRecommendation,
  _private: {
    approvedHeadlineForSequence,
    fullAiGraphicTextBlocksForSequence,
    createOpenAiClient,
    decodeImageResponse,
    expectedOutputDimensions,
    fullAiGraphicPosterValidationPassed,
    normalizeExpectedTextBlocks,
    computePerceptualHash64,
    perceptualHashHammingDistance,
    isRetriableImageError,
    validateAndNormalizeOriginal,
    verifiedProductReferenceUrl,
  },
};
