const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const sharp = require("sharp");

const {
  ART_DIRECTION_SYSTEM_VERSION,
  resolvePinkPaisaArtDirection,
} = require("../services/social/socialArtDirection");
const { buildProductionImagePrompt } = require("../services/social/socialAiImageService");
const {
  buildBrandLogoContract,
  serializeBrandLogoContract,
} = require("../services/social/socialBrandLogoPolicy");
const {
  renderSocialDraftAssets,
  _private: { buildCopyOverlaySvg, calculateTextLayout },
} = require("../services/socialCreativeService");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function recommendation({
  objective = "EDUCATION",
  format = "SINGLE_IMAGE",
  postType = "EDUCATIONAL",
  contentPillar = "Money Education",
} = {}) {
  const headline = "Pause before a money headline moves you";
  const supportingText = "Read the source, check the impact, then act calmly.";
  return {
    internalTitle: "A calmer response to money headlines",
    topic: "Evaluating financial headlines",
    objective,
    format,
    postType,
    contentPillar,
    verifiedProductFacts: null,
    formatContent: {
      id: "creative-style-test",
      format,
      postType,
      objective,
      contentPillar,
      targetAudience: "Indian women building financial confidence",
      whyToday: "A repeatable evaluation habit is useful.",
      formatReason: "One visual explains the decision path clearly.",
      hookOptions: [headline, "Pause, verify, decide", "Check before you act"],
      caption: "A headline is context, not automatically a money instruction.",
      cta: "Save this three-step check.",
      hashtags: ["#PinkPaisa", "#MoneyEducation", "#WomenAndMoney"],
      altText: "An editorial financial education graphic with three decision icons.",
      recommendedLandingPage: "/",
      sourceIndexes: [],
      financialDisclaimer: "Financial education, not financial advice.",
      affiliateDisclosure: null,
      selectedHeadline: headline,
      supportingText,
      imagePrompt: "Create a text-free original visual about calmly evaluating a financial headline.",
      negativeVisualInstructions: ["No visible text, watermark, fake interface or unrelated logo."],
      overlayInstructions: { logoPosition: "Top safe area" },
    },
    visualBrief: {
      id: "creative-style-test",
      format,
      visualMode: "AI_VISUAL_WITH_EXACT_OVERLAY",
      assets: [{
        sequence: 1,
        role: "PRIMARY_VISUAL",
        imagePrompt: "Create a text-free original visual about calmly evaluating a financial headline.",
        overlayInstructions: "Keep integrated editorial space for exact copy.",
        requiredObjects: ["news-page icon", "magnifying-glass icon", "shield icon"],
        prohibitedObjects: ["visible text", "logos", "watermarks"],
      }],
    },
  };
}

async function validatedBaseImage() {
  const buffer = await sharp({
    create: { width: 1200, height: 1500, channels: 3, background: { r: 176, g: 32, b: 91 } },
  }).composite([{
    input: Buffer.from('<svg width="1200" height="1500" xmlns="http://www.w3.org/2000/svg"><circle cx="930" cy="520" r="300" fill="#F05A47"/><path d="M650 1100 L1100 760 L1200 1500 L620 1500 Z" fill="#351927"/></svg>'),
    top: 0,
    left: 0,
  }]).jpeg({ quality: 90 }).toBuffer();
  const checksum = sha256(buffer);
  return {
    buffer,
    url: "https://media.pinkpaisa.test/styles/original.jpg",
    source_url: "https://media.pinkpaisa.test/styles/original.jpg",
    storage_provider: "external",
    storage_key: "styles/original.jpg",
    checksum_sha256: checksum,
    provider: "openai",
    model: "gpt-image-2",
    prompt: "Approved Pink Paisa creative-style prompt",
    response_id: "img-style-test",
    status: "VALIDATED",
    source_provenance: "generated_without_reference",
    usage_rights_status: "api_permitted",
    width: 1200,
    height: 1500,
    mime_type: "image/jpeg",
    file_size_bytes: buffer.length,
  };
}

function memoryStore(records) {
  return async ({ fileName, buffer }) => {
    records.push({ fileName, buffer });
    return {
      url: `https://media.pinkpaisa.test/styles/${fileName}`,
      storage_provider: "external",
      storage_key: `styles/${fileName}`,
      checksum_sha256: sha256(buffer),
    };
  };
}

