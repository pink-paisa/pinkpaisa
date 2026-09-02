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
const { buildSocialCaptionContract } = require("./socialCaptionPolicy");
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

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeIssueText(value) {
  const issues = Array.isArray(value) ? value.map(trimText).filter(Boolean) : [];
  return issues.join("; ").slice(0, 800) || "the approved headline was missing, misspelled, distorted, or accompanied by unapproved text";
}

function stringList(value) {
  return Array.isArray(value) ? value.map(trimText).filter(Boolean) : [];
}

function fullAiGraphicRetryDirection(request = {}) {
  const retryNumber = Math.min(Math.max(Number(request.full_ai_retry_number || 0), 0), 2);
  if (!retryNumber) return null;
  const failureCode = trimText(request.full_ai_retry_failure_code).toLowerCase();
  if (["social_carousel_original_duplicate", "social_carousel_original_near_duplicate"].includes(failureCode)) {
    return retryNumber === 1
      ? "Retry with a materially different full-canvas subject arrangement, focal point, icon placement and visual rhythm while preserving the same server-owned art direction and exact visible-text manifest."
      : "Retry with the alternate composition: reverse the visual balance, change the illustrated subject action, simplify the icon family and preserve the exact visible-text manifest.";
  }
  return retryNumber === 1
    ? "Retry with a cleaner hierarchy: enlarge and isolate every approved text block, increase contrast, reduce decorative elements and preserve generous mobile-safe margins."
    : "Retry with the alternate hierarchy: use fewer larger visual panels, stronger separation around every approved text block and a substantially different icon arrangement.";
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
  const headlineLimit = format === "STORY" ? 160 : 80;
  const wordLimit = format === "STORY" ? 32 : 12;
  if (!headline || headline.length > headlineLimit || headline.split(/\s+/).length > wordLimit) {
    const error = new Error(`FULL_AI_GRAPHIC requires approved ${format === "STORY" ? "Story copy" : "headline copy"} of at most ${headlineLimit} characters and ${wordLimit} words for every generated graphic`);
    error.code = "social_full_ai_graphic_copy_too_long";
    throw error;
  }
  if (supportingText.length > 160) {
    const error = new Error("FULL_AI_GRAPHIC supporting text must not exceed 160 characters");
    error.code = "social_full_ai_graphic_copy_too_long";
    throw error;
  }
  if (format === "STORY") {
    const contract = buildSocialCaptionContract(recommendation);
    const componentIfDistinct = (key, text) => {
      const normalized = trimText(text);
      return normalized && !headline.includes(normalized) ? [{ key, text: normalized }] : [];
    };
    return normalizeExpectedTextBlocks([
      { key: "brand_name", text: "Pink Paisa" },
      { key: "story_copy", text: headline },
      ...(Number(sequence) === 1
        ? componentIfDistinct("affiliate_disclosure", contract.components.affiliate_disclosure)
        : []),
      ...(Number(sequence) === Number(total)
        ? [
          ...componentIfDistinct("cta", contract.components.cta),
          ...componentIfDistinct("financial_disclaimer", contract.components.financial_disclaimer),
        ]
        : []),
      ...(Number(total) > 1 ? [{ key: "sequence_label", text: `${sequence}/${total}` }] : []),
    ]);
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
  const exactOverlayMode = visualMode === "AI_VISUAL_WITH_EXACT_OVERLAY";
  const artworkOnlyMode = visualMode === "AI_ARTWORK_ONLY";
  const artDirection = resolvePinkPaisaArtDirection(recommendation, request.art_direction || request.artDirection);
  const fullAiTextBlocks = visualMode === "FULL_AI_GRAPHIC"
    ? fullAiGraphicTextBlocksForSequence(recommendation, sequence, total)
    : [];
  const prohibitedObjectValues = [
    ...stringList(request.prohibited_objects),
    ...stringList(formatContent.negativeVisualInstructions || formatContent.negative_visual_instructions),
  ];
  const prohibitedObjects = visualMode === "FULL_AI_GRAPHIC"
    ? []
    : [...new Set(prohibitedObjectValues)];
  const requiredObjectValues = productFacts
    ? stringList(request.required_objects).filter((value) => !/\b(product|package|packaging|bottle|box|journal|container)\b/i.test(value))
    : stringList(request.required_objects);
  const requiredObjects = visualMode === "FULL_AI_GRAPHIC"
    ? []
    : requiredObjectValues;
  const fullAiRetryDirection = visualMode === "FULL_AI_GRAPHIC"
    ? fullAiGraphicRetryDirection(request)
    : null;
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
          "Treat Pink Paisa as intentional baked-in brand identity. Use the meaning of the approved manifest as the sole semantic theme for topic-specific illustrations and icons. Make every text block comfortably legible on mobile and keep it inside safe margins.",
          format === "STORY"
            ? "Stories publish without a caption. Render the approved first-frame affiliate disclosure and final-frame CTA/general disclaimer exactly when those blocks are present in the manifest; do not add any post-generation overlay."
            : "For feed posts and Reels, CTA, affiliate disclosure, financial disclaimer and hashtags belong only in the Instagram caption and must not appear in the image unless explicitly listed above.",
        ].join(" "),
    fullAiRetryDirection,
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
  const promptHeading = visualMode === "FULL_AI_GRAPHIC"
    ? [
      "SERVER-OWNED COMPLETE POSTER DIRECTION.",
      "Build the poster only from the production art direction and exact visible-text manifest below. No free-form AI visual-brief wording or object list is included in this image request, so it cannot add, remove or contradict visible copy.",
    ].join("\n")
    : productFacts
      ? `Use this AI-authored brief only as environmental art direction; ignore any phrase asking you to show the supplied product: ${creativePrompt}`
      : creativePrompt;
  return `${promptHeading}\n\nProduction constraints (hard requirements):\n${technicalDirection}`.slice(0, 12000);
}

