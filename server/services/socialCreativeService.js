const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const SocialAsset = require("../models/SocialAsset");
const {
  createCampaignAssetVersion,
  getGeneratedCampaignAssetReference,
  storeCampaignAsset,
} = require("./campaignAssetStorage");
const { buildSocialCaptionContract } = require("./social/socialCaptionPolicy");
const {
  resolvePinkPaisaArtDirection,
  serializePinkPaisaArtDirection,
} = require("./social/socialArtDirection");
const { assertSocialVisualModeEligible } = require("./social/socialVisualPolicy");

const RENDER_VERSION = "social-creative-v2";
const MAX_BASE_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_INPUT_PIXELS = 40 * 1000 * 1000;

const BRAND = Object.freeze({
  name: "Pink Paisa",
  strapline: "Wealth | Wellness | Women",
  palette: {
    ink: "#351927",
    rose: "#B84D75",
    blush: "#F1C4D2",
    cream: "#FFF8F3",
    paper: "#FFFCFA",
    sage: "#A8B6A1",
    plum: "#6D3852",
  },
  fonts: {
    heading: "'DM Serif Display','DM Serif',Georgia,'Times New Roman',serif",
    body: "'DM Sans',Arial,Helvetica,sans-serif",
  },
});

const CANVASES = Object.freeze({
  FEED_4_5: { width: 1080, height: 1350, aspect_ratio: "4:5" },
  SQUARE_1_1: { width: 1080, height: 1080, aspect_ratio: "1:1" },
  VERTICAL_9_16: { width: 1080, height: 1920, aspect_ratio: "9:16" },
});

const SOCIAL_FORMATS = new Set([
  "SINGLE_IMAGE",
  "CAROUSEL",
  "REEL",
  "VIDEO_FEED",
  "STORY",
  "INFOGRAPHIC",
  "MEME",
  "QUIZ",
  "POLL",
  "PRODUCT_FEATURE",
  "RESOURCE_PROMOTION",
  "EVENT_OR_WORKSHOP_PROMOTION",
]);

const SOURCE_PROVENANCE_VALUES = new Set([
  "brand_template",
  "admin_provided",
  "vendor_provided",
  "uploaded",
  "generated",
  "generated_from_approved_source",
  "generated_without_reference",
  "product_reference",
  "licensed",
  "unknown",
]);

const USAGE_RIGHTS_VALUES = new Set(["owned", "licensed", "admin_confirmed", "api_permitted", "unknown"]);

function getSharp() {
  try {
    return require("sharp");
  } catch (_error) {
    throw new Error('Social creative rendering requires the "sharp" package in the server workspace');
  }
}

function asPlainObject(value) {
  if (!value || typeof value !== "object") return {};
  if (typeof value.toObject === "function") {
    return value.toObject({ depopulate: true, flattenMaps: true });
  }
  return value;
}

function textValue(value) {
  return value == null ? null : String(value);
}

function nonEmptyText(value) {
  const result = textValue(value);
  return result && result.trim() ? result : null;
}

function sanitizedMetadataError(value) {
  const message = nonEmptyText(value);
  if (!message) return null;
  return message
    .replace(/\b(bearer|token|api[_-]?key|secret)\s*[:=]?\s*[^\s,;]+/gi, "$1 [redacted]")
    .replace(/https?:\/\/[^\s]+/gi, "[url]")
    .slice(0, 500);
}

function firstDefined(object, keys) {
  for (const key of keys) {
    if (object && object[key] !== undefined && object[key] !== null) return object[key];
  }
  return undefined;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function slugify(value) {
  return String(value || "social-draft")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70) || "social-draft";
}

function escapeXml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizeSocialFormat(value) {
  const normalized = String(value || "SINGLE_IMAGE").trim().toUpperCase().replace(/[\s-]+/g, "_");
  const aliases = {
    SINGLE: "SINGLE_IMAGE",
    FEED: "SINGLE_IMAGE",
    FEED_POST: "SINGLE_IMAGE",
    REEL_COVER: "REEL",
  };
  const resolved = aliases[normalized] || normalized;
  if (!SOCIAL_FORMATS.has(resolved)) throw new Error(`Unsupported social creative format: ${value}`);
  return resolved;
}

function isSocialFormatValue(value) {
  if (!value) return false;
  try {
    normalizeSocialFormat(value);
    return true;
  } catch (_error) {
    return false;
  }
}

function normalizeSourceProvenance(value) {
  const normalized = String(value || "unknown").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const aliases = { ai_generated: "generated", template: "brand_template", admin_upload: "uploaded" };
  const resolved = aliases[normalized] || normalized;
  return SOURCE_PROVENANCE_VALUES.has(resolved) ? resolved : "unknown";
}

function normalizeUsageRights(value) {
  const normalized = String(value || "unknown").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return USAGE_RIGHTS_VALUES.has(normalized) ? normalized : "unknown";
}

function normalizeCanvas(value, socialFormat = "SINGLE_IMAGE") {
  if (value && typeof value === "object") {
    const width = Number(value.width);
    const height = Number(value.height);
    const matchingEntry = Object.entries(CANVASES).find(([, canvas]) => canvas.width === width && canvas.height === height);
    if (!matchingEntry) throw new Error(`Unsupported social creative dimensions: ${width}x${height}`);
    return { canvas_format: matchingEntry[0], ...matchingEntry[1] };
  }
  const requested = typeof value === "string"
    ? value.trim().toUpperCase().replace(/[\sX:-]+/g, "_")
    : "";
  const aliases = {
    "4_5": "FEED_4_5",
    "1080_1350": "FEED_4_5",
    FEED: "FEED_4_5",
    FEED_4_5: "FEED_4_5",
    "1_1": "SQUARE_1_1",
    "1080_1080": "SQUARE_1_1",
    SQUARE: "SQUARE_1_1",
    SQUARE_1_1: "SQUARE_1_1",
    "9_16": "VERTICAL_9_16",
    "1080_1920": "VERTICAL_9_16",
    STORY: "VERTICAL_9_16",
    REEL: "VERTICAL_9_16",
    VIDEO_FEED: "VERTICAL_9_16",
    VERTICAL: "VERTICAL_9_16",
    VERTICAL_9_16: "VERTICAL_9_16",
  };
  const defaultCanvas = ["STORY", "REEL", "VIDEO_FEED"].includes(socialFormat) ? "VERTICAL_9_16" : "FEED_4_5";
  const canvasFormat = aliases[requested] || defaultCanvas;
  const canvas = CANVASES[canvasFormat];
  if (!canvas) throw new Error(`Unsupported social creative canvas: ${value}`);
  return { canvas_format: canvasFormat, ...canvas };
}

function unwrapRecommendation(value) {
  const object = asPlainObject(value);
  return firstDefined(object, ["primaryRecommendation", "primary_recommendation"]) || object;
}

function selectRecommendation(draft, options = {}) {
  if (options.recommendation) return unwrapRecommendation(options.recommendation);
  const source = asPlainObject(draft);
  const candidates = [
    source.editable_recommendation,
    source.editableRecommendation,
    source.current_recommendation,
    source.currentRecommendation,
    source.editable_package,
    source.editablePackage,
    source.current_package,
    source.currentPackage,
    source.content_package,
    source.contentPackage,
    source.result_json,
    source.resultJson,
    source.package_json,
    source.packageJson,
    source.primary_recommendation,
    source.primaryRecommendation,
    source,
  ];
  return unwrapRecommendation(candidates.find((candidate) => candidate && typeof candidate === "object") || {});
}

function getOnPostCopy(recommendation) {
  const legacy = asPlainObject(firstDefined(recommendation, ["onPostCopy", "on_post_copy"]) || {});
  const content = asPlainObject(firstDefined(recommendation, ["formatContent", "format_content", "contentPackage", "content_package"]) || {});
  const directFormatContent = Object.keys(content).length > 0 && (
    nonEmptyText(content.format)
    || nonEmptyText(content.selectedHeadline)
    || Array.isArray(content.slides)
    || Array.isArray(content.frames)
    || Array.isArray(content.scenes)
  );
  const single = asPlainObject((directFormatContent ? content : null)
    || firstDefined(content, ["singleImage", "single_image"])
    || firstDefined(recommendation, ["singleImage", "single_image"])
    || {});
  const carousel = asPlainObject((directFormatContent && Array.isArray(content.slides) ? content : null)
    || content.carousel
    || recommendation.carousel
    || {});
  const story = asPlainObject((directFormatContent && Array.isArray(content.frames) ? content : null)
    || content.story
    || recommendation.story
    || {});
  const reel = asPlainObject((directFormatContent && (Array.isArray(content.scenes) || nonEmptyText(content.coverHeadline)) ? content : null)
    || content.reel
    || recommendation.reel
    || {});
  const staticVisual = asPlainObject((directFormatContent ? content : null)
    || firstDefined(content, ["staticVisual", "static_visual", "productPost", "product_post"])
    || firstDefined(recommendation, ["staticVisual", "static_visual", "productPost", "product_post"])
    || {});
  const interactionCopy = firstDefined(staticVisual, ["interactionCopy", "interaction_copy"]);
  const supportingCopy = firstDefined(single, ["supportingText", "supporting_text", "supportingCopy", "supporting_copy"])
    || firstDefined(staticVisual, ["supportingText", "supporting_text", "supportingCopy", "supporting_copy"])
    || null;
  if (!directFormatContent && Object.keys(legacy).length) return { ...legacy, schema_source: "legacy_onPostCopy" };
  return {
    headline: firstDefined(single, ["headline", "selectedHeadline", "selected_headline"])
      || firstDefined(staticVisual, ["headline", "selectedHeadline", "selected_headline"])
      || null,
    supportingCopy,
    interactionCopy: interactionCopy || null,
    slides: Array.isArray(carousel.slides) ? carousel.slides : [],
    storyFrames: Array.isArray(story.frames) ? story.frames : [],
    reelScenes: Array.isArray(reel.scenes) ? reel.scenes : [],
    coverHeadline: firstDefined(reel, ["coverHeadline", "cover_headline"]) || null,
    schema_source: directFormatContent ? "formatContent" : "legacy_nested_content",
  };
}