test("Pink Paisa routes informational work to Style 1 and engagement work to Style 3", () => {
  assert.equal(resolvePinkPaisaArtDirection(recommendation()).id, "EDITORIAL_ICON_GRID");
  assert.equal(resolvePinkPaisaArtDirection(recommendation({ objective: "ENGAGEMENT", postType: "ENGAGEMENT" })).id, "BOLD_EDITORIAL_COLLAGE");
  assert.equal(resolvePinkPaisaArtDirection(recommendation({ format: "POLL", contentPillar: "Interactive" })).id, "BOLD_EDITORIAL_COLLAGE");
  assert.equal(resolvePinkPaisaArtDirection({}, "BOLD_EDITORIAL_COLLAGE").id, "BOLD_EDITORIAL_COLLAGE");
});

test("production prompts enforce the selected premium style and ban the cheap stock-card treatment", () => {
  const editorial = buildProductionImagePrompt({
    recommendation: recommendation(),
    request: { prompt: "Create a clear text-free visual.", required_objects: [] },
  });
  const collage = buildProductionImagePrompt({
    recommendation: recommendation({ objective: "COMMUNITY_BUILDING", postType: "ENGAGEMENT" }),
    request: { prompt: "Create a clear text-free visual.", required_objects: [] },
  });

  assert.match(editorial, /EDITORIAL_ICON_GRID/);
  assert.match(editorial, /asymmetric modular grid/i);
  assert.match(collage, /BOLD_EDITORIAL_COLLAGE/);
  assert.match(collage, /cut-paper shapes/i);
  for (const prompt of [editorial, collage]) {
    assert.match(prompt, /stock-like office or desk vignette/i);
    assert.match(prompt, /large floating white card/i);
    assert.match(prompt, /Render no text, letters, numbers, currency symbols or logos/i);
  }
});

test("style-aware verified overlays remove the legacy rounded card and remain valid SVG", async () => {
  const editorialLayout = calculateTextLayout({
    width: 1080,
    height: 1350,
    headline: "Pause before a money headline moves you",
    body: "Read the source, check the impact, then act calmly.",
    artDirection: "EDITORIAL_ICON_GRID",
  });
  const collageLayout = calculateTextLayout({
    width: 1080,
    height: 1350,
    headline: "Pause before a money headline moves you",
    body: "Read the source, check the impact, then act calmly.",
    artDirection: "BOLD_EDITORIAL_COLLAGE",
  });
  const editorialSvg = buildCopyOverlaySvg({ width: 1080, height: 1350, layout: editorialLayout, sequence: 1, total: 3, artDirection: "EDITORIAL_ICON_GRID" });
  const collageSvg = buildCopyOverlaySvg({ width: 1080, height: 1350, layout: collageLayout, sequence: 1, total: 3, artDirection: "BOLD_EDITORIAL_COLLAGE" });

  assert.equal(editorialLayout.card, null);
  assert.equal(collageLayout.card, null);
  assert.match(editorialSvg.toString(), /data-art-direction="EDITORIAL_ICON_GRID"/);
  assert.match(collageSvg.toString(), /data-art-direction="BOLD_EDITORIAL_COLLAGE"/);
  assert.doesNotMatch(editorialSvg.toString(), /rx="46"|fill-opacity="0\.95"/);
  assert.doesNotMatch(collageSvg.toString(), /rx="46"|fill-opacity="0\.95"/);

  const [editorialBuffer, collageBuffer] = await Promise.all([
    sharp({ create: { width: 1080, height: 1350, channels: 4, background: "#FFF8F3" } }).composite([{ input: editorialSvg }]).png().toBuffer(),
    sharp({ create: { width: 1080, height: 1350, channels: 4, background: "#FFF8F3" } }).composite([{ input: collageSvg }]).png().toBuffer(),
  ]);
  assert.notEqual(sha256(editorialBuffer), sha256(collageBuffer));
});