function parseStructuredText(response = {}, errorCode = "social_full_ai_graphic_validation_invalid") {
  const text = trimText(response.output_text)
    || trimText(response.output?.flatMap?.((item) => item.content || []).find?.((item) => item.type === "output_text")?.text);
  const responseStatus = trimText(response.status).toLowerCase();
  const refusal = (Array.isArray(response.output) ? response.output : [])
    .flatMap((item) => Array.isArray(item?.content) ? item.content : [])
    .find((part) => part?.type === "refusal" || trimText(part?.refusal));
  if (responseStatus !== "completed" || response.error || refusal) {
    const providerText = trimText(
      response.incomplete_details?.reason || response.error?.message || refusal?.refusal || "",
    );
    const error = new Error("OpenAI visual validation did not return a completed response");
    error.code = errorCode;
    error.validation_response = {
      decision: "INVALID",
      response_id: responseId(response),
      usage: responseUsage(response),
      output_fingerprint: text
        ? crypto.createHash("sha256").update(text).digest("hex")
        : null,
      validation_errors: [
        `OpenAI visual validation status must be completed${responseStatus ? `; received ${responseStatus}` : ""}`,
      ],
      provider_status: responseStatus || null,
      provider_error_fingerprint: providerText
        ? crypto.createHash("sha256").update(providerText).digest("hex")
        : null,
      raw_output_retained: false,
    };
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch (cause) {
    const error = new Error("OpenAI visual text validation returned invalid structured output");
    error.code = errorCode;
    error.cause = cause;
    // The validator response is a paid provider call even when its structured
    // body is empty, refused, incomplete, or malformed. Preserve bounded
    // accounting/provenance without retaining the invalid raw output or image.
    error.validation_response = {
      decision: "INVALID",
      response_id: responseId(response),
      usage: responseUsage(response),
      output_fingerprint: text
        ? crypto.createHash("sha256").update(text).digest("hex")
        : null,
      validation_errors: ["OpenAI visual validation returned invalid structured output"],
      raw_output_retained: false,
    };
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
  const providerResponseId = responseId(response);
  const usage = responseUsage(response);
  let buffer;
  try {
    buffer = decodeImageResponse(response);
  } catch (error) {
    const first = Array.isArray(response?.data) ? response.data[0] : null;
    const encodedOutput = trimText(first?.b64_json || first?.b64Json);
    error.response_id = providerResponseId;
    error.usage = usage;
    error.output_fingerprint = encodedOutput
      ? crypto.createHash("sha256").update(encodedOutput).digest("hex")
      : crypto.createHash("sha256").update(JSON.stringify({
        response_id: providerResponseId,
        data_count: Array.isArray(response?.data) ? response.data.length : 0,
        output_present: Boolean(first),
      })).digest("hex");
    throw error;
  }
  return {
    buffer,
    response_id: providerResponseId,
    usage,
  };
}

function isRetriableImageError(error) {
  const status = Number(error?.status || error?.response?.status || 0);
  if (TRANSIENT_STATUS_CODES.has(status)) return true;
  if ([400, 401, 403, 404, 422].includes(status)) return false;
  if (new Set([
    "social_original_asset_storage_invalid",
    "social_product_reference_storage_invalid",
    "social_product_reference_mismatch",
    "social_product_composite_failed",
  ]).has(error?.code)) return false;
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

function normalizedUsage(value = {}) {
  return {
    input_tokens: Number(value.input_tokens || 0),
    output_tokens: Number(value.output_tokens || 0),
    total_tokens: Number(
      value.total_tokens
      || (Number(value.input_tokens || 0) + Number(value.output_tokens || 0)),
    ),
    input_image_tokens: Number(value.input_image_tokens || 0),
    output_image_tokens: Number(value.output_image_tokens || 0),
  };
}

function usageHasValues(value = {}) {
  const usage = normalizedUsage(value);
  return Object.values(usage).some((amount) => amount !== 0);
}

function sumUsage(rows = []) {
  return rows.reduce((total, row) => {
    const usage = normalizedUsage(row?.usage || row || {});
    return {
      input_tokens: total.input_tokens + usage.input_tokens,
      output_tokens: total.output_tokens + usage.output_tokens,
      total_tokens: total.total_tokens + usage.total_tokens,
      input_image_tokens: total.input_image_tokens + usage.input_image_tokens,
      output_image_tokens: total.output_image_tokens + usage.output_image_tokens,
    };
  }, normalizedUsage());
}

function estimatedTextCost(usage = {}) {
  const inputRate = Math.max(Number(process.env.SOCIAL_MANAGER_OPENAI_INPUT_USD_PER_MILLION || 0), 0);
  const outputRate = Math.max(Number(process.env.SOCIAL_MANAGER_OPENAI_OUTPUT_USD_PER_MILLION || 0), 0);
  return Number((
    Number(usage.input_tokens || 0) * inputRate / 1_000_000
    + Number(usage.output_tokens || 0) * outputRate / 1_000_000
  ).toFixed(6));
}

function promptFingerprint(prompt) {
  return crypto.createHash("sha256").update(trimText(prompt)).digest("hex");
}

function sanitizedProviderAttempts(attempts = []) {
  return (Array.isArray(attempts) ? attempts : []).slice(0, 10).map((attempt, index) => ({
    attempt: Math.max(Number(attempt?.attempt || index + 1), 1),
    status: trimText(attempt?.status).toUpperCase() || "FAILED",
    started_at: attempt?.started_at || null,
    completed_at: attempt?.completed_at || null,
    response_id: trimText(attempt?.response_id).slice(0, 300) || null,
    usage: normalizedUsage(attempt?.usage || {}),
    output_fingerprint: trimText(attempt?.output_fingerprint).slice(0, 128) || null,
    error_code: trimText(attempt?.error_code).slice(0, 200) || null,
    error_message: attempt?.error_code ? "OpenAI image provider attempt failed" : null,
  }));
}

function sanitizedEvidenceValue(value, depth = 0) {
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return undefined;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    if (/^data:image\//i.test(value) || (/^[a-z0-9+/=\r\n]+$/i.test(value) && value.length > 16000)) return undefined;
    return value.slice(0, 12000);
  }
  if (depth >= 6) return undefined;
  if (Array.isArray(value)) {
    return value
      .slice(0, 30)
      .map((item) => sanitizedEvidenceValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (typeof value !== "object") return undefined;
  if (trimText(value.type).toLowerCase() === "buffer" && Array.isArray(value.data)) return undefined;
  const sanitized = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "raw_output_retained" && child === false) {
      sanitized[key] = false;
      continue;
    }
    if (/(?:^|_)(?:buffer|bytes|base64|b64_json|b64json|raw_image|image_data|raw_output)(?:$|_)/i.test(key)) continue;
    if (/^(?:message|reason|refusal|incomplete_reason|provider_error_message)$/i.test(key)) continue;
    if (key === "data" && Array.isArray(child) && child.every((item) => Number.isInteger(item))) continue;
    const safeChild = sanitizedEvidenceValue(child, depth + 1);
    if (safeChild !== undefined) sanitized[key] = safeChild;
  }
  return sanitized;
}

function sanitizedPromptRevisionEvidence(value = {}, overrides = {}) {
  const usage = normalizedUsage(value?.usage || {});
  const attempts = sanitizedProviderAttempts(value?.attempts);
  const responseIdValue = trimText(
    value?.provider_response_id
    || value?.response_id
    || attempts.at(-1)?.response_id,
  ).slice(0, 300) || null;
  return {
    status: trimText(overrides.status || value?.status).toUpperCase() || "FAILED",
    method: trimText(overrides.method || value?.method).slice(0, 200) || null,
    revised_prompt: trimText(overrides.revised_prompt || value?.revised_prompt || value?.revisedPrompt || value?.prompt).slice(0, 12000) || null,
    provider: trimText(value?.provider).toLowerCase() || null,
    model: trimText(value?.model) || null,
    prompt_version: trimText(value?.prompt_version).slice(0, 200) || null,
    provider_response_id: responseIdValue,
    usage,
    estimated_cost: estimatedTextCost(usage),
    attempt_count: Math.max(Number(value?.attempt_count || attempts.length || (responseIdValue ? 1 : 0)), 0),
    attempts,
    started_at: value?.started_at || null,
    completed_at: value?.completed_at || null,
    input_fingerprint: trimText(value?.input_fingerprint).slice(0, 128) || null,
    output_fingerprint: trimText(value?.output_fingerprint).slice(0, 128) || null,
    code: trimText(overrides.code || value?.code).slice(0, 200) || null,
    message: trimText(overrides.message || value?.message).replace(/\s+/g, " ").slice(0, 1000) || null,
    validation_errors: (Array.isArray(value?.validation_errors) ? value.validation_errors : [])
      .map((item) => trimText(item).replace(/\s+/g, " ").slice(0, 1000))
      .filter(Boolean)
      .slice(0, 20),
    raw_output_retained: false,
  };
}

function uniqueEvidenceUsage(rows = []) {
  const seen = new Set();
  return sumUsage(rows.filter((row, index) => {
    if (!row || typeof row !== "object") return false;
    const responseIdValue = trimText(row.response_id || row.responseId);
    const key = responseIdValue ? `response:${responseIdValue}` : `row:${index}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }));
}

function aggregateVisualCallEvidence(success = null, failures = []) {
  const failureRows = Array.isArray(failures) ? failures : [];
  const imageUsage = sumUsage([
    ...(success ? [{ usage: success.image_usage || success.usage || {} }] : []),
    ...failureRows.map((failure) => ({ usage: failure.image_usage || {} })),
  ]);
  const validationUsage = sumUsage([
    ...(success ? [{ usage: success.validation_usage || {} }] : []),
    ...failureRows.map((failure) => ({ usage: failure.validation_usage || {} })),
  ]);
  const promptRevisionUsage = sumUsage(failureRows.map((failure) => ({
    usage: failure.prompt_revision?.usage || {},
  })));
  const paidImageCallCount = Number(Boolean(success)) + failureRows.filter(
    (failure) => failure.image_call_billable === true,
  ).length;
  const imageEstimatedCost = estimatedImageCost(paidImageCallCount);
  const validationEstimatedCost = estimatedTextCost(validationUsage);
  const promptRevisionEstimatedCost = estimatedTextCost(promptRevisionUsage);
  return {
    usage: sumUsage([imageUsage, validationUsage, promptRevisionUsage]),
    image_usage: imageUsage,
    validation_usage: validationUsage,
    prompt_revision_usage: promptRevisionUsage,
    paid_image_call_count: paidImageCallCount,
    image_estimated_cost: imageEstimatedCost,
    validation_estimated_cost: validationEstimatedCost,
    prompt_revision_estimated_cost: promptRevisionEstimatedCost,
    estimated_cost: Number((imageEstimatedCost + validationEstimatedCost + promptRevisionEstimatedCost).toFixed(6)),
  };
}

function sanitizedFailureEvidence(failure = {}) {
  const providerResponseId = trimText(failure.provider_response_id).slice(0, 300) || null;
  const imageUsage = normalizedUsage(failure.image_usage || {});
  const validationUsage = normalizedUsage(failure.validation_usage || {});
  const combinedUsage = normalizedUsage(failure.usage || sumUsage([imageUsage, validationUsage]));
  const imageCallBillable = failure.image_call_billable === true
    || Boolean(providerResponseId)
    || imageUsage.input_tokens > 0
    || imageUsage.output_tokens > 0
    || imageUsage.total_tokens > 0
    || imageUsage.input_image_tokens > 0
    || imageUsage.output_image_tokens > 0;
  const imageEstimatedCost = imageCallBillable ? estimatedImageCost(1) : 0;
  const validationEstimatedCost = estimatedTextCost(validationUsage);
  const minimumEstimatedCost = imageEstimatedCost + validationEstimatedCost;
  return {
    attempt: Math.max(Number(failure.attempt || 1), 1),
    code: trimText(failure.code).slice(0, 200) || null,
    message: "AI image generation or validation attempt failed",
    retriable: failure.retriable === true,
    prompt: trimText(failure.prompt).slice(0, 12000),
    prompt_fingerprint: trimText(failure.prompt_fingerprint).slice(0, 128) || null,
    provider_response_id: providerResponseId,
    image_call_billable: imageCallBillable,
    image_usage: imageUsage,
    validation_usage: validationUsage,
    usage: combinedUsage,
    image_estimated_cost: imageEstimatedCost,
    validation_estimated_cost: validationEstimatedCost,
    estimated_cost: Math.max(Number(failure.estimated_cost ?? minimumEstimatedCost), minimumEstimatedCost, 0),
    output_fingerprint: trimText(failure.output_fingerprint).slice(0, 128) || null,
    details: sanitizedEvidenceValue(failure.details),
    prompt_revision: failure.prompt_revision
      ? sanitizedPromptRevisionEvidence(failure.prompt_revision)
      : null,
    started_at: failure.started_at || null,
    completed_at: failure.completed_at || null,
  };
}

function sanitizedCompletedVisualEvidence(visual = {}) {
  const failures = (Array.isArray(visual.failures) ? visual.failures : []).map(sanitizedFailureEvidence);
  const acceptedImageUsage = normalizedUsage(visual.accepted_image_usage || visual.image_usage || visual.usage || {});
  const acceptedValidationUsage = normalizedUsage(
    visual.accepted_validation_usage
    || (!failures.length ? visual.validation_usage : {})
    || {},
  );
  const acceptedUsage = normalizedUsage(
    usageHasValues(visual.accepted_usage)
      ? visual.accepted_usage
      : sumUsage([acceptedImageUsage, acceptedValidationUsage]),
  );
  const derivedAggregate = aggregateVisualCallEvidence({
    image_usage: acceptedImageUsage,
    validation_usage: acceptedValidationUsage,
  }, failures);
  const imageUsage = normalizedUsage(
    usageHasValues(visual.image_usage) && visual.paid_image_call_count != null
      ? visual.image_usage
      : derivedAggregate.image_usage,
  );
  const validationUsage = normalizedUsage(
    usageHasValues(visual.validation_usage) && visual.paid_image_call_count != null
      ? visual.validation_usage
      : derivedAggregate.validation_usage,
  );
  const promptRevisionUsage = normalizedUsage(
    usageHasValues(visual.prompt_revision_usage)
      ? visual.prompt_revision_usage
      : derivedAggregate.prompt_revision_usage,
  );
  const usage = normalizedUsage(
    usageHasValues(visual.usage) && visual.paid_image_call_count != null
      ? visual.usage
      : sumUsage([imageUsage, validationUsage, promptRevisionUsage]),
  );
  const paidImageCallCount = Math.max(Number(
    visual.paid_image_call_count ?? derivedAggregate.paid_image_call_count,
  ), 1);
  const imageEstimatedCost = estimatedImageCost(paidImageCallCount);
  const validationEstimatedCost = estimatedTextCost(validationUsage);
  const acceptedValidationEstimatedCost = estimatedTextCost(acceptedValidationUsage);
  const promptRevisionEstimatedCost = estimatedTextCost(promptRevisionUsage);
  const minimumAcceptedEstimatedCost = estimatedImageCost(1) + acceptedValidationEstimatedCost;
  const minimumEstimatedCost = imageEstimatedCost + validationEstimatedCost + promptRevisionEstimatedCost;
  return {
    sequence: Math.max(Number(visual.sequence || 1), 1),
    asset_purpose: trimText(visual.asset_purpose).slice(0, 100) || null,
    scene_index: Number.isInteger(visual.scene_index) ? visual.scene_index : null,
    url: trimText(visual.url).slice(0, 4096) || null,
    storage_provider: trimText(visual.storage_provider).slice(0, 100) || null,
    storage_key: trimText(visual.storage_key).slice(0, 4096) || null,
    checksum_sha256: trimText(visual.checksum_sha256).toLowerCase().slice(0, 64) || null,
    mime_type: trimText(visual.mime_type).slice(0, 100) || null,
    file_size_bytes: Math.max(Number(visual.file_size_bytes || 0), 0),
    width: Math.max(Number(visual.width || 0), 0) || null,
    height: Math.max(Number(visual.height || 0), 0) || null,
    aspect_ratio: trimText(visual.aspect_ratio).slice(0, 20) || null,
    provider: trimText(visual.provider).toLowerCase() || "openai",
    model: trimText(visual.model) || null,
    prompt: trimText(visual.prompt).slice(0, 12000),
    prompt_fingerprint: trimText(visual.prompt_fingerprint).slice(0, 128)
      || promptFingerprint(visual.prompt),
    response_id: trimText(visual.response_id).slice(0, 300) || null,
    output_fingerprint: trimText(visual.output_fingerprint).slice(0, 128)
      || trimText(visual.provider_original?.checksum_sha256).slice(0, 128)
      || trimText(visual.checksum_sha256).slice(0, 128)
      || null,
    attempt_count: Math.max(Number(visual.attempt_count || 1), 1),
    status: trimText(visual.status).toUpperCase() || "VALIDATED",
    usage,
    image_usage: imageUsage,
    validation_usage: validationUsage,
    accepted_image_usage: acceptedImageUsage,
    accepted_validation_usage: acceptedValidationUsage,
    accepted_usage: acceptedUsage,
    accepted_estimated_cost: Math.max(
      Number(visual.accepted_estimated_cost ?? minimumAcceptedEstimatedCost),
      minimumAcceptedEstimatedCost,
      0,
    ),
    prompt_revision_usage: promptRevisionUsage,
    paid_image_call_count: paidImageCallCount,
    image_estimated_cost: Math.max(Number(visual.image_estimated_cost ?? imageEstimatedCost), 0),
    validation_estimated_cost: Math.max(
      Number(visual.validation_estimated_cost ?? validationEstimatedCost),
      validationEstimatedCost,
      0,
    ),
    prompt_revision_estimated_cost: Math.max(Number(
      visual.prompt_revision_estimated_cost ?? promptRevisionEstimatedCost,
    ), 0),
    estimated_cost: Math.max(Number(visual.estimated_cost ?? minimumEstimatedCost), minimumEstimatedCost, 0),
    reference_image_url: trimText(visual.reference_image_url).slice(0, 4096) || null,
    reference_image_checksum_sha256: trimText(visual.reference_image_checksum_sha256).toLowerCase().slice(0, 64) || null,
    authentic_product_reference: sanitizedEvidenceValue(visual.authentic_product_reference),
    text_validation: sanitizedEvidenceValue(visual.text_validation),
    poster_validation: sanitizedEvidenceValue(visual.poster_validation),
    artwork_validation: sanitizedEvidenceValue(visual.artwork_validation),
    perceptual_hash_64: trimText(visual.perceptual_hash_64).slice(0, 64) || null,
    provider_original: sanitizedEvidenceValue(visual.provider_original),
    normalization: sanitizedEvidenceValue(visual.normalization),
    staged_files: sanitizedEvidenceValue(visual.staged_files),
    failures,
  };
}

function sanitizeImageGenerationEvidence(evidence = {}) {
  const completedVisuals = (Array.isArray(evidence.completed_visuals) ? evidence.completed_visuals : [])
    .map(sanitizedCompletedVisualEvidence);
  const failures = (Array.isArray(evidence.failures) ? evidence.failures : [])
    .map(sanitizedFailureEvidence);
  const derivedImageUsage = sumUsage([
    ...completedVisuals.map((visual) => visual.image_usage || {}),
    ...failures.map((failure) => failure.image_usage || {}),
  ]);
  const derivedValidationUsage = sumUsage([
    ...completedVisuals.map((visual) => visual.validation_usage || {}),
    ...failures.map((failure) => failure.validation_usage || {}),
  ]);
  const derivedPromptRevisionUsage = sumUsage([
    ...completedVisuals.map((visual) => visual.prompt_revision_usage || {}),
    ...failures.map((failure) => failure.prompt_revision?.usage || {}),
  ]);
  const explicitPaidCount = Number(evidence.paid_image_call_count ?? evidence.paid_attempt_count);
  const paidImageCallCount = Number.isFinite(explicitPaidCount) && explicitPaidCount > 0
    ? explicitPaidCount
    : completedVisuals.reduce(
      (total, visual) => total + Math.max(Number(visual.paid_image_call_count || 1), 1),
      failures.filter((failure) => failure.image_call_billable).length,
    );
  const imageUsage = normalizedUsage(usageHasValues(evidence.image_usage) ? evidence.image_usage : derivedImageUsage);
  const validationUsage = normalizedUsage(usageHasValues(evidence.validation_usage) ? evidence.validation_usage : derivedValidationUsage);
  const promptRevisionUsage = normalizedUsage(
    usageHasValues(evidence.prompt_revision_usage) ? evidence.prompt_revision_usage : derivedPromptRevisionUsage,
  );
  const derivedUsage = sumUsage([
    imageUsage,
    validationUsage,
    promptRevisionUsage,
  ]);
  const usage = normalizedUsage(usageHasValues(evidence.usage) ? evidence.usage : derivedUsage);
  const imageEstimatedCost = Math.max(Number(
    evidence.image_estimated_cost ?? estimatedImageCost(paidImageCallCount),
  ), 0);
  const computedValidationEstimatedCost = estimatedTextCost(validationUsage);
  const validationEstimatedCost = Math.max(Number(
    evidence.validation_estimated_cost ?? computedValidationEstimatedCost,
  ), computedValidationEstimatedCost, 0);
  const promptRevisionEstimatedCost = Math.max(Number(
    evidence.prompt_revision_estimated_cost ?? estimatedTextCost(promptRevisionUsage),
  ), 0);
  const minimumEstimatedCost = imageEstimatedCost + validationEstimatedCost + promptRevisionEstimatedCost;
  const estimatedCost = Math.max(Number(
    evidence.estimated_cost ?? minimumEstimatedCost,
  ), minimumEstimatedCost, 0);
  return {
    sequence: Math.max(Number(evidence.sequence || 1), 1),
    provider: trimText(evidence.provider).toLowerCase() || "openai",
    model: trimText(evidence.model) || null,
    prompt: trimText(evidence.prompt).slice(0, 12000),
    prompt_fingerprint: trimText(evidence.prompt_fingerprint).slice(0, 128)
      || promptFingerprint(evidence.prompt),
    paid_attempt_count: Math.max(paidImageCallCount, 0),
    paid_image_call_count: Math.max(paidImageCallCount, 0),
    image_count: Math.max(Number(evidence.image_count ?? completedVisuals.length), 0),
    usage,
    image_usage: imageUsage,
    validation_usage: validationUsage,
    prompt_revision_usage: promptRevisionUsage,
    image_estimated_cost: imageEstimatedCost,
    validation_estimated_cost: validationEstimatedCost,
    prompt_revision_estimated_cost: promptRevisionEstimatedCost,
    estimated_cost: Number(estimatedCost.toFixed(6)),
    cost_currency: trimText(evidence.cost_currency || "USD").toUpperCase(),
    completed_visuals: completedVisuals,
    failures,
    staged_files: sanitizedEvidenceValue(evidence.staged_files),
    storage_cleanup: sanitizedEvidenceValue(evidence.storage_cleanup),
    raw_image_bytes_retained: false,
  };
}

function estimatedImageCost(count) {
  const perImage = Math.max(Number(process.env.SOCIAL_MANAGER_OPENAI_IMAGE_USD_PER_IMAGE || 0), 0);
  return Number((count * perImage).toFixed(6));
}

function assertImageCostRateConfigured() {
  const rawRate = trimText(process.env.SOCIAL_MANAGER_OPENAI_IMAGE_USD_PER_IMAGE);
  const perImage = Number(rawRate);
  if (process.env.NODE_ENV === "production" && (!rawRate || !Number.isFinite(perImage) || perImage <= 0)) {
    const error = new Error(
      "SOCIAL_MANAGER_OPENAI_IMAGE_USD_PER_IMAGE must be a positive reviewed USD rate before paid image generation is enabled",
    );
    error.code = "social_image_cost_rate_not_configured";
    error.statusCode = 503;
    error.retriable = false;
    throw error;
  }
}

async function storeValidatedBuffer({ fileName, buffer, dependencies = {}, errorCode = "social_original_asset_storage_invalid" }) {
  let stored;
  try {
    stored = await (dependencies.storeCampaignAsset || storeCampaignAsset)({ fileName, buffer });
  } catch (cause) {
    const error = new Error("Guarded social asset storage failed before the generated bytes could be committed");
    error.code = errorCode;
    error.storage_cause_code = trimText(cause?.code).slice(0, 100) || null;
    error.staged_files = safeArray(cause?.staged_files);
    throw error;
  }
  const stagedFiles = trimText(stored?.storage_key)
    ? [{
      storage_provider: trimText(stored?.storage_provider || "local").toLowerCase(),
      storage_key: trimText(stored.storage_key),
    }]
    : [];
  if (!trimText(stored?.url) || !trimText(stored?.storage_key)) {
    const error = new Error("Guarded social asset storage did not return a URL and storage key");
    error.code = errorCode;
    error.staged_files = stagedFiles;
    throw error;
  }
  const storageProvider = trimText(stored.storage_provider || "local").toLowerCase();
  if (!["local", "external"].includes(storageProvider)) {
    const error = new Error("Guarded social asset storage returned an unsupported provider");
    error.code = errorCode;
    error.staged_files = stagedFiles;
    throw error;
  }
  const checksum = crypto.createHash("sha256").update(buffer).digest("hex");
  const storedChecksum = trimText(stored.checksum_sha256).toLowerCase();
  if (/^[a-f0-9]{64}$/.test(storedChecksum) && storedChecksum !== checksum) {
    const error = new Error("Guarded social asset storage checksum does not match the supplied bytes");
    error.code = errorCode;
    error.staged_files = stagedFiles;
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
  let removed = 0;
  for (const file of unique) {
    try {
      const deleted = await remove(file);
      if (deleted === false) throw new Error("storage provider did not delete the staged file");
      removed += 1;
    } catch (error) {
      failures.push({ storage_key: file.storage_key, code: error?.code || null, message: trimText(error?.message).slice(0, 500) });
    }
  }
  return {
    attempted: unique.length,
    attempted_storage_keys: unique.map((file) => file.storage_key),
    removed,
    failed: failures.length,
    failures,
  };
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
  // Production must never make a paid image call that the monthly budget
  // ledger prices as zero. Development/test retain the explicit zero-rate
  // default so offline fixtures can exercise the pipeline without credentials.
  assertImageCostRateConfigured();
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
    let creativePrompt = trimText(request.prompt);
    let prompt = buildProductionImagePrompt({
      recommendation,
      request: { ...request, prompt: creativePrompt },
      sequence: request.sequence,
      total: requests.length,
      visualMode: normalizedVisualMode,
    });
    const failures = [];
    let result = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let paidCallEvidence = null;
      let attemptValidationUsage = normalizedUsage();
      const stagedAttemptFiles = [];
      let authenticReferenceCreatedThisAttempt = false;
      const attemptStartedAt = new Date().toISOString();
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
        paidCallEvidence = {
          provider_response_id: providerResponseId || null,
          usage: normalizedUsage(response.usage || {}),
          output_fingerprint: Buffer.isBuffer(response.buffer)
            ? crypto.createHash("sha256").update(response.buffer).digest("hex")
            : null,
          image_call_billable: true,
        };
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
            || !trimText(artworkValidation?.response_id || artworkValidation?.responseId)
          ) {
            const error = new Error(`AI_ARTWORK_ONLY validation failed: ${safeIssueText(artworkValidation?.issues)}`);
            error.code = "social_artwork_only_visual_invalid";
            error.visual_validation = artworkValidation;
            throw error;
          }
        }
        attemptValidationUsage = uniqueEvidenceUsage([
          posterValidation,
          textValidation,
          artworkValidation,
        ]);
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
        stagedAttemptFiles.push(storedProviderOriginal);
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
          stagedAttemptFiles.push(backgroundAsset);
          if (!storedAuthenticReference) {
            const extension = reference.mime_type === "image/png" ? "png" : reference.mime_type === "image/webp" ? "webp" : "jpg";
            storedAuthenticReference = await storeValidatedBuffer({
              fileName: `${identity}-${version}-authentic-product-reference.${extension}`,
              buffer: reference.buffer,
              dependencies,
              errorCode: "social_product_reference_storage_invalid",
            });
            stagedAttemptFiles.push(storedAuthenticReference);
            authenticReferenceCreatedThisAttempt = true;
            if (storedAuthenticReference.checksum_sha256 !== referenceChecksum) {
              const error = new Error("The stored authentic product reference bytes do not match the guarded downloaded reference");
              error.code = "social_product_reference_mismatch";
              throw error;
            }
          }
          let composite;
          try {
            composite = await (dependencies.compositeAuthenticProduct || compositeAuthenticProduct)({
              backgroundBuffer: normalized.buffer,
              reference,
              format,
            });
          } catch (cause) {
            const error = new Error("Guarded local product composition failed after image generation");
            error.code = "social_product_composite_failed";
            error.composition_cause_code = trimText(cause?.code).slice(0, 100) || null;
            throw error;
          }
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
          stagedAttemptFiles.push(stored);
        } else {
          stored = await storeValidatedBuffer({
            fileName: `${identity}-${version}-ai-normalized-${suffix}.jpg`,
            buffer: sourceBuffer,
            dependencies,
          });
          stagedAttemptFiles.push(stored);
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
          prompt_fingerprint: promptFingerprint(prompt),
          art_direction: serializePinkPaisaArtDirection(resolvePinkPaisaArtDirection(
            recommendation,
            request.art_direction || request.artDirection,
          )),
          response_id: providerResponseId,
          image_usage: normalizedUsage(response.usage || {}),
          validation_usage: attemptValidationUsage,
          usage: sumUsage([response.usage || {}, attemptValidationUsage]),
          output_fingerprint: paidCallEvidence.output_fingerprint,
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
          staged_files: stagedAttemptFiles.map((file) => ({
            storage_provider: file.storage_provider,
            storage_key: file.storage_key,
          })),
          failures,
        };
        result.accepted_image_usage = normalizedUsage(result.image_usage || {});
        result.accepted_validation_usage = normalizedUsage(result.validation_usage || {});
        result.accepted_usage = normalizedUsage(result.usage || {});
        result.accepted_estimated_cost = Number((
          estimatedImageCost(1) + estimatedTextCost(result.accepted_validation_usage)
        ).toFixed(6));
        const aggregate = aggregateVisualCallEvidence(result, failures);
        Object.assign(result, aggregate);
        break;
      } catch (error) {
        const retriable = isRetriableImageError(error);
        const stagedFiles = [
          ...stagedAttemptFiles,
          ...safeArray(error.staged_files),
        ];
        const storageCleanup = await cleanupStagedFullAiGraphic(stagedFiles, dependencies);
        if (authenticReferenceCreatedThisAttempt) storedAuthenticReference = null;
        const validationEvidence = error.poster_validation
          || error.text_validation
          || error.visual_validation
          || error.validation_response
          || error.duplicate_validation
          || null;
        const providerResponseId = paidCallEvidence?.provider_response_id || trimText(error.response_id) || null;
        const imageUsage = normalizedUsage(paidCallEvidence?.usage || error.usage || {});
        const validationUsage = sumUsage([
          attemptValidationUsage,
          normalizedUsage(validationEvidence?.usage || {}),
        ]);
        const imageCallBillable = paidCallEvidence?.image_call_billable === true
          || Boolean(providerResponseId)
          || imageUsage.input_tokens > 0
          || imageUsage.output_tokens > 0
          || imageUsage.total_tokens > 0
          || imageUsage.input_image_tokens > 0
          || imageUsage.output_image_tokens > 0;
        failures.push(sanitizedFailureEvidence({
          attempt,
          code: error.code || null,
          message: trimText(error.message).slice(0, 1000),
          retriable,
          prompt,
          prompt_fingerprint: promptFingerprint(prompt),
          provider_response_id: providerResponseId,
          image_call_billable: imageCallBillable,
          image_usage: imageUsage,
          validation_usage: validationUsage,
          usage: sumUsage([imageUsage, validationUsage]),
          estimated_cost: Number((
            (imageCallBillable ? estimatedImageCost(1) : 0)
            + estimatedTextCost(validationUsage)
          ).toFixed(6)),
          output_fingerprint: paidCallEvidence?.output_fingerprint || trimText(error.output_fingerprint) || null,
          details: {
            validation: validationEvidence,
            storage_cause_code: trimText(error.storage_cause_code).slice(0, 100) || null,
            composition_cause_code: trimText(error.composition_cause_code).slice(0, 100) || null,
            staged_files: stagedFiles.map((file) => ({
              storage_provider: trimText(file?.storage_provider || file?.storageProvider || "local").toLowerCase(),
              storage_key: trimText(file?.storage_key || file?.storageKey),
            })).filter((file) => file.storage_key),
            storage_cleanup: storageCleanup,
          },
          started_at: attemptStartedAt,
          completed_at: new Date().toISOString(),
        }));
        if (attempt >= maxAttempts) break;
        const revisionRequired = requiresPromptRevision(error);
        if (!retriable && !revisionRequired) break;
        if (normalizedVisualMode === "FULL_AI_GRAPHIC") {
          const revisedPrompt = buildProductionImagePrompt({
            recommendation,
            request: {
              ...request,
              prompt: creativePrompt,
              full_ai_retry_number: attempt,
              full_ai_retry_failure_code: error.code || null,
            },
            sequence: request.sequence,
            total: requests.length,
            visualMode: normalizedVisualMode,
          });
          if (revisedPrompt === prompt) {
            failures.at(-1).prompt_revision = sanitizedPromptRevisionEvidence({}, {
              status: "FAILED",
              message: "Server-owned FULL_AI_GRAPHIC retry did not produce a materially changed prompt",
            });
            break;
          }
          failures.at(-1).prompt_revision = sanitizedPromptRevisionEvidence({}, {
            status: "COMPLETED",
            method: "server_owned_full_ai_retry",
            revised_prompt: revisedPrompt,
          });
          prompt = revisedPrompt;
        } else {
          const revise = dependencies.reviseImagePrompt;
          // Non-FULL_AI_GRAPHIC retries use an AI revision stage. Repeating the
          // same production prompt is neither useful nor cost-conscious.
          if (typeof revise !== "function") break;
          try {
            const revision = await revise({
              originalPrompt: creativePrompt,
              failedAttemptFeedback: { ...failures.at(-1), prompt: creativePrompt },
              failure: { ...failures.at(-1), prompt: creativePrompt },
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
              failures.at(-1).prompt_revision = sanitizedPromptRevisionEvidence(revision, {
                status: "FAILED",
                message: "AI prompt revision did not return a materially changed prompt",
              });
              break;
            }
            failures.at(-1).prompt_revision = sanitizedPromptRevisionEvidence(revision, {
              status: "COMPLETED",
              revised_prompt: revisedPrompt,
            });
            creativePrompt = revisedCreativePrompt;
            prompt = revisedPrompt;
          } catch (revisionError) {
            failures.at(-1).prompt_revision = sanitizedPromptRevisionEvidence(revisionError, {
              status: "FAILED",
              code: revisionError?.code || null,
              message: trimText(revisionError?.message || "AI prompt revision failed").slice(0, 1000),
            });
            break;
          }
        }
        await (dependencies.sleep || sleep)(Math.min(1000 * (2 ** (attempt - 1)), 5000));
      }
    }
    if (!result) {
      const completedStagedFiles = generated.flatMap((visual) => safeArray(visual.staged_files));
      const completedStorageCleanup = await cleanupStagedFullAiGraphic(completedStagedFiles, dependencies);
      const terminalAggregate = aggregateVisualCallEvidence(null, failures);
      const completedAggregates = generated.map((visual) => ({
        usage: visual.usage || {},
        image_usage: visual.image_usage || {},
        validation_usage: visual.validation_usage || {},
        prompt_revision_usage: visual.prompt_revision_usage || {},
        paid_image_call_count: Number(visual.paid_image_call_count || 0),
        image_estimated_cost: Number(visual.image_estimated_cost || 0),
        validation_estimated_cost: Number(visual.validation_estimated_cost || 0),
        prompt_revision_estimated_cost: Number(visual.prompt_revision_estimated_cost || 0),
        estimated_cost: Number(visual.estimated_cost || 0),
      }));
      const aggregateUsage = sumUsage([
        ...completedAggregates.map((row) => row.usage),
        terminalAggregate.usage,
      ]);
      const aggregateImageUsage = sumUsage([
        ...completedAggregates.map((row) => row.image_usage),
        terminalAggregate.image_usage,
      ]);
      const aggregateValidationUsage = sumUsage([
        ...completedAggregates.map((row) => row.validation_usage),
        terminalAggregate.validation_usage,
      ]);
      const aggregatePromptRevisionUsage = sumUsage([
        ...completedAggregates.map((row) => row.prompt_revision_usage),
        terminalAggregate.prompt_revision_usage,
      ]);
      const paidAttemptCount = completedAggregates.reduce(
        (total, row) => total + row.paid_image_call_count,
        terminalAggregate.paid_image_call_count,
      );
      const imageEstimatedCost = estimatedImageCost(paidAttemptCount);
      const validationEstimatedCost = estimatedTextCost(aggregateValidationUsage);
      const promptRevisionEstimatedCost = estimatedTextCost(aggregatePromptRevisionUsage);
      const aggregateEstimatedCost = Number((
        imageEstimatedCost + validationEstimatedCost + promptRevisionEstimatedCost
      ).toFixed(6));
      const error = new Error(`OpenAI image generation failed for visual ${request.sequence} after ${failures.length} attempt${failures.length === 1 ? "" : "s"}`);
      error.code = "social_image_generation_failed";
      error.usage = aggregateUsage;
      error.estimated_cost = aggregateEstimatedCost;
      error.image_generation = sanitizeImageGenerationEvidence({
        sequence: request.sequence,
        provider: "openai",
        model,
        prompt,
        prompt_fingerprint: promptFingerprint(prompt),
        paid_attempt_count: paidAttemptCount,
        paid_image_call_count: paidAttemptCount,
        image_count: generated.length,
        usage: aggregateUsage,
        image_usage: aggregateImageUsage,
        validation_usage: aggregateValidationUsage,
        prompt_revision_usage: aggregatePromptRevisionUsage,
        image_estimated_cost: imageEstimatedCost,
        validation_estimated_cost: validationEstimatedCost,
        prompt_revision_estimated_cost: promptRevisionEstimatedCost,
        estimated_cost: aggregateEstimatedCost,
        cost_currency: "USD",
        completed_visuals: generated,
        failures,
        staged_files: completedStagedFiles,
        storage_cleanup: completedStorageCleanup,
      });
      throw error;
    }
    generated.push(result);
  }

  const aggregateUsage = sumUsage(generated.map((visual) => visual.usage || {}));
  const aggregateImageUsage = sumUsage(generated.map((visual) => visual.image_usage || {}));
  const aggregateValidationUsage = sumUsage(generated.map((visual) => visual.validation_usage || {}));
  const aggregatePromptRevisionUsage = sumUsage(generated.map((visual) => visual.prompt_revision_usage || {}));
  const paidImageCallCount = generated.reduce(
    (total, visual) => total + Number(visual.paid_image_call_count || 0),
    0,
  );
  const imageEstimatedCost = estimatedImageCost(paidImageCallCount);
  const validationEstimatedCost = estimatedTextCost(aggregateValidationUsage);
  const promptRevisionEstimatedCost = estimatedTextCost(aggregatePromptRevisionUsage);
  return {
    status: "SUCCEEDED",
    provider: "openai",
    model,
    visual_mode: normalizedVisualMode,
    original_visuals: generated,
    image_count: generated.length,
    paid_image_call_count: paidImageCallCount,
    partial_generation: requestedAssetSequence != null,
    requested_asset_sequence: requestedAssetSequence,
    usage: aggregateUsage,
    image_usage: aggregateImageUsage,
    validation_usage: aggregateValidationUsage,
    prompt_revision_usage: aggregatePromptRevisionUsage,
    image_estimated_cost: imageEstimatedCost,
    validation_estimated_cost: validationEstimatedCost,
    prompt_revision_estimated_cost: promptRevisionEstimatedCost,
    estimated_cost: Number((
      imageEstimatedCost + validationEstimatedCost + promptRevisionEstimatedCost
    ).toFixed(6)),
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
  sanitizeImageGenerationEvidence,
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
    normalizedUsage,
    sanitizedPromptRevisionEvidence,
    validateAndNormalizeOriginal,
    verifiedProductReferenceUrl,
  },
};