function buildRenderItems(recommendation, socialFormat) {
  const onPostCopy = getOnPostCopy(recommendation);
  const headline = firstDefined(onPostCopy, ["headline"]);
  const supportingCopy = firstDefined(onPostCopy, ["supportingCopy", "supporting_copy"]);
  const interactionCopy = firstDefined(onPostCopy, ["interactionCopy", "interaction_copy"]);

  if (socialFormat === "CAROUSEL") {
    const slides = Array.isArray(onPostCopy.slides) ? onPostCopy.slides : [];
    if (!slides.length) throw new Error("Carousel creative requires at least one approved slide");
    return slides.slice(0, 10).map((rawSlide, index) => {
      const slide = asPlainObject(rawSlide);
      const slideNumber = Number(firstDefined(slide, ["slideNumber", "slide_number"]) || index + 1);
      const approvedCopy = {
        slideNumber,
        headline: textValue(slide.headline),
        body: textValue(slide.body),
      };
      return {
        sequence: index + 1,
        source_path: onPostCopy.schema_source === "formatContent"
          ? `formatContent.slides[${index}]`
          : `onPostCopy.slides[${index}]`,
        approved_copy: approvedCopy,
        headline: nonEmptyText(slide.headline),
        body: nonEmptyText(slide.body),
      };
    });
  }

  if (socialFormat === "STORY") {
    const frames = Array.isArray(onPostCopy.storyFrames)
      ? onPostCopy.storyFrames
      : Array.isArray(onPostCopy.story_frames) ? onPostCopy.story_frames : [];
    if (!frames.length) throw new Error("Story creative requires at least one approved story frame");
    const storyFrames = frames.slice(0, 10);
    const storyCaptionContract = buildSocialCaptionContract(recommendation);
    return storyFrames.map((rawFrame, index) => {
      const frame = asPlainObject(rawFrame);
      const frameNumber = Number(firstDefined(frame, ["frameNumber", "frame_number"]) || index + 1);
      const copy = textValue(frame.copy);
      const affiliateDisclosure = index === 0
        ? nonEmptyText(storyCaptionContract.components.affiliate_disclosure)
        : null;
      const cta = index === storyFrames.length - 1
        ? nonEmptyText(storyCaptionContract.components.cta)
        : null;
      const financialDisclaimer = index === storyFrames.length - 1
        ? nonEmptyText(storyCaptionContract.components.financial_disclaimer)
        : null;
      const approvedCopy = {
        frameNumber,
        copy,
        ...(affiliateDisclosure ? { affiliateDisclosure } : {}),
        ...(cta ? { cta } : {}),
        ...(financialDisclaimer ? { financialDisclaimer } : {}),
      };
      return {
        sequence: index + 1,
        source_path: onPostCopy.schema_source === "formatContent"
          ? `formatContent.frames[${index}]`
          : `onPostCopy.storyFrames[${index}]`,
        approved_copy: approvedCopy,
        headline: null,
        body: [affiliateDisclosure, nonEmptyText(copy), cta, financialDisclaimer].filter(Boolean).join("\n\n") || null,
      };
    });
  }

  if (["REEL", "VIDEO_FEED"].includes(socialFormat)) {
    const scenes = Array.isArray(onPostCopy.reelScenes)
      ? onPostCopy.reelScenes
      : Array.isArray(onPostCopy.reel_scenes) ? onPostCopy.reel_scenes : [];
    const firstSceneIndex = scenes.findIndex((entry) => nonEmptyText(firstDefined(asPlainObject(entry), ["onScreenText", "on_screen_text"])));
    const sceneIndex = firstSceneIndex >= 0 ? firstSceneIndex : 0;
    const scene = asPlainObject(scenes[sceneIndex]);
    const sceneNumber = Number(firstDefined(scene, ["sceneNumber", "scene_number"]) || sceneIndex + 1);
    const onScreenText = textValue(firstDefined(scene, ["onScreenText", "on_screen_text"]));
    const coverHeadline = nonEmptyText(firstDefined(onPostCopy, ["coverHeadline", "cover_headline"]));
    return [{
      sequence: 1,
      source_path: coverHeadline ? "formatContent.coverHeadline" : scenes.length ? `onPostCopy.reelScenes[${sceneIndex}].onScreenText` : "onPostCopy",
      approved_copy: coverHeadline
        ? { coverHeadline }
        : scenes.length
        ? { sceneNumber, onScreenText }
        : { headline: textValue(headline), supportingCopy: textValue(supportingCopy) },
      headline: coverHeadline || nonEmptyText(onScreenText) || nonEmptyText(headline),
      body: scenes.length ? null : nonEmptyText(supportingCopy),
    }];
  }

  const canonicalCopy = onPostCopy.schema_source === "formatContent"
    ? {
      selectedHeadline: textValue(headline),
      supportingText: textValue(supportingCopy),
      ...(interactionCopy !== undefined && interactionCopy !== null ? { interactionCopy: textValue(interactionCopy) } : {}),
    }
    : {
      headline: textValue(headline),
      supportingCopy: textValue(supportingCopy),
    };
  return [{
    sequence: 1,
    source_path: onPostCopy.schema_source === "formatContent" ? "formatContent" : "onPostCopy",
    approved_copy: canonicalCopy,
    headline: nonEmptyText(headline),
    body: [nonEmptyText(supportingCopy), nonEmptyText(interactionCopy)].filter(Boolean).join("\n") || null,
  }];
}

function fullAiTextBlocksForRenderItem(item = {}, total = 1) {
  const blocks = [
    { key: "brand_name", text: BRAND.name },
    { key: "headline", text: nonEmptyText(item.headline) },
    ...(nonEmptyText(item.body) ? [{ key: "supporting_text", text: nonEmptyText(item.body) }] : []),
    ...(Number(total) > 1 ? [{ key: "sequence_label", text: `${Number(item.sequence || 1)}/${Number(total)}` }] : []),
  ].filter((block) => nonEmptyText(block.text));
  if (blocks.length < 2) {
    const error = new Error("FULL_AI_GRAPHIC requires an approved headline for every complete graphic");
    error.code = "social_full_ai_graphic_text_contract_invalid";
    throw error;
  }
  return blocks;
}

function splitLongToken(token, maxCharacters) {
  const characters = Array.from(token);
  const chunks = [];
  while (characters.length) chunks.push(characters.splice(0, maxCharacters).join(""));
  return chunks;
}