test("final exact-overlay assets record the selected creative system without weakening copy provenance", async () => {
  const baseImage = await validatedBaseImage();
  const selectedRecommendation = recommendation({ objective: "ENGAGEMENT", postType: "ENGAGEMENT" });
  const runtimeBrandContract = await buildBrandLogoContract({
    draftLike: { idempotency_key: "style-3-final" },
    recommendation: selectedRecommendation,
  });
  const brandLogoContract = serializeBrandLogoContract(runtimeBrandContract);
  const brandLogoEvidence = {
    outcome: "PASS",
    reference_asset_id: brandLogoContract.reference_asset_id,
    reference_checksum_sha256: brandLogoContract.reference_checksum_sha256,
    method: "AI_REFERENCE_BAKED",
    input_fidelity: "high",
    requested_corner: brandLogoContract.locked_corner,
    observed_corner: brandLogoContract.locked_corner,
    normalized_bounding_box: {
      x: brandLogoContract.safe_corner.target_box.left / brandLogoContract.safe_corner.target_box.canvas_width,
      y: brandLogoContract.safe_corner.target_box.top / brandLogoContract.safe_corner.target_box.canvas_height,
      width: brandLogoContract.safe_corner.target_box.width / brandLogoContract.safe_corner.target_box.canvas_width,
      height: brandLogoContract.safe_corner.target_box.height / brandLogoContract.safe_corner.target_box.canvas_height,
    },
    logo_count: 1,
    identity_checks: {
      approved_logo_present: true,
      reference_identity_match: true,
      wordmark_exact_match: true,
      icon_geometry_match: true,
      brand_colour_match: true,
      registered_mark_recognizable: true,
      single_badge_occurrence: true,
      safe_corner_match: true,
      fully_inside_safe_box: true,
      accepted_width_range: true,
      observed_badge_width_px: 210,
      mobile_legible: true,
      protected_content_overlap_present: false,
      no_unapproved_text: true,
      no_unrelated_logo_or_watermark: true,
    },
    validator_model: "gpt-5.6-luna",
    validator_response_id: "resp-style-logo-validation",
    validated_asset: "openai_normalized_final",
    validated_asset_checksum_sha256: baseImage.checksum_sha256,
    post_generation_logo_overlay_applied: false,
    issues: [],
  };
  Object.assign(baseImage, {
    source_provenance: "generated_from_approved_source",
    brand_logo_contract: brandLogoContract,
    brand_logo_evidence: brandLogoEvidence,
  });
  const rows = [];
  const result = await renderSocialDraftAssets({
    idempotency_key: "style-3-final",
    generation_date: "2026-08-26",
    brand_logo_contract: brandLogoContract,
    current_package: { primaryRecommendation: selectedRecommendation },
  }, {
    recommendation: selectedRecommendation,
    baseImages: [baseImage],
    visualMode: "AI_VISUAL_WITH_EXACT_OVERLAY",
    sourceProvenance: "generated_from_approved_source",
    usageRightsStatus: "api_permitted",
    persist: false,
    storeCampaignAsset: memoryStore(rows),
  });
  const asset = result.assets[0];

  assert.equal(asset.render_version, "social-creative-v2");
  assert.equal(asset.renderer, "sharp_svg_overlay");
  assert.equal(asset.overlay_json.text_rendering.method, "sharp_svg_overlay");
  assert.equal(asset.overlay_json.layout.card, null);
  assert.equal(asset.overlay_json.art_direction.id, "BOLD_EDITORIAL_COLLAGE");
  assert.equal(asset.overlay_json.art_direction.system_version, ART_DIRECTION_SYSTEM_VERSION);
  assert.equal(asset.provenance.creative_style.id, "BOLD_EDITORIAL_COLLAGE");
  assert.equal(asset.provenance.overlay.layout_variant, "BOLD_EDITORIAL_COLLAGE");
  assert.equal(asset.overlay_json.rendered_text.headline, selectedRecommendation.formatContent.selectedHeadline);
  assert.equal(asset.provenance.brand_logo_evidence.outcome, "PASS");
  assert.equal(asset.provenance.logo.method, "openai_reference_baked");
  assert.equal(asset.provenance.logo.post_generation_logo_overlay_applied, false);
  assert.match(asset.approved_copy_checksum_sha256, /^[a-f0-9]{64}$/);
  assert.equal(rows.length, 1);
});