function wrapText(value, maxCharacters) {
  if (!nonEmptyText(value)) return [];
  const lines = [];
  String(value).replace(/\r\n?/g, "\n").split("\n").forEach((paragraph) => {
    const words = paragraph.trim().split(/\s+/).filter(Boolean).flatMap((word) => (
      Array.from(word).length > maxCharacters ? splitLongToken(word, maxCharacters) : [word]
    ));
    if (!words.length) {
      lines.push("");
      return;
    }
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (!current || Array.from(candidate).length <= maxCharacters) {
        current = candidate;
      } else {
        lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
  });
  return lines;
}

function calculateTextLayout({
  width,
  height,
  headline,
  body,
  artDirection = "EDITORIAL_ICON_GRID",
  socialFormat = "SINGLE_IMAGE",
  productVisual = false,
}) {
  const direction = resolvePinkPaisaArtDirection({}, artDirection);
  const collage = direction.id === "BOLD_EDITORIAL_COLLAGE";
  const vertical = height === 1920;
  const story = String(socialFormat || "").toUpperCase() === "STORY";
  const margin = vertical ? 72 : 68;
  const safeTop = vertical ? 176 : 58;
  const safeBottom = vertical ? 300 : 72;
  const contentTop = vertical ? (story ? 470 : 390) : height === 1080 ? 205 : collage ? 250 : 220;
  const maximumContentHeight = height - safeBottom - contentTop;
  const maximumWidth = productVisual
    ? Math.round(width * (vertical ? 0.47 : 0.5))
    : Math.round(width * (collage ? 0.79 : 0.66));
  const contentWidth = Math.min(width - (margin * 2), maximumWidth);
  let headlineSize = vertical ? (collage ? 100 : 94) : height === 1080 ? (collage ? 72 : 68) : collage ? 84 : 78;
  let bodySize = vertical ? 43 : height === 1080 ? 31 : 35;
  const minimumHeadlineSize = vertical ? 48 : 40;
  const minimumBodySize = vertical ? 27 : 23;
  let layout;

  for (let attempt = 0; attempt < 18; attempt += 1) {
    const headlineCharacters = Math.max(12, Math.floor(contentWidth / (headlineSize * (collage ? 0.54 : 0.56))));
    const bodyCharacters = Math.max(16, Math.floor(contentWidth / (bodySize * 0.53)));
    const headlineLines = wrapText(headline, headlineCharacters);
    const bodyLines = wrapText(body, bodyCharacters);
    const headlineLineHeight = Math.round(headlineSize * (collage ? 1.02 : 1.08));
    const bodyLineHeight = Math.round(bodySize * 1.38);
    const gap = headlineLines.length && bodyLines.length ? Math.round(bodySize * (collage ? 1.55 : 1.25)) : 0;
    const usedHeight = (headlineLines.length * headlineLineHeight) + gap + (bodyLines.length * bodyLineHeight);
    const headlinePanelHeight = (headlineLines.length * headlineLineHeight) + (headlineLines.length ? (collage ? 92 : 24) : 0);
    const bodyPanelTop = contentTop + (headlineLines.length * headlineLineHeight) + gap;
    const bodyPanelHeight = (bodyLines.length * bodyLineHeight) + (bodyLines.length ? (collage ? 42 : 34) : 0);
    layout = {
      art_direction: direction.id,
      layout_variant: productVisual
        ? `${direction.id}_PRODUCT_LEFT_COLUMN`
        : vertical ? `${direction.id}_VERTICAL_SAFE` : direction.id,
      surface_kind: collage ? "separate_torn_paper_and_color_fields" : "unboxed_editorial_column",
      margin,
      safe_area: { top: safeTop, right: margin, bottom: safeBottom, left: margin },
      card: null,
      content: { x: margin, y: contentTop, width: contentWidth, height: maximumContentHeight },
      headline_panel: { x: margin - (collage ? 22 : 0), y: contentTop - (collage ? 44 : 0), width: contentWidth + (collage ? 48 : 0), height: headlinePanelHeight },
      body_panel: { x: margin, y: bodyPanelTop - (collage ? 10 : 6), width: contentWidth, height: bodyPanelHeight },
      headline_font_size: headlineSize,
      headline_line_height: headlineLineHeight,
      headline_lines: headlineLines,
      body_font_size: bodySize,
      body_line_height: bodyLineHeight,
      body_lines: bodyLines,
      gap,
      used_height: usedHeight,
      has_copy: headlineLines.length > 0 || bodyLines.length > 0,
      within_safe_area: usedHeight <= maximumContentHeight,
      logo: { left: margin, top: vertical ? 176 : 58, width: vertical ? 270 : 220 },
      sequence: { x: width - margin, y: vertical ? 250 : 104 },
    };
    if (layout.within_safe_area) break;
    if (headlineSize > minimumHeadlineSize) headlineSize -= 4;
    if (bodySize > minimumBodySize) bodySize -= 2;
  }
  return layout;
}

function buildBrandBaseSvg({ width, height, hasBaseImage, artDirection = "EDITORIAL_ICON_GRID" }) {
  const { palette } = BRAND;
  const direction = resolvePinkPaisaArtDirection({}, artDirection);
  const collage = direction.id === "BOLD_EDITORIAL_COLLAGE";
  const background = hasBaseImage
    ? collage
      ? `<rect width="${width}" height="${height}" fill="${palette.ink}" fill-opacity="0.05" />
         <path d="M0 0 H${Math.round(width * 0.22)} L${Math.round(width * 0.12)} ${Math.round(height * 0.2)} H0 Z" fill="#D4145A" fill-opacity="0.12" />
         <path d="M${width} ${Math.round(height * 0.72)} V${height} H${Math.round(width * 0.76)} Z" fill="#F05A47" fill-opacity="0.12" />`
      : `<rect width="${width}" height="${height}" fill="url(#editorialReadability)" />
         <rect width="${width}" height="${height}" fill="${palette.ink}" fill-opacity="0.025" />`
    : collage
      ? `<rect width="${width}" height="${height}" fill="url(#collageGradient)" />`
      : `<rect width="${width}" height="${height}" fill="url(#brandGradient)" />`;
  return Buffer.from(`<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="brandGradient" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${palette.cream}" />
        <stop offset="54%" stop-color="${palette.blush}" />
        <stop offset="100%" stop-color="${palette.sage}" />
      </linearGradient>
      <linearGradient id="editorialReadability" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="${palette.cream}" stop-opacity="0.94" />
        <stop offset="58%" stop-color="${palette.cream}" stop-opacity="0.76" />
        <stop offset="82%" stop-color="${palette.cream}" stop-opacity="0.12" />
        <stop offset="100%" stop-color="${palette.cream}" stop-opacity="0" />
      </linearGradient>
      <linearGradient id="collageGradient" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#4A071F" />
        <stop offset="52%" stop-color="#B80F4D" />
        <stop offset="100%" stop-color="#F05A47" />
      </linearGradient>
    </defs>
    ${background}
  </svg>`);
}

function svgTextLines({ lines, x, y, lineHeight, fontSize, fontFamily, color, fontWeight = 400 }) {
  return lines.map((line, index) => (
    `<text x="${x}" y="${y + (index * lineHeight)}" fill="${color}" font-size="${fontSize}" font-weight="${fontWeight}" font-family="${fontFamily}">${escapeXml(line)}</text>`
  )).join("");
}

function buildEditorialOverlay({ width, height, layout, sequenceLabel }) {
  const { palette, fonts } = BRAND;
  const content = layout.content;
  const headlineStart = content.y + layout.headline_font_size;
  const bodyStart = content.y
    + (layout.headline_lines.length * layout.headline_line_height)
    + layout.gap
    + layout.body_font_size;
  const copy = layout.has_copy ? `
    <rect x="${content.x}" y="${content.y - 34}" width="96" height="8" fill="${palette.rose}" />
    <rect x="${content.x - 20}" y="${content.y - 34}" width="6" height="${Math.max(layout.used_height + 44, 120)}" fill="${palette.rose}" fill-opacity="0.9" />
    ${svgTextLines({
      lines: layout.headline_lines,
      x: content.x,
      y: headlineStart,
      lineHeight: layout.headline_line_height,
      fontSize: layout.headline_font_size,
      fontFamily: fonts.heading,
      color: palette.ink,
      fontWeight: 700,
    })}
    ${layout.body_lines.length ? `<rect x="${layout.body_panel.x - 14}" y="${layout.body_panel.y}" width="${layout.body_panel.width + 28}" height="${layout.body_panel.height}" rx="12" fill="${palette.cream}" fill-opacity="0.82" stroke="${palette.rose}" stroke-opacity="0.55" stroke-width="2" />` : ""}
    ${svgTextLines({
      lines: layout.body_lines,
      x: content.x,
      y: bodyStart,
      lineHeight: layout.body_line_height,
      fontSize: layout.body_font_size,
      fontFamily: fonts.body,
      color: palette.plum,
      fontWeight: 600,
    })}` : "";
  const sequenceMarkup = sequenceLabel ? `
    <rect x="${layout.sequence.x - 72}" y="${layout.sequence.y - 34}" width="72" height="44" fill="${palette.rose}" />
    <text x="${layout.sequence.x - 14}" y="${layout.sequence.y - 3}" text-anchor="end" fill="${palette.paper}" font-size="24" font-weight="700" font-family="${fonts.body}">${sequenceLabel}</text>` : "";
  return `${copy}${sequenceMarkup}`;
}

function tornPanelPath({ x, y, width, height }) {
  return [
    `M ${x + 12} ${y}`,
    `L ${x + Math.round(width * 0.34)} ${y + 8}`,
    `L ${x + Math.round(width * 0.68)} ${y - 4}`,
    `L ${x + width} ${y + 13}`,
    `L ${x + width - 9} ${y + Math.round(height * 0.46)}`,
    `L ${x + width + 2} ${y + height - 11}`,
    `L ${x + Math.round(width * 0.62)} ${y + height}`,
    `L ${x + Math.round(width * 0.28)} ${y + height - 7}`,
    `L ${x} ${y + height + 2}`,
    `L ${x + 8} ${y + Math.round(height * 0.52)}`,
    "Z",
  ].join(" ");
}

function buildCollageOverlay({ width, height, layout, sequenceLabel }) {
  const { palette, fonts } = BRAND;
  const content = layout.content;
  const headlineStart = content.y + layout.headline_font_size;
  const bodyStart = content.y
    + (layout.headline_lines.length * layout.headline_line_height)
    + layout.gap
    + layout.body_font_size;
  const headlinePanel = layout.headline_panel;
  const bodyPanel = layout.body_panel;
  const copy = layout.has_copy ? `
    ${layout.headline_lines.length ? `<path d="${tornPanelPath(headlinePanel)}" fill="#FFF4DF" fill-opacity="0.96" stroke="#351927" stroke-opacity="0.2" stroke-width="2" />` : ""}
    <path d="M ${headlinePanel.x + 18} ${headlinePanel.y + 22} L ${headlinePanel.x + 108} ${headlinePanel.y + 8}" stroke="#D4145A" stroke-width="10" />
    ${svgTextLines({
      lines: layout.headline_lines,
      x: content.x,
      y: headlineStart,
      lineHeight: layout.headline_line_height,
      fontSize: layout.headline_font_size,
      fontFamily: fonts.body,
      color: palette.ink,
      fontWeight: 800,
    })}
    ${layout.body_lines.length ? `<path d="M ${bodyPanel.x - 14} ${bodyPanel.y - 8} L ${bodyPanel.x + bodyPanel.width + 18} ${bodyPanel.y + 2} L ${bodyPanel.x + bodyPanel.width + 5} ${bodyPanel.y + bodyPanel.height + 8} L ${bodyPanel.x - 4} ${bodyPanel.y + bodyPanel.height - 2} Z" fill="#B80F4D" fill-opacity="0.97" />` : ""}
    ${svgTextLines({
      lines: layout.body_lines,
      x: content.x + 8,
      y: bodyStart,
      lineHeight: layout.body_line_height,
      fontSize: layout.body_font_size,
      fontFamily: fonts.body,
      color: palette.paper,
      fontWeight: 700,
    })}` : "";
  const sequenceMarkup = sequenceLabel ? `
    <circle cx="${layout.sequence.x - 28}" cy="${layout.sequence.y - 8}" r="34" fill="#D4145A" stroke="#FFF4DF" stroke-width="4" />
    <text x="${layout.sequence.x - 28}" y="${layout.sequence.y}" text-anchor="middle" fill="#FFF4DF" font-size="22" font-weight="800" font-family="${fonts.body}">${sequenceLabel}</text>` : "";
  return `${copy}${sequenceMarkup}`;
}

function buildCopyOverlaySvg({ width, height, layout, sequence, total, artDirection = "EDITORIAL_ICON_GRID" }) {
  const direction = resolvePinkPaisaArtDirection({}, artDirection);
  const sequenceLabel = total > 1 ? `${sequence}/${total}` : "";
  const markup = direction.id === "BOLD_EDITORIAL_COLLAGE"
    ? buildCollageOverlay({ width, height, layout, sequenceLabel })
    : buildEditorialOverlay({ width, height, layout, sequenceLabel });
  return Buffer.from(`<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" data-art-direction="${direction.id}" data-layout-surface="${layout.surface_kind}">
    ${markup}
  </svg>`);
}

function logoCandidates(explicitPath) {
  return [
    explicitPath,
    process.env.SOCIAL_BRAND_LOGO_PATH,
    path.resolve(__dirname, "..", "..", "frontend-next", "src", "assets", "pink-paisa-logo.png"),
    path.resolve(__dirname, "..", "assets", "pink-paisa-logo.png"),
    path.resolve(__dirname, "..", "uploads", "pink-paisa-logo.png"),
  ].filter(Boolean);
}

async function loadBrandLogo(explicitPath) {
  const logoPath = logoCandidates(explicitPath).find((candidate) => fs.existsSync(candidate));
  if (!logoPath) return null;
  const buffer = await fs.promises.readFile(logoPath);
  return {
    buffer,
    checksum_sha256: sha256(buffer),
    source: path.relative(path.resolve(__dirname, "..", ".."), logoPath).replace(/\\/g, "/"),
  };
}

function parseDataImage(value) {
  const match = String(value || "").match(/^data:image\/(?:png|jpeg|jpg|webp);base64,([a-z0-9+/=]+)$/i);
  if (!match) return null;
  return Buffer.from(match[1], "base64");
}

async function readLocalBaseImage(source) {
  if (Buffer.isBuffer(source)) {
    if (source.length > MAX_BASE_IMAGE_BYTES) throw new Error("Social creative base image exceeds 25 MB");
    return { buffer: source };
  }
  const descriptor = typeof source === "string" ? { path: source } : asPlainObject(source);
  if (Buffer.isBuffer(descriptor.buffer)) {
    if (descriptor.buffer.length > MAX_BASE_IMAGE_BYTES) throw new Error("Social creative base image exceeds 25 MB");
    return { ...descriptor, buffer: descriptor.buffer };
  }

  const dataBuffer = parseDataImage(descriptor.data_url || descriptor.dataUrl || descriptor.url || descriptor.path);
  if (dataBuffer) {
    if (dataBuffer.length > MAX_BASE_IMAGE_BYTES) throw new Error("Social creative base image exceeds 25 MB");
    return { ...descriptor, buffer: dataBuffer };
  }

  const sourceValue = firstDefined(descriptor, ["file_path", "filePath", "path", "storage_key", "storageKey", "url"]);
  if (!sourceValue) return null;
  let filePath = String(sourceValue);
  if (/^https?:\/\//i.test(filePath) || filePath.replace(/\\/g, "/").includes("uploads/generated/campaigns/")) {
    const reference = getGeneratedCampaignAssetReference(filePath);
    if (!reference) {
      throw new Error("Remote base images must be downloaded and validated by a configured image provider before rendering");
    }
    filePath = reference.filePath;
  }
  const resolvedPath = path.resolve(filePath);
  const uploadRoot = path.resolve(__dirname, "..", "uploads");
  if (resolvedPath !== uploadRoot && !resolvedPath.startsWith(`${uploadRoot}${path.sep}`)) {
    throw new Error("Social creative base image path must be inside the server uploads directory");
  }
  const stats = await fs.promises.stat(resolvedPath);
  if (!stats.isFile()) throw new Error("Social creative base image is not a file");
  if (stats.size > MAX_BASE_IMAGE_BYTES) throw new Error("Social creative base image exceeds 25 MB");
  return { ...descriptor, buffer: await fs.promises.readFile(resolvedPath), file_path: resolvedPath };
}

function baseImageForSequence(options, index) {
  if (Array.isArray(options.baseImages) && options.baseImages[index] !== undefined) return options.baseImages[index];
  if (Array.isArray(options.base_images) && options.base_images[index] !== undefined) return options.base_images[index];
  return firstDefined(options, ["baseImage", "base_image", "baseImageBuffer", "base_image_buffer"]);
}

function expectedProductReferenceUrl(recommendation = {}) {
  const facts = asPlainObject(firstDefined(recommendation, ["verifiedProductFacts", "verified_product_facts"]) || {});
  const content = asPlainObject(firstDefined(recommendation, ["formatContent", "format_content", "contentPackage", "content_package"]) || {});
  const brief = asPlainObject(firstDefined(recommendation, ["visualBrief", "visual_brief"]) || {});
  const authentic = asPlainObject(firstDefined(brief, ["authenticProductReference", "authentic_product_reference"]) || {});
  const urls = [
    firstDefined(facts, ["imageUrl", "image_url", "mediaUrl", "media_url"]),
    firstDefined(content, ["verifiedProductImageUrl", "verified_product_image_url"]),
    firstDefined(authentic, ["imageUrl", "image_url"]),
  ].map(nonEmptyText).filter(Boolean);
  if (new Set(urls).size > 1) {
    const error = new Error("Product image references changed between the approved content and visual brief");
    error.code = "social_product_reference_mismatch";
    throw error;
  }
  return urls[0] || null;
}

function assertOpenAiOriginalBaseImage(baseImage, {
  approvedHeadline = null,
  expectedTextBlocks = [],
  fullAiGraphic = false,
  artworkOnly = false,
  productReferenceUrl = null,
} = {}) {
  if (!baseImage?.buffer || !Buffer.isBuffer(baseImage.buffer)) {
    const error = new Error("An OpenAI-generated original visual is required before exact-copy composition");
    error.code = "ai_base_image_required";
    throw error;
  }
  const provider = String(baseImage.provider || "").trim().toLowerCase();
  const model = nonEmptyText(baseImage.model);
  const prompt = nonEmptyText(baseImage.prompt);
  const responseId = nonEmptyText(baseImage.response_id || baseImage.responseId);
  const status = String(baseImage.status || "").trim().toUpperCase();
  const provenance = normalizeSourceProvenance(baseImage.source_provenance || baseImage.sourceProvenance);
  const sourceUrl = nonEmptyText(baseImage.source_url || baseImage.url);
  const storageProvider = String(baseImage.storage_provider || baseImage.storageProvider || "").trim().toLowerCase();
  const storageKey = nonEmptyText(baseImage.storage_key || baseImage.storageKey);
  const suppliedChecksum = String(baseImage.checksum_sha256 || "").trim().toLowerCase();
  const actualChecksum = sha256(baseImage.buffer);
  const generatedProvenance = ["generated", "generated_from_approved_source", "generated_without_reference"].includes(provenance);
  if (provider !== "openai" || !model || !prompt || !responseId || status !== "VALIDATED" || !generatedProvenance) {
    const error = new Error("Final composition requires a validated original from the configured OpenAI image provider with complete model, prompt, response, and provenance metadata");
    error.code = "social_original_ai_provenance_invalid";
    throw error;
  }
  if (
    !sourceUrl
    || !["local", "external"].includes(storageProvider)
    || !storageKey
    || !/^[a-f0-9]{64}$/.test(suppliedChecksum)
    || suppliedChecksum !== actualChecksum
  ) {
    const error = new Error("The stored OpenAI original visual must have a matching URL, storage key, and SHA-256 checksum");
    error.code = "social_original_ai_provenance_invalid";
    throw error;
  }
  const providerOriginal = asPlainObject(baseImage.provider_original || baseImage.providerOriginal);
  if (Object.keys(providerOriginal).length && (
    providerOriginal.provider !== "openai"
    || providerOriginal.model !== model
    || providerOriginal.response_id !== responseId
    || providerOriginal.byte_preserving !== true
    || !nonEmptyText(providerOriginal.url)
    || !["local", "external"].includes(String(providerOriginal.storage_provider || "").toLowerCase())
    || !nonEmptyText(providerOriginal.storage_key)
    || !/^[a-f0-9]{64}$/.test(String(providerOriginal.checksum_sha256 || ""))
    || !["image/jpeg", "image/png", "image/webp"].includes(providerOriginal.mime_type)
    || Number(providerOriginal.file_size_bytes || 0) < 1
    || Number(providerOriginal.width || 0) < 1
    || Number(providerOriginal.height || 0) < 1
  )) {
    const error = new Error("The retained OpenAI provider-original asset has incomplete byte-preserving provenance");
    error.code = "social_original_ai_provenance_invalid";
    throw error;
  }
  if (productReferenceUrl) {
    const actualReferenceUrl = nonEmptyText(baseImage.reference_image_url || baseImage.referenceImageUrl);
    const authenticReference = asPlainObject(baseImage.authentic_product_reference || baseImage.authenticProductReference);
    const background = asPlainObject(baseImage.ai_background || baseImage.aiBackground);
    const composition = asPlainObject(baseImage.authentic_product_composition || baseImage.authenticProductComposition);
    const referenceChecksum = nonEmptyText(
      baseImage.reference_image_checksum_sha256
      || authenticReference.checksum_sha256,
    )?.toLowerCase();
    if (
      provenance !== "generated_from_approved_source"
      || actualReferenceUrl !== productReferenceUrl
      || authenticReference.original_database_url !== productReferenceUrl
      || authenticReference.database_record_verified !== true
      || !/^[a-f0-9]{64}$/.test(referenceChecksum || "")
      || authenticReference.checksum_sha256 !== referenceChecksum
      || !nonEmptyText(authenticReference.url)
      || !nonEmptyText(authenticReference.storage_key)
      || !["local", "external"].includes(String(authenticReference.storage_provider || "").toLowerCase())
      || !["jpeg", "png", "webp"].includes(String(authenticReference.detected_file_signature || "").toLowerCase())
      || background.provider !== "openai"
      || !nonEmptyText(background.url)
      || !nonEmptyText(background.storage_key)
      || !/^[a-f0-9]{64}$/.test(String(background.checksum_sha256 || ""))
      || background.text_free_product_free_required !== true
      || composition.renderer !== "sharp_authentic_product_composite_v1"
      || composition.source_reference_checksum_sha256 !== referenceChecksum
      || composition.product_pixels_generated_by_ai !== false
      || composition.packaging_editing_performed !== false
      || composition.placement?.occurrence_count !== 1
    ) {
      const error = new Error("The final product creative must preserve the exact verified authentic product reference");
      error.code = "social_product_reference_mismatch";
      throw error;
    }
  }
  if (fullAiGraphic) {
    const contractVersion = Number(baseImage.full_ai_graphic_contract_version
      || baseImage.fullAiGraphicContractVersion
      || baseImage.provenance?.full_ai_graphic_contract_version
      || 0);
    if (contractVersion === 2) {
      const validation = baseImage.poster_validation || baseImage.posterValidation;
      const storedBlocks = baseImage.expected_text_blocks || baseImage.expectedTextBlocks || [];
      const normalization = asPlainObject(baseImage.normalization);
      if (
        stableStringify(storedBlocks) !== stableStringify(expectedTextBlocks)
        || !fullAiPosterValidationPassed(validation, expectedTextBlocks)
        || normalization.renderer !== "sharp_resize_encode_only_v1"
        || normalization.resize_fit !== "fill"
        || normalization.pixel_overlay_applied !== false
        || String(normalization.output_checksum_sha256 || "").toLowerCase() !== actualChecksum
      ) {
        const error = new Error("FULL_AI_GRAPHIC v2 requires a passing independent complete-poster validation and resize/encoding-only normalization");
        error.code = "social_full_ai_graphic_poster_invalid";
        throw error;
      }
    } else {
      const validation = baseImage.text_validation || baseImage.textValidation;
      const observedText = nonEmptyText(validation?.observedText || validation?.observed_text);
      if (
        validation?.decision !== "PASS"
        || validation?.exactHeadlineMatch !== true
        || observedText !== approvedHeadline
      ) {
        const error = new Error("FULL_AI_GRAPHIC requires a passing independent exact-headline validation before final composition");
        error.code = "social_full_ai_graphic_text_invalid";
        throw error;
      }
    }
  }
  if (artworkOnly) {
    const validation = baseImage.artwork_validation || baseImage.artworkValidation;
    const observedText = nonEmptyText(validation?.observedText || validation?.observed_text);
    if (
      validation?.decision !== "PASS"
      || validation?.hasVisibleText !== false
      || validation?.hasLogoOrWatermark !== false
      || validation?.validated_asset !== "openai_provider_original"
      || observedText
    ) {
      const error = new Error("AI_ARTWORK_ONLY requires a passing independent no-text/no-logo validation before final rendering");
      error.code = "social_artwork_only_visual_invalid";
      throw error;
    }
  }
  return {
    actualChecksum,
    provenance,
    sourceUrl,
    storageProvider,
    storageKey,
    fullAiGraphicContractVersion: Number(baseImage.full_ai_graphic_contract_version
      || baseImage.fullAiGraphicContractVersion
      || baseImage.provenance?.full_ai_graphic_contract_version
      || 0),
  };
}

async function renderCanvas({ canvas, baseImage, overlaySvg, logo, layout, artDirection }) {
  const sharp = getSharp();
  const composites = [];
  let pipeline;
  if (baseImage?.buffer) {
    const normalizedBase = await sharp(baseImage.buffer, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize(canvas.width, canvas.height, { fit: "cover", position: "attention" })
      .jpeg({ quality: 92, mozjpeg: true })
      .toBuffer();
    pipeline = sharp(normalizedBase);
    composites.push({ input: buildBrandBaseSvg({ ...canvas, hasBaseImage: true, artDirection }), top: 0, left: 0 });
  } else {
    pipeline = sharp({
      create: {
        width: canvas.width,
        height: canvas.height,
        channels: 4,
        background: BRAND.palette.cream,
      },
    });
    composites.push({ input: buildBrandBaseSvg({ ...canvas, hasBaseImage: false, artDirection }), top: 0, left: 0 });
  }
  composites.push({ input: overlaySvg, top: 0, left: 0 });
  if (logo?.buffer) {
    const logoWidth = layout?.logo?.width || (canvas.height === 1920 ? 270 : 220);
    const logoBuffer = await sharp(logo.buffer, { failOn: "error" })
      .resize({ width: logoWidth, withoutEnlargement: true })
      .png()
      .toBuffer();
    composites.push({
      input: logoBuffer,
      top: layout?.logo?.top ?? (canvas.height === 1920 ? 176 : 58),
      left: layout?.logo?.left ?? 68,
    });
  }
  return pipeline
    .composite(composites)
    .flatten({ background: BRAND.palette.cream })
    .jpeg({ quality: 93, chromaSubsampling: "4:4:4", mozjpeg: true })
    .toBuffer();
}

async function renderArtworkOnlyCanvas({ canvas, baseImage }) {
  if (!baseImage?.buffer || !Buffer.isBuffer(baseImage.buffer)) {
    const error = new Error("AI_ARTWORK_ONLY requires a validated OpenAI original");
    error.code = "ai_base_image_required";
    throw error;
  }
  return getSharp()(baseImage.buffer, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize(canvas.width, canvas.height, { fit: "cover", position: "attention" })
    .jpeg({ quality: 93, chromaSubsampling: "4:4:4", mozjpeg: true })
    .toBuffer();
}

function colorLuminance(hex) {
  const channels = hex.replace("#", "").match(/.{2}/g).map((entry) => parseInt(entry, 16) / 255);
  const normalized = channels.map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return (0.2126 * normalized[0]) + (0.7152 * normalized[1]) + (0.0722 * normalized[2]);
}

function contrastRatio(foreground, background) {
  const first = colorLuminance(foreground);
  const second = colorLuminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function checklistItem(key, label, status, details, required = true) {
  return { key, label, status, required, details: details || null };
}

function manualFlagsForProvenance(provenance, logoAvailable = true, usageRightsStatus = "unknown", artworkOnly = false) {
  const flags = artworkOnly
    ? ["ARTWORK_ONLY_NO_VISIBLE_TEXT_LOGO_OR_WATERMARK"]
    : ["FINAL_MOBILE_READABILITY", "LOGO_APPEARANCE_AND_BRAND_SPELLING"];
  if (!artworkOnly && !logoAvailable) flags.push("MISSING_APPROVED_LOGO_SOURCE");
  if (usageRightsStatus === "unknown") flags.push("UNCONFIRMED_BASE_IMAGE_USAGE_RIGHTS");
  if (provenance !== "brand_template") {
    flags.push(
      "CULTURAL_REPRESENTATION",
      "IRRELEVANT_OR_UNSUPPORTED_VISUAL_CLAIMS",
      "COMPETITOR_BRANDING_LOGOS_OR_WATERMARKS",
      "BASE_IMAGE_CONTAINS_UNAPPROVED_TEXT",
    );
  }
  return Array.from(new Set(flags));
}

function fullAiPosterValidationPassed(validation = {}, expectedTextBlocks = []) {
  const expected = Array.isArray(expectedTextBlocks)
    ? expectedTextBlocks.map((block) => nonEmptyText(block?.text)).filter(Boolean)
    : [];
  const observed = Array.isArray(validation.observedTextBlocks)
    ? validation.observedTextBlocks
    : Array.isArray(validation.observed_text_blocks) ? validation.observed_text_blocks : [];
  return expected.length > 0
    && validation.decision === "PASS"
    && validation.exactTextMatch === true
    && validation.brandIdentityMatch === true
    && validation.mobileLegible === true
    && validation.safeAreaPassed === true
    && validation.unapprovedTextPresent === false
    && validation.unrelatedLogoOrWatermarkPresent === false
    && validation.validated_asset === "openai_normalized_final"
    && JSON.stringify(observed.map(nonEmptyText)) === JSON.stringify(expected)
    && Boolean(nonEmptyText(validation.response_id || validation.responseId));
}

function inferAspectRatio(width, height) {
  if (width === 1080 && height === 1350) return "4:5";
  if (width === 1080 && height === 1080) return "1:1";
  if (width === 1080 && height === 1920) return "9:16";
  return null;
}

async function resolveValidationBuffer(asset, options = {}) {
  if (Buffer.isBuffer(options.buffer)) return options.buffer;
  if (Buffer.isBuffer(asset.buffer)) return asset.buffer;
  const filePath = options.file_path || options.filePath || asset.file_path || asset.filePath;
  if (filePath && fs.existsSync(filePath)) return fs.promises.readFile(filePath);
  const reference = getGeneratedCampaignAssetReference(asset.storage_key || asset.storageKey || asset.url);
  if (reference && fs.existsSync(reference.filePath)) return fs.promises.readFile(reference.filePath);
  return null;
}

async function validateSocialAsset(assetLike, options = {}) {
  const asset = asPlainObject(assetLike);
  const buffer = await resolveValidationBuffer(asset, options);
  let metadata = null;
  if (buffer) metadata = await getSharp()(buffer, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  const width = Number(metadata?.width || asset.width || options.width || 0);
  const height = Number(metadata?.height || asset.height || options.height || 0);
  const aspectRatio = inferAspectRatio(width, height);
  const expectedWidth = Number(options.expectedWidth || options.expected_width || asset.width || width);
  const expectedHeight = Number(options.expectedHeight || options.expected_height || asset.height || height);
  const overlay = asPlainObject(asset.overlay_json || asset.overlayJson || options.overlay_json || {});
  const expectedCopy = options.expectedCopy || options.expected_copy || overlay.approved_copy || {};
  const expectedCopyChecksum = sha256(Buffer.from(stableStringify(expectedCopy), "utf8"));
  const storedCopyChecksum = asset.approved_copy_checksum_sha256 || overlay.approved_copy_checksum_sha256;
  const actualChecksum = buffer ? sha256(buffer) : asset.checksum_sha256 || null;
  const storedChecksum = asset.checksum_sha256 || actualChecksum;
  const copyContainsRupee = stableStringify(expectedCopy).includes("₹");
  const renderedTextContainsRupee = stableStringify(overlay.rendered_text || expectedCopy).includes("₹");
  const minimumContrast = contrastRatio(BRAND.palette.ink, BRAND.palette.paper);
  const manualReviewStatus = options.manualReviewStatus || options.manual_review_status || asset.manual_review_status || "pending";
  const provenance = asset.source_provenance || asset.provenance?.base_image?.source_provenance || "brand_template";
  const fullAiGraphic = asset.visual_mode === "FULL_AI_GRAPHIC";
  const fullAiGraphicV2 = fullAiGraphic && Number(asset.provenance?.full_ai_graphic_contract_version || 0) === 2;
  const artworkOnly = asset.visual_mode === "AI_ARTWORK_ONLY";
  const fullAiTextValidation = overlay.text_rendering?.full_ai_graphic_text_validation
    || asset.provenance?.base_image?.text_validation
    || null;
  const fullAiPosterValidation = overlay.text_rendering?.full_ai_graphic_poster_validation
    || asset.provenance?.base_image?.poster_validation
    || null;
  const fullAiExpectedTextBlocks = overlay.text_rendering?.expected_text_blocks || [];
  const artworkOnlyValidation = overlay.text_rendering?.artwork_only_visual_validation
    || asset.provenance?.base_image?.artwork_validation
    || null;
  const captionPolicy = asset.provenance?.caption_policy || {};
  const storyAsset = asset.social_format === "STORY";
  const storySequence = Number(asset.slide_number || overlay.sequence || 1);
  const storyTotal = Number(overlay.total_assets || 1);
  const storyExpectedBody = [
    expectedCopy.affiliateDisclosure,
    expectedCopy.copy,
    expectedCopy.cta,
    expectedCopy.financialDisclaimer,
  ].map(nonEmptyText).filter(Boolean).join("\n\n");
  const storyFramePolicyPassed = !storyAsset || (
    captionPolicy.method === "story_frame_overlay"
    && captionPolicy.affiliate_disclosure_placement === "first_frame"
    && captionPolicy.cta_placement === "final_frame"
    && captionPolicy.financial_disclaimer_placement === "final_frame"
    && captionPolicy.instagram_caption_used === false
    && nonEmptyText(overlay.rendered_text?.body) === nonEmptyText(storyExpectedBody)
    && (
      storySequence === 1
        ? (!captionPolicy.affiliate_disclosure_required || Boolean(nonEmptyText(expectedCopy.affiliateDisclosure)))
        : !nonEmptyText(expectedCopy.affiliateDisclosure)
    )
    && (
      storySequence === storyTotal
        ? (
          (!captionPolicy.cta_required || Boolean(nonEmptyText(expectedCopy.cta)))
          && (!captionPolicy.financial_disclaimer_required || Boolean(nonEmptyText(expectedCopy.financialDisclaimer)))
        )
        : !nonEmptyText(expectedCopy.cta) && !nonEmptyText(expectedCopy.financialDisclaimer)
    )
  );
  let manualReviewFlags = Array.from(new Set(
    options.manualReviewFlags
    || options.manual_review_flags
    || asset.manual_review_flags
    || manualFlagsForProvenance(
      provenance,
      Boolean(overlay.logo?.source) || (fullAiGraphicV2 && fullAiPosterValidation?.brandIdentityMatch === true),
      asset.usage_rights_status || "unknown",
      artworkOnly,
    ),
  ));
  const checklist = [
    checklistItem(
      "supported_dimensions",
      "Supported Instagram dimensions",
      width === expectedWidth && height === expectedHeight && Boolean(aspectRatio) ? "PASS" : "FAIL",
      `${width || "unknown"}x${height || "unknown"}; expected ${expectedWidth}x${expectedHeight}`,
    ),
    checklistItem(
      "aspect_ratio",
      "Declared aspect ratio matches the rendered file",
      aspectRatio && (!asset.aspect_ratio || asset.aspect_ratio === aspectRatio) ? "PASS" : "FAIL",
      aspectRatio || "Unsupported aspect ratio",
    ),
    checklistItem(
      "checksum",
      "Stored checksum matches the rendered file",
      actualChecksum && storedChecksum === actualChecksum ? "PASS" : "FAIL",
      actualChecksum ? `sha256:${actualChecksum}` : "Rendered file was not available for checksum verification",
    ),
    checklistItem(
      "public_media_reference",
      "Stored media has a public URL and guarded storage key",
      nonEmptyText(asset.url) && nonEmptyText(asset.storage_key || asset.storageKey) ? "PASS" : "FAIL",
      asset.url || "Public media URL is missing",
    ),
    checklistItem(
      "approved_copy_integrity",
      artworkOnly ? "Approved draft copy checksum is retained outside the artwork" : "Overlay copy equals the approved draft copy",
      stableStringify(overlay.approved_copy || {}) === stableStringify(expectedCopy)
        && (!storedCopyChecksum || storedCopyChecksum === expectedCopyChecksum) ? "PASS" : "FAIL",
      `copy sha256:${expectedCopyChecksum}`,
    ),
    checklistItem(
      "programmatic_text_overlay",
      artworkOnly
        ? "Artwork-only final contains no composited overlay pixels"
        : fullAiGraphicV2
          ? "The complete AI-rendered poster text and brand identity were independently validated"
          : fullAiGraphic ? "AI-rendered short headline was independently validated" : "Exact copy was applied programmatically",
      artworkOnly
        ? (
          asset.renderer === "sharp_resize_only"
          && asset.provenance?.overlay?.method === "none"
          && overlay.text_rendering?.method === "none"
          && artworkOnlyValidation?.decision === "PASS"
          && artworkOnlyValidation?.hasVisibleText === false
          && artworkOnlyValidation?.hasLogoOrWatermark === false
          && artworkOnlyValidation?.validated_asset === "openai_provider_original"
            ? "PASS"
            : "FAIL"
        )
        : fullAiGraphicV2
        ? (
          asset.renderer === "openai_generated_graphic_passthrough"
          && asset.provenance?.renderer === "openai_generated_graphic_passthrough"
          && asset.provenance?.overlay?.method === "none"
          && asset.provenance?.overlay?.pixel_overlay_applied === false
          && overlay.text_rendering?.method === "openai_image_baked_in_exact_copy"
          && overlay.text_rendering?.pixel_overlay_applied === false
          && fullAiPosterValidationPassed(fullAiPosterValidation, fullAiExpectedTextBlocks)
            ? "PASS"
            : "FAIL"
        )
        : fullAiGraphic
        ? (
          fullAiTextValidation?.decision === "PASS"
          && fullAiTextValidation?.exactHeadlineMatch === true
          && nonEmptyText(fullAiTextValidation?.observedText || fullAiTextValidation?.observed_text)
            === nonEmptyText(firstDefined(expectedCopy, ["selectedHeadline", "coverHeadline", "headline", "copy"]))
            ? "PASS"
            : "FAIL"
        )
        : (overlay.text_rendering?.method === "sharp_svg_overlay" && overlay.text_rendering?.image_ai_used_for_text === false ? "PASS" : "FAIL"),
      artworkOnly
        ? "AI_ARTWORK_ONLY requires resize/encoding only plus independent zero-text/logo validation"
        : fullAiGraphicV2
          ? "FULL_AI_GRAPHIC v2 requires exact poster validation and zero post-generation pixel overlays"
          : fullAiGraphic ? "FULL_AI_GRAPHIC requires an exact-text validation result" : "Important overlay text was rendered programmatically",
    ),
    checklistItem(
      "safe_area",
      artworkOnly ? "Artwork-only mode has no text safe-area dependency" : "Text remains inside the configured mobile safe area",
      artworkOnly || (fullAiGraphicV2 ? fullAiPosterValidation?.safeAreaPassed === true : overlay.layout?.within_safe_area === true) ? "PASS" : "FAIL",
      artworkOnly
        ? "Not applicable: the final image has no text overlay"
        : fullAiGraphicV2
          ? fullAiPosterValidation?.safeAreaPassed === true ? "Independent poster validation passed" : "AI-rendered text extends outside safe margins"
          : overlay.layout?.within_safe_area === true ? "Calculated text bounds fit" : "Copy needs a shorter layout or manual adjustment",
    ),
    checklistItem(
      "brand_identity",
      artworkOnly ? "No logo or wordmark was composited" : "Approved Pink Paisa identity is present",
      artworkOnly
        ? (!overlay.logo?.source && asset.provenance?.overlay?.method === "none" ? "PASS" : "FAIL")
        : fullAiGraphicV2
          ? (
            overlay.brand_name === BRAND.name
            && overlay.logo?.method === "openai_image_baked_in"
            && !overlay.logo?.source
            && fullAiPosterValidation?.brandIdentityMatch === true
              ? "PASS"
              : "FAIL"
          )
          : (overlay.brand_name === BRAND.name && Boolean(overlay.logo?.source) ? "PASS" : "FAIL"),
      artworkOnly
        ? "Brand identity remains in the caption/account context"
        : fullAiGraphicV2 ? "Pink Paisa identity is baked into and independently validated in the AI image" : overlay.logo?.source || "Approved wordmark was not found",
    ),
    checklistItem(
      "rupee_glyph",
      "The ₹ glyph is preserved when approved copy uses it",
      artworkOnly || fullAiGraphic || !copyContainsRupee || renderedTextContainsRupee ? "PASS" : "FAIL",
      artworkOnly ? "Not applicable: approved copy is not rendered in artwork-only mode" : copyContainsRupee ? "Approved copy contains ₹" : "Approved copy does not use ₹",
    ),
    checklistItem(
      "contrast",
      "Overlay text contrast meets the WCAG AA reference threshold",
      artworkOnly || (fullAiGraphicV2 ? fullAiPosterValidation?.mobileLegible === true : minimumContrast >= 4.5) ? "PASS" : "FAIL",
      artworkOnly
        ? "Not applicable: the final image has no text overlay"
        : fullAiGraphicV2 ? "Independent mobile-legibility validation" : `Reference contrast ${minimumContrast.toFixed(2)}:1`,
    ),
  ];

  if (fullAiGraphicV2) {
    const baseChecksum = String(asset.provenance?.base_image?.checksum_sha256 || "").toLowerCase();
    checklist.push(checklistItem(
      "no_post_generation_pixel_overlay",
      "Final bytes are the normalized OpenAI graphic with no post-generation pixel overlay",
      asset.provenance?.overlay?.method === "none"
        && asset.provenance?.overlay?.pixel_overlay_applied === false
        && /^[a-f0-9]{64}$/.test(baseChecksum)
        && baseChecksum === String(storedChecksum || "").toLowerCase()
        ? "PASS"
        : "FAIL",
      baseChecksum ? `normalized/final sha256:${baseChecksum}` : "Normalized OpenAI checksum is missing",
    ));
  }

  if (storyAsset) {
    checklist.push(checklistItem(
      "story_frame_disclosure_policy",
      "Story disclosure and action copy is rendered on the required first/final frames",
      storyFramePolicyPassed ? "PASS" : "FAIL",
      storyFramePolicyPassed
        ? `Frame ${storySequence} of ${storyTotal} matches the captionless Story policy`
        : "Story assets must put affiliate disclosure on frame one and CTA/general disclaimer on the final frame",
    ));
  }

  const productReference = Array.isArray(asset.reference_assets)
    ? asset.reference_assets.find((reference) => reference?.reference_type === "PRODUCT_IMAGE")
    : null;
  if (productReference) {
    const composition = asset.provenance?.base_image?.authentic_product_composition || {};
    const referenceMetadata = asset.provenance?.base_image?.authentic_product_reference || {};
    const authenticContractPassed = productReference.database_record_verified === true
      && productReference.source_bytes_preserved === true
      && productReference.authenticity_must_be_preserved === true
      && /^[a-f0-9]{64}$/.test(String(productReference.checksum_sha256 || ""))
      && referenceMetadata.checksum_sha256 === productReference.checksum_sha256
      && composition.source_reference_checksum_sha256 === productReference.checksum_sha256
      && composition.renderer === "sharp_authentic_product_composite_v1"
      && composition.product_pixels_generated_by_ai === false
      && composition.packaging_editing_performed === false
      && composition.placement?.occurrence_count === 1;
    checklist.push(checklistItem(
      "authentic_product_composite",
      "Verified database product was composited locally without generative editing",
      authenticContractPassed ? "PASS" : "FAIL",
      authenticContractPassed
        ? `reference sha256:${productReference.checksum_sha256}; one guarded local placement; human authenticity review required`
        : "The verified product-reference, checksum, or guarded local-composition contract is incomplete",
    ));
  }

  if (manualReviewStatus === "approved") {
    manualReviewFlags = [];
    checklist.push(checklistItem("manual_visual_review", "Human visual safety review", "PASS", "Approved by an authorized reviewer"));
  } else if (manualReviewStatus === "rejected") {
    checklist.push(checklistItem("manual_visual_review", "Human visual safety review", "FAIL", "Rejected during manual review"));
  } else {
    checklist.push(checklistItem(
      "manual_visual_review",
      "Human visual safety review",
      "MANUAL_REVIEW",
      manualReviewFlags.join(", "),
    ));
  }

  const failed = checklist.some((item) => item.status === "FAIL" && item.required);
  const manualReviewRequired = !failed && manualReviewStatus !== "approved" && manualReviewFlags.length > 0;
  return {
    passed: !failed,
    ready_for_approval: !failed && !manualReviewRequired,
    validation_status: failed ? "invalid" : manualReviewRequired ? "needs_manual_review" : "valid",
    validation_checklist: checklist,
    manual_review_required: manualReviewRequired,
    manual_review_flags: manualReviewFlags,
    checksum_sha256: actualChecksum,
    dimensions: { width, height },
    aspect_ratio: aspectRatio,
  };
}

function getDraftIdentity(draft, recommendation, options = {}) {
  const source = asPlainObject(draft);
  const rawId = firstDefined(source, ["_id", "id", "draft_id"]);
  const rawRunId = firstDefined(source, ["generation_run_id", "generationRunId"]);
  const draftKey = String(
    options.draftKey
    || options.draft_key
    || rawId
    || firstDefined(source, ["idempotency_key", "idempotencyKey"])
    || `${firstDefined(source, ["generation_date", "generationDate"]) || "undated"}-${recommendation.topic || recommendation.internalTitle || "draft"}`,
  );
  return { rawId, rawRunId, draftKey };
}

function objectIdOrNull(value, AssetModel = SocialAsset) {
  const candidate = value && typeof value === "object" && value._id ? value._id : value;
  const ObjectId = AssetModel?.base?.Types?.ObjectId;
  if (!candidate || !ObjectId || !ObjectId.isValid(candidate)) return null;
  return candidate;
}

function assetTypeFor(socialFormat, canvasFormat) {
  if (socialFormat === "CAROUSEL") return "carousel_slide";
  if (socialFormat === "STORY") return "story_frame";
  if (["REEL", "VIDEO_FEED"].includes(socialFormat)) return "reel_cover";
  if (canvasFormat === "SQUARE_1_1") return "square_post";
  return "feed_post";
}

function serializeAssetDocument(document, fallback) {
  if (!document) return fallback;
  const value = typeof document.toObject === "function" ? document.toObject() : document;
  return { ...fallback, id: String(value._id || value.id || ""), _id: value._id || undefined };
}

async function renderSocialDraftAssets(draftLike, options = {}) {
  const draft = asPlainObject(draftLike);
  const recommendation = selectRecommendation(draft, options);
  const genericFormatOption = options.format;
  const socialFormat = normalizeSocialFormat(
    options.socialFormat
    || options.social_format
    || (isSocialFormatValue(genericFormatOption) ? genericFormatOption : null)
    || recommendation.format,
  );
  const aspectRatio = options.aspectRatio
    || options.aspect_ratio
    || firstDefined(asPlainObject(firstDefined(recommendation, ["visualConcept", "visual_concept"])), ["aspectRatio", "aspect_ratio"]);
  const canvas = normalizeCanvas(
    options.canvasFormat
    || options.canvas_format
    || options.dimensions
    || options.size
    || (!isSocialFormatValue(genericFormatOption) ? genericFormatOption : null)
    || aspectRatio,
    socialFormat,
  );
  const renderItems = buildRenderItems(recommendation, socialFormat);
  const version = createCampaignAssetVersion();
  const identity = getDraftIdentity(draft, recommendation, options);
  const assetGroupId = String(options.assetGroupId || options.asset_group_id || `${identity.draftKey}-${version}`);
  const AssetModel = options.assetModel || options.asset_model || SocialAsset;
  const shouldPersist = options.persist !== false;
  const templateFlag = options.allowTemplateOnly === true || options.allow_template_only === true;
  const manualTemplateMode = options.manualTemplateMode === true || options.manual_template_mode === true;
  if (templateFlag && !manualTemplateMode) {
    const error = new Error("Template-only rendering requires an explicit administrator manual-template mode");
    error.code = "manual_template_explicit_mode_required";
    throw error;
  }
  if (manualTemplateMode && !nonEmptyText(options.templateReason || options.template_reason)) {
    const error = new Error("Emergency manual-template mode requires an explicit administrator reason");
    error.code = "manual_template_reason_required";
    throw error;
  }
  const allowTemplateOnly = manualTemplateMode;
  const visualMode = allowTemplateOnly
    ? "MANUAL_TEMPLATE"
    : String(options.visualMode || options.visual_mode || recommendation.visualBrief?.visualMode || recommendation.visual_brief?.visualMode || "AI_VISUAL_WITH_EXACT_OVERLAY").toUpperCase();
  if (!["AI_VISUAL_WITH_EXACT_OVERLAY", "AI_ARTWORK_ONLY", "FULL_AI_GRAPHIC", "MANUAL_TEMPLATE"].includes(visualMode)) {
    const error = new Error(`Unsupported social visual mode: ${visualMode}`);
    error.code = "social_visual_mode_unsupported";
    throw error;
  }
  if (!allowTemplateOnly) assertSocialVisualModeEligible({ visualMode, recommendation });
  const fullAiGraphic = visualMode === "FULL_AI_GRAPHIC";
  const artworkOnly = visualMode === "AI_ARTWORK_ONLY";
  const artDirection = resolvePinkPaisaArtDirection(
    recommendation,
    options.artDirection || options.art_direction,
  );
  const artDirectionRecord = serializePinkPaisaArtDirection(artDirection);
  const logo = artworkOnly ? null : await loadBrandLogo(options.logoPath || options.logo_path);
  const captionContract = buildSocialCaptionContract(recommendation);
  const captionPolicy = {
    method: socialFormat === "STORY" ? "story_frame_overlay" : "instagram_caption_only",
    component_order: captionContract.component_order,
    cta_placement: socialFormat === "STORY" ? "final_frame" : "caption_only",
    affiliate_disclosure_placement: socialFormat === "STORY" ? "first_frame" : "caption_only",
    financial_disclaimer_placement: socialFormat === "STORY" ? "final_frame" : "caption_only",
    affiliate_disclosure_required: Boolean(captionContract.components.affiliate_disclosure),
    cta_required: true,
    financial_disclaimer_required: Boolean(captionContract.components.financial_disclaimer),
    instagram_caption_used: socialFormat !== "STORY",
    caption_checksum_sha256: socialFormat === "STORY" ? null : captionContract.checksum_sha256,
    caption_contract_valid: captionContract.valid,
    caption_contract_violations: captionContract.violations,
  };
  const sourceProvenance = normalizeSourceProvenance(
    options.sourceProvenance
    || options.source_provenance
    || (allowTemplateOnly ? "brand_template" : "generated_without_reference"),
  );
  const configuredUsageRights = options.usageRightsStatus || options.usage_rights_status
    ? normalizeUsageRights(options.usageRightsStatus || options.usage_rights_status)
    : null;
  const productReferenceUrl = expectedProductReferenceUrl(recommendation);
  const productVisual = socialFormat === "PRODUCT_FEATURE"
    || Boolean(nonEmptyText(recommendation.verifiedProductId || recommendation.verified_product_id));
  if (!allowTemplateOnly && productVisual && !productReferenceUrl) {
    const error = new Error("A verified authentic product image is required for this product creative");
    error.code = "reference_image_required";
    throw error;
  }
  const suppliedBaseImages = Array.isArray(options.baseImages)
    ? options.baseImages
    : Array.isArray(options.base_images) ? options.base_images : null;
  if (!allowTemplateOnly && renderItems.length > 1 && (!suppliedBaseImages || suppliedBaseImages.length !== renderItems.length)) {
    const error = new Error(`This ${socialFormat} requires one distinct OpenAI original for each of its ${renderItems.length} final assets`);
    error.code = "social_original_visual_count_invalid";
    throw error;
  }
  if (socialFormat === "CAROUSEL" && (renderItems.length < 3 || renderItems.length > 7)) {
    const error = new Error("Carousel composition requires three to seven approved slides and original visuals");
    error.code = "social_carousel_visual_count_invalid";
    throw error;
  }
  const originalChecksums = new Set();
  const storeAsset = options.storeCampaignAsset || options.store_campaign_asset || storeCampaignAsset;
  const results = [];

  for (let index = 0; index < renderItems.length; index += 1) {
    const item = renderItems[index];
    const baseImage = await readLocalBaseImage(baseImageForSequence(options, index));
    const fullAiGraphicV2 = fullAiGraphic && Number(
      baseImage?.full_ai_graphic_contract_version
      || baseImage?.fullAiGraphicContractVersion
      || baseImage?.provenance?.full_ai_graphic_contract_version
      || 0,
    ) === 2;
    const expectedFullAiTextBlocks = fullAiGraphicV2
      ? fullAiTextBlocksForRenderItem(item, renderItems.length)
      : [];
    if (!baseImage && !allowTemplateOnly) {
      const error = new Error("An OpenAI-generated original visual is required before exact-copy composition");
      error.code = "ai_base_image_required";
      throw error;
    }
    let validatedOriginal = null;
    if (baseImage && !allowTemplateOnly) {
      validatedOriginal = assertOpenAiOriginalBaseImage(baseImage, {
        approvedHeadline: item.headline,
        expectedTextBlocks: expectedFullAiTextBlocks,
        fullAiGraphic,
        artworkOnly,
        productReferenceUrl,
      });
      if (socialFormat === "CAROUSEL" && originalChecksums.has(validatedOriginal.actualChecksum)) {
        const error = new Error("Every carousel slide requires a distinct OpenAI-generated original visual");
        error.code = "social_carousel_original_duplicate";
        throw error;
      }
      originalChecksums.add(validatedOriginal.actualChecksum);
    }
    const baseProvenance = firstDefined(baseImage || {}, ["source_provenance", "sourceProvenance"])
      || (typeof baseImage?.provenance === "string" ? baseImage.provenance : null);
    const effectiveProvenance = baseImage
      ? normalizeSourceProvenance(baseProvenance || (sourceProvenance === "brand_template" ? "admin_provided" : sourceProvenance))
      : "brand_template";
    const baseUsageRights = firstDefined(baseImage || {}, ["usage_rights_status", "usageRightsStatus", "rights_status", "rightsStatus"]);
    const effectiveUsageRights = normalizeUsageRights(
      baseUsageRights || configuredUsageRights || (baseImage ? "unknown" : "owned"),
    );
    const layout = artworkOnly || fullAiGraphicV2
      ? {
        safe_area: null,
        card: null,
        content: null,
        headline_lines: [],
        body_lines: [],
        has_copy: false,
        within_safe_area: true,
      }
      : calculateTextLayout({
        ...canvas,
        headline: fullAiGraphic ? null : item.headline,
        body: fullAiGraphic ? null : item.body,
        artDirection: artDirection.id,
        socialFormat,
        productVisual,
      });
    const approvedCopyChecksum = sha256(Buffer.from(stableStringify(item.approved_copy), "utf8"));
    const overlayJson = {
      schema_version: 1,
      brand_name: artworkOnly ? null : BRAND.name,
      art_direction: artDirectionRecord,
      approved_copy: item.approved_copy,
      approved_copy_checksum_sha256: approvedCopyChecksum,
      copy_source_path: item.source_path,
      rendered_text: fullAiGraphicV2 ? item.approved_copy : {
        headline: artworkOnly ? null : item.headline,
        body: artworkOnly || fullAiGraphic ? null : item.body,
        headline_lines: layout.headline_lines,
        body_lines: layout.body_lines,
      },
      ...(fullAiGraphicV2 ? { rendered_text_blocks: expectedFullAiTextBlocks } : {}),
      text_rendering: fullAiGraphicV2 ? {
        method: "openai_image_baked_in_exact_copy",
        image_ai_used_for_text: true,
        pixel_overlay_applied: false,
        copy_source: item.source_path,
        expected_text_blocks: expectedFullAiTextBlocks,
        full_ai_graphic_poster_validation: baseImage?.poster_validation || null,
        exact_copy_preserved_in_overlay_json: true,
      } : {
        method: artworkOnly ? "none" : fullAiGraphic ? "openai_image_with_validated_short_headline" : "sharp_svg_overlay",
        image_ai_used_for_text: fullAiGraphic,
        full_ai_graphic_text_validation: fullAiGraphic ? baseImage?.text_validation || null : null,
        artwork_only_visual_validation: artworkOnly ? baseImage?.artwork_validation || null : null,
        exact_copy_preserved_in_overlay_json: true,
      },
      typography: BRAND.fonts,
      palette: BRAND.palette,
      layout,
      logo: fullAiGraphicV2
        ? { method: "openai_image_baked_in", source: null, image_ai_used_for_logo: true }
        : logo ? { source: logo.source, checksum_sha256: logo.checksum_sha256 } : { source: null },
      sequence: item.sequence,
      total_assets: renderItems.length,
    };
    const overlaySvg = artworkOnly || fullAiGraphicV2 ? null : buildCopyOverlaySvg({
      ...canvas,
      layout,
      sequence: item.sequence,
      total: renderItems.length,
      artDirection: artDirection.id,
    });
    const buffer = fullAiGraphicV2
      ? Buffer.from(baseImage.buffer)
      : artworkOnly
      ? await renderArtworkOnlyCanvas({ canvas, baseImage })
      : await renderCanvas({ canvas, baseImage, overlaySvg, logo, layout, artDirection: artDirection.id });
    const baseImageChecksum = validatedOriginal?.actualChecksum || (baseImage?.buffer ? sha256(baseImage.buffer) : null);
    const providerOriginal = asPlainObject(baseImage?.provider_original || baseImage?.providerOriginal);
    const retainedOriginalVisual = nonEmptyText(providerOriginal.url)
      ? {
        url: providerOriginal.url,
        storage_provider: providerOriginal.storage_provider,
        storage_key: providerOriginal.storage_key,
        checksum_sha256: providerOriginal.checksum_sha256,
        mime_type: providerOriginal.mime_type,
        file_size_bytes: providerOriginal.file_size_bytes,
        width: providerOriginal.width,
        height: providerOriginal.height,
      }
      : (baseImage && validatedOriginal ? {
        url: validatedOriginal.sourceUrl,
        storage_provider: validatedOriginal.storageProvider,
        storage_key: validatedOriginal.storageKey,
        checksum_sha256: validatedOriginal.actualChecksum,
        mime_type: baseImage.mime_type || "image/jpeg",
        file_size_bytes: Math.max(Number(baseImage.file_size_bytes || baseImage.buffer?.length || 0), 1),
        width: Number(baseImage.width || canvas.width),
        height: Number(baseImage.height || canvas.height),
      } : null);
    const fullAiManifestChecksum = fullAiGraphicV2
      ? sha256(Buffer.from(stableStringify(expectedFullAiTextBlocks), "utf8"))
      : null;
    const effectiveRenderer = fullAiGraphicV2
      ? "openai_generated_graphic_passthrough"
      : artworkOnly ? "sharp_resize_only" : "sharp_svg_overlay";
    const effectiveRenderVersion = fullAiGraphicV2
      ? "social-full-ai-graphic-native-v2"
      : RENDER_VERSION;
    const provenance = {
      renderer: effectiveRenderer,
      render_version: effectiveRenderVersion,
      ...(fullAiGraphicV2 ? {
        full_ai_graphic_contract_version: 2,
        full_ai_graphic_manifest: {
          contract_version: 2,
          expected_text_blocks: expectedFullAiTextBlocks,
          checksum_sha256: fullAiManifestChecksum,
          approved_copy_checksum_sha256: approvedCopyChecksum,
        },
      } : {}),
      base_image: {
        type: baseImage
          ? (fullAiGraphicV2
            ? "openai_generated_complete_graphic"
            : productReferenceUrl ? "openai_background_with_authentic_product_composite" : "openai_generated_original_visual")
          : "manual_emergency_brand_template",
        source_provenance: effectiveProvenance,
        source_url: baseImage?.source_url || baseImage?.url || null,
        checksum_sha256: baseImageChecksum,
        provider: baseImage ? (baseImage.provider || options.imageProvider || options.image_provider || null) : null,
        model: baseImage ? (baseImage.model || options.imageModel || options.image_model || null) : null,
        prompt: baseImage ? (baseImage.prompt || options.imagePrompt || options.image_prompt || null) : null,
        response_id: baseImage?.response_id || baseImage?.responseId || null,
        attempt_count: Number(baseImage?.attempt_count || baseImage?.attemptCount || 0) || null,
        generation_status: baseImage ? "VALIDATED" : null,
        original_asset_url: retainedOriginalVisual?.url || null,
        normalized_asset_url: baseImage?.source_url || baseImage?.url || null,
        normalized_asset_storage_provider: baseImage?.storage_provider || baseImage?.storageProvider || null,
        normalized_asset_storage_key: baseImage?.storage_key || baseImage?.storageKey || null,
        reference_image_url: baseImage?.reference_image_url || baseImage?.referenceImageUrl || null,
        reference_image_checksum_sha256: baseImage?.reference_image_checksum_sha256 || null,
        ai_background: baseImage?.ai_background || baseImage?.aiBackground || null,
        authentic_product_reference: baseImage?.authentic_product_reference || baseImage?.authenticProductReference || null,
        authentic_product_composition: baseImage?.authentic_product_composition || baseImage?.authenticProductComposition || null,
        contains_approved_copy_by_design: fullAiGraphic,
        text_validation: baseImage?.text_validation || null,
        poster_validation: fullAiGraphicV2 ? baseImage?.poster_validation || null : null,
        artwork_validation: baseImage?.artwork_validation || null,
        perceptual_hash_64: baseImage?.perceptual_hash_64 || baseImage?.perceptualHash64 || null,
        provider_original: baseImage?.provider_original || baseImage?.providerOriginal || null,
        normalization: baseImage?.normalization || null,
        creative_style: baseImage?.art_direction || artDirectionRecord,
      },
      image_generation_attempt: !baseImage && allowTemplateOnly
        ? {
          provider: null,
          model: null,
          fallback_to_brand_template: false,
          manual_template_mode: true,
          sanitized_error: sanitizedMetadataError(options.templateReason || options.template_reason),
        }
        : null,
      overlay: {
        method: artworkOnly || fullAiGraphicV2 ? "none" : fullAiGraphic ? "sharp_branded_finish_after_validated_ai_headline" : "sharp_svg_overlay",
        copy_source: artworkOnly ? null : item.source_path,
        approved_copy_checksum_sha256: approvedCopyChecksum,
        image_ai_used_for_text: fullAiGraphic,
        ...(fullAiGraphicV2 ? { pixel_overlay_applied: false } : {}),
        creative_style: artworkOnly ? null : artDirectionRecord,
        layout_variant: artworkOnly ? null : layout.layout_variant,
        decorative_elements: artworkOnly || fullAiGraphicV2 ? "none" : "sharp_svg_nontext_v1",
      },
      creative_style: artDirectionRecord,
      caption_policy: captionPolicy,
      logo: fullAiGraphicV2
        ? { method: "openai_image_baked_in", source: null }
        : logo ? { source: logo.source, checksum_sha256: logo.checksum_sha256 } : null,
      ...(fullAiGraphicV2 ? {
        final_pixel_contract: {
          method: "normalized_ai_bytes_passthrough",
          normalized_checksum_sha256: baseImageChecksum,
          final_checksum_sha256: baseImageChecksum,
          pixel_overlay_applied: false,
        },
      } : {}),
    };
    const fileName = `${slugify(identity.draftKey)}-${version}-${canvas.aspect_ratio.replace(":", "x")}-${String(index + 1).padStart(2, "0")}.jpg`;
    const stored = await storeAsset({ fileName, buffer });
    const finalChecksum = sha256(buffer);
    const storedChecksum = String(stored?.checksum_sha256 || "").trim().toLowerCase();
    const finalStorageProvider = String(stored?.storage_provider || "").trim().toLowerCase();
    if (!nonEmptyText(stored?.url) || !nonEmptyText(stored?.storage_key)) {
      const error = new Error("Final social asset storage did not return a URL and storage key");
      error.code = "social_final_asset_storage_invalid";
      throw error;
    }
    if (!["local", "external"].includes(finalStorageProvider)) {
      const error = new Error("Final social asset storage returned an unsupported provider");
      error.code = "social_final_asset_storage_invalid";
      throw error;
    }
    if (/^[a-f0-9]{64}$/.test(storedChecksum) && storedChecksum !== finalChecksum) {
      const error = new Error("Stored final social asset checksum does not match the composed image bytes");
      error.code = "social_final_asset_storage_invalid";
      throw error;
    }
    const preliminaryAsset = {
      draft_key: identity.draftKey,
      asset_group_id: assetGroupId,
      version,
      asset_type: assetTypeFor(socialFormat, canvas.canvas_format),
      social_format: socialFormat,
      media_kind: "IMAGE",
      publication_role: ["REEL", "VIDEO_FEED"].includes(socialFormat) ? "COVER" : "PRIMARY_MEDIA",
      canvas_format: canvas.canvas_format,
      slide_number: item.sequence,
      url: stored.url,
      file_path: stored.file_path,
      storage_provider: finalStorageProvider,
      storage_key: stored.storage_key,
      checksum_sha256: finalChecksum,
      perceptual_hash_64: baseImage?.perceptual_hash_64 || baseImage?.perceptualHash64 || null,
      mime_type: "image/jpeg",
      file_size_bytes: buffer.length,
      width: canvas.width,
      height: canvas.height,
      dimensions: { width: canvas.width, height: canvas.height },
      aspect_ratio: canvas.aspect_ratio,
      renderer: effectiveRenderer,
      asset_role: "FINAL_COMPOSED",
      visual_mode: visualMode,
      render_version: effectiveRenderVersion,
      overlay_json: overlayJson,
      approved_copy_checksum_sha256: approvedCopyChecksum,
      provenance,
      source_provenance: effectiveProvenance,
      usage_rights_status: effectiveUsageRights,
      original_asset_url: retainedOriginalVisual?.url || null,
      image_generation_status: baseImage ? "VALIDATED" : "NOT_APPLICABLE",
      image_provider: baseImage ? (baseImage.provider || options.imageProvider || options.image_provider || null) : null,
      image_model: baseImage ? (baseImage.model || options.imageModel || options.image_model || null) : null,
      provider_response_id: baseImage?.response_id || baseImage?.responseId || null,
      image_prompt: baseImage ? (baseImage.prompt || options.imagePrompt || options.image_prompt || null) : null,
      image_retry_number: Math.max(Number(baseImage?.attempt_count || baseImage?.attemptCount || 1) - 1, 0),
      image_generated_at: baseImage ? new Date() : null,
      image_usage: baseImage?.usage || null,
      original_visual: retainedOriginalVisual,
      reference_assets: productReferenceUrl && baseImage ? [{
        reference_type: "PRODUCT_IMAGE",
        ...(objectIdOrNull(recommendation.verifiedProductId || recommendation.verified_product_id, AssetModel)
          ? { product_id: objectIdOrNull(recommendation.verifiedProductId || recommendation.verified_product_id, AssetModel) }
          : {}),
        url: productReferenceUrl,
        original_database_url: productReferenceUrl,
        stored_url: baseImage.authentic_product_reference?.url || null,
        storage_provider: baseImage.authentic_product_reference?.storage_provider || null,
        storage_key: baseImage.authentic_product_reference?.storage_key || null,
        checksum_sha256: baseImage.reference_image_checksum_sha256 || null,
        mime_type: baseImage.authentic_product_reference?.mime_type || baseImage.reference_image_mime_type || null,
        detected_file_signature: baseImage.authentic_product_reference?.detected_file_signature || null,
        file_size_bytes: baseImage.authentic_product_reference?.file_size_bytes || null,
        width: baseImage.authentic_product_reference?.width || null,
        height: baseImage.authentic_product_reference?.height || null,
        database_record_verified: baseImage.authentic_product_reference?.database_record_verified === true,
        source_bytes_preserved: baseImage.authentic_product_composition?.source_reference_checksum_sha256
          === baseImage.reference_image_checksum_sha256,
        usage_rights_status: baseImage.authentic_product_reference?.usage_rights_status || "admin_confirmed",
        authenticity_must_be_preserved: true,
      }] : [],
      is_active: true,
      deleted_at: null,
    };
    const validation = await validateSocialAsset(preliminaryAsset, {
      buffer,
      expectedWidth: canvas.width,
      expectedHeight: canvas.height,
      expectedCopy: item.approved_copy,
      manualReviewFlags: [
        ...manualFlagsForProvenance(
          effectiveProvenance,
          Boolean(logo) || (fullAiGraphicV2 && baseImage?.poster_validation?.brandIdentityMatch === true),
          effectiveUsageRights,
          artworkOnly,
        ).filter((flag) => !(fullAiGraphicV2 && flag === "BASE_IMAGE_CONTAINS_UNAPPROVED_TEXT")),
        ...(fullAiGraphicV2 ? ["AI_NATIVE_EXACT_TEXT_AND_BRAND"] : []),
        ...(productReferenceUrl ? ["AUTHENTIC_PRODUCT_PACKAGING_LABEL_VARIANT_QUANTITY"] : []),
      ],
    });
    const record = {
      ...preliminaryAsset,
      validation_checklist: validation.validation_checklist,
      validation_status: validation.validation_status,
      manual_review_required: validation.manual_review_required,
      manual_review_flags: validation.manual_review_flags,
      manual_review_status: validation.manual_review_required ? "pending" : "not_required",
    };
    delete record.file_path;
    delete record.dimensions;
    const draftId = objectIdOrNull(identity.rawId, AssetModel);
    const generationRunId = objectIdOrNull(identity.rawRunId, AssetModel);
    if (draftId) record.draft_id = draftId;
    if (generationRunId) record.generation_run_id = generationRunId;

    let persisted = null;
    if (shouldPersist) {
      persisted = await AssetModel.findOneAndUpdate(
        { url: stored.url },
        { $set: record },
        { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true },
      );
    }
    results.push(serializeAssetDocument(persisted, {
      ...record,
      file_path: stored.file_path,
      dimensions: { width: canvas.width, height: canvas.height },
      validation,
    }));
  }

  if (shouldPersist && options.replaceActive !== false && options.replace_active !== false) {
    await AssetModel.updateMany(
      { draft_key: identity.draftKey, is_active: true, asset_role: "FINAL_COMPOSED", asset_group_id: { $ne: assetGroupId } },
      { $set: { is_active: false } },
    );
  }

  const manualReviewRequired = results.some((asset) => asset.manual_review_required);
  const invalid = results.some((asset) => asset.validation_status === "invalid");
  return {
    asset_group_id: assetGroupId,
    content_type: socialFormat === "CAROUSEL" ? "carousel" : socialFormat.toLowerCase(),
    social_format: socialFormat,
    canvas_format: canvas.canvas_format,
    dimensions: { width: canvas.width, height: canvas.height },
    aspect_ratio: canvas.aspect_ratio,
    primary_asset_url: results[0]?.url || null,
    asset_urls: results.map((asset) => asset.url),
    assets: results,
    validation_status: invalid ? "invalid" : manualReviewRequired ? "needs_manual_review" : "valid",
    manual_review_required: manualReviewRequired,
    manual_review_flags: Array.from(new Set(results.flatMap((asset) => asset.manual_review_flags || []))),
    renderer: results[0]?.renderer || (artworkOnly ? "sharp_resize_only" : "sharp_svg_overlay"),
    render_version: RENDER_VERSION,
  };
}

module.exports = {
  BRAND,
  CANVASES,
  renderSocialDraftAssets,
  validateSocialAsset,
  _private: {
    buildBrandBaseSvg,
    buildCopyOverlaySvg,
    buildRenderItems,
    calculateTextLayout,
    contrastRatio,
    normalizeCanvas,
    normalizeSourceProvenance,
    normalizeSocialFormat,
    normalizeUsageRights,
    isSocialFormatValue,
    selectRecommendation,
    stableStringify,
    wrapText,
  },
};
